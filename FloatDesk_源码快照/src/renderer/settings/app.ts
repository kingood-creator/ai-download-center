// 设置窗口渲染进程（经典脚本；IIFE 包裹避免全局名冲突，不产生 exports 引用）
(function () {
const api: any = (window as any).api;
const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

let cfg: any = null;
let currentView = 'general';

/** 全局「显示提示文字」：关掉后给 body 挂 hide-hints 类，CSS 统一藏掉 .hint 说明文字 */
function applyShowHints(): void {
  document.body.classList.toggle('hide-hints', cfg?.appearance?.showHints === false);
}

const TITLES: Record<string, string> = {
  general: '常规',
  scenes: '场景管理',
  shortcuts: '快捷键',
  // 项目管理已并入项目库右栏（场景已添加），不再单独占一页
  library: '项目库',
  tools: '工具',
  about: '关于',
};

/** 内置动作清单（输入法切换 / 便签），启动时从主进程拉一次，避免这里复制一份常量后两边对不上 */
let BUILTINS: Array<{ key: string; name: string; icon: string; hint: string }> = [];
function builtinOf(key: string): any {
  return BUILTINS.find((b) => b.key === key) || null;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function genId(p: string): string {
  return p + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}
function typeName(t: string): string {
  // mac 是项目库里的虚拟分类（系统自带项目），不是 MenuItem 的类型
  return { mac: 'mac 系统', web: '网页', app: '应用', file: '文件', image: '图片', shortcut: '快捷键', action: '内置动作' }[t] || t;
}

/** 组合键显示成符号：command+shift+4 → ⌘⇧4（卡片窄，'command+shift+4' 会撑爆副标题） */
function prettyKey(k: string): string {
  const s = String(k || '').trim();
  if (!s) return '';
  return s
    .split('+')
    .map((p) => {
      const t = p.trim().toLowerCase();
      return ({ command: '⌘', cmd: '⌘', shift: '⇧', option: '⌥', alt: '⌥', control: '⌃', ctrl: '⌃', return: '⏎', enter: '⏎', space: '空格', tab: '⇥', delete: '⌫', escape: '⎋', esc: '⎋' } as Record<string, string>)[t] || p.trim();
    })
    .join('');
}

/** 判断一个场景项目是不是「macOS 系统自带」：场景里的项目不存 system 标记，
 *  收藏回项目库时按「类型 + 目标」回查预制库，命中带 system 的预制条目就算系统项目，
 *  否则收藏一次就会从「mac 系统」分类掉到「应用」分类里去。 */
function isSystemBuiltin(it: any): boolean {
  const t = String(it?.type || '');
  const tgt = String(it?.target || '');
  const ks = String(it?.shortcutKeystroke || '');
  return (LIB_PRESETS || []).some((p: any) => {
    if (!p || p.system !== true) return false;
    if (String(p.type || '') !== t) return false;
    if (t === 'shortcut') return String(p.shortcutKeystroke || '') === ks;
    return String(p.target || '') === tgt;
  });
}

/** 项目库分类匹配：mac 系统 ↔ 其它分类互斥（与 shared/itemLibrary.ts 的 matchLibraryType 同步） */
function libMatchType(it: any, type?: string): boolean {
  const t = String(type || '').trim();
  if (!t) return true;
  if (t === 'mac') return it?.system === true;
  if (it?.system === true) return false;
  return String(it?.type || '') === t;
}
/** 目标列显示什么：内置动作显示动作名，其它显示原始 target（不把 ime:switch 这种 key 甩给用户看） */
function targetText(it: any): string {
  if (it.type === 'action') {
    const b = builtinOf(it.target);
    return b ? b.name : String(it.target || '');
  }
  return String(it.target || '');
}
// 各类型的兜底图标：读不到真图标时也不留一个空白/圆点
const TYPE_DEFAULT_ICON: Record<string, string> = { web: '🔗', app: '🧩', file: '📄', image: '🖼', shortcut: '⌨️', action: '⚙️' };
function defaultIconFor(t: string): string {
  return TYPE_DEFAULT_ICON[t] || '•';
}

/**
 * 图标单元格：本地路径 / http(s) / data 图片 → 渲染成 <img>；其它（emoji）→ 当文字显示。
 * 早期版本这里直接把 icon 字段当文字输出，导致下载来的 favicon 路径整串刷在名称列里。
 * 注意：不能用内联 onerror（页面 CSP 禁内联脚本），加载失败交给下面统一的 error 监听隐藏。
 */
function iconCell(it: any): string {
  const ic = String(it.icon || '').trim();
  if (ic && (ic.startsWith('/') || /^https?:\/\//i.test(ic) || ic.startsWith('data:image'))) {
    return `<img class="cellicon" src="${escapeHtml(ic)}" alt="" />`;
  }
  return `<span class="cellicon emoji">${escapeHtml(ic || '•')}</span>`;
}
function currentScene(): any {
  // 停用的场景不能当「当前场景」：配置里 currentSceneId 理论上不会指向停用场景
  //（migrate 与停用操作都会纠正），这里再兜一层，避免悬浮球显示一个已停用的场景
  const hit = cfg.scenes.find((s: any) => s.id === cfg.currentSceneId);
  if (hit && isSceneOn(hit)) return hit;
  return enabledScenes()[0] || cfg.scenes[0];
}
function findItem(id: string): any {
  for (const s of cfg.scenes) {
    const it = s.items.find((i: any) => i.id === id);
    if (it) return it;
  }
  return null;
}
function sceneOfItem(id: string): any {
  for (const s of cfg.scenes) if (s.items.some((i: any) => i.id === id)) return s;
  return currentScene();
}
function renormalize(scene: any): void {
  scene.items.sort((a: any, b: any) => a.order - b.order).forEach((it: any, i: number) => (it.order = i));
}

let toastTimer = 0;
function toast(msg: string, kind = 'info'): void {
  const t = el('toast');
  // 先复位成不带 show 的状态（保留 kind 用于配色），保证连续触发时动画能重放
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = '';
  if (kind === 'success' || kind === 'error') {
    const ic = document.createElement('span');
    ic.className = 'tic';
    ic.textContent = kind === 'success' ? '✓' : '✕';
    t.appendChild(ic);
  }
  const tx = document.createElement('span');
  tx.textContent = msg;
  t.appendChild(tx);
  void (t as HTMLElement).offsetWidth;
  t.classList.add('show');
  if (toastTimer) window.clearTimeout(toastTimer);
  // 注意：必须移除 show 才会淡出（只改 kind 会一直挂在屏幕上）
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2400);
}

// 按钮上的「保存成功」反馈：变绿 + 打勾，1.5s 后复原（toast 只是辅助）
function flashSaved(btn: HTMLElement, label = '已保存'): void {
  if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent || '保存';
  if (btn.dataset.savedTimer) window.clearTimeout(Number(btn.dataset.savedTimer));
  btn.classList.add('saved');
  btn.textContent = '✓ ' + label;
  const timer = window.setTimeout(() => {
    btn.classList.remove('saved');
    btn.textContent = btn.dataset.origLabel || '保存';
    delete btn.dataset.savedTimer;
  }, 1500);
  btn.dataset.savedTimer = String(timer);
}

// ---------- 保存：不打断操作的写盘节奏 ----------
// 以前每个控件一改就立刻 saveConfig：
//   写盘 → 主进程广播 scene:changed → 设置页 renderView() 重建 DOM
//   → 正在拖的滑杆元素被整个换掉，手一松就断在那儿。
// 现在分两档：
//   · 滑杆 / 取色器 / 数字框这类「会连续改」的：拖动过程只更新内存 + 推给悬浮窗预览，
//     松手后进入 5 秒防抖队列，停手 5 秒自动保存；
//   · 开关 / 下拉 / 按钮这类「一次到位」的：立即保存（要立刻生效，也不会打断拖动）。
// 顶部一直显示当前状态，随时可以点「保存」立即落盘。
const AUTO_SAVE_DELAY = 5000;
/** 自己保存后主进程会广播回来；这段时间内不重建 DOM（否则拖到一半照样被打断） */
const SELF_SAVE_WINDOW = 700;
let pendingSave = 0;
let dirty = false;
let ignoreBroadcastUntil = 0;

function setSaveState(kind: 'clean' | 'dirty' | 'saving'): void {
  const t = document.getElementById('saveState');
  if (!t) return;
  t.classList.toggle('dirty', kind === 'dirty');
  t.classList.toggle('saving', kind === 'saving');
  t.classList.toggle('clean', kind === 'clean');
  t.textContent = kind === 'dirty' ? '改动待保存' : kind === 'saving' ? '保存中…' : '已保存';
}

/** 把「还没落盘」的改动推给悬浮窗做实时预览（80ms 节流；只换主进程内存，不写盘） */
let previewTimer = 0;
function pushPreview(): void {
  if (previewTimer) return;
  previewTimer = window.setTimeout(() => {
    previewTimer = 0;
    try {
      const p = api.previewConfig?.(cfg);
      // invoke 的失败是异步的，必须自己接住：老主进程没有这个通道时不该刷一屏未捕获错误
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* 老主进程没有这个通道时忽略：只是没有实时预览，保存后照常生效 */
    }
  }, 80);
}

/**
 * 标记「有改动」：更新状态、按需预览、重置 5 秒自动保存。
 * preview=true 用于滑杆这类需要悬浮窗跟着变的控件。
 */
function markDirty(preview = false): void {
  dirty = true;
  setSaveState('dirty');
  if (preview) pushPreview();
  if (pendingSave) window.clearTimeout(pendingSave);
  pendingSave = window.setTimeout(() => {
    pendingSave = 0;
    void flushSave({ auto: true }); // 停手 5 秒：自动落盘（不写备份、不弹 toast）
  }, AUTO_SAVE_DELAY);
}

/**
 * 落盘。
 * opts.auto = true：5 秒定时器触发 —— 没有待保存改动就跳过，且不写备份；
 * opts.backup：手动点「保存」时才留一份备份（自动保存不留，免得备份目录爆炸）。
 */
async function flushSave(opts?: { auto?: boolean; backup?: boolean }): Promise<boolean> {
  const auto = !!opts?.auto;
  const backup = typeof opts?.backup === 'boolean' ? opts.backup : !auto;
  if (pendingSave) {
    window.clearTimeout(pendingSave);
    pendingSave = 0;
  }
  if (auto && !dirty) return true;
  setSaveState('saving');
  const ok = await persist(false, backup);
  if (!ok) {
    setSaveState('dirty');
    return false;
  }
  dirty = false;
  setSaveState('clean');
  return true;
}

/** 离散控件（开关 / 下拉 / 按钮）改完立刻落盘：这类操作要马上生效，也不会打断拖动 */
function saveNow(backup = false): void {
  dirty = true;
  void flushSave({ auto: false, backup });
}

async function persist(showSuccess = false, backup = true): Promise<boolean> {
  // 关键顺序：**先**开窗再发请求。主进程是在 handler 里同步广播的，
  // 广播可能比 invoke 的响应先到；等响应回来才开窗就来不及了（页面已经重建过一轮）。
  ignoreBroadcastUntil = Date.now() + SELF_SAVE_WINDOW;
  const r = await api.saveConfig(cfg, { backup });
  if (!r.ok) {
    ignoreBroadcastUntil = 0; // 没存成功就别把这个窗口留着，否则会漏掉别人的广播
    toast('保存失败: ' + r.error, 'error');
    return false;
  }
  // 响应回来后重新计时（IPC 往返可能已经消耗掉一部分窗口）
  ignoreBroadcastUntil = Date.now() + SELF_SAVE_WINDOW;
  if (showSuccess) toast('已保存', 'success');
  return true;
}

// ---------- 按键录制 ----------
function accFromEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.metaKey) mods.push('Command');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (key.startsWith('Arrow')) key = key.slice(5);
  else if (['Enter', 'Tab', 'Backspace', 'Delete', 'Escape'].includes(key)) return mods.join('+') || '';
  if (!key) return '';
  return [...mods, key].join('+');
}
// 当前按住的修饰键（仅用于录制时的实时反馈，不形成最终快捷键）
function heldModsLabel(e: KeyboardEvent): string {
  const m: string[] = [];
  if (e.metaKey) m.push('Command');
  if (e.ctrlKey) m.push('Control');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey) m.push('Shift');
  return m.join('+');
}
function isModifierKey(e: KeyboardEvent): boolean {
  return (
    e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' ||
    e.key === 'MetaLeft' || e.key === 'MetaRight' || e.key === 'ControlLeft' ||
    e.key === 'ControlRight' || e.key === 'AltLeft' || e.key === 'AltRight' ||
    e.key === 'ShiftLeft' || e.key === 'ShiftRight'
  );
}

// 录制流程：点「录制」进入监听 → 按住修饰键（Command/Control/Alt/Shift）时只做实时反馈、
// 不提交 → 按下主键（字母/数字/F 键等）时连同当前所有修饰键一起提交；Esc 取消；
// 再点一次或 8 秒超时自动取消。这样组合键不再「一碰修饰键就录完」，容易录成功。
//
// 系统快捷键屏蔽（默认开，可在「常规 → 行为」关掉）：
//   进入录制时通知主进程启动 bin/keyblock —— 它装一个 session 级键盘事件 tap，
//   吞掉所有键盘事件，系统快捷键（如 Command+Shift+4 截图）就不会抢先执行；
//   同时把识别出的组合键逐行回报（rec:key）。注意 tap 也会吞掉本页面的 keydown，
//   所以 nativeOn = true 时录制输入以 keyblock 的回报为准；keyblock 起不来
//   （缺二进制/没权限）时主进程回报 native=false，自动退回原来的 DOM 捕获。
/** 录制中标记：全局按键守卫靠它让路（录制时 ⌘A/⌘C 也要能被录下来） */
let recActive = false;

function attachRecorder(btn: HTMLElement, onDone: (acc: string | null) => void): void {
  const label = btn.textContent || '录制';
  let active = false;
  let cleanup: (() => void) | null = null;

  btn.addEventListener('click', () => {
    if (active) {
      if (cleanup) cleanup();
      return;
    }
    active = true;
    recActive = true;
    btn.classList.add('on');
    btn.textContent = '按下组合键… (Esc 取消)';
    btn.blur(); // 失焦，避免录制时用空格/回车又触发这个按钮
    let finished = false;
    let timer = 0;
    let nativeOn = false;
    let offNative: (() => void) | null = null;
    let offKey: (() => void) | null = null;

    const finish = (acc: string | null): void => {
      if (finished) return;
      finished = true;
      active = false;
      recActive = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      if (offNative) { offNative(); offNative = null; }
      if (offKey) { offKey(); offKey = null; }
      try { api.setRecording(false); } catch { /* 老主进程没这个桥时忽略 */ }
      btn.classList.remove('on');
      btn.textContent = label;
      cleanup = null;
      onDone(acc);
    };

    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        finish(null);
        return;
      }
      // 只按下了修饰键：继续等待主键，并给出实时反馈
      if (isModifierKey(e)) {
        const held = heldModsLabel(e);
        btn.textContent = (held ? '已按住 ' + held : '按下组合键…') + ' (Esc 取消)';
        return;
      }
      // 非修饰键：连同当前所有修饰键一起提交（这里修饰键必然仍按住）
      finish(accFromEvent(e));
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      // 主键还没按下、修饰键又松开了：回退到等待提示，保持录制
      if (!finished && isModifierKey(e)) btn.textContent = '按下组合键… (Esc 取消)';
    };

    // keyblock 回报的修饰名（command,shift…）转成显示名
    const fmtHeld = (s: string): string =>
      s
        .split(',')
        .map((m) => ({ command: 'Command', control: 'Control', option: 'Alt', shift: 'Shift' }[m.trim()] || m.trim()))
        .join('+');

    // 进入录制：通知主进程起 keyblock；native 状态由主进程回报确认
    try { api.setRecording(true); } catch { /* 老主进程没这个桥时忽略 */ }
    offNative = api.onRecNative((native: boolean) => {
      nativeOn = native;
      if (native && active) btn.textContent = '已屏蔽系统快捷键，按下组合键… (Esc 取消)';
    });
    offKey = api.onRecKey((line: string) => {
      if (finished) return;
      if (line.startsWith('KEY ')) finish(line.slice(4).trim());
      else if (line === 'ESCAPE') finish(null);
      else if (line.startsWith('HELD ')) {
        const held = fmtHeld(line.slice(5).trim());
        btn.textContent = (held ? '已按住 ' + held : '按下组合键…') + ' (Esc 取消)';
      }
    });

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    timer = window.setTimeout(() => finish(null), 8000); // 8 秒超时，避免一直挂着
    cleanup = () => finish(null);
  });
}

// ---------- 模态 ----------
function openModal(html: string, onMount?: (m: HTMLElement) => void): void {
  const m = el('modal');
  // 上一轮弹窗可能挂过附加类（书签导入要用宽版），先复位
  m.className = 'modal';
  m.innerHTML = html;
  el('modalBg').classList.add('show');
  if (onMount) onMount(m);
}
function closeModal(): void {
  el('modalBg').classList.remove('show');
  el('modal').innerHTML = '';
  el('modal').className = 'modal';
}

// ---------- 图标库（userData/icon-library 这个内部文件夹） ----------
// 两种用法：Finder 里直接往这个文件夹扔图标文件（或删改）；设置页里拖放 / 点选 / 删除。
// 点选某个图标时，主进程会把它复制一份进 item-icons 缓存再返回缓存路径——
// 这样以后在库里删掉这个文件，已经用上它的项目也不会变空白图。
interface LibIcon {
  name: string;
  path: string;
  size: number;
  mtime: number;
}
let libIcons: LibIcon[] = [];
/** 图标库浮层处于「选图模式」时的命中回调（项目编辑弹窗用来回填图标输入框） */
let libOnPick: ((cachePath: string) => void) | null = null;

function libGridHtml(icons: LibIcon[], delAttr: string | null = 'data-libdel'): string {
  if (!icons.length) {
    return `<div class="lib-empty">图标库还是空的——把图标文件拖到上方虚线框里，或点「打开文件夹」直接往里面扔。</div>`;
  }
  return (
    `<div class="lib-grid">` +
    icons
      .map(
        (ic) => `
      <div class="lib-tile" data-libpath="${escapeHtml(ic.path)}" title="${escapeHtml(ic.name)}">
        <img src="${escapeHtml(ic.path)}" alt="" loading="lazy" />
        <span class="nm">${escapeHtml(ic.name)}</span>
        ${delAttr ? `<button class="x" ${delAttr}="${escapeHtml(ic.path)}" type="button" title="从图标库删除">×</button>` : ''}
      </div>`
      )
      .join('') +
    `</div>`
  );
}

async function refreshLibGrids(): Promise<void> {
  libIcons = (await api.iconLibList()) || [];
  // 浮层里的网格（带删除按钮）
  const wrap = document.getElementById('lib-grid-wrap');
  if (wrap) wrap.innerHTML = libGridHtml(libIcons);
  const cnt = document.getElementById('lib-count');
  if (cnt) cnt.textContent = `${libIcons.length} 个图标`;
  // 工具页管理卡片里的网格（删除按钮用另一个属性名，事件委托分开挂，避免误删）
  const wrap2 = document.getElementById('lib-grid-wrap2');
  if (wrap2) wrap2.innerHTML = libGridHtml(libIcons, 'data-libdel2');
  const c2 = document.getElementById('lib-count2');
  if (c2) c2.textContent = `${libIcons.length} 个图标`;
}

/** 拖进来的文件加进图标库：优先拿本地路径；拿不到（浏览器里拖的图）走 dataURL */
async function addDroppedFiles(files: FileList): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  for (const f of Array.from(files)) {
    let r: any = null;
    const p = api.pathForFile(f);
    if (p) {
      r = await api.iconLibAdd({ path: p });
    } else {
      const dataUrl = await new Promise<string>((resolve) => {
        const rd = new FileReader();
        rd.onload = () => resolve(String(rd.result || ''));
        rd.onerror = () => resolve('');
        rd.readAsDataURL(f);
      });
      if (dataUrl) r = await api.iconLibAdd({ name: f.name, dataUrl });
    }
    if (r && r.ok) ok++;
    else fail++;
  }
  return { ok, fail };
}

/** 给容器挂拖放：dragover 高亮，drop 收文件进库并刷新网格 */
function bindLibDrop(host: HTMLElement): void {
  host.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    host.classList.add('dropping');
  });
  host.addEventListener('dragleave', () => host.classList.remove('dropping'));
  host.addEventListener('drop', async (e) => {
    e.preventDefault();
    host.classList.remove('dropping');
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    const r = await addDroppedFiles(files);
    await refreshLibGrids();
    toast(
      r.fail ? `已添加 ${r.ok} 个，${r.fail} 个失败（只支持图片文件）` : `已添加 ${r.ok} 个图标到图标库`,
      r.fail ? 'info' : 'success'
    );
  });
}

/** 删除库内图标（浮层与工具页卡片共用；事件委托在各自容器上挂） */
async function deleteLibIcon(p: string): Promise<void> {
  const r = await api.iconLibDelete(p);
  await refreshLibGrids();
  toast(r.ok ? '已从图标库删除' : '删除失败：' + (r.error || '未知错误'), r.ok ? 'success' : 'error');
}

/**
 * 跨场景找「相同项目」（同名 + 同目标 + 同类型，排除自己）——规则与
 * shared/items.ts 的 sameProjectMatches 保持一致（渲染进程是经典脚本，
 * 不能 import 值，这里各存一份；改动时两边同步）。
 */
function sameProjectItems(item: any): any[] {
  const name = String(item.name || '').trim();
  const target = String(item.target || '').trim();
  const type = String(item.type || '');
  if (!name) return [];
  const out: any[] = [];
  for (const s of cfg.scenes) {
    for (const x of s.items || []) {
      if (!x || x.id === item.id) continue;
      if (String(x.name || '').trim() !== name) continue;
      if (String(x.target || '').trim() !== target) continue;
      if (String(x.type || '') !== type) continue;
      out.push(x);
    }
  }
  return out;
}

