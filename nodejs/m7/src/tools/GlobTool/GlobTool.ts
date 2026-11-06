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
    'Fast file pattern matching tool that works with any codebase size.',
    'Supports glob patterns like "**/*.js" or "src/**/*.ts".',
    'Returns matching file paths.',
    'Use this tool when you need to find files by name patterns.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The glob pattern to match files against' },
      path: { type: 'string', description: 'The directory to search in (default: current working directory)' },
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

    if (result.length === 0) return 'No files found';
    return [
      ...result,
      ...(truncated
        ? ['(Results are truncated. Consider using a more specific path or pattern.)']
        : []),
    ].join('\n');
  },
};
