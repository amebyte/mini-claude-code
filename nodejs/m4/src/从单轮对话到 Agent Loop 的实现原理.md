# 来，给 Mini Claude Code 装上一双「手」：从底层理解 Agent Loop 的本质原理

### 1. 前言

在前面的小节里，我们把 Mini Claude Code 从零搭了起来，做到了**单轮对话**，并实现了流式输出。这小节我们来实现 **Agent Loop** 部分。我们在前面的小节也学习了 Agent Loop 相关知识，现在我们来回顾一下。

### 2. 为什么需要 Agent Loop？

因为大模型本质上就是一个**输入 token、输出 token** 的概率机器，它本身连一条 shell 命令都跑不了。那 Claude Code 里的 `ls`、`读文件`、`跑测试` 是怎么完成的？

关键机制叫 **Function Calling**（工具调用）。流程是这样的：

1. 我们在调 API 时，把「有哪些工具可用」提前告诉模型（每个工具一个**说明书**：名字、作用、需要哪些参数）。
2. 模型判断「这个任务我需要执行命令」，于是它**不直接输出最终答案**，而是输出一个 `tool_use` 块：「我要调用 `bash` 工具，参数是 `command: "ls"`」。
3. **客户端**拿到这个请求，替它真正执行 `ls`，把结果包装成 `tool_result` 回喂给模型。
4. 模型看到 `ls` 的结果，再继续组织语言回答你，或者发起下一次工具调用。

那「循环」体现在哪？体现在第 3 步结束后**又回到第 1 步**——模型不是只能调一次工具，它可以调完 `ls` 发现是空目录，再调一次 `mkdir`，再调一次 `touch`……直到它觉得「够了」，才输出纯文本收尾。

所以 Agent Loop 的本质，用一句话说：

> **模型负责「决策」（要调哪个工具、传什么参数），客户端负责「执行」（真正跑命令、读文件），然后无限循环，直到模型输出纯文本为止。**

在前面的小节里，我们只实现了「模型输出纯文本」这一半；这一小节，就是把「工具 + 循环」这另一半补齐。下面开始动手。

### 3. 核心概念：一张图 + 一段伪代码

在写代码之前，先用最精简的伪代码，把整个循环的骨架立起来：

```
while 模型请求调用工具:
    1. 调 API，流式拿回复
    2. 把模型的 assistant 消息存起来
    3. 有没有 tool_use 块？
       没有  ->  结束循环（模型给出了最终文本）
       有    ->  逐个执行工具，拿到 tool_result
    4. 把 tool_result 回喂给模型（role: user）
    5. 回到第 1 步
```

对应的数据流是这样的：

```
                ┌─────────────────────────────┐
                │           模型 (API)          │
                └──────────────┬──────────────┘
                               │  ① 输出 tool_use 块
                               │    "调 bash, command=ls"
                               ▼
                        ┌──────────────┐
   ┌─────────────┐      │  query 循环   │       ┌──────────────┐
   │  messages    │─────▶│  (harness)    │──────▶│  Tool (bash) │
   │  累积对话     │      └──────┬───────┘       │   真正执行     │
   └─────────────┘             │                └──────┬───────┘
        ▲                      │ ③ 拿到结果            │ ② 执行
        │                      │    tool_result        │
        │                      ▼                       │
        │               ┌──────────────┐               │
        └───────────────│  回喂给模型   │◀──────────────┘
                        │  (role:user) │
                        └──────────────┘
```

图里最关键的是那个**回环的箭头**：`tool_result` 不是终点，它被塞回 `messages`，于是下一轮模型能看到「我刚才调了 `ls`，结果是这些文件」，再决定下一步。

好，概念说清了，上代码。

### 4. 代码实现

我们按「构建顺序」一步步来：先定义「工具长什么样」，再造一个「假工具」，然后升级 API 层，最后把循环的骨架拼起来。

#### 4.1 工具契约：一个工具 = 名字 + 说明书 + 执行方法

要让模型「会用工具」，我们先得定义**工具是什么**。新建 [Tool.ts](Tool.ts)：

