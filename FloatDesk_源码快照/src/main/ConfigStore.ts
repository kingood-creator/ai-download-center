// 配置存储：加载 / 原子保存 / 备份 / 导入导出 / 迁移
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig } from '../shared/types';
import { SCHEMA_VERSION } from '../shared/types';
import { validateConfig, normalizeThemeColor, clampGradientAngle } from '../shared/validation';
import {
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  clampNoteFontSize,
  clampNoteOpacity,
  normalizeNoteColor,
} from '../shared/note';
import { defaultGradientFor } from '../shared/color';
import { buildDefaultConfig } from '../shared/defaults';
import { normalizeSoundConfig } from '../shared/sounds';
import { log } from './Logging';

// 与 ShortcutManager.isValidAccelerator 同义：合法快捷键必须含一个非修饰键主键。
// 这里单独放一份，避免 ConfigStore 依赖 ShortcutManager（后者会触碰 globalShortcut）。
function isValidShortcut(a: unknown): boolean {
  if (typeof a !== 'string' || !a) return false;
  // Meta 是旧版录制 bug 留下的「主键」（如 "Command+Meta"），必须当修饰键处理
  const mods = ['Command', 'Control', 'Alt', 'Shift', 'Meta', 'Super', 'Option', 'Cmd', 'Ctrl', 'AltGr', 'CommandOrControl'];
  const parts = a.split('+').map((s) => s.trim());
  return parts.some((p) => !mods.includes(p));
}

export class ConfigStore {
  private configPath: string;
  private backupDir: string;
  config: AppConfig;

