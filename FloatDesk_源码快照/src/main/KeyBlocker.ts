import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';

/**
 * 录制快捷键时的「屏蔽桥」管理器：
 * 启动 bin/keyblock 装一个 session 级键盘事件 tap，吞掉所有键盘事件
 * （防止 Command+Shift+4 这类系统快捷键在录制途中抢先触发），
 * 同时把识别出的组合键逐行打到 stdout，由调用方转发给设置页当录制输入。
 *
 * 安全设计：
 *  - 单例幂等：start() 前总是先 stop()；
 *  - keyblock 自带 30 秒安全阀自动退出；
 *  - stop() 用 SIGTERM（keyblock 有信号处理，会立即退出）。
 */
export class KeyBlocker {
  private child: ChildProcess | null = null;
  private binCache: string | null = null;

  /** 当前是否有 keyblock 在跑 */
  get active(): boolean {
    return !!this.child && this.child.exitCode === null;
  }

  private findBin(): string | null {
    if (this.binCache) return this.binCache;
    const cands = [
      path.join(process.resourcesPath || '', 'bin', 'keyblock'),
      path.join(__dirname, '..', '..', 'bin', 'keyblock'),
      path.join(__dirname, '..', '..', '..', 'bin', 'keyblock'),
      path.join(app.getAppPath(), 'bin', 'keyblock'),
    ];
    for (const c of cands) {
      try {
        if (c && fs.existsSync(c)) {
          this.binCache = c;
          return c;
        }
      } catch {
        /* 忽略，继续找下一个 */
      }
    }
    return null;
  }

  /**
   * 开始屏蔽。onLine 收到每一行 stdout（已 trim）：
   *   'KEYBLOCK_READY' tap 已装好
   *   'KEY <accelerator>' 按下一个完整组合键
   *   'HELD <mods>' 修饰键变化（仅提示）
   *   'ESCAPE' 用户按 Esc
   * 返回：started 已启动 / no-bin 找不到 keyblock / failed 启动异常
   */
  start(onLine: (line: string) => void, maxSec = 30): 'started' | 'no-bin' | 'failed' {
    this.stop();
    const bin = this.findBin();
    if (!bin) return 'no-bin';
    try {
      const child = spawn(bin, [String(maxSec)], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let buf = '';
      child.stdout?.on('data', (d) => {
        buf += String(d);
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) onLine(line);
        }
      });
      child.on('error', () => {
        if (this.child === child) this.child = null;
      });
      child.on('exit', () => {
        if (this.child === child) this.child = null;
      });
      return 'started';
    } catch {
      return 'failed';
    }
  }

  /** 结束屏蔽（幂等；无子进程时什么都不做） */
  stop(): void {
    const c = this.child;
    this.child = null;
    if (c && c.exitCode === null && !c.killed) {
      try {
        c.kill();
      } catch {
        /* 已经死了 */
      }
    }
  }
}
