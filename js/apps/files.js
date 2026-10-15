/* Dosyalar — PandaOS file manager (app id: files).
   Windows 11 Explorer inspired: navigation toolbar with breadcrumb address bar + search, command bar,
   quick-access sidebar, icon grids / details list, trash view, inline rename, rubber-band selection,
   clipboard (cut / copy / paste) and HTML5 drag & drop between windows, the sidebar and the desktop.
   Everything is rendered into win.body; all styling lives in css/apps/files.css under .app-files. */
(function () {
  'use strict';

  const P = window.PandaOS;
  if (!P || !P.fs) {
    console.error('[files] PandaOS.fs bulunamadı; Dosyalar başlatılamıyor');
    return;
  }
  const U = P.util;
  const el = U.el;
  const fs = P.fs;

  const STORE_KEY = 'app.files';
  const TRASH = 'trash:';
  const MIME = 'application/x-pandaos-paths';
  const SEARCH_LIMIT = 300;
  const THUMB_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
  const THUMB_MAX = 3 * 1024 * 1024;
  // files dragged in from the real computer: text and images up to 2 MB
  const IMPORT_TEXT = new Set(['.txt', '.md', '.json', '.csv', '.log', '.js', '.css', '.html', '.xml', '.svg', '.pmus']);
  const IMPORT_IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
  const IMPORT_MAX = 2 * 1024 * 1024;
  const VIEWS = ['large', 'medium', 'details'];
  const SORT_KEYS = ['name', 'modified', 'type', 'size'];

  // The drag started in any Dosyalar window (dataTransfer data is unreadable while dragging over).
  let currentDrag = null;

  // ---------------------------------------------------------------- helpers
  const num = (n) => Number(n).toLocaleString('tr-TR');
  const svg = (name) => (P.icons && P.icons.get ? P.icons.get(name) : '');
  const errText = (e) => (e && e.message ? e.message : String(e));
  const HOME = () => fs.HOME || '/home/panda';

  const TYPE_NAMES = {
    '.txt': 'Metin belgesi', '.md': 'Markdown belgesi', '.log': 'Günlük dosyası', '.json': 'JSON dosyası',
    '.js': 'JavaScript dosyası', '.css': 'CSS dosyası', '.html': 'HTML belgesi', '.csv': 'CSV dosyası',
    '.png': 'PNG resmi', '.jpg': 'JPEG resmi', '.jpeg': 'JPEG resmi', '.gif': 'GIF resmi', '.svg': 'SVG resmi',
    '.webp': 'WebP resmi', '.pmus': 'Müzik dosyası', '.app': 'Uygulama kısayolu'
  };

  function typeLabel(type, ext) {
    if (type === 'dir') return 'Klasör';
    if (TYPE_NAMES[ext]) return TYPE_NAMES[ext];
    return ext ? `${ext.slice(1).toLocaleUpperCase('tr')} dosyası` : 'Dosya';
  }

  function extOf(name) {
    const i = name.lastIndexOf('.');
    return i > 0 && i < name.length - 1 ? name.slice(i).toLowerCase() : '';
  }

  function fileEntry(st) {
    const isDir = st.type === 'dir';
    const ext = st.ext || '';
    const isApp = !isDir && ext === '.app';
    return {
      key: st.path, path: st.path, id: null, name: st.name, display: isApp ? st.name.slice(0, -4) : st.name,
      type: st.type, ext, size: st.size, modified: st.modified, created: st.created, hidden: !!st.hidden, isApp,
      icon: P.icons && P.icons.forFile ? P.icons.forFile(st) : (isDir ? 'folder' : 'file'),
      typeLabel: typeLabel(st.type, ext), where: fs.dirname(st.path)
    };
  }

  function trashEntry(t) {
    const isDir = t.type === 'dir';
    const ext = isDir ? '' : extOf(t.name);
    const isApp = ext === '.app';
    return {
      key: t.id, path: null, id: t.id, name: t.name, display: isApp ? t.name.slice(0, -4) : t.name,
      type: t.type, ext, size: t.size, modified: t.deletedAt, deletedAt: t.deletedAt, hidden: false, isApp,
      icon: P.icons && P.icons.forFile ? P.icons.forFile({ name: t.name, type: t.type, ext }) : (isDir ? 'folder' : 'file'),
      typeLabel: typeLabel(t.type, ext), origin: fs.dirname(t.originalPath), originalPath: t.originalPath
    };
  }

  function sortEntries(list, sort, group) {
    const mul = sort.dir === 'desc' ? -1 : 1;
    const byName = (a, b) => U.compareNames(a.display, b.display) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const cmp = ({
      name: byName,
      modified: (a, b) => a.modified - b.modified,
      type: (a, b) => U.compareNames(a.typeLabel, b.typeLabel),
      size: (a, b) => a.size - b.size,
      where: (a, b) => U.compareNames(a.where || '', b.where || ''),
      origin: (a, b) => U.compareNames(a.origin || '', b.origin || ''),
      deleted: (a, b) => a.deletedAt - b.deletedAt
    })[sort.key] || byName;
    list.sort((a, b) => {
      if (group && a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return cmp(a, b) * mul || byName(a, b);
    });
    return list;
  }

  const matches = (name, q) => name.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')) ||
    name.toLowerCase().includes(q.toLowerCase());

  // columns of the details list (name is flexible; the others have a default width)
  const COLS = {
    name: { id: 'name', label: 'Ad', sort: 'name' },
    modified: { id: 'modified', label: 'Değiştirilme tarihi', sort: 'modified', w: 158, text: (en) => U.formatDateTime(en.modified) },
    type: { id: 'type', label: 'Tür', sort: 'type', w: 140, text: (en) => en.typeLabel },
    size: { id: 'size', label: 'Boyut', sort: 'size', w: 84, right: true, text: (en) => (en.type === 'dir' ? '' : U.formatBytes(en.size)) },
    where: { id: 'where', label: 'Klasör', sort: 'where', w: 210, text: (en) => en.where },
    origin: { id: 'origin', label: 'Özgün konum', sort: 'origin', w: 210, text: (en) => en.origin },
    deleted: { id: 'deleted', label: 'Silinme tarihi', sort: 'deleted', w: 158, text: (en) => U.formatDateTime(en.deletedAt) }
  };
  // [column, minimum content width at which it is still shown]
  const LAYOUTS = {
    folder: [['name', 0], ['modified', 440], ['type', 560], ['size', 340]],
    search: [['name', 0], ['where', 480], ['modified', 640], ['size', 400]],
    trash: [['name', 0], ['origin', 480], ['deleted', 560], ['size', 400]]
  };

  // small view-mode glyphs for the status bar switch (monochrome, same stroke style as the icon set)
  const GLYPH_ATTR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  const VIEW_GLYPHS = {
    details: `<svg ${GLYPH_ATTR}><path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.2 6.5h.01M4.2 12h.01M4.2 17.5h.01"/></svg>`,
    medium: `<svg ${GLYPH_ATTR}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>`,
    large: `<svg ${GLYPH_ATTR}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 14.5l4.6-4.3a1.6 1.6 0 0 1 2.2 0L20 18.5"/><circle cx="15.5" cy="8.5" r="1.4"/></svg>`
  };
  const VIEW_LABELS = { large: 'Büyük simgeler', medium: 'Orta simgeler', details: 'Ayrıntılar' };

  function loadPrefs() {
    const raw = P.storage.get(STORE_KEY, {}) || {};
    const sort = raw.sort || {};
    return {
      view: VIEWS.includes(raw.view) ? raw.view : 'medium',
      sort: { key: SORT_KEYS.includes(sort.key) ? sort.key : 'name', dir: sort.dir === 'desc' ? 'desc' : 'asc' },
      hidden: !!raw.hidden,
      cols: raw.cols && typeof raw.cols === 'object' && !Array.isArray(raw.cols) ? raw.cols : {}
    };
  }

  // ================================================================ the file manager
  class FileManager {
    constructor(win, args) {
      this.win = win;
      this.body = win.body;
      this.prefs = loadPrefs();
      this.cwd = HOME();
      this.mode = 'folder';          // 'folder' | 'trash'
      this.history = [];
      this.hIndex = -1;
      this.sel = new Set();
      this.anchor = null;
      this.cursor = null;
      this.query = '';
      this.searchSort = null;
      this.trashSort = { key: 'deleted', dir: 'desc' };
      this.entries = [];
      this.byKey = new Map();
      this.itemEls = new Map();
      this.renaming = null;
      this.editingAddr = false;
      this.pendingRefresh = false;
      this.batch = 0;
      this.batchDirty = false;
      this.dragging = false;
      this.dropEl = null;
      this.closed = false;
      this.lastSig = '';
      this.chromeKey = '';
      this.cmdMode = null;
      this.winIcon = null;
      this.hiddenCols = '';
      this.contentWidth = 0;
      this.typeBuf = '';
      this.press = null;
      this.suppressSort = false;
      this.menuPress = null;
      this.bandOff = null;
      this.thumbs = new Map();
      this.scrollMemo = new Map();   // folder -> scrollTop when it was left
      this.nodeCache = new Map();    // key -> { sig, node }: item elements survive refreshes that did not change them
      this.nextCache = null;
      this.iconCache = null;
      this.nodeStruct = '';
      this.cleanups = [];
      this.timers = new Set();

      // an event handler must never throw: log it, tell the user, keep the window alive
      ['onKey', 'onViewMouseDown', 'onViewClick', 'onViewDblClick', 'onViewContext', 'onSideContext', 'onDragStart', 'onDragEnd',
        'onDragOver', 'onDragLeave', 'onDrop', 'onFsChange', 'applyLayout'].forEach((name) => {
        const orig = this[name];
        this[name] = (...a) => {
          try { return orig.apply(this, a); } catch (e) {
            console.error(`[files] ${name}`, e);
            if (!this.closed) this.fail('Beklenmeyen hata', errText(e));
            return undefined;
          }
        };
      });

      this.build();
      this.bind();
      this.applyLayout(true);
      this.start(args || {});
    }

    // ---------------------------------------------------------------- tiny utilities
    /** Persists only what this window changed, so a second Dosyalar window never overwrites the other's settings. */
    savePrefs(patch) {
      const cur = P.storage.get(STORE_KEY, {}) || {};
      P.storage.set(STORE_KEY, Object.assign({}, cur, patch));
    }

    later(fn, ms) {
      const id = setTimeout(() => { this.timers.delete(id); if (!this.closed) fn(); }, ms);
      this.timers.add(id);
      return id;
    }

    tip(node, text) {
      if (P.ui && typeof P.ui.tip === 'function') {
        try { this.cleanups.push(P.ui.tip(node, text)); } catch (e) { /* tooltips are optional */ }
      }
    }

    /** Tooltip for a short-lived node (list items): its listeners die with the node, nothing to detach. */
    tipTemp(node, text) {
      if (P.ui && typeof P.ui.tip === 'function') {
        try { P.ui.tip(node, text); } catch (e) { /* tooltips are optional */ }
      }
    }

    fail(title, message) {
      if (typeof P.notify === 'function') P.notify({ title, message, icon: 'error', timeout: 6000 });
      else console.error(`${title}: ${message}`);
    }

    reportErrors(title, errors) {
      if (!errors.length) return;
      const first = errText(errors[0]);
      this.fail(title, errors.length === 1 ? first : `${num(errors.length)} öğe işlenemedi. ${first}`);
    }

    focusView() {
      try { this.view.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }

    runBatch(fn) {
      this.batch++;
      try { fn(); } finally {
        this.batch--;
        if (!this.batch && this.batchDirty) { this.batchDirty = false; this.refresh(); }
      }
    }

    // ---------------------------------------------------------------- DOM construction
    build() {
      const body = this.body;
      body.textContent = '';
      body.classList.add('fm-root');

      // --- navigation row
      const nav = [
        ['back', 'arrow-left', 'Geri', 'Geri (Alt+←)', () => this.goHistory(-1)],
        ['forward', 'arrow-right', 'İleri', 'İleri (Alt+→)', () => this.goHistory(1)],
        ['up', 'arrow-up', 'Yukarı', 'Üst klasör (Alt+↑)', () => this.goUp()],
        ['refresh', 'refresh', 'Yenile', 'Yenile (F5)', () => this.refresh({ full: true, force: true })]
      ];
      this.btn = {};
      const navButtons = nav.map(([id, icon, label, tipText, fn]) => {
        const b = el('button', { class: 'p-btn icon fm-nav', type: 'button', 'aria-label': label, html: svg(icon) });
        b.dataset.nav = id;
        b.addEventListener('click', fn);
        this.tip(b, tipText);
        this.btn[id] = b;
        return b;
      });

      this.addr = el('div', { class: 'fm-address', role: 'group', 'aria-label': 'Adres çubuğu' });
      this.addr.addEventListener('click', (e) => {
        if (this.editingAddr) return;
        if (e.target === this.addr || e.target.closest('.fm-fill') || e.target.closest('.fm-address-ico')) this.editAddress();
      });

      this.searchInput = el('input', {
        class: 'p-input fm-search-input', type: 'text', placeholder: 'Ara', 'aria-label': 'Ara',
        spellcheck: false, autocomplete: 'off'
      });
      this.searchClear = el('button', { class: 'fm-search-clear', type: 'button', 'aria-label': 'Aramayı temizle', html: svg('close'), hidden: true });
      this.searchClear.addEventListener('click', () => { this.clearSearch(); this.focusView(); });
      this.tip(this.searchClear, 'Aramayı temizle (Esc)');
      this.searchBox = el('div', { class: 'fm-search' },
        el('span', { class: 'fm-search-ico', html: svg('search') }), this.searchInput, this.searchClear);

      this.top = el('div', { class: 'p-toolbar fm-top' }, ...navButtons, this.addr, this.searchBox);

      // --- command bar (rebuilt when switching between folder and trash)
      this.cmdbar = el('div', { class: 'p-toolbar fm-cmdbar', role: 'toolbar', 'aria-label': 'Komutlar' });

      // --- sidebar
      this.side = el('nav', { class: 'p-sidebar fm-side', 'aria-label': 'Gezinti' });
      this.buildSidebar();

      // --- content
      this.band = el('div', { class: 'fm-band', hidden: true });
      this.view = el('div', {
        class: 'fm-view', tabindex: '0', role: 'listbox', 'aria-label': 'Dosya listesi', 'aria-multiselectable': 'true'
      });
      this.content = el('div', { class: 'fm-content' }, this.view);
      this.main = el('div', { class: 'fm-main' }, this.side, this.content);

      // --- status bar
      this.statusText = el('span', { class: 'fm-status-text', role: 'status', 'aria-live': 'polite' });
      this.seg = el('div', { class: 'p-segmented fm-seg', role: 'group', 'aria-label': 'Görünüm' });
      this.segBtn = {};
      ['details', 'medium', 'large'].forEach((v) => {
        const b = el('button', { type: 'button', 'aria-label': VIEW_LABELS[v], html: VIEW_GLYPHS[v] });
        b.dataset.view = v;
        b.addEventListener('click', () => this.setView(v));
        this.tip(b, VIEW_LABELS[v]);
        this.seg.appendChild(b);
        this.segBtn[v] = b;
      });
      this.status = el('div', { class: 'p-statusbar fm-status' }, this.statusText, el('span', { class: 'spacer' }), this.seg);

      body.append(this.top, this.cmdbar, this.main, this.status);
    }

    buildSidebar() {
      const side = this.side;
      side.textContent = '';
      const H = HOME();
      const quick = [
        ['Ana klasör', H, 'home'],
        ['Masaüstü', `${H}/Masaüstü`, 'desktop'],
        ['Belgeler', `${H}/Belgeler`, 'document'],
        ['Resimler', `${H}/Resimler`, 'image'],
        ['Müzik', `${H}/Müzik`, 'note'],
        ['İndirilenler', `${H}/İndirilenler`, 'download']
      ];
      this.sideItems = new Map();
      const group = (title, rows) => {
        side.appendChild(el('div', { class: 'fm-side-group' }, el('span', { text: title })));
        const list = el('div', { class: 'p-list', role: 'list' });
        rows.forEach((r) => list.appendChild(this.sideItem(...r)));
        side.appendChild(list);
      };
      group('Hızlı erişim', quick);
      group('Bu bilgisayar', [['PandaOS (/)', '/', 'monitor']]);
      side.appendChild(el('div', { class: 'p-divider fm-side-sep' }));
      const trashRow = el('div', { class: 'p-list', role: 'list' });
      const t = this.sideItem('Çöp Kutusu', TRASH, 'delete');
      this.trashBadge = el('span', { class: 'p-badge subtle fm-badge', hidden: true });
      t.appendChild(this.trashBadge);
      trashRow.appendChild(t);
      side.appendChild(trashRow);
    }

    sideItem(label, path, icon) {
      const b = el('button', { class: 'p-list-item fm-side-item', type: 'button', 'aria-label': label },
        el('span', { class: 'fm-side-ico', html: svg(icon) }), el('span', { class: 'fm-side-label', text: label }));
      b.dataset.path = path;
      b.dataset.drop = path;
      b.addEventListener('click', () => this.go(path));
      b.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); P.apps.launch('files', { path }); } });
      this.tip(b, () => (this.compact ? label : ''));
      this.sideItems.set(path, b);
      return b;
    }

    // command bar -------------------------------------------------------
    cmdButton(id, icon, label, onClick, opts = {}) {
      const b = el('button', {
        class: 'p-btn ghost fm-cmd' + (opts.danger ? ' fm-cmd-danger' : '') + (opts.sec ? ' sec' : ''),
        type: 'button', 'aria-label': label
      });
      b.dataset.cmd = id;
      b.innerHTML = `${svg(icon)}<span class="fm-cmd-label">${U.escapeHtml(label)}</span>` +
        (opts.menu ? `<span class="fm-cmd-chev">${svg('chevron-down')}</span>` : '');
      if (opts.menu) b.setAttribute('aria-haspopup', 'menu');
      b.addEventListener('click', (e) => onClick(b, e));
      this.tip(b, () => (opts.tip || label) + (opts.key ? ` (${opts.key})` : ''));
      this.cmd[id] = b;
      return b;
    }

    buildCmdbar() {
      const bar = this.cmdbar;
      bar.textContent = '';
      this.cmd = {};
      const sep = () => el('span', { class: 'p-divider vertical fm-cmd-sep', 'aria-hidden': 'true' });
      if (this.mode === 'trash') {
        bar.append(
          this.cmdButton('restore', 'undo', 'Geri yükle', () => this.restoreSelected(), { tip: 'Seçili öğeleri geri yükle' }),
          this.cmdButton('purge', 'x', 'Kalıcı olarak sil', () => this.purgeSelected(), { key: 'Del' }),
          sep(),
          this.cmdButton('empty', 'delete', 'Çöp kutusunu boşalt', () => this.emptyTrash(), { danger: true }),
          el('span', { class: 'spacer' }),
          this.cmdButton('sort', 'sort', 'Sırala', (b) => this.openMenuFrom(b, this.sortMenu()), { menu: true })
        );
      } else {
        bar.append(
          this.cmdButton('new', 'plus', 'Yeni', (b) => this.openMenuFrom(b, this.newMenu()), { menu: true, tip: 'Yeni öğe oluştur' }),
          sep(),
          this.cmdButton('cut', 'cut', 'Kes', () => this.cutSelected(), { key: 'Ctrl+X', sec: true }),
          this.cmdButton('copy', 'copy', 'Kopyala', () => this.copySelected(), { key: 'Ctrl+C', sec: true }),
          this.cmdButton('paste', 'paste', 'Yapıştır', () => this.paste(), { key: 'Ctrl+V', sec: true }),
          this.cmdButton('rename', 'edit', 'Yeniden adlandır', () => this.renameSelected(), { key: 'F2', sec: true }),
          this.cmdButton('delete', 'delete', 'Sil', () => this.trashSelected(), { key: 'Del', sec: true }),
          el('span', { class: 'spacer' }),
          this.cmdButton('sort', 'sort', 'Sırala', (b) => this.openMenuFrom(b, this.sortMenu()), { menu: true }),
          this.cmdButton('view', 'grid', 'Görünüm', (b) => this.openMenuFrom(b, this.viewMenu()), { menu: true })
        );
      }
      this.cmdMode = this.mode;
    }

    // ---------------------------------------------------------------- events
    bind() {
      const v = this.view;
      v.addEventListener('mousedown', (e) => this.onViewMouseDown(e));
      v.addEventListener('click', (e) => this.onViewClick(e));
      v.addEventListener('dblclick', (e) => this.onViewDblClick(e));
      v.addEventListener('contextmenu', (e) => this.onViewContext(e));
      v.addEventListener('auxclick', (e) => {
        if (e.button !== 1 || this.mode === 'trash') return;
        const node = e.target.closest ? e.target.closest('.fm-item') : null;
        const en = node ? this.byKey.get(node.dataset.key) : null;
        if (en && en.type === 'dir') { e.preventDefault(); P.apps.launch('files', { path: en.path }); }
      });
      v.addEventListener('dragstart', (e) => this.onDragStart(e));
      v.addEventListener('dragend', () => this.onDragEnd());
      v.addEventListener('mouseover', (e) => {
        const node = e.target.closest ? e.target.closest('.fm-item') : null;
        if (!node || node._tipped || !v.contains(node)) return;
        node._tipped = true;
        this.tipTemp(node, () => this.itemTip(node.dataset.key));
      });
      v.addEventListener('scroll', () => { if (P.ui && P.ui.tip && P.ui.tip.hide) P.ui.tip.hide(); }, { passive: true });
      // Ctrl + wheel steps through the view modes (large -> medium -> details), like Explorer's icon zoom
      let wheelAt = 0;
      v.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const now = Date.now();
        if (this.mode === 'trash' || now - wheelAt < 160) return;
        wheelAt = now;
        const i = VIEWS.indexOf(this.prefs.view) + (e.deltaY > 0 ? 1 : -1);
        if (i >= 0 && i < VIEWS.length) this.setView(VIEWS[i]);
      }, { passive: false });
      this.body.addEventListener('mouseup', (e) => {
        if (e.button === 3 || e.button === 4) { e.preventDefault(); this.goHistory(e.button === 3 ? -1 : 1); }
      });
      this.side.addEventListener('contextmenu', (e) => this.onSideContext(e));
      this.body.addEventListener('dragover', (e) => this.onDragOver(e));
      this.body.addEventListener('dragleave', (e) => this.onDragLeave(e));
      this.body.addEventListener('drop', (e) => this.onDrop(e));
      this.addr.addEventListener('contextmenu', (e) => {
        if (this.editingAddr) return;
        e.preventDefault();
        P.contextMenu.show(e, [
          { label: 'Adresi düzenle', icon: 'edit', shortcut: 'F4', action: () => this.editAddress() },
          { label: 'Adresi kopyala', icon: 'copy', action: () => this.copyAddress() }
        ]);
      });

      // search box
      const si = this.searchInput;
      si.addEventListener('input', () => {
        clearTimeout(this.searchTimer);
        this.searchTimer = this.later(() => this.applySearch(si.value), 160);
        this.searchClear.hidden = !si.value;
      });
      si.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(this.searchTimer);
          this.applySearch(si.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (si.value) this.clearSearch(); else this.focusView();
          this.focusView();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          clearTimeout(this.searchTimer);
          this.applySearch(si.value);
          this.focusView();
          if (this.entries.length && !this.sel.size) this.setSel([this.entries[0].key], { anchor: this.entries[0].key, cursor: this.entries[0].key });
        }
      });

      // keep the toolbar menu buttons toggling (a press on the open menu's button closes it for good)
      const onWinPointer = (e) => {
        const cm = P.contextMenu;
        const b = this.menuBtn;
        this.menuPress = cm && cm.isOpen && cm.isOpen() && b && b.contains(e.target) ? b : null;
      };
      window.addEventListener('pointerdown', onWinPointer, true);
      this.cleanups.push(() => window.removeEventListener('pointerdown', onWinPointer, true));

      this.cleanups.push(P.bus.on('fs:change', (ev) => this.onFsChange(ev)));
      this.cleanups.push(P.bus.on('clipboard:change', () => { this.applyCut(); this.updateCmds(); }));
      this.cleanups.push(this.win.on('keydown', (e) => this.onKey(e)));
      this.cleanups.push(this.win.on('resize', () => this.applyLayout()));
      this.cleanups.push(this.win.on('close', () => this.destroy()));
    }

    destroy() {
      if (this.closed) return;
      this.closed = true;
      if (this.bandOff) { try { this.bandOff(); } catch (e) { /* ignore */ } }
      this.timers.forEach((id) => clearTimeout(id));
      this.timers.clear();
      clearTimeout(this.searchTimer);
      clearTimeout(this.typeTimer);
      if (this.colOff) { try { this.colOff(); } catch (e) { /* ignore */ } }
      this.cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
      if (this.menuBtn && P.contextMenu && P.contextMenu.isOpen && P.contextMenu.isOpen()) P.contextMenu.hide();
      if (P.ui && P.ui.tip && P.ui.tip.hide) P.ui.tip.hide();
      if (this.dragging) currentDrag = null;
      this.thumbs.clear();
      this.itemEls.clear();
    }

    // ---------------------------------------------------------------- startup / navigation
    start(args) {
      let path = args && typeof args.path === 'string' && args.path ? args.path : HOME();
      let select = [];
      if (path !== TRASH) {
        let abs = '';
        try { abs = fs.normalize(path, HOME()); } catch (e) { abs = ''; }
        if (!abs || !fs.exists(abs)) {
          this.fail('Konum bulunamadı', `“${path}” konumu bulunamadı. Ana klasör açılıyor.`);
          abs = HOME();
        } else if (fs.isFile(abs)) {
          select = [abs];
          abs = fs.dirname(abs);
        }
        path = abs;
      }
      this.cwd = path;
      this.mode = path === TRASH ? 'trash' : 'folder';
      this.history = [path];
      this.hIndex = 0;
      this.sel = new Set(select);
      this.anchor = this.cursor = select[0] || null;
      this.refresh({ full: true, force: true, resetScroll: true });
      if (select[0]) this.revealKey(select[0]);
      this.focusView();
    }

    /** Navigates to a folder / the trash. A file path opens its parent folder with the file selected. */
    go(path, opts = {}) {
      if (this.closed) return false;
      let target;
      let select = opts.select || [];
      if (path === TRASH) {
        target = TRASH;
      } else {
        let abs = '';
        try { abs = fs.normalize(String(path), this.mode === 'trash' ? HOME() : this.cwd); } catch (e) { abs = ''; }
        if (!abs || !fs.exists(abs)) {
          this.fail('Konum bulunamadı', `“${path}” konumu bulunamadı.`);
          return false;
        }
        if (fs.isFile(abs)) { select = [abs]; target = fs.dirname(abs); } else target = abs;
      }
      const same = target === this.cwd;
      if (!same) this.scrollMemo.set(this.cwd, this.view.scrollTop);
      this.stopAddressEdit(false);
      this.cancelRename();
      this.hideTipAndMenu();
      if (opts.replace) {
        this.history[this.hIndex] = target;
      } else if (!same) {
        this.history.length = this.hIndex + 1;
        this.history.push(target);
        this.hIndex = this.history.length - 1;
      }
      const hadQuery = !!this.query;
      this.query = '';
      this.searchInput.value = '';
      this.searchClear.hidden = true;
      this.searchSort = null;
      this.cwd = target;
      this.mode = target === TRASH ? 'trash' : 'folder';
      if (!(same && !select.length && !hadQuery)) {
        this.sel = new Set(select);
        this.anchor = this.cursor = select[0] || null;
      }
      this.refresh({ full: true, force: true, resetScroll: true });
      if (opts.restoreScroll && !same && this.scrollMemo.has(target)) this.view.scrollTop = this.scrollMemo.get(target);
      if (select[0]) this.revealKey(select[0]);
      if (!opts.noFocus) this.focusView();
      return true;
    }

    hideTipAndMenu() {
      if (P.ui && P.ui.tip && P.ui.tip.hide) P.ui.tip.hide();
    }

    nearestFolder(path) {
      let p = path;
      while (p && p !== '/' && !fs.isDir(p)) p = fs.dirname(p);
      return p || '/';
    }

    goHistory(delta) {
      const i = this.hIndex + delta;
      if (i < 0 || i >= this.history.length) return false;
      let target = this.history[i];
      if (target !== TRASH && !fs.isDir(target)) target = this.nearestFolder(target);
      this.hIndex = i;
      return this.go(target, { replace: true, restoreScroll: true });
    }

    goUp() {
      if (this.mode === 'trash') return this.go(HOME());
      if (this.cwd === '/') return false;
      return this.go(fs.dirname(this.cwd), { select: [this.cwd], restoreScroll: true });
    }

    /** The current folder vanished / was renamed: follow the rename, or fall back to the nearest existing parent. */
    ensureCwd() {
      if (this.mode === 'trash' || fs.isDir(this.cwd)) return;
      const fallback = this.nearestFolder(this.cwd);
      this.history = this.history.map((h) => (h === TRASH || fs.isDir(h) ? h : this.nearestFolder(h)));
      this.cwd = fallback;
      this.history[this.hIndex] = fallback;
      this.sel.clear();
      this.anchor = this.cursor = null;
    }

    // ---------------------------------------------------------------- data
    curSort() {
      if (this.mode === 'trash') return this.trashSort;
      if (this.query.trim()) return this.searchSort;
      return this.prefs.sort;
    }

    layoutKind() {
      if (this.mode === 'trash') return 'trash';
      return this.query.trim() ? 'search' : 'folder';
    }

    layoutMode() {
      if (this.mode === 'trash' || this.query.trim()) return 'details';
      return this.prefs.view === 'details' ? 'details' : 'grid';
    }

    loadEntries() {
      const q = this.query.trim();
      let list = [];
      try {
        if (this.mode === 'trash') {
          list = fs.listTrash().map(trashEntry);
          if (q) list = list.filter((en) => matches(en.display, q));
          sortEntries(list, this.trashSort, false);
        } else if (q) {
          list = fs.search(q, { root: this.cwd, limit: SEARCH_LIMIT, hidden: this.prefs.hidden }).map(fileEntry);
          if (this.searchSort) sortEntries(list, this.searchSort, false);
        } else {
          list = fs.list(this.cwd, { hidden: this.prefs.hidden }).map(fileEntry);
          sortEntries(list, this.prefs.sort, true);
        }
      } catch (e) {
        console.warn('[files] liste okunamadı', e);
        list = [];
      }
      this.entries = list;
      this.byKey = new Map(list.map((en) => [en.key, en]));
    }

    /** Columns that fit the view; the width is measured on resize only (reading it per refresh would force layouts). */
    visibleColumns() {
      const kind = this.layoutKind();
      const w = this.contentWidth || Math.max(300, (this.win.getBounds().width || 880) - 200);
      return LAYOUTS[kind].filter(([, min]) => w >= min).map(([id]) => COLS[id]);
    }

    colsKey() {
      return this.layoutMode() === 'details' ? this.visibleColumns().map((c) => c.id).join(',') : '';
    }

    signature() {
      const sort = this.curSort();
      return [
        this.mode, this.cwd, this.query, this.prefs.view, this.prefs.hidden, sort ? `${sort.key}${sort.dir}` : '-',
        this.colsKey(), this.layoutMode(),
        this.entries.map((en) => `${en.key}|${en.display}|${en.size}|${en.modified}|${en.icon}`).join('\n')
      ].join('§');
    }

    /** Re-reads the current location and redraws when something visible changed. */
    refresh(opts = {}) {
      if (this.closed) return;
      if (!opts.force && ((this.renaming && !this.renaming.committing) || (this.dragging && !opts.afterDrag))) {
        this.pendingRefresh = true;
        return;
      }
      this.pendingRefresh = false;
      this.ensureCwd();
      const scroll = this.view.scrollTop;
      this.loadEntries();
      // keep only the selection that still exists
      let changed = false;
      this.sel.forEach((k) => { if (!this.byKey.has(k)) { this.sel.delete(k); changed = true; } });
      if (this.anchor && !this.byKey.has(this.anchor)) this.anchor = null;
      if (this.cursor && !this.byKey.has(this.cursor)) this.cursor = null;
      const sig = this.signature();
      if (opts.full || sig !== this.lastSig) {
        this.lastSig = sig;
        this.renderView();
        this.view.scrollTop = opts.resetScroll ? 0 : scroll;
      } else if (changed) {
        this.applySelection();
      }
      this.updateChrome();
    }

    /** A rename / move of the current folder (or a parent) or of selected items: keep following it. */
    remap(ev) {
      if (!ev || !ev.oldPath || !ev.path || (ev.type !== 'rename' && ev.type !== 'move')) return;
      const from = ev.oldPath;
      const to = ev.path;
      const map = (p) => (typeof p === 'string' && (p === from || p.startsWith(from + '/')) ? to + p.slice(from.length) : p);
      if (this.mode !== 'trash') this.cwd = map(this.cwd);
      this.history = this.history.map(map);
      if (this.sel.has(from)) {
        this.sel.delete(from);
        this.sel.add(to);
      }
      if (this.anchor === from) this.anchor = to;
      if (this.cursor === from) this.cursor = to;
    }

    onFsChange(ev) {
      if (this.closed) return;
      this.remap(ev);
      this.updateTrashBadge();
      if (this.batch) { this.batchDirty = true; return; }
      this.refresh();
    }

    // ---------------------------------------------------------------- rendering
    renderView() {
      const v = this.view;
      const kind = this.layoutMode();
      const empty = !this.entries.length;
      // elements are only reused while everything that shapes them (layout, columns, search text...) stays the same
      const struct = [kind, this.prefs.view, this.mode, this.query.trim(), kind === 'details' ? this.colsKey() : ''].join('|');
      if (struct !== this.nodeStruct) { this.nodeCache = new Map(); this.nodeStruct = struct; }
      this.nextCache = new Map();
      this.iconCache = new Map();
      this.itemEls = new Map();
      v.dataset.layout = kind;
      v.dataset.size = this.prefs.view === 'large' ? 'large' : 'medium';
      v.classList.toggle('is-empty', empty);
      v.setAttribute('aria-label', this.mode === 'trash' ? 'Çöp Kutusu öğeleri' : 'Dosya listesi');
      let content;
      if (empty) content = this.renderEmpty();
      else content = kind === 'grid' ? this.renderGrid() : this.renderDetails();
      this.nodeCache = this.nextCache;
      this.nextCache = null;
      this.iconCache = null;
      v.replaceChildren(content, this.band);
      this.applySelection();
      this.applyCut();
    }

    renderEmpty() {
      let icon = 'folder';
      let title = 'Bu klasör boş';
      let sub = 'Yeni bir klasör ya da belge oluşturmak için sağ tıklayın.';
      if (this.mode === 'trash') {
        icon = 'trash';
        title = 'Çöp kutusu boş';
        sub = this.query.trim() ? 'Aramanızla eşleşen bir öğe yok.' : 'Sildiğiniz öğeler geri yüklenebilmeleri için burada bekler.';
      } else if (this.query.trim()) {
        icon = 'search';
        title = 'Sonuç bulunamadı';
        sub = `“${this.query.trim()}” için eşleşen bir öğe yok.`;
      }
      const box = el('div', { class: 'p-empty fm-empty' }, P.icons.el(icon, { size: 56 }), el('h3', { text: title }), el('p', { text: sub }));
      return box;
    }

    /** Icon markup, parsed once per icon name per render (icons.get re-ids every call). */
    icon(name) {
      if (!this.iconCache) return svg(name);
      let m = this.iconCache.get(name);
      if (m === undefined) { m = svg(name); this.iconCache.set(name, m); }
      return m;
    }

    /** The element for an entry: the previous one when nothing it shows has changed. */
    itemNode(en, make) {
      const sig = `${en.display}|${en.size}|${en.modified}|${en.icon}|${en.type}|${en.hidden ? 1 : 0}`;
      const old = this.nodeCache.get(en.key);
      let node;
      if (old && old.sig === sig) {
        node = old.node;
        node.classList.remove('drop-target');
      } else {
        node = make();
      }
      this.nextCache.set(en.key, { sig, node });
      this.itemEls.set(en.key, node);
      return node;
    }

    renderGrid() {
      const grid = el('div', { class: 'fm-grid', role: 'presentation' });
      this.entries.forEach((en) => grid.appendChild(this.itemNode(en, () => this.makeGridItem(en))));
      return grid;
    }

    baseItem(en) {
      const item = el('div', { class: 'fm-item' + (en.hidden ? ' is-hidden' : ''), role: 'option' });
      item.dataset.key = en.key;
      item.setAttribute('aria-selected', 'false');
      if (this.mode !== 'trash') item.draggable = true;
      if (this.mode !== 'trash' && en.type === 'dir') item.dataset.drop = en.path;
      return item;
    }

    makeGridItem(en) {
      const item = this.baseItem(en);
      const ico = el('div', { class: 'fm-ico' });
      const thumb = this.thumbFor(en);
      if (thumb) {
        const img = el('img', { class: 'fm-thumb', src: thumb, alt: '', draggable: false });
        img.addEventListener('error', () => { ico.innerHTML = svg(en.icon); });
        // fill the icon box along the longer side, whatever the image size
        img.addEventListener('load', () => {
          if (img.naturalWidth >= img.naturalHeight) { img.style.width = '100%'; img.style.height = 'auto'; } else { img.style.height = '100%'; img.style.width = 'auto'; }
        });
        ico.appendChild(img);
      } else {
        ico.innerHTML = this.icon(en.icon);
      }
      const nm = el('span', { class: 'fm-nm', text: en.display });
      item.append(ico, el('div', { class: 'fm-name' }, nm));
      return item;
    }

    makeRow(en, cols) {
      const item = this.baseItem(en);
      item.classList.add('fm-row');
      cols.forEach((c) => {
        const cell = el('div', { class: `fm-cell fm-c-${c.id}${c.right ? ' right' : ''}` });
        if (c.id === 'name') {
          const nm = el('span', { class: 'fm-nm' });
          nm.append(this.highlight(en.display));
          cell.append(el('span', { class: 'fm-ico', html: this.icon(en.icon) }), el('span', { class: 'fm-name' }, nm));
        } else {
          cell.textContent = c.text(en);
        }
        item.appendChild(cell);
      });
      return item;
    }

    /** Name text with the search match emphasised (only while searching). */
    highlight(text) {
      const q = this.query.trim();
      const frag = document.createDocumentFragment();
      if (!q) { frag.append(text); return frag; }
      const lo = text.toLocaleLowerCase('tr');
      const ql = q.toLocaleLowerCase('tr');
      const i = lo.length === text.length ? lo.indexOf(ql) : -1;
      if (i < 0) { frag.append(text); return frag; }
      frag.append(text.slice(0, i), el('mark', { class: 'fm-hit', text: text.slice(i, i + q.length) }), text.slice(i + q.length));
      return frag;
    }

    itemTip(key) {
      const en = this.byKey.get(key);
      const node = this.itemEls.get(key);
      if (!en || !node || this.renaming || this.dragging || this.bandOff) return '';
      if (this.layoutMode() === 'details') {
        const nm = node.querySelector('.fm-nm');
        return nm && nm.scrollWidth > nm.clientWidth + 1 ? en.display : '';
      }
      const lines = [en.display, `Tür: ${en.typeLabel}`];
      if (en.type === 'file') lines.push(`Boyut: ${U.formatBytes(en.size)}`);
      else lines.push(`${num(this.childCount(en))} öğe`);
      lines.push(`Değiştirilme: ${U.formatDateTime(en.modified)}`);
      return lines.join('\n');
    }

    childCount(en) {
      try { const st = fs.stat(en.path); return st && st.childCount ? st.childCount : 0; } catch (e) { return 0; }
    }

    thumbFor(en) {
      if (this.layoutMode() !== 'grid' || en.type !== 'file' || !THUMB_EXT.has(en.ext) || en.size > THUMB_MAX) return null;
      const ck = `${en.path}|${en.modified}`;
      if (this.thumbs.has(ck)) return this.thumbs.get(ck);
      let url = null;
      try {
        const data = fs.readFile(en.path);
        if (/^data:image\//i.test(data)) url = data;
        else if (en.ext === '.svg' && /^\s*<svg/i.test(data)) url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
      } catch (e) { url = null; }
      if (this.thumbs.size > 200) this.thumbs.clear();
      this.thumbs.set(ck, url);
      return url;
    }

    // details ------------------------------------------------------------
    colTemplate(cols) {
      return cols.map((c) => {
        const w = this.prefs.cols[c.id];
        if (c.id === 'name') return w ? `${w}px` : 'minmax(180px, 1fr)';
        return `${w || c.w}px`;
      }).join(' ');
    }

    /** Smallest width the columns can take (the container scrolls sideways below it). */
    colsMinWidth(cols) {
      return 16 + cols.reduce((sum, c) => sum + (this.prefs.cols[c.id] || (c.id === 'name' ? 180 : c.w)), 0);
    }

    renderDetails() {
      const cols = this.visibleColumns();
      this.curCols = cols;
      this.hiddenCols = cols.map((c) => c.id).join(',');
      const wrap = el('div', { class: 'fm-details', role: 'presentation' });
      wrap.style.setProperty('--fm-cols', this.colTemplate(cols));
      wrap.style.minWidth = `${this.colsMinWidth(cols)}px`;
      this.detailsEl = wrap;
      const head = el('div', { class: 'fm-head', role: 'presentation' });
      cols.forEach((c) => head.appendChild(this.makeHeaderCell(c)));
      wrap.appendChild(head);
      this.entries.forEach((en) => wrap.appendChild(this.itemNode(en, () => this.makeRow(en, cols))));
      return wrap;
    }

    makeHeaderCell(c) {
      const cur = this.curSort();
      const sorted = !!cur && cur.key === c.sort;
      const b = el('button', { class: 'fm-col' + (c.right ? ' right' : '') + (sorted ? ' sorted' : ''), type: 'button', tabindex: '-1' });
      b.dataset.col = c.id;
      b.dataset.sort = c.sort;
      b.setAttribute('aria-sort', sorted ? (cur.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      b.appendChild(el('span', { class: 'fm-col-label', text: c.label }));
      if (sorted) b.appendChild(el('span', { class: 'fm-sort-arrow', html: svg(cur.dir === 'asc' ? 'chevron-up' : 'chevron-down') }));
      const grip = el('span', { class: 'fm-grip', 'aria-hidden': 'true' });
      grip.addEventListener('mousedown', (e) => this.beginColResize(e, c, b));
      b.appendChild(grip);
      return b;
    }

    beginColResize(e, col, cell) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = cell.getBoundingClientRect().width;
      const min = col.id === 'name' ? 120 : 56;
      const wrap = this.detailsEl;
      const cols = this.curCols;
      const move = (ev) => {
        const w = Math.round(U.clamp(startW + ev.clientX - startX, min, 900));
        this.prefs.cols[col.id] = w;
        wrap.style.setProperty('--fm-cols', this.colTemplate(cols));
        wrap.style.minWidth = `${this.colsMinWidth(cols)}px`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        this.colOff = null;
        this.savePrefs({ cols: this.prefs.cols });
        this.suppressSort = true;
        this.later(() => { this.suppressSort = false; }, 60);
      };
      this.colOff = () => { document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true); };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    }

    // selection state painting ---------------------------------------------
    applySelection() {
      this.itemEls.forEach((node, key) => {
        const on = this.sel.has(key);
        node.classList.toggle('selected', on);
        node.classList.toggle('cursor', key === this.cursor);
        node.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      this.updateCmds();
      this.updateStatus();
    }

    applyCut() {
      const clip = P.clipboard.get();
      const cut = clip && clip.op === 'cut' && this.mode !== 'trash' ? new Set(clip.paths) : null;
      this.itemEls.forEach((node, key) => node.classList.toggle('cut', !!cut && cut.has(key)));
    }

    // chrome (toolbar, address, sidebar, status) ---------------------------------
    updateChrome() {
      if (this.closed) return;
      const trash = this.mode === 'trash';
      if (this.cmdMode !== this.mode) this.buildCmdbar();
      const title = trash ? 'Çöp Kutusu' : (this.cwd === '/' ? 'PandaOS' : fs.displayName(this.cwd));
      if (this.win.getTitle() !== title) this.win.setTitle(title);
      const icon = trash ? (fs.trashCount() ? 'trash-full' : 'trash') : 'files';
      if (this.winIcon !== icon) { this.winIcon = icon; this.win.setIcon(icon); }
      this.btn.back.disabled = this.hIndex <= 0;
      this.btn.forward.disabled = this.hIndex >= this.history.length - 1;
      this.btn.up.disabled = !trash && this.cwd === '/';
      const key = `${this.mode}|${this.cwd}`;
      if (this.chromeKey !== key) {
        this.chromeKey = key;
        this.searchInput.placeholder = `Ara: ${trash ? 'Çöp Kutusu' : (this.cwd === '/' ? 'PandaOS' : fs.displayName(this.cwd))}`;
        this.renderAddress();
      }
      this.sideItems.forEach((node, path) => {
        const on = path === this.cwd;
        node.classList.toggle('selected', on);
        if (on) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
      });
      this.updateTrashBadge();
      Object.keys(this.segBtn).forEach((v) => {
        const on = this.prefs.view === v;
        this.segBtn[v].classList.toggle('active', on);
        this.segBtn[v].setAttribute('aria-pressed', on ? 'true' : 'false');
        this.segBtn[v].disabled = trash;
      });
      this.updateCmds();
      this.updateStatus();
    }

    updateTrashBadge() {
      if (!this.trashBadge) return;
      const n = fs.trashCount();
      this.trashBadge.textContent = n > 99 ? '99+' : String(n);
      this.trashBadge.hidden = !n;
      const item = this.sideItems.get(TRASH);
      if (item) {
        item.dataset.count = String(n);
        item.setAttribute('aria-label', n ? `Çöp Kutusu, ${num(n)} öğe` : 'Çöp Kutusu');
      }
    }

    selected() {
      const out = [];
      this.entries.forEach((en) => { if (this.sel.has(en.key)) out.push(en); });
      return out;
    }

    updateCmds() {
      if (!this.cmd) return;
      const sel = this.selected();
      const n = sel.length;
      const set = (id, on) => { if (this.cmd[id]) this.cmd[id].disabled = !on; };
      if (this.mode === 'trash') {
        set('restore', n > 0);
        set('purge', n > 0);
        set('empty', fs.trashCount() > 0);
        return;
      }
      const prot = sel.some((en) => fs.isProtected(en.path));
      const clip = P.clipboard.get();
      set('cut', n > 0 && !prot);
      set('copy', n > 0);
      set('paste', !!clip);
      set('rename', n === 1 && !prot);
      set('delete', n > 0 && !prot);
    }

    updateStatus() {
      const n = this.entries.length;
      const s = this.sel.size;
      const searching = !!this.query.trim();
      let text;
      if (s) {
        text = `${num(s)} öğe seçili`;
        const sel = this.selected();
        const files = sel.filter((en) => en.type === 'file');
        if (files.length) text += ` · ${U.formatBytes(files.reduce((a, en) => a + en.size, 0))}`;
      } else if (searching) {
        text = `${num(n)}${n >= SEARCH_LIMIT ? '+' : ''} sonuç`;
      } else {
        text = `${num(n)} öğe`;
      }
      this.statusText.textContent = text;
    }

    // layout reacting to the window width -----------------------------------------
    applyLayout(initial) {
      if (this.closed) return;
      const w = this.body.clientWidth || (this.win.getBounds && this.win.getBounds().width) || 880;
      this.compact = w < 660;
      const b = this.body.classList;
      b.toggle('fm-compact', this.compact);
      b.toggle('fm-narrow', w < 780);
      b.toggle('fm-tiny', w < 600);
      b.toggle('fm-short', (this.body.clientHeight || 560) < 430);
      this.contentWidth = this.view.clientWidth || 0;
      if (initial) return;
      if (this.layoutMode() === 'details' && this.colsKey() !== this.hiddenCols) this.refresh({ full: true, force: true });
      this.fitCrumbs();
    }

    // ---------------------------------------------------------------- address bar
    crumbSegments() {
      if (this.mode === 'trash') return [{ label: 'Çöp Kutusu', path: TRASH }];
      const segs = [{ label: 'PandaOS', path: '/' }];
      let acc = '';
      this.cwd.split('/').filter(Boolean).forEach((p) => { acc += `/${p}`; segs.push({ label: p, path: acc }); });
      return segs;
    }

    renderAddress() {
      if (this.editingAddr) return;
      const a = this.addr;
      a.textContent = '';
      a.classList.remove('editing');
      const trash = this.mode === 'trash';
      const ico = el('span', { class: 'fm-address-ico', html: svg(trash ? (fs.trashCount() ? 'trash-full' : 'trash') : 'folder') });
      const crumbs = el('div', { class: 'fm-crumbs' });
      this.crumbsEl = crumbs;
      this.crumbSegs = this.crumbSegments();
      const more = el('button', { class: 'fm-crumb fm-more', type: 'button', 'aria-label': 'Üst konumlar', html: svg('more'), hidden: true });
      more.addEventListener('click', () => this.openMenuFrom(more, this.hiddenCrumbItems()));
      crumbs.appendChild(more);
      this.crumbSegs.forEach((seg, i) => {
        const group = el('span', { class: 'fm-seg-group' });
        const b = el('button', { class: 'fm-crumb' + (i === this.crumbSegs.length - 1 ? ' current' : ''), type: 'button', text: seg.label });
        b.dataset.path = seg.path;
        if (seg.path !== TRASH) b.dataset.drop = seg.path;
        b.addEventListener('click', () => this.go(seg.path));
        b.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); P.apps.launch('files', { path: seg.path }); } });
        group.appendChild(b);
        if (seg.path !== TRASH) {
          const chev = el('button', { class: 'fm-chev', type: 'button', 'aria-label': `${seg.label} içindeki klasörler`, html: svg('chevron-right') });
          chev.addEventListener('click', () => this.openMenuFrom(chev, this.subfolderItems(seg.path)));
          group.appendChild(chev);
        }
        crumbs.appendChild(group);
      });
      a.append(ico, crumbs, el('span', { class: 'fm-fill' }));
      this.fitCrumbs();
    }

    fitCrumbs() {
      const c = this.crumbsEl;
      if (!c || this.editingAddr || !c.isConnected) return;
      const groups = [...c.querySelectorAll('.fm-seg-group')];
      const more = c.querySelector('.fm-more');
      groups.forEach((g) => { g.hidden = false; });
      more.hidden = true;
      let hidden = 0;
      while (c.scrollWidth > c.clientWidth + 1 && hidden < groups.length - 1) {
        groups[hidden].hidden = true;
        hidden++;
        more.hidden = false;
      }
      more.dataset.hidden = String(hidden);
    }

    hiddenCrumbItems() {
      const n = Number((this.crumbsEl.querySelector('.fm-more') || {}).dataset ? this.crumbsEl.querySelector('.fm-more').dataset.hidden : 0) || 0;
      return this.crumbSegs.slice(0, n).map((s) => ({ label: s.label, icon: 'folder', action: () => this.go(s.path) }));
    }

    subfolderItems(path) {
      let dirs = [];
      try { dirs = fs.list(path, { hidden: this.prefs.hidden }).filter((s) => s.type === 'dir'); } catch (e) { dirs = []; }
      if (!dirs.length) return [{ label: 'Alt klasör yok', disabled: true }];
      return dirs.slice(0, 40).map((s) => ({ label: s.name, icon: 'folder', action: () => this.go(s.path) }));
    }

    copyAddress() {
      const text = this.mode === 'trash' ? TRASH : this.cwd;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      } catch (e) { /* the system clipboard may be unavailable */ }
    }

    editAddress() {
      if (this.editingAddr || this.closed) return;
      this.cancelRename();
      this.editingAddr = true;
      const a = this.addr;
      a.textContent = '';
      a.classList.add('editing');
      const ico = el('span', { class: 'fm-address-ico', html: svg(this.mode === 'trash' ? 'trash' : 'folder') });
      const input = el('input', {
        class: 'fm-addr-input', type: 'text', value: this.mode === 'trash' ? TRASH : this.cwd,
        spellcheck: false, autocomplete: 'off', 'aria-label': 'Konum'
      });
      this.addrInput = input;
      a.append(ico, input);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.submitAddress(input.value); } else if (e.key === 'Escape') {
          e.preventDefault();
          this.stopAddressEdit(true);
        }
      });
      input.addEventListener('input', () => { a.classList.remove('invalid'); });
      input.addEventListener('blur', () => { if (this.addrInput === input) this.stopAddressEdit(false); });
      input.focus();
      input.select();
    }

    stopAddressEdit(focusView) {
      if (!this.editingAddr) return;
      this.editingAddr = false;
      this.addrInput = null;
      this.addr.classList.remove('editing', 'invalid');
      this.chromeKey = '';
      this.renderAddress();
      this.chromeKey = `${this.mode}|${this.cwd}`;
      if (focusView) this.focusView();
    }

    submitAddress(value) {
      const raw = String(value || '').trim();
      if (!raw) { this.stopAddressEdit(true); return; }
      const low = raw.toLocaleLowerCase('tr');
      if (low === TRASH || low === 'çöp kutusu') { this.stopAddressEdit(false); this.go(TRASH); return; }
      let abs = '';
      try { abs = fs.normalize(raw, this.mode === 'trash' ? HOME() : this.cwd); } catch (e) { abs = ''; }
      if (!abs || !fs.exists(abs)) {
        this.shakeAddress();
        this.fail('Konum bulunamadı', `“${raw}” konumu bulunamadı. Yolu denetleyip yeniden deneyin.`);
        if (this.addrInput) { this.addrInput.focus(); this.addrInput.select(); }
        return;
      }
      this.stopAddressEdit(false);
      this.go(abs);
    }

    shakeAddress() {
      const a = this.addr;
      a.classList.add('invalid');
      a.classList.remove('shake');
      void a.offsetWidth;
      a.classList.add('shake');
      this.later(() => a.classList.remove('shake'), 480);
    }

    // ---------------------------------------------------------------- search
    applySearch(value) {
      if (this.closed) return;
      const q = String(value || '');
      if (q.trim() === this.query.trim()) { this.query = q; return; }
      this.query = q;
      this.searchClear.hidden = !q;
      if (!q.trim()) this.searchSort = null;
      this.sel.clear();
      this.anchor = this.cursor = null;
      this.refresh({ full: true, force: true, resetScroll: true });
    }

    clearSearch() {
      this.query = '';
      this.searchInput.value = '';
      this.searchClear.hidden = true;
      this.searchSort = null;
      clearTimeout(this.searchTimer);
      this.refresh({ full: true, force: true, resetScroll: true });
    }

    focusSearch() {
      this.searchInput.focus();
      this.searchInput.select();
    }

    // ---------------------------------------------------------------- selection
    setSel(keys, opts = {}) {
      this.sel = new Set(keys);
      if ('anchor' in opts) this.anchor = opts.anchor;
      if ('cursor' in opts) this.cursor = opts.cursor;
      this.applySelection();
    }

    selectAll() {
      this.setSel(this.entries.map((en) => en.key), { cursor: this.cursor || (this.entries[0] && this.entries[0].key) || null });
    }

    clearSelection() {
      if (this.sel.size) this.setSel([], {});
    }

    selectRange(from, to, additive) {
      const a = this.entries.findIndex((en) => en.key === from);
      const b = this.entries.findIndex((en) => en.key === to);
      if (a < 0 || b < 0) return;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const keys = this.entries.slice(lo, hi + 1).map((en) => en.key);
      const next = additive ? new Set([...this.sel, ...keys]) : new Set(keys);
      this.setSel([...next], { cursor: to });
    }

    gridColumns() {
      if (this.layoutMode() !== 'grid') return 1;
      const nodes = [...this.itemEls.values()];
      if (!nodes.length) return 1;
      const top = nodes[0].offsetTop;
      let n = 0;
      while (n < nodes.length && nodes[n].offsetTop === top) n++;
      return Math.max(1, n);
    }

    moveCursor(dir, extend, keep) {
      const list = this.entries;
      const n = list.length;
      if (!n) return;
      let idx = this.cursor ? list.findIndex((en) => en.key === this.cursor) : -1;
      const cols = this.gridColumns();
      const grid = this.layoutMode() === 'grid';
      const page = Math.max(1, Math.floor(this.view.clientHeight / ((this.itemEls.values().next().value || { offsetHeight: 32 }).offsetHeight || 32))) * cols;
      let next;
      if (idx < 0) {
        next = dir === 'end' ? n - 1 : 0;
      } else {
        switch (dir) {
          case 'left': next = grid ? idx - 1 : idx; break;
          case 'right': next = grid ? idx + 1 : idx; break;
          case 'up': next = idx - cols < 0 ? idx : idx - cols; break;
          case 'down': next = idx + cols; if (next > n - 1) next = Math.floor(idx / cols) < Math.floor((n - 1) / cols) ? n - 1 : idx; break;
          case 'home': next = 0; break;
          case 'end': next = n - 1; break;
          case 'pgup': next = idx - page; break;
          case 'pgdn': next = idx + page; break;
          default: next = idx;
        }
      }
      next = U.clamp(next, 0, n - 1);
      const key = list[next].key;
      this.view.classList.add('kbd');
      if (keep) {
        this.cursor = key;
        this.applySelection();
      } else if (extend) {
        const anchor = this.anchor && this.byKey.has(this.anchor) ? this.anchor : (idx >= 0 ? list[idx].key : key);
        this.anchor = anchor;
        this.selectRange(anchor, key, false);
      } else {
        this.setSel([key], { anchor: key, cursor: key });
      }
      this.revealKey(key);
    }

    revealKey(key) {
      const node = this.itemEls.get(key);
      const v = this.view;
      if (!node || !v) return;
      const vr = v.getBoundingClientRect();
      const nr = node.getBoundingClientRect();
      const head = v.querySelector('.fm-head');
      const topPad = head ? head.offsetHeight + 2 : 4;
      if (nr.top - vr.top < topPad) v.scrollTop += nr.top - vr.top - topPad;
      else if (nr.bottom - vr.top > v.clientHeight) v.scrollTop += nr.bottom - vr.top - v.clientHeight + 4;
      if (nr.left < vr.left) v.scrollLeft += nr.left - vr.left - 4;
      else if (nr.right > vr.left + v.clientWidth) v.scrollLeft += nr.right - vr.left - v.clientWidth + 4;
    }

    typeAhead(ch) {
      clearTimeout(this.typeTimer);
      this.typeBuf += ch.toLocaleLowerCase('tr');
      this.typeTimer = this.later(() => { this.typeBuf = ''; }, 800);
      const list = this.entries;
      if (!list.length) return;
      const buf = this.typeBuf;
      let start = 0;
      if (buf.length === 1 && this.cursor) start = Math.max(0, list.findIndex((en) => en.key === this.cursor) + 1);
      for (let k = 0; k < list.length; k++) {
        const en = list[(start + k) % list.length];
        if (en.display.toLocaleLowerCase('tr').startsWith(buf)) {
          this.view.classList.add('kbd');
          this.setSel([en.key], { anchor: en.key, cursor: en.key });
          this.revealKey(en.key);
          return;
        }
      }
    }

    // ---------------------------------------------------------------- mouse
    onViewMouseDown(e) {
      if (e.button === 1 && e.target.closest && e.target.closest('.fm-item')) e.preventDefault(); // no autoscroll cursor
      if (e.button !== 0 || this.closed) return;
      const t = e.target;
      if (t.closest && t.closest('.fm-rename')) return;
      if (this.renaming) this.commitRename(false);
      if (t.closest && t.closest('.fm-head')) return;
      const vr = this.view.getBoundingClientRect();
      if (e.clientX > vr.left + this.view.clientWidth || e.clientY > vr.top + this.view.clientHeight) return; // scrollbar
      this.focusView();
      this.view.classList.remove('kbd');
      this.press = null;
      const additive = e.ctrlKey || e.metaKey;
      const node = t.closest ? t.closest('.fm-item') : null;
      if (node && this.view.contains(node)) {
        const key = node.dataset.key;
        if (e.shiftKey && this.anchor && this.byKey.has(this.anchor)) {
          this.selectRange(this.anchor, key, additive);
        } else if (additive) {
          const next = new Set(this.sel);
          if (next.has(key)) next.delete(key); else next.add(key);
          this.setSel([...next], { anchor: key, cursor: key });
        } else if (this.sel.has(key)) {
          this.cursor = key;
          if (this.sel.size > 1) this.press = key; else this.anchor = key;
          this.applySelection();
        } else {
          this.setSel([key], { anchor: key, cursor: key });
        }
        return;
      }
      if (!additive && !e.shiftKey && this.sel.size) this.setSel([], {});
      this.beginBand(e, additive || e.shiftKey);
    }

    onViewClick(e) {
      const t = e.target;
      const col = t.closest ? t.closest('.fm-col') : null;
      if (col) {
        if (this.suppressSort || (t.closest('.fm-grip'))) return;
        this.sortBy(col.dataset.sort);
        return;
      }
      const press = this.press;
      this.press = null;
      if (press && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
        const node = t.closest ? t.closest('.fm-item') : null;
        if (node && node.dataset.key === press && this.sel.size > 1) this.setSel([press], { anchor: press, cursor: press });
      }
    }

    onViewDblClick(e) {
      const t = e.target;
      if (t.closest && (t.closest('.fm-rename') || t.closest('.fm-head'))) return;
      const node = t.closest ? t.closest('.fm-item') : null;
      if (!node) return;
      const en = this.byKey.get(node.dataset.key);
      if (en) this.openEntries([en]);
    }

    beginBand(e, additive) {
      const v = this.view;
      if (this.bandOff) this.bandOff();
      const r = v.getBoundingClientRect();
      const toContent = (cx, cy) => ({ x: cx - r.left + v.scrollLeft, y: cy - r.top + v.scrollTop });
      const rects = [];
      this.itemEls.forEach((node, key) => {
        const b = node.getBoundingClientRect();
        rects.push({ key, l: b.left - r.left + v.scrollLeft, t: b.top - r.top + v.scrollTop, r: b.right - r.left + v.scrollLeft, b: b.bottom - r.top + v.scrollTop });
      });
      const st = {
        x0: e.clientX, y0: e.clientY, cx: e.clientX, cy: e.clientY, start: toContent(e.clientX, e.clientY), rects,
        base: additive ? new Set(this.sel) : new Set(), active: false, timer: 0
      };
      const update = () => {
        const cur = toContent(st.cx, st.cy);
        cur.x = U.clamp(cur.x, 0, Math.max(v.scrollWidth, 1));
        cur.y = U.clamp(cur.y, 0, Math.max(v.scrollHeight, 1));
        const l = Math.min(st.start.x, cur.x);
        const t = Math.min(st.start.y, cur.y);
        const w = Math.abs(st.start.x - cur.x);
        const h = Math.abs(st.start.y - cur.y);
        const s = this.band.style;
        s.left = `${l}px`; s.top = `${t}px`; s.width = `${w}px`; s.height = `${h}px`;
        const hit = new Set(st.base);
        let last = null;
        st.rects.forEach((q) => {
          if (q.l < l + w && q.r > l && q.t < t + h && q.b > t) { hit.add(q.key); last = q.key; }
        });
        const same = hit.size === this.sel.size && [...hit].every((k) => this.sel.has(k));
        if (!same) this.setSel([...hit], { anchor: last || this.anchor, cursor: last || this.cursor });
      };
      const onMove = (ev) => {
        st.cx = ev.clientX;
        st.cy = ev.clientY;
        if (!st.active) {
          if (Math.hypot(st.cx - st.x0, st.cy - st.y0) < 4) return;
          st.active = true;
          this.band.hidden = false;
          v.classList.add('is-banding');
          st.timer = setInterval(() => {
            const vr = v.getBoundingClientRect();
            const edge = 28;
            let dy = 0;
            if (st.cy < vr.top + edge) dy = -Math.min(34, 6 + (vr.top + edge - st.cy) / 2);
            else if (st.cy > vr.bottom - edge) dy = Math.min(34, 6 + (st.cy - (vr.bottom - edge)) / 2);
            if (dy) { v.scrollTop += dy; update(); }
          }, 40);
        }
        update();
      };
      const finish = () => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', finish, true);
        clearInterval(st.timer);
        this.band.hidden = true;
        v.classList.remove('is-banding');
        this.bandOff = null;
      };
      this.bandOff = finish;
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', finish, true);
    }

    // ---------------------------------------------------------------- open / commands
    openEntries(list) {
      if (!list.length) return;
      if (this.mode === 'trash') { this.askRestore(list[0]); return; }
      if (list.length === 1) {
        const en = list[0];
        if (en.type === 'dir') this.go(en.path);
        else P.apps.openFile(en.path);
        return;
      }
      list.forEach((en) => {
        if (en.type === 'dir') P.apps.launch('files', { path: en.path });
        else P.apps.openFile(en.path);
      });
    }

    openSelection() {
      this.openEntries(this.selected());
    }

    askRestore(en) {
      P.dialog.confirm({
        title: 'Öğe açılamıyor',
        message: `“${en.display}” Çöp Kutusu’nda olduğu için açılamıyor. Kullanmak için önce geri yüklemeniz gerekir.`,
        okText: 'Geri yükle'
      }).then((ok) => {
        if (ok && !this.closed) this.restoreEntries([en]);
      });
    }

    sortBy(key) {
      const cur = this.curSort();
      let dir = key === 'modified' || key === 'deleted' ? 'desc' : 'asc';
      if (cur && cur.key === key) dir = cur.dir === 'asc' ? 'desc' : 'asc';
      this.setSort(key, dir);
    }

    setSort(key, dir) {
      const cur = this.curSort() || { key: 'name', dir: 'asc' };
      const next = { key: key || cur.key, dir: dir || cur.dir };
      if (this.mode === 'trash') this.trashSort = next;
      else if (this.query.trim()) this.searchSort = next;
      else {
        this.prefs.sort = next;
        this.savePrefs({ sort: next });
      }
      this.refresh({ full: true, force: true });
    }

    setView(v) {
      if (!VIEWS.includes(v)) return;
      this.prefs.view = v;
      this.savePrefs({ view: v });
      if (this.thumbs.size > 400) this.thumbs.clear();
      this.refresh({ full: true, force: true });
      if (this.cursor) this.revealKey(this.cursor);
    }

    toggleHidden() {
      this.prefs.hidden = !this.prefs.hidden;
      this.savePrefs({ hidden: this.prefs.hidden });
      this.refresh({ full: true, force: true });
    }

    cutSelected() {
      const sel = this.selected();
      if (!sel.length || this.mode === 'trash') return;
      if (sel.some((en) => fs.isProtected(en.path))) { this.fail('Kesilemedi', 'Korumalı bir öğe kesilemez.'); return; }
      P.clipboard.set({ op: 'cut', paths: sel.map((en) => en.path) });
    }

    copySelected() {
      const sel = this.selected();
      if (!sel.length || this.mode === 'trash') return;
      P.clipboard.set({ op: 'copy', paths: sel.map((en) => en.path) });
    }

    /** Moves / copies paths into dest. Returns the new paths. Same-folder moves are silent no-ops. */
    transfer(paths, dest, op) {
      const created = [];
      const errors = [];
      const conflicts = [];
      this.runBatch(() => {
        paths.forEach((src) => {
          try {
            if (!fs.exists(src)) throw new fs.FSError('ENOENT', `“${fs.basename(src)}” artık yok.`, src);
            if (op === 'move') {
              if (fs.dirname(src) === dest) return;
              if (fs.exists(fs.join(dest, fs.basename(src))) && !(fs.isDir(src) && (dest === src || dest.startsWith(`${src}/`)))) {
                conflicts.push(src);
                return;
              }
              created.push(fs.move(src, dest));
            } else {
              created.push(fs.copy(src, dest));
            }
          } catch (e) { errors.push(e); }
        });
      });
      return { created, errors, conflicts };
    }

    /** A move found same-named items at the destination: offer to keep both (the moved one gets a "kopya" name). */
    async resolveConflicts(conflicts, dest) {
      if (!conflicts.length || this.closed) return [];
      const one = conflicts.length === 1;
      const ok = await P.dialog.confirm({
        title: 'Aynı adlı öğe var',
        message: one
          ? `“${fs.basename(conflicts[0])}” hedef klasörde zaten var. İkisini de tutarsanız taşınan öğe “kopya” eki alır.`
          : `${num(conflicts.length)} öğe hedef klasörde zaten var. İkisini de tutarsanız taşınanlar “kopya” eki alır.`,
        okText: 'İkisini de tut',
        cancelText: 'Atla'
      });
      if (!ok) return [];
      const made = [];
      const errors = [];
      this.runBatch(() => {
        conflicts.forEach((src) => {
          try {
            if (fs.isProtected(src)) throw new fs.FSError('EPERM', `“${fs.basename(src)}” korumalı bir öğe; taşınamaz.`, src);
            const np = fs.copy(src, dest);
            fs.remove(src, { recursive: true });
            made.push(np);
          } catch (e) { errors.push(e); }
        });
      });
      this.reportErrors('Taşınamadı', errors);
      return made;
    }

    /** Common tail of paste / drop: report errors, select what arrived, settle name conflicts. */
    finishTransfer(res, dest, label, op, onMoved) {
      this.reportErrors(label, res.errors);
      const show = (paths) => {
        if (dest === this.cwd && paths.length && !this.closed && this.mode === 'folder') {
          this.setSel(paths, { anchor: paths[0], cursor: paths[paths.length - 1] });
          this.revealKey(paths[0]);
        }
      };
      show(res.created);
      if (res.conflicts.length) {
        this.resolveConflicts(res.conflicts, dest).then((more) => {
          if (more.length) { show(res.created.concat(more)); if (onMoved) onMoved(); }
        });
      }
    }

    paste(dest) {
      if (this.mode === 'trash') return;
      dest = dest || this.cwd;
      const clip = P.clipboard.get();
      if (!clip) return;
      const op = clip.op === 'cut' ? 'move' : 'copy';
      const res = this.transfer(clip.paths, dest, op);
      const clear = () => { const c = P.clipboard.get(); if (c && c.op === 'cut') P.clipboard.clear(); };
      if (op === 'move' && res.created.length) clear();
      this.finishTransfer(res, dest, op === 'move' ? 'Taşınamadı' : 'Kopyalanamadı', op, op === 'move' ? clear : null);
    }

    trashPaths(paths) {
      let done = 0;
      const errors = [];
      this.runBatch(() => {
        paths.forEach((p) => {
          try { fs.trash(p); done++; } catch (e) { errors.push(e); }
        });
      });
      if (done && P.sound && P.sound.play) P.sound.play('trash');
      this.reportErrors('Çöp kutusuna taşınamadı', errors);
      return done;
    }

    trashSelected() {
      if (this.mode === 'trash') { this.purgeSelected(); return; }
      const sel = this.selected();
      if (!sel.length) return;
      this.trashPaths(sel.map((en) => en.path));
    }

    async deleteForever(list) {
      if (!list.length || this.closed) return;
      const one = list.length === 1;
      const ok = await P.dialog.confirm({
        title: 'Kalıcı olarak sil',
        message: one
          ? `“${list[0].display}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`
          : `Seçili ${num(list.length)} öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
        okText: 'Sil',
        danger: true
      });
      if (!ok || this.closed) return;
      const errors = [];
      let done = 0;
      this.runBatch(() => {
        list.forEach((en) => {
          try { fs.remove(en.path, { recursive: true }); done++; } catch (e) { errors.push(e); }
        });
      });
      if (done && P.sound && P.sound.play) P.sound.play('trash');
      this.reportErrors('Silinemedi', errors);
    }

    deleteForeverSelected() {
      if (this.mode === 'trash') { this.purgeSelected(); return; }
      this.deleteForever(this.selected().filter((en) => !fs.isProtected(en.path)));
    }

    createItem(kind) {
      if (this.mode === 'trash' || this.closed) return;
      if (this.query.trim()) this.clearSearch();
      this.cancelRename();
      const dir = this.cwd;
      let path;
      try {
        if (kind === 'dir') path = fs.mkdir(fs.join(dir, fs.uniqueName(dir, 'Yeni Klasör')));
        else path = fs.writeFile(fs.join(dir, fs.uniqueName(dir, 'Yeni Metin Belgesi.txt')), '');
      } catch (e) {
        this.fail(kind === 'dir' ? 'Klasör oluşturulamadı' : 'Belge oluşturulamadı', errText(e));
        return;
      }
      this.refresh({ force: true });
      this.setSel([path], { anchor: path, cursor: path });
      this.revealKey(path);
      this.startRename(path);
    }

    renameSelected() {
      if (this.mode === 'trash') return;
      const sel = this.selected();
      if (sel.length !== 1) return;
      this.startRename(sel[0].key);
    }

    showProperties(path) {
      if (!path || !P.dialog || !P.dialog.properties) return;
      P.dialog.properties(path);
    }

    openTerminal(path) {
      P.apps.launch('terminal', { cwd: path });
    }

    // trash view operations --------------------------------------------------------
    restoreEntries(list) {
      if (!list.length) return;
      let ok = 0;
      let lastDir = null;
      const errors = [];
      this.runBatch(() => {
        list.forEach((en) => {
          try { const p = fs.restore(en.id); ok++; lastDir = fs.dirname(p); } catch (e) { errors.push(e); }
        });
      });
      if (ok && typeof P.notify === 'function') {
        const dir = lastDir;
        P.notify({
          title: 'Geri yüklendi',
          message: ok === 1 ? `“${list[0].display}” özgün konumuna geri yüklendi.` : `${num(ok)} öğe özgün konumlarına geri yüklendi.`,
          icon: 'files',
          timeout: 4000,
          onClick: () => { if (dir) P.apps.launch('files', { path: dir }); }
        });
      }
      this.reportErrors('Geri yüklenemedi', errors);
    }

    restoreSelected() {
      this.restoreEntries(this.selected());
    }

    async purgeSelected() {
      const list = this.selected();
      if (!list.length || this.closed) return;
      const one = list.length === 1;
      const ok = await P.dialog.confirm({
        title: 'Kalıcı olarak sil',
        message: one
          ? `“${list[0].display}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`
          : `Seçili ${num(list.length)} öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
        okText: 'Sil',
        danger: true
      });
      if (!ok || this.closed) return;
      const errors = [];
      this.runBatch(() => {
        list.forEach((en) => { try { fs.deleteFromTrash(en.id); } catch (e) { errors.push(e); } });
      });
      this.reportErrors('Silinemedi', errors);
    }

    async emptyTrash() {
      const n = fs.trashCount();
      if (!n || this.closed) return;
      const ok = await P.dialog.confirm({
        title: 'Çöp kutusunu boşalt',
        message: n === 1
          ? 'Çöp kutusundaki öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.'
          : `Çöp kutusundaki ${num(n)} öğenin tümü kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
        okText: 'Boşalt',
        danger: true
      });
      if (!ok || this.closed) return;
      try { fs.emptyTrash(); if (P.sound && P.sound.play) P.sound.play('trash'); } catch (e) { this.fail('Çöp kutusu boşaltılamadı', errText(e)); }
    }

    // ---------------------------------------------------------------- inline rename
    startRename(key) {
      if (this.mode === 'trash' || this.closed) return;
      const en = this.byKey.get(key);
      const node = this.itemEls.get(key);
      if (!en || !node) return;
      if (fs.isProtected(en.path)) { this.fail('Yeniden adlandırılamadı', `“${en.display}” korumalı bir öğe; adı değiştirilemez.`); return; }
      if (this.renaming) this.commitRename(false);
      if (this.editingAddr) this.stopAddressEdit(false);
      const grid = this.layoutMode() === 'grid';
      const input = el(grid ? 'textarea' : 'input', { class: 'fm-rename', spellcheck: false, autocomplete: 'off', 'aria-label': 'Yeni ad' });
      if (grid) input.rows = 1; else input.type = 'text';
      input.value = en.display;
      const rec = { key, en, input, node, original: en.display, committing: false };
      this.renaming = rec;
      node.classList.add('renaming');
      node.draggable = false;
      const host = grid ? node : node.querySelector('.fm-c-name');
      host.appendChild(input);
      const fit = () => { if (grid) { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; } };
      input.addEventListener('input', () => { input.classList.remove('invalid'); fit(); });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.commitRename(true); } else if (e.key === 'Escape') {
          e.preventDefault();
          this.cancelRename();
          this.focusView();
        }
      });
      ['mousedown', 'click', 'dblclick', 'pointerdown'].forEach((t) => input.addEventListener(t, (e) => e.stopPropagation()));
      input.addEventListener('blur', () => { if (this.renaming === rec && !rec.committing) this.commitRename(false); });
      input.focus();
      fit();
      // select the stem only (not the extension), like Explorer
      const dot = en.type === 'file' && !en.isApp ? en.display.lastIndexOf('.') : -1;
      try { if (dot > 0) input.setSelectionRange(0, dot); else input.select(); } catch (e) { /* ignore */ }
    }

    cancelRename() {
      const rec = this.renaming;
      if (!rec) return;
      this.renaming = null;
      rec.node.classList.remove('renaming');
      rec.node.draggable = this.mode !== 'trash';
      if (rec.input.parentNode) rec.input.remove();
      if (this.pendingRefresh) this.refresh();
    }

    /** Applies the new name. strict (Enter): keep editing on errors; blur: report and revert. */
    commitRename(strict) {
      const rec = this.renaming;
      if (!rec || rec.committing) return true;
      let name = rec.input.value.replace(/[\r\n]+/g, ' ').trim();
      if (!name || name === rec.original) { this.cancelRename(); return true; }
      if (rec.en.isApp && !/\.app$/i.test(name)) name += '.app';
      rec.committing = true;
      let newPath;
      try {
        newPath = fs.rename(rec.en.path, name);
      } catch (e) {
        rec.committing = false;
        this.fail('Yeniden adlandırılamadı', errText(e));
        if (strict) {
          rec.input.classList.add('invalid');
          rec.input.focus();
          rec.input.select();
          return false;
        }
        this.cancelRename();
        return false;
      }
      this.renaming = null;
      rec.node.classList.remove('renaming');
      if (!this.sel.has(newPath)) this.setSel([newPath], { anchor: newPath, cursor: newPath });
      this.refresh({ force: true });
      this.revealKey(newPath);
      if (strict) this.focusView();
      return true;
    }

    // ---------------------------------------------------------------- menus
    openMenuFrom(btn, items) {
      const cm = P.contextMenu;
      if (!cm) return;
      if (this.menuPress === btn) { this.menuPress = null; return; }
      const r = btn.getBoundingClientRect();
      btn.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      this.menuBtn = btn;
      cm.show(r.left, r.bottom + 4, items, {
        onClose: () => {
          btn.classList.remove('open');
          btn.removeAttribute('aria-expanded');
          if (this.menuBtn === btn) this.menuBtn = null;
        }
      });
    }

    newMenu() {
      return [
        { label: 'Klasör', icon: 'folder-plus', action: () => this.createItem('dir') },
        { label: 'Metin belgesi', icon: 'file-plus', action: () => this.createItem('file') }
      ];
    }

    sortMenu() {
      const trash = this.mode === 'trash';
      const cur = this.curSort();
      const keys = trash
        ? [['name', 'Ad'], ['origin', 'Özgün konum'], ['deleted', 'Silinme tarihi'], ['size', 'Boyut']]
        : [['name', 'Ad'], ['modified', 'Değiştirilme tarihi'], ['type', 'Tür'], ['size', 'Boyut']];
      return keys.map(([k, label]) => ({ label, checked: !!cur && cur.key === k, action: () => this.setSort(k, null) }))
        .concat([
          { type: 'separator' },
          { label: 'Artan', checked: !!cur && cur.dir === 'asc', action: () => this.setSort(null, 'asc') },
          { label: 'Azalan', checked: !!cur && cur.dir === 'desc', action: () => this.setSort(null, 'desc') }
        ]);
    }

    viewMenu() {
      return [
        ...VIEWS.map((v) => ({ label: VIEW_LABELS[v], checked: this.prefs.view === v, action: () => this.setView(v) })),
        { type: 'separator' },
        { label: 'Gizli öğeleri göster', checked: this.prefs.hidden, action: () => this.toggleHidden() }
      ];
    }

    openWithItems(en) {
      const defs = P.apps.forExtension(en.ext).slice();
      const np = P.apps.get('notepad');
      if (np && !defs.some((d) => d.id === np.id)) defs.push(np);
      return defs.map((d) => ({ label: d.name, icon: d.icon, action: () => P.apps.launch(d.id, { path: en.path }) }));
    }

    itemMenu(sel) {
      const one = sel.length === 1;
      const first = sel[0];
      const prot = sel.some((en) => fs.isProtected(en.path));
      const clip = P.clipboard.get();
      const items = [{ label: 'Aç', icon: 'open', shortcut: 'Enter', action: () => this.openEntries(sel) }];
      if (this.query.trim() && one) {
        items.push({ label: 'Klasörü aç', icon: 'folder-glyph', action: () => this.go(first.path) });
      }
      if (one && first.type === 'file' && !first.isApp) {
        const sub = this.openWithItems(first);
        if (sub.length) items.push({ label: 'Birlikte aç', icon: 'external', submenu: sub });
      }
      if (one && first.type === 'dir') {
        items.push({ label: 'Yeni pencerede aç', icon: 'external', action: () => P.apps.launch('files', { path: first.path }) });
      }
      items.push({ type: 'separator' });
      items.push({ label: 'Kes', icon: 'cut', shortcut: 'Ctrl+X', disabled: prot, action: () => this.cutSelected() });
      items.push({ label: 'Kopyala', icon: 'copy', shortcut: 'Ctrl+C', action: () => this.copySelected() });
      if (one && first.type === 'dir') {
        items.push({ label: 'Klasöre yapıştır', icon: 'paste', disabled: !clip, action: () => this.paste(first.path) });
      }
      items.push({ type: 'separator' });
      items.push({ label: 'Yeniden adlandır', icon: 'edit', shortcut: 'F2', disabled: !one || prot, action: () => this.startRename(first.key) });
      items.push({ label: 'Sil', icon: 'delete', shortcut: 'Del', danger: true, disabled: prot, action: () => this.trashSelected() });
      items.push({ type: 'separator' });
      if (one && first.type === 'dir') {
        items.push({ label: 'Terminalde aç', icon: 'terminal-glyph', action: () => this.openTerminal(first.path) });
      }
      items.push({ label: 'Özellikler', icon: 'info-glyph', shortcut: 'Alt+Enter', disabled: !one, action: () => this.showProperties(first.path) });
      return items;
    }

    trashItemMenu(sel) {
      return [
        { label: 'Geri yükle', icon: 'undo', action: () => this.restoreEntries(sel) },
        { label: 'Kalıcı olarak sil', icon: 'x', danger: true, shortcut: 'Del', action: () => this.purgeSelected() }
      ];
    }

    backgroundMenu() {
      if (this.mode === 'trash') {
        return [
          { label: 'Sırala', icon: 'sort', submenu: this.sortMenu() },
          { label: 'Yenile', icon: 'refresh', shortcut: 'F5', action: () => this.refresh({ full: true, force: true }) },
          { type: 'separator' },
          { label: 'Çöp kutusunu boşalt', icon: 'delete', danger: true, disabled: !fs.trashCount(), action: () => this.emptyTrash() }
        ];
      }
      const clip = P.clipboard.get();
      const searching = !!this.query.trim();
      return [
        { label: 'Görünüm', icon: 'grid', submenu: this.viewMenu() },
        { label: 'Sırala', icon: 'sort', submenu: this.sortMenu() },
        { label: 'Yenile', icon: 'refresh', shortcut: 'F5', action: () => this.refresh({ full: true, force: true }) },
        { type: 'separator' },
        !searching && { label: 'Yapıştır', icon: 'paste', shortcut: 'Ctrl+V', disabled: !clip, action: () => this.paste() },
        !searching && { label: 'Yeni', icon: 'plus', submenu: this.newMenu() },
        !searching && { type: 'separator' },
        { label: 'Terminalde aç', icon: 'terminal-glyph', action: () => this.openTerminal(this.cwd) },
        { label: 'Özellikler', icon: 'info-glyph', action: () => this.showProperties(this.cwd) }
      ];
    }

    onViewContext(e) {
      if (e.target.closest && e.target.closest('.fm-rename')) return; // native text menu
      e.preventDefault();
      if (this.closed) return;
      if (this.renaming) this.commitRename(false);
      this.focusView();
      const head = e.target.closest ? e.target.closest('.fm-head') : null;
      if (head) { P.contextMenu.show(e, this.sortMenu()); return; }
      const node = e.target.closest ? e.target.closest('.fm-item') : null;
      if (node) {
        const key = node.dataset.key;
        if (!this.sel.has(key)) this.setSel([key], { anchor: key, cursor: key });
        else { this.cursor = key; this.applySelection(); }
        const sel = this.selected();
        if (!sel.length) return;
        P.contextMenu.show(e, this.mode === 'trash' ? this.trashItemMenu(sel) : this.itemMenu(sel));
        return;
      }
      if (this.sel.size) this.setSel([], {});
      P.contextMenu.show(e, this.backgroundMenu());
    }

    onSideContext(e) {
      const b = e.target.closest ? e.target.closest('.fm-side-item') : null;
      if (!b) { e.preventDefault(); return; }
      e.preventDefault();
      const path = b.dataset.path;
      let items;
      if (path === TRASH) {
        items = [
          { label: 'Aç', icon: 'open', action: () => this.go(TRASH) },
          { label: 'Yeni pencerede aç', icon: 'external', action: () => P.apps.launch('files', { path: TRASH }) },
          { type: 'separator' },
          { label: 'Çöp kutusunu boşalt', icon: 'delete', danger: true, disabled: !fs.trashCount(), action: () => this.emptyTrash() }
        ];
      } else {
        items = [
          { label: 'Aç', icon: 'open', action: () => this.go(path) },
          { label: 'Yeni pencerede aç', icon: 'external', action: () => P.apps.launch('files', { path }) },
          { type: 'separator' },
          { label: 'Terminalde aç', icon: 'terminal-glyph', action: () => this.openTerminal(path) },
          { label: 'Özellikler', icon: 'info-glyph', action: () => this.showProperties(path) }
        ];
      }
      P.contextMenu.show(e, items);
    }

    // ---------------------------------------------------------------- keyboard
    onKey(e) {
      if (this.closed) return;
      const t = e.target;
      const key = e.key;
      const low = typeof key === 'string' ? key.toLowerCase() : '';
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const shift = e.shiftKey;
      const editable = U.isEditable(t);

      // shortcuts that work from anywhere in the window
      if ((ctrl && !alt && low === 'f') || key === 'F3' || (ctrl && low === 'e')) { e.preventDefault(); this.focusSearch(); return; }
      if (key === 'F4' || (ctrl && low === 'l') || (alt && low === 'd')) { e.preventDefault(); this.editAddress(); return; }
      if (key === 'F5' || (ctrl && !shift && low === 'r')) { e.preventDefault(); this.refresh({ full: true, force: true }); return; }
      if (editable) return;
      if (alt && !ctrl && !shift) {
        if (key === 'ArrowLeft') { e.preventDefault(); this.goHistory(-1); return; }
        if (key === 'ArrowRight') { e.preventDefault(); this.goHistory(1); return; }
        if (key === 'ArrowUp') { e.preventDefault(); this.goUp(); return; }
      }
      if (ctrl && shift && low === 'n') { e.preventDefault(); this.createItem('dir'); return; }

      const inView = t === document.body || t === this.win.el || t === this.view || this.view.contains(t);
      if (!inView) return;
      let handled = true;
      const trash = this.mode === 'trash';
      switch (key) {
        case 'Enter':
          if (alt) { const s = this.selected(); if (s.length === 1 && !trash) this.showProperties(s[0].path); else if (!s.length && !trash) this.showProperties(this.cwd); } else this.openSelection();
          break;
        case 'F2': if (!trash) this.renameSelected(); else handled = false; break;
        case 'Delete':
          if (trash) this.purgeSelected();
          else if (shift) this.deleteForeverSelected();
          else this.trashSelected();
          break;
        case 'Backspace': this.goHistory(-1); break;
        case 'Escape':
          if (this.sel.size) this.clearSelection();
          else if (this.query) this.clearSearch();
          else handled = false;
          break;
        case 'ArrowLeft': this.moveCursor('left', shift, ctrl); break;
        case 'ArrowRight': this.moveCursor('right', shift, ctrl); break;
        case 'ArrowUp': this.moveCursor('up', shift, ctrl); break;
        case 'ArrowDown': this.moveCursor('down', shift, ctrl); break;
        case 'Home': this.moveCursor('home', shift, false); break;
        case 'End': this.moveCursor('end', shift, false); break;
        case 'PageUp': this.moveCursor('pgup', shift, false); break;
        case 'PageDown': this.moveCursor('pgdn', shift, false); break;
        case ' ':
          if (this.cursor && this.byKey.has(this.cursor)) {
            if (ctrl) {
              const next = new Set(this.sel);
              if (next.has(this.cursor)) next.delete(this.cursor); else next.add(this.cursor);
              this.setSel([...next], { anchor: this.cursor });
            } else this.setSel([this.cursor], { anchor: this.cursor });
          }
          break;
        case 'ContextMenu': this.keyboardMenu(); break;
        case 'F10': if (shift) this.keyboardMenu(); else handled = false; break;
        default:
          if (ctrl && !alt && low === 'a') this.selectAll();
          else if (ctrl && !alt && low === 'c') this.copySelected();
          else if (ctrl && !alt && low === 'x') this.cutSelected();
          else if (ctrl && !alt && low === 'v') this.paste();
          else if (!ctrl && !alt && key.length === 1) this.typeAhead(key);
          else handled = false;
      }
      if (handled) e.preventDefault();
    }

    keyboardMenu() {
      const cur = this.cursor ? this.itemEls.get(this.cursor) : null;
      if (cur && this.sel.size) {
        const r = cur.getBoundingClientRect();
        const sel = this.selected();
        P.contextMenu.show(r.left + Math.min(r.width / 2, 60), r.bottom - 6, this.mode === 'trash' ? this.trashItemMenu(sel) : this.itemMenu(sel));
      } else {
        const r = this.view.getBoundingClientRect();
        P.contextMenu.show(r.left + 40, r.top + 40, this.backgroundMenu());
      }
    }

    // ---------------------------------------------------------------- drag & drop
    onDragStart(e) {
      const node = e.target.closest ? e.target.closest('.fm-item') : null;
      if (!node || this.mode === 'trash' || this.renaming) { e.preventDefault(); return; }
      const key = node.dataset.key;
      if (!this.sel.has(key)) this.setSel([key], { anchor: key, cursor: key });
      const paths = this.selected().map((en) => en.path).filter(Boolean);
      if (!paths.length) { e.preventDefault(); return; }
      currentDrag = { paths };
      this.dragging = true;
      this.hideTipAndMenu();
      const dt = e.dataTransfer;
      if (dt) {
        try {
          dt.effectAllowed = 'copyMove';
          dt.setData(MIME, JSON.stringify(paths));
          dt.setData('text/plain', paths.join('\n'));
          const g = this.buildGhost(paths.length, this.byKey.get(key));
          dt.setDragImage(g, 24, 24);
        } catch (err) { /* synthetic events may lack parts of DataTransfer */ }
      }
      this.view.classList.add('is-dragging');
    }

    buildGhost(count, en) {
      const g = el('div', { class: 'app-files fm-ghost' }, el('div', { class: 'fm-ghost-ico', html: svg(en ? en.icon : 'file') }));
      if (count > 1) g.appendChild(el('span', { class: 'fm-ghost-badge', text: String(count) }));
      document.body.appendChild(g);
      setTimeout(() => g.remove(), 0);
      return g;
    }

    onDragEnd() {
      currentDrag = null;
      this.dragging = false;
      this.view.classList.remove('is-dragging');
      this.clearDropMark();
      if (this.pendingRefresh) this.refresh({ afterDrag: true });
    }

    clearDropMark() {
      if (this.dropEl) { this.dropEl.classList.remove('drop-target'); this.dropEl = null; }
      this.view.classList.remove('drop-bg');
    }

    acceptsDrag(e) {
      const dt = e.dataTransfer;
      if (!dt) return false;
      return Array.from(dt.types || []).includes(MIME);
    }

    /** Where would a drop at this event land? -> { path, el } | null */
    dropTargetFor(e) {
      const t = e.target;
      const node = t && t.closest ? t.closest('[data-drop]') : null;
      if (node && this.body.contains(node)) return { path: node.dataset.drop, el: node };
      if (t && t.closest && t.closest('.fm-view') && this.mode === 'folder' && !this.query.trim() && !t.closest('.fm-head')) {
        return { path: this.cwd, el: this.view, bg: true };
      }
      return null;
    }

    canDrop(paths, dest, copy) {
      if (dest === TRASH) return !paths || paths.some((p) => !fs.isProtected(p));
      if (!paths) return true;
      return paths.some((p) => {
        if (dest === p || dest.startsWith(`${p}/`)) return false;
        if (!copy && fs.dirname(p) === dest) return false;
        return true;
      });
    }

    acceptsFiles(e) {
      const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
      return types.includes('Files') && !types.includes(MIME);
    }

    onDragOver(e) {
      if (this.acceptsFiles(e)) {
        // files from the real computer land in the folder under the pointer (or the open folder)
        const tgt = this.mode === 'folder' && !this.query.trim() ? this.dropTargetFor(e) : null;
        if (!tgt || tgt.path === TRASH) { this.clearDropMark(); return; }
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { /* ignore */ }
        this.markDrop(tgt);
        return;
      }
      if (!this.acceptsDrag(e)) return;
      const tgt = this.dropTargetFor(e);
      const copy = !!(e.ctrlKey || e.metaKey);
      if (!tgt || !this.canDrop(currentDrag ? currentDrag.paths : null, tgt.path, copy)) {
        this.clearDropMark();
        try { e.dataTransfer.dropEffect = 'none'; } catch (err) { /* ignore */ }
        return;
      }
      e.preventDefault();
      try { e.dataTransfer.dropEffect = tgt.path === TRASH ? 'move' : (copy ? 'copy' : 'move'); } catch (err) { /* ignore */ }
      this.markDrop(tgt);
    }

    markDrop(tgt) {
      if (tgt.bg) {
        if (this.dropEl) { this.dropEl.classList.remove('drop-target'); this.dropEl = null; }
        this.view.classList.add('drop-bg');
      } else {
        this.view.classList.remove('drop-bg');
        if (this.dropEl !== tgt.el) {
          if (this.dropEl) this.dropEl.classList.remove('drop-target');
          this.dropEl = tgt.el;
          tgt.el.classList.add('drop-target');
        }
      }
    }

    onDragLeave(e) {
      if (e.relatedTarget && this.body.contains(e.relatedTarget)) return;
      this.clearDropMark();
    }

    /** Text and image files dropped from the real computer are stored in dest. */
    importFiles(list, dest) {
      const files = Array.from(list || []);
      if (!files.length || this.closed) return;
      const made = [];
      const errors = [];
      let pending = files.length;
      const done = () => {
        pending -= 1;
        if (pending > 0 || this.closed) return;
        this.reportErrors('İçe aktarılamadı', errors);
        if (!made.length) return;
        if (dest === this.cwd && this.mode === 'folder' && !this.query.trim()) {
          this.setSel(made, { anchor: made[0], cursor: made[made.length - 1] });
          this.revealKey(made[0]);
        }
        if (typeof P.notify === 'function') {
          P.notify({
            title: 'Dosyalar içe aktarıldı',
            message: made.length === 1 ? `“${fs.basename(made[0])}” eklendi.` : `${num(made.length)} dosya eklendi.`,
            icon: 'files', timeout: 3500
          });
        }
      };
      files.forEach((file) => {
        const ext = extOf(file.name);
        const mime = String(file.type || '');
        const isImage = IMPORT_IMAGE.has(ext) || (!IMPORT_TEXT.has(ext) && mime.startsWith('image/'));
        const isText = IMPORT_TEXT.has(ext) || (!isImage && mime.startsWith('text/'));
        if ((!isText && !isImage) || file.size > IMPORT_MAX) {
          errors.push(new Error(`“${file.name}” desteklenmiyor ya da çok büyük. Metin ve resim dosyaları (en fazla 2 MB) aktarılabilir.`));
          done();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const name = fs.uniqueName(dest, file.name);
            made.push(fs.writeFile(fs.join(dest, name), String(reader.result)));
          } catch (err) { errors.push(err); }
          done();
        };
        reader.onerror = () => { errors.push(new Error(`“${file.name}” okunamadı.`)); done(); };
        if (isImage) reader.readAsDataURL(file); else reader.readAsText(file);
      });
    }

    onDrop(e) {
      if (this.acceptsFiles(e)) {
        const tgt = this.mode === 'folder' && !this.query.trim() ? this.dropTargetFor(e) : null;
        this.clearDropMark();
        if (!tgt || tgt.path === TRASH) return;
        e.preventDefault();
        this.importFiles(e.dataTransfer.files, tgt.path);
        return;
      }
      if (!this.acceptsDrag(e)) return;
      const tgt = this.dropTargetFor(e);
      this.clearDropMark();
      if (!tgt) return;
      e.preventDefault();
      let paths = [];
      try { paths = JSON.parse(e.dataTransfer.getData(MIME) || '[]'); } catch (err) { paths = []; }
      paths = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p.charAt(0) === '/');
      if (!paths.length) return;
      const copy = !!(e.ctrlKey || e.metaKey);
      if (tgt.path === TRASH) { this.trashPaths(paths); return; }
      if (!this.canDrop(paths, tgt.path, copy)) return;
      const res = this.transfer(paths, tgt.path, copy ? 'copy' : 'move');
      this.finishTransfer(res, tgt.path, copy ? 'Kopyalanamadı' : 'Taşınamadı', copy ? 'copy' : 'move', null);
    }
  }

  // ================================================================ registration
  function launch(win, args) {
    const fm = new FileManager(win, args);
    win.state.fm = fm;
  }

  P.apps.register({
    id: 'files',
    name: 'Dosyalar',
    icon: 'files',
    description: 'Dosyaları ve klasörleri yönet',
    category: 'system',
    fileTypes: [],
    singleInstance: false,
    window: { width: 880, height: 560, minWidth: 520, minHeight: 340 },
    launch
  });
})();
