// 内置「项目库」预制条目：设置 → 项目库 里按类型浏览 / 中英文检索 / 一键添加到场景。
// 这些预制项不写入用户配置（builtin=true，仅渲染层常量）；用户自己的收藏存在 AppConfig.itemLibrary。
// keywords 同时放中英文别名，检索时大小写不敏感，命中任一词即显示。
//
// macOS 说明（很重要）：
// · 系统应用在 /System/Applications，工具在 /System/Applications/Utilities，
//   钥匙串/归档工具这类在 /System/Library/CoreServices/Applications，Finder 在 /System/Library/CoreServices。
//   所以这里不写死「/Applications/X.app」那种 Windows 时代的想当然路径，
//   而是带上 appBundle，由主进程用 resolveInstalledApp 在标准目录里定位（还能兼容版本改名）。
// · icon 只是兜底 emoji：iconMode='native' 的条目会优先用系统原生图标
//   （应用读 .app 里的 icns，文件夹读 CoreTypes 里的 Finder 同款图标）。
import { APP_BUNDLE_ALIASES, appDisplayName, appBundleName } from './macapps';
import { LibraryItem } from './types';

/**
 * 项目库支持的类型（顺序即设置页下拉顺序）。
 * 'mac' 是个「虚拟分类」：不是 MenuItem 的类型，只是把 system=true 的条目聚到一起看，
 * 添加进场景后它们仍然是 app / file / shortcut，执行链路完全不变。
 */
export const LIBRARY_TYPES = ['mac', 'web', 'app', 'file', 'image', 'shortcut', 'action'] as const;

/** 「mac 系统」这个虚拟分类的 key */
export const MAC_LIBRARY_TYPE = 'mac';

/** 类型的中文显示名 */
export function libraryTypeName(t: string): string {
  return {
    mac: 'mac 系统',
    web: '网页',
    app: '应用',
    file: '文件',
    image: '图片',
    shortcut: '快捷键',
    action: '内置动作',
  }[t] || String(t || '');
}

/** 是不是 macOS 系统自带的项目 */
export function isMacSystemItem(it: any): boolean {
  return !!it && it.system === true;
}

/**
 * 分类匹配：mac 系统 ↔ 其它分类互斥。
 * · type = 'mac' → 只留系统自带条目
 * · type = 'app' / 'file' / 'shortcut' … → 系统自带条目已经归到 mac 系统了，这里排除掉
 * · type = ''（全部类型）→ 都显示
 * 这样「系统的项目都分到 mac 系统下」才名副其实，不会两边重复出现。
 */
export function matchLibraryType(it: any, type?: string): boolean {
  const t = String(type || '').trim();
  if (!t) return true;
  if (t === MAC_LIBRARY_TYPE) return isMacSystemItem(it);
  if (isMacSystemItem(it)) return false;
  return String(it?.type || '') === t;
}

/**
 * 像不像网址：带协议 / www. 开头 / 裸域名（含点且不含空格）。
 * 项目库里输入网址时会识别出来，给出「读取标题与图标后添加」的入口。
 */
export function looksLikeUrl(s: string): boolean {
  const t = String(s || '').trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^www\.[\w-]+(\.[\w-]+)+/i.test(t)) return true;
  return /^[\w-]+(\.[\w-]+)+(\/[^\s]*)?$/.test(t);
}

/**
 * 库条目是否命中检索词：名称 / 类型名 / 别名。
 * 中文英文都能搜（keywords 里两种都放），大小写不敏感；空检索词 = 全部命中。
 */
export function libraryMatches(it: any, q: string): boolean {
  const ql = String(q || '').trim().toLowerCase();
  if (!ql) return true;
  if (String(it?.name || '').toLowerCase().includes(ql)) return true;
  if (libraryTypeName(it?.type).includes(ql)) return true;
  if (String(it?.type || '').toLowerCase().includes(ql)) return true;
  // 系统自带条目也能按「mac / 系统」搜出来（和「mac 系统」分类一致的叫法）
  if (isMacSystemItem(it) && /^(mac|macos|系统|mac ?系统)$/.test(ql)) return true;
  const kws: string[] = Array.isArray(it?.keywords) ? it.keywords : [];
  return kws.some((k) => String(k).toLowerCase().includes(ql));
}

/** 按类型过滤 + 检索，返回命中的条目（mac 系统与其他分类互斥，见 matchLibraryType） */
export function filterLibrary(list: any[], q: string, type?: string): any[] {
  return (list || []).filter((it) => matchLibraryType(it, type) && libraryMatches(it, q));
}

