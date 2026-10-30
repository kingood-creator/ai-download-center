// 开机启动（可选）
import { app } from 'electron';

export function setOpenAtLogin(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
  } catch (e: any) {
    log_auto('设置开机启动失败: ' + e.message);
  }
}

export function getOpenAtLogin(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function log_auto(msg: string): void {
  // 避免循环依赖，直接打印
  // eslint-disable-next-line no-console
  console.log('[AutoLaunch] ' + msg);
}
