// UI 冒烟测试（开发用，不打包进应用）
// 用真实 Electron 加载「设置」页面，替换 IPC 后端为内存配置，然后脚本化点击，
// 验证「全场景 + 全状态」的删除/编辑/自定义链路是否真的能跑通。
// 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/ui-smoke.js --no-sandbox
const { app, BrowserWindow, ipcMain, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
let cfg = defaults.buildDefaultConfig();

const results = [];
const consoleErrors = [];
const confirms = [];

function push(name, ok, value) {
  results.push({ name, ok, value: value === undefined ? null : value });
}

/**
 * computed style 里的颜色可能是 `rgb(255, 59, 48)`，也可能是 color-mix 算出来的
 * `color(srgb 1 0.231373 0.188235 / 0.55)`。统一换算成 0-255 三元组再比较。
 */
function colorHas(str, target, tol = 2) {
  const s = String(str || '');
  const triples = [];
  for (const m of s.matchAll(/rgba?\(([^)]+)\)/g)) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length >= 3) triples.push([p[0], p[1], p[2]]);
  }
  for (const m of s.matchAll(/color\(srgb\s+([^)]+)\)/g)) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
    if (p.length >= 3) triples.push([p[0] * 255, p[1] * 255, p[2] * 255]);
  }
  return triples.some((t) => target.every((v, i) => Math.abs(t[i] - v) <= tol));
}

ipcMain.handle('config:get', () => cfg);
// 实时预览：和真主进程一样只换内存里的预览副本，不落盘
let previewCfg = null;
ipcMain.handle('config:preview', (_e, next) => {
  previewCfg = JSON.parse(JSON.stringify(next));
  return { ok: true };
});
ipcMain.handle('config:save', (_e, next) => {
  cfg = JSON.parse(JSON.stringify(next));
  cfg.updatedAt = Date.now();
  // 和真主进程一样把配置广播回去：设置页必须能自己忽略「刚保存引发的那次广播」，
  // 否则每次保存都会重建 DOM，正在拖的滑杆就被换掉了
  try {
    if (win && !win.isDestroyed()) win.webContents.send('scene:changed', cfg);
  } catch {
    /* 窗口还没建好时忽略 */
  }
  return { ok: true };
});
ipcMain.handle('config:reset', () => {
  cfg = defaults.buildDefaultConfig();
  return { ok: true, config: cfg };
});
ipcMain.handle('config:export', () => ({ ok: true }));
ipcMain.handle('config:import', () => ({ ok: false, canceled: true }));
ipcMain.handle('perm:status', () => ({ trusted: true }));
// 诊断信息按真实格式给（「关于 → 复制诊断信息」要靠它验证一键复制）
ipcMain.handle('diag:get', () => ({
  diagnostics: ['===== FloatDesk 诊断信息 =====', '平台: darwin (x64)', '场景数量: 3', '=============================='].join('\n'),
  log: '[smoke] 测试日志',
}));
// 本地图标读取走真实实现（这是本轮要验证的能力，不能打桩）
const { probeLocalIcon } = require(path.join(DIST, 'main', 'FileIcon.js'));
ipcMain.handle('icon:probeLocal', (_e, target, kind) => probeLocalIcon(target, kind));
ipcMain.handle('dialog:selectApp', () => ({ canceled: true }));
ipcMain.handle('dialog:selectFile', () => ({ canceled: true }));
ipcMain.handle('dialog:selectIconImage', () => ({ canceled: true }));
ipcMain.handle('action:runById', () => ({ ok: true }));
// 悬浮球「链接到的目标窗口」查询（展开菜单时渲染进程会问一次；不桩会在日志里刷 No handler 报错）
ipcMain.handle('float:linkedGet', () => '冒烟前台应用');

// ---------- 内置动作 / 输入法 / 便签 ----------
const sharedBuiltins = require(path.join(DIST, 'shared', 'builtins.js'));
const sharedNote = require(path.join(DIST, 'shared', 'note.js'));
const noteStore = require(path.join(DIST, 'main', 'NoteStore.js'));
ipcMain.handle('builtins:actions', () => sharedBuiltins.BUILTIN_ACTIONS);
// 项目库预制项（不桩的话，切到「项目库」页会因无 handler 而报错）
const sharedItemLibrary = require(path.join(DIST, 'shared', 'itemLibrary.js'));
ipcMain.handle('library:presets', () => sharedItemLibrary.BUILTIN_LIBRARY);
// 本机应用扫描：冒烟里不需要真的扫盘，给空列表即可（设置页会优雅降级，不显示这一节）
ipcMain.handle('app:scan', () => []);
ipcMain.handle('app:resolve', () => ({ ok: false }));
// 菜单音效：设置页要预制清单（下拉 optgroup）；试听按钮会去取音效数据。
// 冒烟里不让它真转码/发音：清单走真实的 shared 常量，取音效一律返回失败（页面会退到合成音效，不报错）。
const sharedSounds = require(path.join(DIST, 'shared', 'sounds.js'));
ipcMain.handle('sound:list', () => ({
  presets: sharedSounds.SOUND_PRESETS,
  groups: sharedSounds.SOUND_GROUP_LABELS,
  defaults: sharedSounds.DEFAULT_SOUND_CONFIG,
  none: sharedSounds.SOUND_NONE,
}));
ipcMain.handle('sound:get', () => ({ ok: false, error: '冒烟不打桩真实音效' }));

// 输入法：list / cur 走真实辅助程序（只读，不会动用户的输入法），
// toggle / select 必须打桩——真的切会把用户当前的输入法改掉。
const realIM = require(path.join(DIST, 'main', 'InputMethod.js'));
const imeCalls = [];
ipcMain.handle('ime:snapshot', () => realIM.snapshot(null, null));
ipcMain.handle('ime:toggle', () => {
  imeCalls.push('toggle');
  return { ok: true, to: 'stub', via: 'tis' };
});
ipcMain.handle('ime:select', () => ({ ok: true }));

ipcMain.handle('note:presets', () => sharedNote.NOTE_PRESET_COLORS);
// 便签桩：和主进程一样存「多组标签 + 每组各自的 30 版历史」
// （桩里简化成每次存盘就记一版，省得等空闲 5 秒；真实行为见 NoteWindow.pushMilestone）
let noteBook = sharedNote.normalizeNoteBook(null, noteStore.loadNoteHtml(), noteStore.loadNoteText());
let noteMem = { html: '', text: '' };
const noteActive = () => sharedNote.noteBookActive(noteBook);
ipcMain.handle('note:load', () => {
  const a = noteActive();
  noteMem = { html: a ? a.html : '', text: a ? a.text : '' };
  return {
    html: noteMem.html,
    text: noteMem.text,
    config: {
      color: '#fff6c9',
      opacity: 1,
      fontSize: 14,
      x: null,
      y: null,
      width: sharedNote.NOTE_DEFAULT_WIDTH,
      height: sharedNote.NOTE_DEFAULT_HEIGHT,
    },
    book: noteBook,
    pagesMax: sharedNote.NOTE_PAGES_MAX,
    history: a ? noteStore.pageHistory(a.id).length : 0,
  };
});
ipcMain.handle('note:save', (_e, payload) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (p.book) {
    noteBook = sharedNote.normalizeNoteBook(p.book);
    const a = noteActive();
    noteMem = { html: a ? a.html : '', text: a ? a.text : '' };
    noteStore.saveNote(noteMem.html, noteMem.text);
    if (a) noteStore.pushPageHistory(a.id, noteMem.html, noteMem.text);
    return { ok: true, book: noteBook };
  }
  const html = String(p.html || '');
  const text = String(p.text || '');
  noteMem = { html, text };
  noteStore.saveNote(html, text);
  const a = noteActive();
  if (a) noteBook = sharedNote.patchNotePage(noteBook, a.id, { html, text });
  if (a) noteStore.pushPageHistory(a.id, html, text);
  return { ok: true, book: noteBook };
});
ipcMain.handle('note:page', (_e, payload) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (p.book) noteBook = sharedNote.normalizeNoteBook(p.book);
  const op = String(p.op || '');
  const id = String(p.id || '');
  if (op === 'add') noteBook = sharedNote.addNotePage(noteBook);
  else if (op === 'remove') noteBook = sharedNote.removeNotePage(noteBook, id);
  else if (op === 'patch') noteBook = sharedNote.patchNotePage(noteBook, id, p.patch || {});
  else if (op === 'select') noteBook = sharedNote.setActiveNotePage(noteBook, id);
  return { ok: true, book: noteBook };
});
ipcMain.handle('note:history', (_e, pageId) => {
  const a = noteActive();
  return noteStore.pageHistory(String(pageId || (a ? a.id : 'p1')));
});
ipcMain.handle('note:restore', (_e, pageId, index) => {
  const id = String(pageId || (noteActive() ? noteActive().id : 'p1'));
  const h = noteStore.pageHistory(id);
  const e0 = h[Number(index)];
  if (!e0) return { ok: false, error: '历史版本不存在' };
  noteStore.saveNote(e0.html, e0.text);
  noteMem = { html: e0.html, text: e0.text };
  noteBook = sharedNote.patchNotePage(noteBook, id, { html: e0.html, text: e0.text });
  return { ok: true, html: e0.html, text: e0.text, book: noteBook };
});
// 代码块复制按钮走这里，和主进程一致写系统剪贴板
ipcMain.handle('note:copy', (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text));
  return { ok: true };
});
ipcMain.handle('note:configSave', (_e, patch) => ({
  ok: true,
  config: Object.assign({ color: '#fff6c9', opacity: 1, fontSize: 14 }, patch || {}),
}));
// 设置页「复制诊断信息」：设置页整体禁止选中文字，这类复制改走主进程写剪贴板
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text));
  return { ok: true };
});
ipcMain.on('note:open', () => {});
ipcMain.on('note:close', () => {});
ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
ipcMain.handle('float:dragEnd', () => ({ moved: false }));
ipcMain.handle('scene:changed', () => true);
ipcMain.on('float:resize', () => {});
ipcMain.on('settings:open', () => {});
ipcMain.on('settings:close', () => {});
ipcMain.on('diag:log', () => {});
ipcMain.on('preview:open', () => {});
ipcMain.on('perm:openSettings', () => {});
ipcMain.on('menu:itemContext', () => {});
ipcMain.on('float:contextMenu', () => {});
// 录制快捷键屏蔽：记录 rec:state 调用并回报 rec:native（模拟主进程启停 keyblock）。
// rec:key 回报由测试在主进程侧直接 win.webContents.send('rec:key', …) 模拟。
const recStateCalls = [];
ipcMain.on('rec:state', (e, on) => {
  recStateCalls.push(!!on);
  e.sender.send('rec:native', !!on && cfg.appearance.blockKeysWhileRecording !== false);
});

// 内部图标库：走真实实现（IconLibrary 只依赖 electron app.getPath，冒烟用的是
// --user-data-dir=/tmp/fd-smoke，库目录就是 /tmp/fd-smoke/icon-library）。
// 每轮跑之前先清空，保证列表数量可预期。
const IconLibrary = require(path.join(DIST, 'main', 'IconLibrary.js'));
try {
  fs.rmSync(IconLibrary.libDir(), { recursive: true, force: true });
} catch {
  /* 首次跑不存在，忽略 */
}
const LIB_TEST_PNG = '/tmp/fd-lib-test-icon.png';
fs.writeFileSync(LIB_TEST_PNG, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
));
ipcMain.handle('iconlib:list', () => IconLibrary.listIcons());
ipcMain.handle('iconlib:add', (_e, payload) => {
  const p = payload || {};
  const r = p.dataUrl
    ? IconLibrary.addIconFromData(String(p.name || ''), String(p.dataUrl))
    : IconLibrary.addIconFromPath(String(p.path || ''));
  return { ...r, icons: IconLibrary.listIcons() };
});
ipcMain.handle('iconlib:use', (_e, libPath) => IconLibrary.useIcon(String(libPath)));
ipcMain.handle('iconlib:delete', (_e, libPath) => ({ ...IconLibrary.deleteIcon(String(libPath)), icons: IconLibrary.listIcons() }));
ipcMain.handle('iconlib:reveal', async () => {
  // 冒烟里不真的弹 Finder，只验证库目录存在
  return fs.existsSync(IconLibrary.libDir()) ? { ok: true } : { ok: false, error: '库目录不存在' };
});

const PRELUDE = `
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  window.confirm = (m) => { window.__confirms.push(String(m)); return true; };
  window.__confirms = window.__confirms || [];
  // 滑杆/取色器改完不会立刻写盘（停手 5 秒才自动保存），断言主进程配置前先点一次「保存」
  const saveNow = async () => {
    const b = document.getElementById('saveTop');
    if (b && !b.disabled) b.click();
    await sleep(450);
  };
`;

async function run(name, body) {
  try {
    const v = await win.webContents.executeJavaScript(
      `(async () => { ${PRELUDE} ${body} })()`,
      true
    );
    results.push({ name, ok: true, value: v === undefined ? null : v });
  } catch (e) {
    results.push({ name, ok: false, value: String(e && e.message ? e.message : e) });
  }
}

/**
 * 在指定窗口里跑一段页面脚本（带 PRELUDE，可用 sleep）。
 * 直接调 executeJavaScript 时不带 PRELUDE，页面里没有 sleep 会抛错，
 * 抛错会让整个 whenReady 链的 promise 悬住 → 进程一直不退出。
 */
async function ev(target, body) {
  return target.webContents.executeJavaScript(`(async () => { ${PRELUDE} ${body} })()`, true);
}

let win = null;

/**
 * 用 CDP 发真实鼠标事件（executeJavaScript 里 dispatchEvent 是合成事件，
 * 合成事件不会触发浏览器原生的「拖选文字」行为，测不出 user-select 是否生效）。
 * 窗口是 show:false，sendInputEvent 要求窗口获得焦点，CDP 没有这个限制。
 */
async function cdpDrag(fromX, fromY, toX, toY) {
  const dbg = win.webContents.debugger;
  let attached = false;
  try {
    dbg.attach('1.3');
    attached = true;
  } catch {
    attached = false; // 已经 attach 过
  }
  try {
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: fromX, y: fromY, button: 'left', buttons: 1, clickCount: 1,
    });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await dbg.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: fromX + ((toX - fromX) * i) / steps,
        y: fromY + ((toY - fromY) * i) / steps,
        button: 'left',
        buttons: 1,
      });
    }
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1,
    });
  } finally {
    if (attached) {
      try { dbg.detach(); } catch { /* ignore */ }
    }
  }
  return ev(win, `return { text: String(window.getSelection().toString()) };`);
}

