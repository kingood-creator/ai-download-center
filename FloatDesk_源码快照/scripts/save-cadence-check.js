// 「保存节奏」真链路自检（一次性脚本）：用**真的 ConfigStore**（真写盘 / 真备份）验证
//   1) 拖滑杆时只换主进程内存（预览），磁盘上的 config.json 一动不动
//   2) 停手 5 秒后自动落盘
//   3) 点「保存」立刻落盘
//   4) 保存后主进程广播 scene:changed，设置页不会重建 DOM（这是「拖滑杆被卡住」的真正原因）
// 和 ui-smoke 的区别：那边是打桩，这里走真 ConfigStore + 真磁盘文件，能证明「拖动时确实没写盘」。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const builtins = require(path.join(DIST, 'shared', 'builtins.js'));
const sounds = require(path.join(DIST, 'shared', 'sounds.js'));
const { ConfigStore } = require(path.join(DIST, 'main', 'ConfigStore.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else {
    failed++;
    console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  }
}

let win = null;
const store = new ConfigStore(); // 真的配置存储：落盘、备份都在这里
const configPath = path.join(app.getPath('userData'), 'config.json');
const backupDir = path.join(app.getPath('userData'), 'backups');

/** 直接读磁盘上的 config.json（不经过 store 的内存副本） */
function diskDot() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return Number(raw.scenes[0].dotSize);
  } catch {
    return -1;
  }
}
function backupCount() {
  try {
    return fs.readdirSync(backupDir).filter((f) => f.startsWith('config.')).length;
  } catch {
    return -1;
  }
}

