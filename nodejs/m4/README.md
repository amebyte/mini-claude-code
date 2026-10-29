# m2 — T2 · 核心 Agent Loop

《Claude Code 源码最小还原实现》的第 3 个里程碑：把 T1 的「单轮对话」升级成「工具调用循环」——
模型调 API → 若返回 `tool_use` 就执行工具 → 把 `tool_result` 回喂 → 再调 API → 直到返回纯文本。

对应计划文档 v5.0 的 **T2 · 核心 Agent Loop（旧 M2，★ 最关键）**，结构忠实还原真实源码
`D:\workspace\202608\claude-code\claude-code` 的 `src/query.ts` / `src/Tool.ts`。

> 格言：*One loop & Bash is all you need*。Harness 层：**循环**。
> 核心不变式：**循环属于 agent，机制属于 harness**——工具执行换成什么，循环一行都不用改。

## 本里程碑做了什么

在 m1（T1 单轮对话）基础上新增 / 升级：

- **`src/query.ts`**（新增）：`async function* query()`——复刻真实 `query()` + `queryLoop()`
  的 async generator 模式。`while (true)` 循环里维护 `messages: MessageParam[]`，用
  「流式期间是否出现 tool_use 块」（真实代码的 `needsFollowUp`）作为循环退出信号，带
  `maxTurns` 防死循环保护。
- **`src/Tool.ts`**（新增）：最小化的 Tool 类型契约（`name` / `description` /
  `inputSchema` / `call`）+ `findToolByName`。
- **`src/tools/FakeTool.ts`**（新增）：一个**假 `bash` 工具**，无论传什么 command 都返回
  固定字符串——用于先验证「循环能转起来」，真实子进程 Bash 在 T3 实现。
- **`src/services/api/claude.ts`**（升级）：`streamMessage` → `streamAssistantTurn`，在流式
  打印文本之外，还累积 `text` / `tool_use` 块（`input_json_delta` 拼 JSON）、读 `stop_reason`。
- **`src/main.ts`**（升级）：`.action()` 从「单轮」改成驱动 `query()` 循环，渲染
  `[工具调用]` / `[工具结果]` 事件。

**明确不做**：真实 Bash（T3）、文件工具集（T4）、权限审批（T6）、交互式 REPL（T5）、
token 预算管理（本步用固定 `max_tokens: 4096` 占位）、思考块处理（DeepSeek 的
thinking 块本步直接忽略）。

## 目录结构（映射真实源码）

| 本仓库文件 | 真实源码对应 | 说明 |
| --- | --- | --- |
| `src/query.ts` | `src/query.ts`（`query()` L219 + `queryLoop()`） | Agent Loop：async generator + `while(true)` |
| `src/Tool.ts` | `src/Tool.ts` | Tool 类型契约（T2 最小化）+ `findToolByName` |
| `src/tools/FakeTool.ts` | `src/tools/BashTool/`（占位） | 假 bash 工具，T3 替换为真实 BashTool |
| `src/services/api/claude.ts` | `src/services/api/claude.ts` | 流式调用 + tool_use 块累积 |
| `src/services/api/client.ts` | `src/services/api/client.ts` | `getAnthropicClient()`（DeepSeek 兼容端点） |
| `src/entrypoints/cli.tsx` | `src/entrypoints/cli.tsx` | 引导入口 + `--version` fast-path |
| `src/main.ts` | `src/main.tsx` | commander，`.action()` 驱动 query 循环 |
| `src/globals.d.ts` | `declare const MACRO` | 构建注入全局的类型声明 |

## 环境要求

- Node.js ≥ 18（本机验证用 v22.23.2）
- 一个 `DEEPSEEK_API_KEY`（DeepSeek 的 Anthropic 兼容端点，见 <https://platform.deepseek.com/>）
- 该端点需要支持 **tool use**（本里程碑的核心能力；DeepSeek 的 Anthropic 兼容端点已实测通过）

## 启动步骤

### 1. 安装依赖

在 `nodejs/m2` 目录下执行：

```bash
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
```

然后编辑 `.env`，填入：

```
DEEPSEEK_API_KEY=sk-你的key
MODEL_ID=deepseek-v4-pro   # 可选，默认就是这个
```

### 3. 运行

