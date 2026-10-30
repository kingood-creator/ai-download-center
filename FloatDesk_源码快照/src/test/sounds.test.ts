import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOUND_PRESETS,
  SOUND_NONE,
  SOUND_GROUP_LABELS,
  DEFAULT_SOUND_CONFIG,
  soundPresetById,
  isSoundId,
  volumeToGain,
  normalizeSoundConfig,
  hoverSeconds,
} from '../shared/sounds';

test('预制音效清单：id 唯一、名字与说明齐全、分组合法', () => {
  assert.ok(SOUND_PRESETS.length >= 12, '预制音效应有一定数量：' + SOUND_PRESETS.length);
  const ids = SOUND_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, '存在重复 id');
  for (const p of SOUND_PRESETS) {
    assert.ok(p.id && p.id !== SOUND_NONE, '音效 id 不能为空或 none');
    assert.ok(String(p.name || '').trim().length > 0, `${p.id} 缺名字`);
    assert.ok(String(p.desc || '').trim().length > 0, `${p.id} 缺说明`);
    assert.ok(p.group === 'sys' || p.group === 'synth', `${p.id} 分组非法`);
    assert.ok(SOUND_GROUP_LABELS[p.group], `${p.id} 的分组没有中文标题`);
    const hv = Number(p.hoverSec);
    assert.ok(Number.isFinite(hv) && hv > 0 && hv <= 1.5, `${p.id} 的 hoverSec 不合理：${p.hoverSec}`);
  }
});

test('系统音效有声源名字，合成音效有波形配方（两者不能混）', () => {
  const sys = SOUND_PRESETS.filter((p) => p.group === 'sys');
  const synth = SOUND_PRESETS.filter((p) => p.group === 'synth');
  assert.ok(sys.length >= 8, '系统音效至少 8 个：' + sys.length);
  assert.ok(synth.length >= 4, '合成音效至少 4 个：' + synth.length);
  for (const p of sys) {
    assert.ok(String(p.sysName || '').trim(), `${p.id} 缺 sysName`);
    assert.equal(p.synth, undefined, `${p.id} 不应该有合成配方`);
  }
  for (const p of synth) {
    assert.ok(p.synth, `${p.id} 缺合成配方`);
    assert.ok(Number(p.synth!.ms) > 0 && Number(p.synth!.ms) < 1000, `${p.id} 时长不合理`);
    assert.ok(Number(p.synth!.gain) > 0 && Number(p.synth!.gain) <= 1, `${p.id} 增益不合理`);
    if (p.synth!.kind === 'noise') {
      assert.ok(p.synth!.hp > 0 && p.synth!.lp > p.synth!.hp, `${p.id} 滤波参数不合理`);
    } else {
      assert.ok(p.synth!.from > 0 && p.synth!.to > 0, `${p.id} 频率不合理`);
    }
  }
});

test('默认设置指向真实存在的音效：移动到按钮时是清脆的那个', () => {
  assert.equal(DEFAULT_SOUND_CONFIG.enabled, true);
  const hover = soundPresetById(DEFAULT_SOUND_CONFIG.hover);
  assert.ok(hover, '默认 hover 音效不存在');
  assert.equal(hover!.id, 'tink');
  assert.ok(soundPresetById(DEFAULT_SOUND_CONFIG.click), '默认 click 音效不存在');
  // 展开/收起默认静音（开合太频繁，默认加声音会吵）
  assert.equal(DEFAULT_SOUND_CONFIG.open, SOUND_NONE);
  assert.ok(DEFAULT_SOUND_CONFIG.volume > 0 && DEFAULT_SOUND_CONFIG.volume <= 100);
});

test('soundPresetById：none / 空 / 不存在的 id 一律 null', () => {
  assert.equal(soundPresetById('tink')!.id, 'tink');
  assert.equal(soundPresetById(SOUND_NONE), null);
  assert.equal(soundPresetById(''), null);
  assert.equal(soundPresetById(undefined), null);
  assert.equal(soundPresetById('tinkk'), null);
});

test('isSoundId：空串与 none 算合法（= 静音），拼错的 id 不合法', () => {
  assert.equal(isSoundId(''), true);
  assert.equal(isSoundId(SOUND_NONE), true);
  assert.equal(isSoundId('tink'), true);
  assert.equal(isSoundId('tinkk'), false);
  assert.equal(isSoundId(null), true);
});

test('volumeToGain：0 静音、100 满增益、中间单调递增且不越界', () => {
  assert.equal(volumeToGain(0), 0);
  assert.equal(volumeToGain(100), 1);
  const mid = volumeToGain(45);
  assert.ok(mid > 0 && mid < 1, String(mid));
  const seq = [0, 10, 30, 50, 70, 90, 100].map((v) => volumeToGain(v));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1], '音量增益应单调递增');
  // 越界与脏值
  assert.equal(volumeToGain(-50), 0);
  assert.equal(volumeToGain(500), 1);
  assert.ok(volumeToGain(undefined) > 0, '脏值应回默认音量而不是静音');
});

test('normalizeSoundConfig：缺省补默认、写错的 id 回默认、空值表示静音', () => {
  const d = normalizeSoundConfig(undefined);
  assert.deepEqual(d, { ...DEFAULT_SOUND_CONFIG });

  const bad = normalizeSoundConfig({ hover: 'tinkk', click: 'pop2', open: 'nope', volume: 999 });
  assert.equal(bad.hover, DEFAULT_SOUND_CONFIG.hover, '写错的 hover 应回默认');
  assert.equal(bad.click, DEFAULT_SOUND_CONFIG.click);
  assert.equal(bad.open, DEFAULT_SOUND_CONFIG.open);
  assert.equal(bad.volume, 100, '音量应夹到 100');

  const off = normalizeSoundConfig({ enabled: false, hover: '', click: SOUND_NONE, open: 'tink', volume: -10 });
  assert.equal(off.enabled, false);
  assert.equal(off.hover, SOUND_NONE, '空串应理解为不播放');
  assert.equal(off.click, SOUND_NONE);
  assert.equal(off.open, 'tink');
  assert.equal(off.volume, 0);

  // 音量四舍五入成整数，避免 44.9999 这种值写进配置
  assert.equal(normalizeSoundConfig({ volume: 44.6 }).volume, 45);
});

test('hoverSeconds：有值就用（夹到 1.5 秒），没有就 0.3，空音效 0', () => {
  assert.equal(hoverSeconds(soundPresetById('tink')), 0.34);
  assert.equal(hoverSeconds(soundPresetById('tick')), 0.12);
  assert.equal(hoverSeconds(null), 0);
  assert.equal(hoverSeconds({ id: 'x', name: 'x', desc: 'x', group: 'synth' } as any), 0.3);
  assert.equal(hoverSeconds({ id: 'x', name: 'x', desc: 'x', group: 'synth', hoverSec: 9 } as any), 1.5);
});
