/**
 * 完整 CLI 入口（对应真实源码 `src/main.tsx`，真实文件含 ink 渲染与 JSX，
 * 本小节无 JSX 先简化为 `main.ts`）。
 *
 * 真实实现用 commander 组织完整的参数解析、交互式 REPL 与会话管理。
 * 本小节 在 上一小节（单轮对话）的基础上，把 `.action()` 里的 `streamMessage` 升级为
 * 真正的 Agent Loop：调 API → 若返回 tool_use 就执行工具 → 回喂 tool_result
 * → 再调 API，直到返回纯文本。对应计划文档 v5.0 的「本小节 · 核心 Agent Loop」。
 */

import { Command } from 'commander';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { query } from './query.js';
import { fakeBashTool } from './tools/FakeTool.js';

// 真实 Claude Code 有一个庞大、随版本变化的 system prompt（角色 + 工具说明 + 环境信息）。
// 本小节 先放一条最小提示，让模型知道「有个 bash 工具，需要执行命令就调它」。
const SYSTEM_PROMPT = [
  '你是 Claude Code 的最小还原实现（本小节 · 核心 Agent Loop）。',
  '你有一个 `bash` 工具（本里程碑是假实现，固定返回字符串）。',
  '当任务需要执行命令或获取系统信息时，调用 `bash` 工具；拿到结果后继续作答，直到给出最终回答。',
].join(' ');

export async function main(): Promise<void> {
  const program = new Command();

  program
    .name('claude')
    .description('Claude Code 源码最小还原实现（本小节 · 核心 Agent Loop）')
    .argument('[prompt]', '给 agent 的提示词', String)
    .version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')
    .helpOption('-h, --help', 'Display help for command')
    .action(async (prompt: string | undefined) => {
      // 裸启动（无 prompt）：交互式 REPL 属于将来实现，本里程碑仍未实现。
      if (prompt === undefined) {
        console.error('[未实现] 交互式 REPL 尚未实现（将来实现）');
        process.exitCode = 1;
        return;
      }

      try {
        // 初始 messages 只有一条 user 消息；system prompt 单独作为 system 参数传入。
        const messages: MessageParam[] = [{ role: 'user', content: prompt }];

        // 驱动 Agent Loop：文本由 claude.ts 流式打印，这里只渲染工具事件。
        for await (const event of query({
          messages,
          tools: [fakeBashTool],
          system: SYSTEM_PROMPT,
        })) {
          switch (event.type) {
            case 'tool_use':
              console.log(`\n[工具调用] ${event.name} ${JSON.stringify(event.input)}`);
              break;
            case 'tool_result':
              console.log(`[工具结果] ${event.content}\n`);
              break;
          }
        }
        // 结尾补一个换行，让最终回复独立成行。
        console.log('');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[错误] ${message}`);
        process.exitCode = 1;
      }
    });

  await program.parseAsync(process.argv);
}
