// 全局共享类型定义（主进程与渲染进程共用，渲染进程通过 import type 引入，编译后被擦除）

export type ItemType = 'web' | 'app' | 'file' | 'image' | 'shortcut' | 'action';
export type MenuLayout = 'radial' | 'grid' | 'list';
export type ShortcutActionKind = 'global' | 'send-to-app';

export interface MenuItem {
  id: string;
  name: string;
  type: ItemType;
  /** 网页 URL / 应用路径 / 文件(夹)路径 / 图片路径或 URL / 快捷键类型下的目标项 id */
  target: string;
  /** Emoji 或内置图标 id；图片项也可为本地路径或 URL（以 / 或 http 开头时按图片渲染） */
  icon: string;
  /** Electron 加速器格式，如 "Command+Shift+A"，可选 */
  shortcut?: string;
  order: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;

  // 类型相关可选字段
  openWith?: string;        // 用指定应用打开目标（app/file 类型）
  revealInFinder?: boolean; // file 类型：在 Finder 中显示而非打开
  shortcutKind?: ShortcutActionKind; // shortcut 类型
  shortcutKeystroke?: string;       // send-to-app：发送给前台应用的组合键，如 "command+c"
  imageUrlMode?: boolean;   // image 类型：target 是远程 URL
}

export interface LaunchAction {
  itemId: string;
  delayMs: number;
  order: number;
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  icon: string; // Emoji
  items: MenuItem[];
  themeColor: string;   // hex 圆点主色
  /** 渐变叠加色（圆点渐变的另一端）；等于主色时就是纯色 */
  gradientColor: string; // hex
  /** 渐变角度（deg，0=向上 145=左上到右下） */
  gradientAngle: number;
  glassOpacity: number; // 0..1
  dotSize: number;      // px
  ringRadius: number;   // px
  iconSize: number;     // px
  menuOpacity: number;  // 0..1
  layout: MenuLayout;
  showLabels: boolean;
  autoLaunchApps: boolean;
  autoOpenWebsites: boolean;
  launchActions: LaunchAction[];
  switchShortcut?: string; // 加速器
  isDefault: boolean;
  /**
   * 这个场景是否启用（场景库里「＋」启用、开关关掉就停用）。
   * 停用的场景【不删除任何数据】：项目、外观、自动启动策略全部原样留在配置里，
   * 只是不再出现在悬浮球的场景选择里、也不会被当成当前场景。
   * 重新启用就原封不动回来（老配置没有这个字段，一律按「启用」处理）。
   */
  enabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 输入法（中英文切换）配置；两个 id 都为空时自动推断 */
export interface InputMethodConfig {
  chineseId: string | null;
  englishId: string | null;
}

/** 便签配置（正文与历史单独存 note.txt / note_history.json） */
export interface NoteConfig {
  /** 便签底色 */
  color: string;
  /** 不透明度 0.3..1 */
  opacity: number;
  /** 字号 px */
  fontSize: number;
  /** 位置与大小（记住上次停留的地方） */
  x: number | null;
  y: number | null;
  width: number;
  height: number;
}

export interface AppearanceConfig {
  // 全局行为（场景视觉在 Scene 上）
  windowShortcut?: string;     // 唤出/隐藏悬浮工作台
  sceneSwitchShortcut?: string; // 切换场景
  clickOutsideToClose: boolean;
  alwaysOnTop: boolean;
  reduceMotion: boolean;
  openAtLogin: boolean;
  // 长按选场景窗口的宽高（px）；0 = 按场景数量自动
  pickerWidth: number;
  pickerHeight: number;
  // 选区每行文字的上下内边距（px）
  pickerRowPad: number;
  // 录制快捷键时是否临时屏蔽键盘（防止系统快捷键抢先执行）；默认开
  blockKeysWhileRecording: boolean;
  // 设置窗口里的灰色说明文字（.hint）总开关；关掉后界面更清爽，控件不受影响。默认开
  showHints?: boolean;
  // 圆点动画样式：pulse(脉冲,默认) / breathing(呼吸) / energy(能量环) / none(无)
  dotAnimation?: string;
  // 悬浮球「正在操控的窗口」提示药丸（圆点上方那条「↗ 应用名」）
  // 背景不透明度(0.1–1) 与 文字颜色(hex)
  linkedAppBgOpacity?: number;
  linkedAppTextColor?: string;
  // 是否显示这条提示；关掉后悬浮球上不再出现「↗ 应用名」（默认 true）
  linkedAppEnabled?: boolean;
  // 停留几秒后自动淡出；0 = 常驻显示（默认 0）。
  // 自动避让不需要开关：贴圆点放不下就挪到菜单圈外沿，永远按真实占位选位
  linkedAppDuration?: number;
}

/** 菜单音效配置（全局，不分场景）：每个交互事件挑一个预制音效，'none' = 不响 */
export interface SoundConfig {
  /** 总开关 */
  enabled: boolean;
  /** 鼠标移到菜单按钮上时的音效 id（清脆那声就是它） */
  hover: string;
  /** 点击项目执行时的音效 id */
  click: string;
  /** 展开 / 收起菜单时的音效 id */
  open: string;
  /** 音量 0..100 */
  volume: number;
}

export interface FloatingWindowPos {
  x: number;
  y: number;
}

/**
 * 项目库条目：可在「设置 → 项目库」里按类型浏览、中英文检索、一键添加到任意场景的预制/收藏项。
 * builtin=true 表示内置预制（不写入配置，仅渲染层常量）；否则为用户收藏（存于 AppConfig.itemLibrary）。
 */
export interface LibraryItem {
  id: string;
  name: string;
  type: ItemType;
  /** 网页 URL / 应用路径 / 文件(夹)路径 / 快捷键类型下的目标项 id */
  target: string;
  icon: string;
  /** 中英文检索别名（如 ['github','代码托管','代码']），提高检索命中率 */
  keywords?: string[];
  builtin?: boolean;
  /**
   * 优先调用原生图标：app 走 .app 里的 icns，file 走 macOS CoreTypes 文件夹图标。
   * 此时 icon 只是「读不到真图标时的 emoji 兜底」，添加/展示时由主进程补 iconPath。
   */
  iconMode?: 'native';
  /**
   * 是不是 macOS 系统自带的项目（系统应用 / 系统工具 / 系统文件夹 / 系统级快捷键）。
   * 项目库的「mac 系统」分类就是按这个标记筛的；这类条目不会再出现在「应用 / 文件 / 快捷键」分类里，
   * 免得同一批东西在两个分类重复出现。
   */
  system?: boolean;
  /** app 类型：bundle 名（如 Notes.app）；主进程按标准目录解析出真实路径，跨 macOS 版本更稳 */
  appBundle?: string;
  /** 主进程补上的原生图标路径（运行时字段，不写进用户配置） */
  iconPath?: string;
  // 类型相关可选字段（与 MenuItem 对齐，添加时原样带过去）
  openWith?: string;
  revealInFinder?: boolean;
  shortcutKind?: ShortcutActionKind;
  shortcutKeystroke?: string;
  imageUrlMode?: boolean;
  createdAt?: number;
}

export interface AppConfig {
  schemaVersion: number;
  scenes: Scene[];
  currentSceneId: string;
  appearance: AppearanceConfig;
  /** 菜单音效（悬停 / 点击 / 展开）；缺省时按默认值处理 */
  sound?: SoundConfig;
  inputMethod?: InputMethodConfig;
  note?: NoteConfig;
  floatingWindow?: FloatingWindowPos;
  /** 用户收藏的项目库条目（内置预制见 src/shared/itemLibrary.ts，不存这里） */
  itemLibrary?: LibraryItem[];
  /**
   * 被隐藏的项目库条目 id（内置预制 / 本机应用 / 我的收藏都算）。
   * 藏起来的项目不再出现在项目库列表里，不常用的一大堆东西可以收干净；
   * 项目库页顶「已隐藏（N）」能重新放出来。不是删除，随时可恢复。
   */
  libHidden?: string[];
  updatedAt: number;
}

export const SCHEMA_VERSION = 1;
