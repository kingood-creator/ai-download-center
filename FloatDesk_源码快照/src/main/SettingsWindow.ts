// 设置窗口：macOS 风格、可调整大小、带边框
import { BrowserWindow } from 'electron';
import * as path from 'path';
import { Channels } from '../shared/ipc';
import { attachTextEditContextMenu } from './ContextMenu';

export class SettingsWindow {
  win: BrowserWindow | null = null;

  /** 待投递的「定位」请求（窗口还在加载时先存起来，load 完成后补发） */
  private pending: { channel: string; id: string } | null = null;

  openOrFocus(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus();
      return this.win;
    }
    this.win = new BrowserWindow({
      // 常规页合并了外观后是两栏布局，默认窗口要够宽（≥1100）才两栏并排；
      // 太窄会自动收成单栏（见 index.html 里 .grid2 的 1020px 断点）。
      width: 1180,
      height: 800,
      minWidth: 900,
      minHeight: 580,
      title: 'FloatDesk 设置',
      show: true,
      backgroundColor: '#0f1220',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));
    attachTextEditContextMenu(this.win);
    this.win.on('closed', () => {
      this.win = null;
    });
    return this.win;
  }

  /** 打开设置并定位到某个项目（打开编辑弹窗） */
  focusItem(itemId: string): void {
    this.dispatch(Channels.settingsFocusItem, itemId);
  }

  /** 打开设置并定位到某个场景 */
  focusScene(sceneId: string): void {
    this.dispatch(Channels.settingsFocusScene, sceneId);
  }

  /**
   * 打开设置并直接切到某一页（如项目库）。
   * 悬浮菜单里右键项目就有这个入口：不用先开设置再找导航。
   */
  gotoView(view: string): void {
    this.dispatch(Channels.settingsGotoView, view);
  }

  private dispatch(channel: string, id: string): void {
    const w = this.openOrFocus();
    this.pending = { channel, id };
    const flush = (): void => {
      if (!this.pending) return;
      const p = this.pending;
      this.pending = null;
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send(p.channel, p.id);
    };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => setTimeout(flush, 120));
    else setTimeout(flush, 60);
  }

  close(): void {
    this.win?.close();
  }
}
