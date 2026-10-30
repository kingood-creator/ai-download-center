// FloatDesk 主入口：组装各模块、注册 IPC、窗口与托盘生命周期
import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, screen, clipboard } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Channels } from '../shared/ipc';
import { AppConfig, MenuItem, Scene } from '../shared/types';
import { ConfigStore } from './ConfigStore';
import { FloatingWindow } from './FloatingWindow';
import { SettingsWindow } from './SettingsWindow';
import { openPreview } from './PreviewWindow';
import { ActionDeps, executeItem, frontmostAppName } from './ActionRegistry';
import { ShortcutManager, ShortcutCallbacks } from './ShortcutManager';
import { SceneManager } from './SceneManager';
import { checkAccessibility, openAccessibilitySettings } from './PermissionManager';
import { probeWeb } from './WebProbe';
import { probeLocalIcon } from './FileIcon';
import * as IconLibrary from './IconLibrary';
import { sameProjectMatches } from '../shared/items';
import { buildMenuTemplate } from './appMenu';
import { setOpenAtLogin } from './AutoLaunchManager';
import { initLogging, log, getLog, getDiagnostics } from './Logging';
import { BUILTIN_ACTIONS } from '../shared/builtins';
import { buildBuiltinLibrary } from '../shared/itemLibrary';
import { parseBookmarkHtml } from '../shared/bookmarks';
import { resolveInstalledApp } from '../shared/macapps';
import { listInstalledAppsWithIcons, resolvePresetIcons } from './MacApps';
import { repairConfig } from './Repair';
import { NOTE_PAGES_MAX, NOTE_PRESET_COLORS, addNotePage, noteBookActive, patchNotePage, removeNotePage, setActiveNotePage } from '../shared/note';
import * as InputMethod from './InputMethod';
import { NoteWindow, defaultNoteConfig } from './NoteWindow';
import { pageHistory } from './NoteStore';
import { KeyBlocker } from './KeyBlocker';
import { SOUND_PRESETS, SOUND_GROUP_LABELS, DEFAULT_SOUND_CONFIG, SOUND_NONE } from '../shared/sounds';
import { soundDataById, preloadSoundFiles } from './SoundLibrary';

initLogging();log('FloatDesk 启动');

// 菜单音效：Chromium 默认要求「用户手势」才允许 AudioContext 发声，
// 而悬浮菜单多半是点圆点/按全局快捷键后由系统唤起，且悬停本身不算手势 →
// 统一放开（桌面应用不需要网页那套自动播放限制）。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const store = new ConfigStore();
const sm = new SceneManager(store.config);
const floating = new FloatingWindow();
const settingsWin = new SettingsWindow();
const shortcutMgr = new ShortcutManager();
// 录制快捷键时的系统快捷键屏蔽桥（启动/停止由设置页的录制按钮驱动）
const keyBlocker = new KeyBlocker();
let tray: Tray | null = null;

// 悬浮球「链接到的目标窗口」：点悬浮球瞬间捕获的前台应用名。
// 有了它，从悬浮球发出的快捷方式才会真正落到被操控的程序上，而不是被抢焦点的 FloatDesk。
let linkedTargetApp: string | null = null;
// 当前这次 runItemById 是否来自悬浮球界面（决定要不要走「链接窗口」逻辑）
let currentRunFromFloating = false;

/** 捕获当前前台应用作为「链接目标」（仅当它不是 FloatDesk 自己时更新，避免二次点击把自己覆盖掉） */
function captureFrontmost(): void {
  const fm = frontmostAppName();
  if (fm && !/floatdesk/i.test(fm)) {
    linkedTargetApp = fm;
    floating.win?.webContents.send(Channels.floatLinked, fm);
  }
}

// 便签窗口：配置读写挂在 store.config.note 上（老配置缺字段时由 ConfigStore.migrate 补齐）
const noteWin = new NoteWindow({
  getNoteConfig: () => store.config.note || defaultNoteConfig(),
  patchNoteConfig: (patch) => {
    const base = store.config.note || defaultNoteConfig();
    store.config.note = { ...base, ...patch };
    // 拖动便签时每几百毫秒就会写一次，这里不备份，免得 backups 目录被刷满
    store.save(store.config, { backup: false });
  },
});

const actionDeps: ActionDeps = {
  openPreview,
  runItemById,
  // 只有从悬浮球界面触发的动作才返回链接窗口；全局热键等其它入口返回 null（发前台）
  getLinkedAppName: () => (currentRunFromFloating ? linkedTargetApp : null),
  runBuiltin: async (key: string) => {
    if (key === 'ime:switch') {
      const im = store.config.inputMethod || { chineseId: null, englishId: null };
      const r = await InputMethod.toggle(im.chineseId, im.englishId);
      if (!r.ok) toast('输入法切换失败：' + (r.error || '未知错误'), 'error');
      else toast(r.via === 'keystroke' ? '已切换输入法（模拟切换键）' : '已切换输入法', 'success');
      return r;
    }
    if (key === 'note:open') {
      noteWin.open();
      return { ok: true };
    }
    toast('未知内置动作: ' + key, 'error');
    return { ok: false, error: '未知内置动作: ' + key };
  },
};

