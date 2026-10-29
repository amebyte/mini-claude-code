import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * 路径归一化（对应真实源码 `src/utils/path.ts` 的 `expandPath`）。
 *
 * 真实做四件事：`~` 展开、Windows 上 POSIX/MSYS 风格路径转 Windows 格式、相对路径
 * 相对 cwd 解析、NFC Unicode 归一化。T4 只还原前两件 + 相对路径解析：
 *
 *   - `~` / `~/foo` → 家目录；
 *   - Windows 上 `/c/Users/...`（git-bash/MSYS 的盘符写法）→ `C:/Users/...`（Node fs 原生路径）。
 *     这正是踩过的坑：Bash 工具里 `pwd` 返回 `/d/...`，但 Node 的 fs.readFile 只认 `D:\...`，
 *     不转换会导致 Read/Write/Edit 读不到文件（模型被迫多试一次）。
 */
export function expandPath(path: string): string {
  const p = path.trim();

  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));

  let processed = p;
  // Windows：/c/Users/... → C:/Users/...（真实对应 posixPathToWindowsPath）。
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(processed)) {
    processed = `${processed[1].toUpperCase()}:${processed.slice(2)}`;
  }

  if (isAbsolute(processed)) return processed;
  return resolve(process.cwd(), processed);
}
