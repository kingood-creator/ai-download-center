// 悬浮窗「圆点位置」自检：不同场景切来切去，圆点（窗口中心）必须钉在原地。
//
// 背景：场景的 dotSize / ringRadius 是每个场景独立的，所以收起尺寸和展开尺寸都随场景变。
// 以前 resize() 是从「当前窗口 bounds」反算中心再摆回去，窗口一旦被 workArea 夹住，
// 中心就被挪走、圆点跟着跳，缩回小尺寸也不会回来 —— 表现就是「不同场景的窗口位置不一致」。
// 现在改成一切 resize 都从锚点算，这里用真实 BrowserWindow 验证「跳不跳、能不能归位」。
//
// 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --no-sandbox --disable-gpu scripts/float-pos-check.js
const { app, screen } = require('electron');
const { FloatingWindow } = require('../dist/main/FloatingWindow');

const results = [];
function push(name, ok, value) {
  results.push({ name, ok: !!ok, value: value === undefined ? null : value });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : '  ' + JSON.stringify(value)}`);
}

/** 窗口中心（= 圆点中心） */
function center(fw) {
  const b = fw.win.getBounds();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
function same(a, b, tol = 1) {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

(async () => {
  await app.whenReady();
  const fw = new FloatingWindow();
  fw.create();
  await new Promise((r) => setTimeout(r, 350));

  const wa = screen.getPrimaryDisplay().workArea;
  // 先放在屏幕中间（离四边都远）：这里窗口怎么变都放得下，圆点必须一动不动
  fw.setWindowPos(Math.round(wa.x + wa.width / 2 - 60), Math.round(wa.y + wa.height / 2 - 60));
  await new Promise((r) => setTimeout(r, 120));

  const anchor = fw.getAnchor();
  push('setWindowPos 后锚点记下来了', !!anchor && Number.isFinite(anchor.x), anchor);

  // ① 收起态：切不同 dotSize 的场景，圆点必须一动不动
  fw.resize('collapsed', 120);
  await new Promise((r) => setTimeout(r, 120));
  const c1 = center(fw);
  fw.resize('collapsed', 128); // 场景 B 的圆点更大
  await new Promise((r) => setTimeout(r, 120));
  const c2 = center(fw);
  fw.resize('collapsed', 108); // 场景 C 的圆点更小
  await new Promise((r) => setTimeout(r, 120));
  const c3 = center(fw);
  push(
    '收起态切场景（圆点 120/128/108）：圆点位置不动',
    same(c1, c2) && same(c1, c3),
    { c1, c2, c3 }
  );

  // ② 故意把圆点摆到贴着右上角：这种位置展开大窗一定会被 workArea 夹住，
  //    是最容易暴露「位置漂移」的地方（用户就是在屏幕边上用悬浮球的）
  fw.setWindowPos(Math.round(wa.x + wa.width - 150), Math.round(wa.y + 30));
  await new Promise((r) => setTimeout(r, 120));
  fw.resize('collapsed', 120);
  await new Promise((r) => setTimeout(r, 120));
  const home = { ...center(fw) };
  fw.resize('expanded', 404); // 场景 A 的环形菜单
  await new Promise((r) => setTimeout(r, 140));
  const big = center(fw);
  fw.resize('collapsed', 120);
  await new Promise((r) => setTimeout(r, 140));
  const back = center(fw);
  push(
    '展开大窗后被屏幕边缘夹住、收起时仍能回到原位（不再漂移）',
    same(back, home),
    { home, expanded: big, back }
  );

  // ③ 两个展开尺寸差很大的场景来回切：各自都从同一个锚点摆，收起后完全相同
  fw.resize('expanded', 404);
  await new Promise((r) => setTimeout(r, 140));
  const eA = center(fw);
  fw.resize('expanded', 304); // 场景 B 环半径更小
  await new Promise((r) => setTimeout(r, 140));
  const eB = center(fw);
  fw.resize('collapsed', 120);
  await new Promise((r) => setTimeout(r, 140));
  const back2 = center(fw);
  push(
    '两个展开尺寸不同的场景来回切：收起后圆点还是同一个位置',
    same(back2, home),
    { home, expandedA: eA, expandedB: eB, back: back2 }
  );

  // ④ 展开态本身：只要窗口放得下，圆点就该正好在锚点上（不同场景同一个锚点）
  fw.setWindowPos(Math.round(wa.x + wa.width / 2 - 60), Math.round(wa.y + wa.height / 2 - 60));
  await new Promise((r) => setTimeout(r, 120));
  const mid = fw.getAnchor();
  fw.resize('expanded', 404);
  await new Promise((r) => setTimeout(r, 140));
  const mA = center(fw);
  fw.resize('expanded', 304);
  await new Promise((r) => setTimeout(r, 140));
  const mB = center(fw);
  push(
    '屏幕中间展开：不同场景的菜单窗口共享同一个圆心（= 圆点）',
    same(mA, mid) && same(mB, mid),
    { anchor: mid, A: mA, B: mB }
  );

  // ⑤ 拖动会挪锚点（用户主动摆位要生效）
  fw.setWindowPos(Math.round(wa.x + 200), Math.round(wa.y + 200));
  await new Promise((r) => setTimeout(r, 120));
  const moved = fw.getAnchor();
  fw.resize('collapsed', 120);
  await new Promise((r) => setTimeout(r, 120));
  push(
    '重新定位后锚点跟着走，收起态圆点落在新位置',
    !!moved && moved.x !== mid.x && same(center(fw), moved),
    { moved, center: center(fw) }
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed === 0 ? '[OK] 全部检查通过' : '[FAIL] 有 ' + failed + ' 条未通过'}（${results.length} 条）`);
  app.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('自检脚本异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
