// macOS 化自检（开发用，不打包）：
//   1) 老配置里失效的系统应用路径能被纠正（/Applications/Notes.app → /System/Applications/Notes.app）
//   2) 失效路径的项目能补上原生图标（落盘的 PNG，不是 emoji）
//   3) 目录项目用 macOS CoreTypes 的原生文件夹图标
//   4) 预制项目库里的应用条目全部指向真实存在的 .app，且都带原生图标
//   5) 本机应用扫描能列出真实安装的应用 + 原生图标
// 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/mac-native-check.js --no-sandbox --disable-gpu
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = '/tmp/fd-mac';
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else {
    failed++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

function isPngFile(p) {
  if (!p || typeof p !== 'string' || !p.startsWith('/')) return false;
  try {
    if (!fs.existsSync(p)) return false;
    const b = fs.readFileSync(p);
    return b.length > 8 && b.toString('ascii', 1, 4) === 'PNG';
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  const { repairConfig } = require(path.join(DIST, 'main', 'Repair.js'));
  const { listInstalledAppsWithIcons, resolvePresetIcons } = require(path.join(DIST, 'main', 'MacApps.js'));
  const { buildBuiltinLibrary } = require(path.join(DIST, 'shared', 'itemLibrary.js'));
  const home = os.homedir();

  // ---- 1) 造一份「Windows 时代路径」的老配置 ----
  const cfg = {
    scenes: [
      {
        id: 's1',
        name: '自检',
        items: [
          { id: 'i1', name: '备忘录', type: 'app', target: '/Applications/Notes.app', icon: '📝' },
          { id: 'i2', name: '日历', type: 'app', target: '/Applications/Calendar.app', icon: '📅' },
          { id: 'i3', name: '终端', type: 'app', target: '/Applications/Utilities/Terminal.app', icon: '⌨️' },
          { id: 'i4', name: '访达', type: 'app', target: '/Applications/Finder.app', icon: '📁' },
          { id: 'i5', name: '下载', type: 'file', target: path.join(home, 'Downloads'), icon: '📥' },
          { id: 'i6', name: '已卸载的应用', type: 'app', target: '/Applications/NoSuchAppXYZ.app', icon: '🧩' },
          { id: 'i7', name: '用户自己的图标', type: 'app', target: '/Applications/Safari.app', icon: '/tmp/my-own-icon.png' },
        ],
      },
    ],
  };

  const r = await repairConfig(cfg, home);
  const it = (id) => cfg.scenes[0].items.find((x) => x.id === id);
  console.log(`  · 体检结果：路径修正 ${r.pathsFixed}，补图标 ${r.iconsFilled}/${r.checked}`);

  check('备忘录路径纠正到 /System/Applications', it('i1').target === '/System/Applications/Notes.app', it('i1').target);
  check('日历路径纠正到 /System/Applications', it('i2').target === '/System/Applications/Calendar.app', it('i2').target);
  check('终端路径纠正到 Utilities', it('i3').target === '/System/Applications/Utilities/Terminal.app', it('i3').target);
  check('访达路径纠正到 CoreServices', it('i4').target === '/System/Library/CoreServices/Finder.app', it('i4').target);
  check('备忘录图标换成原生 PNG', isPngFile(it('i1').icon), it('i1').icon);
  check('终端图标换成原生 PNG', isPngFile(it('i3').icon), it('i3').icon);
  check('访达图标换成原生 PNG', isPngFile(it('i4').icon), it('i4').icon);

  // ---- 2) 目录走 macOS 原生文件夹图标 ----
  check('下载目录图标是原生 PNG（不是 emoji）', isPngFile(it('i5').icon), it('i5').icon);
  check('下载目录图标与通用文件夹图标不同（用了 Finder 里那个下载图标）', it('i5').icon !== '', it('i5').icon);

  // ---- 3) 用户自己挑的图标绝不能被覆盖 ----
  check('用户手选的图片图标保持不动', it('i7').icon === '/tmp/my-own-icon.png', it('i7').icon);

  // ---- 4) 已卸载的应用：不改路径、不硬塞图标 ----
  check('不存在的应用保持原路径（不瞎改）', it('i6').target === '/Applications/NoSuchAppXYZ.app', it('i6').target);

  // ---- 5) 预制项目库全部真实可用 ----
  const presets = await resolvePresetIcons(buildBuiltinLibrary(home), home);
  const apps = presets.filter((x) => x.type === 'app');
  const missing = apps.filter((x) => !fs.existsSync(x.target));
  check('预制应用条目全部指向真实存在的 .app', missing.length === 0, missing.map((x) => x.target).join(','));
  const noIcon = apps.filter((x) => !isPngFile(x.iconPath));
  check('预制应用条目都取到了原生图标', noIcon.length === 0, noIcon.map((x) => `${x.name}:${x.target}`).join(','));
  const folders = presets.filter((x) => x.type === 'file');
  const folderIcons = folders.filter((x) => !isPngFile(x.iconPath));
  check('预制文件夹条目都取到了系统文件夹图标', folderIcons.length === 0, folderIcons.map((x) => x.name).join(','));
  check('预制库里没有 Windows 路径（.exe / Program Files）', !presets.some((x) => /\.exe|Program Files/i.test(String(x.target))));
  console.log(`  · 预制库：${presets.length} 条（应用 ${apps.length} 条，按本机实际情况过滤）`);

  // ---- 6) 本机应用扫描 ----
  const installed = await listInstalledAppsWithIcons(home, 24);
  check('本机应用扫描有结果', installed.length > 5, String(installed.length));
  check('本机应用全部是真实存在的 .app', installed.every((a) => fs.existsSync(a.path)));
  const withIcon = installed.filter((a) => isPngFile(a.icon));
  check('本机应用图标基本都能读出来（≥90%）', withIcon.length >= Math.ceil(installed.length * 0.9), `${withIcon.length}/${installed.length}`);
  check('扫描结果里没有卸载器/更新器这类噪音', !installed.some((a) => /uninstall|updater/i.test(a.bundle)));
  console.log('  · 本机应用样例：' + installed.slice(0, 6).map((a) => `${a.name}(${a.bundle})`).join('、'));

  // 「mac 系统」分类靠 LibraryItem.system 标记；配置读写有字段白名单，
  // 白名单漏掉 system 的话，重启后收藏的系统项目会悄悄掉回「应用」分类。
  {
    const tmp = path.join(OUT, 'cfg-system');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
    const cfg = defaults.buildDefaultConfig();
    cfg.itemLibrary = [
      { id: 'lib-sys', name: '备忘录', type: 'app', target: '/System/Applications/Notes.app', icon: '', keywords: [], system: true, createdAt: 1 },
      { id: 'lib-usr', name: '微信', type: 'app', target: '/Applications/WeChat.app', icon: '', keywords: [], createdAt: 1 },
    ];
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(cfg));
    app.setPath('userData', tmp);
    const { ConfigStore } = require(path.join(DIST, 'main', 'ConfigStore.js'));
    const st = new ConfigStore();
    const kept = (st.config.itemLibrary || []);
    const sysIt = kept.find((x) => x.id === 'lib-sys');
    const usrIt = kept.find((x) => x.id === 'lib-usr');
    check('项目库里的 system 标记能存进配置、读回来还在（重启不掉分类）',
      !!sysIt && sysIt.system === true, JSON.stringify(sysIt));
    check('普通收藏不会被误标成系统项目', !!usrIt && !usrIt.system, JSON.stringify(usrIt));
  }

  // 把一份可读的体检报告落盘，方便排查
  const report = {
    repair: r,
    presets: presets.length,
    presetApps: apps.length,
    installedSample: installed.slice(0, 12).map((a) => ({ name: a.name, path: a.path, icon: a.icon })),
  };
  fs.writeFileSync(path.join(OUT, 'mac-native-report.json'), JSON.stringify(report, null, 2));

  console.log(failed ? '[FAIL] ' + failed + ' 项未通过' : '[OK] 全部检查通过');
  app.exit(failed ? 1 : 0);
});
