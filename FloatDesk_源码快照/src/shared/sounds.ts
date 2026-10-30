// 菜单音效：预制音效清单 + 配置归一化（纯函数，主进程/渲染进程/单测共用）
//
// 两类音效：
//  1) sys   —— macOS 自带音效（/System/Library/Sounds/*.aiff）。主进程用 afconvert 转成
//              单声道 WAV 缓存起来，渲染进程用 WebAudio 解码播放（Chromium 不能直接解 AIFF）。
//  2) synth —— 纯合成音效（噪声脉冲 / 正弦泛音），渲染进程直接算波形，不依赖任何文件，
//              在系统音效缺失或转换失败时也能响。
//
// 「移动到按钮时」的清脆音效是最主要的用途，所以默认 hover 用 Tink（系统音效里最短最清亮的一颗）。

import { SoundConfig } from './types';

/** 音效 id：'' 或 'none' 表示静音 */
export const SOUND_NONE = 'none';

export type SoundGroup = 'sys' | 'synth';

/** 合成音效配方：渲染进程按这个数据算波形（不在渲染层再写一份音效表） */
export type SynthSpec =
  | {
      /** 噪声脉冲：短促、清脆，像敲木头 / 按键 */
      kind: 'noise';
      ms: number;
      /** 高通（Hz）：越高越"薄"越清脆 */
      hp: number;
      /** 低通（Hz）：压掉刺耳的毛刺 */
      lp: number;
      gain: number;
    }
  | {
      /** 正弦音：带一点二次泛音，像水滴 / 木琴 */
      kind: 'tone';
      ms: number;
      from: number;
      to: number;
      gain: number;
      /** 二次泛音比例 0..1 */
      harm?: number;
    };

export interface SoundPreset {
  id: string;
  /** 下拉里显示的名字（中文为主） */
  name: string;
  /** 一行说明：声音性格 / 适合什么场景 */
  desc: string;
  group: SoundGroup;
  /** sys：/System/Library/Sounds 下的文件名（不含 .aiff） */
  sysName?: string;
  /** synth：波形配方 */
  synth?: SynthSpec;
  /** 悬停时最多播多久（秒）：长音效只截前面一截，避免扫过一圈时糊成一片 */
  hoverSec?: number;
}

/** 系统音效：名字取自 macOS 自带的那一套，性格描述是实测观感 */
const SYS: SoundPreset[] = [
  { id: 'tink', name: '清脆叮（Tink）', desc: '系统音效 · 最短最清亮，悬停首选', group: 'sys', sysName: 'Tink', hoverSec: 0.34 },
  { id: 'pop', name: '轻弹（Pop）', desc: '系统音效 · 软弹一下，闷一点不刺耳', group: 'sys', sysName: 'Pop', hoverSec: 0.26 },
  { id: 'morse', name: '短滴（Morse）', desc: '系统音效 · 极短一声"滴"，像电报键', group: 'sys', sysName: 'Morse', hoverSec: 0.24 },
  { id: 'purr', name: '轻颤（Purr）', desc: '系统音效 · 细碎的沙沙声，很轻', group: 'sys', sysName: 'Purr', hoverSec: 0.26 },
  { id: 'bottle', name: '空瓶（Bottle）', desc: '系统音效 · 空腔"啵"一声，水感', group: 'sys', sysName: 'Bottle', hoverSec: 0.28 },
  { id: 'glass', name: '玻璃（Glass）', desc: '系统音效 · 玻璃敲击，余音较长', group: 'sys', sysName: 'Glass', hoverSec: 0.3 },
  { id: 'ping', name: '铃音（Ping）', desc: '系统音效 · 金属铃，清但偏长', group: 'sys', sysName: 'Ping', hoverSec: 0.32 },
  { id: 'frog', name: '蛙鸣（Frog）', desc: '系统音效 · 有点俏皮，适合点击', group: 'sys', sysName: 'Frog', hoverSec: 0.3 },
  { id: 'blow', name: '吹气（Blow）', desc: '系统音效 · 一口气，偏闷', group: 'sys', sysName: 'Blow', hoverSec: 0.26 },
  { id: 'funk', name: '放克（Funk）', desc: '系统音效 · 带音高的短句', group: 'sys', sysName: 'Funk', hoverSec: 0.28 },
  { id: 'hero', name: '英雄（Hero）', desc: '系统音效 · 上扬音阶，适合"执行成功"', group: 'sys', sysName: 'Hero', hoverSec: 0.34 },
  { id: 'sosumi', name: '经典（Sosumi）', desc: '系统音效 · 老 Mac 那声提示音', group: 'sys', sysName: 'Sosumi', hoverSec: 0.3 },
  { id: 'submarine', name: '潜艇（Submarine）', desc: '系统音效 · 低频"咚"，沉稳', group: 'sys', sysName: 'Submarine', hoverSec: 0.3 },
  { id: 'basso', name: '低音（Basso）', desc: '系统音效 · 最低最厚，适合报错', group: 'sys', sysName: 'Basso', hoverSec: 0.3 },
];