/** 系统应用所在目录（写进库里的规范路径；真正落地时还会被 resolveInstalledApp 校验一次） */
const SYS = '/System/Applications';
const UTIL = '/System/Applications/Utilities';
const CORE_APPS = '/System/Library/CoreServices/Applications';
const CORE = '/System/Library/CoreServices';
const APPS = '/Applications';

interface AppSeed {
  id: string;
  name: string;
  bundle: string;
  /** 规范路径前缀；Finder 这类不在标准目录的单独给 */
  dir?: string;
  icon: string;
  keywords: string[];
}

/** 一条 app 预制：路径由 dir + bundle 拼，图标走原生 */
function appEntry(a: AppSeed): LibraryItem {
  const target = a.dir ? `${a.dir}/${a.bundle}` : `${APPS}/${a.bundle}`;
  return {
    id: a.id,
    name: a.name,
    type: 'app',
    target,
    icon: a.icon,
    iconMode: 'native',
    appBundle: a.bundle,
    builtin: true,
    keywords: a.keywords,
  };
}

// ---------------- 应用：macOS 系统自带（这两组在每台 Mac 上都有） ----------------
const SYSTEM_APPS: AppSeed[] = [
  { id: 'bl-finder', name: '访达', bundle: 'Finder.app', dir: CORE, icon: '🗂️', keywords: ['finder', '访达', '文件管理', '文件', 'folder'] },
  { id: 'bl-launchpad', name: '启动台', bundle: 'Apps.app', dir: SYS, icon: '🚀', keywords: ['launchpad', '启动台', 'apps', '应用列表', '所有应用'] },
  { id: 'bl-safari', name: 'Safari', bundle: 'Safari.app', dir: APPS, icon: '🧭', keywords: ['safari', '苹果浏览器', '浏览器', 'browser'] },
  { id: 'bl-notes', name: '备忘录', bundle: 'Notes.app', dir: SYS, icon: '📝', keywords: ['notes', '备忘录', '便签', 'note'] },
  { id: 'bl-reminders', name: '提醒事项', bundle: 'Reminders.app', dir: SYS, icon: '⏰', keywords: ['reminders', '提醒事项', '待办', 'todo'] },
  { id: 'bl-calendar', name: '日历', bundle: 'Calendar.app', dir: SYS, icon: '📅', keywords: ['calendar', '日历', '日程', 'schedule'] },
  { id: 'bl-mail', name: '邮件', bundle: 'Mail.app', dir: SYS, icon: '✉️', keywords: ['mail', '邮件', '邮箱', 'email'] },
  { id: 'bl-messages', name: '信息', bundle: 'Messages.app', dir: SYS, icon: '💬', keywords: ['messages', '信息', 'imessage', '短信'] },
  { id: 'bl-contacts', name: '通讯录', bundle: 'Contacts.app', dir: SYS, icon: '👥', keywords: ['contacts', '通讯录', '联系人', 'contact'] },
  { id: 'bl-maps', name: '地图', bundle: 'Maps.app', dir: SYS, icon: '🗺️', keywords: ['maps', '地图', 'map', '导航'] },
  { id: 'bl-music', name: '音乐', bundle: 'Music.app', dir: SYS, icon: '🎵', keywords: ['music', '音乐', 'apple music', '歌曲'] },
  { id: 'bl-photos', name: '照片', bundle: 'Photos.app', dir: SYS, icon: '🖼️', keywords: ['photos', '照片', '相册', 'photo'] },
  { id: 'bl-preview', name: '预览', bundle: 'Preview.app', dir: SYS, icon: '📄', keywords: ['preview', '预览', 'pdf', '看图', '阅读'] },
  { id: 'bl-textedit', name: '文本编辑', bundle: 'TextEdit.app', dir: SYS, icon: '📝', keywords: ['textedit', '文本编辑', '文本', '纯文本', 'rtf'] },
  { id: 'bl-calculator', name: '计算器', bundle: 'Calculator.app', dir: SYS, icon: '🧮', keywords: ['calculator', '计算器', 'calc'] },
  { id: 'bl-dictionary', name: '字典', bundle: 'Dictionary.app', dir: SYS, icon: '📖', keywords: ['dictionary', '字典', '词典', '翻译', '查词'] },
  { id: 'bl-books', name: '图书', bundle: 'Books.app', dir: SYS, icon: '📚', keywords: ['books', '图书', 'apple books', '电子书'] },
  { id: 'bl-weather', name: '天气', bundle: 'Weather.app', dir: SYS, icon: '🌤️', keywords: ['weather', '天气', 'forecast'] },
  { id: 'bl-clock', name: '时钟', bundle: 'Clock.app', dir: SYS, icon: '🕐', keywords: ['clock', '时钟', '闹钟', 'world clock', '计时器'] },
  { id: 'bl-facetime', name: 'FaceTime', bundle: 'FaceTime.app', dir: SYS, icon: '📹', keywords: ['facetime', '视频通话', '视频'] },
  { id: 'bl-stickies', name: '便笺', bundle: 'Stickies.app', dir: SYS, icon: '🗒️', keywords: ['stickies', '便笺', '便签', 'sticky'] },
  { id: 'bl-voicememos', name: '语音备忘录', bundle: 'VoiceMemos.app', dir: SYS, icon: '🎙️', keywords: ['voice memos', '语音备忘录', '录音', 'record'] },
  { id: 'bl-podcasts', name: '播客', bundle: 'Podcasts.app', dir: SYS, icon: '🎧', keywords: ['podcasts', '播客', 'podcast'] },
  { id: 'bl-stocks', name: '股市', bundle: 'Stocks.app', dir: SYS, icon: '📈', keywords: ['stocks', '股市', '股票', '行情'] },
  { id: 'bl-home', name: '家庭', bundle: 'Home.app', dir: SYS, icon: '🏠', keywords: ['home', '家庭', 'homekit', '智能家居'] },
  { id: 'bl-findmy', name: '查找', bundle: 'FindMy.app', dir: SYS, icon: '📍', keywords: ['find my', '查找', '定位', '设备'] },
  { id: 'bl-news', name: '新闻', bundle: 'News.app', dir: SYS, icon: '📰', keywords: ['news', '新闻', '资讯'] },
  { id: 'bl-freeform', name: '无边记', bundle: 'Freeform.app', dir: SYS, icon: '🧩', keywords: ['freeform', '无边记', '白板', '脑图'] },
  { id: 'bl-passwords', name: '密码', bundle: 'Passwords.app', dir: SYS, icon: '🔐', keywords: ['passwords', '密码', '钥匙串', 'password'] },
  { id: 'bl-journal', name: '手记', bundle: 'Journal.app', dir: SYS, icon: '📓', keywords: ['journal', '手记', '日记'] },
  { id: 'bl-photobooth', name: '照片亭', bundle: 'Photo Booth.app', dir: SYS, icon: '📸', keywords: ['photo booth', '照片亭', '拍照', '自拍'] },
  { id: 'bl-quicktime', name: 'QuickTime 播放器', bundle: 'QuickTime Player.app', dir: SYS, icon: '🎬', keywords: ['quicktime', '播放器', '视频', 'player'] },
  { id: 'bl-imagecapture', name: '图像捕捉', bundle: 'Image Capture.app', dir: SYS, icon: '📷', keywords: ['image capture', '图像捕捉', '导入照片', '相机'] },
  { id: 'bl-shortcuts', name: '快捷指令', bundle: 'Shortcuts.app', dir: SYS, icon: '⚡', keywords: ['shortcuts', '快捷指令', '自动化', 'automation'] },
  { id: 'bl-timemachine', name: '时间机器', bundle: 'Time Machine.app', dir: SYS, icon: '🕰️', keywords: ['time machine', '时间机器', '备份', 'backup'] },
  { id: 'bl-settings', name: '系统设置', bundle: 'System Settings.app', dir: SYS, icon: '⚙️', keywords: ['settings', 'system settings', '系统设置', '偏好设置', '设置'] },
  { id: 'bl-appstore', name: 'App Store', bundle: 'App Store.app', dir: SYS, icon: '🛍️', keywords: ['app store', '应用商店', '商店', '下载应用'] },
  { id: 'bl-iphone-mirror', name: 'iPhone 镜像', bundle: 'iPhone Mirroring.app', dir: SYS, icon: '📱', keywords: ['iphone mirroring', 'iphone 镜像', '手机镜像', '投屏'] },
];

