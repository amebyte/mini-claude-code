import { isAbsolute, relative, resolve } from 'node:path';
import type { Tool } from '../../Tool.js';
import { expandPath } from '../path.js';
import type {
  PermissionContext,
  PermissionDecision,
} from '../../types/permissions.js';

/**
 * 三道闸门权限检查（对应真实源码 `src/hooks/useCanUseTool.tsx` 的 canUseTool +
 * learn-claude-code s03_permission 的三道闸门模型）。
 *
 *   Gate 1 硬拒绝：危险命令 / 系统目录 —— 直接 deny，不问。
 *   Gate 2 规则匹配：潜在破坏性命令 / 写工作区外 —— 返回 ask，交 Gate 3。
 *   Gate 3 用户审批：ask 决策交给上层（REPL 弹 y/N，一次性模式无回调则拒绝）。
 *
 * 格言：*先划边界，再给自由*。Harness 层：**权限**。
 */

// Gate 1：危险命令硬拒绝清单（对应 Python s03 的 DENY_LIST）。
const DENY_LIST = [
  'rm -rf /',
  'sudo ',
  'shutdown',
  'reboot',
  'mkfs',
  'dd if=',
  '> /dev/sd',
  ':(){',
  'chmod -R 777 /',
];

// Gate 2：潜在破坏性命令（触发用户审批）。
const DESTRUCTIVE_PATTERNS = [
  'rm ',
  '> ',
  '>> ',
  'chmod 777',
  'git push --force',
  'git reset --hard',
  'mv ',
];

// Gate 1：受保护的系统目录（写入即「越界」硬拒绝）。POSIX + Windows 两种写法都覆盖。
const SYSTEM_DIR_PREFIXES = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/root',
  '/opt',
  '/lib',
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
];

function normalizeForCompare(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** 判断路径是否落在给定目录前缀下（含前缀本身）。 */
function hasPathPrefix(p: string, prefix: string): boolean {
  const np = normalizeForCompare(p);
  const nprefix = normalizeForCompare(prefix);
  return np === nprefix || np.startsWith(nprefix + '/');
}

function isSystemDir(p: string): boolean {
  return SYSTEM_DIR_PREFIXES.some(prefix => hasPathPrefix(p, prefix));
}

/** 判断 target 是否位于 dir 目录之内（含 dir 本身）。 */
function isUnderPath(target: string, dir: string): boolean {
  const rel = relative(resolve(dir), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * 权限检查主入口。返回 allow / deny / ask 三态之一。
 */
export function checkPermission(
  tool: Tool,
  input: Record<string, unknown>,
  ctx: PermissionContext,
): PermissionDecision {
  // bypassPermissions 模式：跳过所有检查。
  if (ctx.mode === 'bypassPermissions') {
    return { behavior: 'allow' };
  }

  // 只读工具（Read / Glob / Grep）永远放行。
  if (tool.isReadOnly) {
    return { behavior: 'allow' };
  }

  // Bash：检查命令。
  if (tool.name === 'Bash') {
    const command = String(input.command ?? '');

    // Gate 1：硬拒绝。
    for (const pattern of DENY_LIST) {
      if (command.includes(pattern)) {
        return { behavior: 'deny', message: `命令含禁止项 "${pattern}"，已硬拒绝` };
      }
    }

    // Gate 2：破坏性命令 → ask。
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (command.includes(pattern)) {
        return { behavior: 'ask', message: `潜在破坏性命令：${command}` };
      }
    }

    return { behavior: 'allow' };
  }

  // Write / Edit：检查文件路径。
  const rawPath = typeof input.file_path === 'string' ? input.file_path : '';
  if (!rawPath) return { behavior: 'allow' };

  // Gate 1：系统目录（检查原始路径，避免 expandPath 把 /etc 转成别的）。
  if (isSystemDir(rawPath)) {
    return { behavior: 'deny', message: `禁止写入系统目录（越界）：${rawPath}` };
  }

  // Gate 2：工作区之外 → ask。
  const resolved = expandPath(rawPath);
  if (!isUnderPath(resolved, ctx.cwd)) {
    return { behavior: 'ask', message: `写入工作区之外：${resolved}` };
  }

  // 工作区内 → 放行。
  return { behavior: 'allow' };
}
