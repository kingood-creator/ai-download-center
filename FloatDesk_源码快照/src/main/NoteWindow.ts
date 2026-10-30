// 便签窗口：无边框置顶、自动保存、多组彩色标签各带一组历史版本、颜色/透明度/位置可记忆
// 行为对齐原「输入法悬浮球」的便签：输入即存，空闲 5 秒记一版历史，关闭时强制落盘。
import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { NoteConfig } from '../shared/types';
import {
  NOTE_DEFAULT_COLOR,
  NOTE_DEFAULT_FONT_SIZE,
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_OPACITY,
  NOTE_DEFAULT_WIDTH,
  NoteBook,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  clampNoteOpacity,
  noteBookActive,
  normalizeNoteBook,
  normalizeNoteColor,
  patchNotePage,
} from '../shared/note';
import { loadBook, pruneHistory, pushPageHistory, saveBook } from './NoteStore';
import { attachTextEditContextMenu } from './ContextMenu';
import { log } from './Logging';

/** 空闲多久记一版历史（毫秒） */
const MILESTONE_MS = 5000;

export interface NoteHost {
  getNoteConfig(): NoteConfig;
  patchNoteConfig(patch: Partial<NoteConfig>): void;
}

export function defaultNoteConfig(): NoteConfig {
  return {
    color: NOTE_DEFAULT_COLOR,
    opacity: NOTE_DEFAULT_OPACITY,
    fontSize: NOTE_DEFAULT_FONT_SIZE,
    x: null,
    y: null,
    width: NOTE_DEFAULT_WIDTH,
    height: NOTE_DEFAULT_HEIGHT,
  };
}

export class NoteWindow {
  win: BrowserWindow | null = null;
  private host: NoteHost;
  /** 整本便签（多组标签）；渲染进程是主编，这里是它的落盘副本 */
  private book: NoteBook | null = null;
  /** 当前这一组的正文（关闭时用它兜底落盘） */
  private lastHtml = '';
  private lastText = '';
  private milestoneTimer: NodeJS.Timeout | null = null;
  private boundsTimer: NodeJS.Timeout | null = null;

  constructor(host: NoteHost) {
    this.host = host;
  }

  open(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) {
      if (!this.win.isVisible()) this.win.show();
      this.win.focus();
      return this.win;
    }
    const c = this.config();
    // 老配置里存的是没有工具栏时代的 320x260，直接沿用会把正文挤成两条；
    // 这里按最小可用尺寸兜一下（对用户来说就是"便签变大了一点"）。
    const w = Math.max(Math.round(c.width) || NOTE_DEFAULT_WIDTH, NOTE_MIN_WIDTH);
    const h = Math.max(Math.round(c.height) || NOTE_DEFAULT_HEIGHT, NOTE_MIN_HEIGHT);
    const pos = this.initialPos(w, h);

    this.book = loadBook();
    const act = noteBookActive(this.book);
    this.lastHtml = act ? act.html : '';
    this.lastText = act ? act.text : '';
    this.win = new BrowserWindow({
      width: w,
      height: h,
      x: pos.x,
      y: pos.y,
      minWidth: NOTE_MIN_WIDTH,
      minHeight: NOTE_MIN_HEIGHT,
      title: '便签',
      frame: false,
      resizable: true,
      // 便签要一直浮在最上面，但不能抢走前台应用的焦点（否则切输入法会打断输入）
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: c.color,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'note', 'index.html'));
    attachTextEditContextMenu(this.win);
    this.win.setOpacity(clampNoteOpacity(c.opacity));
    this.win.setAlwaysOnTop(true, 'floating');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.win.once('ready-to-show', () => this.win?.show());

    this.win.on('move', () => this.scheduleBoundsSave());
    this.win.on('resize', () => this.scheduleBoundsSave());
    this.win.on('close', () => {
      // 渲染进程的防抖可能还差最后一拍，这里强制落盘 + 记一版历史
      this.flush(true);
    });
    this.win.on('closed', () => {
      this.win = null;
    });

