// 颜色小工具（纯函数，可单测）：给圆点渐变自动挑一个「叠加色」
// 为什么不一律用紫色：每个场景有自己的主题色（橙/绿/紫都有），
// 硬塞紫色会变成脏色。所以除默认蓝之外，都按同族色相偏移算，天然协调。

export function normalizeHex(input: unknown, fallback = '#3b82f6'): string {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : fallback;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string => {
    const n = Math.max(0, Math.min(255, Math.round(v)));
    return n < 16 ? '0' + n.toString(16) : n.toString(16);
  };
  return '#' + c(r) + c(g) + c(b);
}

/** rgb(0..255) → h(0..360) s(0..1) l(0..1) */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

/** 色相旋转 + 亮度增减（lightDelta 为百分点，-100..100） */
export function shiftHue(hex: string, deg: number, lightDelta = 0): string {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const l2 = Math.min(1, Math.max(0, l + lightDelta / 100));
  const [r2, g2, b2] = hslToRgb(h + deg, s, l2);
  return rgbToHex(r2, g2, b2);
}

function hueOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b)[0];
}

/** 最初设计稿那颗圆点的渐变终点（蓝 → 紫） */
export const DESIGN_GRADIENT_END = '#7c3aed';

/**
 * 找一个协调的渐变叠加色。
 *
 * 方向很关键：色相环上 60°~100° 是黄绿（配任何色都容易脏），所以要绕开它。
 * 冷色（青蓝紫，100°~300°）往紫红方向转，暖色（红橙黄）往红方向转，只转 30°，
 * 这样蓝→紫、绿→青、橙→红、紫→洋红，都是"同一族里换个色相"的观感，不会跑成脏色。
 * 亮度不动，避免绿色、青色被压成墨蓝。
 * 默认蓝直接用设计稿里的紫，保证和最初那颗圆点一模一样。
 */
export function defaultGradientFor(theme: unknown): string {
  const t = normalizeHex(theme);
  if (t === '#3b82f6') return DESIGN_GRADIENT_END;
  const h = hueOf(t);
  const dir = h >= 100 && h < 300 ? 1 : -1;
  return shiftHue(t, dir * 30, 0);
}
