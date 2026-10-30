// 悬浮球顶部「场景名标签」药丸的【样式 + 内容】自检（开发用，不打包）。
//
// 验的是用户这一轮的要求：展开菜单里的文字（就是圆点上方这条提示）改成参考图那种
// 「浅色磨砂胶囊 + 纯白粗体字」，而且是【全局统一】的 ——
//   · 换场景（主题色 / 圆点大小 / 环半径 / 图标尺寸全都不一样）样式一个字节都不变；
//   · 在设置页点「新建场景」造出来的新场景，用的也是这一套（不是老样式）。
//
// 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --no-sandbox --disable-gpu scripts/linked-pill-check.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const builtins = require(path.join(DIST, 'shared', 'builtins.js'));
const sounds = require(path.join(DIST, 'shared', 'sounds.js'));

const OUT = '/tmp/fd-pill';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// ---------- 配置：两个差异极大的老场景（红/紫，圆点 64/88）+ 后面由设置页新建一个 ----------
let cfg = defaults.buildDefaultConfig();
cfg.scenes = [
  {
    id: 's-red', name: '红场景', icon: '🔴', themeColor: '#ff3b30', gradientColor: '#ff9500', gradientAngle: 145,
    dotSize: 64, ringRadius: 60, iconSize: 44, glassOpacity: 0.55, menuOpacity: 0.9,
    layout: 'radial', showLabels: false, isDefault: true, enabled: true,
    items: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: 'r' + n, name: '红项目' + n, type: 'app', target: '/Applications/Utilities/Terminal.app',
      icon: '💻', order: n, enabled: true,
    })),
  },
  {
    id: 's-purple', name: '紫场景', icon: '🟣', themeColor: '#7c3aed', gradientColor: '#22d3ee', gradientAngle: 90,
    dotSize: 88, ringRadius: 180, iconSize: 64, glassOpacity: 0.35, menuOpacity: 0.7,
    layout: 'radial', showLabels: false, isDefault: false, enabled: true,
    items: [1, 2, 3, 4, 5].map((n) => ({
      id: 'p' + n, name: '紫项目' + n, type: 'app', target: '/Applications/Utilities/Terminal.app',
      icon: '💻', order: n, enabled: true,
    })),
  },
];
cfg.currentSceneId = 's-red';
cfg.appearance.linkedAppEnabled = true;
cfg.appearance.linkedAppDuration = 0;
cfg.appearance.linkedAppBgOpacity = 1;
cfg.appearance.linkedAppTextColor = '#ffffff';

// ---------- IPC 桩 ----------
let saves = 0;
ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:save', (_e, next) => {
  cfg = JSON.parse(JSON.stringify(next));
  saves++;
  return { ok: true };
});
ipcMain.handle('config:preview', (_e, next) => {
  if (next && Array.isArray(next.scenes)) cfg = JSON.parse(JSON.stringify(next));
  return { ok: true };
});
ipcMain.handle('builtins:actions', () => builtins.BUILTIN_ACTIONS);
ipcMain.handle('library:presets', () => []);
ipcMain.handle('app:scan', () => []);
ipcMain.handle('app:resolve', () => ({ ok: false }));
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'pill', log: '' }));
ipcMain.handle('note:presets', () => []);
ipcMain.handle('sound:list', () => ({
  presets: sounds.SOUND_PRESETS, groups: sounds.SOUND_GROUP_LABELS,
  defaults: sounds.DEFAULT_SOUND_CONFIG, none: sounds.SOUND_NONE,
}));
ipcMain.handle('sound:get', () => ({ ok: false, error: '自检不放音效' }));
ipcMain.handle('ime:snapshot', () => ({ ok: true, available: true, sources: [], currentId: '', currentName: '' }));
ipcMain.handle('web:probe', (_e, u) => ({ url: String(u || ''), title: '示例', siteName: '示例', iconPath: '' }));
ipcMain.handle('float:linkedGet', () => 'Terminal');
ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
ipcMain.handle('float:dragEnd', () => ({ moved: false }));
for (const ch of [
  'settings:open', 'settings:close', 'diag:log', 'note:open', 'note:close', 'preview:open',
  'float:contextMenu', 'item:contextMenu', 'float:activate', 'float:dragStart', 'float:dragEnd',
  'float:switchScene', 'log:msg', 'float:savePos',
]) ipcMain.on(ch, () => {});