// ---- 设置页需要的其它通道（本项目要验的是配置落盘，其它都给最简桩）----
ipcMain.handle('config:get', () => store.config);
ipcMain.handle('config:preview', (_e, cfg) => {
  const r = store.preview(cfg); // 真实现：只换内存，不写盘
  return r;
});
ipcMain.handle('config:save', (_e, cfg, opts) => {
  const before = store.config.currentSceneId;
  const r = store.save(cfg, opts);
  if (!r.ok) return r;
  // 和真主进程一样广播回去（设置页必须自己忽略这次广播，否则会重建 DOM 打断拖动）
  if (win && !win.isDestroyed()) win.webContents.send('scene:changed', store.config);
  return { ok: true, sameScene: before === store.config.currentSceneId };
});
ipcMain.handle('builtins:actions', () => builtins.BUILTIN_ACTIONS);
ipcMain.handle('library:presets', () => []);
ipcMain.handle('app:scan', () => []);
ipcMain.handle('app:resolve', () => ({ ok: false }));
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('note:presets', () => []);
ipcMain.handle('ime:snapshot', () => ({ ok: true, available: true, sources: [], currentId: '', currentName: '' }));
ipcMain.handle('sound:list', () => ({ presets: sounds.SOUND_PRESETS, groups: sounds.SOUND_GROUP_LABELS }));
ipcMain.handle('sound:get', () => ({ ok: false }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'cadence', log: '' }));
['settings:open', 'settings:close', 'diag:log', 'float:resize', 'note:open', 'note:close', 'preview:open'].forEach((c) =>
  ipcMain.on(c, () => {})
);

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    show: true,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await win.webContents.executeJavaScript(`(async () => {
    window.confirm = () => true;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !document.getElementById('a-dot')) await new Promise(r => setTimeout(r, 100));
    return true;
  })()`);
  await sleep(500);

  const startDot = store.config.scenes[0].dotSize;
  check('初始配置已落盘（真实 config.json 存在）', fs.existsSync(configPath) && diskDot() === startDot, {
    disk: diskDot(),
    mem: startDot,
  });

  // 1) 拖滑杆：内存/预览变了，磁盘不能变
  const backupsBefore = backupCount();
  const drag = await win.webContents.executeJavaScript(`(async () => {
    const inp = document.getElementById('a-dot');
    const ref = inp;
    inp.value = '88';
    inp.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 120));
    inp.value = '92';
    inp.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 260));
    return {
      sameNode: document.getElementById('a-dot') === ref,
      state: (document.getElementById('saveState') || {}).textContent || '',
      label: (document.getElementById('a-dot-v') || {}).textContent || '',
    };
  })()`);
  check('拖动中设置页不重建（同一个滑杆 DOM）', drag.sameNode === true && drag.label === '92px', drag);
  check('拖动中顶栏显示「改动待保存」', drag.state === '改动待保存', drag.state);
  check('拖动中内存里的配置已更新（预览生效）', store.config.scenes[0].dotSize === 92, store.config.scenes[0].dotSize);
  check('拖动中磁盘上的 config.json 一点没动', diskDot() === startDot, { disk: diskDot(), start: startDot });
  check('拖动中不产生备份文件（自动保存不写备份）', backupCount() === backupsBefore, {
    before: backupsBefore,
    after: backupCount(),
  });

  // 2) 停手 5 秒 → 自动落盘
  await sleep(6200);
  check('停手 5 秒后自动写进 config.json', diskDot() === 92, { disk: diskDot() });
  const autoState = await win.webContents.executeJavaScript(
    `(document.getElementById('saveState') || {}).textContent || ''`
  );
  check('自动保存后顶栏回到「已保存」', autoState === '已保存', autoState);

  // 3) 点「保存」：立刻落盘 + 留一份备份 + 广播回来但页面不重建
  const backupsBefore2 = backupCount();
  const manual = await win.webContents.executeJavaScript(`(async () => {
    const inp = document.getElementById('a-dot');
    const ref = inp;
    inp.value = '104';
    inp.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 100));
    document.getElementById('saveTop').click();
    await new Promise(r => setTimeout(r, 600));
    return {
      sameNode: document.getElementById('a-dot') === ref,
      state: (document.getElementById('saveState') || {}).textContent || '',
      diskLabel: (document.getElementById('a-dot-v') || {}).textContent || '',
    };
  })()`);
  check('点「保存」立刻写进 config.json（不用等 5 秒）', diskDot() === 104, { disk: diskDot() });
  check('手动保存会留一份备份', backupCount() === backupsBefore2 + 1, { before: backupsBefore2, after: backupCount() });
  check(
    '保存后主进程广播回来，但设置页没有重建（滑杆还是原来那个节点）',
    manual.sameNode === true && manual.diskLabel === '104px',
    manual
  );
  check('保存后状态是「已保存」', manual.state === '已保存', manual.state);

  // 4) 其它窗口触发的广播仍然要能让设置页刷新（别把自己的广播规则做成「聋子」）
  const other = await win.webContents.executeJavaScript(`(async () => {
    const before = document.getElementById('a-dot');
    window.__fdReloaded = false;
    return { hadRef: !!before };
  })()`);
  // 等过「自己刚保存」那 0.7 秒的窗口，否则测的是抑制逻辑而不是「别变聋」
  await sleep(900);
  const cfgFromMain = JSON.parse(JSON.stringify(store.config));
  cfgFromMain.scenes[0].dotSize = 66;
  win.webContents.send('scene:changed', cfgFromMain);
  await sleep(500);
  const afterOther = await win.webContents.executeJavaScript(`(() => ({
    val: (document.getElementById('a-dot') || {}).value,
    label: (document.getElementById('a-dot-v') || {}).textContent,
  }))()`);
  check('别的窗口改动配置时，设置页照样会跟着刷新（没被自己的广播规则挡住）', afterOther.val === '66', {
    ...afterOther,
    ...other,
  });

  check('全程没有未捕获的脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(failed === 0 ? '[OK] 全部检查通过' : '[FAIL] ' + failed + ' 项未通过');
  app.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('[FATAL] ' + (e && e.stack ? e.stack : e));
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
