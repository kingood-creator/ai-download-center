import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPngFromIcns, isPng, looksLikeIcns } from '../shared/icns';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 造一个假 PNG（只保证前 8 字节是 PNG 签名 + 指定长度，够 isPng 判定用） */
function fakePng(size: number): Buffer {
  const b = Buffer.alloc(Math.max(size, 12));
  PNG_MAGIC.copy(b, 0);
  return b;
}

/** 按 icns 结构拼一个容器：'icns' + 总长 + 若干 { type, size, data } */
function buildIcns(chunks: Array<{ type: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  for (const c of chunks) {
    const head = Buffer.alloc(8);
    head.write(c.type, 0, 'ascii');
    head.writeUInt32BE(c.data.length + 8, 4);
    parts.push(head, c.data);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

test('isPng 只认 PNG 签名', () => {
  assert.equal(isPng(fakePng(16)), true);
  assert.equal(isPng(Buffer.from('not a png at all')), false);
  assert.equal(isPng(Buffer.alloc(0)), false);
  assert.equal(isPng(null), false);
});

test('looksLikeIcns 只认 icns 魔数', () => {
  assert.equal(looksLikeIcns(buildIcns([{ type: 'ic07', data: fakePng(20) }])), true);
  assert.equal(looksLikeIcns(Buffer.from('icns')), false); // 太短
  assert.equal(looksLikeIcns(fakePng(64)), false);
});

test('extractPngFromIcns 取出最大的内嵌 PNG', () => {
  const small = fakePng(40);
  const big = fakePng(4000);
  const mid = fakePng(900);
  const icns = buildIcns([
    { type: 'ic11', data: small },
    { type: 'ic09', data: mid },
    { type: 'ic10', data: big },
  ]);
  const got = extractPngFromIcns(icns);
  assert.ok(got);
  assert.equal(got!.length, big.length);
  assert.ok(isPng(got!));
});

test('extractPngFromIcns 跳过非 PNG 块（老式 RLE 表示）', () => {
  const rgb = Buffer.alloc(500, 0x7f); // 不是 PNG
  const icns = buildIcns([
    { type: 'ic04', data: rgb },
    { type: 'ic07', data: fakePng(120) },
  ]);
  const got = extractPngFromIcns(icns);
  assert.ok(got);
  assert.ok(isPng(got!));
});

test('extractPngFromIcns 没有 PNG 表示时返回 null', () => {
  const icns = buildIcns([{ type: 'ic04', data: Buffer.alloc(300, 1) }]);
  assert.equal(extractPngFromIcns(icns), null);
});

test('extractPngFromIcns 对非法输入返回 null 且不抛错', () => {
  assert.equal(extractPngFromIcns(null), null);
  assert.equal(extractPngFromIcns(undefined), null);
  assert.equal(extractPngFromIcns(Buffer.alloc(0)), null);
  assert.equal(extractPngFromIcns(Buffer.from('PNG')), null);
  assert.equal(extractPngFromIcns(fakePng(1024)), null); // 不是 icns 容器
});

test('extractPngFromIcns 遇到损坏的块长度不会死循环', () => {
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(64, 4);
  const bad = Buffer.alloc(16);
  bad.write('ic07', 0, 'ascii');
  bad.writeUInt32BE(4, 4); // 长度小于块头 → 属于非法
  const buf = Buffer.concat([head, bad, Buffer.alloc(32)]);
  assert.equal(extractPngFromIcns(buf), null);
});
