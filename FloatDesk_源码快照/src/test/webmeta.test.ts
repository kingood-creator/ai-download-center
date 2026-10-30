import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  parseAttrs,
  pickTitle,
  pickSiteName,
  pickIconCandidates,
  nameFromUrl,
  resolveUrl,
  sniffImageExt,
} from '../shared/webmeta';

test('decodeEntities 解常见实体', () => {
  assert.equal(decodeEntities('A &amp; B'), 'A & B');
  assert.equal(decodeEntities('it&#39;s'), "it's");
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('&#x4E2D;&#25991;'), '中文');
});

test('parseAttrs 属性顺序无关、支持单双引号与裸值', () => {
  assert.deepEqual(parseAttrs('<link rel="icon" href="/a.png">'), { rel: 'icon', href: '/a.png' });
  assert.deepEqual(parseAttrs("<meta content='x' name='og:title'>"), { content: 'x', name: 'og:title' });
  assert.equal(parseAttrs('<link rel=icon>')['rel'], 'icon');
});

test('pickTitle 优先级 og:title > title > og:site_name', () => {
  const og = `<meta property="og:title" content="OG 标题"><title>HTML 标题</title>`;
  assert.equal(pickTitle(og), 'OG 标题');
  assert.equal(pickTitle('<title>只有 title</title>'), '只有 title');
  assert.equal(pickTitle(`<meta property="og:site_name" content="站点名">`), '站点名');
  assert.equal(pickTitle('<html><body>无标题</body></html>'), '');
});

test('pickTitle 会解实体并压缩空白', () => {
  assert.equal(pickTitle('<title>\n  Hello &amp;  World \n</title>'), 'Hello & World');
});

test('pickSiteName 读 og:site_name', () => {
  assert.equal(pickSiteName('<meta property="og:site_name" content="GitHub">'), 'GitHub');
  assert.equal(pickSiteName('<title>x</title>'), '');
});

test('pickIconCandidates：apple-touch-icon 优先，相对路径转绝对，末尾补 /favicon.ico', () => {
  const html = `
    <link rel="icon" href="/small.png" sizes="16x16">
    <link rel="apple-touch-icon" sizes="180x180" href="/touch.png">
    <link rel="icon" href="/big.png" sizes="192x192">
  `;
  const list = pickIconCandidates(html, 'https://example.com/dir/page.html');
  assert.equal(list[0], 'https://example.com/touch.png');
  assert.ok(list.includes('https://example.com/big.png'));
  assert.ok(list.includes('https://example.com/small.png'));
  assert.equal(list[list.length - 1], 'https://example.com/favicon.ico');
  // 去重
  assert.equal(new Set(list).size, list.length);
});

test('pickIconCandidates 忽略非 http 协议与不相关 rel', () => {
  const html = `<link rel="stylesheet" href="/a.css"><link rel="icon" href="javascript:alert(1)">`;
  const list = pickIconCandidates(html, 'https://example.com/');
  assert.deepEqual(list, ['https://example.com/favicon.ico']);
});

test('resolveUrl 只允许 http(s)', () => {
  assert.equal(resolveUrl('/a.png', 'https://x.com/b/'), 'https://x.com/a.png');
  assert.equal(resolveUrl('//cdn.x.com/a.png', 'https://x.com/'), 'https://cdn.x.com/a.png');
  assert.equal(resolveUrl('ftp://x.com/a.png', 'https://x.com/'), '');
});

test('nameFromUrl 去掉 www.', () => {
  assert.equal(nameFromUrl('https://www.apple.com/cn/'), 'apple.com');
  assert.equal(nameFromUrl('not a url'), '');
});

test('sniffImageExt 按文件头识别格式', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00, 1, 2, 3, 4]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3, 4]);
  assert.equal(sniffImageExt(png), 'png');
  assert.equal(sniffImageExt(ico), 'ico');
  assert.equal(sniffImageExt(jpg), 'jpg');
  assert.equal(sniffImageExt(svg), 'svg');
  assert.equal(sniffImageExt(webp), 'webp');
  assert.equal(sniffImageExt(gif), 'gif');
  assert.equal(sniffImageExt(new Uint8Array([1, 2, 3, 4])), null);
});
