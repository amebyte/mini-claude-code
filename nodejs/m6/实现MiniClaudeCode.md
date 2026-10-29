# 实现 Mini Claude Code：四个工具如何让 AI 真正「写代码」

> 本文基于 `nodejs/m6/src/tools` 目录下的四个工具（Bash / Read / Write / Edit）展开，
> 重点拆解 `FileWriteTool/FileWriteTool.ts`，用一组测试例子串起整个「写代码」链路，
> 回答一个核心问题：**Claude Code 到底是怎么"写"代码的？**

---

## 0. 一句话先说结论

Claude Code（以及这里的 Mini 版）**并不"写"代码**——它不会直接往磁盘写一个字节。

真正发生的事是：

1. 模型只负责「说」——它输出一个 `tool_use` 块，内容是 `{ "name": "Write", "input": { "file_path": "...", "content": "...代码..." } }`；
2. 真正「动」文件的是 harness（宿主程序）里的工具函数——`FileWriteTool.call()` 里的 `fs.writeFile`。

换句话说：**模型产代码，harness 落盘**。这就是「写代码」的实现本质。理解了这条，下面每个工具、每个测试例子都豁然开朗。

---

## 1. 核心架构：一条循环 + 一张注册表

Mini Claude Code 的结构非常小，整个「智能」只靠两块拼起来：

### 1.1 Agent Loop（`src/query.ts`）——「循环属于 agent」

```ts
while (true) {
  // 1. 调 API，流式拿到模型这一轮的回复（可能带 tool_use 块）
  const turn = await streamAssistantTurn(messages, tools, system);
  // 2. 把 assistant 回复追加进历史
  messages.push({ role: 'assistant', content: turn.content });
  // 3. 提取 tool_use 块
  const toolUseBlocks = turn.content.filter(b => b.type === 'tool_use');
  // 4. 没有工具调用 = 说完了，循环结束
  if (toolUseBlocks.length === 0) return;
  // 5. 逐个执行工具，收集 tool_result
  const toolResults = [];
  for (const block of toolUseBlocks) {
    const tool = findToolByName(tools, block.name);
    const content = tool ? await tool.call(block.input) : `未找到工具 ${block.name}`;
    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
  }
  // 6. 把工具结果回喂给模型，进入下一轮
  messages.push({ role: 'user', content: toolResults });
}
```

这就是整个「agent」的全部。没有状态机、没有规划器，**就一个 `while` 循环**：模型输出工具调用 → 执行 → 结果回喂 → 再让模型决定下一步。代码里那句格言写得极好：

> **One loop & Bash is all you need.**

### 1.2 工具注册表（`src/tools.ts` + `src/Tool.ts`）——「机制属于 harness」

一个工具在代码里就是一个对象：

```ts
type Tool = {
  name: string;              // 模型在 tool_use 里引用的名字
  description: string;       // 写进 tools 数组，告诉模型何时用、怎么用
  inputSchema: JSONSchema;   // 入参结构，模型据此生成合法参数
  call(args): Promise<string>; // 真正干活的函数
};
```

注册表就是把它们排成一排，`findToolByName` 按名字查表分发：

```ts
// src/tools.ts
export const TOOLS: Tool[] = [bashTool, fileReadTool, fileEditTool];
```

> **核心不变式：循环属于 agent，机制属于 harness。** 加一个工具 = 在 `TOOLS` 里加一行 handler，
> 循环（`query.ts`）一行都不用改。这正是 Claude Code 能快速长出几十上百个工具的秘诀。

---

## 2. 重点：`FileWriteTool` 逐行拆解

这是本文的主角，位于 `src/tools/FileWriteTool/FileWriteTool.ts`，完整代码只有 49 行：

```ts
export const fileWriteTool: Tool = {
  name: 'Write',
  description: [
    '将文件写入本地文件系统。',
    '用法：',
    '- 如果提供的路径上已存在文件，此工具将覆盖该文件。',
    '- 修改已有文件时优先使用 Edit 工具——它只发送差异。仅在新建文件或完全重写时才使用 Write。',
    '- file_path 必须是绝对路径。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要写入文件的绝对路径' },
      content: { type: 'string', description: '要写入文件的内容' },
    },
    required: ['file_path', 'content'],
  },
  async call(args) {
    const filePath = expandPath(String(args.file_path ?? ''));
    const content = String(args.content ?? '');

    // 判断新建还是覆盖
    let existed = true;
    try { await access(filePath); } catch { existed = false; }

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');

    return existed
      ? `文件 ${filePath} 已成功更新。`
      : `文件已成功创建于：${filePath}`;
  },
};
```

