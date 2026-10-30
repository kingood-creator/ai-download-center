// 「正在操控的窗口」提示药丸（↗ 应用名）UI 自检（开发用，不打包）。
// 覆盖三条新行为：自动避开遮挡 / 关闭指示 / 停留几秒后淡出，外加默认位置回归。
// 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/linked-app-check.js --no-sandbox --disable-gpu
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = '/tmp/fd-linked';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// 场景故意用「小圆环半径」：正上方那颗项目会压住药丸的默认位置（还原用户截图里的遮挡）
const DOT = 64, RING = 60, ICON = 44;
const EXPANDED = 2 * (RING + ICON / 2 + 30); // = 224
let cfg = {
  currentSceneId: 's1',
  scenes: [{
    id: 's1', name: '自检', icon: '🏠', themeColor: '#3b82f6', gradientColor: '#7c3aed', gradientAngle: 145,
    dotSize: DOT, ringRadius: RING, iconSize: ICON, glassOpacity: 0.55, menuOpacity: 0.9,
    layout: 'radial', showLabels: true, isDefault: true,
    items: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: 'i' + n, name: '项目' + n, type: 'app', target: '/Applications/Utilities/Terminal.app',
      icon: '💻', order: n, enabled: true,
    })),
  }],
  appearance: {
    clickOutsideToClose: true, reduceMotion: false,
    linkedAppBgOpacity: 1, linkedAppTextColor: '#e8ecf6',
    linkedAppEnabled: true, linkedAppDuration: 0,
  },
};

ipcMain.handle('config:get', () => cfg);
ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
ipcMain.handle('float:dragEnd', () => ({ moved: false }));
ipcMain.handle('float:linkedGet', () => 'Safari');
// 真实 setBounds：镜像 FloatingWindow.resize 的「保持窗口中心」缩放逻辑，
// 这样渲染进程的 window resize 事件才会真的触发（回归：收起后药丸按新尺寸重排）
let win = null;
ipcMain.on('float:resize', (_e, _mode, size) => {
  if (!win) return;
  const b = win.getBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  let s = Math.round(size);
  if (!s || Number.isNaN(s)) s = 224;
  s = Math.max(120, Math.min(760, s));
  win.setBounds({ x: Math.round(cx - s / 2), y: Math.round(cy - s / 2), width: s, height: s });
});
ipcMain.on('float:contextMenu', () => {});
ipcMain.on('item:contextMenu', () => {});
ipcMain.on('float:activate', () => {});
ipcMain.on('float:dragStart', () => {});
ipcMain.on('float:switchScene', () => {});
ipcMain.on('log:msg', () => {});
ipcMain.on('diag:log', () => {});
ipcMain.on('float:savePos', () => {});

  // 读药丸 / 圆点 / 菜单项的真实占位
  const PROBE = `(() => {
    const p = document.getElementById('linked-app');
    const d = document.getElementById('dot');
    const pr = p.getBoundingClientRect();
    const dr = d.getBoundingClientRect();
    const items = [...document.querySelectorAll('#menu .menu-item')].map(n => {
      const b = n.getBoundingClientRect();
      return { t: b.top, b: b.bottom, l: b.left, r: b.right };
    });
    const overlaps = items.filter(it => !(pr.left + pr.width < it.l || pr.left > it.r || pr.top + pr.height < it.t || pr.top > it.b));
    return {
      hidden: p.classList.contains('hidden'),
      display: getComputedStyle(p).display,
      pill: { t: pr.top, b: pr.bottom, l: pr.left, r: pr.right, w: pr.width, h: pr.height },
      dot: { t: dr.top, b: dr.bottom },
      itemsN: items.length, overlaps: overlaps.length,
      win: { w: window.innerWidth, h: window.innerHeight },
    };
  })()`;

  // 悬浮球的「点一下展开」走的是 mousedown → mouseup（没移动才算点击），
  // 真实点击不能只派发 click，要补全这一对事件才会触发 toggle()
  const CLICK = `(() => {
    const d = document.getElementById('dot');
    d.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    return true;
  })()`;