// ---------- 工具 ----------

function findItem(id: string): MenuItem | null {
  for (const s of store.config.scenes) {
    const it = s.items.find((i) => i.id === id);
    if (it) return it;
  }
  return null;
}

function toast(msg: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  for (const w of [floating.win, settingsWin.win]) {
    if (w && !w.isDestroyed()) w.webContents.send(Channels.toast, msg, kind);
  }
}

/**
 * 把配置推给窗口。
 * opts.toSettings = false：只推给悬浮窗 —— 设置页自己发起的「实时预览」不该回推给它，
 * 否则设置页会重建 DOM，正在拖的滑杆会被换掉（这正是「拖滑杆卡住」的根因）。
 */
function broadcastScene(opts?: { toSettings?: boolean }): void {
  const cfg = store.config;
  const wins = [floating.win];
  if (opts?.toSettings !== false) wins.push(settingsWin.win);
  for (const w of wins) {
    if (w && !w.isDestroyed()) w.webContents.send(Channels.sceneChanged, cfg);
  }
}

function runLaunchActions(scene: Scene): void {
  const toRun: MenuItem[] = [];
  if (scene.autoLaunchApps) scene.items.filter((i) => i.enabled && i.type === 'app').forEach((i) => toRun.push(i));
  if (scene.autoOpenWebsites) scene.items.filter((i) => i.enabled && i.type === 'web').forEach((i) => toRun.push(i));

  const orderMap = new Map(scene.launchActions.map((a) => [a.itemId, a]));
  toRun.sort((a, b) => {
    const oa = orderMap.get(a.id)?.order ?? 999;
    const ob = orderMap.get(b.id)?.order ?? 999;
    return oa - ob;
  });

  let i = 0;
  for (const item of toRun) {
    const delay = orderMap.get(item.id)?.delayMs ?? i * 300;
    setTimeout(() => {
      const r = executeItem(item, actionDeps);
      if (!r.ok) toast(`启动失败: ${item.name} - ${r.error}`, 'error');
      else toast(`已启动: ${item.name}`, 'success');
    }, delay);
    i += 1;
  }
}

function resyncAll(): string[] {
  const failures = shortcutMgr.syncFromConfig(store.config, shortcutCallbacks);
  setOpenAtLogin(!!store.config.appearance.openAtLogin);
  floating.win?.setAlwaysOnTop(!!store.config.appearance.alwaysOnTop, 'floating');
  return failures;
}

/**
 * 保存配置并同步快捷键/窗口/广播；runLaunchIfChanged 控制是否在场景切换时自动启动工作环境。
 * opts.backup = false：自动保存（5 秒防抖）不写备份，免得备份目录里堆一堆几乎一样的快照；
 * 用户手点「保存」时仍然备份，留一个可回滚的里程碑。
 */
function commitConfig(
  cfg: AppConfig,
  runLaunchIfChanged: boolean,
  opts?: { backup?: boolean }
): { ok: boolean; error?: string; failures?: string[] } {
  const prev = store.config.currentSceneId;
  const res = store.save(cfg, opts && typeof opts.backup === 'boolean' ? { backup: opts.backup } : undefined);
  if (!res.ok) return { ok: false, error: res.error };
  const failures = resyncAll();
  broadcastScene();
  if (runLaunchIfChanged && cfg.currentSceneId !== prev) {
    const sc = sm.get(cfg.currentSceneId);
    if (sc) runLaunchActions(sc);
  }
  if (failures.length) toast('部分快捷键注册失败，请到「快捷键」检查', 'error');
  return { ok: true, failures };
}

function runItemById(id: string, opts?: { fromFloating?: boolean }): void {
  const item = findItem(id);
  if (!item) {
    toast('未找到项目: ' + id, 'error');
    return;
  }
  if (item.type === 'shortcut' && item.shortcutKind === 'global' && item.target) {
    return runItemById(item.target);
  }
  // 标记本次执行来源：来自悬浮球界面才走「链接窗口」逻辑，否则发当前前台
  currentRunFromFloating = !!(opts && opts.fromFloating);
  try {
    const r = executeItem(item, actionDeps);
    if (!r.ok) toast(`${item.name}: ${r.error}`, 'error');
    else toast(`已执行: ${item.name}`, 'success');
  } finally {
    currentRunFromFloating = false;
  }
}

