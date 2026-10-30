import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultIconForType, extOf, iconForPath, isImagePath } from '../shared/icons';

test('每种项目类型都有兜底图标', () => {
  assert.equal(defaultIconForType('web'), '🔗');
  assert.equal(defaultIconForType('app'), '🧩');
  assert.equal(defaultIconForType('file'), '📄');
  assert.equal(defaultIconForType('image'), '🖼');
  assert.equal(defaultIconForType('shortcut'), '⌨️');
  assert.equal(defaultIconForType('unknown-type'), '•');
});

test('extOf 取扩展名并转小写', () => {
  assert.equal(extOf('/a/b/c.MP4'), 'mp4');
  assert.equal(extOf('report.final.xlsx'), 'xlsx');
  assert.equal(extOf('/a/b/noext'), '');
  assert.equal(extOf('.hidden'), ''); // 点开头视为无扩展名
  assert.equal(extOf(''), '');
});

test('isImagePath 认常见图片扩展名', () => {
  for (const p of ['a.png', 'a.JPG', 'a.webp', 'a.heic', 'a.svg']) assert.equal(isImagePath(p), true, p);
  for (const p of ['a.pdf', 'a.mp4', 'a.app', 'a']) assert.equal(isImagePath(p), false, p);
});

test('文件按扩展名给常用图标', () => {
  assert.equal(iconForPath('/a/表.xlsx'), '📊');
  assert.equal(iconForPath('/a/合同.pdf'), '📕');
  assert.equal(iconForPath('/a/说明.md'), '📝');
  assert.equal(iconForPath('/a/录像.mov'), '🎬');
  assert.equal(iconForPath('/a/歌.flac'), '🎵');
  assert.equal(iconForPath('/a/包.zip'), '🗜');
  assert.equal(iconForPath('/a/main.ts'), '🧑‍💻');
  assert.equal(iconForPath('/a/照片.png'), '🖼');
});

test('目录给文件夹图标，未知扩展名给文档图标', () => {
  assert.equal(iconForPath('/Users/me/项目', true), '📁');
  assert.equal(iconForPath('/Users/me/项目/'), '📁');
  assert.equal(iconForPath('/a/奇怪.zzz'), '📄');
  assert.equal(iconForPath('/a/noext'), '📄');
});
