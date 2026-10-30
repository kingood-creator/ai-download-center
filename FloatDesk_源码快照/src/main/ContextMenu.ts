// 文本编辑右键菜单：只给输入框（能自己打字的地方）剪切/复制/粘贴。
// 设置页已全局禁止选中文字（拖滑杆不再误选说明文字），所以非输入区不再弹文本菜单。
// 注意：Electron 默认不提供右键菜单，必须自己挂 'context-menu'。
import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';
import { buildEditMenuSpec } from './appMenu';
import { log } from './Logging';

/** 需要在这些 role 之后插分隔线 */
const SEP_AFTER = new Set(['redo', 'paste']);

export function attachTextEditContextMenu(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.on('context-menu', (_e, params) => {
    try {
      const spec = buildEditMenuSpec(params.isEditable, params.selectionText || '', (params.editFlags || {}) as any);
      // 返回 null 表示这里不给文本菜单：圆点 / 菜单项有自己的业务菜单，
      // 非输入区（设置页的说明文字、日志、诊断）也一律不给（页面本身选不中文字）
      if (!spec) return;
      const template: MenuItemConstructorOptions[] = [];
      for (const s of spec) {
        template.push({ label: s.label, role: s.role as any, enabled: s.enabled });
        if (SEP_AFTER.has(s.role)) template.push({ type: 'separator' });
      }
      if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
    } catch (e: any) {
      log('右键菜单构建失败: ' + (e?.message || e));
    }
  });
}
