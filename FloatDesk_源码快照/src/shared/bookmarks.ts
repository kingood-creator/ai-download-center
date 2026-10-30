// 浏览器书签导入的纯逻辑：解析各浏览器导出的 Netscape 书签 HTML（Chrome / Edge / Firefox / Safari 通用格式）。
// 放在 shared 是为了能在纯 node 下单测；主进程只负责「选文件 + 读文件」，解析全在这里。
//
// 这个格式长这样（各家略有差异，但骨架相同）：
//   <DL><p>
//     <DT><H3 ADD_DATE="...">书签栏</H3>
//     <DL><p>
//       <DT><A HREF="https://github.com" ADD_DATE="..." ICON="data:image/png;base64,...">GitHub</A>
//       <DT><H3>子文件夹</H3>
//       <DL><p> ... </DL><p>
//     </DL><p>
//   </DL><p>
// 所以解析思路是：顺序扫 <H3> / <A> / <DL> / </DL>，用栈记住「当前在哪个文件夹里」。
// 不用 DOM 解析器（主进程里没有 DOM），也不追求严格 HTML 语义 —— 只认这四种标记，容错优先。

/** 一个书签节点（文件夹或链接） */
export interface BookmarkNode {
  /** 解析时分配的序号，前端勾选/折叠用（同一次解析内唯一） */
  id: number;
  type: 'folder' | 'link';
  name: string;
  /** link 才有：已规整的网址 */
  url?: string;
  /** 浏览器导出里自带的小图标（Chrome/Edge 会给 data:image/png;base64,...） */
  icon?: string;
  /** 文件夹才有 */
  children?: BookmarkNode[];
  /** 层级深度（顶层文件夹 = 1） */
  depth: number;
  /** 从根到父级的文件夹名链（用来做「书签栏 / 技术 / 前端」这类定位，也当检索关键词） */
  path: string[];
}

export interface BookmarkParseResult {
  /** 顶层节点（通常是「书签栏」「其他书签」等几个文件夹） */
  nodes: BookmarkNode[];
  /** 解析到的链接总数 */
  links: number;
  /** 文件夹总数 */
  folders: number;
  /** 被跳过的链接数（非 http(s) / 空地址 / 解析不出地址） */
  skipped: number;
}

