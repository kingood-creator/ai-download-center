// 输入法切换（主进程）
//
// 真正干活的是 native/imeswitch（Carbon / TIS 的命令行桥，见 scripts/build-native.sh）：
//   · TIS 直切不需要「辅助功能」权限，也不受用户自定义切换键影响，比模拟按键稳得多
//   · 辅助程序缺失（比如没编译、被杀软删了）时退回模拟 Ctrl+Space，那条路需要辅助功能权限
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { InputSource, cycleTarget, pickTogglePair, toggleTarget } from '../shared/ime';
import { log } from './Logging';

const TIMEOUT_MS = 4000;

/** 候选路径：打包后在 extraResources 下，开发时在仓库 bin/ 下 */
function helperCandidates(): string[] {
  const list: string[] = [];
  try {
    list.push(path.join(process.resourcesPath || '', 'bin', 'imeswitch'));
  } catch {
    /* ignore */
  }
  // __dirname = dist/main（开发）或 app.asar/main（打包）
  list.push(path.join(__dirname, '..', '..', 'bin', 'imeswitch'));
  list.push(path.join(__dirname, '..', '..', '..', 'bin', 'imeswitch'));
  list.push(path.join(app.getAppPath(), 'bin', 'imeswitch'));
  return list.filter(Boolean);
}

export function helperPath(): string {
  for (const p of helperCandidates()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function run(args: string[]): Promise<{ ok: boolean; stdout: string; error?: string }> {
  const bin = helperPath();
  if (!bin) return Promise.resolve({ ok: false, stdout: '', error: '缺少输入法辅助程序 bin/imeswitch' });
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: String(stdout || ''), error: String(stderr || err.message || err).trim() });
        return;
      }
      resolve({ ok: true, stdout: String(stdout || '') });
    });
  });
}

export function isAvailable(): boolean {
  return !!helperPath();
}

export async function listSources(): Promise<{ ok: boolean; sources: InputSource[]; error?: string }> {
  const r = await run(['list']);
  if (!r.ok) return { ok: false, sources: [], error: r.error };
  const sources: InputSource[] = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('\t');
      return i > 0 ? { id: l.slice(0, i), name: l.slice(i + 1) } : { id: l, name: l };
    });
  return { ok: true, sources };
}

export async function currentId(): Promise<{ ok: boolean; id: string; error?: string }> {
  const r = await run(['cur']);
  if (!r.ok) return { ok: false, id: '', error: r.error };
  return { ok: true, id: r.stdout.trim().split('\n')[0] || '' };
}

export async function selectId(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: '缺少输入源 id' };
  const r = await run(['sel', id]);
  return r.ok ? { ok: true } : { ok: false, error: r.error || '切换失败' };
}

/** 模拟系统切换键（Ctrl+Space）：辅助程序不可用时的兜底，需要「辅助功能」权限 */
function sendToggleKeystroke(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to key code 49 using control down'],
      { timeout: TIMEOUT_MS },
      (err) => {
        if (err) resolve({ ok: false, error: '模拟切换键失败（可能未授予辅助功能权限）：' + err.message });
        else resolve({ ok: true });
      }
    );
  });
}

export interface ToggleResult {
  ok: boolean;
  /** 切过去之后实际的输入源 id（兜底路径拿不到就为空） */
  to?: string;
  /** 走的是 TIS 直切还是模拟按键 */
  via?: 'tis' | 'keystroke';
  error?: string;
}

/**
 * 中英文切换。
 * @param chineseId 配置里的中文源；为空则自动推断
 * @param englishId 配置里的英文源；为空则自动推断
 */
export async function toggle(chineseId?: string | null, englishId?: string | null): Promise<ToggleResult> {
  if (!isAvailable()) {
    const r = await sendToggleKeystroke();
    return { ok: r.ok, via: 'keystroke', error: r.error };
  }

  const cur = await currentId();
  if (!cur.ok) return { ok: false, error: cur.error };

  const ls = await listSources();
  const sources = ls.ok ? ls.sources : [];

  let cn = chineseId || null;
  let en = englishId || null;
  if (!cn && !en && sources.length) {
    const auto = pickTogglePair(sources);
    cn = auto.chineseId;
    en = auto.englishId;
  }

  let target = toggleTarget(cur.id, cn, en);
  if (!target) {
    // 没配好 / 推断不出来 → 在可选源里循环（原输入法悬浮球的行为）
    target = cycleTarget(cur.id, sources.map((s) => s.id));
  }
  if (!target) return { ok: false, error: '没有可用的输入源' };

  const r = await selectId(target);
  if (r.ok) {
    // 关键：TISSelectInputSource 可能「返回成功但没真切过去」——
    // 在没有窗口会话的上下文里（沙箱/守护进程那类环境）实测就是如此。
    // 所以切完必须回读一次确认，没生效就退回模拟切换键，别让用户以为点了个寂寞。
    const after = await currentId();
    if (after.ok && after.id === target) {
      log(`输入法切换：${cur.id} -> ${target}`);
      return { ok: true, to: target, via: 'tis' };
    }
    log(`TIS 切换未生效（目标 ${target}，实际 ${after.id || '未知'}），退回模拟切换键`);
    const fb = await sendToggleKeystroke();
    return { ok: fb.ok, via: 'keystroke', error: fb.ok ? '' : fb.error };
  }
  // TIS 选不中时再试模拟按键
  const fb = await sendToggleKeystroke();
  return { ok: fb.ok, via: 'keystroke', error: fb.ok ? '' : r.error };
}

/** 给设置页用：一次拿到「列表 + 当前 + 自动推断的中英对」 */
export async function snapshot(
  chineseId?: string | null,
  englishId?: string | null
): Promise<{
  ok: boolean;
  available: boolean;
  currentId: string;
  currentName: string;
  sources: InputSource[];
  chineseId: string | null;
  englishId: string | null;
  error?: string;
}> {
  const available = isAvailable();
  const ls = await listSources();
  const cur = await currentId();
  const sources = ls.ok ? ls.sources : [];
  const auto = pickTogglePair(sources);
  const curName = sources.find((s) => s.id === cur.id)?.name || '';
  return {
    ok: ls.ok && cur.ok,
    available,
    currentId: cur.id,
    currentName: curName,
    sources,
    chineseId: chineseId || auto.chineseId,
    englishId: englishId || auto.englishId,
    error: ls.error || cur.error || '',
  };
}
