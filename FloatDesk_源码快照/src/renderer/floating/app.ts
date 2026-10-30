// 悬浮窗渲染进程（经典脚本；用 IIFE 包裹避免与其它渲染脚本的全局名冲突，且不产生 CommonJS exports 引用）
(function () {
// 先挂错误上报：脚本若抛错，主进程日志里能看到具体原因（过去就有渲染脚本一加载即崩、
// 圆点能看见但完全点不动的情况，日志里查不到任何线索）。
window.addEventListener('error', (ev: any) => {
  try {
    (window as any).api?.logMsg?.('onerror: ' + (ev?.message || ev?.type || 'unknown'));
  } catch {
    /* ignore */
  }
});

const api: any = (window as any).api;
// 菜单音效引擎（src/renderer/shared/sound.ts，由 index.html 先于本脚本加载）
const Snd: any = (window as any).FDSound;

let config: any = null;
let expanded = false;
let lastExpandAt = 0;

/** 把配置里的音效设置交给发动机；配置里没有这一节时按默认（开启、Tink、45%） */
function applySound(): void {
  try {
    Snd?.configure?.(config?.sound);
  } catch {
    /* 音效出问题绝不能影响菜单本身 */
  }
}

/** 播放一个交互音效；任何异常都吞掉（宁可没声音，也不能让点击失效） */
function playSnd(event: 'hover' | 'click' | 'open'): void {
  try {
    Snd?.play?.(event);
  } catch {
    /* ignore */
  }
}

const dotEl = document.getElementById('dot') as HTMLElement;
const menuEl = document.getElementById('menu') as HTMLElement;
const stageEl = document.getElementById('stage') as HTMLElement;
const linkedEl = document.getElementById('linked-app') as HTMLElement | null;

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function iconHtml(item: any): string {
  if (!item) return '';
  const ic = item.icon || '•';
  if (typeof ic === 'string' && (ic.startsWith('/') || ic.startsWith('http') || ic.startsWith('data:image'))) {
    return `<img src="${escapeHtml(ic)}" alt="" />`;
  }
  // 没有原生图标时：emoji 外面套一层 macOS 风格圆角方块（Big Sur 图标观感），
  // 和「真图标」摆在一起不会显得一个是应用、一个是表情符号
  return `<span class="ico-tile">${escapeHtml(ic)}</span>`;
}

/** 场景是否启用（停用的场景只在「场景库」里存着数据，不参与切换/展示） */
function sceneOn(s: any): boolean {
  return !!s && s.enabled !== false;
}

function currentScene(): any {
  if (!config) return null;
  // 停用的场景不能当「当前场景」：配置里理论上不会指向它（migrate 与停用操作都会纠正），
  // 这里再兜一层，免得悬浮球显示一个已停用的场景
  const hit = config.scenes.find((s: any) => s.id === config.currentSceneId);
  if (hit && sceneOn(hit)) return hit;
  return config.scenes.find((s: any) => sceneOn(s)) || config.scenes[0];
}

/**
 * 主题色兜底：这个值会直接当 CSS 变量用，还参与 color-mix()。
 * 一旦是非法值（老配置 / 手改成 'blue' / 写成 rgb(...)），整条 background 会失效 →
 * 圆点直接消失，所以宁可退回默认蓝也不能把脏值塞进去。
 * （正常路径上 ConfigStore.migrate 已经归一化过，这里是第二道保险）
 */
function safeTheme(v: any): string {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : '#3b82f6';
}

function applySceneStyle(scene: any): void {
  const root = document.documentElement.style;
  const theme = safeTheme(scene.themeColor);
  const theme2 = safeTheme(scene.gradientColor || scene.themeColor);
  root.setProperty('--theme', theme);
  root.setProperty('--theme2', theme2);
  root.setProperty('--grad-angle', (typeof scene.gradientAngle === 'number' ? scene.gradientAngle : 145) + 'deg');
  root.setProperty('--glass-opacity', String(scene.glassOpacity ?? 0.55));
  root.setProperty('--dot-size', (scene.dotSize || 64) + 'px');
  root.setProperty('--ring-radius', (scene.ringRadius || 150) + 'px');
  root.setProperty('--icon-size', (scene.iconSize || 44) + 'px');
  root.setProperty('--menu-opacity', String(scene.menuOpacity ?? 0.9));
  root.setProperty('--show-labels', scene.showLabels ? '1' : '0');
  // 选区每行文字的上下内边距（设置 → 常规 →「选区文字边距」）
  const pad = Math.max(4, Math.min(28, Math.round(Number(config?.appearance?.pickerRowPad) || 12)));
  root.setProperty('--sp-row-pad', pad + 'px');
  document.body.classList.toggle('reduce-motion', !!config.appearance.reduceMotion);
  // 圆点动画样式：body 上的 anim-* 类切换（脉冲 / 呼吸 / 能量环 / 无）
  {
    const allowed = ['pulse', 'breathing', 'energy', 'none'];
    const anim = allowed.includes(config?.appearance?.dotAnimation) ? config.appearance.dotAnimation : 'pulse';
    document.body.classList.remove('anim-pulse', 'anim-breathing', 'anim-energy', 'anim-none');
    document.body.classList.add('anim-' + anim);
  }
  // 「正在操控的窗口」提示药丸：磨砂浓度 + 文字颜色（设置实时驱动）。
  // 底色/边框是全局统一的浅色磨砂（不掺场景主题色），这两个值只做微调。
  {
    const bgOp = Number(config?.appearance?.linkedAppBgOpacity);
    root.setProperty('--linked-bg-opacity', (Number.isFinite(bgOp) && bgOp > 0 ? Math.max(0.1, Math.min(1, bgOp)) : 1).toString());
    root.setProperty('--linked-fg', /^#[0-9a-fA-F]{6}$/.test(config?.appearance?.linkedAppTextColor || '') ? config.appearance.linkedAppTextColor : '#ffffff');
  }
  menuEl.classList.toggle('show-labels', !!scene.showLabels);
}

function collapsedSize(scene: any): number {
  return Math.round((scene.dotSize || 64) + 56);
}
function expandedSize(scene: any): number {
  const r = Math.min(scene.ringRadius || 150, 200);
  const icon = Math.min(scene.iconSize || 44, 64);
  return Math.round(2 * (r + icon / 2 + 30));
}

function renderMenu(): void {
  renderMenuInner();
  // 菜单重排后药丸要重新避让（项目占位变了；收起态也会被调一次回到圆点上方）
  placeLinkedApp();
}

function renderMenuInner(): void {
  const scene = currentScene();
  menuEl.innerHTML = '';
  if (!scene) return;
  const list = scene.items.filter((i: any) => i.enabled).sort((a: any, b: any) => a.order - b.order);
  // 空场景（项目全删/全停用）不能进下面的排布循环：i < n 会取到 undefined
  if (list.length === 0) {
    const tip = document.createElement('div');
    tip.className = 'empty-hint';
    tip.textContent = '该场景还没有项目 · 右键圆点 → 打开设置';
    menuEl.appendChild(tip);
    return;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;
  const n = Math.min(list.length, 12);
  const icon = Math.min(scene.iconSize || 44, 64);
  const maxR = Math.min(cx, cy) - icon / 2 - 16;
  const radius = Math.max(30, Math.min(scene.ringRadius || 150, maxR));

  for (let i = 0; i < n; i++) {
    const ang = (-90 + i * (360 / n)) * (Math.PI / 180);
    const x = cx + radius * Math.cos(ang);
    const y = cy + radius * Math.sin(ang);
    const el = document.createElement('div');
    el.className = 'menu-item';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.innerHTML = iconHtml(list[i]) + `<span class="lbl">${escapeHtml(list[i].name)}</span>`;
    el.title = list[i].name + (list[i].shortcut ? `  (${list[i].shortcut})` : '');
    // 移到按钮上：清脆一响（「菜单滚动音效」就是它；40ms 内只响一次，扫一圈不会糊成一片）
    el.addEventListener('mouseenter', () => playSnd('hover'));
    el.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      playSnd('click');
      activate(list[i]);
    });
    // 单个菜单项右键：执行 / 编辑 / 启用停用 / 换图标 / 删除（由主进程弹原生菜单）
    el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      api.showItemContextMenu?.(list[i].id);
    });
    menuEl.appendChild(el);
  }
}

