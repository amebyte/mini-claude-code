import fg from 'fast-glob';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from '../../Tool.js';
import { expandPath } from '../../utils/path.js';

// 对应真实 GrepTool 的 DEFAULT_HEAD_LIMIT = 250。
const MAX_RESULTS = 250;

/**
 * Grep 工具（对应真实源码 `src/tools/GrepTool/GrepTool.ts`）。
 *
 * 真实用 ripgrep（`rg` 二进制）实现，支持 -A/-B/-C 上下文、-i 忽略大小写、type 过滤、
 * multiline 等一大堆 flag。T4 用 Node fs + 正则等价实现最核心的三种 output_mode：
 *   - files_with_matches（默认）：返回含匹配的文件路径；
 *   - content：返回 `<文件>:<行号>: <内容>`；
 *   - count：返回 `<文件>: <匹配行数>`。
 */
export const grepTool: Tool = {
  name: 'Grep',
  description: [
    '基于 ripgrep 的强大搜索工具。',
    '支持完整的正则表达式语法（例如 "log.*Error"）。',
    '可通过 glob 参数过滤文件（例如 "*.js"、"*.{ts,tsx}"）。',
    '输出模式："content" 显示匹配行，"files_with_matches" 显示文件路径（默认），"count" 显示匹配数量。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '要搜索的正则表达式模式' },
      path: { type: 'string', description: '要搜索的文件或目录（默认：当前工作目录）' },
      glob: { type: 'string', description: '用于过滤文件的 glob 模式（例如 "*.js"、"*.{ts,tsx}"）' },
      output_mode: { type: 'string', description: 'content | files_with_matches | count（默认：files_with_matches）' },
    },
    required: ['pattern'],
  },
  async call(args) {
    const pattern = String(args.pattern ?? '');
    const searchPath = args.path ? expandPath(String(args.path)) : process.cwd();
    const glob = args.glob ? String(args.glob) : '**/*';
    const outputMode =
      args.output_mode === 'content' || args.output_mode === 'count'
        ? args.output_mode
        : 'files_with_matches';

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (e) {
      return `正则表达式无效：${(e as Error).message}`;
    }

    let isDir = true;
    try {
      isDir = (await stat(searchPath)).isDirectory();
    } catch (e) {
      return `错误：路径未找到：${searchPath}（${(e as Error).message}）`;
    }

    const files: string[] = isDir
      ? await fg(glob, {
          cwd: searchPath,
          dot: true,
          onlyFiles: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      : [searchPath];

    const results: string[] = [];
    for (const relPath of files) {
      const fullPath = isDir ? join(searchPath, relPath) : relPath;
      let content: string;
      try {
        content = await readFile(fullPath, 'utf8');
      } catch {
        continue; // 读不了就跳过
      }
      if (content.includes('\0')) continue; // 二进制文件

      const lines = content.split(/\r?\n/);
      let matchCount = 0;
      const contentLines: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matchCount++;
          if (outputMode === 'content') {
            contentLines.push(`${relPath}:${i + 1}: ${lines[i]}`);
          }
        }
      }

      if (matchCount === 0) continue;
      if (outputMode === 'files_with_matches') results.push(relPath);
      else if (outputMode === 'count') results.push(`${relPath}: ${matchCount}`);
      else results.push(...contentLines);
    }

    if (results.length === 0) return '未找到匹配项';
    const truncated = results.length > MAX_RESULTS;
    return [
      ...results.slice(0, MAX_RESULTS),
      ...(truncated
        ? [`（结果已截断至 ${MAX_RESULTS} 条，请使用更具体的模式或 glob。）`]
        : []),
    ].join('\n');
  },
};