```bash
# 触发工具调用循环（模型会调 bash 假工具 → 收结果 → 继续回复）
npm run dev -- "请用 bash 工具执行 date 命令，然后告诉我结果"

# 输出版本号（fast-path，零动态加载）
npm run dev -- --version

# 帮助信息（commander 生成）
npm run dev -- --help
```

> 注意：npm 不会把带 `-` 的参数透传给脚本，所以 `--version` / `--help` 前面必须加 `--`。
> 带 prompt 的位置参数则直接 `npm run dev -- "prompt"` 或
> `npx tsx src/entrypoints/cli.tsx "prompt"`。

### 4. 类型检查

```bash
npm run typecheck
```

## 对照真实源码怎么学

打开真实源码 `src/query.ts`、`src/Tool.ts`，逐条对照：

1. **`query()` 的 async generator 模式（真实 L219）**：真实 `query()` 是
   `async function*`，yield `StreamEvent | Message` 给上层消费者（print.ts / REPL）渲染，
   最后 `return` 一个 `Terminal`。本仓库 `query()` 同样用 async generator，但只 yield
   工具事件（文本已由 claude.ts 直接流式打印），是同一「把事件抛给上层」的思路的最小版。

2. **`while (true)` + `needsFollowUp`（真实 queryLoop）**：真实循环不用
   `stop_reason === 'tool_use'` 判断（源码注释明确它「不可靠」），而是在流式期间一旦出现
   `tool_use` 块就置 `needsFollowUp = true`，流式结束后用它决定「继续执行工具」还是
   `return { reason: 'completed' }`。本仓库 `query()` 的 `toolUseBlocks.length === 0` 就是这个信号。

3. **message 组装顺序（真实 L1715-1716）**：每轮结束前
   `state.messages = [...messagesForQuery, ...assistantMessages, ...toolResults]`——
   即 assistant 的 tool_use 之后必须紧跟含 `tool_use_id` 的 tool_result，且所有 tool_result
   合并成**一条 user 消息**。本仓库 `messages.push({ role: 'assistant' })` +
   `messages.push({ role: 'user', content: toolResults })` 复刻的正是这个顺序（角色严格交替）。

4. **Tool 类型契约（真实 `src/Tool.ts` L362 起）**：真实的 `Tool` 很重（`call` 返回
   `ToolResult<T>`、`description()` 异步、`inputSchema` 用 Zod、还有 isConcurrencySafe /
   isReadOnly / maxResultSizeChars / validateInput / checkPermissions…）。T2 先压到
   `name + description + inputSchema + call` 四要素，后续里程碑逐步把字段加回来——先理解
   契约的「形状」，再写自己的最小版。

5. **流式累积（真实 claude.ts 的 raw streaming）**：`content_block_start`（开块）→
   `content_block_delta`（`text_delta` 逐 token 打印、`input_json_delta` 拼 tool 入参）→
   `content_block_stop`（收块，`JSON.parse` 入参）→ `message_delta`（读 `stop_reason`）。
   本仓库 `streamAssistantTurn` 复刻的正是这组原始事件处理。

## 验证清单（完成标准）

- [x] 给一个假工具，模型能「调工具 → 收到结果 → 继续回复 → 结束」。
- [x] 循环次数正确（一次 tool_use → 一次最终文本，共 2 次 API 调用）。
- [x] 不会死循环（`maxTurns` 默认 10 兜底）。
- [x] `--version` 打印 `0.3.0 (Claude Code)`（fast-path 零动态加载）。
- [x] 缺 key 时清晰报错、退出码 1。

实测输出（DeepSeek 端点真实流式）：

```
[工具调用] bash {"command":"date"}
[工具结果] [T2 假工具 · bash] 固定返回，未真正执行子进程（真实 Bash 在 T3 实现）。
收到的 command：date

我执行了 `date` 命令，结果如下：…（模型基于固定返回作答，循环正常结束）
```

## 下一步

**T3 · 第一个真实工具：Bash（旧 M3）**：把 `src/tools/FakeTool.ts` 换成真实的
`src/tools/BashTool/`（`child_process` 执行 + 超时 + 输出截断），循环一行不改——模型就能
真的 `ls`、`git branch`、创建文件了。届时再对照真实 `src/tools/BashTool/` 的沙箱与
输出处理逐条复刻。
