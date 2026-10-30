// .icns 解析：macOS 的应用图标是一个容器，里面按尺寸存了多份表示。
// 现代图标（含 macOS 系统应用）大多把大尺寸表示直接存成 PNG，所以可以直接把最大的那份
// 抽出来用，既比 `sips` 转出来的清晰（sips 常只取 256px），也不用起外部进程。
// 老式图标是 RLE 压缩的裸 RGB（类型 ic04/ic05 等），这里抽不出来，返回 null 交给上层兜底。
//
// 文件格式：'icns' + 4 字节总长度(大端) + 若干块 { 4 字节类型, 4 字节块长度(含 8 字节头), 数据 }

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buf: Buffer | null | undefined): boolean {
  if (!buf || buf.length < 8) return false;
  return buf.subarray(0, 8).equals(PNG_MAGIC);
}

/**
 * 从 .icns 内容里取出最大的内嵌 PNG。
 * 非法/截断/没有任何 PNG 表示时返回 null（绝不抛错，调用方据此走兜底）。
 */
export function extractPngFromIcns(buf: Buffer | null | undefined): Buffer | null {
  if (!buf || buf.length < 16) return null;
  if (buf.toString('ascii', 0, 4) !== 'icns') return null;

  // 总长度字段不可全信（有的图标写得比实际大），取两者较小值当上界
  const declared = buf.readUInt32BE(4);
  const limit = declared >= 8 && declared <= buf.length ? declared : buf.length;

  let best: Buffer | null = null;
  let offset = 8;
  let guard = 0;
  while (offset + 8 <= limit) {
    if (++guard > 4096) break; // 防呆：正常图标不会这么多块
    const size = buf.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > limit) break;
    const data = buf.subarray(offset + 8, offset + size);
    if (isPng(data) && (!best || data.length > best.length)) best = Buffer.from(data);
    offset += size;
  }
  return best;
}

/** 老式 icns 只有 RLE 裸 RGB 表示时，判断是否至少“像个图标容器”（给上层决定要不要用 sips） */
export function looksLikeIcns(buf: Buffer | null | undefined): boolean {
  return !!buf && buf.length >= 8 && buf.toString('ascii', 0, 4) === 'icns';
}
