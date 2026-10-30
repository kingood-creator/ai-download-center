// 「正在操控的窗口」提示药丸（悬浮球上方那条「↗ 应用名」）的纯逻辑。
// 放在 shared 是为了让单测能在纯 node 下覆盖；悬浮窗渲染进程是经典脚本、不能 import 值，
// 那里按「双胞胎」约定各存一份同逻辑副本（与 sameProjectMatches / libraryMatches 同样的约定，
// 改动时两边同步 —— 见 src/renderer/floating/app.ts 里的 pickLinkedAppSlot）。

/** 一个占位矩形（top/bottom/left/right，渲染进程坐标系 = 窗口内坐标） */
export interface PillRect {
  t: number;
  b: number;
  l: number;
  r: number;
}

export interface PillSlotInput {
  /** 悬浮窗宽高 */
  winW: number;
  winH: number;
  /** 药丸自身宽高 */
  pillW: number;
  pillH: number;
  /** 中心圆点的上/下边缘（用于「贴着圆点」的候选位） */
  dotTop: number;
  dotBottom: number;
  /** 菜单项目的占位（空数组 = 收起态，没有菜单） */
  items: PillRect[];
}

/**
 * 给提示药丸挑一个「不压住任何菜单项目」的位置 —— **而且必须都在圆点上方**。
 *
 * 背景：药丸原先固定在圆点正上方，一旦把「圆环半径」调小 / 图标调大，
 * 正上方那颗菜单项目就会把药丸压住（用户截图反馈过）。
 *
 * 为什么只挑上方：每个场景的环半径、图标尺寸、圆点大小都不一样，
 * 只要允许「下方」这个候选，同一条提示在 A 场景（环大、空隙够）就贴在圆点上方、
 * 在 B 场景（环小、被顶到图标）就跑到圆点下方去了 —— 看起来像提示乱跳。
 * 用户要的是「所有场景都在上面」，所以候选位一律是上方：
 *   ① 圆点正上方（贴着圆点，最近——收起态和有足够空隙时用它，和原来的手感一致）
 *   ② 菜单圈上方（展开态窗口外沿本来就有 30px 余量，一定放得下）
 *   ③ 窗口顶部（前两个都被占时的最后退路，仍然是「上面」）
 * 每个候选位还会尝试「水平居中 / 左偏 14px / 右偏 14px」——只做小幅横移，
 * 不让药丸甩到窗口另一侧（那就和圆点脱节了，反而看不出在说哪个窗口）。
 * 全都躲不开时返回 null，调用方退回 CSS 默认位置（也在圆点上方，允许被压也好过跑出窗口）。
 */
export function pickLinkedAppSlot(inp: PillSlotInput): { top: number; left: number } | null {
  const { winW, winH, pillW, pillH, dotTop, items } = inp;
  if (!(pillW > 0) || !(pillH > 0) || !(winW > 0) || !(winH > 0)) return null;

  const hit = (top: number, left: number): boolean =>
    items.some((it) => !(left + pillW < it.l || left > it.r || top + pillH < it.t || top > it.b));

  const cx = winW / 2;
  const lefts: number[] = [cx - pillW / 2, cx - pillW / 2 - 14, cx - pillW / 2 + 14];

  const itemsTop = items.length ? Math.min(...items.map((i) => i.t)) : 0;
  const tops: number[] = [
    dotTop - pillH - 4, // ① 圆点正上方
    items.length ? itemsTop - pillH - 4 : Number.NaN, // ② 菜单圈上方
    2, // ③ 窗口顶部（兜底，依旧在上方）
  ];

  for (const top of tops) {
    if (!Number.isFinite(top)) continue;
    if (top < 1 || top + pillH > winH - 1) continue;
    for (const left of lefts) {
      if (left < 1 || left + pillW > winW + 1) continue;
      if (hit(top, left)) continue;
      return { top, left };
    }
  }
  return null;
}

/**
 * 「提示停留时长」归一化：0 = 常驻显示；否则夹到 1–60 秒。
 * 接受字符串数字（设置页 select 的 value 就是字符串），脏值一律按 0（常驻）处理。
 */
export function normalizeLinkedDuration(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const r = Math.round(n);
  if (r < 1) return 0; // 不足 1 秒按常驻处理（避免「刚出现就消失」）
  return Math.max(1, Math.min(60, r));
}