// 真 setBounds：镜像 FloatingWindow.resize 的「保持中心」缩放，让渲染进程收到真实 resize
let floatWin = null;
ipcMain.on('float:resize', (_e, _mode, size) => {
  if (!floatWin) return;
  const b = floatWin.getBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  let s = Math.round(size);
  if (!s || Number.isNaN(s)) s = 224;
  s = Math.max(120, Math.min(760, s));
  floatWin.setBounds({ x: Math.round(cx - s / 2), y: Math.round(cy - s / 2), width: s, height: s });
});

// 药丸样式的探针：底色/边框/文字色/字号/字重/圆角/磨砂，全部取计算值
const STYLE = `(() => {
  const p = document.getElementById('linked-app');
  const cs = getComputedStyle(p);
  const r = p.getBoundingClientRect();
  return {
    bg: cs.backgroundColor,
    border: cs.borderTopColor,
    borderW: cs.borderTopWidth,
    fg: cs.color,
    fs: cs.fontSize,
    fw: cs.fontWeight,
    radius: cs.borderTopLeftRadius,
    shadow: cs.textShadow,
    filter: cs.backdropFilter || cs.webkitBackdropFilter || '',
    h: Math.round(r.height), w: Math.round(r.width),
    txt: p.textContent.trim(),
  };
})()`;

const CLICK = `(() => {
  const d = document.getElementById('dot');
  d.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  return true;
})()`;