// ---------------- 应用：macOS 自带工具（Utilities / CoreServices） ----------------
const UTILITY_APPS: AppSeed[] = [
  { id: 'bl-terminal', name: '终端', bundle: 'Terminal.app', dir: UTIL, icon: '💻', keywords: ['terminal', '终端', '命令行', 'shell', 'command line'] },
  { id: 'bl-activity', name: '活动监视器', bundle: 'Activity Monitor.app', dir: UTIL, icon: '📊', keywords: ['activity monitor', '活动监视器', '进程', 'cpu', '内存', 'process'] },
  { id: 'bl-diskutil', name: '磁盘工具', bundle: 'Disk Utility.app', dir: UTIL, icon: '💽', keywords: ['disk utility', '磁盘工具', '分区', '抹掉', 'disk'] },
  { id: 'bl-sysinfo', name: '系统信息', bundle: 'System Information.app', dir: UTIL, icon: '🖥️', keywords: ['system information', '系统信息', '硬件', '配置', 'about'] },
  { id: 'bl-screenshot', name: '截图', bundle: 'Screenshot.app', dir: UTIL, icon: '📷', keywords: ['screenshot', '截图', '截屏', 'screen capture', '录屏'] },
  { id: 'bl-console', name: '控制台', bundle: 'Console.app', dir: UTIL, icon: '🧾', keywords: ['console', '控制台', '日志', 'log'] },
  { id: 'bl-scripteditor', name: '脚本编辑器', bundle: 'Script Editor.app', dir: UTIL, icon: '📜', keywords: ['script editor', '脚本编辑器', 'applescript', '自动化'] },
  { id: 'bl-colormeter', name: '数字测色计', bundle: 'Digital Color Meter.app', dir: UTIL, icon: '🎨', keywords: ['digital color meter', '数字测色计', '取色', '颜色'] },
  { id: 'bl-audiomidi', name: '音频 MIDI 设置', bundle: 'Audio MIDI Setup.app', dir: UTIL, icon: '🎚️', keywords: ['audio midi setup', '音频', 'midi', '声音'] },
  { id: 'bl-bluetooth', name: '蓝牙文件交换', bundle: 'Bluetooth File Exchange.app', dir: UTIL, icon: '📶', keywords: ['bluetooth', '蓝牙', '文件交换'] },
  { id: 'bl-screensharing', name: '屏幕共享', bundle: 'Screen Sharing.app', dir: UTIL, icon: '🖥', keywords: ['screen sharing', '屏幕共享', '远程桌面'] },
  { id: 'bl-magnifier', name: '放大器', bundle: 'Magnifier.app', dir: UTIL, icon: '🔍', keywords: ['magnifier', '放大器', '放大镜'] },
  { id: 'bl-migration', name: '迁移助理', bundle: 'Migration Assistant.app', dir: UTIL, icon: '🔁', keywords: ['migration assistant', '迁移助理', '换机', '迁移'] },
  { id: 'bl-keychain', name: '钥匙串访问', bundle: 'Keychain Access.app', dir: CORE_APPS, icon: '🔑', keywords: ['keychain access', '钥匙串访问', '密码管理', '证书'] },
  { id: 'bl-fontbook', name: '字体册', bundle: 'Font Book.app', dir: SYS, icon: '🔤', keywords: ['font book', '字体册', '字体', 'font'] },
  { id: 'bl-archive', name: '归档实用工具', bundle: 'Archive Utility.app', dir: CORE_APPS, icon: '🗜️', keywords: ['archive utility', '归档', '解压', '压缩', 'zip'] },
  { id: 'bl-wirelessdiag', name: '无线诊断', bundle: 'Wireless Diagnostics.app', dir: CORE_APPS, icon: '📡', keywords: ['wireless diagnostics', '无线诊断', 'wifi', '网络'] },
];

