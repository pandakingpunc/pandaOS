/* Not Defteri — PandaOS text editor (id: notepad).
   A Windows 11 style notepad: slim menu bar (Dosya / Düzen / Görünüm), a full-size textarea editor,
   inline find & replace bar with match highlighting, markdown preview for .md files, an in-window
   "save changes?" sheet, external-change detection and a status bar.
   Everything is rendered into win.body (class .app-notepad); state lives in the closure of launch(). */
(function () {
  'use strict';

  const P = window.PandaOS;
  const U = P.util;
  const h = U.el;

  // ------------------------------------------------------------------ constants
  const APP_NAME = 'Not Defteri';
  const STORE_KEY = 'app.notepad';
  const EXTENSIONS = ['.txt', '.md', '.log', '.json', '.js', '.css', '.html', '.csv'];
  const ZOOM = { min: 30, max: 500, step: 10, def: 100 };
  const BASE_FONT = 14;
  const MAX_MATCHES = 20000;      // find never collects more than this
  const HL_WINDOW = 2500;         // with more matches only this many around the current one are highlighted
  const PREVIEW_MAX = 300000;     // the markdown preview renders at most this many characters
  const BIG_DOC = 2000000;        // characters; opening more asks first
  const MENUS = [['file', 'Dosya'], ['edit', 'Düzen'], ['view', 'Görünüm']];
  const ZWSP = String.fromCharCode(0x200B);   // zero width space: gives the measuring marker a box
  const HAS_WINDOW_EVENT = 'event' in window;   // lets a menu close tell which event closed it
  const DEFAULT_PREFS = { wrap: true, zoom: ZOOM.def, statusBar: true, mono: true, preview: false };

  // ------------------------------------------------------------------ small helpers
  const fmt = (n) => Number(n || 0).toLocaleString('tr-TR');
  const clamp = U.clamp;
  const errText = (e) => (e && e.message ? e.message : String(e));
  const isMdPath = (p) => /\.(md|markdown)$/i.test(p || '');
  /** Editor text is always '\n' separated and BOM free. */
  const nl = (s) => {
    s = String(s == null ? '' : s);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return s.replace(/\r\n?/g, '\n');
  };

  function icon(name) {
    try { return P.icons && typeof P.icons.get === 'function' ? P.icons.get(name) : ''; } catch (e) { return ''; }
  }

  function readPrefs() {
    const out = Object.assign({}, DEFAULT_PREFS);
    let raw = null;
    try { raw = P.storage.get(STORE_KEY, null); } catch (e) { raw = null; }
    if (raw && typeof raw === 'object') {
      ['wrap', 'statusBar', 'mono', 'preview'].forEach((k) => { if (typeof raw[k] === 'boolean') out[k] = raw[k]; });
      const z = Number(raw.zoom);
      if (Number.isFinite(z)) out.zoom = clamp(Math.round(z / ZOOM.step) * ZOOM.step, ZOOM.min, ZOOM.max);
    }
    return out;
  }

  /** Writes one preference without clobbering the others (another Not Defteri window may have changed them). */
  function writePref(key, value) {
    let cur = null;
    try { cur = P.storage.get(STORE_KEY, null); } catch (e) { cur = null; }
    const next = Object.assign({}, cur && typeof cur === 'object' ? cur : {});
    next[key] = value;
    P.storage.set(STORE_KEY, next);
  }

  /** All case-insensitive match offsets of `q` in `text` (Turkish aware: İ/i and I/ı are different letters). */
  function findAll(text, q, caseSensitive, cap) {
    const out = [];
    if (!q) return out;
    let hay = text;
    let needle = q;
    if (!caseSensitive) {
      const a = text.toLocaleLowerCase('tr');
      const b = q.toLocaleLowerCase('tr');
      if (a.length === text.length && b.length === q.length) { hay = a; needle = b; } else {
        const c = text.toLowerCase();
        const d = q.toLowerCase();
        if (c.length === text.length && d.length === q.length) { hay = c; needle = d; }
      }
    }
    const max = cap == null ? MAX_MATCHES : cap;
    let i = 0;
    while (out.length < max) {
      i = hay.indexOf(needle, i);
      if (i === -1) break;
      out.push(i);
      i += needle.length;
    }
    return out;
  }

  // ------------------------------------------------------------------ markdown (simple, safe: DOM nodes only, never innerHTML)
  const MD_ESCAPABLE = '\\`*_{}[]()#+-.!~|<>';
  const URL_RE = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;

  function mdText(parent, str) {
    if (!str) return;
    let last = 0;
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(str))) {
      if (m.index > last) parent.appendChild(document.createTextNode(str.slice(last, m.index)));
      parent.appendChild(h('span', { class: 'np-md-link', text: m[0] }));
      last = m.index + m[0].length;
    }
    if (last < str.length) parent.appendChild(document.createTextNode(str.slice(last)));
  }

  function mdBackticks(src, from, run) {
    const fence = '`'.repeat(run);
    let idx = src.indexOf(fence, from);
    while (idx !== -1) {
      if (src[idx - 1] !== '`' && src[idx + run] !== '`') return idx;
      let end = idx;
      while (src[end] === '`') end++;
      idx = src.indexOf(fence, end);
    }
    return -1;
  }

  /** Index of the closing emphasis run for an opening run of `len` x `ch`, or -1. */
  function mdFindClose(src, from, ch, len) {
    for (let j = from; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === '`') {
        let run = 1;
        while (src[j + run] === '`') run++;
        const close = mdBackticks(src, j + run, run);
        j = close >= 0 ? close + run - 1 : j + run - 1;
        continue;
      }
      if (c === ch) {
        let run = 1;
        while (src[j + run] === ch) run++;
        const prevOk = j > from && !/\s/.test(src[j - 1]);
        const nextOk = ch !== '_' || !/[\p{L}\p{N}]/u.test(src[j + run] || ' ');
        if (run >= len && prevOk && nextOk) return j;
        j += run - 1;
      }
    }
    return -1;
  }

  function mdParseLink(src, i) {
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) break; }
    }
    if (j >= src.length || src[j + 1] !== '(') return null;
    let k = j + 2;
    let pd = 1;
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === '\\') { k++; continue; }
      if (c === '(') pd++;
      else if (c === ')') { pd--; if (pd === 0) break; }
    }
    if (k >= src.length) return null;
    return { text: src.slice(i + 1, j), href: src.slice(j + 2, k).trim().split(/\s+/)[0] || '', end: k + 1 };
  }

  function mdInline(src, parent) {
    if (src.length > 20000) { parent.appendChild(document.createTextNode(src)); return; }   // keeps pathological lines linear
    let buf = '';
    const flush = () => { if (buf) { mdText(parent, buf); buf = ''; } };
    const n = src.length;
    let i = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\\' && i + 1 < n && MD_ESCAPABLE.indexOf(src[i + 1]) >= 0) { buf += src[i + 1]; i += 2; continue; }
      if (c === '\n') {
        if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); flush(); parent.appendChild(document.createElement('br')); } else buf += ' ';
        i++;
        continue;
      }
      if (c === '`') {
        let run = 1;
        while (src[i + run] === '`') run++;
        const close = mdBackticks(src, i + run, run);
        if (close >= 0) {
          flush();
          let inner = src.slice(i + run, close).replace(/\n/g, ' ');
          if (/^ .* $/.test(inner) && inner.trim()) inner = inner.slice(1, -1);
          parent.appendChild(h('code', { text: inner }));
          i = close + run;
        } else { buf += '`'.repeat(run); i += run; }
        continue;
      }
      if (c === '!' && src[i + 1] === '[') {
        const l = mdParseLink(src, i + 1);
        if (l) { flush(); parent.appendChild(h('span', { class: 'np-md-img', text: `[Görsel: ${l.text || l.href}]` })); i = l.end; continue; }
      }
      if (c === '[') {
        const l = mdParseLink(src, i);
        if (l) {
          flush();
          const a = h('span', { class: 'np-md-link' });
          mdInline(l.text, a);
          parent.appendChild(a);
          i = l.end;
          continue;
        }
      }
      if (c === '<') {
        const m = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/.exec(src.slice(i, i + 400));
        if (m) { flush(); parent.appendChild(h('span', { class: 'np-md-link', text: m[1] })); i += m[0].length; continue; }
      }
      if (c === '~' && src[i + 1] === '~') {
        const end = src.indexOf('~~', i + 2);
        if (end > i + 2) {
          flush();
          const d = document.createElement('del');
          mdInline(src.slice(i + 2, end), d);
          parent.appendChild(d);
          i = end + 2;
          continue;
        }
      }
      if (c === '*' || c === '_') {
        let run = 1;
        while (src[i + run] === c) run++;
        const intraword = c === '_' && i > 0 && /[\p{L}\p{N}]/u.test(src[i - 1]);
        if (!intraword && i + run < n && !/\s/.test(src[i + run])) {
          const use = Math.min(run, 3);
          const close = mdFindClose(src, i + run, c, use);
          if (close >= 0) {
            flush();
            if (run > use) buf += c.repeat(run - use);
            flush();
            const inner = src.slice(i + run, close);
            let node = parent;
            if (use >= 2) { node = document.createElement('strong'); parent.appendChild(node); }
            if (use === 1 || use === 3) { const em = document.createElement('em'); node.appendChild(em); node = em; }
            mdInline(inner, node);
            i = close + use;
            continue;
          }
        }
        buf += c.repeat(run);
        i += run;
        continue;
      }
      buf += c;
      i++;
    }
    flush();
  }

  const MD_LIST = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
  const MD_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const MD_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
  const MD_HEAD = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const MD_TSEP = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;

  const mdBlank = (s) => !s.trim();
  const mdIndent = (s) => /^[ \t]*/.exec(s)[0].replace(/\t/g, '    ').length;

  function mdStartsBlock(line) {
    return MD_FENCE.test(line) || MD_HEAD.test(line) || MD_HR.test(line) || /^ {0,3}>/.test(line) || MD_LIST.test(line);
  }

  function mdSplitRow(s) {
    let t = s.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
    return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  }

  function mdList(lines, start, parent) {
    let i = start;
    const first = MD_LIST.exec(lines[i]);
    const base = mdIndent(first[1]);
    const ordered = /\d/.test(first[2]);
    const listEl = document.createElement(ordered ? 'ol' : 'ul');
    if (ordered) {
      const num = parseInt(first[2], 10);
      if (num !== 1) listEl.start = num;
    }
    while (i < lines.length) {
      const line = lines[i].replace(/\t/g, '    ');
      const m = MD_LIST.exec(line);
      if (!m) break;
      const indent = m[1].length;
      if (indent < base || /\d/.test(m[2]) !== ordered) break;
      const markerLen = m[2].length + 1;
      const item = [m[3]];
      i++;
      while (i < lines.length) {
        const raw = lines[i].replace(/\t/g, '    ');
        if (mdBlank(raw)) {
          let j = i + 1;
          while (j < lines.length && mdBlank(lines[j])) j++;
          if (j < lines.length && mdIndent(lines[j]) > base) { item.push(''); i++; continue; }
          break;
        }
        const ind = mdIndent(raw);
        if (ind > base) { item.push(raw.slice(Math.min(ind, base + markerLen))); i++; continue; }
        if (!MD_LIST.test(raw) && !mdStartsBlock(raw) && item[item.length - 1] !== '') { item.push(raw.trim()); i++; continue; }
        break;
      }
      const li = document.createElement('li');
      let content = item;
      const task = /^\[( |x|X)\][ \t]+/.exec(content[0]);
      if (task) {
        content = [content[0].slice(task[0].length)].concat(content.slice(1));
        li.className = 'np-task';
        li.appendChild(h('span', { class: 'np-md-check' + (task[1] !== ' ' ? ' on' : ''), 'aria-hidden': 'true' }));
      }
      const tmp = document.createElement('div');
      mdBlocks(content, tmp);
      if (tmp.firstChild && tmp.firstChild.nodeName === 'P') {
        const p = tmp.firstChild;
        while (p.firstChild) li.appendChild(p.firstChild);
        p.remove();
      }
      while (tmp.firstChild) li.appendChild(tmp.firstChild);
      listEl.appendChild(li);
    }
    parent.appendChild(listEl);
    return i;
  }

  function mdBlocks(lines, parent) {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (mdBlank(line)) { i++; continue; }

      let m = MD_FENCE.exec(line);
      if (m) {
        const fence = m[1];
        const closeRe = new RegExp('^ {0,3}' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}\\s*$');
        const buf = [];
        i++;
        while (i < lines.length && !closeRe.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        const code = h('code', { text: buf.join('\n') });
        if (m[2]) code.dataset.lang = m[2];
        parent.appendChild(h('pre', null, code));
        continue;
      }

      m = MD_HEAD.exec(line);
      if (m) {
        const hd = document.createElement('h' + m[1].length);
        mdInline(m[2], hd);
        parent.appendChild(hd);
        i++;
        continue;
      }

      if (MD_HR.test(line)) { parent.appendChild(document.createElement('hr')); i++; continue; }

      if (/^ {0,3}>/.test(line)) {
        const inner = [];
        while (i < lines.length) {
          const l = lines[i];
          if (/^ {0,3}>/.test(l)) inner.push(l.replace(/^ {0,3}> ?/, ''));
          else if (!mdBlank(l) && !mdStartsBlock(l) && inner.length && inner[inner.length - 1] !== '') inner.push(l);
          else break;
          i++;
        }
        const bq = document.createElement('blockquote');
        mdBlocks(inner, bq);
        parent.appendChild(bq);
        continue;
      }

      if (MD_LIST.test(line)) { i = mdList(lines, i, parent); continue; }

      if (/^(?: {4}|\t)/.test(line)) {
        const buf = [];
        while (i < lines.length && (/^(?: {4}|\t)/.test(lines[i]) || (mdBlank(lines[i]) && i + 1 < lines.length && /^(?: {4}|\t)/.test(lines[i + 1])))) {
          buf.push(lines[i].replace(/^(?: {4}|\t)/, ''));
          i++;
        }
        parent.appendChild(h('pre', null, h('code', { text: buf.join('\n') })));
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && MD_TSEP.test(lines[i + 1]) && lines[i + 1].includes('-') && lines[i + 1].includes('|')) {
        const head = mdSplitRow(line);
        const aligns = mdSplitRow(lines[i + 1]).map((c) => {
          const l = c.startsWith(':');
          const r = c.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
        });
        i += 2;
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const hr = document.createElement('tr');
        head.forEach((c, k) => {
          const th = document.createElement('th');
          if (aligns[k]) th.style.textAlign = aligns[k];
          mdInline(c, th);
          hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        while (i < lines.length && !mdBlank(lines[i]) && lines[i].includes('|')) {
          const tr = document.createElement('tr');
          const cells = mdSplitRow(lines[i]);
          for (let k = 0; k < head.length; k++) {
            const td = document.createElement('td');
            if (aligns[k]) td.style.textAlign = aligns[k];
            mdInline(cells[k] || '', td);
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
          i++;
        }
        table.appendChild(tbody);
        parent.appendChild(h('div', { class: 'np-md-table' }, table));
        continue;
      }

      // paragraph (or setext heading)
      const para = [line.replace(/^\s+/, '')];
      i++;
      let level = 0;
      while (i < lines.length && !mdBlank(lines[i])) {
        const sm = /^ {0,3}(=+|-+)\s*$/.exec(lines[i]);
        if (sm) { level = sm[1][0] === '=' ? 1 : 2; i++; break; }
        if (mdStartsBlock(lines[i])) break;
        para.push(lines[i].replace(/^\s+/, ''));
        i++;
      }
      para[para.length - 1] = para[para.length - 1].replace(/\s+$/, '');
      const node = document.createElement(level ? 'h' + level : 'p');
      mdInline(para.join('\n'), node);
      parent.appendChild(node);
    }
  }

  /** Renders markdown `src` into `container`. Only DOM text nodes are created, so no source text can inject markup. */
  function renderMarkdown(src, container) {
    const frag = document.createDocumentFragment();
    mdBlocks(nl(src).split('\n'), frag);
    container.textContent = '';
    container.appendChild(frag);
  }

  // ------------------------------------------------------------------ the app
  function launch(win, args) {
    args = args || {};
    const fs = P.fs;
    const prefs = readPrefs();
    const fast = !!(P.params && P.params.get('fast') === '1');

    // ---- resource bookkeeping (everything below is released on close)
    const disposers = [];
    const timers = new Set();
    let closed = false;
    const later = (fn, ms) => {
      if (closed) return 0;
      const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.error('[notepad]', e); } }, ms);
      timers.add(id);
      return id;
    };
    const unlater = (id) => { if (id) { clearTimeout(id); timers.delete(id); } };
    const tip = (elm, text) => {
      try {
        if (P.ui && typeof P.ui.tip === 'function') {
          const off = P.ui.tip(elm, text);
          if (typeof off === 'function') disposers.push(off);
        }
      } catch (e) { /* tooltips are cosmetic */ }
    };
    const guard = (fn) => function (...a) {
      try {
        const r = fn.apply(this, a);
        if (r && typeof r.then === 'function') r.then(null, (e) => console.error('[notepad]', e));
        return r;
      } catch (e) {
        console.error('[notepad]', e);
        return undefined;
      }
    };
    const on = (target, evt, fn, opts) => {
      const f = guard(fn);
      target.addEventListener(evt, f, opts);
      disposers.push(() => target.removeEventListener(evt, f, opts));
    };
    const alive = () => !win.isClosed();
    const showAlert = (title, message, kind) => P.dialog.alert({ title, message, icon: kind || 'error' });

    // ---- document state
    const doc = { path: null, hint: '', saved: '', forceDirty: false, pending: false, external: null, eol: '\n' };
    const docName = () => (doc.path ? fs.basename(doc.path) : 'Adsız');
    let lastTitle = '';
    let lastDirty = false;
    let selfWrite = false;

    // ---- find state
    let findOpen = false;
    let replaceOpen = false;
    let caseSensitive = false;
    let matches = [];
    let matchIdx = -1;
    let matchLen = 0;
    let matchesCapped = false;
    let findTimer = 0;
    let countNote = '';

    // ---- misc state
    let lineStarts = [0];
    let linesDirty = true;
    let previewShown = false;
    let previewTimer = 0;
    let flashTimer = 0;
    let sheet = null;
    let current = null;      // open menu bar menu: { name, token }
    let menuSeq = 0;
    let lastClosed = null;   // { name, at } of the menu that closed last
    let menuKeysOn = false;
    let ownCtx = false;      // a context menu opened by this window (editor / zoom label) is showing

    // ================================================================== DOM
    const root = h('div', { class: 'np-root' + (fast ? ' np-fast' : '') });
    win.body.appendChild(root);

    // ---- menu bar
    const menubar = h('div', { class: 'np-menubar', role: 'menubar', 'aria-label': 'Menü' });
    const menuBtns = {};
    MENUS.forEach(([id, label]) => {
      const b = h('button', {
        class: 'np-menu-btn', type: 'button', role: 'menuitem', text: label,
        'aria-haspopup': 'menu', 'aria-expanded': 'false', dataset: { menu: id }
      });
      menuBtns[id] = b;
      menubar.appendChild(b);
    });
    const pathLabel = h('span', { class: 'np-path' });
    const mdBtn = h('button', { class: 'p-btn icon small np-md-toggle', type: 'button', 'aria-label': 'Markdown önizleme', html: icon('eye'), hidden: true });
    menubar.append(h('span', { class: 'np-menubar-gap' }), pathLabel, mdBtn);
    root.appendChild(menubar);

    // ---- notice bar (external changes)
    const notice = h('div', { class: 'np-notice', role: 'status', hidden: true });
    root.appendChild(notice);

    // ---- find / replace bar
    const replaceToggle = h('button', { class: 'p-btn icon small np-find-toggle', type: 'button', 'aria-label': 'Değiştirmeyi aç/kapat', 'aria-expanded': 'false', html: icon('chevron-right') });
    const findInput = h('input', { class: 'p-input small np-find-input', type: 'text', placeholder: 'Bul', 'aria-label': 'Bul' });
    const findCount = h('span', { class: 'np-find-count', 'aria-live': 'polite' });
    const prevBtn = h('button', { class: 'p-btn icon small', type: 'button', 'aria-label': 'Önceki eşleşme', html: icon('chevron-up') });
    const nextBtn = h('button', { class: 'p-btn icon small', type: 'button', 'aria-label': 'Sonraki eşleşme', html: icon('chevron-down') });
    const caseBtn = h('button', { class: 'p-btn icon small np-case', type: 'button', 'aria-label': 'Büyük/küçük harf duyarlı', 'aria-pressed': 'false', text: 'Aa' });
    const findClose = h('button', { class: 'p-btn icon small', type: 'button', 'aria-label': 'Bulmayı kapat', html: icon('close') });
    const replaceInput = h('input', { class: 'p-input small np-replace-input', type: 'text', placeholder: 'Değiştir', 'aria-label': 'Yerine yazılacak metin' });
    const replaceBtn = h('button', { class: 'p-btn small', type: 'button', text: 'Değiştir' });
    const replaceAllBtn = h('button', { class: 'p-btn small', type: 'button', text: 'Tümünü değiştir' });
    const findRow = h('div', { class: 'np-find-row' }, replaceToggle, findInput, findCount, prevBtn, nextBtn, caseBtn, findClose);
    const replaceRow = h('div', { class: 'np-find-row np-replace-row', hidden: true }, h('span', { class: 'np-find-pad' }), replaceInput, replaceBtn, replaceAllBtn);
    [findInput, replaceInput].forEach((i) => {
      i.setAttribute('spellcheck', 'false');
      i.setAttribute('autocomplete', 'off');
    });
    const findBar = h('div', { class: 'np-find', role: 'search', hidden: true }, findRow, replaceRow);

    // ---- editor (+ highlight layer behind it, + hidden measuring layer)
    const editor = h('textarea', { class: 'np-editor', 'aria-label': 'Metin düzenleyici', placeholder: 'Yazmaya başlayın…' });
    editor.spellcheck = false;
    ['autocomplete', 'autocorrect', 'autocapitalize'].forEach((a) => editor.setAttribute(a, 'off'));
    const hl = h('div', { class: 'np-hl', 'aria-hidden': 'true' });
    const measure = h('div', { class: 'np-measure', 'aria-hidden': 'true' });
    const edWrap = h('div', { class: 'np-edwrap' }, hl, measure, editor);
    const editorPane = h('div', { class: 'np-pane' }, findBar, edWrap);
    const preview = h('div', { class: 'np-preview selectable', hidden: true, role: 'document', 'aria-label': 'Markdown önizleme' });
    const main = h('div', { class: 'np-main' }, editorPane, preview);
    root.appendChild(main);

    // ---- status bar
    const stPos = h('span', { class: 'np-st-pos' });
    const stChars = h('span', { class: 'np-st-chars' });
    const stFlash = h('span', { class: 'np-st-flash', 'aria-live': 'polite' });
    const stZoom = h('button', { class: 'np-st-btn np-st-zoom', type: 'button', 'aria-label': 'Yakınlaştırma' });
    const stEnc = h('span', { class: 'np-st-enc', text: 'UTF-8' });
    const status = h('div', { class: 'p-statusbar np-status', role: 'status' },
      stPos, h('span', { class: 'np-st-sep' }), stChars, stFlash, h('span', { class: 'spacer' }),
      stZoom, h('span', { class: 'np-st-sep np-st-sep-enc' }), stEnc);
    root.appendChild(status);

    // tooltips
    tip(replaceToggle, 'Değiştirmeyi aç/kapat');
    tip(prevBtn, 'Önceki eşleşme\nShift+Enter');
    tip(nextBtn, 'Sonraki eşleşme\nEnter');
    tip(caseBtn, 'Büyük/küçük harf duyarlı');
    tip(findClose, 'Kapat\nEsc');
    tip(mdBtn, 'Markdown önizleme');
    tip(stZoom, 'Yakınlaştırma düzeyi');
    tip(pathLabel, () => doc.path || '');

    // ================================================================== document helpers
    const isDirty = () => doc.forceDirty || editor.value !== doc.saved;
    const hasSelection = () => editor.selectionEnd > editor.selectionStart;
    const selectedText = () => editor.value.slice(editor.selectionStart, editor.selectionEnd);
    const caretPos = () => (editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd);
    const defaultDir = () => {
      const d = fs.join(fs.HOME, 'Belgeler');
      return fs.isDir(d) ? d : fs.HOME;
    };
    const dirOfDoc = () => (doc.path && fs.isDir(fs.dirname(doc.path)) ? fs.dirname(doc.path) : defaultDir());
    const displayPath = (p) => (p === fs.HOME || p.startsWith(fs.HOME + '/') ? '~' + p.slice(fs.HOME.length) : p);

    function refreshChrome() {
      const dirty = isDirty();
      lastDirty = dirty;
      const title = (dirty ? '• ' : '') + docName() + ' - ' + APP_NAME;
      if (title !== lastTitle) { lastTitle = title; win.setTitle(title); }
      win.dirty = dirty;
      pathLabel.textContent = doc.path ? displayPath(doc.path) : '';
      pathLabel.hidden = !doc.path;
      mdBtn.hidden = !isMdPath(doc.path);
      mdBtn.classList.toggle('active', prefs.preview);
      mdBtn.setAttribute('aria-pressed', prefs.preview ? 'true' : 'false');
      syncPreviewVisibility();
    }

    function refreshDirty() {
      if (isDirty() !== lastDirty) refreshChrome();
    }

    function setDocument(path, content, opts) {
      opts = opts || {};
      doc.path = path || null;
      doc.hint = opts.hint || '';
      doc.eol = opts.eol === '\r\n' ? '\r\n' : '\n';
      doc.saved = content;
      doc.forceDirty = false;
      doc.pending = false;
      doc.external = null;
      editor.value = content;
      try { editor.setSelectionRange(0, 0); } catch (e) { /* ignore */ }
      editor.scrollTop = 0;
      editor.scrollLeft = 0;
      linesDirty = true;
      hideNotice();
      refreshChrome();
      if (findOpen) recompute({ select: false, from: 0 });
      schedulePreview(true);
      updateStatus();
    }

    // ================================================================== status bar
    function ensureLines() {
      if (!linesDirty) return;
      linesDirty = false;
      const v = editor.value;
      const out = [0];
      let i = -1;
      while ((i = v.indexOf('\n', i + 1)) !== -1) out.push(i + 1);
      lineStarts = out;
    }

    function lineCol(pos) {
      ensureLines();
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
      }
      return { line: lo + 1, col: pos - lineStarts[lo] + 1 };
    }

    function updateStatus() {
      const { line, col } = lineCol(caretPos());
      stPos.textContent = `Satır ${fmt(line)}, Sütun ${fmt(col)}`;
      const total = editor.value.length;
      const sel = editor.selectionEnd - editor.selectionStart;
      stChars.textContent = sel > 0 ? `${fmt(sel)} / ${fmt(total)} karakter` : `${fmt(total)} karakter`;
      stZoom.textContent = `%${prefs.zoom}`;
    }

    function flash(msg) {
      stFlash.textContent = msg;
      stFlash.classList.add('show');
      unlater(flashTimer);
      flashTimer = later(() => { stFlash.classList.remove('show'); stFlash.textContent = ''; }, 2400);
    }

    // ================================================================== layout / prefs
    function applyPrefs() {
      root.classList.toggle('np-nowrap', !prefs.wrap);
      root.classList.toggle('np-mono', prefs.mono);
      editor.wrap = prefs.wrap ? 'soft' : 'off';
      status.hidden = !prefs.statusBar;
      root.style.setProperty('--np-fs', (BASE_FONT * prefs.zoom / 100).toFixed(2) + 'px');
      syncMirrorGeometry();
    }

    function setPref(key, value) {
      prefs[key] = value;
      writePref(key, value);
      applyPrefs();
      if (key === 'zoom') updateStatus();
      if (findOpen) renderHighlights();
    }

    function setZoom(z) {
      z = clamp(Math.round(z / ZOOM.step) * ZOOM.step, ZOOM.min, ZOOM.max);
      if (z !== prefs.zoom) setPref('zoom', z);
      else updateStatus();
    }
    const zoomBy = (dir) => setZoom(prefs.zoom + dir * ZOOM.step);

    function onResize(size) {
      const w = size && size.width ? size.width : win.body.clientWidth;
      main.classList.toggle('np-stack', w < 620);
      root.classList.toggle('np-compact', w < 520);
      root.classList.toggle('np-tiny', w < 430);
      syncMirrorGeometry();
    }

    // ================================================================== mirror layers (highlights + measuring)
    function syncMirrorGeometry() {
      const sbw = Math.max(0, editor.offsetWidth - editor.clientWidth);
      const sbh = Math.max(0, editor.offsetHeight - editor.clientHeight);
      hl.style.right = sbw + 'px';
      hl.style.bottom = sbh + 'px';
      measure.style.right = sbw + 'px';
    }

    function syncScroll() {
      hl.scrollTop = editor.scrollTop;
      hl.scrollLeft = editor.scrollLeft;
    }

    function lineHeightPx() {
      const cs = getComputedStyle(editor);
      const lh = parseFloat(cs.lineHeight);
      return Number.isFinite(lh) && lh > 0 ? lh : (parseFloat(cs.fontSize) || 14) * 1.5;
    }

    /** Pixel position (inside the textarea's scroll area) of the character at `offset`. */
    function caretMetrics(offset) {
      syncMirrorGeometry();
      measure.textContent = '';
      measure.appendChild(document.createTextNode(editor.value.slice(0, offset)));
      const mk = h('span', { text: ZWSP });
      measure.appendChild(mk);
      measure.appendChild(document.createTextNode('x'));
      const m = { top: mk.offsetTop, left: mk.offsetLeft };
      measure.textContent = '';
      return m;
    }

    /** Scrolls the textarea so that `offset` is comfortably inside the viewport. */
    function ensureVisible(offset, center) {
      const m = caretMetrics(offset);
      const lh = lineHeightPx();
      const top = editor.scrollTop;
      const vh = editor.clientHeight;
      if (center || m.top < top - vh || m.top > top + vh * 2) {
        editor.scrollTop = Math.max(0, m.top - vh / 2 + lh / 2);         // far away: centre the line
      } else if (m.top < top + lh) {
        editor.scrollTop = Math.max(0, m.top - lh * 2);                  // just above: nudge it into view
      } else if (m.top + lh * 2 > top + vh) {
        editor.scrollTop = Math.max(0, m.top + lh * 3 - vh);             // just below: nudge it into view
      }
      if (!prefs.wrap) {
        const left = editor.scrollLeft;
        const vw = editor.clientWidth;
        if (m.left < left + 24 || m.left > left + vw - 48) editor.scrollLeft = Math.max(0, m.left - vw / 2);
      }
      syncScroll();
    }

    // ================================================================== editing primitives
    /** Replaces [start, end) with `str` through the browser's editing pipeline so Ctrl+Z keeps working. */
    function replaceRange(start, end, str) {
      if (start === end && !str) return;
      const before = editor.value;
      const expected = before.slice(0, start) + str + before.slice(end);
      const prev = document.activeElement;
      const restore = prev && prev !== editor && prev !== document.body && win.el.contains(prev) && typeof prev.focus === 'function' ? prev : null;
      if (document.activeElement !== editor) editor.focus({ preventScroll: true });
      editor.setSelectionRange(start, end);
      let ok = false;
      try { ok = str === '' ? document.execCommand('delete') : document.execCommand('insertText', false, str); } catch (e) { ok = false; }
      if (!ok || editor.value !== expected) {
        editor.value = expected;
        const caret = start + str.length;
        editor.setSelectionRange(caret, caret);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (restore && restore.isConnected) restore.focus({ preventScroll: true });
    }

    function insertText(str) {
      replaceRange(editor.selectionStart, editor.selectionEnd, str);
      updateStatus();
    }

    const lineStartOf = (pos) => editor.value.lastIndexOf('\n', pos - 1) + 1;
    const lineEndOf = (pos) => {
      const i = editor.value.indexOf('\n', pos);
      return i < 0 ? editor.value.length : i;
    };

    /** Tab / Shift+Tab: insert a tab, or (de)indent the selected lines. */
    function handleTab(shift) {
      const s = editor.selectionStart;
      const e = editor.selectionEnd;
      const v = editor.value;
      const multi = s !== e && v.slice(s, e).includes('\n');
      if (!multi && !shift) { insertText('\t'); return; }
      const from = lineStartOf(s);
      let to = e;
      if (to > from && v[to - 1] === '\n') to--;      // a selection ending at a line start excludes that line
      to = lineEndOf(to);
      const block = v.slice(from, to);
      const lines = block.split('\n');
      const out = lines.map((l) => {
        if (!shift) return '\t' + l;
        if (l.startsWith('\t')) return l.slice(1);
        return l.replace(/^ {1,4}/, '');
      });
      const next = out.join('\n');
      if (next === block) return;
      if (!multi) {
        // Shift+Tab on a single line / caret: keep the caret on the same text
        const removed = block.length - next.length;
        replaceRange(from, to, next);
        const caret = Math.max(from, e - removed);
        editor.setSelectionRange(caret, caret);
      } else {
        replaceRange(from, to, next);
        editor.setSelectionRange(from, from + next.length);
      }
      updateStatus();
    }

    // ================================================================== clipboard commands
    function copyToClipboard(str) {
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (!ok) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(str).catch(() => {});
        } catch (e) { /* clipboard unavailable */ }
      }
    }

    function cmdCopy() {
      editor.focus();
      if (hasSelection()) copyToClipboard(selectedText());
    }

    function cmdCut() {
      editor.focus();
      if (!hasSelection()) return;
      // the native cut copies and deletes in one undoable step; when it is refused do both by hand
      const before = editor.value;
      let ok = false;
      try { ok = document.execCommand('cut'); } catch (e) { ok = false; }
      if (!ok || editor.value === before) {
        copyToClipboard(selectedText());
        replaceRange(editor.selectionStart, editor.selectionEnd, '');
      }
      updateStatus();
    }

    async function cmdPaste() {
      editor.focus();
      let txt = null;
      try { txt = await navigator.clipboard.readText(); } catch (e) { txt = null; }
      if (txt == null) {
        if (typeof P.notify === 'function') P.notify({ title: APP_NAME, message: 'Panoya erişilemedi. Yapıştırmak için Ctrl+V kullanın.', icon: 'info', timeout: 4000 });
        return;
      }
      if (!alive()) return;
      editor.focus();
      insertText(nl(txt));
    }

    function cmdDelete() {
      editor.focus();
      const s = editor.selectionStart;
      const e = editor.selectionEnd;
      if (s !== e) replaceRange(s, e, '');
      else if (s < editor.value.length) replaceRange(s, s + 1, '');
      updateStatus();
    }

    function cmdUndo() {
      editor.focus();
      try { document.execCommand('undo'); } catch (e) { /* nothing to undo */ }
      updateStatus();
    }

    function cmdSelectAll() {
      editor.focus();
      editor.select();
      updateStatus();
    }

    function cmdDateTime() {
      editor.focus();
      const now = Date.now();
      insertText(`${U.formatTime(now)} ${U.formatDate(now, { day: '2-digit', month: '2-digit', year: 'numeric' })}`);
    }

    async function cmdGoto() {
      ensureLines();
      const total = lineStarts.length;
      const cur = lineCol(caretPos()).line;
      const val = await P.dialog.prompt({
        title: 'Satıra git',
        message: `Satır numarası (1 – ${fmt(total)})`,
        value: String(cur),
        okText: 'Git',
        validate: (v) => {
          const t = String(v).trim();
          if (!/^\d+$/.test(t)) return 'Bir satır numarası girin.';
          const n = parseInt(t, 10);
          return n >= 1 && n <= total ? null : `1 ile ${fmt(total)} arasında bir sayı girin.`;
        }
      });
      if (val == null || !alive()) { if (alive()) editor.focus(); return; }
      goToLine(parseInt(String(val).trim(), 10));
    }

    function goToLine(n) {
      ensureLines();
      const line = clamp(n, 1, lineStarts.length);
      const pos = lineStarts[line - 1];
      editor.focus();
      editor.setSelectionRange(pos, pos);
      ensureVisible(pos, false);
      updateStatus();
    }

    // ================================================================== find & replace
    function updateCounter() {
      const q = findInput.value;
      let text = '';
      let none = false;
      if (countNote) text = countNote;
      else if (q) {
        if (matches.length) text = `${fmt(matchIdx + 1)}/${fmt(matches.length)}${matchesCapped ? '+' : ''}`;
        else { text = 'Sonuç yok'; none = true; }
      }
      findCount.textContent = text;
      findInput.classList.toggle('invalid', none);
      findInput.setAttribute('aria-invalid', none ? 'true' : 'false');
      const has = matches.length > 0;
      prevBtn.disabled = !has;
      nextBtn.disabled = !has;
      replaceBtn.disabled = !has;
      replaceAllBtn.disabled = !has;
    }

    function indexAtOrAfter(pos) {
      let lo = 0;
      let hi = matches.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (matches[mid] < pos) lo = mid + 1; else hi = mid;
      }
      return lo >= matches.length ? 0 : lo;
    }

    function indexBefore(pos) {
      let lo = 0;
      let hi = matches.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (matches[mid] < pos) lo = mid + 1; else hi = mid;
      }
      return lo - 1 < 0 ? matches.length - 1 : lo - 1;
    }

    function currentIsSelected() {
      return matchIdx >= 0 && matches[matchIdx] === editor.selectionStart && matches[matchIdx] + matchLen === editor.selectionEnd;
    }

    function selectMatch() {
      if (matchIdx < 0) return;
      const s = matches[matchIdx];
      try { editor.setSelectionRange(s, s + matchLen); } catch (e) { /* ignore */ }
      ensureVisible(s, false);
      updateStatus();
    }

    function renderHighlights() {
      if (!findOpen || !matches.length) {
        if (hl.firstChild) hl.textContent = '';
        return;
      }
      const val = editor.value;
      const frag = document.createDocumentFragment();
      let lo = 0;
      let hi = matches.length;
      if (hi > HL_WINDOW * 2) {
        const c = Math.max(0, matchIdx);
        lo = Math.max(0, c - HL_WINDOW);
        hi = Math.min(matches.length, lo + HL_WINDOW * 2);
        lo = Math.max(0, hi - HL_WINDOW * 2);
      }
      let pos = 0;
      for (let i = lo; i < hi; i++) {
        const s = matches[i];
        if (s < pos) continue;
        if (s > pos) frag.appendChild(document.createTextNode(val.slice(pos, s)));
        const mk = document.createElement('mark');
        if (i === matchIdx) mk.className = 'cur';
        mk.textContent = val.substr(s, matchLen);
        frag.appendChild(mk);
        pos = s + matchLen;
      }
      frag.appendChild(document.createTextNode(val.slice(pos) + '\n' + ZWSP));
      hl.textContent = '';
      hl.appendChild(frag);
      syncMirrorGeometry();
      syncScroll();
    }

    /** Recomputes all matches. opts: { from: offset to pick the current match at/after, select: bool, keep: bool } */
    function recompute(opts) {
      opts = opts || {};
      unlater(findTimer);
      findTimer = 0;
      const q = findInput.value;
      const found = findAll(editor.value, q, caseSensitive, MAX_MATCHES + 1);
      matchesCapped = found.length > MAX_MATCHES;
      matches = matchesCapped ? found.slice(0, MAX_MATCHES) : found;
      matchLen = q.length;
      if (!matches.length) matchIdx = -1;
      else matchIdx = indexAtOrAfter(opts.from != null ? opts.from : editor.selectionStart);
      if (!opts.keepNote) countNote = '';
      updateCounter();
      if (opts.select && matchIdx >= 0) selectMatch();
      renderHighlights();
    }

    function flushFind() {
      if (findTimer) recompute({ select: false });
    }

    function scheduleFind() {
      unlater(findTimer);
      findTimer = later(() => { findTimer = 0; recompute({ select: false }); }, 40);
    }

    function setReplaceMode(on) {
      replaceOpen = !!on;
      replaceRow.hidden = !replaceOpen;
      replaceToggle.setAttribute('aria-expanded', replaceOpen ? 'true' : 'false');
      replaceToggle.innerHTML = icon(replaceOpen ? 'chevron-down' : 'chevron-right');
      syncMirrorGeometry();
    }

    function openFind(withReplace) {
      const wasOpen = findOpen;
      findOpen = true;
      findBar.hidden = false;
      if (withReplace) setReplaceMode(true);
      const sel = selectedText();
      if (sel && !sel.includes('\n') && sel.length <= 200) findInput.value = sel;
      recompute({ select: false, from: editor.selectionStart });
      const target = withReplace && wasOpen && findInput.value && document.activeElement === findInput ? replaceInput : findInput;
      target.focus();
      target.select();
      syncMirrorGeometry();
    }

    function closeFind() {
      if (!findOpen) return;
      findOpen = false;
      findBar.hidden = true;
      unlater(findTimer);
      findTimer = 0;
      hl.textContent = '';
      editor.focus();
      syncMirrorGeometry();
      updateStatus();
    }

    function stepMatch(dir) {
      if (!findOpen) {
        openFind(false);
        if (findInput.value) stepMatch(dir);      // F3 with an earlier query goes straight to the next match
        return;
      }
      flushFind();
      if (!matches.length) {
        recompute({ select: true, from: editor.selectionStart });
        return;
      }
      if (!currentIsSelected()) {
        matchIdx = dir > 0 ? indexAtOrAfter(editor.selectionEnd) : indexBefore(editor.selectionStart);
      } else {
        matchIdx = (matchIdx + dir + matches.length) % matches.length;
      }
      countNote = '';
      selectMatch();
      renderHighlights();
      updateCounter();
    }

    function replaceCurrent() {
      if (!findOpen || !findInput.value) return;
      flushFind();
      if (!matches.length) return;
      if (!currentIsSelected()) { matchIdx = indexAtOrAfter(editor.selectionStart); selectMatch(); renderHighlights(); updateCounter(); return; }
      const start = matches[matchIdx];
      const rep = replaceInput.value;
      replaceRange(start, start + matchLen, rep);
      recompute({ from: start + rep.length, select: true });
    }

    function replaceAll() {
      if (!findOpen || !findInput.value) return;
      unlater(findTimer);
      findTimer = 0;
      const all = findAll(editor.value, findInput.value, caseSensitive, Infinity);
      if (!all.length) { recompute({ select: false }); return; }
      const val = editor.value;
      const rep = replaceInput.value;
      const len = findInput.value.length;
      let out = '';
      let last = 0;
      for (const m of all) { out += val.slice(last, m) + rep; last = m + len; }
      out += val.slice(last);
      const scroll = editor.scrollTop;
      replaceRange(0, val.length, out);
      const caret = all[0] + rep.length;
      editor.setSelectionRange(caret, caret);
      editor.scrollTop = scroll;
      recompute({ select: false, from: caret });
      countNote = `${fmt(all.length)} değişiklik`;
      updateCounter();
      flash(`${fmt(all.length)} değişiklik yapıldı`);
      updateStatus();
    }

    // ================================================================== markdown preview
    function syncPreviewVisibility() {
      const want = prefs.preview && isMdPath(doc.path);
      if (want === previewShown) return;
      previewShown = want;
      preview.hidden = !want;
      main.classList.toggle('np-split', want);
      if (want) renderPreviewNow();
      syncMirrorGeometry();
      later(syncMirrorGeometry, 0);
    }

    function renderPreviewNow() {
      unlater(previewTimer);
      previewTimer = 0;
      if (!previewShown) return;
      try {
        const text = editor.value;
        renderMarkdown(text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text, preview);
        if (text.length > PREVIEW_MAX) preview.appendChild(h('p', { class: 'np-md-img', text: 'Önizleme ilk ' + fmt(PREVIEW_MAX) + ' karakterle sınırlıdır.' }));
        syncPreviewScroll();
      } catch (e) {
        console.error('[notepad] önizleme çizilemedi', e);
      }
    }

    function schedulePreview(immediate) {
      if (!previewShown) return;
      if (immediate) { renderPreviewNow(); return; }
      unlater(previewTimer);
      previewTimer = later(renderPreviewNow, 60);
    }

    function syncPreviewScroll() {
      if (!previewShown) return;
      const eMax = editor.scrollHeight - editor.clientHeight;
      const pMax = preview.scrollHeight - preview.clientHeight;
      preview.scrollTop = eMax > 0 ? (editor.scrollTop / eMax) * Math.max(0, pMax) : 0;
    }

    function togglePreview() {
      setPref('preview', !prefs.preview);
      refreshChrome();
    }

    // ================================================================== notice bar
    function hideNotice() {
      notice.hidden = true;
      notice.textContent = '';
      delete notice.dataset.kind;
    }

    function showNotice(kind, message, actions) {
      notice.textContent = '';
      notice.dataset.kind = kind;
      notice.appendChild(h('span', { class: 'np-notice-icon', html: icon('warning') }));
      notice.appendChild(h('span', { class: 'np-notice-text', text: message }));
      (actions || []).forEach((a) => {
        notice.appendChild(h('button', { class: 'p-btn small', type: 'button', text: a.label, on: { click: guard(a.run) } }));
      });
      const x = h('button', { class: 'p-btn icon small np-notice-x', type: 'button', 'aria-label': 'Kapat', html: icon('close'), on: { click: guard(hideNotice) } });
      notice.appendChild(x);
      notice.hidden = false;
    }

    // ================================================================== files
    function writeTo(path) {
      const content = editor.value;
      let saved;
      selfWrite = true;
      try {
        saved = fs.writeFile(path, doc.eol === '\r\n' ? content.replace(/\n/g, '\r\n') : content);
      } catch (e) {
        selfWrite = false;
        showAlert('Dosya kaydedilemedi', errText(e), 'error');
        return false;
      }
      selfWrite = false;
      doc.path = typeof saved === 'string' ? saved : fs.normalize(path);
      doc.saved = content;
      doc.forceDirty = false;
      doc.pending = false;
      doc.hint = '';
      doc.external = null;
      hideNotice();
      refreshChrome();
      flash('Kaydedildi');
      return true;
    }

    async function cmdSaveAs() {
      const target = await P.dialog.pickFile({
        mode: 'save',
        title: 'Farklı kaydet',
        dir: dirOfDoc(),
        name: doc.path ? fs.basename(doc.path) : (doc.hint || 'Adsız.txt'),
        extensions: EXTENSIONS
      });
      if (!alive()) return false;
      if (!target) { editor.focus(); return false; }
      const ok = writeTo(target);
      editor.focus();
      return ok;
    }

    async function cmdSave() {
      if (doc.path) {
        const ok = writeTo(doc.path);
        editor.focus();
        return ok;
      }
      return cmdSaveAs();
    }

    /** Asks "save changes?" when needed. Resolves true when it is fine to replace/close the document. */
    async function confirmDiscard() {
      if (!isDirty()) return true;
      const choice = await askSheet();
      if (!alive()) return true;
      if (choice === 'cancel') return false;
      if (choice === 'save') return cmdSave();
      return true;
    }

    async function cmdNew() {
      if (!(await confirmDiscard()) || !alive()) return;
      setDocument(null, '');
      editor.focus();
    }

    function cmdNewWindow() {
      P.apps.launch('notepad');
    }

    async function openPath(path) {
      let content;
      try {
        content = fs.readFile(path);
      } catch (e) {
        await showAlert('Dosya açılamadı', errText(e), 'error');
        return false;
      }
      if (typeof content !== 'string') content = String(content == null ? '' : content);
      if (content.length > BIG_DOC) {
        const ok = await P.dialog.confirm({
          title: 'Büyük dosya',
          message: `"${fs.basename(path)}" büyük bir dosya (${U.formatBytes(content.length)}). Açmak uygulamayı yavaşlatabilir. Yine de açılsın mı?`,
          okText: 'Aç'
        });
        if (!ok || !alive()) return false;
      }
      setDocument(path, nl(content), { eol: /\r\n/.test(content) ? '\r\n' : '\n' });
      return true;
    }

    async function cmdOpen() {
      if (!(await confirmDiscard()) || !alive()) return;
      const path = await P.dialog.pickFile({ mode: 'open', title: 'Aç', dir: dirOfDoc(), extensions: EXTENSIONS });
      if (!alive()) return;
      if (!path) { editor.focus(); return; }
      await openPath(path);
      if (alive()) editor.focus();
    }

    /** Dropped files: open them (asks first when there are unsaved changes). */
    async function openDropped(paths, file) {
      if (!(await confirmDiscard()) || !alive()) return;
      if (paths && paths.length) {
        const p = paths.find((x) => fs.isFile(x));
        if (p) await openPath(p);
      } else if (file) {
        let txt = '';
        try { txt = await file.text(); } catch (e) { await showAlert('Dosya açılamadı', errText(e), 'error'); return; }
        if (!alive()) return;
        setDocument(null, '', { hint: file.name || '' });
        editor.value = nl(txt);
        linesDirty = true;
        refreshChrome();
        updateStatus();
      }
      if (alive()) editor.focus();
    }

    function openInitial(path) {
      let p;
      try { p = fs.normalize(path); } catch (e) { p = String(path); }
      if (fs.isFile(p)) { openPath(p); return; }
      if (fs.isDir(p)) { showAlert('Klasör açılamaz', `"${p}" bir klasör.`, 'warning'); return; }
      if (fs.isDir(fs.dirname(p))) {
        // a file that does not exist yet: the document is bound to the path and the file appears on the first save
        doc.path = p;
        doc.pending = true;
        refreshChrome();
        return;
      }
      showAlert('Dosya açılamadı', `"${p}" bulunamadı.`, 'warning');
    }

    // ---- external changes
    function handleGone() {
      const oldName = doc.path ? fs.basename(doc.path) : '';
      doc.path = null;
      doc.hint = oldName;
      doc.forceDirty = true;
      doc.external = null;
      refreshChrome();
      showNotice('gone', `"${oldName}" silindi ya da taşındı. Değişiklikleri korumak için farklı kaydedin.`, [{ label: 'Farklı kaydet…', run: () => { cmdSaveAs(); } }]);
    }

    function reloadFrom(content) {
      const s = editor.selectionStart;
      const e = editor.selectionEnd;
      const top = editor.scrollTop;
      doc.saved = content;
      doc.forceDirty = false;
      doc.external = null;
      editor.value = content;
      linesDirty = true;
      const max = content.length;
      try { editor.setSelectionRange(Math.min(s, max), Math.min(e, max)); } catch (err) { /* ignore */ }
      editor.scrollTop = top;
      hideNotice();
      refreshChrome();
      if (findOpen) recompute({ select: false });
      schedulePreview(true);
      updateStatus();
    }

    function checkExternal() {
      if (!doc.path || doc.pending || selfWrite || !alive()) return;
      let st = null;
      try { st = fs.stat(doc.path); } catch (e) { st = null; }
      if (!st || st.type !== 'file') { handleGone(); return; }
      let content;
      try { content = nl(fs.readFile(doc.path)); } catch (e) { return; }
      if (content === doc.saved) return;
      if (content === editor.value) {              // somebody wrote exactly what is in the editor
        doc.saved = content;
        doc.external = null;
        hideNotice();
        refreshChrome();
        return;
      }
      if (!isDirty()) {
        reloadFrom(content);
        flash('Dosya yenilendi');
      } else if (doc.external !== content || notice.hidden) {
        doc.external = content;
        showNotice('changed', `"${fs.basename(doc.path)}" başka bir yerde değiştirildi. Kaydederseniz bu değişikliklerin üzerine yazılır.`, [
          { label: 'Yeniden yükle', run: () => { reloadFrom(content); } }
        ]);
      }
    }

    /** Can this fs:change touch our file (the file itself, one of its folders, or a wholesale change)? */
    function touchesDoc(ev) {
      if (!doc.path) return false;
      if (!ev || typeof ev !== 'object' || typeof ev.path !== 'string') return true;
      if (ev.type === 'reset' || ev.type === 'external') return true;
      const p = doc.path;
      const hit = (x) => typeof x === 'string' && (x === p || p.startsWith(x.endsWith('/') ? x : x + '/'));
      return hit(ev.path) || hit(ev.oldPath);
    }

    disposers.push(P.bus.on('fs:change', guard((ev) => { if (!selfWrite && touchesDoc(ev)) checkExternal(); })));

    // ================================================================== "save changes?" sheet (in-window, modal)
    function askSheet() {
      if (sheet) return sheet.promise;
      try { if (P.contextMenu && P.contextMenu.isOpen()) P.contextMenu.hide(); } catch (e) { /* ignore */ }
      try { win.focus(); } catch (e) { /* ignore */ }
      const prevFocus = document.activeElement;
      let resolveFn;
      const promise = new Promise((r) => { resolveFn = r; });
      const titleId = U.uid('np-sheet');
      const finish = (val) => {
        if (!sheet) return;
        const s = sheet;
        sheet = null;
        s.el.remove();
        root.inert = false;
        if (alive()) {
          const back = prevFocus && prevFocus.isConnected && win.el.contains(prevFocus) ? prevFocus : editor;
          try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        resolveFn(val);
      };
      const bSave = h('button', { class: 'p-btn primary np-sheet-btn', type: 'button', text: 'Kaydet', dataset: { choice: 'save' }, on: { click: () => finish('save') } });
      const bNo = h('button', { class: 'p-btn np-sheet-btn', type: 'button', text: 'Kaydetme', dataset: { choice: 'discard' }, on: { click: () => finish('discard') } });
      const bCancel = h('button', { class: 'p-btn np-sheet-btn', type: 'button', text: 'İptal', dataset: { choice: 'cancel' }, on: { click: () => finish('cancel') } });
      const buttons = [bSave, bNo, bCancel];
      const card = h('div', { class: 'np-sheet-card', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
        h('div', { class: 'np-sheet-body' },
          h('div', { class: 'np-sheet-icon', html: icon('notepad') }),
          h('div', { class: 'np-sheet-text' },
            h('div', { class: 'np-sheet-title', id: titleId, text: APP_NAME }),
            h('div', { class: 'np-sheet-msg', text: `${docName()} dosyasındaki değişiklikler kaydedilsin mi?` }))),
        h('div', { class: 'np-sheet-foot' }, buttons));
      const el = h('div', { class: 'np-sheet' }, card);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); return; }
        if (e.key === 'Tab') {
          e.preventDefault();
          const i = buttons.indexOf(document.activeElement);
          const next = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i + 1) % buttons.length;
          buttons[next].focus();
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const i = Math.max(0, buttons.indexOf(document.activeElement));
          buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const t = buttons.includes(e.target) ? e.target : bSave;
          t.click();
        }
      });
      el.addEventListener('mousedown', (e) => {
        if (e.target === el) { e.preventDefault(); const f = buttons.includes(document.activeElement) ? document.activeElement : bSave; f.focus(); }
      });
      win.body.appendChild(el);
      root.inert = true;
      sheet = { el, promise, finish, buttons };
      bSave.focus();
      return promise;
    }

    // ================================================================== menus
    function fileMenuItems() {
      return [
        { label: 'Yeni', icon: 'file-plus', action: guard(cmdNew) },
        { label: 'Yeni pencere', icon: 'external', action: guard(cmdNewWindow) },
        { label: 'Aç…', icon: 'open', shortcut: 'Ctrl+O', action: guard(cmdOpen) },
        { label: 'Kaydet', icon: 'save', shortcut: 'Ctrl+S', action: guard(cmdSave) },
        { label: 'Farklı kaydet…', icon: 'download', shortcut: 'Ctrl+Shift+S', action: guard(cmdSaveAs) },
        { type: 'separator' },
        { label: 'Kapat', icon: 'close', action: guard(() => win.close()) }
      ];
    }

    function editMenuItems() {
      const sel = hasSelection();
      return [
        { label: 'Geri al', icon: 'undo', shortcut: 'Ctrl+Z', action: guard(cmdUndo) },
        { type: 'separator' },
        { label: 'Kes', icon: 'cut', shortcut: 'Ctrl+X', disabled: !sel, action: guard(cmdCut) },
        { label: 'Kopyala', icon: 'copy', shortcut: 'Ctrl+C', disabled: !sel, action: guard(cmdCopy) },
        { label: 'Yapıştır', icon: 'paste', shortcut: 'Ctrl+V', action: guard(cmdPaste) },
        { label: 'Sil', icon: 'delete', shortcut: 'Del', disabled: !sel, action: guard(cmdDelete) },
        { type: 'separator' },
        { label: 'Bul…', icon: 'search', shortcut: 'Ctrl+F', action: guard(() => openFind(false)) },
        { label: 'Değiştir…', icon: 'edit', shortcut: 'Ctrl+H', action: guard(() => openFind(true)) },
        { label: 'Git…', icon: 'arrow-right', shortcut: 'Ctrl+G', action: guard(cmdGoto) },
        { type: 'separator' },
        { label: 'Tümünü seç', shortcut: 'Ctrl+A', action: guard(cmdSelectAll) },
        { label: 'Saat/Tarih', icon: 'time', shortcut: 'F5', action: guard(cmdDateTime) }
      ];
    }

    function viewMenuItems() {
      return [
        { label: 'Yakınlaştır', icon: 'zoom-in', shortcut: 'Ctrl++', disabled: prefs.zoom >= ZOOM.max, action: guard(() => { zoomBy(1); editor.focus(); }) },
        { label: 'Uzaklaştır', icon: 'zoom-out', shortcut: 'Ctrl+-', disabled: prefs.zoom <= ZOOM.min, action: guard(() => { zoomBy(-1); editor.focus(); }) },
        { label: 'Varsayılan yakınlaştırma', shortcut: 'Ctrl+0', disabled: prefs.zoom === ZOOM.def, action: guard(() => { setZoom(ZOOM.def); editor.focus(); }) },
        { type: 'separator' },
        { label: 'Sözcük kaydırma', checked: prefs.wrap, action: guard(() => { setPref('wrap', !prefs.wrap); editor.focus(); }) },
        { label: 'Durum çubuğu', checked: prefs.statusBar, action: guard(() => { setPref('statusBar', !prefs.statusBar); editor.focus(); }) },
        { label: 'Eş aralıklı yazı tipi', checked: prefs.mono, action: guard(() => { setPref('mono', !prefs.mono); editor.focus(); }) },
        isMdPath(doc.path) && { type: 'separator' },
        isMdPath(doc.path) && { label: 'Markdown önizleme', checked: prefs.preview, action: guard(() => { togglePreview(); editor.focus(); }) }
      ];
    }

    function editorContextItems() {
      const sel = hasSelection();
      return [
        { label: 'Geri al', icon: 'undo', shortcut: 'Ctrl+Z', action: guard(cmdUndo) },
        { type: 'separator' },
        { label: 'Kes', icon: 'cut', shortcut: 'Ctrl+X', disabled: !sel, action: guard(cmdCut) },
        { label: 'Kopyala', icon: 'copy', shortcut: 'Ctrl+C', disabled: !sel, action: guard(cmdCopy) },
        { label: 'Yapıştır', icon: 'paste', shortcut: 'Ctrl+V', action: guard(cmdPaste) },
        { label: 'Sil', icon: 'delete', shortcut: 'Del', disabled: !sel, action: guard(cmdDelete) },
        { type: 'separator' },
        { label: 'Tümünü seç', shortcut: 'Ctrl+A', action: guard(cmdSelectAll) },
        { type: 'separator' },
        { label: 'Bul…', icon: 'search', shortcut: 'Ctrl+F', action: guard(() => openFind(false)) },
        { label: 'Saat/Tarih', icon: 'time', shortcut: 'F5', action: guard(cmdDateTime) }
      ];
    }

    const MENU_ITEMS = { file: fileMenuItems, edit: editMenuItems, view: viewMenuItems };

    function setOpenClass(name) {
      MENUS.forEach(([id]) => {
        const open = id === name;
        menuBtns[id].classList.toggle('open', open);
        menuBtns[id].setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    function onMenuClosed(token, name) {
      if (!current || current.token !== token) return;
      current = null;
      lastClosed = { name, ev: window.event || null, at: performance.now() };
      setOpenClass(null);
      detachMenuKeys();
    }

    function onMenuKey(e) {
      if (!current) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const ids = MENUS.map((m) => m[0]);
      const i = ids.indexOf(current.name);
      openMenu(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]);
    }

    function attachMenuKeys() {
      if (menuKeysOn) return;
      menuKeysOn = true;
      document.addEventListener('keydown', onMenuKey, true);
    }

    function detachMenuKeys() {
      if (!menuKeysOn) return;
      menuKeysOn = false;
      document.removeEventListener('keydown', onMenuKey, true);
    }
    disposers.push(detachMenuKeys);

    function openMenu(name) {
      if (sheet || !MENU_ITEMS[name]) return;
      const btn = menuBtns[name];
      const token = ++menuSeq;
      current = { name, token };
      setOpenClass(name);
      attachMenuKeys();
      const r = btn.getBoundingClientRect();
      let shown = null;
      try {
        shown = P.contextMenu.show(r.left, r.bottom + 2, MENU_ITEMS[name](), { onClose: () => onMenuClosed(token, name) });
      } finally {
        if (!shown) onMenuClosed(token, name);
      }
    }

    /** Shows a context menu that belongs to this window. */
    function showCtx(x, y, items) {
      const shown = P.contextMenu.show(x, y, items, { onClose: () => { ownCtx = false; } });
      ownCtx = !!shown;                       // after show(): it closes (and reports) any previous menu first
      return shown;
    }

    function closeMenus() {
      if ((current || ownCtx) && P.contextMenu && typeof P.contextMenu.hide === 'function') P.contextMenu.hide();
    }

    Object.keys(menuBtns).forEach((name) => {
      const b = menuBtns[name];
      on(b, 'mousedown', (e) => e.preventDefault());           // the editor keeps the keyboard focus
      on(b, 'pointerdown', (e) => {
        if (e.button !== 0) return;
        // when this very press has just closed the menu (the UI kit closes menus on any outside pointerdown) it stays closed
        const justClosed = !!lastClosed && lastClosed.name === name &&
          (HAS_WINDOW_EVENT ? lastClosed.ev === e : performance.now() - lastClosed.at < 8);   // without window.event: same-tick fallback
        if (justClosed || (current && current.name === name)) return;
        openMenu(name);
      });
      on(b, 'click', (e) => {
        if (e.detail === 0 && !(current && current.name === name)) openMenu(name);   // keyboard activation
      });
      on(b, 'pointerenter', () => {
        if (current && current.name !== name) openMenu(name);
      });
      on(b, 'mouseenter', () => {
        if (current && current.name !== name) openMenu(name);
      });
    });

    on(mdBtn, 'mousedown', (e) => e.preventDefault());
    on(mdBtn, 'click', () => { togglePreview(); editor.focus(); });

    on(stZoom, 'mousedown', (e) => e.preventDefault());
    on(stZoom, 'click', () => {
      const r = stZoom.getBoundingClientRect();
      showCtx(r.left, r.top - 4, [
        { label: 'Yakınlaştır', icon: 'zoom-in', disabled: prefs.zoom >= ZOOM.max, action: guard(() => { zoomBy(1); editor.focus(); }) },
        { label: 'Uzaklaştır', icon: 'zoom-out', disabled: prefs.zoom <= ZOOM.min, action: guard(() => { zoomBy(-1); editor.focus(); }) },
        { label: 'Varsayılan yakınlaştırma', disabled: prefs.zoom === ZOOM.def, action: guard(() => { setZoom(ZOOM.def); editor.focus(); }) }
      ]);
    });

    // ================================================================== editor events
    on(editor, 'input', () => {
      linesDirty = true;
      refreshDirty();
      updateStatus();
      if (findOpen) { countNote = ''; scheduleFind(); }
      schedulePreview(false);
    });

    ['keyup', 'mouseup', 'select', 'focus', 'click'].forEach((evt) => on(editor, evt, updateStatus));
    on(editor, 'keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        handleTab(e.shiftKey);
        return;
      }
      // caret moves on keydown (key repeat) show up in the status bar without waiting for keyup
      later(updateStatus, 0);
    });
    on(editor, 'scroll', () => { syncScroll(); syncPreviewScroll(); }, { passive: true });
    on(editor, 'wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    on(editor, 'contextmenu', (e) => {
      e.preventDefault();
      closeMenus();
      let x = e.clientX;
      let y = e.clientY;
      if (!x && !y) {                       // opened with the keyboard (menu key / Shift+F10): anchor to the editor
        const r = editor.getBoundingClientRect();
        x = r.left + 24;
        y = r.top + 24;
      }
      showCtx(x, y, editorContextItems());
    });
    on(document, 'selectionchange', () => { if (document.activeElement === editor) updateStatus(); });

    // find bar events
    on(findInput, 'input', () => { countNote = ''; recompute({ select: true, from: editor.selectionStart }); });
    on(findInput, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
    });
    on(replaceInput, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
    });
    on(prevBtn, 'click', () => { stepMatch(-1); });
    on(nextBtn, 'click', () => { stepMatch(1); });
    on(findClose, 'click', closeFind);
    on(replaceToggle, 'click', () => { setReplaceMode(!replaceOpen); });
    on(caseBtn, 'click', () => {
      caseSensitive = !caseSensitive;
      caseBtn.classList.toggle('active', caseSensitive);
      caseBtn.setAttribute('aria-pressed', caseSensitive ? 'true' : 'false');
      recompute({ select: true, from: editor.selectionStart });
    });
    on(replaceBtn, 'click', replaceCurrent);
    on(replaceAllBtn, 'click', replaceAll);

    // drag & drop from the file manager / desktop (internal) or from the real computer
    const dropTypes = (e) => {
      const t = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
      return t.includes('application/x-pandaos-paths') || t.includes('Files');
    };
    on(root, 'dragover', (e) => {
      if (!dropTypes(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { /* ignore */ }
      root.classList.add('np-drop');
    });
    on(root, 'dragleave', (e) => {
      if (!e.relatedTarget || !root.contains(e.relatedTarget)) root.classList.remove('np-drop');
    });
    on(root, 'drop', (e) => {
      root.classList.remove('np-drop');
      if (!dropTypes(e)) return;
      e.preventDefault();
      let paths = [];
      try { paths = JSON.parse(e.dataTransfer.getData('application/x-pandaos-paths') || '[]'); } catch (err) { paths = []; }
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (paths.length) openDropped(paths, null);
      else if (file) openDropped(null, file);
    });

    // ================================================================== keyboard shortcuts (only while this window is focused)
    function onWinKey(e) {
      if (sheet || !alive()) return;
      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = typeof key === 'string' ? key.toLowerCase() : '';
      const stop = () => { e.preventDefault(); };
      if (ctrl && !e.altKey) {
        if (k === 's') { stop(); if (e.shiftKey) cmdSaveAs(); else cmdSave(); return; }
        if (k === 'o') { stop(); cmdOpen(); return; }
        if (k === 'f') { stop(); openFind(false); return; }
        if (k === 'h') { stop(); openFind(true); return; }
        if (k === 'g') { stop(); cmdGoto(); return; }
        if (key === '+' || key === '=' || e.code === 'NumpadAdd') { stop(); zoomBy(1); return; }
        if (key === '-' || key === '_' || e.code === 'NumpadSubtract') { stop(); zoomBy(-1); return; }
        if (key === '0' || e.code === 'Numpad0') { stop(); setZoom(ZOOM.def); return; }
        return;
      }
      if (key === 'F3') { stop(); stepMatch(e.shiftKey ? -1 : 1); return; }
      if (key === 'F5') {
        stop();
        if (e.target === editor || e.target === document.body || e.target === win.el) cmdDateTime();
        return;
      }
      if (key === 'F10') { stop(); openMenu('file'); return; }
      if (key === 'Escape' && findOpen) { stop(); closeFind(); }
    }

    // ================================================================== lifecycle
    win.beforeClose = () => {
      if (!isDirty()) return true;
      return confirmDiscard();
    };
    win.dirty = false;

    disposers.push(win.on('keydown', guard(onWinKey)));
    disposers.push(win.on('resize', guard(onResize)));
    disposers.push(win.on('close', () => {
      closed = true;
      closeMenus();
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      disposers.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
      try { if (P.ui && P.ui.tip && typeof P.ui.tip.hide === 'function') P.ui.tip.hide(); } catch (e) { /* ignore */ }
      sheet = null;
    }));

    // handles for the tests (and other apps): nothing here is required for normal use
    win.state.args = args;      // the launch arguments (the integration tests and other apps read them)
    win.state.notepad = {
      editor, doc, prefs,
      isDirty,
      getText: () => editor.value,
      renderMarkdown,
      pendingTimers: () => timers.size,
      menuState: () => ({ open: current && current.name, last: lastClosed && lastClosed.name, ctx: P.contextMenu.isOpen(), keys: menuKeysOn }),
      openPath,
      save: cmdSave,
      find: () => ({ open: findOpen, replace: replaceOpen, matches: matches.slice(), index: matchIdx, caseSensitive })
    };

    applyPrefs();
    onResize({ width: win.body.clientWidth });
    updateCounter();
    setReplaceMode(false);
    stZoom.textContent = `%${prefs.zoom}`;
    refreshChrome();
    updateStatus();

    if (args.path) openInitial(args.path);
    else if (args.text != null) { editor.value = nl(args.text); linesDirty = true; refreshChrome(); updateStatus(); }

    try { editor.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  P.apps.register({
    id: 'notepad',
    name: APP_NAME,
    icon: 'notepad',
    description: 'Metin dosyalarını düzenle',
    category: 'productivity',
    fileTypes: EXTENSIONS.slice(),
    singleInstance: false,
    window: { width: 760, height: 540, minWidth: 380, minHeight: 260 },
    launch
  });
})();
