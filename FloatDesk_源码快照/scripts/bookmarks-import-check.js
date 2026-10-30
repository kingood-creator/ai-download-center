// 浏览器书签批量导入自检（开发用，不打包）。
//
// 覆盖：解析（真实 HTML 文件）→ 弹窗里的树/全选/检索/已存在去重 → 导进项目库 → 重复导入不产生重复
//        → 切成「直接加进场景」也能落进场景。
// 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --no-sandbox --disable-gpu scripts/bookmarks-import-check.js
//
// 说明：这里用「等价的 IPC 桩」跑真实渲染页（跟 scripts/scenes-shot.js 同一套做法），
// 桩里做的就是 main.ts 那个 handler 的两件事：读文件 + parseBookmarkHtml。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DIST = path.join(__dirname, '..', 'dist');
const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const builtins = require(path.join(DIST, 'shared', 'builtins.js'));
const sounds = require(path.join(DIST, 'shared', 'sounds.js'));
const bookmarks = require(path.join(DIST, 'shared', 'bookmarks.js'));

const OUT = '/tmp/fd-bm';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// ---------- 造一份「浏览器导出」的文件 ----------
const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function bookmarkFile() {
  const rows = [];
  rows.push('<DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>');
  rows.push('<DL><p>');
  rows.push(`<DT><A HREF="https://github.com/" ADD_DATE="1700000002" ICON="${ICON}">GitHub</A>`);
  rows.push(`<DT><A HREF="https://stackoverflow.com/" ICON="${ICON}">Stack Overflow</A>`);
  rows.push('<DT><H3>技术</H3>');
  rows.push('<DL><p>');
  for (let i = 1; i <= 8; i++) rows.push(`<DT><A HREF="https://developer.mozilla.org/doc${i}">MDN 文档 ${i}</A>`);
  rows.push('<DT><H3>前端</H3>');
  rows.push('<DL><p>');
  for (let i = 1; i <= 4; i++) rows.push(`<DT><A HREF="https://css-tricks.com/p${i}">CSS 技巧 ${i}</A>`);
  rows.push('</DL><p>');
  rows.push('</DL><p>');
  rows.push('<DT><A HREF="javascript:void(0)">坏书签</A>');
  rows.push('</DL><p>');
  rows.push('<DT><H3>其他书签</H3>');
  rows.push('<DL><p>');
  for (let i = 1; i <= 6; i++) rows.push(`<DT><A HREF="https://news.ycombinator.com/item?id=${i}">HN ${i}</A>`);
  rows.push('<DT><A HREF="https://github.com/">GitHub</A>'); // 文件内重复
  rows.push('</DL><p>');
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${rows.join('\n')}
</DL><p>`;
  const p = path.join(OUT, 'bookmarks.html');
  fs.writeFileSync(p, html, 'utf-8');
  return p;
}

// ---------- 配置与 IPC 桩 ----------
let cfg = defaults.buildDefaultConfig();
// 只留一个干净场景，断言好算
cfg.scenes = [{
  id: 'sc1', name: '自检场景', icon: '🧪', themeColor: '#3b82f6', gradientColor: '#7c3aed', gradientAngle: 145,
  dotSize: 64, ringRadius: 120, iconSize: 44, glassOpacity: 0.55, menuOpacity: 0.9,
  layout: 'radial', showLabels: false, isDefault: true, enabled: true, items: [],
}];
cfg.currentSceneId = 'sc1';
cfg.itemLibrary = [];
cfg.libHidden = [];
// 预先放一条与文件里相同的网址：用来验「已存在」不给重复导入
cfg.itemLibrary.push({ id: 'lib-pre', name: 'Stack Overflow（旧）', type: 'web', target: 'https://stackoverflow.com/', icon: '🔗', createdAt: 1 });

let saves = 0;
ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:save', (_e, next) => { cfg = JSON.parse(JSON.stringify(next)); saves++; return { ok: true }; });
ipcMain.handle('config:preview', (_e, next) => { if (next && Array.isArray(next.scenes)) cfg = JSON.parse(JSON.stringify(next)); return { ok: true }; });
ipcMain.handle('library:presets', () => []);
ipcMain.handle('builtins:actions', () => builtins.BUILTIN_ACTIONS);
ipcMain.handle('app:scan', () => []);
ipcMain.handle('app:resolve', () => ({ ok: false }));
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'bm', log: '' }));
ipcMain.handle('note:presets', () => []);
ipcMain.handle('sound:list', () => ({ presets: sounds.SOUND_PRESETS, groups: sounds.SOUND_GROUP_LABELS, defaults: sounds.SOUND_DEFAULT_CONFIG, none: sounds.SOUND_NONE }));
ipcMain.handle('sound:get', () => ({ ok: false }));
ipcMain.handle('ime:snapshot', () => ({ ok: true, available: true, sources: [], currentId: '', currentName: '' }));
ipcMain.handle('web:probe', (_e, u) => ({ url: String(u || ''), title: 't', siteName: 't', iconPath: '' }));
ipcMain.handle('icon:probeLocal', () => ({ ok: false }));
ipcMain.handle('iconlib:list', () => []);
// 书签导入：等价于 main.ts 里的 handler（选文件那一步在自检里直接给路径）
ipcMain.handle('library:importBookmarks', (_e, payload = {}) => {
  const file = String(payload.file || '');
  if (!file) return { ok: false, canceled: true };
  try {
    const html = fs.readFileSync(file, 'utf-8');
    const p = bookmarks.parseBookmarkHtml(html);
    if (!p.links) return { ok: false, error: '这个文件里没找到书签' };
    return { ok: true, file, name: path.basename(file), size: html.length, nodes: p.nodes, links: p.links, folders: p.folders, skipped: p.skipped };
  } catch (e) {
    return { ok: false, error: '读取失败：' + e.message };
  }
});
for (const ch of [
  'settings:open', 'settings:close', 'diag:log', 'note:open', 'note:close', 'preview:open',
  'float:resize', 'float:contextMenu', 'item:contextMenu', 'float:activate', 'float:switchScene',
]) ipcMain.on(ch, () => {});

const FILE = bookmarkFile();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1240, height: 860, show: true,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.log('  [page-error] ' + msg);
  });
  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await sleep(1200);

  // 打开项目库页
  const nav = await win.webContents.executeJavaScript(`(async () => {
    const b = document.querySelector('[data-view="library"]');
    if (!b) return { error: '导航里没有项目库' };
    b.click();
    await new Promise(r => setTimeout(r, 350));
    return { ok: true, hasBtn: !!document.getElementById('lib-import') };
  })()`);
  check('项目库页顶有「导入书签」按钮', nav && nav.hasBtn === true, JSON.stringify(nav));

  // 走真实的解析入口（自检钩子带文件路径，跳过系统选择框）
  const opened = await win.webContents.executeJavaScript(`(async () => {
    await window.FDImportBookmarks(${JSON.stringify(FILE)});
    await new Promise(r => setTimeout(r, 450));
    const m = document.getElementById('modal');
    const rows = m.querySelectorAll('.bm-row');
    return {
      wide: m.classList.contains('bm'),
      rows: rows.length,
      folders: m.querySelectorAll('.bm-row.folder').length,
      links: m.querySelectorAll('.bm-row.link').length,
      dup: m.querySelectorAll('.bm-row.dup').length,
      stat: (document.getElementById('bm-stat') || {}).textContent || '',
      doLabel: (document.getElementById('bm-do') || {}).textContent || '',
      hint: m.querySelector('.hint') ? m.querySelector('.hint').textContent.replace(/\\s+/g, ' ').trim() : '',
    };
  })()`);
  check('导入弹窗打开且是宽版', opened.wide === true, JSON.stringify(opened.wide));
  // 这份文件：书签栏 / 技术 / 前端 / 其他书签 = 4 个文件夹；
  // 链接 = GitHub 1 + Stack 1 + MDN 8 + CSS 4 + HN 6 + 重复的 GitHub 1 = 21（文件内的重复不去重，交给落库时判）
  check('树里画出了文件夹与链接（21 条链接 / 4 个文件夹）',
    opened.links === 21 && opened.folders === 4, JSON.stringify(opened));
  check('头部的统计文案带上来链接数 / 文件夹数 / 跳过的坏书签',
    /21 条链接/.test(opened.hint) && /4 个文件夹/.test(opened.hint) && /跳过 1 条/.test(opened.hint), opened.hint);
  check('已存在的那个网址被标成「已存在」且默认不勾', opened.dup === 1, JSON.stringify(opened.dup));
  check('默认把没导入过的都勾上了（20 条）', /已选 20 \/ 共 21 条/.test(opened.stat), opened.stat);
  check('底部按钮显示要导入的条数', /导入所选（20）/.test(opened.doLabel), opened.doLabel);
  await sleep(400);
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'bookmarks-modal.png'), img.toPNG()));

  // 检索过滤
  const searched = await win.webContents.executeJavaScript(`(async () => {
    const q = document.getElementById('bm-q');
    q.value = 'css 技巧';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 200));
    const links = document.querySelectorAll('#bm-tree .bm-row.link').length;
    q.value = '';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 200));
    return { links, back: document.querySelectorAll('#bm-tree .bm-row.link').length };
  })()`);
  check('检索框能按书名过滤（css 技巧 → 4 条）', searched.links === 4, JSON.stringify(searched));
  check('清空检索词后树恢复完整', searched.back === 21, JSON.stringify(searched.back));

  // 文件夹勾选框 = 全选/全不选这一支
  const folderToggle = await win.webContents.executeJavaScript(`(async () => {
    const rows = [...document.querySelectorAll('#bm-tree .bm-row.folder')];
    const tech = rows.find(r => r.textContent.includes('技术'));
    const cb = tech.querySelector('input[data-bm-toggle]');
    const before = cb.checked;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 200));
    const after = (document.getElementById('bm-stat') || {}).textContent || '';
    // 再点回来
    const cb2 = [...document.querySelectorAll('#bm-tree .bm-row.folder')].find(r => r.textContent.includes('技术')).querySelector('input[data-bm-toggle]');
    cb2.checked = true;
    cb2.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 200));
    return { before, after, stat2: (document.getElementById('bm-stat') || {}).textContent || '' };
  })()`);
  // 「技术」这一支 = 8 MDN + 4 CSS = 12 条，清空后 20 - 12 = 8
  check('文件夹勾选框能一键清空这一支（20 → 8）', folderToggle.before === true && /已选 8 \/ 共 21/.test(folderToggle.after), JSON.stringify(folderToggle));
  check('再点一下恢复全选（20）', /已选 20 \/ 共 21/.test(folderToggle.stat2), JSON.stringify(folderToggle));

  // 导入到项目库
  const imported = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('bm-do').click();
    await new Promise(r => setTimeout(r, 600));
    return { closed: !document.getElementById('bm-name') && !document.getElementById('bm-tree') };
  })()`);
  const lib = (cfg.itemLibrary || []).filter((x) => x.type === 'web');
  check('点「导入所选」后弹窗关闭', imported.closed === true, JSON.stringify(imported));
  // 选中 20 条，其中两条 GitHub 是文件内重复 → 落库时折叠成 1 条，实际新增 19（+ 原有 1 条 = 20）
  check('19 条新书签落进了项目库（原有 1 条 → 共 20）', lib.length === 20, 'web 条数=' + lib.length);
  check('文件内重复的 GitHub 只落了一条',
    lib.filter((x) => String(x.target).replace(/\/+$/, '') === 'https://github.com').length === 1,
    JSON.stringify(lib.filter((x) => String(x.target).includes('github')).map((x) => x.name)));
  check('已存在的那条没有被重复加进来',
    lib.filter((x) => String(x.target).replace(/\/+$/, '') === 'https://stackoverflow.com').length === 1,
    JSON.stringify(lib.filter((x) => x.target.includes('stackoverflow')).map((x) => x.name)));
  check('导入的条目带文件夹路径关键词（便于以后检索）',
    lib.some((x) => Array.isArray(x.keywords) && x.keywords.includes('技术') && x.keywords.includes('书签栏')),
    JSON.stringify(lib.find((x) => x.name === 'MDN 文档 1') || {}).slice(0, 160));
  check('导入的条目带上了浏览器导出里的图标（data:image）',
    lib.some((x) => String(x.icon || '').startsWith('data:image/')),
    JSON.stringify(lib.filter((x) => String(x.icon || '').startsWith('data:image/')).length));
  check('导入的书签都是 web 类型、目标是 http(s)',
    lib.every((x) => x.type === 'web' && /^https?:\/\//.test(String(x.target))),
    JSON.stringify(lib.filter((x) => !/^https?:\/\//.test(String(x.target))).map((x) => x.target)));
  check('导入真的写进配置了（不是只改内存页面）', saves > 0, 'saves=' + saves);

  // 再导一次同一个文件：应该一条都不新增
  const again = await win.webContents.executeJavaScript(`(async () => {
    const before = ${JSON.stringify(0)};
    await window.FDImportBookmarks(${JSON.stringify(FILE)});
    await new Promise(r => setTimeout(r, 450));
    return {
      stat: (document.getElementById('bm-stat') || {}).textContent || '',
      dup: document.querySelectorAll('.bm-row.dup').length,
      doLabel: (document.getElementById('bm-do') || {}).textContent || '',
      disabled: (document.getElementById('bm-do') || {}).disabled === true,
    };
  })()`);
  const libBefore = lib.length;
  await win.webContents.executeJavaScript(`(() => { const b=document.getElementById('bm-do'); if(b) b.click(); return true; })()`);
  await sleep(400);
  const libAfter = (cfg.itemLibrary || []).filter((x) => x.type === 'web').length;
  check('同一份文件再导一次：全部标成「已存在」', again.dup === 21, JSON.stringify(again));
  check('再导一次不会重复加条目', libAfter === libBefore, `${libBefore} → ${libAfter}`);

  // 目标改成「直接加进场景」：判定口径要从「项目库」换成「当前场景」，所以又全都能选了
  const intoScene = await win.webContents.executeJavaScript(`(async () => {
    await window.FDImportBookmarks(${JSON.stringify(FILE)});
    await new Promise(r => setTimeout(r, 450));
    const statLib = (document.getElementById('bm-stat') || {}).textContent || '';
    const radio = document.querySelector('input[name="bm-target"][value="scene"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 250));
    const statScene = (document.getElementById('bm-stat') || {}).textContent || '';
    const dupHint = (document.getElementById('bm-dup') || {}).textContent || '';
    const dupRows = document.querySelectorAll('.bm-row.dup').length;
    // 场景里还没有 → 切过去时已自动全选，再点一次全选确认不抖
    document.getElementById('bm-all').click();
    await new Promise(r => setTimeout(r, 200));
    const before = (document.getElementById('bm-stat') || {}).textContent || '';
    document.getElementById('bm-do').click();
    await new Promise(r => setTimeout(r, 600));
    return { statLib, statScene, dupHint, dupRows, before };
  })()`);
  const sceneItems = cfg.scenes[0].items || [];
  check('按项目库口径时全都「已存在」（已选 0）', /已选 0 \/ 共 21/.test(intoScene.statLib), intoScene.statLib);
  check('切到「直接加进场景」后按场景重算：不再算重复、自动全选（21）',
    /已选 21 \/ 共 21/.test(intoScene.statScene) && intoScene.dupRows === 0 && intoScene.dupHint === '',
    JSON.stringify(intoScene));
  check('全选按钮在场景口径下仍是 21', /已选 21 \/ 共 21/.test(intoScene.before), intoScene.before);
  // 21 条里 GitHub 出现两次 → 落进场景 20 条
  check('20 条书签真的加进了场景', sceneItems.length === 20, 'items=' + sceneItems.length);
  check('场景里的书签是 web 类型、顺序连续、默认启用',
    sceneItems.length === 20 && sceneItems.every((x) => x.type === 'web' && x.enabled === true && x.order >= 0),
    JSON.stringify(sceneItems.slice(0, 2).map((x) => ({ t: x.type, o: x.order, e: x.enabled }))));
  check('场景里没有出现重复网址',
    new Set(sceneItems.map((x) => String(x.target).replace(/\/+$/, ''))).size === sceneItems.length,
    sceneItems.length);

  // 场景里有条目后，右栏应该能渲染出来（顺带确认页面没崩）
  const after = await win.webContents.executeJavaScript(`(async () => {
    await new Promise(r => setTimeout(r, 300));
    return {
      right: document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length,
      err: (document.querySelector('#lib-msg') || {}).textContent || '',
    };
  })()`);
  check('导入后项目库右栏正常渲染出 20 行', after.right === 20, JSON.stringify(after));
  await sleep(300);
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'bookmarks-imported.png'), img.toPNG()));

  console.log(failed ? '\n[FAIL] ' + failed + ' 项未通过' : '\n[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('自检脚本异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
