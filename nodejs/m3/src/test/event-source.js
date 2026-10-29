const BASE_URL = 'http://localhost:9527'; // 本地模拟服务器
const MODEL = 'deepseek-v4-pro';
const PROMPT = '用一句话解释什么是流式输出';

// EventSource 只发 GET，问题只能走查询参数，而不是 POST 的 JSON body
const url = new URL('/v1/messages/stream', BASE_URL);
url.searchParams.set('model', MODEL);
url.searchParams.set('prompt', PROMPT);

const es = new EventSource(url);

let fullText = ''; // 用来在最后还原完整回复

// 小工具：把「事件名 → 回调」的注册包一层。事件对象其实是 MessageEvent，
// 它的 .data 就是服务器 data: 行里那串 JSON 字符串——EventSource 已把
// 切事件、抠 data 行、拼字符串这些活儿干完了，只剩 JSON.parse 留给你。
function on(type, handler) {
  es.addEventListener(type, (ev) => handler(ev.data));
}

// 1. message_start —— 整条消息的骨架（content 还空着，usage 先占位）
on('message_start', (data) => {
  console.log('[message_start]', data);
});

// 2. content_block_start —— 声明第一个文本块
on('content_block_start', (data) => {
  console.log('[content_block_start]', data);
});

// 3. content_block_delta —— 逐块吐字，真正「流」出来的文本增量
on('content_block_delta', (data) => {
  const event = JSON.parse(data);
  console.log('[content_block_delta]', data);
  // 等价于之前的 for await 里面的
  //   if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
  //     fullText += event.delta.text;
  if (event.delta?.type === 'text_delta') fullText += event.delta.text;
});

// 4. content_block_stop —— 文本块结束
on('content_block_stop', (data) => {
  console.log('[content_block_stop]', data);
});

// 5. message_delta —— stop_reason 与最终 token 用量
on('message_delta', (data) => {
  console.log('[message_delta]', data);
});

// 6. message_stop —— 整条消息结束：主动 close() 关掉连接（否则 EventSource 会
//    自动重连），然后打印还原出的完整文本
on('message_stop', (data) => {
  console.log('[message_stop]', data);
  es.close();

  console.log('');
  console.log('=== 2. 还原出的完整文本===');
  console.log(fullText);
});

// 连接出错时的兜底（比如服务器没起）。message_stop 里 close() 之后也会触发一次
// error 事件，但那时 readyState 已是 CLOSED，直接忽略即可。
es.onerror = () => {
  if (es.readyState === EventSource.CLOSED) return;
  console.error('\n连接失败或中断（本地模拟服务器是否已启动？）');
  es.close();
  process.exit(1);
};