function sceneOfItem(id: string): Scene | null {
  for (const s of store.config.scenes) if (s.items.some((i) => i.id === id)) return s;
  return null;
}

/** 保存 + 同步快捷键/窗口 + 广播（供右键菜单这类「就地修改」使用） */
function saveAndSync(msg?: string, kind: 'success' | 'error' | 'info' = 'success'): void {
  const r = store.save(store.config);
  if (!r.ok) {
    toast('保存失败: ' + r.error, 'error');
    return;
  }
  resyncAll();
  broadcastScene();
  if (msg) toast(msg, kind);
}

/** 启用 / 停用任意场景下的任意项目（停用后不出现在环形菜单，但配置保留） */
function setItemEnabled(id: string, enabled: boolean): void {
  const it = findItem(id);
  if (!it) return;
  it.enabled = enabled;
  it.updatedAt = Date.now();
  saveAndSync(enabled ? `已启用: ${it.name}` : `已停用: ${it.name}`);
}

/** 删除任意场景下的任意项目，并清理指向它的全局触发项 */
function deleteItem(id: string): void {
  const item = findItem(id);
  const scene = sceneOfItem(id);
  if (!item || !scene) {
    toast('未找到项目: ' + id, 'error');
    return;
  }
  scene.items = scene.items.filter((i) => i.id !== id);
  scene.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((it, i) => (it.order = i));
  // 其它项目若把「触发」指向了被删项目，自动停用，避免悬空引用
  for (const s of store.config.scenes) {
    for (const it of s.items) {
      if (it.type === 'shortcut' && it.shortcutKind === 'global' && it.target === id) {
        it.enabled = false;
        it.target = '';
        it.updatedAt = Date.now();
      }
    }
  }
  saveAndSync(`已删除: ${item.name}`);
}

/** 场景是否启用（停用的场景只在「场景库」里存着，不参与切换与展示） */
function sceneOn(s: { enabled?: boolean }): boolean {
  return s.enabled !== false;
}

function cycleScene(): void {
  // 只在一启用的场景之间循环：停用的场景还在配置里存着数据，但不能被切到
  const list = store.config.scenes.filter(sceneOn);
  if (list.length <= 1) return;
  const idx = list.findIndex((s) => s.id === store.config.currentSceneId);
  const next = list[(idx + 1) % list.length];
  store.config.currentSceneId = next.id;
  commitConfig(store.config, true);
  toast('已切换到场景: ' + next.name, 'info');
}

const shortcutCallbacks: ShortcutCallbacks = {
  runItemById,
  toggleWindow: () => floating.toggleVisibility(),
  switchScene: () => cycleScene(),
};

// ---------- 窗口创建 ----------

function createWindows(): void {
  floating.create();
  // 恢复悬浮窗位置（setWindowPos 内部会夹取到可见屏幕）
  const pos = store.config.floatingWindow;
  if (pos) {
    floating.setWindowPos(pos.x, pos.y);
  } else {
    // 默认放在主屏右上附近
    const { workArea } = screen.getPrimaryDisplay();
    floating.setWindowPos(workArea.x + workArea.width - 260, workArea.y + 160);
  }
  resyncAll();
}

// ---------- IPC ----------

ipcMain.handle(Channels.configGet, () => store.config);

ipcMain.handle(Channels.configSave, (_e, cfg: AppConfig, opts?: { backup?: boolean }) =>
  commitConfig(cfg, true, opts)
);

// 实时预览：只换内存 + 推给悬浮窗。拖滑杆时每几十毫秒来一次，所以这里既不写盘也不重设快捷键
ipcMain.handle(Channels.configPreview, (_e, cfg: AppConfig) => {
  const r = store.preview(cfg);
  if (!r.ok) return r;
  broadcastScene({ toSettings: false });
  return { ok: true };
});

ipcMain.handle(Channels.configReset, () => {
  const d = store.reset();
  resyncAll();
  broadcastScene();
  return { ok: true, config: d };
});

ipcMain.handle(Channels.configExport, async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出 FloatDesk 配置',
    defaultPath: 'floatdesk-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, store.exportToString(), 'utf-8');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle(Channels.configImport, async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '导入 FloatDesk 配置',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    const obj = JSON.parse(raw);
    const res = store.importFromObject(obj);
    if (!res.ok) return { ok: false, error: res.error };
    resyncAll();
    broadcastScene();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: '解析失败: ' + e.message };
  }
});