function activate(item: any): void {
  api.runItemById(item.id);
  collapse(true); // 已经响过「点击」音了，收起时别再响一次
}

/**
 * 顶部那条药丸：现在显示【当前场景名】（如「全局场景」），不是链接到的窗口名。
 * 需求：展开菜单顶部文字一律是场景名，样式用全局统一的淡紫磨砂胶囊（见 index.html 的 .linked-app），
 * 切换 / 新建场景后也跟着变（读 currentScene().name，不写死）。
 *
 * 链接窗口名（点悬浮球捕获到的前台应用）仍要记在 linkedName 里 —— ActionRegistry 靠它决定
 * 快捷键发到哪个前台窗口，所以不能丢，只是不再显示在药丸上。
 *
 * 可调行为（设置 → 悬浮球）：
 *  · linkedAppEnabled  —— 关掉后场景名标签不再出现（但主进程照旧捕获窗口，快捷键照样发对窗口）
 *  · linkedAppDuration —— 停留几秒后自动淡出（0 = 常驻）；展开菜单 / 切场景时会重新出现
 * 自动避让没有开关：贴着圆点放不下就挪到菜单圈外沿，永远按真实占位选位（永远在上方）。
 */
let linkedName: string | null = null;
let linkedHideTimer = 0;

function linkedDurationMs(): number {
  const v = Number(config?.appearance?.linkedAppDuration);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.max(1, Math.min(60, Math.round(v))) * 1000;
}