/**
 * 打开图标库浮层。
 * onPick 传了就是「选图模式」：点某个图标 → 复制进缓存 → 回调缓存路径 → 关闭；
 * 不传就是「管理模式」（工具页入口），点图标不做事。
 */
async function openIconLibrary(onPick?: (cachePath: string) => void): Promise<void> {
  libOnPick = onPick || null;
  const bg = document.getElementById('iconlibBg') as HTMLElement;
  const panel = document.getElementById('iconlib') as HTMLElement;
  libIcons = (await api.iconLibList()) || [];
  panel.innerHTML = `
    <h3>图标库</h3>
    <div class="lib-tools">
      <span class="hint" style="margin:0" id="lib-count">${libIcons.length} 个图标</span>
      <span class="grow"></span>
      <button class="btn sm ghost" id="lib-open" type="button">打开文件夹</button>
      <button class="btn sm ghost" id="lib-pickfile" type="button">从文件选择…</button>
      <button class="btn sm ghost" id="lib-refresh" type="button">刷新</button>
    </div>
    <div class="lib-drop" id="lib-drop">把图标文件拖到这里即可加入图标库（png / jpg / gif / webp / svg / bmp / ico，单个 ≤8MB）</div>
    <div id="lib-grid-wrap">${libGridHtml(libIcons)}</div>
    <div class="lib-actions"><button class="btn ghost" id="lib-close" type="button">关闭</button></div>`;
  bg.classList.add('show');

  (panel.querySelector('#lib-close') as HTMLButtonElement).addEventListener('click', () => {
    bg.classList.remove('show');
    libOnPick = null;
  });
  bg.addEventListener('click', (e) => {
    if (e.target === bg) {
      bg.classList.remove('show');
      libOnPick = null;
    }
  });
  (panel.querySelector('#lib-open') as HTMLButtonElement).addEventListener('click', async () => {
    const r = await api.iconLibReveal();
    if (!r || !r.ok) toast('打开文件夹失败：' + ((r && r.error) || '未知错误'), 'error');
  });
  (panel.querySelector('#lib-refresh') as HTMLButtonElement).addEventListener('click', () => refreshLibGrids());
  (panel.querySelector('#lib-pickfile') as HTMLButtonElement).addEventListener('click', async () => {
    const r = await api.selectIconImage();
    if (r && r.path) {
      const add = await api.iconLibAdd({ path: r.path });
      await refreshLibGrids();
      if (!add || !add.ok) toast('添加失败：' + ((add && add.error) || '未知错误'), 'error');
    }
  });
  bindLibDrop(panel.querySelector('#lib-drop') as HTMLElement);
  // 网格事件委托：点图标 = 选用；点 × = 删除
  const wrap = panel.querySelector('#lib-grid-wrap') as HTMLElement;
  wrap.addEventListener('click', async (e) => {
    const delBtn = (e.target as HTMLElement).closest('[data-libdel]') as HTMLElement | null;
    if (delBtn) {
      e.stopPropagation();
      const p = delBtn.dataset.libdel!;
      if (confirm(`确定从图标库删除「${p.split('/').pop()}」？\n（已经用上它的项目不受影响）`)) {
        await deleteLibIcon(p);
      }
      return;
    }
    const tile = (e.target as HTMLElement).closest('[data-libpath]') as HTMLElement | null;
    if (!tile || !libOnPick) return;
    const r = await api.iconLibUse(tile.dataset.libpath!);
    if (r && r.ok && r.path) {
      const cb = libOnPick;
      bg.classList.remove('show');
      libOnPick = null;
      cb(r.path);
    } else {
      toast('图标读取失败：' + ((r && r.error) || '未知错误'), 'error');
    }
  });
}

// ---------- 菜单音效 ----------
// 预制清单在 shared/sounds.ts（主进程的权威版本），这里通过 IPC 拉一份，避免两边各写一张表对不上。
let SND_PRESETS: any[] = [];
let SND_GROUPS: any = { sys: 'macOS 系统音效', synth: '合成音效（不依赖系统文件）' };
let sndLoaded = false;

/** 配置里的音效设置（老配置可能没有这一节，按默认补） */
function soundCfg(): any {
  const s = cfg && cfg.sound ? cfg.sound : {};
  const v = Number(s.volume);
  return {
    enabled: s.enabled !== false,
    hover: s.hover === undefined ? 'tink' : String(s.hover || 'none'),
    click: s.click === undefined ? 'pop' : String(s.click || 'none'),
    open: s.open === undefined ? 'none' : String(s.open || 'none'),
    volume: Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 45,
  };
}

/** 下拉选项：不播放 + 两组 optgroup（系统音效 / 合成音效） */
function soundOptions(selected: string): string {
  const none = `<option value="none" ${!selected || selected === 'none' ? 'selected' : ''}>不播放</option>`;
  if (!SND_PRESETS.length) {
    // 清单还没到：先把当前值显示出来，别让下拉变成空的
    return none + (selected && selected !== 'none'
      ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`
      : '');
  }
  let out = none;
  for (const g of ['sys', 'synth']) {
    const items = SND_PRESETS.filter((p: any) => p.group === g);
    if (!items.length) continue;
    out += `<optgroup label="${escapeHtml(SND_GROUPS[g] || g)}">` + items.map((p: any) =>
      `<option value="${escapeHtml(p.id)}" title="${escapeHtml(p.desc || '')}"${selected === p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('') + '</optgroup>';
  }
  return out;
}

/** 拉一次预制清单（拿到后重绘常规页，下拉才有内容） */
async function ensureSoundPresets(): Promise<void> {
  if (sndLoaded) return;
  sndLoaded = true;
  try {
    const r = await api.soundPresets?.();
    SND_PRESETS = (r && r.presets) || [];
    if (r && r.groups) SND_GROUPS = r.groups;
  } catch {
    SND_PRESETS = [];
  }
  if (currentView === 'general') renderGeneral();
}

/** 把设置推给音效引擎（设置页只用于试听；悬浮窗自己从配置读） */
function applySoundEngine(): void {
  try {
    (window as any).FDSound?.configure?.(soundCfg());
  } catch {
    /* 音效挂掉不影响设置页 */
  }
}

// ---------- 视图：常规（场景 / 外观 / 行为 / 悬浮球 / 音效 / 快捷键，合成一页） ----------
// 以前「常规」和「外观」是两页，各有一个场景下拉，调完颜色再回去改动画要来回跳。
// 现在合成一页：左栏是「这个场景长什么样」，右栏是「全局行为」，一屏就能看完。
let appearSceneId: string | null = null;
function appearanceScene(): any {
  return (appearSceneId && cfg.scenes.find((s: any) => s.id === appearSceneId)) || currentScene();
}

function renderGeneral(): void {
  const c = cfg;
  void ensureSoundPresets();
  applySoundEngine();
  const snd = soundCfg();
  const s = appearanceScene();
  // 「正在操控的窗口」提示药丸的默认值（与 defaults.ts 保持一致）：磨砂浓度 1，文字纯白 #ffffff
  const linkedBgRaw = Number(c.appearance.linkedAppBgOpacity);
  const linkedBgVal = Number.isFinite(linkedBgRaw) && linkedBgRaw > 0 ? Math.max(0.1, Math.min(1, linkedBgRaw)) : 1;
  const linkedFgVal = /^#[0-9a-fA-F]{6}$/.test(c.appearance.linkedAppTextColor || '') ? c.appearance.linkedAppTextColor : '#ffffff';
  const pickerPad = Math.max(4, Math.min(28, Math.round(Number(c.appearance.pickerRowPad) || 12)));
  const sceneOpts = c.scenes
    .map(
      (x: any) =>
        `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.id === c.currentSceneId ? '（当前）' : ''}${isSceneOn(x) ? '' : '（未启用）'}</option>`
    )
    .join('');
  const isCurrent = s.id === c.currentSceneId;

  el('view-general').innerHTML = `
    <div class="grid2">
      <div class="col">
        <div class="card">
          <div class="cardhead"><h3>场景</h3>
            <div class="headctl">
              <select id="ap-scene">${sceneOpts}</select>
              ${isCurrent
                ? '<span class="pill">当前场景</span>'
                : '<button class="btn sm" id="ap-setcur" type="button">切换到此场景</button>'}
              <button class="btn sm ghost" id="ap-edit-scene" type="button">编辑信息</button>
            </div>
          </div>
          <div class="hint">下面的外观调这个场景；「切换到此场景」会换掉悬浮菜单。</div>
        </div>

        <div class="card">
          <div class="cardhead"><h3>外观</h3>
            <div class="headctl"><button class="btn sm ghost" id="ap-apply-all" type="button">套用到所有场景</button></div>
          </div>
          <div class="row"><label>主题色</label><div class="ctl">
            <input type="color" id="a-color" value="${escapeHtml(s.themeColor)}">
            <span class="hint hval" style="margin:0" id="a-color-v">${escapeHtml(s.themeColor)}</span>
            <span class="dotpreview sm" id="a-color-dot" style="--pv:${escapeHtml(s.themeColor)};--pv2:${escapeHtml(s.gradientColor || s.themeColor)};--pva:${Number(s.gradientAngle) || 145}deg"></span>
          </div></div>
          <div class="row"><label>渐变叠加色</label><div class="ctl">
            <input type="color" id="a-color2" value="${escapeHtml(s.gradientColor || s.themeColor)}">
            <span class="hint hval" style="margin:0" id="a-color2-v">${escapeHtml(s.gradientColor || s.themeColor)}</span>
            <button class="btn sm ghost" id="a-color2-same" type="button" title="取消渐变，变回纯色圆点">改成主色</button>
          </div></div>
          <div class="row"><label>渐变角度</label><div class="ctl">
            <input type="range" id="a-angle" min="0" max="360" step="5" value="${Number(s.gradientAngle) || 145}">
            <span class="tag" id="a-angle-v">${Number(s.gradientAngle) || 145}°</span>
          </div></div>
          <div class="row"><label>玻璃透明度</label><div class="ctl">
            <input type="range" id="a-glass" min="0.2" max="0.95" step="0.05" value="${s.glassOpacity}">
            <span class="tag" id="a-glass-v">${s.glassOpacity}</span>
          </div></div>
          <div class="row"><label>圆点大小</label><div class="ctl">
            <input type="range" id="a-dot" min="40" max="120" step="2" value="${s.dotSize}">
            <span class="tag" id="a-dot-v">${s.dotSize}px</span>
          </div></div>
          <div class="row"><label>环形半径</label><div class="ctl">
            <input type="range" id="a-ring" min="80" max="200" step="2" value="${s.ringRadius}">
            <span class="tag" id="a-ring-v">${s.ringRadius}px</span>
          </div></div>
          <div class="row"><label>图标尺寸</label><div class="ctl">
            <input type="range" id="a-icon" min="28" max="64" step="2" value="${s.iconSize}">
            <span class="tag" id="a-icon-v">${s.iconSize}px</span>
          </div></div>
          <div class="row"><label>菜单透明度</label><div class="ctl">
            <input type="range" id="a-menu" min="0.4" max="1" step="0.05" value="${s.menuOpacity}">
            <span class="tag" id="a-menu-v">${s.menuOpacity}</span>
          </div></div>
          <div class="row"><label>菜单布局</label><div class="ctl">
            <select id="a-layout">
              <option value="radial" ${s.layout === 'radial' ? 'selected' : ''}>环形</option>
              <option value="grid" ${s.layout === 'grid' ? 'selected' : ''}>网格</option>
              <option value="list" ${s.layout === 'list' ? 'selected' : ''}>列表</option>
            </select>
          </div></div>
          <div class="row"><label>显示名称</label><div class="ctl">
            <label class="switch"><input type="checkbox" id="a-labels" ${s.showLabels ? 'checked' : ''}><span class="slider"></span></label>
            <span class="hint" style="margin:0">菜单里每个图标下面带名字</span>
          </div></div>
          <div class="hint">按场景保存；改动实时预览，停手 5 秒或点「保存」写盘。</div>
        </div>

        <div class="card">
          <h3>悬浮球</h3>
          <div class="row"><label>圆点动画</label><div class="ctl">
            <select id="g-anim">
              <option value="pulse" ${c.appearance.dotAnimation === 'pulse' ? 'selected' : ''}>脉冲（默认）</option>
              <option value="breathing" ${c.appearance.dotAnimation === 'breathing' ? 'selected' : ''}>呼吸</option>
              <option value="energy" ${c.appearance.dotAnimation === 'energy' ? 'selected' : ''}>能量环</option>
              <option value="none" ${c.appearance.dotAnimation === 'none' ? 'selected' : ''}>无</option>
            </select>
          </div></div>
          <div class="row"><label>场景名标签</label><div class="ctl">
            <label class="switch"><input type="checkbox" id="g-linksw" ${c.appearance.linkedAppEnabled !== false ? 'checked' : ''}><span class="slider"></span></label>
            <span class="hint" style="margin:0">圆点上方那条场景名（如「全局场景」），切换/新建场景自动变</span>
          </div></div>
          <div class="row"><label>提示停留时长</label><div class="ctl">
            <select id="g-linkdur">
              <option value="0" ${Number(c.appearance.linkedAppDuration) > 0 ? '' : 'selected'}>常驻显示</option>
              ${[1, 2, 3, 5, 10].map((x) => `<option value="${x}" ${Number(c.appearance.linkedAppDuration) === x ? 'selected' : ''}>${x} 秒后淡出</option>`).join('')}
            </select>
          </div></div>
          <div class="row"><label>提示磨砂</label><div class="ctl">
            <input type="range" id="g-linkbg" min="0.1" max="1" step="0.05" value="${linkedBgVal}">
            <span class="tag" id="g-linkbg-v">${Math.round(linkedBgVal * 100)}%</span>
            <span class="hint" style="margin:0">胶囊越淡越不挡视线</span>
          </div></div>
          <div class="row"><label>提示文字色</label><div class="ctl">
            <input type="color" id="g-linkfg" value="${linkedFgVal}">
            <span class="hint hval" style="margin:0" id="g-linkfg-v">${linkedFgVal}</span>
          </div></div>
        </div>
      </div>

      <div class="col">
        <div class="card">
          <h3>行为</h3>
          <div class="row"><label>开机启动</label><div class="ctl"><label class="switch"><input type="checkbox" id="g-login" ${c.appearance.openAtLogin ? 'checked' : ''}><span class="slider"></span></label></div></div>
          <div class="row"><label>始终置顶</label><div class="ctl"><label class="switch"><input type="checkbox" id="g-top" ${c.appearance.alwaysOnTop ? 'checked' : ''}><span class="slider"></span></label></div></div>
          <div class="row"><label>点击其他区域收起</label><div class="ctl"><label class="switch"><input type="checkbox" id="g-click" ${c.appearance.clickOutsideToClose ? 'checked' : ''}><span class="slider"></span></label></div></div>
          <div class="row"><label>减少动态效果</label><div class="ctl"><label class="switch"><input type="checkbox" id="g-rm" ${c.appearance.reduceMotion ? 'checked' : ''}><span class="slider"></span></label></div></div>
          <div class="row"><label>显示提示文字</label><div class="ctl"><label class="switch"><input type="checkbox" id="g-hints" ${c.appearance.showHints !== false ? 'checked' : ''}><span class="slider"></span></label><span class="hint" style="margin:0">各页灰色说明文字</span></div></div>
          <div class="row"><label>录制时屏蔽系统键</label><div class="ctl"><label class="switch"><input type="checkbox" id="g-block" ${c.appearance.blockKeysWhileRecording !== false ? 'checked' : ''}><span class="slider"></span></label></div></div>
          <div class="hint">录制期间屏蔽系统快捷键，需辅助功能权限。</div>
        </div>

        <div class="card">
          <h3>菜单音效</h3>
          <div class="row"><label>启用音效</label><div class="ctl">
            <label class="switch"><input type="checkbox" id="g-snd-on" ${snd.enabled ? 'checked' : ''}><span class="slider"></span></label>
            <span class="hint" style="margin:0">关掉后菜单静音</span>
          </div></div>
          <div class="row"><label>移到按钮上</label><div class="ctl">
            <select id="g-snd-hover">${soundOptions(snd.hover)}</select>
            <button class="btn sm" type="button" data-snd-prev="hover">试听</button>
          </div></div>
          <div class="row"><label>点击项目</label><div class="ctl">
            <select id="g-snd-click">${soundOptions(snd.click)}</select>
            <button class="btn sm" type="button" data-snd-prev="click">试听</button>
          </div></div>
          <div class="row"><label>展开 / 收起</label><div class="ctl">
            <select id="g-snd-open">${soundOptions(snd.open)}</select>
            <button class="btn sm" type="button" data-snd-prev="open">试听</button>
          </div></div>
          <div class="row"><label>音量</label><div class="ctl">
            <input type="range" id="g-snd-vol" min="0" max="100" step="5" value="${snd.volume}">
            <span class="tag" id="g-snd-vol-v">${snd.volume}%</span>
          </div></div>
          <div class="hint">${SND_PRESETS.length
            ? `${SND_PRESETS.length} 个预制音效（系统音效 + 合成音效）；悬停默认「清脆叮 Tink」，扫一圈 40ms 内只响一次。`
            : '正在读取预制音效…'}</div>
        </div>

        <div class="card">
          <h3>右键场景选区</h3>
          <div class="row"><label>宽度</label><div class="ctl">
            <input type="number" id="g-pw" min="120" max="760" step="10" class="num" value="${Number(c.appearance.pickerWidth) > 0 ? Number(c.appearance.pickerWidth) : ''}" placeholder="自动">
            <span class="tag">px</span>
          </div></div>
          <div class="row"><label>高度</label><div class="ctl">
            <input type="number" id="g-ph" min="120" max="760" step="10" class="num" value="${Number(c.appearance.pickerHeight) > 0 ? Number(c.appearance.pickerHeight) : ''}" placeholder="自动">
            <span class="tag">px</span>
          </div></div>
          <div class="row"><label>文字边距</label><div class="ctl">
            <input type="range" id="g-ppad" min="4" max="28" step="2" value="${pickerPad}">
            <span class="tag" id="g-ppad-v">${pickerPad}px</span>
          </div></div>
          <div class="hint">右键圆点弹出的选区大小；宽高留空 = 自动（120–760）。</div>
        </div>

        <div class="card">
          <h3>全局快捷键</h3>
          <div class="row"><label>唤出 / 隐藏菜单</label><div class="ctl">
            <span class="tag" id="g-win">${escapeHtml(c.appearance.windowShortcut || '未设置')}</span>
            <button class="btn sm rec" id="g-win-rec" type="button">修改</button>
          </div></div>
          <div class="row"><label>切换场景</label><div class="ctl">
            <span class="tag" id="g-sc">${escapeHtml(c.appearance.sceneSwitchShortcut || '未设置')}</span>
            <button class="btn sm rec" id="g-sc-rec" type="button">修改</button>
          </div></div>
          <div class="hint">任何应用在前台都生效；和系统或别的应用撞车时，保存后会提示注册失败。</div>
        </div>
      </div>
    </div>`;

  // ---- 场景：选中的场景决定「外观」改谁 ----
  el('ap-scene').addEventListener('change', (e: any) => {
    appearSceneId = e.target.value;
    renderGeneral();
  });
  if (el('ap-setcur')) {
    el('ap-setcur').addEventListener('click', () => {
      cfg.currentSceneId = s.id;
      renderGeneral(); // 下拉里的「（当前）」标记 + 按钮状态要跟着变
      saveNow(); // 切场景会触发自动启动，必须立刻落盘
    });
  }
  el('ap-edit-scene').addEventListener('click', () => openSceneModal(s));
  el('ap-apply-all').addEventListener('click', () => {
    const keys = ['themeColor', 'gradientColor', 'gradientAngle', 'glassOpacity', 'dotSize', 'ringRadius', 'iconSize', 'menuOpacity', 'layout', 'showLabels'];
    cfg.scenes.forEach((x: any) => {
      if (x.id === s.id) return;
      keys.forEach((k) => (x[k] = (s as any)[k]));
      x.updatedAt = Date.now();
    });
    saveNow();
    toast('已套用到全部 ' + cfg.scenes.length + ' 个场景', 'success');
  });

  // ---- 行为（开关 / 下拉：一次到位，立即保存） ----
  const bindSwitch = (id: string, apply: (on: boolean) => void) => {
    el(id).addEventListener('change', (e: any) => {
      apply(!!e.target.checked);
      saveNow();
    });
  };
  bindSwitch('g-login', (on) => (c.appearance.openAtLogin = on));
  bindSwitch('g-top', (on) => (c.appearance.alwaysOnTop = on));
  bindSwitch('g-click', (on) => (c.appearance.clickOutsideToClose = on));
  bindSwitch('g-rm', (on) => (c.appearance.reduceMotion = on));
  bindSwitch('g-block', (on) => (c.appearance.blockKeysWhileRecording = on));
  bindSwitch('g-hints', (on) => {
    c.appearance.showHints = on;
    applyShowHints(); // 改完立即生效（body 类驱动，不用等保存）
  });
  el('g-anim').addEventListener('change', (e: any) => {
    c.appearance.dotAnimation = e.target.value;
    saveNow();
  });
  bindSwitch('g-linksw', (on) => (c.appearance.linkedAppEnabled = on));
  el('g-linkdur').addEventListener('change', (e: any) => {
    const n = Math.round(Number(e.target.value));
    c.appearance.linkedAppDuration = Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(60, n)) : 0;
    saveNow();
  });

  // ---- 连续控件（滑杆 / 取色器 / 数字框）：拖动过程只预览，松手后 5 秒自动保存 ----
  // input 阶段：写内存 + 更新读数 + 推悬浮窗预览（不写盘，所以不会重建 DOM 打断拖动）
  const bindLive = (id: string, read: (v: string) => void, label?: (v: string) => void) => {
    const inp = el(id) as HTMLInputElement;
    inp.addEventListener('input', () => {
      read(inp.value);
      if (label) label(inp.value);
      markDirty(true);
    });
    // 松手：把定时器重新起算（拖动中每次 input 都会重置，等价于「停手 5 秒后保存」）
    inp.addEventListener('change', () => {
      read(inp.value);
      markDirty(false);
    });
    return inp;
  };

  // 外观：主题色 / 叠加色 / 角度 / 尺寸类
  bindLive(
    'a-color',
    (v) => {
      s.themeColor = v;
      s.updatedAt = Date.now();
      el('a-color-dot').style.setProperty('--pv', v);
    },
    (v) => ((el('a-color-v') as HTMLElement).textContent = v)
  );
  bindLive(
    'a-color2',
    (v) => {
      s.gradientColor = v;
      s.updatedAt = Date.now();
      el('a-color-dot').style.setProperty('--pv2', v);
    },
    (v) => ((el('a-color2-v') as HTMLElement).textContent = v)
  );
  bindLive(
    'a-angle',
    (v) => {
      s.gradientAngle = Number(v);
      s.updatedAt = Date.now();
      el('a-color-dot').style.setProperty('--pva', v + 'deg');
    },
    (v) => ((el('a-angle-v') as HTMLElement).textContent = v + '°')
  );
  const bindSceneRange = (id: string, key: string, suffix = '') => {
    bindLive(
      id,
      (v) => {
        (s as any)[key] = parseFloat(v);
        s.updatedAt = Date.now();
      },
      (v) => ((el(id + '-v') as HTMLElement).textContent = v + suffix)
    );
  };
  bindSceneRange('a-glass', 'glassOpacity');
  bindSceneRange('a-dot', 'dotSize', 'px');
  bindSceneRange('a-ring', 'ringRadius', 'px');
  bindSceneRange('a-icon', 'iconSize', 'px');
  bindSceneRange('a-menu', 'menuOpacity');
  el('a-color2-same').addEventListener('click', () => {
    // 就地更新，不整页重建（否则滚动位置会跳回顶部）
    s.gradientColor = s.themeColor;
    s.updatedAt = Date.now();
    (el('a-color2') as HTMLInputElement).value = s.themeColor;
    (el('a-color2-v') as HTMLElement).textContent = s.themeColor;
    el('a-color-dot').style.setProperty('--pv2', s.themeColor);
    saveNow();
  });
  el('a-layout').addEventListener('change', (e: any) => {
    s.layout = e.target.value;
    saveNow();
  });
  el('a-labels').addEventListener('change', (e: any) => {
    s.showLabels = e.target.checked;
    saveNow();
  });

  // 悬浮球提示药丸：背景透明度 / 文字颜色
  bindLive(
    'g-linkbg',
    (v) => {
      const n = Math.max(0.1, Math.min(1, Number(v) || 1));
      c.appearance.linkedAppBgOpacity = n;
    },
    (v) => ((el('g-linkbg-v') as HTMLElement).textContent = Math.round(Math.max(0.1, Math.min(1, Number(v) || 1)) * 100) + '%')
  );
  bindLive(
    'g-linkfg',
    (v) => {
      if (/^#[0-9a-fA-F]{6}$/.test(v)) c.appearance.linkedAppTextColor = v;
    },
    (v) => ((el('g-linkfg-v') as HTMLElement).textContent = v)
  );

  // 选区窗口宽高：留空 = 自动(0)，填了夹到 120–760
  const bindPickerDim = (id: string, key: 'pickerWidth' | 'pickerHeight') => {
    el(id).addEventListener('change', (e: any) => {
      const n = Math.round(Number(e.target.value));
      c.appearance[key] = Number.isFinite(n) && n > 0 ? Math.max(120, Math.min(760, n)) : 0;
      (e.target as HTMLInputElement).value = c.appearance[key] > 0 ? String(c.appearance[key]) : '';
      saveNow();
    });
  };
  bindPickerDim('g-pw', 'pickerWidth');
  bindPickerDim('g-ph', 'pickerHeight');
  bindLive(
    'g-ppad',
    (v) => {
      c.appearance.pickerRowPad = Math.max(4, Math.min(28, Math.round(Number(v) || 12)));
    },
    (v) => ((el('g-ppad-v') as HTMLElement).textContent = Math.max(4, Math.min(28, Math.round(Number(v) || 12))) + 'px')
  );

  // 取消（Esc / 超时 / 再点一次）一律 null，不覆盖已有快捷键；只有真正录到组合键才写。
  // 全局快捷键要主进程当场注册，所以这里不等 5 秒，立刻保存。
  attachRecorder(el('g-win-rec'), (acc) => {
    if (!acc) return;
    c.appearance.windowShortcut = acc;
    el('g-win').textContent = acc;
    saveNow();
  });
  attachRecorder(el('g-sc-rec'), (acc) => {
    if (!acc) return;
    c.appearance.sceneSwitchShortcut = acc;
    el('g-sc').textContent = acc;
    saveNow();
  });

  // ---- 菜单音效 ----
  el('g-snd-on').addEventListener('change', (e: any) => {
    cfg.sound = { ...soundCfg(), enabled: !!e.target.checked };
    applySoundEngine();
    saveNow();
  });
  (['hover', 'click', 'open'] as const).forEach((k) => {
    el('g-snd-' + k).addEventListener('change', (e: any) => {
      cfg.sound = { ...soundCfg(), [k]: String(e.target.value || 'none') };
      applySoundEngine();
      saveNow();
    });
  });
  bindLive(
    'g-snd-vol',
    (v) => {
      cfg.sound = { ...soundCfg(), volume: Math.max(0, Math.min(100, Number(v) || 0)) };
      applySoundEngine(); // 拖动即时改音量，试听就能听出新音量
    },
    (v) => ((el('g-snd-vol-v') as HTMLElement).textContent = v + '%')
  );
  // 试听：忽略总开关（点了就该响），用当前音量放一遍
  document.querySelectorAll('[data-snd-prev]').forEach((b: any) => {
    b.addEventListener('click', () => {
      const k = String(b.dataset.sndPrev || 'hover');
      const id = soundCfg()[k];
      if (!id || id === 'none') {
        toast('这一项现在是「不播放」，先选一个音效再试听', 'info');
        return;
      }
      try {
        (window as any).FDSound?.preview?.(id);
      } catch {
        toast('试听失败：音效引擎没加载', 'error');
      }
    });
  });
}

// ---------- 视图：场景管理（场景库：未启用 ⇄ 已启用，左右分屏） ----------
/** 场景是否启用（老配置没有 enabled 字段一律按启用） */
function isSceneOn(s: any): boolean {
  return !!s && s.enabled !== false;
}
function enabledScenes(): any[] {
  return (cfg.scenes || []).filter(isSceneOn);
}

function renderScenes(): void {
  const on = (cfg.scenes || []).filter(isSceneOn);
  const off = (cfg.scenes || []).filter((s: any) => !isSceneOn(s));

  const rowHtml = (s: any, on_: boolean): string => {
    const n = s.items.length;
    const nOn = s.items.filter((i: any) => i.enabled).length;
    const dot = `<span class="dotpreview mini" style="--pv:${escapeHtml(s.themeColor)};--pv2:${escapeHtml(s.gradientColor || s.themeColor)};--pva:${Number(s.gradientAngle) || 145}deg"></span>`;
    const tags =
      (s.id === cfg.currentSceneId ? '<span class="tag">当前</span>' : '') +
      (s.isDefault ? '<span class="pill">默认</span>' : '') +
      (on_ ? '' : '<span class="tag off">未启用</span>');
    const sub =
      `${n} 个项目（启用 ${nOn} / 停用 ${n - nOn}） · ${dot}${escapeHtml(s.themeColor)}` +
      `${s.gradientColor && s.gradientColor !== s.themeColor ? ' → ' + escapeHtml(s.gradientColor) : ''} · 圆点 ${s.dotSize}px · 环半径 ${s.ringRadius}px` +
      (s.description ? ' · ' + escapeHtml(s.description) : '');
    // 只有三个按钮，没有开关：左栏「编辑 / 项目 / ＋」，右栏「编辑 / 项目 / －」
    return `<div class="scene-row${on_ ? '' : ' off'}" data-sc-id="${escapeHtml(s.id)}" title="点击编辑这个场景">
      <span class="ic">${escapeHtml(s.icon || '•')}</span>
      <div class="meta">
        <div class="nm">${escapeHtml(s.name)} ${tags}</div>
        <div class="tp">${sub}</div>
      </div>
      <div class="ops">
        <button class="btn xs ghost" data-act="edit" data-id="${escapeHtml(s.id)}" type="button">编辑</button>
        <button class="btn xs ghost" data-act="items" data-id="${escapeHtml(s.id)}" type="button">项目</button>
        ${on_
          ? `<button class="sub" data-act="disable" data-id="${escapeHtml(s.id)}" type="button" title="停用这个场景：移到左边「场景库」，数据全部保留">－</button>`
          : `<button class="add" data-act="enable" data-id="${escapeHtml(s.id)}" type="button" title="启用这个场景">＋</button>`}
      </div>
    </div>`;
  };

  el('view-scenes').innerHTML = `
    <div class="card">
      <div class="cardhead">
        <h3>场景管理</h3>
        <div class="headctl"><button class="btn sm" id="sc-new" type="button">+ 新建场景</button></div>
      </div>
      <div class="lib-target">左边是<b>场景库</b>（未启用的场景，点 <b>＋</b> 就启用）；右边是<b>已启用</b>的场景（点 <b>－</b> 就停用，场景自动回到左边，<b>项目与外观一个不丢</b>，重新启用原样回来）。两边点行内空白处都是 <b>编辑</b>；要彻底删除请进编辑弹窗。</div>
      <div class="scene-split">
        <div class="lib-col">
          <div class="lib-col-title"><span>场景库 · 未启用</span><span class="n">${off.length}</span></div>
          ${off.length
            ? off.map((s: any) => rowHtml(s, false)).join('')
            : '<div class="lib-empty">没有未启用的场景。把右边场景点「－」停用，它就会带着全部数据回到这里。</div>'}
        </div>
        <div class="lib-col">
          <div class="lib-col-title"><span>已启用</span><span class="n">${on.length}</span></div>
          ${on.length
            ? on.map((s: any) => rowHtml(s, true)).join('')
            : '<div class="lib-empty">还没有启用的场景，从左边点 ＋ 启用一个。</div>'}
        </div>
      </div>
      <div class="hint">每个场景都能独立编辑名称/图标/主题色/圆点大小/环形半径/自动启动策略。停用的场景只是不出现在悬浮球的场景选择里、也不会被当成当前场景，配置里一直留着；最后一个启用场景不允许停用（悬浮球总得有地方用），也不允许删光（至少保留一个场景）。项目库里可以跨场景增删改任意项目。</div>
    </div>`;

  const box = el('view-scenes');
  // 行内按钮：点按钮不要顺带触发「点行 = 编辑」
  box.querySelectorAll('[data-act]').forEach((b) => {
    const act = (b as HTMLElement).dataset.act!;
    const id = (b as HTMLElement).dataset.id!;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSceneAct(act, id);
    });
  });
  // 点行内空白处 = 编辑这个场景
  box.querySelectorAll('.scene-row').forEach((r) =>
    r.addEventListener('click', () => handleSceneAct('edit', (r as HTMLElement).dataset.scId!))
  );
  el('sc-new').addEventListener('click', () => openSceneModal(null));
}

