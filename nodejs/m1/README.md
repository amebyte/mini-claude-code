# m0 — LLM 应用快速入门示例（Node.js）

一个最简示例，使用 `@anthropic-ai/sdk` 调用 DeepSeek 的 Anthropic 兼容端点，演示如何发起一次聊天请求并打印回复。对应 `python/m0` 的 Node.js 版本。

## 环境要求

- Node.js 18+（推荐 20+）
- 一个 DeepSeek API Key（在 [DeepSeek 开放平台](https://platform.deepseek.com/) 申请）

## 启动步骤

### 1. 安装依赖

在 `nodejs/m0` 目录下执行：

```bash
npm install
```

### 2. 配置 API Key

在 `nodejs/m0` 目录下创建 `.env` 文件，内容如下：

```
DEEPSEEK_API_KEY=你的 API Key
```

### 3. 运行

```bash
npm run dev          # 开发直跑（tsx，不编译）
# 或先编译再运行
npm run build        # tsc 编译到 dist/
npm start            # node dist/index.js
```

运行成功后会打印模型的回复，例如「我是 DeepSeek，由深度求索公司创造的 AI 助手」。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `src/index.ts` | 主程序：初始化客户端并发起一次对话请求 |
| `package.json` | 依赖清单与脚本（对应 `requirements.txt`） |
| `tsconfig.json` | TypeScript 配置（NodeNext ESM） |
| `.env` | 存放 `DEEPSEEK_API_KEY` 等敏感配置（勿提交到版本库） |

## 与 `python/m0` 的差异

| 项 | `python/m0` | `nodejs/m0` |
| --- | --- | --- |
| SDK | `openai`（OpenAI 兼容接口） | `@anthropic-ai/sdk`（Anthropic 兼容接口） |
| 端点 | `https://api.deepseek.com` | `https://api.deepseek.com/anthropic` |
| 依赖清单 | `requirements.txt` | `package.json` |
