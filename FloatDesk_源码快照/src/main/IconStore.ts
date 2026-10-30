// 图标缓存目录：网页 favicon、应用图标、文件图标都落在 userData/item-icons/ 下，
// 用内容 sha1 做文件名，重复内容不会重复写盘。落盘后界面直接用 file:// 路径显示，
// 离线、原站点改版、原文件被移动都不会变成空白图。
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { log } from './Logging';

export function iconDir(): string {
  const dir = path.join(app.getPath('userData'), 'item-icons');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

/** 写入图标缓存，返回绝对路径；失败返回空串（调用方要能容忍） */
export function saveIcon(buf: Buffer, ext: string): string {
  const dir = iconDir();
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const file = path.join(dir, `${hash}.${ext}`);
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    return file;
  } catch (e: any) {
    log('图标写入失败: ' + e.message);
    return '';
  }
}
