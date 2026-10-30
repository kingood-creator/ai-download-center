// 悬浮菜单图标观感自检（开发用，不打包）：
// 一个场景里同时放「原生图标的应用」「原生图标的文件夹」「emoji 兜底的网页/快捷键」，
// 展开菜单截图，确认三者摆在一起观感统一（应用是真实 macOS 图标，其它是 macOS 风格圆角方块）。
// 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/float-icons-shot.js --no-sandbox --disable-gpu
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = '/tmp/fd-icons';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else {
    failed++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

const DOT = 64, RING = 96, ICON = 44;

const cfg = () => ({
  currentSceneId: 's1',
  scenes: [
    {
      id: 's1', name: '图标观感', icon: '🎨', themeColor: '#3b82f6', gradientColor: '#7c3aed', gradientAngle: 145,
      dotSize: DOT, ringRadius: RING, iconSize: ICON, glassOpacity: 0.55, menuOpacity: 0.9,
      layout: 'radial', showLabels: false, isDefault: true,
      items: [
        { id: 'i1', name: '访达', type: 'app', target: '/System/Library/CoreServices/Finder.app', icon: '', order: 0, enabled: true },
        { id: 'i2', name: 'Safari', type: 'app', target: '/Applications/Safari.app', icon: '', order: 1, enabled: true },
        { id: 'i3', name: '备忘录', type: 'app', target: '/System/Applications/Notes.app', icon: '', order: 2, enabled: true },
        { id: 'i4', name: '下载', type: 'file', target: path.join(os.homedir(), 'Downloads'), icon: '', order: 3, enabled: true },
        { id: 'i5', name: 'GitHub', type: 'web', target: 'https://github.com', icon: '🐙', order: 4, enabled: true },
        { id: 'i6', name: '复制', type: 'shortcut', target: '', icon: '⌨️', order: 5, enabled: true, shortcutKind: 'send-to-app', shortcutKeystroke: 'command+c' },
      ],
    },
  ],
  appearance: {
    clickOutsideToClose: true, reduceMotion: false,
    linkedAppEnabled: false, linkedAppDuration: 0, linkedAppBgOpacity: 1, linkedAppTextColor: '#e8ecf6',
  },
});

app.whenReady().then(async () => {
  const { repairConfig } = require(path.join(DIST, 'main', 'Repair.js'));
  const c = cfg();
  // 用真实体检把「空图标」补成原生图标（这就是用户首次启动时会发生的事）
  const r = await repairConfig(c, os.homedir());
  console.log(`  · 体检补图标 ${r.iconsFilled}/${r.checked}`);

  ipcMain.handle('config:get', () => c);
  ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
  ipcMain.handle('float:dragEnd', () => ({ moved: false }));
  ipcMain.handle('float:linkedGet', () => null);
  ipcMain.on('float:resize', (_e, _m, size) => {
    const b = win.getBounds();
    const s = Math.max(120, Math.round(size));
    win.setBounds({ x: Math.round(b.x + b.width / 2 - s / 2), y: Math.round(b.y + b.height / 2 - s / 2), width: s, height: s });
  });
  for (const ch of ['float:contextMenu', 'item:contextMenu', 'float:activate', 'float:dragStart', 'float:switchScene', 'log:msg', 'diag:log', 'float:savePos']) {
    ipcMain.on(ch, () => {});
  }

  const win = new BrowserWindow({
    width: 2 * (RING + ICON / 2 + 30), height: 2 * (RING + ICON / 2 + 30),
    show: true, transparent: true, frame: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
  await sleep(700);

  const CLICK = `(() => {
    const d = document.getElementById('dot');
    d.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    return true;
  })()`;
  await win.webContents.executeJavaScript(CLICK);
  await sleep(700);

  const probe = await win.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll('#menu .menu-item')];
    return {
      n: items.length,
      imgs: items.filter(n => n.querySelector('img')).length,
      tiles: items.filter(n => n.querySelector('.ico-tile')).length,
      srcs: items.map(n => { const i = n.querySelector('img'); return i ? i.getAttribute('src') : null; }).filter(Boolean),
    };
  })()`);
  check('菜单渲染出 6 个项目', probe.n === 6, JSON.stringify(probe.n));
  check('应用/文件夹用了原生图标（img）', probe.imgs === 4, JSON.stringify(probe));
  check('网页/快捷键用了 macOS 风格圆角方块（ico-tile）', probe.tiles === 2, JSON.stringify(probe));
  check('原生图标指向已落盘的 PNG', probe.srcs.every((s) => s.startsWith('/') && fs.existsSync(s)), JSON.stringify(probe.srcs));

  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'floating-icons.png'), img.toPNG()));
  console.log('[shot] 悬浮菜单图标 → ' + OUT + '/floating-icons.png');

  console.log(failed ? '[FAIL] ' + failed + ' 项未通过' : '[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
});
