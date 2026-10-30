// 图标库 UI 截图自检（一次性脚本）：工具页「图标库」卡片 + 项目编辑弹窗上的选图浮层。
// 用真实 IconLibrary 往库里放几个彩色小图标，然后截图看排版。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const defaults = require(path.join(DIST, 'shared', 'defaults.js'));
const builtins = require(path.join(DIST, 'shared', 'builtins.js'));
const IconLibrary = require(path.join(DIST, 'main', 'IconLibrary.js'));

// 造 4 个不同颜色的小 PNG 当测试图标
function coloredPng(r, g, b) {
  // 8x8 纯色 PNG（zlib 存的是 raw scanline，这里直接用已知可用的最小 PNG 手工拼太麻烦，
  // 改用 dataURL 形式让主进程解码——但截图脚本直接写文件更简单，用 Buffer 拼一个合法 PNG）
  const zlib = require('zlib');
  const w = 8, h = 8;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = r; raw[off + 2 + x * 3] = g; raw[off + 3 + x * 3] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(require('zlib').crc32 ? require('zlib').crc32(td) : crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// 简易 CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

ipcMain.handle('config:get', () => defaults.buildDefaultConfig());
ipcMain.handle('config:save', () => ({ ok: true }));
ipcMain.handle('builtins:actions', () => builtins.BUILTIN_ACTIONS);
ipcMain.handle('perm:status', () => ({ trusted: true }));
ipcMain.handle('diag:get', () => ({ diagnostics: 'shot', log: '' }));
ipcMain.handle('note:presets', () => []);
ipcMain.handle('ime:snapshot', () => ({ ok: true, available: true, sources: [], currentId: '', currentName: '' }));
ipcMain.handle('float:bounds', () => ({ x: 0, y: 0 }));
ipcMain.handle('float:dragEnd', () => ({ moved: false }));
ipcMain.on('settings:open', () => {});
ipcMain.on('settings:close', () => {});
ipcMain.on('diag:log', () => {});
ipcMain.on('float:resize', () => {});
ipcMain.on('note:open', () => {});
ipcMain.on('note:close', () => {});
ipcMain.on('preview:open', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  // 清库并放入 6 个彩色图标
  fs.rmSync(IconLibrary.libDir(), { recursive: true, force: true });
  const colors = [
    ['红', 220, 70, 70], ['绿', 70, 190, 110], ['蓝', 80, 130, 230],
    ['紫', 150, 100, 220], ['橙', 235, 160, 60], ['青', 70, 200, 200],
  ];
  for (const [nm, r, g, b] of colors) {
    fs.writeFileSync(path.join(IconLibrary.libDir(), `测试图标-${nm}.png`), coloredPng(r, g, b));
    await sleep(30);
  }
  console.log('[shot] 库内图标:', IconLibrary.listIcons().map((i) => i.name).join(', '));

  ipcMain.handle('iconlib:list', () => IconLibrary.listIcons());
  ipcMain.handle('iconlib:add', (_e, p) => ({ ...IconLibrary.addIconFromPath(String(p.path || '')), icons: IconLibrary.listIcons() }));
  ipcMain.handle('iconlib:use', (_e, p) => IconLibrary.useIcon(String(p)));
  ipcMain.handle('iconlib:delete', (_e, p) => ({ ...IconLibrary.deleteIcon(String(p)), icons: IconLibrary.listIcons() }));
  ipcMain.handle('iconlib:reveal', async () => ({ ok: true }));

  const win = new BrowserWindow({
    width: 1020, height: 720, show: true,
    webPreferences: {
      preload: path.join(DIST, 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  await sleep(600);

  // 1) 工具页：图标库卡片（滚动到卡片位置再截）
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-view="tools"]').click();
    await new Promise(r => setTimeout(r, 500));
    document.getElementById('lib-drop2').scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 300));
    return true;
  })()`);
  await sleep(400);
  await win.capturePage().then((img) => {
    fs.writeFileSync('/tmp/fd-shot/iconlib-tools.png', img.toPNG());
    console.log('[shot] 工具页已截图');
  });

  // 2) 项目编辑弹窗 + 选图浮层（叠在一起）
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-view="items"]').click();
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('#view-items [data-edit]').click();
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('it-iconpick').click();
    await new Promise(r => setTimeout(r, 500));
    return true;
  })()`);
  await sleep(400);
  await win.capturePage().then((img) => {
    fs.writeFileSync('/tmp/fd-shot/iconlib-picker.png', img.toPNG());
    console.log('[shot] 选图浮层已截图');
  });
  app.exit(0);
});
