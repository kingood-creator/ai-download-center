// 视觉自检：长按圆点（不移动）弹出的「场景选择」面板
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

app.whenReady().then(async () => {
  const cfg = {
    currentSceneId: 's1',
    scenes: [
      { id: 's1', name: '日常办公', icon: '🏠', themeColor: '#3b82f6', gradientColor: '#7c3aed', gradientAngle: 145, dotSize: 72, ringRadius: 150, iconSize: 44, glassOpacity: 0.55, menuOpacity: 0.9, layout: 'radial', showLabels: true, isDefault: true, items: [] },
      { id: 's2', name: '跨境电商', icon: '🛒', themeColor: '#22c55e', dotSize: 72, ringRadius: 150, iconSize: 44, layout: 'radial', items: [] },
      { id: 's3', name: '英语学习', icon: '📖', themeColor: '#f59e0b', dotSize: 72, ringRadius: 150, iconSize: 44, layout: 'radial', items: [] },
    ],
    appearance: { clickOutsideToClose: true, pickerWidth: 360, pickerHeight: 500 },
  };

  ipcMain.handle('config:get', () => cfg);
  ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
  ipcMain.handle('float:dragEnd', () => ({ moved: false }));
  ipcMain.on('float:resize', (_e, mode, size) => console.log('resize', mode, size));
  ipcMain.on('float:resizePicker', (_e, w, h) => console.log('resizePicker', w, 'x', h));
  ipcMain.on('float:contextMenu', () => {});
  ipcMain.on('float:switchScene', (_e, id) => console.log('switchScene ->', id));
  ipcMain.on('float:activate', () => {});
  ipcMain.on('float:dragStart', () => {});
  ipcMain.on('diag:log', () => {});

  const win = new BrowserWindow({
    width: 360, height: 500, show: false, transparent: true,
    frame: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(DIST, 'main', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));
  // 右键圆点 → 场景选区弹出（含底部设置入口）
  await win.webContents.executeJavaScript(
    `document.getElementById('dot').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }))`,
    true
  );
  await new Promise((r) => setTimeout(r, 400));
  const state = await win.webContents.executeJavaScript(
    `(() => ({ open: !!document.querySelector('#scene-picker.open'), rows: document.querySelectorAll('#scene-picker .sp-row').length, cur: (document.querySelector('#scene-picker .sp-row.cur') || {}).textContent, acts: [...document.querySelectorAll('#scene-picker .sp-row.act')].map((r) => r.textContent.trim()) }))()`,
    true
  );
  console.log('PICKER_STATE', JSON.stringify(state));
  const out = '/tmp/fd-visual/picker-open.png';
  await win.capturePage().then((img) => require('fs').writeFileSync(out, img.toPNG()));
  console.log('PICKER_OK ' + out);
  app.exit(0);
});
