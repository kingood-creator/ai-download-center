// 本地目标的图标读取
//
// 为什么不用 Electron 的 app.getFileIcon：实测在部分环境下它会直接把主进程打死（SIGTRAP），
// 应用图标这种「锦上添花」的功能不该有让整个程序崩掉的风险，所以这里改成自己解析：
//   · 应用（.app）：读 Contents/Info.plist 的 CFBundleIconFile → Resources/*.icns →
//     抽里面最大的内嵌 PNG（现代图标都是 PNG）；老式 icns 再退一步用系统 sips 转一次
//   · 图片：直接用这张图当图标（本地文件或 http(s) URL 都行）
//   · 其它文件：按扩展名给常用图标（xlsx → 📊、pdf → 📕、mp4 → 🎬 …），目录 → 📁
// 外部命令一律用 execFile + 参数数组，不经过 shell，不做字符串拼接。
import { execFile } from 'child_process';
import { nativeImage } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isHttpUrl } from '../shared/validation';
import { extractPngFromIcns, looksLikeIcns } from '../shared/icns';
import { defaultIconForType, iconForPath, isImagePath } from '../shared/icons';
import {
  coreTypesIconPath,
  documentIconName,
  expandHome,
  folderIconName,
  resolveInstalledApp,
} from '../shared/macapps';
import { saveIcon } from './IconStore';
import { log } from './Logging';

export type LocalIconKind = 'app' | 'file' | 'image';

export interface LocalIconResult {
  ok: boolean;
  /** 图片路径或远程 URL（本地的一律已落盘到 item-icons） */
  iconPath?: string;
  /** 读不到真图标时的常用图标（emoji），渲染层直接当文字显示 */
  iconText?: string;
  /** 由目标路径推导的建议名称（.app 会去掉后缀） */
  name?: string;
  /** 纠正后的真实路径（老配置指向了旧目录时会带回来，供调用方修正配置） */
  target?: string;
  /** 实际拿到的图标像素尺寸，便于排查「为什么图标是糊的」 */
  size?: { width: number; height: number };
  /** 图标来源，仅用于日志/排查 */
  source?: 'icns-png' | 'icns-sips' | 'self' | 'ext';
  error?: string;
}

/** /Applications/微信.app → 微信；/a/b/报价单.xlsx → 报价单.xlsx */
export function suggestName(target: string): string {
  const clean = String(target || '').replace(/\/+$/, '');
  const base = path.basename(clean);
  if (/\.app$/i.test(base)) {
    const noExt = base.replace(/\.app$/i, '');
    if (noExt) return noExt;
  }
  return base;
}

function statSafe(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** execFile 包装：永不抛错，失败返回空串 */
function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

/** 读 Info.plist 里的 CFBundleIconFile（plutil 能吃二进制 plist，比手写解析稳） */
async function bundleIconName(appPath: string): Promise<string> {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  if (!statSafe(plist)) return '';
  const out = await run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist]);
  return out.trim().replace(/^"|"$/g, '');
}

/** 在 .app 里找到实际的 .icns 文件；找不到返回空串 */
async function findIcns(appPath: string): Promise<string> {
  const resDir = path.join(appPath, 'Contents', 'Resources');
  if (!statSafe(resDir)) return '';

  const declared = await bundleIconName(appPath);
  if (declared) {
    for (const name of [declared, `${declared}.icns`]) {
      const p = path.join(resDir, name);
      if (statSafe(p) && !statSafe(p)!.isDirectory()) return p;
    }
  }

  // 兜底：扫 Resources 下的 .icns，优先与应用同名，其次挑体积最大的
  let files: string[] = [];
  try {
    files = fs.readdirSync(resDir).filter((f) => /\.icns$/i.test(f));
  } catch {
    return '';
  }
  if (!files.length) return '';
  const appName = path.basename(appPath).replace(/\.app$/i, '').toLowerCase();
  const sameName = files.find((f) => f.toLowerCase().replace(/\.icns$/, '') === appName);
  if (sameName) return path.join(resDir, sameName);
  const sized = files
    .map((f) => {
      const p = path.join(resDir, f);
      const st = statSafe(p);
      return { p, size: st ? st.size : 0 };
    })
    .sort((a, b) => b.size - a.size);
  return sized[0] ? sized[0].p : '';
}

