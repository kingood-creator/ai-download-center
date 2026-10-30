// 悬浮窗：透明 / 置顶 / 动态尺寸（收起=小窗、展开=大窗）/ 拖动 / 边界约束
// 说明：macOS 上 setIgnoreMouseEvents(true,{forward:true}) 不能可靠转发 hover 事件，
// 会导致圆点无法点击/拖动。因此改为「窗口始终接收鼠标事件 + 按状态动态改尺寸」的方案：
// 收起时窗口只有圆点大小，展开时扩展到容纳环形菜单；圆点始终位于窗口中心，屏幕位置不变。
import { BrowserWindow, screen, Rectangle } from 'electron';
import * as path from 'path';
import { log } from './Logging';
import { attachTextEditContextMenu } from './ContextMenu';

export const COLLAPSED_DEFAULT = 116; // 收起时默认边长（含光晕）
export const EXPANDED_DEFAULT = 420;  // 展开时默认边长

export class FloatingWindow {
  win: BrowserWindow | null = null;

  /**
   * 圆点的「锚点」= 窗口中心的理想屏幕坐标。
   *
   * 背景：窗口是正方形、圆点永远在正中心，但不同场景的收起/展开尺寸不一样
   *（dotSize / ringRadius 都是每个场景独立的）。以前 resize 是从**当前窗口 bounds**
   * 反算中心再按新尺寸摆回去，一旦窗口贴近屏幕边缘就会被 workArea 夹住 ——
   * 中心被挪走、圆点跟着跳；再切回小尺寸也不会回到原位（窗口一路往左飘）。
   * 场景之间尺寸差越大、圆点离边缘越近，跳得越明显，就是反馈的
   * 「不同场景的窗口位置不一致」。
   *
   * 现在改成：一切 resize 都从锚点算，夹取只影响这一次真正落下去的 bounds，
   * 锚点本身不动。于是切场景时圆点钉在原地；被边缘夹过的展开态收回去后也能归位。
   * 只有用户自己拖动窗口（以及 setWindowPos）才更新锚点。
   */
  private anchor: { x: number; y: number } | null = null;

  // ---- 拖动状态（主进程驱动）----
  private dragTimer: NodeJS.Timeout | null = null;
  private dragMoved = false;

  create(): BrowserWindow {
    const { workArea } = screen.getPrimaryDisplay();
    const s = COLLAPSED_DEFAULT;
    this.win = new BrowserWindow({
      width: s,
      height: s,
      x: Math.round(workArea.x + workArea.width - s - 70),
      y: Math.round(workArea.y + 48),
      transparent: true,
      frame: false,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      // macOS 关键项：窗口未激活时，第一次点击也直接传给页面，
      // 否则「悬停有光标但第一次点击被吞掉」→ 看起来点不动、拖不动。
      acceptFirstMouse: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'floating', 'index.html'));
    attachTextEditContextMenu(this.win);
    this.win.setAlwaysOnTop(true, 'floating');
    // 全屏应用 / 不同 Space 也能显示
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // 记下初始锚点（圆点中心）：之后所有 resize 都按它摆，切场景时圆点不会漂
    {
      const b0 = this.win.getBounds();
      this.anchor = { x: b0.x + b0.width / 2, y: b0.y + b0.height / 2 };
    }

    this.win.once('ready-to-show', () => {
      this.win?.show();
      // 显式确保窗口接收鼠标事件（不做点击穿透）
      this.win?.setIgnoreMouseEvents(false);
    });

    this.win.on('closed', () => {
      this.win = null;
    });

    return this.win;
  }

  /** 拿锚点；还没记过就以当前窗口中心为准（首帧 / 老路径兜底） */
  private anchorPoint(): { x: number; y: number } {
    if (this.anchor) return this.anchor;
    if (this.win) {
      const b = this.win.getBounds();
      this.anchor = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      return this.anchor;
    }
    const { workArea } = screen.getPrimaryDisplay();
    this.anchor = { x: workArea.width / 2, y: workArea.height / 2 };
    return this.anchor;
  }

