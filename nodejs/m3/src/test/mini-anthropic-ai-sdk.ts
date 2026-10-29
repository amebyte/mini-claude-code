/**
 * mini-anthropic-ai-sdk
 *
 * 不依赖 @anthropic-ai/sdk，只用 Node 内置 fetch 手搓一个最小 Anthropic 客户端，
 * 只实现 streamMessage() 用到的那一个 API 面：
 *
 *   const client = new Anthropic({ apiKey, baseURL });
 *   const stream = await client.messages.create({ model, max_tokens, messages, stream: true });
 *   for await (const event of stream) {
 *     if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
 *       process.stdout.write(event.delta.text);
 *     }
 *   }
 *
 * 底层做的事和 raw-stream.ts 完全一样：一个 POST → 读 SSE 字节流 → 用
 * TextDecoder(stream) 增量解码 → 按 \n\n 边收边切成事件 → JSON.parse 出 event
 * → 通过 async generator 逐个 yield 出去。SDK 的「for await 拿到 event」本质
 * 就是一个 async generator，这里把那段逻辑从 raw-stream.ts 搬进来封装成类。
 *
 * 运行（在 nodejs/m1 目录下，.env 里配好 DEEPSEEK_API_KEY）：
 *   npx tsx src/test/mini-anthropic-ai-sdk.ts "你的问题"
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// ============ 类型定义（只声明本项目用到的部分） ============

type Role = 'user' | 'assistant';

/** 一条消息（真实 SDK 支持多 block、多模态，这里只留最常用的纯文本） */
interface MessageParam {
  role: Role;
  content: string;
}

/** messages.create() 的入参（其余参数如 temperature 等暂不实现） */
interface MessageCreateParams {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  stream?: boolean;
}

/** 非流式响应：完整消息（简化版，只标出常用字段） */
interface Message {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * 流式事件对象。真实 SDK 里是 message_start / content_block_start /
 * content_block_delta / content_block_stop / message_delta / message_stop
 * 的联合类型；mini 版只精确声明用到的 content_block_delta，其余字段一律
 * 放开（用索引签名兜底），够 streamMessage 用即可。
 */
interface MessageStreamEvent {
  type: string;
  index?: number;
  delta?: { type?: string; text?: string; [key: string]: unknown };
  [key: string]: unknown;
}

// ============ 客户端 ============

/**
 * 对应 @anthropic-ai/sdk 的 Anthropic 类。真实 SDK 的 constructor 还处理
 * proxy、自定义 header、OAuth、多 provider（Bedrock/Vertex）等，这里只留
 * apiKey + baseURL 两个字段。
 */
export class Anthropic {
  /** 对应真实 SDK 的 client.messages（一个资源对象，上面挂 create 等方法） */
  readonly messages: Messages;

  private apiKey: string;
  private baseURL: string;

  constructor(opts: { apiKey: string; baseURL?: string }) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL ?? 'https://api.anthropic.com';
    this.messages = new Messages(this);
  }

  // 下面两个方法不加 private，是给 Messages 用的「内部方法」。TS 没有跨类的
  // friend 访问，真实 SDK 里这些也只是一个模块内的普通函数。

  async _create(params: MessageCreateParams): Promise<Message | MessageStream> {
    const stream = params.stream ?? false;
    const response = await this._request(params, stream);

    if (stream) {
      // response.body 是 Web ReadableStream<Uint8Array>，交给 MessageStream
      // 去异步迭代（Node 里它可被 for await，但类型上要转一下）。
      if (!response.body) throw new Error('响应缺少 body，无法流式读取');
      return new MessageStream(response.body as unknown as AsyncIterable<Uint8Array>);
    }

    return (await response.json()) as Message;
  }

  async _request(params: MessageCreateParams, stream: boolean): Promise<Response> {
    const url = `${this.baseURL}/v1/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...params, stream }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }
    return response;
  }
}

/**
 * 对应真实 SDK 的 Messages 资源：client.messages.create(...)。
 * 用重载让 TypeScript 根据 stream 字面量自动收窄返回类型：
 * stream: true  → MessageStream（可 for await）
 * 否则          → Message（完整消息）
 */
export class Messages {
  constructor(private client: Anthropic) {}

  create(params: MessageCreateParams & { stream: true }): Promise<MessageStream>;
  create(params: MessageCreateParams & { stream?: false }): Promise<Message>;
  create(params: MessageCreateParams): Promise<Message | MessageStream>;
  create(params: MessageCreateParams): Promise<Message | MessageStream> {
    return this.client._create(params);
  }
}

// ============ 流 ============

/**
 * 对应真实 SDK 的 MessageStream：一个 AsyncIterable，for await 它就能逐个
 * 拿到解析好的 event。核心是下面的 async generator——这正是「SDK 里 for await
 * 拿到的 event」的来源，逻辑和 raw-stream.ts 合并后的那段一模一样。
 */
export class MessageStream implements AsyncIterable<MessageStreamEvent> {
  constructor(private body: AsyncIterable<Uint8Array>) {}

  async *[Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
    const decoder = new TextDecoder();
    let buffer = ''; // 尚未切出完整事件的字节残留（可能正好被 chunk 边界切断）

    for await (const chunk of this.body) {
      // streaming 模式解码，避免多字节 UTF-8 字符被切在两个 chunk 里变成乱码
      buffer += decoder.decode(chunk, { stream: true });

      // SSE：事件之间用空行（\n\n）分隔。循环 indexOf 切分，能切出来的就是
      // 「已完整送达」的事件，最后一个可能还没收完，留给下一轮继续拼。
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = this._parseEvent(raw);
        if (event) yield event;
      }
    }

    // 冲刷 decoder 残留字节，处理最后一个可能没有 \n\n 结尾的事件
    buffer += decoder.decode();
    const event = this._parseEvent(buffer);
    if (event) yield event;
  }

  /** 把一段完整 SSE 文本解析成一个 event；解析不了（心跳/注释/[DONE]）返回 null */
  private _parseEvent(raw: string): MessageStreamEvent | null {
    if (raw.trim().length === 0) return null;

    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }
    if (dataLines.length === 0) return null;

    const json = dataLines.join('\n');
    if (json === '[DONE]') return null; // 某些兼容端点用 [DONE] 标记结束，跳过

    try {
      return JSON.parse(json) as MessageStreamEvent;
    } catch {
      return null; // 无法解析的行直接跳过，不影响后续事件
    }
  }
}

// ============ 使用示例（等价于 claude.ts 的 streamMessage） ============

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error('缺少 DEEPSEEK_API_KEY，请在 .env 中配置（参考 .env.example）');
    process.exit(1);
  }

  const client = new Anthropic({
    apiKey,
    baseURL: 'https://api.deepseek.com/anthropic', // 与 client.ts 的 baseURL 一致
  });

  const model = process.env.MODEL_ID ?? 'deepseek-v4-pro';
  const prompt = process.argv[2] ?? '用一句话解释什么是流式输出';

  const stream = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  });

  for await (const event of stream) {
    // 真实 SDK 里 delta 一定存在；mini 版类型放宽了，所以这里加 ?. 与 ?? '' 兜底
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      process.stdout.write(event.delta.text ?? '');
    }
  }
  process.stdout.write('\n');
}

// 直接运行本文件（npx tsx src/test/mini-anthropic-ai-sdk.ts）时执行示例；
// 被别的模块 import 时跳过，只当普通 SDK 用。
const isEntryPoint =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
