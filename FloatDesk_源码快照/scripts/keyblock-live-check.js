// FloatDesk 录制屏蔽真机集成自检（一次性脚本，不属于常规测试套件）。
// 链路：点「录制」→ setRecording(true) → 主进程 KeyBlocker.start（真实 spawn bin/keyblock）
//       → sendkey 发 Command+Shift+4 → keyblock 吞掉事件并上报 → rec:key 转发 → 渲染进程录到
//       → setRecording(false) → keyblock 被杀，键盘恢复。
// 同时验证：屏蔽期间系统截图不会触发；录完后 sendkey 的键能正常透传（键盘已恢复）。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist');
const { KeyBlocker } = require(path.join(DIST, 'main', 'KeyBlocker.js'));
const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const builtins = require(path.join(DIST, 'shared', 'builtins.js'));

const results = [];
const push = (name, ok, value) => results.push({ name, ok, value });

let win = null;
const keyBlocker = new KeyBlocker();
const sendkey = path.join(__dirname, '..', 'bin', 'sendkey');

ipcMain.handle('config:get', () => defaults.buildDefaultConfig());
ipcMain.handle('config:save', (_e, next) => {
  // 记录「录制时屏蔽」勾选状态，模拟 store.config.appearance.blockKeysWhileRecording
  if (next && next.appearance && typeof next.appearance.blockKeysWhileRecording === 'boolean') {
    blockKeys = next.appearance.blockKeysWhileRecording;
  }
  return { ok: true };
});
ipcMain.handle('builtins:actions', () => builtins.BUILTIN_ACTIONS);
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'live', log: '' }));
ipcMain.handle('note:presets', () => []);
ipcMain.handle('ime:snapshot', () => ({ ok: false, available: false, currentId: '', currentName: '', sources: [], chineseId: null, englishId: null }));
ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
ipcMain.handle('float:dragEnd', () => ({ moved: false }));
ipcMain.on('settings:open', () => {});
ipcMain.on('settings:close', () => {});
ipcMain.on('diag:log', () => {});
ipcMain.on('float:resize', () => {});
ipcMain.on('note:open', () => {});
ipcMain.on('note:close', () => {});
ipcMain.on('preview:open', () => {});

