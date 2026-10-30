// 全局快捷键管理：注册 / 注销 / 冲突检测
import { globalShortcut } from 'electron';
import { AppConfig } from '../shared/types';
import { log } from './Logging';

export interface ShortcutCallbacks {
  runItemById: (id: string) => void;
  toggleWindow: () => void;
  switchScene: () => void;
}

export class ShortcutManager {
  private handlers = new Map<string, () => void>();

  isRegistered(a: string): boolean {
    if (!a) return false;
    try {
      return globalShortcut.isRegistered(a);
    } catch {
      return false;
    }
  }

  /**
   * 合法快捷键必须至少含一个「主键」（字母/数字/F 键等），不能只是修饰键。
   * 纯修饰键组合（如 "Command+Meta"）既注册不了，也是旧版录制 bug 留下的垃圾值，直接判非法。
   */
  static isValidAccelerator(a: string): boolean {
    if (!a) return false;
    // 这些在 Electron 里都是修饰键（Meta 是旧版录制 bug 留下的「主键」，必须当修饰键处理，否则 Command+Meta 会被误判合法）
    const mods = ['Command', 'Control', 'Alt', 'Shift', 'Meta', 'Super', 'Option', 'Cmd', 'Ctrl', 'AltGr', 'CommandOrControl'];
    const parts = a.split('+').map((s) => s.trim());
    const hasMain = parts.some((p) => !mods.includes(p));
    return hasMain;
  }

  register(accelerator: string, handler: () => void): { ok: boolean; error?: string } {
    if (!accelerator) return { ok: false, error: '快捷键为空' };
    if (!ShortcutManager.isValidAccelerator(accelerator)) {
      return { ok: false, error: `快捷键缺少主键（只有修饰键）: ${accelerator}` };
    }
    if (this.isRegistered(accelerator) || this.handlers.has(accelerator)) {
      return { ok: false, error: `快捷键已被占用: ${accelerator}` };
    }
    try {
      const ok = globalShortcut.register(accelerator, handler);
      if (!ok) return { ok: false, error: `注册失败（可能被系统或其他应用占用）: ${accelerator}` };
      this.handlers.set(accelerator, handler);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  unregister(accelerator: string): void {
    if (this.handlers.has(accelerator)) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        /* ignore */
      }
      this.handlers.delete(accelerator);
    }
  }

  unregisterAll(): void {
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* ignore */
    }
    this.handlers.clear();
  }

  /** 根据配置同步所有全局快捷键；返回被占用/失败的列表 */
  syncFromConfig(cfg: AppConfig, cb: ShortcutCallbacks): string[] {
    this.unregisterAll();
    const failures: string[] = [];

    for (const scene of cfg.scenes) {
      for (const it of scene.items) {
        if (it.enabled && it.shortcut) {
          const r = this.register(it.shortcut, () => cb.runItemById(it.id));
          if (!r.ok) failures.push(`${it.name} (${it.shortcut}): ${r.error}`);
        }
      }
    }
    if (cfg.appearance.windowShortcut) {
      const r = this.register(cfg.appearance.windowShortcut, cb.toggleWindow);
      if (!r.ok) failures.push(`唤出菜单 (${cfg.appearance.windowShortcut}): ${r.error}`);
    }
    if (cfg.appearance.sceneSwitchShortcut) {
      const r = this.register(cfg.appearance.sceneSwitchShortcut, cb.switchScene);
      if (!r.ok) failures.push(`切换场景 (${cfg.appearance.sceneSwitchShortcut}): ${r.error}`);
    }
    if (failures.length) log('部分快捷键注册失败: ' + failures.join(' | '));
    return failures;
  }
}
