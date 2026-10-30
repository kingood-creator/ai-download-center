// macOS 权限检测与引导（辅助功能用于向其他应用发送模拟按键）
import { execFileSync, execFile } from 'child_process';
import { systemPreferences } from 'electron';
import { log } from './Logging';

export function checkAccessibility(): boolean {
  try {
    const fn = (systemPreferences as any).isTrustedWithAccessibility;
    if (typeof fn === 'function') {
      return !!fn.call(systemPreferences);
    }
  } catch (e: any) {
    log('辅助功能 API 检测异常: ' + e.message);
  }
  // 回退：尝试一个无害的 System Events 调用，成功说明已授权
  try {
    execFileSync(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
      { timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

export function openAccessibilitySettings(): void {
  execFile('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], (err) => {
    if (err) {
      // 兜底：打开系统设置
      execFile('open', ['/System/Applications/System Settings.app']);
    }
  });
}