// 悬浮窗
ipcMain.on(Channels.floatResize, (_e, mode: 'collapsed' | 'expanded', size: number) => floating.resize(mode, size));
// 长按选场景窗口：宽高独立（用户可在设置里直接指定，0/未设置走渲染进程的自动逻辑）
ipcMain.on(Channels.floatResizePicker, (_e, width: number, height: number) => floating.resizeRect(width, height));
// 场景选区底部的「退出 FloatDesk」（原右键菜单入口搬进了选区）
ipcMain.on(Channels.floatQuit, () => app.quit());
ipcMain.on(Channels.floatActivate, () => {
  // 先捕获当前前台应用作为「链接目标」（此时 FloatDesk 还没抢焦点），再让自己成为 key window
  captureFrontmost();
  floating.focus();
});
ipcMain.on(Channels.floatMove, (_e, x: number, y: number) => floating.setWindowPos(x, y));
ipcMain.handle(Channels.floatBounds, () => floating.getWindowPos());
ipcMain.on(Channels.floatToggle, () => floating.toggleVisibility());
ipcMain.on(Channels.floatHide, () => floating.hide());

// 拖动：渲染进程只负责「开始/结束」，位移由主进程轮询光标完成
ipcMain.on(Channels.floatDragStart, () => {
  log('dragStart');
  floating.startDrag();
});
ipcMain.handle(Channels.floatDragEnd, () => {
  const moved = floating.stopDrag();
  if (moved) {
    const p = floating.getWindowPos();
    store.config.floatingWindow = { x: p.x, y: p.y };
    store.save(store.config); // 仅持久化位置，不触发场景启动
  }
  log(`dragEnd moved=${moved}`);
  return { moved };
});

// 长按圆点弹出的场景选择面板：点选某个场景（行为与右键菜单「切换场景」一致）
ipcMain.on(Channels.floatSwitchScene, (_e, sceneId: string) => {
  const s = store.config.scenes.find((x) => x.id === sceneId);
  if (!s || !sceneOn(s) || s.id === store.config.currentSceneId) return;
  log('长按选择场景 -> ' + s.name);
  store.config.currentSceneId = s.id;
  commitConfig(store.config, true);
});

ipcMain.on(Channels.diagLog, (_e, msg: string) => {
  log('[renderer] ' + String(msg).slice(0, 500));
});

// 圆点右键菜单（macOS 上右键菜单需要窗口是 key window，popup 时自动处理）
ipcMain.on(Channels.floatContextMenu, () => {
  if (!floating.win || floating.win.isDestroyed()) return;
  const sceneSubmenu = store.config.scenes.filter(sceneOn).map((s) => ({
    label: s.name,
    type: 'checkbox' as const,
    checked: s.id === store.config.currentSceneId,
    click: () => {
      store.config.currentSceneId = s.id;
      commitConfig(store.config, true);
    },
  }));
  const menu = Menu.buildFromTemplate([
    { label: '打开设置…', click: () => settingsWin.openOrFocus() },
    { label: '切换场景', submenu: sceneSubmenu },
    { type: 'separator' },
    { label: '隐藏悬浮台', click: () => floating.hide() },
    { type: 'separator' },
    { label: '退出 FloatDesk', click: () => app.quit() },
  ]);
  menu.popup({ window: floating.win });
});

// 环形菜单里单个项目的右键菜单：执行 / 编辑 / 启用停用 / 换图标 / 删除
ipcMain.on(Channels.menuItemContext, (_e, itemId: string) => {
  if (!floating.win || floating.win.isDestroyed()) return;
  const item = findItem(itemId);
  if (!item) return;
  const owner = sceneOfItem(itemId);
  const menu = Menu.buildFromTemplate([
    { label: `打开：${item.name}`, click: () => runItemById(item.id, { fromFloating: true }) },
    { type: 'separator' },
    { label: '编辑…', click: () => settingsWin.focusItem(item.id) },
    // 项目库直达：菜单里加减项目最常用的地方，省掉「先开设置再翻导航」两步
    { label: '打开项目库…', click: () => settingsWin.gotoView('library') },
    {
      label: '更换图标…',
      click: async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: '选择图标图片',
          properties: ['openFile'],
          filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
        });
        if (canceled || !filePaths.length) return;
        item.icon = filePaths[0];
        item.updatedAt = Date.now();
        // 相同项目（同名 + 同目标）出现在其他场景时，问一句要不要一起换
        const same = sameProjectMatches(store.config.scenes, item);
        if (same.length) {
          const { response } = await dialog.showMessageBox(floating.win!, {
            type: 'question',
            buttons: [`同步到其他 ${same.length} 个场景`, '仅当前场景'],
            defaultId: 0,
            cancelId: 1,
            message: `「${item.name}」还出现在其他 ${same.length} 个场景`,
            detail: '是否把新图标一并应用到那些场景里的相同项目？',
          });
          if (response === 0) {
            for (const x of same) {
              x.icon = item.icon;
              x.updatedAt = Date.now();
            }
          }
        }
        saveAndSync('图标已更新');
      },
    },
    {
      label: item.enabled ? '停用（从菜单隐藏）' : '启用（显示到菜单）',
      click: () => setItemEnabled(item.id, !item.enabled),
    },
    ...(owner
      ? ([
          { type: 'separator' },
          { label: `编辑所属场景「${owner.name}」…`, click: () => settingsWin.focusScene(owner.id) },
        ] as any)
      : []),
    { type: 'separator' },
    { label: '删除', click: () => deleteItem(item.id) },
  ]);
  menu.popup({ window: floating.win });
});