/**
 * 启用 / 停用场景。
 * 关键：停用**只改一个 enabled 标记**，items、外观、自动启动策略一个字节都不动 ——
 * 场景库里存着的「上次的数据」必须原样留着，重新启用要能一模一样回来。
 */
function setSceneEnabled(id: string, on: boolean): void {
  const s = cfg.scenes.find((x: any) => x.id === id);
  if (!s) return;
  if (!on) {
    const others = enabledScenes().filter((x: any) => x.id !== id);
    if (others.length === 0) {
      toast('至少保留一个启用场景', 'error');
      renderView();
      return;
    }
    s.enabled = false;
    // 停用的正是当前场景 → 切到下一个启用的（默认场景优先），别让悬浮球显示停用的场景
    if (cfg.currentSceneId === id) {
      const next = others.find((x: any) => x.isDefault) || others[0];
      cfg.currentSceneId = next.id;
    }
    toast('已停用「' + s.name + '」，数据已保留在场景库', 'success');
  } else {
    s.enabled = true;
    toast('已启用「' + s.name + '」', 'success');
  }
  s.updatedAt = Date.now();
  void persist(false);
  renderView();
}

function handleSceneAct(act: string, id: string): void {
  const s = cfg.scenes.find((x: any) => x.id === id);
  if (act === 'current') {
    cfg.currentSceneId = id;
    persist();
    return;
  }
  if (!s) return;
  if (act === 'edit') {
    openSceneModal(s);
    return;
  }
  if (act === 'enable') {
    setSceneEnabled(id, true);
    return;
  }
  if (act === 'disable') {
    setSceneEnabled(id, false);
    return;
  }
  if (act === 'items') {
    // 项目管理已并入项目库：带着场景 id 跳到项目库，右栏就是该场景已添加的项目
    libSceneId = id;
    currentView = 'library';
    renderNav();
    renderView();
    return;
  }
  if (act === 'appearance') {
    // 外观已并入「常规」页：带着场景 id 跳过去，滚到外观卡片
    appearSceneId = id;
    currentView = 'general';
    renderNav();
    renderView();
    const card = el('view-general').querySelector('.grid2 .col .card:nth-child(2)');
    if (card && (card as HTMLElement).scrollIntoView) (card as HTMLElement).scrollIntoView({ block: 'start' });
    return;
  }
  if (act === 'dup') {
    const copy = JSON.parse(JSON.stringify(s));
    copy.id = genId('scene');
    copy.name = s.name + ' 副本';
    copy.isDefault = false;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.items = copy.items.map((it: any) => ({ ...it, id: genId('item'), createdAt: Date.now(), updatedAt: Date.now() }));
    cfg.scenes.push(copy);
    persist();
    toast('已复制场景', 'success');
    renderView();
    return;
  }
  if (act === 'default') {
    cfg.scenes.forEach((x: any) => (x.isDefault = x.id === id));
    cfg.currentSceneId = id;
    persist();
    toast('已设为默认场景', 'success');
    renderView();
    return;
  }
  if (act === 'del') {
    if (cfg.scenes.length <= 1) {
      toast('至少保留一个场景', 'error');
      return;
    }
    const enabled = s.items.filter((i: any) => i.enabled).length;
    if (!confirm(`确定删除场景「${s.name}」？\n其中 ${s.items.length} 个项目（启用 ${enabled}）会一起删除，且不可撤销。`)) return;
    const wasDefault = s.isDefault;
    const wasCurrent = cfg.currentSceneId === id;
    const removedIds = new Set(s.items.map((i: any) => i.id));
    cfg.scenes = cfg.scenes.filter((x: any) => x.id !== id);
    // 清理其它场景里指向被删项目的「全局触发」项，避免悬空引用
    cfg.scenes.forEach((sc: any) =>
      sc.items.forEach((it: any) => {
        if (it.type === 'shortcut' && it.shortcutKind === 'global' && removedIds.has(it.target)) {
          it.target = '';
          it.enabled = false;
        }
      })
    );
    if (wasDefault || !cfg.scenes.some((x: any) => x.isDefault)) cfg.scenes[0].isDefault = true;
    if (wasCurrent) cfg.currentSceneId = (cfg.scenes.find((x: any) => x.isDefault) || cfg.scenes[0]).id;
    persist();
    toast('已删除场景「' + s.name + '」', 'success');
    renderView();
    return;
  }
}

/** 场景完整编辑弹窗（新建时传 null）；名称/图标/描述/全部外观/自动启动/默认身份 */
function openSceneModal(src: any): void {
  const isNew = !src;
  const s = src
    ? JSON.parse(JSON.stringify(src))
    : {
        id: genId('scene'),
        name: '',
        description: '',
        icon: '✨',
        items: [],
        themeColor: '#3b82f6',
        gradientColor: '#7c3aed',
        gradientAngle: 145,
        glassOpacity: 0.55,
        dotSize: 64,
        ringRadius: 150,
        iconSize: 44,
        menuOpacity: 0.9,
        layout: 'radial',
        showLabels: true,
        autoLaunchApps: false,
        autoOpenWebsites: false,
        launchActions: [],
        isDefault: false,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
  const rangeRow = (id: string, label: string, min: number, max: number, step: number, val: number, suffix: string): string =>
    `<div class="row"><label>${label}</label><div class="ctl"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="tag" id="${id}-v">${val}${suffix}</span></div></div>`;
  openModal(
    `<h3>${isNew ? '新建场景' : '编辑场景'}</h3>
     <div class="row"><label>名称</label><div class="ctl"><input type="text" id="sm-name" value="${escapeHtml(s.name)}" placeholder="例如：日常办公"></div></div>
     <div class="row"><label>图标</label><div class="ctl"><input type="text" id="sm-icon" value="${escapeHtml(s.icon)}" placeholder="Emoji，如 💼" style="width:80px"><span class="hint" style="margin:0">一个 Emoji 即可，也会显示在场景列表</span></div></div>
     <div class="row"><label>描述</label><div class="ctl"><input type="text" id="sm-desc" value="${escapeHtml(s.description || '')}" placeholder="可选，用于自己辨认"></div></div>
     <div class="row"><label>主题色</label><div class="ctl"><input type="color" id="sm-color" value="${escapeHtml(s.themeColor)}"><span class="hint hval" style="margin:0" id="sm-color-v">${escapeHtml(s.themeColor)}</span><span class="dotpreview sm" id="sm-color-dot" style="--pv:${escapeHtml(s.themeColor)};--pv2:${escapeHtml(s.gradientColor || s.themeColor)};--pva:${Number(s.gradientAngle) || 145}deg"></span><span class="hint" style="margin:0">圆点主色</span></div></div>
     <div class="row"><label>渐变叠加色</label><div class="ctl"><input type="color" id="sm-color2" value="${escapeHtml(s.gradientColor || s.themeColor)}"><span class="hint hval" style="margin:0" id="sm-color2-v">${escapeHtml(s.gradientColor || s.themeColor)}</span><span class="hint" style="margin:0">和主色相同即纯色</span></div></div>
     ${rangeRow('sm-angle', '渐变角度', 0, 360, 5, Number(s.gradientAngle) || 145, '°')}
     ${rangeRow('sm-dot', '圆点大小', 40, 120, 2, s.dotSize, 'px')}
     ${rangeRow('sm-ring', '环形半径', 80, 200, 2, s.ringRadius, 'px')}
     ${rangeRow('sm-icon-size', '图标尺寸', 28, 64, 2, s.iconSize, 'px')}
     ${rangeRow('sm-glass', '玻璃透明度', 0.2, 0.95, 0.05, s.glassOpacity, '')}
     ${rangeRow('sm-menu', '菜单透明度', 0.4, 1, 0.05, s.menuOpacity, '')}
     <div class="row"><label>菜单布局</label><div class="ctl"><select id="sm-layout"><option value="radial" ${s.layout === 'radial' ? 'selected' : ''}>环形</option><option value="grid" ${s.layout === 'grid' ? 'selected' : ''}>网格</option><option value="list" ${s.layout === 'list' ? 'selected' : ''}>列表</option></select></div></div>
     <div class="row"><label>显示项目名称</label><div class="ctl"><label class="switch"><input type="checkbox" id="sm-labels" ${s.showLabels ? 'checked' : ''}><span class="slider"></span></label></div></div>
     <div class="row"><label>切换到本场景时</label><div class="ctl" style="gap:18px">
        <label style="display:flex;gap:6px;align-items:center;width:auto;color:var(--text)"><input type="checkbox" id="sm-auto-app" ${s.autoLaunchApps ? 'checked' : ''}> 自动启动应用项目</label>
        <label style="display:flex;gap:6px;align-items:center;width:auto;color:var(--text)"><input type="checkbox" id="sm-auto-web" ${s.autoOpenWebsites ? 'checked' : ''}> 自动打开网页项目</label>
     </div></div>
     <div class="row"><label>设为默认场景</label><div class="ctl"><label class="switch"><input type="checkbox" id="sm-default" ${s.isDefault ? 'checked' : ''}><span class="slider"></span></label><span class="hint" style="margin:0">默认场景在启动时自动启用</span></div></div>
     <div id="sm-err" class="err"></div>
     <div class="actions">
       ${isNew ? '' : '<button class="btn danger" id="sm-del" type="button" style="margin-right:auto">删除场景</button><button class="btn ghost" id="sm-dup" type="button">复制一份</button>'}
       <button class="btn ghost" id="sm-cancel" type="button">取消</button><button class="btn" id="sm-save" type="button">保存</button>
     </div>`,
    (m) => {
      const bindRange = (id: string, suffix: string) => {
        const inp = m.querySelector('#' + id) as HTMLInputElement;
        inp.addEventListener('input', () => {
          (m.querySelector('#' + id + '-v') as HTMLElement).textContent = inp.value + suffix;
        });
      };
      bindRange('sm-dot', 'px');
      bindRange('sm-ring', 'px');
      bindRange('sm-icon-size', 'px');
      bindRange('sm-glass', '');
      bindRange('sm-menu', '');
      bindRange('sm-angle', '°');
      m.querySelector('#sm-color')!.addEventListener('input', (e: any) => {
        const hex = String(e.target.value || '');
        const hint = m.querySelector('#sm-color-v') as HTMLElement;
        if (hint) hint.textContent = hex;
        const dot = m.querySelector('#sm-color-dot') as HTMLElement | null;
        if (dot) dot.style.setProperty('--pv', hex);
      });
      m.querySelector('#sm-color2')!.addEventListener('input', (e: any) => {
        const hex = String(e.target.value || '');
        const hint = m.querySelector('#sm-color2-v') as HTMLElement;
        if (hint) hint.textContent = hex;
        const dot = m.querySelector('#sm-color-dot') as HTMLElement | null;
        if (dot) dot.style.setProperty('--pv2', hex);
      });
      (m.querySelector('#sm-angle') as HTMLInputElement).addEventListener('input', () => {
        const dot = m.querySelector('#sm-color-dot') as HTMLElement | null;
        if (dot) dot.style.setProperty('--pva', (m.querySelector('#sm-angle') as HTMLInputElement).value + 'deg');
      });
      m.querySelector('#sm-cancel')!.addEventListener('click', closeModal);
      m.querySelector('#sm-save')!.addEventListener('click', () => {
        const name = (m.querySelector('#sm-name') as HTMLInputElement).value.trim();
        if (!name) {
          (m.querySelector('#sm-err') as HTMLElement).textContent = '场景名称不能为空';
          return;
        }
        s.name = name;
        s.icon = (m.querySelector('#sm-icon') as HTMLInputElement).value.trim() || '✨';
        s.description = (m.querySelector('#sm-desc') as HTMLInputElement).value.trim();
        s.themeColor = (m.querySelector('#sm-color') as HTMLInputElement).value;
        s.gradientColor = (m.querySelector('#sm-color2') as HTMLInputElement).value;
        s.gradientAngle = parseFloat((m.querySelector('#sm-angle') as HTMLInputElement).value);
        s.dotSize = parseFloat((m.querySelector('#sm-dot') as HTMLInputElement).value);
        s.ringRadius = parseFloat((m.querySelector('#sm-ring') as HTMLInputElement).value);
        s.iconSize = parseFloat((m.querySelector('#sm-icon-size') as HTMLInputElement).value);
        s.glassOpacity = parseFloat((m.querySelector('#sm-glass') as HTMLInputElement).value);
        s.menuOpacity = parseFloat((m.querySelector('#sm-menu') as HTMLInputElement).value);
        s.layout = (m.querySelector('#sm-layout') as HTMLSelectElement).value;
        s.showLabels = (m.querySelector('#sm-labels') as HTMLInputElement).checked;
        s.autoLaunchApps = (m.querySelector('#sm-auto-app') as HTMLInputElement).checked;
        s.autoOpenWebsites = (m.querySelector('#sm-auto-web') as HTMLInputElement).checked;
        const setDefault = (m.querySelector('#sm-default') as HTMLInputElement).checked;
        // 启用/停用只走场景库行内的 ＋ / －，弹窗不提供开关：
        // s 是从原场景深拷贝来的，enabled 原样带回来，不会因为编辑一下就被改掉
        if (s.enabled === undefined) s.enabled = true;
        s.updatedAt = Date.now();

        if (isNew) {
          cfg.scenes.push(s);
          cfg.currentSceneId = s.id;
        } else {
          // 关键：弹窗里操作的是深拷贝，必须写回原场景对象，否则改动会丢
          const idx = cfg.scenes.findIndex((x: any) => x.id === s.id);
          if (idx >= 0) cfg.scenes[idx] = s;
        }
        if (setDefault) cfg.scenes.forEach((x: any) => (x.isDefault = x.id === s.id));
        // 停用的正是当前场景 → 切到下一个启用的，别让悬浮球显示停用的场景
        if (s.enabled === false && cfg.currentSceneId === s.id) {
          const next = enabledScenes().find((x: any) => x.id !== s.id);
          if (next) cfg.currentSceneId = next.id;
        }
        persist(true);
        closeModal();
        toast(isNew ? '已创建场景「' + s.name + '」' : '已保存场景「' + s.name + '」', 'success');
        renderView();
      });
      // 行内已经不放「×」了（停用一律走启用滑块），彻底删除收进编辑弹窗里，避免误点
      const delBtn = m.querySelector('#sm-del');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          closeModal();
          handleSceneAct('del', s.id);
        });
      }
      const dupBtn = m.querySelector('#sm-dup');
      if (dupBtn) {
        dupBtn.addEventListener('click', () => {
          closeModal();
          handleSceneAct('dup', s.id);
        });
      }
    }
  );
}