app.whenReady().then(async () => {
  // 初始就是收起尺寸（dotSize+56=120，也是 resize 的下限），贴近真实运行状态
  const COLLAPSED = DOT + 56;
  win = new BrowserWindow({
    width: COLLAPSED, height: COLLAPSED, show: true, transparent: true,
    frame: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'floating', 'index.html'));
  await sleep(600);

  // 1) 主进程推送链接窗口名 → 药丸出现，且停在圆点上方（收起态没有菜单项）
  win.webContents.send('float:linked', 'Safari');
  await sleep(400);
  const collapsed = await win.webContents.executeJavaScript(PROBE);
  check('推送链接窗口名后药丸显示', collapsed.hidden === false && collapsed.display !== 'none', JSON.stringify(collapsed));
  check('收起态（无菜单）药丸贴在圆点上方', collapsed.pill.b <= collapsed.dot.t + 1, JSON.stringify(collapsed.pill));
  check('药丸没有越出窗口', collapsed.pill.t >= 0 && collapsed.pill.b <= collapsed.win.h && collapsed.pill.l >= 0 && collapsed.pill.r <= collapsed.win.w, JSON.stringify(collapsed.pill));
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'linked-collapsed.png'), img.toPNG()));

  // 2) 展开菜单（小圆环 → 正上方项目会压住默认位置）→ 药丸自动避开
  await win.webContents.executeJavaScript(CLICK);
  await sleep(500); // 展开后 90ms 还会重排一次，等它稳定
  const expanded = await win.webContents.executeJavaScript(PROBE);
  check('展开后菜单项目已渲染', expanded.itemsN === 6, JSON.stringify(expanded.itemsN));
  check('自动避开遮挡：药丸没有压住任何菜单项目', expanded.overlaps === 0, JSON.stringify(expanded.overlaps));
  check('自动避开遮挡：药丸仍在窗口内', expanded.pill.t >= 0 && expanded.pill.b <= expanded.win.h, JSON.stringify(expanded.pill));
  check('自动避开遮挡：药丸挪到了菜单圈外沿（不再贴圆点）', expanded.pill.b <= expanded.dot.t - 4, JSON.stringify(expanded.pill));
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'linked-expanded.png'), img.toPNG()));

  // 2.5) 收起 → 窗口真实缩回小球尺寸，药丸必须按新尺寸重排（回归：右下角露出一小块「↗」箭头框）
  await win.webContents.executeJavaScript(CLICK); // 收起
  await sleep(600); // 等 setBounds 落地 + resize 事件触发的重排
  const recol = await win.webContents.executeJavaScript(PROBE);
  check('收起后窗口缩回小球尺寸', recol.win.w === DOT + 56 && recol.win.h === DOT + 56, JSON.stringify(recol.win));
  check('收起后药丸完整在窗口内（不再被裁出箭头框）', recol.hidden === false && recol.pill.t >= 0 && recol.pill.b <= recol.win.h && recol.pill.l >= 0 && recol.pill.r <= recol.win.w, JSON.stringify(recol.pill));
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'linked-recollapsed.png'), img.toPNG()));
  await win.webContents.executeJavaScript(CLICK); // 重新展开，后续步骤继续在展开态验证
  await sleep(600);

  // 3) 关掉「显示链接窗口提示」→ 整条提示消失（但捕获照旧，快捷键照样发对窗口）
  cfg.appearance.linkedAppEnabled = false;
  win.webContents.send('scene:changed', cfg);
  await sleep(400);
  const off = await win.webContents.executeJavaScript(PROBE);
  check('关掉「显示链接窗口提示」后药丸消失', off.hidden === true && off.display === 'none', JSON.stringify(off));
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'linked-off.png'), img.toPNG()));

  // 4) 再打开 → 药丸回来，并且仍然不压项目
  cfg.appearance.linkedAppEnabled = true;
  win.webContents.send('scene:changed', cfg);
  await sleep(400);
  const back = await win.webContents.executeJavaScript(PROBE);
  check('重新打开后药丸回来且仍不压项目', back.hidden === false && back.overlaps === 0, JSON.stringify(back));

  // 5) 停留 1 秒后淡出：设了时长 → 出现一会儿自己退场
  cfg.appearance.linkedAppDuration = 1;
  win.webContents.send('scene:changed', cfg);
  await sleep(300);
  const shown = await win.webContents.executeJavaScript(PROBE);
  check('设了停留时长后药丸先显示', shown.hidden === false, JSON.stringify(shown));
  await sleep(1400); // 1 秒 + 余量
  const faded = await win.webContents.executeJavaScript(PROBE);
  check('停留 1 秒后药丸自动淡出', faded.hidden === true, JSON.stringify(faded));
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'linked-faded.png'), img.toPNG()));

  // 6) 改回常驻 → 展开菜单时重新出现并停住
  cfg.appearance.linkedAppDuration = 0;
  await win.webContents.executeJavaScript(CLICK); // 收起
  await sleep(400);
  await win.webContents.executeJavaScript(CLICK); // 再展开
  await sleep(600);
  let stay = await win.webContents.executeJavaScript(PROBE);
  // 无头环境里窗口偶尔会先失焦自动收起，两次点击净效果变成「收起」→ 这里补一次，
  // 否则会偶发一条假失败（药丸在收起态也是显示的，但菜单项是 0，断言要看展开态）
  if (stay.itemsN === 0) {
    await win.webContents.executeJavaScript(CLICK);
    await sleep(650);
    stay = await win.webContents.executeJavaScript(PROBE);
  }
  check('改回常驻后重新展开，药丸出现并停住', stay.hidden === false && stay.overlaps === 0, JSON.stringify(stay));

  // 7) 换不同「场景」反复验：环半径 / 图标尺寸 / 圆点大小都不同，
  //    药丸必须**都在圆点上方**（以前允许落到下方，同一个提示换了场景就跑到下面去了）
  const scenes = [
    { name: '小环', dotSize: 64, ringRadius: 60, iconSize: 44 },
    { name: '中环', dotSize: 72, ringRadius: 120, iconSize: 40 },
    { name: '大环', dotSize: 56, ringRadius: 180, iconSize: 52 },
    { name: '小圆点大图标', dotSize: 44, ringRadius: 90, iconSize: 64 },
  ];
  for (const sc of scenes) {
    const s = cfg.scenes[0];
    s.dotSize = sc.dotSize;
    s.ringRadius = sc.ringRadius;
    s.iconSize = sc.iconSize;
    win.webContents.send('scene:changed', cfg);
    await sleep(400); // 切场景会 resize + 90ms 后重排一次，等它稳定
    // 切场景时窗口可能已经收起（无头环境里窗口会失焦），这里确保是展开态再验
    let p = await win.webContents.executeJavaScript(PROBE);
    if (p.itemsN === 0) {
      await win.webContents.executeJavaScript(CLICK);
      await sleep(650);
      p = await win.webContents.executeJavaScript(PROBE);
    }
    // 「在上面」= 药丸的中心高于圆点的中心（收起态空间极小、贴着圆点上沿是正常且期望的）
    const pillMid = p.pill.t + p.pill.h / 2;
    const dotMid = (p.dot.t + p.dot.b) / 2;
    check(
      `场景「${sc.name}」：药丸在圆点上方（${p.itemsN} 个菜单项目）`,
      p.hidden === false && pillMid < dotMid && p.pill.t < p.dot.t,
      JSON.stringify({ pill: p.pill, dot: p.dot })
    );
    check(
      `场景「${sc.name}」：药丸没压住任何菜单项目、也没越出窗口`,
      p.overlaps === 0 && p.pill.t >= 0 && p.pill.b <= p.win.h,
      JSON.stringify({ overlaps: p.overlaps, pill: p.pill, win: p.win })
    );
  }
  await win.capturePage().then((img) => fs.writeFileSync(path.join(OUT, 'linked-on-top.png'), img.toPNG()));

  console.log(failed ? '[FAIL] ' + failed + ' 项未通过' : '[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
});
