import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleTarget, isChineseSource, isEnglishSource, pickTogglePair, toggleTarget } from '../shared/ime';

const ABC = { id: 'com.apple.keylayout.ABC', name: 'ABC' };
const US = { id: 'com.apple.keylayout.US', name: 'U.S.' };
const WETYPE = { id: 'com.tencent.inputmethod.wetype.pinyin', name: '微信输入法' };
const PINYIN = { id: 'com.apple.inputmethod.Chinese.pinyin', name: '拼音 - 简体' };
const PALETTE = { id: 'com.apple.CharacterPaletteIM', name: '表情与符号' };

test('isEnglishSource 认出纯键盘布局', () => {
  assert.equal(isEnglishSource(ABC), true);
  assert.equal(isEnglishSource(US), true);
  assert.equal(isEnglishSource({ id: 'x', name: 'English' }), true);
  assert.equal(isEnglishSource(WETYPE), false);
});

test('isChineseSource 认出中文输入法', () => {
  assert.equal(isChineseSource(WETYPE), true);
  assert.equal(isChineseSource(PINYIN), true);
  assert.equal(isChineseSource(ABC), false);
  // 非 inputmethod 引擎不该被认成中文
  assert.equal(isChineseSource(PALETTE), false);
});

test('pickTogglePair 从一堆源里挑出中英一对', () => {
  const p = pickTogglePair([PALETTE, ABC, WETYPE]);
  assert.equal(p.englishId, ABC.id);
  assert.equal(p.chineseId, WETYPE.id);
});

test('pickTogglePair 只有英文源时中文侧留空', () => {
  const p = pickTogglePair([ABC]);
  assert.equal(p.englishId, ABC.id);
  assert.equal(p.chineseId, null);
});

test('pickTogglePair 两端撞到同一个源时丢掉英文侧', () => {
  // 既被判成英文又被判成中文的怪源（id 里同时带 keylayout 与 inputmethod）
  const both = { id: 'com.foo.inputmethod.keylayout.zh', name: '拼音' };
  const p = pickTogglePair([both]);
  assert.equal(p.chineseId, both.id);
  assert.equal(p.englishId, null, '两端相同等于切不动，必须丢掉一端');
});

test('pickTogglePair 空列表返回两个空', () => {
  const p = pickTogglePair([]);
  assert.equal(p.chineseId, null);
  assert.equal(p.englishId, null);
});

test('toggleTarget 在两端之间来回切', () => {
  assert.equal(toggleTarget(ABC.id, WETYPE.id, ABC.id), WETYPE.id);
  assert.equal(toggleTarget(WETYPE.id, WETYPE.id, ABC.id), ABC.id);
  // 当前既不是配的中文也不是英文（比如第三方输入法）→ 切到中文
  assert.equal(toggleTarget('other', WETYPE.id, ABC.id), WETYPE.id);
});

test('toggleTarget 只配了一端时也能切过去', () => {
  assert.equal(toggleTarget(ABC.id, null, ABC.id), null); // 已经在英文且没有中文目标
  assert.equal(toggleTarget('other', WETYPE.id, null), WETYPE.id);
  assert.equal(toggleTarget('other', null, null), null);
});

test('cycleTarget 在列表里循环，不在列表里回到第一个', () => {
  const ids = [ABC.id, WETYPE.id, US.id];
  assert.equal(cycleTarget(ABC.id, ids), WETYPE.id);
  assert.equal(cycleTarget(US.id, ids), ABC.id);
  assert.equal(cycleTarget('nope', ids), ABC.id);
  assert.equal(cycleTarget(ABC.id, []), null);
});
