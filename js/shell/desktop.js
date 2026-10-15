/* PandaOS desktop — wallpaper + icon grid (the Masaüstü folder and the trash).
   Renders into #desktop. Selection, rubber band, drag & drop (HTML5 DnD, so the file manager can exchange
   files with it), inline rename, clipboard, context menus. See docs/API.md §7. */
(function () {
  'use strict';

  const P = (window.PandaOS = window.PandaOS || {});
  const util = P.util;
  const el = util.el;

  const DIR = '/home/panda/Masaüstü';
  const TRASH_KEY = '::trash';
  const PAD = 8;
  const SIZES = {
    small: { icon: 32, w: 84, h: 82 },
    medium: { icon: 48, w: 96, h: 100 },
    large: { icon: 64, w: 112, h: 122 }
  };
  const PREFERRED = ['Dosyalar', 'Terminal', 'Not Defteri', 'Hesap Makinesi', 'Müzik Çalar', 'Mayın Tarlası', '2048',
    'Çizim', 'Görev Yöneticisi', 'Saat', 'Ayarlar'];
  const MIME_PATHS = 'application/x-pandaos-paths';
  const IMPORT_TEXT = ['.txt', '.md', '.json', '.csv', '.log', '.js', '.css', '.html', '.xml'];
  const IMPORT_IMAGE = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
  const IMPORT_MAX = 2 * 1024 * 1024;

  // ------------------------------------------------------------------ state
  let inited = false;
  let root = null;          // #desktop
  let wallEl = null;        // wallpaper layers
  let iconsEl = null;       // icon grid area (above the taskbar)
  let bandEl = null;        // rubber band rectangle
  let snapEl = null;        // drop target cell preview

  let entries = [];         // last entries read from the fs
  let items = [];           // item objects in grid order
  const byKey = new Map();  // key -> item
  let layout = {};          // key -> { col, row }
  const grid = { cols: 1, rows: 1, over: false, cap: 1 }; // over: more entries than visible cells; cap: usable columns (>= cols)
  let sizerEl = null;       // gives the icon area its scroll width when entries overflow the visible columns

  let selected = new Set();
  let anchorKey = null;
  let cursorKey = null;
  let pendingSingle = null; // plain press on an already selected icon: decided on click

  let renaming = null;      // { item, ta, done, committing }
  let drag = null;          // { keys, primary, paths }
  let pendingRefresh = false;
  let firstRender = true;
  let wallValue = null;
  let wallStamp = null;
  let relayoutQueued = false;
  let typeBuf = '';
  let typeTimer = 0;
  let ghostEl = null;
  let pendingRename = null; // { from, to }: lets refresh() carry the same element over to the new name

  // ------------------------------------------------------------------ small helpers
  const fs = () => P.fs;
  const metrics = () => SIZES[sizeName()] || SIZES.medium;
  const cellKey = (c, r) => `${c},${r}`;

  function sizeName() {
    const v = P.settings && P.settings.get('desktop.iconSize');
    return SIZES[v] ? v : 'medium';
  }

  function notifyError(title, message) {
    if (typeof P.notify === 'function') P.notify({ title, message, icon: 'error', timeout: 6000 });
    else console.warn(`[desktop] ${title}: ${message}`);
  }

  function errText(e) {
    return (e && e.message) || String(e);
  }

  function iconMarkup(name) {
    try {
      if (P.icons && typeof P.icons.get === 'function') return P.icons.get(name);
    } catch (e) { /* fall through */ }
    const folder = name === 'folder';
    return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="${folder ? 5 : 9}" y="${folder ? 11 : 5}" width="${folder ? 38 : 30}" height="${folder ? 28 : 38}" rx="5" fill="#8a94a6"/></svg>`;
  }

  function typeLabel(stat) {
    if (!stat) return 'Dosya';
    if (stat.type === 'dir') return 'Klasör';
    const ext = stat.ext || '';
    const map = {
      '.app': 'Uygulama kısayolu', '.txt': 'Metin belgesi', '.md': 'Markdown belgesi', '.json': 'JSON belgesi',
      '.log': 'Günlük dosyası', '.csv': 'CSV belgesi', '.html': 'HTML belgesi', '.css': 'CSS dosyası', '.js': 'JavaScript dosyası',
      '.png': 'PNG resmi', '.jpg': 'JPEG resmi', '.jpeg': 'JPEG resmi', '.gif': 'GIF resmi', '.pmus': 'Müzik dosyası'
    };
    return map[ext] || (ext ? `${ext.slice(1).toUpperCase()} dosyası` : 'Dosya');
  }

  function plural(n) {
    return `${n} öğe`;
  }

  // ------------------------------------------------------------------ wallpaper
  function wallpaperCss(value) {
    try {
      if (P.wallpapers && typeof P.wallpapers.css === 'function') return P.wallpapers.css(value);
    } catch (e) { console.warn('[desktop] duvar kağıdı çözülemedi', e); }
    return '#0b1210';
  }

  function wallpaperStamp(value) {
    const v = String(value || '');
    if (!v.startsWith('vfs:') || !fs()) return '';
    try {
      const st = fs().stat(v.slice(4));
      return st ? `${st.modified}:${st.size}` : 'missing';
    } catch (e) { return 'missing'; }
  }

  function applyWallpaper(animate) {
    if (!wallEl) return;
    const value = P.settings.get('wallpaper');
    const stamp = wallpaperStamp(value);
    if (value === wallValue && stamp === wallStamp) return;
    const first = wallValue === null;
    wallValue = value;
    wallStamp = stamp;
    const tone = P.wallpapers && typeof P.wallpapers.tone === 'function' ? P.wallpapers.tone(value) : 'dark';
    root.dataset.wallTone = tone;
    const bright = !!(P.wallpapers && typeof P.wallpapers.bright === 'function' && P.wallpapers.bright(value));
    if (bright) root.dataset.wallBright = '1'; else delete root.dataset.wallBright;

    const layer = el('div', { class: 'desk-wall' });
    layer.style.background = wallpaperCss(value);
    const old = [...wallEl.children];
    wallEl.appendChild(layer);
    if (first || !animate || old.length === 0) {
      old.forEach((n) => n.remove());
      return;
    }
    layer.classList.add('fade-in');
    setTimeout(() => {
      // another change may have replaced us already; only drop layers below the newest
      const all = [...wallEl.children];
      const idx = all.indexOf(layer);
      if (idx > 0) all.slice(0, idx).forEach((n) => n.remove());
      layer.classList.remove('fade-in');
    }, 760);
  }

  // ------------------------------------------------------------------ fs -> entries
  function readEntries() {
    const out = [];
    const f = fs();
    let count = 0;
    try { count = f && f.trashCount ? f.trashCount() : 0; } catch (e) { count = 0; }
    out.push({
      key: TRASH_KEY, kind: 'trash', name: 'Çöp Kutusu', path: 'trash:', iconName: count ? 'trash-full' : 'trash',
      type: 'Sistem klasörü', modified: 0, count, tip: `Çöp Kutusu\n${count ? plural(count) : 'Boş'}`
    });
    if (!f) return out;
    let list = [];
    try { list = f.exists(DIR) ? f.list(DIR) : []; } catch (e) { list = []; }
    list.forEach((st) => {
      const kind = st.type === 'dir' ? 'dir' : (st.ext === '.app' ? 'app' : 'file');
      let name = st.name;
      let iconName;
      if (kind === 'app') {
        name = f.displayName(st.path);
        let def = null;
        try {
          const target = JSON.parse(f.readFile(st.path));
          def = P.apps && P.apps.get ? P.apps.get(target.appId) : null;
        } catch (e) { def = null; }
        iconName = (def && def.icon) || 'file-app';
      } else {
        try { iconName = P.icons && P.icons.forFile ? P.icons.forFile(st) : (kind === 'dir' ? 'folder' : 'file'); } catch (e) { iconName = kind === 'dir' ? 'folder' : 'file'; }
      }
      const tipLines = [name, typeLabel(st)];
      if (kind === 'file') tipLines.push(`Boyut: ${util.formatBytes(st.size)}`);
      if (kind === 'dir') tipLines.push(st.childCount ? plural(st.childCount) : 'Boş klasör');
      if (st.modified) tipLines.push(`Değiştirilme: ${util.formatDateTime(st.modified)}`);
      out.push({
        key: st.name, kind, name, path: st.path, iconName, type: typeLabel(st), modified: st.modified || 0, tip: tipLines.join('\n')
      });
    });
    return out;
  }

  // ------------------------------------------------------------------ grid / layout
  function measure() {
    const m = metrics();
    const w = (iconsEl && iconsEl.clientWidth) || window.innerWidth;
    // offsetHeight (not clientHeight): the horizontal scrollbar must not change the row count, or toggling it would loop
    const h = (iconsEl && iconsEl.offsetHeight) || Math.max(0, window.innerHeight - 48);
    grid.cols = Math.max(1, Math.floor((w - PAD * 2) / m.w));
    grid.rows = Math.max(1, Math.floor((h - PAD * 2) / m.h));
    // more entries than visible cells: the extra columns stay reachable by scrolling the icon area sideways
    const n = Math.max(entries.length, items.length);
    grid.over = n > grid.cols * grid.rows;
    grid.cap = grid.over ? grid.cols + Math.ceil(n / grid.rows) : grid.cols;
  }

  function saveLayout() {
    P.storage.set('desktop.layout', layout);
  }

  function validCell(c) {
    return c && Number.isInteger(c.col) && Number.isInteger(c.row) && c.col >= 0 && c.row >= 0;
  }

  function inBounds(c) {
    return validCell(c) && c.col < grid.cap && c.row < grid.rows;
  }

  function firstFree(occ) {
    const limit = grid.cols + entries.length + 4;
    for (let c = 0; c < limit; c++) {
      for (let r = 0; r < grid.rows; r++) if (!occ.has(cellKey(c, r))) return { col: c, row: r };
    }
    return { col: limit, row: 0 };
  }

  function nearestFree(cell, occ) {
    const start = { col: util.clamp(cell.col, 0, grid.cap - 1), row: util.clamp(cell.row, 0, grid.rows - 1) };
    if (!occ.has(cellKey(start.col, start.row))) return start;
    let best = null;
    let bestD = Infinity;
    for (let c = 0; c < grid.cap; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (occ.has(cellKey(c, r))) continue;
        const d = (c - start.col) * (c - start.col) * 1.15 + (r - start.row) * (r - start.row);
        if (d < bestD) { bestD = d; best = { col: c, row: r }; }
      }
    }
    return best || firstFree(occ);
  }

  function freshOrder(a, b) {
    if (a.kind === 'trash' || b.kind === 'trash') return a.kind === 'trash' ? -1 : 1;
    const ia = PREFERRED.indexOf(a.name);
    const ib = PREFERRED.indexOf(b.name);
    if (ia >= 0 || ib >= 0) {
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    }
    if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1;
    return util.compareNames(a.name, b.name);
  }

  /** Decide a grid cell for every entry. Persists new/dropped items, never moves stored ones out of place. */
  function place(list) {
    measure();
    const keys = new Set(list.map((e) => e.key));
    let changed = false;
    Object.keys(layout).forEach((k) => {
      if (!keys.has(k)) { delete layout[k]; changed = true; }
    });
    const occ = new Map();
    const pos = new Map();
    const displaced = [];
    const fresh = [];
    list.forEach((e) => {
      const c = layout[e.key];
      if (!validCell(c)) fresh.push(e);
      else if (inBounds(c) && !occ.has(cellKey(c.col, c.row))) {
        occ.set(cellKey(c.col, c.row), e.key);
        pos.set(e.key, { col: c.col, row: c.row });
      } else displaced.push(e);
    });
    displaced.forEach((e) => {
      const t = nearestFree(layout[e.key], occ);
      occ.set(cellKey(t.col, t.row), e.key);
      pos.set(e.key, t);
    });
    fresh.sort(freshOrder).forEach((e) => {
      const t = firstFree(occ);
      occ.set(cellKey(t.col, t.row), e.key);
      pos.set(e.key, t);
      layout[e.key] = { col: t.col, row: t.row };
      changed = true;
    });
    if (changed) saveLayout();
    return pos;
  }

  function cellAt(clientX, clientY) {
    const r = iconsEl.getBoundingClientRect();
    const m = metrics();
    return {
      col: util.clamp(Math.floor((clientX - r.left + iconsEl.scrollLeft - PAD) / m.w), 0, Math.max(0, grid.cap - 1)),
      row: util.clamp(Math.floor((clientY - r.top - PAD) / m.h), 0, Math.max(0, grid.rows - 1))
    };
  }

  function positionItem(it) {
    const m = metrics();
    it.el.style.width = `${m.w}px`;
    it.el.style.height = `${m.h}px`;
    it.el.style.transform = `translate3d(${PAD + it.col * m.w}px, ${PAD + it.row * m.h}px, 0)`;
  }

  function applyMetrics() {
    const m = metrics();
    const name = sizeName();
    root.dataset.iconSize = name;
    root.style.setProperty('--desk-icon', `${m.icon}px`);
    root.style.setProperty('--desk-cw', `${m.w}px`);
    root.style.setProperty('--desk-ch', `${m.h}px`);
  }

  function relayout() {
    if (!inited) return;
    if (renaming && !renaming.committing) return;
    const list = items.map((it) => ({ key: it.key, kind: it.kind, name: it.name }));
    const pos = place(list);
    items.forEach((it) => {
      const p = pos.get(it.key);
      if (p) { it.col = p.col; it.row = p.row; }
      positionItem(it);
    });
    syncScroll();
  }

  /** Icons placed past the last visible column (more entries than fit): make the area scrollable so they stay reachable. */
  function syncScroll() {
    if (!iconsEl) return;
    const m = metrics();
    const maxCol = items.reduce((mx, it) => Math.max(mx, it.col), 0);
    const need = maxCol >= grid.cols;
    iconsEl.classList.toggle('desk-scroll', need);
    if (sizerEl) sizerEl.style.width = need ? `${PAD * 2 + (maxCol + 1) * m.w}px` : '0px';
    if (!need && iconsEl.scrollLeft) iconsEl.scrollLeft = 0;
  }

  /** Scrolls the icon area sideways just enough to show an icon (keyboard navigation can land on a far column). */
  function reveal(key) {
    const it = byKey.get(key);
    if (!it || !iconsEl || !iconsEl.classList.contains('desk-scroll')) return;
    const m = metrics();
    const left = PAD + it.col * m.w;
    const view = iconsEl.clientWidth;
    if (left < iconsEl.scrollLeft) iconsEl.scrollLeft = Math.max(0, left - PAD);
    else if (left + m.w > iconsEl.scrollLeft + view) iconsEl.scrollLeft = left + m.w - view + PAD;
  }

  function queueRelayout() {
    if (relayoutQueued) return;
    relayoutQueued = true;
    const run = () => { relayoutQueued = false; relayout(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  // ------------------------------------------------------------------ item DOM
  function createItem(e) {
    const img = el('div', { class: 'desk-img' });
    const text = el('span', { class: 'desk-label-text' });
    const label = el('div', { class: 'desk-label' }, text);
    const inner = el('div', { class: 'desk-inner', draggable: 'true', role: 'button' }, img, label);
    const cell = el('div', { class: 'desk-icon', dataset: { key: e.key, kind: e.kind } }, inner);
    const it = {
      key: e.key, kind: e.kind, name: '', path: '', iconName: '', el: cell, inner, img, label, text, col: 0, row: 0, modified: 0, type: '', tipText: ''
    };
    // the OS tooltip (same one as the taskbar's) instead of the browser's native title bubble
    it.tipped = !!(P.ui && typeof P.ui.tip === 'function');
    if (it.tipped) P.ui.tip(inner, () => (renaming || drag ? '' : it.tipText));
    return it;
  }

  function updateItem(it, e) {
    it.kind = e.kind;
    it.path = e.path;
    it.modified = e.modified;
    it.type = e.type;
    it.el.dataset.kind = e.kind;
    if (it.name !== e.name) {
      it.name = e.name;
      it.text.textContent = e.name;
      it.inner.setAttribute('aria-label', e.name);
    }
    if (it.iconName !== e.iconName) {
      const swap = !!it.iconName;
      it.iconName = e.iconName;
      it.img.innerHTML = iconMarkup(e.iconName);
      if (swap) {
        it.img.classList.remove('desk-swap');
        void it.img.offsetWidth;
        it.img.classList.add('desk-swap');
      }
    }
    it.tipText = e.tip;
    if (!it.tipped) it.inner.title = e.tip;
  }

  function syncSelection() {
    items.forEach((it) => {
      const on = selected.has(it.key);
      it.el.classList.toggle('selected', on);
      it.el.classList.toggle('cursor', it.key === cursorKey);
      it.inner.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function syncClipboard() {
    const clip = P.clipboard && P.clipboard.get();
    const cut = clip && clip.op === 'cut' ? new Set(clip.paths) : null;
    items.forEach((it) => it.el.classList.toggle('cut', !!(cut && cut.has(it.path))));
  }

  // ------------------------------------------------------------------ refresh
  function refresh() {
    if (!inited) return;
    if ((renaming && !renaming.committing) || drag) { pendingRefresh = true; return; }
    pendingRefresh = false;
    entries = readEntries();
    const pos = place(entries);
    const seen = new Set();
    let order = 0;
    entries.forEach((e) => {
      let it = byKey.get(e.key);
      if (!it && pendingRename && pendingRename.to === e.key && byKey.has(pendingRename.from)) {
        const from = pendingRename.from;
        it = byKey.get(from);
        byKey.delete(from);
        it.key = e.key;
        it.el.dataset.key = e.key;
        byKey.set(e.key, it);
        if (selected.delete(from)) selected.add(e.key);
        if (anchorKey === from) anchorKey = e.key;
        if (cursorKey === from) cursorKey = e.key;
        pendingRename = null;
      }
      const isNew = !it;
      if (isNew) {
        it = createItem(e);
        byKey.set(e.key, it);
        iconsEl.appendChild(it.el);
        if (!firstRender) {
          it.el.classList.add('desk-new');
          setTimeout(() => it.el.classList.remove('desk-new'), 520);
        }
        it.el.classList.add('desk-nt');
        setTimeout(() => it.el.classList.remove('desk-nt'), 80);
      }
      updateItem(it, e);
      const p = pos.get(e.key);
      it.col = p.col;
      it.row = p.row;
      it.el.style.setProperty('--i', String(order++));
      positionItem(it);
      seen.add(e.key);
    });
    [...byKey.keys()].forEach((k) => {
      if (!seen.has(k)) { byKey.get(k).el.remove(); byKey.delete(k); }
    });
    items = entries.map((e) => byKey.get(e.key));
    selected.forEach((k) => { if (!byKey.has(k)) selected.delete(k); });
    if (anchorKey && !byKey.has(anchorKey)) anchorKey = null;
    if (cursorKey && !byKey.has(cursorKey)) cursorKey = null;
    syncSelection();
    syncClipboard();
    syncScroll();
    firstRender = false;
  }

  // ------------------------------------------------------------------ selection
  function selectOnly(key, opts) {
    selected = new Set(key == null ? [] : [key]);
    anchorKey = key;
    cursorKey = key;
    if (!opts || !opts.silent) syncSelection();
  }

  function selectKeys(keys, cursor) {
    selected = new Set(keys.filter((k) => byKey.has(k)));
    cursorKey = cursor != null ? cursor : (keys.length ? keys[keys.length - 1] : null);
    anchorKey = cursorKey;
    syncSelection();
  }

  function clearSelection() {
    selected = new Set();
    anchorKey = null;
    syncSelection();
  }

  function toggle(key) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    anchorKey = key;
    cursorKey = key;
    syncSelection();
  }

  function gridOrder() {
    return items.slice().sort((a, b) => (a.col - b.col) || (a.row - b.row));
  }

  function rangeSelect(key) {
    const order = gridOrder();
    const a = order.findIndex((i) => i.key === (anchorKey || key));
    const b = order.findIndex((i) => i.key === key);
    if (a < 0 || b < 0) { selectOnly(key); return; }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    selected = new Set(order.slice(lo, hi + 1).map((i) => i.key));
    cursorKey = key;
    syncSelection();
  }

  function selectedItems() {
    return items.filter((it) => selected.has(it.key));
  }

  function selectedFiles() {
    return selectedItems().filter((it) => it.kind !== 'trash');
  }

  function focusRoot() {
    if (!root) return;
    if (document.activeElement !== root && !(renaming && renaming.ta === document.activeElement)) {
      try { root.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  // ------------------------------------------------------------------ actions
  function openItem(it) {
    if (!it) return;
    if (it.kind === 'trash') P.apps.launch('files', { path: 'trash:' });
    else P.apps.openFile(it.path);
  }

  function playSound(name) {
    try { if (P.sound && typeof P.sound.play === 'function') P.sound.play(name); } catch (e) { /* ignore */ }
  }

  function trashItems(list) {
    const f = fs();
    if (!f) return 0;
    let n = 0;
    list.filter((it) => it && it.kind !== 'trash').forEach((it) => {
      try { f.trash(it.path); n++; } catch (e) { notifyError('Çöp kutusuna taşınamadı', errText(e)); }
    });
    if (n) playSound('trash');
    return n;
  }

  function deleteForever(list) {
    const f = fs();
    const files = list.filter((it) => it && it.kind !== 'trash');
    if (!f || !files.length) return Promise.resolve(false);
    if (!P.dialog || typeof P.dialog.confirm !== 'function') return Promise.resolve(false);
    const message = files.length === 1
      ? `“${files[0].name}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`
      : `Seçilen ${files.length} öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.`;
    return P.dialog.confirm({ title: 'Kalıcı olarak sil', message, okText: 'Sil', cancelText: 'İptal', danger: true }).then((ok) => {
      if (!ok) return false;
      files.forEach((it) => {
        try { f.remove(it.path, { recursive: true }); } catch (e) { notifyError('Silinemedi', errText(e)); }
      });
      playSound('trash');
      return true;
    });
  }

  function emptyTrash() {
    const f = fs();
    if (!f || !f.trashCount()) return Promise.resolve(false);
    const count = f.trashCount();
    if (!P.dialog || typeof P.dialog.confirm !== 'function') return Promise.resolve(false);
    return P.dialog.confirm({
      title: 'Çöp kutusunu boşalt',
      message: `Çöp kutusundaki ${count} öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      okText: 'Boşalt',
      cancelText: 'İptal',
      danger: true
    }).then((ok) => {
      if (!ok) return false;
      try { f.emptyTrash(); playSound('trash'); } catch (e) { notifyError('Çöp kutusu boşaltılamadı', errText(e)); return false; }
      return true;
    });
  }

  function setClipboard(op) {
    const files = selectedFiles();
    if (!files.length || !P.clipboard) return;
    P.clipboard.set({ op, paths: files.map((it) => it.path) });
  }

  /** Move src into destDir; a taken name falls back to copy (auto-renamed) + remove. Returns the new path. */
  function moveInto(src, destDir) {
    const f = fs();
    if (f.dirname(src) === destDir) return src;
    try {
      return f.move(src, destDir);
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        const np = f.copy(src, destDir);
        f.remove(src, { recursive: true });
        return np;
      }
      throw e;
    }
  }

  /** Give just-created names a position, starting at `cell` (nearest free cells). */
  function placeNames(names, cell) {
    if (!cell || !names.length) return;
    measure();
    const occ = new Map();
    items.forEach((it) => { if (!names.includes(it.key)) occ.set(cellKey(it.col, it.row), it.key); });
    names.forEach((n, i) => {
      if (!byKey.has(n)) return;
      const t = nearestFree({ col: cell.col + Math.floor((i * 1) / Math.max(1, grid.rows)), row: cell.row + (i % Math.max(1, grid.rows)) }, occ);
      occ.set(cellKey(t.col, t.row), n);
      layout[n] = { col: t.col, row: t.row };
    });
    saveLayout();
    relayout();
  }

  function paste(cell) {
    const f = fs();
    const clip = P.clipboard && P.clipboard.get();
    if (!f || !clip) return [];
    const names = [];
    clip.paths.forEach((src) => {
      try {
        if (!f.exists(src)) return;
        const np = clip.op === 'cut' ? moveInto(src, DIR) : f.copy(src, DIR);
        names.push(f.basename(np));
      } catch (e) {
        notifyError('Yapıştırılamadı', errText(e));
      }
    });
    if (clip.op === 'cut') P.clipboard.clear();
    refresh();
    if (cell) placeNames(names, cell);
    selectKeys(names);
    return names;
  }

  function createEntry(kind, cell) {
    const f = fs();
    if (!f) return null;
    try {
      const base = kind === 'dir' ? 'Yeni Klasör' : 'Yeni Metin Belgesi.txt';
      const name = f.uniqueName(DIR, base);
      const path = f.join(DIR, name);
      if (cell) {
        measure();
        const occ = new Map();
        items.forEach((it) => occ.set(cellKey(it.col, it.row), it.key));
        const t = nearestFree(cell, occ);
        layout[name] = { col: t.col, row: t.row };
      }
      if (kind === 'dir') f.mkdir(path);
      else f.writeFile(path, '');
      refresh();
      selectOnly(name);
      startRename(name);
      return name;
    } catch (e) {
      notifyError(kind === 'dir' ? 'Klasör oluşturulamadı' : 'Belge oluşturulamadı', errText(e));
      return null;
    }
  }

  function arrange(mode) {
    const list = items.slice();
    const byName = (a, b) => util.compareNames(a.name, b.name);
    const dirsFirst = (a, b) => ((b.kind === 'dir') - (a.kind === 'dir'));
    const cmp = {
      name: (a, b) => dirsFirst(a, b) || byName(a, b),
      type: (a, b) => dirsFirst(a, b) || util.compareNames(a.type, b.type) || byName(a, b),
      date: (a, b) => (b.modified - a.modified) || byName(a, b)
    }[mode] || byName;
    const trash = list.filter((it) => it.kind === 'trash');
    const rest = list.filter((it) => it.kind !== 'trash').sort(cmp);
    measure();
    layout = {};
    trash.concat(rest).forEach((it, i) => {
      layout[it.key] = { col: Math.floor(i / grid.rows), row: i % grid.rows };
    });
    saveLayout();
    relayout();
  }

  function setIconsVisible(on) {
    P.storage.set('desktop.showIcons', !!on);
    root.classList.toggle('desk-hide-icons', !on);
    if (!on) {
      // invisible icons must not stay selected, in rename mode or reachable by keys
      if (renaming) endRename(true);
      clearSelection();
      cursorKey = null;
      syncSelection();
    }
  }

  function iconsVisible() {
    return P.storage.get('desktop.showIcons', true) !== false;
  }

  /** A Desktop entry renamed from anywhere (inline, Files app, terminal mv...) keeps its cell: layout is keyed by name. */
  function migrateLayout(e) {
    const f = fs();
    if (!f || !e || (e.type !== 'rename' && e.type !== 'move') || !e.oldPath || !e.path) return;
    if (f.dirname(e.oldPath) !== DIR || f.dirname(e.path) !== DIR) return;
    const from = f.basename(e.oldPath);
    const to = f.basename(e.path);
    if (from === to || !validCell(layout[from])) return;
    layout[to] = { col: layout[from].col, row: layout[from].row };
    delete layout[from];
    saveLayout();
  }

  // ------------------------------------------------------------------ inline rename
  function stemEnd(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? i : name.length;
  }

  function startRename(key) {
    const it = typeof key === 'string' ? byKey.get(key) : key;
    if (!it || it.kind === 'trash') return false;
    if (renaming) endRename(true);
    const ta = el('textarea', { class: 'desk-rename', rows: 1, spellcheck: false, autocomplete: 'off', 'aria-label': 'Yeni ad' });
    ta.value = it.name;
    renaming = { item: it, ta, done: false, committing: false };
    it.el.classList.add('renaming');
    it.inner.draggable = false;
    it.inner.appendChild(ta);

    const autosize = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    };
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    });
    ta.addEventListener('keyup', (e) => e.stopPropagation());
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('dblclick', (e) => e.stopPropagation());
    ta.addEventListener('click', (e) => e.stopPropagation());
    ta.addEventListener('blur', () => {
      // a moment of grace so clicking e.g. a toast does not instantly commit twice
      setTimeout(() => { if (renaming && renaming.ta === ta && !renaming.done) commitRename(true); }, 0);
    });
    autosize();
    ta.focus({ preventScroll: true });
    const end = it.kind === 'file' ? stemEnd(it.name) : it.name.length;
    try { ta.setSelectionRange(0, end); } catch (e) { /* ignore */ }
    return true;
  }

  function endRename(silent) {
    const r = renaming;
    if (!r) return;
    renaming = null;
    r.done = true;
    r.item.el.classList.remove('renaming');
    r.item.inner.draggable = true;
    if (r.ta.parentNode) r.ta.remove();
    if (!silent && noWindowFocused()) focusRoot();
    if (pendingRefresh) refresh();
  }

  function cancelRename() {
    endRename(false);
  }

  function commitRename(fromBlur) {
    const r = renaming;
    if (!r || r.done) return false;
    const it = r.item;
    const value = r.ta.value.replace(/[\r\n]+/g, ' ').trim();
    if (!value || value === it.name) { endRename(!!fromBlur); return true; }
    if (value.includes('/')) {
      notifyError('Geçersiz ad', 'Ad “/” karakteri içeremez.');
      if (fromBlur) endRename(true);
      else r.ta.focus();
      return false;
    }
    const f = fs();
    const newName = it.kind === 'app' && !/\.app$/i.test(value) ? `${value}.app` : value;
    const oldKey = it.key;
    const keepSel = selected.has(oldKey) && selected.size === 1;
    r.committing = true;
    pendingRename = { from: oldKey, to: newName };
    try {
      // the icon keeps its cell: fs:change('rename') carries the layout entry over to the new name (migrateLayout).
      // Nothing is written under `newName` before the rename succeeded, so a name clash (EEXIST) cannot touch
      // the other icon's saved cell.
      const np = f.rename(it.path, newName);
      pendingRename = null;
      migrateLayout({ type: 'rename', oldPath: it.path, path: np });
      endRename(!!fromBlur);
      refresh();
      if (keepSel) selectOnly(f.basename(np));
      return true;
    } catch (e) {
      pendingRename = null;
      r.committing = false;
      notifyError('Yeniden adlandırılamadı', errText(e));
      if (fromBlur) endRename(true);
      else { try { r.ta.focus(); r.ta.select(); } catch (_) { /* ignore */ } }
      return false;
    }
  }

  // ------------------------------------------------------------------ rubber band
  function startBand(e) {
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? new Set(selected) : new Set();
    const sx = e.clientX;
    const sy = e.clientY;
    const rr = root.getBoundingClientRect();
    let moved = false;
    try { root.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }

    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const x1 = Math.min(sx, ev.clientX);
      const y1 = Math.min(sy, ev.clientY);
      const x2 = Math.max(sx, ev.clientX);
      const y2 = Math.max(sy, ev.clientY);
      bandEl.hidden = false;
      bandEl.style.transform = `translate(${x1 - rr.left}px, ${y1 - rr.top}px)`;
      bandEl.style.width = `${x2 - x1}px`;
      bandEl.style.height = `${y2 - y1}px`;
      const next = new Set(base);
      items.forEach((it) => {
        const b = it.inner.getBoundingClientRect();
        if (b.right >= x1 && b.left <= x2 && b.bottom >= y1 && b.top <= y2) next.add(it.key);
      });
      selected = next;
      cursorKey = null;
      syncSelection();
    };
    const finish = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onUp);
      bandEl.hidden = true;
    };
    const onUp = () => {
      finish();
      if (!moved && !additive) clearSelection();
      else if (selected.size) { anchorKey = [...selected][0]; cursorKey = [...selected][selected.size - 1]; syncSelection(); }
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onUp);
  }

  // ------------------------------------------------------------------ pointer & mouse events
  function itemFromEvent(e) {
    const t = e.target;
    const cell = t && t.closest ? t.closest('.desk-icon') : null;
    return cell ? byKey.get(cell.dataset.key) || null : null;
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.target.closest && e.target.closest('.desk-rename')) return;
    const it = itemFromEvent(e);
    if (renaming) {
      const ta = renaming.ta;
      // commit the pending rename before anything else reacts to this press
      if (document.activeElement === ta) { try { ta.blur(); } catch (_) { /* ignore */ } }
    }
    focusRoot();
    root.classList.remove('desk-kbd');
    pendingSingle = null;
    try { if (P.wm && typeof P.wm.blurAll === 'function') P.wm.blurAll(); } catch (err) { /* optional wm feature */ }
    if (!it) {
      if (e.button === 0) startBand(e);
      return;
    }
    if (e.button === 2) {
      if (!selected.has(it.key)) selectOnly(it.key);
      return;
    }
    if (e.ctrlKey || e.metaKey) toggle(it.key);
    else if (e.shiftKey) rangeSelect(it.key);
    else if (selected.has(it.key)) { pendingSingle = it.key; cursorKey = it.key; syncSelection(); }
    else selectOnly(it.key);
  }

  function onClick(e) {
    const it = itemFromEvent(e);
    if (pendingSingle && it && it.key === pendingSingle && !e.ctrlKey && !e.shiftKey && !e.metaKey) selectOnly(it.key);
    pendingSingle = null;
  }

  function onDblClick(e) {
    if (e.target.closest && e.target.closest('.desk-rename')) return;
    const it = itemFromEvent(e);
    if (it) { selectOnly(it.key); openItem(it); }
  }

  function onContextMenu(e) {
    if (e.target.closest && e.target.closest('.desk-rename')) return;
    e.preventDefault();
    const it = itemFromEvent(e);
    if (it) {
      if (!selected.has(it.key)) selectOnly(it.key);
      showItemMenu(e.clientX, e.clientY);
    } else {
      clearSelection();
      showBackgroundMenu(e.clientX, e.clientY);
    }
  }

  // ------------------------------------------------------------------ context menus
  function showMenu(x, y, menu) {
    if (!P.contextMenu || typeof P.contextMenu.show !== 'function') return;
    P.contextMenu.show(x, y, menu);
  }

  function launch(id, args) {
    if (P.apps && typeof P.apps.launch === 'function') P.apps.launch(id, args);
  }

  function showBackgroundMenu(x, y) {
    const size = sizeName();
    const clip = P.clipboard && P.clipboard.get();
    const cell = cellAt(x, y);
    showMenu(x, y, [
      {
        label: 'Görünüm',
        icon: 'grid',
        submenu: [
          { label: 'Küçük simgeler', checked: size === 'small', action: () => P.settings.set('desktop.iconSize', 'small') },
          { label: 'Orta simgeler', checked: size === 'medium', action: () => P.settings.set('desktop.iconSize', 'medium') },
          { label: 'Büyük simgeler', checked: size === 'large', action: () => P.settings.set('desktop.iconSize', 'large') },
          { type: 'separator' },
          { label: 'Masaüstü simgelerini göster', checked: iconsVisible(), action: () => setIconsVisible(!iconsVisible()) }
        ]
      },
      {
        label: 'Sırala',
        icon: 'sort',
        submenu: [
          { label: 'Ada göre', action: () => arrange('name') },
          { label: 'Türe göre', action: () => arrange('type') },
          { label: 'Değiştirilme tarihine göre', action: () => arrange('date') }
        ]
      },
      { label: 'Yenile', icon: 'refresh', shortcut: 'F5', action: () => refresh() },
      { type: 'separator' },
      { label: 'Yapıştır', icon: 'paste', shortcut: 'Ctrl+V', disabled: !clip, action: () => paste(cell) },
      {
        label: 'Yeni',
        icon: 'plus',
        submenu: [
          { label: 'Klasör', icon: 'folder-plus', action: () => createEntry('dir', cell) },
          { label: 'Metin Belgesi', icon: 'file-plus', action: () => createEntry('file', cell) }
        ]
      },
      { type: 'separator' },
      { label: 'Terminalde aç', icon: 'terminal-glyph', action: () => launch('terminal', { cwd: DIR }) },
      { label: 'Duvar kağıdını değiştir', icon: 'image', action: () => launch('settings', { page: 'wallpaper' }) },
      { label: 'Kişiselleştir', icon: 'palette', action: () => launch('settings', { page: 'appearance' }) }
    ]);
  }

  function showItemMenu(x, y) {
    const sel = selectedItems();
    const files = sel.filter((it) => it.kind !== 'trash');
    if (sel.length === 1 && sel[0].kind === 'trash') {
      const empty = !(fs() && fs().trashCount());
      showMenu(x, y, [
        { label: 'Aç', icon: 'open', shortcut: 'Enter', action: () => openItem(sel[0]) },
        { type: 'separator' },
        { label: 'Çöp kutusunu boşalt', icon: 'delete', disabled: empty, action: () => emptyTrash() }
      ]);
      return;
    }
    const single = files.length === 1 && sel.length === 1;
    showMenu(x, y, [
      { label: 'Aç', icon: 'open', shortcut: 'Enter', action: () => sel.forEach(openItem) },
      { type: 'separator' },
      { label: 'Kes', icon: 'cut', shortcut: 'Ctrl+X', disabled: !files.length, action: () => setClipboard('cut') },
      { label: 'Kopyala', icon: 'copy', shortcut: 'Ctrl+C', disabled: !files.length, action: () => setClipboard('copy') },
      { type: 'separator' },
      { label: 'Yeniden adlandır', icon: 'edit', shortcut: 'F2', disabled: !single, action: () => startRename(files[0]) },
      { label: 'Çöp kutusuna taşı', icon: 'delete', shortcut: 'Del', disabled: !files.length, action: () => trashItems(files) },
      { type: 'separator' },
      {
        label: 'Özellikler',
        icon: 'info-glyph',
        shortcut: 'Alt+Enter',
        disabled: !single,
        action: () => { if (P.dialog && P.dialog.properties) P.dialog.properties(files[0].path); }
      }
    ]);
  }

  // ------------------------------------------------------------------ keyboard
  function moveCursor(dir, extend) {
    const order = gridOrder();
    if (!order.length) return;
    const cur = byKey.get(cursorKey) || byKey.get(anchorKey) || null;
    if (!cur) {
      selectOnly(order[0].key);
      return;
    }
    let best = null;
    let bestScore = Infinity;
    items.forEach((it) => {
      if (it === cur) return;
      const dc = it.col - cur.col;
      const dr = it.row - cur.row;
      let main;
      let side;
      if (dir === 'right') { if (dc <= 0) return; main = dc; side = Math.abs(dr); }
      else if (dir === 'left') { if (dc >= 0) return; main = -dc; side = Math.abs(dr); }
      else if (dir === 'down') { if (dr <= 0) return; main = dr; side = Math.abs(dc); }
      else { if (dr >= 0) return; main = -dr; side = Math.abs(dc); }
      const score = main * 100 + side;
      if (score < bestScore) { bestScore = score; best = it; }
    });
    if (!best) {
      // wrap vertically through the column order like a file list would
      const idx = order.indexOf(cur);
      if (dir === 'down' && idx < order.length - 1) best = order[idx + 1];
      else if (dir === 'up' && idx > 0) best = order[idx - 1];
    }
    if (!best) return;
    if (extend) {
      if (!anchorKey) anchorKey = cur.key;
      rangeSelect(best.key);
    } else selectOnly(best.key);
    reveal(best.key);
  }

  function typeAhead(ch) {
    typeBuf += ch.toLocaleLowerCase('tr');
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => { typeBuf = ''; }, 800);
    const order = gridOrder();
    const hit = order.find((it) => it.name.toLocaleLowerCase('tr').startsWith(typeBuf));
    if (hit) { selectOnly(hit.key); reveal(hit.key); }
  }

  function noWindowFocused() {
    const w = P.wm && typeof P.wm.getFocused === 'function' ? P.wm.getFocused() : null;
    return !w || (w.isMinimized && w.isMinimized());
  }

  function iconsHiddenNow() {
    return !!root && root.classList.contains('desk-hide-icons');
  }

  function onKeyDown(e) {
    if (!inited || e.defaultPrevented) return;
    if (P.session && P.session.isLocked && P.session.isLocked()) return;
    if (P.dialog && P.dialog.isOpen && P.dialog.isOpen()) return;
    if (P.contextMenu && P.contextMenu.isOpen && P.contextMenu.isOpen()) return;
    if (P.startMenu && P.startMenu.isOpen && P.startMenu.isOpen()) return;
    if (iconsHiddenNow()) return; // icons switched off: nothing visible to select, open or delete
    const t = e.target;
    const inDesk = root.contains(t);
    const onBody = t === document.body || t === document.documentElement;
    if (!inDesk && !(onBody && noWindowFocused())) return;
    if (renaming) return;
    if (inDesk && util.isEditable(t)) return;

    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    root.classList.add('desk-kbd');
    let handled = true;

    if (ctrl && !e.altKey && (key === 'a' || key === 'A')) {
      selected = new Set(items.map((it) => it.key));
      syncSelection();
    } else if (ctrl && !e.altKey && (key === 'c' || key === 'C')) setClipboard('copy');
    else if (ctrl && !e.altKey && (key === 'x' || key === 'X')) setClipboard('cut');
    else if (ctrl && !e.altKey && (key === 'v' || key === 'V')) paste();
    else if (key === 'Delete') {
      const files = selectedFiles();
      if (files.length) {
        if (e.shiftKey) deleteForever(files);
        else trashItems(files);
      }
    } else if (key === 'F2') {
      const files = selectedFiles();
      if (files.length === 1 && selected.size === 1) startRename(files[0]);
    } else if (key === 'F5') refresh();
    else if (key === 'Enter' && e.altKey) {
      const files = selectedFiles();
      if (files.length === 1 && P.dialog && P.dialog.properties) P.dialog.properties(files[0].path);
    } else if (key === 'Enter') selectedItems().forEach(openItem);
    else if (key === 'Escape') clearSelection();
    else if (key === 'ArrowRight') moveCursor('right', e.shiftKey);
    else if (key === 'ArrowLeft') moveCursor('left', e.shiftKey);
    else if (key === 'ArrowDown') moveCursor('down', e.shiftKey);
    else if (key === 'ArrowUp') moveCursor('up', e.shiftKey);
    else if (key === 'Home' && items.length) { const k = gridOrder()[0].key; selectOnly(k); reveal(k); }
    else if (key === 'End' && items.length) { const k = gridOrder()[items.length - 1].key; selectOnly(k); reveal(k); }
    else if (key === 'ContextMenu' || (key === 'F10' && e.shiftKey)) {
      const cur = byKey.get(cursorKey) || selectedItems()[0];
      if (cur) {
        const b = cur.inner.getBoundingClientRect();
        if (!selected.has(cur.key)) selectOnly(cur.key);
        showItemMenu(b.left + b.width / 2, b.bottom - 6);
      } else {
        const rr = iconsEl.getBoundingClientRect();
        showBackgroundMenu(rr.left + 40, rr.top + 40);
      }
    } else if (!ctrl && !e.altKey && key.length === 1 && key !== ' ') {
      typeAhead(key);
      handled = true;
    } else handled = false;

    if (handled) e.preventDefault();
  }

  // ------------------------------------------------------------------ drag & drop
  function buildGhost(list, primary, e) {
    removeGhost();
    const rect = primary.inner.getBoundingClientRect();
    const g = el('div', { class: 'desk-ghost' });
    g.style.setProperty('--desk-icon', `${metrics().icon}px`);
    g.style.width = `${rect.width + (list.length > 1 ? 14 : 0)}px`;
    g.style.height = `${rect.height + (list.length > 1 ? 14 : 0)}px`;
    [primary].concat(list.filter((i) => i !== primary)).slice(0, 3).reverse().forEach((it, i, arr) => {
      const c = it.inner.cloneNode(true);
      c.removeAttribute('draggable');
      c.removeAttribute('title');
      c.classList.add('desk-ghost-card');
      const depth = arr.length - 1 - i;
      c.style.transform = `translate(${depth * 7}px, ${depth * 7}px)`;
      c.style.width = `${rect.width}px`;
      g.appendChild(c);
    });
    if (list.length > 1) g.appendChild(el('span', { class: 'desk-ghost-badge', text: String(list.length) }));
    document.body.appendChild(g);
    ghostEl = g;
    return { node: g, x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function removeGhost() {
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
  }

  function onDragStart(e) {
    const it = itemFromEvent(e);
    if (!it || renaming) { e.preventDefault(); return; }
    pendingSingle = null;
    if (!selected.has(it.key)) selectOnly(it.key);
    const list = gridOrder().filter((i) => selected.has(i.key));
    const paths = list.filter((i) => i.kind !== 'trash').map((i) => i.path);
    drag = { keys: list.map((i) => i.key), primary: it.key, paths };
    const dt = e.dataTransfer;
    if (dt) {
      try {
        dt.effectAllowed = 'copyMove';
        if (paths.length) {
          dt.setData(MIME_PATHS, JSON.stringify(paths));
          dt.setData('text/plain', paths.join('\n'));
        } else dt.setData('text/plain', 'trash:');
        const g = buildGhost(list, it, e);
        dt.setDragImage(g.node, g.x, g.y);
      } catch (err) { /* synthetic events may lack some DataTransfer features */ }
    }
    root.classList.add('desk-dragging');
    setTimeout(removeGhost, 0);
  }

  function setDropTarget(it) {
    items.forEach((i) => i.el.classList.toggle('drop-target', i === it));
  }

  function showSnap(cell) {
    if (!snapEl) return;
    const m = metrics();
    snapEl.hidden = false;
    snapEl.style.width = `${m.w - 8}px`;
    snapEl.style.height = `${m.h - 8}px`;
    snapEl.style.transform = `translate3d(${PAD + cell.col * m.w + 4}px, ${PAD + cell.row * m.h + 4}px, 0)`;
  }

  function hideSnap() {
    if (snapEl) snapEl.hidden = true;
  }

  function dropTargetFor(e) {
    const over = itemFromEvent(e);
    if (!over) return null;
    if (drag && drag.keys.includes(over.key)) return null;
    return over.kind === 'trash' || over.kind === 'dir' ? over : null;
  }

  /** Files dragged in from the real computer: text and images are stored on the desktop. */
  function importFiles(files, cell) {
    const f = fs();
    const list = Array.from(files || []);
    if (!f || !list.length) return;
    let pending = list.length;
    const names = [];
    const finish = () => {
      pending -= 1;
      if (pending > 0) return;
      if (names.length) {
        refresh();
        if (cell) placeNames(names, cell);
        selectKeys(names);
      }
    };
    list.forEach((file) => {
      const m = /\.[^.]+$/.exec(file.name);
      const ext = m ? m[0].toLowerCase() : '';
      const isText = IMPORT_TEXT.includes(ext) || /^text\//.test(file.type || '');
      const isImage = IMPORT_IMAGE.includes(ext) || /^image\//.test(file.type || '');
      if ((!isText && !isImage) || file.size > IMPORT_MAX) {
        notifyError('Dosya aktarılamadı', `“${file.name}” desteklenmiyor ya da çok büyük. Metin ve resim dosyaları (en fazla 2 MB) aktarılabilir.`);
        finish();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const name = f.uniqueName(DIR, file.name);
          f.writeFile(f.join(DIR, name), String(reader.result));
          names.push(name);
        } catch (err) {
          notifyError('Dosya aktarılamadı', errText(err));
        }
        finish();
      };
      reader.onerror = () => { notifyError('Dosya okunamadı', file.name); finish(); };
      if (isText && !isImage) reader.readAsText(file);
      else reader.readAsDataURL(file);
    });
  }

  function onDragOver(e) {
    const dt = e.dataTransfer;
    if (!dt) return;
    const types = Array.from(dt.types || []);
    if (!drag && types.includes('Files') && !types.includes(MIME_PATHS)) {
      // never let the browser navigate away to a dropped file
      e.preventDefault();
      try { dt.dropEffect = 'copy'; } catch (err) { /* ignore */ }
      showSnap(cellAt(e.clientX, e.clientY));
      return;
    }
    if (!drag && !types.includes(MIME_PATHS)) return;
    e.preventDefault();
    const allowed = String(dt.effectAllowed || '');
    const canCopy = drag || /copy|all|uninitialized/i.test(allowed);
    const target = dropTargetFor(e);
    try { dt.dropEffect = target && target.kind === 'trash' ? 'move' : (e.ctrlKey && canCopy ? 'copy' : 'move'); } catch (err) { /* ignore */ }
    setDropTarget(target);
    if (target) hideSnap();
    else showSnap(cellAt(e.clientX, e.clientY));
  }

  function onDragLeave(e) {
    if (e.relatedTarget && root.contains(e.relatedTarget)) return;
    setDropTarget(null);
    hideSnap();
  }

  /** Shared body for drops that move/copy file paths into a folder, the trash or the desktop. */
  function transfer(paths, target, copy, cell) {
    const f = fs();
    if (!f) return;
    if (target && target.kind === 'trash') {
      const n = paths.reduce((acc, p) => {
        try { f.trash(p); return acc + 1; } catch (e) { notifyError('Çöp kutusuna taşınamadı', errText(e)); return acc; }
      }, 0);
      if (n) playSound('trash');
      return;
    }
    const dest = target && target.kind === 'dir' ? target.path : DIR;
    const names = [];
    paths.forEach((src) => {
      try {
        if (!f.exists(src)) return;
        if (dest !== DIR && (src === dest || dest.startsWith(`${src}/`))) {
          throw new Error('Bir klasör kendi içine taşınamaz.');
        }
        const np = copy ? f.copy(src, dest) : moveInto(src, dest);
        if (dest === DIR) names.push(f.basename(np));
      } catch (e) {
        notifyError(copy ? 'Kopyalanamadı' : 'Taşınamadı', errText(e));
      }
    });
    if (names.length) {
      refresh();
      if (cell) placeNames(names, cell);
      selectKeys(names);
    }
  }

  function moveGroup(keys, primaryKey, target) {
    const prim = byKey.get(primaryKey);
    if (!prim) return;
    const dc = target.col - prim.col;
    const dr = target.row - prim.row;
    if (!dc && !dr) return;
    measure();
    const moving = new Set(keys);
    const occ = new Map();
    items.forEach((it) => { if (!moving.has(it.key)) occ.set(cellKey(it.col, it.row), it.key); });
    const order = [primaryKey].concat(keys.filter((k) => k !== primaryKey));
    order.forEach((k) => {
      const it = byKey.get(k);
      if (!it) return;
      const want = { col: Math.max(0, it.col + dc), row: util.clamp(it.row + dr, 0, grid.rows - 1) };
      const t = want.col < grid.cap ? nearestFree(want, occ) : nearestFree({ col: grid.cap - 1, row: want.row }, occ);
      occ.set(cellKey(t.col, t.row), k);
      layout[k] = { col: t.col, row: t.row };
    });
    saveLayout();
    relayout();
  }

  function onDrop(e) {
    const dt = e.dataTransfer;
    const d = drag;
    const types = dt ? Array.from(dt.types || []) : [];
    if (!d && types.includes('Files') && !types.includes(MIME_PATHS)) {
      e.preventDefault();
      hideSnap();
      importFiles(dt.files, cellAt(e.clientX, e.clientY));
      return;
    }
    if (!d && !types.includes(MIME_PATHS)) return;
    e.preventDefault();
    const copy = !!e.ctrlKey;
    const target = dropTargetFor(e);
    const cell = cellAt(e.clientX, e.clientY);
    setDropTarget(null);
    hideSnap();
    root.classList.remove('desk-dragging');
    drag = null;

    if (d) {
      if (target) {
        transfer(d.paths, target, copy, null);
      } else if (copy && d.paths.length) {
        // Ctrl + drop on empty space duplicates the files at that spot
        transfer(d.paths, null, true, cell);
      } else {
        moveGroup(d.keys, d.primary, cell);
      }
    } else {
      let paths = [];
      try { paths = JSON.parse(dt.getData(MIME_PATHS) || '[]'); } catch (err) { paths = []; }
      paths = paths.filter((p) => typeof p === 'string' && p.startsWith('/'));
      if (!paths.length) return;
      const insideDesktop = paths.every((p) => fs() && fs().dirname(p) === DIR);
      if (insideDesktop && !target && !copy) {
        // the file manager is showing this very folder: just reposition by name
        const keys = paths.map((p) => fs().basename(p)).filter((k) => byKey.has(k));
        if (keys.length) moveGroup(keys, keys[0], cell);
      } else {
        transfer(paths, target, copy, cell);
      }
    }
    if (pendingRefresh) refresh();
  }

  function onDragEnd() {
    drag = null;
    setDropTarget(null);
    hideSnap();
    removeGhost();
    root.classList.remove('desk-dragging');
    if (pendingRefresh) refresh();
  }

  // ------------------------------------------------------------------ init
  function buildDom() {
    root = document.getElementById('desktop');
    if (!root) {
      root = el('div', { id: 'desktop' });
      (document.getElementById('os-root') || document.body).appendChild(root);
    }
    root.classList.add('desk-root');
    root.setAttribute('tabindex', '0');
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Masaüstü');
    root.textContent = '';
    wallEl = el('div', { class: 'desk-wallpaper', 'aria-hidden': 'true' });
    iconsEl = el('div', { class: 'desk-icons', role: 'group', 'aria-label': 'Masaüstü simgeleri' });
    snapEl = el('div', { class: 'desk-snap', hidden: true });
    bandEl = el('div', { class: 'desk-band', hidden: true });
    sizerEl = el('div', { class: 'desk-sizer', 'aria-hidden': 'true' });
    iconsEl.append(sizerEl, snapEl);
    root.append(wallEl, iconsEl, bandEl);
  }

  function init() {
    if (inited) { refresh(); return; }
    try {
      buildDom();
    } catch (e) {
      console.error('[desktop] başlatılamadı', e);
      return;
    }
    inited = true;
    layout = P.storage.get('desktop.layout', {}) || {};
    if (typeof layout !== 'object' || Array.isArray(layout)) layout = {};
    root.classList.toggle('desk-hide-icons', !iconsVisible());
    applyMetrics();
    applyWallpaper(false);

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('click', onClick);
    root.addEventListener('dblclick', onDblClick);
    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', onDragEnd);
    root.addEventListener('focusout', () => root.classList.remove('desk-kbd'));
    document.addEventListener('keydown', onKeyDown);
    // Safety net: a file dragged in from the real computer and dropped on something that does not handle it
    // (a window, the taskbar...) would make the browser navigate away from PandaOS. Whoever wants the drop
    // (this desktop, an app) cancels dragover / drop first; this bubble-phase handler only catches the rest.
    const carriesFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    window.addEventListener('dragover', (e) => {
      if (e.defaultPrevented || !carriesFiles(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'none'; } catch (err) { /* ignore */ }
    });
    window.addEventListener('drop', (e) => { if (!e.defaultPrevented && carriesFiles(e)) e.preventDefault(); });
    window.addEventListener('resize', queueRelayout);
    if (typeof ResizeObserver !== 'undefined') {
      try { new ResizeObserver(queueRelayout).observe(iconsEl); } catch (e) { /* ignore */ }
    }
    // more icons than columns: the mouse wheel scrolls the icon area sideways (the area is wider than the screen)
    iconsEl.addEventListener('wheel', (e) => {
      if (!iconsEl.classList.contains('desk-scroll') || e.ctrlKey || e.defaultPrevented) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      iconsEl.scrollLeft += d;
      e.preventDefault();
    }, { passive: false });
    // another browser tab moved icons around: pick up its layout instead of overwriting it with ours later
    window.addEventListener('storage', (e) => {
      if (e.key !== null && e.key !== 'pandaos.desktop.layout') return;
      const next = P.storage.get('desktop.layout', {});
      layout = next && typeof next === 'object' && !Array.isArray(next) ? next : {};
      relayout();
    });

    P.bus.on('fs:change', (ev) => {
      migrateLayout(ev);
      refresh();
      applyWallpaper(true);
    });
    P.bus.on('apps:change', () => refresh());
    P.bus.on('clipboard:change', syncClipboard);
    P.bus.on('settings:change', (ev) => {
      if (ev.key === 'desktop.iconSize') {
        applyMetrics();
        relayout();
      } else if (ev.key === 'wallpaper') applyWallpaper(true);
    });
    ['session:lock', 'session:shutdown', 'session:restart'].forEach((evt) => {
      P.bus.on(evt, () => {
        // an unfinished rename or drag must not survive the lock / power screens
        if (renaming) endRename(true);
        onDragEnd();
        setDropTarget(null);
      });
    });
    P.bus.on('session:unlock', () => {
      root.classList.add('desk-welcome');
      setTimeout(() => root.classList.remove('desk-welcome'), 1100);
      // the keyboard belongs to the window that was active before the lock; only an empty desktop takes it
      setTimeout(() => {
        if (noWindowFocused()) focusRoot();
        else if (P.wm && typeof P.wm.refocus === 'function') P.wm.refocus();
      }, 60);
    });

    refresh();
  }

  P.desktop = {
    DIR,
    init,
    refresh,
    /* helpers (also used by tests / other shell modules) */
    items: () => items.map((it) => ({ key: it.key, name: it.name, kind: it.kind, path: it.path, icon: it.iconName, col: it.col, row: it.row })),
    selection: () => items.filter((it) => selected.has(it.key)).map((it) => it.key),
    select: (keys) => selectKeys([].concat(keys || [])),
    iconElement: (key) => (byKey.get(key) ? byKey.get(key).el : null),
    startRename: (key) => startRename(key),
    newFolder: (cell) => createEntry('dir', cell),
    newTextFile: (cell) => createEntry('file', cell),
    paste: (cell) => paste(cell),
    arrange,
    openItem: (key) => openItem(byKey.get(key)),
    grid: () => ({ cols: grid.cols, rows: grid.rows, size: sizeName() }),
    /** hover tooltip text of an icon (what the OS tooltip shows) */
    tipText: (key) => (byKey.get(key) ? byKey.get(key).tipText : null)
  };
})();
