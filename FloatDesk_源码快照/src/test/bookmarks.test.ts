import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanBookmarkTitle,
  countLinks,
  filterBookmarks,
  flattenBookmarks,
  listBookmarkFolders,
  normalizeBookmarkUrl,
  parseBookmarkHtml,
} from '../shared/bookmarks';

// Chrome / Edge 导出的骨架（带 ICON data URL、多层文件夹）
const CHROME = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><A HREF="https://github.com/" ADD_DATE="1700000002" ICON="data:image/png;base64,iVBORw0KGgo=">GitHub</A>
        <DT><H3 ADD_DATE="1700000003">技术</H3>
        <DL><p>
            <DT><A HREF="https://developer.mozilla.org/zh-CN/" ADD_DATE="1700000004">MDN &amp; 文档</A>
            <DT><A HREF="https://stackoverflow.com">Stack Overflow</A>
        </DL><p>
        <DT><A HREF="javascript:void(0)">坏书签</A>
        <DT><A HREF="chrome://settings">设置页</A>
    </DL><p>
    <DT><H3>其他书签</H3>
    <DL><p>
        <DT><A HREF="example.com/page?x=1">裸域名</A>
    </DL><p>
</DL><p>`;

// Firefox 导出：属性更多、文件名大小写混杂、带 place: / 空的条目
const FIREFOX = `<DT><H3>Bookmarks Menu</H3>
<DL><p>
    <DT><A HREF="place:type=6&amp;sort=14">最近使用</A>
    <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1" LAST_MODIFIED="2" ICON_URI="https://news.ycombinator.com/favicon.ico">Hacker News</A>
    <DT><A HREF="">空地址</A>
</DL><p>`;

// Safari 导出：没有 ICON，只有一层文件夹
const SAFARI = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC>
<DL><p>
  <DT><H3>BookmarksBar</H3>
  <DL><p>
    <DT><A HREF="https://www.apple.com/">Apple</A>
    <DT><A HREF="https://www.apple.com/cn/">Apple 中国</A>
  </DL><p>
</DL><p>`;

test('parseBookmarkHtml：Chrome 导出解析出链接 / 文件夹 / 层级', () => {
  const r = parseBookmarkHtml(CHROME);
  assert.equal(r.links, 4); // GitHub / MDN / Stack / 裸域名
  assert.equal(r.folders, 3); // 书签栏 / 技术 / 其他书签（顶层那个 DL 不算文件夹）
  assert.ok(r.skipped >= 2, 'javascript: 与 chrome:// 要跳过，skipped=' + r.skipped);
  const all = flattenBookmarks(r.nodes);
  const names = all.map((x) => x.name);
  assert.ok(names.includes('GitHub'));
  assert.ok(names.includes('MDN & 文档'), '实体要解码');
  assert.ok(!names.includes('坏书签'));
  assert.ok(!names.includes('设置页'));
});

test('parseBookmarkHtml：多层文件夹的 path / depth 正确', () => {
  const r = parseBookmarkHtml(CHROME);
  const all = flattenBookmarks(r.nodes);
  const mdn = all.find((x) => x.name === 'MDN & 文档');
  assert.ok(mdn);
  assert.deepEqual(mdn!.path, ['书签栏', '技术']);
  assert.equal(mdn!.depth, 3); // 顶层 书签栏(1) → 技术(2) → 链接(3)
  const gh = all.find((x) => x.name === 'GitHub');
  assert.deepEqual(gh!.path, ['书签栏']);
});

test('parseBookmarkHtml：裸域名补 https、query 保留', () => {
  const r = parseBookmarkHtml(CHROME);
  const bare = flattenBookmarks(r.nodes).find((x) => x.name === '裸域名');
  assert.ok(bare);
  assert.equal(bare!.url, 'https://example.com/page?x=1');
});

test('parseBookmarkHtml：Chrome 的内嵌图标被收下（data:image）', () => {
  const r = parseBookmarkHtml(CHROME);
  const gh = flattenBookmarks(r.nodes).find((x) => x.name === 'GitHub');
  assert.ok(gh!.icon && gh!.icon.startsWith('data:image/png;base64,'));
});

