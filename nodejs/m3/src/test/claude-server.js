import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// 端口
const PORT = 9527;
const HOST = '127.0.0.1';
// 每个 SSE 事件之间停顿的毫秒数。设为 0 会一口气全写出来（看不出「流」），
// 设大一点能让客户端的 for await 循环肉眼可见地「一段一段」收到字节。
const DELAY_MS = 40;

/** 返回一个等待 ms 毫秒的 Promise，用于在「生成/写事件」之间人工停顿，模拟流式延迟 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 生成一个形如 msg_xxx 的消息 id（模拟真实 API 的消息标识） */
function newMessageId() {
  return `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/**
 * 拼一条「模拟回复」。真实场景里这段文字是大模型按 token 生成的，这里直接
 * 手写一段，并把它收到的问题原样带回，好让 demo 跑起来有「它听懂了我」的感觉。
 */
function buildReply(prompt) {
  return (
    '这是一段由本地模拟生成的流式回复。' +
    `你刚才的问题是：「${prompt}」。` +
    '在真实场景里，这些文字是大模型一个 token 一个 token 吐出来的；' +
    '这里我用 setTimeout 把整段话切成小块、逐块 res.write()，' +
    '从而让客户端的 for await 循环能清楚地看到「边收边解析」的过程。'
  );
}

/**
 * 把完整回复切成一小段一小段的「增量」（text_delta），模拟大模型逐 token 吐字。
 * 中文字符本身就是一个信息单位，这里按「每次 1~3 个字符」切，块大小交替变化，
 * 更接近真实 token 的参差不齐。
 *
 * 这是一个【异步生成器】：每 yield 一小段增量后，就用 setTimeout 停顿 DELAY_MS，
 * 再继续生成下一段。这样下游 for await 循环「边等边收」，真正还原了 token 逐个
 * 吐出的节奏，而不是一口气把整段切好一次性返回。
 */
async function* splitDeltas(text) {
  const chars = Array.from(text); // 按码点切，避免把多字节字符（emoji 等）拆坏
  let i = 0;
  while (i < chars.length) {
    const size = (i % 3) + 1; // 1, 2, 3, 1, 2, 3 … 交替，让块大小不一
    yield chars.slice(i, i + size).join('');
    i += size;
    await delay(DELAY_MS); // 每生成一段就 setTimeout 停顿，模拟 token 逐个吐出
  }
}

/** 非流式响应：一次性返回完整 JSON（真实 API 在 stream:false 时的另一个分支） */
async function buildFullMessage({ model, prompt }) {
  const messageId = newMessageId();
  const reply = buildReply(prompt);
  // 非流式虽然没有逐段吐字，但服务端同样要「一个 token 一个 token」地把文字生成完
  // 才一次性返回。这里复用 splitDeltas 异步生成器：边等边拼出完整回复，中间的
  // DELAY_MS 停顿就是真实请求的生成时间。
  let text = '';
  for await (const delta of splitDeltas(reply)) {
    text += delta;
  }
  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(1, Math.ceil(Array.from(prompt).length / 4)),
      output_tokens: Array.from(text).length,
    },
  };
}

const server = createServer(async (req, res) => {
  const { method, url } = req;
  // url 里可能带查询串（GET 分支要读它），统一解析出 pathname 和 searchParams
  const { pathname, searchParams } = new URL(url, `http://${HOST}:${PORT}`);
  
  // 只认 POST /v1/messages（与客户端 baseURL + '/v1/messages' 对齐）
  if (method === 'POST' && pathname === '/v1/messages') {
    // 读请求体。这里直接拼字符串；真实服务器可能要限制 body 大小、处理 gzip 等
    let body = '';
    for await (const chunk of req) body += chunk;

    const parsed = JSON.parse(body || '{}');
    const model = parsed.model ?? 'deepseek-v4-pro';
    const stream = parsed.stream ?? false;
    const prompt = extractPrompt(parsed.messages);

    // ===== 非流式分支 =====
    if (!stream) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(await buildFullMessage({ model, prompt })));
        return;
    }
  }
});

// ============ 启动 ============
server.listen(PORT, HOST, () => {
  console.log('本地 Node.js 服务器已经启动，监听地址：', `http://${HOST}:${PORT}`);
});

/**
 * 从请求体里取出「要回复的问题」：取最后一条 role === 'user' 的消息文本。
 * 兼容两种 content 形态：
 *   - 字符串："你好"
 *   - 多 block 数组：[{ type: 'text', text: '你好' }, ...]（真实 SDK 常用后者）
 */
function extractPrompt(messages) {
  if (!Array.isArray(messages)) return '（未提供问题，用默认演示文案）';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      const text = m.content
        .filter((b) => b?.type === 'text')
        .map((b) => b.text)
        .join('');
      if (text) return text;
    }
  }
  return '（未提供问题，用默认演示文案）';
}
