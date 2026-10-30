// 场景管理「场景库」UI 截图自检：左右分屏（左=场景库·未启用 / 右=已启用）、
// 行内只有「编辑 / 项目 / ＋|－」（不放开关、不放删除×）、点行编辑，
// 以及 MacBook 屏（1180×800）下的排版不挤不换行。
// 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --no-sandbox --disable-gpu scripts/scenes-shot.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const builtins = require(path.join(DIST, 'shared', 'builtins.js'));

const OUT = '/tmp/fd-shot';
fs.mkdirSync(OUT, { recursive: true });

// 桩：配置读写（保存的内容记下来，验证「启用/停用」真的写进了配置）
let saved = null;
ipcMain.handle('config:get', () => defaults.buildDefaultConfig());
ipcMain.handle('config:save', (_e, cfg) => { saved = cfg; return { ok: true }; });
ipcMain.handle('config:preview', () => ({ ok: true }));
ipcMain.handle('builtins:actions', () => builtins.BUILTIN_ACTIONS);
ipcMain.handle('library:presets', () => []);
ipcMain.handle('app:scan', () => []);
ipcMain.handle('app:resolve', () => ({ ok: false }));
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'shot', log: '' }));
ipcMain.handle('note:presets', () => []);
// 音效清单（设置页要下拉 optgroup；不注册会在日志里刷 No handler）
const sounds = require(path.join(DIST, 'shared', 'sounds.js'));
ipcMain.handle('sound:list', () => ({
  presets: sounds.SOUND_PRESETS, groups: sounds.SOUND_GROUP_LABELS,
  defaults: sounds.DEFAULT_SOUND_CONFIG, none: sounds.SOUND_NONE,
}));
ipcMain.handle('sound:get', () => ({ ok: false, error: '截图脚本不放音效' }));
ipcMain.handle('ime:snapshot', () => ({ ok: true, available: true, sources: [], currentId: '', currentName: '' }));
ipcMain.handle('web:probe', (_e, u) => ({ url: String(u || ''), title: '示例站点', siteName: '示例', iconPath: '' }));
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
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const WAIT_HELPER = `
  const waitFor = async (fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 8000)) {
      let v = false;
      try { v = fn(); } catch (e) { v = false; }
      if (v) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  };`;