三个关键设计点：

### 2.1 `description` 是给模型看的「使用说明书」

`Write` 的描述里藏着两条硬规则，它们不是给人看的，是**写进发给 API 的 tools 数组**、用来约束模型行为的：

- **「改已有文件优先用 Edit，Write 只用于新建或整体重写」** —— 这是 Claude Code 真实源码里的设计哲学：
  写代码大多数时候是「改几行」，用 Edit 发差异更省 token、更安全；Write 是用来「从头生成文件」的。
- **「file_path 必须是绝对路径」** —— 逼模型给出确定位置，避免相对路径解析歧义。

### 2.2 `inputSchema` 是模型生成入参的「接口契约」

模型看到的不是这段 TS，而是这段 schema 编译出的 JSON Schema。它能保证模型把代码**原样、完整**地放进 `content` 字段——这才是「写代码」的核心：**代码作为字符串参数，从模型一路传到 `writeFile`。**

### 2.3 `call()` 是真正「落盘」的那只手

注意最后四行，这才是全世界的 Claude Code「写文件」的真相：

```ts
await mkdir(dirname(filePath), { recursive: true }); // 自动建父目录
await writeFile(filePath, content, 'utf8');          // 写文件
```

前面所有机制（循环、schema、描述）都是为了让模型「说出正确的 `content`」，最终落到实处的就是这两行。它还通过 `access()` 区分了「新建 / 覆盖」，返回不同的文案，让模型知道刚才到底发生了什么。

---

## 3. 四个工具的分工：读、写、改、执行

写代码从来不是 Write 一个人的事。四个工具各管一段，拼起来才完整：

| 工具 | 名字 | 作用 | 一句类比 |
| --- | --- | --- | --- |
| [FileReadTool](src/tools/FileReadTool/FileReadTool.ts) | `Read` | 读文件，带行号、可翻页 | **眼睛** |
| [FileWriteTool](src/tools/FileWriteTool/FileWriteTool.ts) | `Write` | 新建/整体覆盖文件（`mkdir` + `writeFile`） | **新建的手** |
| [FileEditTool](src/tools/FileEditTool/FileEditTool.ts) | `Edit` | 精确字符串替换（`old_string` → `new_string`） | **外科手术刀** |
| [BashTool](src/tools/BashTool/BashTool.ts) | `Bash` | 跑任意 shell 命令（`bash -c`） | **万能的手** |

三个细节值得单独拎出来讲，因为它们共同决定了「写代码」的质量：

### 3.1 Read 的行号格式是 Edit 的地基

`Read` 返回的内容长这样（复刻真实 Claude Code 的 `addLineNumbers`）：

```
     1→print("Hello, Mini Claude Code")
     2→
```

`右对齐 6 位行号 + → + 真实内容`。模型看到这个，要**剥掉前缀**才能拿到文件的真实内容，从而构造 `Edit` 的 `old_string`。这是 Read 和 Edit 之间的暗号——`Edit` 的 description 里就写了「请保留行号前缀之后的精确缩进」。

### 3.2 Edit 的「精确替换」三段论

`FileEditTool.call()` 的核心是这三行：

```ts
const matches = file.split(oldString).length - 1;
if (matches === 0) return `编辑失败：在文件中未找到 old_string...`;
if (matches > 1 && !replaceAll) return `编辑失败：找到 ${matches} 处 old_string 匹配...`;
const updated = replaceAll ? file.replaceAll(oldString, newString) : file.replace(oldString, newString);
```

0 次 → 报「找不到」；多次且没开 `replace_all` → 报「不唯一」；否则替换。这套「先数后替」的逻辑，让模型改代码时**要么精确命中，要么明确报错**，而不是糊里糊涂改错地方。

### 3.3 Bash 是「验证写出来的代码」的那只手

`BashTool` 用 `execFile(shell, ['-c', command])` 跑命令，**永远用 bash 而非 Windows 的 cmd.exe**（cmd 不剥引号，`echo "print('hi')" > f` 会把引号一起写进文件）。写代码不只是把文本写进文件，更要**跑起来验证**——这一步靠 Bash。

---

## 4. 测试例子（重点）

下面用真实的工具调用/返回，演示「写代码」的完整过程。工具名、入参 JSON、返回文案都与源码一一对应。

