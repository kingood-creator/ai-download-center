// 场景管理：增删改查 / 复制 / 重命名 / 默认 / 切换
import { AppConfig, MenuItem, Scene } from '../shared/types';
import { validateScene } from '../shared/validation';
import { log } from './Logging';

export class SceneManager {
  constructor(private cfg: AppConfig) {}

  list(): Scene[] {
    return this.cfg.scenes;
  }

  get(id: string): Scene | undefined {
    return this.cfg.scenes.find((s) => s.id === id);
  }

  current(): Scene {
    return this.get(this.cfg.currentSceneId) || this.cfg.scenes[0];
  }

  create(scene: Scene): { ok: boolean; error?: string } {
    const v = validateScene(scene);
    if (!v.ok) return { ok: false, error: v.errors.join('; ') };
    if (this.cfg.scenes.some((s) => s.id === scene.id)) return { ok: false, error: '场景 id 重复' };
    this.cfg.scenes.push(scene);
    return { ok: true };
  }

  update(scene: Scene): { ok: boolean; error?: string } {
    const v = validateScene(scene);
    if (!v.ok) return { ok: false, error: v.errors.join('; ') };
    const i = this.cfg.scenes.findIndex((s) => s.id === scene.id);
    if (i < 0) return { ok: false, error: '未找到场景' };
    this.cfg.scenes[i] = scene;
    return { ok: true };
  }

  remove(id: string): { ok: boolean; error?: string } {
    if (this.cfg.scenes.length <= 1) return { ok: false, error: '至少保留一个场景' };
    if (this.cfg.scenes.find((s) => s.id === id)?.isDefault) {
      return { ok: false, error: '默认场景不可删除，请先设置其他默认场景' };
    }
    this.cfg.scenes = this.cfg.scenes.filter((s) => s.id !== id);
    if (this.cfg.currentSceneId === id) this.cfg.currentSceneId = this.cfg.scenes[0].id;
    return { ok: true };
  }

  duplicate(id: string): { ok: boolean; error?: string; scene?: Scene } {
    const s = this.get(id);
    if (!s) return { ok: false, error: '未找到场景' };
    const copy: Scene = JSON.parse(JSON.stringify(s));
    copy.id = 'scene-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    copy.name = s.name + ' 副本';
    copy.isDefault = false;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.items = copy.items.map((it: MenuItem) => ({
      ...it,
      id: 'item-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    this.cfg.scenes.push(copy);
    return { ok: true, scene: copy };
  }

  rename(id: string, name: string): { ok: boolean; error?: string } {
    const s = this.get(id);
    if (!s) return { ok: false, error: '未找到场景' };
    if (!name.trim()) return { ok: false, error: '名称不能为空' };
    s.name = name.trim();
    s.updatedAt = Date.now();
    return { ok: true };
  }

  setDefault(id: string): { ok: boolean; error?: string } {
    if (!this.get(id)) return { ok: false, error: '未找到场景' };
    this.cfg.scenes.forEach((s) => (s.isDefault = s.id === id));
    this.cfg.currentSceneId = id;
    return { ok: true };
  }

  switchTo(id: string): { ok: boolean; error?: string } {
    if (!this.get(id)) return { ok: false, error: '未找到场景' };
    this.cfg.currentSceneId = id;
    return { ok: true };
  }
}
