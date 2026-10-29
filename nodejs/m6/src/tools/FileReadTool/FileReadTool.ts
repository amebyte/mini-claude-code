import { readFile } from 'node:fs/promises';
import type { Tool } from '../../Tool.js';
import { expandPath } from '../../utils/path.js';

// 对应真实源码 `src/tools/FileReadTool/prompt.ts` 的 MAX_LINES_TO_READ。
const MAX_LINES_TO_READ = 2000;

/**
 * 加 cat -n 风格的行号（对应真实源码 `src/utils/file.ts` 的 `addLineNumbers`）。
 * 默认格式：6 位右对齐行号 + `→`（U+2192）+ 行内容。模型据此剥离前缀做 Edit 的 old_string。
 */
function addLineNumbers(lines: string[], startLine: number): string {
  return lines
    .map((line, i) => {
      const numStr = String(i + startLine);
      return numStr.length >= 6 ? `${numStr}→${line}` : `${numStr.padStart(6, ' ')}→${line}`;
    })
    .join('\n');
}

/**
 * Read 工具（对应真实源码 `src/tools/FileReadTool/FileReadTool.ts`）。
 *
 * 真实 Read 支持图片 / PDF / notebook 等，并有 maxTokens / maxSizeBytes 两道上限。
 * 本小节只还原最核心：读文本文件 + offset/limit 分页 + cat -n 行号。
 */
export const fileReadTool: Tool = {
  name: 'Read',
  description: [
    '从本地文件系统读取文件。',
    '用法：',
    '- file_path 必须是绝对路径。',
    `- 默认从文件开头读取最多 ${MAX_LINES_TO_READ} 行；对于较大的文件，请使用 offset/limit。`,
    '- 以 cat -n 格式返回内容："     1→内容"（右对齐的行号 + →，然后是实际内容）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要读取的文件的绝对路径' },
      offset: { type: 'number', description: '开始读取的行号（默认为 1）' },
      limit: { type: 'number', description: '要读取的行数' },
    },
    required: ['file_path'],
  },
  async call(args) {
    const filePath = expandPath(String(args.file_path ?? ''));
    const offset = typeof args.offset === 'number' && args.offset >= 1 ? Math.floor(args.offset) : 1;
    const limit = typeof args.limit === 'number' ? Math.floor(args.limit) : undefined;

    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (e) {
      return `读取文件出错 ${filePath}: ${(e as Error).message}`;
    }

    const lines = content.split(/\r?\n/);
    // 去掉末尾因换行符产生的空行，避免多一行空行号。
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const start = offset - 1;
    const end = limit !== undefined ? Math.min(start + limit, lines.length) : lines.length;
    const selected = lines.slice(start, end);

    if (selected.length === 0) return '(空文件)';
    return addLineNumbers(selected, offset);
  },
};
