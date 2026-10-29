# m0 — LLM 应用快速入门示例

一个最简示例，使用 OpenAI SDK 调用 DeepSeek 的对话接口，演示如何发起一次聊天请求并打印回复。

## 环境要求

- Python 3.8+
- 一个 DeepSeek API Key（在 [DeepSeek 开放平台](https://platform.deepseek.com/) 申请）

## 启动步骤

### 1. 安装依赖

在 `python/m0` 目录下执行：

```bash
pip install -r requirements.txt
```

### 2. 配置 API Key

在 `python/m0` 目录下创建 `.env` 文件，内容如下：

```
DEEPSEEK_API_KEY=你的 API Key
```

### 3. 运行

```bash
python llm.py
```

运行成功后会打印模型的回复，例如「我是 DeepSeek，由深度求索公司创造的 AI 助手」。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `llm.py` | 主程序：初始化客户端并发起一次对话请求 |
| `requirements.txt` | Python 依赖清单 |
| `.env` | 存放 `DEEPSEEK_API_KEY` 等敏感配置（勿提交到版本库） |


注意：
Anthropic Messages API 和 OpenAI Chat Completions API 在工具调用协议上的一个核心差异——两种 API 用了完全不同的消息结构来表示"工具返回结果"。

OpenAI 的写法：

```js
messages.push({ role: 'assistant', content: null, tool_calls: [...] });
// 工具执行完后，用一个独立的 tool 角色回填结果
messages.push({ role: 'tool', tool_call_id: '...', content: result });
```

Anthropic 的写法（工具结果作为 user 消息里的一个 block）：
```js
messages.push({
  role: 'assistant',
  content: [
    { type: 'tool_use', id: '...', name: 'read_file', input: {...} },
  ],
});
// 工具结果没有独立的 role，而是作为 user 消息的一个 tool_result block
messages.push({
  role: 'user',
  content: [
    { type: 'tool_result', tool_use_id: '...', content: result },
  ],
});
```