// ---------------- 应用：常见第三方（本机装了才会出现在库里，见主进程过滤） ----------------
const THIRD_PARTY_APPS: AppSeed[] = [
  { id: 'bl-chrome', name: 'Google Chrome', bundle: 'Google Chrome.app', icon: '🌐', keywords: ['chrome', 'google chrome', '谷歌浏览器', '浏览器', 'browser'] },
  { id: 'bl-edge', name: 'Microsoft Edge', bundle: 'Microsoft Edge.app', icon: '🌊', keywords: ['edge', '微软浏览器', '浏览器'] },
  { id: 'bl-firefox', name: 'Firefox', bundle: 'Firefox.app', icon: '🦊', keywords: ['firefox', '火狐', '浏览器'] },
  { id: 'bl-vscode', name: 'Visual Studio Code', bundle: 'Visual Studio Code.app', icon: '🧑‍💻', keywords: ['vscode', 'vs code', '代码', '编辑器', 'code'] },
  { id: 'bl-cursor', name: 'Cursor', bundle: 'Cursor.app', icon: '🖱️', keywords: ['cursor', 'ai 编辑器', '代码'] },
  { id: 'bl-iterm', name: 'iTerm', bundle: 'iTerm.app', icon: '⌨️', keywords: ['iterm', 'iterm2', '终端', 'terminal'] },
  { id: 'bl-warp', name: 'Warp', bundle: 'Warp.app', icon: '🌀', keywords: ['warp', '终端', 'terminal'] },
  { id: 'bl-raycast', name: 'Raycast', bundle: 'Raycast.app', icon: '🚀', keywords: ['raycast', '启动器', 'launcher'] },
  { id: 'bl-obsidian', name: 'Obsidian', bundle: 'Obsidian.app', icon: '🪨', keywords: ['obsidian', '笔记', 'note', '知识库'] },
  { id: 'bl-notion', name: 'Notion', bundle: 'Notion.app', icon: '📔', keywords: ['notion', '笔记', '文档'] },
  { id: 'bl-figma', name: 'Figma', bundle: 'Figma.app', icon: '🎨', keywords: ['figma', '设计', 'design'] },
  { id: 'bl-slack', name: 'Slack', bundle: 'Slack.app', icon: '💼', keywords: ['slack', '团队沟通', '聊天'] },
  { id: 'bl-docker', name: 'Docker', bundle: 'Docker.app', icon: '🐳', keywords: ['docker', '容器', 'container'] },
  { id: 'bl-postman', name: 'Postman', bundle: 'Postman.app', icon: '📮', keywords: ['postman', '接口调试', 'api'] },
  { id: 'bl-xcode', name: 'Xcode', bundle: 'Xcode.app', icon: '🔨', keywords: ['xcode', '开发', 'ios', 'swift'] },
  { id: 'bl-wechat', name: '微信', bundle: 'WeChat.app', icon: '💬', keywords: ['wechat', '微信', '聊天'] },
  { id: 'bl-wecom', name: '企业微信', bundle: 'WXWork.app', icon: '🏢', keywords: ['wxwork', '企业微信', '办公'] },
  { id: 'bl-feishu-app', name: '飞书', bundle: 'Lark.app', icon: '🕊️', keywords: ['lark', 'feishu', '飞书', '办公'] },
  { id: 'bl-dingtalk-app', name: '钉钉', bundle: 'DingTalk.app', icon: '📌', keywords: ['dingtalk', '钉钉', '办公'] },
  { id: 'bl-qq', name: 'QQ', bundle: 'QQ.app', icon: '🐧', keywords: ['qq', '聊天'] },
  { id: 'bl-tencent-meeting', name: '腾讯会议', bundle: 'wemeetapp.app', icon: '📹', keywords: ['wemeet', '腾讯会议', '视频会议'] },
  { id: 'bl-telegram', name: 'Telegram', bundle: 'Telegram.app', icon: '✈️', keywords: ['telegram', 'tg', '聊天'] },
  { id: 'bl-ollama', name: 'Ollama', bundle: 'Ollama.app', icon: '🦙', keywords: ['ollama', '本地大模型', 'llm'] },
];

