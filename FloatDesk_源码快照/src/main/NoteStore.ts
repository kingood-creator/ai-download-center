// 便签数据读写，落在 userData/note 下
//
// notes.json        : 主数据 —— 多组标签（每组 {id,title,color,html,text}）+ 当前打开哪一组
// note_history.json : 每组标签各自的历史版本 { pages: { p1: [{time,html,text}], ... } }
// note.html / note.txt : 当前这一组的镜像（纯文本/富文本各一份），
//                        想用别的编辑器打开或全文搜索时看这两个，老版本升级也靠它们兜底
//
// 早期版本只有 note.txt（纯文本），后来是 note.html + 3 版历史；升级到多组标签时
// 会把这些老内容整成「便签 1」，老数据一条都不丢。
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import {
  NoteBook,
  NoteHistoryEntry,
  NoteHistoryMap,
  formatNoteTime,
  noteBookActive,
  normalizeHistoryMap,
  normalizeNoteBook,
  plainTextToHtml,
  pruneHistoryMap,
  pushHistoryEntry,
  sanitizeNoteHtml,
} from '../shared/note';
import { log } from './Logging';

function noteDir(): string {
  const d = path.join(app.getPath('userData'), 'note');
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {
    /* ignore */
  }
  return d;
}

export function noteFilePath(): string {
  return path.join(noteDir(), 'note.txt');
}
export function noteHtmlPath(): string {
  return path.join(noteDir(), 'note.html');
}
export function noteHistoryPath(): string {
  return path.join(noteDir(), 'note_history.json');
}
export function notesFilePath(): string {
  return path.join(noteDir(), 'notes.json');
}

/** 原子写：先写临时文件再 rename，避免写一半崩溃导致内容丢了 */
function writeAtomic(p: string, data: string): boolean {
  try {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, data, 'utf-8');
    fs.renameSync(tmp, p);
    return true;
  } catch (e: any) {
    log('便签写入失败(' + path.basename(p) + '): ' + (e?.message || e));
    return false;
  }
}

function readText(p: string): string {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

/** 纯文本镜像（当前这一组） */
export function loadNoteText(): string {
  return readText(noteFilePath());
}

/**
 * 富文本镜像（当前这一组）。
 * note.html 不存在时（老版本升级上来的情况）用 note.txt 生成一份，保证能无缝接上。
 */
export function loadNoteHtml(): string {
  const html = readText(noteHtmlPath());
  if (html.trim()) return html;
  return plainTextToHtml(loadNoteText());
}

/** 只写镜像文件（不碰 notes.json）：恢复历史、老脚本单页写入时用 */
export function saveNote(html: string, text: string): boolean {
  const h = sanitizeNoteHtml(html);
  const okHtml = writeAtomic(noteHtmlPath(), h);
  // 纯文本镜像写失败不影响主功能，所以不并进返回值
  writeAtomic(noteFilePath(), String(text == null ? '' : text));
  return okHtml;
}

// ---------- 多组标签 ----------

/** 读整本便签；没有 notes.json 时用老的 note.html/note.txt 升成「便签 1」 */
export function loadBook(): NoteBook {
  let raw: any = null;
  const json = readText(notesFilePath());
  if (json.trim()) {
    try {
      raw = JSON.parse(json);
    } catch (e: any) {
      // 文件坏了也别把内容丢掉：留下备份再从镜像文件重建
      log('notes.json 解析失败，改用镜像重建：' + (e?.message || e));
      try {
        fs.copyFileSync(notesFilePath(), notesFilePath() + '.broken');
      } catch {
        /* ignore */
      }
    }
  }
  return normalizeNoteBook(raw, loadNoteHtml(), loadNoteText());
}

/** 写整本便签，并把「当前这一组」同步到 note.html / note.txt 两个镜像文件 */
export function saveBook(book: NoteBook): boolean {
  const b = normalizeNoteBook(book);
  const ok = writeAtomic(notesFilePath(), JSON.stringify(b, null, 2));
  const active = noteBookActive(b);
  if (active) saveNote(active.html, active.text);
  return ok;
}

// ---------- 历史（每组标签各自一份） ----------

export function loadHistoryMap(): NoteHistoryMap {
  const raw = readText(noteHistoryPath());
  if (!raw.trim()) return {};
  try {
    return normalizeHistoryMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveHistoryMap(map: NoteHistoryMap): boolean {
  return writeAtomic(noteHistoryPath(), JSON.stringify({ version: 2, pages: map }, null, 2));
}

/** 某一组标签的历史（最新在前） */
export function pageHistory(pageId: string): NoteHistoryEntry[] {
  const m = loadHistoryMap();
  return m[String(pageId || '')] || [];
}

/** 记一版历史（与最新一版相同则跳过）。返回这一组最新的历史列表。 */
export function pushPageHistory(pageId: string, html: string, text: string): NoteHistoryEntry[] {
  const key = String(pageId || '');
  const map = loadHistoryMap();
  const list = pushHistoryEntry(
    map[key] || [],
    sanitizeNoteHtml(html),
    String(text == null ? '' : text),
    formatNoteTime(new Date())
  );
  map[key] = list;
  saveHistoryMap(map);
  return list;
}

/** 标签被删掉后，顺手把它那一份历史也清了（不然文件只涨不跌） */
export function pruneHistory(book: NoteBook): void {
  const map = loadHistoryMap();
  const kept = pruneHistoryMap(
    map,
    book.pages.map((p) => p.id)
  );
  if (Object.keys(kept).length !== Object.keys(map).length) saveHistoryMap(kept);
}
