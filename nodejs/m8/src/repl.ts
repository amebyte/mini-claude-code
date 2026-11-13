import * as readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { runQuery, type QueryEvent } from './query.js';
import { TOOLS } from './tools.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import type { ApprovalHandler, PermissionMode } from './types/permissions.js';

/**
 * 交互式 REPL（对应真实源码 `src/replLauncher.tsx` + `src/components/App.tsx` + `src/ink/`）。
 *
 * 真实 REPL 用 ink（React 终端渲染库）做全屏 UI、消息选择器、进度条等——那些**留到 T21 再还原**
 * （计划明确「不要急着碰 ink」）。T5 起用 Node `readline` + 纯文本做最简版；T6 加权限审批交互。
 */

const PROMPT_SYMBOL = '❯ ';

const HELP_TEXT = [
  '可用命令：',
  '  /help    显示帮助',
  '  /clear   清空当前会话历史',
  '  /exit    退出（同 /quit）',
  '',
  '直接输入文字即可与 agent 对话；历史自动保留，可连续多轮追问。',
  '破坏性操作（删除、写系统目录、写工作区外）会弹出 y/N 权限询问。',
].join('\n');

/**
 * 渲染 query() 产出的事件。文本 delta 已由 claude.ts 流式打印，
 * 这里只打印「工具」相关进度（一次性模式与 REPL 共用）。
 */
export function renderQueryEvent(event: QueryEvent): void {
  switch (event.type) {
    case 'tool_use':
      console.log(`\n[工具调用] ${event.name} ${JSON.stringify(event.input)}`);
      break;
    case 'tool_result':
      console.log(`[工具结果] ${event.content}\n`);
      break;
  }
}

/**
 * 进入交互式 REPL：循环读输入 → 处理斜杠命令 → 跑 query 循环 → 保留历史。
 *
 * 用 `for await (const line of rl)` 而不是 `rl.question()`：readline 的 async iterator
 * 会**缓冲**提前到达的行（`rl.question()` 的 questionCallback 是单槽，非 TTY 管道输入会
 * 因为 readline 读超前而丢行）。TTY 下 ↑/↓ 输入历史由 readline 自动维护。
 *
 * T6：权限审批（Gate 3）在工具执行前触发，用 `rl.question()` 弹 y/N。TTY 下它与
 * `for await` 顺序共存（question 的 questionCallback 优先于 async iterator 的 line 监听）。
 */
export async function startRepl(mode: PermissionMode = 'default'): Promise<void> {
  const rl = readline.createInterface({ input, output });
  rl.setPrompt(PROMPT_SYMBOL);

  let messages: MessageParam[] = [];

  // T6：权限上下文 + 审批回调。
  const permission = { mode, cwd: process.cwd() };
  const askUser = (query: string): Promise<string> =>
    new Promise(resolve => rl.question(query, resolve));
  const onApproval: ApprovalHandler = async (toolName, input, message) => {
    console.log(`\n[权限询问] ${message}`);
    console.log(`  工具：${toolName} ${JSON.stringify(input)}`);
    const answer = (await askUser('  允许？[y/N] ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  };

  console.log(`Claude Code 源码最小还原实现 ${MACRO.VERSION}（T6 权限系统）`);
  console.log('输入 /help 查看命令，/exit 退出。\n');
  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();

    if (trimmed === '') {
      rl.prompt();
      continue;
    }

    // 斜杠命令
    if (trimmed.startsWith('/')) {
      const command = trimmed.split(/\s+/)[0];
      switch (command) {
        case '/exit':
        case '/quit':
          console.log('再见！');
          rl.close();
          return;
        case '/help':
          console.log(HELP_TEXT);
          break;
        case '/clear':
          messages = [];
          console.log('已清空会话历史。');
          break;
        default:
          console.log(`未知命令 ${command}，输入 /help 查看帮助。`);
      }
      rl.prompt();
      continue;
    }

    // 普通消息：追加 user 消息 → 跑一次 query 循环（工具调用循环在 query 内部完成）。
    const nextMessages: MessageParam[] = [...messages, { role: 'user', content: trimmed }];
    try {
      messages = await runQuery(
        { messages: nextMessages, tools: TOOLS, system: SYSTEM_PROMPT, permission, onApproval },
        renderQueryEvent,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[错误] ${message}`);
      // 出错则保留上一轮历史，不追加这次失败的 user 消息。
    }
    console.log(''); // 空行分隔两轮
    rl.prompt();
  }

  console.log('再见！');
}
