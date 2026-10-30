// preload：唯一暴露给渲染进程的接口（contextIsolation + nodeIntegration:false）
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/ipc';

const api = {
  // 配置
  getConfig: (): Promise<any> => ipcRenderer.invoke(Channels.configGet),
  saveConfig: (cfg: any, opts?: any): Promise<any> => ipcRenderer.invoke(Channels.configSave, cfg, opts),
  // 实时预览：只更新主进程内存 + 通知悬浮窗，不写盘（拖滑杆时用，避免每帧写盘/重建 DOM）
  previewConfig: (cfg: any): Promise<any> => ipcRenderer.invoke(Channels.configPreview, cfg),
  exportConfig: (): Promise<any> => ipcRenderer.invoke(Channels.configExport),
  importConfig: (): Promise<any> => ipcRenderer.invoke(Channels.configImport),
  resetConfig: (): Promise<any> => ipcRenderer.invoke(Channels.configReset),

  // 悬浮窗
  resizeFloating: (mode: 'collapsed' | 'expanded', size: number): void => ipcRenderer.send(Channels.floatResize, mode, size),
  activateFloating: (): void => ipcRenderer.send(Channels.floatActivate),
  moveWindow: (x: number, y: number): void => ipcRenderer.send(Channels.floatMove, x, y),
  getWindowBounds: (): Promise<any> => ipcRenderer.invoke(Channels.floatBounds),
  toggleVisibility: (): void => ipcRenderer.send(Channels.floatToggle),
  hideWindow: (): void => ipcRenderer.send(Channels.floatHide),
  saveFloatPos: (x: number, y: number): void => ipcRenderer.send(Channels.floatSavePos, x, y),

  // 拖动：开始/结束交给主进程，位移由主进程轮询光标完成
  dragStart: (): void => ipcRenderer.send(Channels.floatDragStart),
  dragEnd: (): Promise<{ moved: boolean }> => ipcRenderer.invoke(Channels.floatDragEnd),
  showFloatContextMenu: (): void => ipcRenderer.send(Channels.floatContextMenu),
  showItemContextMenu: (itemId: string): void => ipcRenderer.send(Channels.menuItemContext, itemId),
  // 长按圆点弹出的场景选择：点选某个场景
  switchScene: (sceneId: string): void => ipcRenderer.send(Channels.floatSwitchScene, sceneId),
  // 长按选场景窗口：宽高独立设置
  resizePickerFloating: (width: number, height: number): void => ipcRenderer.send(Channels.floatResizePicker, width, height),
  // 场景选区底部的入口
  quitApp: (): void => ipcRenderer.send(Channels.floatQuit),

  // 快捷键录制：告知主进程录制开始/结束（开启屏蔽时主进程会启停 keyblock）
  setRecording: (on: boolean): void => ipcRenderer.send(Channels.recState, on),

  // 渲染进程诊断日志
  logMsg: (msg: string): void => ipcRenderer.send(Channels.diagLog, msg),
  // 写系统剪贴板（一键复制诊断信息等；设置页全局禁止选中文字，靠按钮复制）
  writeClipboard: (text: string): Promise<any> => ipcRenderer.invoke(Channels.clipboardWrite, text),

  // 选择器
  selectApp: (): Promise<any> => ipcRenderer.invoke(Channels.dialogSelectApp),
  selectFile: (opts: any): Promise<any> => ipcRenderer.invoke(Channels.dialogSelectFile, opts),
  selectIconImage: (): Promise<any> => ipcRenderer.invoke(Channels.dialogSelectIconImage),

  // 图片预览
  openPreview: (target: string, isUrl: boolean): void => ipcRenderer.send(Channels.previewOpen, { target, isUrl }),

  // 网页探测（标题 + favicon 落盘）
  probeWeb: (url: string): Promise<any> => ipcRenderer.invoke(Channels.webProbe, url),

  // 本地目标图标（应用 / 文件走系统图标，图片用自身）
  probeLocalIcon: (target: string, kind: string): Promise<any> => ipcRenderer.invoke(Channels.iconProbeLocal, target, kind),

  // 执行
  runItemById: (id: string): Promise<any> => ipcRenderer.invoke(Channels.actionRunById, id),
  // 悬浮球链接到的目标窗口（点悬浮球瞬间捕获的前台应用名），供 UI 提示「正在操控哪个窗口」
  getLinkedApp: (): Promise<any> => ipcRenderer.invoke(Channels.floatLinkedGet),

  // 内置动作清单（输入法切换 / 便签等 FloatDesk 自带功能）
  builtinActions: (): Promise<any> => ipcRenderer.invoke(Channels.builtinsActions),

  // 菜单音效：预制清单（设置页下拉）与某个音效的 WAV data URL（悬浮窗 WebAudio 解码播放）
  soundPresets: (): Promise<any> => ipcRenderer.invoke(Channels.soundList),
  getSound: (id: string): Promise<any> => ipcRenderer.invoke(Channels.soundGet, id),

  // 内置「项目库」预制条目（设置页「项目库」页浏览 / 检索 / 添加到场景）
  libraryPresets: (): Promise<any> => ipcRenderer.invoke(Channels.libraryPresets),
  // 浏览器书签批量导入：不传 file 会弹系统选择框；传了就直接读那个文件（自检用）
  importBookmarks: (payload?: { file?: string }): Promise<any> =>
    ipcRenderer.invoke(Channels.libraryImportBookmarks, payload || {}),

  // macOS 本机应用（扫本机 .app，图标走原生 icns）；设置页「项目库」的「本机应用」一节用
  scanApps: (): Promise<any> => ipcRenderer.invoke(Channels.appScan),
  // 失效的应用路径 → 真实路径（bundle 名在标准目录里重新定位）
  resolveApp: (targetOrBundle: string): Promise<any> => ipcRenderer.invoke(Channels.appResolve, targetOrBundle),

  // 输入法（中英文切换，走系统 TIS，不需要辅助功能权限）
  imeSnapshot: (): Promise<any> => ipcRenderer.invoke(Channels.imeSnapshot),
  imeToggle: (): Promise<any> => ipcRenderer.invoke(Channels.imeToggle),
  imeSelect: (id: string): Promise<any> => ipcRenderer.invoke(Channels.imeSelect, id),

  // 便签
  openNote: (): void => ipcRenderer.send(Channels.noteOpen),
  noteClose: (): void => ipcRenderer.send(Channels.noteClose),
  noteLoad: (): Promise<any> => ipcRenderer.invoke(Channels.noteLoad),
  noteSave: (payload: any): Promise<any> => ipcRenderer.invoke(Channels.noteSave, payload),
  noteHistory: (pageId?: string): Promise<any> => ipcRenderer.invoke(Channels.noteHistory, pageId),
  noteRestore: (pageId: string, index: number): Promise<any> => ipcRenderer.invoke(Channels.noteRestore, pageId, index),
  notePage: (payload: any): Promise<any> => ipcRenderer.invoke(Channels.notePage, payload),
  noteConfigSave: (patch: any): Promise<any> => ipcRenderer.invoke(Channels.noteConfigSave, patch),
  notePresets: (): Promise<any> => ipcRenderer.invoke(Channels.notePresets),
  noteCopy: (text: string): Promise<any> => ipcRenderer.invoke(Channels.noteCopy, text),

  // 内部图标库（设置页拖放 / 点选 / 管理）
  iconLibList: (): Promise<any> => ipcRenderer.invoke(Channels.iconLibList),
  iconLibAdd: (payload: { path?: string; name?: string; dataUrl?: string }): Promise<any> => ipcRenderer.invoke(Channels.iconLibAdd, payload),
  iconLibUse: (libPath: string): Promise<any> => ipcRenderer.invoke(Channels.iconLibUse, libPath),
  iconLibDelete: (libPath: string): Promise<any> => ipcRenderer.invoke(Channels.iconLibDelete, libPath),
  iconLibReveal: (): Promise<any> => ipcRenderer.invoke(Channels.iconLibReveal),
  // 拖拽：把拖进来的 File 对象转成真实文件路径（拿不到路径时返回 undefined，调用方走 dataURL 兜底）
  pathForFile: (file: File): string | undefined => {
    try {
      return require('electron').webUtils.getPathForFile(file);
    } catch {
      return undefined;
    }
  },

  // 权限
  getPermissionStatus: (): Promise<any> => ipcRenderer.invoke(Channels.permStatus),
  openAccessibilitySettings: (): void => ipcRenderer.send(Channels.permOpenSettings),

  // 设置窗口
  openSettings: (): void => ipcRenderer.send(Channels.settingsOpen),

  // 事件订阅
  onSceneChanged: (cb: (cfg: any) => void): void => {
    ipcRenderer.on(Channels.sceneChanged, (_e, cfg) => cb(cfg));
  },
  onToast: (cb: (msg: string, kind: string) => void): void => {
    ipcRenderer.on(Channels.toast, (_e, msg, kind) => cb(msg, kind));
  },
  onFocusItem: (cb: (itemId: string) => void): void => {
    ipcRenderer.on(Channels.settingsFocusItem, (_e, id) => cb(id));
  },
  onFocusScene: (cb: (sceneId: string) => void): void => {
    ipcRenderer.on(Channels.settingsFocusScene, (_e, id) => cb(id));
  },
  // 主进程要求切到设置里的某一页（如悬浮菜单右键「打开项目库…」）
  onGotoView: (cb: (view: string) => void): void => {
    ipcRenderer.on(Channels.settingsGotoView, (_e, v) => cb(String(v || '')));
  },
  // 悬浮球链接到的目标窗口变化（点悬浮球捕获前台应用时由主进程主动推送）
  onLinkedApp: (cb: (name: string | null) => void): void => {
    ipcRenderer.on(Channels.floatLinked, (_e, name) => cb(name || null));
  },
  // keyblock 是否生效（true = 键盘被吞，录制输入走原生上报，忽略 DOM 键盘事件）
  onRecNative: (cb: (native: boolean) => void): void => {
    ipcRenderer.on(Channels.recNative, (_e, v) => cb(v));
  },
  // keyblock 上报：'KEY <acc>' / 'HELD <mods>' / 'ESCAPE'
  onRecKey: (cb: (line: string) => void): void => {
    ipcRenderer.on(Channels.recKey, (_e, line) => cb(line));
  },

  // 诊断
  getDiagnostics: (): Promise<any> => ipcRenderer.invoke(Channels.diagGet),
};

contextBridge.exposeInMainWorld('api', api);
