// 「设置页禁止选中文字」截图自检（一次性脚本）：
//   1) 在设置页的说明文字上按住鼠标拖过去 —— 不该出现蓝色选区（原来拖滑杆就是这么误选文字，滑杆跟着卡住）
//   2) 对照组：临时把 body 放回可选中，同样的拖拽必须能选中（证明第 1 条不是空跑）
//   3) 页面不能选中文字了，诊断信息改走「关于 → 复制诊断信息」按钮一键复制
// 鼠标事件走 CDP（Input.dispatchMouseEvent）：executeJavaScript 里 dispatchEvent 是合成事件，
// 合成事件不会触发浏览器原生的拖选行为，测不出 user-select 是否真的生效。
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const builtins = require(path.join(DIST, 'shared', 'builtins.js'));
const sounds = require(path.join(DIST, 'shared', 'sounds.js'));

const OUT = '/tmp/fd-nosel';
const DOCS = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });

// ---- 主进程桩：只留设置页渲染要用的那几条 ----
ipcMain.handle('config:get', () => defaults.buildDefaultConfig());
ipcMain.handle('config:save', () => ({ ok: true }));
ipcMain.handle('config:preview', () => ({ ok: true }));
ipcMain.handle('config:export', () => ({ ok: false, canceled: true }));
ipcMain.handle('config:import', () => ({ ok: false, canceled: true }));
ipcMain.handle('config:reset', () => ({ ok: true, config: defaults.buildDefaultConfig() }));
ipcMain.handle('builtins:actions', () => builtins.BUILTIN_ACTIONS);
ipcMain.handle('library:presets', () => []);
ipcMain.handle('app:scan', () => []);
ipcMain.handle('app:resolve', () => ({ ok: false }));
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('note:presets', () => []);
ipcMain.handle('ime:snapshot', () => ({ ok: true, available: true, sources: [], currentId: '', currentName: '' }));
ipcMain.handle('sound:list', () => ({ presets: sounds.SOUND_PRESETS, groups: sounds.SOUND_GROUP_LABELS }));
ipcMain.handle('sound:get', () => ({ ok: false }));
// 真实格式的诊断信息（截图里要看到内容才对得上）
ipcMain.handle('diag:get', () => ({
  diagnostics: [
    '===== FloatDesk 诊断信息 =====',
    '时间: ' + new Date().toISOString(),
    '平台: darwin (arm64)',
    'Electron: 34.5.8',
    '场景数量: 4',
    '当前场景: 日常办公',
    '唤出快捷键: command+shift+space',
    '==============================',
  ].join('\n'),
  log: '[diag] 设置页加载完成\n[diag] 悬浮窗已就绪',
}));
// 设置页「复制诊断信息」走这条（页面本身禁止选中文字，复制只能靠按钮）
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text));
  return { ok: true };
});
ipcMain.on('settings:open', () => {});
ipcMain.on('settings:close', () => {});
ipcMain.on('diag:log', () => {});
ipcMain.on('float:resize', () => {});
ipcMain.on('note:open', () => {});
ipcMain.on('note:close', () => {});
ipcMain.on('preview:open', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else {
    failed++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

const WAIT_HELPER = `
  const waitFor = async (fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 4000)) {
      let v = false;
      try { v = fn(); } catch (e) { v = false; }
      if (v) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  };`;

let win = null;

/** 用真实鼠标事件在 [from] → [to] 之间拖一道，返回拖完后的选区内文字 */
async function dragSelect(fromX, fromY, toX, toY) {
  const dbg = win.webContents.debugger;
  try {
    dbg.attach('1.3');
  } catch {
    /* 已 attach */
  }
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
  return win.webContents.executeJavaScript(`String(window.getSelection().toString())`);
}

async function shot(name, note) {
  const img = await win.capturePage();
  const p = path.join(OUT, name);
  fs.writeFileSync(p, img.toPNG());
  fs.copyFileSync(p, path.join(DOCS, name));
  console.log('[shot] ' + note + ' → ' + p);
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1180, height: 800, show: true,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    window.confirm = () => true;
    await waitFor(() => document.querySelector('[data-view="general"]'), 15000);
    document.querySelector('[data-view="general"]').click();
    await waitFor(() => document.getElementById('g-snd-vol'), 8000);
    return true;
  })()`);
  await sleep(500);

  // 1) 量出「说明文字」和「音量滑杆」的位置
  const geo = await win.webContents.executeJavaScript(`(() => {
    const cs = (n) => { const s = getComputedStyle(n); return String(s.userSelect || s.webkitUserSelect || ''); };
    const range = document.getElementById('g-snd-vol');
    const hint = [...document.querySelectorAll('#view-general .hint')]
      .map(h => ({ h, r: h.getBoundingClientRect() }))
      .filter(x => x.r.width > 200 && x.r.height > 6 && x.h.offsetParent)
      .sort((a, b) => b.r.width - a.r.width)[0];
    const rr = range.getBoundingClientRect();
    return {
      bodySel: cs(document.body),
      hintSel: hint ? cs(hint.h) : 'no-hint',
      rangeSel: cs(range),
      hintX1: Math.round(hint.r.x + 6),
      hintX2: Math.round(hint.r.x + Math.min(260, hint.r.width - 6)),
      hintY: Math.round(hint.r.y + hint.r.height / 2),
      rngX: Math.round(rr.x + rr.width / 2),
      rngY: Math.round(rr.y + rr.height / 2),
    };
  })()`);

  check(
    '设置页整体 user-select:none（说明文字、滑杆都不可选中）',
    geo.bodySel === 'none' && geo.hintSel === 'none' && geo.rangeSel === 'none',
    JSON.stringify(geo)
  );

  // 2) 在说明文字上拖 —— 不该有选区
  await win.webContents.executeJavaScript(`window.getSelection().removeAllRanges(); true`);
  const t1 = await dragSelect(geo.hintX1, geo.hintY, geo.hintX2, geo.hintY);
  check('说明文字上拖鼠标不产生选区', t1 === '', JSON.stringify(t1));
  await shot('settings-nosel.png', '拖过说明文字 → 没有蓝色选区');

  // 3) 从滑杆往外拖 —— 也就是用户反馈的那个动作
  await win.webContents.executeJavaScript(`window.getSelection().removeAllRanges(); true`);
  const t2 = await dragSelect(geo.rngX, geo.rngY, geo.rngX + 100, geo.rngY);
  check('从音量滑杆往外拖不产生选区', t2 === '', JSON.stringify(t2));

  // 4) 对照组：放开选中后同样的拖拽必须能选中
  await win.webContents.executeJavaScript(
    `document.body.style.userSelect = 'text'; document.body.style.webkitUserSelect = 'text';
     window.getSelection().removeAllRanges(); true`
  );
  const t3 = await dragSelect(geo.hintX1, geo.hintY, geo.hintX2, geo.hintY);
  check('对照：放开选中后同样的拖拽能选中（证明上一条不是空跑）', t3.length > 0, JSON.stringify(t3.slice(0, 40)));
  await shot('settings-nosel-control.png', '对照：放开 user-select 后同样的拖拽会选中');
  await win.webContents.executeJavaScript(
    `document.body.style.userSelect = ''; document.body.style.webkitUserSelect = '';
     window.getSelection().removeAllRanges(); true`
  );

  // 5) 输入框必须保住「能选中、能复制粘贴」——这是需求里明确要保留的部分
  const inputGeo = await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    document.querySelector('[data-view="shortcuts"]').click();
    await waitFor(() => document.getElementById('sc-q'), 8000);
    const q = document.getElementById('sc-q');
    q.value = 'macOS 输入框仍然可以选中文字';
    q.focus();
    q.setSelectionRange(0, 0);
    const r = q.getBoundingClientRect();
    return { x1: Math.round(r.x + 10), x2: Math.round(r.x + 170), y: Math.round(r.y + r.height / 2) };
  })()`);
  await dragSelect(inputGeo.x1, inputGeo.y, inputGeo.x2, inputGeo.y);
  const inputSel = await win.webContents.executeJavaScript(
    `(() => { const q = document.getElementById('sc-q');
      return { start: q.selectionStart, end: q.selectionEnd, focused: document.activeElement === q }; })()`
  );
  check(
    '输入框里按住鼠标拖过去照样能选中文字（复制粘贴没被牵连）',
    inputSel.focused === true && inputSel.end > inputSel.start,
    JSON.stringify(inputSel)
  );
  await win.webContents.executeJavaScript(`document.getElementById('sc-q').blur(); window.getSelection().removeAllRanges(); true`);

  // 6) 关于页的「复制诊断信息」按钮
  clipboard.writeText('');
  await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    document.querySelector('[data-view="about"]').click();
    await waitFor(() => document.getElementById('ab-copydiag'), 8000);
    document.getElementById('ab-copydiag').click();
    await new Promise(r => setTimeout(r, 400));
    return true;
  })()`);
  const clip = clipboard.readText();
  check('「复制诊断信息」按钮把诊断写进系统剪贴板', clip.includes('FloatDesk 诊断信息') && clip.length > 80, clip.slice(0, 60));
  await shot('settings-copydiag.png', '关于 → 复制诊断信息（一键复制）');

  check('设置页无严重控制台错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(failed === 0 ? '[OK] 全部检查通过' : '[FAIL] ' + failed + ' 项未通过');
  app.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('[FATAL] ' + (e && e.stack ? e.stack : e));
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