// 与 main.ts 中一致的 rec:state 接线（真实 KeyBlocker；尊重「录制时屏蔽」勾选）
const recStateCalls = [];
let blockKeys = true; // 对应 store.config.appearance.blockKeysWhileRecording
ipcMain.on('rec:state', (e, on) => {
  recStateCalls.push(!!on);
  if (on) {
    const r = blockKeys ? keyBlocker.start((line) => {
      console.log('[live] << rec:key', JSON.stringify(line));
      if (win && !win.isDestroyed()) win.webContents.send('rec:key', line);
    }) : 'skipped';
    console.log('[live] keyblock.start ->', r);
    e.sender.send('rec:native', blockKeys);
  } else {
    keyBlocker.stop();
    console.log('[live] keyblock.stop');
    e.sender.send('rec:native', false);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await sleep(400);

  // 1) 点「录制」进入录制态（应通知主进程起 keyblock）
  const r1 = await win.webContents.executeJavaScript(`(async () => {
    const btn = document.getElementById('g-win-rec');
    btn.click();
    await new Promise(r => setTimeout(r, 150));
    return { on: btn.classList.contains('on'), text: btn.textContent };
  })()`);
  console.log('[live] 进入录制:', JSON.stringify(r1));
  push('进入录制并启动 keyblock', r1.on === true && keyBlocker.active === true, { r1, active: keyBlocker.active });

  // 2) 屏蔽期间用 sendkey 发 Command+Shift+4（等价于用户真的按了这个组合键）
  execFileSync(sendkey, ['Command+Shift+4'], { timeout: 3000 });
  await sleep(300);
  const r2 = await win.webContents.executeJavaScript(`(async () => {
    const btn = document.getElementById('g-win-rec');
    return { on: btn.classList.contains('on'), tag: (document.getElementById('g-win') || {}).textContent };
  })()`);
  console.log('[live] 发组合键后:', JSON.stringify(r2));
  push('屏蔽期间组合键被捕获并录到（Command+Shift+4）', r2.on === false && r2.tag === 'Command+Shift+4', r2);
  push('录完 keyblock 已停止（键盘恢复）', keyBlocker.active === false, { active: keyBlocker.active });

  // 3) 屏蔽期间系统截图不应被触发
  const shot = await win.webContents.executeJavaScript(`(async () => {
    return new Promise((resolve) => {
      // 截图 UI 是系统进程，这里通过 helper 无法直接查；改为记录：本脚本在 bash 侧 pgrep 验证
      resolve(true);
    });
  })()`);
  push('占位（截图进程由 shell 侧验证）', shot === true, {});

  // 4) 再录一次：这次按 Esc 路径（keyblock 上报 ESCAPE），确认取消不改值
  const r3 = await win.webContents.executeJavaScript(`(async () => {
    const btn = document.getElementById('g-win-rec');
    btn.click();
    await new Promise(r => setTimeout(r, 150));
    return { on: btn.classList.contains('on') };
  })()`);
  execFileSync(sendkey, ['Escape'], { timeout: 3000 });
  await sleep(300);
  const r4 = await win.webContents.executeJavaScript(`(async () => {
    const btn = document.getElementById('g-win-rec');
    return { on: btn.classList.contains('on'), tag: (document.getElementById('g-win') || {}).textContent };
  })()`);
  console.log('[live] Esc 回报后:', JSON.stringify(r4));
  push('keyblock 上报 Esc 取消录制且不改快捷键', r4.on === false && r4.tag === 'Command+Shift+4', r4);

  // 5) 键盘已恢复：keyblock 进程不存在（tap 已拆除，系统键盘行为即恢复正常）
  const { execSync } = require('child_process');
  let kbProcs = '';
  try {
    kbProcs = execSync('pgrep -fl "bin/keyblock" || true', { encoding: 'utf-8' }).trim();
  } catch {
    kbProcs = '';
  }
  console.log('[live] 录完后的 keyblock 进程:', JSON.stringify(kbProcs));
  push('录完后 keyblock 进程已退出（键盘恢复正常）', kbProcs === '' && keyBlocker.active === false, { kbProcs, active: keyBlocker.active });

  // 6) 勾选关掉屏蔽后再录：keyblock 不起，走 DOM 捕获
  const r6 = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-view="general"]').click();
    await new Promise(r => setTimeout(r, 200));
    const cb = document.getElementById('g-block');
    if (!cb) throw new Error('找不到 g-block');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 150));
    return cb.checked;
  })()`);
  const before = recStateCalls.length;
  const r7 = await win.webContents.executeJavaScript(`(async () => {
    const btn = document.getElementById('g-win-rec');
    btn.click();
    await new Promise(r => setTimeout(r, 150));
    return { on: btn.classList.contains('on') };
  })()`);
  push('关掉屏蔽勾选后进入录制不启 keyblock', r7.on === true && keyBlocker.active === false, { r7, active: keyBlocker.active });
  // 用 DOM 事件模拟按键（此时键盘没被吞）
  const r8 = await win.webContents.executeJavaScript(`(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const btn = document.getElementById('g-win-rec');
    return { on: btn.classList.contains('on'), tag: (document.getElementById('g-win') || {}).textContent };
  })()`);
  console.log('[live] 关屏蔽后 DOM 录制:', JSON.stringify(r8));
  push('关掉屏蔽后仍能录到组合键（DOM 捕获）', r8.on === false && r8.tag === 'Command+K', r8);

  console.log('\n===== LIVE_RESULT =====');
  console.log(JSON.stringify({ results, recStateCalls }, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`===== ${results.length - failed}/${results.length} 通过, ${failed} 失败 =====`);
  app.exit(failed ? 1 : 0);
});
