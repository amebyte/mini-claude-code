import type { Tool } from '../Tool.js';

/**
 * 本小节假工具（对应真实源码 `src/tools/BashTool/` 的占位）。
 *
 * 本小节的目标是「验证 Agent Loop 能运行起来」，不实现真实工具执行，
 * 所以这里放一个「假 bash」：无论模型传什么 command，都返回一条固定字符串。
 * 真实的子进程 Bash 在下一小节里程碑（`src/tools/BashTool/`）实现，届时替换本文件即可，
 * 循环一行都不用改——这正是「循环属于 agent，机制属于 harness」的体现。
 *
 * - 真实 Claude Code 的 BashTool 有沙箱、超时、输出截断、后台化等机制。
 */
export const fakeBashTool: Tool = {
  name: 'bash',
  description:
    'Run a shell command and return its output. ' +
    '(本小节假实现：固定返回字符串，不真正执行子进程——真实 Bash 在下一小节里程碑实现)',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
    },
    required: ['command'],
  },
  async call(args) {
    const command = typeof args.command === 'string' ? args.command : '(no command)';
    return [
      '[本小节假工具 · bash] 固定返回，未真正执行子进程（真实 Bash 在下一小节里程碑实现）。',
      `收到的 command：${command}`,
    ].join('\n');
  },
};
