import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# 加载环境变量（如 DEEPSEEK_API_KEY）
load_dotenv()

# ---------- 工具定义 ----------
tools = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取文本文件内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "要读取的文件路径"},
                    "encoding": {"type": "string", "enum": ["utf-8", "gbk"], "description": "文件编码格式"}
                },
                "required": ["path"]
            }
        }
    }
]

# ---------- 工具实现 ----------
class ReadFileTool:
    def execute(self, path: str, encoding: str = "utf-8") -> str:
        try:
            file_path = Path(path).expanduser()
            if not file_path.exists():
                return f"文件不存在: {path}"
            return file_path.read_text(encoding=encoding)
        except Exception as e:
            return f"读取失败: {str(e)}"

file_tool = ReadFileTool()

# ---------- 初始化客户端 ----------
client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com"
)

# ---------- 构建对话 ----------
messages = [
    {"role": "system", "content": "你是一个文件读取助手，必要时可以调用工具帮助用户读取文件内容。"}
]
# user_input = "帮我读一下 file.txt"
user_input = "请帮我读取 step1.txt 文件，并严格按照文件中的线索一步步寻找，直到拼凑出最终的完整密码告诉我。"
# user_input = "工具执行结果：线索2：做得好！密码的前半部分是 'Agent'，请继续读取 step3.txt 获取后半部分。"
messages.append({"role": "user", "content": user_input})
print(f"用户: {user_input}\n")

def agent_loop(messages):
    while True:    
        # 第一步：请求模型判断是否调用工具
        response = client.chat.completions.create(
            model="deepseek-v4-pro",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )
        # print(json.dumps(response.model_dump(), indent=2, ensure_ascii=False))
        msg = response.choices[0].message
        messages.append(msg.model_dump())

        # 第二步：处理工具调用
        if msg.tool_calls:
            for tool_call in msg.tool_calls:
                if tool_call.function.name == "read_file":
                    args = json.loads(tool_call.function.arguments)
                    result = file_tool.execute(**args)
                    print(f"调用工具: {tool_call.function.name}, 参数: {args}")
                    print(f"工具执行结果:\n{result}\n")
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result
                    })
        else:
            print(f"助手: {msg.content}")
            return msg.content

result = agent_loop(messages)
print(f"最终结果: {result}")