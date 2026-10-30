import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_HISTORY_MAX,
  clampNoteFontSize,
  clampNoteOpacity,
  formatNoteTime,
  normalizeHistoryEntry,
  normalizeNoteColor,
  notePreview,
  plainTextToHtml,
  pushHistoryEntry,
  sanitizeNoteHtml,
} from '../shared/note';

test('normalizeNoteColor 统一成 #rrggbb', () => {
  assert.equal(normalizeNoteColor('#FFF6C9'), '#fff6c9');
  assert.equal(normalizeNoteColor('fff6c9'), '#fff6c9');
  assert.equal(normalizeNoteColor('#abc'), '#aabbcc');
});

test('normalizeNoteColor 非法值回退默认', () => {
  assert.equal(normalizeNoteColor(''), '#fff6c9');
  assert.equal(normalizeNoteColor('rgb(1,2,3)'), '#fff6c9');
  assert.equal(normalizeNoteColor(null), '#fff6c9');
  assert.equal(normalizeNoteColor('blue'), '#fff6c9');
});

test('clampNoteOpacity 夹在 0.3..1', () => {
  assert.equal(clampNoteOpacity(0), 0.3);
  assert.equal(clampNoteOpacity(0.5), 0.5);
  assert.equal(clampNoteOpacity(5), 1);
  assert.equal(clampNoteOpacity('abc'), 1);
});

test('clampNoteFontSize 夹在 10..32', () => {
  assert.equal(clampNoteFontSize(1), 10);
  assert.equal(clampNoteFontSize(14), 14);
  assert.equal(clampNoteFontSize(99), 32);
  assert.equal(clampNoteFontSize('x'), 14);
});

test('formatNoteTime 输出 YYYY-MM-DD HH:mm', () => {
  assert.equal(formatNoteTime(new Date(2026, 0, 2, 3, 4)), '2026-01-02 03:04');
});

test('notePreview 压缩空白并截断', () => {
  assert.equal(notePreview('  a\n  b  '), 'a b');
  assert.equal(notePreview(''), '（空）');
  assert.equal(notePreview('x'.repeat(50)).endsWith('…'), true);
});

test('pushHistoryEntry 最新在前且不重复记录', () => {
  let h = pushHistoryEntry([], '<b>A</b>', 'A', 't1');
  assert.equal(h.length, 1);
  h = pushHistoryEntry(h, '<b>A</b>', 'A', 't2'); // 与最新一版相同 → 不记
  assert.equal(h.length, 1);
  h = pushHistoryEntry(h, '<b>B</b>', 'B', 't3');
  assert.equal(h[0].html, '<b>B</b>');
  assert.equal(h[0].text, 'B');
  assert.equal(h[0].time, 't3');
  assert.equal(h.length, 2);
});

test('pushHistoryEntry 超出上限后丢最旧的', () => {
  let h: any[] = [];
  for (let i = 0; i < NOTE_HISTORY_MAX + 5; i++) h = pushHistoryEntry(h, 'v' + i, 'v' + i, 't' + i);
  assert.equal(h.length, NOTE_HISTORY_MAX);
  assert.equal(h[0].html, 'v' + (NOTE_HISTORY_MAX + 4));
  // 最早那几版已经被挤掉了
  assert.equal(h[h.length - 1].html, 'v5');
});

test('历史至少能存下 10 版（早期只有 3 版不够回退）', () => {
  assert.ok(NOTE_HISTORY_MAX >= 10);
  let h: any[] = [];
  for (const c of ['A', 'B', 'C', 'D', 'E']) h = pushHistoryEntry(h, c, c.toLowerCase(), 't' + c);
  assert.equal(h.length, 5);
  assert.deepEqual(
    h.map((x: any) => x.html),
    ['E', 'D', 'C', 'B', 'A']
  );
});

test('sanitizeNoteHtml 剔除脚本 / iframe / on* 事件', () => {
  const out = sanitizeNoteHtml(
    '<div onclick="alert(1)">hi<script>alert(1)</script></div>' +
      '<iframe src="https://evil"></iframe><img src=x onerror="alert(1)">'
  );
  assert.equal(/script/i.test(out), false);
  assert.equal(/iframe/i.test(out), false);
  assert.equal(/onclick|onerror/i.test(out), false);
  assert.equal(out.includes('hi'), true);
});

test('sanitizeNoteHtml 保留正常格式标签', () => {
  const src = '<div><b>粗体</b><i>斜体</i><pre><code>const a = 1;</code></pre></div>';
  assert.equal(sanitizeNoteHtml(src), src);
  assert.equal(sanitizeNoteHtml(null), '');
});

test('plainTextToHtml 空行分段、行内换行用 br', () => {
  assert.equal(plainTextToHtml(''), '');
  assert.equal(plainTextToHtml('a\nb'), '<div>a<br>b</div>');
  assert.equal(plainTextToHtml('a\n\nb'), '<div>a</div><div>b</div>');
  // 尖括号要转义，避免老的纯文本正文变成标签
  assert.equal(plainTextToHtml('<x>'), '<div>&lt;x&gt;</div>');
});

test('normalizeHistoryEntry 兼容老格式 {time, content}', () => {
  const e = normalizeHistoryEntry({ time: '2026-01-01 00:00', content: 'abc' });
  assert.ok(e);
  assert.equal(e!.text, 'abc');
  assert.equal(e!.html, '<div>abc</div>');
  // 新格式原样通过
  const n = normalizeHistoryEntry({ time: 't', html: '<b>x</b>', text: 'x' });
  assert.equal(n!.html, '<b>x</b>');
  // 空条目丢弃
  assert.equal(normalizeHistoryEntry({}), null);
  assert.equal(normalizeHistoryEntry(null), null);
});
