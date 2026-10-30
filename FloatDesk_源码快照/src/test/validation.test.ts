import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, validateItem, isHttpUrl, normalizeThemeColor, clampGradientAngle } from '../shared/validation';
import { buildDefaultConfig } from '../shared/defaults';

test('isHttpUrl 只允许 http/https', () => {
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('http://example.com'), true);
  assert.equal(isHttpUrl('ftp://example.com'), false);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('not a url'), false);
});

test('默认配置通过校验', () => {
  const cfg = buildDefaultConfig();
  const r = validateConfig(cfg);
  assert.ok(r.ok, r.errors.join('; '));
});

test('网页项目必须是 http(s)', () => {
  const r = validateItem({ id: '1', name: 'x', type: 'web', target: 'ftp://a', order: 0 });
  assert.equal(r.ok, false);
});

test('应用项目路径必须以 .app 结尾', () => {
  const r = validateItem({ id: '1', name: 'x', type: 'app', target: '/bin/ls', order: 0 });
  assert.equal(r.ok, false);
});

test('非法当前场景 id 校验失败', () => {
  const cfg = buildDefaultConfig();
  cfg.currentSceneId = 'does-not-exist';
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
});

test('重复场景 id 校验失败', () => {
  const cfg = buildDefaultConfig();
  cfg.scenes[1].id = cfg.scenes[0].id;
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
});

test('send-to-app 快捷键类型需填写键', () => {
  const r = validateItem({ id: '1', name: 'x', type: 'shortcut', target: '', order: 0, shortcutKind: 'send-to-app', shortcutKeystroke: '' });
  assert.equal(r.ok, false);
});

// ---------- 主题色归一化（主题色会直接进 CSS 变量并参与 color-mix，非法值会让圆点消失） ----------
test('normalizeThemeColor 接受 6 位并统一小写带井号', () => {
  assert.equal(normalizeThemeColor('#FF3B30'), '#ff3b30');
  assert.equal(normalizeThemeColor('FF3B30'), '#ff3b30');
  assert.equal(normalizeThemeColor('  #3b82f6  '), '#3b82f6');
});

test('normalizeThemeColor 把 3 位缩写展开成 6 位', () => {
  assert.equal(normalizeThemeColor('#abc'), '#aabbcc');
  assert.equal(normalizeThemeColor('f00'), '#ff0000');
});

test('normalizeThemeColor 对非法值退回默认蓝', () => {
  assert.equal(normalizeThemeColor('blue'), '#3b82f6');
  assert.equal(normalizeThemeColor('rgb(1,2,3)'), '#3b82f6');
  assert.equal(normalizeThemeColor(''), '#3b82f6');
  assert.equal(normalizeThemeColor(null), '#3b82f6');
  assert.equal(normalizeThemeColor(undefined), '#3b82f6');
  assert.equal(normalizeThemeColor('#12345'), '#3b82f6');
  assert.equal(normalizeThemeColor('#gggggg'), '#3b82f6');
});

test('normalizeThemeColor 支持自定义兜底色', () => {
  assert.equal(normalizeThemeColor('oops', '#123456'), '#123456');
});

// ---------- 渐变角度（直接进 CSS linear-gradient，必须是 0..360 的整数） ----------
test('clampGradientAngle 夹在 0..360 并取整', () => {
  assert.equal(clampGradientAngle(0), 0);
  assert.equal(clampGradientAngle(145), 145);
  assert.equal(clampGradientAngle(360), 360);
  assert.equal(clampGradientAngle(-30), 0);
  assert.equal(clampGradientAngle(999), 360);
  assert.equal(clampGradientAngle(144.6), 145);
});

test('clampGradientAngle 非法值回退 145', () => {
  assert.equal(clampGradientAngle('abc'), 145);
  assert.equal(clampGradientAngle(null), 145);
  assert.equal(clampGradientAngle(undefined), 145);
  assert.equal(clampGradientAngle(NaN), 145);
  assert.equal(clampGradientAngle(''), 145); // Number('') === 0 但空串视为没填
});

// ---------- 内置动作（输入法切换 / 便签） ----------
test('内置动作项目通过校验', () => {
  const r = validateItem({ id: '1', name: '切换中/英文输入法', type: 'action', target: 'ime:switch', order: 0 });
  assert.ok(r.ok, r.errors.join('; '));
});

test('内置动作 target 必须是已知 key', () => {
  const r = validateItem({ id: '1', name: 'x', type: 'action', target: 'rm -rf /', order: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.join(';').includes('内置动作无效'));
});

test('内置动作 target 为空也校验失败', () => {
  const r = validateItem({ id: '1', name: 'x', type: 'action', target: '', order: 0 });
  assert.equal(r.ok, false);
});
