// 纯函数校验（不依赖 Electron，可在 Node 单元测试中直接 require）
import { AppConfig, ItemType, MenuLayout, Scene, MenuItem } from './types';
import { isBuiltinActionKey } from './builtins';

const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];
const ITEM_TYPES: ItemType[] = ['web', 'app', 'file', 'image', 'shortcut', 'action'];
const LAYOUTS: MenuLayout[] = ['radial', 'grid', 'list'];

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return ALLOWED_URL_PROTOCOLS.includes(u.protocol);
  } catch {
    return false;
  }
}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

export function isSupportedImageExt(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif'].includes(ext || '');
}

/**
 * 主题色归一化：'#abc' / 'ABC' / '#AABBCC' / 'aabbcc' 一律统一成 '#aabbcc'，
 * 其它任何值（含空、rgb() 写法、拼错的颜色名）都退回默认蓝。
 * 主题色会直接进入 CSS 变量并参与 color-mix()，非法值会让整个圆点背景失效（圆点消失），
 * 所以这里必须兜住。
 */
export function normalizeThemeColor(input: unknown, fallback = '#3b82f6'): string {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : fallback;
}

/** 渐变角度夹到 0..360（非法值回退 145deg，也就是最初设计稿的角度） */
export function clampGradientAngle(input: unknown): number {
  // 空串按"没填"处理（Number('') 会变 0，那样角度就悄悄被改成 0deg 了）
  if (input == null || (typeof input === 'string' && !input.trim())) return 145;
  const v = Number(input);
  if (!Number.isFinite(v)) return 145;
  return Math.min(360, Math.max(0, Math.round(v)));
}

export function validateItem(item: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!item || typeof item !== 'object') return { ok: false, errors: ['item 不是对象'] };
  if (!ITEM_TYPES.includes(item.type)) errors.push('未知的快捷项目类型: ' + item.type);
  if (typeof item.id !== 'string' || !item.id) errors.push('缺少 id');
  if (typeof item.name !== 'string' || !item.name.trim()) errors.push('名称不能为空');
  if (typeof item.order !== 'number') errors.push('order 必须为数字');

  if (item.type === 'web') {
    if (!isHttpUrl(String(item.target || ''))) errors.push('网页地址必须以 http:// 或 https:// 开头');
  }
  if (item.type === 'app') {
    if (!/\.app$/.test(String(item.target || ''))) errors.push('应用路径应以 .app 结尾');
  }
  if (item.type === 'file') {
    if (!isAbsolutePath(String(item.target || ''))) errors.push('文件路径必须为本地绝对路径');
  }
  if (item.type === 'image') {
    const t = String(item.target || '');
    const isUrl = isHttpUrl(t);
    const isPath = isAbsolutePath(t);
    if (!isUrl && !isPath) errors.push('图片目标必须是本地绝对路径或 http(s) URL');
    if (isUrl && !isHttpUrl(t)) errors.push('图片 URL 协议不被允许');
  }
  if (item.type === 'shortcut') {
    if (item.shortcutKind && !['global', 'send-to-app'].includes(item.shortcutKind)) {
      errors.push('快捷键类型无效');
    }
    if (item.shortcutKind === 'send-to-app' && !item.shortcutKeystroke) {
      errors.push('send-to-app 类型需要填写要发送的快捷键');
    }
  }
  if (item.type === 'action') {
    // 内置动作的目标必须是 known key，否则悬浮菜单点下去会没反应
    if (!isBuiltinActionKey(String(item.target || ''))) {
      errors.push('内置动作无效: ' + (item.target || '（空）'));
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateScene(scene: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!scene || typeof scene !== 'object') return { ok: false, errors: ['场景不是对象'] };
  if (typeof scene.id !== 'string' || !scene.id) errors.push('场景缺少 id');
  if (typeof scene.name !== 'string' || !scene.name.trim()) errors.push('场景名称不能为空');
  if (scene.layout && !LAYOUTS.includes(scene.layout)) errors.push('布局类型无效: ' + scene.layout);
  if (!Array.isArray(scene.items)) {
    errors.push('场景项目列表缺失');
  } else {
    scene.items.forEach((it: any, i: number) => {
      const r = validateItem(it);
      if (!r.ok) errors.push(`项目[${i}] ${it?.name || ''}: ${r.errors.join('; ')}`);
    });
  }
  return { ok: errors.length === 0, errors };
}

export function validateConfig(cfg: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!cfg || typeof cfg !== 'object') return { ok: false, errors: ['配置不是对象'] };
  if (typeof cfg.schemaVersion !== 'number') errors.push('缺少 schemaVersion');
  if (!Array.isArray(cfg.scenes) || cfg.scenes.length === 0) errors.push('场景列表为空或缺失');

  const ids: string[] = [];
  (cfg.scenes || []).forEach((s: any, i: number) => {
    const r = validateScene(s);
    if (!r.ok) errors.push(`场景[${i}] ${s?.name || ''}: ${r.errors.join('; ')}`);
    if (s?.id) ids.push(s.id);
  });
  if (ids.length && new Set(ids).size !== ids.length) errors.push('场景 id 重复');
  if (cfg.scenes?.length && (!cfg.currentSceneId || !ids.includes(cfg.currentSceneId))) {
    errors.push('当前场景 id 无效');
  }
  if (cfg.appearance && typeof cfg.appearance !== 'object') errors.push('appearance 格式错误');
  return { ok: errors.length === 0, errors };
}

export function assertConfig(cfg: AppConfig): AppConfig {
  const r = validateConfig(cfg);
  if (!r.ok) throw new Error('配置校验失败: ' + r.errors.join('; '));
  return cfg;
}
