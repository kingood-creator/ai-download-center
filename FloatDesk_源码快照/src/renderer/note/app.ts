// 便签渲染进程：多组彩色标签 + 富文本编辑（加粗/斜体/划线/代码块/列表）+ 自动保存
//                + 每组各自的历史版本（先预览渲染结果，再决定恢复）
// 只通过 preload 暴露的 window.api 与主进程通信（contextIsolation: true）。
//
// 分工：本文件只管「界面 + 正文」；便签的结构（哪几组标签、当前打开哪组）由主进程用
// shared/note.ts 里的纯函数维护 —— 增删标签都走一次 IPC，拿回整理好的整本便签再渲染，
// 免得渲染进程里再抄一份 addNotePage/patchNotePage 的逻辑（抄了迟早会跟主进程跑偏）。
(function () {
  const api: any = (window as any).api;
  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const editor = el('editor');

  let cfg: any = {};
  let book: any = null;
  let pagesMax = 20;
  let saveTimer = 0;
  let flashTimer = 0;
  let decorateTimer = 0;
  let histShown = false;
  let histList: any[] = [];
  let previewIdx = -1;
  let renaming = false;

  function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

  /** 字数：去空白后按字符算 */
  function charCount(t: any): number {
    return String(t == null ? '' : t).replace(/\s+/g, '').length;
  }

  /** 一行摘要 */
  function previewText(t: any, max: number): string {
    const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    if (!s) return '（空）';
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  /** 当前这一组标签 */
  function activePage(): any {
    if (!book || !Array.isArray(book.pages) || !book.pages.length) return null;
    return book.pages.find((p: any) => p.id === book.active) || book.pages[0];
  }

  // ---------- 外观 ----------
  function applyStyle(): void {
    document.documentElement.style.setProperty('--paper', cfg.color || '#fff6c9');
    editor.style.fontSize = (cfg.fontSize || 14) + 'px';
    (el('opacity') as HTMLInputElement).value = String(Math.round((cfg.opacity == null ? 1 : cfg.opacity) * 100));
    (el('fontsize') as HTMLInputElement).value = String(cfg.fontSize || 14);
  }

  async function renderSwatches(): Promise<void> {
    const presets: string[] = (await api.notePresets()) || [];
    const box = el('swatches');
    box.innerHTML = '';
    presets.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (String(cfg.color || '').toLowerCase() === c.toLowerCase() ? ' on' : '');
      b.style.background = c;
      b.title = c;
      b.type = 'button';
      b.addEventListener('click', () => setColor(c));
      box.appendChild(b);
    });
    (el('color-more') as HTMLInputElement).value = cfg.color || '#fff6c9';
  }

  async function setColor(c: string): Promise<void> {
    cfg.color = c;
    applyStyle();
    await renderSwatches();
    const rr = await api.noteConfigSave({ color: c });
    if (rr && rr.config) {
      cfg = rr.config;
      applyStyle();
      await renderSwatches();
    }
  }

  // ---------- 标签栏 ----------

  /** 标签底色上用什么字色才看得清（金/橙这类亮色上用深字，深色上用白字） */
  function tabInk(color: string): string {
    const c = String(color || '#000').replace('#', '');
    const r = parseInt(c.slice(0, 2), 16) || 0;
    const g = parseInt(c.slice(2, 4), 16) || 0;
    const b = parseInt(c.slice(4, 6), 16) || 0;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#2b2418' : '#ffffff';
  }

  function renderTabs(): void {
    if (!book) return;
    const multi = book.pages.length > 1;
    el('tabs').innerHTML = book.pages
      .map((p: any) => {
        const on = p.id === book.active;
        return `<div class="tab${on ? ' on' : ''}" data-tab="${escapeHtml(p.id)}"
            style="--tc:${escapeHtml(p.color || '#ef8f3c')};--tab-ink:${tabInk(p.color)}"
            title="${escapeHtml(p.title)}（双击改名）">
          <span class="tab-dot"></span>
          <span class="tab-name" data-name="${escapeHtml(p.id)}">${escapeHtml(p.title)}</span>
          ${multi ? `<button class="tab-x" data-del="${escapeHtml(p.id)}" type="button" title="删除这一组">×</button>` : ''}
        </div>`;
      })
      .join('');
    // ＋ 号是固定元素（不跟着标签滚走），这里只同步它可不可点
    const add = el('tab-add') as HTMLButtonElement | null;
    if (add) {
      const full = book.pages.length >= pagesMax;
      add.disabled = full;
      add.title = full ? `最多 ${pagesMax} 组标签` : '加一组标签';
    }
    // 当前这组滚进可视区（组多了不手动滚也能看见）
    const onTab = document.querySelector('#tabs .tab.on');
    if (onTab && (onTab as HTMLElement).scrollIntoView) {
      (onTab as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function updateTitle(): void {
    // 头部只写「便签 · N 组」：组名在标签上，这里再写一遍就重复了；
    // 多组时把组数带上，标签栏横向滚动后也能知道总共有几组。
    const n = book && Array.isArray(book.pages) ? book.pages.length : 1;
    el('note-title').textContent = n > 1 ? `便签 · ${n} 组` : '便签';
  }

  /** 把某一组的正文铺进编辑器（切标签 / 恢复历史后用） */
  function loadActiveIntoEditor(): void {
    const a = activePage();
    editor.innerHTML = a ? a.html || '' : '';
    decorateCodeBlocks();
  }

  /**
   * 发给主进程做一次标签操作（add / remove / patch / select），拿回整理好的整本便签。
   * 先把编辑器里的最新正文塞进当前组，免得切走的是一份旧内容。
   */
  async function pageOp(op: string, id?: string, patch?: any): Promise<any> {
    const before = book ? book.active : '';
    const r = await api.notePage({ book: collect(), op, id, patch });
    if (!r || !r.ok || !r.book) return null;
    book = r.book;
    // 只有「当前打开的是哪组」变了才动编辑器，否则会打断光标
    if (book.active !== before) loadActiveIntoEditor();
    renderTabs();
    updateTitle();
    if (histShown) void refreshHistory();
    return r.book;
  }

  async function addPage(): Promise<void> {
    if (book && book.pages.length >= pagesMax) {
      flashTip(`最多 ${pagesMax} 组标签`);
      return;
    }
    await pageOp('add');
    editor.focus();
  }

  async function removePage(id: string): Promise<void> {
    if (!book || book.pages.length <= 1) return;
    const p = book.pages.find((x: any) => x.id === id);
    if (!p) return;
    const body = (id === book.active ? serialize().text : p.text || '').trim();
    if (body && !window.confirm(`删除「${p.title}」？\n这一组的正文和历史版本都会一起删掉。`)) return;
    await pageOp('remove', id);
  }

  async function switchPage(id: string): Promise<void> {
    if (!book || !book.pages.some((p: any) => p.id === id)) return;
    if (id === book.active && !renaming) {
      // 已经在这一组上：不打断编辑，只把焦点还给正文
      return;
    }
    await pageOp('select', id);
  }

  /** 双击标签名 → 就地改成输入框 */
  function beginRename(id: string): void {
    if (renaming) return;
    const tab = document.querySelector(`#tabs [data-tab="${id}"]`);
    const nameEl = tab ? tab.querySelector('[data-name]') : null;
    if (!tab || !nameEl) return;
    renaming = true;
    const old = nameEl.textContent || '';
    const inp = document.createElement('input');
    inp.className = 'tab-rename';
    inp.value = old;
    inp.maxLength = 14;
    nameEl.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = async (commit: boolean): Promise<void> => {
      if (done) return;
      done = true;
      renaming = false;
      const v = inp.value.trim();
      inp.remove();
      if (commit && v && v !== old) await pageOp('patch', id, { title: v });
      else renderTabs();
    };
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
    inp.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        void finish(false);
      }
    });
    inp.addEventListener('blur', () => void finish(true));
  }

  // ---------- 存取 ----------

  /**
   * 序列化：克隆一份再删掉注入的「复制」按钮。
   * 直接读 editor.innerHTML 会把 .code-copy 也存进文件，下次打开就多出一堆死按钮。
   * 纯文本镜像同理：按钮虽然是绝对定位的浮层，但 innerText 仍会把它的文字算进去，
   * 所以取 text 前临时把按钮藏起来（display:none 不参与 innerText），取完立刻恢复。
   */
  function serialize(): { html: string; text: string } {
    const clone = editor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.code-copy').forEach((n) => n.remove());
    const btns = Array.from(editor.querySelectorAll<HTMLElement>('.code-copy'));
    const prev = btns.map((b) => b.style.display);
    btns.forEach((b) => (b.style.display = 'none'));
    const text = (editor as any).innerText || '';
    btns.forEach((b, i) => (b.style.display = prev[i]));
    return { html: clone.innerHTML, text };
  }

  /** 把编辑器里的最新正文写进当前这一组，返回整本便签（可直接发主进程） */
  function collect(): any {
    const p = serialize();
    const a = activePage();
    if (a) {
      // 只有真变了才更新时间戳（别让每次存盘都刷新，历史面板/排序会看不出真实修改时间）
      if (a.html !== p.html || a.text !== p.text) a.updatedAt = Date.now();
      a.html = p.html;
      a.text = p.text;
    }
    return book;
  }

  function flashSaved(): void {
    const s = el('saved');
    s.textContent = '已保存';
    s.classList.add('show');
    if (flashTimer) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => s.classList.remove('show'), 1200);
  }

  /** 左下角临时提示（复用「已保存」那一格，不额外占地方） */
  function flashTip(text: string): void {
    const s = el('saved');
    s.textContent = text;
    s.classList.add('show');
    if (flashTimer) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      s.classList.remove('show');
      s.textContent = '已保存';
    }, 1600);
  }

  async function saveNow(): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
    }
    const b = collect();
    if (!b) return;
    await api.noteSave({ book: b });
    flashSaved();
  }

  function scheduleSave(): void {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      saveNow();
    }, 400);
  }

  // ---------- 代码块的「复制」按钮 ----------

  /**
   * 给每个 <pre> 挂一个「复制」按钮（contenteditable=false，所以不会被当成正文编辑）。
   * 只在还没有按钮时插一次，避免反复打断光标。
   */
  function decorateCodeBlocks(): void {
    editor.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector(':scope > .code-copy')) return;
      const b = document.createElement('button');
      b.className = 'code-copy';
      b.type = 'button';
      b.textContent = '复制';
      b.setAttribute('contenteditable', 'false');
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 取 code 里或者 pre 里的文字，去掉按钮自身文字
        const target = pre.querySelector('code') || pre;
        const text = (target.textContent || '').replace(/复制$/, '');
        await api.noteCopy(text);
        b.textContent = '已复制';
        b.classList.add('done');
        window.setTimeout(() => {
          b.textContent = '复制';
          b.classList.remove('done');
        }, 1200);
      });
      pre.appendChild(b);
    });
  }

  function scheduleDecorate(): void {
    if (decorateTimer) window.clearTimeout(decorateTimer);
    decorateTimer = window.setTimeout(() => {
      decorateTimer = 0;
      decorateCodeBlocks();
    }, 350);
  }

  // ---------- 编辑命令 ----------

  function focusEditor(): void {
    editor.focus();
  }

  function exec(cmd: string, val?: string): void {
    focusEditor();
    try {
      document.execCommand(cmd, false, val);
    } catch {
      /* execCommand 在极少数情况下会抛，忽略即可，不影响已输入内容 */
    }
  }

  /**
   * 在光标处插入节点。
   * 不能用 execCommand('insertHTML', '<pre>…')：Chromium 会按"粘贴清理"处理，
   * 把块级的 <pre> 拍平成带内联样式的 <span>，代码块就没有边框/背景/复制按钮了。
   * 这里直接建节点插进 Range，结构完全可控。
   */
  function insertAtCaret(nodes: Node[]): void {
    focusEditor();
    const sel = window.getSelection();
    let range: Range | null = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    let last: Node = range.startContainer;
    nodes.forEach((n) => {
      (range as Range).insertNode(n);
      last = n;
    });
    if (sel) {
      const after = document.createRange();
      after.selectNodeContents(last);
      after.collapse(false);
      sel.removeAllRanges();
      sel.addRange(after);
    }
  }

  /** 行内代码：把选中文字包进 <code>；没选就插一个占位 */
  function wrapInlineCode(): void {
    const sel = window.getSelection();
    const txt = sel ? sel.toString() : '';
    const code = document.createElement('code');
    code.textContent = txt || '代码';
    insertAtCaret([code, document.createTextNode('\u00a0')]);
    scheduleSave();
    scheduleDecorate();
  }

  /** 代码块：插一个 <pre><code>…</code></pre>，后面留一个空段落好继续写 */
  function insertCodeBlock(): void {
    const sel = window.getSelection();
    const txt = sel ? sel.toString() : '';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = txt || '// 在这里写代码';
    pre.appendChild(code);
    const next = document.createElement('div');
    next.appendChild(document.createElement('br'));
    insertAtCaret([pre, next]);
    scheduleDecorate();
    scheduleSave();
  }

  function clearFormat(): void {
    exec('removeFormat');
    exec('formatBlock', 'p');
    scheduleSave();
    scheduleDecorate();
  }

  // ---------- 历史（先预览，再恢复） ----------

  async function refreshHistory(): Promise<void> {
    const a = activePage();
    if (!a) return;
    histList = (await api.noteHistory(a.id)) || [];
    previewIdx = -1;
    el('hprev').classList.remove('show');
    el('hist-sub').textContent = `「${a.title}」 · 共 ${histList.length} 版`;
    renderHistList();
  }

  function renderHistList(): void {
    const box = el('hist-list');
    if (!histList.length) {
      box.innerHTML =
        '<div class="empty">这一组还没有历史版本<br>（改完停手 5 秒、或收起便签时会各记一版）</div>';
      return;
    }
    box.innerHTML = histList
      .map(
        (h: any, i: number) =>
          `<div class="item${i === previewIdx ? ' on' : ''}" data-v="${i}" title="点一下先预览">
             <div class="meta"><b>版本 ${histList.length - i}</b><span>${escapeHtml(String(h.time || ''))}</span><span>${charCount(h.text)} 字</span></div>
             <div class="prev">${escapeHtml(previewText(h.text, 60))}</div>
           </div>`
      )
      .join('');
    box.querySelectorAll('[data-v]').forEach((it) =>
      it.addEventListener('click', () => showPreview(Number((it as HTMLElement).dataset.v)))
    );
  }

  /** 预览：把这一版渲染后的样子铺在面板上，还没动正文 */
  function showPreview(i: number): void {
    const h = histList[i];
    if (!h) return;
    previewIdx = i;
    el('hprev-title').textContent = `版本 ${histList.length - i} · ${h.time || ''} · ${charCount(h.text)} 字`;
    const html = String(h.html || '').trim();
    el('hprev-body').innerHTML = html || '<div class="empty">（这一版是空的）</div>';
    el('hprev').classList.add('show');
    renderHistList();
  }

  async function restorePreview(): Promise<void> {
    const a = activePage();
    if (!a || previewIdx < 0) return;
    const r = await api.noteRestore(a.id, previewIdx);
    if (!r || !r.ok) {
      flashTip('恢复失败');
      return;
    }
    if (r.book) {
      book = r.book;
      renderTabs();
      updateTitle();
    }
    loadActiveIntoEditor();
    flashSaved();
    closeHistory();
  }

  async function openHistory(): Promise<void> {
    await saveNow();
    await refreshHistory();
    el('hist').classList.add('show');
    histShown = true;
  }

  function closeHistory(): void {
    el('hist').classList.remove('show');
    el('hprev').classList.remove('show');
    histShown = false;
    previewIdx = -1;
  }

  // ---------- 启动 ----------
  (async () => {
    const r = await api.noteLoad();
    cfg = (r && r.config) || {};
    pagesMax = Number(r && r.pagesMax) || 20;
    book = (r && r.book) || null;
    if (!book || !Array.isArray(book.pages) || !book.pages.length) {
      book = { active: 'p1', pages: [{ id: 'p1', title: '便签 1', color: '#ef8f3c', html: '', text: '', updatedAt: 0 }] };
    }
    renderTabs();
    updateTitle();
    loadActiveIntoEditor();
    applyStyle();
    await renderSwatches();

    // 标签栏：点切换 / × 删 / ＋ 加 / 双击改名
    el('tabs').addEventListener('click', (ev: Event) => {
      const t = ev.target as HTMLElement;
      const del = t.closest('[data-del]') as HTMLElement | null;
      if (del) {
        ev.stopPropagation();
        void removePage(String(del.dataset.del));
        return;
      }
      const tab = t.closest('[data-tab]') as HTMLElement | null;
      if (tab) void switchPage(String(tab.dataset.tab));
    });
    el('tabs').addEventListener('dblclick', (ev: Event) => {
      const name = (ev.target as HTMLElement).closest('[data-name]') as HTMLElement | null;
      if (name) beginRename(String(name.dataset.name));
    });
    // ＋ 号在滚动区外面，只绑一次（不跟着标签重绘）
    el('tab-add').addEventListener('click', () => void addPage());

    // 输入（含粘贴）→ 防抖存盘 + 补代码块按钮
    editor.addEventListener('input', () => {
      scheduleSave();
      scheduleDecorate();
    });
    // 粘贴一律降级成纯文本：外部网页的样式会把便签整张纸带歪，也避免夹带脚本
    editor.addEventListener('paste', (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd) return;
      e.preventDefault();
      const text = cd.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    editor.addEventListener('blur', () => {
      if (saveTimer) saveNow();
    });
    // 快捷键：⌘K 代码块、⌘⇧X 划线（⌘B / ⌘I 浏览器原生就管）
    editor.addEventListener('keydown', (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        insertCodeBlock();
      } else if (k === 'x' && e.shiftKey) {
        e.preventDefault();
        exec('strikeThrough');
        scheduleSave();
      }
    });

    // 工具栏：mousedown 阻止默认行为，保住编辑器里的选区
    ['tb-bold', 'tb-italic', 'tb-strike', 'tb-code', 'tb-codeblock', 'tb-ol', 'tb-ul', 'tb-clear'].forEach((id) =>
      el(id).addEventListener('mousedown', (e) => e.preventDefault())
    );

    el('tb-bold').addEventListener('click', () => { exec('bold'); scheduleSave(); });
    el('tb-italic').addEventListener('click', () => { exec('italic'); scheduleSave(); });
    // 划线：标「这件事已经做完了」（Chromium 产出 <strike>，样式在 index.html 里统一补）
    el('tb-strike').addEventListener('click', () => { exec('strikeThrough'); scheduleSave(); });
    el('tb-code').addEventListener('click', () => wrapInlineCode());
    el('tb-codeblock').addEventListener('click', () => insertCodeBlock());
    el('tb-ol').addEventListener('click', () => { exec('insertOrderedList'); scheduleSave(); });
    el('tb-ul').addEventListener('click', () => { exec('insertUnorderedList'); scheduleSave(); });
    el('tb-clear').addEventListener('click', () => clearFormat());

    el('btn-close').addEventListener('click', () => {
      saveNow();
      api.noteClose();
    });
    el('btn-hist').addEventListener('click', () => {
      if (histShown) closeHistory();
      else void openHistory();
    });
    el('hist-close').addEventListener('click', () => closeHistory());
    el('hprev-back').addEventListener('click', () => {
      el('hprev').classList.remove('show');
      previewIdx = -1;
      renderHistList();
    });
    el('hprev-do').addEventListener('click', () => void restorePreview());

    (el('color-more') as HTMLInputElement).addEventListener('input', (e) => setColor((e.target as HTMLInputElement).value));

    const syncOpacity = async (): Promise<void> => {
      const v = Number((el('opacity') as HTMLInputElement).value) / 100;
      cfg.opacity = v;
      const rr = await api.noteConfigSave({ opacity: v });
      if (rr && rr.config) cfg = rr.config;
    };
    el('opacity').addEventListener('change', syncOpacity);

    el('fontsize').addEventListener('input', (e) => {
      cfg.fontSize = Number((e.target as HTMLInputElement).value);
      editor.style.fontSize = cfg.fontSize + 'px';
    });
    el('fontsize').addEventListener('change', async () => {
      const rr = await api.noteConfigSave({ fontSize: cfg.fontSize });
      if (rr && rr.config) { cfg = rr.config; applyStyle(); }
    });

    // 自检钩子（开发脚本用；正常使用不会碰）
    (window as any).FDNote = {
      book: () => book,
      activeId: () => (book ? book.active : ''),
      pages: () => (book && Array.isArray(book.pages) ? book.pages.length : 0),
      html: () => serialize().html,
      save: () => saveNow(),
      add: () => addPage(),
      remove: (id: string) => removePage(id),
      select: (id: string) => switchPage(id),
      openHistory: () => openHistory(),
    };

    editor.focus();
  })();
})();
