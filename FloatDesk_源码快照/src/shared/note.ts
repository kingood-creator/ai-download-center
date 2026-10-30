// 便签相关的纯函数与常量（不依赖 Electron，可单测）
// 行为对齐「输入法悬浮球」的便签：纸面颜色 / 透明度 / 自动保存 / 每组标签各自的历史版本。

/** 每组标签最多保留几版历史（早期只有 3 版，改两笔就翻不回更早的稿子，这里放宽到 30） */
export const NOTE_HISTORY_MAX = 30;

/** 最多几组标签（再多标签栏就挤不下了，也容易误点） */
export const NOTE_PAGES_MAX = 20;

/**
 * 标签色板：跟纸面色板分开 —— 纸面是浅色底，标签要在浅底上一眼分得清，
 * 所以用更饱和的一组色，按「新建顺序」循环取。
 */
export const NOTE_TAB_COLORS: string[] = [
  '#ef8f3c', // 橙
  '#e0567a', // 玫红
  '#4b8ff0', // 蓝
  '#2fae7a', // 绿
  '#9b6bf0', // 紫
  '#d9a72e', // 金
  '#33a6b8', // 青
  '#c26fd0', // 品红
  '#7f8f3a', // 橄榄
  '#cf5a3a', // 砖红
];

/** 便签纸面预设色板 */
export const NOTE_PRESET_COLORS: string[] = [
  '#fff6c9', // 暖黄（默认）
  '#ffd9e4', // 蜜粉
  '#d7e8ff', // 天蓝
  '#d6f5dd', // 薄荷
  '#e7d9ff', // 淡紫
  '#ffe0c2', // 暖橙
  '#f0f0f0', // 素灰
];

export const NOTE_DEFAULT_COLOR = '#fff6c9';
export const NOTE_DEFAULT_OPACITY = 1;
export const NOTE_DEFAULT_FONT_SIZE = 14;
// 便签现在带格式工具栏，260 太矮了（正文只剩百来像素），默认给高一点
export const NOTE_DEFAULT_WIDTH = 340;
export const NOTE_DEFAULT_HEIGHT = 320;
// 最小尺寸：再小的话「头部 + 工具栏 + 底部调色条」就把正文挤没了
export const NOTE_MIN_WIDTH = 280;
export const NOTE_MIN_HEIGHT = 300;