// ---------------- 网页 ----------------
const WEB_ITEMS: LibraryItem[] = [
  { id: 'bl-github', name: 'GitHub', type: 'web', target: 'https://github.com', icon: '🐙', builtin: true, keywords: ['github', 'gh', '代码托管', '代码', 'git', '开发'] },
  { id: 'bl-gmail', name: 'Gmail', type: 'web', target: 'https://mail.google.com', icon: '✉️', builtin: true, keywords: ['gmail', '邮件', '邮箱', 'email', 'google mail'] },
  { id: 'bl-youtube', name: 'YouTube', type: 'web', target: 'https://www.youtube.com', icon: '▶️', builtin: true, keywords: ['youtube', '油管', '视频', 'video'] },
  { id: 'bl-chatgpt', name: 'ChatGPT', type: 'web', target: 'https://chat.openai.com', icon: '💬', builtin: true, keywords: ['chatgpt', 'gpt', 'ai', '聊天', '人工智能'] },
  { id: 'bl-claude', name: 'Claude', type: 'web', target: 'https://claude.ai', icon: '🌀', builtin: true, keywords: ['claude', 'ai', '人工智能', '聊天'] },
  { id: 'bl-deepl', name: 'DeepL 翻译', type: 'web', target: 'https://www.deepl.com', icon: '🔤', builtin: true, keywords: ['deepl', '翻译', 'translate', '词典'] },
  { id: 'bl-google', name: 'Google 搜索', type: 'web', target: 'https://www.google.com', icon: '🔍', builtin: true, keywords: ['google', '搜索', '谷歌', 'search'] },
  { id: 'bl-drive', name: 'Google 云端硬盘', type: 'web', target: 'https://drive.google.com', icon: '📁', builtin: true, keywords: ['google drive', '网盘', '云盘', 'drive', '云端硬盘'] },
  { id: 'bl-gtranslate', name: 'Google 翻译', type: 'web', target: 'https://translate.google.com', icon: '🌐', builtin: true, keywords: ['google translate', '翻译', 'translate'] },
  { id: 'bl-gdocs', name: 'Google 文档', type: 'web', target: 'https://docs.google.com', icon: '📄', builtin: true, keywords: ['google docs', '文档', '在线文档', 'docs'] },
  { id: 'bl-baidu', name: '百度', type: 'web', target: 'https://www.baidu.com', icon: '🔍', builtin: true, keywords: ['baidu', '百度', '搜索'] },
  { id: 'bl-zhihu', name: '知乎', type: 'web', target: 'https://www.zhihu.com', icon: '💡', builtin: true, keywords: ['zhihu', '知乎', '问答', '社区'] },
  { id: 'bl-weibo', name: '微博', type: 'web', target: 'https://weibo.com', icon: '🐦', builtin: true, keywords: ['weibo', '微博', '社交'] },
  { id: 'bl-douban', name: '豆瓣', type: 'web', target: 'https://www.douban.com', icon: '🌿', builtin: true, keywords: ['douban', '豆瓣', '电影', '读书', '社区'] },
  { id: 'bl-bilibili', name: '哔哩哔哩', type: 'web', target: 'https://www.bilibili.com', icon: '📺', builtin: true, keywords: ['bilibili', 'b站', '哔哩哔哩', '视频', '番剧'] },
  { id: 'bl-dingtalk', name: '钉钉网页版', type: 'web', target: 'https://www.dingtalk.com', icon: '📌', builtin: true, keywords: ['dingtalk', '钉钉', '办公', '协同'] },
  { id: 'bl-feishu', name: '飞书网页版', type: 'web', target: 'https://www.feishu.cn', icon: '🕊️', builtin: true, keywords: ['feishu', 'lark', '飞书', '办公', '协同', '文档'] },
  { id: 'bl-tdocs', name: '腾讯文档', type: 'web', target: 'https://docs.qq.com', icon: '📄', builtin: true, keywords: ['tencent docs', '腾讯文档', '在线文档', '文档'] },
  { id: 'bl-taobao', name: '淘宝', type: 'web', target: 'https://www.taobao.com', icon: '🛒', builtin: true, keywords: ['taobao', '淘宝', '购物', '电商'] },
  { id: 'bl-jd', name: '京东', type: 'web', target: 'https://www.jd.com', icon: '🛍️', builtin: true, keywords: ['jd', '京东', '购物', '电商'] },
  { id: 'bl-pdd', name: '拼多多', type: 'web', target: 'https://www.pinduoduo.com', icon: '🟢', builtin: true, keywords: ['pdd', '拼多多', '购物', '电商'] },
  { id: 'bl-alipay', name: '支付宝', type: 'web', target: 'https://www.alipay.com', icon: '💰', builtin: true, keywords: ['alipay', '支付宝', '支付', '付款'] },
  { id: 'bl-12306', name: '12306', type: 'web', target: 'https://www.12306.cn', icon: '🚄', builtin: true, keywords: ['12306', '铁路', '火车票', '购票'] },
  { id: 'bl-wikipedia', name: '维基百科', type: 'web', target: 'https://www.wikipedia.org', icon: '🌐', builtin: true, keywords: ['wikipedia', '维基', '百科'] },
  { id: 'bl-reddit', name: 'Reddit', type: 'web', target: 'https://www.reddit.com', icon: '👽', builtin: true, keywords: ['reddit', '论坛', '社区'] },
  { id: 'bl-x', name: 'X (Twitter)', type: 'web', target: 'https://x.com', icon: '🐦', builtin: true, keywords: ['twitter', 'x', '推特', '社交'] },
  { id: 'bl-amazon', name: 'Amazon', type: 'web', target: 'https://www.amazon.com', icon: '📦', builtin: true, keywords: ['amazon', '亚马逊', '购物', '电商'] },
  { id: 'bl-netflix', name: 'Netflix', type: 'web', target: 'https://www.netflix.com', icon: '🎬', builtin: true, keywords: ['netflix', '奈飞', '视频', '影视'] },
  { id: 'bl-sspai', name: '少数派', type: 'web', target: 'https://sspai.com', icon: '✍️', builtin: true, keywords: ['sspai', '少数派', '数码', '效率'] },
  { id: 'bl-juejin', name: '稀土掘金', type: 'web', target: 'https://juejin.cn', icon: '⛏️', builtin: true, keywords: ['juejin', '掘金', '技术', '开发', '博客'] },
];

