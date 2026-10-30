// 菜单音效的「文件来源」：macOS 自带音效在 /System/Library/Sounds/*.aiff，
// 但 Chromium 的 <audio>/WebAudio 不能解 AIFF，所以这里用系统自带的 afconvert
// 转成单声道 22.05kHz 的 WAV（体积小、解码快），缓存到 userData/sounds/ 下次直接读。
//
// 返回值是 data URL（base64）：渲染进程用 atob 还原成 ArrayBuffer 交给 decodeAudioData，
// 不经过网络/文件协议，也就不受渲染进程 CSP 影响。
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { log } from './Logging';
import { soundPresetById } from '../shared/sounds';

const SYS_DIR = '/System/Library/Sounds';
const AFCONVERT = '/usr/bin/afconvert';

/** 内存里缓存 data URL：同一声音重复播放不再读盘 */
const dataCache = new Map<string, string>();

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'sounds');
}

function cacheFile(sysName: string): string {
  return path.join(cacheDir(), `${sysName}.wav`);
}

/** 跑一次 afconvert（同步失败只返回原因，不抛） */
function convert(src: string, dst: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
    } catch (e: any) {
      resolve({ ok: false, error: '建目录失败: ' + (e?.message || e) });
      return;
    }
    execFile(
      AFCONVERT,
      ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', src, dst],
      { timeout: 8000 },
      (err, _stdout, stderr) => {
        if (err) resolve({ ok: false, error: stderr || err.message });
        else resolve({ ok: true });
      }
    );
  });
}

function isWavFile(p: string): boolean {
  try {
    if (!fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    if (st.size < 512) return false;
    const fd = fs.openSync(p, 'r');
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    return head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE';
  } catch {
    return false;
  }
}

/**
 * 取一个系统音效的 data URL。
 *  · ok=true  → dataUrl 可直接喂给 WebAudio / <audio>
 *  · ok=false → error 说明原因（渲染进程会退回合成音效，不会静默失声）
 */
export async function systemSoundDataUrl(sysName: string): Promise<{ ok: boolean; dataUrl?: string; error?: string; bytes?: number }> {
  const name = String(sysName || '').trim();
  if (!name) return { ok: false, error: '缺少音效名' };

  const cached = dataCache.get(name);
  if (cached) return { ok: true, dataUrl: cached, bytes: Math.round((cached.length * 3) / 4) };

  const dst = cacheFile(name);
  if (!isWavFile(dst)) {
    const src = path.join(SYS_DIR, `${name}.aiff`);
    if (!fs.existsSync(src)) return { ok: false, error: '系统里没有这个音效：' + src };
    const r = await convert(src, dst);
    if (!r.ok) {
      log(`音效转换失败 ${name}: ${r.error || ''}`);
      return { ok: false, error: '音效转换失败：' + (r.error || '未知原因') };
    }
    if (!isWavFile(dst)) {
      try {
        fs.unlinkSync(dst);
      } catch {
        /* ignore */
      }
      return { ok: false, error: '转换出来的文件不是 WAV' };
    }
  }

  try {
    const buf = fs.readFileSync(dst);
    const dataUrl = 'data:audio/wav;base64,' + buf.toString('base64');
    dataCache.set(name, dataUrl);
    return { ok: true, dataUrl, bytes: buf.length };
  } catch (e: any) {
    return { ok: false, error: '读文件失败：' + (e?.message || e) };
  }
}

/** 按音效 id 取数据（synth 类型的音效不需要文件，返回 ok=false + reason=synth） */
export async function soundDataById(id: string): Promise<{ ok: boolean; dataUrl?: string; error?: string; bytes?: number; synth?: boolean }> {
  const preset = soundPresetById(id);
  if (!preset) return { ok: false, error: '没有这个音效' };
  if (preset.synth) return { ok: false, error: '合成音效由渲染进程直接生成', synth: true };
  if (!preset.sysName) return { ok: false, error: '这个音效没有来源' };
  const r = await systemSoundDataUrl(preset.sysName);
  return { ...r, synth: false };
}

/** 预热：把配置里用到的系统音效提前转好，第一次悬停就不会等转换 */
export async function preloadSoundFiles(ids: string[]): Promise<void> {
  const names = ids
    .map((id) => soundPresetById(id))
    .filter((p) => !!p && !p!.synth && !!p!.sysName)
    .map((p) => p!.sysName as string);
  for (const n of Array.from(new Set(names))) {
    try {
      await systemSoundDataUrl(n);
    } catch {
      /* 预热失败不影响主流程，真正播放时还会再试 */
    }
  }
}
