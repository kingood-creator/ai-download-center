// 网页探测：抓标题 / favicon，并把图标落盘到本地（离线也能显示，不依赖远程可用性）
import { net } from 'electron';
import { isHttpUrl } from '../shared/validation';
import { pickTitle, pickSiteName, nameFromUrl, pickIconCandidates, sniffImageExt } from '../shared/webmeta';
import { saveIcon } from './IconStore';
import { log } from './Logging';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 1024 * 1024; // 读页面头部 1MB 足够拿到 <head>
const MAX_ICON_BYTES = 1024 * 1024;

export interface WebProbeResult {
  ok: boolean;
  /** 用户输入的 URL（补全协议后的实际请求地址） */
  url?: string;
  /** 跟随跳转后的最终地址 */
  finalUrl?: string;
  title?: string;
  siteName?: string;
  iconUrl?: string;
  /** 图标已下载到本地的绝对路径（优先使用它） */
  iconPath?: string;
  error?: string;
}

/** 给「只输入域名」的输入补上 https:// */
export function normalizeUrl(input: string): string {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return ''; // 其它协议一律拒绝
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(s)) return 'https://' + s;
  return '';
}

async function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await net.fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 只读响应体的前 max 字节，避免被超大页面拖死 */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (!res.body) {
    const ab = await res.arrayBuffer();
    return Buffer.from(ab).subarray(0, max);
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
      if (total >= max) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, max);
}

/** 依次尝试候选图标地址，第一个能下载且能识别格式的胜出 */
async function downloadIcon(candidates: string[]): Promise<{ iconUrl: string; iconPath: string } | null> {
  for (const url of candidates.slice(0, 4)) {
    try {
      const res = await fetchWithTimeout(url, 'image/*,*/*;q=0.8');
      if (!res.ok) continue;
      const buf = await readCapped(res, MAX_ICON_BYTES);
      if (buf.length < 8) continue;
      const ext = sniffImageExt(buf);
      if (!ext) continue;
      const saved = saveIcon(buf, ext);
      if (saved) return { iconUrl: url, iconPath: saved };
      return { iconUrl: url, iconPath: '' };
    } catch (e: any) {
      log(`图标候选失败 ${url}: ${e?.message || e}`);
    }
  }
  return null;
}

/**
 * 探测一个网址：返回标题 + 本地图标路径。
 * 页面打不开时仍尝试 /favicon.ico，并用域名兜底一个名称，尽量不让用户空手而归。
 */
export async function probeWeb(rawUrl: string): Promise<WebProbeResult> {
  const url = normalizeUrl(rawUrl);
  if (!url || !isHttpUrl(url)) {
    return { ok: false, error: '请填写以 http:// 或 https:// 开头的网址' };
  }

  let html = '';
  let finalUrl = url;
  let pageError = '';
  try {
    const res = await fetchWithTimeout(url, 'text/html,application/xhtml+xml');
    finalUrl = res.url || url;
    if (!res.ok) {
      pageError = `网页返回 ${res.status}`;
    } else {
      const buf = await readCapped(res, MAX_HTML_BYTES);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      // 不是 HTML（比如直接指向图片/PDF）时不做文本解析
      if (!ct || ct.includes('html') || ct.includes('xml') || ct.includes('text/plain')) {
        html = buf.toString('utf-8');
      }
    }
  } catch (e: any) {
    pageError = e?.name === 'AbortError' ? '请求超时' : e?.message || String(e);
  }

  let title = '';
  let siteName = '';
  const candidates: string[] = [];
  if (html) {
    try {
      title = pickTitle(html);
      siteName = pickSiteName(html);
      candidates.push(...pickIconCandidates(html, finalUrl));
    } catch (e: any) {
      log('HTML 解析失败: ' + (e?.message || e));
    }
  }
  if (!candidates.length) {
    const fb = new URL('/favicon.ico', finalUrl).toString();
    candidates.push(fb);
  }

  let icon: { iconUrl: string; iconPath: string } | null = null;
  try {
    icon = await downloadIcon(candidates);
  } catch (e: any) {
    log('图标下载失败: ' + (e?.message || e));
  }

  let name = title || siteName || nameFromUrl(finalUrl);
  // 标题常常是「首页 - 站点名」这种，太长的截断
  if (name.length > 40) name = name.slice(0, 40).trim();

  const result: WebProbeResult = {
    ok: !!(name || icon),
    url,
    finalUrl,
    title: title || '',
    siteName: siteName || '',
    iconUrl: icon?.iconUrl,
    iconPath: icon?.iconPath || '',
    error: pageError || (icon ? '' : '未能读取到图标'),
  };
  log(`web:probe ${url} -> title="${result.title}" icon=${result.iconPath ? 'local' : 'none'} err=${result.error || '-'}`);
  return result;
}