```ts
export type ToolInputJSONSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

export type Tool = {
  /** 工具名（模型在 tool_use block 里引用的名字） */
  readonly name: string;
  /** 一句话描述，写进 tools 数组里交给 API，让模型知道何时调用 */
  readonly description: string;
  /** JSON Schema（真实用 Zod 定义再转 JSON Schema，T2 直接手写） */
  readonly inputSchema: ToolInputJSONSchema;
  /** 执行工具，返回回传给模型的 tool_result 文本内容 */
  call(args: Record<string, unknown>): Promise<string>;
};

/** 按名字查找工具 */
export function findToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}
```

大白话解释一下：一个工具，本质就是三样东西——**叫什么名字**（`name`）、**怎么用**（`description` + `inputSchema`，相当于一张说明书，会原样传给 API 让模型看懂）、以及**怎么执行**（`call`）。这个契约在真实 Claude Code 里要重得多，有 `checkPermissions`（权限校验）、`isReadOnly`、`maxResultSizeChars`（输出截断）等一大堆字段，但本小节的目标是「先把循环转起来」，所以压到最小够用即可——后面里程碑再逐步加回来。

#### 4.2 先放一个「假工具」：循环先跑起来再说

有了契约，我们得有个具体工具让模型调用。但真实执行 shell 命令需要子进程、超时、沙箱这些（那是 后面 的活），本小节里程碑只验证「循环能转起来」，所以先造一个**假 bash**。新建 [tools/FakeTool.ts](tools/FakeTool.ts)：

```ts
import type { Tool } from '../Tool.js';

// T2 假工具：无论模型传什么 command，都返回一条固定字符串。
// 真实的子进程 Bash 在 T3（src/tools/BashTool/）实现，届时替换本文件即可，
// 循环一行都不用改——这正是「循环属于 agent，机制属于 harness」的体现。
export const fakeBashTool: Tool = {
  name: 'bash',
  description:
    'Run a shell command and return its output. ' +
    '(T2 假实现：固定返回字符串，不真正执行子进程——真实 Bash 在 T3 里程碑实现)',
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
      '[T2 假工具 · bash] 固定返回，未真正执行子进程（真实 Bash 在 T3 实现）。',
      `收到的 command：${command}`,
    ].join('\n');
  },
};
```

这里有个设计点值得留意：假工具和以后的真工具**长得一模一样**（都是 `Tool` 契约），所以将来把 `fakeBashTool` 换成真 Bash 工具，循环一行都不用改。这体现了一个重要的分层思想——**「循环属于 agent，机制属于 harness」**：循环不知道也不关心 `bash` 是不是真的，它只负责「模型要调工具 → 找到工具 → 调 `call()` → 回喂结果」。

#### 4.3 升级 API 层：从「打印文本」到「拿回完整 turn」

上一小节里的 `streamMessage` 只会把文本流式打印出来，但 Agent Loop 需要知道「模型这一轮有没有调工具、调了哪个、传了什么参数」。所以 [services/api/claude.ts](services/api/claude.ts) 要从 `streamMessage` 升级成 `streamAssistantTurn`。改动核心如下：

```diff
-export async function streamMessage(prompt: string): Promise<void> {
+export async function streamAssistantTurn(
+  messages: MessageParam[],
+  tools: Tool[],
+  system?: string,
+): Promise<AssistantTurn> {
   const client = getAnthropicClient();
   const model = process.env.MODEL_ID ?? 'deepseek-v4-pro';
 
   const stream = await client.messages.create({
     model,
-    max_tokens: 1024,
-    messages: [{ role: 'user', content: prompt }],
+    max_tokens: 4096, // tool use + 思考可能超过单轮 1024，先固定上限占位
+    system,
+    messages,
+    // 把本仓库的 Tool 契约映射成 API 需要的 tools 数组
+    tools: tools.map(t => ({
+      name: t.name,
+      description: t.description,
+      input_schema: t.inputSchema,
+    })),
     stream: true,
   });
```

两个关键变化：

1. **`messages` 变成多轮**：从「只发一条 user 消息」变成「传入累积的完整对话」，这正是循环能继续下去的前提。
2. **`tools` 数组传进 API**：把我们的 `Tool` 契约映射成 API 认的 `{ name, description, input_schema }`，模型这才知道「有个叫 `bash` 的工具能用」。

