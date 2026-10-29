import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '../../Tool.js';
import { expandPath } from '../../utils/path.js';

/**
 * Write 工具（对应真实源码 `src/tools/FileWriteTool/FileWriteTool.ts`）。
 *
 * 真实 Write 有「写前必须 Read」的校验、LSP/VSCode 通知、diff 补丁等。本小节只还原核心：
 * mkdir 父目录 + fs.writeFile，并区分「新建 / 覆盖」两种返回文案。
 */
export const fileWriteTool: Tool = {
  name: 'Write',
  description: [
    '将文件写入本地文件系统。',
    '用法：',
    '- 如果提供的路径上已存在文件，此工具将覆盖该文件。',
    '- 修改已有文件时优先使用 Edit 工具——它只发送差异。仅在新建文件或完全重写时才使用 Write。',
    '- file_path 必须是绝对路径。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要写入文件的绝对路径' },
      content: { type: 'string', description: '要写入文件的内容' },
    },
    required: ['file_path', 'content'],
  },
  async call(args) {
    const filePath = expandPath(String(args.file_path ?? ''));
    const content = String(args.content ?? '');

    // 判断是新建还是覆盖（真实通过 readFileState 与 mtime 判断，本小节简化成 access）。
    let existed = true;
    try {
      await access(filePath);
    } catch {
      existed = false;
    }

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');

    return existed
      ? `文件 ${filePath} 已成功更新。`
      : `文件已成功创建于：${filePath}`;
  },
};