/** 用系统 sips 把 icns 转 PNG（老式图标没有内嵌 PNG 时的兜底） */
async function icnsViaSips(icnsPath: string): Promise<Buffer | null> {
  const tmp = path.join(os.tmpdir(), `floatdesk-icon-${process.pid}-${Date.now()}.png`);
  try {
    await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '512', icnsPath, '--out', tmp]);
    if (!statSafe(tmp)) return null;
    const buf = fs.readFileSync(tmp);
    return buf.length > 8 ? buf : null;
  } finally {
    try {
      if (statSafe(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function pngSize(buf: Buffer): { width: number; height: number } | undefined {
  // PNG: 8 字节签名 + IHDR(长度4+类型4) + 宽4 + 高4
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * 应用图标的原始表示常有 1024×1024（一张 PNG 就几百 KB）。菜单里最多显示 64px，
 * 没必要把原图整个塞进缓存和显存，这里统一降到 256px（仍远大于任何显示尺寸）。
 */
function shrinkPng(buf: Buffer, max = 256): Buffer {
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return buf;
    const { width, height } = img.getSize();
    if (!width || !height || Math.max(width, height) <= max) return buf;
    const scale = max / Math.max(width, height);
    const out = img
      .resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' })
      .toPNG();
    return out && out.length ? out : buf;
  } catch {
    return buf;
  }
}

/** icns 路径 → 已落盘的 PNG 图标（缓存：同一个 icns 只解一次） */
const icnsMemo = new Map<string, { key: string; iconPath: string }>();

async function icnsToIcon(icnsPath: string): Promise<{ iconPath: string; size?: { width: number; height: number }; source: 'icns-png' | 'icns-sips' } | null> {
  const p = String(icnsPath || '').trim();
  if (!p) return null;
  const st = statSafe(p);
  const key = st ? `${st.mtimeMs}:${st.size}` : '';
  const hit = icnsMemo.get(p);
  if (hit && hit.key === key && statSafe(hit.iconPath)) {
    return { iconPath: hit.iconPath, source: 'icns-png' };
  }

  let buf: Buffer | null = null;
  try {
    buf = fs.readFileSync(p);
  } catch {
    return null;
  }
  const png = looksLikeIcns(buf) ? extractPngFromIcns(buf) : null;
  if (png) {
    const small = shrinkPng(png);
    const saved = saveIcon(small, 'png');
    if (saved) {
      icnsMemo.set(p, { key, iconPath: saved });
      return { iconPath: saved, size: pngSize(small), source: 'icns-png' };
    }
  }
  // 老式 icns（RLE 裸 RGB）→ 交给 sips
  const converted = await icnsViaSips(p);
  if (converted) {
    const small = shrinkPng(converted);
    const saved = saveIcon(small, 'png');
    if (saved) {
      icnsMemo.set(p, { key, iconPath: saved });
      return { iconPath: saved, size: pngSize(small), source: 'icns-sips' };
    }
  }
  return null;
}

async function readAppIcon(appPath: string): Promise<LocalIconResult> {
  const icns = await findIcns(appPath);
  if (!icns) return { ok: false, iconText: defaultIconForType('app'), error: '这个应用里没找到图标文件' };
  const r = await icnsToIcon(icns);
  if (r) return { ok: true, iconPath: r.iconPath, size: r.size, source: r.source };
  return { ok: false, iconText: defaultIconForType('app'), error: '图标解析失败，可手动选一张图' };
}

/**
 * 目录 → macOS 原生文件夹图标（CoreTypes 里 Finder 同款那套）。
 * 这是「调用原生图标」的关键一步：下载/桌面/文稿/图片/音乐/影片/公共/应用程序
 * 各有自己的系统图标，不再一律用 📁 表情。
 */
async function readFolderIcon(folderPath: string): Promise<LocalIconResult | null> {
  const name = folderIconName(folderPath, os.homedir());
  if (!name) return null;
  const icns = coreTypesIconPath(name);
  if (!statSafe(icns)) return null;
  const r = await icnsToIcon(icns);
  if (!r) return null;
  return { ok: true, iconPath: r.iconPath, size: r.size, source: r.source };
}

/** 普通文件 → 系统通用文档图标（扩展名 emoji 更有信息量的情况由调用方决定） */
export async function documentIconPath(): Promise<string> {
  const icns = coreTypesIconPath(documentIconName());
  if (!statSafe(icns)) return '';
  const r = await icnsToIcon(icns);
  return r ? r.iconPath : '';
}

/**
 * 读取一个本地目标的图标。目标不存在时如实返回错误（调用方保留用户手填的图标）。
 *
 * 「路径失效但应用还在」的情况会自动纠正：老配置里的 /Applications/Notes.app
 * 在现在的 macOS 上其实是 /System/Applications/Notes.app，这里按 bundle 名重新定位，
 * 返回的 name/target 里带上真实路径，调用方据此把配置修正过来。
 */
export async function probeLocalIcon(target: string, kind: LocalIconKind = 'file'): Promise<LocalIconResult> {
  const t0 = String(target || '').trim();
  if (!t0) return { ok: false, iconText: defaultIconForType(kind), error: '请先填写路径' };
  const home = os.homedir();
  const t = expandHome(t0, home);
  const name = suggestName(t);

  // ---- 图片：自己就是图标 ----
  if (kind === 'image') {
    if (isHttpUrl(t)) return { ok: true, iconPath: t, name, source: 'self' };
    if (!statSafe(t)) return { ok: false, iconText: '🖼', name, error: '图片路径不存在' };
    return { ok: true, iconPath: t, name, source: 'self' };
  }

  // ---- 应用 ----
  if (kind === 'app') {
    if (!/\.app$/i.test(t)) return { ok: false, iconText: '🧩', name, error: '应用路径应以 .app 结尾' };
    // 路径失效 → 按 bundle 名在标准目录里找回来（macOS 版本间的目录迁移 / 应用搬家）
    const resolved = resolveInstalledApp(t, (p) => !!statSafe(p), home);
    if (!resolved) return { ok: false, iconText: '🧩', name, error: '找不到这个应用（路径不存在）', target: t };
    const r = await readAppIcon(resolved.replace(/\/+$/, ''));
    log(`icon:probe app ${resolved} -> ${r.source || 'none'} ${r.iconPath || ''} ${r.error || ''}`);
    return { ...r, name: suggestName(resolved), target: resolved };
  }

  // ---- 普通文件 / 目录 ----
  const st = statSafe(t);
  if (!st) {
    // 有些老项目把 .app 错标成了「文件」类型，这里也顺手救一下
    if (/\.app$/i.test(t)) {
      const resolved = resolveInstalledApp(t, (p) => !!statSafe(p), home);
      if (resolved) {
        const r = await readAppIcon(resolved.replace(/\/+$/, ''));
        if (r.ok) return { ...r, name: suggestName(resolved), target: resolved };
      }
    }
    return { ok: false, iconText: '📄', name, error: '找不到这个文件（路径不存在）' };
  }
  // 图片文件还是直接显示这张图，比一个「图片文件」图标有用
  if (!st.isDirectory() && isImagePath(t)) return { ok: true, iconPath: t, name, source: 'self' };
  // 目录 → macOS 原生文件夹图标（下载/桌面/文稿/图片/音乐/影片/公共/应用程序各有自己的图标）
  if (st.isDirectory()) {
    const native = await readFolderIcon(t);
    if (native) return { ...native, name };
  }
  const iconText = iconForPath(t, st.isDirectory());
  log(`icon:probe file ${t} -> ${iconText}`);
  return { ok: true, iconText, name, target: t, source: 'ext' };
}
