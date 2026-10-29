# m01 — T0.1 项目骨架（--version / --help）

《Claude Code 源码最小还原实现》的第 1 个里程碑：把「命令行骨架」立起来，支持 `--version` 与 `--help`。

目录结构与参数解析方式都参考真实源码

## 本里程碑做了什么

复刻真实 Claude Code 的「引导入口 + 完整 CLI」两层结构，参数解析用 **commander**：

- `src/entrypoints/cli.tsx`：引导入口，先走 `--version` **fast-path（零动态加载）**，未命中再动态加载完整 CLI。
- `src/main.ts`：完整 CLI 入口（真实是 `src/main.tsx`，含 ink/JSX，T0.1 简化为 `.ts`），用 **commander** 组织 `--version` / `--help` / `[prompt]`。
- `src/globals.d.ts`：`declare const MACRO`，对应真实源码里「构建时注入版本号」的全局常量。

**明确不做**：prompt 处理、单轮对话、任何 LLM 调用、任何工具。这些分别属于 T0.2、T1、T2。

## 目录结构（映射真实源码）

| 本仓库文件 | 真实源码对应 | 说明 |
| --- | --- | --- |
| `src/entrypoints/cli.tsx` | `src/entrypoints/cli.tsx` | 引导入口 + fast-path |
| `src/main.ts` | `src/main.tsx` | 完整 CLI（commander，简化无 ink/JSX） |
| `src/globals.d.ts` | `declare const MACRO`（分散在真实源码里） | 构建注入全局的类型声明 |
| `package.json` / `tsconfig.json` | 真实构建见 `build.ts` | ESM + NodeNext，`tsx` 直跑 |

## 环境要求

- Node.js ≥ 18（本机验证用 v22.23.2）
- 无需任何 API Key（本里程碑不调用模型）

## 启动步骤

### 1. 安装依赖

在 `nodejs/m01` 目录下执行：

```bash
npm install
```

### 2. 运行

```bash
# 输出版本号（命中 fast-path，零动态加载）
npm run dev -- --version
# → 0.1.0 (Claude Code)

# 输出帮助信息（动态加载完整 CLI，由 commander 生成）
npm run dev -- --help
```

也可以直接用 `npx`：

```bash
npx tsx src/entrypoints/cli.tsx --version
npx tsx src/entrypoints/cli.tsx --help
```

`--help` 输出由 commander 自动生成：

```
Usage: claude [options] [prompt]

Claude Code 源码最小还原实现（T0.1 项目骨架）

Arguments:
  prompt         给 agent 的提示词（T0.2 单轮对话才实现，本里程碑忽略）

Options:
  -v, --version  Output the version number
  -h, --help     Display help for command
```

### 3. 类型检查

```bash
npm run typecheck
```

## 常见问题（坑）

### 为什么 `npm run dev -V` 打印「[未实现] 交互式 REPL…」而不是版本号？

npm 的 `run` 命令**不会**把带 `-` 的参数透传给脚本（除非加 `--`）：

```bash
npm run dev -V        # ✗ npm 吞掉了 -V，脚本裸跑 → 打印「[未实现] 交互式 REPL…」
npm run dev -- -V     # ✓ 加 -- 后 -V 才透传 → 打印 0.1.0 (Claude Code)
```

用一个只打印 argv 的临时脚本验证过：

```
npm run dump -V      → argv.slice(2) = []          # -V 被 npm 吞掉
npm run dump -- -V   → argv.slice(2) = ["-V"]      # 加 -- 才透传
npm run dump hello   → argv.slice(2) = ["hello"]   # 不带 - 的位置参数直接透传
```

**规则**：`npm run <script>` 后面，不带 `-` 的位置参数直接透传；带 `-` 的 flag 必须加 `--` 才会透传。
所以想省事可以直接用 `npx tsx src/entrypoints/cli.tsx -V`，绕过 npm 这一层。

## 对照真实源码怎么学

打开真实源码 `src/entrypoints/cli.tsx` 与 `src/main.tsx`，逐条对照本仓库实现：

1. **fast-path 零加载**：真实 `cli.tsx` 的 `main()` 里第一个检查就是版本号——

   ```ts
   if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
     console.log(`${MACRO.VERSION} (Claude Code)`);
     return;
   }
   ```

   命中 `--version` 时**还没有 `import` 任何重模块**就结束进程（真实顶部注释：*"Fast-path for
   --version has zero imports beyond this file"*）。本仓库 `cli.tsx` 复刻了这个「先 fast-path、后加载」的顺序。

2. **commander 组织完整 CLI**：真实 `main.tsx` 用 commander 搭出整个参数面，本仓库复刻了它的骨架：

   ```ts
   program
     .name('claude')
     .description('...')
     .argument('[prompt]', '...', String)
     .version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')
     .helpOption('-h, --help', 'Display help for command')
     .action(async (prompt) => { ... });

   await program.parseAsync(process.argv);
   ```

   **注意**：commander 的 `.version()` 也会处理 `-v/--version`——它是 fast-path 之外的「兜底」。
   fast-path 只对「单独一个 `--version`」做零加载优化；当 `--version` 混在其它参数里时，就落到 commander 兜底。两层各司其职。

3. **`@commander-js/extra-typings` vs `commander`**：真实源码 import 的是 `@commander-js/extra-typings`
   （给 options 提供类型推断），本里程碑先用官方 `commander`（两者 API 同构）。等后续里程碑有带类型的
   option 时，再切换到 `extra-typings`。

4. **MACRO 是构建时注入，不是运行时配置**：真实 `MACRO.VERSION` 由 `build.ts` 用 `bun:bundle`
   在构建时内联成字符串字面量，源码里只有 `declare const MACRO: { VERSION: string }`。本仓库用 `tsx`
   直跑没有构建注入，于是用 `(globalThis as ...).MACRO ??= { VERSION: '0.1.0' }` 做了个等价垫片（类型见 `globals.d.ts`）。

5. **动态 `import` 委托**：真实里未命中特殊 flag 后，才 `await import('../main.js')` 加载完整 CLI，
   把启动开销从 fast-path 剥离出去。且真实的 `cliMain()` **不接收参数**——`main.tsx` 内部直接用
   `process.argv` 交给 commander 解析，本仓库 `main()` 同样是无参签名。

6. **`.js` 扩展名**：真实源码的 import 写 `'../main.js'`（NodeNext ESM 约定），tsc 与 tsx 会自动把
   `.js` 映射回 `.ts` 源文件。本仓库沿用这一写法，跑起来与类型检查都正常。

7. **`void main()`**：真实文件末尾用 `void main()` 触发异步入口（避免悬空 Promise 告警），本仓库同样。

## 下一步

**T0.2 · 单轮对话**：读 `ANTHROPIC_API_KEY`，用 `@anthropic-ai/sdk` 发一条消息、
逐 token 流式打印（`messages.createStream()`）。届时会把 `main.ts` 里 `.action()` 的「未实现」分支补成真正的 prompt 处理。