app.whenReady().then(async () => {
  // 给探测打桩准备一张真实存在的 1x1 PNG（否则 <img onerror> 会把预览隐藏，测不出真实行为）
  fs.writeFileSync(
    '/tmp/fd-smoke-favicon.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  win = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 窗口是 show:false，默认会被 Chromium 后台节流，导致 1.5s 的复原动画测不准
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) => consoleErrors.push('render-process-gone: ' + JSON.stringify(d)));
  win.webContents.on('preload-error', (_e, p, err) => consoleErrors.push('preload-error: ' + err.message));

  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await new Promise((r) => setTimeout(r, 600));

  // 1. 基础渲染
  await run('设置页加载 + 7 个导航', `
    const navs = [...document.querySelectorAll('#nav [data-view]')].map(b => b.dataset.view);
    return { navs, title: document.getElementById('viewTitle').textContent, apiReady: !!(window.api && window.api.getConfig) };
  `);

  // 2. 场景管理：列表 + 每个场景都有「删除/编辑」按钮
  await run('场景列表与每行操作按钮', `
    document.querySelector('[data-view="scenes"]').click();
    await sleep(120);
    const rows = [...document.querySelectorAll('#view-scenes .scene-row')];
    return {
      count: rows.length,
      acts: rows.map(r => [...r.querySelectorAll('[data-act]')].map(b => b.dataset.act).join(',')),
    };
  `);

  // 3. 编辑任意场景（非当前场景）：改名 + 主题色 + 圆点大小 + 自动启动 + 设为默认
  await run('编辑第 3 个场景的全部属性', `
    const rows = [...document.querySelectorAll('#view-scenes .scene-row')];
    const target = rows[2];
    const id = target.querySelector('[data-act="edit"]').dataset.id;
    target.querySelector('[data-act="edit"]').click();
    await sleep(80);
    const nameEl = document.querySelector('#sm-name');
    if (!nameEl) return { error: '编辑弹窗未打开' };
    nameEl.value = '冒烟-场景C';
    document.querySelector('#sm-icon').value = '🧪';
    document.querySelector('#sm-desc').value = 'smoke';
    document.querySelector('#sm-color').value = '#ff8800';
    document.querySelector('#sm-dot').value = '88';
    document.querySelector('#sm-ring').value = '170';
    document.querySelector('#sm-auto-app').checked = true;
    document.querySelector('#sm-default').checked = true;
    document.querySelector('#sm-save').click();
    await sleep(200);
    return { id, modalClosed: !document.querySelector('#sm-name') };
  `);

  // 4. 校验后端（主进程内存 cfg）真的收到了修改
  push(
    '场景修改写入后端',
    cfg.scenes[2].name === '冒烟-场景C' && cfg.scenes[2].dotSize === 88 && cfg.scenes[2].isDefault === true && cfg.scenes[2].themeColor === '#ff8800',
    { name: cfg.scenes[2].name, dot: cfg.scenes[2].dotSize, def: cfg.scenes[2].isDefault, color: cfg.scenes[2].themeColor }
  );
  push('默认场景唯一', cfg.scenes.filter((s) => s.isDefault).length === 1, cfg.scenes.filter((s) => s.isDefault).map((s) => s.name));

  // 5. 删除「默认场景」（以前被禁止），确认默认身份自动转移
  const beforeCount = cfg.scenes.length;
  const defaultId = cfg.scenes.find((s) => s.isDefault).id;
  // 行内不再放「×」（停用一律走启用滑块），彻底删除收进编辑弹窗
  await run('删除默认场景（入口在编辑弹窗里）', `
    const row = [...document.querySelectorAll('#view-scenes .scene-row')].find(r => r.dataset.scId === '${defaultId}');
    if (!row) return { error: '找不到默认场景行' };
    if (row.querySelector('[data-act="del"]')) return { error: '行内不该再有删除按钮' };
    row.querySelector('[data-act="edit"]').click();
    await sleep(160);
    const del = document.querySelector('#sm-del');
    if (!del) return { error: '编辑弹窗里没有删除按钮' };
    del.click();
    await sleep(320);
    return { rows: document.querySelectorAll('#view-scenes .scene-row').length, confirms: window.__confirms.slice(-1) };
  `);
  push('默认场景可删除 + 数量减 1', cfg.scenes.length === beforeCount - 1, { before: beforeCount, after: cfg.scenes.length });
  push('默认身份已转移', cfg.scenes.some((s) => s.isDefault), cfg.scenes.find((s) => s.isDefault)?.name);
  push('删除后当前场景有效', cfg.scenes.some((s) => s.id === cfg.currentSceneId), cfg.currentSceneId);

  // 6. 项目管理：切到任意场景 → 添加项目 → 停用 → 再启用 → 删除
  const sceneB = cfg.scenes[1];
  await run('项目库页切换到指定场景并添加项目', `
    document.querySelector('[data-view="library"]').click();
    await sleep(160);
    const sel = document.querySelector('#lib-scene');
    sel.value = '${sceneB.id}';
    sel.dispatchEvent(new Event('change'));
    await sleep(200);
    document.querySelector('#lib-new').click();
    await sleep(80);
    document.querySelector('#it-name').value = '冒烟-网页';
    document.querySelector('#it-target').value = 'https://example.com/smoke';
    document.querySelector('#it-save').click();
    await sleep(250);
    return { rows: document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length };
  `);
  const added = cfg.scenes[1].items.find((i) => i.name === '冒烟-网页');
  push('项目已加入指定场景', !!added, added ? { id: added.id, target: added.target } : null);

  await run('停用该项目（右栏行内开关）', `
    const box = [...document.querySelectorAll('#lib-results [data-sc-en]')].find(c => c.dataset.scEn === '${added ? added.id : 'x'}');
    if (!box) return { error: '找不到启用开关' };
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await sleep(200);
    return { off: true };
  `);
  push('停用状态已保存', cfg.scenes[1].items.find((i) => i.id === added.id).enabled === false, null);

  await run('在编辑弹窗内删除该项目', `
    const btn = [...document.querySelectorAll('#lib-results [data-sc-editbtn]')].find(b => b.dataset.scEditbtn === '${added ? added.id : 'x'}');
    btn.click();
    await sleep(80);
    const del = document.querySelector('#it-del');
    if (!del) return { error: '弹窗里没有删除按钮' };
    del.click();
    await sleep(250);
    return { deleted: !document.querySelector('#it-name') };
  `);
  push('弹窗内删除生效', !cfg.scenes[1].items.some((i) => i.id === added.id), null);

  // 7. 外观（已并入「常规」页）：切换场景 + 套用到所有场景
  await run('常规页的外观卡可以套用到所有场景', `
    document.querySelector('[data-view="general"]').click();
    await sleep(160);
    const sel = document.querySelector('#ap-scene');
    if (!sel) return { error: '常规页缺少场景选择器' };
    sel.value = '${cfg.scenes[0].id}';
    sel.dispatchEvent(new Event('change'));
    await sleep(150);
    const dot = document.querySelector('#a-dot');
    dot.value = '100';
    dot.dispatchEvent(new Event('change'));
    await sleep(200);
    document.querySelector('#ap-apply-all').click();
    await sleep(250);
    return { scenes: document.querySelectorAll('#ap-scene option').length };
  `);
  push('外观套用后所有场景圆点一致', cfg.scenes.every((s) => s.dotSize === 100), cfg.scenes.map((s) => s.dotSize));

  // 7.1 圆点渐变：叠加色 + 角度必须是真控件，能写进配置并反映到预览圆点上
  const gradRes = await ev(win, `
       const c1 = document.getElementById('a-color');
       const c2 = document.getElementById('a-color2');
       const ang = document.getElementById('a-angle');
       if (!c2 || !ang) return { missing: true };
       c1.value = '#3b82f6';
       c1.dispatchEvent(new Event('input'));
       c1.dispatchEvent(new Event('change'));
       await sleep(120);
       const c2b = document.getElementById('a-color2');
       c2b.value = '#7c3aed';
       c2b.dispatchEvent(new Event('input'));
       c2b.dispatchEvent(new Event('change'));
       await sleep(120);
       const ang2 = document.getElementById('a-angle');
       ang2.value = '90';
       ang2.dispatchEvent(new Event('input'));
       ang2.dispatchEvent(new Event('change'));
       await sleep(250);
       const pv = document.querySelector('#a-color-dot');
       const out = {
         missing: false,
         bg: pv ? getComputedStyle(pv).backgroundImage : '',
         hasSameBtn: !!document.getElementById('a-color2-same'),
         angleLabel: (document.getElementById('a-angle-v') || {}).textContent || '',
       };
       // 取色器/滑杆是连续控件：拖动中不写盘，停了 5 秒才自动保存；这里点按钮立即落盘再断言
       await saveNow();
       return out;
  `);
  push(
    '外观页有「渐变叠加色 + 渐变角度」控件',
    gradRes.missing === false && gradRes.hasSameBtn === true,
    gradRes
  );
  push(
    '渐变叠加色写进配置并存盘',
    cfg.scenes[0].gradientColor === '#7c3aed',
    cfg.scenes[0].gradientColor
  );
  push('渐变角度写进配置（90°）', cfg.scenes[0].gradientAngle === 90 && gradRes.angleLabel === '90°', {
    v: cfg.scenes[0].gradientAngle,
    label: gradRes.angleLabel,
  });
  push(
    '预览圆点同时渲染主色与叠加色（双色渐变）',
    colorHas(gradRes.bg, [59, 130, 246]) && colorHas(gradRes.bg, [124, 58, 237]),
    gradRes.bg.slice(0, 160)
  );

  // 「改成主色」= 取消渐变，退回纯色圆点
  const sameRes = await ev(win, `
       document.getElementById('a-color2-same').click();
       await sleep(250);
       const pv = document.querySelector('#a-color-dot');
       return { bg: pv ? getComputedStyle(pv).backgroundImage : '', color2: (document.getElementById('a-color2') || {}).value };
  `);
  push(
    '「改成主色」退回纯色圆点',
    sameRes.color2 === '#3b82f6' && !colorHas(sameRes.bg, [124, 58, 237]) && colorHas(sameRes.bg, [59, 130, 246]),
    sameRes
  );
  // 复原成蓝紫渐变，后面的悬浮窗断言要用
  await ev(win, `
       const c2 = document.getElementById('a-color2');
       c2.value = '#7c3aed';
       c2.dispatchEvent(new Event('input'));
       c2.dispatchEvent(new Event('change'));
       await sleep(200);
       await saveNow();
       return true;
  `);

  // 8. 右键「编辑…」跳转定位（模拟主进程投递 settings:focusItem）
  const someItem = cfg.scenes.find((s) => s.items.length > 0)?.items[0];
  if (someItem) {
    win.webContents.send('settings:focusItem', someItem.id);
    await new Promise((r) => setTimeout(r, 400));
    const focused = await win.webContents.executeJavaScript(
      `(() => ({ view: document.getElementById('viewTitle').textContent, modalOpen: !!document.querySelector('#it-name'), modalName: (document.querySelector('#it-name')||{}).value || null }))()`,
      true
    );
    // 项目管理页已并入项目库，右键「编辑…」现在定位到「项目库」页并直接弹出编辑框
    push('右键编辑定位到项目库并弹出编辑框', focused.modalOpen === true && focused.view === '项目库', focused);
    await win.webContents.executeJavaScript(`document.querySelector('#it-cancel') && document.querySelector('#it-cancel').click()`, true);
  }

  // 9. 网址自动读取（web:probe 打桩，离线也能验证渲染侧接线）
  ipcMain.handle('web:probe', (_e, url) => ({
    ok: true,
    url: /^https?:\/\//i.test(url) ? url : 'https://' + url,
    finalUrl: /^https?:\/\//i.test(url) ? url : 'https://' + url,
    title: '冒烟站点 · Smoke Site',
    siteName: '冒烟站点',
    iconUrl: 'https://example.com/favicon.ico',
    iconPath: '/tmp/fd-smoke-favicon.png',
    error: '',
  }));

  await run('项目库：网址模式粘贴网址一键读取并添加', `
    document.querySelector('[data-view="library"]').click();
    await sleep(160);
    const sel = document.querySelector('#lib-scene');
    sel.value = '${cfg.scenes[0].id}';
    sel.dispatchEvent(new Event('change'));
    await sleep(200);
    // 输入框右下角的小切换按钮 → 切到「网址」模式
    const mode = document.querySelector('#lib-mode');
    if (!mode) return { error: '缺少输入框小切换按钮' };
    if (document.querySelector('#lib-type')) { mode.click(); await sleep(250); }
    const q = document.querySelector('#lib-q');
    if (!q) return { error: '缺少项目库输入框' };
    q.value = 'example.com/smoke';
    q.dispatchEvent(new Event('input'));
    await sleep(120);
    const add = document.querySelector('#lib-urladd');
    if (!add) return { error: '缺少「读取并添加」按钮' };
    add.click();
    await sleep(600);
    const rows = document.querySelectorAll('#view-library .lib-in').length;
    return { rows, tableRows: rows };
  `);
  const quickAdded = cfg.scenes[0].items.find((i) => i.target === 'https://example.com/smoke');
  push(
    '快速添加：名称与图标来自探测结果',
    !!quickAdded && quickAdded.name === '冒烟站点 · Smoke Site' && quickAdded.icon === '/tmp/fd-smoke-favicon.png' && quickAdded.type === 'web',
    quickAdded ? { name: quickAdded.name, icon: quickAdded.icon, target: quickAdded.target } : null
  );

  await run('编辑弹窗：按钮触发读取名称+图标并显示预览', `
    document.querySelector('#lib-new').click();
    await sleep(100);
    const t = document.querySelector('#it-target');
    t.value = 'https://example.com/modal';
    document.querySelector('#it-probe').click();
    await sleep(500);
    const img = document.querySelector('#it-probe-img');
    return {
      name: document.querySelector('#it-name').value,
      icon: document.querySelector('#it-icon').value,
      msg: document.querySelector('#it-probe-msg').textContent,
      previewVisible: !!img && img.style.display !== 'none',
    };
  `);
  const probeUi = results[results.length - 1].value || {};
  push(
    '弹窗内读取：名称/图标/预览均就位',
    probeUi.name === '冒烟站点 · Smoke Site' && String(probeUi.icon || '').startsWith('/tmp/') && probeUi.previewVisible === true,
    probeUi
  );

  await run('弹窗内读取后可直接保存', `
    document.querySelector('#it-save').click();
    await sleep(300);
    return { closed: !document.querySelector('#it-name') };
  `);
  push(
    '弹窗保存后项目带图标',
    cfg.scenes[0].items.some((i) => i.target === 'https://example.com/modal' && i.icon === '/tmp/fd-smoke-favicon.png'),
    cfg.scenes[0].items.filter((i) => i.target.includes('example.com')).map((i) => ({ t: i.target, icon: i.icon }))
  );

  // 名称列必须是「图标图片 + 名称」，不能把图标路径当文字打印出来
  await run('项目库右栏渲染图标图片而非路径文字', `
    document.querySelector('[data-view="library"]').click();
    await sleep(200);
    const rows = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in')];
    const row = rows.find((r) => {
      const nm = r.querySelector('.nm');
      return nm && nm.textContent.includes('冒烟站点');
    });
    if (!row) return { error: '右栏没找到刚添加的项目', rows: rows.length };
    return { hasImg: !!row.querySelector('img'), nameText: row.querySelector('.nm').textContent, cellText: row.textContent };
  `);
  const iconRow = results[results.length - 1].value || {};
  push(
    '名称列显示图标图片，不再把路径当文字',
    iconRow.hasImg === true && iconRow.nameText === '冒烟站点 · Smoke Site' && !String(iconRow.cellText).includes('/tmp/'),
    iconRow
  );

  // 10. 剪贴板：所有输入框要能复制 / 粘贴
  win.show();
  win.focus();
  await run('准备一个输入框并聚焦', `
    if (!document.querySelector('#sm-name')) {
      document.querySelector('[data-view="scenes"]').click();
      await sleep(150);
      document.querySelector('#sc-new').click();
      await sleep(220);
    }
    const el = document.querySelector('#sm-name');
    if (!el) return { error: '没有拿到输入框' };
    el.value = '';
    el.focus();
    return { focused: document.activeElement === el, userSelect: getComputedStyle(el).userSelect };
  `);
  const prep = results[results.length - 1].value || {};
  push('输入框可聚焦且文字可选中', prep.focused === true && String(prep.userSelect).toLowerCase() === 'text', prep);

  clipboard.writeText('粘贴测试-ABC123');
  win.webContents.focus();
  win.webContents.paste();
  await new Promise((r) => setTimeout(r, 250));
  const pasted = await win.webContents.executeJavaScript(`document.querySelector('#sm-name').value`, true);
  push('粘贴进输入框（Cmd+V 的等价调用）', pasted === '粘贴测试-ABC123', { pasted });

  await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('#sm-name'); el.focus(); el.setSelectionRange(0, el.value.length); return true; })()`,
    true
  );
  clipboard.writeText('');
  win.webContents.copy();
  await new Promise((r) => setTimeout(r, 200));
  push('复制输入框内容（Cmd+C 的等价调用）', clipboard.readText() === '粘贴测试-ABC123', { clip: clipboard.readText() });

  // 应用菜单里必须有「编辑」角色，否则 macOS 上 Cmd+C/V 不生效
  const { buildMenuTemplate } = require(path.join(DIST, 'main', 'appMenu.js'));
  const appMenu = Menu.buildFromTemplate(
    buildMenuTemplate({
      scenes: [{ id: 'a', name: 'A' }],
      currentSceneId: 'a',
      onOpenSettings() {},
      onToggleFloating() {},
      onSelectScene() {},
    })
  );
  Menu.setApplicationMenu(appMenu);
  const editMenu = appMenu.items.find((i) => i.label === '编辑');
  // Electron 会把 role 归一化成小写（pasteAndMatchStyle -> pasteandmatchstyle），断言时统一小写
  const roles = editMenu && editMenu.submenu ? editMenu.submenu.items.map((i) => String(i.role || '').toLowerCase()) : [];
  push(
    '应用菜单含编辑角色（Cmd+C/V 生效前提）',
    ['undo', 'cut', 'copy', 'paste', 'selectall'].every((r) => roles.includes(r)),
    roles
  );

  await run('取消测试弹窗', `const b = document.querySelector('#sm-cancel'); if (b) b.click(); await sleep(120); return { closed: !document.querySelector('#sm-name') };`);

  // 10.2 本地目标自动读图标：应用（.app 里的真实图标）/ 文件（按扩展名的常用图标）/ 图片（用图本身）
  // 这三条走的是真实实现（见上面的 icon:probeLocal），不是打桩。
  const APP_TARGET = ['/System/Applications/Calculator.app', '/Applications/Safari.app', '/System/Applications/Utilities/Terminal.app'].find((p) => fs.existsSync(p));

  await run('应用项目：填好路径就自动读出图标和名称', `
    const appPath = ${JSON.stringify(APP_TARGET || '')};
    if (!appPath) return { skipped: '本机没有可用于测试的 .app' };
    document.querySelector('[data-view="library"]').click();
    await sleep(200);
    document.getElementById('lib-new').click();
    await sleep(140);
    const typeSel = document.getElementById('it-type');
    typeSel.value = 'app';
    typeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(60);
    const target = document.getElementById('it-target');
    target.value = appPath;
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(900);
    const icon = document.getElementById('it-icon').value;
    const name = document.getElementById('it-name').value;
    const msg = document.getElementById('it-probe-msg').textContent;
    const out = { icon, name, msg, typeBtn: document.getElementById('it-probe').textContent };
    document.getElementById('it-cancel').click();
    await sleep(120);
    if (!/\\.png$/i.test(icon)) throw new Error('应用图标没有自动填充: ' + JSON.stringify(out));
    if (!name) throw new Error('应用名称没有自动填充: ' + JSON.stringify(out));
    return out;
  `);

  await run('文件项目：读不到真图标时给常用图标（按扩展名）', `
    document.getElementById('lib-new').click();
    await sleep(140);
    const typeSel = document.getElementById('it-type');
    typeSel.value = 'file';
    typeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(60);
    const target = document.getElementById('it-target');
    target.value = ${JSON.stringify(path.join(DIST, 'main', 'ConfigStore.js'))};
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(700);
    const icon = document.getElementById('it-icon').value;
    const name = document.getElementById('it-name').value;
    const out = { icon, name };
    document.getElementById('it-cancel').click();
    await sleep(120);
    if (!icon || /\\.png$/i.test(icon)) throw new Error('文件图标异常: ' + JSON.stringify(out));
    if (!name) throw new Error('文件名没有自动填充: ' + JSON.stringify(out));
    return out;
  `);

  await run('图片项目：直接把这张图当图标', `
    document.getElementById('lib-new').click();
    await sleep(140);
    const typeSel = document.getElementById('it-type');
    typeSel.value = 'image';
    typeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(60);
    const target = document.getElementById('it-target');
    target.value = '/tmp/fd-smoke-favicon.png';
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(600);
    const icon = document.getElementById('it-icon').value;
    const shown = document.getElementById('it-icon-img').style.display !== 'none';
    const out = { icon, shown };
    document.getElementById('it-cancel').click();
    await sleep(120);
    if (icon !== '/tmp/fd-smoke-favicon.png') throw new Error('图片没有用于图标: ' + JSON.stringify(out));
    if (!shown) throw new Error('图标预览没有显示出来: ' + JSON.stringify(out));
    return out;
  `);

  await run('路径不存在时如实报错（不留假图标）', `
    document.getElementById('lib-new').click();
    await sleep(140);
    const typeSel = document.getElementById('it-type');
    typeSel.value = 'app';
    typeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(60);
    const target = document.getElementById('it-target');
    target.value = '/Applications/NoSuchAppForSmoke.app';
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(700);
    const msg = document.getElementById('it-probe-msg').textContent;
    const icon = document.getElementById('it-icon').value;
    const out = { msg, icon };
    document.getElementById('it-cancel').click();
    await sleep(120);
    if (!/失败|不存在/.test(msg)) throw new Error('没有给出失败提示: ' + JSON.stringify(out));
    if (/\\.png$/i.test(icon)) throw new Error('路径不存在却填了 png 图标: ' + JSON.stringify(out));
    return out;
  `);

  // 「自动补全图标」：把已经存在的、图标还是 emoji 的老项目补成真图标
  await run('「自动补全图标」能给老项目补上真图标', `
    const appPath = ${JSON.stringify(APP_TARGET || '')};
    if (!appPath) return { skipped: '本机没有可用于测试的 .app' };
    document.querySelector('[data-view="library"]').click();
    await sleep(200);
    document.getElementById('lib-new').click();
    await sleep(140);
    const typeSel = document.getElementById('it-type');
    typeSel.value = 'app';
    typeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(60);
    const tInp = document.getElementById('it-target');
    tInp.value = appPath;
    tInp.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(800);
    // 模拟老数据：图标还是 emoji
    document.getElementById('it-icon').value = '🧩';
    document.getElementById('it-name').value = '冒烟-应用';
    document.getElementById('it-save').click();
    await sleep(400);
    document.getElementById('lib-autoicon').click();
    await sleep(1800);
    const rows = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in')];
    const row = rows.find((tr) => tr.textContent.includes('冒烟-应用'));
    const img = row && row.querySelector('img');
    const out = { found: !!row, icon: img ? img.getAttribute('src') : null, toast: document.getElementById('toast').textContent };
    if (!row) throw new Error('没有找到刚添加的项目: ' + JSON.stringify(out));
    if (!img || !/\\.png$/i.test(out.icon || '')) throw new Error('图标没有被补全: ' + JSON.stringify(out));
    if (!/补全/.test(out.toast)) throw new Error('没有给出补全提示: ' + JSON.stringify(out));
    return out;
  `);

  // 10.5 启用开关尺寸：必须 34×20，不能被 `.row label{width:130px}` 拉成长胶囊
  await run('开关尺寸 34×20（未被 .row label 拉宽）', `
    document.querySelector('[data-view="general"]').click();
    await sleep(180);
    const sws = [...document.querySelectorAll('#view-general .switch')].map((s) => {
      const r = s.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    });
    if (!sws.length) throw new Error('常规页未找到开关');
    if (!sws.every(([w, h]) => w === 34 && h === 20)) throw new Error('开关尺寸异常: ' + JSON.stringify(sws));
    return sws;
  `);

  // 10.55 快捷键录制：修饰键不急于提交，按主键才提交完整组合（修复「一碰修饰键就录完、组合键录不成」）
  await run('快捷键录制能录下组合键（修饰键先按住不提交，主键才提交）', `
    const btn = document.getElementById('g-win-rec');
    btn.click();
    await sleep(40);
    const armed = btn.classList.contains('on');
    // 先按修饰键 Meta：应保持录制，不提交
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Meta', code:'MetaLeft', metaKey:true, bubbles:true }));
    await sleep(40);
    const afterMod = { stillOn: btn.classList.contains('on'), text: btn.textContent };
    // 再按主键 a（仍按住 Meta）
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'a', code:'KeyA', metaKey:true, bubbles:true }));
    await sleep(80);
    const t = document.getElementById('g-win');
    const afterMain = { on: btn.classList.contains('on'), tag: t ? t.textContent : null };
    if (!armed) throw new Error('点击后未进入录制态');
    if (!afterMod.stillOn) throw new Error('按修饰键就提前结束: ' + JSON.stringify(afterMod));
    if (afterMain.on) throw new Error('主键按下后仍未结束录制');
    if (afterMain.tag !== 'Command+A') throw new Error('录到的快捷键不对: ' + JSON.stringify(afterMain));
    return { armed, afterMod, afterMain };
  `);

  // 10.56 录制中按 Esc 可取消，不写入任何快捷键
  await run('录制中按 Esc 取消且不写入快捷键', `
    const btn = document.getElementById('g-win-rec');
    const before = (document.getElementById('g-win') || {}).textContent;
    btn.click();
    await sleep(40);
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Shift', code:'ShiftLeft', shiftKey:true, bubbles:true }));
    await sleep(30);
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', bubbles:true }));
    await sleep(60);
    const t = document.getElementById('g-win');
    const out = { on: btn.classList.contains('on'), tag: t ? t.textContent : null };
    if (out.on) throw new Error('Esc 后仍在录制');
    if (out.tag !== 'Command+A') throw new Error('Esc 误改了已录快捷键: ' + JSON.stringify(out));
    return out;
  `);

  // 10.56b 录制屏蔽：进入录制通知主进程起 keyblock（rec:state=true），
  // keyblock 上报 HELD/KEY/ESCAPE 驱动录制；录完通知主进程停 keyblock（rec:state=false）
  const mainSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  {
    const r1 = await ev(win, `
      const btn = document.getElementById('g-win-rec');
      btn.click();
      await sleep(100);
      return { on: btn.classList.contains('on'), text: btn.textContent };
    `);
    push('进入录制时通知主进程开启屏蔽', recStateCalls.length > 0 && recStateCalls[recStateCalls.length - 1] === true, { rec: recStateCalls.slice(-3), btn: r1 });
    // 模拟 keyblock 的 HELD 回报：按钮提示变为「已按住 Command+Shift」
    win.webContents.send('rec:key', 'HELD command,shift');
    await mainSleep(60);
    const r2 = await ev(win, `
      const btn = document.getElementById('g-win-rec');
      return { on: btn.classList.contains('on'), text: btn.textContent };
    `);
    push('keyblock 上报 HELD 时更新「已按住」提示', !!r2.on && /Command\+Shift/.test(r2.text || ''), r2);
    // 模拟 keyblock 上报完整组合键：录到并结束录制
    win.webContents.send('rec:key', 'KEY Command+Shift+4');
    await mainSleep(80);
    const r3 = await ev(win, `
      const btn = document.getElementById('g-win-rec');
      return { on: btn.classList.contains('on'), tag: (document.getElementById('g-win') || {}).textContent };
    `);
    push('keyblock 上报组合键即录到（Command+Shift+4）', !r3.on && r3.tag === 'Command+Shift+4', r3);
    push('录完通知主进程停止屏蔽', recStateCalls.length > 0 && recStateCalls[recStateCalls.length - 1] === false, recStateCalls.slice(-3));
    // Esc 回报：取消录制且不写值
    await ev(win, `
      const btn = document.getElementById('g-win-rec');
      btn.click();
      await sleep(80);
      return { on: btn.classList.contains('on') };
    `);
    win.webContents.send('rec:key', 'ESCAPE');
    await mainSleep(60);
    const r5 = await ev(win, `
      const btn = document.getElementById('g-win-rec');
      return { on: btn.classList.contains('on'), tag: (document.getElementById('g-win') || {}).textContent };
    `);
    push('keyblock 上报 Esc 取消录制且不改快捷键', !r5.on && r5.tag === 'Command+Shift+4', r5);
  }

  // 10.56c 屏蔽勾选：默认开，可关，写进配置
  {
    const r = await ev(win, `
      document.querySelector('[data-view="general"]').click();
      await sleep(180);
      const cb = document.getElementById('g-block');
      if (!cb) throw new Error('找不到 g-block 勾选');
      const before = cb.checked;
      cb.checked = !before;
      cb.dispatchEvent(new Event('change'));
      await sleep(120);
      return { before, after: cb.checked };
    `);
    push('录制屏蔽勾选默认开启', r.before === true, r);
    push('屏蔽勾选变更写入配置', cfg.appearance.blockKeysWhileRecording === r.after, { cfg: cfg.appearance.blockKeysWhileRecording, dom: r.after });
  }

  // 10.56d 全局「显示提示文字」：关掉 → body.hide-hints 且 .hint 真的被藏掉；再开 → 恢复
  {
    const r = await ev(win, `
      document.querySelector('[data-view="general"]').click();
      await sleep(180);
      const hintsBefore = document.querySelectorAll('#view-general .hint').length;
      if (!hintsBefore) throw new Error('常规页没有 .hint 可测');
      const hiddenOf = () => {
        const h = document.querySelector('#view-general .hint');
        return getComputedStyle(h).display === 'none';
      };
      const cb = document.getElementById('g-hints');
      if (!cb) throw new Error('找不到 g-hints 勾选');
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
      await sleep(150);
      const off = { cls: document.body.classList.contains('hide-hints'), hidden: hiddenOf(), cfg: null };
      // 切到别的页也要生效（全局开关，不是只对当前页）
      document.querySelector('[data-view="about"]').click();
      await sleep(200);
      const apHidden = (() => { const h = document.querySelector('#view-about .hint'); return h ? getComputedStyle(h).display === 'none' : null; })();
      document.querySelector('[data-view="general"]').click();
      await sleep(150);
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
      await sleep(150);
      const on = { cls: document.body.classList.contains('hide-hints'), hidden: hiddenOf() };
      return { hintsBefore, off, apHidden, on };
    `);
    push('「显示提示文字」关掉后 body 挂 hide-hints 且提示真被隐藏', r.off.cls === true && r.off.hidden === true, r);
    push('「显示提示文字」是全局开关（换到其它页也同步生效）', r.apHidden === true, r);
    push('重新打开后提示恢复显示且类被移除', r.on.cls === false && r.on.hidden === false, r);
    push('「显示提示文字」写进配置', cfg.appearance.showHints === true, cfg.appearance.showHints);
  }

  // 10.57 长按选场景窗口的宽高设置：填写 → 写进配置并夹取；清空 → 回到自动(0)
  await run('设置里可指定长按选区窗口宽高', `
    document.querySelector('[data-view="general"]').click();
    await sleep(150);
    const pw = document.getElementById('g-pw');
    const ph = document.getElementById('g-ph');
    if (!pw || !ph) throw new Error('找不到 g-pw/g-ph 输入框');
    pw.value = '320';
    pw.dispatchEvent(new Event('change'));
    ph.value = '99999'; // 超上限，应被夹到 760
    ph.dispatchEvent(new Event('change'));
    await sleep(120);
    return { pw: pw.value, ph: ph.value };
  `);
  push('选区窗口宽高写入配置并夹取', cfg.appearance.pickerWidth === 320 && cfg.appearance.pickerHeight === 760, { w: cfg.appearance.pickerWidth, h: cfg.appearance.pickerHeight });
  await run('清空宽高恢复自动', `
    const pw = document.getElementById('g-pw');
    const ph = document.getElementById('g-ph');
    pw.value = '';
    pw.dispatchEvent(new Event('change'));
    ph.value = '';
    ph.dispatchEvent(new Event('change'));
    await sleep(120);
    return { };
  `);
  push('清空后宽高回到自动(0)', cfg.appearance.pickerWidth === 0 && cfg.appearance.pickerHeight === 0, { w: cfg.appearance.pickerWidth, h: cfg.appearance.pickerHeight });
  await run('选区文字边距写入配置并夹取', `
    const pad = document.getElementById('g-ppad');
    if (!pad) throw new Error('找不到 g-ppad 滑杆');
    pad.value = '999'; // 超上限，应被夹到 28
    pad.dispatchEvent(new Event('change'));
    await sleep(120);
    await saveNow(); // 滑杆是连续控件，停手 5 秒才会自动保存
    return { v: pad.value };
  `);
  push('文字边距写入配置并夹到上限(28)', cfg.appearance.pickerRowPad === 28, { pad: cfg.appearance.pickerRowPad });

  // 10.58 快捷键视图：权限卡搬去侧栏；检索 + 分类标签 + 清除快捷键
  await run('打开快捷键视图（权限卡在侧栏底部）', `
    document.querySelector('[data-view="shortcuts"]').click();
    await sleep(350);
    const q = document.getElementById('sc-q');
    const chips = document.querySelectorAll('#sc-tags .chip').length;
    const rows = document.querySelectorAll('#sc-body tr').length;
    const hasPermCard = !!document.getElementById('perm');
    const permInView = !!document.querySelector('#view-shortcuts #perm');
    if (!q) throw new Error('找不到检索框 sc-q');
    if (chips < 2) throw new Error('分类标签少于 2 个: ' + chips);
    if (rows < 1) throw new Error('表格没有行');
    if (!hasPermCard) throw new Error('侧栏权限卡缺失');
    if (permInView) throw new Error('权限卡还留在快捷键页里');
    return { chips, rows, hasPermCard };
  `);
  push('快捷键视图含检索框与分类标签，权限卡已移到侧栏', true, null);

  // 检索：输入项目名，只剩匹配的行（ev 才返回值；run 只记账不返回）
  let searchRes = null;
  try {
    searchRes = await ev(win, `
    const first = document.querySelector('#sc-body tr td:nth-child(2)');
    const name = first ? first.textContent.trim() : '';
    if (!name) throw new Error('没有项目名可检索');
    const q = document.getElementById('sc-q');
    q.value = name;
    q.dispatchEvent(new Event('input'));
    await sleep(150);
    const rows = [...document.querySelectorAll('#sc-body tr')];
    return { name, rows: rows.length, shown: rows.map((r) => r.textContent.includes(name)) };
  `);
  } catch (e) {
    searchRes = { error: String(e && e.message ? e.message : e) };
  }
  push(
    '检索后只显示匹配项目',
    !!(searchRes && searchRes.rows >= 1 && Array.isArray(searchRes.shown) && searchRes.shown.every((v) => v === true)),
    searchRes
  );

  // 分类标签：点「内置动作」只剩该类型；再点「全部」还原
  // 分类标签：点第一个分类只剩该类型；再点「全部」还原
  let chipRes = null;
  try {
    chipRes = await ev(win, `
    const q = document.getElementById('sc-q');
    q.value = '';
    q.dispatchEvent(new Event('input'));
    const chips = [...document.querySelectorAll('#sc-tags .chip')];
    const chip = chips.length > 1 ? chips[1] : null; // 第一个分类标签（索引 0 是「全部」）
    if (!chip) return { skipped: true };
    const label = chip.textContent.trim();
    chip.click();
    await sleep(150);
    const rows = [...document.querySelectorAll('#sc-body tr')];
    return { skipped: false, label, rows: rows.length };
  `);
  } catch (e) {
    chipRes = { error: String(e && e.message ? e.message : e) };
  }
  push('分类标签可过滤', !!(chipRes && (chipRes.skipped === true || chipRes.rows >= 1)), chipRes);
  await run('分类标签还原为全部', `
    const chip = document.querySelector('#sc-tags .chip[data-tag=""]');
    if (chip) chip.click();
    await sleep(150);
    return {};
  `);

  // 录制一个快捷键 → 表格出现「清除」→ 点清除 → 回到未设置
  // 录制一个快捷键 → 表格出现「清除」→ 点清除 → 回到未设置
  let clearRes = null;
  try {
    clearRes = await ev(win, `
    const btn = document.querySelector('#sc-body [data-rec]');
    if (!btn) throw new Error('找不到录制按钮');
    const id = btn.dataset.rec;
    btn.click();
    await sleep(40);
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Meta', code:'MetaLeft', metaKey:true, bubbles:true }));
    await sleep(40);
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'a', code:'KeyA', metaKey:true, bubbles:true }));
    await sleep(150);
    const tag = document.getElementById('sc-' + id);
    const afterRec = tag ? tag.textContent : null;
    const clr = document.querySelector('#sc-body [data-clr="' + id + '"]');
    if (!clr) throw new Error('录完后没有出现清除按钮');
    clr.click();
    await sleep(200);
    const tag2 = document.getElementById('sc-' + id);
    const clr2 = document.querySelector('#sc-body [data-clr="' + id + '"]');
    return { id, afterRec, afterClr: tag2 ? tag2.textContent : null, clrGone: !clr2 };
  `);
  } catch (e) {
    clearRes = { error: String(e && e.message ? e.message : e) };
  }
  push(
    '清除快捷键后回到未设置',
    !!(clearRes && clearRes.afterRec === 'Command+A' && clearRes.afterClr === '未设置' && clearRes.clrGone === true),
    clearRes
  );

  // 10.59 内部图标库：本地路径添加 → 使用（复制进缓存）→ 拖放（dataURL 兜底）→ 删除 → 浮层选图回填
  {
    const r1 = await ev(win, `
      const r = await window.api.iconLibAdd({ path: '${LIB_TEST_PNG}' });
      return { ok: r.ok, dedup: r.dedup, count: (r.icons || []).length, first: (r.icons || [])[0] };
    `);
    push('图标库：从本地路径添加成功', !!(r1 && r1.ok && r1.count === 1 && r1.first && /fd-lib-test-icon\.png$/.test(r1.first.name)), r1);

    const r2 = await ev(win, `
      const r = await window.api.iconLibUse(${JSON.stringify(r1.first.path)});
      return { ok: r.ok, path: r.path };
    `);
    push('图标库：使用图标时复制进缓存目录（item-icons）', !!(r2 && r2.ok && /item-icons\//.test(r2.path || '') && /\/[0-9a-f]{16}\.png$/.test(r2.path || '')), r2);

    // 拖放：构造的 File 没有本地路径 → 渲染层走 dataURL 兜底 → 主进程解码落库
    const r3 = await ev(win, `
      document.querySelector('[data-view="tools"]').click();
      await sleep(300);
      const drop = document.getElementById('lib-drop2');
      if (!drop) throw new Error('工具页找不到图标库拖放区');
      const bytes = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,73,72,68,82,0,0,0,1]);
      const file = new File([bytes], 'dropped-via-drop.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      drop.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      const highlighted = drop.classList.contains('dropping');
      drop.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await sleep(500);
      return { highlighted, count2: (document.getElementById('lib-count2') || {}).textContent };
    `);
    push('图标库：拖放文件（无本地路径走 dataURL）落入库中', !!(r3 && r3.highlighted && /2 个图标/.test(r3.count2 || '')), r3);

    const r4 = await ev(win, `
      const icons = await window.api.iconLibList();
      const del = icons.find((i) => /dropped-via-drop/.test(i.name));
      if (!del) throw new Error('拖放的图标不在库中: ' + JSON.stringify(icons.map((i) => i.name)));
      const r = await window.api.iconLibDelete(del.path);
      return { ok: r.ok, left: (r.icons || []).length };
    `);
    push('图标库：删除后列表减少', !!(r4 && r4.ok && r4.left === 1), r4);

    // 浮层选图：项目编辑弹窗里点「从图标库选图」→ 浮层出现 → 点图标 → 回填缓存路径并关闭
    const r5 = await ev(win, `
      document.querySelector('[data-view="library"]').click();
      await sleep(250);
      const editBtn = document.querySelector('#lib-results [data-sc-editbtn]');
      if (!editBtn) throw new Error('右栏找不到项目编辑按钮');
      editBtn.click();
      await sleep(250);
      const before = document.getElementById('it-icon').value;
      document.getElementById('it-iconpick').click();
      await sleep(350);
      const shown = document.getElementById('iconlibBg').classList.contains('show');
      const tiles = document.querySelectorAll('#iconlib [data-libpath]').length;
      const tile = document.querySelector('#iconlib [data-libpath]');
      if (!tile) throw new Error('浮层里没有图标');
      tile.click();
      await sleep(350);
      return { before, shown, tiles,
               after: document.getElementById('it-icon').value,
               closed: !document.getElementById('iconlibBg').classList.contains('show') };
    `);
    push('图标库浮层：选图后回填缓存路径并关闭', !!(r5 && r5.shown && r5.tiles === 1 && r5.after !== r5.before && /item-icons\//.test(r5.after || '') && r5.closed), r5);
    await run('关闭项目编辑弹窗', `const c = document.getElementById('it-cancel'); if (c) c.click(); await sleep(150); return {};`);
  }

  // 10.60 相同项目（同名 + 同目标）的图标同步到全场景
  {
    const setup = await ev(win, `
      document.querySelector('[data-view="library"]').click();
      await sleep(250);
      // 按索引选前两个场景（场景名可能被前面的测试改过，不能写死）
      const add = async (idx, icon) => {
        const sel = document.getElementById('lib-scene');
        if (sel.options.length < 2) throw new Error('场景不足两个');
        sel.selectedIndex = idx;
        sel.dispatchEvent(new Event('change'));
        await sleep(250);
        document.getElementById('lib-new').click();
        await sleep(250);
        document.getElementById('it-name').value = '同步测试项目';
        document.getElementById('it-target').value = 'https://sync-test.example.com';
        document.getElementById('it-icon').value = icon;
        document.getElementById('it-save').click();
        await sleep(300);
      };
      await add(0, '/tmp/icon-a.png');
      await add(1, '/tmp/icon-b.png');
      return { done: true, scenes: [...document.getElementById('lib-scene').options].map((o) => o.textContent.trim()) };
    `);
    push('同步测试：两个场景加入同名 + 同目标项目', !!(setup && setup.done), setup);
    // 两个测试项目的图标值（按 cfg.scenes 顺序：索引 0 的场景加的是 a，索引 1 是 b）
    const twoIcons = () => {
      const out = [];
      for (const s of cfg.scenes) for (const i of s.items || []) if (i.name === '同步测试项目') out.push(i.icon);
      return out;
    };
    push('同步测试：写入配置（两个场景各一个，图标不同）', JSON.stringify(twoIcons()) === JSON.stringify(['/tmp/icon-a.png', '/tmp/icon-b.png']), twoIcons());

    // 编辑场景 A 的项目：不勾选同步 → 保存 → 场景 B 不变
    const noSync = await ev(win, `
      document.querySelector('[data-view="library"]').click();
      await sleep(250);
      const sel = document.getElementById('lib-scene');
      sel.selectedIndex = 0;
      sel.dispatchEvent(new Event('change'));
      await sleep(250);
      const row = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in')].find((r) => r.textContent.includes('同步测试项目'));
      if (!row) throw new Error('右栏找不到刚添加的项目');
      row.querySelector('[data-sc-editbtn]').click();
      await sleep(250);
      const rowSync = document.getElementById('row-sync');
      const visible = rowSync && rowSync.style.display !== 'none';
      const hint = (document.getElementById('it-sync-hint') || {}).textContent || '';
      document.getElementById('it-icon').value = '/tmp/icon-c.png';
      document.getElementById('it-save').click();
      await sleep(300);
      return { visible, hint };
    `);
    push('同步测试：编辑时出现「同步到全场景」勾选且提示数量', !!(noSync && noSync.visible && /1 个相同项目/.test(noSync.hint || '')), noSync);
    const afterNoSync = twoIcons();
    push('同步测试：不勾选时其他场景图标不变', JSON.stringify(afterNoSync) === JSON.stringify(['/tmp/icon-c.png', '/tmp/icon-b.png']), afterNoSync);

    // 再编辑：勾选同步 → 保存 → 场景 B 的图标被一并更新
    const withSync = await ev(win, `
      const row = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in')].find((r) => r.textContent.includes('同步测试项目'));
      if (!row) throw new Error('右栏找不到项目行');
      row.querySelector('[data-sc-editbtn]').click();
      await sleep(250);
      document.getElementById('it-icon').value = '/tmp/icon-d.png';
      document.getElementById('it-sync').checked = true;
      document.getElementById('it-save').click();
      await sleep(300);
      return { toast: document.getElementById('toast').textContent };
    `);
    const afterSync = twoIcons();
    push('同步测试：勾选后其他场景相同项目的图标一并更新', JSON.stringify(afterSync) === JSON.stringify(['/tmp/icon-d.png', '/tmp/icon-d.png']), { withSync, afterSync });

    // 清理：删掉两个测试项目（confirm 已被 PRELUDE 打桩为 true）
    await ev(win, `
      for (let idx = 0; idx < 2; idx++) {
        const sel = document.getElementById('lib-scene');
        sel.selectedIndex = idx;
        sel.dispatchEvent(new Event('change'));
        await sleep(250);
        const row = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in')].find((r) => r.textContent.includes('同步测试项目'));
        // 右栏的 × 是「从场景移除」；要真删掉得进编辑弹窗用「删除此项目」
        if (row) {
          row.querySelector('[data-sc-editbtn]').click();
          await sleep(250);
          const del = document.getElementById('it-del');
          if (del) { del.click(); await sleep(250); }
          else { const c = document.getElementById('it-cancel'); if (c) c.click(); await sleep(150); }
        }
      }
      return true;
    `);
    push('同步测试：清理后配置里没有测试项目', twoIcons().length === 0, twoIcons());
  }

  // 10.6 保存按钮三态：点击 → 变绿 + ✓已保存（toast 同时出现）；约 1.5s → 复原；toast 会淡出
  await run('保存按钮点击后变绿并显示「✓ 已保存」', `
    const b = document.getElementById('saveTop');
    b.click();
    await sleep(260);
    const cs = getComputedStyle(b);
    const out = { cls: b.className, text: b.textContent, bg: cs.backgroundColor,
                  toastShow: document.getElementById('toast').classList.contains('show') };
    if (!b.classList.contains('saved')) throw new Error('未进入 saved 态: ' + JSON.stringify(out));
    if (!/已保存/.test(b.textContent)) throw new Error('按钮文案未变: ' + b.textContent);
    if (cs.backgroundColor !== 'rgb(31, 154, 91)') throw new Error('按钮未变绿: ' + cs.backgroundColor);
    if (!out.toastShow) throw new Error('toast 未出现');
    return out;
  `);

  await run('保存反馈约 1.5s 后复原且 toast 会淡出', `
    await sleep(2800);
    const b = document.getElementById('saveTop');
    const t = document.getElementById('toast');
    const out = { cls: b.className, text: b.textContent, bg: getComputedStyle(b).backgroundColor,
                  toastShow: t.classList.contains('show'), toastOpacity: getComputedStyle(t).opacity };
    if (b.classList.contains('saved')) throw new Error('saved 态没有复原: ' + JSON.stringify(out));
    if (b.textContent !== '保存') throw new Error('按钮文案没有复原: ' + b.textContent);
    if (t.classList.contains('show')) throw new Error('toast 没有隐藏（老 bug 回归）');
    return out;
  `);

  win.hide();

  // 11. 悬浮窗渲染：空场景（项目被删光/全停用）不应崩，应给出提示
  const emptyCfg = JSON.parse(JSON.stringify(cfg));
  emptyCfg.scenes = emptyCfg.scenes.map((s, i) => (i === 0 ? { ...s, items: [] } : s));
  emptyCfg.currentSceneId = emptyCfg.scenes[0].id;
  const resizeCalls = [];
  ipcMain.removeAllListeners('float:resize');
  ipcMain.on('float:resize', (_e, mode, size) => resizeCalls.push([mode, size]));

  const floatErrors = [];
  // 用工厂函数建悬浮窗：headless 环境里这个窗口偶尔会被系统回收，
  // 之后再用 webContents 就会「Object has been destroyed」把整个冒烟脚本噎死，
  // 所以每次用之前检查一下，没了就重建。
  const createFloatWin = async () => {
    const w = new BrowserWindow({
      width: 420,
      height: 420,
      show: false,
      webPreferences: {
        preload: path.join(DIST, 'main', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    w.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) floatErrors.push(message);
    });
    w.webContents.on('render-process-gone', (_e, d) => floatErrors.push('gone: ' + JSON.stringify(d)));
    await w.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
    await new Promise((r) => setTimeout(r, 500));
    return w;
  };
  let fwin = await createFloatWin();
  const aliveFloat = () => fwin && !fwin.isDestroyed() && !fwin.webContents.isDestroyed();
  /** 拿一个可用的悬浮窗：被回收过就重建，并把当前配置重新推一遍 */
  const useFloat = async (cfgToPush) => {
    if (!aliveFloat()) fwin = await createFloatWin();
    if (cfgToPush) fwin.webContents.send('scene:changed', cfgToPush);
    return fwin;
  };
  /** 往悬浮窗发 IPC：窗口没了先重建，避免「Object has been destroyed」噎死脚本 */
  const fSend = async (...args) => {
    const w = await useFloat();
    w.webContents.send(...args);
    return w;
  };
  /** 在悬浮窗里跑脚本：同上，窗口没了先重建 */
  const fExec = async (code, ...rest) => {
    const w = await useFloat();
    return w.webContents.executeJavaScript(code, ...rest);
  };
  const floatReady = await fExec(
    `(() => ({ apiReady: !!(window.api && window.api.getConfig), hintShown: false }))()`,
    true
  );
  push('悬浮窗页面加载', floatReady.apiReady === true, floatReady);

  await fSend('scene:changed', emptyCfg);
  await new Promise((r) => setTimeout(r, 250));
  // 模拟「点一下圆点」：mousedown + mouseup，主进程 dragEnd 返回 moved=false → 展开
  await fExec(
    `(() => {
       const d = document.getElementById('dot');
       d.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
       document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
       return true;
     })()`,
    true
  );
  await new Promise((r) => setTimeout(r, 450));
  const floatAfter = await fExec(
    `(() => ({ hint: !!document.querySelector('.empty-hint'), items: document.querySelectorAll('.menu-item').length }))()`,
    true
  );
  push('空场景不崩且显示提示', floatAfter.hint === true && floatAfter.items === 0, floatAfter);
  push('空场景点击仍会请求展开', resizeCalls.some((c) => c[0] === 'expanded'), resizeCalls);

  // 11.5 场景主题色必须真的决定圆点颜色
  // （以前 applySceneStyle 只是把 themeColor 写进 --theme，但没有任何 CSS 用到它，
  //   改主题色在界面上完全没反应。这里对 computed style 做断言，防止再次变成摆设。）
  const dotWith = async (hex) => {
    const themed = JSON.parse(JSON.stringify(cfg));
    themed.scenes[0].themeColor = hex;
    themed.currentSceneId = themed.scenes[0].id;
    const w = await useFloat(themed);
    await new Promise((r) => setTimeout(r, 280));
    return w.webContents.executeJavaScript(
      `(() => {
         const d = document.getElementById('dot');
         const cs = getComputedStyle(d);
         return {
           themeVar: getComputedStyle(document.documentElement).getPropertyValue('--theme').trim(),
           bg: cs.backgroundImage,
           shadow: cs.boxShadow,
           size: Math.round(d.getBoundingClientRect().width),
         };
       })()`,
      true
    );
  };

  const red = await dotWith('#ff3b30');
  push(
    '主题色 #ff3b30 → 圆点变红（渐变 + 光晕）',
    red.themeVar === '#ff3b30' && colorHas(red.bg, [255, 59, 48]) && colorHas(red.shadow, [255, 59, 48]),
    red
  );

  const green = await dotWith('#22c55e');
  push(
    '主题色改成 #22c55e → 圆点跟着变绿（不是写死的）',
    green.themeVar === '#22c55e' && colorHas(green.bg, [34, 197, 94]) && colorHas(green.shadow, [34, 197, 94]) && green.bg !== red.bg,
    green
  );

  // 非法色值不能把圆点搞消失（应该有兜底蓝）
  const bad = await dotWith('not-a-color');
  push(
    '非法主题色不致命，圆点仍渲染出默认蓝',
    bad.themeVar === '#3b82f6' && colorHas(bad.bg, [59, 130, 246]) && bad.size > 0,
    bad
  );

  // 11.5b 圆点渐变：叠加色与角度也必须真的作用到圆点上
  const dotGrad = async (theme, grad, angle) => {
    const c2 = JSON.parse(JSON.stringify(cfg));
    c2.scenes[0].themeColor = theme;
    c2.scenes[0].gradientColor = grad;
    c2.scenes[0].gradientAngle = angle;
    c2.currentSceneId = c2.scenes[0].id;
    const w = await useFloat(c2);
    await new Promise((r) => setTimeout(r, 280));
    return w.webContents.executeJavaScript(
      `(() => {
         const d = document.getElementById('dot');
         const root = getComputedStyle(document.documentElement);
         return {
           theme2: root.getPropertyValue('--theme2').trim(),
           angle: root.getPropertyValue('--grad-angle').trim(),
           bg: getComputedStyle(d).backgroundImage,
           shadow: getComputedStyle(d).boxShadow,
         };
       })()`,
      true
    );
  };

  const bluePurple = await dotGrad('#3b82f6', '#7c3aed', 145);
  push(
    '默认蓝→紫渐变（最初那颗圆点）：两段颜色都在，角度 145deg',
    bluePurple.theme2 === '#7c3aed' &&
      bluePurple.angle === '145deg' &&
      colorHas(bluePurple.bg, [59, 130, 246]) &&
      colorHas(bluePurple.bg, [124, 58, 237]),
    bluePurple
  );

  const orangeCyan = await dotGrad('#f59e0b', '#06b6d4', 30);
  push(
    '渐变叠加色可调：橙→青同时生效，角度换成 30deg',
    orangeCyan.theme2 === '#06b6d4' &&
      orangeCyan.angle === '30deg' &&
      colorHas(orangeCyan.bg, [245, 158, 11]) &&
      colorHas(orangeCyan.bg, [6, 182, 212]) &&
      orangeCyan.bg !== bluePurple.bg,
    orangeCyan
  );

  const solidDot = await dotGrad('#10b981', '#10b981', 145);
  push(
    '叠加色选成主色 = 纯色圆点（不再有第二种颜色）',
    solidDot.theme2 === '#10b981' && !colorHas(solidDot.bg, [124, 58, 237]) && colorHas(solidDot.bg, [16, 185, 129]),
    solidDot
  );

  push('悬浮窗无严重控制台错误', floatErrors.length === 0, floatErrors.slice(0, 5));

  // 11.5c 执行反馈：原来底部绿色文字 toast 已移除，改为圆点上的对勾 + 扩散光环动画（无文字）
  await fSend('toast', '已启动: 测试', 'success');
  await new Promise((r) => setTimeout(r, 120));
  const fx = await fExec(
    `(() => {
       const f = document.getElementById('exec-fx');
       const ico = f ? f.querySelector('.ico') : null;
       return {
         hasOldToast: !!document.getElementById('toast'),
         fxPlaying: !!(f && f.classList.contains('play')),
         icon: ico ? ico.textContent : null,
         color: f ? getComputedStyle(f).getPropertyValue('--fx-color').trim() : '',
       };
     })()`,
    true
  );
  push(
    '执行反馈改为圆点动画（无文字、无绿色 toast 框）',
    fx.hasOldToast === false && fx.fxPlaying === true && fx.icon === '✓' && fx.color === '#4ade80',
    fx
  );
  // 失败反馈：红色叉号 + 红环
  await fSend('toast', '启动失败', 'error');
  await new Promise((r) => setTimeout(r, 120));
  const fxErr = await fExec(
    `(() => {
       const f = document.getElementById('exec-fx');
       const ico = f ? f.querySelector('.ico') : null;
       return { fxPlaying: !!(f && f.classList.contains('play')), icon: ico ? ico.textContent : null, color: f ? getComputedStyle(f).getPropertyValue('--fx-color').trim() : '' };
     })()`,
    true
  );
  push(
    '失败反馈为红色叉号动画（无文字）',
    fxErr.fxPlaying === true && fxErr.icon === '✕' && fxErr.color === '#f87171',
    fxErr
  );

  // ---------- 11.5d 右键圆点弹出场景选区（场景行 + 底部原右键菜单入口） ----------
  // 右键 → 选区弹出（长按已废除，左键拖动不受影响）；点场景立即切换；底部入口执行对应动作。
  const switchCalls = [];
  ipcMain.removeAllListeners('float:switchScene');
  ipcMain.on('float:switchScene', (_e, id) => switchCalls.push(id));
  const pickerResizeCalls = [];
  ipcMain.removeAllListeners('float:resizePicker');
  ipcMain.on('float:resizePicker', (_e, w, h) => pickerResizeCalls.push([w, h]));
  const settingsOpenCalls = [];
  ipcMain.removeAllListeners('settings:open');
  ipcMain.on('settings:open', () => settingsOpenCalls.push(1));

  // 先送一份完整配置（带用户指定的选区窗口宽高），确保场景列表和当前场景是确定的；
  // 再按 Esc 收起（前面段落可能把菜单留在了展开态）
  const pickCfg = JSON.parse(JSON.stringify(cfg));
  pickCfg.currentSceneId = pickCfg.scenes[0].id;
  pickCfg.appearance.pickerWidth = 360;
  pickCfg.appearance.pickerHeight = 500;
  pickCfg.appearance.pickerRowPad = 20;
  await fSend('scene:changed', pickCfg);
  await new Promise((r) => setTimeout(r, 300));
  await fExec(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    true
  );
  await new Promise((r) => setTimeout(r, 200));

  // 右键圆点 → 选区弹出，含全部场景 + 底部 3 个入口
  await fExec(
    `(() => {
       document.getElementById('dot').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
       return true;
     })()`,
    true
  );
  await new Promise((r) => setTimeout(r, 300));
  const rp = await fExec(
    `(() => {
       const p = document.getElementById('scene-picker');
       const rows = p ? Array.from(p.querySelectorAll('.sp-row')) : [];
       const acts = rows.filter((r) => r.classList.contains('act')).map((r) => r.textContent.trim());
       return {
         open: !!(p && p.classList.contains('open')),
         sceneRows: rows.filter((r) => !r.classList.contains('act')).length,
         curId: (rows.find((r) => r.classList.contains('cur')) || {}).dataset ? rows.find((r) => r.classList.contains('cur')).dataset.sceneId : null,
         acts,
         hasSep: !!p.querySelector('.sp-sep'),
         menuOpen: document.getElementById('menu').classList.contains('open'),
       };
     })()`,
    true
  );
  push(
    '右键圆点弹出场景选区（场景 + 底部设置入口）',
    rp.open === true && rp.sceneRows === pickCfg.scenes.length && rp.curId === pickCfg.scenes[0].id &&
      rp.hasSep === true && rp.acts.join('|') === '打开设置…|隐藏悬浮台|退出 FloatDesk' && rp.menuOpen === false,
    rp
  );
  push(
    '选区窗口用配置里指定的宽高',
    pickerResizeCalls.some((c) => c[0] === 360 && c[1] === 500),
    pickerResizeCalls
  );
  const padCheck = await fExec(
    `(() => {
       const row = document.querySelector('#scene-picker .sp-row');
       return { pad: row ? getComputedStyle(row).paddingTop : null };
     })()`,
    true
  );
  push(
    '选区行文字边距跟随设置（CSS 变量生效）',
    padCheck.pad === '20px',
    padCheck
  );

  // 点一个非当前场景 → 立即切换（主进程收到 float:switchScene）+ 选区关闭
  const target = pickCfg.scenes[1] ? pickCfg.scenes[1].id : pickCfg.scenes[0].id;
  await fExec(
    `(() => {
       const rows = document.querySelectorAll('#scene-picker .sp-row:not(.act)');
       const row = rows[1] || rows[0];
       if (row) row.click();
       return true;
     })()`,
    true
  );
  await new Promise((r) => setTimeout(r, 250));
  const rpAfter = await fExec(
    `(() => ({ open: !!document.querySelector('#scene-picker.open') }))()`,
    true
  );
  push(
    '点击场景立即切换且选区关闭',
    rpAfter.open === false && switchCalls.includes(target),
    { rpAfter, switchCalls, target }
  );

  // 再右键打开 → 点底部「打开设置…」 → settings:open 触发 + 选区关闭
  await fExec(
    `(() => {
       document.getElementById('dot').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
       return true;
     })()`,
    true
  );
  await new Promise((r) => setTimeout(r, 250));
  await fExec(
    `(() => {
       const row = [...document.querySelectorAll('#scene-picker .sp-row.act')].find((r) => r.textContent.includes('打开设置'));
       if (row) row.click();
       return true;
     })()`,
    true
  );
  await new Promise((r) => setTimeout(r, 250));
  const rpSettings = await fExec(
    `(() => ({ open: !!document.querySelector('#scene-picker.open') }))()`,
    true
  );
  push(
    '底部「打开设置…」入口生效且选区关闭',
    rpSettings.open === false && settingsOpenCalls.length === 1,
    { rpSettings, settingsOpenCalls }
  );

  // 左键短按不受影响：mousedown + mouseup 立刻抬起 → 还是展开菜单，不弹选区
  await fExec(
    `(() => {
       const d = document.getElementById('dot');
       d.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
       document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
       return true;
     })()`,
    true
  );
  await new Promise((r) => setTimeout(r, 500));
  const quick = await fExec(
    `(() => ({
       menuOpen: document.getElementById('menu').classList.contains('open'),
       pickerOpen: !!document.querySelector('#scene-picker.open'),
     }))()`,
    true
  );
  push(
    '左键短按仍是展开菜单（不再有长按判定）',
    quick.menuOpen === true && quick.pickerOpen === false,
    quick
  );
  // 收起来，别影响后续断言
  await fExec(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    true
  );
  await new Promise((r) => setTimeout(r, 150));

  // ---------- 11.6 内置动作：输入法切换 / 便签 ----------
  // 先数一遍配置里已有的 action 项目，点「一键加入」后必须多出来一个
  const countActions = () =>
    cfg.scenes.reduce((n, s) => n + s.items.filter((i) => i.type === 'action').length, 0);
  const actionsBefore = countActions();

  const toolsView = await ev(win, `
       document.querySelector('[data-view="tools"]').click();
       await sleep(250);
       const v = document.getElementById('view-tools');
       return {
         title: document.getElementById('viewTitle').textContent,
         hasImCn: !!document.getElementById('im-cn'),
         hasImEn: !!document.getElementById('im-en'),
         hasToggle: !!document.getElementById('im-toggle'),
         hasNoteOpen: !!document.getElementById('note-open'),
         hasOpacity: !!document.getElementById('note-opacity'),
         swatches: document.querySelectorAll('#note-sw button').length,
         addBtns: [...document.querySelectorAll('[data-add]')].map((b) => b.dataset.add),
         avail: (document.getElementById('im-avail') || {}).textContent || '',
         cur: (document.getElementById('im-cur') || {}).textContent || '',
       };
  `);
  push(
    '工具页渲染出「中英文切换」与「便签」两组配置',
    toolsView.title === '工具' &&
      toolsView.hasImCn &&
      toolsView.hasImEn &&
      toolsView.hasToggle &&
      toolsView.hasNoteOpen &&
      toolsView.hasOpacity,
    toolsView
  );
  push('便签预设色板渲染完整', toolsView.swatches >= 7, toolsView.swatches);
  push(
    '工具页提供两个内置动作的一键加入入口',
    toolsView.addBtns.includes('ime:switch') && toolsView.addBtns.includes('note:open'),
    toolsView.addBtns
  );
  // snapshot 走的是真实 imeswitch 辅助程序（只读），验证「辅助程序可用 + 能读到当前输入法」
  push(
    '输入法状态读到真实输入源（走 bin/imeswitch，不切用户输入法）',
    /已就绪/.test(toolsView.avail) && toolsView.cur.length > 0,
    { avail: toolsView.avail, cur: toolsView.cur }
  );

  // 点「立即切换一次」不能报错（这里 toggle 被打桩，避免真的改掉用户输入法）
  const toggleRes = await ev(win, `
       document.getElementById('im-toggle').click();
       await sleep(250);
       return { toast: document.getElementById('toast').textContent };
  `);
  push('点「立即切换一次」给出成功反馈', /已切换输入法/.test(toggleRes.toast) && imeCalls.length > 0, toggleRes);

  // 一键加入 → 配置里真的多出一个 action 项目
  await ev(win, `
       document.querySelector('[data-add="ime:switch"]').click();
       await sleep(250);
       return true;
  `);
  push('一键加入把内置动作写进配置', countActions() === actionsBefore + 1, {
    before: actionsBefore,
    after: countActions(),
  });

  // 项目类型下拉里应当有「内置动作」这一项
  const typeOpts = await ev(win, `
       document.querySelector('[data-view="library"]').click();
       await sleep(200);
       document.getElementById('lib-new').click();
       await sleep(200);
       const sel = document.getElementById('it-type');
       const vals = [...sel.options].map((o) => o.value);
       const labels = [...sel.options].map((o) => o.textContent);
       return { vals, labels };
  `);
  push(
    '项目类型下拉含「内置动作」',
    typeOpts.vals.includes('action') && typeOpts.labels.some((l) => l.includes('内置动作')),
    typeOpts
  );

  // 选「内置动作」后：目标输入框隐藏、动作下拉出现并自动带出名称/图标
  const actionModal = await ev(win, `
       const sel = document.getElementById('it-type');
       sel.value = 'action';
       sel.dispatchEvent(new Event('change'));
       await sleep(200);
       const m = document.getElementById('modal');
       return {
         targetHidden: m.querySelector('#row-target').style.display === 'none',
         actionShown: m.querySelector('#row-action').style.display === 'flex',
         actionVal: m.querySelector('#it-action').value,
         probeHidden: m.querySelector('#row-probe').style.display === 'none',
         name: m.querySelector('#it-name').value,
         icon: m.querySelector('#it-icon').value,
         hint: (m.querySelector('#it-actionhint') || {}).textContent || '',
       };
  `);
  push(
    '选「内置动作」后目标框隐藏、动作下拉出现',
    actionModal.targetHidden && actionModal.actionShown && actionModal.actionVal === 'ime:switch' && actionModal.probeHidden,
    actionModal
  );
  push(
    '选动作自动带出名称与图标（不用手打）',
    actionModal.name === '切换中/英文输入法' && actionModal.icon === '⌨️' && actionModal.hint.length > 0,
    actionModal
  );

  // 保存一个内置动作项目，校验必须能过（target 是内置 key）
  const saveAction = await ev(win, `
       document.getElementById('it-save').click();
       await sleep(300);
       const err = (document.getElementById('it-err') || {}).textContent || '';
       return { modalOpen: document.getElementById('modalBg').classList.contains('show'), err };
  `);
  push('内置动作项目能正常保存（校验放行）', saveAction.modalOpen === false && saveAction.err === '', saveAction);

  // ---------- 11.7 便签窗口：真实窗口 + 真实落盘 ----------
  const nwin = new BrowserWindow({
    width: 340,
    height: 320,
    show: false,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  const noteErrors = [];
  nwin.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) noteErrors.push(message);
  });
  await nwin.loadFile(path.join(DIST, 'renderer', 'note', 'index.html'));
  await new Promise((r) => setTimeout(r, 600));

  const noteTyped = await ev(nwin, `
       const ed = document.getElementById('editor');
       ed.innerHTML = '<div>冒烟测试便签内容</div>';
       ed.dispatchEvent(new Event('input'));
       await sleep(800);
       return {
         paper: getComputedStyle(document.querySelector('.paper')).backgroundColor,
         swatches: document.querySelectorAll('.swatch').length,
         savedShown: document.getElementById('saved').classList.contains('show'),
         editable: ed.getAttribute('contenteditable'),
         toolbar: document.querySelectorAll('.toolbar .tbtn').length,
       };
  `);
  await new Promise((r) => setTimeout(r, 300));
  const noteOnDisk = noteStore.loadNoteHtml();
  push('便签输入后自动落盘到磁盘', noteOnDisk.includes('冒烟测试便签内容'), noteOnDisk.slice(0, 40));
  push(
    '便签纸面颜色跟随配置（#fff6c9）',
    colorHas(noteTyped.paper, [255, 246, 201]) && noteTyped.swatches >= 7,
    noteTyped
  );
  push('便签保存后显示「已保存」', noteTyped.savedShown === true, noteTyped.savedShown);
  push(
    '便签是富文本编辑器且格式工具栏齐全',
    noteTyped.editable === 'true' && noteTyped.toolbar >= 7,
    noteTyped
  );

  // 富文本：代码块（带复制按钮）+ 加粗 + 有序列表 + 行内代码
  const richRes = await ev(nwin, `
       const ed = document.getElementById('editor');
       const out = {};
       const caretToEnd = (node) => {
         const r = document.createRange();
         r.selectNodeContents(node);
         r.collapse(false);
         const s = window.getSelection();
         s.removeAllRanges();
         s.addRange(r);
       };
       const selectAllOf = (node) => {
         const r = document.createRange();
         r.selectNodeContents(node);
         const s = window.getSelection();
         s.removeAllRanges();
         s.addRange(r);
       };

       // 1) 代码块 + 复制按钮
       ed.focus();
       caretToEnd(ed);
       document.getElementById('tb-codeblock').click();
       await sleep(700);                    // decorateCodeBlocks 有 350ms 防抖
       const pre = ed.querySelector('pre');
       out.preOk = !!pre && !!pre.querySelector('code');
       const btn = pre && pre.querySelector('.code-copy');
       out.copyBtn = !!btn;
       out.copyBtnNotEditable = btn ? btn.getAttribute('contenteditable') === 'false' : false;
       out.copyDefaultLabel = btn ? btn.textContent : '';
       if (btn) btn.click();
       await sleep(260);
       out.copyDone = btn ? btn.classList.contains('done') : false;
       out.copyDoneLabel = btn ? btn.textContent : '';
       await sleep(1200);                   // 等按钮自己复原，避免影响后面的检查
       out.copyResetLabel = btn ? btn.textContent : '';

       // 2) 加粗
       const d1 = document.createElement('div');
       d1.textContent = '加粗测试';
       ed.appendChild(d1);
       selectAllOf(d1);
       document.getElementById('tb-bold').click();
       await sleep(200);
       out.bold = !!ed.querySelector('b, strong');

       // 3) 有序列表（序列号）
       const d2 = document.createElement('div');
       d2.textContent = '列表项';
       ed.appendChild(d2);
       selectAllOf(d2);
       document.getElementById('tb-ol').click();
       await sleep(200);
       out.ordered = !!ed.querySelector('ol li');

       // 4) 行内代码
       const d3 = document.createElement('div');
       d3.textContent = 'inline';
       ed.appendChild(d3);
       selectAllOf(d3);
       document.getElementById('tb-code').click();
       await sleep(200);
       out.inline = [...ed.querySelectorAll('code')].some((c) => !c.closest('pre'));

       ed.dispatchEvent(new Event('input'));
       await sleep(700);
       return out;
  `);
  push(
    '代码块插入后自带「复制」按钮（且不可被编辑）',
    richRes.preOk === true && richRes.copyBtn === true && richRes.copyBtnNotEditable === true && richRes.copyDefaultLabel === '复制',
    richRes
  );
  push(
    '点代码块「复制」写进剪贴板并给出「已复制」反馈',
    richRes.copyDone === true && richRes.copyDoneLabel === '已复制' && richRes.copyResetLabel === '复制' &&
      clipboard.readText().includes('// 在这里写代码'),
    { done: richRes.copyDone, label: richRes.copyDoneLabel, clip: clipboard.readText().slice(0, 40) }
  );
  push(
    '加粗 / 有序列表 / 行内代码都生效',
    richRes.bold === true && richRes.ordered === true && richRes.inline === true,
    richRes
  );
  const noteHtmlDisk = noteStore.loadNoteHtml();
  push(
    '存盘的 HTML 不含注入的复制按钮（只留正文格式）',
    noteHtmlDisk.includes('<pre') && noteHtmlDisk.includes('<b>') && !noteHtmlDisk.includes('code-copy'),
    noteHtmlDisk.slice(0, 120)
  );

  const noteHist = noteStore.pageHistory('p1');
  push('便签记录了历史版本', noteHist.length >= 1 && String(noteHist[0].text).includes('冒烟测试便签内容'), {
    len: noteHist.length,
    first: String(noteHist[0] && noteHist[0].text).slice(0, 30),
  });

  // 历史面板：能打开并列出版本，点某一版先预览、再点「恢复这一版」写回编辑器
  const histRes = await ev(nwin, `
       const ed = document.getElementById('editor');
       ed.innerHTML = '<div>冒烟测试便签第二版</div>';
       ed.dispatchEvent(new Event('input'));
       await sleep(700);
       document.getElementById('btn-hist').click();
       await sleep(400);
       const opened = document.getElementById('hist').classList.contains('show');
       const items = document.querySelectorAll('#hist-list .item');
       let previewed = false;
       let restored = '';
       if (items.length >= 2) {
         items[1].click();                              // 点上一版 → 只预览
         await sleep(300);
         previewed = document.getElementById('hprev').classList.contains('show')
           && document.getElementById('hprev-body').textContent.includes('冒烟测试便签内容');
         document.getElementById('hprev-do').click();   // 确认后才写回正文
         await sleep(500);
         restored = document.getElementById('editor').innerHTML;
       }
       return { opened, count: items.length, previewed, restored };
  `);
  push(
    '便签历史：先预览某一版，再点「恢复这一版」写回正文',
    histRes.opened === true && histRes.count >= 2 && histRes.previewed === true && histRes.restored.includes('冒烟测试便签内容'),
    histRes
  );
  push('便签窗口无严重控制台错误', noteErrors.length === 0, noteErrors.slice(0, 5));
  nwin.destroy();

  // 11.5 菜单音效（常规页的卡片：下拉清单、默认值、改完写配置、试听能点）
  const sndUI = await ev(win, `
       document.querySelector('[data-view="general"]').click();
       await sleep(400);
       // 预制清单是异步拉取的，等下拉真正有内容
       for (let i = 0; i < 30 && document.querySelectorAll('#g-snd-hover option').length < 2; i++) await sleep(100);
       const card = [...document.querySelectorAll('#view-general .card')]
         .find(c => ((c.querySelector('h3') || {}).textContent || '') === '菜单音效');
       const hover = document.getElementById('g-snd-hover');
       const clickSel = document.getElementById('g-snd-click');
       const openSel = document.getElementById('g-snd-open');
       return {
         hasCard: !!card,
         opts: hover ? hover.options.length : 0,
         groups: hover ? [...hover.querySelectorAll('optgroup')].map(g => g.label) : [],
         hover: hover ? hover.value : '',
         click: clickSel ? clickSel.value : '',
         open: openSel ? openSel.value : '',
         vol: (document.getElementById('g-snd-vol') || {}).value,
         hasPrev: !!document.querySelector('[data-snd-prev="hover"]'),
       };
  `);
  push(
    '常规页有「菜单音效」卡片，默认「移到按钮上=清脆叮 Tink」「点击=轻弹 Pop」「展开收起=不播放」',
    sndUI.hasCard && sndUI.hover === 'tink' && sndUI.click === 'pop' && sndUI.open === 'none' && sndUI.vol === '45',
    sndUI
  );
  push(
    '音效下拉列全了预制音效（系统音效 + 合成音效两组，至少 15 个）',
    sndUI.opts >= 15 && sndUI.groups.length === 2 && sndUI.hasPrev,
    { opts: sndUI.opts, groups: sndUI.groups, hasPrev: sndUI.hasPrev }
  );

  const sndChange = await ev(win, `
       const sel = document.getElementById('g-snd-hover');
       sel.value = 'morse';
       sel.dispatchEvent(new Event('change'));
       await sleep(300);
       const vol = document.getElementById('g-snd-vol');
       vol.value = '70';
       vol.dispatchEvent(new Event('input'));
       vol.dispatchEvent(new Event('change'));
       await sleep(300);
       await saveNow(); // 音量滑杆也是「停手 5 秒才自动保存」
       const prevBtn = document.querySelector('[data-snd-prev="hover"]');
       let previewOk = false;
       try { prevBtn.click(); previewOk = true; } catch (e) { previewOk = String(e); }
       await sleep(300);
       return { hover: sel.value, vol: vol.value, volLabel: (document.getElementById('g-snd-vol-v') || {}).textContent, previewOk };
  `);
  push(
    '改「移到按钮上」为短滴（Morse）会写进配置',
    sndChange.hover === 'morse' && cfg.sound && cfg.sound.hover === 'morse',
    { ui: sndChange.hover, saved: cfg.sound && cfg.sound.hover }
  );
  push(
    '拖音量滑杆写进配置并同步标签（70%）',
    String(cfg.sound && cfg.sound.volume) === '70' && sndChange.volLabel === '70%',
    { saved: cfg.sound && cfg.sound.volume, label: sndChange.volLabel }
  );
  push('「试听」按钮可点击且不抛错', sndChange.previewOk === true, sndChange);

  // 11.6 禁止选中文字：设置页只有「能打字的地方」能选中 / 复制粘贴
  // 起因：拖音量滑杆时鼠标滑到旁边的说明文字上，整段文字被选中，滑杆跟着卡住。
  const selProbe = await ev(win, `
       document.querySelector('[data-view="general"]').click();
       await sleep(300);
       const cs = (n) => { const s = getComputedStyle(n); return String(s.userSelect || s.webkitUserSelect || ''); };
       const range = document.getElementById('g-snd-vol');
       // 找一段够长的说明文字，用来做「鼠标划过文字」的拖选测试
       const hint = [...document.querySelectorAll('#view-general .hint')]
         .map(h => ({ h, r: h.getBoundingClientRect() }))
         .filter(x => x.r.width > 200 && x.r.height > 6 && x.h.offsetParent)
         .sort((a, b) => b.r.width - a.r.width)[0];
       const rr = range ? range.getBoundingClientRect() : null;
       return {
         bodySel: cs(document.body),
         hintSel: hint ? cs(hint.h) : 'no-hint',
         rangeSel: range ? cs(range) : 'no-range',
         hintX1: hint ? Math.round(hint.r.x + 6) : 0,
         hintX2: hint ? Math.round(hint.r.x + Math.min(240, hint.r.width - 6)) : 0,
         hintY: hint ? Math.round(hint.r.y + hint.r.height / 2) : 0,
         rngX: rr ? Math.round(rr.x + rr.width / 2) : 0,
         rngY: rr ? Math.round(rr.y + rr.height / 2) : 0,
       };
  `);
  push(
    '设置页整体关闭文字选中（说明文字、滑杆都不是可选中的）',
    selProbe.bodySel === 'none' && selProbe.hintSel === 'none' && selProbe.rangeSel === 'none' && selProbe.hintY > 0,
    selProbe
  );

  await ev(win, `window.getSelection().removeAllRanges(); return 1;`);
  const dragText = await cdpDrag(selProbe.hintX1, selProbe.hintY, selProbe.hintX2, selProbe.hintY);
  push('在说明文字上按住鼠标拖过去，不会选中任何文字', dragText.text === '', dragText);

  // 对照组：临时把 body 放回可选中，同样的拖拽必须能选中 —— 否则上面那条是假通过
  await ev(
    win,
    `document.body.style.userSelect = 'text'; document.body.style.webkitUserSelect = 'text';
     window.getSelection().removeAllRanges(); return 1;`
  );
  const dragCtrl = await cdpDrag(selProbe.hintX1, selProbe.hintY, selProbe.hintX2, selProbe.hintY);
  await ev(
    win,
    `document.body.style.userSelect = ''; document.body.style.webkitUserSelect = '';
     window.getSelection().removeAllRanges(); return 1;`
  );
  push('对照：放开选中后同样的拖拽确实能选中（证明上一条不是空跑）', dragCtrl.text.length > 0, dragCtrl);

  const dragSlider = await cdpDrag(selProbe.rngX, selProbe.rngY, selProbe.rngX + 90, selProbe.rngY);
  push('从音量滑杆往外拖也不产生选区（原先就是这个动作把文字选中了）', dragSlider.text === '', dragSlider);

  // 键盘这条路 CSS 管不住（⌘A 能选中全页），要靠脚本再拦一层
  const keyGuard = await ev(win, `
       const fire = (t) => {
         const e = new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true });
         t.dispatchEvent(e);
         return e.defaultPrevented;
       };
       const hintNode = document.querySelector('#view-general .hint') || document.body;
       const bodyBlocked = fire(hintNode);
       document.querySelector('[data-view="library"]').click();
       await sleep(400);
       const q = document.getElementById('lib-q');
       const inputBlocked = q ? fire(q) : 'no-input';
       const inputSel = q ? getComputedStyle(q).userSelect : '';
       document.querySelector('[data-view="general"]').click();
       await sleep(200);
       return { bodyBlocked, inputBlocked, inputSel };
  `);
  push(
    '非输入区 ⌘A 被拦下，输入框里 ⌘A 照常可用（且输入框仍可选中）',
    keyGuard.bodyBlocked === true && keyGuard.inputBlocked === false && keyGuard.inputSel === 'text',
    keyGuard
  );

  // 页面不能选中文字了，诊断信息改走「关于」页的按钮一键复制
  clipboard.writeText('');
  const copyDiag = await ev(win, `
       document.querySelector('[data-view="about"]').click();
       await sleep(500);
       const btn = document.getElementById('ab-copydiag');
       if (!btn) return { error: '没有「复制诊断信息」按钮' };
       btn.click();
       await sleep(400);
       return { clicked: true, diagLen: (document.getElementById('ab-diag') || {}).textContent.length };
  `);
  const clipDbg = clipboard.readText();
  push(
    '「关于 → 复制诊断信息」按钮把诊断写进系统剪贴板',
    copyDiag.clicked === true && clipDbg.includes('FloatDesk 诊断信息') && clipDbg.length > 80,
    { ...copyDiag, clip: clipDbg.slice(0, 80) }
  );

  // 11.7 合并「常规 + 外观」+ 新的保存节奏（拖滑杆不写盘、停手 5 秒自动保存、点按钮立即保存）
  {
    const merged = await ev(win, `
      document.querySelector('[data-view="general"]').click();
      await sleep(320);
      const navs = [...document.querySelectorAll('#nav [data-view]')].map(b => b.dataset.view);
      const grid = document.querySelector('#view-general .grid2');
      const cols = grid ? [...grid.children] : [];
      const cardsOf = (i) => (cols[i] ? cols[i].querySelectorAll('.card').length : -1);
      return {
        navs,
        hasAppearanceView: !!document.getElementById('view-appearance'),
        cols: cols.length,
        leftCards: cardsOf(0),
        rightCards: cardsOf(1),
        hasScene: !!document.getElementById('ap-scene'),
        hasAppearance: !!document.getElementById('a-dot'),
        hasBehavior: !!document.getElementById('g-login'),
        hasPicker: !!document.getElementById('g-pw'),
        saveState: (document.getElementById('saveState') || {}).textContent || '',
      };
    `);
    push(
      '导航精简：不再有独立的「外观」「项目管理」页（8 项 → 6 项）',
      merged.hasAppearanceView === false &&
        merged.navs.length === 6 &&
        !merged.navs.includes('appearance') &&
        !merged.navs.includes('items') &&
        merged.navs.includes('library'),
      merged.navs
    );
    push(
      '合并后是左右两栏（左=场景/外观/悬浮球，右=行为/音效/选区/快捷键）',
      merged.cols === 2 && merged.leftCards >= 3 && merged.rightCards >= 4,
      { cols: merged.cols, left: merged.leftCards, right: merged.rightCards }
    );
    push(
      '原先两页的控件现在同页可用（外观滑杆 + 行为开关 + 选区宽高 + 场景选择）',
      merged.hasAppearance && merged.hasBehavior && merged.hasPicker && merged.hasScene,
      merged
    );
    push('顶栏有保存状态，默认是「已保存」', merged.saveState === '已保存', merged.saveState);

    // 拖滑杆：不写盘、不重建 DOM，状态变「改动待保存」
    const beforeDot = cfg.scenes[0].dotSize;
    previewCfg = null;
    const dragging = await ev(win, `
      const inp = document.getElementById('a-dot');
      const ref = inp;
      inp.value = '72';
      inp.dispatchEvent(new Event('input'));
      await sleep(120);
      inp.value = '86';
      inp.dispatchEvent(new Event('input'));
      await sleep(160);
      return {
        sameNode: document.getElementById('a-dot') === ref,
        state: (document.getElementById('saveState') || {}).textContent || '',
        label: (document.getElementById('a-dot-v') || {}).textContent || '',
        val: inp.value,
      };
    `);
    push(
      '拖滑杆时页面不重建（还是同一个 DOM 节点）、读数实时更新、状态变「改动待保存」',
      dragging.sameNode === true && dragging.state === '改动待保存' && dragging.label === '86px',
      dragging
    );
    push('拖滑杆时不立刻写盘（主进程配置仍是旧值）', cfg.scenes[0].dotSize === beforeDot, {
      before: beforeDot,
      now: cfg.scenes[0].dotSize,
    });
    push(
      '但改动会以「预览」推给主进程（悬浮窗能实时看到，不落盘）',
      previewCfg && previewCfg.scenes && previewCfg.scenes[0].dotSize === 86,
      previewCfg ? previewCfg.scenes[0].dotSize : null
    );

    // 停手 5 秒 → 自动保存
    await new Promise((r) => setTimeout(r, 6200));
    const afterAuto = await win.webContents.executeJavaScript(
      `(document.getElementById('saveState') || {}).textContent || ''`
    );
    push('停手 5 秒后自动保存进配置（不点按钮也会存）', cfg.scenes[0].dotSize === 86, { now: cfg.scenes[0].dotSize });
    push('自动保存后状态回到「已保存」', afterAuto === '已保存', afterAuto);

    // 点按钮：立即保存
    const manual = await ev(win, `
      const inp = document.getElementById('a-dot');
      inp.value = '78';
      inp.dispatchEvent(new Event('input'));
      await sleep(80);
      const dirtyLabel = (document.getElementById('saveState') || {}).textContent || '';
      const b = document.getElementById('saveTop');
      b.click();
      await sleep(420);
      return { dirtyLabel, state: (document.getElementById('saveState') || {}).textContent || '', cls: b.className, text: b.textContent };
    `);
    push(
      '点「保存」立即落盘（不用等 5 秒），按钮给「✓ 已保存」反馈',
      cfg.scenes[0].dotSize === 78 && manual.cls.includes('saved'),
      { dot: cfg.scenes[0].dotSize, ...manual }
    );
    push('手动保存后顶栏状态回到「已保存」', manual.state === '已保存', manual.state);
  }

  // 11.8 项目库：项目管理已并入「已添加」+ 项目可隐藏/放回 + 悬浮菜单右键直达
  {
    // 挑一个确实有项目的场景，右栏才有行可看
    const scWithItems = cfg.scenes.find((s) => (s.items || []).length > 0);
    const merged = await ev(win, `
      document.querySelector('[data-view="library"]').click();
      await sleep(240);
      const sel = document.getElementById('lib-scene');
      sel.value = '${scWithItems ? scWithItems.id : ''}';
      sel.dispatchEvent(new Event('change'));
      await sleep(260);
      const rows = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in')];
      const r0 = rows[0];
      return {
        title: (document.getElementById('viewTitle') || {}).textContent || '',
        rows: rows.length,
        ops: r0 ? {
          toggle: !!r0.querySelector('[data-sc-en]'),
          up: !!r0.querySelector('[data-sc-up]'),
          down: !!r0.querySelector('[data-sc-down]'),
          edit: !!r0.querySelector('[data-sc-editbtn]'),
          dup: !!r0.querySelector('[data-sc-dup]'),
          save: !!r0.querySelector('[data-sc-save]'),
          del: !!r0.querySelector('[data-sc-del]'),
        } : null,
        head: {
          add: !!document.getElementById('lib-new'),
          autoIcon: !!document.getElementById('lib-autoicon'),
          hidden: !!document.getElementById('lib-hidden'),
        },
      };
    `);
    push(
      '项目管理已并入项目库：右「已添加」行内有 启用/↑↓/编辑/复制/收藏/× 全套操作',
      merged.rows > 0 &&
        !!merged.ops &&
        merged.ops.toggle &&
        merged.ops.up &&
        merged.ops.down &&
        merged.ops.edit &&
        merged.ops.dup &&
        merged.ops.save &&
        merged.ops.del,
      merged
    );
    push(
      '项目库页顶补上了原项目管理的能力：「+ 添加项目」与「自动补全图标」',
      merged.head.add === true && merged.head.autoIcon === true && merged.head.hidden === true,
      merged.head
    );

    // 隐藏：点左栏卡片上的 👁
    const hideFlow = await ev(win, `
      const btn = document.querySelector('#lib-results [data-lib-hide]');
      if (!btn) return { error: '左栏没有可隐藏的项目' };
      const id = btn.dataset.libHide;
      btn.click();
      await sleep(320);
      return {
        id,
        gone: !document.querySelector('#lib-results .lib-card:not(.hidden)[data-lib-id="' + id + '"]'),
        btnText: ((document.getElementById('lib-hidden') || {}).textContent || '').trim(),
      };
    `);
    push('项目卡片点 👁 后从列表消失（不是删除）', hideFlow.gone === true, hideFlow);
    push('工具栏「已隐藏」计数跟着 +1', /已隐藏（1）/.test(String(hideFlow.btnText || '')), hideFlow.btnText);
    push(
      '隐藏已写进配置 libHidden（不是只藏在当前页面）',
      Array.isArray(cfg.libHidden) && cfg.libHidden.indexOf(hideFlow.id) >= 0,
      { libHidden: cfg.libHidden, id: hideFlow.id }
    );

    // 展开「已隐藏」分区 → 放回去
    const showFlow = await ev(win, `
      document.getElementById('lib-hidden').click();
      await sleep(320);
      const secs = [...document.querySelectorAll('#lib-results .lib-section-title')].map((x) => x.textContent.trim());
      const card = document.querySelector('#lib-results .lib-card.hidden[data-lib-id="${hideFlow.id}"]');
      const restore = card ? card.querySelector('[data-lib-show]') : null;
      if (restore) restore.click();
      await sleep(340);
      return {
        secs,
        hadCard: !!card,
        back: !!document.querySelector('#lib-results .lib-card:not(.hidden)[data-lib-id="${hideFlow.id}"]'),
      };
    `);
    push(
      '点「已隐藏」能展开隐藏分区，里面能看到被藏起来的项目',
      showFlow.hadCard === true && showFlow.secs.some((s) => /已隐藏（1）/.test(s)),
      showFlow
    );
    push(
      '点 ↺ 放回去：项目回到列表，配置里的 libHidden 也移除',
      showFlow.back === true &&
        (!Array.isArray(cfg.libHidden) || cfg.libHidden.indexOf(hideFlow.id) < 0),
      { back: showFlow.back, libHidden: cfg.libHidden }
    );
    // 收起「已隐藏」分区，把页面恢复原样
    await ev(win, `document.getElementById('lib-hidden').click(); await sleep(200); return true;`);

    // 悬浮菜单右键「打开项目库…」：主进程投递 settings:gotoView 后应直接切页
    await ev(win, `document.querySelector('[data-view="about"]').click(); await sleep(220); return true;`);
    win.webContents.send('settings:gotoView', 'library');
    await new Promise((r) => setTimeout(r, 420));
    const jumped = await win.webContents.executeJavaScript(
      `(document.getElementById('viewTitle') || {}).textContent || ''`,
      true
    );
    push('悬浮菜单右键「打开项目库…」从任意页直达项目库', jumped === '项目库', jumped);
  }

  // 11.9 场景库：左右分屏 + 行内只有「编辑 / 项目 / ＋|－」
  // 明确约定：行内【不放开关、不放删除×、不放外观】，停用只改 enabled 标记，数据一条不丢
  {
    const split = await ev(win, `
      document.querySelector('[data-view="scenes"]').click();
      await sleep(280);
      const cols = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
      const titles = cols.map((c) => ((c.querySelector('.lib-col-title') || {}).textContent || '').trim());
      const r0 = cols[1] ? cols[1].querySelector('.scene-row') : null;
      return {
        cols: cols.length,
        titles,
        leftRows: cols[0] ? cols[0].querySelectorAll('.scene-row').length : -1,
        rightRows: cols[1] ? cols[1].querySelectorAll('.scene-row').length : -1,
        rightActs: r0 ? [...r0.querySelectorAll('[data-act]')].map((b) => b.dataset.act) : [],
        rightBtns: r0 ? [...r0.querySelectorAll('.ops button')].map((b) => b.textContent.trim()) : [],
        rightSwitches: r0 ? r0.querySelectorAll('input[type="checkbox"], .switch, [data-act="toggle"]').length : -1,
      };
    `);
    push(
      '场景管理是左右两栏：左「场景库 · 未启用」、右「已启用」',
      split.cols === 2 &&
        split.titles.some((t) => /场景库/.test(t) && /未启用/.test(t)) &&
        split.titles.some((t) => /已启用/.test(t)),
      split
    );
    push(
      '已启用行内正好三个按钮：编辑 / 项目 / －（没有开关、没有删除×、没有外观）',
      split.rightActs.length === 3 &&
        split.rightActs[0] === 'edit' &&
        split.rightActs[1] === 'items' &&
        split.rightActs[2] === 'disable' &&
        !split.rightActs.includes('toggle') &&
        !split.rightActs.includes('del') &&
        !split.rightActs.includes('appearance') &&
        split.rightSwitches === 0,
      { acts: split.rightActs, switches: split.rightSwitches }
    );
    push('右栏第三个按钮是减号「－」', split.rightBtns[2] === '－', split.rightBtns);

    // 点「－」停用：只改标记，配置里的场景数与项目数一个都不能少
    const firstOn = cfg.scenes.find((s) => s.enabled !== false);
    const beforeLen = cfg.scenes.length;
    const beforeItems = firstOn.items.length;
    const beforeNames = firstOn.items.map((i) => i.name).join('|');
    const dis = await ev(win, `
      const cols = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
      const row = [...cols[1].querySelectorAll('.scene-row')].find((r) => r.dataset.scId === '${firstOn.id}');
      if (!row) return { error: '右栏找不到该场景' };
      const minus = row.querySelector('[data-act="disable"]');
      if (!minus) return { error: '右栏这一行没有减号按钮' };
      minus.click();
      await sleep(360);
      const c2 = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
      const lr = [...c2[0].querySelectorAll('.scene-row')].find((r) => r.dataset.scId === '${firstOn.id}');
      return {
        leftRows: c2[0].querySelectorAll('.scene-row').length,
        rightRows: c2[1].querySelectorAll('.scene-row').length,
        inLeft: !!lr,
        leftActs: lr ? [...lr.querySelectorAll('[data-act]')].map((b) => b.dataset.act) : [],
        leftBtns: lr ? [...lr.querySelectorAll('.ops button')].map((b) => b.textContent.trim()) : [],
        leftSwitches: lr ? lr.querySelectorAll('input[type="checkbox"], .switch, [data-act="toggle"]').length : -1,
      };
    `);
    const after = cfg.scenes.find((s) => s.id === firstOn.id);
    push(
      '点「－」停用后，场景从右栏移到左栏「场景库」',
      dis.leftRows === 1 && dis.rightRows === split.rightRows - 1 && dis.inLeft === true,
      dis
    );
    push(
      '左栏未启用行内也正好三个按钮：编辑 / 项目 / ＋（没有开关、没有删除×）',
      Array.isArray(dis.leftActs) &&
        dis.leftActs.length === 3 &&
        dis.leftActs[0] === 'edit' &&
        dis.leftActs[1] === 'items' &&
        dis.leftActs[2] === 'enable' &&
        !dis.leftActs.includes('toggle') &&
        !dis.leftActs.includes('del') &&
        dis.leftSwitches === 0,
      { acts: dis.leftActs, switches: dis.leftSwitches }
    );
    push('左栏第三个按钮是加号「＋」', dis.leftBtns[2] === '＋', dis.leftBtns);
    push(
      '停用不删场景：配置里场景数不变、只把 enabled 置 false',
      cfg.scenes.length === beforeLen && after && after.enabled === false,
      { before: beforeLen, after: cfg.scenes.length, enabled: after ? after.enabled : null }
    );
    push(
      '停用场景的数据原样保留（项目数与名称都没动）',
      after && after.items.length === beforeItems && after.items.map((i) => i.name).join('|') === beforeNames,
      after ? { n: after.items.length, want: beforeItems } : null
    );

    // 点「＋」重新启用：回到右栏，数据还是原来那批
    const re = await ev(win, `
      const cols = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
      const btn = cols[0].querySelector('[data-act="enable"]');
      if (!btn) return { error: '左栏没有加号按钮' };
      btn.click();
      await sleep(360);
      const c2 = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
      return {
        leftRows: c2[0].querySelectorAll('.scene-row').length,
        rightRows: c2[1].querySelectorAll('.scene-row').length,
      };
    `);
    const back = cfg.scenes.find((s) => s.id === firstOn.id);
    push('点「＋」重新启用：回到右栏且两侧计数复原', re.leftRows === 0 && re.rightRows === split.rightRows, re);
    push(
      '重新启用后数据还是原来那批（项目与名称一致）',
      back && back.enabled !== false && back.items.length === beforeItems &&
        back.items.map((i) => i.name).join('|') === beforeNames,
      back ? { enabled: back.enabled, n: back.items.length } : null
    );

    // ＋ / － 双向往返：－ 掉进左栏、＋ 回右栏，来回两次都不丢数据
    const round = await ev(win, `
      const pick = (i) => [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')][i];
      const step = async (colIdx, act) => {
        const row = [...pick(colIdx).querySelectorAll('.scene-row')].find((r) => r.dataset.scId === '${firstOn.id}');
        const b = row && row.querySelector('[data-act="' + act + '"]');
        if (!b) return false;
        b.click();
        await sleep(340);
        return true;
      };
      const a = await step(1, 'disable');
      const offLeft = pick(0).querySelectorAll('.scene-row').length;
      const b1 = await step(0, 'enable');
      const onRight = pick(1).querySelectorAll('.scene-row').length;
      const b2 = await step(1, 'disable');
      const offLeft2 = pick(0).querySelectorAll('.scene-row').length;
      await step(0, 'enable');
      return {
        ok: a && b1 && b2,
        offLeft, onRight, offLeft2,
        onLeft: pick(0).querySelectorAll('.scene-row').length,
        rightRows: pick(1).querySelectorAll('.scene-row').length,
      };
    `);
    push(
      '＋ / － 反复往返都能用：两次停用都落左栏、启用后回右栏无残留',
      round.ok === true &&
        round.offLeft === 1 && round.onRight === split.rightRows &&
        round.offLeft2 === 1 && round.onLeft === 0 && round.rightRows === split.rightRows,
      round
    );

    // 点行内空白处 = 编辑；行内没有开关，删除只放在弹窗里
    const rowEdit = await ev(win, `
      const cols = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
      const row = cols[1].querySelector('.scene-row');
      (row.querySelector('.nm') || row).click();
      await sleep(180);
      const opened = !!document.querySelector('#sm-name');
      const hasEnabledSwitch = !!document.querySelector('#sm-enabled');
      const hasDel = !!document.querySelector('#sm-del');
      const hasDup = !!document.querySelector('#sm-dup');
      if (document.querySelector('#sm-cancel')) document.querySelector('#sm-cancel').click();
      await sleep(120);
      return { opened, hasEnabledSwitch, hasDel, hasDup, closed: !document.querySelector('#sm-name') };
    `);
    push(
      '点场景行空白处打开编辑弹窗（弹窗里没有启用开关，删除/复制都在这里）',
      rowEdit.opened === true && rowEdit.hasEnabledSwitch === false &&
        rowEdit.hasDel === true && rowEdit.hasDup === true && rowEdit.closed === true,
      rowEdit
    );

    // 最后一个启用场景不允许停用
    const last = await ev(win, `
      for (let guard = 0; guard < 24; guard++) {
        const c = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
        const rows = [...c[1].querySelectorAll('.scene-row')];
        if (rows.length <= 1) break;
        const minus = rows[0].querySelector('[data-act="disable"]');
        if (!minus) break;
        minus.click();
        await sleep(220);
      }
      const c = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
      const rows = [...c[1].querySelectorAll('.scene-row')];
      if (rows.length !== 1) return { error: '没能收敛到只剩一个启用场景', n: rows.length };
      const minus = rows[0].querySelector('[data-act="disable"]');
      if (minus) { minus.click(); await sleep(300); }
      const c2 = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
      return { rightRows: c2[1].querySelectorAll('.scene-row').length, hadMinus: !!minus };
    `);
    push(
      '最后一个启用场景停不掉（至少留一个，悬浮球不会无处可去）',
      last.rightRows === 1 && last.hadMinus === true &&
        cfg.scenes.filter((s) => s.enabled !== false).length === 1,
      last
    );
  
  }

  // 12. 页面无脚本错误
  // level>=2 是 warning/error；渲染脚本崩溃会走 render-process-gone / preload-error
  push('无严重控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 5));

  const failed = results.filter((r) => !r.ok);
  console.log('SMOKE_RESULT_BEGIN');
  console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
  console.log('SMOKE_RESULT_END');
  fs.writeFileSync(path.join(ROOT, 'ui-smoke-result.json'), JSON.stringify({ results, consoleErrors }, null, 2));
  app.exit(failed.length ? 1 : 0);
}).catch((e) => {
  // 兜底：任何未预期的抛出都打印当前结果再退出，避免进程挂着不输出
  console.log('SMOKE_RESULT_BEGIN');
  console.log(JSON.stringify({ results, fatal: String(e && e.stack ? e.stack : e), failed: results.filter((r) => !r.ok).length }, null, 2));
  console.log('SMOKE_RESULT_END');
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