test('parseBookmarkHtml：Firefox 导出 — place: 与空地址都跳过', () => {
  const r = parseBookmarkHtml(FIREFOX);
  assert.equal(r.links, 1);
  assert.equal(r.skipped, 2);
  assert.equal(flattenBookmarks(r.nodes)[0].url, 'https://news.ycombinator.com/');
});

test('parseBookmarkHtml：Safari 导出也认（无 ICON、单层）', () => {
  const r = parseBookmarkHtml(SAFARI);
  assert.equal(r.links, 2);
  assert.deepEqual(flattenBookmarks(r.nodes).map((x) => x.name), ['Apple', 'Apple 中国']);
});

test('parseBookmarkHtml：空 / 乱码输入不抛错，返回空结果', () => {
  for (const s of ['', '   ', 'not html', '<DL><p></DL><p>', '<h3>只有文件夹</h3>']) {
    const r = parseBookmarkHtml(s);
    assert.equal(typeof r.links, 'number');
    assert.ok(r.links >= 0);
  }
  assert.equal(parseBookmarkHtml('<h3>只有文件夹</h3>').folders, 1);
});

test('parseBookmarkHtml：大小写混杂的标签也认', () => {
  const r = parseBookmarkHtml('<dt><a href="https://a.com">A</a><DT><A HREF="https://b.com">B</A>');
  assert.equal(r.links, 2);
});

test('normalizeBookmarkUrl：只放行 http(s)', () => {
  assert.equal(normalizeBookmarkUrl('https://a.com/x'), 'https://a.com/x');
  assert.equal(normalizeBookmarkUrl('a.com'), 'https://a.com/');
  assert.equal(normalizeBookmarkUrl('javascript:alert(1)'), null);
  assert.equal(normalizeBookmarkUrl('place:type=6'), null);
  assert.equal(normalizeBookmarkUrl('chrome://settings'), null);
  assert.equal(normalizeBookmarkUrl('file:///tmp/a.html'), null);
  assert.equal(normalizeBookmarkUrl(''), null);
  assert.equal(normalizeBookmarkUrl('第 1 条'), null);
});

test('cleanBookmarkTitle：去标签 / 解实体 / 长标题截断 / 空标题回退域名', () => {
  assert.equal(cleanBookmarkTitle('<b>粗体</b>  标题'), '粗体 标题');
  assert.equal(cleanBookmarkTitle('A &amp; B'), 'A & B');
  assert.equal(cleanBookmarkTitle('', 'https://www.example.com/a'), 'example.com');
  assert.equal(cleanBookmarkTitle('x'.repeat(120)).length, 81); // 80 + 省略号
  assert.equal(cleanBookmarkTitle('&#20013;&#x6587;'), '中文');
});

test('flattenBookmarks / countLinks / listBookmarkFolders 与树一致', () => {
  const r = parseBookmarkHtml(CHROME);
  assert.equal(flattenBookmarks(r.nodes).length, r.links);
  const tech = r.nodes[0].children!.find((n) => n.name === '技术')!;
  assert.equal(countLinks(tech), 2);
  const folders = listBookmarkFolders(r.nodes);
  const names = folders.map((f) => f.path);
  assert.ok(names.includes('书签栏'));
  assert.ok(names.includes('书签栏 / 技术'));
  const t = folders.find((f) => f.path === '书签栏 / 技术');
  assert.equal(t!.count, 2);
});

test('filterBookmarks：按名字 / 网址 / 文件夹路径检索，空文件夹被剔掉', () => {
  const r = parseBookmarkHtml(CHROME);
  const byName = filterBookmarks(r.nodes, 'mdn');
  assert.equal(flattenBookmarks(byName).length, 1);
  const byUrl = filterBookmarks(r.nodes, 'stackoverflow');
  assert.equal(flattenBookmarks(byUrl).length, 1);
  const byFolder = filterBookmarks(r.nodes, '其他书签');
  assert.equal(flattenBookmarks(byFolder).length, 1);
  // 空检索词原样返回
  assert.equal(filterBookmarks(r.nodes, ''), r.nodes);
  // 检索不到任何东西
  assert.equal(flattenBookmarks(filterBookmarks(r.nodes, 'zzz-nothing')).length, 0);
});