但光把工具传进去还不够，我们还得**从流式事件里把 `tool_use` 块解析出来**。真正的流式事件里，工具的入参是分片到达的（`input_json_delta`），要先把 JSON 拼起来再 parse：

```ts
  const content: AssistantContent[] = [];
  let currentBlock: AssistantContent | null = null;
  // tool_use 块的入参是分片（input_json_delta）流式到达的，先拼 JSON 再 parse。
  let inputJsonBuffer = '';
  let stopReason: string | null = null;

  for await (const event of stream) {
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        if (block.type === 'text') {
          currentBlock = { type: 'text', text: '' };
          content.push(currentBlock);
        } else if (block.type === 'tool_use') {
          currentBlock = { type: 'tool_use', id: block.id, name: block.name, input: {} };
          inputJsonBuffer = '';
          content.push(currentBlock);
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          if (currentBlock?.type === 'text') {
            currentBlock.text += delta.text;
          }
          process.stdout.write(delta.text); // 文本仍然实时打印
        } else if (delta.type === 'input_json_delta') {
          inputJsonBuffer += delta.partial_json; // 拼接入参 JSON
        }
        break;
      }

      case 'content_block_stop': {
        // tool_use 块结束时，把累积的 input_json 解析成对象。
        if (currentBlock?.type === 'tool_use') {
          try {
            currentBlock.input = inputJsonBuffer.trim() ? JSON.parse(inputJsonBuffer) : {};
          } catch {
            currentBlock.input = {};
          }
        }
        currentBlock = null;
        break;
      }

      case 'message_delta': {
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
        break;
      }
    }
  }

  return { content, stopReason };
```

这里最精妙的是 `AssistantContent` 这个类型设计：它直接用 SDK 的 `TextBlockParam | ToolUseBlockParam` 作为内容块类型，所以累积出来的 `content` 数组可以**原样塞回 `messages`**（`role: 'assistant'`），不用再做一次结构转换——下一轮 API 调用直接吃进去就行。

#### 4.4 核心循环：`query()`，Agent Loop 的心脏

终于到最关键的部分了。新建 [query.ts](query.ts)，它就是整个 Agent Loop 的心脏：

```ts
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { findToolByName, type Tool } from './Tool.js';
import {
  streamAssistantTurn,
  type AssistantContent,
  type AssistantTurn,
} from './services/api/claude.js';

type ToolUseBlock = Extract<AssistantContent, { type: 'tool_use' }>;

// query() 产出的进度事件：文本已由 claude.ts 直接打印，这里只回传「工具」事件。
export type QueryEvent =
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; content: string };

export type QueryParams = {
  messages: MessageParam[];
  tools: Tool[];
  system?: string;
  maxTurns?: number; // 单轮最大迭代次数（防死循环）
};

export async function* query(
  params: QueryParams,
): AsyncGenerator<QueryEvent, void, void> {
  const tools = params.tools;
  const system = params.system;
  const maxTurns = params.maxTurns ?? 10;

  // 循环状态：messages 在每轮之间累积。
  const messages: MessageParam[] = [...params.messages];
  let turnCount = 0;

  while (true) {
    turnCount += 1;

    // 死循环保护：超过 maxTurns 强制结束。
    if (turnCount > maxTurns) {
      yield {
        type: 'tool_result',
        id: '',
        name: '',
        content: `[循环保护] 已达最大轮次 ${maxTurns}，强制结束。`,
      };
      return;
    }

    // 1) 调一次 API：文本流式打印，返回完整 assistant turn。
    const turn: AssistantTurn = await streamAssistantTurn(messages, tools, system);

    // 2) assistant 这轮的 content 追加进 messages。
    messages.push({ role: 'assistant', content: turn.content });

    // 3) 提取 tool_use 块。
    const toolUseBlocks: ToolUseBlock[] = turn.content.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use',
    );

    // 4) 纯文本（无工具调用）→ 循环结束。
    if (toolUseBlocks.length === 0) {
      return;
    }

    // 5) 执行每个工具，收集 tool_result。
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    for (const block of toolUseBlocks) {
      yield { type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> };

      const tool = findToolByName(tools, block.name);
      const content = tool
        ? await tool.call(block.input as Record<string, unknown>)
        : `[错误] 未找到工具 ${block.name}`;

      yield { type: 'tool_result', id: block.id, name: block.name, content };
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
    }

    // 6) tool_result 回喂给模型，继续下一轮。
    messages.push({ role: 'user', content: toolResults });
  }
}
```