ipcMain.on(Channels.floatSavePos, (_e, x: number, y: number) => {
  store.config.floatingWindow = { x, y };
  store.save(store.config); // 仅持久化位置，不触发场景启动
});

// 选择器
ipcMain.handle(Channels.dialogSelectApp, async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择 macOS 应用',
    properties: ['openFile'],
    filters: [{ name: 'Application', extensions: ['app'] }],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  return { path: filePaths[0] };
});

ipcMain.handle(Channels.dialogSelectFile, async (_e, opts: any) => {
  const properties: Array<'openFile' | 'openDirectory'> = opts?.directory ? ['openDirectory'] : ['openFile', 'openDirectory'];
  const { canceled, filePaths } = await dialog.showOpenDialog({ title: '选择文件或文件夹', properties });
  if (canceled || !filePaths.length) return { canceled: true };
  return { path: filePaths[0] };
});

ipcMain.handle(Channels.dialogSelectIconImage, async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择图标图片',
    properties: ['openFile'],
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  return { path: filePaths[0] };
});

ipcMain.on(Channels.previewOpen, (_e, payload: { target: string; isUrl: boolean }) => {
  openPreview(payload.target, payload.isUrl);
});

ipcMain.handle(Channels.actionRunById, (_e, id: string) => {
  runItemById(id, { fromFloating: true });
  return { ok: true };
});

// 渲染进程主动查询：悬浮球当前链接到的目标窗口名（null = 还没捕获/前台就是自己）
ipcMain.handle(Channels.floatLinkedGet, () => linkedTargetApp);

// ---------- 内置动作 / 输入法 / 便签 ----------

// 内置动作清单：设置页据此渲染下拉，避免渲染进程复制一份常量后两边对不上
ipcMain.handle(Channels.builtinsActions, () => BUILTIN_ACTIONS);

// 内置「项目库」预制条目：设置页「项目库」页按类型浏览 / 中英文检索 / 一键加到场景。
// 这里顺带做两件 macOS 专属的事：
//   1) 用真实 home 展开文件类路径（渲染进程拿不到 home）
//   2) 应用类条目按 bundle 解析真实路径 + 补原生图标；没装的应用直接过滤掉
ipcMain.handle(Channels.libraryPresets, async () => {
  try {
    return await resolvePresetIcons(buildBuiltinLibrary(os.homedir()), os.homedir());
  } catch (e: any) {
    log('library:presets 异常，退回未解析版本: ' + (e?.message || e));
    return buildBuiltinLibrary(os.homedir());
  }
});

