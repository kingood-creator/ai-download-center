import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMenuTemplate, buildEditMenuSpec } from '../main/appMenu';

const ctx = {
  scenes: [
    { id: 's1', name: '日常办公' },
    { id: 's2', name: '跨境电商' },
  ],
  currentSceneId: 's2',
  onOpenSettings: () => {},
  onToggleFloating: () => {},
  onSelectScene: () => {},
};

test('应用菜单包含带 role 的「编辑」子菜单（Cmd+C/V 生效的前提）', () => {
  const tpl = buildMenuTemplate(ctx) as any[];
  const edit = tpl.find((m) => m.label === '编辑');
  assert.ok(edit, '缺少「编辑」菜单');
  const roles = (edit.submenu as any[]).map((i) => i.role);
  for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']) {
    assert.ok(roles.includes(r), `缺少 role: ${r}`);
  }
});

test('场景子菜单反映当前选中并回传 id', () => {
  const picked: string[] = [];
  const tpl = buildMenuTemplate({ ...ctx, onSelectScene: (id) => picked.push(id) }) as any[];
  const scene = tpl.find((m) => m.label === '场景');
  const subs = scene.submenu as any[];
  assert.equal(subs.length, 2);
  assert.equal(subs.find((s) => s.checked).label, '跨境电商');
  subs[0].click();
  assert.deepEqual(picked, ['s1']);
});

test('顶层菜单顺序：应用 / 编辑 / 场景 / 窗口', () => {
  const labels = (buildMenuTemplate(ctx) as any[]).map((m) => m.label);
  assert.deepEqual(labels, ['FloatDesk', '编辑', '场景', '窗口']);
});

test('非输入框：一律不弹文本菜单（设置页已全局禁止选中，复制粘贴只留给输入框）', () => {
  assert.equal(buildEditMenuSpec(false, '', {}), null);
  assert.equal(buildEditMenuSpec(false, '   ', {}), null);
  // 就算渲染层有选中文字（例如日志区），也不再给「复制」：这类区域现在选不中，菜单点了也没用
  assert.equal(buildEditMenuSpec(false, '选中的一段文字', { canCopy: true }), null);
});

test('输入框：给出撤销/重做/剪切/复制/粘贴/全选', () => {
  const spec = buildEditMenuSpec(true, '', { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true });
  assert.ok(spec);
  assert.deepEqual(
    spec!.map((s) => s.role),
    ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']
  );
  // 不可用的项要禁用（例如刚打开时不能撤销）
  assert.equal(spec!.find((s) => s.role === 'redo')!.enabled, false);
  assert.equal(spec!.find((s) => s.role === 'undo')!.enabled, true);
});

test('输入框里没内容可粘贴时，「粘贴」禁用但仍然显示', () => {
  const spec = buildEditMenuSpec(true, '', { canPaste: false });
  assert.ok(spec);
  const paste = spec!.find((s) => s.role === 'paste');
  assert.ok(paste);
  assert.equal(paste!.enabled, false);
});
