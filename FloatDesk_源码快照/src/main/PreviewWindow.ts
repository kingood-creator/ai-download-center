// 图片预览窗口：独立于悬浮窗，用于查看本地或远程图片
import { BrowserWindow } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { attachTextEditContextMenu } from './ContextMenu';

let previewWin: BrowserWindow | null = null;

export function openPreview(target: string, isUrl: boolean): void {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.close();
  }
  const w = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 360,
    minHeight: 300,
    title: 'FloatDesk 图片预览',
    backgroundColor: '#0b0d16',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // 允许加载本地文件图片（file://）
    },
  });
  const url = pathToFileURL(path.join(__dirname, '..', 'renderer', 'preview', 'index.html'));
  url.searchParams.set('target', target);
  url.searchParams.set('url', isUrl ? '1' : '0');
  w.loadURL(url.toString());
  attachTextEditContextMenu(w);
  w.on('closed', () => {
    if (previewWin === w) previewWin = null;
  });
  previewWin = w;
}