    log(`便签窗口打开 @(${pos.x},${pos.y}) ${w}x${h}`);
    return this.win;
  }

  close(): void {
    this.win?.close();
  }

  /**
   * 渲染进程把整本便签报上来（标签增删改 + 当前页正文都在里面）。
   * 便签的内容由渲染进程掌管，主进程不做二次编辑，只负责「落盘 + 排历史」。
   */
  updateBook(rawBook: any): NoteBook {
    const b = normalizeNoteBook(rawBook, this.lastHtml, this.lastText);
    const before = this.book;
    this.book = b;
    const act = noteBookActive(b);
    this.lastHtml = act ? act.html : '';
    this.lastText = act ? act.text : '';
    saveBook(b);
    if (before && before.pages.length !== b.pages.length) pruneHistory(b);
    this.scheduleMilestone();
    return b;
  }

  /** 兼容老调用：只更新当前这一组的正文 */
  updateText(html: string, text: string): void {
    const b = this.book || loadBook();
    const act = noteBookActive(b);
    this.book = patchNotePage(b, act ? act.id : 'p1', { html, text });
    this.lastHtml = String(html == null ? '' : html);
    this.lastText = String(text == null ? '' : text);
    saveBook(this.book);
    this.scheduleMilestone();
  }

  /**
   * 把某一组恢复到某个历史版本。
   * 恢复前先把「现在的内容」记一版 —— 万一恢复错了，还能从历史里点回去。
   */
  restorePage(pageId: string, html: string, text: string): NoteBook {
    const b = this.book || loadBook();
    const id = String(pageId || '');
    const cur = b.pages.find((p) => p.id === id);
    if (cur) pushPageHistory(id, cur.html, cur.text);
    return this.updateBook(patchNotePage(b, id, { html, text }));
  }

  /** 内容（打开窗口 / 渲染进程初始化时要喂给它的当前这一组） */
  content(): { html: string; text: string } {
    return { html: this.lastHtml, text: this.lastText };
  }

  /** 整本便签的只读快照 */
  bookState(): NoteBook {
    if (!this.book) this.book = loadBook();
    return this.book;
  }

  /** 强制落盘；recordHistory 控制是否顺带记一版历史 */
  flush(recordHistory: boolean): void {
    if (this.milestoneTimer) {
      clearTimeout(this.milestoneTimer);
      this.milestoneTimer = null;
    }
    if (!this.book) this.book = loadBook();
    saveBook(this.book);
    if (recordHistory) {
      const act = noteBookActive(this.book);
      if (act) pushPageHistory(act.id, this.lastHtml, this.lastText);
    }
  }

  /** 空闲 5 秒记一版历史（切了标签就记到新标签名下） */
  private scheduleMilestone(): void {
    if (this.milestoneTimer) clearTimeout(this.milestoneTimer);
    this.milestoneTimer = setTimeout(() => {
      this.milestoneTimer = null;
      const act = this.book ? noteBookActive(this.book) : null;
      if (act) pushPageHistory(act.id, this.lastHtml, this.lastText);
    }, MILESTONE_MS);
  }

  /** 配置变了（颜色/透明度/字号）→ 应用到窗口 */
  applyConfig(patch: Partial<NoteConfig>): NoteConfig {
    this.host.patchNoteConfig(patch);
    const c = this.config();
    if (this.win && !this.win.isDestroyed()) {
      this.win.setOpacity(clampNoteOpacity(c.opacity));
      this.win.setBackgroundColor(normalizeNoteColor(c.color));
    }
    return c;
  }

  config(): NoteConfig {
    const c = this.host.getNoteConfig();
    return {
      color: normalizeNoteColor(c?.color),
      opacity: clampNoteOpacity(c?.opacity),
      fontSize: c?.fontSize || NOTE_DEFAULT_FONT_SIZE,
      x: typeof c?.x === 'number' ? c.x : null,
      y: typeof c?.y === 'number' ? c.y : null,
      width: c?.width || NOTE_DEFAULT_WIDTH,
      height: c?.height || NOTE_DEFAULT_HEIGHT,
    };
  }

  private scheduleBoundsSave(): void {
    if (this.boundsTimer) clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => {
      this.boundsTimer = null;
      this.saveBounds();
    }, 400);
  }

  private saveBounds(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const [x, y] = this.win.getPosition();
    const [width, height] = this.win.getSize();
    this.host.patchNoteConfig({ x, y, width, height });
  }

  /** 记住上次位置；没记过就放在主屏左上，且保证不超出可视区 */
  private initialPos(w: number, h: number): { x: number; y: number } {
    const c = this.config();
    const wa = screen.getPrimaryDisplay().workArea;
    if (typeof c.x === 'number' && typeof c.y === 'number') {
      const x = Math.max(wa.x, Math.min(c.x, wa.x + wa.width - w));
      const y = Math.max(wa.y, Math.min(c.y, wa.y + wa.height - h));
      return { x, y };
    }
    return { x: wa.x + 60, y: wa.y + 60 };
  }
}
