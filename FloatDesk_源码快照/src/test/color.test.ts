import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_GRADIENT_END, defaultGradientFor, normalizeHex, shiftHue } from '../shared/color';

const HEX = /^#[0-9a-f]{6}$/;

test('normalizeHex 统一小写 #rrggbb', () => {
  assert.equal(normalizeHex('#3B82F6'), '#3b82f6');
  assert.equal(normalizeHex('3b82f6'), '#3b82f6');
  assert.equal(normalizeHex('#abc'), '#aabbcc');
  assert.equal(normalizeHex('  #FFF  '), '#ffffff');
});

test('normalizeHex 非法值回退', () => {
  assert.equal(normalizeHex(''), '#3b82f6');
  assert.equal(normalizeHex(null), '#3b82f6');
  assert.equal(normalizeHex('rgb(1,2,3)'), '#3b82f6');
  assert.equal(normalizeHex('blue'), '#3b82f6');
  assert.equal(normalizeHex('zzz', '#ffffff'), '#ffffff');
});

test('shiftHue 0 度 0 亮度 = 原色', () => {
  assert.equal(shiftHue('#3b82f6', 0, 0), '#3b82f6');
  assert.equal(shiftHue('#f59e0b', 0, 0), '#f59e0b');
});

test('shiftHue 输出始终是合法 hex', () => {
  for (const c of ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#808080', '#ffffff', '#000000']) {
    for (const deg of [-180, -90, -30, 0, 30, 90, 180, 360]) {
      const out = shiftHue(c, deg, -20);
      assert.equal(HEX.test(out), true, `${c} ${deg} -> ${out}`);
    }
  }
});

test('defaultGradientFor 默认蓝就是设计稿的紫', () => {
  assert.equal(defaultGradientFor('#3b82f6'), DESIGN_GRADIENT_END);
  assert.equal(defaultGradientFor('#3B82F6'), DESIGN_GRADIENT_END);
  assert.equal(DESIGN_GRADIENT_END, '#7c3aed');
});

test('defaultGradientFor 其它主题色给出协调的邻近色', () => {
  // 绿 → 青、橙 → 红、紫 → 洋红：都应与主色不同且是合法 hex
  const cases: Array<[string, string]> = [
    ['#10b981', '#109cb9'], // 绿 → 青
    ['#f59e0b', '#f5290b'], // 橙 → 红
    ['#8b5cf6', '#d85cf6'], // 紫 → 洋红
    ['#ef4444', '#ef449a'], // 红 → 玫红
  ];
  for (const [theme, expected] of cases) {
    const out = defaultGradientFor(theme);
    assert.equal(out, expected, `${theme} -> ${out}`);
    assert.notEqual(out, theme);
  }
});

test('defaultGradientFor 灰度色保持灰度（无色相可转）', () => {
  const out = defaultGradientFor('#808080');
  assert.equal(HEX.test(out), true);
  assert.equal(out, '#808080');
});

test('defaultGradientFor 非法输入回退到蓝→紫', () => {
  assert.equal(defaultGradientFor(''), DESIGN_GRADIENT_END);
  assert.equal(defaultGradientFor(null), DESIGN_GRADIENT_END);
});
