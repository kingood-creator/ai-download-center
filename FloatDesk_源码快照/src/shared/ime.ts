// 输入法判定（纯函数，可单测）
// 「中英文切换」要回答两个问题：这一堆输入源里哪个算英文、哪个算中文；
// 以及现在停在其中之一时，该切到另一个。判定规则放在这里，主进程只负责调 TIS。

export interface InputSource {
  id: string;
  name: string;
}

/** 纯键盘布局（没有输入法引擎）算英文：ABC / U.S. / 各种 keylayout */
export function isEnglishSource(s: InputSource): boolean {
  const id = String(s.id || '').toLowerCase();
  const name = String(s.name || '');
  if (/^com\.apple\.keylayout\./.test(id)) return true;
  if (/^(abc|u\.s\.|us|english|英语|美国英语)$/i.test(name.trim())) return true;
  if (/keylayout|keyboardlayout/.test(id)) return true;
  return false;
}

/** 中文输入法：走 inputmethod 引擎且名称含中文/拼音/五笔等 */
export function isChineseSource(s: InputSource): boolean {
  const id = String(s.id || '').toLowerCase();
  const name = String(s.name || '');
  if (!/inputmethod/.test(id)) return false;
  if (/[\u4e00-\u9fa5]/.test(name)) return true;
  if (/pinyin|wubi|shuangpin|zhuyin|cangjie|zh-hans|zh_CN/i.test(id)) return true;
  if (/拼音|五笔|双拼|注音|仓颉|简体|中文/.test(name)) return true;
  return false;
}

/**
 * 自动推断「中文源 / 英文源」这一对。
 * 规则：优先用明确的中文 IME + 明确的英文布局；凑不齐就用剩下的源补位；
 * 实在凑不出就都不指定（此时切换退化为「在全部源里循环」）。
 */
export function pickTogglePair(sources: InputSource[]): { chineseId: string | null; englishId: string | null } {
  const list = (sources || []).filter((s) => s && s.id);
  const english = list.filter(isEnglishSource);
  const chinese = list.filter(isChineseSource);
  const others = list.filter((s) => !isEnglishSource(s) && !isChineseSource(s));

  // 有 IME 但名字不含中文（比如 Pinyin - Simplified）时，按「是不是 IME」兜底
  const pickChinese: InputSource | undefined =
    chinese[0] ||
    list.find((s) => /inputmethod/.test(String(s.id || '').toLowerCase())) ||
    others.find((s) => !/^(com\.apple\.)?(characterpaletteim|pressandhold|dictation|ironwood)/i.test(String(s.id || '')));

  const pickEnglish: InputSource | undefined = english[0] || others[0];

  let chineseId = pickChinese ? pickChinese.id : null;
  let englishId = pickEnglish ? pickEnglish.id : null;
  // 两边不能是同一个，否则切换等于没切
  if (chineseId && englishId && chineseId === englishId) englishId = null;
  return { chineseId, englishId };
}

/**
 * 该切到哪个：当前是英文 → 切中文；否则 → 切英文。
 * 两个都没指定时返回 null（调用方按全部源循环）。
 */
export function toggleTarget(
  currentId: string,
  chineseId: string | null,
  englishId: string | null
): string | null {
  const cur = String(currentId || '');
  if (chineseId && englishId) {
    // 当前不是中文，就切中文；是中文就切英文
    return cur === chineseId ? englishId : chineseId;
  }
  if (chineseId && cur !== chineseId) return chineseId;
  if (englishId && cur !== englishId) return englishId;
  return null;
}

/** 在给定列表里循环：当前不在列表里就取第一个 */
export function cycleTarget(currentId: string, ids: string[]): string | null {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return null;
  const i = list.indexOf(String(currentId || ''));
  return i < 0 || i + 1 >= list.length ? list[0] : list[i + 1];
}
