// 菜单音效播放引擎（渲染进程共享脚本，经典脚本不能 import）
// 悬浮窗和设置页都引这一份：
//   · 悬浮窗：移动到菜单按钮 / 点击项目 / 展开收起时 play('hover'|'click'|'open')
//   · 设置页：试听按钮 preview(id)
//
// 声音从哪来：
//   · sys 音效：主进程用 afconvert 把 /System/Library/Sounds/*.aiff 转成 WAV 并给 data URL，
//     这里 atob → ArrayBuffer → ctx.decodeAudioData 解码后缓存（首次播放会有一点点延迟，
//     配置里用到的那几个会在初始化时提前加载）。
//   · synth 音效：这里直接算波形（噪声脉冲 / 正弦泛音），不依赖任何文件；
//     sys 音效解码失败时也退到合成音效，保证「鼠标划过有反馈」这件事不会静音失效。
(function () {
  'use strict';

  // ---- 音效表（与 src/shared/sounds.ts 保持一致；渲染进程引用不到模块，只能各存一份） ----
  // 只需要 id → (sysName | synth 配方 | hoverSec)，名字/说明由设置页从主进程/常量里取。
  const PRESETS: Record<string, any> = {
    tink: { sysName: 'Tink', hoverSec: 0.34 },
    pop: { sysName: 'Pop', hoverSec: 0.26 },
    morse: { sysName: 'Morse', hoverSec: 0.24 },
    purr: { sysName: 'Purr', hoverSec: 0.26 },
    bottle: { sysName: 'Bottle', hoverSec: 0.28 },
    glass: { sysName: 'Glass', hoverSec: 0.3 },
    ping: { sysName: 'Ping', hoverSec: 0.32 },
    frog: { sysName: 'Frog', hoverSec: 0.3 },
    blow: { sysName: 'Blow', hoverSec: 0.26 },
    funk: { sysName: 'Funk', hoverSec: 0.28 },
    hero: { sysName: 'Hero', hoverSec: 0.34 },
    sosumi: { sysName: 'Sosumi', hoverSec: 0.3 },
    submarine: { sysName: 'Submarine', hoverSec: 0.3 },
    basso: { sysName: 'Basso', hoverSec: 0.3 },
    tick: { hoverSec: 0.12, synth: { kind: 'noise', ms: 34, hp: 1500, lp: 6500, gain: 0.5 } },
    click: { hoverSec: 0.08, synth: { kind: 'noise', ms: 20, hp: 2400, lp: 9000, gain: 0.42 } },
    drop: { hoverSec: 0.14, synth: { kind: 'tone', ms: 120, from: 1400, to: 700, gain: 0.42, harm: 0.2 } },
    marimba: { hoverSec: 0.18, synth: { kind: 'tone', ms: 170, from: 1046, to: 1046, gain: 0.4, harm: 0.45 } },
  };

  const NONE = 'none';
  // 各事件的相对音量：悬停要轻（会连续响），点击最实，开合居中
  const EVENT_GAIN: Record<string, number> = { hover: 0.55, click: 1, open: 0.8 };

  let cfg: any = { enabled: true, hover: 'tink', click: 'pop', open: NONE, volume: 45 };
  let ctx: any = null;
  let master: any = null;
  const buffers: Record<string, any> = {};
  const loading: Record<string, Promise<any> | undefined> = {};
  const active: any[] = [];
  let lastHoverAt = 0;
  let warned = false;

  const stats = { plays: 0, lastEvent: '', lastId: '', errors: 0, failed: [] as string[] };

  function preset(id: any): any {
    const s = String(id == null ? '' : id).trim();
    if (!s || s === NONE) return null;
    return PRESETS[s] || null;
  }

  function volumeGain(v: any): number {
    const n = Number(v);
    const p = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0.45;
    return Math.pow(p, 1.35);
  }

  function ensureCtx(): any {
    if (ctx) return ctx;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volumeGain(cfg.volume);
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  /** 浏览器自动播放策略：没用户手势时 AudioContext 可能是 suspended，尽量唤醒 */
  function unlock(): void {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') {
      try {
        c.resume();
      } catch {
        /* ignore */
      }
    }
  }

  // ---- 合成音效：直接算一段 PCM ----
  function synthBuffer(spec: any): any {
    const c = ensureCtx();
    if (!c) return null;
    const sr = c.sampleRate;
    const len = Math.max(1, Math.round((spec.ms / 1000) * sr));
    const buf = c.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    if (spec.kind === 'noise') {
      // 白噪声 → 一阶高通（差分）→ 一阶低通（指数平滑）→ 极快衰减包络
      const hpA = Math.max(0, Math.min(0.999, 1 - (2 * Math.PI * spec.hp) / sr));
      const lpA = Math.max(0.001, Math.min(1, (2 * Math.PI * spec.lp) / sr));
      let prevIn = 0;
      let prevHp = 0;
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        const hp = hpA * (prevHp + white - prevIn);
        prevIn = white;
        prevHp = hp;
        lp = lp + lpA * (hp - lp);
        const t = i / len;
        const env = Math.exp(-6.5 * t); // 快衰减 = 清脆
        out[i] = lp * env * (spec.gain || 0.4);
      }
    } else {
      // 正弦（可带滑音）+ 二次泛音 + 指数衰减
      const from = Number(spec.from) || 880;
      const to = spec.to === undefined ? from : Number(spec.to);
      const harm = Number(spec.harm) || 0;
      let phase = 0;
      let phase2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const f = from * Math.pow(to / from, t); // 指数滑音
        phase += (2 * Math.PI * f) / sr;
        phase2 += (2 * Math.PI * f * 2) / sr;
        const env = Math.exp(-4.2 * t);
        const wave = Math.sin(phase) + harm * Math.sin(phase2) * Math.exp(-7 * t);
        out[i] = wave * env * (spec.gain || 0.4);
      }
    }
    // 末尾 3ms 淡出，避免硬切产生咔哒声
    const fade = Math.min(len, Math.round(sr * 0.003));
    for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
    return buf;
  }

  /** 取一个音效的 AudioBuffer：合成音效现算，系统音效走主进程数据 + 解码 */
  function load(id: string): Promise<any> {
    const p = preset(id);
    if (!p) return Promise.resolve(null);
    if (buffers[id]) return Promise.resolve(buffers[id]);
    if (loading[id]) return loading[id] as Promise<any>;

    if (p.synth) {
      const buf = synthBuffer(p.synth);
      if (buf) buffers[id] = buf;
      return Promise.resolve(buf);
    }

    const job = (async () => {
      try {
        const api: any = (window as any).api;
        if (!api || !api.getSound) throw new Error('没有音效接口');
        const r = await api.getSound(id);
        if (!r || !r.ok || !r.dataUrl) throw new Error((r && r.error) || '取不到音效文件');
        const c = ensureCtx();
        if (!c) throw new Error('没有 AudioContext');
        const b64 = String(r.dataUrl).split(',')[1] || '';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const buf = await new Promise((resolve, reject) => {
          // 老版 Chromium 的 decodeAudioData 只支持回调
          const ret = c.decodeAudioData(bytes.buffer.slice(0), (b: any) => resolve(b), (e: any) => reject(e || new Error('解码失败')));
          if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
        });
        buffers[id] = buf;
        return buf;
      } catch (e: any) {
        stats.errors++;
        const why = (e && e.message) || String(e);
        if (stats.failed.indexOf(id) < 0) stats.failed.push(id);
        if (!warned) {
          warned = true;
          try {
            (window as any).api?.logMsg?.('音效不可用，改用合成音效: ' + why);
          } catch {
            /* ignore */
          }
        }
        // 系统音效放不出来 → 退到合成音效（宁愿音色不同，也不能"划过没反应"）
        const fb = p.synth ? null : synthBuffer((PRESETS.tick && PRESETS.tick.synth) || { kind: 'noise', ms: 30, hp: 1600, lp: 7000, gain: 0.45 });
        if (fb) buffers[id] = fb;
        return fb;
      } finally {
        loading[id] = undefined;
      }
    })();
    loading[id] = job;
    return job;
  }

  /** 真正发声：截断 + 淡出 + 控制并发，避免扫一圈糊成噪音 */
  function emit(buf: any, gainScale: number, maxSec: number): void {
    const c = ensureCtx();
    if (!c || !buf) return;
    if (c.state === 'suspended') {
      try {
        c.resume();
      } catch {
        /* ignore */
      }
    }
    const now = c.currentTime;
    const dur = Math.min(buf.duration, Math.max(0.02, Number(maxSec) || buf.duration));
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    const peak = Math.max(0.0001, gainScale);
    src.connect(g);
    g.connect(master);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.004); // 4ms 起音，避免爆音
    if (dur < buf.duration - 0.005) {
      const fadeStart = now + Math.max(0.005, dur - 0.025);
      g.gain.setValueAtTime(peak, fadeStart);
      g.gain.linearRampToValueAtTime(0, now + dur);
    }
    try {
      src.start(now, 0, dur);
    } catch {
      return;
    }
    active.push(src);
    src.onended = () => {
      const i = active.indexOf(src);
      if (i >= 0) active.splice(i, 1);
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    };
    // 同时最多 5 个：超过就把最早的掐掉（快速扫过菜单时不会叠成噪音）
    while (active.length > 5) {
      const old = active.shift();
      try {
        old.stop();
      } catch {
        /* ignore */
      }
    }
  }

  function playId(id: string, event: string, force: boolean): void {
    const p = preset(id);
    if (!p) return;
    const scale = (EVENT_GAIN[event] || 0.6) * (force ? 1 : 1);
    const maxSec = event === 'hover' ? Number(p.hoverSec) || 0.3 : p.hoverSec || 0.6;
    load(id).then((buf: any) => {
      if (!buf) return;
      stats.plays++;
      stats.lastEvent = event;
      stats.lastId = id;
      emit(buf, scale, maxSec);
    });
  }

  const FDSound = {
    /** 应用配置（设置页每次改动都会重新 configure） */
    configure(next: any): void {
      const s = next && typeof next === 'object' ? next : {};
      cfg = {
        enabled: s.enabled !== false,
        hover: s.hover === undefined ? 'tink' : String(s.hover || NONE),
        click: s.click === undefined ? 'pop' : String(s.click || NONE),
        open: s.open === undefined ? NONE : String(s.open || NONE),
        volume: Number.isFinite(Number(s.volume)) ? Math.max(0, Math.min(100, Number(s.volume))) : 45,
      };
      if (master) master.gain.value = volumeGain(cfg.volume);
      // 配置里用到的系统音效提前解码，第一次悬停不用等
      ['hover', 'click', 'open'].forEach((k) => {
        const id = cfg[k];
        if (preset(id) && !preset(id).synth) void load(id);
      });
    },

    /** 播放某个交互事件的音效 */
    play(event: 'hover' | 'click' | 'open'): void {
      if (!cfg.enabled) return;
      const id = cfg[event];
      if (!preset(id)) return;
      if (event === 'hover') {
        // 扫过一整圈时每次进入都响会太密：40ms 内只响一次
        const now = Date.now();
        if (now - lastHoverAt < 40) return;
        lastHoverAt = now;
      }
      unlock();
      playId(id, event, false);
    },

    /** 设置页试听：忽略总开关（点了就该响），用当前音量 */
    preview(id: string): void {
      const p = preset(id);
      if (!p) return;
      unlock();
      playId(id, 'click', true);
    },

    /** 让 AudioContext 进入 running（首次点击/展开时调一次即可） */
    unlock,

    /** 诊断用：AudioContext 状态（'running' 才真的出声；'suspended' 会静默） */
    _ctxState(): string {
      return ctx ? String(ctx.state) : 'none';
    },

    /** 诊断/自检用 */
    stats,
    _presets: PRESETS,
  };

  (window as any).FDSound = FDSound;
})();