// 纯逻辑与 src/shared/linkedApp.ts 的 pickLinkedAppSlot 保持一致（渲染进程是经典脚本、
// 不能 import 值，按「双胞胎」约定各存一份；改动时两边同步，单测覆盖 shared 那份）
function pickLinkedAppSlot(inp: {
  winW: number; winH: number; pillW: number; pillH: number;
  dotTop: number; dotBottom: number;
  items: Array<{ t: number; b: number; l: number; r: number }>;
}): { top: number; left: number } | null {
  const { winW, winH, pillW, pillH, dotTop, items } = inp;
  if (!(pillW > 0) || !(pillH > 0) || !(winW > 0) || !(winH > 0)) return null;
  const hit = (top: number, left: number): boolean =>
    items.some((it) => !(left + pillW < it.l || left > it.r || top + pillH < it.t || top > it.b));
  const cx = winW / 2;
  const lefts = [cx - pillW / 2, cx - pillW / 2 - 14, cx - pillW / 2 + 14];
  const itemsTop = items.length ? Math.min(...items.map((i) => i.t)) : 0;
  // 只在「上方」选位：环半径/图标尺寸每个场景都不同，一旦允许落到圆点下方，
  // 同一条提示就会在有的场景在上面、有的场景跑到下面（用户要的是「都在上面」）。
  const tops = [
    dotTop - pillH - 4, // ① 圆点正上方（默认手感）
    items.length ? itemsTop - pillH - 4 : Number.NaN, // ② 菜单圈上方
    2, // ③ 窗口顶部兜底
  ];
  for (const top of tops) {
    if (!Number.isFinite(top) || top < 1 || top + pillH > winH - 1) continue;
    for (const left of lefts) {
      if (left < 1 || left + pillW > winW + 1) continue;
      if (hit(top, left)) continue;
      return { top, left };
    }
  }
  return null;
}

/**
 * 按「真实占位」给药丸挑位置：先回到默认位置（圆点正上方、水平居中），
 * 再按圆点与菜单项目的实际矩形选一个不压项目的位置（自动避让，没有开关）。
 * 收起态没有菜单项 → 就是默认位置，和以前手感一致。
 */
function placeLinkedApp(): void {
  const el = linkedEl;
  if (!el) return;
  el.style.top = '';
  el.style.bottom = '';
  el.style.left = '';
  el.style.transform = 'translateX(-50%)';
  // 药丸不能比窗口还宽：收起态窗口只有 dotSize+56，长应用名会被窗口硬裁掉 → 先收紧 max-width 走省略号，
  // 必须在测量 offsetWidth 之前做，否则第一轮量到超宽的药丸，候选位全放不下而落回默认位置
  el.style.maxWidth = Math.max(60, window.innerWidth - 8) + 'px';
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;
  if (!pw || !ph) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  // 圆点永远居中（#dot 靠 translate(-50%,-50%) 定位，offsetTop 是未平移的布局值），
  // 直接按「窗口中心 ± 半径」算，避开呼吸/执行反馈等缩放动画对 rect 的干扰
  const dotH = dotEl.offsetHeight;
  const dotTop = (H - dotH) / 2;
  const dotBottom = dotTop + dotH;
  const cx = W / 2;
  const cy = H / 2;
  // 菜单打开时有 scale(0.85→1) 的过渡，量 rect 会拿到「还没放大完」的占位，
  // 按它选位等动画结束就会差出几个像素压到项目。这里把测到的矩形按当前缩放反算回布局位置。
  const mb = menuEl.getBoundingClientRect();
  let scale = menuEl.offsetWidth > 0 ? mb.width / menuEl.offsetWidth : 1;
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  const items: Array<{ t: number; b: number; l: number; r: number }> = [];
  menuEl.querySelectorAll('.menu-item').forEach((n: any) => {
    const b = n.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return; // display:none 的标签量出来是全 0，别拿来当占位
    items.push({
      t: cy + (b.top - cy) / scale,
      b: cy + (b.bottom - cy) / scale,
      l: cx + (b.left - cx) / scale,
      r: cx + (b.right - cx) / scale,
    });
  });
  const slot = pickLinkedAppSlot({ winW: W, winH: H, pillW: pw, pillH: ph, dotTop, dotBottom, items });
  if (slot) {
    el.style.top = slot.top + 'px';
    el.style.left = slot.left + 'px';
    el.style.transform = 'none';
  }
}