// 浏览器书签批量导入：
//   ① 没给 file 就弹系统选择框（默认定位到「下载」，多数人导出的书签都在那儿）
//   ② 读文件 → parseBookmarkHtml（纯逻辑在 shared/bookmarks.ts）
//   ③ 原样把树交回渲染进程，勾选哪些、加到哪儿由设置页决定
// 解析失败/文件太大都返回结构化错误，不抛异常（设置页据此给提示）。
ipcMain.handle(Channels.libraryImportBookmarks, async (e, payload: { file?: string } = {}) => {
  const MAX_BYTES = 24 * 1024 * 1024; // 书签 HTML 一般几百 KB，给到 24MB 足够宽容
  try {
    let file = String((payload && payload.file) || '').trim();
    if (!file) {
      const parent = BrowserWindow.fromWebContents(e.sender) || undefined;
      const r = await dialog.showOpenDialog(parent as any, {
        title: '选择浏览器导出的书签文件',
        buttonLabel: '导入',
        defaultPath: path.join(os.homedir(), 'Downloads'),
        properties: ['openFile'],
        filters: [
          { name: '书签文件 (HTML)', extensions: ['html', 'htm'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
      file = r.filePaths[0];
    }
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, error: '这不是一个文件：' + file };
    if (st.size > MAX_BYTES) return { ok: false, error: '文件太大了（上限 24MB）' };
    const html = fs.readFileSync(file, 'utf-8');
    const parsed = parseBookmarkHtml(html);
    if (!parsed.links) {
      return {
        ok: false,
        error: '这个文件里没找到书签。请从浏览器导出「书签/收藏夹」为 HTML 再试（Chrome：书签管理器 → 导出书签）。',
        file,
        name: path.basename(file),
      };
    }
    log(`书签导入：${path.basename(file)} → ${parsed.links} 条链接 / ${parsed.folders} 个文件夹`);
    return {
      ok: true,
      file,
      name: path.basename(file),
      size: st.size,
      nodes: parsed.nodes,
      links: parsed.links,
      folders: parsed.folders,
      skipped: parsed.skipped,
    };
  } catch (err: any) {
    log('书签导入失败: ' + (err?.message || err));
    return { ok: false, error: '读取失败：' + (err?.message || err) };
  }
});

// 本机应用扫描：只列这台机器真的装了的 .app，图标是原生 icns（Finder 里那个样子）
ipcMain.handle(Channels.appScan, async () => {
  try {
    return await listInstalledAppsWithIcons(os.homedir(), 140);
  } catch (e: any) {
    log('app:scan 异常: ' + (e?.message || e));
    return [];
  }
});

// 菜单音效：预制清单（设置页下拉）+ 取某个系统音效的 WAV data URL（悬浮窗解码播放）
ipcMain.handle(Channels.soundList, () => ({
  presets: SOUND_PRESETS,
  groups: SOUND_GROUP_LABELS,
  defaults: DEFAULT_SOUND_CONFIG,
  none: SOUND_NONE,
}));
ipcMain.handle(Channels.soundGet, async (_e, id: string) => {
  try {
    return await soundDataById(String(id || ''));
  } catch (e: any) {
    log('sound:get 异常: ' + (e?.message || e));
    return { ok: false, error: e?.message || '未知错误' };
  }
});

// 失效的应用路径 → 真实路径（老配置里的 /Applications/Notes.app 会被纠正到 /System/Applications）
ipcMain.handle(Channels.appResolve, (_e, targetOrBundle: string) => {
  const q = String(targetOrBundle || '').trim();
  if (!q) return { ok: false, error: '缺少 bundle 名或路径' };
  const exists = (p: string): boolean => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };
  const resolved = resolveInstalledApp(q.endsWith('.app') || q.includes('/') ? q : `${q}.app`, exists, os.homedir());
  return resolved ? { ok: true, path: resolved } : { ok: false, error: '没找到这个应用' };
});

// 输入法：一次拿到「可用状态 + 全部输入源 + 当前 + 自动推断的中英对」
ipcMain.handle(Channels.imeSnapshot, async () => {
  const im = store.config.inputMethod || { chineseId: null, englishId: null };
  try {
    return await InputMethod.snapshot(im.chineseId, im.englishId);
  } catch (e: any) {
    log('ime:snapshot 异常: ' + (e?.message || e));
    return { ok: false, available: false, currentId: '', currentName: '', sources: [], chineseId: null, englishId: null, error: '读取失败: ' + (e?.message || String(e)) };
  }
});

ipcMain.handle(Channels.imeToggle, async () => {
  const im = store.config.inputMethod || { chineseId: null, englishId: null };
  const r = await InputMethod.toggle(im.chineseId, im.englishId);
  log(`ime:toggle -> ${r.ok ? r.to || 'ok' : r.error}`);
  return r;
});

ipcMain.handle(Channels.imeSelect, async (_e, id: string) => {
  const r = await InputMethod.selectId(String(id || ''));
  log(`ime:select ${id} -> ${r.ok ? 'ok' : r.error}`);
  return r;
});

ipcMain.on(Channels.noteOpen, () => noteWin.open());
ipcMain.on(Channels.noteClose, () => noteWin.close());

ipcMain.handle(Channels.noteLoad, () => {
  const c = noteWin.content();
  const book = noteWin.bookState();
  const act = noteBookActive(book);
  return {
    config: noteWin.config(),
    book,
    pagesMax: NOTE_PAGES_MAX,
    // 老的 html/text 还留着：万一有别的脚本按老字段读，不至于直接空掉
    html: c.html,
    text: c.text,
    history: act ? pageHistory(act.id).length : 0,
  };
});

// 正文 + 标签：立即落盘，空闲 5 秒后补一版历史。
// 新版渲染进程传整本便签（{ book }）；老调用仍可能只传 { html, text }，两种都认。
ipcMain.handle(Channels.noteSave, (_e, payload: any) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (p.book) return { ok: true, book: noteWin.updateBook(p.book) };
  noteWin.updateText(String(p.html || ''), String(p.text || ''));
  return { ok: true, book: noteWin.bookState() };
});

// 某组标签的历史（不传就取当前这组）
ipcMain.handle(Channels.noteHistory, (_e, pageId?: string) => {
  const id = pageId ? String(pageId) : '';
  if (id) return pageHistory(id);
  const act = noteBookActive(noteWin.bookState());
  return act ? pageHistory(act.id) : [];
});

ipcMain.handle(Channels.noteRestore, (_e, pageId: string, index: number) => {
  const id = String(pageId || '');
  const h = pageHistory(id);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= h.length) return { ok: false, error: '历史版本不存在' };
  const html = h[i].html || '';
  const text = h[i].text || '';
  // 恢复前会先把「现在的内容」记一版，恢复错了还能再点回去
  const book = noteWin.restorePage(id, html, text);
  return { ok: true, html, text, book };
});

/**
 * 多组标签的一次操作：add / remove / patch / select。
 * 渲染进程把「当前整本便签（含最新正文）」发上来，这里先落盘、再用 shared/note.ts 的纯函数
 * 算出新的一本，回传给渲染进程去渲染 —— 标签结构只有一份实现，不会前后端跑偏。
 */
ipcMain.handle(Channels.notePage, (_e, payload: any) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  let book = noteWin.updateBook(p.book);
  const op = String(p.op || '');
  const id = String(p.id || '');
  if (op === 'add') book = addNotePage(book);
  else if (op === 'remove') book = removeNotePage(book, id);
  else if (op === 'patch') book = patchNotePage(book, id, p.patch || {});
  else if (op === 'select') book = setActiveNotePage(book, id);
  else return { ok: false, error: '未知的标签操作：' + op, book };
  return { ok: true, book: noteWin.updateBook(book) };
});

