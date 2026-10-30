import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_LIBRARY,
  looksLikeUrl,
  libraryMatches,
  filterLibrary,
  libraryTypeName,
  LIBRARY_TYPES,
  matchLibraryType,
} from '../shared/itemLibrary';
import { validateItem } from '../shared/validation';

test('预制项目库不为空，且覆盖多种类型', () => {
  assert.ok(BUILTIN_LIBRARY.length > 20, '预制项目应该有一定数量');
  const types = new Set(BUILTIN_LIBRARY.map((x) => x.type));
  for (const t of ['web', 'app', 'file', 'shortcut', 'action']) {
    assert.ok(types.has(t as any), `预制项目应包含类型 ${t}`);
  }
});

test('预制项目 id 唯一', () => {
  const ids = BUILTIN_LIBRARY.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, '存在重复 id');
});

test('每个预制项目都能通过项目校验（加到场景后不会被配置校验打回）', () => {
  for (const lib of BUILTIN_LIBRARY) {
    const r = validateItem({
      id: lib.id,
      name: lib.name,
      type: lib.type,
      target: lib.target,
      icon: lib.icon,
      order: 0,
      enabled: true,
      shortcutKind: lib.shortcutKind,
      shortcutKeystroke: lib.shortcutKeystroke,
    });
    assert.ok(r.ok, `预制项目「${lib.name}」校验失败: ${r.errors.join('; ')}`);
  }
});

test('每个预制项目都有名称、图标与检索别名', () => {
  for (const lib of BUILTIN_LIBRARY) {
    assert.ok(lib.name && lib.name.trim(), `预制项目 ${lib.id} 缺名称`);
    assert.ok(lib.icon && lib.icon.trim(), `预制项目 ${lib.id} 缺图标`);
    assert.ok(Array.isArray(lib.keywords) && lib.keywords.length > 0, `预制项目 ${lib.id} 缺检索别名`);
    for (const k of lib.keywords) assert.ok(typeof k === 'string' && k.trim(), `预制项目 ${lib.id} 有空别名`);
  }
});

test('预制项目都标记为 builtin（不写进用户配置）', () => {
  for (const lib of BUILTIN_LIBRARY) assert.equal(lib.builtin, true, `${lib.id} 未标记 builtin`);
});

test('快捷键类预制项目必须带要发送的组合键', () => {
  for (const lib of BUILTIN_LIBRARY.filter((x) => x.type === 'shortcut')) {
    assert.equal(lib.shortcutKind, 'send-to-app', `${lib.id} 快捷键类型不对`);
    assert.ok(lib.shortcutKeystroke && lib.shortcutKeystroke.trim(), `${lib.id} 缺组合键`);
  }
});

test('中文检索：能按中文名与中文别名搜到', () => {
  assert.ok(libraryMatches({ name: '备忘录', type: 'app' }, '备忘'), '中文名应命中');
  assert.ok(libraryMatches({ name: 'x', type: 'web', keywords: ['代码托管'] }, '代码'), '中文别名应命中');
  assert.ok(libraryMatches({ name: 'x', type: 'web', keywords: ['代码托管'] }, '代码托管'), '完整别名应命中');
});

test('英文检索：能按英文名与英文别名搜到，且大小写不敏感', () => {
  assert.ok(libraryMatches({ name: 'GitHub', type: 'web' }, 'git'), '英文名应命中');
  assert.ok(libraryMatches({ name: 'x', type: 'web', keywords: ['github'] }, 'GITHUB'), '英文别名应大小写不敏感');
});

test('按类型名检索：搜「网页」「快捷键」能筛出对应类型', () => {
  assert.ok(libraryMatches({ name: 'x', type: 'web' }, '网页'), '类型中文名应命中');
  assert.ok(libraryMatches({ name: 'x', type: 'shortcut' }, '快捷键'), '类型中文名应命中');
  assert.equal(libraryTypeName('shortcut'), '快捷键');
});

test('空检索词命中全部；不相关的词一条都不命中', () => {
  assert.ok(libraryMatches({ name: '任意', type: 'web' }, ''), '空词应全部命中');
  assert.ok(libraryMatches({ name: '任意', type: 'web' }, '   '), '空白词应全部命中');
  assert.equal(libraryMatches({ name: 'GitHub', type: 'web', keywords: ['git'] }, 'zzz不存在'), false);
});

