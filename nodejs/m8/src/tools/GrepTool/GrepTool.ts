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
  isReadOnly: true,
  description: [
    'A powerful search tool built on ripgrep.',
    'Supports full regex syntax (e.g. "log.*Error").',
    'Filter files with the glob parameter (e.g. "*.js", "*.{ts,tsx}").',
    'Output modes: "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The regular expression pattern to search for' },
      path: { type: 'string', description: 'File or directory to search in (default: current working directory)' },
      glob: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")' },
      output_mode: { type: 'string', description: 'content | files_with_matches | count (default: files_with_matches)' },
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
      return `Invalid regex pattern: ${(e as Error).message}`;
    }

    let isDir = true;
    try {
      isDir = (await stat(searchPath)).isDirectory();
    } catch (e) {
      return `Error: path not found: ${searchPath} (${(e as Error).message})`;
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

    if (results.length === 0) return 'No matches found';
    const truncated = results.length > MAX_RESULTS;
    return [
      ...results.slice(0, MAX_RESULTS),
      ...(truncated
        ? [`(Results truncated to ${MAX_RESULTS}. Use a more specific pattern or glob.)`]
        : []),
    ].join('\n');
  },
};
