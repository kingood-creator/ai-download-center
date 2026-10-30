// 视觉自检：悬浮窗「执行反馈」动画（对勾 + 扩散光环，替代旧绿色文字 toast）
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

app.whenReady().then(async () => {
  const cfg = {
    currentSceneId: 's1',
    scenes: [{ id: 's1', name: '默认', icon: '🏠', themeColor: '#3b82f6', gradientColor: '#7c3aed', gradientAngle: 145, dotSize: 72, ringRadius: 150, iconSize: 44, glassOpacity: 0.55, menuOpacity: 0.9, layout: 'radial', showLabels: true, isDefault: true, items: [] }],
    appearance: { clickOutsideToClose: true },
  };

  ipcMain.handle('config:get', () => cfg);
  ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
  ipcMain.handle('float:dragEnd', () => ({ moved: false }));
  ipcMain.on('float:resize', () => {});
  ipcMain.on('float:contextMenu', () => {});
  ipcMain.on('item:contextMenu', () => {});
  ipcMain.on('float:activate', () => {});
  ipcMain.on('float:dragStart', () => {});
  ipcMain.on('log:msg', () => {});
  ipcMain.on('diag:log', () => {});

  const win = new BrowserWindow({
    width: 360, height: 360, show: false, transparent: true,
    frame: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(DIST, 'main', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));
  // 触发成功反馈动画
  win.webContents.send('toast', '已启动', 'success');
  await new Promise((r) => setTimeout(r, 200)); // 动画中途抓拍
  const out = '/tmp/fd-visual/fx-success.png';
  await win.capturePage().then((img) => require('fs').writeFileSync(out, img.toPNG()));
  console.log('FX_OK ' + out);
  app.exit(0);
});