### 4.1 测试 1：Write 新建文件（最核心的「写代码」）

**提示词：** `创建一个 hello.py，打印 "Hello, Mini Claude Code"`

模型第一轮就调用 Write：

```json
// tool_use 块
{
  "name": "Write",
  "input": {
    "file_path": "D:\\workspace\\202608\\mini-claude-code\\nodejs\\m6\\hello.py",
    "content": "print(\"Hello, Mini Claude Code\")\n"
  }
}
```

harness 执行 `FileWriteTool.call()`，`mkdir` + `writeFile` 落盘，返回：

```
[工具结果] 文件已成功创建于：D:\workspace\202608\mini-claude-code\nodejs\m6\hello.py
```

模型拿到结果后输出最终回答：「已创建 hello.py」。**注意：代码是作为 `content` 字符串写进 `input` 的，真正写盘的是 harness。**

### 4.2 测试 2：Write 覆盖已存在文件

**提示词：** `把 hello.py 完全重写为打印 "Hi"`

文件已存在，`access()` 判定 `existed = true`，返回文案不同：

```
[工具结果] 文件 D:\workspace\...\hello.py 已成功更新。
```

「新建 / 覆盖」两种文案，让模型明确知道自己做的是「创建」还是「覆盖」，避免误覆盖后不自知。

### 4.3 测试 3：Read → Edit 精确改一行（最常见的「改代码」）

**提示词：** `把 hello.py 里的 "Hello, Mini Claude Code" 改成 "Hello, Claude Code"`

模型先 Read：

```
// tool_use: Read { file_path: ".../hello.py" }
// tool_result:
     1→print("Hello, Mini Claude Code")
```

模型剥掉 `     1→` 前缀，拿到精确内容 `print("Hello, Mini Claude Code")`，然后 Edit：

```json
// tool_use: Edit
{
  "name": "Edit",
  "input": {
    "file_path": ".../hello.py",
    "old_string": "print(\"Hello, Mini Claude Code\")",
    "new_string": "print(\"Hello, Claude Code\")"
  }
}
// tool_result: 文件 ...\hello.py 已成功更新。
```

这一轮完整展示了「**读 → 剥行号 → 精确替换 → 写回**」的闭环，是 Claude Code 改代码的标准姿势。

### 4.4 测试 4：Edit 的边界（fail 也是测试的一部分）

**4.4.1 old_string 找不到：**

```
编辑失败：在文件中未找到 old_string。在 .../hello.py 中未找到精确文本。请重新读取文件并复制要替换的精确文本（包括缩进）。
```

**4.4.2 old_string 不唯一（多处匹配，未开 replace_all）：**

```
编辑失败：找到 7 处 old_string 匹配，但 replace_all 为 false。请将 replace_all 设为 true 以替换所有出现位置，或提供更多上下文使 old_string 唯一。
```

**4.4.3 开 replace_all 后一次替换所有（如重命名变量）：**

```json
{ "name": "Edit", "input": { "file_path": "...", "old_string": "temp", "new_string": "result", "replace_all": true } }
// tool_result: 文件 ... 已成功更新。
```

这三个边界测试证明：Edit 宁可**明确报错**，也不会静默改错——这正是它能被信任去改生产代码的原因。

### 4.5 测试 5：写代码 + Bash 运行验证（端到端）

**提示词：** `写一个计算斐波那契数列的 Python 文件 fib.py，并运行验证输出前 10 项`

模型会自己编排多工具、多轮：

```
第 1 轮  tool_use: Write  fib.py  (content = 完整 Python 代码)
         tool_result: 文件已成功创建于：...\fib.py
第 2 轮  tool_use: Bash   python fib.py
         tool_result: 0 1 1 2 3 5 8 13 21 34
第 3 轮  （纯文本）「fib.py 已创建并验证，输出前 10 项为 0 1 1 2 3 5 8 13 21 34」
```

这就是「写代码」的最高形态：**生成 → 落盘 → 执行 → 看结果 → 给结论**。没有 Bash 这一步，写出来的代码是「盲写」；有了它，模型能**自己验证自己写的东西对不对**，错了就回到 Edit 再改，如此往复——这正是 Claude Code 让人感觉「真的在干活」的原因。

### 4.6 测试 6：路径坑与 `expandPath`（一个真实踩过的坑）

