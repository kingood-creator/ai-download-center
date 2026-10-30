import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_PAGES_MAX,
  NOTE_TAB_COLORS,
  addNotePage,
  clampTabTitle,
  nextNotePageId,
  nextNoteTitle,
  noteBookActive,
  noteBookIndexOf,
  noteCharCount,
  noteTabColor,
  normalizeHistoryMap,
  normalizeNoteBook,
  patchNotePage,
  pruneHistoryMap,
  removeNotePage,
  setActiveNotePage,
} from '../shared/note';

function book1() {
  return normalizeNoteBook({
    active: 'p1',
    pages: [{ id: 'p1', title: '工作', color: '#4b8ff0', html: '<div>甲</div>', text: '甲' }],
  });
}

test('normalizeNoteBook：没有 pages 时把老的 note.html/txt 升成「便签 1」', () => {
  const b = normalizeNoteBook(null, '<div>老内容</div>', '老内容');
  assert.equal(b.pages.length, 1);
  assert.equal(b.active, 'p1');
  assert.equal(b.pages[0].id, 'p1');
  assert.equal(b.pages[0].title, '便签 1');
  assert.equal(b.pages[0].html, '<div>老内容</div>');
  assert.equal(b.pages[0].text, '老内容');
  // 老正文里的脚本仍然要剔掉
  assert.equal(/script/i.test(normalizeNoteBook(null, '<script>x</script>ok').pages[0].html), false);
});

test('normalizeNoteBook：空数据也给一张空纸（永不返回空 pages）', () => {
  const b = normalizeNoteBook({});
  assert.equal(b.pages.length, 1);
  assert.equal(b.pages[0].html, '');
  assert.equal(noteBookActive(b).id, 'p1');
});