逐行读一下这个循环，它就是我们前面那张图的原样落地：

- **第 1 步**调 API，`streamAssistantTurn` 一边流式打印文本，一边返回完整的 `turn`（里面可能有 `text` 块，也可能有 `tool_use` 块）。
- **第 2 步**把这一轮的 assistant 消息**原样塞回 `messages`**——因为 `content` 类型就是 SDK 的类型，直接回喂零成本。
- **第 3、4 步**判断「有没有 `tool_use` 块」：没有，说明模型已经给出最终文本，**循环退出**。注意这里**不依赖 `stop_reason`**，真实源码的注释明确写了它「不可靠」，以「是否出现 `tool_use`」为准。
- **第 5 步**逐个执行工具，把 `call()` 的返回值包装成 `tool_result`。
- **第 6 步**最关键：把 `tool_result` 以 `role: 'user'` 的身份**塞回 `messages`**，然后 `while` 循环回到第 1 步。

有没有发现一个细节？`tool_result` 是用 `role: 'user'` 回喂的。这是 Anthropic Messages 协议的规定——工具结果必须作为一条**新的 user 消息**接在 assistant 的 `tool_use` 之后，模型才能正确地把「我请求了 → 我拿到了结果」对上号。这个「人肉中转站」的语义，正是整个循环能闭环的关键。

#### 4.5 接线：让 `main.ts` 驱动循环

最后改 [main.ts](main.ts)，把原来那句 `await streamMessage(prompt)` 换成对 `query()` 的消费：

```diff
 import { Command } from 'commander';
-import { streamMessage } from './services/api/claude.js';
+import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
+import { query } from './query.js';
+import { fakeBashTool } from './tools/FakeTool.js';
+
+// 最小 system prompt：让模型知道「有个 bash 工具，需要执行命令就调它」。
+const SYSTEM_PROMPT = [
+  '你是 Claude Code 的最小还原实现（T2 · 核心 Agent Loop）。',
+  '你有一个 `bash` 工具（本里程碑是假实现，固定返回字符串）。',
+  '当任务需要执行命令或获取系统信息时，调用 `bash` 工具；拿到结果后继续作答，直到给出最终回答。',
+].join(' ');
 
 export async function main(): Promise<void> {
   const program = new Command();
 
   program
     .name('claude')
-    .description('Claude Code 源码最小还原实现（T0.2 单轮对话）')
+    .description('Claude Code 源码最小还原实现（T2 核心 Agent Loop）')
     .argument('[prompt]', '给 agent 的提示词', String)
     .version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')
     .helpOption('-h, --help', 'Display help for command')
     .action(async (prompt: string | undefined) => {
-      // 裸启动（无 prompt）：交互式 REPL 属于 T2.2，本里程碑仍未实现。
       if (prompt === undefined) {
-        console.error('[未实现] 交互式 REPL 尚未实现（T2.2）');
+        console.error('[未实现] 交互式 REPL 尚未实现（T5）');
         process.exitCode = 1;
         return;
       }
 
-      // 单轮对话：发一条消息，流式打印回复。
       try {
-        await streamMessage(prompt);
+        // 初始 messages 只有一条 user 消息；system prompt 单独作为 system 参数传入。
+        const messages: MessageParam[] = [{ role: 'user', content: prompt }];
+
+        // 驱动 Agent Loop：文本由 claude.ts 流式打印，这里只渲染工具事件。
+        for await (const event of query({
+          messages,
+          tools: [fakeBashTool],
+          system: SYSTEM_PROMPT,
+        })) {
+          switch (event.type) {
+            case 'tool_use':
+              console.log(`\n[工具调用] ${event.name} ${JSON.stringify(event.input)}`);
+              break;
+            case 'tool_result':
+              console.log(`[工具结果] ${event.content}\n`);
+              break;
+          }
+        }
+        console.log('');
       } catch (err) {
         const message = err instanceof Error ? err.message : String(err);
         console.error(`[错误] ${message}`);
         process.exitCode = 1;
       }
     });
 
   await program.parseAsync(process.argv);
 }
```

