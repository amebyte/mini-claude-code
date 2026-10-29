# m3 — T3 · 第一个真实工具：Bash

《Claude Code 源码最小还原实现》的第 4 个里程碑：把 T2 的「假 bash 工具」换成**真实 Bash 工具**——
真的跑本地命令（`bash -c` 经 `child_process`），把 stdout/stderr 作为 `tool_result` 回传，
带超时与输出截断。**Agent Loop（`query.ts`）一行没改**。

对应计划文档 v5.0 的 **T3 · 第一个真实工具：Bash（旧 M3）**，结构忠实还原真实源码
`D:\workspace\202608\claude-code\claude-code` 的 `src/tools/BashTool/`。

> 格言（延续 T2）：*One loop & Bash is all you need*。
> 核心不变式：**循环属于 agent，机制属于 harness**——把假工具换成真工具，循环不用动。

## 本里程碑做了什么

在 m2（T2 Agent Loop）基础上，把 `src/tools/FakeTool.ts` 换成 `src/tools/BashTool/`：

- **`src/tools/BashTool/toolName.ts`**（新增）：`BASH_TOOL_NAME = 'Bash'`——真实工具名是
  **大写 `Bash`**（不是 T2 假工具的 `bash`）。独立成文件是为了打破循环依赖（真实同款）。
- **`src/tools/BashTool/BashTool.ts`**（新增）：真实 Bash 工具，三件核心事：
  1. 跑本地命令（`child_process.execFile(shell, ['-c', command])` + 超时）；
  2. 把 stdout/stderr 拼成 tool_result，非零退出码追加 `Exit code N`；
  3. 输出截断（超 30K 字符追加 `... [N lines truncated] ...`）。
- **`src/tools/BashTool/utils.ts`**（新增）：`stripEmptyLines`（去首尾空行）+ `formatOutput`
  （截断），复刻真实 `BashTool/utils.ts`。
- **`src/main.ts`**：`fakeBashTool` → `bashTool`，system prompt 同步更新。
- **`src/Tool.ts` / `src/query.ts`**：**未改动**——Bash 工具只是实现了同一个 `call()` 契约。

**明确不做**：文件工具集（T4）、权限审批（T6，本步所有命令直通）、沙箱
（`dangerouslyDisableSandbox`，T6 之后）、后台化（`run_in_background`，T13）、
`description` 入参、超大输出落盘（`toolResultStorage`，本步用 `maxBuffer` 10MB 占位）。

## 目录结构（映射真实源码）

| 本仓库文件 | 真实源码对应 | 说明 |
| --- | --- | --- |
| `src/tools/BashTool/toolName.ts` | `src/tools/BashTool/toolName.ts` | `BASH_TOOL_NAME = 'Bash'` |
| `src/tools/BashTool/BashTool.ts` | `src/tools/BashTool/BashTool.tsx` | 真实 Bash 工具（无 JSX → `.ts`） |
| `src/tools/BashTool/utils.ts` | `src/tools/BashTool/utils.ts` | `stripEmptyLines` + `formatOutput`（截断） |
| `src/query.ts` | `src/query.ts` | Agent Loop（**本步未改**） |
| `src/Tool.ts` | `src/Tool.ts` | Tool 契约（**本步未改**） |
| `src/services/api/claude.ts` | `src/services/api/claude.ts` | 流式 + tool_use 累积（**未改**） |
| `src/main.ts` | `src/main.tsx` | commander，换 `bashTool` |

## 环境要求

- Node.js ≥ 18（本机验证用 v22.23.2）
- 一个 `DEEPSEEK_API_KEY`（DeepSeek 的 Anthropic 兼容端点，见 <https://platform.deepseek.com/>）
- **bash**：命令经 `bash -c` 执行，需要系统里有 bash。本机（Windows + git-bash）自带；
  纯 Windows 无 bash 时可用 `CLAUDE_CODE_SHELL` 指向你的 bash 路径。

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
# 真的执行 ls 并读进回复
npm run dev -- "运行 ls 并告诉我结果"