// ---------- 视图：快捷键 ----------
// 辅助功能权限卡片：从「快捷键」页顶部搬到侧栏底部，常驻可见（与当前视图无关）
async function renderPermBox(): Promise<void> {
  let perm: any = {};
  try {
    perm = await api.getPermissionStatus();
  } catch {
    /* ignore */
  }
  el('permBox').innerHTML = `
    <div class="permcard">
      <div class="pchead"><span>辅助功能权限</span><span class="tag" id="perm">${perm.trusted ? '已授权' : '未授权'}</span></div>
      <div class="hint" style="margin:2px 0 0">向其他应用发送快捷键需要「辅助功能」权限，仅申请功能所需，不采集屏幕或输入。</div>
      <div class="pcbtns">
        <button class="btn sm" id="perm-open" type="button">打开系统设置授权</button>
        <button class="btn sm ghost" id="perm-refresh" type="button">刷新状态</button>
      </div>
    </div>`;
  el('perm-open').addEventListener('click', () => api.openAccessibilitySettings());
  el('perm-refresh').addEventListener('click', () => {
    renderPermBox();
  });
}

let scQuery = '';
let scType = ''; // '' = 全部

function scAllItems(): Array<{ s: any; it: any }> {
  const all: Array<{ s: any; it: any }> = [];
  cfg.scenes.forEach((s: any) => (s.items || []).forEach((it: any) => all.push({ s, it })));
  return all;
}

