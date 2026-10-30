// 便签真实链路自检（开发用，不打包进应用）
// 不达桩：用真实的 NoteWindow + 真实的 note 渲染进程 + 真实的 NoteStore 落盘，
// 走完整 IPC（renderer → preload → main → 磁盘），验证富文本内容能存下来、历史记的是 html/text。
// 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/note-real-check.js --no-sandbox
const { app, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const USER_DATA = '/tmp/fd-note-real';

// 用独立 userData，避免污染你真实的便签
fs.rmSync(USER_DATA, { recursive: true, force: true });
app.setPath('userData', USER_DATA);

const { NoteWindow } = require(path.join(DIST, 'main', 'NoteWindow.js'));
const NoteStore = require(path.join(DIST, 'main', 'NoteStore.js'));
const sharedNote = require(path.join(DIST, 'shared', 'note.js'));

const results = [];
const push = (name, ok, value) => results.push({ name, ok, value: value === undefined ? null : value });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  // ---- 和 main.ts 一样的接线 ----
  const noteCfg = { color: '#fff6c9', opacity: 1, fontSize: 14, x: 200, y: 200, width: 340, height: 320 };
  const noteWin = new NoteWindow({
    getNoteConfig: () => noteCfg,
    patchNoteConfig: (p) => Object.assign(noteCfg, p),
  });

  ipcMain.handle('note:load', () => {
    const c = noteWin.content();
    const book = noteWin.bookState();
    const act = sharedNote.noteBookActive(book);
    return {
      config: noteWin.config(),
      book,
      pagesMax: sharedNote.NOTE_PAGES_MAX,
      html: c.html,
      text: c.text,
      history: act ? NoteStore.pageHistory(act.id).length : 0,
    };
  });
  ipcMain.handle('note:save', (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (p.book) return { ok: true, book: noteWin.updateBook(p.book) };
    noteWin.updateText(String(p.html || ''), String(p.text || ''));
    return { ok: true, book: noteWin.bookState() };
  });
  ipcMain.handle('note:page', (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    let book = noteWin.updateBook(p.book);
    const op = String(p.op || '');
    const id = String(p.id || '');
    if (op === 'add') book = sharedNote.addNotePage(book);
    else if (op === 'remove') book = sharedNote.removeNotePage(book, id);
    else if (op === 'patch') book = sharedNote.patchNotePage(book, id, p.patch || {});
    else if (op === 'select') book = sharedNote.setActiveNotePage(book, id);
    else return { ok: false, error: '未知的标签操作：' + op, book };
    return { ok: true, book: noteWin.updateBook(book) };
  });
  ipcMain.handle('note:history', (_e, pageId) => {
    const b = noteWin.bookState();
    const act = sharedNote.noteBookActive(b);
    return NoteStore.pageHistory(pageId ? String(pageId) : act ? act.id : '');
  });
  ipcMain.handle('note:restore', (_e, pageId, index) => {
    const h = NoteStore.pageHistory(String(pageId || ''));
    const e0 = h[Number(index)];
    if (!e0) return { ok: false };
    const book = noteWin.restorePage(String(pageId || ''), e0.html, e0.text);
    return { ok: true, html: e0.html, text: e0.text, book };
  });
  ipcMain.handle('note:copy', (_e, t) => {
    clipboard.writeText(String(t == null ? '' : t));
    return { ok: true };
  });
  ipcMain.handle('note:configSave', (_e, p) => ({ ok: true, config: Object.assign({}, noteCfg, p || {}) }));
  ipcMain.handle('note:presets', () => sharedNote.NOTE_PRESET_COLORS);
  ipcMain.on('note:close', () => {});

  const win = noteWin.open();
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  await sleep(800);

  const loaded = await win.webContents.executeJavaScript(
    `(() => ({
       editable: document.getElementById('editor').getAttribute('contenteditable'),
       toolbar: document.querySelectorAll('.toolbar .tbtn').length,
       apiOk: !!(window.api && window.api.noteSave),
       size: [window.innerWidth, window.innerHeight],
     }))()`,
    true
  );
  push('便签窗口真的用富文本编辑器加载（工具栏齐全）', loaded.editable === 'true' && loaded.toolbar >= 7 && loaded.apiOk, loaded);

  // 在真实渲染进程里敲内容：加粗 + 列表 + 代码块
  const typed = await win.webContents.executeJavaScript(
    `(async () => {
       const ed = document.getElementById('editor');
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       ed.focus();
       ed.innerHTML = '<div>真机自检便签</div>';
       ed.dispatchEvent(new Event('input'));
       await sleep(600);
       // 加粗一段
       const d = document.createElement('div');
       d.textContent = '重点';
       ed.appendChild(d);
       const r = document.createRange();
       r.selectNodeContents(d);
       const s = window.getSelection();
       s.removeAllRanges();
       s.addRange(r);
       document.getElementById('tb-bold').click();
       await sleep(200);
       // 代码块
       const r2 = document.createRange();
       r2.selectNodeContents(ed);
       r2.collapse(false);
       s.removeAllRanges();
       s.addRange(r2);
       document.getElementById('tb-codeblock').click();
       await sleep(700);
       const btn = ed.querySelector('pre .code-copy');
       if (btn) btn.click();
       await sleep(200);
       ed.dispatchEvent(new Event('input'));
       await sleep(700);
       return {
         hasBold: !!ed.querySelector('b, strong'),
         hasPre: !!ed.querySelector('pre code'),
         copyDone: btn ? btn.classList.contains('done') : false,
         html: ed.innerHTML.slice(0, 120),
       };
     })()`,
    true
  );
  push('真实渲染进程里加粗 + 代码块 + 复制按钮可用', typed.hasBold && typed.hasPre && typed.copyDone === true, typed);

  // ---- 落盘：磁盘上必须是真的 HTML，不是 [object Object] ----
  const htmlOnDisk = NoteStore.loadNoteHtml();
  const textOnDisk = NoteStore.loadNoteText();
  push('note.html 落盘的是真 HTML（含 b / pre）', htmlOnDisk.includes('<b>') && htmlOnDisk.includes('<pre'), htmlOnDisk.slice(0, 100));
  push('note.html 不含注入的复制按钮', !htmlOnDisk.includes('code-copy'), htmlOnDisk.includes('code-copy'));
  push('note.txt 是纯文本镜像（不是 [object Object]）', textOnDisk.includes('真机自检便签') && !textOnDisk.includes('[object Object]'), textOnDisk.slice(0, 60));

  // ---- 历史 ----
  noteWin.flush(true);
  const hist = NoteStore.pageHistory('p1');
  push(
    '历史条目存的是 {time, html, text}',
    hist.length >= 1 && typeof hist[0].html === 'string' && typeof hist[0].text === 'string' && hist[0].html.length > 0,
    hist.slice(0, 1)
  );

  // ---- 重新打开一个窗口，验证渲染进程能从 note.html 把富文本读回来 ----
  const win2 = noteWin.open();
  await sleep(500);
  const reloaded = await win2.webContents.executeJavaScript(
    `(() => {
       const ed = document.getElementById('editor');
       return { html: ed.innerHTML.slice(0, 120), hasBold: !!ed.querySelector('b, strong'), hasPre: !!ed.querySelector('pre') };
     })()`,
    true
  );
  push('重开便签能把富文本内容读回来（含格式）', reloaded.hasBold && reloaded.hasPre, reloaded);

  const failed = results.filter((r) => !r.ok);
  console.log('NOTE_REAL_RESULT_BEGIN');
  console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
  console.log('NOTE_REAL_RESULT_END');
  app.exit(failed.length ? 1 : 0);
});