  /**
   * 按锚点算出「窗口中心落在锚点上」的左上角，再夹进屏幕可见区。
   * 夹取只改返回值，不回写锚点 —— 这样被边缘挤过的窗口，缩回去时能回到锚点。
   */
  private boundsForAnchor(w: number, h: number): Rectangle {
    const a = this.anchorPoint();
    const disp = screen.getDisplayNearestPoint({ x: Math.round(a.x), y: Math.round(a.y) });
    const wa = disp.workArea;
    const nx = Math.max(wa.x, Math.min(Math.round(a.x - w / 2), wa.x + wa.width - w));
    const ny = Math.max(wa.y, Math.min(Math.round(a.y - h / 2), wa.y + wa.height - h));
    return { x: nx, y: ny, width: w, height: h };
  }

  /**
   * 动态调整窗口尺寸，并保持窗口中心（=圆点）在屏幕上的位置不变。
   * mode=expanded 时 size 由渲染进程按场景的 ringRadius/iconSize 计算传入。
   *
   * 尺寸是**按场景**变的（每场景 dotSize / ringRadius 独立），所以这里一律从锚点反算，
   * 保证「切场景 → 圆点原地不动」；只有用户拖动才会真正挪走锚点。
   */
  resize(mode: 'collapsed' | 'expanded', size: number): void {
    if (!this.win) return;

    let s = Math.round(size);
    if (!s || Number.isNaN(s)) s = mode === 'expanded' ? EXPANDED_DEFAULT : COLLAPSED_DEFAULT;
    s = Math.max(120, Math.min(760, s));

    const a = this.anchorPoint();
    const disp = screen.getDisplayNearestPoint({ x: Math.round(a.x), y: Math.round(a.y) });
    const wa = disp.workArea;
    s = Math.min(s, wa.width, wa.height);

    const r = this.boundsForAnchor(s, s);
    this.win.setBounds({ x: r.x, y: r.y, width: s, height: s });
    log(`悬浮窗 resize -> ${mode} ${s}px @(${r.x},${r.y}) anchor=(${Math.round(a.x)},${Math.round(a.y)})`);
  }

  /**
   * 非正方形调整（长按选场景窗口）：宽高独立设置，窗口中心（=圆点）位置不变。
   * 由用户在设置里指定；未指定的维度走 resize(mode, size) 的正方形逻辑。
   */
  resizeRect(width: number, height: number): void {
    if (!this.win) return;
    const b = this.win.getBounds();

    let w = Math.round(width);
    let h = Math.round(height);
    if (!w || Number.isNaN(w)) w = b.width;
    if (!h || Number.isNaN(h)) h = b.height;
    w = Math.max(120, Math.min(760, w));
    h = Math.max(120, Math.min(760, h));

    const a = this.anchorPoint();
    const disp = screen.getDisplayNearestPoint({ x: Math.round(a.x), y: Math.round(a.y) });
    const wa = disp.workArea;
    w = Math.min(w, wa.width);
    h = Math.min(h, wa.height);

    const r = this.boundsForAnchor(w, h);
    this.win.setBounds({ x: r.x, y: r.y, width: w, height: h });
    log(`悬浮窗 resizeRect -> ${w}x${h} @(${r.x},${r.y})`);
  }

  /** 把窗口定位到指定坐标（保持当前尺寸，圆点仍在窗口中心）；这会挪动锚点 */
  setWindowPos(x: number, y: number): void {
    if (!this.win) return;
    const b = this.win.getBounds();
    const rect = this.clamp(x, y, b.width);
    this.win.setPosition(rect.x, rect.y);
    // 显式定位＝用户/配置指定的位置，作为新的锚点
    this.anchor = { x: rect.x + b.width / 2, y: rect.y + b.height / 2 };
  }

