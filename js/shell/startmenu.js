/* PandaOS start menu (C3b) — search (apps + files), pinned app grid, recent files, user tile
   and power menu. Renders into #start-menu. Public API: PandaOS.startMenu (docs/API.md §8). */
(function () {
  'use strict';

  const P = window.PandaOS;
  if (!P) return;
  const { el } = P.util;
  const bus = P.bus;
  const settings = P.settings;
  const storage = P.storage;

  const RECENT_MAX = 6;
  const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">';

  // ------------------------------------------------------------------ helpers
  function iconMarkup(name) {
    if (!name) name = 'file-app';
    if (typeof name === 'string' && name.trim().startsWith('<svg')) return name;
    if (P.icons && typeof P.icons.get === 'function') {
      try { return P.icons.get(name); } catch (e) { /* fall through */ }
    }
    return SVG_OPEN + '<circle cx="12" cy="12" r="8"/></svg>';
  }

  /** lower-case, strip Turkish diacritics; always keeps the string length (index safe) */
  function fold(s) {
    let out = '';
    for (const ch of String(s == null ? '' : s)) {
      let c = ch.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (c === 'ı') c = 'i';
      out += c.length === ch.length ? c : ch;
    }
    return out;
  }

  function highlight(text, tokens) {
    const frag = document.createDocumentFragment();
    const f = fold(text);
    if (!tokens.length || f.length !== text.length) { frag.append(text); return frag; }
    const mask = new Array(text.length).fill(false);
    tokens.forEach((t) => {
      if (!t) return;
      let i = f.indexOf(t);
      while (i >= 0) {
        for (let j = i; j < i + t.length; j++) mask[j] = true;
        i = f.indexOf(t, i + t.length);
      }
    });
    let i = 0;
    while (i < text.length) {
      let j = i;
      while (j < text.length && mask[j] === mask[i]) j++;
      const seg = text.slice(i, j);
      frag.append(mask[i] ? el('mark', { class: 'sm-hl', text: seg }) : seg);
      i = j;
    }
    return frag;
  }

  function safe(label, fn) {
    try { return fn(); } catch (e) { console.error(`[startmenu] ${label}`, e); return undefined; }
  }

  function toast(title, message, icon) {
    if (typeof P.notify === 'function') safe('notify', () => P.notify({ title, message, icon: icon || 'info', timeout: 3500 }));
  }

  const appList = () => (P.apps && P.apps.list ? P.apps.list() : []).filter((d) => d.showInStartMenu !== false);
  const fsOk = () => !!(P.fs && typeof P.fs.exists === 'function');

  function prettyDir(path) {
    const fs = P.fs;
    if (!fs) return '';
    const dir = fs.dirname(path);
    const home = fs.HOME || '/home/panda';
    if (dir === home) return 'Ana klasör';
    if (dir.startsWith(home + '/')) return dir.slice(home.length + 1);
    return dir;
  }

  // ------------------------------------------------------------------ state
  let inited = false;
  let isOpen = false;
  let layer, panel, input, clearBtn, homeEl, resultsEl, gridEl, recentEl, secMeta, powerBtn, powerMenu;
  let query = '';
  let results = []; // [{type:'app'|'file', def|stat, node}]
  let sel = 0;
  let powerOpen = false;
  let metaDown = false;
  let metaCombo = false;

  // ------------------------------------------------------------------ recent files
  function recentList() {
    const list = storage.get('recent', []);
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
  }

  function trackRecent(path) {
    if (typeof path !== 'string' || path[0] !== '/') return;
    if (fsOk()) {
      try { if (P.fs.isDir(path)) return; } catch (e) { return; }
    }
    const list = recentList().filter((p) => p !== path);
    list.unshift(path);
    storage.set('recent', list.slice(0, RECENT_MAX));
    if (isOpen && !query) renderRecent();
  }

  // ------------------------------------------------------------------ rendering: home
  function appTile(def, index, animate) {
    const b = el('button', { class: 'sm-app', type: 'button', dataset: { app: def.id }, 'aria-label': def.name },
      el('span', { class: 'sm-app-ico', html: iconMarkup(def.icon) }),
      el('span', { class: 'sm-app-name', text: def.name }));
    if (animate) { b.classList.add('anim'); b.style.setProperty('--i', String(index)); }
    b.addEventListener('click', () => launchApp(def.id));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      appMenu(def, e.clientX, e.clientY);
    });
    return b;
  }

  /** Pinned apps (the taskbar's pin list, in its order) come first, everything else follows alphabetically. */
  function orderedApps() {
    const apps = appList();
    const pinned = settings.get('taskbar.pinned');
    if (!Array.isArray(pinned) || !pinned.length) return apps;
    const first = [];
    pinned.forEach((id) => {
      const def = apps.find((d) => d.id === id);
      if (def && !first.includes(def)) first.push(def);
    });
    return first.concat(apps.filter((d) => !first.includes(d)));
  }

  function renderHome(animate) {
    const apps = orderedApps();
    gridEl.textContent = '';
    apps.forEach((def, i) => gridEl.appendChild(appTile(def, i, animate)));
    secMeta.textContent = `${apps.length} uygulama`;
    renderRecent();
  }

  function renderRecent() {
    if (!recentEl) return;
    recentEl.textContent = '';
    const fs = P.fs;
    const items = fsOk() ? recentList().filter((p) => fs.exists(p) && fs.isFile(p)).slice(0, RECENT_MAX) : [];
    if (!items.length) {
      recentEl.classList.add('empty');
      recentEl.appendChild(el('div', { class: 'sm-rec-empty' },
        el('span', { class: 'sm-rec-empty-ico', html: iconMarkup('file-text') }),
        el('span', { text: 'Son açtığın dosyalar burada görünecek.' })));
      return;
    }
    recentEl.classList.remove('empty');
    items.forEach((path) => {
      let iconName = 'file';
      try { iconName = (P.icons && P.icons.forFile && P.icons.forFile(path)) || 'file'; } catch (e) { /* ignore */ }
      const b = el('button', { class: 'sm-rec', type: 'button', dataset: { path }, 'aria-label': fs.displayName ? fs.displayName(path) : fs.basename(path) },
        el('span', { class: 'sm-rec-ico', html: iconMarkup(iconName) }),
        el('span', { class: 'sm-rec-text' },
          el('span', { class: 'sm-rec-name', text: fs.displayName ? fs.displayName(path) : fs.basename(path) }),
          el('span', { class: 'sm-rec-sub', text: prettyDir(path) })));
      b.addEventListener('click', () => openPath(path));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu(e.clientX, e.clientY, [
          { label: 'Aç', icon: 'open', action: () => openPath(path) },
          { label: 'Listeden kaldır', icon: 'x', action: () => { storage.set('recent', recentList().filter((p) => p !== path)); renderRecent(); } }
        ]);
      });
      recentEl.appendChild(b);
    });
  }

  // ------------------------------------------------------------------ search
  function scoreApp(def, tokens) {
    const name = fold(def.name);
    const desc = fold(def.description || '');
    const id = fold(def.id);
    let total = 0;
    for (const t of tokens) {
      let s;
      if (name === t) s = 100;
      else if (name.startsWith(t)) s = 90;
      else if (name.split(/\s+/).some((w) => w.startsWith(t))) s = 78;
      else if (name.includes(t)) s = 64;
      else if (id.startsWith(t)) s = 58;
      else if (id.includes(t)) s = 50;
      else if (desc.split(/\s+/).some((w) => w.startsWith(t))) s = 40;
      else if (desc.includes(t)) s = 30;
      else return 0;
      total += s;
    }
    return total / tokens.length;
  }

  function searchFiles(raw, tokens) {
    if (!fsOk()) return [];
    const fs = P.fs;
    const found = new Map();
    const add = (st) => {
      if (!st || st.hidden || st.ext === '.app' || !st.path) return;
      found.set(st.path, st);
    };
    safe('fs.search', () => (fs.search(raw.trim(), { root: fs.HOME, limit: 40 }) || []).forEach(add));
    if (typeof fs.walk === 'function') {
      let n = 0;
      safe('fs.walk', () => fs.walk(fs.HOME, (st) => {
        if (++n > 4000 || !st || st.hidden) return;
        const nm = fold(st.name);
        if (tokens.every((t) => nm.includes(t))) add(st);
      }));
    }
    const scored = [...found.values()].map((st) => {
      const nm = fold(st.name);
      let s = 10;
      if (tokens.some((t) => nm.startsWith(t))) s += 20;
      if (nm === tokens.join(' ')) s += 30;
      return { st, s };
    });
    scored.sort((a, b) => (b.s - a.s) || P.util.compareNames(a.st.name, b.st.name));
    return scored.slice(0, 8).map((x) => x.st);
  }

  function runSearch(raw) {
    const tokens = fold(raw.trim()).split(/\s+/).filter(Boolean);
    const apps = appList()
      .map((def) => ({ def, score: scoreApp(def, tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => (b.score - a.score) || P.util.compareNames(a.def.name, b.def.name))
      .map((x) => x.def);
    const files = searchFiles(raw, tokens);
    return { tokens, apps, files };
  }

  function resultRow(entry, tokens) {
    let node;
    if (entry.type === 'app') {
      const d = entry.def;
      node = el('button', { class: 'sm-result', type: 'button', dataset: { app: d.id } },
        el('span', { class: 'sm-result-ico', html: iconMarkup(d.icon) }),
        el('span', { class: 'sm-result-text' },
          el('span', { class: 'sm-result-name' }, highlight(d.name, tokens)),
          el('span', { class: 'sm-result-sub', text: d.description ? `Uygulama · ${d.description}` : 'Uygulama' })));
      node.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); appMenu(d, e.clientX, e.clientY); });
    } else {
      const st = entry.stat;
      let iconName = st.type === 'dir' ? 'folder' : 'file';
      try { iconName = (P.icons && P.icons.forFile && P.icons.forFile(st)) || iconName; } catch (e) { /* ignore */ }
      node = el('button', { class: 'sm-result', type: 'button', dataset: { path: st.path } },
        el('span', { class: 'sm-result-ico', html: iconMarkup(iconName) }),
        el('span', { class: 'sm-result-text' },
          el('span', { class: 'sm-result-name' }, highlight(st.name, tokens)),
          el('span', { class: 'sm-result-sub', text: `${st.type === 'dir' ? 'Klasör' : 'Dosya'} · ${prettyDir(st.path)}` })));
    }
    node.addEventListener('click', () => activate(entry));
    node.addEventListener('mousemove', () => {
      const i = results.indexOf(entry);
      if (i >= 0 && i !== sel) setSel(i, false);
    });
    return node;
  }

  function renderResults() {
    const { tokens, apps, files } = runSearch(query);
    resultsEl.textContent = '';
    results = [];
    const section = (title, list, make) => {
      if (!list.length) return;
      resultsEl.appendChild(el('div', { class: 'sm-sec' }, el('h3', { text: title })));
      list.forEach((item) => {
        const entry = make(item);
        entry.node = resultRow(entry, tokens);
        results.push(entry);
        resultsEl.appendChild(entry.node);
      });
    };
    section('Uygulamalar', apps, (def) => ({ type: 'app', def }));
    section('Dosyalar', files, (stat) => ({ type: 'file', stat }));
    if (!results.length) {
      resultsEl.appendChild(el('div', { class: 'sm-noresult' },
        el('span', { class: 'sm-noresult-ico', html: iconMarkup('search') }),
        el('div', { class: 'sm-noresult-title', text: 'Sonuç bulunamadı' }),
        el('div', { class: 'sm-noresult-sub', text: `“${query.trim()}” için eşleşen uygulama veya dosya yok.` })));
    }
    setSel(0, false);
  }

  function setSel(i, scroll) {
    sel = Math.max(0, Math.min(results.length - 1, i));
    results.forEach((r, idx) => r.node.classList.toggle('sel', idx === sel));
    if (scroll !== false && results[sel]) results[sel].node.scrollIntoView({ block: 'nearest' });
  }

  function setQuery(q, silent) {
    query = q;
    if (input.value !== q) input.value = q;
    const searching = q.trim().length > 0;
    panel.classList.toggle('searching', searching);
    clearBtn.hidden = !q.length;
    homeEl.hidden = searching;
    resultsEl.hidden = !searching;
    if (searching) renderResults();
    else { results = []; sel = 0; }
    void silent;
  }

  // ------------------------------------------------------------------ actions
  function launchApp(id) {
    close();
    if (P.apps) P.apps.launch(id);
  }

  function openPath(path) {
    close();
    if (P.apps) P.apps.openFile(path);
  }

  function activate(entry) {
    if (!entry) return;
    if (entry.type === 'app') launchApp(entry.def.id);
    else openPath(entry.stat.path);
  }

  function showMenu(x, y, items) {
    if (P.contextMenu && typeof P.contextMenu.show === 'function') safe('contextMenu', () => P.contextMenu.show(x, y, items));
  }

  function appMenu(def, x, y) {
    const pinned = (settings.get('taskbar.pinned') || []).includes(def.id);
    showMenu(x, y, [
      { label: 'Aç', icon: 'open', action: () => launchApp(def.id) },
      {
        label: pinned ? 'Görev çubuğundan kaldır' : 'Görev çubuğuna sabitle',
        icon: 'star',
        action: () => {
          const list = (settings.get('taskbar.pinned') || []).slice();
          const i = list.indexOf(def.id);
          if (i >= 0) list.splice(i, 1); else list.push(def.id);
          settings.set('taskbar.pinned', list);
        }
      },
      { label: 'Masaüstüne kısayol ekle', icon: 'desktop', action: () => addDesktopShortcut(def) }
    ]);
  }

  function addDesktopShortcut(def) {
    const fs = P.fs;
    if (!fs) return;
    try {
      const dir = (P.desktop && P.desktop.DIR) || fs.join(fs.HOME || '/home/panda', 'Masaüstü');
      const name = fs.uniqueName(dir, `${def.name}.app`);
      fs.writeFile(fs.join(dir, name), JSON.stringify({ appId: def.id }));
      toast('Kısayol eklendi', `“${def.name}” masaüstüne eklendi.`, def.icon);
    } catch (e) {
      toast('Kısayol eklenemedi', e && e.message ? e.message : 'Bilinmeyen hata', 'error');
    }
  }

  // ------------------------------------------------------------------ power menu
  function showPowerMenu() {
    powerOpen = true;
    powerMenu.classList.add('open');
    powerBtn.classList.add('active');
    powerBtn.setAttribute('aria-expanded', 'true');
    const first = powerMenu.querySelector('.sm-pm-item');
    if (first) first.focus({ preventScroll: true });
  }

  function hidePowerMenu(restore) {
    if (!powerMenu) return;
    const had = powerMenu.contains(document.activeElement);
    powerOpen = false;
    powerMenu.classList.remove('open');
    powerBtn.classList.remove('active');
    powerBtn.setAttribute('aria-expanded', 'false');
    if (restore || had) { try { powerBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function powerAction(kind) {
    close();
    const s = P.session;
    if (!s) return;
    if (kind === 'lock' && typeof s.lock === 'function') safe('session.lock', () => s.lock());
    else if (kind === 'restart' && typeof s.restart === 'function') safe('session.restart', () => s.restart());
    else if (kind === 'shutdown' && typeof s.shutdown === 'function') safe('session.shutdown', () => s.shutdown());
  }

  // ------------------------------------------------------------------ open / close
  function open() {
    if (!inited || isOpen) return;
    if (P.session && typeof P.session.isLocked === 'function' && P.session.isLocked()) return;
    isOpen = true;
    bus.emit('popup:open', { name: 'start' });
    setQuery('');
    renderHome(true);
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    bus.emit('startmenu:toggle', { open: true });
    safe('focus', () => input.focus({ preventScroll: true }));
    setTimeout(() => { if (isOpen && !panel.contains(document.activeElement)) input.focus({ preventScroll: true }); }, 40);
  }

  function close() {
    if (!inited || !isOpen) return;
    isOpen = false;
    hidePowerMenu();
    const ae = document.activeElement;
    // focus left on the menu or on the (toggling) start button would swallow every key meant for the active window
    const parked = !!ae && (panel.contains(ae) || (ae.classList && ae.classList.contains('tb-start')));
    if (panel.contains(ae)) safe('blur', () => ae.blur());
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    bus.emit('startmenu:toggle', { open: false });
    if (parked && !(P.session && typeof P.session.isLocked === 'function' && P.session.isLocked())) {
      const wm = P.wm;
      if (wm && typeof wm.refocus === 'function') safe('wm.refocus', () => wm.refocus());
    }
  }

  function toggle() {
    if (isOpen) close(); else open();
  }

  // ------------------------------------------------------------------ keyboard
  function gridCols() {
    const cols = getComputedStyle(gridEl).gridTemplateColumns;
    return Math.max(1, cols ? cols.split(' ').length : 6);
  }

  function navigateGrid(target, key) {
    const apps = [...panel.querySelectorAll('.sm-app')];
    const recs = [...panel.querySelectorAll('.sm-rec')];
    const items = apps.concat(recs);
    const idx = items.indexOf(target);
    if (idx < 0) {
      if (key === 'ArrowDown' && items[0]) items[0].focus();
      return;
    }
    const isApp = idx < apps.length;
    const cols = isApp ? gridCols() : 2;
    let next = idx;
    if (key === 'ArrowRight') next = idx + 1;
    else if (key === 'ArrowLeft') next = idx - 1;
    else if (key === 'ArrowDown') {
      next = idx + cols;
      if (isApp && next >= apps.length) next = recs.length ? apps.length : idx;
      else if (!isApp && next >= items.length) next = idx;
    } else if (key === 'ArrowUp') {
      next = idx - cols;
      if (isApp && next < 0) { input.focus(); return; }
      if (!isApp && next < apps.length) next = Math.max(0, apps.length - 1);
    }
    if (next >= 0 && next < items.length) items[next].focus();
  }

  function onPanelKeydown(e) {
    const k = e.key;
    if (e.target === input && query.trim()) {
      if (k === 'ArrowDown') { e.preventDefault(); if (results.length) setSel((sel + 1) % results.length); }
      else if (k === 'ArrowUp') { e.preventDefault(); if (results.length) setSel((sel - 1 + results.length) % results.length); }
      else if (k === 'Enter') { e.preventDefault(); activate(results[sel]); }
      return;
    }
    if (!query.trim() && (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight')) {
      if (e.target === input && (k === 'ArrowLeft' || k === 'ArrowRight')) return;
      if (powerMenu.contains(e.target)) return;
      e.preventDefault();
      navigateGrid(e.target, k);
    }
  }

  function onDocKeydown(e) {
    if (P.session && typeof P.session.isLocked === 'function' && P.session.isLocked()) return;
    if (e.key === 'Meta') { metaDown = true; metaCombo = false; return; }
    if (metaDown) metaCombo = true;
    const dialogOpen = !!(P.dialog && typeof P.dialog.isOpen === 'function' && P.dialog.isOpen());
    if (e.key === 'Escape') {
      if (e.ctrlKey && !dialogOpen) { e.preventDefault(); toggle(); return; }
      if (isOpen && !dialogOpen) close();
      return;
    }
    if (!isOpen || dialogOpen) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !P.util.isEditable(document.activeElement)) {
      input.focus({ preventScroll: true });
    }
  }

  function onDocKeyup(e) {
    if (e.key !== 'Meta') return;
    const clean = metaDown && !metaCombo;
    metaDown = false;
    metaCombo = false;
    if (!clean) return;
    if (P.session && typeof P.session.isLocked === 'function' && P.session.isLocked()) return;
    if (P.dialog && typeof P.dialog.isOpen === 'function' && P.dialog.isOpen()) return;
    toggle();
  }

  // ------------------------------------------------------------------ init
  function buildPowerMenu() {
    const mk = (kind, glyph, label, danger) => {
      const b = el('button', { class: 'sm-pm-item' + (danger ? ' danger' : ''), type: 'button', role: 'menuitem', dataset: { power: kind } },
        el('span', { class: 'sm-pm-ico', html: iconMarkup(glyph) }),
        el('span', { text: label }));
      b.addEventListener('click', () => powerAction(kind));
      return b;
    };
    powerMenu = el('div', { class: 'sm-power-menu', role: 'menu', 'aria-label': 'Güç seçenekleri' },
      mk('lock', 'lock', 'Kilitle'),
      mk('restart', 'restart', 'Yeniden başlat'),
      mk('shutdown', 'power', 'Kapat', true));
    powerMenu.addEventListener('keydown', (e) => {
      const items = [...powerMenu.querySelectorAll('.sm-pm-item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePowerMenu(true); }
    });
  }

  function init() {
    if (inited) return;
    layer = document.getElementById('start-menu');
    if (!layer) { console.error('[startmenu] #start-menu bulunamadı'); return; }
    inited = true;
    layer.textContent = '';

    input = el('input', {
      class: 'sm-input', type: 'text', placeholder: 'Uygulama ve dosya ara', autocomplete: 'off', spellcheck: false,
      'aria-label': 'Uygulama ve dosya ara', enterKeyHint: 'search'
    });
    clearBtn = el('button', { class: 'sm-clear', type: 'button', hidden: true, 'aria-label': 'Aramayı temizle', html: iconMarkup('x') });
    clearBtn.addEventListener('click', () => { setQuery(''); input.focus(); });
    input.addEventListener('input', () => setQuery(input.value));

    gridEl = el('div', { class: 'sm-grid', role: 'list' });
    recentEl = el('div', { class: 'sm-recent' });
    secMeta = el('span', { class: 'sm-sec-meta' });
    homeEl = el('div', { class: 'sm-home' },
      el('div', { class: 'sm-sec' }, el('h3', { text: 'Sabitlenmiş' }), secMeta),
      gridEl,
      el('div', { class: 'sm-sec' }, el('h3', { text: 'Son kullanılanlar' })),
      recentEl);
    resultsEl = el('div', { class: 'sm-results', hidden: true, role: 'listbox' });

    const user = el('button', { class: 'sm-user', type: 'button', 'aria-label': `${P.user.displayName} — hesap ayarları` },
      el('span', { class: 'sm-avatar', html: iconMarkup('avatar') }),
      el('span', { class: 'sm-user-name', text: P.user.displayName || 'Panda' }));
    user.addEventListener('click', () => { close(); if (P.apps) P.apps.launch('settings'); });

    powerBtn = el('button', { class: 'sm-power', type: 'button', 'aria-label': 'Güç', 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: iconMarkup('power') });
    powerBtn.addEventListener('click', () => { if (powerOpen) hidePowerMenu(true); else showPowerMenu(); });
    buildPowerMenu();

    panel = el('div', { class: 'sm-panel', role: 'dialog', 'aria-label': 'Başlat menüsü', 'aria-hidden': 'true', tabIndex: -1 },
      el('div', { class: 'sm-search' },
        el('div', { class: 'sm-search-box' },
          el('span', { class: 'sm-search-ico', html: iconMarkup('search') }), input, clearBtn)),
      el('div', { class: 'sm-body' }, homeEl, resultsEl),
      el('div', { class: 'sm-foot' }, user, powerBtn),
      powerMenu);
    layer.appendChild(panel);

    panel.addEventListener('keydown', onPanelKeydown);
    document.addEventListener('keydown', onDocKeydown);
    document.addEventListener('keyup', onDocKeyup);
    window.addEventListener('blur', () => { metaDown = false; metaCombo = false; });

    document.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (powerOpen && !powerMenu.contains(t) && !powerBtn.contains(t)) hidePowerMenu();
      if (!isOpen) return;
      if (panel.contains(t) || t.closest('.tb-start') || t.closest('#context-menu-layer, #dialog-layer')) return;
      close();
    }, true);

    bus.on('apps:launch', (e) => {
      const args = e && e.args;
      if (args && typeof args.path === 'string') trackRecent(args.path);
    });
    bus.on('apps:change', () => { if (isOpen && !query.trim()) renderHome(false); });
    bus.on('settings:change', (e) => { if (e && e.key === 'taskbar.pinned' && isOpen && !query.trim()) renderHome(false); });
    bus.on('fs:change', () => { if (isOpen && !query.trim()) renderRecent(); else if (isOpen) renderResults(); });
    bus.on('session:lock', close);
    bus.on('popup:open', (e) => { if (e && e.name !== 'start') close(); });
  }

  P.startMenu = {
    init,
    open,
    close,
    toggle,
    isOpen() { return isOpen; }
  };
})();