const COLS = `(() => {
  const cols = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col')];
  return {
    n: cols.length,
    titles: cols.map(c => ((c.querySelector('.lib-col-title') || {}).textContent || '').replace(/\\s+/g, ' ').trim()),
    left: cols[0] ? cols[0].querySelectorAll('.scene-row').length : -1,
    right: cols[1] ? cols[1].querySelectorAll('.scene-row').length : -1,
  };
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 800, show: true,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('  [page-error] ' + message);
  });
  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    await waitFor(() => document.querySelector('[data-view="scenes"]'), 15000);
    return true;
  })()`);
  await win.webContents.executeJavaScript(`window.confirm = () => true; true`);

  // 1) 打开场景管理
  await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    document.querySelector('[data-view="scenes"]').click();
    await waitFor(() => document.querySelectorAll('#view-scenes .scene-split > .lib-col').length === 2, 15000);
    return true;
  })()`);
  await sleep(300);

  const split = await win.webContents.executeJavaScript(COLS);
  check('场景管理是左右两栏', split.n === 2, JSON.stringify(split));
  check('左栏是「场景库 · 未启用」', (split.titles[0] || '').includes('场景库') && (split.titles[0] || '').includes('未启用'), JSON.stringify(split.titles));
  check('右栏是「已启用」', (split.titles[1] || '').includes('已启用'), JSON.stringify(split.titles));
  check('默认 4 个场景全在右栏、左栏为空', split.right === 4 && split.left === 0, JSON.stringify(split));

  // 2) 行内按钮：右栏只有「编辑 / 项目 / －」，左栏（停用后）只有「编辑 / 项目 / ＋」
  //    明确约定：行内不放启用开关、不放删除×、不放外观，一行就三个按钮
  const acts = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('#view-scenes .scene-split > .lib-col:last-child .scene-row');
    if (!row) return { acts: [], switches: -1, btns: [] };
    return {
      acts: [...row.querySelectorAll('[data-act]')].map(b => b.dataset.act),
      switches: row.querySelectorAll('input[type="checkbox"], .switch').length,
      btns: [...row.querySelectorAll('.ops button')].map(b => b.textContent.trim()),
    };
  })()`);
  check('已启用行内正好三个按钮：编辑 / 项目 / －',
    acts.acts.length === 3 && acts.acts[0] === 'edit' && acts.acts[1] === 'items' && acts.acts[2] === 'disable',
    JSON.stringify(acts));
  check('已启用行内没有启用开关（不要滑块）', acts.switches === 0 && !acts.acts.includes('toggle'), JSON.stringify(acts));
  check('行内没有「×」删除，也没有「外观」按钮', !acts.acts.includes('del') && !acts.acts.includes('appearance'), JSON.stringify(acts));
  check('第三个按钮画的是减号「－」', acts.btns[2] === '－', JSON.stringify(acts.btns));

  // 3) MacBook 排版：一行放得下（不换行、不溢出）
  const layout = await win.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('#view-scenes .scene-row')];
    const col = document.querySelector('#view-scenes .scene-split > .lib-col');
    const r = rows[0];
    const ops = r ? r.querySelector('.ops') : null;
    return {
      rows: rows.length,
      rowH: r ? Math.round(r.getBoundingClientRect().height) : -1,
      colW: col ? Math.round(col.getBoundingClientRect().width) : -1,
      rowW: r ? Math.round(r.getBoundingClientRect().width) : -1,
      opsWrapped: ops ? ops.scrollHeight > ops.clientHeight + 2 : true,
      opsW: ops ? Math.round(ops.scrollWidth) : -1,
      nameW: r ? Math.round((r.querySelector('.nm') || {}).getBoundingClientRect?.().width || 0) : -1,
      subClipped: r ? ((r.querySelector('.tp') || {}).scrollWidth || 0) > ((r.querySelector('.tp') || {}).clientWidth || 0) : true,
    };
  })()`);
  check('一行一个场景（操作按钮没有换行撑高）', layout.rowH > 0 && layout.rowH <= 64, JSON.stringify(layout));
  check('操作区不溢出所在列', layout.opsW > 0 && layout.opsW <= layout.colW, JSON.stringify(layout));
  check('场景名有足够宽度（没被挤成 0）', layout.nameW >= 60, JSON.stringify(layout));
  // 截图前等一下重绘：capturePage 抓得太快会拿到上一帧（两张图就会一模一样）
  await sleep(600);
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'scenes-split.png'), img.toPNG()));

  // 4) 点「－」停用第 2 个场景：只改标记，配置里场景数与项目数都不能少
  const before = await win.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col:last-child .scene-row')];
    return { id: rows[1].dataset.scId, name: rows[1].querySelector('.nm').textContent.trim() };
  })()`);
  const dis = await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    const rows = [...document.querySelectorAll('#view-scenes .scene-split > .lib-col:last-child .scene-row')];
    const minus = rows[1].querySelector('[data-act="disable"]');
    if (!minus) return { ok: false, error: '右栏没有减号按钮' };
    minus.click();
    await waitFor(() => document.querySelectorAll('#view-scenes .scene-split > .lib-col:first-child .scene-row').length === 1, 5000);
    return { ok: true };
  })()`);
  const after = await win.webContents.executeJavaScript(COLS);
  check('点「－」停用后场景从右栏移到左栏「场景库」', dis.ok && after.left === 1 && after.right === 3, JSON.stringify({ dis, after }));
  const st = saved ? saved.scenes.find((s) => s.id === before.id) : null;
  check('停用只改 enabled 标记，场景没被删', !!st && st.enabled === false && saved.scenes.length === 4, JSON.stringify({ n: saved ? saved.scenes.length : -1, enabled: st ? st.enabled : null }));
  check('停用场景的项目一个都没丢', !!st && st.items.length > 0, st ? JSON.stringify({ n: st.items.length }) : 'no save');
  const leftOps = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('#view-scenes .scene-split > .lib-col:first-child .scene-row');
    if (!row) return null;
    return {
      acts: [...row.querySelectorAll('[data-act]')].map(b => b.dataset.act),
      switches: row.querySelectorAll('input[type="checkbox"], .switch').length,
      btns: [...row.querySelectorAll('.ops button')].map(b => b.textContent.trim()),
    };
  })()`);
  check('左栏未启用行内正好三个按钮：编辑 / 项目 / ＋',
    !!leftOps && leftOps.acts.length === 3 &&
      leftOps.acts[0] === 'edit' && leftOps.acts[1] === 'items' && leftOps.acts[2] === 'enable',
    JSON.stringify(leftOps));
  check('左栏行内没有启用开关（打开开关就启用的那套已经去掉）', !!leftOps && leftOps.switches === 0 && !leftOps.acts.includes('toggle'), JSON.stringify(leftOps));
  check('左栏行也没有删除×、没有外观', !!leftOps && !leftOps.acts.includes('del') && !leftOps.acts.includes('appearance'), JSON.stringify(leftOps));
  check('左栏第三个按钮画的是加号「＋」', !!leftOps && leftOps.btns[2] === '＋', JSON.stringify(leftOps && leftOps.btns));
  await sleep(600);
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'scenes-library.png'), img.toPNG()));

  // 5) 点 ＋ 重新启用 → 回到右栏
  await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    document.querySelector('#view-scenes .scene-split > .lib-col:first-child [data-act="enable"]').click();
    await waitFor(() => document.querySelectorAll('#view-scenes .scene-split > .lib-col:first-child .scene-row').length === 0, 5000);
    return true;
  })()`);
  const back = await win.webContents.executeJavaScript(COLS);
  const backSt = saved ? saved.scenes.find((s) => s.id === before.id) : null;
  check('点 ＋ 重新启用：场景回到右栏', back.left === 0 && back.right === 4, JSON.stringify(back));
  check('重新启用后项目还是原来那批', !!backSt && backSt.items.length > 0 && backSt.enabled !== false, backSt ? JSON.stringify({ n: backSt.items.length }) : 'no save');

  // 6) 点行内空白处 = 编辑，删除/复制收在弹窗里（弹窗里也没有启用开关）
  const modal = await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    const row = document.querySelector('#view-scenes .scene-split > .lib-col:last-child .scene-row');
    (row.querySelector('.nm') || row).click();
    await waitFor(() => !!document.querySelector('#sm-name'), 5000);
    const opened = !!document.querySelector('#sm-name');
    const hasSw = !!document.querySelector('#sm-enabled');
    const hasDup = !!document.querySelector('#sm-dup');
    const hasDel = !!document.querySelector('#sm-del');
    if (document.querySelector('#sm-cancel')) document.querySelector('#sm-cancel').click();
    return { opened, hasSw, hasDup, hasDel, closed: !document.querySelector('#sm-name') };
  })()`);
  check('点场景行空白处打开编辑弹窗', modal.opened === true && modal.closed === true, JSON.stringify(modal));
  check('编辑弹窗里不再有「启用这个场景」开关', modal.hasSw === false, JSON.stringify(modal));
  check('彻底删除收进编辑弹窗（「删除场景」按钮）', modal.hasDel === true && modal.hasDup === true, JSON.stringify(modal));

  console.log(failed ? '\n[FAIL] ' + failed + ' 项未通过' : '\n[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('自检脚本异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