// ---------------- 快捷键（macOS 常用组合键，发给前台应用） ----------------
interface KeySeed {
  id: string;
  name: string;
  key: string;
  keywords: string[];
  /** 系统级快捷键（截图/录屏/聚焦/锁屏…）→ 归到「mac 系统」分类 */
  sys?: boolean;
}

const KEY_SEEDS: KeySeed[] = [
  { id: 'bl-k-copy', name: '复制', key: 'command+c', keywords: ['copy', '复制', '拷贝'] },
  { id: 'bl-k-paste', name: '粘贴', key: 'command+v', keywords: ['paste', '粘贴'] },
  { id: 'bl-k-cut', name: '剪切', key: 'command+x', keywords: ['cut', '剪切'] },
  { id: 'bl-k-selectall', name: '全选', key: 'command+a', keywords: ['select all', '全选'] },
  { id: 'bl-k-undo', name: '撤销', key: 'command+z', keywords: ['undo', '撤销'] },
  { id: 'bl-k-redo', name: '重做', key: 'command+shift+z', keywords: ['redo', '重做'] },
  { id: 'bl-k-save', name: '保存', key: 'command+s', keywords: ['save', '保存'] },
  { id: 'bl-k-find', name: '查找', key: 'command+f', keywords: ['find', '查找', '搜索'] },
  { id: 'bl-k-print', name: '打印', key: 'command+p', keywords: ['print', '打印'] },
  { id: 'bl-k-open', name: '打开文件', key: 'command+o', keywords: ['open', '打开', '打开文件'] },
  { id: 'bl-k-quit', name: '退出应用', key: 'command+q', keywords: ['quit', '退出', '关闭应用'] },
  { id: 'bl-k-hide', name: '隐藏应用', key: 'command+h', keywords: ['hide', '隐藏'] },
  { id: 'bl-k-prefs', name: '偏好设置', key: 'command+,', keywords: ['preferences', '设置', '偏好设置', 'settings'] },
  { id: 'bl-k-close', name: '关闭窗口', key: 'command+w', keywords: ['close window', '关闭窗口'] },
  { id: 'bl-k-newwin', name: '新建窗口', key: 'command+n', keywords: ['new window', '新建窗口'] },
  { id: 'bl-k-newtab', name: '新建标签', key: 'command+t', keywords: ['new tab', '新标签'] },
  { id: 'bl-k-refresh', name: '刷新', key: 'command+r', keywords: ['refresh', '刷新', 'reload'] },
  { id: 'bl-k-nexttab', name: '下一个标签', key: 'command+shift+]', keywords: ['next tab', '下一个标签'] },
  { id: 'bl-k-prevtab', name: '上一个标签', key: 'command+shift+[', keywords: ['prev tab', '上一个标签'] },
  { id: 'bl-k-addressbar', name: '定位到地址栏', key: 'command+l', keywords: ['address bar', '地址栏', '网址'] },
  { id: 'bl-k-shot', name: '区域截图', key: 'command+shift+4', keywords: ['screenshot', '截图', '截屏', 'screen capture'], sys: true },
  { id: 'bl-k-shotfull', name: '全屏截图', key: 'command+shift+3', keywords: ['全屏截图', 'full screenshot'], sys: true },
  { id: 'bl-k-record', name: '录屏 / 截图工具栏', key: 'command+shift+5', keywords: ['录屏', '录制', 'record', 'screenshot toolbar'], sys: true },
  { id: 'bl-k-spotlight', name: '聚焦搜索', key: 'command+space', keywords: ['spotlight', '聚焦搜索', '搜索'], sys: true },
  { id: 'bl-k-emoji', name: '打开表情与符号', key: 'control+command+space', keywords: ['emoji', '表情', '字符', '符号'], sys: true },
  { id: 'bl-k-fullscreen', name: '进入全屏', key: 'control+command+f', keywords: ['fullscreen', '全屏'], sys: true },
  { id: 'bl-k-hidedock', name: '显示/隐藏程序坞', key: 'command+option+d', keywords: ['dock', '程序坞', '隐藏程序坞'], sys: true },
  { id: 'bl-k-switchapp', name: '切换应用', key: 'command+tab', keywords: ['switch app', '切换应用'], sys: true },
  { id: 'bl-k-lock', name: '锁定屏幕', key: 'command+control+q', keywords: ['lock screen', '锁屏', '锁定'], sys: true },
  { id: 'bl-k-min', name: '最小化', key: 'command+m', keywords: ['minimize', '最小化'] },
  { id: 'bl-k-newfolder', name: '新建文件夹', key: 'command+shift+n', keywords: ['new folder', '新建文件夹'] },
  { id: 'bl-k-info', name: '显示简介', key: 'command+i', keywords: ['get info', '简介', '属性'] },
  { id: 'bl-k-goto', name: '前往文件夹', key: 'command+shift+g', keywords: ['go to folder', '前往文件夹', '路径'] },
  { id: 'bl-k-hidden', name: '显示/隐藏隐藏文件', key: 'command+shift+.', keywords: ['hidden files', '隐藏文件', '显示隐藏'] },
  { id: 'bl-k-zoomin', name: '放大', key: 'command+plus', keywords: ['zoom in', '放大'] },
  { id: 'bl-k-zoomout', name: '缩小', key: 'command+-', keywords: ['zoom out', '缩小'] },
];

