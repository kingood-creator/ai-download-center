// 联网自检：对若干真实网站跑一遍 favicon/标题探测（开发用，不打包）
// 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/probe-check.js --no-sandbox
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const { probeWeb, normalizeUrl } = require(path.join(DIST, 'main', 'WebProbe.js'));

const TARGETS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const URLS = TARGETS.length
  ? TARGETS
  : ['https://github.com', 'https://www.apple.com/cn/', 'https://news.ycombinator.com', 'https://www.bilibili.com'];

app.whenReady().then(async () => {
  const out = [];
  for (const u of URLS) {
    const t0 = Date.now();
    let r;
    try {
      r = await probeWeb(u);
    } catch (e) {
      r = { ok: false, error: String(e && e.message ? e.message : e) };
    }
    const ms = Date.now() - t0;
    let iconBytes = 0;
    if (r.iconPath && fs.existsSync(r.iconPath)) iconBytes = fs.statSync(r.iconPath).size;
    out.push({
      input: u,
      normal: normalizeUrl(u),
      ok: !!r.ok,
      title: r.title || '',
      siteName: r.siteName || '',
      iconUrl: r.iconUrl || '',
      iconPath: r.iconPath || '',
      iconBytes,
      error: r.error || '',
      ms,
    });
  }
  console.log('PROBE_RESULT_BEGIN');
  console.log(JSON.stringify(out, null, 2));
  console.log('PROBE_RESULT_END');
  fs.writeFileSync(path.join(__dirname, '..', 'probe-check-result.json'), JSON.stringify(out, null, 2));
  app.exit(out.every((o) => o.ok) ? 0 : 1);
});

app.on('window-all-closed', () => app.quit());
