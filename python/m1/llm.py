# LLM 和 OpenAI 接口快速入门
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
# 初始化客户端
client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"), # 身份验证凭证，确保你有权访问 API
    base_url="https://api.deepseek.com" # 将请求重定向到 DeepSeek 的服务器（而非 OpenAI）
)
# 构建聊天请求
response = client.chat.completions.create(
  model="deepseek-v4-pro", # 指定模型版本
  temperature=0.5,
  messages=[   # 对话消息数组
      {"role": "system", "content": "你是一个有帮助的助手。"},
      {"role": "user", "content": "你是谁？"}
  ]
)
# 参数 temperature 控制随机性（0~2，越低越确定）
# 在 OpenAI API 中，`messages` 数组中的每条消息都有一个 `role` 字段，
# 它定义了消息的来源和用途。
# 消息角色主要有四种：system、user、assistant、tool。
# 系统消息通常用于设置助手的行为或提供上下文，
# 用户消息是用户输入的内容，助手消息是模型生成的响应。

# 打印结果（结构化输出完整响应对象）
# print(json.dumps(response.model_dump(), indent=2, ensure_ascii=False))
print(response.choices[0].message.content.strip())