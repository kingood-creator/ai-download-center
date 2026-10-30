import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImageBuffer, isImageExt, sanitizeLibName } from '../main/IconLibrary';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

test('isImageExt 只认图片扩展名（大小写/带点都兼容）', () => {
  for (const e of ['png', 'PNG', '.jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'apng']) {
    assert.equal(isImageExt(e), true, e);
  }
  for (const e of ['txt', 'exe', '', 'pngx', 'jpg.exe']) {
    assert.equal(isImageExt(e), false, e);
  }
});

test('isImageBuffer 按文件头魔数判定', () => {
  assert.equal(isImageBuffer(PNG), true);
  assert.equal(isImageBuffer(JPEG), true);
  assert.equal(isImageBuffer(Buffer.from('GIF89a....')), true);
  assert.equal(isImageBuffer(Buffer.from('BM' + '\u0000'.repeat(12))), true); // BMP（文件头 14 字节起）
  assert.equal(isImageBuffer(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00])), true); // ICO
  const webp = Buffer.alloc(16);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  assert.equal(isImageBuffer(webp), true);
  assert.equal(isImageBuffer(Buffer.from('<svg xmlns="..."></svg>')), true);
  assert.equal(isImageBuffer(Buffer.from('<?xml version="1.0"?><svg/>')), true);
  // 非图片：纯文本 / 太短 / PDF
  assert.equal(isImageBuffer(Buffer.from('hello world, not an image')), false);
  assert.equal(isImageBuffer(Buffer.from([1, 2, 3])), false);
  assert.equal(isImageBuffer(Buffer.from('%PDF-1.7...')), false);
  assert.equal(isImageBuffer(null as any), false);
});

test('sanitizeLibName 去掉路径成分、控制字符，保留扩展名', () => {
  assert.equal(sanitizeLibName('我的图标.png'), '我的图标.png');
  assert.equal(sanitizeLibName('/etc/passwd'), 'passwd.png'); // 无扩展名 → 补 png
  assert.equal(sanitizeLibName('../../evil.txt'), 'evil.png'); // 非图片扩展名 → 按 png 收
  assert.equal(sanitizeLibName('a\u0000b/c.JPG'), 'c.jpg'); // basename 取最后一段，扩展名统一小写
  assert.equal(sanitizeLibName('  spaced.webp  '), 'spaced.webp');
  assert.equal(sanitizeLibName(''), 'icon.png');
  assert.equal(sanitizeLibName('..'), 'icon.png');
  // 超长文件名被截断且扩展名还在
  const long = 'x'.repeat(200) + '.png';
  const out = sanitizeLibName(long);
  assert.equal(out.length <= 85, true);
  assert.equal(out.endsWith('.png'), true);
});
