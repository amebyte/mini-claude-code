# 深入理解 Claude Code 启动骨架的本质原理：fast-path 零加载 + 一次动态 import

### 1. 前言

不知道你有没有这样的疑惑：在终端里敲下 `claude --version`，结果几乎是「啪」的一下就出来了；而敲 `claude` 进入交互式 REPL，却要等上一小会儿。同样是启动，为什么前者快、后者慢？

答案是：**前者根本没有加载那个庞大的 CLI**。

这不是玄学，而是真实 Claude Code 源码里刻意设计的一层「引导入口」。它的核心思想只有一句话——**在加载任何重模块之前，先把能快速回答的问题回答掉**。

我们这篇文章，就从一个最小还原项目出发，把 Claude Code 的「启动骨架」一层层拆开来看：它到底是怎么做到「零加载」的？`--version` 和 `--help` 走的是同一条路吗？那个神秘的 `MACRO` 又是从哪儿冒出来的？

> 本文对应的源码仓库是《Claude Code 源码最小还原实现》的**第 1 个里程碑 T0.1**，只做「命令行骨架」这一件事，不碰 prompt、不碰模型、不碰工具。如果你看过我的系列文章，可以把它理解成整个还原工程的**地基**——后面所有单轮对话、Agent Loop、工具调用，都要盖在这块地基上。

那么，这个骨架到底是怎么搭起来的呢？

### 2. 为什么需要这样一个启动骨架？

先回答一个更根本的问题：**一个 CLI 工具，启动时最怕什么？**

最怕的是「启动即全量加载」。想象一下，你的命令行工具里塞了几十个模块——文件系统操作、权限校验、LLM SDK、终端渲染（ink）、会话管理……如果 `main` 一进来就把这些**全部 `import` 进来**，那么哪怕用户只是想看一眼版本号，也得先把这些重家伙一个个求值完。

结果就是：一个本应「瞬间返回」的 `--version`，硬生生等了几百毫秒。

**传统做法**是这样的：

```
入口文件
  ├── import 文件系统模块
  ├── import 权限模块
  ├── import LLM SDK
  ├── import ink 渲染
  └── ... 全都先求值一遍
       └── 最后才看：哦，你要 --version 啊，打印走人
```

而 Claude Code 的做法，是把「回答版本号」这件事**提到最前面**，让它成为一条**不加载任何重模块**的捷径：

```
入口文件（cli.tsx）
  ├── 先检查：是不是单独一个 --version？
  │     ├── 是 → 打印版本号，直接 return（零加载，到此结束）✅
  │     └── 否 → 继续往下
  └── 动态 import 完整 CLI（main.tsx）→ 交给 commander 解析
```

你会发现，真正的**重模块加载**（`import('../main.js')`）被放到了 `--version` 判断**之后**。命中 fast-path 时，那行 `import` 压根不会执行。

这就是整个骨架的**核心要义**：**用「先判断、后加载」的顺序，把最常见的快路径从庞大的启动开销里剥离出来。**

### 3. 核心概念：两层入口

先用最精简的伪代码，给这个骨架拍一张「全景照」：

```
if 参数是单独一个 --version:
    print(版本号)          # fast-path，零动态加载
    return

main = await import('./main')   # 未命中，才加载完整 CLI
main.run(process.argv)          # 交给 commander 解析
```

再配一张数据流图，你就能看清这两层是怎么分工的：

```
┌─────────────────────────────────────────────────────────────┐
│  cli.tsx（引导入口 / bootstrap）                             │
│                                                             │
│   process.argv ──► 是单独 --version？                        │
│                        │                                    │
│              ┌─────────┴─────────┐                          │
│              │ 是                │ 否                       │
│              ▼                   ▼                          │
│     打印版本号并 return    await import('../main.js')        │
│     （零加载，进程结束）            │                         │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  main.ts（完整 CLI）                                        │
│                                                             │
│   commander 组织参数面：                                     │
│     .name('claude')                                         │
│     .argument('[prompt]')                                   │
│     .version(...)      ← 这是 fast-path 之外的「兜底」       │
│     .helpOption(...)                                        │
│     .action(...)                                            │
│   parseAsync(process.argv)                                  │
└─────────────────────────────────────────────────────────────┘
```

