# 文件工具集

《Claude Code 源码最小还原实现》的第 5 个里程碑：在上一小节（真实 Bash）之外再加
**Read / Write / Edit / Glob / Grep** 5 个文件工具，让 agent 从「跑命令」升级到「读、搜、改代码」。
**Agent Loop（`query.ts`）依然一行没改**——工具从 1 个变 6 个，分发靠 `src/tools.ts` 的
TOOLS 注册表 + `findToolByName` 查表。

对应计划文档 v5.0 的 **本小节 · 文件工具集**，结构忠实还原真实源码
`D:\workspace\202608\claude-code\claude-code` 的 `src/tools.ts` + `src/tools/{FileReadTool,FileWriteTool,FileEditTool,GlobTool,GrepTool}/`。

> *加一个工具，只加一个 handler*。Harness 层：**工具分发**。
> 核心不变式：**循环属于 agent，机制属于 harness**——加工具不改循环，只加 handler。

## 本里程碑做了什么

在上一小节（真实 Bash）基础上新增 5 个文件工具 + 一个注册表：

- **`src/tools.ts`**（新增）：TOOLS 注册表，登记全部 6 个工具。加一个工具 = 在这里加一行，
  循环里的 `findToolByName(tools, block.name)` 查表分发，一行不用改。
- **`src/tools/FileReadTool/FileReadTool.ts`**：`Read`——`fs.readFile` + offset/limit 分页 +
  `cat -n` 风格行号（`     1→content`，右对齐行号 + `→`）。
- **`src/tools/FileWriteTool/FileWriteTool.ts`**：`Write`——`mkdir` 父目录 + `fs.writeFile`，
  区分「新建 / 覆盖」文案。
- **`src/tools/FileEditTool/FileEditTool.ts`**：`Edit`——精确字符串替换（`file.split(old_string)`
  计次数 → 0 次报「找不到」、>1 次且非 replace_all 报「不唯一」、否则 replace/replaceAll）。
- **`src/tools/GlobTool/GlobTool.ts`**：`Glob`——`fast-glob` 按文件名匹配，忽略 node_modules/.git。
- **`src/tools/GrepTool/GrepTool.ts`**：`Grep`——fs + 正则实现 3 种 output_mode
  （`files_with_matches` / `content` / `count`）。
- **`src/utils/path.ts`**（新增）：`expandPath`——`~` 展开 + Windows 上 POSIX/MSYS 路径转原生路径。

**明确不做**：权限审批（T6，本步所有工具直通）、Read 的图片/PDF/notebook（T6 之后）、
Edit 的引号归一化与写前校验（T6 之后）、Grep 的 `-A/-B/-C/-i/type/multiline` 等 rg flag、
Glob 按 mtime 排序（本步按名字排序）、`description` 入参。

## 目录结构（映射真实源码）

| 本仓库文件 | 真实源码对应 | 说明 |
| --- | --- | --- |
| `src/tools.ts` | `src/tools.ts` | 工具注册表 / 分发（TOOLS 数组） |
| `src/tools/FileReadTool/FileReadTool.ts` | `src/tools/FileReadTool/FileReadTool.ts` | `Read`（行号 `→` 格式复刻 `addLineNumbers`） |
| `src/tools/FileWriteTool/FileWriteTool.ts` | `src/tools/FileWriteTool/FileWriteTool.ts` | `Write` |
| `src/tools/FileEditTool/FileEditTool.ts` | `src/tools/FileEditTool/FileEditTool.ts` | `Edit`（唯一性检查复刻真实逻辑） |
| `src/tools/GlobTool/GlobTool.ts` | `src/tools/GlobTool/GlobTool.ts` | `Glob`（真实用 rg `--files --glob`，本步 fast-glob 等价） |
| `src/tools/GrepTool/GrepTool.ts` | `src/tools/GrepTool/GrepTool.ts` | `Grep`（真实用 rg，本步 fs+正则等价） |
| `src/utils/path.ts` | `src/utils/path.ts` | `expandPath`（POSIX→Windows 路径转换） |
| `src/tools/BashTool/` | `src/tools/BashTool/` | 真实 Bash（T3，本步未改） |
| `src/query.ts` / `src/Tool.ts` | `src/query.ts` / `src/Tool.ts` | **本步未改** |

## 环境要求

