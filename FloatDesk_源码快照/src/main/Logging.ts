// 诊断日志（不记录敏感内容：不写密码 / Cookie / 网页登录态）
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

let logPath = '';

export function initLogging(): void {
  try {
    logPath = path.join(app.getPath('userData'), 'floatdesk.log');
  } catch {
    logPath = path.join(process.cwd(), 'floatdesk.log');
  }
}

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (logPath) fs.appendFileSync(logPath, line);
  } catch {
    /* 忽略日志写入失败 */
  }
  // 同时输出到控制台便于开发调试
  // eslint-disable-next-line no-console
  console.log(msg);
}

export function getLog(): string {
  try {
    return fs.readFileSync(logPath, 'utf-8');
  } catch {
    return '';
  }
}

export function getDiagnostics(config: any): string {
  const lines = [
    '===== FloatDesk 诊断信息 =====',
    `时间: ${new Date().toISOString()}`,
    `平台: ${process.platform} (${process.arch})`,
    `Electron: ${process.versions.electron || 'n/a'}`,
    `Node: ${process.versions.node}`,
    `场景数量: ${config?.scenes?.length ?? 0}`,
    `当前场景: ${config?.currentSceneId ?? 'n/a'}`,
    `开机启动: ${config?.appearance?.openAtLogin ?? false}`,
    `唤出快捷键: ${config?.appearance?.windowShortcut ?? '未设置'}`,
    '==============================',
  ];
  return lines.join('\n');
}
