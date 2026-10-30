// FloatDesk 录制快捷键时的临时屏蔽桥（兼录制输入源）。
// 场景：录制 "Command+Shift+4" 时，系统会抢先执行截图，导致这个组合键录不上。
// 方案：录制期间装一个键盘事件 tap，吞掉所有键盘事件（系统与应用都不会执行），
//      同时把识别出的组合键打到 stdout，由主进程转发给设置页当录制输入：
//        KEY <accelerator>   按下了一个完整组合键（如 "Command+Shift+4"）
//        HELD <mods>         修饰键按下/抬起，只更新「已按住」提示（如 "command,shift"）
//        ESCAPE              用户按了 Esc（取消录制）
// 注意：
//   - 需要「辅助功能」权限（与 bin/sendkey 同一个权限）；
//   - 带 30 秒安全阀：无论如何都会自动退出，防止意外把键盘锁死；
//   - 主进程在录制结束（完成/取消/超时）时会杀掉本进程，双保险。
//
// 用法：keyblock [最大秒数，默认 30]
// 退出码：0 正常退出；4 装不上 tap（多半是没辅助功能权限）
#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static volatile sig_atomic_t gStop = 0;
static void onSig(int s) {
  (void)s;
  gStop = 1;
}

// 虚拟键码 -> 显示名（与 native/sendkey.m 的表互为逆映射；发送端能发的这里都要能录）
static const char *keyNameFor(CGKeyCode code) {
  switch (code) {
    case 0x00: return "A"; case 0x0B: return "B"; case 0x08: return "C"; case 0x02: return "D";
    case 0x0E: return "E"; case 0x03: return "F"; case 0x05: return "G"; case 0x04: return "H";
    case 0x22: return "I"; case 0x26: return "J"; case 0x28: return "K"; case 0x25: return "L";
    case 0x2E: return "M"; case 0x2D: return "N"; case 0x1F: return "O"; case 0x23: return "P";
    case 0x0C: return "Q"; case 0x0F: return "R"; case 0x01: return "S"; case 0x11: return "T";
    case 0x20: return "U"; case 0x09: return "V"; case 0x0D: return "W"; case 0x07: return "X";
    case 0x10: return "Y"; case 0x06: return "Z";
    case 0x1D: return "0"; case 0x12: return "1"; case 0x13: return "2"; case 0x14: return "3";
    case 0x15: return "4"; case 0x17: return "5"; case 0x16: return "6"; case 0x1A: return "7";
    case 0x1C: return "8"; case 0x19: return "9";
    case 0x1B: return "-"; case 0x18: return "="; case 0x21: return "["; case 0x1E: return "]";
    case 0x2A: return "\\"; case 0x29: return ";"; case 0x27: return "'"; case 0x2B: return ",";
    case 0x2F: return "."; case 0x2C: return "/"; case 0x32: return "`";
    case 0x31: return "Space"; case 0x24: return "Return"; case 0x30: return "Tab";
    case 0x35: return "Escape"; case 0x33: return "Backspace"; case 0x75: return "Delete";
    case 0x7E: return "Up"; case 0x7D: return "Down"; case 0x7B: return "Left"; case 0x7C: return "Right";
    case 0x73: return "Home"; case 0x77: return "End"; case 0x74: return "PageUp"; case 0x79: return "PageDown";
    case 0x39: return "CapsLock"; case 0x72: return "Help";
    case 0x7A: return "F1"; case 0x78: return "F2"; case 0x63: return "F3"; case 0x76: return "F4";
    case 0x60: return "F5"; case 0x61: return "F6"; case 0x62: return "F7"; case 0x64: return "F8";
    case 0x65: return "F9"; case 0x6D: return "F10"; case 0x67: return "F11"; case 0x6F: return "F12";
    default: return NULL;
  }
}

// 事件回调：一律 return NULL 吞掉键盘事件，同时把组合键打到 stdout。
// 注意 CGEventTapCreate 只收 C 函数指针（新版 SDK 已无 block 重载），userInfo 传 NULL。
static CGEventRef tapCB(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *ctx) {
  (void)proxy; (void)ctx;
  // FlagsChanged：只报「已按住哪些修饰键」，事件照样吞掉
  if (type == kCGEventFlagsChanged) {
    CGEventFlags f = CGEventGetFlags(event);
    char held[64] = "";
    if (f & kCGEventFlagMaskCommand) strcat(held, "command,");
    if (f & kCGEventFlagMaskShift) strcat(held, "shift,");
    if (f & kCGEventFlagMaskAlternate) strcat(held, "option,");
    if (f & kCGEventFlagMaskControl) strcat(held, "control,");
    size_t n = strlen(held);
    if (n) held[n - 1] = '\0';
    printf("HELD %s\n", held);
    fflush(stdout);
    return NULL;
  }
  if (type != kCGEventKeyDown) return NULL;
  CGKeyCode code = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  const char *name = keyNameFor(code);
  if (!name) return NULL; // 表外的键：吞掉但不报（录不了就别录）
  if (strcmp(name, "Escape") == 0) {
    printf("ESCAPE\n");
    fflush(stdout);
    return NULL;
  }
  CGEventFlags f = CGEventGetFlags(event);
  char acc[128] = "";
  if (f & kCGEventFlagMaskCommand) strcat(acc, "Command+");
  if (f & kCGEventFlagMaskControl) strcat(acc, "Control+");
  if (f & kCGEventFlagMaskAlternate) strcat(acc, "Alt+");
  if (f & kCGEventFlagMaskShift) strcat(acc, "Shift+");
  strcat(acc, name);
  printf("KEY %s\n", acc);
  fflush(stdout);
  return NULL; // 吞掉：系统不会执行这个组合键
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    signal(SIGTERM, onSig);
    signal(SIGINT, onSig);
    double maxSec = (argc > 1 && atof(argv[1]) > 0) ? atof(argv[1]) : 30;

    CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) | CGEventMaskBit(kCGEventFlagsChanged);
    CFMachPortRef tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault, mask, tapCB, NULL);
    if (!tap) {
      fprintf(stderr, "event tap create failed (needs Accessibility permission)\n");
      return 4;
    }
    CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    printf("KEYBLOCK_READY\n");
    fflush(stdout);

    time_t started = time(NULL);
    while (!gStop) {
      CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.2, true);
      if (difftime(time(NULL), started) >= maxSec) {
        fprintf(stderr, "keyblock safety timeout\n");
        break;
      }
    }
    CGEventTapEnable(tap, false);
    CFRelease(src);
    CFRelease(tap);
    return 0;
  }
}