- Node.js ≥ 18（本机验证用 v22.23.2）
- 一个 `DEEPSEEK_API_KEY`（DeepSeek 的 Anthropic 兼容端点，见 <https://platform.deepseek.com/>）
- 依赖 `fast-glob`（`npm install` 自动装好）

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
# 读文件
npm run dev -- "读取 README.md 并总结内容"

# 读→改→确认（进阶验收）
npm run dev -- "在 README.md 末尾加一行 'Author: Cobyte'，先 Read 再 Edit，只许使用这两个工具，最后确认"

# 按内容搜索
npm run dev -- "用 Grep 在 src 下搜包含 export const 的文件"

# 输出版本号
npm run dev -- --version
```

> 注意：npm 不透明传带 `-` 的参数，`--version` / `--help` 前必须加 `--`。

### 4. 类型检查

```bash
npm run typecheck
```

## 对照真实源码怎么学

打开真实源码 `src/tools.ts` + 各工具目录，逐条对照：

1. **工具分发（`src/tools.ts`）**：真实的 `findToolByName(tools, name)` 在 tools 数组里查表分发
   （还支持 `aliases` 别名）。本小节的 `src/tools.ts` 就是「加一个工具，只加一个 handler」的落点——
   循环不感知具体工具，只按 `block.name` 查表。

2. **Read 的行号格式（`utils/file.ts` 的 `addLineNumbers`）**：默认是 `右对齐 6 位行号 + →`，
   紧凑模式是 `行号 + \t`。这个格式是 Edit 的地基——模型看到 Read 输出后，要剥掉前缀取真正的
   文件内容来构造 `old_string`。本仓库复刻了默认的 `→` 格式，Edit 描述里也写了「行号前缀之后才是真实内容」。

3. **Edit 的精确替换（`FileEditTool.ts`）**：真实用 `file.split(old_string).length - 1` 算匹配次数，
   0 次报「找不到」、>1 次且非 replace_all 报「不唯一」、否则 `replace` / `replaceAll`。本仓库逐行
   复刻这三个分支（真实还有 `findActualString` 引号归一化，本小节 省略）。

4. **Glob/Grep 用 ripgrep**：真实 `GlobTool`/`GrepTool` 底层都是 `ripGrep`（spawn `rg` 二进制，
   内存友好、支持 `--glob`/`--sort=modified` 等）。本小节 用 `fast-glob`（Glob）+ fs/正则（Grep）做
   等价实现——语义一致，省去对 `rg` 二进制的依赖，也更容易读。

5. **Windows 路径转换（`utils/path.ts` 的 `expandPath`）**：真实代码在 Windows 上把 POSIX/MSYS
   风格路径（如 `/c/Users/...`）转成 Windows 格式。这是**本步踩到并修掉的真坑**：Bash 工具里
   `pwd` 返回 `/d/workspace/...`（MSYS 路径），但 Node 的 `fs.readFile` 只认 `D:\workspace\...`，
   不转换就会 `ENOENT`。修复前模型被迫多试一次，修复后 `expandPath` 统一处理。

## 验证清单（完成标准）

- [x] `Read README.md...` / `Create test.py then read it back` → Read/Write 正常读写。
- [x] 进阶：`在 sample.txt 加一行作者信息` → 模型自己 **Glob → Read → Edit → Read 确认**，
      最终文件内容正确（`Author: Cobyte` 追加成功）。
- [x] Grep 三种 output_mode 均正确（files_with_matches / count / content）。
- [x] Grep 跨目录搜索（`**/*.ts`）正确命中所有含 `MAX_` 的文件。
- [x] Edit 边界：old_string 不唯一 → 报「found 7 matches...」；找不到 → 报「old_string not found」。
- [x] `--version` → `0.5.0 (Claude Code)`；typecheck 通过。


一个可选的后续小改进

当前 Bash 工具返回的 pwd 仍是 MSYS 路径（/d/...），靠 expandPath 在文件工具侧兜底。更彻底的做法是让 Bash 工具也返回原生 Windows 路径（真实 getCwd() 就是这么做的），但那涉及 shell 环境搭建，可留到 T6（权限系统，会顺带引入 getCwd/工作目录管理）一起做。

## 下一步

**T5 · 交互式 REPL（可选）**：从「一次性 `cli.ts "prompt"`」升级成「交互式多轮」——
用 Node `readline` 做输入 + 历史，支持 `/help`、`/exit` 等 2-3 个斜杠命令。渲染先简单化
（纯文本逐行打印），**不要急着碰 ink**（ink 留到 T21）。

Author: Cobyte
