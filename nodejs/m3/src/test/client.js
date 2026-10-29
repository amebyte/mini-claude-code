const BASE_URL = 'http://localhost:9527'; // 本地模拟服务器
const API_KEY =  'local-dev'; // 本地服务器不校验 key，随便填一个
const MODEL = 'deepseek-v4-pro';
const PROMPT = '用一句话解释什么是流式输出';

const url = `${BASE_URL}/v1/messages`;

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: PROMPT }],
    stream: false, // 这里测试非流式分支
  }),
});

if (!response.ok) {
  const errText = await response.text();
  console.error(`HTTP ${response.status}: ${errText}`);
  process.exit(1);
}

const data = await response.json();
console.log('返回的数据:', data);