`Bash` 工具里 `pwd` 在 Windows 上返回 MSYS 风格路径 `/d/workspace/...`，但 Node 的 `fs.readFile` 只认 `D:\workspace\...`。`FileWriteTool`/`FileReadTool`/`FileEditTool` 开头都调 `expandPath()` 兜底：

```ts
// src/utils/path.ts
if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(processed)) {
  processed = `${processed[1].toUpperCase()}:${processed.slice(2)}`; // /d/... → D:/...
}
```

没有这层转换，模型就得「多试一次」才能读到自己刚写的东西。这是「机制属于 harness」的又一个体现：**脏活累活由 harness 兜底，模型只负责产出。**

---

## 5. Claude Code 是如何「写代码」的：完整链路

把前面所有碎片拼成一条完整链路，就是 Claude Code 写代码的全貌：

```
用户: "写一个 foo.py"
   │
   ▼
[Agent Loop 第 1 轮]  模型生成 tool_use { name:"Write", input:{ file_path, content:代码 } }
   │
   ▼
[工具分发]            findToolByName(tools, "Write") → 命中 fileWriteTool
   │
   ▼
[FileWriteTool.call]  expandPath → mkdir 父目录 → fs.writeFile 落盘
   │
   ▼
[回喂]                tool_result "文件已成功创建于：..." 塞回 messages
   │
   ▼
[Agent Loop 第 2 轮]  模型看到结果，或继续（Bash 验证 / Edit 修改），或输出最终回答
   │
   ▼
循环结束，纯文本回复
```

**一句话总结：模型的输出是「意图」，harness 的工具是「执行」。** 写代码 = 模型把代码装进 `content` 字段 + harness 把 `content` 写进文件。其余所有复杂度（循环、schema、路径转换、报错文案）都围绕一件事：**让这个「装进去再写出来」的过程更可靠、更可控。**

---

## 6. 一个值得注意的发现

读代码时发现：`fileWriteTool` 已经完整实现，但 **没有被注册进 `src/tools.ts`**——当前注册表只有 Bash / Read / Edit 三个工具：

```ts
// src/tools.ts（现状）
export const TOOLS: Tool[] = [bashTool, fileReadTool, fileEditTool];
//                            ↑ 缺 fileWriteTool
```

也就是说，`Write` 工具**代码在，但没上线**。要让上面测试 1/2/5 里的 Write 真正可用，只需补一行 import 和一行注册：

```ts
import { fileWriteTool } from './tools/FileWriteTool/FileWriteTool.js';

export const TOOLS: Tool[] = [bashTool, fileReadTool, fileEditTool, fileWriteTool];
```

这恰好也是本文想强调的架构优点最直观的注脚：**加一个工具，真的只加一行 handler**——只不过这一行还没加而已。（README 描述的目标里程碑里还规划了 Glob / Grep 两个搜索工具，当前 `src/tools` 目录里也尚未出现。）

---

## 7. 结语

Mini Claude Code 用极小的代码量还原了 Claude Code 的核心：**一条循环 + 一张注册表 + 四个工具**。

- **循环**（`query.ts`）负责「反复问模型、反复执行」；
- **注册表**（`tools.ts`）负责「模型要什么，就调什么」；
- **四个工具**（Bash / Read / Write / Edit）负责「读、写、改、跑」四种真实的系统能力。

而「写代码」这件事，本质上就是 `FileWriteTool.call()` 里那两行 `mkdir` + `writeFile`，加上一整套机制去保证模型能把**正确的代码字符串**喂到这两行上。理解了这一层，再看任何「AI 编程工具」，都不过是在这个骨架上的加减法。

Author: Cobyte

npm run dev -- '在D:\workspace\202608\mini-claude-code\nodejs 目录下创建一个简洁但功能丰富的 Vue3 TodoList 应用： 创建项目：echo y | pnpm create vite vue-todo-app --template vue-ts 修改 src/App.vue 和组件，实现以下功能： 任务增删改查：添加、删除、编辑（双击）、标记完成 分类筛选：全部 / 进行中 / 已完成统计信息：总任务、已完成、未完成数量 数据持久化：localStorage 自动保存与恢复 样式要求： 渐变背景（蓝到紫）卡片阴影、圆角、悬停效果 整洁美观的布局 动画要求： 任务添加/删除时有过渡动画（淡入淡出/缩放）使用 Vue 的 <TransitionGroup> 实现列表动画 项目结构简洁（例如包含 TodoItem.vue 等组件）完成后在 vue-todo-app 项目中执行： pnpm install 再执行 pnpm run dev'
