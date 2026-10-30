// 视觉自检（开发用，不打包进应用）：
//  1) 便签窗口：富文本工具栏 + 代码块带「复制」按钮 + 加粗 + 有序列表
//  2) 悬浮圆点：蓝→紫双色渐变（最初设计稿那颗）
// 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/visual-check.js --no-sandbox
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = '/tmp/fd-visual';

const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const sharedNote = require(path.join(DIST, 'shared', 'note.js'));

const cfg = defaults.buildDefaultConfig();
const demoHtml =
  '<div>发布前必看：<b>三件事</b></div>' +
  '<div><ol><li>跑一遍 <code>npm test</code></li><li>确认便签能存</li><li>看圆点渐变</li></ol></div>' +
  '<pre><code>npm run smoke\n# 77 项断言全绿</code></pre>' +
  '<div>就这些。</div>';

ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:save', () => ({ ok: true }));
// 设置页拖动连续控件时只走 preview（不写盘），这里给个空桩免得报「无 handler」
ipcMain.handle('config:preview', () => ({ ok: true }));
// 音效下拉需要预制清单，否则设置页加载时会报 No handler registered for 'sound:list'
ipcMain.handle('sound:list', () => {
  const s = require(path.join(DIST, 'shared', 'sounds.js'));
  return { presets: s.SOUND_PRESETS, groups: s.SOUND_GROUP_LABELS, defaults: s.DEFAULT_SOUND_CONFIG, none: s.SOUND_NONE };
});
ipcMain.handle('sound:get', () => ({ ok: false, error: '截图模式不播音频' }));
// 项目库预制清单（不解析图标，够截图用）
ipcMain.handle('library:presets', () => {  const lib = require(path.join(DIST, 'shared', 'itemLibrary.js'));
  try {
    return lib.buildBuiltinLibrary(require('os').homedir());
  } catch (e) {
    return [];
  }
});
ipcMain.handle('note:presets', () => sharedNote.NOTE_PRESET_COLORS);
ipcMain.handle('note:load', () => ({
  html: demoHtml,
  text: 'demo',
  config: { color: '#fff6c9', opacity: 1, fontSize: 14, x: null, y: null, width: 340, height: 320 },
  history: 2,
}));
ipcMain.handle('note:save', () => ({ ok: true }));
ipcMain.handle('note:history', () => []);
ipcMain.handle('note:restore', () => ({ ok: false }));
ipcMain.handle('note:copy', (_e, t) => {
  clipboard.writeText(String(t || ''));
  return { ok: true };
});
ipcMain.handle('note:configSave', (_e, p) => ({ ok: true, config: Object.assign({ color: '#fff6c9' }, p || {}) }));
ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
ipcMain.handle('float:dragEnd', () => ({ moved: false }));
ipcMain.handle('float:linkedGet', () => ({ ok: true, linked: { enabled: false, items: [] } }));
ipcMain.handle('scene:changed', () => true);
// 设置页需要的桩
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'visual', log: '' }));
ipcMain.handle('builtins:actions', () => require(path.join(DIST, 'shared', 'builtins.js')).BUILTIN_ACTIONS);
ipcMain.handle('ime:snapshot', () => ({ ok: true, current: '', sources: [] }));
ipcMain.handle('ime:toggle', () => ({ ok: true, via: 'tis' }));
ipcMain.handle('ime:select', () => ({ ok: true }));
ipcMain.handle('icon:probeLocal', () => ({ icon: '' }));
ipcMain.handle('action:runById', () => ({ ok: true }));
ipcMain.on('note:open', () => {});
ipcMain.on('note:close', () => {});
ipcMain.on('float:resize', () => {});
ipcMain.on('diag:log', () => {});
ipcMain.on('settings:open', () => {});
ipcMain.on('settings:close', () => {});
ipcMain.on('preview:open', () => {});
ipcMain.on('perm:openSettings', () => {});
ipcMain.on('menu:itemContext', () => {});
ipcMain.on('float:contextMenu', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(win, file) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return file;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---- 1. 便签 ----
  const nwin = new BrowserWindow({
    width: 340,
    height: 320,
    show: false,
    backgroundColor: '#1b1b1b',
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  await nwin.loadFile(path.join(DIST, 'renderer', 'note', 'index.html'));
  await sleep(900); // 等 decorateCodeBlocks 把「复制」按钮挂上去
  await shoot(nwin, path.join(OUT_DIR, 'note.png'));

  // ---- 2. 悬浮圆点 ----
  const fwin = new BrowserWindow({
    width: 220,
    height: 220,
    show: false,
    transparent: false,
    backgroundColor: '#20232e',
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  await fwin.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
  await sleep(400);
  const frames = [
    ['#3b82f6', '#7c3aed', 145, 'dot-blue-purple.png'], // 默认（最初那颗）
    ['#f59e0b', '#f5290b', 145, 'dot-orange-red.png'],
    ['#10b981', '#109cb9', 145, 'dot-green-teal.png'],
    ['#3b82f6', '#3b82f6', 145, 'dot-solid-blue.png'],
  ];
  for (const [t, t2, ang, name] of frames) {
    const c = JSON.parse(JSON.stringify(cfg));
    c.scenes[0].themeColor = t;
    c.scenes[0].gradientColor = t2;
    c.scenes[0].gradientAngle = ang;
    c.currentSceneId = c.scenes[0].id;
    fwin.webContents.send('scene:changed', c);
    await sleep(350);
    await shoot(fwin, path.join(OUT_DIR, name));
  }

  // ---- 3. 设置页「常规」：已把「外观」并进来，一页两栏（左：场景/外观/悬浮球，右：行为/音效/选区/快捷键） ----
  const swin = new BrowserWindow({
    width: 1180,
    height: 800,
    show: false,
    backgroundColor: '#0b0d16',
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  await swin.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await sleep(800);
  await swin.webContents.executeJavaScript(
    `(async () => {
       const b = document.querySelector('[data-view="general"]');
       if (b) b.click();
       await new Promise(r => setTimeout(r, 500));
       return true;
     })()`,
    true
  );
  await sleep(400);
  await shoot(swin, path.join(OUT_DIR, 'settings-general-merged.png'));

  // ---- 4. 快捷键录制态：点「修改」后按住修饰键，呈现「已按住 Command…」+ 脉冲按钮 ----
  await swin.webContents.executeJavaScript(
    `(async () => {
       const g = document.querySelector('[data-view="general"]'); if (g) g.click();
       await new Promise(r => setTimeout(r, 400));
       const btn = document.getElementById('g-win-rec');
       if (btn) btn.click();
       await new Promise(r => setTimeout(r, 200));
       document.dispatchEvent(new KeyboardEvent('keydown', { key:'Meta', code:'MetaLeft', metaKey:true, bubbles:true }));
       await new Promise(r => setTimeout(r, 200));
       return true;
     })()`,
    true
  );
  await sleep(300);
  await shoot(swin, path.join(OUT_DIR, 'shortcut-recording.png'));

  console.log('VISUAL_OK ' + OUT_DIR);
  app.exit(0);
});
