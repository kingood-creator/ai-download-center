// 输入法切换辅助程序（macOS，Carbon / TIS）
//
// 为什么需要它：Electron 主进程是纯 Node，拿不到 dlopen / ctypes，
// 无法直接调用 Carbon 的 TIS 接口。而「切换输入法」又必须走 TIS 才够稳：
// 用模拟按键（Ctrl+Space）会依赖「辅助功能」权限，也受用户自定义切换键影响。
// TIS 直切不需要任何权限，也不管用户把切换键设成了什么。
//
// 用法：
//   imeswitch list             列出所有可选输入源，每行 "id\t名称"
//   imeswitch cur              打印当前输入源 id
//   imeswitch sel <id>         切到指定 id，成功输出 ok
//   imeswitch cycle <id...>    在这些 id 之间循环（当前不在列表中则取第一个）
//
// 退出码：0 成功，1 失败（参数不对 / 找不到 / 切换失败）

#import <Foundation/Foundation.h>
#import <Carbon/Carbon.h>

static NSString *cfToNS(CFTypeRef cf) {
    if (!cf) return nil;
    if (CFGetTypeID(cf) == CFStringGetTypeID()) {
        return (__bridge NSString *)(CFStringRef)cf;
    }
    return nil;
}

/** 列出所有输入源：@[ @{@"id":..., @"name":..., @"ref": (id)source} ] */
static NSArray *listSources(void) {
    CFArrayRef arr = TISCreateInputSourceList(NULL, false);
    if (!arr) return @[];
    NSMutableArray *out = [NSMutableArray array];
    CFIndex n = CFArrayGetCount(arr);
    for (CFIndex i = 0; i < n; i++) {
        TISInputSourceRef src = (TISInputSourceRef)CFArrayGetValueAtIndex(arr, i);
        NSString *sid = cfToNS(TISGetInputSourceProperty(src, kTISPropertyInputSourceID));
        if (!sid.length) continue;
        NSString *name = cfToNS(TISGetInputSourceProperty(src, kTISPropertyLocalizedName));
        [out addObject:@{
            @"id": sid,
            @"name": name.length ? name : sid,
            @"ref": (__bridge id)src,
        }];
    }
    // 注意：不 CFRelease(arr) —— 里面的 ref 还要用，交给进程退出时回收
    (void)arr;
    return out;
}

static NSString *currentId(void) {
    TISInputSourceRef cur = TISCopyCurrentKeyboardInputSource();
    NSString *sid = cfToNS(TISGetInputSourceProperty(cur, kTISPropertyInputSourceID));
    return sid ?: @"";
}

static TISInputSourceRef findById(NSArray *list, NSString *sid) {
    for (NSDictionary *d in list) {
        if ([[d objectForKey:@"id"] isEqualToString:sid]) {
            return (__bridge TISInputSourceRef)[d objectForKey:@"ref"];
        }
    }
    return NULL;
}

static BOOL selectSource(NSArray *list, NSString *sid) {
    TISInputSourceRef src = findById(list, sid);
    if (!src) return NO;
    OSStatus st = TISSelectInputSource(src);
    return st == 0 || st == noErr;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            fprintf(stderr, "usage: imeswitch list|cur|sel <id>|cycle <id...>\n");
            return 1;
        }
        NSString *cmd = [NSString stringWithUTF8String:argv[1]];

        if ([cmd isEqualToString:@"list"]) {
            for (NSDictionary *d in listSources()) {
                printf("%s\t%s\n", [[d objectForKey:@"id"] UTF8String], [[d objectForKey:@"name"] UTF8String]);
            }
            return 0;
        }

        if ([cmd isEqualToString:@"cur"]) {
            printf("%s\n", [currentId() UTF8String]);
            return 0;
        }

        if ([cmd isEqualToString:@"sel"]) {
            if (argc < 3) { fprintf(stderr, "sel 需要 id\n"); return 1; }
            NSString *sid = [NSString stringWithUTF8String:argv[2]];
            NSArray *list = listSources();
            // 第三方输入法的父级 ID 常不可直接选中（如 com.xxx.inputmethod.wetype），
            // 只有 .pinyin 这种「模式」可选，这里按名字前缀回退一次
            BOOL ok = selectSource(list, sid);
            if (!ok) {
                for (NSDictionary *d in list) {
                    NSString *cand = [d objectForKey:@"id"];
                    if ([cand hasPrefix:[sid stringByAppendingString:@"."]]) {
                        ok = selectSource(list, cand);
                        if (ok) break;
                    }
                }
            }
            if (!ok) { fprintf(stderr, "找不到或无法选中输入源: %s\n", [sid UTF8String]); return 1; }
            printf("ok\n");
            return 0;
        }

        if ([cmd isEqualToString:@"cycle"]) {
            if (argc < 4) { fprintf(stderr, "cycle 至少给两个 id\n"); return 1; }
            NSMutableArray *ids = [NSMutableArray array];
            for (int i = 2; i < argc; i++) [ids addObject:[NSString stringWithUTF8String:argv[i]]];
            NSArray *list = listSources();
            NSString *cur = currentId();
            NSUInteger idx = [ids indexOfObject:cur];
            NSString *next = (idx == NSNotFound || idx + 1 >= ids.count) ? [ids objectAtIndex:0] : [ids objectAtIndex:idx + 1];
            BOOL ok = selectSource(list, next);
            if (!ok) {
                for (NSDictionary *d in list) {
                    NSString *cand = [d objectForKey:@"id"];
                    if ([cand hasPrefix:[next stringByAppendingString:@"."]]) { ok = selectSource(list, cand); if (ok) break; }
                }
            }
            if (!ok) { fprintf(stderr, "切换失败: %s\n", [next UTF8String]); return 1; }
            printf("%s\n", [next UTF8String]);
            return 0;
        }

        fprintf(stderr, "未知命令: %s\n", [cmd UTF8String]);
        return 1;
    }
}
