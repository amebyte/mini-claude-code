# m6 — T6 · 权限系统

《Claude Code 源码最小还原实现》的第 7 个里程碑：在工具执行前插入**三道权限闸门**——
硬拒绝 → 规则匹配 → 用户审批。破坏性操作（删除、写系统目录、写工作区外）不再直接执行，
而是先过权限检查。**循环（`query.ts`）只加了一处**：执行工具前先调 `runToolWithPermission`。

对应计划文档 v5.0 的 **T6 · 权限系统（day 0）**，结构忠实还原真实源码
`src/types/permissions.ts` + `src/hooks/useCanUseTool.tsx`，三道闸门模型对照 learn-claude-code 的
`s03_permission/code.py`。

> 格言：*先划边界，再给自由*。Harness 层：**权限**。
> 核心不变式：**循环属于 agent，机制属于 harness**——权限是插在「循环」与「工具执行」之间的闸门，
> 循环本身一行逻辑不变。

## 本里程碑做了什么

在 m5（T5 交互式 REPL）基础上新增：

- **`src/types/permissions.ts`**（新增）：权限类型契约——`PermissionMode`（default / bypassPermissions）、
  `PermissionDecision`（allow / deny / ask 三态）、`PermissionContext`、`ApprovalHandler`。
- **`src/utils/permissions/checkPermission.ts`**（新增）：三道闸门的主逻辑。
- **`src/Tool.ts`**（改动）：Tool 契约加 `isReadOnly?: boolean`（对应真实 `Tool.isReadOnly()` 的静态版）。
- **`src/tools/{FileReadTool,GlobTool,GrepTool}`**（改动）：标记 `isReadOnly: true`（只读工具永远放行）。
- **`src/query.ts`**（改动）：新增 `runToolWithPermission`，执行工具前先过权限闸门；`QueryParams`
  加 `permission` 与 `onApproval`。
- **`src/repl.ts`**（改动）：`onApproval` 回调——遇到 `ask` 决策弹出 `允许？[y/N]`。
- **`src/main.ts`**（改动）：加 `--dangerously-skip-permissions` flag（对应真实同名 flag，切 bypassPermissions）。
- **`src/systemPrompt.ts`**（改动）：提示模型「破坏性操作会触发审批」。

### 三道闸门（对应 Python s03 的 `check_permission`）

```
Gate 1 硬拒绝（deny，不问）：危险命令（rm -rf /、sudo、mkfs…）+ 系统目录（/etc /usr C:\Windows…）
Gate 2 规则匹配（ask）：潜在破坏性命令（rm、> 覆盖、chmod 777…）+ 写工作区外（非系统目录）
Gate 3 用户审批（ask 的下一步）：REPL 弹 y/N；一次性模式无回调 → fail-closed 自动拒绝
未命中任何闸门（只读工具 / 安全命令 / 工作区内新建）→ allow 直通
```

## 目录结构（映射真实源码）

| 本仓库文件 | 真实源码对应 | 说明 |
| --- | --- | --- |
| `src/types/permissions.ts` | `src/types/permissions.ts` | 权限类型（PermissionDecision / Context，T6 最小化） |
| `src/utils/permissions/checkPermission.ts` | `src/hooks/useCanUseTool.tsx` | 三道闸门主逻辑（真实还有分类器/沙箱/规则持久化） |
| `src/query.ts` | `src/query.ts` | `runToolWithPermission` 在工具执行前拦截 |
| `src/Tool.ts` | `src/Tool.ts` | `isReadOnly`（对应真实 `isReadOnly()`） |
| `src/repl.ts` | `src/replLauncher.tsx` + `useCanUseTool` | 审批交互（y/N） |

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
# 交互式 REPL（破坏性操作会弹 y/N）
npm run dev

# 一次性模式（无审批回调 → ask 决策自动拒绝）
npm run dev -- "删除 test.txt"

# 跳过所有权限检查（危险，对应真实 --dangerously-skip-permissions）
npm run dev -- --dangerously-skip-permissions "删除 test.txt"
```

### 4. 类型检查

```bash
npm run typecheck
```

## 对照真实源码怎么学

打开真实源码 `src/types/permissions.ts`、`src/hooks/useCanUseTool.tsx`，对照 learn-claude-code 的
`s03_permission/code.py`：

1. **「循环只加一行」的插入点**：Python s03 的注释写明 *Only one line added to the agent loop:
   `if not check_permission(block): continue`*。本仓库对应的是 `query.ts` 里 `runToolWithPermission`
   这一处——在 `findToolByName` 拿到工具后、`tool.call()` 之前拦截。真实 Claude Code 里这个拦截点是
   `canUseTool` hook（`useCanUseTool.tsx`），由 `Tool.checkPermissions()` + 规则引擎 + 分类器 + 沙箱共同决定。

2. **三态决策（PermissionDecision）**：真实是 `allow / deny / ask / passthrough` 四态（passthrough 给
   更外层继续判断），T6 简化为 `allow / deny / ask` 三态。`deny` 直接拒绝并给理由；`ask` 交给审批回调；
   `allow` 放行。

3. **只读工具短路**：真实 `Tool.isReadOnly(input)` 是**方法**（Bash 的 `ls` 只读、`rm` 不只读，按 input 判断）。
   T6 用静态 `isReadOnly: boolean` 覆盖 Read/Glob/Grep 三个永远只读的工具，Bash 的 input 依赖只读性在
   checkPermission 里用「破坏性命令模式」单独判断。要更贴近真实，可把 `isReadOnly` 改成方法。

4. **三道闸门 vs 真实分层**：真实 Claude Code 的权限不止三道闸门——还有 permission mode
   （acceptEdits/plan/bypassPermissions/auto）、规则持久化（`.claude/settings.json` 0.2.67）、
   Bash 分类器（classifier）、沙箱（2.0.24）。T6 只还原「三道闸门」这一层，`bypassPermissions`
   模式用一个 flag 占位；规则持久化、分类器、沙箱留到后续里程碑。

## 验证清单（完成标准）

- [x] `Create test.txt`（Write 工作区内新建）→ **直通**，文件落盘。
- [x] `Delete test.txt`（Bash rm）→ **审批**：REPL 弹 `允许？[y/N]`，答 `y` 后真正删除；
      一次性模式无回调则自动拒绝。
- [x] `Write /etc`（系统目录）→ **越界拒绝**：`[权限拒绝] 禁止写入系统目录（越界）：/etc/...`。
- [x] `checkPermission` 单元测试 10 条全过（硬拒绝/ask/直通/bypass/只读短路）。
- [x] `--dangerously-skip-permissions` 切 bypassPermissions。
- [x] `--version` → `0.7.0 (Claude Code)`；typecheck 通过。

实测交互（pty 全流程）：

```
❯ 删除 test.txt 文件
[工具调用] Bash {"command":"rm -f test.txt"}
[权限询问] 潜在破坏性命令：rm -f test.txt
  工具：Bash {"command":"rm -f test.txt"}
  允许？[y/N] y
[工具结果] (no output)
（模型确认文件已删除）
```

## 下一步

**T7 · MCP 支持（≤0.2.21，第一梯队）★**：`MCPClient` + `connect_mcp` + `assemble_tool_pool`
（基础工具 + 已连接的 MCP 工具），让 agent 能「插上」外部 MCP server。对应真实源码
`src/services/mcp/`、`src/tools/MCPTool/`，CHANGELOG 确认 MCP 是 Claude Code 最早的能力之一
（比 Skills 早约 7 个月）。届时权限系统会顺带覆盖 MCP 工具的权限检查。
