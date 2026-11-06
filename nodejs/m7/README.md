# m5 — T5 · 交互式 REPL

《Claude Code 源码最小还原实现》的第 6 个里程碑：把「一次性 `cli.ts "prompt"`」升级成
「交互式多轮」——进入 REPL 后连续对话、历史自动保留，支持 `/help` / `/clear` / `/exit`
斜杠命令。**工具循环（`query.ts`）只改了一处**：`query()` 现在返回最终 messages，供 REPL 跨轮维护历史。

对应计划文档 v5.0 的 **T5 · 交互式 REPL（旧 M5，可选，保真度后置）**。按计划「不要急着碰 ink」，
本步用 Node `readline` + 纯文本逐行打印做最简版，**ink 渲染留到 T21**。

> 格言：*先能用，再好看*。这是「保真度后置」的典型——渲染先简单化，机制先跑通。

## 本里程碑做了什么

在 m4（T4 文件工具集）基础上新增：

- **`src/repl.ts`**（新增）：`startRepl()`——`readline` 输入循环 + 3 个斜杠命令（`/help`/`/clear`/`/exit`）
  + 跨轮会话历史；`renderQueryEvent()`——渲染工具事件（一次性模式与 REPL 共用）。
- **`src/systemPrompt.ts`**（新增）：把 system prompt 从 main.ts 抽出，两个模式共用。
- **`src/query.ts`**（改动）：`query()` 的返回类型从 `void` 改成 `MessageParam[]`（返回该轮结束后的完整
  会话历史）；新增 `runQuery()` 消费器（手动 `.next()` 循环，拿到 `for await` 拿不到的 return 值）。
- **`src/main.ts`**（改动）：`.action()` 从「无 prompt 就报未实现」改成「无 prompt → `startRepl()`；
  有 prompt → 一次性模式」。

**明确不做**：ink 全屏渲染、消息选择器、进度条、`/` 斜杠命令补全、多 provider——全部留到后续
（ink 明确 T21）。输入历史的 ↑/↓ 由 readline 在 TTY 下自动维护，未单独实现。

## 目录结构（映射真实源码）

| 本仓库文件 | 真实源码对应 | 说明 |
| --- | --- | --- |
| `src/repl.ts` | `src/replLauncher.tsx` + `src/components/App.tsx` + `src/ink/` | readline 最简 REPL（ink 留 T21） |
| `src/systemPrompt.ts` | `src/main.tsx` 里的 system prompt 组装 | 静态最小提示 |
| `src/query.ts` | `src/query.ts` | `query()` 返回 messages + `runQuery()` |
| `src/main.ts` | `src/main.tsx` | commander 分发（REPL / 一次性） |
| `src/tools.ts` / `src/tools/*` | `src/tools.ts` / `src/tools/*` | 6 个工具（T3/T4，本步未改） |

## 环境要求

- Node.js ≥ 18（本机验证用 v22.23.2）
- 一个 `DEEPSEEK_API_KEY`（DeepSeek 的 Anthropic 兼容端点，见 <https://platform.deepseek.com/>）

## 启动步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY=sk-你的key
```

### 3. 运行

```bash
# 交互式 REPL（不带 prompt）
npm run dev
# 或
npx tsx src/entrypoints/cli.tsx

# 一次性模式（带 prompt，行为同 m4）
npm run dev -- "运行 ls 看看有哪些文件"
```

进入 REPL 后：

```
❯ 你好，用一句话介绍你自己
（模型流式回复）

