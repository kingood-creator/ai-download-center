// 便签「多组彩色标签 + 更多历史 + 预览后恢复 + 划线」真机自检（开发用，不打包进应用）
//
// 真窗口 + 真渲染进程 + 真 NoteStore 落盘，走完整 IPC，跟 scripts/note-real-check.js 是同一套做法。
// 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --no-sandbox --disable-gpu scripts/note-pages-check.js
const { app, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const USER_DATA = '/tmp/fd-note-pages';
const OUT = '/tmp/fd-notepages';

fs.rmSync(USER_DATA, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', USER_DATA);

const { NoteWindow } = require(path.join(DIST, 'main', 'NoteWindow.js'));
const NoteStore = require(path.join(DIST, 'main', 'NoteStore.js'));
const sharedNote = require(path.join(DIST, 'shared', 'note.js'));

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else {
    failed++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readNotes = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(USER_DATA, 'note', 'notes.json'), 'utf-8'));
  } catch {
    return null;
  }
};
const readHist = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(USER_DATA, 'note', 'note_history.json'), 'utf-8'));
  } catch {
    return null;
  }
};

app.whenReady().then(async () => {
  // ---- 和 main.ts 一样的接线（含新的 note:page） ----
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
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.log('  [page-error] ' + msg);
  });

  // ---------- 1. 初始状态：一组标签 + ＋ ----------
  const init = await win.webContents.executeJavaScript(
    `(() => ({
       tabs: document.querySelectorAll('#tabs .tab').length,
       add: !!document.getElementById('tab-add'),
       del: document.querySelectorAll('#tabs .tab-x').length,
       title: document.getElementById('note-title').textContent,
       color: getComputedStyle(document.querySelector('#tabs .tab')).getPropertyValue('--tc').trim(),
       strike: !!document.getElementById('tb-strike'),
     }))()`,
    true
  );
  check('便签打开时只有一组标签，有 ＋ 号、没有删除 ×', init.tabs === 1 && init.add && init.del === 0, init);
  check('第一组标签叫「便签 1」并带自己的颜色', init.title === '便签' && init.color === sharedNote.NOTE_TAB_COLORS[0], init);
  check('工具栏里有划线按钮', init.strike === true, init);

  // ---------- 2. 划线：选中「内容」变成带删除线的 <strike> ----------
  const strike = await win.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       const ed = document.getElementById('editor');
       ed.focus();
       ed.innerHTML = '<div>第一组的内容</div>';
       ed.dispatchEvent(new Event('input'));
       await sleep(200);
       // 选中「内容」两个字
       const textNode = ed.querySelector('div').firstChild;
       const r = document.createRange();
       r.setStart(textNode, 4);
       r.setEnd(textNode, 6);
       const s = window.getSelection();
       s.removeAllRanges(); s.addRange(r);
       document.getElementById('tb-strike').click();
       await sleep(600);
       const el = ed.querySelector('strike, s, del');
       return {
         found: !!el,
         text: el ? el.textContent : '',
         deco: el ? getComputedStyle(el).textDecorationLine : '',
         html: ed.innerHTML,
       };
     })()`,
    true
  );
  check('划线按钮把选中文字变成删除线标签', strike.found === true && strike.text === '内容', JSON.stringify(strike));
  check('删除线真的画出来了（getComputedStyle 含 line-through）', /line-through/.test(strike.deco), strike.deco);

  // ---------- 3. 点 ＋ 加一组：自动配色、自动切过去、正文是空的 ----------
  const added = await win.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       document.getElementById('tab-add').click();
       await sleep(500);
       const tabs = [...document.querySelectorAll('#tabs .tab')];
       return {
         count: tabs.length,
         colors: tabs.map(t => getComputedStyle(t).getPropertyValue('--tc').trim()),
         on: tabs.findIndex(t => t.classList.contains('on')),
         title: document.getElementById('note-title').textContent,
         editor: document.getElementById('editor').innerHTML,
         del: document.querySelectorAll('#tabs .tab-x').length,
         names: tabs.map(t => t.textContent.replace('×', '').trim()),
       };
     })()`,
    true
  );
  check('点 ＋ 多出一组标签，并且自动切到新组', added.count === 2 && added.on === 1, JSON.stringify(added));
  check('新组是空白的（上一组的正文没串过来）', String(added.editor || '').trim() === '', JSON.stringify(added));
  check('两组标签颜色不同（一眼能分清）', added.colors[0] !== added.colors[1], JSON.stringify(added.colors));
  check('多组之后每组都有删除 ×', added.del === 2, String(added.del));
  check('新组自动命名「便签 2」，头部显示组数', added.names[1] === '便签 2' && /2 组/.test(added.title), JSON.stringify(added.names) + ' / ' + added.title);

  // ---------- 4. 第二组写字 → 两组内容互不干扰 ----------
  const twoPages = await win.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       const ed = document.getElementById('editor');
       ed.focus();
       ed.innerHTML = '<div>第二组的事情</div>';
       ed.dispatchEvent(new Event('input'));
       await sleep(700);
       const tabs = [...document.querySelectorAll('#tabs .tab')];
       // 切回第一组
       tabs[0].click();
       await sleep(500);
       const first = document.getElementById('editor').innerHTML;
       // 再切回第二组
       [...document.querySelectorAll('#tabs .tab')][1].click();
       await sleep(500);
       const second = document.getElementById('editor').innerHTML;
       return { first, second };
     })()`,
    true
  );
  check('切回第一组看到的是第一组的正文', /第一组/.test(twoPages.first) && !/第二组/.test(twoPages.first), twoPages.first);
  check('切回第二组看到的是第二组的正文', /第二组/.test(twoPages.second) && !/第一组/.test(twoPages.second), twoPages.second);

  const onDisk2 = readNotes();
  check(
    '两组正文都落到 notes.json（各存各的）',
    onDisk2 && onDisk2.pages.length === 2 && /第一组/.test(onDisk2.pages[0].html) && /第二组/.test(onDisk2.pages[1].html),
    onDisk2 ? JSON.stringify(onDisk2.pages.map((p) => p.html)) : 'notes.json 不存在'
  );

  // ---------- 5. 双击标签改名 ----------
  const renamed = await win.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       const tab = [...document.querySelectorAll('#tabs .tab')][1];
       const name = tab.querySelector('.tab-name');
       name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
       await sleep(200);
       const inp = tab.querySelector('.tab-rename');
       if (!inp) return { error: '没有出现改名输入框' };
       inp.value = '待办清单';
       inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
       await sleep(500);
       return {
         names: [...document.querySelectorAll('#tabs .tab-name')].map(n => n.textContent),
         title: document.getElementById('note-title').textContent,
       };
     })()`,
    true
  );
  check('双击标签能改名成「待办清单」', renamed.names && renamed.names[1] === '待办清单', JSON.stringify(renamed));
  const onDiskRename = readNotes();
  check(
    '改名也落盘了',
    onDiskRename && onDiskRename.pages[1].title === '待办清单',
    onDiskRename ? onDiskRename.pages[1].title : 'x'
  );

  // ---------- 6. 更多历史版本：连写 12 版 ----------
  const page2 = readNotes().pages[1].id;
  for (let i = 1; i <= 12; i++) {
    await win.webContents.executeJavaScript(
      `(async () => {
         const sleep = (ms) => new Promise(r => setTimeout(r, ms));
         const ed = document.getElementById('editor');
         ed.focus();
         ed.innerHTML = '<div>第 ${i} 版内容</div>';
         ed.dispatchEvent(new Event('input'));
         await sleep(520);
       })()`,
      true
    );
    noteWin.flush(true); // 立刻记一版（等价于空闲 5 秒 / 收起便签）
  }
  const histDisk = NoteStore.pageHistory(page2);
  check('每组标签各自记历史：这一组存了 12 版', histDisk.length === 12, '实际 ' + histDisk.length);
  check('上限不再是 3 版（能往回翻很多版）', histDisk.length > 3 && sharedNote.NOTE_HISTORY_MAX === 30, 'MAX=' + sharedNote.NOTE_HISTORY_MAX);
  check('最新一版在最前面', /第 12 版/.test(histDisk[0].html), histDisk[0] && histDisk[0].html);

  // ---------- 7. 历史面板：点某一版先预览，正文不变；再点恢复 ----------
  const histList = await win.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       document.getElementById('btn-hist').click();
       await sleep(600);
       return {
         count: document.querySelectorAll('#hist-list .item').length,
         sub: document.getElementById('hist-sub').textContent,
         first: (document.querySelector('#hist-list .item .meta') || {}).textContent || '',
       };
     })()`,
    true
  );
  await sleep(250);
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'hist-list.png'), img.toPNG()));

  const histUI = await win.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       const items = [...document.querySelectorAll('#hist-list .item')];
       const before = document.getElementById('editor').innerHTML;
       if (!items.length) return { error: '历史列表是空的' };
       // 点倒数第 4 条（更早的一版）
       items[items.length - 4].click();
       await sleep(400);
       return {
         prevShown: document.getElementById('hprev').classList.contains('show'),
         prevBody: document.getElementById('hprev-body').innerHTML,
         before,
         afterPreview: document.getElementById('editor').innerHTML,
         prevTitle: document.getElementById('hprev-title').textContent,
         marked: document.querySelectorAll('#hist-list .item.on').length,
       };
     })()`,
    true
  );
  check('历史面板列出 12 版', histList.count === 12, JSON.stringify(histList.count));
  check('面板标题写清是哪组、共几版', /待办清单/.test(histList.sub || '') && /12 版/.test(histList.sub || ''), histList.sub);
  check('列表每条都带版本号/时间/字数', /版本 12/.test(histList.first || ''), histList.first);
  check('点某一版先弹出预览层（不是直接恢复）', histUI.prevShown === true, JSON.stringify(histUI));
  check('预览里是那一版渲染后的内容', /版内容/.test(histUI.prevBody || ''), (histUI.prevBody || '').slice(0, 120));
  check('预览时正文一个字都没动', histUI.afterPreview === histUI.before, JSON.stringify({ b: histUI.before, a: histUI.afterPreview }));
  check('预览标题带版本号与时间', /版本 \d+/.test(histUI.prevTitle || ''), histUI.prevTitle);
  check('预览时列表里那一版被标成选中态', histUI.marked === 1, String(histUI.marked));
  await sleep(300);
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'hist-preview.png'), img.toPNG()));

  const restored = await win.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       const want = document.getElementById('hprev-body').textContent.trim();
       document.getElementById('hprev-do').click();
       await sleep(700);
       return {
         want,
         editor: document.getElementById('editor').textContent.trim(),
         closed: !document.getElementById('hist').classList.contains('show'),
       };
     })()`,
    true
  );
  check('点「恢复这一版」后正文变成预览的那一版', restored.editor === restored.want && /版内容/.test(restored.editor), JSON.stringify(restored));
  check('恢复完自动收起历史面板', restored.closed === true, JSON.stringify(restored.closed));
  const afterRestore = NoteStore.pageHistory(page2);
  // 恢复前那一版的正文本来就已经是最新的一版了（不会重复记），
  // 所以这里验的是「最新一版仍是恢复前的内容」—— 想反悔随时能点回去。
  check(
    '恢复前的正文留在历史最上面（恢复错了还能点回去）',
    afterRestore.length === 12 && /第 12 版/.test(afterRestore[0].html),
    'len=' + afterRestore.length + ' top=' + (afterRestore[0] && afterRestore[0].html)
  );

  // ---------- 8. 删除一组标签（含它的历史） ----------
  const removed = await win.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       window.confirm = () => true; // 自检里不想弹原生确认框
       // 点「当前这一组」上的 ×
       const x = document.querySelector('#tabs .tab.on .tab-x');
       x.click();
       await sleep(600);
       return {
         count: document.querySelectorAll('#tabs .tab').length,
         name: document.querySelector('#tabs .tab .tab-name').textContent,
         title: document.getElementById('note-title').textContent,
         editor: document.getElementById('editor').textContent,
       };
     })()`,
    true
  );
  check('点 × 删掉当前这组，只剩一组', removed.count === 1, JSON.stringify(removed));
  check('删完自动切到剩下的那组，正文跟着换', removed.name === '便签 1' && /第一组/.test(removed.editor), JSON.stringify(removed));  const histAfterDel = readHist();
  check(
    '被删那组的历史也一起清掉了',
    histAfterDel && !JSON.stringify(histAfterDel).includes(page2),
    histAfterDel ? Object.keys(histAfterDel.pages || {}).join(',') : '无历史文件'
  );

  // ---------- 9. 重开窗口：标签与正文都还在 ----------
  noteWin.flush(true);
  noteWin.close();
  await sleep(400);
  const win2 = noteWin.open();
  await new Promise((r) => (win2.webContents.isLoading() ? win2.webContents.once('did-finish-load', r) : r()));
  await sleep(700);
  const reloaded = await win2.webContents.executeJavaScript(
    `(() => ({
       tabs: document.querySelectorAll('#tabs .tab').length,
       names: [...document.querySelectorAll('#tabs .tab-name')].map(n => n.textContent),
       html: document.getElementById('editor').innerHTML,
       strikeCss: !!document.querySelector('#tabs .tab'),
     }))()`,
    true
  );
  check('重开便签：组数和名字都还在', reloaded.tabs === 1 && reloaded.names[0] === '便签 1', JSON.stringify(reloaded.names));
  check('重开便签：正文和划线格式都还在', /第一组/.test(reloaded.html) && /<(strike|s|del)/.test(reloaded.html), reloaded.html.slice(0, 140));
  await sleep(300);
  await win2.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'note-tabs.png'), img.toPNG()));

  // ---------- 10. 组多了也不难用：标签横向滚，＋ 号固定在可视区 ----------
  const many = await win2.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       for (let i = 0; i < 7; i++) { await window.FDNote.add(); await sleep(150); }
       const tabs = [...document.querySelectorAll('#tabs .tab')];
       const addBtn = document.getElementById('tab-add');
       const wrap = document.querySelector('.tabs').getBoundingClientRect();
       const r = addBtn.getBoundingClientRect();
       return {
         count: tabs.length,
         names: tabs.map(t => t.querySelector('.tab-name').textContent),
         colors: tabs.map(t => getComputedStyle(t).getPropertyValue('--tc').trim()),
         addVisible: r.width > 0 && r.right <= wrap.right + 1,
         addDisabled: addBtn.disabled,
         activeVisible: (() => {
           const a = document.querySelector('#tabs .tab.on');
           if (!a) return false;
           const ar = a.getBoundingClientRect();
           return ar.left >= wrap.left - 1 && ar.right <= wrap.right + 1;
         })(),
       };
     })()`,
    true
  );
  check('连加 7 组后共有 8 组标签', many.count === 8, JSON.stringify(many.count));
  check('8 组标签颜色各不相同', new Set(many.colors).size === 8, JSON.stringify(many.colors));
  check('组多了 ＋ 号仍固定在可视区里（不会被挤出去）', many.addVisible === true && many.addDisabled === false, JSON.stringify(many));
  check('当前这组自动滚进可视区', many.activeVisible === true, JSON.stringify(many));
  await sleep(400);
  await win2.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'note-tabs-many.png'), img.toPNG()));

  // 上限：加到 20 组后 ＋ 变灰
  const capped = await win2.webContents.executeJavaScript(
    `(async () => {
       const sleep = (ms) => new Promise(r => setTimeout(r, ms));
       for (let i = 0; i < 14; i++) { await window.FDNote.add(); await sleep(120); }
       const addBtn = document.getElementById('tab-add');
       const before = document.querySelectorAll('#tabs .tab').length;
       addBtn.click();                 // 已经满了，点了也不该再加
       await sleep(300);
       return { before, after: document.querySelectorAll('#tabs .tab').length, disabled: addBtn.disabled };
     })()`,
    true
  );
  check(`加到上限 ${sharedNote.NOTE_PAGES_MAX} 组后不再增加，＋ 变灰`, capped.after === sharedNote.NOTE_PAGES_MAX && capped.disabled === true, JSON.stringify(capped));

  console.log(failed ? '\n[FAIL] ' + failed + ' 项未通过' : '\n[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('自检脚本异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});

app.on('window-all-closed', () => {
  // 自检脚本自己要 close + 重开窗口（验证落盘），这里不能跟着 app.quit()，
  // 否则重开那一步还没跑到进程就没了
});
