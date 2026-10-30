#!/bin/bash
# 编译输入法切换的原生辅助程序（Carbon / TIS）。
# Electron 主进程没法直接调 Carbon，所以用一个极小的命令行程序做桥，
# 主进程用 execFile 调用它（不经过 shell，参数以数组传入）。
#
# 产物：bin/imeswitch（x86_64 + arm64 通用二进制，同时支持 Intel 与 Apple Silicon）
# 用法：bash scripts/build-native.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/imeswitch.m"
OUT="$ROOT/bin/imeswitch"

SDK="$(xcrun --show-sdk-path 2>/dev/null || true)"
if [ -z "$SDK" ]; then
  echo "[build-native] 找不到 macOS SDK（需要 Xcode Command Line Tools）" >&2
  echo "              安装：xcode-select --install" >&2
  exit 1
fi

mkdir -p "$ROOT/bin"
echo "[build-native] SDK: $SDK"
clang -arch x86_64 -arch arm64 \
  -mmacosx-version-min=10.15 \
  -isysroot "$SDK" \
  -framework Carbon -framework Foundation \
  -fobjc-arc \
  -Os -Wall \
  -o "$OUT" "$SRC"

echo "[build-native] 已生成 $OUT"
file "$OUT"
"$OUT" cur >/dev/null && echo "[build-native] 自检：cur 可用"

# ---- sendkey：向前台应用发送组合键（CGEvent 走 HID 事件流）----
SRC2="$ROOT/native/sendkey.m"
OUT2="$ROOT/bin/sendkey"
clang -arch x86_64 -arch arm64 \
  -mmacosx-version-min=10.15 \
  -isysroot "$SDK" \
  -framework ApplicationServices -framework Foundation \
  -fobjc-arc \
  -Os -Wall \
  -o "$OUT2" "$SRC2"
echo "[build-native] 已生成 $OUT2"
file "$OUT2"
"$OUT2" "command+shift+4" >/dev/null 2>&1 && echo "[build-native] 自检：sendkey 可用" || echo "[build-native] 自检：sendkey 未通过（可能需要辅助功能权限，不影响构建）"

# ---- keyblock：录制快捷键时临时吞掉键盘事件，并把组合键报给主进程 ----
SRC3="$ROOT/native/keyblock.m"
OUT3="$ROOT/bin/keyblock"
clang -arch x86_64 -arch arm64 \
  -mmacosx-version-min=10.15 \
  -isysroot "$SDK" \
  -framework ApplicationServices -framework Foundation \
  -fobjc-arc \
  -Os -Wall \
  -o "$OUT3" "$SRC3"
echo "[build-native] 已生成 $OUT3"
file "$OUT3" | head -1