function armLinkedAutoHide(): void {
  if (linkedHideTimer) {
    window.clearTimeout(linkedHideTimer);
    linkedHideTimer = 0;
  }
  const ms = linkedDurationMs();
  if (ms <= 0) return; // 0 = 常驻
  linkedHideTimer = window.setTimeout(() => {
    if (linkedEl && !linkedEl.classList.contains('hidden')) linkedEl.classList.add('hidden');
  }, ms);
}

function setLinkedApp(name: string | null): void {
  // 链接窗口名只更新变量（供 ActionRegistry 发快捷键用），药丸改显示场景名
  linkedName = name || null;
  showScenePill();
}

/**
 * 顶部药丸渲染：显示当前场景名（如「全局场景」）。
 * 样式沿用全局统一的淡紫磨砂胶囊（见 index.html .linked-app），和场景主题色无关，
 * 所以切换 / 新建场景后长得都一样。
 */
function showScenePill(): void {
  if (!linkedEl) return;
  const scene = currentScene();
  if (!scene || config?.appearance?.linkedAppEnabled === false) {
    linkedEl.classList.add('hidden');
    linkedEl.textContent = '';
    linkedEl.removeAttribute('title');
    return;
  }
  const name = scene.name || '全局场景';
  linkedEl.innerHTML = '<span class="name">' + escapeHtml(name) + '</span>';
  linkedEl.classList.remove('hidden');
  linkedEl.title = '当前场景：' + name;
  placeLinkedApp();
  armLinkedAutoHide();
}

function expand(): void {
  const scene = currentScene();
  if (!scene) return;
  playSnd('open');
  expanded = true;
  lastExpandAt = Date.now();
  api.resizeFloating('expanded', expandedSize(scene));
  menuEl.classList.add('open');
  renderMenu();
  // 同步一次链接窗口提示（点悬浮球时已捕获；这里兜底确保显示最新值）
  api.getLinkedApp?.().then(setLinkedApp).catch(() => {});
  // 等主进程完成窗口 resize 后，按真实尺寸再排布一次
  window.setTimeout(() => {
    if (expanded) renderMenu();
  }, 90);
}

function collapse(silent?: boolean): void {
  const scene = currentScene();
  if (!silent) playSnd('open');
  expanded = false;
  menuEl.classList.remove('open');
  menuEl.innerHTML = '';
  if (scene) api.resizeFloating('collapsed', collapsedSize(scene));
  placeLinkedApp(); // 菜单清了 → 药丸回到圆点上方
}

function toggle(): void {
  if (expanded) collapse();
  else expand();
}

// 执行反馈：用圆点上的对勾/叉号 + 扩散光环动画代替原来的绿色文字 toast（无文字）。
// kind: success/info → 绿/主题色对勾；error → 红叉。
let fxTimer = 0;
function showToast(msg: string, kind: string): void {
  const fx = document.getElementById('exec-fx') as HTMLElement | null;
  const dot = document.getElementById('dot') as HTMLElement | null;
  if (!fx || !dot) return;
  const isErr = kind === 'error';
  const color = isErr ? '#f87171' : kind === 'info' ? 'var(--theme)' : '#4ade80';
  fx.style.setProperty('--fx-color', color);
  const ico = fx.querySelector('.ico') as HTMLElement | null;
  if (ico) ico.textContent = isErr ? '✕' : '✓';
  // 重新触发动画：先移除 class 强制 reflow，再重新加上
  fx.classList.remove('play');
  dot.classList.remove('exec-kick');
  void fx.offsetWidth;
  fx.classList.add('play');
  dot.classList.add('exec-kick');
  if (fxTimer) window.clearTimeout(fxTimer);
  fxTimer = window.setTimeout(() => {
    fx.classList.remove('play');
    dot.classList.remove('exec-kick');
  }, 760);
}