test('normalizeNoteBook：active 不存在时落到第一组', () => {
  const b = normalizeNoteBook({ active: 'nope', pages: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(b.active, 'a');
});

test('normalizeNoteBook：重复 id 会被拆开（否则切标签会切错页）', () => {
  const b = normalizeNoteBook({ pages: [{ id: 'p1' }, { id: 'p1' }] });
  assert.equal(b.pages.length, 2);
  assert.notEqual(b.pages[0].id, b.pages[1].id);
});

test('normalizeNoteBook：颜色非法时按顺序补色板颜色', () => {
  const b = normalizeNoteBook({ pages: [{ id: 'a', color: 'blue' }, { id: 'b' }] });
  assert.equal(b.pages[0].color, NOTE_TAB_COLORS[0]);
  assert.equal(b.pages[1].color, NOTE_TAB_COLORS[1]);
});

test('noteTabColor 循环取色，负数/越界也能落回色板', () => {
  assert.equal(noteTabColor(0), NOTE_TAB_COLORS[0]);
  assert.equal(noteTabColor(NOTE_TAB_COLORS.length), NOTE_TAB_COLORS[0]);
  assert.equal(noteTabColor(-1), NOTE_TAB_COLORS[NOTE_TAB_COLORS.length - 1]);
  assert.equal(noteTabColor(NaN), NOTE_TAB_COLORS[0]);
});

test('addNotePage：新建一组、自动配色、自动切过去', () => {
  let b = book1();
  b = addNotePage(b);
  assert.equal(b.pages.length, 2);
  assert.equal(b.active, b.pages[1].id);
  assert.equal(b.pages[1].html, '');
  assert.notEqual(b.pages[1].color, b.pages[0].color);
  // 标题不能跟已有的撞
  assert.notEqual(b.pages[1].title, b.pages[0].title);
});

test('addNotePage：到上限就不再新增', () => {
  let b = book1();
  for (let i = 1; i < NOTE_PAGES_MAX; i++) b = addNotePage(b);
  assert.equal(b.pages.length, NOTE_PAGES_MAX);
  const same = addNotePage(b);
  assert.equal(same.pages.length, NOTE_PAGES_MAX);
  assert.equal(same.active, b.active);
});

test('removeNotePage：删当前这组会顺位落到下一组', () => {
  let b = book1();
  b = addNotePage(b); // 两组，active = p2
  b = setActiveNotePage(b, 'p1');
  const after = removeNotePage(b, 'p1');
  assert.equal(after.pages.length, 1);
  assert.equal(after.pages[0].id, 'p2');
  assert.equal(after.active, 'p2');
});

test('removeNotePage：只剩一组时不许删', () => {
  const b = book1();
  assert.equal(removeNotePage(b, 'p1').pages.length, 1);
});

test('removeNotePage：删的不是当前那组，active 不动', () => {
  let b = book1();
  b = addNotePage(b); // active = p2
  const after = removeNotePage(b, 'p1');
  assert.equal(after.active, 'p2');
  assert.equal(after.pages.length, 1);
});

test('patchNotePage：改名/换色/换正文只影响目标那组', () => {
  let b = addNotePage(book1());
  b = patchNotePage(b, 'p1', { title: '  待办  清单 ', color: '#2fae7a', html: '<div>乙</div>', text: '乙' });
  const p1 = b.pages.find((p) => p.id === 'p1')!;
  assert.equal(p1.title, '待办 清单');
  assert.equal(p1.color, '#2fae7a');
  assert.equal(p1.html, '<div>乙</div>');
  assert.equal(p1.text, '乙');
  // 另一组没被碰
  assert.equal(b.pages[1].html, '');
  // 空标题不会把标签变成空白
  assert.equal(patchNotePage(b, 'p1', { title: '   ' }).pages[0].title, '待办 清单');
});

test('patchNotePage：正文里夹带的脚本会被过滤', () => {
  const b = patchNotePage(book1(), 'p1', { html: '<div onclick="alert(1)">x<script>alert(1)</script></div>' });
  assert.equal(/script|onclick/i.test(b.pages[0].html), false);
});

test('setActiveNotePage：切成存在的 id 才生效', () => {
  const b = addNotePage(book1());
  assert.equal(setActiveNotePage(b, 'p1').active, 'p1');
  assert.equal(setActiveNotePage(b, 'zzz').active, b.active);
});

test('clampTabTitle：压空白、限 14 字、空值回退', () => {
  assert.equal(clampTabTitle('  开会\n记录  '), '开会 记录');
  assert.equal(clampTabTitle('一二三四五六七八九十一二三四五六', '便签'), '一二三四五六七八九十一二三四');
  assert.equal(clampTabTitle('', '便签 2'), '便签 2');
  assert.equal(clampTabTitle(null, '便签 3'), '便签 3');
});

test('nextNoteTitle / nextNotePageId：避开已经用掉的', () => {
  const b = addNotePage(book1()); // 工作 / 便签 1
  assert.equal(nextNoteTitle(b), '便签 2');
  assert.equal(nextNotePageId(b), 'p3');
  // 删掉第一组后，p1 空出来了，但标题也按没用过的最小号来
  const after = removeNotePage(setActiveNotePage(b, 'p1'), 'p1');
  assert.equal(nextNotePageId(after), 'p1');
  assert.equal(nextNoteTitle(after), '便签 2');
});

test('noteBookIndexOf 找不到返回 -1', () => {
  assert.equal(noteBookIndexOf(book1(), 'p1'), 0);
  assert.equal(noteBookIndexOf(book1(), 'x'), -1);
  assert.equal(noteBookIndexOf(null, 'p1'), -1);
});

test('noteCharCount 忽略空白', () => {
  assert.equal(noteCharCount(' ab\n c '), 3);
  assert.equal(noteCharCount('中文 两个'), 4);
  assert.equal(noteCharCount(null), 0);
});

test('normalizeHistoryMap：老的一维数组全归到第一组', () => {
  const m = normalizeHistoryMap([
    { time: 't1', html: '<b>a</b>', text: 'a' },
    { time: 't2', content: '老纯文本' },
  ]);
  assert.deepEqual(Object.keys(m), ['p1']);
  assert.equal(m.p1.length, 2);
  assert.equal(m.p1[1].html, '<div>老纯文本</div>');
});

test('normalizeHistoryMap：新格式按标签分开读', () => {
  const m = normalizeHistoryMap({
    version: 2,
    pages: {
      p1: [{ time: 't', html: '<b>1</b>', text: '1' }],
      p2: [{ time: 't', html: '<b>2</b>', text: '2' }],
      p3: [],
    },
  });
  assert.deepEqual(Object.keys(m).sort(), ['p1', 'p2']);
  assert.equal(m.p2[0].text, '2');
  // 一堆乱七八糟的输入也不能抛
  assert.deepEqual(normalizeHistoryMap(null), {});
  assert.deepEqual(normalizeHistoryMap('x'), {});
  assert.deepEqual(normalizeHistoryMap({ pages: 'nope' }), {});
});

test('pruneHistoryMap：删掉标签后只留还存在的那几组', () => {
  const m = { p1: [{ time: 't', html: 'a', text: 'a' }], p2: [{ time: 't', html: 'b', text: 'b' }] };
  const out = pruneHistoryMap(m, ['p2']);
  assert.deepEqual(Object.keys(out), ['p2']);
});
