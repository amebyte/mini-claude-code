import { createServer } from 'node:http';
// 端口
const PORT = 9527;
const HOST = '127.0.0.1';

// 内存数据：先用一条示例数据，POST 新增后也会追加到这里
const dataList = [{ id: 1, name: '示例数据' }];

const server = createServer(async (req, res) => {
  const { method, url } = req;
  // url 里可能带查询串（GET 分支要读它），统一解析出 pathname 和 searchParams
  const { pathname, searchParams } = new URL(url, `http://${HOST}:${PORT}`);

  // ============ GET /detail?id=xxx：根据 id 获取详情 ============
  if (method === 'GET' && pathname === '/detail') {
    const id = Number(searchParams.get('id'));
    const item = dataList.find((v) => v.id === id);
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, data: item }));
    return;
  }
});
// ============ 启动 ============
server.listen(PORT, HOST, () => {
  console.log('本地 Node.js 服务器已经启动，监听地址：', `http://${HOST}:${PORT}`);
});
