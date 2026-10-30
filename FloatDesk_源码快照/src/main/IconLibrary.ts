// 内部图标库：userData/icon-library/ 下的一个普通文件夹。
// 用户可以从 Finder 直接往里扔图标文件（或删改），也可以在设置页里拖放 / 点选 / 删除。
// 与 item-icons（自动读取的缓存）分开：这里是用户自己管的「图标仓库」。
//
// 安全约定：
//   - 外部传入的路径一律先 resolve 再校验必须位于库目录内，杜绝 ../ 越界删除；
//   - 落库前校验扩展名白名单 + 文件头魔数（防止拖个 .txt 进来当图标）；
//   - 单个文件最大 8MB；execFile 一概不用，纯 fs 操作。
import { app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { log } from './Logging';
import { saveIcon } from './IconStore';

const IMAGE_EXTS = ['png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_NAME = 80;

export interface LibIcon {
  /** 文件名（用户在 Finder 里看到的名字） */
  name: string;
  /** 库内绝对路径 */
  path: string;
  /** 字节数 */
  size: number;
  /** 修改时间（ms），列表按它倒序排，新扔进来的排前面 */
  mtime: number;
}

export interface OpResult {
  ok: boolean;
  error?: string;
  path?: string;
  /** true = 库里有同名且内容一致的文件，没有重复写入 */
  dedup?: boolean;
}

/** 图标库目录（不存在则创建） */
export function libDir(): string {
  const dir = path.join(app.getPath('userData'), 'icon-library');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

/** 扩展名是否在图片白名单里（不带点，小写） */
export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.includes(String(ext || '').toLowerCase().replace(/^\./, ''));
}

/**
 * 文件头魔数判定：能当图标用的才收。
 * SVG 是文本，放宽为「含 <svg 或 <?xml」。
 */
export function isImageBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 8) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true; // BMP
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return true; // ICO
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true; // WEBP
  const head = buf.toString('utf-8', 0, Math.min(buf.length, 512)).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return true; // SVG
  return false;
}

/**
 * 把用户提供的文件名清理成安全的库内文件名：
 * 去掉路径部分、控制字符，超长截断，保留扩展名（小写）。
 */
export function sanitizeLibName(raw: string): string {
  let name = path.basename(String(raw || '').trim()).replace(/[\u0000-\u001f\\/]/g, '').trim();
  if (!name) name = 'icon';
  const ext = path.extname(name).toLowerCase();
  // 茎干去掉首尾的点（防止 '..' / '.hidden' 这类怪名字），超长截断
  const stem = (ext ? name.slice(0, -ext.length) : name)
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, MAX_NAME)
    .trim() || 'icon';
  return isImageExt(ext) ? `${stem}${ext}` : `${stem}.png`;
}

