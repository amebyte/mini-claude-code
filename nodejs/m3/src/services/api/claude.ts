import { getAnthropicClient } from './client.js';

/**
 * 单轮对话：发一条消息，逐 token 流式打印回复。
 * 对应真实源码的流式调用：messages.create({ ...params, stream: true }) + for await。
 * 只做「一句话 → 流式打印」，不含工具调用循环（那属于后面的 Agent Loop）。
 */
export async function streamMessage(prompt: string): Promise<void> {
  const client = getAnthropicClient();
  const model = process.env.MODEL_ID ?? 'deepseek-v4-pro';

  const stream = await client.messages.create({
    model,
    // 真实代码有复杂的 token 预算管理，先用固定上限占位。
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
    stream: true,   // ← 关键：告诉服务端「边生成边推」
  });

  for await (const event of stream) {
    // 事件类型有很多种：——`message_start`、`content_block_start`、`content_block_delta`、`message_stop`……
    // delta.type 的类型有： thinking_delta text_delta
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      process.stdout.write(event.delta.text);   // 逐字打印，不加换行
    }
  }
  process.stdout.write('\n');   // 全部打印完，补一个换行
}