/** ---------------- 文件(夹)：目录图标走 macOS 原生 ---------------- */
function fileEntries(home: string): LibraryItem[] {
  const h = home.replace(/\/+$/, '') || '~';
  const mk = (id: string, name: string, sub: string, icon: string, keywords: string[]): LibraryItem => ({
    id,
    name,
    type: 'file',
    target: sub ? `${h}/${sub}` : h,
    icon,
    iconMode: 'native',
    builtin: true,
    system: true, // 系统标准文件夹 → 归入「mac 系统」分类
    keywords,
  });
  return [
    mk('bl-f-downloads', '下载', 'Downloads', '📥', ['downloads', '下载']),
    mk('bl-f-desktop', '桌面', 'Desktop', '🖥️', ['desktop', '桌面']),
    mk('bl-f-documents', '文稿', 'Documents', '📂', ['documents', '文稿', '文档']),
    mk('bl-f-pictures', '图片', 'Pictures', '🖼️', ['pictures', '图片', '照片']),
    mk('bl-f-movies', '影片', 'Movies', '🎞️', ['movies', '影片', '电影']),
    mk('bl-f-music', '音乐', 'Music', '🎵', ['music', '音乐', '歌曲']),
    mk('bl-f-public', '公共', 'Public', '👥', ['public', '公共', '共享']),
    mk('bl-f-home', '用户主目录', '', '🏠', ['home', '主目录', '用户目录']),
    { id: 'bl-f-apps', name: '应用程序', type: 'file', target: '/Applications', icon: '🅰️', iconMode: 'native', builtin: true, system: true, keywords: ['applications', '应用程序', 'app'] },
  ];
}