// ---------- 右键弹场景选择 ----------
// 右键圆点 → 弹出场景选区：场景行在上（悬停高亮、点击立即切换），
// 最下面是分隔线 + 原右键菜单入口（打开设置 / 隐藏悬浮台 / 退出）。
// 左键不再做长按判定，拖动灵敏度与从前完全一致。

const pickerEl = document.getElementById('scene-picker') as HTMLElement | null;
let lastPickerAt = 0;

function closePicker(): void {
  if (!pickerEl || !pickerEl.classList.contains('open')) return;
  pickerEl.classList.remove('open');
  // 选区可能把窗口临时撑大过，关闭时恢复收起尺寸
  const scene = currentScene();
  if (scene && !expanded) api.resizeFloating('collapsed', collapsedSize(scene));
}

function openPicker(): void {
  if (!pickerEl || !config) return;
  if (pickerEl.classList.contains('open')) return; // 已开着（mousedown/contextmenu 会连着触发两次）
  // 只列启用的场景：停用的还在配置里存着数据，但不该出现在切换列表里
  const scenes: any[] = (config.scenes || []).filter(sceneOn);
  pickerEl.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'sp-title';
  title.textContent = '选择场景';
  pickerEl.appendChild(title);
  for (const s of scenes) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sp-row' + (s.id === config.currentSceneId ? ' cur' : '');
    row.dataset.sceneId = s.id;
    row.textContent = s.name;
    row.title = s.name;
    // 选区也是「按钮」：移上去照样有清脆的一声，点下去有反馈
    row.addEventListener('mouseenter', () => playSnd('hover'));
    row.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      playSnd('click');
      const changed = s.id !== config.currentSceneId;
      closePicker();
      if (changed) api.switchScene?.(s.id);
    });
    pickerEl.appendChild(row);
  }
  // 分隔线 + 原右键菜单入口（滑到最下面）
  const sep = document.createElement('div');
  sep.className = 'sp-sep';
  pickerEl.appendChild(sep);
  const actions: Array<[string, () => void]> = [
    ['打开设置…', () => api.openSettings?.()],
    ['隐藏悬浮台', () => api.hideWindow?.()],
    ['退出 FloatDesk', () => api.quitApp?.()],
  ];
  for (const [label, fn] of actions) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sp-row act';
    row.textContent = label;
    row.title = label;
    row.addEventListener('mouseenter', () => playSnd('hover'));
    row.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      playSnd('click');
      closePicker();
      fn();
    });
    pickerEl.appendChild(row);
  }
  pickerEl.classList.add('open');
  lastPickerAt = Date.now();
  api.activateFloating?.();
  // 窗口尺寸：设置里指定了宽/高就用指定的（非正方形也行）；没指定的维度按内容自动
  const scene = currentScene();
  if (scene) {
    const collapsed = collapsedSize(scene);
    const pad = Math.max(4, Math.min(28, Math.round(Number(config.appearance?.pickerRowPad) || 12)));
    const rowH = pad * 2 + 16;
    const needed = Math.round(26 + (scenes.length + 4) * rowH + 20);
    const autoSize = Math.min(Math.max(collapsed, needed), 760);
    const clampDim = (v: any) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) && n > 0 ? Math.max(120, Math.min(760, n)) : 0;
    };
    const w = clampDim(config.appearance?.pickerWidth) || autoSize;
    const h = clampDim(config.appearance?.pickerHeight) || autoSize;
    if (w !== collapsed || h !== collapsed) api.resizePickerFloating?.(w, h);
  }
}

// ---------- 拖动 + 点击 ----------
// 拖动交由主进程按「光标绝对屏幕坐标」执行，渲染进程只负责报告开始/结束。
// 原因：窗口一旦被移动，Chromium 可能不再向页面派发 mousemove，拖动会中途卡死。
let dragging = false;

function markCursor(on: boolean): void {
  document.body.style.cursor = on ? 'grabbing' : '';
  dotEl.style.cursor = on ? 'grabbing' : '';
}

