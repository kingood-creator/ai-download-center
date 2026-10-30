// 项目库 UI 截图自检（一次性脚本）：验证「项目库」页的两栏结构（左=还没加入场景 / 右=场景已有）、
// 类型下拉、中英文检索、网址识别、小加号添加、右栏 × 移除与放回左栏，各条路径都真的能用。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const builtins = require(path.join(DIST, 'shared', 'builtins.js'));
const lib = require(path.join(DIST, 'shared', 'itemLibrary.js'));
const macApps = require(path.join(DIST, 'main', 'MacApps.js'));
const os = require('os');

const OUT = '/tmp/fd-shot';
fs.mkdirSync(OUT, { recursive: true });

// 桩：配置读写（把保存的内容记下来，验证「加到场景 / 从场景移除」真的写进了配置）
let saved = null;
ipcMain.handle('config:get', () => defaults.buildDefaultConfig());
ipcMain.handle('config:save', (_e, cfg) => { saved = cfg; return { ok: true }; });
ipcMain.handle('builtins:actions', () => builtins.BUILTIN_ACTIONS);
// 和真实主进程走同一条路径：解析真实路径 + 补原生图标（失败的第三方应用会被过滤掉）
ipcMain.handle('library:presets', () => macApps.resolvePresetIcons(lib.buildBuiltinLibrary(os.homedir()), os.homedir()));
ipcMain.handle('app:scan', () => macApps.listInstalledAppsWithIcons(os.homedir(), 40));
ipcMain.handle('app:resolve', (_e, q) => ({ ok: false }));
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'shot', log: '' }));
ipcMain.handle('note:presets', () => []);
ipcMain.handle('ime:snapshot', () => ({ ok: true, available: true, sources: [], currentId: '', currentName: '' }));
ipcMain.handle('web:probe', (_e, u) => {
  // 主进程收到的是网址字符串（不是对象）
  const raw = String(u || '').trim();
  const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  return { url, title: '示例站点', siteName: '示例', iconPath: '' };
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
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
// 页面内用的轮询等待：机器忙的时候固定 sleep 容易偶发失败，改成「条件满足就立刻返回」
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

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 800, show: true,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  // 渲染进程里的报错也要看得见：不然只会表现为「点了没反应」，很难查
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('  [page-error] ' + message);
  });
  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  // 等设置页把导航渲染出来再点：预置项目库现在要先解析原生图标，首屏比过去慢一点，
  // 固定 sleep 会偶发「元素还没出来就 click」→ 直接改成条件轮询
  await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    await waitFor(() => document.querySelector('[data-view="library"]'), 15000);
    return true;
  })()`);
  // confirm() 会弹原生对话框，脚本里直接放行
  await win.webContents.executeJavaScript(`window.confirm = () => true; true`);

  // 1) 打开项目库页（等两栏真的画出来再断言）
  await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    document.querySelector('[data-view="library"]').click();
    await waitFor(() => document.querySelectorAll('#lib-results .lib-col').length === 2, 15000);
    return true;
  })()`);
  await sleep(400);

  // 2) 两栏结构
  const split = await win.webContents.executeJavaScript(`(() => {
    const cols = document.querySelectorAll('#lib-results .lib-col');
    const titles = [...document.querySelectorAll('#lib-results .lib-col-title')].map(e => e.textContent.replace(/\\s+/g,' ').trim());
    return { n: cols.length, titles,
             leftCards: document.querySelectorAll('#lib-results .lib-col:first-child .lib-card').length,
             rightRows: document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length };
  })()`);
  check('页面分成左右两栏', split.n === 2, JSON.stringify(split));
  check('左栏标题是「还没加入场景」', (split.titles[0] || '').includes('还没加入场景'), JSON.stringify(split.titles));
  check('右栏标题是「场景已添加」', (split.titles[1] || '').includes('场景已添加'), JSON.stringify(split.titles));
  check('右栏列出了场景已有的项目', split.rightRows > 0, JSON.stringify(split));

  // 2.5) macOS 化：本机应用分区 + 原生图标（img 而不是 emoji）
  await win.webContents.executeJavaScript(`(async () => { ${WAIT_HELPER}
    await waitFor(() => document.querySelectorAll('#lib-results .lib-card .ic img').length > 10, 15000);
    // 再等「本机应用」扫描回来（截图里要能看到这一节，顺带验证它真的会出现）
    await waitFor(() => [...document.querySelectorAll('#lib-results .lib-section-title')]
      .some(n => n.textContent.includes('本机应用') && /\\d/.test(n.textContent)), 15000);
    return true;
  })()`);
  const native = await win.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('#lib-results .lib-card')];
    const secs = [...document.querySelectorAll('#lib-results .lib-section-title')].map(n => n.textContent.replace(/\\s+/g,' ').trim());
    return {
      cards: cards.length,
      imgs: cards.filter(c => c.querySelector('.ic img')).length,
      hasInstalled: secs.some(s => s.includes('本机应用')),
      secs,
    };
  })()`);
  // 注意：占位文案「正在读取这台 Mac 上已安装的应用…」里也有「本机应用」四个字，
  // 所以必须要求「本机应用（N）」带数字，否则扫盘没回来也会误判通过
  check('左栏出现「本机应用（N）」分区（这台 Mac 真实装的应用）', /本机应用（\d+）/.test(native.secs.join(' ')), JSON.stringify(native.secs));
  check('本机应用卡片真的渲染出来了（左栏卡片数 > 60）', native.cards > 60, JSON.stringify(native.cards));
  check('卡片图标是原生图片（不是 emoji 表情）', native.imgs > 10, JSON.stringify(native));
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-all.png'), img.toPNG());
    console.log('[shot] 项目库两栏 → ' + OUT + '/library-all.png');
  });

  // 3) 左栏不含「已经在场景里」的项目
  const notDup = await win.webContents.executeJavaScript(`(() => {
    const left = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent);
    const right = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in .nm')].map(e => e.textContent);
    const overlap = left.filter(n => right.includes(n));
    return { leftN: left.length, rightN: right.length, overlap };
  })()`);
  check('左栏不含已加入场景的项目（无重复）', notDup.overlap.length === 0, JSON.stringify(notDup.overlap));

  // 4) 类型下拉：筛「网页」后卡片应全是网页
  const webOnly = await win.webContents.executeJavaScript(`(async () => {
    const s = document.getElementById('lib-type');
    s.value = 'web';
    s.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 300));
    const cards = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card')];
    return { n: cards.length, allWeb: cards.every(c => (c.querySelector('.tp')||{}).textContent.startsWith('网页')) };
  })()`);
  check('类型下拉筛选生效（只剩网页）', webOnly.n > 0 && webOnly.allWeb, JSON.stringify(webOnly));
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-web.png'), img.toPNG());
  });

  // 5) 中文检索
  const cn = await win.webContents.executeJavaScript(`(async () => {
    const s = document.getElementById('lib-type');
    s.value = ''; s.dispatchEvent(new Event('change'));
    const q = document.getElementById('lib-q');
    q.value = '代码';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));
    return {
      left: [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent),
      right: [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in .nm')].map(e => e.textContent),
    };
  })()`);
  // GitHub 在默认场景「日常办公」里已经有了 → 应该出现在右栏、而不是左栏
  check('中文检索命中（代码 → GitHub），且已在场景的归到右栏',
    cn.left.includes('GitHub') || cn.right.includes('GitHub'),
    JSON.stringify(cn));
  check('已加入场景的项目不出现在左栏', !cn.left.includes('GitHub'), JSON.stringify(cn.left));
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-cn.png'), img.toPNG());
    console.log('[shot] 中文检索 → ' + OUT + '/library-cn.png');
  });

  // 5b) 检索一个还没加入场景的项目（终端），应该出现在左栏
  const cn2 = await win.webContents.executeJavaScript(`(async () => {
    const q = document.getElementById('lib-q');
    q.value = '终端';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));
    return {
      left: [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent),
      right: [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in .nm')].map(e => e.textContent),
    };
  })()`);
  check('中文检索命中未加入场景的项目（终端 → 左栏）',
    cn2.left.some((n) => n.includes('终端')) && !cn2.right.some((n) => n.includes('终端')),
    JSON.stringify(cn2));

  // 6) 英文检索
  const en = await win.webContents.executeJavaScript(`(async () => {
    const q = document.getElementById('lib-q');
    q.value = 'notion';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 250));
    q.value = 'terminal';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 250));
    return [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent);
  })()`);
  check('英文检索能搜到（terminal → 终端）', en.some((n) => n.includes('终端')), JSON.stringify(en));

  // 7) 网址识别
  const urlCard = await win.webContents.executeJavaScript(`(async () => {
    const q = document.getElementById('lib-q');
    q.value = 'https://example.com';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));
    const c = document.querySelector('#lib-results .lib-col:first-child .lib-card.url');
    return c ? { has: true, text: c.textContent.replace(/\\s+/g, ' ').trim() } : { has: false };
  })()`);
  check('输入网址被识别（出现「识别为网址」卡片）', urlCard.has, JSON.stringify(urlCard));
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-url.png'), img.toPNG());
    console.log('[shot] 网址识别 → ' + OUT + '/library-url.png');
  });

  // 8) 小加号：加进场景 → 右侧出现、左侧消失（用「终端」，默认场景里没有它）
  const added = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    const q = document.getElementById('lib-q');
    q.value = '终端';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));
    const plus = document.querySelector('#lib-results .lib-col:first-child .lib-card .add');
    if (!plus) return { err: '没有小加号按钮' };
    plus.click();
    const rightHas = () => [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in .nm')]
      .some(e => e.textContent.includes('终端'));
    await waitFor(rightHas, 5000);
    const after = {
      left: [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent),
      right: [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in .nm')].map(e => e.textContent),
      count: document.querySelector('#lib-results .lib-col:last-child .lib-col-title .n').textContent,
    };
    return { after, plusText: plus.textContent };
  })()`);
  check('卡片上有小加号按钮', !!added.plusText, JSON.stringify(added));
  check('小加号后项目出现在右栏（场景已添加）',
    added.after && added.after.right.some((n) => n.includes('终端')) && !added.after.left.some((n) => n.includes('终端')),
    JSON.stringify(added.after));
  check('右栏计数已更新', added.after && String(added.after.count).trim() === String(added.after.right.length), JSON.stringify(added.after && added.after.count));
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-added.png'), img.toPNG());
    console.log('[shot] 添加后 → ' + OUT + '/library-added.png');
  });

  // 9) 右栏 × 移除 → 场景项数减少、该项目回到左栏（方便换别的）
  const removed = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    const row = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in')]
      .find(r => r.querySelector('.nm').textContent.includes('终端'));
    if (!row) return { err: '右栏找不到 终端' };
    const rightBefore = document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length;
    (row.querySelector('[data-sc-del]') || row.querySelector('.rm')).click();
    await waitFor(() => document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length < rightBefore, 5000);
    return {
      rightBefore,
      rightAfter: document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length,
      leftHas: [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent).some(n => n.includes('终端')),
    };
  })()`);
  check('右栏 × 能把项目从场景移除', removed.rightAfter === removed.rightBefore - 1, JSON.stringify(removed));
  check('移除后该项目回到左栏（可重新添加 / 换别的）', removed.leftHas === true, JSON.stringify(removed));
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-removed.png'), img.toPNG());
    console.log('[shot] 移除后 → ' + OUT + '/library-removed.png');
  });

  // 10) 项目管理已并进项目库：导航里不再有「项目管理」，网址输入/新建项目都在项目库页
  const qa = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-view="library"]').click();
    await new Promise(r => setTimeout(r, 500));
    const navs = [...document.querySelectorAll('nav button')].map(b => b.textContent.trim());
    const hasOldInput = !!document.getElementById('qa-url');
    const q = document.getElementById('lib-q');
    q.focus();
    return {
      hasOldInput,
      navs,
      noItemsNav: !navs.some(t => t.includes('项目管理')),
      libVisible: !!document.querySelector('#view-library .lib-split'),
      view: (document.querySelector('nav button.active') || {}).dataset ? document.querySelector('nav button.active').dataset.view : '',
      hasNewBtn: !!document.getElementById('lib-new'),
      hasAutoIcon: !!document.getElementById('lib-autoicon'),
      hasHiddenBtn: !!document.getElementById('lib-hidden'),
      focused: document.activeElement === q,
    };
  })()`);
  check('导航里已没有「项目管理」页（并入项目库）', qa.noItemsNav === true && qa.navs.length === 6, JSON.stringify(qa.navs));
  check('项目管理页不再有单独的网址输入框（已并入项目库）', qa.hasOldInput === false, JSON.stringify(qa));
  check('项目库页自带「+ 添加项目 / 自动补全图标 / 已隐藏」', qa.hasNewBtn === true && qa.hasAutoIcon === true && qa.hasHiddenBtn === true, JSON.stringify(qa));
  check('项目库两栏正常渲染，检索框能聚焦', qa.libVisible === true && qa.view === 'library' && qa.focused === true, JSON.stringify(qa));

  // 11) 输入框右下角的小切换按钮：检索 ⇄ 添加网址（一个输入框两种模式）
  const mode = await win.webContents.executeJavaScript(`(async () => {
    const btn = document.getElementById('lib-mode');
    if (!btn) return { err: '没有小切换按钮' };
    const box = btn.closest('.smartinput');
    const q = document.getElementById('lib-q');
    const snap = () => ({
      hasType: !!document.getElementById('lib-type'),
      hasAdd: !!document.getElementById('lib-urladd'),
      ph: (document.getElementById('lib-q') || {}).placeholder || '',
    });
    const before = snap();
    const inInput = !!box && box.contains(q);
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    const mid = snap();
    const midLabel = document.getElementById('lib-mode').textContent.trim();
    document.getElementById('lib-mode').click();
    await new Promise(r => setTimeout(r, 400));
    const after = snap();
    return { before, mid, after, midLabel, inInput, txt: btn.textContent.trim() };
  })()`);
  check('输入框里有一个小切换按钮（检索⇄网址）', !!mode.txt && mode.inInput === true, JSON.stringify(mode));
  check('默认是检索模式（有类型下拉、没有「读取并添加」）', mode.before && mode.before.hasType && !mode.before.hasAdd, JSON.stringify(mode.before));
  check('切到网址模式：类型下拉收起、出现「读取并添加」', mode.mid && !mode.mid.hasType && mode.mid.hasAdd && mode.mid.ph.includes('粘贴网址'), JSON.stringify(mode.mid));
  check('再点一次切回检索模式，界面恢复原样', mode.after && mode.after.hasType && !mode.after.hasAdd, JSON.stringify(mode.after));

  // 网址模式下的样子（截图看看输入框里的小按钮是否协调）
  await win.webContents.executeJavaScript(`(async () => {
    if (document.getElementById('lib-type')) { document.getElementById('lib-mode').click(); await new Promise(r => setTimeout(r, 400)); }
    return true;
  })()`);
  await sleep(300);
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-urlmode.png'), img.toPNG());
    console.log('[shot] 网址模式 → ' + OUT + '/library-urlmode.png');
  });

  // 12) 网址模式：粘贴网址 → 「读取并添加」→ 场景里真的多一项
  const urlAdd = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    if (document.getElementById('lib-type')) { document.getElementById('lib-mode').click(); await new Promise(r => setTimeout(r, 400)); }
    const q = document.getElementById('lib-q');
    q.value = 'https://example.org';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 250));
    const before = document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length;
    const addBtn = document.getElementById('lib-urladd');
    if (!addBtn) return { err: '没有「读取并添加」按钮' };
    addBtn.click();
    await waitFor(() => document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length > before, 6000);
    await new Promise(r => setTimeout(r, 200));
    return {
      before,
      after: document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length,
      right: [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in .nm')].map(e => e.textContent),
      inputCleared: (document.getElementById('lib-q') || {}).value === '',
    };
  })()`);
  check('网址模式「读取并添加」把网址加进了场景', urlAdd.after === urlAdd.before + 1 && urlAdd.right.some((n) => n.includes('示例')), JSON.stringify(urlAdd));
  check('添加后输入框被清空', urlAdd.inputCleared === true, JSON.stringify(urlAdd));

  // 13) 点卡片其它位置（不是 ＋）= 编辑项目：弹窗预填；保存后存回项目库，不会加进场景
  const edit = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    if (document.getElementById('lib-type')) { document.getElementById('lib-mode').click(); await new Promise(r => setTimeout(r, 400)); }
    const q = document.getElementById('lib-q');
    q.value = '终端';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 400));
    const card = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card[data-lib-id]')]
      .find(c => ((c.querySelector('.nm') || {}).textContent || '').includes('终端'));
    if (!card) return { err: '左栏找不到「终端」卡片' };
    const rightBefore = document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length;
    card.querySelector('.nm').click();
    await new Promise(r => setTimeout(r, 600));
    const m = document.getElementById('modal');
    const nameInp = m.querySelector('#it-name');
    const typeSel = m.querySelector('#it-type');
    const info = {
      open: document.getElementById('modalBg').classList.contains('show'),
      title: (m.querySelector('h3') || {}).textContent || '',
      name: nameInp ? nameInp.value : '',
      type: typeSel ? typeSel.value : '',
      rightBefore,
    };
    if (nameInp) nameInp.value = '终端改';      // 改个名再保存
    document.getElementById('it-save').click();
    await waitFor(() => {
      const names = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent);
      return names.some(n => n.includes('终端改'));
    }, 6000);
    await new Promise(r => setTimeout(r, 300));
    info.rightAfter = document.querySelectorAll('#lib-results .lib-col:last-child .lib-in').length;
    info.mineNames = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent);
    return info;
  })()`);
  check('点卡片其它位置弹出编辑弹窗', edit.open === true, JSON.stringify(edit));
  check('弹窗表单已预填该项目的名称与类型', edit.name === '终端' && edit.type === 'app', JSON.stringify(edit));
  check('弹窗标题是「编辑项目」', (edit.title || '').includes('编辑项目'), JSON.stringify(edit));
  check('编辑项目库条目不会加进场景（只有 ＋ 才加）', edit.rightAfter === edit.rightBefore, JSON.stringify(edit));
  check('编辑后的条目存回了「我的收藏」', (edit.mineNames || []).some((n) => n.includes('终端改')), JSON.stringify(edit.mineNames));
  // 存档一张编辑弹窗的样子
  await win.webContents.executeJavaScript(`(async () => {
    const q = document.getElementById('lib-q');
    q.value = '访达';
    q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 400));
    const card = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card[data-lib-id]')]
      .find(c => ((c.querySelector('.nm') || {}).textContent || '').includes('访达'));
    if (card) card.querySelector('.nm').click();
    await new Promise(r => setTimeout(r, 600));
    return true;
  })()`);
  await sleep(400);
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-edit.png'), img.toPNG());
    console.log('[shot] 编辑弹窗 → ' + OUT + '/library-edit.png');
  });
  await win.webContents.executeJavaScript(`(async () => {
    const c = document.getElementById('it-cancel');
    if (c) c.click();
    await new Promise(r => setTimeout(r, 300));
    return true;
  })()`);

  // 14) 右栏点名称 = 编辑场景里那一条（标题应是「编辑项目」）
  const editSc = await win.webContents.executeJavaScript(`(async () => {
    const row = [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in .meta')][0];
    if (!row) return { err: '右栏没有行' };
    row.click();
    await new Promise(r => setTimeout(r, 600));
    const m = document.getElementById('modal');
    const title = (m.querySelector('h3') || {}).textContent || '';
    const name = (m.querySelector('#it-name') || {}).value || '';
    const c = document.getElementById('it-cancel');
    if (c) c.click();
    await new Promise(r => setTimeout(r, 300));
    return { title, name };
  })()`);
  check('右栏点名称打开的是「编辑项目」', (editSc.title || '').includes('编辑项目') && !!(editSc.name || ''), JSON.stringify(editSc));

  // 15) 收藏到项目库 → 项目库左栏出现「我的收藏」
  const fav = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    const btn = document.querySelector('#lib-results [data-sc-save]');
    if (!btn) return { err: '右栏没有“收藏”按钮' };
    btn.click();
    await new Promise(r => setTimeout(r, 500));
    document.querySelector('[data-view="library"]').click();
    await new Promise(r => setTimeout(r, 400));
    await waitFor(() => [...document.querySelectorAll('#lib-results .lib-section-title')]
      .some(e => e.textContent.includes('我的收藏')), 6000);
    const titles = [...document.querySelectorAll('#lib-results .lib-section-title')].map(e => e.textContent);
    return { titles, hasMine: titles.some(t => t.includes('我的收藏')) };
  })()`);
  check('收藏后项目库出现「我的收藏」', !!fav.hasMine, JSON.stringify(fav));
  // 收藏项若已在当前场景里，左栏应标「已在场景」而不是给加号
  const badge = await win.webContents.executeJavaScript(`(async () => {
    const secs = [...document.querySelectorAll('#lib-results .lib-section-title')];
    const mine = secs.find(s => s.textContent.includes('我的收藏'));
    if (!mine) return { err: '没有我的收藏区' };
    // 「我的收藏」标题后面紧跟的那个 .lib-results 才是收藏区本身
    const grid = mine.nextElementSibling;
    if (!grid || !grid.classList.contains('lib-results')) return { err: '收藏区结构不对' };
    const cards = [...grid.querySelectorAll('.lib-card')];
    const badgeCards = cards.filter(c => c.querySelector('.badge'));
    return { n: cards.length, badges: badgeCards.length,
             hasPlus: cards.filter(c => c.querySelector('.add')).length,
             badgeHasPlus: badgeCards.filter(c => c.querySelector('.add')).length };
  })()`);
  check('已在场景里的收藏项标「已在场景」（不给加号）',
    badge.n > 0 && badge.badges > 0 && badge.badgeHasPlus === 0, JSON.stringify(badge));
  // 滚到「我的收藏」那截个图
  await win.webContents.executeJavaScript(`(async () => {
    const secs = [...document.querySelectorAll('#lib-results .lib-section-title')];
    const mine = secs.find(s => s.textContent.includes('我的收藏'));
    if (mine) mine.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 300));
    return true;
  })()`);
  await sleep(400);
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-mine.png'), img.toPNG());
    console.log('[shot] 我的收藏 → ' + OUT + '/library-mine.png');
  });

  // 16) 项目分类：「mac 系统」只留系统自带，其它分类不再出现系统条目
  const macCat = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    document.querySelector('[data-view="library"]').click();
    await new Promise(r => setTimeout(r, 400));
    // 分类筛选只在「检索」模式下生效，先切回检索模式（网址模式下没有 #lib-type）
    if (!document.getElementById('lib-type')) {
      const modeBtn = document.getElementById('lib-mode');
      if (modeBtn) { modeBtn.click(); await new Promise(r => setTimeout(r, 500)); }
    }
    if (!document.getElementById('lib-type')) return { err: '没有类型下拉' };
    const q = document.getElementById('lib-q');
    q.value = '';
    q.dispatchEvent(new Event('input'));
    const sel = document.getElementById('lib-type');
    const opts = [...sel.options].map(o => ({ v: o.value, t: o.textContent }));
    const pick = async (v) => {
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 500));
      const cards = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card[data-lib-id]')];
      // 「我的收藏」卡片右边还多一颗 × 删除键，比预制卡片更窄，量宽度时把它们排除掉
      const plain = cards.filter(c => !c.querySelector('.rm'));
      return {
        n: cards.length,
        plainN: plain.length,
        sys: cards.filter(c => c.querySelector('.ic.sys')).length,
        names: cards.map(c => (c.querySelector('.nm') || {}).textContent || ''),
        subs: cards.map(c => (c.querySelector('.tp') || {}).textContent || ''),
        // 副标题有没有被 CSS 省略号切掉：scrollWidth > clientWidth 就是切了
        clipped: plain.filter(c => { const t = c.querySelector('.tp'); return t && t.scrollWidth > t.clientWidth + 1; }).length,
        clippedTexts: plain.filter(c => { const t = c.querySelector('.tp'); return t && t.scrollWidth > t.clientWidth + 1; })
          .map(c => (c.querySelector('.tp') || {}).textContent + ' (w=' + Math.round(c.querySelector('.tp').clientWidth) + '/need=' + Math.round(c.querySelector('.tp').scrollWidth) + ')'),
        minW: plain.length ? Math.min(...plain.map(c => (c.querySelector('.tp') || {}).clientWidth || 0)) : 0,
      };
    };
    const mac = await pick('mac');
    const app = await pick('app');
    const file = await pick('file');
    const fileEmpty = (document.querySelector('#lib-results .lib-empty') || {}).textContent || '';
    const all = await pick('');
    return { opts, mac, app, file, fileEmpty, all };
  })()`);
  check('类型下拉里「mac 系统」紧跟「全部类型」，并排在「网页」之前',
    !!macCat.opts && macCat.opts[0].v === '' && macCat.opts[1].v === 'mac'
      && macCat.opts[1].t === 'mac 系统' && macCat.opts[2].v === 'web', JSON.stringify(macCat.opts));
  check('选「mac 系统」：卡片全是系统自带（带小蓝点）',
    macCat.mac && macCat.mac.n > 10 && macCat.mac.sys === macCat.mac.n,
    JSON.stringify({ n: macCat.mac && macCat.mac.n, sys: macCat.mac && macCat.mac.sys }));
  // 卡片宽度有限，极少数超长英文名（Bluetooth File Exchange）肯定会省略，但不能像以前那样"每张都截成 mac 系统 ..."
  check('「mac 系统」副标题显示目标简称，绝大多数完整不被省略',
    macCat.mac && macCat.mac.plainN > 10 && macCat.mac.clipped / macCat.mac.plainN <= 0.1,
    JSON.stringify({ clipped: macCat.mac && macCat.mac.clipped, n: macCat.mac && macCat.mac.plainN, sample: macCat.mac && macCat.mac.clippedTexts }));
  check('副标题文字区宽度够（≥140px），不是被挤成一小截',
    macCat.mac && macCat.mac.minW >= 140, JSON.stringify({ minW: macCat.mac && macCat.mac.minW }));
  check('快捷键副标题显示成符号（⌘⇧4）而不是 command+shift+4',
    macCat.mac && macCat.mac.subs.some((s) => /⌘|⇧|⌃|⌥/.test(s)) && !macCat.mac.subs.some((s) => /command\+/i.test(s)),
    JSON.stringify((macCat.mac && macCat.mac.subs || []).filter((s) => /⌘|command/i.test(s)).slice(0, 4)));
  check('「mac 系统」里的卡片副标题标着「mac 系统 ·」',    macCat.mac && macCat.mac.subs.every((s) => s.startsWith('mac 系统 ·')),
    JSON.stringify((macCat.mac && macCat.mac.subs || []).slice(0, 4)));
  check('「mac 系统」里含访达 / 终端 这类系统应用',
    macCat.mac && /访达|Finder/.test(macCat.mac.names.join(',')) && /终端/.test(macCat.mac.names.join(',')),
    JSON.stringify((macCat.mac && macCat.mac.names || []).slice(0, 12)));
  check('选「应用」：一个系统条目都不出现（和 mac 系统互斥）',
    macCat.app && macCat.app.n > 0 && macCat.app.sys === 0,
    JSON.stringify({ n: macCat.app && macCat.app.n, sys: macCat.app && macCat.app.sys }));
  check('选「文件」：不含系统条目（系统文件夹已归到 mac 系统）',
    macCat.file && macCat.file.sys === 0, JSON.stringify(macCat.file));
  check('「文件」分类空了会说清原因（系统文件夹已归到 mac 系统），不是一句「没有匹配」',
    /系统自带的下载、桌面、文稿等文件夹都归到了「mac 系统」/.test(macCat.fileEmpty || ''), JSON.stringify(macCat.fileEmpty));
  check('切回「全部类型」：系统条目和第三方条目都在',
    macCat.all && macCat.all.n > macCat.mac.n && macCat.all.sys > 0,
    JSON.stringify({ n: macCat.all && macCat.all.n, sys: macCat.all && macCat.all.sys }));

  // 存档一张「mac 系统」分类的样子
  await win.webContents.executeJavaScript(`(async () => {
    const sel = document.getElementById('lib-type');
    if (!sel) return false;
    sel.value = 'mac';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 500));
    const r = document.getElementById('lib-results');
    if (r) r.scrollTop = 0;
    return true;
  })()`);
  await sleep(400);
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-mac-type.png'), img.toPNG());
    console.log('[shot] mac 系统分类 → ' + OUT + '/library-mac-type.png');
  });
  // 恢复成全部类型，别影响后面的截图
  await win.webContents.executeJavaScript(`(async () => {
    const sel = document.getElementById('lib-type');
    if (sel) { sel.value = ''; sel.dispatchEvent(new Event('change')); }
    await new Promise(r => setTimeout(r, 300));
    return true;
  })()`);

  // ---------- 17) 隐藏 / 放回：不常用的项目可以收起来 ----------
  // 搜一个确定的目标（计算器），点卡片上的 👁 → 从左栏消失 + 写进配置；
  // 打开「已隐藏（N）」→ 能看到它并点 ↺ 放回。
  const hideFlow = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    const q = document.getElementById('lib-q');
    if (!q) return { err: '没有检索框' };
    q.value = '计算器';
    q.dispatchEvent(new Event('input'));
    await waitFor(() => [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card[data-lib-id]')]
      .some(c => ((c.querySelector('.nm') || {}).textContent || '').includes('计算器')), 6000);
    const card = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card[data-lib-id]')]
      .find(c => ((c.querySelector('.nm') || {}).textContent || '').includes('计算器'));
    if (!card) return { err: '左栏找不到「计算器」' };
    const btn = card.querySelector('[data-lib-hide]');
    if (!btn) return { err: '卡片上没有隐藏按钮' };
    const id = btn.dataset.libHide;
    const before = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent).filter(n => n.includes('计算器')).length;
    btn.click();
    await waitFor(() => ![...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')]
      .map(e => e.textContent).some(n => n.includes('计算器')), 6000);
    const afterHide = [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent).filter(n => n.includes('计算器')).length;
    const label = (document.getElementById('lib-hidden') || {}).textContent || '';
    return { id, before, afterHide, label, hiddenInCfg: null };
  })()`);
  check('卡片上有「隐藏」按钮，点了之后从左栏消失',
    !hideFlow.err && hideFlow.before > 0 && hideFlow.afterHide === 0, JSON.stringify(hideFlow));
  check('顶栏「已隐藏（N）」计数跟着 +1', /已隐藏（[1-9]/.test(hideFlow.label || ''), JSON.stringify(hideFlow.label));
  check('隐藏真的写进了配置（libHidden 里有这一项的 id）',
    !!saved && Array.isArray(saved.libHidden) && saved.libHidden.includes(hideFlow.id),
    JSON.stringify({ id: hideFlow.id, hidden: saved && saved.libHidden }));

  // 打开「已隐藏」分区 → 能看到刚才那条，点 ↺ 放回
  const showFlow = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    const btn = document.getElementById('lib-hidden');
    if (!btn) return { err: '没有已隐藏按钮' };
    btn.click();
    await waitFor(() => [...document.querySelectorAll('#lib-results .lib-section-title')]
      .some(e => e.textContent.includes('已隐藏')), 6000);
    const secs = [...document.querySelectorAll('#lib-results .lib-section-title')];
    const sec = secs.find(e => e.textContent.includes('已隐藏'));
    const grid = sec ? sec.nextElementSibling : null;
    const names = grid ? [...grid.querySelectorAll('.lib-card .nm')].map(e => e.textContent) : [];
    const restore = grid ? grid.querySelector('[data-lib-show]') : null;
    const labelAfterOpen = (document.getElementById('lib-hidden') || {}).textContent || '';
    if (!restore) return { err: '隐藏区没有放回按钮', names };
    restore.click();
    await waitFor(() => !document.getElementById('lib-hidden').textContent.includes('（0）'), 6000);
    return {
      names,
      hasRestore: true,
      labelAfterOpen,
      labelAfterRestore: (document.getElementById('lib-hidden') || {}).textContent || '',
      leftHas: [...document.querySelectorAll('#lib-results .lib-col:first-child .lib-card .nm')].map(e => e.textContent).some(n => n.includes('计算器')),
    };
  })()`);
  check('点「已隐藏（N）」能看到被收起来的项目',
    !showFlow.err && (showFlow.names || []).some((n) => n.includes('计算器')), JSON.stringify(showFlow));
  check('点 ↺ 能把项目放回项目库（左栏重新出现）',
    showFlow.leftHas === true && Array.isArray(saved.libHidden || null) && (saved.libHidden || []).indexOf(hideFlow.id) < 0,
    JSON.stringify({ leftHas: showFlow.leftHas, hidden: saved && saved.libHidden }));
  await sleep(300);
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-hidden.png'), img.toPNG());
    console.log('[shot] 已隐藏分区 → ' + OUT + '/library-hidden.png');
  });

  // ---------- 18) 项目管理已并进右栏：启用/停用、排序、复制、收藏、+添加项目 ----------
  const manage = await win.webContents.executeJavaScript(`(async () => {
    ${WAIT_HELPER}
    // 回到检索模式并清空检索词，右栏才完整
    const q = document.getElementById('lib-q');
    if (q) { q.value = ''; q.dispatchEvent(new Event('input')); }
    await new Promise(r => setTimeout(r, 500));
    const rows = () => [...document.querySelectorAll('#lib-results .lib-col:last-child .lib-in')];
    const names = () => rows().map(r => (r.querySelector('.nm') || {}).textContent || '');
    const before = names();
    // 停用第一行
    const sw = rows()[0].querySelector('[data-sc-en]');
    if (!sw) return { err: '右栏没有启用开关' };
    const swId = sw.dataset.scEn;
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 600));
    const offName = names()[0];
    // 下移第一行 → 顺序变化
    const down = rows()[0].querySelector('[data-sc-down]');
    if (!down) return { err: '右栏没有下移按钮' };
    down.click();
    await waitFor(() => names()[0] !== before[0], 6000);
    const moved = names();
    // 复制第一行
    const n0 = rows().length;
    const dup = rows()[0].querySelector('[data-sc-dup]');
    if (!dup) return { err: '右栏没有复制按钮' };
    dup.click();
    await waitFor(() => rows().length === n0 + 1, 6000);
    const dupNames = names();
    // 编辑按钮能打开弹窗
    const editBtn = rows()[0].querySelector('[data-sc-editbtn]');
    if (!editBtn) return { err: '右栏没有编辑按钮' };
    editBtn.click();
    await new Promise(r => setTimeout(r, 600));
    const modalOpen = document.getElementById('modalBg').classList.contains('show');
    const c = document.getElementById('it-cancel');
    if (c) c.click();
    await new Promise(r => setTimeout(r, 300));
    return {
      before, moved, dupNames, modalOpen,
      hasSwitch: true, swId, offName,
      hasNewBtn: !!document.getElementById('lib-new'),
      hasAuto: !!document.getElementById('lib-autoicon'),
      sameFirst: moved[0] === before[0],
      dupAdded: dupNames.some(n => n.includes('副本')),
    };
  })()`);
  check('右栏每行都有启用开关（停用后写进配置 enabled=false）',
    !manage.err && manage.hasSwitch === true
      && !!saved && (saved.scenes || []).some(sc => (sc.items || []).some(i => i.id === manage.swId && i.enabled === false)),
    JSON.stringify({ err: manage.err, swId: manage.swId }));
  check('右栏「↓」能改变项目顺序', manage.sameFirst === false, JSON.stringify({ before: manage.before, moved: manage.moved }));
  check('右栏「复制」多出一条副本', manage.dupAdded === true, JSON.stringify(manage.dupNames));
  check('右栏「编辑」能打开项目弹窗', manage.modalOpen === true, JSON.stringify(manage));
  check('项目库页自带「+ 添加项目」与「自动补全图标」', manage.hasNewBtn === true && manage.hasAuto === true, JSON.stringify(manage));
  await sleep(300);
  await win.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'library-manage.png'), img.toPNG());
    console.log('[shot] 合并后的项目管理 → ' + OUT + '/library-manage.png');
  });

  console.log(failed ? '[FAIL] ' + failed + ' 项未通过' : '[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
});