// 代码块的「复制」：走主进程的系统剪贴板，比渲染进程的 navigator.clipboard 稳
ipcMain.handle(Channels.noteCopy, (_e, text: string) => {
  clipboard.writeText(String(text == null ? '' : text));
  return { ok: true };
});

// 通用写剪贴板：设置页整体禁止了文字选中，需要复制的场合（如诊断信息）改走按钮
ipcMain.handle(Channels.clipboardWrite, (_e, text: string) => {
  clipboard.writeText(String(text == null ? '' : text));
  return { ok: true };
});

ipcMain.handle(Channels.noteConfigSave, (_e, patch: any) => {
  const p = patch && typeof patch === 'object' ? patch : {};
  const c = noteWin.applyConfig(p);
  return { ok: true, config: c };
});

ipcMain.handle(Channels.notePresets, () => NOTE_PRESET_COLORS);

ipcMain.handle(Channels.permStatus, () => ({ trusted: checkAccessibility() }));
ipcMain.on(Channels.permOpenSettings, () => openAccessibilitySettings());

ipcMain.on(Channels.settingsOpen, () => settingsWin.openOrFocus());
ipcMain.on(Channels.settingsClose, () => {
  // 设置窗关闭时录制一定已经结束，兜底停掉屏蔽桥（防键盘被锁死）
  keyBlocker.stop();
  settingsWin.close();
});

// 录制快捷键时的系统快捷键屏蔽：
// 设置页进入录制时发 true —— keyblock 装一个键盘事件 tap，吞掉所有键盘事件，
// 防止「Command+Shift+4」这类系统快捷键在录制途中抢先执行；同时把识别出的
// 组合键逐行转发回设置页（rec:key）当录制输入（因为 DOM keydown 也被吞了）。
// 结束后发 false —— 杀掉 keyblock，键盘立即恢复正常。
ipcMain.on(Channels.recState, (e, on: boolean) => {
  // 只接受设置窗口发来的指令
  if (!settingsWin.win || settingsWin.win.isDestroyed() || e.sender !== settingsWin.win.webContents) return;
  if (on) {
    const enabled = store.config.appearance.blockKeysWhileRecording !== false;
    if (enabled) {
      const r = keyBlocker.start((line) => {
        if (settingsWin.win && !settingsWin.win.isDestroyed()) {
          settingsWin.win.webContents.send(Channels.recKey, line);
        }
      });
      log(`rec:state on -> keyblock ${r}`);
    }
    settingsWin.win.webContents.send(Channels.recNative, enabled);
  } else {
    keyBlocker.stop();
    if (settingsWin.win && !settingsWin.win.isDestroyed()) {
      settingsWin.win.webContents.send(Channels.recNative, false);
    }
    log('rec:state off -> keyblock stopped');
  }
});

ipcMain.handle(Channels.diagGet, () => ({ diagnostics: getDiagnostics(store.config), log: getLog() }));

// 网页探测：读取网站标题 + favicon（图标下载到 userData/item-icons，离线也能显示）
ipcMain.handle(Channels.webProbe, async (_e, url: string) => {
  try {
    return await probeWeb(url);
  } catch (e: any) {
    log('web:probe 异常: ' + (e?.message || e));
    return { ok: false, error: '读取失败: ' + (e?.message || String(e)) };
  }
});

// 本地目标图标：.app 取应用图标，文件取系统文件图标，图片直接用自身（同样落盘缓存）
ipcMain.handle(Channels.iconProbeLocal, async (_e, target: string, kind: string) => {
  try {
    const k = kind === 'app' || kind === 'image' ? kind : 'file';
    return await probeLocalIcon(target, k);
  } catch (e: any) {
    log('icon:probeLocal 异常: ' + (e?.message || e));
    return { ok: false, error: '读取失败: ' + (e?.message || String(e)) };
  }
});