/** "rgba(226, 229, 255, 0.3)" → { r,g,b,a } */
function parseColor(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => Number(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

app.whenReady().then(async () => {
  // ---------- 悬浮窗（透明，和真身一样） ----------
  const sc0 = cfg.scenes[0];
  const collapsed = Math.round(sc0.dotSize + 56);
  floatWin = new BrowserWindow({
    width: collapsed, height: collapsed, show: true, transparent: true,
    frame: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  await floatWin.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
  await sleep(600);
  floatWin.webContents.send('float:linked', 'Terminal');
  await sleep(400);
  await floatWin.webContents.executeJavaScript(CLICK); // 展开
  await sleep(650);

  const base = await floatWin.webContents.executeJavaScript(STYLE);
  const bg = parseColor(base.bg);
  const bd = parseColor(base.border);

  // 1) 形状：淡紫磨砂胶囊 + 纯白粗体字
  check('提示条底色是淡紫磨砂（不再是原来的深色底 rgb(12,15,26)）',
    !!bg && bg.r >= 120 && bg.b >= bg.r && bg.a > 0.4 && bg.a < 0.8,
    base.bg);
  check('提示条边框是白色亮边（不再掺场景主题色）',
    !!bd && bd.r >= 200 && bd.g >= 200 && bd.b >= 200, base.border);
  check('文字是纯白 #ffffff', base.fg === 'rgb(255, 255, 255)', base.fg);
  check('文字加粗（font-weight ≥ 700）', Number(base.fw) >= 700, base.fw);
  check('字号 12px、胶囊圆角', base.fs === '12px' && parseFloat(base.radius) >= 999, `${base.fs} / ${base.radius}`);
  check('有背景磨砂（backdrop-filter 生效）', /blur/.test(base.filter), base.filter);
  check('文字带描边阴影（底再浅也读得清）', !!base.shadow && base.shadow !== 'none', base.shadow);
  check('提示条内容是当前场景名（不再是「↗ 应用名」）', base.txt === sc0.name, JSON.stringify({ txt: base.txt, expect: sc0.name }));

  // 2) 换场景：主题色/圆点/环半径/图标全不同，样式必须一个字节都不变
  const other = cfg.scenes[1];
  cfg.currentSceneId = other.id;
  floatWin.webContents.send('scene:changed', cfg);
  await sleep(500);
  let p = await floatWin.webContents.executeJavaScript(STYLE);
  if (!p || p.h === 0) { await floatWin.webContents.executeJavaScript(CLICK); await sleep(650); p = await floatWin.webContents.executeJavaScript(STYLE); }
  check('换到「紫场景」（主题色/圆点 88/环 180/图标 64）后样式完全一致',
    p.bg === base.bg && p.border === base.border && p.fg === base.fg &&
      p.fs === base.fs && p.fw === base.fw && p.radius === base.radius,
    JSON.stringify({ 红: [base.bg, base.border], 紫: [p.bg, p.border] }));
  await sleep(200);
  await floatWin.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'pill-purple-scene.png'), img.toPNG()));

  // 3) 回到第一个场景，截图留档
  cfg.currentSceneId = cfg.scenes[0].id;
  floatWin.webContents.send('scene:changed', cfg);
  await sleep(500);
  p = await floatWin.webContents.executeJavaScript(STYLE);
  await floatWin.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'pill-red-scene.png'), img.toPNG()));

  // ---------- 设置页：真点一次「新建场景」，验证新场景也用这一套 ----------
  const setWin = new BrowserWindow({
    width: 1180, height: 800, show: true,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  setWin.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.log('  [page-error] ' + msg);
  });
  await setWin.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await sleep(1200);

  const created = await setWin.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const scenes = document.querySelector('[data-view="scenes"]');
    if (!scenes) return { error: '导航里没有场景管理' };
    scenes.click();
    await sleep(320);
    const add = document.getElementById('sc-new');
    if (!add) return { error: '页面上没有「新建场景」' };
    add.click();
    await sleep(220);
    const name = document.querySelector('#sm-name');
    if (!name) return { error: '编辑弹窗没打开' };
    name.value = '自检新场景';
    const color = document.querySelector('#sm-color');
    if (color) { color.value = '#22c55e'; color.dispatchEvent(new Event('input', { bubbles: true })); }
    const dot = document.querySelector('#sm-dot');
    if (dot) { dot.value = '56'; dot.dispatchEvent(new Event('input', { bubbles: true })); }
    const ring = document.querySelector('#sm-ring');
    if (ring) { ring.value = '140'; ring.dispatchEvent(new Event('input', { bubbles: true })); }
    const ok = document.querySelector('#sm-save');
    if (!ok) return { error: '弹窗里没有保存按钮' };
    ok.click();
    await sleep(500);
    return { ok: true, closed: !document.querySelector('#sm-name') };
  })()`);
  check('设置页点「新建场景」能建成（弹窗保存后关闭）',
    created && created.ok === true, JSON.stringify(created));

  const fresh = cfg.scenes.find((s) => s.name === '自检新场景');
  check('新场景真的写进了配置（不是只改内存页面）',
    !!fresh && saves > 0, JSON.stringify({ scenes: cfg.scenes.map((s) => s.name), saves }));
  check('新场景带着自己的主题色/圆点/环半径（和别的场景不一样）',
    !!fresh && fresh.themeColor === '#22c55e' && Number(fresh.dotSize) === 56 && Number(fresh.ringRadius) === 140,
    fresh ? JSON.stringify({ color: fresh.themeColor, dot: fresh.dotSize, ring: fresh.ringRadius }) : null);

  // 切到新场景 → 药丸必须还是那一套（这才是「新建场景后也是用这种」）
  if (fresh) {
    cfg.currentSceneId = fresh.id;
    floatWin.webContents.send('scene:changed', cfg);
    await sleep(600);
    let q = await floatWin.webContents.executeJavaScript(STYLE);
    if (!q || q.h === 0) { await floatWin.webContents.executeJavaScript(CLICK); await sleep(700); q = await floatWin.webContents.executeJavaScript(STYLE); }
    check('新建的场景里提示条样式和老场景完全一致（浅色磨砂 + 纯白粗体）',
      q.bg === base.bg && q.border === base.border && q.fg === base.fg &&
        q.fs === base.fs && q.fw === base.fw,
      JSON.stringify({ 老: [base.bg, base.fg, base.fs], 新: [q.bg, q.fg, q.fs] }));
    check('新建场景里提示条仍然在圆点上方、没压住菜单项',
      await floatWin.webContents.executeJavaScript(`(() => {
        const p = document.getElementById('linked-app').getBoundingClientRect();
        const d = document.getElementById('dot').getBoundingClientRect();
        const items = [...document.querySelectorAll('#menu .menu-item')].map(n => n.getBoundingClientRect());
        const hit = items.filter(it => !(p.right < it.left || p.left > it.right || p.bottom < it.top || p.top > it.bottom));
        return p.bottom <= d.top + 1 && hit.length === 0;
      })()`), '见截图');
    await sleep(200);
    await floatWin.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'pill-new-scene.png'), img.toPNG()));
  }

  console.log(failed ? '[FAIL] ' + failed + ' 项未通过' : '[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('自检脚本异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