这里 `query()` 是一个**异步生成器**（`async function*`），`main.ts` 用 `for await ... of` 消费它吐出的工具事件：`tool_use` 打印「模型想调什么工具」，`tool_result` 打印「工具返回了什么」。而模型的文本，早在 `streamAssistantTurn` 里就被实时打印到 stdout 了，所以 `main.ts` 只需要关心工具这一层——职责分得很清爽。

### 5. 测试 / 演示

现在来跑一下，看循环是不是真的转起来了。我们故意下一条「会触发工具调用」的指令，比如让模型执行命令：

```bash
$ npx tsx src/entrypoints/cli.tsx "查看一下当前目录，然后告诉我里面有什么"
```

模型收到指令后，会先调 `bash` 工具（虽然是假的），拿到「固定返回」再组织回答。运行效果大致是：

```diff
[工具调用] bash {"command":"ls"}

[工具结果] [T2 假工具 · bash] 固定返回，未真正执行子进程（真实 Bash 在 T3 实现）。
收到的 command：ls

当前目录内容我已经通过 bash 工具查看了（虽然当前是假实现，返回的是固定
字符串，还没有真正执行 ls 命令）。等 T3 里程碑接入真实 Bash 后，这里就会
返回真实的目录列表了。
```

从结果可以看出两件事：

1. **模型真的发起了一次工具调用**——它没有直接瞎编目录内容，而是输出 `tool_use` 请求 `bash` 工具，传了 `command: "ls"`。
2. **循环闭环了**——工具结果被回喂后，模型基于结果继续作答，最后输出纯文本收尾，循环退出。

再下一条纯文本指令，验证「无工具调用时循环直接退出」：

```bash
$ npx tsx src/entrypoints/cli.tsx "说一句你好"
```

```
你好！我是 Claude Code 的最小还原实现，有什么可以帮你的吗？
```

这条没有触发任何工具，模型直接输出文本，`query()` 在第 4 步就 `return` 了——整个循环「空转」了一次就优雅退出。

### 6. 工作原理总结

把整个 Agent Loop 压缩成一张有序步骤：

1. 用户输入一条 `prompt`，作为 `role: 'user'` 塞进 `messages`；
2. `query()` 进入 `while` 循环，调 `streamAssistantTurn` 流式拿回复；
3. 这一轮的 assistant `content` 追加进 `messages`；
4. 判断有没有 `tool_use` 块：**没有** → 循环结束；**有** → 继续；
5. 逐个找到对应工具，调 `call()` 执行，收集 `tool_result`；
6. 把 `tool_result` 以 `role: 'user'` 回喂进 `messages`；
7. 回到第 2 步。

这就是 **Agent Loop 的最小闭环**，也是整个 Claude Code 的骨架。真实的 `queryLoop` 在它上面叠了 token 预算、权限校验、子 agent 调度、后台进程管理……但**内核就是这个 `while` 循环**。

### 7. 总结

所谓 **Agent Loop**，本质就是一句话：

> **模型出「决策」，harness 出「执行」，两者靠 `messages` 数组这个「对话记忆」来回接力，直到模型吐出纯文本为止。**

三个核心，记住它们就够了：

- **工具契约是「说明书」**：`name` + `description` + `inputSchema` 三件套，原样交给 API，模型才知道「何时调、怎么传参」；`call()` 是真正干活的入口。
- **循环退出看 `tool_use`，不看 `stop_reason`**：有没有 `tool_use` 块是唯一可靠的结束信号，`stop_reason` 在真实实现里被证明不可靠。
- **分层是灵魂**：「循环属于 agent，机制属于 harness」。假工具换成真工具，循环一行不改——这为后续 T3（真实 Bash）、T4（文件工具集）、T7（MCP 工具）留好了干净的扩展点。

在此基础上，你可以继续加：把假 Bash 换成真实子进程执行（T3）、接入文件读写工具（T4）、给工具加权限校验（T6）、以及把工具做成 MCP 协议（T7）……但无论怎么加，**核心永远是这一个循环**。

我是 Cobyte，欢迎添加 v: icobyte，学习交流 AI 全栈。