// ---------- 内部图标库（userData/icon-library） ----------
ipcMain.handle(Channels.iconLibList, () => IconLibrary.listIcons());
ipcMain.handle(Channels.iconLibAdd, (_e, payload: { path?: string; name?: string; dataUrl?: string }) => {
  const p = payload || {};
  const r = p.dataUrl
    ? IconLibrary.addIconFromData(String(p.name || ''), String(p.dataUrl))
    : IconLibrary.addIconFromPath(String(p.path || ''));
  if (!r.ok) log('iconlib:add 失败: ' + (r.error || ''));
  return { ...r, icons: IconLibrary.listIcons() };
});
ipcMain.handle(Channels.iconLibUse, (_e, libPath: string) => IconLibrary.useIcon(String(libPath)));
ipcMain.handle(Channels.iconLibDelete, (_e, libPath: string) => {
  const r = IconLibrary.deleteIcon(String(libPath));
  return { ...r, icons: IconLibrary.listIcons() };
});
ipcMain.handle(Channels.iconLibReveal, () => IconLibrary.revealLib());

// ---------- 菜单 / 托盘 ----------

function buildAppMenu(): Menu {
  // 菜单模板在 appMenu.ts 里（纯数据、可单测）。其中「编辑」子菜单负责启用
  // macOS 的 Cmd+C / Cmd+V / Cmd+A 等标准编辑快捷键，删掉它所有输入框就复制不了。
  const template = buildMenuTemplate({
    scenes: store.config.scenes.filter(sceneOn).map((s) => ({ id: s.id, name: s.name })),
    currentSceneId: store.config.currentSceneId,
    onOpenSettings: () => settingsWin.openOrFocus(),
    onToggleFloating: () => floating.toggleVisibility(),
    onSelectScene: (id) => {
      store.config.currentSceneId = id;
      commitConfig(store.config, true);
    },
  });
  return Menu.buildFromTemplate(template);
}

function setupTray(): void {
  try {
    const img = nativeImage.createFromDataURL(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    );
    tray = new Tray(img);
    tray.setToolTip('FloatDesk');
    tray.on('click', () => settingsWin.openOrFocus());
  } catch (e: any) {
    log('托盘创建失败（非致命）: ' + e.message);
  }
}

// ---------- 生命周期 ----------

// 单实例锁：避免重复双击启动器时出现多个悬浮圆点
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 注意：这里绝不能再调用 setIgnoreMouseEvents(true)，
    // 那会让悬浮圆点变成点击穿透（能看见但点不动、拖不动），
    // 曾经就是重复双击启动器后圆点「失活」的原因。
    if (floating.win && !floating.win.isDestroyed()) {
      floating.win.show();
      floating.focus();
    } else {
      createWindows();
    }
    settingsWin.openOrFocus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildAppMenu());
    setupTray();
    // 图标库目录启动时就建好：用户可以直接在 Finder 里找到它往里扔图标
    IconLibrary.libDir();
    createWindows();
    // 启动后菜单可能因场景变化需要刷新，这里简单重建一次
    Menu.setApplicationMenu(buildAppMenu());
    // 静默体检：老配置里失效的 macOS 应用路径（/Applications/Notes.app 这类）改成真实路径，
    // 并给还没有真图标的 app/file 项目补上原生图标。延后 1.5s 做，不拖慢启动。
    setTimeout(() => {
      void (async () => {
        try {
          const r = await repairConfig(store.config, os.homedir());
          if (!r.pathsFixed && !r.iconsFilled) return;
          store.save(store.config, { backup: true });
          broadcastScene();
          log(`repair: 路径修正 ${r.pathsFixed} 项，补图标 ${r.iconsFilled}/${r.checked} 项` +
            (r.missing.length ? `，仍未找到：${r.missing.slice(0, 5).join('、')}` : ''));
        } catch (e: any) {
          log('repair 异常（不影响使用）: ' + (e?.message || e));
        }
      })();
    }, 1500);
    // 菜单音效预热：把配置里用到的那几个系统音效先转成 WAV（第一次悬停就不等转换）
    setTimeout(() => {
      const s = store.config.sound || DEFAULT_SOUND_CONFIG;
      void preloadSoundFiles([s.hover, s.click, s.open]).catch(() => {});
    }, 800);
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindows();
  else settingsWin.openOrFocus();
});

app.on('window-all-closed', () => {
  // macOS 上保留后台运行；仅在其他平台退出
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  // 退出前把便签最后一段字落盘（渲染进程的防抖可能还差最后一拍）
  noteWin.flush(true);
  shortcutMgr.unregisterAll();
  keyBlocker.stop();
});
