// 动作执行入口：统一处理各类快捷项目
import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app, shell } from 'electron';
import { MenuItem, ShortcutActionKind } from '../shared/types';
import { isHttpUrl } from '../shared/validation';
import { isBuiltinActionKey } from '../shared/builtins';
import { log } from './Logging';

export interface ActionDeps {
  /** 打开图片预览窗口 */
  openPreview: (target: string, isUrl: boolean) => void;
  /** 按 id 执行另一个项目（用于 shortcut 类型的 global 别名） */
  runItemById: (id: string) => void;
  /** 执行 FloatDesk 自带功能（输入法切换 / 便签等）；异步，结果由主进程自行提示 */
  runBuiltin?: (key: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * 返回悬浮球当前「链接到」的目标应用名称（点悬浮球瞬间捕获的前台应用）。
   * 只有从悬浮球界面触发的动作才应传这个值；全局热键等其它入口返回 null，
   * 表示「直接发到当前前台应用」即可（前台应用此时本来就是目标）。
   * 返回 FloatDesk 自身或空串时，调用方会回退为发前台。
   */
  getLinkedAppName?: () => string | null;
}

function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** 把 'command+c' 之类翻译为 AppleScript，仅支持单字符键 + 修饰键（MVP） */
function toAppleScript(keystroke: string): string | null {
  if (!keystroke) return null;
  const parts = keystroke.toLowerCase().split('+').map((s) => s.trim());
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const map: Record<string, string> = {
    command: 'command down',
    cmd: 'command down',
    control: 'control down',
    ctrl: 'control down',
    shift: 'shift down',
    option: 'option down',
    alt: 'option down',
  };
  const using = mods.map((m) => map[m]).filter(Boolean);
  if (key.length === 1) {
    const usingStr = using.length ? ` using {${using.join(', ')}}` : '';
    return `tell application "System Events" to keystroke "${key}"${usingStr}`;
  }
  return null;
}

/** 定位原生发送桥 bin/sendkey（与 imeswitch 同一套查找顺序） */
function findSendkeyBin(): string | null {
  const cands = [
    path.join(process.resourcesPath || '', 'bin', 'sendkey'),
    path.join(__dirname, '..', '..', 'bin', 'sendkey'),
    path.join(__dirname, '..', '..', '..', 'bin', 'sendkey'),
    path.join(app.getAppPath(), 'bin', 'sendkey'),
  ];
  for (const c of cands) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * 把组合键真实「按」到前台应用（CGEvent 走 HID 事件流，与物理按键无区别）。
 * 这就是「用 FloatDesk 的按钮/热键代替在别的应用里按物理键」的实现：
 * 例如给系统截图录 Command+Shift+4，点一下项目或按全局热键，
 * 前台应用收到的就是完整的 Command+Shift+4（AppleScript 方案只能发单字符键）。
 * 需要「辅助功能」权限；拿不到原生桥时退回 AppleScript（仅单字符键）。
 */
export function sendKeystrokeToFrontApp(keystroke: string): { ok: boolean; error?: string } {
  const acc = String(keystroke || '').trim();
  if (!acc) return { ok: false, error: '未设置要发送的按键' };
  const bin = findSendkeyBin();
  if (bin) {
    try {
      execFileSync(bin, [acc], { timeout: 3000 });
      return { ok: true };
    } catch (e: any) {
      const msg = String(e?.stderr || e?.message || e);
      if (/unsupported key/i.test(msg)) return { ok: false, error: `暂不支持的按键：${acc}` };
      if (/unsupported modifier/i.test(msg)) return { ok: false, error: `暂不支持的修饰键：${acc}` };
      return { ok: false, error: '发送失败（需要「辅助功能」权限）：' + msg };
    }
  }
  // 兜底：没有原生桥时退回 AppleScript（只能发单字符键）
  const script = toAppleScript(acc);
  if (!script) return { ok: false, error: '暂仅支持单字符键（缺少原生发送桥 bin/sendkey）' };
  execFile('osascript', ['-e', script], (err) => {
    if (err) log('发送快捷键失败: ' + err.message);
  });
  return { ok: true };
}

/** 当前前台（最前）应用的进程名；拿不到返回 null */
export function frontmostAppName(): string | null {
  try {
    const out = execFileSync(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
      { timeout: 2500 },
    )
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

/** 是不是 FloatDesk 自己（避免把按键发回给自己） */
function isFloatDesk(name: string | null): boolean {
  if (!name) return false;
  return /floatdesk/i.test(name);
}

/** 把某个应用推到前台（AppleScript activate）。异步，不阻塞。 */
function activateApp(name: string): void {
  execFile('osascript', ['-e', `tell application "${name}" to activate`], (err) => {
    if (err) log('激活目标应用失败: ' + name + ' - ' + err.message);
  });
}

/**
 * 轮询确认目标已成为前台（最多 ~timeoutMs），再返回。
 * 用每次 20ms 的小 sleep 让出主线程，避免空转把 Electron 卡死。
 */
function waitUntilFrontmost(name: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (frontmostAppName() === name) return true;
    try {
      execFileSync('sleep', ['0.02']);
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * 把组合键发到「悬浮球链接到的目标窗口」，而不是发到被悬浮球抢走焦点的前台。
 * 实现：先把目标应用推到前台，确认它确实成为前台后，再交给 bin/sendkey（CGEvent，
 * 与物理按键无区别、支持任意组合键）真实按下去。没有目标（或目标是 FloatDesk 自己）
 * 时回退为发当前前台应用（全局热键等入口就是这种情况）。
 */
export function sendKeystrokeToTargetApp(keystroke: string, targetApp: string | null): { ok: boolean; error?: string } {
  const acc = String(keystroke || '').trim();
  if (!acc) return { ok: false, error: '未设置要发送的按键' };
  // 没指定目标 / 目标是自己 → 直接发前台（保持全局热键等原有行为）
  if (!targetApp || isFloatDesk(targetApp)) return sendKeystrokeToFrontApp(acc);

  log('sendkey: 链接目标=' + targetApp + '，先把它推到前台');
  activateApp(targetApp);
  const ready = waitUntilFrontmost(targetApp, 320);
  if (!ready) log('sendkey: 目标应用未在 320ms 内成为前台，仍尝试发送（可能落到其它窗口）');
  // 此刻前台应为目标应用，bin/sendkey 走 CGEvent 发到前台即命中目标
  return sendKeystrokeToFrontApp(acc);
}

export function executeItem(item: MenuItem, deps: ActionDeps): { ok: boolean; error?: string } {
  try {
    switch (item.type) {
      case 'web': {
        const url = String(item.target);
        if (!isHttpUrl(url)) return { ok: false, error: '非法的网页地址（仅允许 http/https）' };
        shell.openExternal(url);
        return { ok: true };
      }
      case 'app': {
        const p = String(item.target);
        if (!/\.app$/.test(p)) return { ok: false, error: '应用路径无效（应为 .app）' };
        if (!pathExists(p)) return { ok: false, error: '应用不存在: ' + p };
        const args = item.openWith ? ['-a', item.openWith, p] : [p];
        execFile('open', args, (err) => {
          if (err) log('打开应用失败: ' + err.message);
        });
        return { ok: true };
      }
      case 'file': {
        const p = String(item.target);
        if (!pathExists(p)) return { ok: false, error: '文件不存在: ' + p };
        const args = item.revealInFinder ? ['-R', p] : [p];
        execFile('open', args, (err) => {
          if (err) log('打开文件失败: ' + err.message);
        });
        return { ok: true };
      }
      case 'image': {
        const t = String(item.target);
        const isUrl = isHttpUrl(t);
        if (!isUrl && !pathExists(t)) return { ok: false, error: '图片不存在: ' + t };
        deps.openPreview(t, isUrl);
        return { ok: true };
      }
      case 'shortcut': {
        const kind: ShortcutActionKind = item.shortcutKind || 'send-to-app';
        if (kind === 'send-to-app') {
          // 从悬浮球界面点出来的动作带「链接到的目标窗口」；全局热键等入口返回 null
          const target = deps.getLinkedAppName ? deps.getLinkedAppName() : null;
          return sendKeystrokeToTargetApp(item.shortcutKeystroke || '', target);
        }
        // global 别名：执行目标项目
        if (item.target) {
          deps.runItemById(item.target);
          return { ok: true };
        }
        return { ok: false, error: 'shortcut 别名缺少目标项目' };
      }
      case 'action': {
        // 内置动作：target 存的是 builtins.ts 里的 key（如 'ime:switch'）
        const key = String(item.target || '');
        if (!isBuiltinActionKey(key)) return { ok: false, error: '未知内置动作: ' + key };
        if (!deps.runBuiltin) return { ok: false, error: '主进程未挂载内置动作' };
        // 切输入法 / 开便签都是异步的，结果由主进程 toast，这里先返回「已受理」
        void deps.runBuiltin(key).catch((e: any) => log('内置动作执行失败: ' + (e?.message || e)));
        return { ok: true };
      }
      default:
        return { ok: false, error: '未知项目类型: ' + (item as any).type };
    }
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
