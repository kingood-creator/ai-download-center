// 「正在操控的窗口」提示药丸的纯逻辑自检（自动避让选位 + 停留时长归一化）。
import { test } from 'node:test';
import assert from 'node:assert';
import { pickLinkedAppSlot, normalizeLinkedDuration } from '../shared/linkedApp';

/** 构造一个「菜单圈」占位：n 个项目均匀分布在半径 r 的圆上，第一颗在正上方 */
function ring(n: number, r: number, icon: number, winW: number, winH: number) {
  const cx = winW / 2;
  const cy = winH / 2;
  const out: Array<{ t: number; b: number; l: number; r: number }> = [];
  for (let i = 0; i < n; i++) {
    const ang = ((-90 + (i * 360) / n) * Math.PI) / 180;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    out.push({ t: y - icon / 2, b: y + icon / 2, l: x - icon / 2, r: x + icon / 2 });
  }
  return out;
}

const WIN = { winW: 400, winH: 400 };
const PILL = { pillW: 80, pillH: 24 };
// 圆点 64px 居中 → 上边缘 168、下边缘 232
const DOT = { dotTop: 168, dotBottom: 232 };

/** 断言某个选位没有压住任何菜单项目、也没越出窗口 */
function assertClear(s: { top: number; left: number }, pill: { pillW: number; pillH: number }, win: { winW: number; winH: number }, items: Array<{ t: number; b: number; l: number; r: number }>) {
  assert.ok(s.top >= 1, '选位越出窗口上沿');
  assert.ok(s.top + pill.pillH <= win.winH - 1, '选位越出窗口下沿');
  assert.ok(s.left >= 1, '选位越出窗口左沿');
  assert.ok(s.left + pill.pillW <= win.winW + 1, '选位越出窗口右沿');
  for (const it of items) {
    assert.ok(
      s.left + pill.pillW < it.l || s.left > it.r || s.top + pill.pillH < it.t || s.top > it.b,
      `选位 (${s.top},${s.left}) 压住了菜单项目 ${JSON.stringify(it)}`
    );
  }
}

test('pickLinkedAppSlot: 收起态（没有菜单项）→ 贴圆点正上方', () => {
  const s = pickLinkedAppSlot({ ...WIN, ...PILL, ...DOT, items: [] });
  assert.ok(s);
  assert.strictEqual(s!.top, DOT.dotTop - PILL.pillH - 4);
  assert.strictEqual(s!.left, WIN.winW / 2 - PILL.pillW / 2); // 水平居中
});

test('pickLinkedAppSlot: 空隙够（大圆环）→ 仍贴圆点上方，不躲', () => {
  // r=150, icon=44 → 正上方那颗占 [28,72]，圆点上边缘 168，中间空隙很大
  const items = ring(6, 150, 44, 400, 400);
  const s = pickLinkedAppSlot({ ...WIN, ...PILL, ...DOT, items });
  assert.ok(s);
  assert.strictEqual(s!.top, DOT.dotTop - PILL.pillH - 4);
  assertClear(s!, PILL, WIN, items);
});

test('pickLinkedAppSlot: 圆点上方被项目压住（小圆环）→ 挪到菜单圈上方', () => {
  const items = ring(6, 60, 44, 400, 400);
  const topItem = items.reduce((a, b) => (a.t <= b.t ? a : b));
  const s = pickLinkedAppSlot({ ...WIN, ...PILL, ...DOT, items });
  assert.ok(s);
  assert.strictEqual(s!.top, topItem.t - PILL.pillH - 4);
  assertClear(s!, PILL, WIN, items);
});

test('pickLinkedAppSlot: 不管环半径多大/多小，选位一律在圆点上方（不跑到下面去）', () => {
  // 不同场景的 ringRadius / iconSize 差别很大：只要允许「下方」候选，
  // 同一条提示就会在有的场景在上面、有的场景跑到下面（用户要的是「都在上面」）
  for (const r of [60, 90, 120, 150, 180]) {
    for (const icon of [28, 44, 64]) {
      const items = ring(6, r, icon, 400, 400);
      const s = pickLinkedAppSlot({ ...WIN, ...PILL, ...DOT, items });
      assert.ok(s, `r=${r} icon=${icon} 应该能选到位置`);
      assert.ok(
        s!.top + PILL.pillH <= DOT.dotTop,
        `r=${r} icon=${icon} 提示跑到圆点下方去了（top=${s!.top}）`
      );
      assertClear(s!, PILL, WIN, items);
    }
  }
});

test('pickLinkedAppSlot: 上方实在放不下 → 返回 null（调用方退回默认位置，仍在圆点上方）', () => {
  // 一整块占满上半屏（连窗口顶部余量一起吃掉）→ 一个上方候选都不剩
  const items = [{ t: 0, b: 170, l: 0, r: 400 }];
  const s = pickLinkedAppSlot({ ...WIN, ...PILL, ...DOT, items });
  assert.strictEqual(s, null);
});

test('pickLinkedAppSlot: 全都躲不开 → 返回 null（调用方退回默认位置）', () => {
  // 上下两块连成一片，任何候选位都被占
  const items = [
    { t: 0, b: 100, l: 0, r: 400 },
    { t: 120, b: 200, l: 0, r: 400 },
  ];
  const s = pickLinkedAppSlot({ winW: 400, winH: 200, ...PILL, dotTop: 80, dotBottom: 120, items });
  assert.strictEqual(s, null);
});

test('pickLinkedAppSlot: 尺寸非法 → null（调用方退回默认位置）', () => {
  assert.strictEqual(pickLinkedAppSlot({ ...WIN, pillW: 0, pillH: 24, ...DOT, items: [] }), null);
  assert.strictEqual(pickLinkedAppSlot({ ...WIN, pillW: 80, pillH: 0, ...DOT, items: [] }), null);
  assert.strictEqual(pickLinkedAppSlot({ winW: 0, winH: 0, ...PILL, ...DOT, items: [] }), null);
});

test('normalizeLinkedDuration: 0/脏值 = 常驻，正数夹到 1–60', () => {
  assert.strictEqual(normalizeLinkedDuration(0), 0);
  assert.strictEqual(normalizeLinkedDuration(undefined), 0);
  assert.strictEqual(normalizeLinkedDuration(null), 0);
  assert.strictEqual(normalizeLinkedDuration(''), 0);
  assert.strictEqual(normalizeLinkedDuration(-5), 0);
  assert.strictEqual(normalizeLinkedDuration('abc'), 0);
  assert.strictEqual(normalizeLinkedDuration(0.2), 0); // 不足 1 秒按常驻处理（避免瞬间消失）
  assert.strictEqual(normalizeLinkedDuration(1), 1);
  assert.strictEqual(normalizeLinkedDuration('3'), 3);
  assert.strictEqual(normalizeLinkedDuration(2.4), 2);
  assert.strictEqual(normalizeLinkedDuration(100), 60);
});