function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => {
      const n = Number(d);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/** 名字清洗：去标签、解实体、压空白、控长 */
export function cleanBookmarkTitle(raw: unknown, url?: string, max = 80): string {
  let s = String(raw == null ? '' : raw).replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s && url) s = hostOf(url);
  if (s.length > max) s = s.slice(0, max).trim() + '…';
  return s;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * 网址规整：
 * · 只接受 http / https（书签里混着的 javascript:、place:、chrome://、about: 一律跳过）
 * · 裸域名补 https://
 * · 去首尾空白与内部换行
 */
export function normalizeBookmarkUrl(raw: unknown): string | null {
  let s = String(raw == null ? '' : raw).replace(/[\r\n\t]+/g, '').trim();
  if (!s) return null;
  s = decodeEntities(s);
  if (/^(javascript|place|data|about|chrome|edge|view-source|file):/i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(s)) s = 'https://' + s;
    else return null;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** 从一段标签属性串里取属性值（HREF="..." / HREF='...' / HREF=...） */
function attrOf(attrs: string, name: string): string {
  const re = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = re.exec(attrs || '');
  if (!m) return '';
  return m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] || '';
}

/**
 * 解析书签 HTML。容错优先：
 * · 各家导出的 <DT> 可大写可小写、可带属性、可省略闭合
 * · 缺 </DL> 或多余的 </DL> 都不会抛错
 * · 文件夹名会被当成 path，深层嵌套也不会乱
 */
export function parseBookmarkHtml(html: string): BookmarkParseResult {
  const src = String(html == null ? '' : html);
  const nodes: BookmarkNode[] = [];
  let links = 0;
  let folders = 0;
  let skipped = 0;
  let seq = 0;

  // 当前挂载点（某个文件夹的 children，或顶层 nodes）
  let current: BookmarkNode[] = nodes;
  // 当前文件夹链（用于 path / depth）
  let pathNames: string[] = [];
  // 等待 <DL> 的文件夹（<H3> 之后紧跟着的那个 <DL> 才是它的内容）
  let pending: BookmarkNode | null = null;
  // <DL> → 进入的上下文（回来时恢复）
  const stack: { list: BookmarkNode[]; path: string[] }[] = [];

  // 一次扫完：把 H3 / A / <DL / </DL> 按出现顺序切开
  const tokenRe = /<h3\b([^>]*)>([\s\S]*?)<\/h3\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>|<\s*dl\b[^>]*>|<\s*\/\s*dl\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(src))) {
    const whole = m[0];
    if (/^<\s*\/\s*dl/i.test(whole)) {
      // 出栈：回到上一层
      const up = stack.pop();
      if (up) {
        current = up.list;
        pathNames = up.path;
      }
      pending = null;
      continue;
    }
    if (/^<\s*dl/i.test(whole)) {
      // 进栈：如果前面刚有个 <H3>，内容归它；否则是「无名容器」（顶层）
      stack.push({ list: current, path: pathNames });
      if (pending) {
        current = pending.children as BookmarkNode[];
        pathNames = pathNames.concat(pending.name);
        pending = null;
      }
      continue;
    }
    if (m[1] !== undefined) {
      // 文件夹
      const name = cleanBookmarkTitle(m[2]) || '未命名文件夹';
      const node: BookmarkNode = {
        id: ++seq,
        type: 'folder',
        name,
        children: [],
        depth: pathNames.length + 1,
        path: pathNames.slice(),
      };
      current.push(node);
      folders++;
      pending = node;
      continue;
    }
    // 链接
    const attrs = m[3] || '';
    const rawTitle = m[4] || '';
    const url = normalizeBookmarkUrl(attrOf(attrs, 'href'));
    if (!url) {
      skipped++;
      continue;
    }
    const icon = attrOf(attrs, 'icon');
    const node: BookmarkNode = {
      id: ++seq,
      type: 'link',
      name: cleanBookmarkTitle(rawTitle, url),
      url,
      depth: pathNames.length + 1,
      path: pathNames.slice(),
    };
    if (/^data:image\//i.test(icon)) node.icon = icon;
    current.push(node);
    links++;
  }

  return { nodes, links, folders, skipped };
}

/** 扁平化所有链接（保留所属文件夹路径，导入时用得上） */
export function flattenBookmarks(nodes: BookmarkNode[]): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  const walk = (list: BookmarkNode[]): void => {
    list.forEach((n) => {
      if (n.type === 'link') out.push(n);
      else if (n.children) walk(n.children);
    });
  };
  walk(Array.isArray(nodes) ? nodes : []);
  return out;
}

/** 所有文件夹（按名字排好），给「按文件夹选」这类 UI 用 */
export function listBookmarkFolders(nodes: BookmarkNode[]): { path: string; name: string; count: number }[] {
  const out: { path: string; name: string; count: number }[] = [];
  const walk = (list: BookmarkNode[], parent: string[]): void => {
    list.forEach((n) => {
      if (n.type !== 'folder') return;
      const p = parent.concat(n.name);
      const key = p.join(' / ');
      out.push({ path: key, name: n.name, count: flattenBookmarks(n.children || []).length });
      walk(n.children || [], p);
    });
  };
  walk(Array.isArray(nodes) ? nodes : [], []);
  return out;
}

/** 文件夹里（含子文件夹）的链接数：勾选状态用 */
export function countLinks(node: BookmarkNode): number {
  if (node.type === 'link') return 1;
  return flattenBookmarks(node.children || []).length;
}

/**
 * 按名字 / 网址 / 文件夹筛选（前端检索框用）。
 * 返回新的树：命中的链接保留，文件夹只要有命中子项就保留。
 */
export function filterBookmarks(nodes: BookmarkNode[], q: string): BookmarkNode[] {
  const ql = String(q || '').trim().toLowerCase();
  if (!ql) return nodes;
  const walk = (list: BookmarkNode[]): BookmarkNode[] => {
    const out: BookmarkNode[] = [];
    list.forEach((n) => {
      if (n.type === 'link') {
        const hay = (n.name + ' ' + (n.url || '') + ' ' + n.path.join(' ')).toLowerCase();
        if (hay.includes(ql)) out.push(n);
      } else {
        const kids = walk(n.children || []);
        if (kids.length) out.push({ ...n, children: kids });
      }
    });
    return out;
  };
  return walk(Array.isArray(nodes) ? nodes : []);
}
