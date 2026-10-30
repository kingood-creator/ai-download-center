// 网页元信息解析（纯函数，不依赖 Electron / 网络，方便单元测试）
// 只做「从 HTML 文本里挑标题和图标候选」以及「按字节判断图片格式」这类确定性工作。

/** 解码常见的 HTML 实体（标题里经常出现 &amp; &#39; 之类） */
export function decodeEntities(s: string): string {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeChar(parseInt(d, 10)));
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** 解析一个标签里的所有 属性名=值（值可带双引号/单引号/裸值） */
export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '';
    out[name] = value;
  }
  return out;
}

function tidyTitle(s: string): string {
  return decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, 80);
}

function metas(html: string): Record<string, string>[] {
  const list: Record<string, string>[] = [];
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) list.push(parseAttrs(m[0]));
  return list;
}

/** 页面标题：og:title > twitter:title > <title> > og:site_name */
export function pickTitle(html: string): string {
  const ms = metas(html);
  const byKey = (keys: string[]): string => {
    for (const k of keys) {
      for (const a of ms) {
        const key = (a.property || a.name || '').toLowerCase();
        if (key === k && a.content && a.content.trim()) return a.content;
      }
    }
    return '';
  };
  const og = byKey(['og:title', 'twitter:title']);
  if (og) return tidyTitle(og);

  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t && t[1].trim()) return tidyTitle(t[1]);

  const site = byKey(['og:site_name', 'application-name']);
  return site ? tidyTitle(site) : '';
}

/** 站点名（用于标题为空时兜底） */
export function pickSiteName(html: string): string {
  for (const a of metas(html)) {
    const key = (a.property || a.name || '').toLowerCase();
    if ((key === 'og:site_name' || key === 'application-name') && a.content) return tidyTitle(a.content);
  }
  return '';
}

/** 从 URL 推一个名字（域名去掉 www. 和端口） */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '') || u.hostname;
  } catch {
    return '';
  }
}

export interface IconCandidate {
  url: string;
  score: number;
}

/**
 * 收集 favicon 候选：apple-touch-icon 优先，sizes 越大越优先，svg 略加权重；
 * 最后总是补一个 /favicon.ico 作为兜底。
 */
export function pickIconCandidates(html: string, pageUrl: string): string[] {
  const list: IconCandidate[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const a = parseAttrs(m[0]);
    const rel = (a.rel || '').toLowerCase();
    if (!rel.includes('icon')) continue;
    if (!a.href) continue;

    let score = 10;
    if (rel.includes('apple-touch-icon')) score += 80;
    else if (rel.includes('mask-icon')) score += 5;
    if (rel.includes('shortcut')) score += 2;

    const sizes = (a.sizes || '').toLowerCase();
    const sz = parseInt(sizes, 10);
    if (Number.isFinite(sz)) score += Math.min(sz, 256) / 8;
    if (sizes.includes('any')) score += 2;
    if (/\.svg(\?|#|$)/i.test(a.href) || (a.type || '').includes('svg')) score += 4;
    if (/^data:/i.test(a.href)) continue;

    const abs = resolveUrl(a.href, pageUrl);
    if (abs) list.push({ url: abs, score });
  }

  list.sort((x, y) => y.score - x.score);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c.url);
  }
  const fallback = resolveUrl('/favicon.ico', pageUrl);
  if (fallback && !seen.has(fallback)) out.push(fallback);
  return out;
}

/** 相对路径 → 绝对 URL；只允许 http(s) */
export function resolveUrl(href: string, base: string): string {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

/** 按文件头判断图片格式（有些站点返回 application/octet-stream，靠 MIME 不可靠） */
export function sniffImageExt(buf: Uint8Array): string | null {
  if (!buf || buf.length < 4) return null;
  const b = buf;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b.length >= 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') return 'webp';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 256)).trim().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!--')) {
    if (head.includes('<svg') || head.includes('<?xml')) return 'svg';
  }
  return null;
}
