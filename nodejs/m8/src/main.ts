/**
 * 完整 CLI 入口（对应真实源码 `src/main.tsx`，真实文件含 ink 渲染与 JSX，
 * T6 无 JSX 先简化为 `main.ts`）。
 *
 * 真实实现用 commander 组织参数解析，再分发到「交互式 REPL」（replLauncher）或
 * 「print 模式」（一次性 prompt）。T6 加权限系统：`--dangerously-skip-permissions`
 * 对应真实的同名 flag（切到 bypassPermissions 模式跳过所有检查）。
 */

import { Command } from 'commander';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { runQuery } from './query.js';
import { TOOLS } from './tools.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { renderQueryEvent, startRepl } from './repl.js';
import type { PermissionMode } from './types/permissions.js';

export async function main(): Promise<void> {
  const program = new Command();

  program
    .name('claude')
    .description('Claude Code 源码最小还原实现（T6 权限系统）')
    .argument('[prompt]', '给 agent 的提示词（缺省进入交互式 REPL）', String)
    .option('--dangerously-skip-permissions', '跳过所有权限检查（危险）')
    .version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')
    .helpOption('-h, --help', 'Display help for command')
    .action(async (prompt: string | undefined, options: { dangerouslySkipPermissions?: boolean }) => {
      const mode: PermissionMode = options.dangerouslySkipPermissions
        ? 'bypassPermissions'
        : 'default';

      // 无 prompt → 交互式 REPL（T5）
      if (prompt === undefined) {
        await startRepl(mode);
        return;
      }

      // 一次性模式：单条 prompt 跑一次 query 循环（无 onApproval → ask 决策 fail-closed）。
      try {
        const messages: MessageParam[] = [{ role: 'user', content: prompt }];
        await runQuery(
          { messages, tools: TOOLS, system: SYSTEM_PROMPT, permission: { mode, cwd: process.cwd() } },
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
