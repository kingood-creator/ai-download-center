// 老配置的「macOS 化」体检：路径纠正 + 原生图标补齐
//
// 背景：项目库里早期的系统应用路径是 Windows 思维的 /Applications/Notes.app，
// 而现在的 macOS 把这些应用放在 /System/Applications、Utilities、CoreServices 下，
// 于是老配置里的应用既读不到图标也打不开（悬浮球上只剩一个 emoji，点了一点反应都没有）。
// 这里在启动后做一次静默体检：
//   1. app 类型：target 不存在 → 按 bundle 名在标准目录里找回来，改写 target
//   2. app/file 类型：图标还是 emoji / 空 → 读一次原生图标（.app 的 icns、目录的 CoreTypes 图标）
// 只补「没图标」的，绝不动用户手挑的图片图标；补完写盘并广播，界面立即变。
import * as fs from 'fs';
import * as os from 'os';
import { appBundleName, expandHome, resolveInstalledApp } from '../shared/macapps';
import { probeLocalIcon } from './FileIcon';
import { log } from './Logging';

export interface RepairStats {
  /** 纠正了路径的项目数 */
  pathsFixed: number;
  /** 补上原生图标的项目数 */
  iconsFilled: number;
  /** 检查过的项目数 */
  checked: number;
  /** 仍然失效（应用已卸载/文件已删除）的项目名 */
  missing: string[];
}

function statSafe(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** 图标是不是「用户自己的图片」（路径 / URL / data），这种一律不动 */
function isImageIcon(icon: string): boolean {
  const s = String(icon || '').trim();
  return s.startsWith('/') || s.startsWith('data:image') || /^https?:\/\//i.test(s);
}

/**
 * 同步部分：只纠正路径（很快，启动时直接跑）。
 * 返回改了几个，调用方据此决定要不要写盘。
 */
export function fixAppTargets(config: any, home = os.homedir()): number {
  let fixed = 0;
  for (const scene of config?.scenes || []) {
    for (const it of scene.items || []) {
      if (it.type !== 'app') continue;
      const t = String(it.target || '').trim();
      if (!t) continue;
      const resolved = resolveInstalledApp(t, (p) => !!statSafe(p), home);
      if (!resolved) continue;
      if (resolved !== t) {
        it.target = resolved;
        it.updatedAt = Date.now();
        fixed++;
        log(`repair: 应用路径 ${t} -> ${resolved}`);
      }
    }
  }
  return fixed;
}

/**
 * 异步部分：补原生图标（要解 icns，慢一点，放后台跑）。
 * 只处理 app / file 两类，且只处理「当前没有图片图标」的条目。
 */
export async function fillItemIcons(config: any, home = os.homedir()): Promise<{ filled: number; checked: number; missing: string[] }> {
  const pending: any[] = [];
  for (const scene of config?.scenes || []) {
    for (const it of scene.items || []) {
      if (it.type !== 'app' && it.type !== 'file') continue;
      if (!String(it.target || '').trim()) continue;
      if (isImageIcon(it.icon)) continue; // 已经是真图标了
      pending.push(it);
    }
  }
  let filled = 0;
  const missing: string[] = [];
  for (const it of pending) {
    const before = String(it.icon || '');
    try {
      const r = await probeLocalIcon(expandHome(String(it.target), home), it.type);
      // 路径被纠正了就顺手写回去（probeLocalIcon 会带 resolved target）
      if (r?.target && r.target !== it.target && statSafe(r.target)) {
        it.target = r.target;
      }
      if (r?.ok && r.iconPath) {
        it.icon = r.iconPath;
        it.updatedAt = Date.now();
        filled++;
        continue;
      }
      if (r?.iconText && !before) {
        it.icon = r.iconText;
        filled++;
        continue;
      }
      if (!r?.ok) missing.push(it.name || it.target);
    } catch (e: any) {
      log('repair: 图标补齐失败 ' + (it.target || '') + ' ' + (e?.message || e));
    }
  }
  return { filled, checked: pending.length, missing };
}

/** 一次性体检（主进程启动后调用）：先修路径，再补图标 */
export async function repairConfig(config: any, home = os.homedir()): Promise<RepairStats> {
  const pathsFixed = fixAppTargets(config, home);
  const { filled, checked, missing } = await fillItemIcons(config, home);
  return { pathsFixed, iconsFilled: filled, checked, missing };
}

/** 给单个项目读一次图标（设置页手动点「读图标」时用，逻辑与体检一致） */
export async function probeItemIcon(item: any, home = os.homedir()): Promise<{ iconPath?: string; iconText?: string; target?: string; error?: string }> {
  const kind = item?.type === 'app' ? 'app' : item?.type === 'image' ? 'image' : 'file';
  const target = expandHome(String(item?.target || ''), home);
  const r = await probeLocalIcon(target, kind as any);
  return { iconPath: r.iconPath, iconText: r.iconText, target: r.target, error: r.error };
}

/** 供排查用：这个路径到底会被解析到哪 */
export function describeAppPath(target: string, home = os.homedir()): { bundle: string; resolved: string | null } {
  const bundle = appBundleName(target);
  const resolved = resolveInstalledApp(target, (p) => !!statSafe(p), home);
  return { bundle, resolved };
}