test('网址识别：带协议 / www / 裸域名都算网址，普通词不算', () => {
  assert.ok(looksLikeUrl('https://github.com'));
  assert.ok(looksLikeUrl('http://example.com/a/b?c=1'));
  assert.ok(looksLikeUrl('www.baidu.com'));
  assert.ok(looksLikeUrl('github.com'));
  assert.ok(looksLikeUrl('example.com/path'));
  assert.equal(looksLikeUrl('github'), false);
  assert.equal(looksLikeUrl('代码'), false);
  assert.equal(looksLikeUrl('hello world'), false);
  assert.equal(looksLikeUrl(''), false);
});

test('按类型过滤 + 检索组合使用', () => {
  const list = BUILTIN_LIBRARY;
  const onlyWeb = filterLibrary(list, '', 'web');
  assert.ok(onlyWeb.length > 0);
  assert.ok(onlyWeb.every((x) => x.type === 'web'), '类型过滤应只留 web');
  const hit = filterLibrary(list, 'github', 'web');
  assert.ok(hit.some((x) => x.id === 'bl-github'), '应能检索到 GitHub');
  assert.equal(filterLibrary(list, 'github', 'app').length, 0, '类型不匹配时不应命中');
});

// ---------------- macOS 化约束（防止「Windows 思维」的路径/条目再混进来） ----------------

test('预制应用全部是 macOS bundle 路径，且带 appBundle + iconMode=native', () => {
  const apps = BUILTIN_LIBRARY.filter((x) => x.type === 'app');
  assert.ok(apps.length > 30, '系统应用应该有一批');
  for (const a of apps) {
    assert.match(a.target, /^\/.+\.app$/, `${a.name} 目标不是 .app 路径：${a.target}`);
    assert.ok(a.appBundle && a.appBundle.endsWith('.app'), `${a.name} 缺 appBundle`);
    assert.equal(a.iconMode, 'native', `${a.name} 应优先用原生图标`);
    assert.ok(a.icon && a.icon.trim(), `${a.name} 仍需要 emoji 兜底`);
  }
});

test('系统应用不许写死 /Applications（它们其实在 /System/Applications）', () => {
  // 这几个是重灾区：老版本写成 /Applications/Notes.app、/Applications/Utilities/Terminal.app
  const mustNotBeAppsDir = ['bl-notes', 'bl-calendar', 'bl-mail', 'bl-reminders', 'bl-terminal', 'bl-finder', 'bl-screenshot', 'bl-activity'];
  for (const id of mustNotBeAppsDir) {
    const it = BUILTIN_LIBRARY.find((x) => x.id === id);
    assert.ok(it, `${id} 不存在`);
    assert.ok(!it!.target.startsWith('/Applications/'), `${id} 路径仍是老位置：${it!.target}`);
  }
  // Finder 在 CoreServices 里，终端/活动监视器在 Utilities 里
  assert.equal(BUILTIN_LIBRARY.find((x) => x.id === 'bl-finder')!.target, '/System/Library/CoreServices/Finder.app');
  assert.equal(BUILTIN_LIBRARY.find((x) => x.id === 'bl-terminal')!.target, '/System/Applications/Utilities/Terminal.app');
});

test('预制文件条目使用绝对路径（主进程会按真实 home 展开）', () => {
  for (const f of BUILTIN_LIBRARY.filter((x) => x.type === 'file')) {
    assert.ok(f.target.startsWith('/'), `${f.name} 不是绝对路径：${f.target}`);
    assert.equal(f.iconMode, 'native', `${f.name} 目录图标应走 macOS 原生`);
  }
});

test('预制快捷键用 macOS 修饰键（command / option / control），不用 ctrl 这种 Windows 写法', () => {
  for (const k of BUILTIN_LIBRARY.filter((x) => x.type === 'shortcut')) {
    assert.ok(k.shortcutKeystroke, `${k.name} 缺组合键`);
    const acc = k.shortcutKeystroke!;
    assert.ok(!/\bctrl\b/i.test(acc), `${k.name} 用了 ctrl：${acc}`);
    assert.ok(!/\bwin\b/i.test(acc), `${k.name} 用了 win 键：${acc}`);
    assert.ok(/command|option|control|shift/i.test(acc), `${k.name} 没有修饰键：${acc}`);
  }
});

test('预制库里没有 Windows 专属条目与术语（.exe / 我的电脑 / 资源管理器 / 任务管理器 / 记事本）', () => {
  const bad = /\.exe|我的电脑|回收站|资源管理器|任务管理器|记事本|Program Files/i;
  for (const it of BUILTIN_LIBRARY) {
    const hay = [it.name, it.target, ...(it.keywords || [])].join(' ');
    assert.ok(!bad.test(hay), `预制项「${it.name}」还带 Windows 痕迹：${hay}`);
  }
});

// ---------------- 项目库分类：mac 系统 ----------------

