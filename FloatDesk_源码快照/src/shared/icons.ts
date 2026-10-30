// 常用图标映射（纯函数，可单测）
// 用途：应用图标读不到、文件没有专门图标时，给一个「一眼能认出来」的默认图标，
// 而不是清一色的圆点。类型兜底与扩展名兜底都在这里。

/** 每种项目类型的默认图标 */
export function defaultIconForType(type: string): string {
  switch (type) {
    case 'web':
      return '🔗';
    case 'app':
      return '🧩';
    case 'file':
      return '📄';
    case 'image':
      return '🖼';
    case 'shortcut':
      return '⌨️';
    default:
      return '•';
  }
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'heic'];

/** 按扩展名给常用图标（顺序有意义：先匹配更具体的） */
const EXT_ICONS: Array<[string[], string]> = [
  [['xls', 'xlsx', 'csv', 'numbers', 'tsv'], '📊'],
  [['ppt', 'pptx', 'key'], '📽'],
  [['doc', 'docx', 'pages', 'rtf', 'md', 'txt', 'log'], '📝'],
  [['pdf'], '📕'],
  [['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'pkg'], '🗜'],
  [['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'flv'], '🎬'],
  [['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'aiff'], '🎵'],
  [['psd', 'ai', 'sketch', 'fig', 'xd', 'afdesign'], '🎨'],
  [['js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sh', 'json', 'yml', 'yaml', 'toml', 'html', 'css'], '🧑‍💻'],
  [['icns', 'app'], '🧩'],
];

export function extOf(p: string): string {
  const base = String(p || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function isImagePath(p: string): boolean {
  return IMAGE_EXTS.includes(extOf(p));
}

/** 文件/目录的常用图标；不认识的扩展名给 📄，目录给 📁 */
export function iconForPath(p: string, isDirectory = false): string {
  const s = String(p || '');
  if (isDirectory || s.endsWith('/')) return '📁';
  const ext = extOf(s);
  if (!ext) return '📄';
  if (IMAGE_EXTS.includes(ext)) return '🖼';
  for (const [exts, icon] of EXT_ICONS) if (exts.includes(ext)) return icon;
  return '📄';
}