  /** 当前圆点（窗口中心）锚点；自检脚本用它验证「切场景位置不动」 */
  getAnchor(): { x: number; y: number } | null {
    return this.anchor ? { x: this.anchor.x, y: this.anchor.y } : null;
  }

  getWindowPos(): { x: number; y: number } {
    if (!this.win) return { x: 0, y: 0 };
    const [x, y] = this.win.getPosition();
    return { x, y };
  }

  /** 确保窗口不完全移出所有屏幕 */
  private clamp(x: number, y: number, size: number): Rectangle {
    const margin = 24;
    for (const d of screen.getAllDisplays()) {
      const wa = d.workArea;
      const overlapX = Math.min(x + size, wa.x + wa.width) - Math.max(x, wa.x);
      const overlapY = Math.min(y + size, wa.y + wa.height) - Math.max(y, wa.y);
      if (overlapX > margin && overlapY > margin) return { x, y, width: size, height: size };
    }
    const wa = screen.getPrimaryDisplay().workArea;
    return {
      x: Math.max(wa.x, Math.min(x, wa.x + wa.width - size)),
      y: Math.max(wa.y, Math.min(y, wa.y + wa.height - size)),
      width: size,
      height: size,
    };
  }

  toggleVisibility(): void {
    if (!this.win) return;
    if (this.win.isVisible()) this.win.hide();
    else this.win.show();
  }

  /** 让悬浮窗获得焦点，成为 key window（保证鼠标事件与 Esc 稳定） */
  focus(): void {
    if (!this.win) return;
    try {
      if (!this.win.isVisible()) this.win.show();
      this.win.focus();
    } catch {
      /* ignore */
    }
  }

  // ---------- 拖动（主进程轮询光标）----------
  // 为什么不用渲染进程的 mousemove：窗口被移动后 Chromium 可能不再派发 mousemove，
  // 拖动会立刻卡死。由主进程按光标绝对坐标移动窗口最稳，且窗口移动不影响光标读数。

  startDrag(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.stopDrag();
    const b = this.win.getBounds();
    const cur = screen.getCursorScreenPoint();
    const offX = cur.x - b.x;
    const offY = cur.y - b.y;
    const startCursorX = cur.x;
    const startCursorY = cur.y;
    const w = b.width;
    const h = b.height;

    this.dragMoved = false;
    let ticks = 0;
    let lastX = Number.NaN;
    let lastY = Number.NaN;

    this.dragTimer = setInterval(() => {
      if (!this.win || this.win.isDestroyed()) {
        this.stopDrag();
        return;
      }
      // 兜底：超过 20 秒仍未收到 dragEnd（例如 mouseup 丢失）就自动结束，避免窗口自己乱跑
      if (++ticks > 1200) {
        log('拖动超时，自动结束');
        this.stopDrag();
        return;
      }
      const p = screen.getCursorScreenPoint();
      if (!this.dragMoved && (Math.abs(p.x - startCursorX) > 3 || Math.abs(p.y - startCursorY) > 3)) {
        this.dragMoved = true;
      }
      const nx = p.x - offX;
      const ny = p.y - offY;
      if (nx === lastX && ny === lastY) return;
      lastX = nx;
      lastY = ny;
      this.win.setBounds({ x: nx, y: ny, width: w, height: h });
      // 拖动是用户主动摆位：锚点跟着走（下一轮 resize 就以新位置为准）
      this.anchor = { x: nx + w / 2, y: ny + h / 2 };
    }, 16);
  }

  /** 结束拖动，返回本次是否真的移动过（用于区分「点击」与「拖动」） */
  stopDrag(): boolean {
    if (this.dragTimer) {
      clearInterval(this.dragTimer);
      this.dragTimer = null;
    }
    const moved = this.dragMoved;
    this.dragMoved = false;
    return moved;
  }

  hide(): void {
    this.win?.hide();
  }
}