test('「mac 系统」是项目库的虚拟分类，排在下拉第一位', () => {
  assert.equal(LIBRARY_TYPES[0], 'mac');
  assert.equal(libraryTypeName('mac'), 'mac 系统');
  assert.ok((LIBRARY_TYPES as readonly string[]).includes('mac'));
});

test('matchLibraryType：mac 分类只留系统自带，其它分类排除系统自带（互斥）', () => {
  const sys = { type: 'app', system: true, name: '备忘录' };
  const third = { type: 'app', name: '微信' };
  const web = { type: 'web', name: 'GitHub' };

  assert.equal(matchLibraryType(sys, 'mac'), true);
  assert.equal(matchLibraryType(third, 'mac'), false, '第三方应用不算 mac 系统');
  assert.equal(matchLibraryType(web, 'mac'), false);

  // 系统项目已经归到 mac 系统了，不再出现在「应用」分类里
  assert.equal(matchLibraryType(sys, 'app'), false);
  assert.equal(matchLibraryType(third, 'app'), true);

  // 全部类型 / 空值：都保留
  assert.equal(matchLibraryType(sys, ''), true);
  assert.equal(matchLibraryType(sys, undefined), true);
});

test('filterLibrary 按 mac 分类筛：只剩 system=true 的条目', () => {
  const mac = filterLibrary(BUILTIN_LIBRARY, '', 'mac');
  assert.ok(mac.length > 40, '系统自带条目应该有一批：' + mac.length);
  assert.ok(mac.every((x) => x.system === true), 'mac 分类里混进了非系统条目');
  // 系统应用 / 系统文件夹 / 系统级快捷键都要在里面
  assert.ok(mac.some((x) => x.id === 'bl-notes'), 'mac 分类应含备忘录');
  assert.ok(mac.some((x) => x.id === 'bl-terminal'), 'mac 分类应含终端');
  assert.ok(mac.some((x) => x.id === 'bl-f-downloads'), 'mac 分类应含系统文件夹');
  assert.ok(mac.some((x) => x.id === 'bl-k-shot'), 'mac 分类应含系统级快捷键');
});

test('filterLibrary：应用 / 文件 / 快捷键分类里不再出现系统自带条目', () => {
  for (const t of ['app', 'file', 'shortcut']) {
    const list = filterLibrary(BUILTIN_LIBRARY, '', t);
    // 「文件」分类里的内置条目全是系统标准文件夹，已经整体归到 mac 系统，
    // 所以这里允许为空（用户自己收藏的文件仍会出现在该分类下），但绝不能再混进系统条目。
    assert.ok(list.every((x) => !x.system), `${t} 分类里还有系统自带条目`);
  }
  // 第三方应用仍然在「应用」分类里
  const apps = filterLibrary(BUILTIN_LIBRARY, '', 'app');
  assert.ok(apps.length > 0, '应用分类不应为空');
  assert.ok(apps.every((x) => x.type === 'app'));
  assert.ok(apps.some((x) => /微信|Chrome|VS Code/.test(x.name)), '第三方应用应留在应用分类');
  // 快捷键分类里留下的是第三方/通用快捷键
  const keys = filterLibrary(BUILTIN_LIBRARY, '', 'shortcut');
  assert.ok(keys.length > 0, '快捷键分类不应为空');
});

test('系统自带的每个应用都打了 system 标记（Finder / 终端 / 磁盘工具…）', () => {
  for (const id of ['bl-finder', 'bl-launchpad', 'bl-notes', 'bl-terminal', 'bl-activity', 'bl-diskutil', 'bl-settings']) {
    const it = BUILTIN_LIBRARY.find((x) => x.id === id);
    assert.ok(it, `${id} 不存在`);
    assert.equal(it!.system, true, `${id} 未标 system`);
  }
  // 第三方应用不能标成系统
  for (const id of ['bl-chrome', 'bl-vscode', 'bl-wechat']) {
    const it = BUILTIN_LIBRARY.find((x) => x.id === id);
    assert.equal(it?.system === true, false, `${id} 被误标成系统自带`);
  }
});

test('搜「mac 系统」/「系统」能把系统自带条目搜出来', () => {
  for (const q of ['mac', 'macos', '系统', 'mac 系统']) {
    const hit = filterLibrary(BUILTIN_LIBRARY, q);
    assert.ok(hit.some((x) => x.id === 'bl-notes'), `搜「${q}」应命中系统应用`);
  }
  // 但搜「系统」不该把普通网页也带出来当系统项（命中项里非系统条目允许有，只要系统项在内）
  const hit = filterLibrary(BUILTIN_LIBRARY, 'mac 系统');
  assert.ok(hit.every((x) => x.system === true), '搜「mac 系统」应只剩系统条目');
});
