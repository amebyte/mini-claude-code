/**
 * 完整 CLI 入口（对应真实源码 `src/main.tsx`，真实文件含 ink 渲染与 JSX，
 * 无 JSX 先简化为 `main.ts`）。
 *
 * 真实实现用 commander 组织完整的参数解析、交互式 REPL（ink 渲染）与会话
 * 管理。 先落地 commander 骨架：--version / --help / [prompt] 三个表面。
 *
 * 真实源码用 `@commander-js/extra-typings` 获得更强的类型推断，本里程碑先
 * 用官方 `commander`（两者 API 同构，README 里有对照说明）。
 */

import { Command } from 'commander';

export async function main(): Promise<void> {
  const program = new Command();

  program
    .name('claude')
    .description('Claude Code 源码最小还原实现（T0.1 项目骨架）')
    .argument('[prompt]', '给 agent 的提示词（T0.2 单轮对话才实现，本里程碑忽略）', String)
    // 真实源码：.version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')
    .version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')
    .helpOption('-h, --help', 'Display help for command')
    .action(async (prompt: string | undefined) => {
      // T0.1：prompt 与交互式 REPL 都还没实现，统一提示后返回非零退出码。
      if (prompt !== undefined) {
        console.error(`[未实现] 收到 prompt：${prompt}（T0.2 单轮对话才实现）`);
      } else {
        console.error('[未实现] 交互式 REPL 尚未实现（T2.2）');
      }
      process.exitCode = 1;
    });

  await program.parseAsync(process.argv);
}
