import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultConfig } from '../shared/defaults';

test('默认生成 4 个场景且含默认场景', () => {
  const cfg = buildDefaultConfig();
  assert.equal(cfg.scenes.length, 4);
  assert.ok(cfg.scenes.some((s) => s.isDefault), '应有一个默认场景');
  assert.ok(cfg.scenes.every((s) => s.items.length > 0), '每个场景应有项目');
});

test('schemaVersion 为 1', () => {
  assert.equal(buildDefaultConfig().schemaVersion, 1);
});

test('默认配置带上输入法与便签两节', () => {
  const cfg = buildDefaultConfig();
  assert.ok(cfg.inputMethod, '应含 inputMethod');
  assert.equal(cfg.inputMethod!.chineseId, null);
  assert.equal(cfg.inputMethod!.englishId, null);
  assert.ok(cfg.note, '应含 note');
  assert.equal(cfg.note!.color, '#fff6c9');
  assert.equal(cfg.note!.opacity, 1);
  // 便签带格式工具栏，默认尺寸要够高才放得下正文
  assert.equal(cfg.note!.width, 340);
  assert.equal(cfg.note!.height, 320);
});

test('每个场景都有可用的双色渐变', () => {
  const cfg = buildDefaultConfig();
  for (const s of cfg.scenes) {
    assert.match(s.themeColor, /^#[0-9a-f]{6}$/, `${s.name} themeColor`);
    assert.match(s.gradientColor, /^#[0-9a-f]{6}$/, `${s.name} gradientColor`);
    assert.equal(s.gradientAngle, 145, `${s.name} gradientAngle`);
    assert.notEqual(s.gradientColor, s.themeColor, `${s.name} 应有渐变（两色不同）`);
  }
  // 默认场景是蓝 → 紫，就是最初设计稿那颗圆点
  const def = cfg.scenes.find((s) => s.isDefault)!;
  assert.equal(def.themeColor, '#3b82f6');
  assert.equal(def.gradientColor, '#7c3aed');
});

test('默认场景全部启用（场景库里默认没有停用场景）', () => {
  const cfg = buildDefaultConfig();
  for (const s of cfg.scenes) {
    assert.equal(s.enabled, true, `${s.name} 默认应启用`);
  }
});

test('Scene 可以显式建成停用状态（数据照旧）', () => {
  const cfg = buildDefaultConfig();
  const s = cfg.scenes[1];
  s.enabled = false;
  assert.equal(s.enabled, false);
  assert.ok(s.items.length > 0, '停用不该动 items');
});

test('场景与项目 id 唯一', () => {
  const cfg = buildDefaultConfig();
  const ids = cfg.scenes.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});
