/**
 * 权限类型契约（对应真实源码 `src/types/permissions.ts`，已按 T6 最小化）。
 *
 * 真实里有 PermissionMode（acceptEdits / bypassPermissions / default / dontAsk / plan /
 * auto / bubble）、PermissionRule（带 source）、PermissionUpdate（持久化操作）、
 * 分类器（classifier）等一大堆。T6 只还原核心的三件：
 *   - PermissionMode：default / bypassPermissions；
 *   - PermissionDecision：allow / deny / ask 三种行为；
 *   - PermissionContext：权限检查所需的上下文（模式 + 工作区根目录）。
 */

export type PermissionMode = 'default' | 'bypassPermissions';

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

/** 权限决策（对应真实 PermissionDecision 的三态，去掉 passthrough） */
export type PermissionDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string }
  | { behavior: 'ask'; message: string };

/** 权限检查上下文 */
export type PermissionContext = {
  mode: PermissionMode;
  /** 工作区根目录（项目根），用于判断「工作区内 / 外」 */
  cwd: string;
};

/** 用户审批回调：返回 true=批准，false=拒绝 */
export type ApprovalHandler = (
  toolName: string,
  input: Record<string, unknown>,
  message: string,
) => Promise<boolean>;