function onDotMouseDown(e: MouseEvent): void {
  if (e.button === 2) {
    e.preventDefault();
    e.stopPropagation();
    api.logMsg?.('dot contextmenu -> scene picker');
    openPicker();
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  closePicker();
  dragging = true;
  markCursor(true);
  Snd?.unlock?.(); // 第一次真实点击时唤醒 AudioContext
  api.logMsg?.('dot mousedown');
  api.activateFloating?.();
  api.dragStart?.();
}

function finishDrag(allowClick: boolean): void {
  if (!dragging) return;
  dragging = false;
  markCursor(false);
  const p = api.dragEnd ? api.dragEnd() : Promise.resolve({ moved: true });
  Promise.resolve(p)
    .then((r: any) => {
      const moved = !!(r && r.moved);
      api.logMsg?.(`dragEnd moved=${moved}`);
      if (allowClick && !moved) toggle();
    })
    .catch(() => {
      /* 忽略 */
    });
}

dotEl.addEventListener('mousedown', onDotMouseDown);
dotEl.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  openPicker(); // mousedown(button2) 已打开时这里是 no-op
});
document.addEventListener('mouseup', (e: MouseEvent) => finishDrag(e.button === 0));
window.addEventListener('mouseup', (e: MouseEvent) => finishDrag(e.button === 0));

// 点击透明区域收起（菜单项已 stopPropagation）；场景面板开着时点空白处先关面板
stageEl.addEventListener('click', (e: MouseEvent) => {
  if (pickerEl && pickerEl.classList.contains('open')) {
    closePicker();
    return;
  }
  if (expanded && e.target === stageEl && config?.appearance?.clickOutsideToClose) collapse();
});

window.addEventListener('blur', () => {
  // 拖动中失焦（例如被别的窗口抢走）也要结束拖动，避免窗口继续跟着光标跑
  if (dragging) finishDrag(false);
  // 面板弹出/撑大窗口的瞬间可能触发一次 blur，短时间内不要立刻关掉
  if (pickerEl && pickerEl.classList.contains('open') && Date.now() - lastPickerAt > 300) closePicker();
  // 展开瞬间可能触发一次 blur，短时间内不要立刻收起
  if (expanded && config?.appearance?.clickOutsideToClose && Date.now() - lastExpandAt > 300) collapse();
});

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closePicker();
    collapse();
  }
});

// 尺寸变化（展开/多屏/拖动）后重新排布菜单
window.addEventListener('resize', () => {
  if (expanded) renderMenu();
  // 收起时窗口从大尺寸缩到小球尺寸是异步落地的，collapse() 里按旧尺寸算的药丸坐标会被窗口裁掉
  //（右下角只露一小块「↗」）→ 等新尺寸真正生效后再重排一次
  else placeLinkedApp();
});

api.onSceneChanged((cfg: any) => {
  config = cfg;
  applySound();
  const scene = currentScene();
  if (!scene) return;
  // 注意：悬停选场景时会连续收到 scene:changed，此时不要关选区（用户可能继续扫到别的场景）
  applySceneStyle(scene);
  if (expanded) {
    api.resizeFloating('expanded', expandedSize(scene));
    window.setTimeout(renderMenu, 90);
  } else {
    api.resizeFloating('collapsed', collapsedSize(scene));
  }
  // 设置页每次保存都会广播整份配置（含「显示链接窗口提示 / 自动避开遮挡 / 停留时长」），
  // 这里顺手重放一次药丸：关掉提示能立刻生效，改了避让/时长也立刻按新规则排。
  setLinkedApp(linkedName);
});

api.onToast((msg: string, kind: string) => showToast(msg, kind));

// 主进程点悬浮球捕获前台应用时主动推送链接窗口名（也可能在切换场景等时被重置）
api.onLinkedApp?.((name: string | null) => setLinkedApp(name));

(async () => {
  try {
    api.logMsg?.('悬浮窗渲染进程已就绪');
    config = await api.getConfig();
    applySound();
    const scene = currentScene();
    if (scene) {
      applySceneStyle(scene);
      api.resizeFloating('collapsed', collapsedSize(scene));
      showScenePill(); // 初始化就先把场景名标签画出来（不依赖链接窗口回调）
    }
    api.logMsg?.('悬浮窗初始化完成（事件已绑定）');
    // 启动时同步一次（若之后有链接窗口名推送，也只是更新变量，药丸仍是场景名）
    api.getLinkedApp?.().then(setLinkedApp).catch(() => {});
  } catch (err: any) {
    api.logMsg?.('初始化失败: ' + (err?.message || String(err)));
  }
})();
})();
