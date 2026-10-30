// 编译后把渲染进程的 HTML 拷贝到 dist/renderer，保持目录结构
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'renderer');
const dst = path.join(root, 'dist', 'renderer');

function copyDir(s, d) {
  if (!fs.existsSync(s)) return;
  fs.mkdirSync(d, { recursive: true });
  for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, entry.name);
    const dp = path.join(d, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else if (entry.name.endsWith('.html')) fs.copyFileSync(sp, dp);
  }
}

copyDir(src, dst);
console.log('[copy-assets] renderer HTML copied to', dst);
