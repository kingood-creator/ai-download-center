// 跨场景的「相同项目」匹配：同一个项目（同名 + 同目标 + 同类型）被加进多个场景时，
// 它们本质上是同一个东西。设置页的「同步到全场景」勾选、悬浮窗换图标的同步提示都用它。
// 纯函数，主进程与渲染进程共用（渲染进程 import type 后编译擦除，这里也供单测直接 require）。

export interface SameProjectLike {
  id: string;
  name: string;
  type: string;
  target: string;
}

export interface SceneLike {
  items: SameProjectLike[];
}

/**
 * 找出「与 item 相同、且不是它自己」的所有项目（跨全部场景）。
 * 相同 = 名称相同 + 目标相同 + 类型相同（名称和目标是项目的身份，类型防止
 * 不同语义的项目偶然同名同目标，如两个都叫「README」的网页和文件）。
 * target 为空串时也参与比较（如部分内置动作），此时靠名称+类型兜底。
 * 泛型：调用方传 MenuItem 就回 MenuItem[]，方便直接改图标等字段。
 */
export function sameProjectMatches<T extends SameProjectLike>(scenes: SceneLike[], item: T): T[] {
  if (!item || !Array.isArray(scenes)) return [];
  const name = String(item.name || '').trim();
  const target = String(item.target || '').trim();
  const type = String(item.type || '');
  if (!name) return [];
  const out: T[] = [];
  for (const sc of scenes) {
    for (const x of (sc && sc.items) || []) {
      if (!x || x.id === item.id) continue;
      if (String(x.name || '').trim() !== name) continue;
      if (String(x.target || '').trim() !== target) continue;
      if (String(x.type || '') !== type) continue;
      out.push(x as T);
    }
  }
  return out;
}