# 创建文件（真实写盘）
npm run dev -- "用 Bash 创建一个 hello.py，内容为 print('hello')，然后确认成功"

# 输出版本号
npm run dev -- --version
```

> 注意：npm 不透明传带 `-` 的参数，`--version` / `--help` 前必须加 `--`。

### 4. 类型检查

```bash
npm run typecheck
```

## 对照真实源码怎么学

打开真实源码 `src/tools/BashTool/BashTool.tsx`（1143 行）与 `src/utils/Shell.ts`，逐条对照：

1. **工具名 `Bash`（`toolName.ts`）**：真实 `BASH_TOOL_NAME = 'Bash'`（大写）。模型在 tool_use
   block 里引用的就是这个名字。T2 假工具叫 `bash`，T3 换成真实名字——这是最容易忽略的一处还原。

2. **跑命令的方式（`Shell.ts` 的 `findSuitableShell` + `formatShellPrefixCommand`）**：
   真实永远用 **bash/zsh** 跑命令，**不是** Windows 的 cmd.exe。本仓库用
   `execFile(shell, ['-c', command])` 显式走 bash 语义——因为 `exec(command)` 在 Windows 上
   默认走 cmd.exe（`/c` 语义），`echo "print('hi')" > f` 会**连引号一起写进文件**（实测踩过这个坑）。
   真实还有 `CLAUDE_CODE_SHELL` 环境变量覆盖，本仓库 `resolveShell()` 复刻了「override → $SHELL → 平台兜底」。

3. **超时（`utils/timeouts.ts`）**：默认 `120_000`ms（2 分钟）、最大 `600_000`ms（10 分钟）。
   `execFile` 的 `timeout` 到期后用 SIGTERM 杀进程，回调 error 带 `killed=true` / `signal='SIGTERM'`
   ——本仓库据此判断「超时」并回 `[命令超时] Nms 后被终止`。

4. **退出码**：非零退出码时真实在输出末尾追加 `Exit code N`（配合 `interpretCommandResult` 判断
   「确实出错」才追加）。本仓库 `code !== 0` 时追加，实测 `命令不存在` → `Exit code 127`。

5. **输出截断（`utils.ts` 的 `formatOutput` + `outputLimits.ts`）**：上限 `30_000` 字符
   （`BASH_MAX_OUTPUT_DEFAULT`，真实还支持 `BASH_MAX_OUTPUT_LENGTH` 环境变量覆盖，上限 150_000）。
   超过时保留前 N 字符 + `\n\n... [N lines truncated] ...`。另有 `stripEmptyLines` 去首尾空行。
   本仓库逐行复刻这两个函数。

## 验证清单（完成标准）

- [x] `运行 ls 并告诉我结果` → 真的执行 `ls`，模型把结果读进回复。
- [x] 创建 `hello.py` → 真的写盘（内容 `print('hello')`，15 字节，无引号），模型 `ls -l` 确认。
- [x] `git branch` → 非 git 仓库时返回 `fatal: ...` + `Exit code 128`，模型据此诊断并多轮排查。
- [x] 超时：`sleep 5` + `timeout=500` → `[命令超时] 500ms 后被终止`。
- [x] 截断：`seq 1 50000` → 截到 30033 字符 + `... [43779 lines truncated] ...`。
- [x] 非零退出码：不存在的命令 → `Exit code 127`。
- [x] `--version` → `0.4.0 (Claude Code)`；typecheck 通过。

## 下一步

**T4 · 文件工具集（旧 M4）**：循环仍一行不改，在 `bashTool` 之外加 `Read` / `Write` / `Edit` /
`Grep` / `Glob` 5 个工具，用 `TOOL_HANDLERS[block.name]()` 查表分发，让 agent 能「读、搜、改」代码。
届时再对照真实 `src/tools.ts`（工具分发）与 `src/tools/FileReadTool/`、`FileEditTool/` 等逐条复刻。