/** 合成音效：不依赖任何文件，随时能响 */
const SYNTH: SoundPreset[] = [
  { id: 'tick', name: '木敲（合成）', desc: '合成 · 一声干脆的木鱼轻敲', group: 'synth', hoverSec: 0.12, synth: { kind: 'noise', ms: 34, hp: 1500, lp: 6500, gain: 0.5 } },
  { id: 'click', name: '干脆按键（合成）', desc: '合成 · 最短的"嗒"，比木敲更轻', group: 'synth', hoverSec: 0.08, synth: { kind: 'noise', ms: 20, hp: 2400, lp: 9000, gain: 0.42 } },
  { id: 'drop', name: '水滴（合成）', desc: '合成 · 由高往低的一滴水', group: 'synth', hoverSec: 0.14, synth: { kind: 'tone', ms: 120, from: 1400, to: 700, gain: 0.42, harm: 0.2 } },
  { id: 'marimba', name: '木琴（合成）', desc: '合成 · 带泛音的木琴单音，温和', group: 'synth', hoverSec: 0.18, synth: { kind: 'tone', ms: 170, from: 1046, to: 1046, gain: 0.4, harm: 0.45 } },
];

export const SOUND_PRESETS: SoundPreset[] = SYS.concat(SYNTH);

/** 分组标题（设置页下拉用 optgroup） */
export const SOUND_GROUP_LABELS: Record<SoundGroup, string> = {
  sys: 'macOS 系统音效',
  synth: '合成音效（不依赖系统文件）',
};

export const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  hover: 'tink', // 移动到按钮：清脆叮
  click: 'pop', // 点下去：轻弹
  open: SOUND_NONE, // 展开/收起：默认不响（菜单开合太频繁，容易吵）
  volume: 45,
};

export function soundPresetById(id: any): SoundPreset | null {
  const s = String(id == null ? '' : id).trim();
  if (!s || s === SOUND_NONE) return null;
  return SOUND_PRESETS.find((p) => p.id === s) || null;
}

/** 这个 id 是不是合法音效（含 none / 空） */
export function isSoundId(id: any): boolean {
  const s = String(id == null ? '' : id).trim();
  return s === '' || s === SOUND_NONE || SOUND_PRESETS.some((p) => p.id === s);
}

/** 音量 0..100 → 增益 0..1（开方偏一点，小音量也能听清，大音量不会炸） */
export function volumeToGain(volume: any): number {
  const v = Number(volume);
  const p = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : DEFAULT_SOUND_CONFIG.volume / 100;
  return Math.round(Math.pow(p, 1.35) * 1000) / 1000;
}

/** 归一化音效配置：非法 id 回默认、音量夹到 0–100、缺字段补默认 */
export function normalizeSoundConfig(raw: any): SoundConfig {
  const src = raw && typeof raw === 'object' ? raw : {};
  // '' 与 'none' 都表示「这个事件不响」；写错了的 id 退回默认音效
  const pick = (v: any, fallback: string): string => {
    if (v === undefined) return fallback;
    const s = String(v).trim();
    if (s === '' || s === SOUND_NONE) return SOUND_NONE;
    return soundPresetById(s) ? s : fallback;
  };
  const vol = Number(src.volume);
  return {
    enabled: src.enabled !== false,
    hover: pick(src.hover, DEFAULT_SOUND_CONFIG.hover),
    click: pick(src.click, DEFAULT_SOUND_CONFIG.click),
    open: pick(src.open, DEFAULT_SOUND_CONFIG.open),
    volume: Number.isFinite(vol) ? Math.max(0, Math.min(100, Math.round(vol))) : DEFAULT_SOUND_CONFIG.volume,
  };
}

/** 悬停最多播多久（秒）；没写就按 0.3 */
export function hoverSeconds(preset: SoundPreset | null): number {
  if (!preset) return 0;
  const v = Number(preset.hoverSec);
  return Number.isFinite(v) && v > 0 ? Math.min(1.5, v) : 0.3;
}