❯ /help        # 查看命令
❯ /clear       # 清空会话历史
❯ /exit        # 退出（同 /quit）
```

### 4. 类型检查

```bash
npm run typecheck
```

## 对照真实源码怎么学

打开真实源码 `src/replLauncher.tsx`、`src/components/App.tsx`、`src/ink/`，逐条对照：

1. **真实 REPL 是 ink 全屏 UI**：`replLauncher.tsx` 只是 `await import('./components/App.js')` 后把
   `<REPL>` 挂到 ink root 上——消息列表、输入框、进度条、消息选择器都是 React 组件。T5 **故意不碰**：
   计划明确 ink 留到 T21。本步用 `readline` 做最简版，正好对照「保真度后置」——先跑通多轮 + 斜杠命令，
   再在 T21 换 ink 全屏渲染，循环逻辑不变。

2. **会话历史谁维护**：真实 REPL 持有完整 `messages` 数组，每轮追加 user 消息后交给 `query()`。
   本步对应改动是让 `query()` **返回**该轮结束后的 messages（真实 `query()` 返回 `Terminal`，messages
   由上层 REPL/print 层自己累积）——`runQuery()` 消费生成器拿到 return 值，REPL 跨轮保存。

3. **斜杠命令分发**：真实有 `src/commands/`（0.2.31 引入自定义 slash 命令）和队列处理器。本步只在
   REPL 循环里 `line.startsWith('/')` 后 `switch` 三个内置命令，是最小分发；真实的自定义命令机制留到 T12 之后。

4. **`for await` vs `rl.question()`（本步踩到的坑）**：`rl.question()` 的 questionCallback 是**单槽**
   （一次只挂一个回调），非 TTY 管道输入时 readline 会「读超前」——一次性读完所有行、连续触发 line 事件，
   而 `question()` 还没挂上下一个回调，中间的行就丢了。readline 的 **async iterator**（`for await`）会
   把提前到达的行**缓冲**进队列，不会丢。所以用 `for await (const line of rl)` 而不是 `rl.question()`。
   真实 ink UI 不经过 readline 这条路径，但这是个通用的 Node 交互坑。

## 验证清单（完成标准）

- [x] 进入 REPL 后能连续多轮对话（无 prompt 裸启动进入 REPL）。
- [x] 支持 `/help`、`/exit`（`/quit`）、`/clear` 三个斜杠命令。
- [x] **多轮历史保留**：第一轮「记住：最喜欢的颜色是蓝色」→ 第二轮「最喜欢的颜色？」正确答「蓝色」。
- [x] 一次性模式（带 prompt）行为不变，工具调用正常（回归验证）。
- [x] `--version` → `0.6.0 (Claude Code)`；typecheck 通过。


关键机制：query() 之前复制 messages 内部循环、用完即弃，无法跨轮保留历史。现在 query() 返回最终 messages，runQuery() 用手动 .next() 循环拿到 for await 拿不到的 return 值，REPL 跨轮保存——这就是「多轮」的地基。

踩到并修掉的第三个真坑（readline 读超前）

最初用 rl.question()，但它的 questionCallback 是单槽：非 TTY 管道输入时 readline 会「读超前」——一次性读完所有行、连续触发 line 事件，而 question() 还没挂上下一个回调，中间的行就丢了（测试时「你好」被吞掉）。改成 for await (const line of rl)（readline 的 async iterator 会缓冲提前到达的行）后修好。真实 ink UI 不走 readline 这条路径，但这是通用的 Node 交互坑，已写进 README。

验证结果（真实运行，非 mock）

- typecheck 通过、--version → 0.6.0 (Claude Code)
- 多轮历史保留（核心验收）：第一轮「记住：最喜欢的颜色是蓝色」→ 第二轮「最喜欢的颜色？」正确答「蓝色」✓
- 斜杠命令 /help//clear//exit 全部正常 ✓
- 一次性模式回归：带 prompt + 工具调用（ls）正常 ✓
- 管道输入（非 TTY）和真实 TTY 都能跑通

m5/.env 已含你的 DeepSeek key（gitignored），可直接 npm run dev 进入交互式 REPL 体验。

## 下一步

**T6 · 权限系统（day 0）**：三道闸门（硬拒绝 → 规则匹配 → 用户审批），`Write to /etc` 这类越界操作
要被拦下。届时会引入 `getCwd`/工作目录管理（顺带解决 T4 遗留的「Bash 返回 MSYS 路径」问题），
对应真实源码 `src/types/permissions.ts`、`src/hooks/useCanUseTool.ts`。