  constructor() {
    const userData = app.getPath('userData');
    this.configPath = path.join(userData, 'config.json');
    this.backupDir = path.join(userData, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.config = this.load();
    // 首次运行（或配置损坏回退）时，立即把默认配置落盘：
    // 保证场景/项目 id 稳定、重启后能恢复，而不是每次启动重新生成。
    if (!fs.existsSync(this.configPath)) {
      const r = this.save(this.config);
      if (!r.ok) log('首次写入默认配置失败: ' + r.error);
    }
  }

  private load(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const v = validateConfig(parsed);
        if (!v.ok) {
          this.backupCorrupt(raw);
          log('配置校验失败，回退到默认配置: ' + v.errors.join('; '));
          return buildDefaultConfig();
        }
        return this.migrate(parsed);
      }
    } catch (e: any) {
      log('读取配置失败: ' + e.message);
    }
    return buildDefaultConfig();
  }

  get(): AppConfig {
    return this.config;
  }

  /**
   * 保存配置（原子写入 + 覆盖前备份）。校验失败返回错误且不写入。
   * opts.backup=false 用于「高频位置/滑块写入」（比如拖便签），避免每几百毫秒就多一个备份文件。
   */
  save(cfg: AppConfig, opts?: { backup?: boolean }): { ok: boolean; error?: string } {
    const v = validateConfig(cfg);
    if (!v.ok) return { ok: false, error: v.errors.join('; ') };
    cfg.updatedAt = Date.now();
    cfg.schemaVersion = SCHEMA_VERSION;
    try {
      if (opts?.backup !== false) this.backupCurrent();
      const tmp = this.configPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
      fs.renameSync(tmp, this.configPath); // 原子替换
      this.config = cfg;
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * 只换掉内存里的配置：不校验、不备份、不写盘。
   * 给「拖滑杆时的实时预览」用——写盘会连带备份 + 广播，设置页收到广播会重建 DOM，
   * 正在拖的滑杆就被替换掉了，手感直接断。真正落盘仍然走 save()。
   */
  preview(cfg: AppConfig): { ok: boolean; error?: string } {
    if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.scenes)) return { ok: false, error: '配置格式不对' };
    this.config = cfg;
    return { ok: true };
  }

  private backupCurrent(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(this.configPath, path.join(this.backupDir, `config.${ts}.json`));
      }
    } catch (e: any) {
      log('备份当前配置失败: ' + e.message);
    }
  }

  private backupCorrupt(raw: string): void {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(this.backupDir, `corrupt.${ts}.json`), raw, 'utf-8');
    } catch {
      /* ignore */
    }
  }

  /** 未来按 schemaVersion 做迁移；当前仅归一化版本号 */
  private migrate(cfg: any): AppConfig {
    cfg.schemaVersion = SCHEMA_VERSION;
    let dirty = false;
    // 主题色直接进 CSS 变量（还要参与 color-mix），非法值会让圆点背景整条失效，
    // 老配置或手改过的配置在这里统一纠正成 #rrggbb
    if (Array.isArray(cfg.scenes)) {
      cfg.scenes.forEach((s: any) => {
        if (!s || typeof s !== 'object') return;
        // 场景启用开关（场景库）：老配置没有这个字段一律按「启用」，脏值归布尔。
        // 停用的场景只改这一个标记，items/外观一个字节都不动 —— 重新启用要能原样回来。
        if (s.enabled === undefined) {
          s.enabled = true;
          dirty = true;
        } else {
          const fixed = !!s.enabled;
          if (s.enabled !== fixed) {
            s.enabled = fixed;
            dirty = true;
          }
        }
        s.themeColor = normalizeThemeColor(s.themeColor);
        // 渐变是后加的能力：老配置没有 gradientColor/gradientAngle 时补上默认值，
        // 否则圆点会一直是纯色（用户会以为「渐变开关坏了」）
        s.gradientColor = normalizeThemeColor(s.gradientColor, defaultGradientFor(s.themeColor));
        s.gradientAngle = clampGradientAngle(s.gradientAngle);
        // 清理旧版录制 bug 留下的「纯修饰键」快捷键（如 "Command+Meta"，没有任何主键，注册必失败）
        if (Array.isArray(s.items)) {
          s.items.forEach((it: any) => {
            if (it && typeof it.shortcut === 'string' && !isValidShortcut(it.shortcut)) {
              log(`迁移：清除无效快捷键（仅修饰键）${it.name ? '「' + it.name + '」' : ''} -> ${it.shortcut}`);
              it.shortcut = undefined;
              dirty = true;
            }
          });
        }
      });
      // 兜底：一个场景都没启用时，悬浮球就无处可去（currentScene 会拿到停用场景）。
      // 这里把第一个场景强制启用，保证任何时候都至少有一个可用场景。
      if (cfg.scenes.length > 0 && !cfg.scenes.some((s: any) => s && s.enabled === true)) {
        cfg.scenes[0].enabled = true;
        dirty = true;
      }
      // 当前场景指向了停用的场景 → 切到第一个启用的（或默认场景），别让悬浮球显示已停用的
      {
        const cur = cfg.scenes.find((s: any) => s && s.id === cfg.currentSceneId && s.enabled === true);
        if (!cur && cfg.scenes.length > 0) {
          const next = cfg.scenes.find((s: any) => s && s.enabled === true && s.isDefault) || cfg.scenes.find((s: any) => s && s.enabled === true);
          if (next) {
            cfg.currentSceneId = next.id;
            dirty = true;
          }
        }
      }
    }
    // 全局快捷键同理清理
    if (typeof cfg.appearance === 'object' && cfg.appearance) {
      ['windowShortcut', 'sceneSwitchShortcut'].forEach((k) => {
        if (typeof cfg.appearance[k] === 'string' && !isValidShortcut(cfg.appearance[k])) {
          log(`迁移：清除无效全局快捷键（仅修饰键）${k} -> ${cfg.appearance[k]}`);
          cfg.appearance[k] = undefined;
          dirty = true;
        }
      });
      // 长按选场景窗口宽高：非法值归 0（= 自动），合法值夹到窗口允许范围内
      (['pickerWidth', 'pickerHeight'] as const).forEach((k) => {
        const raw = Number(cfg.appearance[k]);
        const fixed = Number.isFinite(raw) && raw > 0 ? Math.max(120, Math.min(760, Math.round(raw))) : 0;
        if (cfg.appearance[k] !== fixed) {
          cfg.appearance[k] = fixed;
          dirty = true;
        }
      });
      // 选区每行文字的上下内边距：非法值回默认 12，合法值夹到 4–28
      {
        const raw = Number(cfg.appearance.pickerRowPad);
        const fixed = Number.isFinite(raw) && raw > 0 ? Math.max(4, Math.min(28, Math.round(raw))) : 12;
        if (cfg.appearance.pickerRowPad !== fixed) {
          cfg.appearance.pickerRowPad = fixed;
          dirty = true;
        }
      }
      // 录制时屏蔽系统快捷键：老配置缺字段补 true（缺字段 !== false 即视为开，这里落盘明确值）
      if (typeof cfg.appearance.blockKeysWhileRecording !== 'boolean') {
        cfg.appearance.blockKeysWhileRecording = true;
        dirty = true;
      }
      // 圆点动画：非法/缺省值归为 'pulse'（脉冲，默认）
      {
        const allowed = ['pulse', 'breathing', 'energy', 'none'];
        const v = typeof cfg.appearance.dotAnimation === 'string' ? cfg.appearance.dotAnimation : '';
        if (!allowed.includes(v)) {
          cfg.appearance.dotAnimation = 'pulse';
          dirty = true;
        }
      }
      // 「正在操控的窗口」提示药丸：背景不透明度夹到 0.1–1，缺省/非法归 1
      {
        const raw = Number(cfg.appearance.linkedAppBgOpacity);
        const fixed = Number.isFinite(raw) && raw > 0 ? Math.max(0.1, Math.min(1, raw)) : 1;
        if (cfg.appearance.linkedAppBgOpacity !== fixed) {
          cfg.appearance.linkedAppBgOpacity = fixed;
          dirty = true;
        }
      }
      // 文字颜色：必须是 #rrggbb。老默认 #e8ecf6（偏灰蓝）跟着新样式（全局浅色磨砂胶囊）
      // 一次性升到纯白 #ffffff —— 只有「还是老默认值」的才升，用户自己选过的颜色一律不动。
      {
        const v = typeof cfg.appearance.linkedAppTextColor === 'string' ? cfg.appearance.linkedAppTextColor : '';
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
          cfg.appearance.linkedAppTextColor = '#ffffff';
          dirty = true;
        } else if (v.toLowerCase() === '#e8ecf6') {
          cfg.appearance.linkedAppTextColor = '#ffffff';
          dirty = true;
        }
      }
      // 是否显示：老配置没有这个字段，undefined 一律按「开」处理
      if (cfg.appearance.linkedAppEnabled === undefined) {
        cfg.appearance.linkedAppEnabled = true;
        dirty = true;
      } else {
        cfg.appearance.linkedAppEnabled = !!cfg.appearance.linkedAppEnabled;
      }
      // 设置窗口「显示提示文字」总开关：老配置没有就按「开」，脏值归布尔
      if (cfg.appearance.showHints === undefined) {
        cfg.appearance.showHints = true;
        dirty = true;
      } else {
        cfg.appearance.showHints = !!cfg.appearance.showHints;
      }
      // 停留时长：0 = 常驻；正数夹到 1–60 秒（不足 1 秒按常驻，避免刚出现就消失）
      {
        const raw = Number(cfg.appearance.linkedAppDuration);
        const fixed = Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.min(60, Math.round(raw))) : 0;
        if (cfg.appearance.linkedAppDuration !== fixed) {
          cfg.appearance.linkedAppDuration = fixed;
          dirty = true;
        }
      }
    }
    // 菜单音效（后加的功能）：老配置没有这一节就补默认；音效 id 写错/音量越界在这里纠正，
    // 免得渲染层拿到不存在的音效后「划过没声音」还查不出原因
    {
      const before = JSON.stringify(cfg.sound === undefined ? null : cfg.sound);
      const fixed = normalizeSoundConfig(cfg.sound);
      if (before !== JSON.stringify(fixed)) dirty = true;
      cfg.sound = fixed;
    }
    // 老配置没有输入法/便签这两节（是后加的功能），这里补齐，避免读到 undefined 后到处判空
    const d = buildDefaultConfig();
    if (!cfg.inputMethod || typeof cfg.inputMethod !== 'object') {
      cfg.inputMethod = d.inputMethod;
      dirty = true;
    }
    if (!cfg.note || typeof cfg.note !== 'object') {
      cfg.note = d.note;
      dirty = true;
    } else {
      cfg.note.color = normalizeNoteColor(cfg.note.color);
      cfg.note.opacity = clampNoteOpacity(cfg.note.opacity);
      cfg.note.fontSize = clampNoteFontSize(cfg.note.fontSize);
      // 便签加了格式工具栏，老配置的 260 高会把正文挤没，这里抬到最小可用尺寸
      cfg.note.width = Math.max(NOTE_MIN_WIDTH, Math.round(Number(cfg.note.width) || 0) || NOTE_DEFAULT_WIDTH);
      cfg.note.height = Math.max(NOTE_MIN_HEIGHT, Math.round(Number(cfg.note.height) || 0) || NOTE_DEFAULT_HEIGHT);
    }
    // 用户项目库：确保是数组；逐项校验，丢弃「类型/名称/目标缺失」的脏条目（避免渲染时崩）。
    // builtin 一律按 false 处理（内置预制不进配置），缺 id 的补一个。
    {
      if (!Array.isArray(cfg.itemLibrary)) {
        cfg.itemLibrary = [];
        dirty = true;
      } else {
        const ALLOWED: string[] = ['web', 'app', 'file', 'image', 'shortcut', 'action'];
        const kept: any[] = [];
        for (const raw of cfg.itemLibrary as any[]) {
          if (!raw || typeof raw !== 'object') continue;
          if (!ALLOWED.includes(raw.type) || !String(raw.name || '').trim() || !String(raw.target || '').trim()) continue;
          kept.push({
            id: typeof raw.id === 'string' && raw.id ? raw.id : 'lib-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
            name: String(raw.name),
            type: raw.type,
            target: String(raw.target),
            icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : '',
            keywords: Array.isArray(raw.keywords) ? raw.keywords.filter((k: any) => typeof k === 'string') : [],
            builtin: false,
            // system：这条是 macOS 系统自带（收藏自「mac 系统」分类）。不保留的话，
            // 重启后它就会掉回「应用/文件」分类里，分类互斥的规则也就失效了。
            system: !!raw.system,
            openWith: typeof raw.openWith === 'string' ? raw.openWith : '',
            revealInFinder: !!raw.revealInFinder,
            shortcutKind: raw.shortcutKind === 'global' || raw.shortcutKind === 'send-to-app' ? raw.shortcutKind : 'send-to-app',
            shortcutKeystroke: typeof raw.shortcutKeystroke === 'string' ? raw.shortcutKeystroke : '',
            imageUrlMode: !!raw.imageUrlMode,
            createdAt: Number(raw.createdAt) || Date.now(),
          });
        }
        if (kept.length !== (cfg.itemLibrary as any[]).length) dirty = true;
        cfg.itemLibrary = kept;
      }
      // 被隐藏的项目库条目：只存一份 id 列表（内置的、本机应用的、收藏的都靠 id 认）。
      // 老配置没有这个字段很正常，这里补空数组；脏数据（非字符串 / 空串 / 重复）清掉。
      const rawHidden = (cfg as any).libHidden;
      const cleanHidden: string[] = [];
      if (Array.isArray(rawHidden)) {
        for (const h of rawHidden) {
          if (typeof h === 'string' && h.trim() && !cleanHidden.includes(h)) cleanHidden.push(h);
        }
      }
      if (!Array.isArray(rawHidden) || cleanHidden.length !== rawHidden.length) dirty = true;
      (cfg as any).libHidden = cleanHidden;
    }
    // 只有真改动了才回写，避免每次启动都多一份备份
    if (dirty) {
      try {
        this.save(cfg, { backup: false });
      } catch (e: any) {
        log('迁移回写失败（忽略）: ' + e.message);
      }
    }
    return cfg as AppConfig;
  }

  exportToString(): string {
    return JSON.stringify(this.config, null, 2);
  }

  importFromObject(obj: any): { ok: boolean; error?: string } {
    const v = validateConfig(obj);
    if (!v.ok) return { ok: false, error: v.errors.join('; ') };
    return this.save(obj);
  }

  reset(): AppConfig {
    const d = buildDefaultConfig();
    this.save(d);
    return d;
  }
}
