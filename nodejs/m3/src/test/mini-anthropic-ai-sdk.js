/**
 * 最原始的流式请求：不依赖 @anthropic-ai/sdk，只用 Node 内置 fetch，
 * 把「原始 SSE 字节流」和「解析后的事件」都原样打印出来，直观对比流式返回的数据结构。
 *
 *
 * 想连回真实的 DeepSeek 兼容端点时，把下面 BASE_URL 改回
 * https://api.deepseek.com/anthropic，并在 .env 里配好 DEEPSEEK_API_KEY 即可。
 */

import 'dotenv/config';

const BASE_URL = 'http://localhost:9527'; // 本地模拟服务器，替代 https://api.deepseek.com/anthropic
const API_KEY = process.env.DEEPSEEK_API_KEY ?? 'local-dev'; // 本地服务器不校验 key，随便填一个；连真 API 时用 .env 里的真实值
const MODEL = process.env.MODEL_ID ?? 'deepseek-v4-pro';
const PROMPT = process.argv[2] ?? '用一句话解释什么是流式输出';

const url = `${BASE_URL}/v1/messages`;

// 这就是 SDK 在底层做的事：一个普通的 POST，stream: true
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: PROMPT }],
    stream: true,
  }),
});

if (!response.ok) {
  const errText = await response.text();
  console.error(`HTTP ${response.status}: ${errText}`);
  process.exit(1);
}

// response.body 是一个 Web ReadableStream<Uint8Array>，异步迭代它，
// 每次 yield 一段「网络刚送达」的字节。这正是 SDK 里 for await 的来源。
//
// 下面把「收字节」和「解析事件」合并在同一个 for await 循环里：
// 之前是先攒满 fullBody 再整体切分，这里改成边收边切——收到一段就试着
// 解析成事件，还没收完的最后一段留在 buffer 里等下一轮，等价于 SDK 内部
// 逐事件 yield 的行为。所以原始字节和解析后的事件会交替打印出来。
const decoder = new TextDecoder();
let buffer = '';   // 尚未切出完整事件的字节残留（可能正好被 chunk 边界切断）
let fullText = ''; // 用来在最后还原完整回复

for await (const chunk of response.body) {
  // 用 streaming 模式解码，避免一个多字节 UTF-8 字符被切在两个 chunk 里变成乱码
  const text = decoder.decode(chunk, { stream: true });
  process.stdout.write(text); // 原样打印，不加换行，保持字节流本来的样子
  buffer += text;

  // SSE 格式：事件之间用空行（\n\n）分隔。循环 indexOf 切分：能切出来的
  // 就是「已完整送达」的事件，最后一个可能还没收完，留给下一轮继续拼。
  let sep;
  while ((sep = buffer.indexOf('\n\n')) !== -1) {
    const raw = buffer.slice(0, sep);
    buffer = buffer.slice(sep + 2);
    if (raw.trim().length > 0) processEvent(raw);
  }
}

// 冲刷 decoder 里残留的字节，并处理最后一个可能没有 \n\n 结尾的事件
buffer += decoder.decode();
if (buffer.trim().length > 0) processEvent(buffer);
process.stdout.write('\n');

console.log('\n=== 2. 还原出的完整文本（等价于 SDK 里逐 token 打印的最终结果）===');
console.log(fullText);

// 处理一个「完整」的 SSE 事件：提取 data 行 → JSON.parse → 打印 + 拼文本
function processEvent(raw) {
  const dataLines = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (dataLines.length === 0) return;

  try {
    const event = JSON.parse(dataLines.join('\n'));
    console.log(`[${event.type}]`, JSON.stringify(event));

    // 只把「文本增量」拼起来，等价于 SDK 示例里的
    //   if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
    //     process.stdout.write(event.delta.text);
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      fullText += event.delta.text;
    }
  } catch {
    console.log('[无法解析]', raw);
  }
};
