import type { Tool } from './Tool.js';
import { bashTool } from './tools/BashTool/BashTool.js';
import { fileReadTool } from './tools/FileReadTool/FileReadTool.js';
import { fileEditTool } from './tools/FileEditTool/FileEditTool.js';
import { fileWriteTool } from './tools/FileWriteTool/FileWriteTool.js';

/**
 * 工具注册表（对应真实源码 `src/tools.ts` 的工具分发）。
 *
 * 加一个工具，只加一个 handler。Harness 层：**工具分发**。
 * 每加一个工具，只需在这里登记进 TOOLS 数组——循环（query.ts）里的
 * `findToolByName(tools, block.name)` 查表分发，一行都不用改。
 */
export const TOOLS: Tool[] = [
  bashTool,
  fileReadTool,
  fileEditTool,
  fileWriteTool,
];
