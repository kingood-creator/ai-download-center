// 截图自检（开发用，不打包）：用真实渲染拍一张「项目管理」页，确认图标列显示的是图片而不是路径文字
// 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/ui-shot.js --no-sandbox
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = process.argv.find((a) => a.endsWith('.png')) || '/tmp/fd-items-shot.png';

const defaults = require(path.join(DIST, 'shared', 'defaults.js'));

// 找一个真实存在的图标文件做样本（优先用刚才探测下载下来的）
const ICON_POOL = ['/tmp/fd-probe/item-icons/d3157085c38b6812.png', '/tmp/fd-probe/item-icons/d10a44e5d06c8a95.ico', '/tmp/fd-probe/item-icons/5dec89dc9dbcebff.svg'];
const sampleIcon = ICON_POOL.find((p) => fs.existsSync(p)) || '';

const cfg = defaults.buildDefaultConfig();
const scene = cfg.scenes[0];
scene.items = [
  {
    id: 'shot-1',
    name: '百度',
    type: 'web',
    target: 'https://www.baidu.com',
    icon: '🔍',
    order: 0,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'shot-2',
    name: '智谱清言',
    type: 'web',
    target: 'https://chatglm.cn/',
    icon: sampleIcon || '🔗',
    order: 1,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'shot-3',
    name: '一个名字特别长的项目用来验证省略号不会把表格撑坏',
    type: 'file',
    target: '/Users/mac/Documents/some/very/long/path/that/should/be/truncated.docx',
    icon: sampleIcon || '📄',
    order: 2,
    enabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];
cfg.currentSceneId = scene.id;

ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:save', () => ({ ok: true }));
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'shot', log: '' }));
ipcMain.handle('web:probe', () => ({ ok: false, error: '截图模式不联网' }));
ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
ipcMain.handle('float:dragEnd', () => ({ moved: false }));
ipcMain.handle('action:runById', () => ({ ok: true }));
['dialog:selectApp', 'dialog:selectFile', 'dialog:selectIconImage', 'config:export', 'config:import', 'config:reset'].forEach((c) =>
  ipcMain.handle(c, () => ({ canceled: true, ok: false }))
);
['float:resize', 'float:activate', 'float:dragStart', 'float:move', 'float:toggle', 'float:hide', 'float:savePos',
 'settings:open', 'settings:close', 'diag:log', 'preview:open', 'perm:openSettings', 'menu:itemContext', 'float:contextMenu',
 'float:dragEnd:sync'].forEach((c) => ipcMain.on(c, () => {}));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    show: true,
    backgroundColor: '#0f1220',
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await new Promise((r) => setTimeout(r, 700));
  await win.webContents.executeJavaScript(
    `(() => { document.querySelector('[data-view="items"]').click(); return true; })()`,
    true
  );
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('SHOT_SAVED ' + OUT);
  // 顺带把关键 DOM 事实打出来，便于断言
  const facts = await win.webContents.executeJavaScript(
    `(() => {
       const rows = [...document.querySelectorAll('#view-items tbody tr')];
       return rows.map((r) => {
         const cell = r.querySelector('.cellname');
         const img2 = cell && cell.querySelector('img.cellicon');
         return {
           name: cell && cell.querySelector('.nm') ? cell.querySelector('.nm').textContent : null,
           usesImg: !!img2,
           imgVisible: !!img2 && img2.style.display !== 'none' && img2.complete && img2.naturalWidth > 0,
           cellText: cell ? cell.textContent : null,
         };
       });
     })()`,
    true
  );
  console.log('SHOT_FACTS ' + JSON.stringify(facts, null, 2));
  app.exit(0);
});

app.on('window-all-closed', () => app.quit());
