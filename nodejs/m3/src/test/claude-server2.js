import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// 端口
const PORT = 9527;
const HOST = '127.0.0.1';
// 每个 SSE 事件之间停顿的毫秒数。设为 0 会一口气全写出来（看不出「流」），
// 设大一点能让客户端的 for await 循环肉眼可见地「一段一段」收到字节。
const DELAY_MS = 40;

/**
 * CORS 响应头。允许任意来源（*）访问，方便本地前端 / 其他端口页面跨域调用这个模拟 API。
 * 真实生产环境应把 * 换成具体的前端域名白名单。
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, anthropic-version',
};

/** 返回一个等待 ms 毫秒的 Promise，用于在「生成/写事件」之间人工停顿，模拟流式延迟 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 把一个事件序列化成 SSE 文本。
 *
 * SSE 协议里，一个事件由若干「field: value」行组成，事件之间用【空行】\n\n 分隔。
 * 这里每个事件写两行：
 *   event: <类型>      —— 事件名（真实 SDK 会用它分流，本项目的客户端只读 data 行，可留可去）
 *   data:  <json>      —— 事件体，客户端 JSON.parse 的就是它
 * 末尾的 \n\n 就是客户端靠 indexOf('\n\n') 切分事件的依据，绝对不能漏。
 */
function sseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
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

/**
 * 把「一条完整回复」展开成 Anthropic 流式协议要求的【6 种事件序列】，并逐段
 * res.write() 到响应流里，最后 res.end() 收尾。
 *
 * 这正是真实 API 在 stream:true 时返回的字节结构，事件按固定顺序出现：
 *
 *   message_start        —— 整条消息的骨架（content 还空着，usage 先占位）
 *   content_block_start  —— 声明第一个文本块（text 为空）
 *   content_block_delta × N —— 逐块吐字，delta.text 是新吐出的一小段文字
 *   content_block_stop   —— 文本块结束
 *   message_delta        —— 携带 stop_reason 与最终 token 用量
 *   message_stop         —— 整条消息结束
 *
 * 写入不是一次性完成的：content_block_delta 靠 splitDeltas 这个异步生成器「边等
 * 边吐」，每个事件之间隔着 DELAY_MS 的 setTimeout 停顿，客户端因此能清楚地看到
 * 字节「一段接一段」地到，而不是一次性收到。
 */
async function buildStreamEvents(res, { model, prompt }) {
  const messageId = newMessageId();
  const reply = buildReply(prompt);
  // input/output token 只是个近似值，够 demo 展示 usage 字段即可
  const inputTokens = Math.max(1, Math.ceil(Array.from(prompt).length / 4));

  // 1. message_start：整条消息的骨架，content 恒为空，文本靠后面的 delta 一点点填
  res.write(
    sseEvent('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [], // 流式开始时 content 恒为空，文本要靠后面的 delta 一点点填
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 1 },
      },
    })
  );

  // 2. content_block_start：index 0 表示这是第 0 个（也是唯一一个）内容块
  res.write(
    sseEvent('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })
  );

  // 3. 逐块吐字：这是流式输出的「主角」，客户端每收到一个就多打印一小段。
  //    splitDeltas 是异步生成器，每 yield 一段就停 DELAY_MS，for await 边等边写。
  let outputTokens = 0;
  for await (const delta of splitDeltas(reply)) {
    if (res.destroyed) return; // 客户端已断开（比如 Ctrl+C），停止写入
    outputTokens += 1;
    res.write(
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: delta },
      })
    );
  }

  if (res.destroyed) return;

  // 4. content_block_stop
  res.write(
    sseEvent('content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    })
  );

  // 5. message_delta
  res.write(
    sseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    })
  );

  // 6. message_stop
  res.write(sseEvent('message_stop', { type: 'message_stop' }));

  res.end(); // 全部写完，结束这条响应
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

/**
 * 设置 SSE 响应头并启动流式写入。POST /v1/messages 和 GET /v1/messages/stream
 * （EventSource 用）两个分支共用这一段逻辑；真正的「展开事件 + 逐段 res.write/res.end」
 * 都发生在 buildStreamEvents 内部。
 */
function writeSseStream(res, { model, prompt }) {
  // SSE 的标准响应头。不设 Content-Length，让 HTTP 走 chunked 编码逐段下发；
  // flushHeaders() 先把这些头立刻发给客户端，之后 res.write 的每一段都会「即时」到达。
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    ...CORS_HEADERS,
  });
  res.flushHeaders();

  // 事件序列的展开与逐段 res.write()/res.end() 都在 buildStreamEvents 内部完成，
  // 这里 fire-and-forget 启动即可（客户端断开时内部会靠 res.destroyed 判断停止）。
  buildStreamEvents(res, { model, prompt });
}

const server = createServer(async (req, res) => {
  const { method, url } = req;
  // url 里可能带查询串（GET 分支要读它），统一解析出 pathname 和 searchParams
  const { pathname, searchParams } = new URL(url, `http://${HOST}:${PORT}`);

  // ===== GET 分支：专供浏览器标准的 EventSource 使用 =====
  // EventSource 只能发 GET、不能带 body，所以「问题」走查询参数传递。
  // 返回的字节流与 POST 分支完全一致，只是「输入」的传法不同。
  if (method === 'GET' && pathname === '/v1/messages/stream') {
    const prompt = searchParams.get('prompt') ?? '（未提供问题，用默认演示文案）';
    const model = searchParams.get('model') ?? 'deepseek-v4-pro';
    writeSseStream(res, { model, prompt });
    return;
  }

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
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          ...CORS_HEADERS,
        });
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
