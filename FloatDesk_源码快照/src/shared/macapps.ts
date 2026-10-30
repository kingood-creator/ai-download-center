// macOS 应用定位 + 原生图标路径（纯函数，可单测）
//
// 为什么需要这一层：macOS 从 Catalina 起把系统应用挪到了 /System/Applications，
// 工具类又各自在 /System/Applications/Utilities 与 /System/Library/CoreServices/Applications，
// Finder 这种「藏在系统里」的更是在 /System/Library/CoreServices 下。
// 于是老配置里的 /Applications/Notes.app、/Applications/Utilities/Terminal.app 全都找不到 →
// 图标读不到、点了也打不开。这里按「bundle 名 + 标准目录」重新定位真实路径，
// 顺带兼容版本改名（启动台 Launchpad.app → Apps.app、系统偏好设置 → 系统设置）。

/** macOS 里应用可能待的标准目录（顺序即优先级） */
export const MAC_APP_DIRS = [
  '/Applications',
  '/System/Applications',
  '/System/Applications/Utilities',
  '/System/Library/CoreServices/Applications',
  '/System/Library/CoreServices',
  '~/Applications',
];

/**
 * 同一个功能在不同 macOS 版本里的 bundle 名。
 * key 是「逻辑名」（老配置里常见的那个），value 是按优先级排列的候选。
 */
export const APP_BUNDLE_ALIASES: Record<string, string[]> = {
  'Launchpad.app': ['Launchpad.app', 'Apps.app'],
  'Apps.app': ['Apps.app', 'Launchpad.app'],
  'System Preferences.app': ['System Settings.app', 'System Preferences.app'],
  'System Settings.app': ['System Settings.app', 'System Preferences.app'],
  'iTunes.app': ['Music.app', 'iTunes.app'],
  'Address Book.app': ['Contacts.app', 'Address Book.app'],
  'iCal.app': ['Calendar.app', 'iCal.app'],
};

/** '/a/b/Notes.app' → 'Notes.app'；不是 .app 时返回空串 */
export function appBundleName(target: string): string {
  const t = String(target || '').trim().replace(/\/+$/, '');
  const base = t.split('/').pop() || '';
  return /\.app$/i.test(base) ? base : '';
}

/** 把 ~ 开头的路径展开（渲染进程没有 home，统一由主进程展开后再下发） */
export function expandHome(p: string, home: string): string {
  const s = String(p || '');
  if (!home) return s;
  if (s === '~') return home;
  if (s.startsWith('~/')) return home.replace(/\/+$/, '') + s.slice(1);
  return s;
}

/**
 * 给一个 bundle 名，列出所有可能的绝对路径（按优先级）。
 * home 用于 ~/Applications；候选名会按别名表展开（去重、保序）。
 */
export function candidateAppPaths(bundle: string, home = ''): string[] {
  const b = String(bundle || '').trim();
  if (!b) return [];
  const names = APP_BUNDLE_ALIASES[b] && APP_BUNDLE_ALIASES[b].length ? APP_BUNDLE_ALIASES[b] : [b];
  const out: string[] = [];
  for (const dir of MAC_APP_DIRS) {
    const base = dir.startsWith('~') ? expandHome(dir, home) : dir;
    if (!base) continue;
    for (const n of names) {
      const p = `${base.replace(/\/+$/, '')}/${n}`;
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

/**
 * 把一个（可能已经失效的）应用路径解析成真实路径。
 * - 路径本来就存在 → 原样返回
 * - 否则按 bundle 名在标准目录里找，第一个存在的就返回
 * - 都找不到 → null（调用方保留原值，不要瞎改）
 * exists 注入是为了单测不碰真文件系统。
 */
export function resolveInstalledApp(
  target: string,
  exists: (p: string) => boolean,
  home = '',
): string | null {
  const t = String(target || '').trim().replace(/\/+$/, '');
  if (!t) return null;
  const direct = expandHome(t, home);
  try {
    if (exists(direct)) return direct;
  } catch {
    /* ignore */
  }
  const bundle = appBundleName(direct);
  if (!bundle) return null;
  for (const cand of candidateAppPaths(bundle, home)) {
    try {
      if (exists(cand)) return cand;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** CoreTypes 里那套系统原生图标的位置（Finder 自己在用的就是这些） */
export const CORE_TYPES_DIR = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources';

/**
 * 目录 → 系统原生 icns 文件名。
 * 用 Finder 自己的那套图标（下载/桌面/文稿/图片/音乐/影片/公共/应用程序/主目录），
 * 其它目录给通用文件夹图标。这样「文件」类项目也是真·macOS 图标，而不是 emoji。
 */
export function folderIconName(folderPath: string, home = ''): string {
  const raw = expandHome(String(folderPath || '').trim().replace(/\/+$/, ''), home);
  const known: Array<[string, string]> = [
    ['Downloads', 'DownloadsFolder.icns'],
    ['Desktop', 'DesktopFolderIcon.icns'],
    ['Documents', 'DocumentsFolderIcon.icns'],
    ['Pictures', 'PicturesFolderIcon.icns'],
    ['Music', 'MusicFolderIcon.icns'],
    ['Movies', 'MovieFolderIcon.icns'],
    ['Public', 'PublicFolderIcon.icns'],
  ];
  const base = raw.split('/').filter(Boolean).pop() || '';
  for (const [name, icns] of known) {
    if (base === name) return icns;
  }
  if (raw === '/Applications' || raw === '/System/Applications') return 'ApplicationsFolderIcon.icns';
  if (home && raw === home.replace(/\/+$/, '')) return 'HomeFolderIcon.icns';
  return 'GenericFolderIcon.icns';
}

/** 非目录文件的通用文档图标 */
export function documentIconName(): string {
  return 'GenericDocumentIcon.icns';
}

/** 拼出 CoreTypes 里某个 icns 的绝对路径 */
export function coreTypesIconPath(icnsName: string): string {
  const n = String(icnsName || '').trim();
  if (!n) return '';
  return `${CORE_TYPES_DIR}/${n}`;
}

/**
 * 应用名（bundle 名去掉 .app）→ 展示名。
 * 只为少数「路径名不是人话」的系统应用做映射，其它直接用文件名。
 */
export const APP_DISPLAY_NAMES: Record<string, string> = {
  'Apps': '启动台',
  'System Settings': '系统设置',
  'System Information': '系统信息',
  'Activity Monitor': '活动监视器',
  'Keychain Access': '钥匙串访问',
  'Disk Utility': '磁盘工具',
  'Font Book': '字体册',
  'VoiceMemos': '语音备忘录',
  'QuickTime Player': 'QuickTime 播放器',
  'Photo Booth': '照片亭',
  'Time Machine': '时间机器',
  'iPhone Mirroring': 'iPhone 镜像',
  'Image Capture': '图像捕捉',
};

export function appDisplayName(bundleOrPath: string): string {
  const b = appBundleName(bundleOrPath) || String(bundleOrPath || '').trim();
  const noExt = b.replace(/\.app$/i, '');
  return APP_DISPLAY_NAMES[noExt] || noExt;
}
