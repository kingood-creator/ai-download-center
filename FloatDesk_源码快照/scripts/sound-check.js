// 菜单音效自检（开发用，不打包）：
//   1) 主进程能把 /System/Library/Sounds/*.aiff 转成 WAV，返回可播放的 data URL，并缓存到 userData/sounds
//   2) 合成音效不需要文件（返回 synth 标记，由渲染层算波形）
//   3) 悬浮窗里的音效引擎：鼠标移到菜单按钮上真的会发响（hover），点击发 click
//   4) 总开关关掉 / 该项选「不播放」时不发响；快速扫过时 40ms 内只响一次（不糊成一片）
//   5) 系统音效解码失败时能退回合成音效，不会静默失声
// 运行：./node_modules/.bin/electron scripts/sound-check.js --no-sandbox --disable-gpu
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = '/tmp/fd-sound';
fs.mkdirSync(OUT, { recursive: true });
// 和 main.ts 里同一条开关：否则没有用户手势时 AudioContext 会一直 suspended（听不到声音）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// 用临时 userData：转码缓存写到 /tmp，不碰真实配置
app.setPath('userData', path.join(OUT, 'userData'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else {
    failed++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

const DOT = 64, RING = 120, ICON = 44;
const baseCfg = (sound) => ({
  currentSceneId: 's1',
  scenes: [
    {
      id: 's1', name: '音效', icon: '🔊', themeColor: '#3b82f6', gradientColor: '#7c3aed', gradientAngle: 145,
      dotSize: DOT, ringRadius: RING, iconSize: ICON, glassOpacity: 0.55, menuOpacity: 0.9,
      layout: 'radial', showLabels: false, isDefault: true,
      items: [
        { id: 'i1', name: '访达', type: 'app', target: '/System/Library/CoreServices/Finder.app', icon: '🙂', order: 0, enabled: true },
        { id: 'i2', name: 'Safari', type: 'app', target: '/Applications/Safari.app', icon: '🧭', order: 1, enabled: true },
        { id: 'i3', name: 'GitHub', type: 'web', target: 'https://github.com', icon: '🐙', order: 2, enabled: true },
      ],
    },
  ],
  appearance: {
    clickOutsideToClose: true, reduceMotion: false,
    linkedAppEnabled: false, linkedAppDuration: 0, linkedAppBgOpacity: 1, linkedAppTextColor: '#e8ecf6',
  },
  sound,
});

app.whenReady().then(async () => {
  const S = require(path.join(DIST, 'main', 'SoundLibrary.js'));
  const Snd = require(path.join(DIST, 'shared', 'sounds.js'));

  // ---------- 1) 主进程：系统音效转码 ----------
  const tink1 = await S.soundDataById('tink');
  check('系统音效 Tink 能取到可播放数据', !!tink1 && tink1.ok === true, JSON.stringify(tink1 && { ok: tink1.ok, error: tink1.error }));
  const b64 = String((tink1 && tink1.dataUrl) || '');
  check('返回的是 data:audio/wav 的 base64', b64.startsWith('data:audio/wav;base64,'), b64.slice(0, 40));
  {
    const bin = Buffer.from(b64.split(',')[1] || '', 'base64');
    check('解出来的确是 WAV（RIFF/WAVE 头，且不是空文件）',
      bin.length > 2000 && bin.toString('ascii', 0, 4) === 'RIFF' && bin.toString('ascii', 8, 12) === 'WAVE',
      'bytes=' + bin.length);
    const wavPath = path.join(OUT, 'userData', 'sounds', 'Tink.wav');
    check('转码结果缓存在 userData/sounds（下次不用再转）', fs.existsSync(wavPath) && fs.statSync(wavPath).size > 2000, wavPath);
  }
  const tink2 = await S.soundDataById('tink');
  check('同一个音效第二次直接命中缓存（内容一致）', tink2.ok && tink2.dataUrl === tink1.dataUrl);

  const synth = await S.soundDataById('tick');
  check('合成音效不读文件（返回 synth 标记）', synth.ok === false && synth.synth === true, JSON.stringify(synth));
  const nope = await S.soundDataById('nope');
  check('不存在的音效返回明确错误', nope.ok === false && !!nope.error, JSON.stringify(nope));

  await S.preloadSoundFiles(['pop', 'none', 'tick']);
  check('预热把配置里用到的系统音效都转好了（Pop）',
    fs.existsSync(path.join(OUT, 'userData', 'sounds', 'Pop.wav')));
  check('预热遇到 none / 合成音效不会报错', true);

  // ---------- 2) 悬浮窗里的音效引擎 ----------
  ipcMain.handle('config:get', () => baseCfg({ enabled: true, hover: 'tink', click: 'pop', open: 'none', volume: 60 }));
  ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
  ipcMain.handle('float:dragEnd', () => ({ moved: false }));
  ipcMain.handle('float:linkedGet', () => null);
  ipcMain.handle('sound:get', (_e, id) => S.soundDataById(String(id || '')));
  ipcMain.on('float:resize', (_e, _m, size) => {
    const b = win.getBounds();
    const s = Math.max(120, Math.round(size));
    win.setBounds({ x: Math.round(b.x + b.width / 2 - s / 2), y: Math.round(b.y + b.height / 2 - s / 2), width: s, height: s });
  });
  for (const ch of ['float:contextMenu', 'float:activate', 'float:dragStart', 'float:switchScene', 'diag:log', 'float:savePos', 'float:resizePicker', 'float:quit', 'settings:open', 'preview:open', 'note:open']) {
    ipcMain.on(ch, () => {});
  }
  ipcMain.handle('action:runById', () => ({ ok: true }));

  const win = new BrowserWindow({
    width: 2 * (RING + ICON / 2 + 30), height: 2 * (RING + ICON / 2 + 30),
    show: true, transparent: true, frame: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
  await sleep(800);

  const hasEngine = await win.webContents.executeJavaScript(`typeof window.FDSound === 'object' && !!window.FDSound.play`);
  check('悬浮窗加载了音效引擎（window.FDSound）', hasEngine === true);
  check('AudioContext 处于 running（suspended 就等于静音）',
    (await win.webContents.executeJavaScript(`window.FDSound._ctxState()`)) === 'running');

  // 展开菜单（和真机一样：点圆点 → 主进程回报未移动 → 展开）
  await win.webContents.executeJavaScript(`(() => {
    const d = document.getElementById('dot');
    d.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    return true;
  })()`);
  await sleep(700);
  const itemCount = await win.webContents.executeJavaScript(`document.querySelectorAll('#menu .menu-item').length`);
  check('菜单已展开（有可悬停的按钮）', itemCount === 3, String(itemCount));

  const hoverPlay = await win.webContents.executeJavaScript(`(async () => {
    const F = window.FDSound;
    F.stats.plays = 0; F.stats.lastEvent = ''; F.stats.lastId = ''; F.stats.errors = 0;
    F.configure({ enabled: true, hover: 'tink', click: 'pop', open: 'none', volume: 60 });
    const el = document.querySelector('#menu .menu-item');
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await new Promise(r => setTimeout(r, 600));
    return { plays: F.stats.plays, event: F.stats.lastEvent, id: F.stats.lastId, errors: F.stats.errors, failed: F.stats.failed };
  })()`);
  check('移动到按钮上会响（hover + Tink，解码无错）',
    hoverPlay.plays >= 1 && hoverPlay.event === 'hover' && hoverPlay.id === 'tink' && hoverPlay.errors === 0,
    JSON.stringify(hoverPlay));

  const throttle = await win.webContents.executeJavaScript(`(async () => {
    const F = window.FDSound;
    F.stats.plays = 0;
    const els = document.querySelectorAll('#menu .menu-item');
    // 连着扫过三个按钮：只有第一下该响（40ms 节流）
    els[0].dispatchEvent(new MouseEvent('mouseenter'));
    els[1].dispatchEvent(new MouseEvent('mouseenter'));
    els[2].dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 500));
    return F.stats.plays;
  })()`);
  check('快速扫过一整圈不会连着响（40ms 节流）', throttle === 1, String(throttle));

  const synthPlay = await win.webContents.executeJavaScript(`(async () => {
    const F = window.FDSound;
    F.stats.plays = 0; F.stats.lastId = '';
    F.configure({ enabled: true, hover: 'tick', click: 'pop', open: 'none', volume: 60 });
    await new Promise(r => setTimeout(r, 60));
    document.querySelector('#menu .menu-item').dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 400));
    return { plays: F.stats.plays, id: F.stats.lastId };
  })()`);
  check('合成音效（不依赖系统文件）也能响', synthPlay.plays >= 1 && synthPlay.id === 'tick', JSON.stringify(synthPlay));

  const disabled = await win.webContents.executeJavaScript(`(async () => {
    const F = window.FDSound;
    F.stats.plays = 0;
    F.configure({ enabled: false, hover: 'tink', click: 'pop', open: 'none', volume: 60 });
    await new Promise(r => setTimeout(r, 60));
    document.querySelector('#menu .menu-item').dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 400));
    return F.stats.plays;
  })()`);
  check('总开关关掉后完全不响', disabled === 0, String(disabled));

  const noneSel = await win.webContents.executeJavaScript(`(async () => {
    const F = window.FDSound;
    F.stats.plays = 0;
    F.configure({ enabled: true, hover: 'none', click: 'pop', open: 'none', volume: 60 });
    await new Promise(r => setTimeout(r, 60));
    document.querySelector('#menu .menu-item').dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 300));
    return F.stats.plays;
  })()`);
  check('该项选「不播放」时不发声', noneSel === 0, String(noneSel));

  const clickPlay = await win.webContents.executeJavaScript(`(async () => {
    const F = window.FDSound;
    F.stats.plays = 0; F.stats.lastEvent = '';
    F.configure({ enabled: true, hover: 'tink', click: 'pop', open: 'none', volume: 60 });
    await new Promise(r => setTimeout(r, 60));
    document.querySelector('#menu .menu-item').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    return { plays: F.stats.plays, event: F.stats.lastEvent };
  })()`);
  check('点击项目会响（click + Pop）', clickPlay.plays >= 1 && clickPlay.event === 'click', JSON.stringify(clickPlay));

  // 点击项目会把菜单收起（真实行为），后面的检查要先把菜单再展开
  const expandMenu = async () => {
    await win.webContents.executeJavaScript(`(() => {
      if (document.querySelectorAll('#menu .menu-item').length) return true;
      const d = document.getElementById('dot');
      d.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
      return true;
    })()`);
    await sleep(600);
  };
  await expandMenu();
  const reopened = await win.webContents.executeJavaScript(`document.querySelectorAll('#menu .menu-item').length`);
  check('点击执行后菜单收起，再点圆点能重新展开（不影响后续交互）', reopened === 3, String(reopened));

  // 系统音效取不到时（主进程转码失败 / 系统没有那个音效）必须退回合成音效，不能静默失声。
  // contextBridge 暴露的 api 是冻结的，页面里改不动 → 另开一个窗口，配一个「故意失败」的 preload 来验。
  const stubPreload = path.join(OUT, 'stub-preload.js');
  fs.writeFileSync(stubPreload, `
const { contextBridge } = require('electron');
const cfg = {
  currentSceneId: 's1',
  scenes: [{ id: 's1', name: 'x', icon: '🔊', themeColor: '#3b82f6', gradientColor: '#3b82f6', gradientAngle: 145,
    dotSize: ${DOT}, ringRadius: ${RING}, iconSize: ${ICON}, glassOpacity: 0.55, menuOpacity: 0.9,
    layout: 'radial', showLabels: false, isDefault: true,
    items: [{ id: 'i1', name: 'A', type: 'web', target: 'https://a.com', icon: '🔗', order: 0, enabled: true }] }],
  appearance: {},
  sound: { enabled: true, hover: 'glass', click: 'pop', open: 'none', volume: 60 },
};
contextBridge.exposeInMainWorld('api', {
  getConfig: async () => cfg,
  getSound: async () => ({ ok: false, error: '模拟：转码失败' }),
  logMsg: () => {},
  resizeFloating: () => {},
  dragStart: () => {},
  dragEnd: async () => ({ moved: false }),
  getLinkedApp: async () => null,
  runItemById: async () => ({ ok: true }),
  onSceneChanged: () => {},
  onToast: () => {},
  onLinkedApp: () => {},
});
`);
  const win2 = new BrowserWindow({
    width: 2 * (RING + ICON / 2 + 30), height: 2 * (RING + ICON / 2 + 30),
    show: false, transparent: true, frame: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: stubPreload,
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  await win2.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
  await sleep(600);
  await win2.webContents.executeJavaScript(`(() => {
    const d = document.getElementById('dot');
    d.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  const fallback = await win2.webContents.executeJavaScript(`(async () => {
    const F = window.FDSound;
    // 注意：页面初始化时已经按配置预加载过 hover 音效并失败过一次，失败列表里应当留下 'glass'
    F.stats.plays = 0;
    F.configure({ enabled: true, hover: 'glass', click: 'pop', open: 'none', volume: 60 });
    await new Promise(r => setTimeout(r, 300));
    const el = document.querySelector('#menu .menu-item');
    if (!el) return { err: '菜单没展开' };
    el.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 500));
    return { plays: F.stats.plays, errors: F.stats.errors, failed: F.stats.failed.slice() };
  })()`);
  check('系统音效取不到时退回合成音效（仍然有声音，不是静默）',
    fallback.plays >= 1 && ((fallback.errors || 0) >= 1 || (fallback.failed || []).indexOf('glass') >= 0),
    JSON.stringify(fallback));
  win2.destroy();

  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'sound-menu.png'), img.toPNG()));
  console.log('[shot] 菜单 → ' + OUT + '/sound-menu.png');

  console.log(failed ? '[FAIL] ' + failed + ' 项未通过' : '[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
});