这里有三个关键角色，我们先记住它们的名字，后面逐个拆解：

- **`cli.tsx`（引导入口）**：门卫。先拦一道，能自己回答的问题（版本号）当场回答，回答不了才放行去加载后面的大家伙。
- **`main.ts`（完整 CLI）**：主体。用 **commander** 声明式地把整个参数面立起来。
- **`MACRO`（全局常量）**：说明书上的「型号铭牌」。版本号不是运行时读出来的，而是**构建时注入**的。

### 4. 代码实现

下面我们按「从配置到入口」的构建顺序，把这个骨架一块块搭起来。

#### 4.1 环境准备：ESM + NodeNext，tsx 直跑

先看 `package.json` 和 `tsconfig.json`，它们决定了整个项目「怎么跑」：

```json
{
  "name": "claude-code-m01",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/entrypoints/cli.tsx",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  },
  "dependencies": {
    "commander": "^15.0.0"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

这里有两个点值得说道：

1. **`"type": "module"` + `NodeNext`**：整个项目是 **ESM** 模块。这意味着后面 `import('../main.js')` 这种**动态 import** 是原生能力，也意味着源码里的 import 路径可以写 `.js` 后缀——tsc 和 tsx 会自动把它映射回 `.ts` 源文件。
2. **`tsx` 直跑，没有构建步骤**：真实 Claude Code 是用 `bun:bundle` 构建的，但我们为了还原学习，用 `tsx` 直接解释执行 TypeScript。这个「没有构建」的选择，恰恰在后面 `MACRO` 那里埋下了一个小坑——**构建时注入的东西，直跑就没有了**，我们得想办法补回来。

#### 4.2 全局常量 MACRO：版本号是「构建时注入」的

先看类型声明 `src/globals.d.ts`：

```ts
/**
 * 全局类型声明。
 * 真实源码里，MACRO 是构建时注入的全局常量——build.ts 用 bun:bundle
 * 把 MACRO.VERSION / MACRO.BUILD_TIME 直接内联成字符串字面量。
 */
declare const MACRO: {
  /** 构建时注入的版本号（真实对应 MACRO.VERSION） */
  VERSION: string;
};
```

**这是最容易让人犯迷糊的一个点**：源码里只有一句 `declare const MACRO`，那它的值到底在哪儿？

答案是：**它根本不在源码里，而是在构建产物里**。

真实 Claude Code 的 `build.ts` 会在打包时，把 `MACRO.VERSION` 直接替换成一个字符串字面量，比如 `"1.0.0"`。也就是说，源码里那行 `MACRO.VERSION`，编译后变成了一段死值。**运行时没有任何「读版本号」的动作，版本号已经被焊死在二进制里了。**

而我们是 `tsx` 直跑，没有构建注入这一步，`MACRO` 会是个 `undefined`，直接引用会报错。于是我们在 `cli.tsx` 顶部补了一个**垫片（shim）**：

```ts
// 用 tsx 直跑没有构建注入，这里在文件顶部给 globalThis 补一个等价常量，
// 使 MACRO.VERSION 在运行时可解析。
(globalThis as { MACRO?: { VERSION: string } }).MACRO ??= {
  VERSION: '0.1.0',
};
```

`??=` 是「空值合并赋值」：只有当 `globalThis.MACRO` 还是 `undefined`/`null` 时才赋值。这样既能在无构建环境里跑起来，又不会覆盖真实构建注入的值——**一个垫片，两全其美**。

简单来说：**`MACRO` 是「构建时注入」，而不是「运行时配置」**。这是理解这个骨架的第二个关键认知。

#### 4.3 引导入口 cli.tsx：fast-path + 动态 import

接下来是重头戏，`src/entrypoints/cli.tsx`：

```ts
// 引导入口 —— 在加载完整 CLI 之前，先检查特殊 flag。
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // fast-path：--version / -v / -V —— 零动态加载。
  // 真实实现还要求 args.length === 1（单独出现才命中，避免误吞其它参数）。
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
    console.log(`${MACRO.VERSION} (Claude Code)`);
    return;
  }

  // 未命中特殊 flag，加载并运行完整 CLI。
  const { main: cliMain } = await import('../main.js');
  await cliMain();
}

