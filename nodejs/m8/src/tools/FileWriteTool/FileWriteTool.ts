import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '../../Tool.js';
import { expandPath } from '../../utils/path.js';

/**
 * Write 工具（对应真实源码 `src/tools/FileWriteTool/FileWriteTool.ts`）。
 *
 * 真实 Write 有「写前必须 Read」的校验、LSP/VSCode 通知、diff 补丁等。T4 只还原核心：
 * mkdir 父目录 + fs.writeFile，并区分「新建 / 覆盖」两种返回文案。
 */
export const fileWriteTool: Tool = {
  name: 'Write',
  description: [
    'Write a file to the local filesystem.',
    'Usage:',
    '- This tool will overwrite the existing file if there is one at the provided path.',
    '- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use Write for new files or complete rewrites.',
    '- file_path must be an absolute path.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'The absolute path to the file to write' },
      content: { type: 'string', description: 'The content to write to the file' },
    },
    required: ['file_path', 'content'],
  },
  async call(args) {
    const filePath = expandPath(String(args.file_path ?? ''));
    const content = String(args.content ?? '');

    // 判断是新建还是覆盖（真实通过 readFileState 与 mtime 判断，T4 简化成 access）。
    let existed = true;
    try {
      await access(filePath);
    } catch {
      existed = false;
    }

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');

    return existed
      ? `The file ${filePath} has been updated successfully.`
      : `File created successfully at: ${filePath}`;
  },
};
