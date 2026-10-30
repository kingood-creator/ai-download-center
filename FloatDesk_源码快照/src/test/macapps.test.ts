import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_BUNDLE_ALIASES,
  MAC_APP_DIRS,
  appBundleName,
  appDisplayName,
  candidateAppPaths,
  coreTypesIconPath,
  documentIconName,
  expandHome,
  folderIconName,
  resolveInstalledApp,
} from '../shared/macapps';

test('appBundleName：从路径取 bundle 名，非 .app 返回空', () => {
  assert.equal(appBundleName('/Applications/Safari.app'), 'Safari.app');
  assert.equal(appBundleName('/System/Applications/Notes.app/'), 'Notes.app');
  assert.equal(appBundleName('/System/Applications/Utilities/Terminal.app'), 'Terminal.app');
  assert.equal(appBundleName('/Users/mac/Downloads'), '');
  assert.equal(appBundleName(''), '');
});

test('expandHome：~ / ~/xxx 展开，其它原样', () => {
  assert.equal(expandHome('~', '/Users/mac'), '/Users/mac');
  assert.equal(expandHome('~/Downloads', '/Users/mac'), '/Users/mac/Downloads');
  assert.equal(expandHome('/Applications', '/Users/mac'), '/Applications');
  assert.equal(expandHome('', '/Users/mac'), '');
});

test('candidateAppPaths：覆盖所有标准目录，含 ~/Applications', () => {
  const list = candidateAppPaths('Notes.app', '/Users/mac');
  for (const dir of MAC_APP_DIRS) {
    const base = dir.startsWith('~') ? '/Users/mac' + dir.slice(1) : dir;
    assert.ok(list.includes(`${base}/Notes.app`), `缺少候选 ${base}/Notes.app`);
  }
  // Finder 那种藏在 CoreServices 下的也要能找到
  assert.ok(candidateAppPaths('Finder.app', '/Users/mac').includes('/System/Library/CoreServices/Finder.app'));
});

test('candidateAppPaths：按别名表补上版本改名（启动台 / 系统设置）', () => {
  const lp = candidateAppPaths('Launchpad.app', '/Users/mac');
  assert.ok(lp.some((p) => p.endsWith('/Apps.app')), '老名字 Launchpad.app 应回退到 Apps.app');
  const sp = candidateAppPaths('System Preferences.app', '/Users/mac');
  assert.ok(sp.some((p) => p.endsWith('/System Settings.app')), '系统偏好设置应回退到系统设置');
  // 别名表本身不能空
  for (const [k, v] of Object.entries(APP_BUNDLE_ALIASES)) {
    assert.ok(Array.isArray(v) && v.length > 0, `${k} 别名列表为空`);
  }
});

test('resolveInstalledApp：老路径失效时按 bundle 名在标准目录里找回来', () => {
  // 模拟一台「系统应用都挪到 /System/Applications」的 macOS
  const exists = (p: string): boolean =>
    [
      '/System/Applications/Notes.app',
      '/System/Applications/Utilities/Terminal.app',
      '/System/Library/CoreServices/Finder.app',
      '/Applications/Safari.app',
    ].includes(p);

  assert.equal(resolveInstalledApp('/Applications/Notes.app', exists), '/System/Applications/Notes.app');
  assert.equal(resolveInstalledApp('/Applications/Utilities/Terminal.app', exists), '/System/Applications/Utilities/Terminal.app');
  assert.equal(resolveInstalledApp('/Applications/Finder.app', exists), '/System/Library/CoreServices/Finder.app');
  // 本来就对的路径原样返回（不做无谓改写）
  assert.equal(resolveInstalledApp('/Applications/Safari.app', exists), '/Applications/Safari.app');
  // 没装的应用返回 null，调用方不该瞎改
  assert.equal(resolveInstalledApp('/Applications/Photoshop.app', exists), null);
  assert.equal(resolveInstalledApp('', exists), null);
});

test('resolveInstalledApp：~/Applications 里的应用也能解析', () => {
  const exists = (p: string): boolean => p === '/Users/mac/Applications/foo.app';
  assert.equal(resolveInstalledApp('~/Applications/foo.app', exists, '/Users/mac'), '/Users/mac/Applications/foo.app');
});

test('folderIconName：常见目录各自对应 Finder 同款系统图标', () => {
  assert.equal(folderIconName('/Users/mac/Downloads', '/Users/mac'), 'DownloadsFolder.icns');
  assert.equal(folderIconName('/Users/mac/Desktop', '/Users/mac'), 'DesktopFolderIcon.icns');
  assert.equal(folderIconName('/Users/mac/Documents', '/Users/mac'), 'DocumentsFolderIcon.icns');
  assert.equal(folderIconName('/Users/mac/Pictures', '/Users/mac'), 'PicturesFolderIcon.icns');
  assert.equal(folderIconName('/Users/mac/Music', '/Users/mac'), 'MusicFolderIcon.icns');
  assert.equal(folderIconName('/Users/mac/Movies', '/Users/mac'), 'MovieFolderIcon.icns');
  assert.equal(folderIconName('/Applications', '/Users/mac'), 'ApplicationsFolderIcon.icns');
  assert.equal(folderIconName('/Users/mac', '/Users/mac'), 'HomeFolderIcon.icns');
  // 其它目录给通用文件夹图标
  assert.equal(folderIconName('/Users/mac/Projects', '/Users/mac'), 'GenericFolderIcon.icns');
  assert.equal(folderIconName('~/Downloads', '/Users/mac'), 'DownloadsFolder.icns');
});

test('coreTypesIconPath / documentIconName：拼出系统图标绝对路径', () => {
  assert.equal(documentIconName(), 'GenericDocumentIcon.icns');
  assert.equal(
    coreTypesIconPath('GenericFolderIcon.icns'),
    '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericFolderIcon.icns',
  );
  assert.equal(coreTypesIconPath(''), '');
});

test('appDisplayName：系统应用给中文名，其它按文件名', () => {
  assert.equal(appDisplayName('Notes.app'), 'Notes');
  assert.equal(appDisplayName('/System/Applications/Apps.app'), '启动台');
  assert.equal(appDisplayName('/System/Applications/System Settings.app'), '系统设置');
  assert.equal(appDisplayName('/Applications/Google Chrome.app'), 'Google Chrome');
});