// 用 void main() 触发（避免悬空 Promise 的 lint 告警）。
void main();
```

这段代码是整个骨架的**心脏**，我们逐行拆：

1. `process.argv.slice(2)`：`argv` 前两项是 `node` 和脚本路径，去掉后剩下的才是真正的用户参数。
2. **`if (args.length === 1 && ...)`**：注意这个 `args.length === 1` 的条件——**版本号只有在「单独出现」时才走 fast-path**。为什么？因为如果用户敲的是 `claude --version foo` 这种混合参数，我们不该抢在 commander 前面乱打印，而应该把整个参数面交给 commander 去规范处理。这就是「门卫只拦最确定的那一种情况」。
3. **`console.log(...); return;`**：命中了就直接打印、直接返回，**进程到此结束**。关键点在于——走到这里时，那行 `await import('../main.js')` **还没有执行**，也就是说完整 CLI 那一坨重模块一个都没加载。
4. **`await import('../main.js')`**：这是**动态 import**。它把「加载完整 CLI」这个昂贵的动作，延迟到了「确实需要」的那一刻。真实源码里，连渲染用的 ink、文件系统、权限模块都是这样按需加载的。

你有没有发现一个精妙之处？**`--version` 的整个生命周期，就只加载了 `cli.tsx` 这一个文件**。真实源码里甚至有这么一句注释：*"Fast-path for --version has zero imports beyond this file"*——「除了这个文件之外，零 import」。这就是 **fast-path 零加载** 的全部含义。

#### 4.4 完整 CLI main.ts：commander 组织参数面

最后是 `src/main.ts`，它只在 fast-path **未命中**时才会被加载：

```ts
import { Command } from 'commander';

