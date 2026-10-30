// macOS 本机应用扫描 + 原生图标解析（带内存缓存）
//
// 作用一：把这台机器上真实装了的应用列出来，设置页「项目库」里单列一节「本机应用」，
//         图标直接取 .app 里的 icns（就是 Finder / 启动台里那个样子）。
// 作用二：给预制项目库里的 app/file 条目补原生图标路径（读不到就退回 emoji）。
// 缓存 key 用「路径 + mtime」，应用升级换了图标会自动失效重读。
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { MAC_APP_DIRS, appBundleName, appDisplayName, expandHome, resolveInstalledApp } from '../shared/macapps';
import { probeLocalIcon } from './FileIcon';
import { log } from './Logging';

export interface InstalledApp {
  /** 展示名（中文名映射在 macapps.ts 的 APP_DISPLAY_NAMES 里） */
  name: string;
  /** .app 的绝对路径 */
  path: string;
  /** bundle 名，如 Notes.app */
  bundle: string;
  /** macOS 自带（在 /System 下），项目库里归到「mac 系统」分类 */
  system?: boolean;
  /** 原生图标 PNG 缓存路径（异步解析，可能为空） */
  icon?: string;
}

/** 扫描顺序即展示顺序：用户装的 → 系统 → 系统工具 → 系统核心 */
const SCAN_DIRS = MAC_APP_DIRS;

function statSafe(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** 这些 bundle 不是给用户点的（后台服务 / 卸载器 / 升级包） */
function isIgnorableBundle(name: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith('.')) return true;
  return /(uninstaller|updater|helper|daemon|agent|installer\.app)/.test(n);
}

/** 同步扫描（只列路径，不碰图标，很快） */
export function listInstalledApps(home = os.homedir()): InstalledApp[] {
  const out: InstalledApp[] = [];
  const seen = new Set<string>();
  for (const rawDir of SCAN_DIRS) {
    const dir = rawDir.startsWith('~') ? expandHome(rawDir, home) : rawDir;
    if (!dir) continue;
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // 目录不存在 / 没权限，正常跳过
    }
    for (const n of names) {
      if (!/\.app$/i.test(n)) continue;
      if (isIgnorableBundle(n)) continue;
      const p = path.posix.join(dir, n);
      if (seen.has(p)) continue;
      const st = statSafe(p);
      if (!st || !st.isDirectory()) continue;
      seen.add(p);
      out.push({ name: appDisplayName(n), path: p, bundle: n, system: p.startsWith('/System/') });
    }
  }
  return out;
}

/** 图标缓存：appPath -> { key, icon } */
const iconMemo = new Map<string, { key: string; icon: string }>();

/** 落盘缓存（userData/app-icon-cache.json）：解 icns 是 CPU 活，第一次之后直接读缓存 */
let diskLoaded = false;
let diskDirty = false;

function cacheFile(): string {
  try {
    return path.join(app.getPath('userData'), 'app-icon-cache.json');
  } catch {
    return '';
  }
}

function loadDiskCache(): void {
  if (diskLoaded) return;
  diskLoaded = true;
  const f = cacheFile();
  if (!f) return;
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [k, v] of Object.entries(raw || {})) {
      const rec = v as { key?: string; icon?: string };
      if (k && rec?.key && rec?.icon) iconMemo.set(k, { key: rec.key, icon: rec.icon });
    }
  } catch {
    /* 第一次运行 / 文件被删 / 内容坏了：都当空缓存 */
  }
}

function saveDiskCache(): void {
  if (!diskDirty) return;
  const f = cacheFile();
  if (!f) return;
  try {
    const obj: Record<string, { key: string; icon: string }> = {};
    for (const [k, v] of iconMemo) obj[k] = v;
    fs.writeFileSync(f, JSON.stringify(obj));
    diskDirty = false;
  } catch (e: any) {
    log('app-icon-cache 写入失败: ' + (e?.message || e));
  }
}

function memoKey(appPath: string): string {
  const st = statSafe(appPath);
  return st ? `${st.mtimeMs}:${st.size}` : '';
}

/** 取某个 .app 的原生图标路径；读不到返回空串（调用方退回 emoji） */
export async function appIconPath(appPath: string): Promise<string> {
  const p = String(appPath || '').trim().replace(/\/+$/, '');
  if (!p) return '';
  loadDiskCache();
  const key = memoKey(p);
  const hit = iconMemo.get(p);
  // 缓存命中：图标文件还在就直接用（应用升级后 mtime 变了会自动重读）
  if (hit && hit.key === key && fs.existsSync(hit.icon)) return hit.icon;
  try {
    const r = await probeLocalIcon(p, 'app');
    const icon = r && r.ok && r.iconPath ? r.iconPath : '';
    if (icon) {
      iconMemo.set(p, { key, icon });
      diskDirty = true;
    }
    return icon;
  } catch (e: any) {
    log('appIcon 失败: ' + (e?.message || e));
    return '';
  }
}

/** 并发受控地跑一批异步任务（图标解码是 CPU 活，别一次全怼上去） */
async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, list.length || 1))).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 扫描 + 解析图标（并发 4）；limit 用于避免一次打开就解压上百个 icns */
export async function listInstalledAppsWithIcons(home = os.homedir(), limit = 120): Promise<InstalledApp[]> {
  const apps = listInstalledApps(home).slice(0, limit);
  await mapLimit(apps, 4, async (a) => {
    a.icon = await appIconPath(a.path);
    return null;
  });
  saveDiskCache();
  return apps;
}

/**
 * 给预制项目库补原生图标：app 条目按 bundle 解析真实路径，file 条目读系统文件夹图标。
 * 解析不到路径的第三方应用直接丢掉（没装就别摆出来让用户点了个寂寞）。
 */
export async function resolvePresetIcons(list: any[], home = os.homedir()): Promise<any[]> {
  const exists = (p: string): boolean => !!statSafe(p);
  const kept: any[] = [];
  for (const it of list) {
    const item = { ...it };
    if (item.type === 'app') {
      const bundle = String(item.appBundle || appBundleName(item.target) || '');
      const resolved =
        (it.target && exists(expandHome(it.target, home)) ? expandHome(it.target, home) : null) ||
        (bundle ? resolveInstalledApp(bundle, exists, home) : null);
      if (!resolved) continue; // 没装：不展示
      item.target = resolved;
      item.bundle = bundle || appBundleName(resolved);
    }
    kept.push(item);
  }
  await mapLimit(kept, 4, async (it) => {
    if (it.type === 'app') {
      it.iconPath = await appIconPath(it.target);
      return null;
    }
    if (it.type === 'file') {
      try {
        const r = await probeLocalIcon(it.target, 'file');
        if (r && r.ok && r.iconPath) it.iconPath = r.iconPath;
      } catch {
        /* ignore */
      }
      return null;
    }
    return null;
  });
  saveDiskCache();
  return kept;
}
