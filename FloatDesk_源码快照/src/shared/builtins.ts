// 内置动作（不依赖外部目标，由 FloatDesk 自己实现的功能）
// 这是权威列表：主进程据此校验与执行，设置页通过 builtins:actions 拿它渲染下拉，
// 避免渲染进程再复制一份常量后两边对不上。

export interface BuiltinAction {
  /** item.target 存这个值 */
  key: string;
  name: string;
  icon: string;
  /** 一句话说明，显示在设置页 */
  hint: string;
}

export const BUILTIN_ACTIONS: BuiltinAction[] = [
  {
    key: 'ime:switch',
    name: '切换中/英文输入法',
    icon: '⌨️',
    hint: '在中文输入法与英文键盘之间切换（走系统 TIS，不需要辅助功能权限）',
  },
  {
    key: 'note:open',
    name: '打开便签',
    icon: '📝',
    hint: '打开桌面便签，自动保存，多组彩色标签，每组可回看 30 版历史',
  },
];

export function findBuiltinAction(key: string): BuiltinAction | undefined {
  const k = String(key || '').trim();
  return BUILTIN_ACTIONS.find((a) => a.key === k);
}

export function isBuiltinActionKey(key: string): boolean {
  return !!findBuiltinAction(key);
}
