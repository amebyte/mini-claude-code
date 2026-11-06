/**
 * 完整 CLI 入口（对应真实源码 `src/main.tsx`，真实文件含 ink 渲染与 JSX，
 * T5 无 JSX 先简化为 `main.ts`）。
 *
 * 真实实现用 commander 组织参数解析，再分发到「交互式 REPL」（replLauncher）或
 * 「print 模式」（一次性 prompt）。T5 复刻这个分发：带 prompt 走一次性模式，
 * 不带 prompt 进入交互式 REPL。对应计划文档 v5.0 的「T5 · 交互式 REPL」。
 */

import { Command } from 'commander';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { runQuery } from './query.js';
import { TOOLS } from './tools.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { renderQueryEvent, startRepl } from './repl.js';

export async function main(): Promise<void> {
  const program = new Command();

  program
    .name('claude')
    .description('Claude Code 源码最小还原实现（T5 交互式 REPL）')
    .argument('[prompt]', '给 agent 的提示词（缺省进入交互式 REPL）', String)
    .version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')
    .helpOption('-h, --help', 'Display help for command')
    .action(async (prompt: string | undefined) => {
      // 无 prompt → 交互式 REPL（T5）npm run dev -- "你是谁"
      if (prompt === undefined) {
        await startRepl();
        return;
      }

      // 一次性模式：单条 prompt 跑一次 query 循环。
      try {
        const messages: MessageParam[] = [{ role: 'user', content: prompt }];
        await runQuery(
          { messages, tools: TOOLS, system: SYSTEM_PROMPT },
          renderQueryEvent,
        );
        console.log('');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[错误] ${message}`);
        process.exitCode = 1;
      }
    });

  await program.parseAsync(process.argv);
}
