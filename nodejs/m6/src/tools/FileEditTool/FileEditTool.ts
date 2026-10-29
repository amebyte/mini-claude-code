import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '../../Tool.js';
import { expandPath } from '../../utils/path.js';

/**
 * Edit 工具（对应真实源码 `src/tools/FileEditTool/FileEditTool.ts`）。
 *
 * 真实 Edit 用 diff 库生成结构化补丁，还做引号归一化（findActualString）、
 * 写前「文件是否被外部改动」校验。本小节只还原最核心的「精确字符串替换」逻辑：
 *   1. 统计 old_string 出现次数（file.split(old_string).length - 1）；
 *   2. 0 次 → 报「找不到」；>1 次且 !replace_all → 报「不唯一」；
 *   3. 否则 replace / replaceAll 后写盘。
 */
export const fileEditTool: Tool = {
  name: 'Edit',
  description: [
    '在文件中执行精确的字符串替换。',
    '用法：',
    '- 编辑前必须先使用 Read 工具读取该文件。',
    '- 从 Read 输出复制文本时，请保留行号前缀（右对齐的数字 + →）之后的精确缩进。',
    '- 如果 old_string 在文件中不唯一，编辑将会失败。请提供更多上下文使其唯一，或使用 replace_all。',
    '- 使用 replace_all 替换所有出现的位置（例如重命名变量）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要修改的文件的绝对路径' },
      old_string: { type: 'string', description: '要替换的文本' },
      new_string: { type: 'string', description: '替换后的文本（必须与 old_string 不同）' },
      replace_all: { type: 'boolean', description: '替换 old_string 的所有出现位置（默认为 false）' },
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
      return `读取文件 ${filePath} 时出错：${(e as Error).message}`;
    }

    // 精确匹配次数（对应真实 FileEditTool 的 matches 计算）。
    const matches = file.split(oldString).length - 1;
    if (matches === 0) {
      return `编辑失败：在文件中未找到 old_string。在 ${filePath} 中未找到精确文本。请重新读取文件并复制要替换的精确文本（包括缩进）。`;
    }
    if (matches > 1 && !replaceAll) {
      return `编辑失败：找到 ${matches} 处 old_string 匹配，但 replace_all 为 false。请将 replace_all 设为 true 以替换所有出现位置，或提供更多上下文使 old_string 唯一。`;
    }

    const updated = replaceAll
      ? file.replaceAll(oldString, newString)
      : file.replace(oldString, newString);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, updated, 'utf8');

    return `文件 ${filePath} 已成功更新。`;
  },
};
