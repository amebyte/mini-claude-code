# 实现Claude Code 流式输出

> 从上一小节实现的功能出发，看怎么让 AI 的回复像打字机一样，一个字一个字蹦出来的。

### 1 环境准备：加两个依赖

先看 `package.json` 的变化。上一版的生产依赖只有 `commander` 一个依赖，这一版多了两个：

```diff
 {
-  "name": "claude-code-m01",
-  "version": "0.1.0",
+  "name": "claude-code-m02",
+  "version": "0.2.0",
   "type": "module",
-  "description": "Claude Code 源码最小还原实现 · T0.1 项目骨架（--version / --help）",
+  "description": "Claude Code 源码最小还原实现 · T0.2 单轮对话（流式输出）",
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
+    "@anthropic-ai/sdk": "^0.120.0",
     "commander": "^15.0.0",
+    "dotenv": "^17.4.2"
   }
 }
```



### 2 客户端：`getAnthropicClient`

新增 `src/services/api/client.ts`，负责「创建 一个能发请求的客户端」：

```ts
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * 构造 Anthropic 客户端。真实 Claude Code 直连 Anthropic 官方端点；
 * 本仓库为了能在本地真实跑通，把 baseURL 指向 DeepSeek 的 Anthropic 兼容端点，
 * 读 DEEPSEEK_API_KEY。SDK 仍是 @anthropic-ai/sdk（Anthropic Messages 协议不变），
 * 只是换了后端。
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY，请在 .env 中配置（参考 .env.example）');
  }
  return new Anthropic({
    apiKey,
    // DeepSeek 的 Anthropic 兼容端点；换回官方 Anthropic 时删除此行、改用 ANTHROPIC_API_KEY 即可。
    baseURL: 'https://api.deepseek.com/anthropic',
  });
}
```

配套的 `.env` 长这样：

```
DEEPSEEK_API_KEY=sk-你的key
MODEL_ID=deepseek-v4-pro
```

`DEEPSEEK_API_KEY` 必填，`MODEL_ID` 可选（不写就默认 `deepseek-v4-pro`）。

### 3 流式调用：`streamMessage`（核心）

新增 `src/services/api/claude.ts`。整小节的灵魂，全在这十几行里：

```ts
import { getAnthropicClient } from './client.js';

/**
 * 单轮对话：发一条消息，逐 token 流式打印回复。
 * 对应真实源码的流式调用：messages.create({ ...params, stream: true }) + for await。
 * 只做「一句话 → 流式打印」，不含工具调用循环（那属于后面的 Agent Loop）。
 */
export async function streamMessage(prompt: string): Promise<void> {
  const client = getAnthropicClient();
  const model = process.env.MODEL_ID ?? 'deepseek-v4-pro';

  const stream = await client.messages.create({
    model,
    // 真实代码有复杂的 token 预算管理，先用固定上限占位。
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
    stream: true,   // ← 关键：告诉服务端「边生成边推」
  });

  for await (const event of stream) {
    // 事件类型有很多种：——`message_start`、`content_block_start`、`content_block_delta`、`message_stop`……
    // delta.type 的类型有： thinking_delta text_delta
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      process.stdout.write(event.delta.text);   // 逐字打印，不加换行
    }
  }
  process.stdout.write('\n');   // 全部打印完，补一个换行
}
```


### 4 接入 CLI：`main.ts` 的 `.action()`

有了 `streamMessage`，最后一步就是把 `main.ts` 里那个「未实现」的分支，换成真正的调用：

```diff
 import { Command } from 'commander';
+import { streamMessage } from './services/api/claude.js';

 export async function main(): Promise<void> {
   const program = new Command();

   program
     .name('claude')
-    .description('Claude Code 源码最小还原实现（T0.1 项目骨架）')
-    .argument('[prompt]', '给 agent 的提示词（T0.2 单轮对话才实现，本里程碑忽略）', String)
+    .description('Claude Code 源码最小还原实现（T0.2 单轮对话）')
+    .argument('[prompt]', '给 agent 的提示词（流式打印回复）', String)
     .version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')
     .helpOption('-h, --help', 'Display help for command')
     .action(async (prompt: string | undefined) => {
-      // T0.1：prompt 与交互式 REPL 都还没实现，统一提示后返回非零退出码。
-      if (prompt !== undefined) {
-        console.error(`[未实现] 收到 prompt：${prompt}（T0.2 单轮对话才实现）`);
-      } else {
-        console.error('[未实现] 交互式 REPL 尚未实现（T2.2）');
-      }
-      process.exitCode = 1;
+      // 裸启动（无 prompt）：交互式 REPL 属于 T2.2，本里程碑仍未实现。
+      if (prompt === undefined) {
+        console.error('[未实现] 交互式 REPL 尚未实现（T2.2）');
+        process.exitCode = 1;
+        return;
+      }
+
+      // 单轮对话：发一条消息，流式打印回复。
+      try {
+        await streamMessage(prompt);
+      } catch (err) {
+        const message = err instanceof Error ? err.message : String(err);
+        console.error(`[错误] ${message}`);
+        process.exitCode = 1;
+      }
     });

   await program.parseAsync(process.argv);
 }
```

### 5. 测试 / 演示

在 `nodejs/m1` 目录下，先装依赖、配好 Key：

```bash
npm install
cp .env.example .env   # 然后把 .env 里的 DEEPSEEK_API_KEY 填成你自己的
```

然后跑一句对话：

```bash
$ npm run dev -- "写一首三行诗"
$ npm run dev -- "为什么要实现流式输出"
```

你会看到终端里的字，不是一次性整段糊上来，而是**一个接一个地蹦出来**（截取最终效果）：

```
月亮
是夜空独白的一行
轻轻落在湖心
```

从结果可以看出：`streamMessage` 把模型吐出的几十条 `thinking_delta`（思考过程）全部过滤掉了，只把 `text_delta` 里那些真正的正文，一个 `process.stdout.write` 接着一个，逐字写到了终端。

顺便验证一下，上一版的 fast-path 依然健在：

```bash
$ npm run dev -- --version
0.2.0 (Claude Code)
```

版本号升到了 `0.2.0`，而它走的依然是那条「零加载」的快路径——因为 `dotenv` 和 SDK 都被隔离在 API 层，`--version` 从头到尾都没碰过它们。


我是 Cobyte，欢迎添加 v: icobyte，学习交流 AI 全栈。