export interface NoteHistoryEntry {
  /** 'YYYY-MM-DD HH:mm' */
  time: string;
  /** 富文本正文（HTML，已过滤） */
  html: string;
  /** 同一版的纯文本，用于列表预览与 note.txt 镜像 */
  text: string;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 存盘前过滤：便签内容只在本机自己的窗口里渲染，但粘贴进来的东西可能是任意 HTML，
 * 脚本 / iframe / on* 事件 / javascript: 链接一律剔掉。
 * 这里是第二道保险（第一道是 contenteditable 里不做任何 innerHTML 之外的注入）。
 */
export function sanitizeNoteHtml(html: unknown): string {
  let s = String(html == null ? '' : html);
  // 成对标签整段移除
  s = s.replace(/<\s*(script|iframe|object|embed|link|style|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  // 自闭合 / 没闭合的残余
  s = s.replace(/<\s*(script|iframe|object|embed|link|style|meta)\b[^>]*>?/gi, '');
  // on* 事件属性
  s = s.replace(/\son[a-z-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // javascript: 协议
  s = s.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '');
  return s;
}

/** 老版本便签是纯文本，升级后第一次打开时把它转成 HTML（空行分段，行内换行用 <br>） */
export function plainTextToHtml(text: unknown): string {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return '';
  return raw
    .split(/\n{2,}/)
    .map((p) => `<div>${esc(p).replace(/\n/g, '<br>')}</div>`)
    .join('');
}

/** 颜色归一化：'#abc' / 'ABC' / 'AABBCC' 统一成 '#aabbcc'，其它一律回退默认 */
export function normalizeNoteColor(input: unknown, fallback = NOTE_DEFAULT_COLOR): string {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : fallback;
}

/** 不透明度夹到 0.3..1（再低就看不清了） */
export function clampNoteOpacity(input: unknown): number {
  const v = Number(input);
  if (!Number.isFinite(v)) return NOTE_DEFAULT_OPACITY;
  return Math.min(1, Math.max(0.3, v));
}

/** 字号夹到 10..32 */
export function clampNoteFontSize(input: unknown): number {
  const v = Math.round(Number(input));
  if (!Number.isFinite(v)) return NOTE_DEFAULT_FONT_SIZE;
  return Math.min(32, Math.max(10, v));
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** 'YYYY-MM-DD HH:mm' */
export function formatNoteTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 摘要：把正文压成一行预览（历史列表里显示） */
export function notePreview(text: string, max = 40): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '（空）';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * 记录一版历史：与最新一版相同就不重复记；超出上限丢弃最旧的。
 * 返回新的历史列表（新的一版在最前）。
 */
export function pushHistoryEntry(
  history: NoteHistoryEntry[],
  html: string,
  text: string,
  time: string
): NoteHistoryEntry[] {
  const list = Array.isArray(history) ? history.slice() : [];
  if (list.length && list[0].html === html) return list;
  list.unshift({ time, html, text });
  return list.slice(0, NOTE_HISTORY_MAX);
}

/**
 * 兼容老的历史文件：早期版本一条只有 {time, content}（纯文本）。
 * 读进来时统一升级成 {time, html, text}，避免旧历史直接丢光。
 */
export function normalizeHistoryEntry(raw: any): NoteHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const time = String(raw.time || '');
  const legacy = typeof raw.content === 'string' ? raw.content : null;
  const html = typeof raw.html === 'string' ? raw.html : legacy != null ? plainTextToHtml(legacy) : '';
  const text = typeof raw.text === 'string' ? raw.text : legacy != null ? legacy : '';
  if (!html && !text) return null;
  return { time, html, text };
}

// ---------- 多组标签（一页一张纸，像 Windows 便签那样分页） ----------

export interface NotePage {
  id: string;
  /** 标签上显示的名字（双击可改名） */
  title: string;
  /** 标签颜色 #rrggbb，一眼区分是哪一组 */
  color: string;
  /** 富文本正文（保存前已过滤） */
  html: string;
  /** 纯文本镜像（列表预览、字数统计用） */
  text: string;
  updatedAt: number;
}

export interface NoteBook {
  /** 当前打开的那一组 */
  active: string;
  pages: NotePage[];
}

/** 每组标签各自的历史：{ 标签 id: 版本列表 } */
export type NoteHistoryMap = Record<string, NoteHistoryEntry[]>;

export function noteTabColor(index: number): string {
  const n = NOTE_TAB_COLORS.length;
  const i = ((Math.round(Number(index) || 0) % n) + n) % n;
  return NOTE_TAB_COLORS[i];
}

/** 默认标题：便签 1 / 便签 2 …（跳过已经用掉的名字，删了中间一组也不会重名） */
export function nextNoteTitle(book: NoteBook | null): string {
  const used = new Set((((book && book.pages) || []) as NotePage[]).map((p) => String(p.title || '')));
  for (let i = 1; i <= 999; i++) {
    const t = `便签 ${i}`;
    if (!used.has(t)) return t;
  }
  return '便签';
}

/** 标签标题清洗：压掉换行/多余空白、限 14 字（太长的标签会把 ＋ 挤到看不见） */
export function clampTabTitle(raw: unknown, fallback = ''): string {
  const s = String(raw == null ? '' : raw)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 14)
    .trim();
  return s || fallback;
}

/** 下一个可用 id（p1 / p2 …，删掉中间一组也不会撞号） */
export function nextNotePageId(book: NoteBook | null): string {
  const used = new Set((((book && book.pages) || []) as NotePage[]).map((p) => String(p.id || '')));
  for (let i = 1; i <= 999; i++) {
    const id = 'p' + i;
    if (!used.has(id)) return id;
  }
  return 'p' + Date.now();
}

export function noteBookIndexOf(book: NoteBook | null, id: string): number {
  const pages = (book && book.pages) || [];
  for (let i = 0; i < pages.length; i++) if (pages[i].id === id) return i;
  return -1;
}

/** 取当前这一组（book 意外为空时给一张空纸，调用方不用到处判空） */
export function noteBookActive(book: NoteBook | null): NotePage {
  const pages = (book && book.pages) || [];
  const i = noteBookIndexOf(book, book ? String(book.active) : '');
  return i >= 0 ? pages[i] : pages[0];
}

function normalizeNotePage(raw: any, index: number): NotePage {
  const o = raw && typeof raw === 'object' ? raw : {};
  const html = typeof o.html === 'string' ? o.html : plainTextToHtml(o.text);
  return {
    id: String(o.id || 'p' + (index + 1)),
    title: clampTabTitle(o.title, `便签 ${index + 1}`),
    color: normalizeNoteColor(o.color, noteTabColor(index)),
    html,
    text: typeof o.text === 'string' ? o.text : '',
    updatedAt: Number(o.updatedAt) || 0,
  };
}

/**
 * 把磁盘上（或渲染进程报上来）的原始数据整理成一本便签。
 * 老版本只有一个 note.html / note.txt，没有 notes.json —— 这种情况下喂 legacyHtml/legacyText 进来，
 * 会被升成「便签 1」，老内容一条都不丢。
 */
export function normalizeNoteBook(raw: any, legacyHtml = '', legacyText = ''): NoteBook {
  const list: any[] = raw && Array.isArray(raw.pages) ? raw.pages : [];
  let pages: NotePage[] = list.map((p: any, i: number) => normalizeNotePage(p, i));
  // id 去重：手改过文件、或迁移时撞号，重排成不重复的 id（否则切换标签会切错页）
  const seen = new Set<string>();
  pages.forEach((p, i) => {
    let id = p.id;
    let k = 2;
    while (seen.has(id)) id = p.id + '_' + k++;
    seen.add(id);
    p.id = id;
  });
  if (!pages.length) {
    pages = [
      {
        id: 'p1',
        title: '便签 1',
        color: noteTabColor(0),
        html: sanitizeNoteHtml(legacyHtml || ''),
        text: String(legacyText || ''),
        updatedAt: 0,
      },
    ];
  }
  if (pages.length > NOTE_PAGES_MAX) pages = pages.slice(0, NOTE_PAGES_MAX);
  const wanted = String((raw && raw.active) || '');
  const active = pages.some((p) => p.id === wanted) ? wanted : pages[0].id;
  return { active, pages };
}

/** 新建一组标签并切过去；已经到上限就原样返回（调用方按 length 判断有没有加成） */
export function addNotePage(book: NoteBook | null): NoteBook {
  const b = normalizeNoteBook(book);
  if (b.pages.length >= NOTE_PAGES_MAX) return b;
  const id = nextNotePageId(b);
  const page: NotePage = {
    id,
    title: nextNoteTitle(b),
    color: noteTabColor(b.pages.length),
    html: '',
    text: '',
    updatedAt: Date.now(),
  };
  return { active: id, pages: b.pages.concat(page) };
}

/** 删一组标签；只剩一组时不动（不然便签就没有正文可写了） */
export function removeNotePage(book: NoteBook | null, id: string): NoteBook {
  const b = normalizeNoteBook(book);
  if (b.pages.length <= 1) return b;
  const idx = noteBookIndexOf(b, id);
  if (idx < 0) return b;
  const pages = b.pages.filter((p) => p.id !== id);
  // 删的就是当前这组 → 落到同位置的下一组（没有就前一组）
  const active = b.active === id ? pages[Math.min(idx, pages.length - 1)].id : b.active;
  return { active, pages };
}

/** 改一组标签（改名 / 换色 / 换正文），只过滤被改的那一页，别的不重复跑 sanitize */
export function patchNotePage(book: NoteBook | null, id: string, patch: Partial<NotePage>): NoteBook {
  const b = normalizeNoteBook(book);
  const pages = b.pages.map((p) => {
    if (p.id !== id) return p;
    const next: NotePage = { ...p };
    if (patch.title != null) next.title = clampTabTitle(patch.title, p.title);
    if (patch.color != null) next.color = normalizeNoteColor(patch.color, p.color);
    if (patch.html != null) next.html = sanitizeNoteHtml(patch.html);
    if (patch.text != null) next.text = String(patch.text);
    next.updatedAt = Date.now();
    return next;
  });
  return { active: b.active, pages };
}

/** 切到某一组（id 不存在就不动） */
export function setActiveNotePage(book: NoteBook | null, id: string): NoteBook {
  const b = normalizeNoteBook(book);
  if (noteBookIndexOf(b, String(id)) < 0) return b;
  return { active: String(id), pages: b.pages };
}

/** 字数：去掉空白后按字符算（中文按字、英文按字母，够用就好） */
export function noteCharCount(text: unknown): number {
  return String(text == null ? '' : text).replace(/\s+/g, '').length;
}

/**
 * 历史文件的兼容读法：
 * 老文件是「一维数组」→ 全部归到第一组标签；
 * 新文件是 { pages: { p1: [...], p2: [...] } }。
 */
export function normalizeHistoryMap(raw: any, firstPageId = 'p1'): NoteHistoryMap {
  const out: NoteHistoryMap = {};
  const collect = (arr: any): NoteHistoryEntry[] =>
    Array.isArray(arr)
      ? arr
          .map(normalizeHistoryEntry)
          .filter((x): x is NoteHistoryEntry => !!x)
          .slice(0, NOTE_HISTORY_MAX)
      : [];
  if (Array.isArray(raw)) {
    const list = collect(raw);
    if (list.length) out[firstPageId] = list;
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const src = raw.pages && typeof raw.pages === 'object' ? raw.pages : raw;
  Object.keys(src).forEach((k) => {
    const list = collect(src[k]);
    if (list.length) out[k] = list;
  });
  return out;
}

/** 丢掉已经不存在的标签的历史（删了标签，历史也别留着占地方） */
export function pruneHistoryMap(map: NoteHistoryMap, keepIds: string[]): NoteHistoryMap {
  const keep = new Set(keepIds);
  const out: NoteHistoryMap = {};
  Object.keys(map || {}).forEach((k) => {
    if (keep.has(k) && Array.isArray(map[k]) && map[k].length) out[k] = map[k];
  });
  return out;
}