/** 目标名已被占用时追加 -2、-3… */
function uniqueName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; i < 999; i++) {
    const cand = `${stem}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, cand))) return cand;
  }
  return `${stem}-${crypto.randomBytes(4).toString('hex')}${ext}`;
}

/** 列出库内全部图标（按修改时间倒序，新扔进来的排前面） */
export function listIcons(): LibIcon[] {
  const dir = libDir();
  const out: LibIcon[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (!st.isFile() || !isImageExt(path.extname(name))) continue;
      out.push({ name, path: p, size: st.size, mtime: st.mtimeMs });
    } catch {
      /* 文件在读列表时被删了，跳过 */
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** 把一段字节写进库（内部共用：路径拖入 / dataURL 拖入都走这里） */
function writeToLib(buf: Buffer, rawName: string): OpResult {
  if (buf.length > MAX_BYTES) return { ok: false, error: `文件太大（>${Math.round(MAX_BYTES / 1024 / 1024)}MB）` };
  if (!isImageBuffer(buf)) return { ok: false, error: '不是可用的图片文件' };
  const dir = libDir();
  const name = sanitizeLibName(rawName);
  const dest = path.join(dir, name);
  // 同名同内容：跳过（重复拖入同一个文件不会堆一份）
  try {
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) {
      return { ok: true, path: dest, dedup: true };
    }
  } catch {
    /* 读不了就按新文件写 */
  }
  const finalName = uniqueName(dir, name);
  const finalPath = path.join(dir, finalName);
  try {
    fs.writeFileSync(finalPath, buf);
    return { ok: true, path: finalPath };
  } catch (e: any) {
    return { ok: false, error: '写入失败: ' + (e?.message || e) };
  }
}

/** 从本地路径添加（Finder 拖入、文件选择） */
export function addIconFromPath(srcPath: string): OpResult {
  const src = path.resolve(String(srcPath || ''));
  if (!src) return { ok: false, error: '路径为空' };
  let st: fs.Stats;
  try {
    st = fs.statSync(src);
  } catch {
    return { ok: false, error: '文件不存在或读不了' };
  }
  if (!st.isFile()) return { ok: false, error: '不是文件' };
  if (st.size > MAX_BYTES) return { ok: false, error: `文件太大（>${Math.round(MAX_BYTES / 1024 / 1024)}MB）` };
  if (!isImageExt(path.extname(src))) return { ok: false, error: '只支持图片文件（png/jpg/gif/webp/svg/bmp/ico）' };
  let buf: Buffer;
  try {
    buf = fs.readFileSync(src);
  } catch (e: any) {
    return { ok: false, error: '读取失败: ' + (e?.message || e) };
  }
  return writeToLib(buf, path.basename(src));
}

/** 从 dataURL 添加（浏览器里直接拖图片过来的兜底，拿不到本地路径时用） */
export function addIconFromData(name: string, dataUrl: string): OpResult {
  const m = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: '不是图片数据' };
  const buf = Buffer.from(String(dataUrl).slice(m[0].length), 'base64');
  if (!buf.length) return { ok: false, error: '图片数据为空' };
  return writeToLib(buf, name || 'dropped.png');
}

/**
 * 使用库里的某个图标：复制一份进 item-icons 缓存，返回缓存路径。
 * 这样用户以后在库里删了这个文件，已经用上的项目也不会变空白。
 */
export function useIcon(libPath: string): OpResult {
  const p = path.resolve(String(libPath || ''));
  if (!isInsideLib(p)) return { ok: false, error: '路径不在图标库内' };
  let buf: Buffer;
  try {
    buf = fs.readFileSync(p);
  } catch (e: any) {
    return { ok: false, error: '读取失败: ' + (e?.message || e) };
  }
  const ext = path.extname(p).replace(/^\./, '').toLowerCase() || 'png';
  const cached = saveIcon(buf, ext);
  if (!cached) return { ok: false, error: '写入图标缓存失败' };
  return { ok: true, path: cached };
}

/** 删除库内图标（路径必须位于库目录内） */
export function deleteIcon(libPath: string): OpResult {
  const p = path.resolve(String(libPath || ''));
  if (!isInsideLib(p)) return { ok: false, error: '路径不在图标库内' };
  try {
    fs.unlinkSync(p);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: '删除失败: ' + (e?.message || e) };
  }
}

/** 在 Finder 里打开图标库文件夹 */
export async function revealLib(): Promise<{ ok: boolean; error?: string }> {
  const dir = libDir();
  try {
    const r = await shell.openPath(dir);
    if (r) return { ok: false, error: r };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 路径是否位于图标库内（拒绝 ../ 越界与软链逃逸的基本校验） */
function isInsideLib(p: string): boolean {
  if (!p) return false;
  const dir = path.resolve(libDir());
  const rel = path.relative(dir, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 诊断信息用：库里有多少个图标、占多少字节 */
export function libStats(): { count: number; bytes: number; dir: string } {
  const icons = listIcons();
  return { count: icons.length, bytes: icons.reduce((s, i) => s + i.size, 0), dir: libDir() };
}