/** 渲染快捷键表格（受检索词与分类标签过滤，行内含「清除」按钮） */
function renderScRows(): void {
  const all = scAllItems();
  // 分类标签：全部 + 出现过的项目类型
  const types = Array.from(new Set(all.map((x) => x.it.type)));
  const tags = document.getElementById('sc-tags');
  if (tags) {
    tags.innerHTML = [['', '全部'] as [string, string], ...types.map((t) => [t, typeName(t)] as [string, string])]
      .map(([t, label]) => `<button class="chip ${scType === t ? 'on' : ''}" data-tag="${t}" type="button">${escapeHtml(label)}</button>`)
      .join('');
    tags.querySelectorAll('[data-tag]').forEach((c) =>
      c.addEventListener('click', () => {
        scType = (c as HTMLElement).dataset.tag || '';
        renderScRows();
      })
    );
  }
  const q = scQuery.trim().toLowerCase();
  const body = document.getElementById('sc-body');
  if (!body) return;
  const list = all.filter(({ s, it }) => {
    if (scType && it.type !== scType) return false;
    if (!q) return true;
    return it.name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
  });
  body.innerHTML = list.length
    ? list
        .map(
          ({ s, it }) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(it.name)}</td>
        <td><span class="tag" id="sc-${it.id}">${escapeHtml(it.shortcut || '未设置')}</span></td>
        <td><button class="btn sm rec" data-rec="${it.id}" type="button">录制</button></td>
        <td>${it.shortcut ? `<button class="btn xs danger" data-clr="${it.id}" type="button" title="清除该项目的快捷键">清除</button>` : ''}</td>
        <td class="col-state"><label class="switch"><input type="checkbox" data-en="${it.id}" ${it.enabled ? 'checked' : ''}><span class="slider"></span></label></td></tr>`
        )
        .join('')
    : `<tr><td colspan="6"><div class="hint" style="margin:0">没有匹配的项目。${q ? '换个关键词试试。' : ''}</div></td></tr>`;
  // 绑定表格内的按钮（每次重建后都要重新绑）
  body.querySelectorAll('[data-rec]').forEach((b) =>
    attachRecorder(b as HTMLElement, (acc) => {
      if (!acc) return; // 取消不清除已有的快捷键
      const it = findItem((b as HTMLElement).dataset.rec!);
      if (!it) return;
      it.shortcut = acc;
      const tag = el('sc-' + (b as HTMLElement).dataset.rec!);
      if (tag) tag.textContent = acc;
      renderScRows();
      persist(true);
    })
  );
  body.querySelectorAll('[data-en]').forEach((c) =>
    c.addEventListener('change', (e: any) => {
      const it = findItem(e.target.dataset.en);
      if (it) {
        it.enabled = e.target.checked;
        persist();
      }
    })
  );
  body.querySelectorAll('[data-clr]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = (b as HTMLElement).dataset.clr!;
      const it = findItem(id);
      if (!it) return;
      it.shortcut = undefined;
      const tag = el('sc-' + id);
      if (tag) tag.textContent = '未设置';
      renderScRows();
      persist(true);
      toast(`已清除「${it.name}」的快捷键`, 'success');
    })
  );
}

async function renderShortcuts(): Promise<void> {
  el('view-shortcuts').innerHTML = `
    <div class="card"><h3>项目快捷键</h3>
      <div class="sc-filter">
        <input type="text" id="sc-q" placeholder="检索项目或场景名称…" value="${escapeHtml(scQuery)}" />
        <div class="sc-tags" id="sc-tags"></div>
      </div>
      <div class="tablewrap"><table><thead><tr><th>场景</th><th>项目</th><th>快捷键</th><th>录制</th><th>清除</th><th>启用</th></tr></thead><tbody id="sc-body"></tbody></table></div>
      <div class="hint">设置快捷键后，无论当前哪个应用在前台，按下组合键都会触发该项目。冲突时主程序会提示失败。「清除」删除该项目已录的快捷键（不影响启用状态）。</div>
    </div>`;
  const q = el('sc-q') as HTMLInputElement;
  q.addEventListener('input', () => {
    scQuery = q.value;
    renderScRows();
  });
  renderScRows();
}

// ---------- 项目管理已并入「项目库」右栏（场景已添加） ----------
/**
 * 一键补全图标：给所有场景里「还是 emoji 图标」的应用/文件/图片项目读一次真图标。
 * 已经有图片图标的跳过，读不到的保持原样（不会把用户手填的图标改坏）。
 */
async function autoFillIcons(btn?: HTMLElement | null): Promise<void> {
  const b = (btn || el('lib-autoicon')) as HTMLButtonElement | null;
  if (b && b.disabled) return;
  const orig = b ? b.textContent || '' : '';
  if (b) b.disabled = true;
  let done = 0;
  let failed = 0;
  let scanned = 0;
  const all: any[] = [];
  cfg.scenes.forEach((sc: any) => (sc.items || []).forEach((i: any) => all.push(i)));
  for (const i of all) {
    if (i.type !== 'app' && i.type !== 'file' && i.type !== 'image') continue;
    const cur = String(i.icon || '').trim();
    // 已经是图片（本地路径 / http / data）就不再动
    if (cur.startsWith('/') || /^https?:\/\//i.test(cur) || cur.startsWith('data:image')) continue;
    const target = String(i.target || '').trim();
    if (!target) continue;
    scanned++;
    if (scanned === 1 && b) b.textContent = '读取中…';
    try {
      const r = await api.probeLocalIcon(target, i.type);
      if (r && r.iconPath) {
        i.icon = r.iconPath;
        i.updatedAt = Date.now();
        done++;
      } else if (r && r.iconText) {
        i.icon = r.iconText; // 常用图标兜底
        i.updatedAt = Date.now();
        done++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  if (b) {
    b.disabled = false;
    b.textContent = orig || '自动补全图标';
  }
  if (!scanned) {
    toast('没有需要补全图标的项目', 'info');
    return;
  }
  await persist();
  renderView();
  toast(`已补全 ${done} 个项目的图标` + (failed ? `，${failed} 个读取失败` : ''), failed ? 'info' : 'success');
}

/**
 * 打开项目编辑弹窗。
 * - src：已有项目（编辑它）
 * - template：从项目库点进来的预制条目（预填表单，保存后作为新项目加入 targetScene）
 * - targetScene：template 保存时加到哪个场景（默认项目库页当前选中的场景）
 */
function openItemModal(src: any, template?: any, targetScene?: any, libEdit?: { id: string; builtin: boolean; system?: boolean }): void {
  const isNew = !src;
  // libEdit：编辑的是「项目库」里的条目（还没加进场景）——存回项目库，不碰场景
  const editingLib = !!libEdit;
  const destScene = targetScene || libScene();
  const it = src
    ? JSON.parse(JSON.stringify(src))
    : template
      ? {
          id: genId('item'),
          name: String(template.name || ''),
          type: template.type || 'web',
          target: String(template.target || ''),
          icon: String(template.icon || '') || defaultIconFor(template.type || 'web'),
          shortcut: '',
          order: destScene.items.length,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          shortcutKind: template.shortcutKind === 'global' ? 'global' : 'send-to-app',
          shortcutKeystroke: String(template.shortcutKeystroke || ''),
          imageUrlMode: !!template.imageUrlMode,
          revealInFinder: !!template.revealInFinder,
          openWith: template.openWith || '',
        }
      : { id: genId('item'), name: '', type: 'web', target: '', icon: '🔗', shortcut: '', order: libScene().items.length, enabled: true, createdAt: Date.now(), updatedAt: Date.now(), shortcutKind: 'send-to-app', shortcutKeystroke: '', imageUrlMode: false, revealInFinder: false, openWith: '' };
  const typeOpts = ['web', 'app', 'file', 'image', 'shortcut', 'action']
    .map((t) => `<option value="${t}" ${it.type === t ? 'selected' : ''}>${typeName(t)}</option>`)
    .join('');
  // 内置动作：target 存 key（如 ime:switch），名称/图标默认取动作自带的
  if (it.type === 'action' && !it.name && builtinOf(it.target)) {
    const b = builtinOf(it.target);
    it.name = b.name;
    if (!it.icon) it.icon = b.icon;
  }
  const actionOpts = BUILTINS.map(
    (b) => `<option value="${escapeHtml(b.key)}" ${it.target === b.key ? 'selected' : ''}>${escapeHtml(b.name)}</option>`
  ).join('');
  const allItemsOpts = cfg.scenes
    .flatMap((s: any) => s.items.map((i: any) => `<option value="${i.id}" ${it.target === i.id ? 'selected' : ''}>${escapeHtml(s.name)} / ${escapeHtml(i.name)}</option>`))
    .join('');
  openModal(
    `<h3>${editingLib ? '编辑项目' : isNew ? (template ? '从项目库添加项目' : '添加项目') : '编辑项目'}</h3>
     ${editingLib ? '<div class="hint" style="margin:0 0 4px">这是<b>项目库</b>里的条目，改完存回项目库；<b>要加进场景请点卡片右上角的 ＋</b>。</div>' : ''}
     <div class="row"><label>类型</label><div class="ctl"><select id="it-type">${typeOpts}</select></div></div>
     <div class="row"><label>名称</label><div class="ctl"><input type="text" id="it-name" value="${escapeHtml(it.name)}" placeholder="显示名称"></div></div>
     <div class="row" id="row-target"><label>目标</label><div class="ctl"><input type="text" id="it-target" value="${escapeHtml(it.target)}" placeholder=""><button class="btn sm ghost" id="it-pick" type="button">选择</button></div></div>
     <div class="row" id="row-probe" style="display:none"><label></label><div class="ctl"><button class="btn sm ghost" id="it-probe" type="button" title="读取图标与名称">自动读取</button><img id="it-probe-img" class="iconpreview" alt="" style="display:none" /><span class="hint" id="it-probe-msg" style="margin:0"></span></div></div>
     <div class="row" id="row-reveal" style="display:none"><label></label><div class="ctl"><label class="switch"><input type="checkbox" id="it-reveal" ${it.revealInFinder ? 'checked' : ''}><span class="slider"></span></label> 在 Finder 中显示</div></div>
     <div class="row" id="row-urlmode" style="display:none"><label></label><div class="ctl"><label class="switch"><input type="checkbox" id="it-urlmode" ${it.imageUrlMode ? 'checked' : ''}><span class="slider"></span></label> 目标为远程 URL</div></div>
     <div class="row"><label>图标</label><div class="ctl"><input type="text" id="it-icon" value="${escapeHtml(it.icon)}" placeholder="Emoji 或图片路径"><img id="it-icon-img" class="iconpreview" alt="" style="display:none" /><button class="btn sm ghost" id="it-iconpick" type="button" title="从内部图标库选择（也可以把图标文件拖进去）">从图标库选图</button></div></div>
     <div class="row" id="row-sync" style="display:none"><label></label><div class="ctl"><label class="switch"><input type="checkbox" id="it-sync"><span class="slider"></span></label> 同步到全场景<span class="hint" style="margin:0" id="it-sync-hint"></span></div></div>
     <div class="row" id="row-invoke"><label>快捷键</label><div class="ctl"><span class="tag" id="it-sc">${escapeHtml(it.shortcut || '未设置')}</span><button class="btn sm rec" id="it-recc" type="button">录制</button><label class="switch" style="margin-left:10px"><input type="checkbox" id="it-en" ${it.enabled ? 'checked' : ''}><span class="slider"></span></label> 启用<span class="hint" style="margin:0">唤起本项目的全局热键（可不填，只点圆点用）</span></div></div>
     <div class="row" id="row-kind" style="display:none"><label>快捷键类型</label><div class="ctl"><select id="it-kind"><option value="send-to-app" ${it.shortcutKind === 'send-to-app' ? 'selected' : ''}>向当前应用发送组合键</option><option value="global" ${it.shortcutKind === 'global' ? 'selected' : ''}>全局触发另一项目</option></select></div></div>
     <div class="row" id="row-keystroke" style="display:none"><label>发送的键</label><div class="ctl"><span class="tag" id="it-ks">${escapeHtml(it.shortcutKeystroke || '未设置')}</span><button class="btn sm rec" id="it-ksrec" type="button">录制</button><span class="hint" style="margin:0">点项目 / 按全局热键时，像真的按下一样发到前台应用，如 Command+Shift+4（系统截图）</span></div></div>
     <div class="row" id="row-targetitem" style="display:none"><label>目标项目</label><div class="ctl"><select id="it-targetitem">${allItemsOpts}</select></div></div>
     <div class="row" id="row-action" style="display:none"><label>动作</label><div class="ctl"><select id="it-action">${actionOpts}</select></div></div>
     <div class="row" id="row-actionhint" style="display:none"><label></label><div class="ctl"><span class="hint" id="it-actionhint"></span></div></div>
     <div id="it-err" class="err"></div>
     <div class="actions">${isNew ? '' : '<button class="btn sm danger" id="it-del" type="button" style="margin-right:auto">删除此项目</button>'}${editingLib && !libEdit!.builtin ? '<button class="btn sm danger" id="it-dellib" type="button" style="margin-right:auto">从项目库移除</button>' : ''}<button class="btn ghost" id="it-cancel" type="button">取消</button><button class="btn" id="it-save" type="button">保存</button></div>`,
    (m) => {
      const typeSel = m.querySelector('#it-type') as HTMLSelectElement;
      const kindSel = m.querySelector('#it-kind') as HTMLSelectElement;
      const actionSel = m.querySelector('#it-action') as HTMLSelectElement;
      const actionHint = m.querySelector('#it-actionhint') as HTMLElement;
      const rebuild = () => {
        const t = typeSel.value;
        // 内置动作不需要「目标」输入框，改由下拉选择
        (m.querySelector('#row-target') as HTMLElement).style.display = t === 'shortcut' || t === 'action' ? 'none' : 'flex';
        (m.querySelector('#row-reveal') as HTMLElement).style.display = t === 'file' ? 'flex' : 'none';
        (m.querySelector('#row-urlmode') as HTMLElement).style.display = t === 'image' ? 'flex' : 'none';
        (m.querySelector('#row-kind') as HTMLElement).style.display = t === 'shortcut' ? 'flex' : 'none';
        const showKs = t === 'shortcut' && kindSel.value === 'send-to-app';
        const showTi = t === 'shortcut' && kindSel.value === 'global';
        (m.querySelector('#row-keystroke') as HTMLElement).style.display = showKs ? 'flex' : 'none';
        (m.querySelector('#row-targetitem') as HTMLElement).style.display = showTi ? 'flex' : 'none';
        const showAction = t === 'action';
        (m.querySelector('#row-action') as HTMLElement).style.display = showAction ? 'flex' : 'none';
        (m.querySelector('#row-actionhint') as HTMLElement).style.display = showAction ? 'flex' : 'none';
        (m.querySelector('#row-probe') as HTMLElement).style.display = t === 'shortcut' || t === 'action' ? 'none' : 'flex';
        if (showAction) {
          const b = builtinOf(actionSel.value);
          actionHint.textContent = b ? b.hint : '';
          // 名称还是空的就直接套用动作自带的名称 + 图标，省得再手打一遍
          const nameInp2 = m.querySelector('#it-name') as HTMLInputElement;
          const iconInp2 = m.querySelector('#it-icon') as HTMLInputElement;
          if (b && !nameInp2.value.trim()) {
            nameInp2.value = b.name;
            iconInp2.value = b.icon;
          }
        }
        const pick = m.querySelector('#it-pick') as HTMLButtonElement;
        pick.style.display = t === 'web' ? 'none' : 'inline-block';
        pick.textContent = t === 'app' ? '选择应用' : t === 'file' ? '选择文件' : t === 'image' ? '选择图片' : '';
        // 探测按钮按类型改提示（按钮文字统一用「自动读取」，长了会把这行挤换行）
        const probeBtnEl = m.querySelector('#it-probe') as HTMLButtonElement | null;
        if (probeBtnEl) {
          probeBtnEl.title =
            t === 'web' ? '读取网站标题与网站图标'
              : t === 'app' ? '读取 .app 里的应用图标与名称'
                : t === 'file' ? '读取图标；没有专用图标时按扩展名给常用图标'
                  : t === 'image' ? '把这张图本身作为图标'
                    : '读取图标'; 
        }
        const tinput = m.querySelector('#it-target') as HTMLInputElement;
        tinput.placeholder = t === 'web' ? 'https://...' : t === 'image' ? '本地路径或 URL' : t === 'app' ? '/Applications/xxx.app' : t === 'file' ? '/路径/到/文件' : '';
      };
      // 换类型时，图标若还是上一个类型的兜底图标就跟着换掉，
      // 否则从「网页」切到「内置动作」会留着 🔗，看起来像没生效。
      let prevType = String(it.type || 'web');
      typeSel.addEventListener('change', () => {
        const to = typeSel.value;
        const iconInp2 = m.querySelector('#it-icon') as HTMLInputElement;
        if (iconInp2.value.trim() === defaultIconFor(prevType)) iconInp2.value = defaultIconFor(to);
        prevType = to;
        rebuild();
      });
      kindSel.addEventListener('change', rebuild);
      actionSel.addEventListener('change', rebuild);
      rebuild();

      // 编辑项目库里的条目：全局热键 / 同步到全场景都是「场景项目」才有的概念，藏掉
      if (editingLib) {
        const inv = m.querySelector('#row-invoke') as HTMLElement | null;
        if (inv) inv.style.display = 'none';
        const syncRow = m.querySelector('#row-sync') as HTMLElement | null;
        if (syncRow) syncRow.style.display = 'none';
      }

      // 「同步到全场景」：编辑已有项目时，若其他场景还有相同项目（同名 + 同目标），显示勾选行
      if (!isNew) {
        const sameN = sameProjectItems(it).length;
        if (sameN > 0) {
          (m.querySelector('#row-sync') as HTMLElement).style.display = 'flex';
          (m.querySelector('#it-sync-hint') as HTMLElement).textContent =
            `其他场景还有 ${sameN} 个相同项目（同名 + 同目标），保存时一并套用这个图标`;
        }
      }

      // ---- 网址自动读取：按钮手动触发 + 输入框失焦自动触发（信息已填好时不打扰） ----
      const probeBtn = m.querySelector('#it-probe') as HTMLButtonElement;
      const probeMsg = m.querySelector('#it-probe-msg') as HTMLElement;
      const probeImg = m.querySelector('#it-probe-img') as HTMLImageElement;
      const iconInp = m.querySelector('#it-icon') as HTMLInputElement;
      const nameInp = m.querySelector('#it-name') as HTMLInputElement;
      const targetInp = m.querySelector('#it-target') as HTMLInputElement;
      let probing = false;
      // 图标是不是「上一次自动读取」写进去的：是的话，重选目标时可以放心覆盖；
      // 用户手动改过图标就置 false，之后自动读取不再动它。
      let iconFromProbe = false;

      const showIconPreview = (v: string): void => {
        if (v && (v.startsWith('/') || /^https?:/i.test(v))) {
          probeImg.src = v;
          probeImg.style.display = 'inline-block';
          probeImg.onerror = (): void => {
            probeImg.style.display = 'none';
          };
        } else {
          probeImg.style.display = 'none';
        }
      };
      showIconPreview(iconInp.value);

      // 图标输入框旁的小预览：填的是图片路径/网址就显示图，填 emoji 就藏起来
      const iconImg = m.querySelector('#it-icon-img') as HTMLImageElement;
      const refreshIconPreview = (): void => {
        const v = iconInp.value.trim();
        if (v && (v.startsWith('/') || /^https?:\/\//i.test(v) || v.startsWith('data:image'))) {
          iconImg.src = v;
          iconImg.style.display = 'inline-block';
          iconImg.onerror = (): void => {
            iconImg.style.display = 'none';
          };
        } else {
          iconImg.style.display = 'none';
        }
      };
      refreshIconPreview();

      const doProbe = async (auto: boolean): Promise<void> => {
        if (probing) return;
        const raw = targetInp.value.trim();
        if (!/^https?:\/\//i.test(raw) && !/^[\w-]+(\.[\w-]+)+/.test(raw)) {
          if (!auto) probeMsg.textContent = '请先填写网址（可以只写域名，如 github.com）';
          return;
        }
        // 自动触发时：名称和图标都已经是用户自己的内容，就不覆盖
        if (auto && nameInp.value.trim() && iconInp.value.trim() && !iconFromProbe) return;
        probing = true;
        probeBtn.disabled = true;
        probeMsg.textContent = '读取中…';
        const notes: string[] = [];
        try {
          const r = await api.probeWeb(raw);
          if (!r || !r.ok) {
            probeMsg.textContent = '读取失败：' + ((r && r.error) || '未知错误');
            return;
          }
          if (r.url) targetInp.value = r.url;
          const fetched = String(r.title || r.siteName || '')
            .replace(/[\u0000-\u001f]/g, ' ')
            .trim();
          if (fetched) {
            if (!nameInp.value.trim()) {
              nameInp.value = fetched;
              notes.push('名称');
            } else if (!auto && nameInp.value.trim() !== fetched) {
              notes.push('名称已保留');
            }
          }
          const iconVal = String(r.iconPath || r.iconUrl || '');
          if (iconVal) {
            iconInp.value = iconVal;
            it.icon = iconVal;
            iconFromProbe = true;
            showIconPreview(iconVal);
            refreshIconPreview();
            notes.push('图标');
          }
          probeMsg.textContent = notes.length ? '已读取：' + notes.join('、') : '没有读到可用的名称/图标';
        } catch (e: any) {
          probeMsg.textContent = '读取失败：' + (e?.message || e);
        } finally {
          probing = false;
          probeBtn.disabled = false;
        }
      };

      // 本地目标（应用 / 文件 / 图片）：选完就自动读图标与名称，和网址的操作手感一致
      const doLocalProbe = async (auto: boolean): Promise<void> => {
        if (probing) return;
        const t = typeSel.value;
        if (t !== 'app' && t !== 'file' && t !== 'image') return;
        const raw = targetInp.value.trim();
        if (!raw) {
          if (!auto) probeMsg.textContent = '请先选择或填写路径';
          return;
        }
        // 自动触发时，名称和图标都已经是用户自己的内容就不覆盖
        if (auto && nameInp.value.trim() && iconInp.value.trim() && !iconFromProbe) return;
        probing = true;
        probeBtn.disabled = true;
        probeMsg.textContent = '读取中…';
        const notes: string[] = [];
        try {
          const r = await api.probeLocalIcon(raw, t);
          // 路径被主进程纠正过（老配置的 /Applications/Notes.app 其实在 /System/Applications）→ 写回输入框
          if (r && r.target && r.target !== raw) {
            targetInp.value = r.target;
            notes.push('路径已纠正为 ' + r.target);
          }
          if (r && r.name && !nameInp.value.trim()) {
            nameInp.value = r.name;
            notes.push('名称');
          }
          const iconVal = String((r && r.iconPath) || '');
          if (iconVal) {
            iconInp.value = iconVal;
            iconFromProbe = true;
            showIconPreview(iconVal);
            refreshIconPreview();
            notes.push('图标');
          } else if (r && r.iconText) {
            if (!iconInp.value.trim() || iconFromProbe) {
              iconInp.value = r.iconText;
              iconFromProbe = true;
              refreshIconPreview();
              notes.push('常用图标');
            }
          }
          if (r && r.ok) {
            probeMsg.textContent = notes.length ? '已读取：' + notes.join('、') : '没有需要更新的内容';
          } else {
            probeMsg.textContent = '读取失败：' + ((r && r.error) || '未知错误');
          }
        } catch (e: any) {
          probeMsg.textContent = '读取失败：' + (e?.message || e);
        } finally {
          probing = false;
          probeBtn.disabled = false;
        }
      };

      probeBtn.addEventListener('click', () => {
        if (typeSel.value === 'web') doProbe(false);
        else doLocalProbe(false);
      });
      targetInp.addEventListener('blur', () => {
        if (typeSel.value === 'web') doProbe(true);
        else doLocalProbe(true);
      });
      iconInp.addEventListener('input', () => { iconFromProbe = false; refreshIconPreview(); });
      iconInp.addEventListener('change', () => { iconFromProbe = false; refreshIconPreview(); });

      (m.querySelector('#it-pick') as HTMLButtonElement).addEventListener('click', async () => {
        const t = typeSel.value;
        let r: any;
        if (t === 'app') r = await api.selectApp();
        else if (t === 'file') r = await api.selectFile({ directory: false });
        else if (t === 'image') r = await api.selectIconImage();
        if (r && r.path) {
          targetInp.value = r.path;
          // 选完立刻读图标 + 名称：应用读 .app 里的真实图标，文件按扩展名给常用图标
          iconFromProbe = true; // 目标换了，图标应当允许被覆盖
          await doLocalProbe(false);
        }
      });
      (m.querySelector('#it-iconpick') as HTMLButtonElement).addEventListener('click', async () => {
        // 从内部图标库选图：点某个图标 → 主进程复制进缓存 → 回填输入框
        await openIconLibrary((cachePath) => {
          (m.querySelector('#it-icon') as HTMLInputElement).value = cachePath;
          iconFromProbe = false;
          refreshIconPreview();
        });
      });
      attachRecorder(m.querySelector('#it-recc') as HTMLButtonElement, (acc) => { if (!acc) return; it.shortcut = acc; (m.querySelector('#it-sc') as HTMLElement).textContent = acc; });
      attachRecorder(m.querySelector('#it-ksrec') as HTMLButtonElement, (acc) => { if (!acc) return; it.shortcutKeystroke = acc; (m.querySelector('#it-ks') as HTMLElement).textContent = acc; });
      const delBtn = m.querySelector('#it-del') as HTMLButtonElement | null;
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          if (!confirm(`确定删除项目「${it.name}」？不可撤销。`)) return;
          const sc = sceneOfItem(it.id);
          const i = sc.items.findIndex((x: any) => x.id === it.id);
          if (i >= 0) {
            sc.items.splice(i, 1);
            renormalize(sc);
            cfg.scenes.forEach((s2: any) =>
              s2.items.forEach((x: any) => {
                if (x.type === 'shortcut' && x.shortcutKind === 'global' && x.target === it.id) {
                  x.target = '';
                  x.enabled = false;
                }
              })
            );
            persist();
            toast('已删除项目「' + it.name + '」', 'success');
          }
          closeModal();
          renderView();
        });
      }
      // 编辑项目库里的条目 → 从项目库移除（只是移除收藏，不影响已加进场景的项目）
      const delLibBtn = m.querySelector('#it-dellib') as HTMLButtonElement | null;
      if (delLibBtn) {
        delLibBtn.addEventListener('click', () => {
          if (!confirm(`确定从项目库移除「${it.name}」？不可撤销。`)) return;
          removeLibraryItem(libEdit!.id);
          closeModal();
          renderView();
        });
      }
      m.querySelector('#it-cancel')!.addEventListener('click', closeModal);
      m.querySelector('#it-save')!.addEventListener('click', () => {
        it.name = (m.querySelector('#it-name') as HTMLInputElement).value.trim();
        it.type = typeSel.value;
        it.target = (m.querySelector('#it-target') as HTMLInputElement).value.trim();
        // 内置动作：target 存动作 key，名称和图标允许为空（执行时按 key 走内置实现）
        if (it.type === 'action') it.target = actionSel.value;
        it.icon = (m.querySelector('#it-icon') as HTMLInputElement).value.trim() || defaultIconFor(typeSel.value);
        it.enabled = (m.querySelector('#it-en') as HTMLInputElement).checked;
        it.revealInFinder = !!((m.querySelector('#it-reveal') as HTMLInputElement)?.checked);
        it.imageUrlMode = !!((m.querySelector('#it-urlmode') as HTMLInputElement)?.checked);
        if (it.type === 'shortcut') {
          it.shortcutKind = kindSel.value;
          if (it.shortcutKind === 'global') it.target = (m.querySelector('#it-targetitem') as HTMLSelectElement).value;
        }
        const errs: string[] = [];
        if (!it.name) errs.push('名称不能为空');
        if (it.type === 'web' && !/^https?:\/\//.test(it.target)) errs.push('网页地址需以 http:// 或 https:// 开头');
        if (it.type === 'app' && !/\.app$/.test(it.target)) errs.push('应用路径应以 .app 结尾');
        if (it.type === 'action' && !builtinOf(it.target)) errs.push('请选择一个内置动作');
        // send-to-app 必须录一个要发送的键（否则点项目什么也不会发生）
        if (it.type === 'shortcut' && it.shortcutKind === 'send-to-app' && !it.shortcutKeystroke) errs.push('请录制要发送给当前应用的组合键');
        if (errs.length) { (m.querySelector('#it-err') as HTMLElement).textContent = errs.join('；'); return; }
        if (editingLib) {
          // 编辑项目库里的条目 → 存回项目库（不碰场景：只有卡片上的 ＋ 才会加进场景）
          const entry: any = {
            id: libEdit!.builtin ? genId('lib') : libEdit!.id,
            name: it.name,
            type: it.type,
            target: it.target,
            icon: it.icon,
            keywords: [it.name],
            openWith: it.openWith || '',
            revealInFinder: !!it.revealInFinder,
            shortcutKind: it.shortcutKind === 'global' ? 'global' : 'send-to-app',
            shortcutKeystroke: String(it.shortcutKeystroke || ''),
            imageUrlMode: !!it.imageUrlMode,
            builtin: false,
            // 编辑系统自带项目后仍然是系统项目（别因为改了个名字就掉到「应用」分类）
            system: libEdit?.system === true || it.system === true || isSystemBuiltin(it),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          if (!Array.isArray(cfg.itemLibrary)) cfg.itemLibrary = [];
          if (libEdit!.builtin) {
            // 预制项目是公共资源，不能直接改：存成「我的收藏」里的一份副本
            cfg.itemLibrary.push(entry);
          } else {
            const idx = cfg.itemLibrary.findIndex((x: any) => x.id === entry.id);
            if (idx >= 0) cfg.itemLibrary[idx] = { ...cfg.itemLibrary[idx], ...entry };
            else cfg.itemLibrary.push(entry);
          }
          persist(); closeModal(); renderView();
          toast(
            libEdit!.builtin ? '已存到「我的收藏」，要加进场景请点卡片上的 ＋' : '已更新项目库里的这一项',
            'success'
          );
          return;
        }
        if (isNew) {
          it.createdAt = Date.now();
          it.updatedAt = Date.now();
          it.order = destScene.items.length;
          destScene.items.push(it);
        }
        else {
          const sc = sceneOfItem(it.id);
          const arr = sc.items;
          const i = arr.findIndex((x: any) => x.id === it.id);
          if (i >= 0) arr[i] = it; else destScene.items.push(it);
        }
        // 「同步到全场景」：勾选了就把图标一并应用到其他场景的相同项目（同名 + 同目标 + 同类型）
        const syncBox = m.querySelector('#it-sync') as HTMLInputElement | null;
        if (syncBox && syncBox.checked) {
          const same = sameProjectItems(it);
          for (const x of same) {
            x.icon = it.icon;
            x.updatedAt = Date.now();
          }
          if (same.length) toast(`已同步到其他 ${same.length} 个场景的相同项目`, 'success');
        }
        persist(); closeModal(); renderView();
      });
    }
  );
}

// ---------- 视图：关于 ----------
async function renderAbout(): Promise<void> {
  const d = await api.getDiagnostics();
  el('view-about').innerHTML = `
    <div class="card"><h3>关于 FloatDesk</h3>
      <div class="row"><label>版本</label><div class="ctl"><span class="tag">1.0.0</span> · schema ${cfg.schemaVersion}</div></div>
      <div class="hint">本地优先，不上传任何配置或遥测。配置保存在应用数据目录。</div>
    </div>
    <div class="card"><h3>配置</h3>
      <div class="row"><label></label><div class="ctl">
        <button class="btn sm" id="ab-export" type="button">导出配置</button>
        <button class="btn sm ghost" id="ab-import" type="button">导入配置</button>
        <button class="btn sm danger" id="ab-reset" type="button">恢复默认</button>
      </div></div>
      <div class="hint">导入前会校验结构；失败则保留原配置。恢复默认会清掉当前所有自定义。</div>
    </div>
    <div class="card"><h3>诊断</h3>
      <div class="row"><label></label><div class="ctl"><button class="btn sm" id="ab-copydiag" type="button">复制诊断信息</button><span class="hint" style="margin:0">设置页禁止鼠标选中文字（拖滑杆不会误选），要反馈问题点这里一键复制</span></div></div>
      <pre class="log" id="ab-diag">${escapeHtml(d.diagnostics)}</pre>
      <details><summary>查看日志</summary><pre class="log">${escapeHtml(d.log || '（无日志）')}</pre></details>
    </div>`;
  // 设置页全局禁止选中文字（拖滑杆不误选），诊断信息这种要贴给别人的内容改走按钮一键复制
  el('ab-copydiag').addEventListener('click', async () => {
    const body = String(d.diagnostics || '') + '\n\n' + String(d.log || '（无日志）');
    const r = await api.writeClipboard(body);
    toast(r && r.ok ? '已复制诊断信息' : '复制失败', r && r.ok ? 'success' : 'error');
  });
  el('ab-export').addEventListener('click', async () => { const r = await api.exportConfig(); toast(r.ok ? '已导出' : '导出取消或失败' + (r.error ? ': ' + r.error : ''), r.ok ? 'success' : 'error'); });
  el('ab-import').addEventListener('click', async () => {
    const r = await api.importConfig();
    if (r.ok) { cfg = await api.getConfig(); applyShowHints(); renderView(); toast('已导入', 'success'); }
    else if (!r.canceled) toast('导入失败: ' + r.error, 'error');
  });
  el('ab-reset').addEventListener('click', async () => {
    if (!confirm('确定恢复默认配置？将丢失当前全部自定义。')) return;
    const r = await api.resetConfig(); cfg = r.config; applyShowHints(); renderView(); toast('已恢复默认', 'success');
  });
}

// ---------- 视图：工具（中英文切换 / 便签） ----------
// 这两个功能是 FloatDesk 自带的「内置动作」，先在这里配置好，再以 action 类型挂到任意场景的环形菜单里。
function ensureInputMethod(): any {
  if (!cfg.inputMethod || typeof cfg.inputMethod !== 'object') cfg.inputMethod = { chineseId: null, englishId: null };
  return cfg.inputMethod;
}
function ensureNote(): any {
  if (!cfg.note || typeof cfg.note !== 'object') {
    cfg.note = { color: '#fff6c9', opacity: 1, fontSize: 14, x: null, y: null, width: 320, height: 260 };
  }
  return cfg.note;
}

async function renderTools(): Promise<void> {
  const im = ensureInputMethod();
  const note = ensureNote();
  let snap: any = null;
  try {
    snap = await api.imeSnapshot();
  } catch (e: any) {
    snap = { ok: false, available: false, sources: [], error: e?.message || '读取失败' };
  }
  const presets: string[] = (await api.notePresets()) || [];
  const sources: Array<{ id: string; name: string }> = (snap && snap.sources) || [];

  const srcOpts = (sel: string | null, autoLabel: string): string =>
    `<option value="" ${!sel ? 'selected' : ''}>${autoLabel}</option>` +
    sources
      .map((s) => `<option value="${escapeHtml(s.id)}" ${sel === s.id ? 'selected' : ''}>${escapeHtml(s.name || s.id)}</option>`)
      .join('');

  const curName = (snap && (snap.currentName || snap.currentId)) || '未知';
  const availTxt = snap && snap.available
    ? '<span class="acc">已就绪</span>'
    : '<span style="color:#ff9a9a">缺少辅助程序 bin/imeswitch（将退回模拟 Ctrl+Space，需要辅助功能权限）</span>';

  el('view-tools').innerHTML = `
    <div class="card">
      <div class="cardhead"><h3>中英文切换</h3>
        <div class="headctl"><button class="btn sm ghost" id="im-refresh" type="button">刷新</button></div></div>
      <div class="row"><label>切换能力</label><div class="ctl"><span id="im-avail">${availTxt}</span></div></div>
      <div class="row"><label>当前输入法</label><div class="ctl"><span id="im-cur">${escapeHtml(String(curName))}</span>
        <button class="btn sm" id="im-toggle" type="button">立即切换一次</button></div></div>
      <div class="row"><label>中文输入法</label><div class="ctl"><select id="im-cn">${srcOpts(im.chineseId, '自动识别')}</select></div></div>
      <div class="row"><label>英文输入法</label><div class="ctl"><select id="im-en">${srcOpts(im.englishId, '自动识别')}</select></div></div>
      <div class="hint">两个都选「自动识别」时，会在你的输入源里自动挑一个中文和一个英文；没配好就退化成「在所有输入源之间循环」。
        切换走系统 TIS 接口，不需要辅助功能权限，也不受你自定义的切换快捷键影响。</div>
      <div class="row" style="margin-top:12px"><label></label><div class="ctl">
        <button class="btn" id="im-save" type="button">保存输入法设置</button></div></div>
    </div>

    <div class="card">
      <div class="cardhead"><h3>便签</h3>
        <div class="headctl"><button class="btn sm" id="note-open" type="button">打开便签</button></div></div>
      <div class="row"><label>纸面颜色</label><div class="ctl" id="note-sw"></div></div>
      <div class="row"><label>自定义颜色</label><div class="ctl"><input type="color" id="note-color" value="${escapeHtml(note.color || '#fff6c9')}" /></div></div>
      <div class="row"><label>不透明度</label><div class="ctl"><input type="range" id="note-opacity" min="30" max="100" step="1" value="${Math.round((note.opacity == null ? 1 : note.opacity) * 100)}" /><span class="hint hval" id="note-opacity-v">${Math.round((note.opacity == null ? 1 : note.opacity) * 100)}%</span></div></div>
      <div class="row"><label>字号</label><div class="ctl"><input type="range" id="note-fontsize" min="10" max="28" step="1" value="${note.fontSize || 14}" /><span class="hint hval" id="note-fontsize-v">${note.fontSize || 14}px</span></div></div>
      <div class="hint">便签输入即存，空闲 5 秒记一版历史（每组标签各自留 30 版，可以先预览再恢复）；标签栏的 ＋ 号可以再加一组，双击标签改名、× 删除；位置和大小会自动记住。</div>
    </div>

    <div class="card">
      <div class="cardhead"><h3>图标库</h3>
        <div class="headctl"><span class="hint" style="margin:0" id="lib-count2">…</span>
          <button class="btn sm ghost" id="lib-open2" type="button">打开文件夹</button>
          <button class="btn sm ghost" id="lib-manage" type="button">管理</button></div></div>
      <div class="hint">FloatDesk 内部的图标文件夹。编辑项目时点「从图标库选图」即可选用这里的图标；也可以直接在 Finder 里往这个文件夹扔图标文件（或删改）。</div>
      <div class="lib-drop" id="lib-drop2">把图标文件拖到这里加入图标库（png / jpg / gif / webp / svg / bmp / ico，单个 ≤8MB）</div>
      <div id="lib-grid-wrap2"></div>
    </div>

    <div class="card">
      <h3>加到悬浮菜单</h3>
      <div class="hint">把这两个功能加到当前场景「${escapeHtml(currentScene()?.name || '')}」的环形菜单里，点一下就能用。</div>
      <div class="row"><label></label><div class="ctl">
        ${BUILTINS.map((b) => `<button class="btn sm ghost" data-add="${escapeHtml(b.key)}" type="button">＋ ${escapeHtml(b.name)}</button>`).join('')}
      </div></div>
    </div>`;

  // ---- 输入法 ----
  const saveBtn = el('im-save') as HTMLButtonElement;
  el('im-refresh').addEventListener('click', () => renderView());
  el('im-toggle').addEventListener('click', async () => {
    const r = await api.imeToggle();
    if (r && r.ok) {
      toast('已切换输入法', 'success');
      setTimeout(() => renderView(), 300);
    } else {
      toast('切换失败：' + ((r && r.error) || '未知错误'), 'error');
    }
  });
  saveBtn.addEventListener('click', async () => {
    im.chineseId = (el('im-cn') as HTMLSelectElement).value || null;
    im.englishId = (el('im-en') as HTMLSelectElement).value || null;
    if (await persist(false)) flashSaved(saveBtn, '已保存');
  });

  // ---- 便签 ----
  const swBox = el('note-sw');
  presets.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'btn sm ghost';
    b.type = 'button';
    b.style.width = '26px';
    b.style.padding = '0';
    b.style.height = '22px';
    b.style.background = c;
    b.style.borderColor = String(note.color || '').toLowerCase() === c.toLowerCase() ? '#7a6a2a' : '';
    b.title = c;
    b.addEventListener('click', async () => {
      note.color = c;
      await api.noteConfigSave({ color: c });
      await persist(false);
      renderView();
    });
    swBox.appendChild(b);
  });
  (el('note-color') as HTMLInputElement).addEventListener('input', async (e) => {
    note.color = (e.target as HTMLInputElement).value;
    await api.noteConfigSave({ color: note.color });
  });
  (el('note-color') as HTMLInputElement).addEventListener('change', async () => {
    if (await persist(false)) toast('便签颜色已保存', 'success');
  });
  el('note-opacity').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    (el('note-opacity-v') as HTMLElement).textContent = v + '%';
    note.opacity = v / 100;
  });
  el('note-opacity').addEventListener('change', async () => {
    await api.noteConfigSave({ opacity: note.opacity });
    if (await persist(false)) toast('便签透明度已保存', 'success');
  });
  el('note-fontsize').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    (el('note-fontsize-v') as HTMLElement).textContent = v + 'px';
    note.fontSize = v;
  });
  el('note-fontsize').addEventListener('change', async () => {
    await api.noteConfigSave({ fontSize: note.fontSize });
    if (await persist(false)) toast('便签字号已保存', 'success');
  });
  el('note-open').addEventListener('click', () => api.openNote());

  // ---- 图标库 ----
  refreshLibGrids();
  el('lib-open2').addEventListener('click', async () => {
    const r = await api.iconLibReveal();
    if (!r || !r.ok) toast('打开文件夹失败：' + ((r && r.error) || '未知错误'), 'error');
  });
  el('lib-manage').addEventListener('click', () => openIconLibrary());
  bindLibDrop(el('lib-drop2'));
  // 工具页网格：只挂删除（点选要到项目编辑弹窗里）
  el('lib-grid-wrap2').addEventListener('click', async (e) => {
    const delBtn = (e.target as HTMLElement).closest('[data-libdel2]') as HTMLElement | null;
    if (!delBtn) return;
    const p = delBtn.dataset.libdel2!;
    if (confirm(`确定从图标库删除「${p.split('/').pop()}」？\n（已经用上它的项目不受影响）`)) {
      await deleteLibIcon(p);
    }
  });

  // ---- 一键加入当前场景 ----
  el('view-tools').querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = (b as HTMLElement).dataset.add!;
      const meta = builtinOf(key);
      if (!meta) return;
      const sc = currentScene();
      if (sc.items.some((i: any) => i.type === 'action' && i.target === key)) {
        toast(`「${meta.name}」已经在「${sc.name}」里了`, 'info');
        return;
      }
      sc.items.push({
        id: genId('item'),
        name: meta.name,
        type: 'action',
        target: key,
        icon: meta.icon,
        order: sc.items.length,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      persist();
      toast(`已加入「${sc.name}」：${meta.name}`, 'success');
    })
  );
}

// ---------- 项目库（预制项目 / 按类型下拉 / 中英文检索 / 网址识别 / 小加号加到场景） ----------
// 内置预制走 IPC 拿主进程权威列表（渲染进程是经典脚本，不能 import 值）；
// 用户自己收藏的项目存在 cfg.itemLibrary，与预制一起显示在检索结果里。
let LIB_PRESETS: any[] = [];
// 本机应用（扫这台 Mac 上真实装了的 .app，图标是原生 icns）：项目库左栏单列一节，
// 只列预制库里没有的那些，避免重复。
let LIB_INSTALLED: any[] = [];
let libInstalledLoading = false;
let libQuery = '';    // 检索词（存模块级：persist 触发重渲染时不丢输入）
let libUrl = '';      // 网址模式下正在填的网址
let libMode: 'search' | 'url' = 'search'; // 输入框的两种模式：检索项目库 / 添加网址
let libType = '';     // 类型过滤，'' = 全部
let libSceneId = '';  // 往哪个场景加；为空则用当前场景
let libShowHidden = false; // 是否显示「已隐藏」分区（只是页面上的开关，不写进配置）
/** 被隐藏的项目库条目 id（内置 / 本机应用 / 我的收藏都算） */
function libHiddenSet(): Set<string> {
  return new Set<string>(Array.isArray(cfg?.libHidden) ? cfg.libHidden.map((x: any) => String(x)) : []);
}
/** 隐藏 / 恢复一个项目库条目（立即落盘） */
function toggleLibHidden(id: string, hidden: boolean): void {
  if (!Array.isArray(cfg.libHidden)) cfg.libHidden = [];
  const i = cfg.libHidden.indexOf(id);
  if (hidden && i < 0) cfg.libHidden.push(id);
  if (!hidden && i >= 0) cfg.libHidden.splice(i, 1);
  saveNow();
  if (currentView !== 'library') return;
  // 只重画结果区：整页重画会把检索框的焦点弄丢
  renderLibResults();
  const btn = el('lib-hidden');
  if (btn) btn.textContent = libShowHidden ? '收起已隐藏' : `已隐藏（${cfg.libHidden.length}）`;
}

/**
 * 像不像网址：带协议 / www. 开头 / 裸域名（含点且不含空格）。
 * 与 shared/itemLibrary.ts 的 looksLikeUrl 保持一致（渲染进程是经典脚本，不能 import 值，
 * 这里各存一份；改动时两边同步）。
 */
function looksLikeUrl(s: string): boolean {
  const t = String(s || '').trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^www\.[\w-]+(\.[\w-]+)+/i.test(t)) return true;
  return /^[\w-]+(\.[\w-]+)+(\/[^\s]*)?$/.test(t);
}

/**
 * 库条目是否命中检索词：名称 / 类型名 / 别名（中文英文都能搜，大小写不敏感）。
 * 与 shared/itemLibrary.ts 的 libraryMatches 保持一致（渲染进程是经典脚本，不能 import 值，
 * 这里各存一份；改动时两边同步）。
 */
function libMatches(it: any, q: string): boolean {
  const ql = String(q || '').trim().toLowerCase();
  if (!ql) return true;
  if (String(it.name || '').toLowerCase().includes(ql)) return true;
  if (typeName(it.type).includes(ql)) return true;
  if (String(it.type || '').toLowerCase().includes(ql)) return true;
  const kws: string[] = Array.isArray(it.keywords) ? it.keywords : [];
  return kws.some((k) => String(k).toLowerCase().includes(ql));
}

/** 项目库里要加到哪个场景（项目管理已并入项目库，这里是唯一的场景选择） */
function libScene(): any {
  if (libSceneId) {
    const f = cfg.scenes.find((s: any) => s.id === libSceneId);
    if (f) return f;
  }
  return currentScene();
}

/**
 * 同一性判定键：类型 + 名称 + 目标 + 组合键。
 * 用来判断「库里这一条是不是已经加进当前场景了」——
 * 从库里加进场景的项目会原样带上目标（快捷键则带组合键），所以这几个字段一致即视为同一个。
 */
function libItemKey(it: any): string {
  return [
    String(it?.type || ''),
    String(it?.name || '').trim(),
    String(it?.target || '').trim(),
    String(it?.shortcutKeystroke || '').trim(),
  ].join('|');
}

/**
 * 把场景里的项目移除（项目库右栏的 ×）。
 * 连带清理其它场景里指向它的全局触发项（悬浮菜单里删项目是同一套逻辑）。
 */
async function removeSceneItem(sc: any, id: string): Promise<void> {
  const arr = sc.items || [];
  const i = arr.findIndex((x: any) => x.id === id);
  if (i < 0) return;
  const it = arr[i];
  if (!confirm(`确定把「${it.name}」从场景「${sc.name}」移除？\n移除后可以随时在左边项目库里重新添加。`)) return;
  arr.splice(i, 1);
  renormalize(sc);
  // 清理其它场景里指向它的全局触发项
  cfg.scenes.forEach((s: any) =>
    (s.items || []).forEach((x: any) => {
      if (x.type === 'shortcut' && x.shortcutKind === 'global' && x.target === id) {
        x.target = '';
        x.enabled = false;
      }
    })
  );
  await persist();
  toast(`已从「${sc.name}」移除「${it.name}」`, 'success');
  if (currentView === 'library') renderLibrary();
}

/** 库条目 → 场景项目（复制一份：绝不能把库里的对象直接塞进场景，否则改一处两处都跟着变） */
function libraryItemToMenuItem(lib: any, sc: any): any {
  return {
    id: genId('item'),
    name: String(lib.name || ''),
    type: lib.type,
    target: String(lib.target || ''),
    icon: String(lib.iconPath || lib.icon || '') || defaultIconFor(lib.type),
    order: (sc.items || []).length,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    openWith: lib.openWith || '',
    revealInFinder: !!lib.revealInFinder,
    shortcutKind: lib.shortcutKind === 'global' ? 'global' : 'send-to-app',
    shortcutKeystroke: String(lib.shortcutKeystroke || ''),
    imageUrlMode: !!lib.imageUrlMode,
  };
}

/** 把库里一个项目加到场景（项目库页顶部选中的那个场景） */
async function addLibraryItemToScene(lib: any, sc: any): Promise<void> {
  const it = libraryItemToMenuItem(lib, sc);
  // macOS 原生图标优先：库里带 iconPath 就直接用；没有就现场读一次
  //（.app 读 icns，文件夹读 CoreTypes 系统图标；路径失效时主进程会顺手纠正 target）
  if ((lib.iconMode === 'native' || lib.installed) && !String(it.icon || '').startsWith('/')) {
    try {
      const r = await api.probeLocalIcon(it.target, it.type);
      if (r?.target) it.target = r.target;
      if (r?.iconPath) it.icon = r.iconPath;
      else if (r?.iconText) it.icon = r.iconText;
    } catch {
      /* 读不到就保留 emoji 兜底，不影响添加 */
    }
  }
  sc.items.push(it);
  renormalize(sc);
  await persist();
  // 场景项数变了，这里主动重画一次（主进程广播也会重画，双保险）
  if (currentView === 'library') renderLibrary();
  toast(`已添加「${it.name}」到「${sc.name}」`, 'success');
}

/** 粘贴网址 → 读标题与 favicon → 建一个网页项目（项目库的网址模式与项目编辑弹窗共用） */
async function addWebByUrl(raw: string, sc: any): Promise<{ ok: boolean; msg: string; hint?: string }> {
  const r = await api.probeWeb(raw);
  if (!r || !r.url) return { ok: false, msg: '网址无效：' + ((r && r.error) || '需要 http(s) 地址') };
  const target = String(r.url);
  let name = String(r.title || r.siteName || '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (!name) {
    try {
      name = new URL(target).hostname.replace(/^www\./i, '');
    } catch {
      name = target;
    }
  }
  if (name.length > 40) name = name.slice(0, 40).trim();
  const iconVal = String(r.iconPath || r.iconUrl || '') || '🔗';
  const it = {
    id: genId('item'), name, type: 'web', target, icon: iconVal,
    order: (sc.items || []).length, enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  sc.items.push(it);
  renormalize(sc);
  await persist();
  const withIcon = !!(r.iconPath || r.iconUrl);
  return {
    ok: true,
    msg: `已添加「${name}」${withIcon ? '（含图标）' : '（未取到图标）'}`,
    hint: r.error ? String(r.error) : undefined,
  };
}

/** 把场景里的项目收藏进项目库（同名 + 同目标 + 同类型算同一个，不重复收藏） */
async function saveItemToLibrary(it: any): Promise<void> {
  if (!Array.isArray(cfg.itemLibrary)) cfg.itemLibrary = [];
  const dup = cfg.itemLibrary.find((x: any) => x.name === it.name && x.target === it.target && x.type === it.type);
  if (dup) {
    toast('项目库里已经有这一项了', 'info');
    return;
  }
  cfg.itemLibrary.push({
    id: genId('lib'),
    name: String(it.name || ''),
    type: it.type,
    target: String(it.target || ''),
    icon: String(it.icon || ''),
    keywords: [String(it.name || '')],
    openWith: it.openWith || '',
    revealInFinder: !!it.revealInFinder,
    shortcutKind: it.shortcutKind === 'global' ? 'global' : 'send-to-app',
    shortcutKeystroke: String(it.shortcutKeystroke || ''),
    imageUrlMode: !!it.imageUrlMode,
    // 系统自带的项目收藏进来也还是系统项目（留在「mac 系统」分类）
    system: it.system === true || isSystemBuiltin(it),
    createdAt: Date.now(),
  });
  await persist();
  // 清掉项目库页的检索词：否则之前搜着别的词，切到「项目库」会看不到刚收藏的这一项
  libQuery = '';
  toast(`已收藏「${it.name}」到项目库`, 'success');
}

/** 从项目库移除一项收藏 */
async function removeLibraryItem(id: string): Promise<void> {
  if (!Array.isArray(cfg.itemLibrary)) return;
  const before = cfg.itemLibrary.length;
  cfg.itemLibrary = cfg.itemLibrary.filter((x: any) => x.id !== id);
  if (cfg.itemLibrary.length === before) return;
  // 顺手把它从「已隐藏」里摘掉：条目都没了，留个 id 只会让计数虚高
  if (Array.isArray(cfg.libHidden)) {
    cfg.libHidden = cfg.libHidden.filter((x: any) => String(x) !== String(id));
  }
  await persist();
  if (currentView === 'library') renderLibResults();
  toast('已从项目库移除', 'info');
}

/**
 * 项目库结果区：左「还没加入场景的项目」+ 右「场景里已有的项目」。
 * 只重画结果区，不动上面的检索框（否则打字会掉焦点）。
 */
/**
 * 懒加载「本机应用」：扫这台 Mac 上真实装了的 .app（主进程扫 + 原生图标）。
 * 只拉一次；失败静默降级——预制项目库照常可用。
 */
let libInstalledDone = false;
async function ensureInstalledApps(): Promise<void> {
  if (libInstalledDone || libInstalledLoading) return;
  libInstalledLoading = true;
  try {
    const list: any[] = (await (api as any).scanApps?.()) || [];
    LIB_INSTALLED = list
      .filter((a) => a && a.path)
      .map((a) => ({
        id: 'mac-' + a.path,
        name: String(a.name || ''),
        type: 'app',
        target: String(a.path),
        icon: String(a.icon || ''),
        iconPath: String(a.icon || ''),
        builtin: true,
        installed: true,
        // /System/... 是 macOS 自带（Chess、Grapher 这类），归到「mac 系统」分类
        system: a.system === true || /^\/System\//.test(String(a.path || '')),
        keywords: [String(a.bundle || '').replace(/\.app$/i, '').toLowerCase()].filter(Boolean),
      }));
  } catch {
    LIB_INSTALLED = [];
  }
  libInstalledDone = true;
  libInstalledLoading = false;
  if (currentView === 'library') renderLibResults();
}

function renderLibResults(): void {
  const box = el('lib-results');
  if (!box) return;
  const q = libQuery;
  const presets: any[] = LIB_PRESETS || [];
  const mine: any[] = Array.isArray(cfg.itemLibrary) ? cfg.itemLibrary : [];
  const sc = libScene();
  const isSearch = libMode === 'search';
  // 网址模式不参与检索/类型筛选（左栏照常列出可添加的项目）
  const hit = (it: any): boolean => (isSearch ? libMatchType(it, libType) && libMatches(it, q) : true);

  // 已经在当前场景里的：按「类型+名称+目标+组合键」判定
  const sceneKeys = new Set((sc.items || []).map(libItemKey));
  const inScene = (it: any): boolean => sceneKeys.has(libItemKey(it));

  // 隐藏的项目：不出现在左右两栏的常规列表里（「已隐藏」开关打开才单独列出来）
  const hiddenIds = libHiddenSet();
  const isHidden = (it: any): boolean => hiddenIds.has(String(it?.id || ''));

  // 左栏：库里还没加进这个场景的
  const pre = presets.filter((it) => hit(it) && !inScene(it) && !isHidden(it));
  // 我的收藏：全部显示（用户自己的收藏不该凭空消失）；已经在当前场景里的标「已在场景」且不给加号
  const usr = mine.filter((it) => hit(it) && !isHidden(it));
  // 本机应用：预制库里没有、当前场景也没加过的那些（按路径去重）
  const presetAppPaths = new Set(presets.filter((x) => x.type === 'app').map((x) => String(x.target || '')));
  const sceneAppPaths = new Set((sc.items || []).filter((x: any) => x.type === 'app').map((x: any) => String(x.target || '')));
  const installed = LIB_INSTALLED.filter(
    (it) => hit(it) && !presetAppPaths.has(it.target) && !sceneAppPaths.has(it.target) && !isHidden(it)
  );
  // 已隐藏的全部（内置 / 本机应用 / 收藏都算），开关打开时列在最上面；按 id 去重
  const hiddenItems: any[] = [];
  if (libShowHidden) {
    const seen = new Set<string>();
    for (const it of [...mine, ...LIB_INSTALLED, ...presets]) {
      const id = String(it?.id || '');
      if (!id || seen.has(id) || !isHidden(it)) continue;
      seen.add(id);
      hiddenItems.push(it);
    }
  }
  // 右栏：场景里已有的全部（不按检索过滤；不匹配当前条件的淡显，但照样能移除）
  const sceneItems = (sc.items || []).slice().sort((a: any, b: any) => a.order - b.order);

  const iconCell = (icon: string, type: string): string => {
    const s = String(icon || '');
    const isImg = s.startsWith('/') || /^https?:\/\//i.test(s) || s.startsWith('data:image');
    return isImg ? `<img src="${escapeHtml(s)}" alt="" />` : escapeHtml(s || defaultIconFor(type));
  };
  // 系统自带项目：副标题标「mac 系统 · <目标简称>」，和分类一致好认。
  // 系统项目的目标是很长的绝对路径（/System/Applications/Notes.app），卡片窄装不下，
  // 直接截断会变成清一色的「mac 系统 ...」，所以只取最后一段（Notes / Downloads / ⌘⇧4），
  // 完整路径放到 title 里。
  const shortTarget = (it: any): string => {
    if (it.type === 'shortcut') return prettyKey(it.shortcutKeystroke || '');
    const t = String(it.target || '').trim();
    const base = t.replace(/\/+$/, '').split('/').pop() || '';
    return base.replace(/\.app$/i, '') || t;
  };
  const subOf = (it: any): string => {
    if (it.system) return 'mac 系统 · ' + (shortTarget(it) || typeName(it.type));
    return typeName(it.type) + ' · ' + (it.type === 'shortcut' ? prettyKey(it.shortcutKeystroke || '') : String(it.target || '').slice(0, 46));
  };

  // ---- 左栏卡片（还没加进场景的）----
  // ＋ 按钮 = 直接加进场景；点卡片其它位置 = 编辑这个项目（预填表单，保存后加入场景）
  const cardHtml = (it: any, isUser: boolean, alreadyIn: boolean): string =>
    `<div class="lib-card${alreadyIn ? ' in-sc' : ''}" data-lib-id="${escapeHtml(it.id)}" title="${alreadyIn ? '已经在当前场景里了，点击可编辑' : '点击编辑这个项目（存回项目库；要加进场景请点 ＋）'}">
      <div class="ic${it.system ? ' sys' : ''}"${it.system ? ' title="macOS 系统自带"' : ''}>${iconCell(it.iconPath || it.icon, it.type)}</div>
      <div class="meta">
        <div class="nm" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
        <div class="tp" title="${escapeHtml(subOf(it))}">${escapeHtml(subOf(it))}</div>
      </div>
      ${alreadyIn
        ? '<span class="badge">已在场景</span>'
        : `<button class="add" type="button" data-lib-add="${escapeHtml(it.id)}" title="添加到场景">＋</button>`}
      <button class="hid" type="button" data-lib-hide="${escapeHtml(it.id)}" title="隐藏这个项目（不常用的收起来，可随时放回来）">👁</button>
      ${isUser ? `<button class="rm" type="button" data-lib-rm="${escapeHtml(it.id)}" title="从项目库移除">×</button>` : ''}
    </div>`;

  /** 已隐藏分区里的一行：只有「放回来」一个动作 */
  const hiddenCardHtml = (it: any): string =>
    `<div class="lib-card hidden" data-lib-id="${escapeHtml(it.id)}" title="隐藏中：点 ↔ 放回到项目库（也可以点卡片编辑）">
      <div class="ic${it.system ? ' sys' : ''}">${iconCell(it.iconPath || it.icon, it.type)}</div>
      <div class="meta">
        <div class="nm" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
        <div class="tp" title="${escapeHtml(subOf(it))}">${escapeHtml(subOf(it))}</div>
      </div>
      <button class="add restore" type="button" data-lib-show="${escapeHtml(it.id)}" title="取消隐藏，放回项目库">↺</button>
    </div>`;

  const leftParts: string[] = [];

  // 「已隐藏」分区：开关打开才出现，列在最上面，每行一个「放回」按钮
  if (libShowHidden) {
    leftParts.push(
      `<div class="lib-section-title">已隐藏（${hiddenItems.length}）<span class="lib-tag">不显示在项目库里，可随时放回</span></div>` +
        (hiddenItems.length
          ? `<div class="lib-results">${hiddenItems.map((x) => hiddenCardHtml(x)).join('')}</div>`
          : '<div class="lib-empty">还没有隐藏任何项目。在项目卡片上点 👁 就能把它收起来。</div>')
    );
  }

  // 搜到像网址的内容 → 顶部给出「识别为网址」卡片，点一下读取标题与图标后添加
  // （网址模式已经有工具栏的「读取并添加」按钮，就不再重复这个卡片了）
  if (isSearch && looksLikeUrl(q)) {
    const u = q.trim();
    leftParts.push(`<div class="lib-card url" data-lib-url="${escapeHtml(u)}">
      <div class="ic">🔗</div>
      <div class="meta">
        <div class="nm">识别为网址</div>
        <div class="tp">${escapeHtml(u)} · 读取标题与图标后添加</div>
      </div>
      <button class="add" type="button" title="读取并添加到场景">＋</button>
    </div>`);
  }
  // 本机应用放最前面：这是这台 Mac 上真实装了的东西，图标是 macOS 原生 icns（和 Finder 里一致）
  if (installed.length) {
    leftParts.push(
      `<div class="lib-section-title">本机应用（${installed.length}）<span class="lib-tag">macOS 原生图标</span></div>` +
        `<div class="lib-results">${installed.map((x) => cardHtml(x, false, false)).join('')}</div>`
    );
  } else if (!libInstalledDone) {
    leftParts.push('<div class="lib-section-title">本机应用</div><div class="hint" style="margin:6px 0 0">正在读取这台 Mac 上已安装的应用…</div>');
  }
  if (pre.length) {
    leftParts.push(`<div class="lib-section-title">预制项目（${pre.length}）</div><div class="lib-results">${pre.map((x) => cardHtml(x, false, false)).join('')}</div>`);
  }
  if (usr.length) {
    const inSceneN = usr.filter((x) => inScene(x)).length;
    leftParts.push(
      `<div class="lib-section-title">我的收藏（${usr.length}）</div>` +
        `<div class="lib-results">${usr.map((x) => cardHtml(x, true, inScene(x))).join('')}</div>` +
        (inSceneN ? `<div class="hint" style="margin:8px 0 0">其中 ${inSceneN} 项已在当前场景里，标了「已在场景」；从右边移除后这里就能再加回去。</div>` : '')
    );
  }
  if (!pre.length && !usr.length && !installed.length) {
    // 分类筛选把内容筛空了：说清楚原因，别让人以为是坏了
    const catEmpty = !!libType && !q
      ? libType === 'mac'
        ? '<div class="lib-empty">「mac 系统」分类下没有还没加进场景的系统项目了，切到「全部类型」看看别的。</div>'
        : libType === 'file'
          ? '<div class="lib-empty">「文件」分类下暂时没有项目 —— 系统自带的下载、桌面、文稿等文件夹都归到了「mac 系统」分类里。</div>'
          : `<div class="lib-empty">「${escapeHtml(typeName(libType))}」分类下暂时没有还没加进场景的项目。</div>`
      : '';
    leftParts.push(
      catEmpty ||
        (isSearch && looksLikeUrl(q)
          ? '<div class="lib-empty">没有匹配的项目，但上面这条网址可以直接添加。</div>'
          : '<div class="lib-empty">没有匹配的项目。换个词试试（中文英文都行），或用右栏行内的「收藏」把常用项目存进项目库。</div>')
    );
  }

  // ---- 右栏（场景里已有的：项目管理已并到这里，启用/排序/编辑/复制/收藏/移除全在行内）----
  const rightParts: string[] = sceneItems.length
    ? sceneItems.map((it: any, idx: number) => {
        // 有检索条件时，不匹配的行淡显（但仍然可以操作）
        const dim = (libType || q) && !hit(it) ? ' dim' : '';
        return `<div class="lib-in${dim}">
          <div class="ic${it.system ? ' sys' : ''}"${it.system ? ' title="macOS 系统自带"' : ''}>${iconCell(it.iconPath || it.icon, it.type)}</div>
          <div class="meta" data-sc-edit="${escapeHtml(it.id)}" title="点击编辑这个项目">
            <div class="nm">${escapeHtml(it.name)}</div>
            <div class="tp">${escapeHtml(subOf(it))}</div>
          </div>
          <label class="switch" title="${it.enabled ? '已启用（出现在环形菜单）' : '已停用（保留在配置里，不显示）'}"><input type="checkbox" data-sc-en="${escapeHtml(it.id)}" ${it.enabled ? 'checked' : ''}><span class="slider"></span></label>
          <div class="ops">
            <button class="btn xs ghost" data-sc-up="${escapeHtml(it.id)}" type="button" title="上移" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn xs ghost" data-sc-down="${escapeHtml(it.id)}" type="button" title="下移" ${idx === sceneItems.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn xs" data-sc-editbtn="${escapeHtml(it.id)}" type="button">编辑</button>
            <button class="btn xs ghost" data-sc-dup="${escapeHtml(it.id)}" type="button" title="复制一份">复制</button>
            <button class="btn xs ghost" data-sc-save="${escapeHtml(it.id)}" type="button" title="收藏到项目库，之后可在别的场景一键添加">收藏</button>
            <button class="btn xs danger" data-sc-del="${escapeHtml(it.id)}" type="button" title="从场景移除（可随时从左边加回来）">×</button>
          </div>
        </div>`;
      })
    : ['<div class="lib-empty">这个场景还没有项目。左边点 ＋ 加进来，或点右上角「+ 添加项目」自己建一个。</div>'];

  box.innerHTML = `
    <div class="lib-split">
      <div class="lib-col">
        <div class="lib-col-title"><span>项目库 · 还没加入场景</span><span class="n">${pre.length + usr.length}</span></div>
        ${leftParts.join('')}
      </div>
      <div class="lib-col">
        <div class="lib-col-title"><span>${escapeHtml(sc.name)} · 场景已添加</span><span class="n">${sceneItems.length}</span></div>
        ${rightParts.join('')}
      </div>
    </div>`;

  // 图片加载失败就藏掉（设置页 CSP 不允许内联 onerror，只能挂事件）
  box.querySelectorAll('img').forEach((img) =>
    img.addEventListener('error', () => {
      (img as HTMLElement).style.display = 'none';
    })
  );

  // 小加号：添加到场景（整张卡片点一下效果相同）
  const findIt = (id: string): any => [...pre, ...usr, ...installed, ...hiddenItems].find((x) => x.id === id);
  box.querySelectorAll('[data-lib-add]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      const it = findIt((b as HTMLElement).dataset.libAdd!);
      if (!it) return;
      if (inScene(it)) {
        toast('已经在当前场景里了', 'info');
        return;
      }
      addLibraryItemToScene(it, libScene());
    })
  );
  // 隐藏 / 放回：点卡片上的 👁 收起来，在「已隐藏」分区点 ↺ 放回去
  box.querySelectorAll('[data-lib-hide]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      const id = (b as HTMLElement).dataset.libHide!;
      const it = findIt(id);
      toggleLibHidden(id, true);
      toast(`已隐藏「${it ? it.name : id}」，可从「已隐藏（…）」放回`, 'info');
    })
  );
  box.querySelectorAll('[data-lib-show]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      const id = (b as HTMLElement).dataset.libShow!;
      const it = findIt(id);
      toggleLibHidden(id, false);
      toast(`已放回「${it ? it.name : id}」`, 'success');
    })
  );
  box.querySelectorAll('.lib-card[data-lib-id]').forEach((c) =>
    c.addEventListener('click', () => {
      const it = findIt((c as HTMLElement).dataset.libId!);
      if (!it) return;
      const sc = libScene();
      if (inScene(it)) {
        // 已经在场景里了 → 直接编辑场景里那一条
        const exist = (sc.items || []).find((x: any) => libItemKey(x) === libItemKey(it));
        if (exist) openItemModal(exist);
        return;
      }
      // 还没加进场景 → 编辑这个项目（存回项目库；只有 ＋ 才会加进场景）
      openItemModal(null, it, undefined, { id: it.id, builtin: !!it.builtin, system: it.system === true });
    })
  );
  // 移除收藏
  box.querySelectorAll('[data-lib-rm]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      removeLibraryItem((b as HTMLElement).dataset.libRm!);
    })
  );
  // 右栏：点名称打开编辑弹窗
  box.querySelectorAll('[data-sc-edit]').forEach((m) =>
    m.addEventListener('click', () => {
      const id = (m as HTMLElement).dataset.scEdit!;
      const it = (libScene().items || []).find((x: any) => x.id === id);
      if (it) openItemModal(it);
    })
  );
  // 右栏：编辑按钮（与点名称等价，按钮更直观）
  box.querySelectorAll('[data-sc-editbtn]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      const it = findItem((b as HTMLElement).dataset.scEditbtn!);
      if (it) openItemModal(it);
    })
  );
  // 右栏：启用 / 停用（停用的项目保留在配置里，只是不出现在环形菜单）
  box.querySelectorAll('[data-sc-en]').forEach((c) =>
    c.addEventListener('change', (e: any) => {
      const it = (libScene().items || []).find((x: any) => x.id === e.target.dataset.scEn);
      if (!it) return;
      it.enabled = !!e.target.checked;
      it.updatedAt = Date.now();
      saveNow();
      renderLibResults();
    })
  );
  // 右栏：复制一份
  box.querySelectorAll('[data-sc-dup]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      const src = findItem((b as HTMLElement).dataset.scDup!);
      if (!src) return;
      const scn = libScene();
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = genId('item');
      copy.name = src.name + ' 副本';
      copy.order = scn.items.length;
      copy.createdAt = Date.now();
      copy.updatedAt = Date.now();
      scn.items.push(copy);
      renormalize(scn);
      saveNow();
      renderLibResults();
      toast('已复制项目', 'success');
    })
  );
  // 右栏：收藏进项目库（之后可以在别的场景一键添加）
  box.querySelectorAll('[data-sc-save]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      const it = findItem((b as HTMLElement).dataset.scSave!);
      if (it) void saveItemToLibrary(it).then(() => renderLibrary());
    })
  );
  // 右栏：上移 / 下移
  const moveItem = (id: string, dir: number): void => {
    const scn = libScene();
    const srt = scn.items.slice().sort((a: any, b: any) => a.order - b.order);
    const i = srt.findIndex((x: any) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= srt.length) return;
    const t = srt[i].order;
    srt[i].order = srt[j].order;
    srt[j].order = t;
    renormalize(scn);
    saveNow();
    renderLibResults();
  };
  box.querySelectorAll('[data-sc-up]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      moveItem((b as HTMLElement).dataset.scUp!, -1);
    })
  );
  box.querySelectorAll('[data-sc-down]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      moveItem((b as HTMLElement).dataset.scDown!, 1);
    })
  );
  // 右栏：× 从场景移除（移除后左边会重新出现这一项）
  box.querySelectorAll('[data-sc-del]').forEach((b) =>
    b.addEventListener('click', (e: any) => {
      e.stopPropagation();
      removeSceneItem(libScene(), (b as HTMLElement).dataset.scDel!);
    })
  );
  // 网址识别卡片
  const urlCard = box.querySelector('[data-lib-url]') as HTMLElement | null;
  if (urlCard) {
    const doAdd = async (): Promise<void> => {
      const raw = urlCard.dataset.libUrl || '';
      const target = libScene();
      const card = urlCard as HTMLElement;
      card.style.opacity = '0.5';
      try {
        const r = await addWebByUrl(raw, target);
        toast(r.msg, r.ok ? 'success' : 'error');
        if (r.ok) {
          // 加完就把检索词清掉：否则这张「识别为网址」卡片还在，容易重复添加
          libQuery = '';
          const qInp = el('lib-q') as HTMLInputElement | null;
          if (qInp) qInp.value = '';
          if (currentView === 'library') renderLibrary();
        }
      } catch (e: any) {
        toast('读取失败：' + (e?.message || e), 'error');
      } finally {
        card.style.opacity = '';
      }
    };
    urlCard.addEventListener('click', doAdd);
    const plus = urlCard.querySelector('.add') as HTMLElement | null;
    if (plus) plus.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); doAdd(); });
  }
}

/**
 * 项目库页：一个输入框两种模式（检索项目库 / 添加网址），右下角小按钮切换；
 * 下面是左右两栏（左=还没加入场景，右=场景已添加）。
 */
function renderLibrary(): void {
  // 本机应用清单懒加载（第一次进项目库页时扫一次，含原生图标，稍慢所以异步）
  void ensureInstalledApps();
  const sc = libScene();
  const sceneOpts = cfg.scenes
    .map(
      (x: any) =>
        `<option value="${x.id}" ${x.id === sc.id ? 'selected' : ''}>${escapeHtml(x.name)}（${x.items.length} 项）${isSceneOn(x) ? '' : ' · 未启用'}</option>`
    )
    .join('');
  const typeOpts = ['', 'mac', 'web', 'app', 'file', 'image', 'shortcut', 'action']
    .map((t) => `<option value="${t}" ${libType === t ? 'selected' : ''}>${t ? typeName(t) : '全部类型'}</option>`)
    .join('');
  const isSearch = libMode === 'search';
  const inputVal = isSearch ? libQuery : libUrl;
  const placeholder = isSearch
    ? '检索项目库：中文英文都能搜（github / 代码 / 复制）'
    : '粘贴网址即可自动读取网站图标和名称，例如 github.com 或 https://www.apple.com';
  const hiddenN = (Array.isArray(cfg.libHidden) ? cfg.libHidden.length : 0);
  el('view-library').innerHTML = `
    <div class="card">
      <div class="cardhead">
        <h3>项目库</h3>
        <div class="headctl">
          <span class="hint" style="margin:0">场景</span>
          <select id="lib-scene">${sceneOpts}</select>
          <button class="btn sm ghost" id="lib-import" type="button" title="从浏览器导出的书签 HTML 批量导入（Chrome / Edge / Firefox / Safari 都认）">导入书签</button>
          <button class="btn sm ghost" id="lib-autoicon" type="button" title="给还没有图标的 应用/文件/图片 项目自动读取图标">自动补全图标</button>
          <button class="btn sm" id="lib-new" type="button">+ 添加项目</button>
        </div>
      </div>
      <div class="lib-bar">
        <div class="smartinput">
          <input type="text" id="lib-q" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(inputVal)}" />
          <button class="sibtn${isSearch ? '' : ' on'}" id="lib-mode" type="button"
            title="${isSearch ? '切换到：添加网址' : '切换到：检索项目库'}">${isSearch ? '🔍' : '🔗'}</button>
        </div>
        ${isSearch
          ? `<select id="lib-type">${typeOpts}</select>`
          : '<button class="btn sm" id="lib-urladd" type="button">读取并添加</button>'}
        <button class="btn sm ghost${libShowHidden ? ' on' : ''}" id="lib-hidden" type="button"
          title="不常用的项目可以「隐藏」，在这里放回来">${libShowHidden ? '收起已隐藏' : `已隐藏（${hiddenN}）`}</button>
        <span class="hint" id="lib-msg" style="margin:0"></span>
      </div>
      <div class="lib-target">左边是<b>还没加入场景</b>的项目，点卡片右上角的小 <b>＋</b> 加到场景 <b>${escapeHtml(sc.name)}</b>（<b>只有 ＋ 才会加进去</b>）；不常用的可以点 <b>👁</b> 隐藏。右边是<b>场景里已有的</b>项目：开关管<b>启用/停用</b>，<b>↑↓</b> 排序，<b>编辑 / 复制 / 收藏 / ×</b> 都在行内（× = 从场景移除，回到左边还能再加回来）。</div>
      <div id="lib-results"></div>
      <div class="hint">预制项目覆盖常用应用、网址、快捷键、文件夹与内置动作；「我的收藏」来自你从场景里收藏的项目（行内「收藏」按钮）。输入框右下角的小按钮可在「检索」与「添加网址」之间切换。</div>
    </div>`;

  const q = el('lib-q') as HTMLInputElement;
  q.addEventListener('input', (e: any) => {
    if (libMode === 'search') {
      libQuery = e.target.value;
      renderLibResults();
    } else {
      libUrl = e.target.value;
    }
  });
  q.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && libMode === 'url') {
      e.preventDefault();
      addUrlToLibScene();
    }
  });
  // 小切换按钮：检索 ⇄ 添加网址
  (el('lib-mode') as HTMLButtonElement).addEventListener('click', () => {
    libMode = libMode === 'search' ? 'url' : 'search';
    renderLibrary();
    const i2 = el('lib-q') as HTMLInputElement | null;
    if (i2) i2.focus();
  });
  const typeSel = el('lib-type') as HTMLSelectElement | null;
  if (typeSel) {
    typeSel.addEventListener('change', (e: any) => {
      libType = e.target.value;
      renderLibResults();
    });
  }
  const urlAdd = el('lib-urladd') as HTMLButtonElement | null;
  if (urlAdd) urlAdd.addEventListener('click', () => addUrlToLibScene());
  (el('lib-scene') as HTMLSelectElement).addEventListener('change', (e: any) => {
    libSceneId = e.target.value;
    renderLibrary();
  });
  // 项目库页的「+ 添加项目」（项目管理并进来后，这是新建项目的唯一入口）
  const newBtn = el('lib-new') as HTMLButtonElement | null;
  if (newBtn) newBtn.addEventListener('click', () => openItemModal(null, undefined, libScene()));
  // 「自动补全图标」：给还是 emoji 图标的应用/文件/图片项目读一次真图标
  const autoBtn = el('lib-autoicon') as HTMLButtonElement | null;
  if (autoBtn) autoBtn.addEventListener('click', () => void autoFillIcons(autoBtn));
  // 「导入书签」：浏览器导出的 HTML 批量导入（弹窗里勾选 / 选目标）
  const importBtn = el('lib-import') as HTMLButtonElement | null;
  if (importBtn) importBtn.addEventListener('click', () => void openBookmarkImport());
  // 自检/调试钩子：带文件路径直接解析，跳过系统选择框
  (window as any).FDImportBookmarks = (file?: string) => openBookmarkImport(file);
  // 已隐藏开关：只是页面上的显示开关，不是配置
  const hiddenBtn = el('lib-hidden') as HTMLButtonElement | null;
  if (hiddenBtn) {
    hiddenBtn.addEventListener('click', () => {
      libShowHidden = !libShowHidden;
      renderLibrary();
    });
  }
  renderLibResults();
}

/** 网址模式：读取网址（标题 + favicon）后加进当前场景 */
async function addUrlToLibScene(): Promise<void> {
  const input = el('lib-q') as HTMLInputElement | null;
  const msg = el('lib-msg') as HTMLElement | null;
  const raw = (input ? input.value : libUrl).trim();
  if (!raw) {
    toast('请先粘贴网址', 'info');
    if (input) input.focus();
    return;
  }
  if (msg) msg.textContent = '读取中…';
  try {
    const r = await addWebByUrl(raw, libScene());
    toast(r.msg, r.ok ? 'success' : 'error');
    if (r.ok) {
      libUrl = '';
      if (input) input.value = '';
      if (currentView === 'library') renderLibrary();
    } else if (msg) {
      msg.textContent = r.msg;
    }
  } catch (e: any) {
    const m = '读取失败：' + (e?.message || e);
    if (msg) msg.textContent = m;
    toast(m, 'error');
  }
}

// ---------- 浏览器书签批量导入 ----------
/**
 * 书签树的「扁平化 / 检索筛选」——纯逻辑的**双胞胎副本**。
 * 权威在 src/shared/bookmarks.ts（那边带单测）；渲染进程是经典脚本、不能 import 值，
 * 所以按 sameProjectMatches / libMatches 同样的约定在这里各存一份，改动时两边同步。
 */
function flattenBookmarks(nodes: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]): void => {
    (Array.isArray(list) ? list : []).forEach((n: any) => {
      if (n.type === 'link') out.push(n);
      else if (n.children) walk(n.children);
    });
  };
  walk(nodes);
  return out;
}
function filterBookmarks(nodes: any[], q: string): any[] {
  const ql = String(q || '').trim().toLowerCase();
  if (!ql) return nodes;
  const walk = (list: any[]): any[] => {
    const out: any[] = [];
    (Array.isArray(list) ? list : []).forEach((n: any) => {
      if (n.type === 'link') {
        const hay = (n.name + ' ' + (n.url || '') + ' ' + (n.path || []).join(' ')).toLowerCase();
        if (hay.includes(ql)) out.push(n);
      } else {
        const kids = walk(n.children || []);
        if (kids.length) out.push({ ...n, children: kids });
      }
    });
    return out;
  };
  return walk(nodes);
}

/**
 * 流程：点「导入书签」→ 主进程弹选择框 + 解析（shared/bookmarks.ts）→ 这里渲染一棵可勾选的树
 * → 选好目标（项目库 / 当前场景）→ 导入。
 *
 * 几个刻意的设计：
 * · 默认导到【项目库】而不是场景 —— 浏览器书签动辄几百条，全塞进悬浮环会把菜单撑爆；
 *   先落库再挑着 ＋ 进场景才是正常用法。想直接进场景也留了单选项。
 * · 已经在项目库 / 当前场景 / 内置预制里的网址，显示成「已存在」并默认不勾，
 *   同一份文件导两次不会产生重复项。
 * · 勾选状态只按「链接」算，文件夹勾选框是「全选/全不选这一支」的快捷方式（带半选态）。
 */
type BmNode = any;
let bmRes: any = null;
let bmSel: Set<number> = new Set();
let bmClosed: Set<number> = new Set();
let bmQuery = '';
let bmTarget: 'lib' | 'scene' = 'lib';
let bmDup: Set<string> = new Set();

/** 网址比较键：去空白、去末尾斜杠、小写（http 与 https 不视为同一个，避免误杀） */
function bmKey(u: any): string {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * 已经存在的网页项目。判定口径跟着「导入目标」走：
 * · 目标 = 项目库 → 内置预制 + 我的收藏 + 当前场景 都算已存在
 * · 目标 = 场景   → 只看当前场景自己的 items
 * （否则先导进项目库、再想直接进场景时，刚入库的网址会把自己全判成重复）
 */
function bmExistingUrls(target: 'lib' | 'scene' = bmTarget): Set<string> {
  const s = new Set<string>();
  const add = (it: any): void => {
    if (!it || it.type !== 'web') return;
    const k = bmKey(it.target);
    if (k) s.add(k);
  };
  if (target === 'scene') {
    ((libScene() && libScene().items) || []).forEach(add);
    return s;
  }
  (LIB_PRESETS || []).forEach(add);
  (Array.isArray(cfg.itemLibrary) ? cfg.itemLibrary : []).forEach(add);
  ((libScene() && libScene().items) || []).forEach(add);
  return s;
}

/** 按当前 bmDup 重算默认勾选（勾上所有还不存在的） */
function bmReselect(): void {
  bmSel = new Set();
  if (!bmRes) return;
  flattenBookmarks(bmRes.nodes).forEach((n: BmNode) => {
    if (!bmDup.has(bmKey(n.url))) bmSel.add(n.id);
  });
}

/** 书签自带的图标（Chrome/Edge 会把 favicon 以 data URL 写进导出文件），太大就不要了 */
function bmIcon(n: BmNode): string {
  const ic = String(n && n.icon ? n.icon : '');
  if (ic && ic.length <= 12000) return ic;
  return '🔗';
}

async function openBookmarkImport(presetFile?: string): Promise<void> {
  let r: any = null;
  try {
    r = await api.importBookmarks(presetFile ? { file: presetFile } : undefined);
  } catch (e: any) {
    toast('导入失败：' + (e?.message || e), 'error');
    return;
  }
  if (!r || r.canceled) return;
  if (!r.ok) {
    toast(String(r.error || '没能读取这个书签文件'), 'error');
    return;
  }
  bmRes = r;
  bmQuery = '';
  bmTarget = 'lib';
  bmClosed = new Set();
  bmDup = bmExistingUrls('lib');
  // 默认全选「不是已存在」的链接
  bmReselect();
  showBookmarkModal();
}

function showBookmarkModal(): void {
  const r = bmRes;
  const sc = libScene();
  openModal(
    `<h3>导入浏览器书签</h3>
     <div class="hint" style="margin:-2px 0 10px">
       来自 <b>${escapeHtml(String(r.name || '书签文件'))}</b>：
       <span id="bm-head">${r.links} 条链接 / ${r.folders} 个文件夹${r.skipped ? ` · 跳过 ${r.skipped} 条非网页` : ''}</span><span id="bm-dup"></span>。<br>
       浏览器导出位置：Chrome「书签管理器 → 右上角 ⋮ → 导出书签」、Safari「文件 → 导出 → 书签」、Firefox「书签 → 管理 → 导入和备份 → 导出为 HTML」。
     </div>
     <div class="bm-target">
       <label class="bm-radio"><input type="radio" name="bm-target" value="lib" checked>
         <span>先放进<b>项目库</b>（推荐）<i>之后在项目库里挑着 ＋ 加进场景</i></span></label>
       <label class="bm-radio"><input type="radio" name="bm-target" value="scene">
         <span>直接加进场景 <b>${escapeHtml(sc.name)}</b><i>书签很多时会让悬浮环很挤，慎选</i></span></label>
     </div>
     <div class="bm-bar">
       <input type="text" id="bm-q" placeholder="检索书名 / 网址 / 文件夹" />
       <button class="btn xs ghost" id="bm-all" type="button">全选</button>
       <button class="btn xs ghost" id="bm-none" type="button">全不选</button>
       <span class="hint" id="bm-stat" style="margin:0"></span>
     </div>
     <div class="bm-tree" id="bm-tree"></div>
     <div class="actions">
       <button class="btn ghost" id="bm-cancel" type="button">取消</button>
       <button class="btn" id="bm-do" type="button">导入所选</button>
     </div>`,
    (m) => {
      m.classList.add('bm'); // 宽版弹窗（树下要放得下几百条）
      bmRenderTree();
      const q = m.querySelector('#bm-q') as HTMLInputElement;
      q.addEventListener('input', () => {
        bmQuery = q.value;
        bmRenderTree();
      });
      m.querySelectorAll('input[name="bm-target"]').forEach((inp: any) =>
        inp.addEventListener('change', () => {
          bmTarget = inp.value === 'scene' ? 'scene' : 'lib';
          // 目标变了，「已存在」的判定口径也跟着变 → 重算去重集合 + 重算默认勾选
          bmDup = bmExistingUrls(bmTarget);
          bmReselect();
          bmRenderTree();
        })
      );
      m.querySelector('#bm-all')!.addEventListener('click', () => {
        const shown = bmQuery ? filterBookmarks(r.nodes, bmQuery) : r.nodes;
        flattenBookmarks(shown).forEach((n: BmNode) => {
          if (!bmDup.has(bmKey(n.url))) bmSel.add(n.id);
        });
        bmRenderTree();
      });
      m.querySelector('#bm-none')!.addEventListener('click', () => {
        const shown = bmQuery ? filterBookmarks(r.nodes, bmQuery) : r.nodes;
        flattenBookmarks(shown).forEach((n: BmNode) => bmSel.delete(n.id));
        bmRenderTree();
      });
      m.querySelector('#bm-cancel')!.addEventListener('click', () => {
        bmRes = null;
        closeModal();
      });
      m.querySelector('#bm-do')!.addEventListener('click', () => void bmDoImport());
      q.focus();
    }
  );
}

/** 画树（只重画这一块，检索框不重建，输入焦点不丢） */
function bmRenderTree(): void {
  const box = el('bm-tree');
  if (!box || !bmRes) return;
  const nodes: BmNode[] = bmQuery ? filterBookmarks(bmRes.nodes, bmQuery) : bmRes.nodes;
  const out: string[] = [];
  const walk = (list: BmNode[]): void => {
    list.forEach((n: BmNode) => {
      const pad = 8 + Math.max(0, (n.depth || 1) - 1) * 15;
      if (n.type === 'folder') {
        const kids = n.children || [];
        const links = flattenBookmarks(kids);
        const closed = bmClosed.has(n.id);
        const selN = links.filter((x: BmNode) => bmSel.has(x.id)).length;
        const dupN = links.filter((x: BmNode) => bmDup.has(bmKey(x.url))).length;
        out.push(
          `<div class="bm-row folder" data-bm-folder="${n.id}" style="padding-left:${pad}px">
             <span class="caret">${closed ? '▸' : '▾'}</span>
             <input type="checkbox" data-bm-toggle="${n.id}" ${links.length && selN === links.length ? 'checked' : ''}>
             <span class="bm-name" title="${escapeHtml(n.path.concat(n.name).join(' / '))}">${escapeHtml(n.name)}</span>
             <span class="bm-n">${selN}/${links.length}${dupN ? ` · ${dupN} 已存在` : ''}</span>
           </div>`
        );
        if (!closed) walk(kids);
        return;
      }
      const dup = bmDup.has(bmKey(n.url));
      let host = '';
      try {
        host = new URL(n.url).hostname.replace(/^www\./i, '');
      } catch {
        host = '';
      }
      out.push(
        `<div class="bm-row link${dup ? ' dup' : ''}" style="padding-left:${pad + 18}px">
           <input type="checkbox" data-bm-link="${n.id}" ${bmSel.has(n.id) ? 'checked' : ''} ${dup ? 'disabled' : ''}>
           <span class="bm-name" title="${escapeHtml(n.url)}">${escapeHtml(n.name)}</span>
           <span class="bm-url">${escapeHtml(host)}</span>
           ${dup ? '<span class="bm-tag">已存在</span>' : ''}
         </div>`
      );
    });
  };
  walk(nodes);
  box.innerHTML = out.join('') || '<div class="bm-empty">没有匹配的书签</div>';

  // 半选态：父文件夹里只选了一部分
  box.querySelectorAll<HTMLInputElement>('input[data-bm-toggle]').forEach((inp) => {
    const id = Number(inp.dataset.bmToggle);
    const found = bmFindFolder(bmRes.nodes, id);
    if (!found) return;
    const links = flattenBookmarks(found.children || []);
    if (!links.length) return;
    const selN = links.filter((x: BmNode) => bmSel.has(x.id)).length;
    inp.indeterminate = selN > 0 && selN < links.length;
  });

  // 交互：折叠 / 勾选
  box.querySelectorAll('.bm-row.folder').forEach((row: any) => {
    const id = Number(row.dataset.bmFolder);
    row.addEventListener('click', (ev: Event) => {
      if ((ev.target as HTMLElement).tagName === 'INPUT') return;
      if (bmClosed.has(id)) bmClosed.delete(id);
      else bmClosed.add(id);
      bmRenderTree();
    });
  });
  box.querySelectorAll<HTMLInputElement>('input[data-bm-toggle]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const found = bmFindFolder(bmRes!.nodes, Number(inp.dataset.bmToggle));
      if (!found) return;
      const links = flattenBookmarks(found.children || []);
      const selN = links.filter((x: BmNode) => bmSel.has(x.id)).length;
      const wantAll = selN < links.length; // 没全选 → 一键全选；全选了 → 一键清空
      links.forEach((x: BmNode) => {
        if (wantAll) {
          if (!bmDup.has(bmKey(x.url))) bmSel.add(x.id);
        } else bmSel.delete(x.id);
      });
      bmRenderTree();
    })
  );
  box.querySelectorAll<HTMLInputElement>('input[data-bm-link]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const id = Number(inp.dataset.bmLink);
      if (inp.checked) bmSel.add(id);
      else bmSel.delete(id);
      bmUpdateStat();
    })
  );
  bmUpdateStat();
}

function bmFindFolder(list: BmNode[], id: number): BmNode | null {
  for (const n of list) {
    if (n.type === 'folder') {
      if (n.id === id) return n;
      const got = bmFindFolder(n.children || [], id);
      if (got) return got;
    }
  }
  return null;
}

function bmUpdateStat(): void {
  if (!bmRes) return;
  const all = flattenBookmarks(bmRes.nodes);
  const n = all.filter((x: BmNode) => bmSel.has(x.id) && !bmDup.has(bmKey(x.url))).length;
  const stat = el('bm-stat');
  if (stat) stat.textContent = `已选 ${n} / 共 ${all.length} 条`;
  // 头部那句「N 条已经存在」跟着目标变（项目库口径 / 场景口径不一样）
  const dupN = all.filter((x: BmNode) => bmDup.has(bmKey(x.url))).length;
  const dupEl = el('bm-dup');
  if (dupEl) {
    dupEl.innerHTML = dupN ? ` · <b>${dupN}</b> 条${bmTarget === 'scene' ? '已经在当前场景里' : '已经在项目库里'}` : '';
  }
  const btn = el('bm-do') as HTMLButtonElement | null;
  if (btn) {
    btn.textContent = n ? `导入所选（${n}）` : '导入所选';
    btn.disabled = n === 0;
  }
}

/** 真正落盘：按目标写进项目库或当前场景 */
async function bmDoImport(): Promise<void> {
  if (!bmRes) return;
  const picked = flattenBookmarks(bmRes.nodes).filter((n: BmNode) => bmSel.has(n.id) && !bmDup.has(bmKey(n.url)));
  if (!picked.length) {
    toast('还没有选中任何书签', 'info');
    return;
  }
  const sc = libScene();
  let added = 0;
  if (bmTarget === 'lib') {
    if (!Array.isArray(cfg.itemLibrary)) cfg.itemLibrary = [];
    picked.forEach((n: BmNode) => {
      const k = bmKey(n.url);
      if (cfg.itemLibrary!.some((x: any) => x.type === 'web' && bmKey(x.target) === k)) return;
      cfg.itemLibrary!.push({
        id: genId('lib'),
        name: String(n.name || n.url),
        type: 'web',
        target: String(n.url),
        icon: bmIcon(n),
        // 文件夹路径也存成关键词：以后搜「技术」「工具」能直接搜到这批书签
        keywords: [String(n.name || ''), ...(n.path || [])].filter(Boolean),
        createdAt: Date.now(),
      });
      added++;
    });
    await persist();
    toast(`已导入 ${added} 条书签到项目库（在项目库里挑着 ＋ 加进场景）`, 'success');
  } else {
    picked.forEach((n: BmNode) => {
      const k = bmKey(n.url);
      if ((sc.items || []).some((x: any) => x.type === 'web' && bmKey(x.target) === k)) return;
      sc.items.push({
        id: genId('item'),
        name: String(n.name || n.url),
        type: 'web',
        target: String(n.url),
        icon: bmIcon(n),
        order: (sc.items || []).length,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      added++;
    });
    renormalize(sc);
    await persist();
    toast(`已把 ${added} 条书签加进场景「${sc.name}」`, 'success');
  }
  bmRes = null;
  closeModal();
  if (currentView === 'library') renderLibrary();
}

// ---------- 导航 ----------
const RENDER: Record<string, () => any> = {
  general: renderGeneral,
  scenes: renderScenes,
  shortcuts: renderShortcuts,
  library: renderLibrary,
  tools: renderTools,
  about: renderAbout,
};
function renderNav(): void {
  el('nav').innerHTML = Object.keys(RENDER)
    .map((k) => `<button data-view="${k}" class="${k === currentView ? 'active' : ''}">${TITLES[k]}</button>`)
    .join('');
  el('nav').querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => { currentView = (b as HTMLElement).dataset.view!; renderView(); })
  );
}
function renderView(): void {
  el('nav').querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.view === currentView));
  el('viewTitle').textContent = TITLES[currentView];
  document.querySelectorAll('section.view').forEach((s) => s.classList.remove('active'));
  el('view-' + currentView).classList.add('active');
  const r = RENDER[currentView]();
  if (r && typeof r.then === 'function') r.catch((e: any) => toast('渲染出错: ' + e.message, 'error'));
}

// ---------- 全局：禁止把非输入区的文字选中 ----------
// 起因：拖音量 / 不透明度 / 圆点大小这类滑杆时，鼠标从滑杆划到旁边的说明文字上，
// 整段文字被选中，滑杆跟着「卡住」不动。index.html 里已经对 html,body 设了
// user-select:none，但两种情况下仍会误选：
//   ① ⌘A / ⌘C 这类快捷键绕过 CSS，照样能选中全页文字（拖滑杆时手抖按住 ⌘ 就中招）；
//   ② 某些 Chromium 版本拖 input[type=range] 时会顺手起一个文档选区。
// 所以这里再拦一层：只有「能自己打字进去的地方」放行，其它地方一律吞掉。
const TEXT_INPUT_TYPES = ['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'];

/** 这个节点是不是「能自己打字进去」的地方（只有这类保留选中 / 复制粘贴） */
function isTypingTarget(t: EventTarget | null): boolean {
  const n = t as HTMLElement | null;
  if (!n || !n.tagName) return false;
  const tag = n.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const ty = String((n as HTMLInputElement).type || 'text').toLowerCase();
    return TEXT_INPUT_TYPES.indexOf(ty) >= 0;
  }
  if (n.isContentEditable) return true;
  return !!(n.closest && n.closest('[contenteditable="true"]'));
}

let copyHintShown = false;
document.addEventListener(
  'keydown',
  (e: KeyboardEvent) => {
    if (recActive) return; // 录制快捷键时让路，⌘A 之类也要能录下来
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const k = String(e.key || '').toLowerCase();
    if (k !== 'a' && k !== 'c' && k !== 'x') return;
    if (isTypingTarget(e.target)) return; // 输入框里的全选 / 复制 / 剪切照常可用
    e.preventDefault();
    if (k === 'c' && !copyHintShown) {
      copyHintShown = true;
      toast('设置页已关闭文字选中；要复制诊断信息请到「关于」页点「复制诊断信息」', 'info');
    }
  },
  true
);

// 兜底：真拖到滑杆上时，先把已有选区清掉，避免带出一段高亮
document.addEventListener(
  'mousedown',
  (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t || !t.tagName) return;
    const isRange = t.tagName.toLowerCase() === 'input' && String((t as HTMLInputElement).type).toLowerCase() === 'range';
    if (!isRange) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
  },
  true
);

// ---------- 初始化 ----------
let pendingFocusItem: string | null = null;
let pendingFocusScene: string | null = null;
let pendingGotoView: string | null = null;

/** 从悬浮菜单右键「编辑…」跳进来：定位场景 + 打开该项目编辑弹窗 */
function applyFocusItem(id: string): void {
  const it = findItem(id);
  if (!it) {
    toast('该项目已被删除', 'error');
    return;
  }
  const sc = sceneOfItem(id);
  libSceneId = sc.id;
  currentView = 'library';
  renderNav();
  renderView();
  openItemModal(it);
}

/** 主进程要求直接切到某一页（悬浮菜单右键「打开项目库…」） */
function gotoView(v: string): void {
  const target = TITLES[v] ? v : 'general';
  currentView = target;
  renderNav();
  renderView();
}

/** 从悬浮菜单右键「编辑所属场景…」跳进来：打开场景编辑弹窗 */
function applyFocusScene(id: string): void {
  const sc = cfg.scenes.find((x: any) => x.id === id);
  if (!sc) return;
  appearSceneId = id;
  libSceneId = id;
  currentView = 'scenes';
  renderNav();
  renderView();
  openSceneModal(sc);
}

(async () => {
  api.onSceneChanged((nc: any) => {
    // 自己刚保存引发的广播：设置页不重建（否则拖到一半的滑杆会被换掉），
    // 也不要用主进程那份覆盖本地 —— 本地才是正在编辑的现场
    if (Date.now() < ignoreBroadcastUntil) return;
    cfg = nc;
    if (cfg) renderView();
  });
  api.onToast((m: string, k: string) => toast(m, k));
  api.onFocusItem((id: string) => {
    if (!cfg) {
      pendingFocusItem = id;
      return;
    }
    applyFocusItem(id);
  });
  api.onFocusScene((id: string) => {
    if (!cfg) {
      pendingFocusScene = id;
      return;
    }
    applyFocusScene(id);
  });
  // 悬浮菜单右键「打开项目库…」：直接切页（配置还没到就先记着，init 末尾补上）
  api.onGotoView?.((v: string) => {
    if (!cfg) {
      pendingGotoView = v;
      return;
    }
    gotoView(v);
  });

  cfg = await api.getConfig();
  applyShowHints(); // 「显示提示文字」关掉时，打开设置窗口就别再显示那些灰色说明
  applySoundEngine(); // 音效音量先跟配置对齐（试听时用当前音量）
  // 内置动作清单（输入法切换 / 便签）：项目类型下拉与「工具」页都要用
  try {
    BUILTINS = (await api.builtinActions()) || [];
  } catch {
    BUILTINS = [];
  }
  // 内置「项目库」预制条目：主进程权威列表（渲染进程是经典脚本，不能 import 值）
  try {
    LIB_PRESETS = (await api.libraryPresets?.()) || [];
  } catch {
    LIB_PRESETS = [];
  }
  el('modalBg').addEventListener('click', (e) => {
    if (e.target === el('modalBg')) closeModal();
  });
  // 保存：手动点按钮 = 立刻落盘 + 写一份备份 + 明确反馈；不改动也照存（用户点了就该存）
  el('saveTop').addEventListener('click', async () => {
    const btn = el('saveTop') as HTMLButtonElement;
    // 连点保护：保存中 / 成功提示期内不再重复触发
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    btn.disabled = true;
    const orig = btn.dataset.origLabel || btn.textContent || '保存';
    btn.dataset.origLabel = orig;
    btn.textContent = '保存中…';
    let ok = false;
    try {
      ok = await flushSave({ backup: true });
    } finally {
      btn.classList.remove('busy');
      btn.disabled = false;
    }
    if (ok) {
      flashSaved(btn, '已保存');
      toast('已保存', 'success');
    } else {
      btn.textContent = orig;
      setSaveState('dirty');
    }
  });
  // 关窗口 / 隐藏前把没落盘的改动补上（5 秒还没到就被关掉的场景）
  window.addEventListener('beforeunload', () => {
    if (!dirty) return;
    try {
      void api.saveConfig(cfg, { backup: true });
    } catch {
      /* 进程正在退出，忽略 */
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && dirty) void flushSave({ auto: true });
  });

  setSaveState('clean');
  renderNav();
  renderView();
  renderPermBox();

  if (pendingFocusItem) {
    const id = pendingFocusItem;
    pendingFocusItem = null;
    applyFocusItem(id);
  }
  if (pendingFocusScene) {
    const id = pendingFocusScene;
    pendingFocusScene = null;
    applyFocusScene(id);
  }
  if (pendingGotoView) {
    const v = pendingGotoView;
    pendingGotoView = null;
    gotoView(v);
  }
})();
})();

