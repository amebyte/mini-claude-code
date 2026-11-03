import fg from 'fast-glob';
import type { Tool } from '../../Tool.js';
import { expandPath } from '../../utils/path.js';

// 对应真实 GlobTool 的 globLimits.maxResults 默认 100。
const MAX_RESULTS = 100;

/**
 * Glob 工具（对应真实源码 `src/tools/GlobTool/GlobTool.ts`）。
 *
 * 真实用 ripgrep `--files --glob --sort=modified` 实现（按修改时间排序、内存友好）。
 * T4 用 fast-glob 等价实现（按名字排序，语义一致），忽略 node_modules/.git。
 */
export const globTool: Tool = {
  name: 'Glob',
  description: [
    '快速的文件模式匹配工具，适用于任意规模的代码库。',
    '支持诸如 "**/*.js" 或 "src/**/*.ts" 的 glob 模式。',
    '返回匹配到的文件路径。',
    '当你需要按名称模式查找文件时使用此工具。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '用于匹配文件的 glob 模式' },
      path: { type: 'string', description: '要搜索的目录（默认：当前工作目录）' },
    },
    required: ['pattern'],
  },
  async call(args) {
    const pattern = String(args.pattern ?? '');
    const cwd = args.path ? expandPath(String(args.path)) : process.cwd();

    const files = await fg(pattern, {
      cwd,
      dot: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    files.sort();
    const truncated = files.length > MAX_RESULTS;
    const result = files.slice(0, MAX_RESULTS);

    if (result.length === 0) return '未找到任何文件';
    return [
      ...result,
      ...(truncated
        ? ['(结果已被截断，请使用更具体的路径或模式。)']
        : []),
    ].join('\n');
  },
};