/** ---------------- 内置动作 ---------------- */
const ACTION_ITEMS: LibraryItem[] = [
  { id: 'bl-act-ime', name: '中英文切换', type: 'action', target: 'ime:switch', icon: '🔤', builtin: true, keywords: ['中英文切换', '输入法', '切换输入法', 'ime', 'switch', 'input method'] },
  { id: 'bl-act-note', name: '打开便签', type: 'action', target: 'note:open', icon: '📝', builtin: true, keywords: ['打开便签', '便签', '笔记', 'note', 'memo'] },
];

/**
 * 生成预制项目库。home 用于把文件类条目的路径写实（渲染进程拿不到 home，统一由主进程传入）。
 * 第三方应用条目会被主进程按「是否已安装」过滤，未装的不会出现在库里。
 */
export function buildBuiltinLibrary(home: string): LibraryItem[] {
  return [
    // 系统自带的（应用 / 工具）统一打 system 标记 → 项目库里归到「mac 系统」分类
    ...SYSTEM_APPS.map((a) => ({ ...appEntry(a), system: true })),
    ...UTILITY_APPS.map((a) => ({ ...appEntry(a), system: true })),
    ...THIRD_PARTY_APPS.map(appEntry),
    ...WEB_ITEMS,
    ...KEY_SEEDS.map((k) => ({
      id: k.id,
      name: k.name,
      type: 'shortcut' as const,
      target: '',
      icon: '⌨️',
      builtin: true,
      shortcutKind: 'send-to-app' as const,
      shortcutKeystroke: k.key,
      keywords: k.keywords,
      system: k.sys === true,
    })),
    ...fileEntries(home),
    ...ACTION_ITEMS,
  ];
}

/** 单元测试 / 兜底用的固定版本（正式路径由主进程按真实 home 生成） */
export const BUILTIN_LIBRARY: LibraryItem[] = buildBuiltinLibrary('/Users/mac');

/** 第三方应用 id 集合：主进程据此决定「未安装就过滤掉」 */
export const THIRD_PARTY_APP_IDS = new Set(THIRD_PARTY_APPS.map((a) => a.id));

/** 把预制项里的 bundle 名统一取出来（供主进程解析路径 / 去重） */
export function libraryAppBundle(it: any): string {
  const b = String(it?.appBundle || '').trim();
  if (b) return b;
  return appBundleName(String(it?.target || ''));
}

/** 展示名兜底：库里写的中文名优先，没写就按 bundle 名推 */
export function libraryAppName(it: any): string {
  const n = String(it?.name || '').trim();
  if (n) return n;
  const bundle = libraryAppBundle(it);
  return bundle ? appDisplayName(bundle) : '';
}

/** 别名表导出，方便设置页展示「会去哪找这个应用」 */
export function bundleAliases(bundle: string): string[] {
  const b = String(bundle || '').trim();
  return APP_BUNDLE_ALIASES[b] && APP_BUNDLE_ALIASES[b].length ? APP_BUNDLE_ALIASES[b] : b ? [b] : [];
}
