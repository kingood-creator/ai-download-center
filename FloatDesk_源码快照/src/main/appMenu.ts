// 应用菜单模板（纯数据，不 import 运行时 electron，方便单元测试）
import type { MenuItemConstructorOptions } from 'electron';

export interface MenuContext {
  scenes: { id: string; name: string }[];
  currentSceneId: string;
  onOpenSettings: () => void;
  onToggleFloating: () => void;
  onSelectScene: (id: string) => void;
}

/**
 * macOS 上「Cmd+C / Cmd+V / Cmd+A」等标准编辑快捷键，只有在应用菜单存在
 * 带 role 的「编辑」子菜单时才会生效。缺了它，所有输入框都只能靠鼠标右键。
 * 这里显式补齐，别再删。
 */
export function buildMenuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
  return [
    {
      label: 'FloatDesk',
      submenu: [
        { label: '打开设置…', accelerator: 'Command+,', click: () => ctx.onOpenSettings() },
        { label: '唤出 / 隐藏悬浮台', click: () => ctx.onToggleFloating() },
        { type: 'separator' },
        { label: '隐藏 FloatDesk', role: 'hide' },
        { label: '隐藏其他', role: 'hideOthers' },
        { type: 'separator' },
        { label: '退出 FloatDesk', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' },
        { label: '删除', role: 'delete' },
        { type: 'separator' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '场景',
      submenu: ctx.scenes.map((s) => ({
        label: s.name,
        type: 'checkbox' as const,
        checked: s.id === ctx.currentSceneId,
        click: () => ctx.onSelectScene(s.id),
      })),
    },
    {
      label: '窗口',
      submenu: [{ label: '最小化', role: 'minimize' }, { label: '缩放', role: 'zoom' }, { label: '关闭', role: 'close' }],
    },
  ];
}

/** 文本编辑右键菜单需要的动作集合（供主进程构建原生菜单用） */
export type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'delete' | 'selectAll';

export interface EditFlags {
  canUndo?: boolean;
  canRedo?: boolean;
  canCut?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canDelete?: boolean;
  canSelectAll?: boolean;
}

/**
 * 根据右键位置的能力，算出该显示哪些菜单项。
 * 纯函数，单测覆盖；返回 null 表示「这里不需要文本菜单」。
 *
 * 只有「能自己打字进去的地方」（输入框 / 文本域 / contenteditable）才给复制粘贴：
 * 设置页整体关掉了文字选中（拖滑杆时不会把说明文字一起选上），
 * 非输入区域的右键不该再冒出「复制」这种点了也没用的项。
 */
export function buildEditMenuSpec(
  isEditable: boolean,
  selectionText: string,
  flags: EditFlags
): { label: string; role: EditAction; enabled: boolean }[] | null {
  if (!isEditable) return null;

  const spec: { label: string; role: EditAction; enabled: boolean }[] = [];
  const push = (label: string, role: EditAction, enabled?: boolean): void => {
    spec.push({ label, role, enabled: enabled !== false });
  };
  push('撤销', 'undo', flags.canUndo);
  push('重做', 'redo', flags.canRedo);
  push('剪切', 'cut', flags.canCut);
  push('复制', 'copy', flags.canCopy);
  push('粘贴', 'paste', flags.canPaste);
  push('全选', 'selectAll', flags.canSelectAll);
  return spec;
}
