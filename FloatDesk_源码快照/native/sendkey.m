// FloatDesk 快捷键发送桥：把 "command+shift+4" 这样的组合键真正「按」到前台应用。
// 为什么不用 AppleScript keystroke：它只能发单字符键，系统截图（Command+Shift+4）、
// 方向键、F 键、回车退格全都发不了。CGEvent 走 HID 事件流，和真实按键没有区别
// （需要「辅助功能」权限，与 AppleScript 方案一致）。
//
// 用法：sendkey "command+shift+4"
// 退出码：0 成功；2 用法错误；3 不支持的按键
#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>

// 单键 -> macOS 虚拟键码（ANSI 布局；非 ANSI 键盘上的少数键位可能不同）
static CGKeyCode keyCodeFor(NSString *key) {
  static NSDictionary<NSString *, NSNumber *> *map = nil;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    map = @{
      // 字母
      @"a": @0x00, @"b": @0x0B, @"c": @0x08, @"d": @0x02, @"e": @0x0E, @"f": @0x03,
      @"g": @0x05, @"h": @0x04, @"i": @0x22, @"j": @0x26, @"k": @0x28, @"l": @0x25,
      @"m": @0x2E, @"n": @0x2D, @"o": @0x1F, @"p": @0x23, @"q": @0x0C, @"r": @0x0F,
      @"s": @0x01, @"t": @0x11, @"u": @0x20, @"v": @0x09, @"w": @0x0D, @"x": @0x07,
      @"y": @0x10, @"z": @0x06,
      // 数字行
      @"0": @0x1D, @"1": @0x12, @"2": @0x13, @"3": @0x14, @"4": @0x15, @"5": @0x17,
      @"6": @0x16, @"7": @0x1A, @"8": @0x1C, @"9": @0x19,
      // 符号
      @"-": @0x1B, @"=": @0x18, @"[": @0x21, @"]": @0x1E, @"\\": @0x2A,
      @";": @0x29, @"'": @0x27, @",": @0x2B, @".": @0x2F, @"/": @0x2C, @"`": @0x32,
      // 常用功能键
      @"space": @0x31, @"spacebar": @0x31, @"return": @0x24, @"enter": @0x24,
      @"tab": @0x30, @"esc": @0x35, @"escape": @0x35,
      @"backspace": @0x33, @"delete": @0x33, @"forwarddelete": @0x75,
      @"up": @0x7E, @"arrowup": @0x7E, @"down": @0x7D, @"arrowdown": @0x7D,
      @"left": @0x7B, @"arrowleft": @0x7B, @"right": @0x7C, @"arrowright": @0x7C,
      @"home": @0x73, @"end": @0x77, @"pageup": @0x74, @"pagedown": @0x79,
      @"capslock": @0x39, @"help": @0x72,
      // F1-F12
      @"f1": @0x7A, @"f2": @0x78, @"f3": @0x63, @"f4": @0x76, @"f5": @0x60, @"f6": @0x61,
      @"f7": @0x62, @"f8": @0x64, @"f9": @0x65, @"f10": @0x6D, @"f11": @0x67, @"f12": @0x6F,
    };
  });
  NSNumber *n = map[key];
  return n ? (CGKeyCode)[n integerValue] : 0xFFFF; // 0xFFFF = 表里没有
}

// 修饰键 -> CGEventFlags
static CGEventFlags flagsFor(NSString *mod) {
  if ([mod isEqualToString:@"command"] || [mod isEqualToString:@"cmd"] || [mod isEqualToString:@"meta"] || [mod isEqualToString:@"super"] || [mod isEqualToString:@"commandorcontrol"]) return kCGEventFlagMaskCommand;
  if ([mod isEqualToString:@"shift"]) return kCGEventFlagMaskShift;
  if ([mod isEqualToString:@"option"] || [mod isEqualToString:@"alt"] || [mod isEqualToString:@"opt"] || [mod isEqualToString:@"altgr"]) return kCGEventFlagMaskAlternate;
  if ([mod isEqualToString:@"control"] || [mod isEqualToString:@"ctrl"]) return kCGEventFlagMaskControl;
  if ([mod isEqualToString:@"fn"] || [mod isEqualToString:@"function"]) return kCGEventFlagMaskSecondaryFn;
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr, "usage: sendkey \"command+shift+4\"\n");
      return 2;
    }
    NSString *acc = [NSString stringWithUTF8String:argv[1]];
    NSMutableArray<NSString *> *parts = [NSMutableArray array];
    for (NSString *p in [acc componentsSeparatedByString:@"+"]) {
      NSString *t = [p stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
      if (t.length) [parts addObject:t.lowercaseString];
    }
    if (parts.count == 0) {
      fprintf(stderr, "usage: sendkey \"command+shift+4\"\n");
      return 2;
    }
    CGEventFlags flags = 0;
    NSString *key = parts.lastObject;
    for (NSUInteger i = 0; i + 1 < parts.count; i++) {
      CGEventFlags f = flagsFor(parts[i]);
      if (f == 0) {
        fprintf(stderr, "unsupported modifier: %s\n", parts[i].UTF8String);
        return 3;
      }
      flags |= f;
    }
    CGKeyCode code = keyCodeFor(key);
    if (code == 0xFFFF) {
      fprintf(stderr, "unsupported key: %s\n", key.UTF8String);
      return 3;
    }

    CGEventRef down = CGEventCreateKeyboardEvent(NULL, code, true);
    CGEventRef up = CGEventCreateKeyboardEvent(NULL, code, false);
    if (!down || !up) {
      fprintf(stderr, "CGEventCreateKeyboardEvent failed\n");
      return 3;
    }
    CGEventSetFlags(down, flags);
    CGEventSetFlags(up, flags);
    CGEventPost(kCGHIDEventTap, down);
    usleep(20000); // 20ms：系统截图等需要按下持续一下才认
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(down);
    CFRelease(up);
    return 0;
  }
}
