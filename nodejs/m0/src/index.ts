import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * M0：LLM 应用快速入门 —— 单轮对话。
 *
 * 用 @anthropic-ai/sdk 调用 DeepSeek 的 Anthropic 兼容端点，
 * 发起一次聊天请求并打印回复。对应 python/m0 的 llm.py。
 */

// 初始化客户端
const client = new Anthropic({
  apiKey: process.env.DEEPSEEK_API_KEY, // 身份验证凭证，确保你有权访问 API
  baseURL: 'https://api.deepseek.com/anthropic', // DeepSeek 的 Anthropic 兼容端点
});

// 构建聊天请求
const response = await client.messages.create({
  model: 'deepseek-v4-pro', // 指定模型版本
  max_tokens: 1024,
  temperature: 0.5,
  messages: [
    // 对话消息数组
    { role: 'user', content: '你是谁？' },
  ],
});
// console.log(response);
// 打印结果
const text = response.content
  .filter((block): block is Anthropic.TextBlock => block.type === 'text')
  .map((block) => block.text)
  .join('')
  .trim();
console.log(text);
