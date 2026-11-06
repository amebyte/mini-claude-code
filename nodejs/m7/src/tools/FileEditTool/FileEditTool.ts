import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '../../Tool.js';
import { expandPath } from '../../utils/path.js';

/**
 * Edit 工具（对应真实源码 `src/tools/FileEditTool/FileEditTool.ts`）。
 *
 * 真实 Edit 用 diff 库生成结构化补丁，还做引号归一化（findActualString）、
 * 写前「文件是否被外部改动」校验。T4 只还原最核心的「精确字符串替换」逻辑：
 *   1. 统计 old_string 出现次数（file.split(old_string).length - 1）；
 *   2. 0 次 → 报「找不到」；>1 次且 !replace_all → 报「不唯一」；
 *   3. 否则 replace / replaceAll 后写盘。
 */
export const fileEditTool: Tool = {
  name: 'Edit',
  description: [
    'Performs exact string replacements in files.',
    'Usage:',
    '- You must use the Read tool to read the file before editing.',
    '- When copying text from Read output, preserve the exact indentation as it appears AFTER the line number prefix (right-aligned number + →).',
    '- The edit will FAIL if old_string is not unique in the file. Provide more surrounding context to make it unique, or use replace_all.',
    '- Use replace_all to change every occurrence (e.g. renaming a variable).',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'The absolute path to the file to modify' },
      old_string: { type: 'string', description: 'The text to replace' },
      new_string: { type: 'string', description: 'The text to replace it with (must be different from old_string)' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences of old_string (default false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async call(args) {
    const filePath = expandPath(String(args.file_path ?? ''));
    const oldString = String(args.old_string ?? '');
    const newString = String(args.new_string ?? '');
    const replaceAll = args.replace_all === true;

    let file: string;
    try {
      file = await readFile(filePath, 'utf8');
    } catch (e) {
      return `Error reading file ${filePath}: ${(e as Error).message}`;
    }

    // 精确匹配次数（对应真实 FileEditTool 的 matches 计算）。
    const matches = file.split(oldString).length - 1;
    if (matches === 0) {
      return `Edit failed: old_string not found in file. The exact text was not found in ${filePath}. Read the file again and copy the exact text (including indentation) to replace.`;
    }
    if (matches > 1 && !replaceAll) {
      return `Edit failed: found ${matches} matches of old_string, but replace_all is false. Set replace_all to true to replace all occurrences, or provide more surrounding context to make old_string unique.`;
    }

    const updated = replaceAll
      ? file.replaceAll(oldString, newString)
      : file.replace(oldString, newString);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, updated, 'utf8');

    return `The file ${filePath} has been updated successfully.`;
  },
};