export async function main(): Promise<void> {
  const program = new Command();

  program
    .name('claude')
    .description('Claude Code 源码最小还原实现（T0.1 项目骨架）')
    .argument('[prompt]', '给 agent 的提示词（T0.2 单轮对话才实现，本里程碑忽略）', String)
    // 真实源码：.version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', ...)
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
```

这里的关键认知是：**commander 的 `.version()` 也会处理 `-v/--version`**——它是 fast-path 之外的「兜底」。

于是你看到了一个漂亮的分工：

| 场景 | 走哪条路 | 说明 |
| --- | --- | --- |
| `claude --version`（单独） | **fast-path** | `cli.tsx` 直接打印，零加载，进程秒结束 |
| `claude --version foo`（混合） | **commander 兜底** | 落到 `.version()` 处理 |
| `claude --help` | **commander** | 先加载 `main.ts`，再由 commander 自动生成帮助 |
| `claude` / `claude xxx` | **commander** | 进 `.action()`，本里程碑打印「未实现」 |

`parseAsync(process.argv)` 是 commander 的异步解析入口，它会把参数按 `.argument()`、`.version()`、`.helpOption()` 的声明去匹配，匹配到 `--help` 就打印帮助，匹配到 `[prompt]` 就调 `.action()` 回调。

**两层各司其职**：`cli.tsx` 只负责「最确定的那一种情况」的极致优化，`main.ts` 负责「其余所有情况」的规范处理。

### 5. 测试 / 演示

先装依赖，然后跑两个命令验证：

```bash
npm install
```

**场景一：`--version` 命中 fast-path**

```bash
$ npm run dev -- --version
0.1.0 (Claude Code)
```

打印的是 `${MACRO.VERSION} (Claude Code)`——版本号来自我们补的那个垫片，而 `(Claude Code)` 这个后缀是真实 Claude Code 的标志性格式。从结果可以看出，整个过程只走了 `cli.tsx` 一个文件。

**场景二：`--help` 由 commander 自动生成**

```bash
$ npm run dev -- --help
Usage: claude [options] [prompt]

Claude Code 源码最小还原实现（T0.1 项目骨架）

Arguments:
  prompt         给 agent 的提示词（T0.2 单轮对话才实现，本里程碑忽略）

Options:
  -v, --version  Output the version number
  -h, --help     Display help for command
```

这份帮助信息**不是我们手写的**，而是 commander 根据 `.argument()`、`.version()`、`.helpOption()` 的声明**自动排版**出来的。这就是「声明式参数解析」的好处——你只声明「有什么」，格式它替你管。

#### 一个真实的坑：`npm run dev -V` 为什么打印的是「未实现」？

这里埋着一个特别容易踩的坑，值得单独说。如果你这样跑：

```bash
$ npm run dev -V
[未实现] 交互式 REPL 尚未实现（T2.2）
```

咦？`-V` 不是应该打印版本号吗，怎么变成「未实现」了？

原因是：**npm 的 `run` 命令不会把带 `-` 的参数透传给脚本**（除非加 `--`）。也就是说 `npm run dev -V` 里的 `-V` 被 npm 自己吞掉了，脚本收到的参数是空的，于是裸跑进了 `.action()` 的「未实现」分支。

加一个 `--` 就好了：

```bash
$ npm run dev -- -V
0.1.0 (Claude Code)
```

用一个只打印 `argv` 的临时脚本验证过，规律非常清晰：

| 命令 | `argv.slice(2)` | 说明 |
| --- | --- | --- |
| `npm run dump -V` | `[]` | `-V` 被 npm 吞掉 |
| `npm run dump -- -V` | `["-V"]` | 加 `--` 才透传 |
| `npm run dump hello` | `["hello"]` | 不带 `-` 的位置参数直接透传 |

**规则记住一句话**：`npm run <script>` 后面，不带 `-` 的位置参数直接透传；带 `-` 的 flag 必须加 `--` 才会透传。想省事的话，直接用 `npx tsx src/entrypoints/cli.tsx -V`，绕过 npm 这一层。

### 6. 工作原理总结

把整个启动骨架的运转流程，压缩成一条有序链路：

1. 用户敲下命令，`process.argv` 进入 `cli.tsx` 的 `main()`。
2. **判断**：参数是不是「单独一个 `--version`/`-v`/`-V`」？
3. **命中** → 打印 `${MACRO.VERSION} (Claude Code)`，`return`，进程结束（**零加载**）。
4. **未命中** → `await import('../main.js')`，此时才真正加载完整 CLI。
5. `main.ts` 用 commander 声明参数面，`parseAsync(process.argv)` 解析。
6. 匹配 `--help` → 打印帮助；匹配 `--version` → commander 兜底打印；匹配 `[prompt]` → 进 `.action()`（本里程碑打印「未实现」）。

**这就是命令行工具最小骨架的完整闭环**：一个门卫先拦一道，拦得住就零开销收工，拦不住才把大家伙请出来。

### 7. 总结

所谓 **Claude Code 的启动骨架，本质就是「分层加载」**——把「回答版本号」这条最高频的快路径，从「加载完整 CLI」这个重开销里剥离出去，用**一个 fast-path + 一次动态 import** 完成。

提炼三个核心：

- **fast-path 零加载**：`--version` 在 import 任何重模块之前就结束。顺序是关键——「先判断、后加载」，而不是「先加载、后判断」。
- **动态 import 延迟加载**：`await import('../main.js')` 把完整 CLI 的求值开销推迟到「确实需要」的那一刻，让快路径完全不被拖累。
- **构建时注入的 MACRO**：版本号不是运行时读的，是构建时焊进产物的字符串字面量。我们用 `globalThis.MACRO ??=` 垫片在无构建环境里等价还原。

在此基础上，你可以往这几个方向扩展：

- 把 `main.ts` 里 `.action()` 的「未实现」分支补成真正的 **prompt 处理**——这就是下一里程碑 T0.2 单轮对话要做的事（读 `ANTHROPIC_API_KEY`、调 `@anthropic-ai/sdk`、`messages.createStream()` 逐 token 流式打印）。
- 引入 `@commander-js/extra-typings`，给 options 加上更强的类型推断（真实源码就是这么干的，两者 API 同构）。
- 参考真实 `build.ts` 的 `bun:bundle`，把「tsx 直跑 + 垫片」升级成真正的「构建时注入」。

地基已经立好，接下来我们就要在这块地基上，一层层盖出单轮对话、Agent Loop、工具调用——敬请期待。

---

我是 Cobyte，欢迎添加 v: icobyte，学习交流 AI 全栈。
