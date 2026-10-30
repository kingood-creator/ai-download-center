// 默认配置与内置示例场景（URL / 应用路径均可编辑，不假设用户已安装某应用）
import { AppConfig, MenuItem, Scene } from './types';
import { SCHEMA_VERSION } from './types';
import { defaultGradientFor } from './color';
import {
  NOTE_DEFAULT_COLOR,
  NOTE_DEFAULT_FONT_SIZE,
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_OPACITY,
  NOTE_DEFAULT_WIDTH,
} from './note';

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function item(partial: Partial<MenuItem> & Pick<MenuItem, 'name' | 'type' | 'target' | 'icon'>): MenuItem {
  const now = Date.now();
  return {
    id: uid('item'),
    order: 0,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  } as MenuItem;
}

function scene(partial: Partial<Scene> & Pick<Scene, 'name' | 'icon' | 'items'>): Scene {
  const now = Date.now();
  const theme = partial.themeColor || '#3b82f6';
  return {
    id: uid('scene'),
    description: '',
    themeColor: theme,
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
    // 场景库：默认全部启用；停用的场景数据照旧保留，只是不出现在悬浮球场景选择里
    enabled: partial.enabled !== false,
    createdAt: now,
    updatedAt: now,
    ...partial,
    // 双色渐变放在最后覆盖：显式传了就用，没传就按最终 themeColor 推导
    // （蓝 → 紫就是最初设计稿里那颗圆点；其它颜色按同族色相推导）
    gradientColor: partial.gradientColor || defaultGradientFor(theme),
    gradientAngle: typeof partial.gradientAngle === 'number' ? partial.gradientAngle : 145,
  } as Scene;
}

function renumber(items: MenuItem[]): MenuItem[] {
  return items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((it, i) => ({ ...it, order: i }));
}

export function buildDefaultConfig(): AppConfig {
  // 注意：系统应用的真实位置是 /System/Applications（工具在 Utilities 下），
  // /Applications/Notes.app 这种是 Windows 时代的想当然路径，会导致图标读不到、点了打不开。
  // 图标先留空，启动后的体检会补上原生 icns（见 main/Repair.ts）。
  const daily = scene({
    name: '日常办公',
    icon: '💼',
    description: '常用办公工具',
    isDefault: true,
    items: renumber([
      item({ name: '浏览器', type: 'app', target: '/Applications/Safari.app', icon: '' }),
      item({ name: '备忘录', type: 'app', target: '/System/Applications/Notes.app', icon: '' }),
      item({ name: '日历', type: 'app', target: '/System/Applications/Calendar.app', icon: '' }),
      item({ name: '邮件', type: 'app', target: '/System/Applications/Mail.app', icon: '' }),
      item({ name: '文件夹', type: 'file', target: '/Users', icon: '', revealInFinder: true }),
      item({ name: 'GitHub', type: 'web', target: 'https://github.com', icon: '🐙' }),
    ]),
  });

  const crossBorder = scene({
    name: '跨境电商',
    icon: '🌍',
    description: '跨境平台与工具',
    themeColor: '#f59e0b',
    items: renumber([
      item({ name: 'eBay', type: 'web', target: 'https://www.ebay.com', icon: '🛒' }),
      item({ name: '速卖通', type: 'web', target: 'https://www.aliexpress.com', icon: '🚢' }),
      item({ name: 'Amazon', type: 'web', target: 'https://www.amazon.com', icon: '📦' }),
      item({ name: '汇率', type: 'web', target: 'https://www.xe.com', icon: '💱' }),
      item({ name: 'Google 表格', type: 'web', target: 'https://sheets.google.com', icon: '📊' }),
    ]),
  });

  const ai = scene({
    name: 'AI 工具',
    icon: '🤖',
    description: 'AI 生产力',
    themeColor: '#8b5cf6',
    items: renumber([
      item({ name: 'ChatGPT', type: 'web', target: 'https://chat.openai.com', icon: '💬' }),
      item({ name: 'Claude', type: 'web', target: 'https://claude.ai', icon: '🌀' }),
      item({ name: 'Midjourney', type: 'web', target: 'https://www.midjourney.com', icon: '🎨' }),
      item({ name: '终端', type: 'app', target: '/System/Applications/Utilities/Terminal.app', icon: '' }),
      item({ name: '复制', type: 'shortcut', target: '', icon: '📋', shortcutKind: 'send-to-app', shortcutKeystroke: 'command+c' }),
    ]),
  });

  const english = scene({
    name: '英语学习',
    icon: '📚',
    description: '英语学习资源',
    themeColor: '#10b981',
    items: renumber([
      item({ name: 'DeepL', type: 'web', target: 'https://www.deepl.com', icon: '🔤' }),
      item({ name: 'YouTube', type: 'web', target: 'https://www.youtube.com', icon: '▶️' }),
      item({ name: 'BBC', type: 'web', target: 'https://www.bbc.co.uk/learningenglish', icon: '🇬🇧' }),
      item({ name: '单词本', type: 'file', target: '/Users', icon: '', revealInFinder: true }),
    ]),
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    scenes: [daily, crossBorder, ai, english],
    currentSceneId: daily.id,
    appearance: {
      windowShortcut: 'Alt+Space',
      sceneSwitchShortcut: 'Alt+Shift+S',
      clickOutsideToClose: true,
      alwaysOnTop: true,
      reduceMotion: false,
      openAtLogin: false,
      // 长按选场景窗口的宽高；0 = 按场景数量自动
      pickerWidth: 0,
      pickerHeight: 0,
      // 选区每行文字的上下内边距
      pickerRowPad: 12,
      // 录制快捷键时临时屏蔽键盘，防止系统快捷键抢先执行
      blockKeysWhileRecording: true,
      // 设置窗口里的灰色说明文字总开关（关掉后界面更清爽）
      showHints: true,
      // 圆点动画样式：脉冲 / 呼吸 / 能量环 / 无
      dotAnimation: 'pulse',
      // 「正在操控的窗口」提示：背景磨砂浓度(0.1–1)、文字颜色(hex)、
      // 是否显示、停留几秒后淡出(0=常驻)。自动避让无开关，永远按真实占位选位。
      // 样式是全局统一的浅色磨砂胶囊（与场景主题色无关），文字默认纯白。
      linkedAppBgOpacity: 1,
      linkedAppTextColor: '#ffffff',
      linkedAppEnabled: true,
      linkedAppDuration: 0,
    },
    // 菜单音效：移动到按钮时清脆一响（Tink），点下去轻弹（Pop），展开收起默认不响
    sound: {
      enabled: true,
      hover: 'tink',
      click: 'pop',
      open: 'none',
      volume: 45,
    },
    // 输入法与便签：两个 id 留空 = 首次使用时自动推断中/英
    inputMethod: { chineseId: null, englishId: null },
    // 项目库：用户收藏的条目（内置预制不存这里，见 src/shared/itemLibrary.ts）
    itemLibrary: [],
    // 被隐藏的项目库条目 id（默认一个都不藏）
    libHidden: [],
    note: {
      color: NOTE_DEFAULT_COLOR,
      opacity: NOTE_DEFAULT_OPACITY,
      fontSize: NOTE_DEFAULT_FONT_SIZE,
      x: null,
      y: null,
      width: NOTE_DEFAULT_WIDTH,
      height: NOTE_DEFAULT_HEIGHT,
    },
    updatedAt: Date.now(),
  };
}
