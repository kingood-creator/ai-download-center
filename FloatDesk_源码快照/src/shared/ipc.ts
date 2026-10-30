// IPC 通道常量（主进程与 preload 共用）。渲染进程经 preload 暴露的 window.api 调用，不直接引用本文件。
export const Channels = {
  configGet: 'config:get',
  configSave: 'config:save',
  // 只更新主进程内存里的配置并推给悬浮窗（不写盘、不重设快捷键）。
  // 拖滑杆/取色器时用它做实时预览：写盘 + 广播会让设置页重建 DOM，把正在拖的滑杆打断。
  configPreview: 'config:preview',
  configExport: 'config:export',
  configImport: 'config:import',
  configReset: 'config:reset',

  floatClickThrough: 'float:clickThrough',
  floatResize: 'float:resize',
  floatActivate: 'float:activate',
  floatMove: 'float:move',
  floatBounds: 'float:bounds',
  floatToggle: 'float:toggle',
  floatHide: 'float:hide',
  floatSavePos: 'float:savePos',
  // 拖动：由主进程轮询光标位置来移动窗口，避免窗口移动后渲染进程收不到 mousemove 而卡住
  floatDragStart: 'float:dragStart',
  floatDragEnd: 'float:dragEnd',
  floatContextMenu: 'float:contextMenu',
  // 长按圆点弹出的场景选择面板里点选某个场景
  floatSwitchScene: 'float:switchScene',
  // 长按选场景窗口：宽高独立设置（非正方形）
  floatResizePicker: 'float:resizePicker',
  // 场景选区底部的「退出 FloatDesk」
  floatQuit: 'float:quit',
  // 录制快捷键：渲染进程告知主进程「录制开始/结束」；主进程据此启停 keyblock
  recState: 'rec:state',
  // 主进程 -> 设置窗口：keyblock 是否生效（true = 键盘已被吞，录制输入改走原生上报）
  recNative: 'rec:native',
  // 主进程 -> 设置窗口：keyblock 上报的按键（KEY <acc> / HELD <mods> / ESCAPE）
  recKey: 'rec:key',

  // 渲染进程诊断日志（写入 floatdesk.log，便于定位「点了没反应」这类问题）
  diagLog: 'diag:log',
  // 写系统剪贴板（设置页「复制诊断信息」这类一键复制；页面本身禁止选中文字）
  clipboardWrite: 'clipboard:write',

  dialogSelectApp: 'dialog:selectApp',
  dialogSelectFile: 'dialog:selectFile',
  dialogSelectIconImage: 'dialog:selectIconImage',

  previewOpen: 'preview:open',

  // 网页探测：读取标题与 favicon
  webProbe: 'web:probe',

  // 本地目标图标：应用 / 文件用系统图标，图片用自身
  iconProbeLocal: 'icon:probeLocal',

  // 内部图标库（userData/icon-library）：列出 / 添加（路径或 dataURL）/ 使用（复制进缓存）/ 删除 / 在 Finder 中打开
  iconLibList: 'iconlib:list',
  iconLibAdd: 'iconlib:add',
  iconLibUse: 'iconlib:use',
  iconLibDelete: 'iconlib:delete',
  iconLibReveal: 'iconlib:reveal',

  // 内置动作清单（渲染进程要渲染下拉，但不想复制一份常量，走 IPC 拿主进程的权威列表）
  builtinsActions: 'builtins:actions',

  // 菜单音效：预制音效清单（设置页下拉用）+ 取某个系统音效的 WAV data URL（渲染进程解码播放）
  soundList: 'sound:list',
  soundGet: 'sound:get',

  // 内置「项目库」预制条目（应用/网页/快捷键/文件/内置动作，带中英文检索别名）
  libraryPresets: 'library:presets',
  // 浏览器书签批量导入：选文件（或直接给 file 路径）→ 读 → 解析成树，交给设置页勾选
  libraryImportBookmarks: 'library:importBookmarks',

  // macOS 本机应用扫描（项目库「本机应用」一节：只列这台机器真的装了的应用，图标取原生 icns）
  appScan: 'app:scan',
  // 把 bundle 名 / 失效的应用路径解析成真实路径（跨 macOS 版本的目录迁移）
  appResolve: 'app:resolve',

  // 输入法（Carbon / TIS 直切）
  imeSnapshot: 'ime:snapshot',
  imeToggle: 'ime:toggle',
  imeSelect: 'ime:select',

  // 便签
  noteOpen: 'note:open',
  noteClose: 'note:close',
  noteLoad: 'note:load',
  noteSave: 'note:save',
  noteHistory: 'note:history',
  noteRestore: 'note:restore',
  // 多组标签的增删改切换：渲染进程把整本便签发上来，主进程用 shared/note.ts 整理后回传
  notePage: 'note:page',
  noteConfigSave: 'note:configSave',
  notePresets: 'note:presets',
  // 代码块的「复制」按钮：渲染进程拿不到系统剪贴板时也能用
  noteCopy: 'note:copy',

  actionRunById: 'action:runById',

  permStatus: 'perm:status',
  permOpenSettings: 'perm:openSettings',

  settingsOpen: 'settings:open',
  settingsClose: 'settings:close',

  sceneChanged: 'scene:changed',
  toast: 'toast',

  // 悬浮菜单项右键菜单
  menuItemContext: 'menu:itemContext',
  // 悬浮球「链接到的目标窗口」：主进程点击悬浮球时捕获前台应用，主动广播；
  // 渲染进程也可主动查询当前链接的应用名
  floatLinked: 'float:linked',
  floatLinkedGet: 'float:linkedGet',
  // 主进程 -> 设置窗口：定位到某个项目/场景并打开编辑
  settingsFocusItem: 'settings:focusItem',
  settingsFocusScene: 'settings:focusScene',
  // 主进程 -> 设置窗口：直接切到某一页（悬浮菜单右键「打开项目库…」用）
  settingsGotoView: 'settings:gotoView',

  diagGet: 'diag:get',
} as const;
