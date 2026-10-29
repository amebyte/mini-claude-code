import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

/**
 * M0：LLM 应用快速入门 —— 工具调用（tool use）。
 *
 * 用 @anthropic-ai/sdk 调用 DeepSeek 的 Anthropic 兼容端点，
 * 演示「文件读取助手」：模型判断是否调用 read_file 工具，
 * 执行后二次请求生成最终回答。对应 python/m0 的 llm2.py。
 */

// ---------- 工具定义 ----------
const tools: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: '读取文本文件内容。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要读取的文件路径' },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'gbk'],
          description: '文件编码格式',
        },
      },
      required: ['path'],
    },
  },
];

// ---------- 工具实现 ----------
function executeReadFile(args: {
  path: string;
  encoding?: 'utf-8' | 'gbk';
}): string {
  try {
    const filePath = expandUser(args.path);
    if (!existsSync(filePath)) {
      return `文件不存在: ${args.path}`;
    }
    const buf = readFileSync(filePath);
    // TextDecoder 走 ICU，utf-8 / gbk 都能解（Node 默认构建含 full-icu）。
    return new TextDecoder(args.encoding ?? 'utf-8').decode(buf);
  } catch (e) {
    return `读取失败: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** 展开路径中的 `~`（对应 Python 的 Path.expanduser()）。 */
function expandUser(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// ---------- 初始化客户端 ----------
const client = new Anthropic({
  apiKey: process.env.DEEPSEEK_API_KEY, // 身份验证凭证，确保你有权访问 API
  baseURL: 'https://api.deepseek.com/anthropic', // DeepSeek 的 Anthropic 兼容端点
});

// ---------- 构建对话 ----------
const system = '你是一个文件读取助手，必要时可以调用工具帮助用户读取文件内容。';
const messages: Anthropic.MessageParam[] = [];
const userInput = '帮我读一下 file.txt';
messages.push({ role: 'user', content: userInput });
console.log(`用户: ${userInput}\n`);

// 第一步：请求模型判断是否调用工具
const response = await client.messages.create({
  model: 'deepseek-v4-pro', // 指定模型版本
  max_tokens: 1024,
  system,
  messages,
  tools,
  tool_choice: { type: 'auto' },
});
messages.push({ role: 'assistant', content: response.content });
// console.log(JSON.stringify(response, null, 2));



// 第二步：处理工具调用
const toolUseBlocks = response.content.filter(
  (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
);

if (toolUseBlocks.length > 0) {
  const toolResults: Anthropic.ToolResultBlockParam[] = [];

  for (const toolUse of toolUseBlocks) {
    if (toolUse.name === 'read_file') {
      const args = toolUse.input as {
        path: string;
        encoding?: 'utf-8' | 'gbk';
      };
      const result = executeReadFile(args);
      console.log(`调用工具: ${toolUse.name}, 参数: ${JSON.stringify(args)}`);
      console.log(`工具执行结果:\n${result}\n`);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }
  }

  // 第三步：二次请求，生成最终回答
  messages.push({ role: 'user', content: toolResults });
  const secondResponse = await client.messages.create({
    model: 'deepseek-v4-pro',
    max_tokens: 2048,
    system,
    messages,
  });

  const finalText = secondResponse.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  console.log(`助手: ${finalText}`);
} else {
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  console.log(`助手: ${text}`);
}
