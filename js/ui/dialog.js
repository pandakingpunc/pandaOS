/* PandaOS dialogs — modal alert / confirm / prompt, the file picker, the properties sheet.
   Promise based, stackable, with focus trap. Renders into #dialog-layer.
   This file also hosts a tiny helper that keeps `.p-range` sliders' filled track in sync. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const U = P.util;

  // ---------------------------------------------------------------- icon helpers
  const GLYPHS = {
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    'chevron-right': '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
    'arrow-left': '<path d="M19 12H5.5M11 6l-6 6 6 6"/>',
    'arrow-up': '<path d="M12 19V5.5M6 11l6-6 6 6"/>',
    'folder-plus': '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    file: '<path d="M7 3.5h6.5l5 5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5v5h5"/>',
    home: '<path d="M4 11.2 12 4l8 7.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    desktop: '<rect x="3.5" y="5" width="17" height="11" rx="1.8"/><path d="M9 20h6M12 16v4"/>',
    document: '<path d="M7 3.5h6.5l5 5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5v5h5M8.5 13h7M8.5 16.5h5"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l4.5-4.5L13 16l2.5-2.5L19 17"/>',
    note: '<path d="M9 17.5v-11l9-2v11"/><circle cx="7" cy="17.5" r="2"/><circle cx="16" cy="15.5" r="2"/>',
    download: '<path d="M12 4.5v10M7.5 10.5l4.5 4.5 4.5-4.5M5 19.5h14"/>',
    computer: '<rect x="3.5" y="5" width="17" height="11" rx="1.8"/><path d="M9 20h6M12 16v4"/>'
  };

  const KIND_SVG = {
    info: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="var(--info)"/><rect x="22" y="21" width="4" height="13" rx="2" fill="#fff"/><circle cx="24" cy="15" r="2.7" fill="#fff"/></svg>',
    warning: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5.5c1 0 1.9.5 2.4 1.4l17 29.5c1 1.7-.3 3.8-2.4 3.8H7c-2.1 0-3.4-2.1-2.4-3.8l17-29.5c.5-.9 1.4-1.4 2.4-1.4z" fill="var(--warning)"/><rect x="22" y="17" width="4" height="12" rx="2" fill="#1b1e24"/><circle cx="24" cy="34" r="2.5" fill="#1b1e24"/></svg>',
    error: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="var(--danger)"/><path d="M17 17l14 14M31 17L17 31" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',
    question: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="var(--accent-solid)"/><path d="M18.6 19.2a5.5 5.5 0 1 1 8.5 4.6c-1.9 1.2-3.1 2.2-3.1 4.4" fill="none" stroke="var(--on-accent)" stroke-width="3.6" stroke-linecap="round"/><circle cx="24" cy="34.4" r="2.5" fill="var(--on-accent)"/></svg>'
  };

  function glyph(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (GLYPHS[name] || '') + '</svg>';
  }

  function iconMarkup(name, fallbackGlyph) {
    if (typeof name === 'string' && name.trim().startsWith('<svg')) return name;
    const icons = P.icons;
    if (name && icons && typeof icons.get === 'function' && (typeof icons.has !== 'function' || icons.has(name))) {
      try { return icons.get(name); } catch (e) { /* fall through */ }
    }
    return fallbackGlyph ? glyph(fallbackGlyph) : '';
  }

  /** info / warning / error / question (own art as a fallback) or any icon name. */
  function dialogIcon(name) {
    if (!name) return '';
    if (KIND_SVG[name]) {
      const icons = P.icons;
      if (icons && typeof icons.has === 'function' && icons.has(name)) return icons.get(name);
      return KIND_SVG[name];
    }
    return iconMarkup(name);
  }

  // ---------------------------------------------------------------- modal core
  const stack = [];            // open dialogs; the last one is on top
  let layer = null;
  let listening = false;

  function getLayer() {
    if (!layer || !layer.isConnected) {
      layer = document.getElementById('dialog-layer');
      if (!layer) {
        layer = U.el('div', { id: 'dialog-layer' });
        (document.getElementById('os-root') || document.body).appendChild(layer);
      }
    }
    return layer;
  }

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function focusables(root) {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && isVisible(el) && !el.closest('[inert]'));
  }

  /** Brief attention cue via WAAPI (so the CSS entrance animation is never replayed). */
  function nudge(el, shake) {
    if (!el.animate || document.documentElement.classList.contains('no-anim')) return;
    const frames = shake
      ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }]
      : [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }];
    try {
      el.animate(frames, { duration: shake ? 280 : 240, easing: 'ease-out' });
    } catch (e) { /* cosmetic only */ }
  }

  function selfHandles(target, key) {
    const host = target && target.closest ? target.closest('[data-dlg-self]') : null;
    return !!host && host.getAttribute('data-dlg-self').split(' ').includes(key);
  }

  /** While the lock / power screens are up they own the keyboard and focus; an open dialog just waits behind them. */
  function sessionOwnsInput() {
    try { return !!(P.session && typeof P.session.isLocked === 'function' && P.session.isLocked()); } catch (e) { return false; }
  }

  function onKeyDown(e) {
    const top = stack[stack.length - 1];
    if (!top || sessionOwnsInput()) return;
    const target = e.target;
    const inside = top.card.contains(target);

    if (e.key === 'Escape') {
      if (inside && selfHandles(target, 'Escape')) return;
      e.preventDefault();
      e.stopPropagation();
      if (top.escape) top.escape();
      return;
    }

    if (e.key === 'Tab') {
      const list = focusables(top.card);
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (!top.card.contains(active)) {
        e.preventDefault();
        list[e.shiftKey ? list.length - 1 : 0].focus();
      } else if (e.shiftKey && active === list[0]) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && active === list[list.length - 1]) {
        e.preventDefault();
        list[0].focus();
      }
      return;
    }

    if (e.key === 'Enter' && !e.isComposing) {
      if (inside) {
        if (selfHandles(target, 'Enter') || target.tagName === 'TEXTAREA') return;
        if (target.tagName === 'BUTTON') {
          e.preventDefault();
          e.stopPropagation();
          target.click();
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
      if (top.enter) top.enter(e);
      return;
    }

    // keys typed while focus sits outside the dialog must not reach the apps underneath
    if (!inside) e.stopPropagation();
  }

  function onFocusIn(e) {
    const top = stack[stack.length - 1];
    if (!top || sessionOwnsInput()) return;
    if (top.card.contains(e.target)) {
      top.lastFocus = e.target;
      return;
    }
    const back = top.lastFocus && top.lastFocus.isConnected ? top.lastFocus : top.initial;
    if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  function listen() {
    if (listening) return;
    listening = true;
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', swallowKeyUp, true);
    document.addEventListener('focusin', onFocusIn, true);
  }

  function unlisten() {
    if (!listening) return;
    listening = false;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', swallowKeyUp, true);
    document.removeEventListener('focusin', onFocusIn, true);
  }

  function swallowKeyUp(e) {
    const top = stack[stack.length - 1];
    if (top && !sessionOwnsInput() && !top.card.contains(e.target)) e.stopPropagation();
  }

  /**
   * Shows a card as a modal. cfg: { card, onEscape(), onEnter(), initialFocus (element) }.
   * Returns { close(value), promise, rec }.
   */
  function present(cfg) {
    let resolveFn;
    const promise = new Promise((resolve) => { resolveFn = resolve; });
    const backdrop = U.el('div', { class: 'dlg-backdrop' + (stack.length ? ' stacked' : '') });
    backdrop.appendChild(cfg.card);
    // clicking beside the card does not dismiss; it just draws attention to the dialog
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) {
        e.preventDefault();
        nudge(cfg.card);
        const f = rec.lastFocus && rec.lastFocus.isConnected ? rec.lastFocus : rec.initial;
        if (f) f.focus({ preventScroll: true });
      }
    });

    const rec = {
      backdrop,
      card: cfg.card,
      escape: cfg.onEscape,
      enter: cfg.onEnter,
      initial: cfg.initialFocus || cfg.card,
      lastFocus: null,
      prevFocus: document.activeElement,
      closed: false
    };

    function close(value) {
      if (rec.closed) return;
      rec.closed = true;
      const i = stack.indexOf(rec);
      if (i >= 0) stack.splice(i, 1);
      backdrop.remove();
      const top = stack[stack.length - 1];
      if (top) top.backdrop.removeAttribute('inert');
      if (!stack.length) unlisten();
      const prev = rec.prevFocus;
      if (prev && prev !== document.body && prev.isConnected && typeof prev.focus === 'function') {
        try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      resolveFn(value);
      P.bus.emit('dialog:change', { open: stack.length > 0 });
    }

    const below = stack[stack.length - 1];
    if (below) below.backdrop.setAttribute('inert', '');
    stack.push(rec);
    getLayer().appendChild(backdrop);
    listen();
    try {
      rec.initial.focus({ preventScroll: true });
    } catch (e) { /* ignore */ }
    P.bus.emit('dialog:change', { open: true });
    return { close, promise, rec };
  }

  // ---------------------------------------------------------------- standard card
  function button(label, kind, onClick, primary) {
    return U.el('button', {
      class: 'p-btn dlg-btn' + (kind ? ' ' + kind : '') + (primary ? ' dlg-primary' : ''),
      type: 'button',
      text: label,
      on: { click: onClick }
    });
  }

  function buildCard(o) {
    const titleId = U.uid('dlg-title');
    const msgId = U.uid('dlg-msg');
    const card = U.el('div', {
      class: 'dlg-card' + (o.className ? ' ' + o.className : ''),
      role: o.role || 'dialog',
      tabindex: '-1',
      'aria-labelledby': titleId
    });
    card.setAttribute('aria-modal', 'true');
    if (o.message) card.setAttribute('aria-describedby', msgId);

    const text = U.el('div', { class: 'dlg-text' });
    text.appendChild(U.el('div', { class: 'dlg-title', id: titleId, text: o.title }));
    if (o.message) text.appendChild(U.el('div', { class: 'dlg-message', id: msgId, text: o.message }));
    if (o.extra) text.appendChild(o.extra);

    const body = U.el('div', { class: 'dlg-body' });
    if (o.icon) body.appendChild(U.el('div', { class: 'dlg-icon', html: o.icon }));
    body.appendChild(text);
    card.appendChild(body);
    card.appendChild(U.el('div', { class: 'dlg-footer' }, o.buttons));
    return card;
  }

  function asOpts(opts) {
    if (typeof opts === 'string') return { message: opts };
    return opts && typeof opts === 'object' ? opts : {};
  }

  const text = (v) => (v == null ? '' : String(v));

  // ---------------------------------------------------------------- alert / confirm / prompt
  function alertDialog(opts) {
    opts = asOpts(opts);
    const ok = button(text(opts.okText) || 'Tamam', 'primary', () => h.close(), true);
    const card = buildCard({
      title: text(opts.title) || 'PandaOS',
      message: text(opts.message),
      icon: dialogIcon(opts.icon || 'info'),
      buttons: [ok]
    });
    const h = present({ card, onEscape: () => h.close(), onEnter: () => h.close(), initialFocus: ok });
    if (opts.icon === 'error' && P.sound && P.sound.play) P.sound.play('error');
    return h.promise.then(() => undefined);
  }

  function confirmDialog(opts) {
    opts = asOpts(opts);
    const danger = !!opts.danger;
    const cancel = button(text(opts.cancelText) || 'İptal', '', () => h.close(false));
    const ok = button(text(opts.okText) || 'Tamam', danger ? 'danger' : 'primary', () => h.close(true), true);
    const card = buildCard({
      title: text(opts.title) || 'PandaOS',
      message: text(opts.message),
      icon: dialogIcon(opts.icon || (danger ? 'warning' : 'question')),
      buttons: [cancel, ok],
      className: danger ? 'danger' : ''
    });
    // A destructive confirm opens on "İptal" so a held/repeated Enter from the opener cannot confirm it;
    // Enter then acts on whichever button has focus.
    const h = present({
      card,
      onEscape: () => h.close(false),
      onEnter: () => h.close(danger ? document.activeElement === ok : true),
      initialFocus: danger ? cancel : ok
    });
    return h.promise.then((v) => v === true);
  }

  function selectStem(input) {
    const v = input.value;
    const m = /^(.+)\.[A-Za-z0-9_-]{1,8}$/.exec(v);
    try {
      if (m) input.setSelectionRange(0, m[1].length);
      else input.select();
    } catch (e) { /* ignore */ }
  }

  function promptDialog(opts) {
    opts = asOpts(opts);
    const input = U.el('input', {
      class: 'p-input dlg-input',
      type: 'text',
      value: text(opts.value),
      placeholder: text(opts.placeholder)
    });
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('autocomplete', 'off');
    const err = U.el('div', { class: 'dlg-error', role: 'alert' });

    function setError(msg) {
      err.textContent = msg || '';
      err.classList.toggle('show', !!msg);
      input.classList.toggle('invalid', !!msg);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }

    function check() {
      let msg = null;
      if (typeof opts.validate === 'function') {
        try { msg = opts.validate(input.value); } catch (e) { console.error('[dialog] validate hatası', e); }
      }
      setError(msg ? String(msg) : '');
      return !msg;
    }

    function submit() {
      if (!check()) {
        nudge(input, true);
        input.focus();
        return;
      }
      h.close(input.value);
    }

    input.addEventListener('input', () => { if (typeof opts.validate === 'function') check(); });

    const extra = U.el('div', { class: 'dlg-field' }, input, err);
    const cancel = button(text(opts.cancelText) || 'İptal', '', () => h.close(null));
    const ok = button(text(opts.okText) || 'Tamam', 'primary', submit, true);
    const card = buildCard({
      title: text(opts.title) || 'PandaOS',
      message: text(opts.message),
      icon: opts.icon ? dialogIcon(opts.icon) : '',
      extra,
      buttons: [cancel, ok],
      className: 'prompt'
    });
    const h = present({ card, onEscape: () => h.close(null), onEnter: submit, initialFocus: input });
    selectStem(input);
    return h.promise.then((v) => (v == null ? null : v));
  }

  // ---------------------------------------------------------------- properties
  function typeLabel(st) {
    if (st.type === 'dir') return 'Klasör';
    if (st.ext === '.app') return 'Uygulama kısayolu';
    if (st.ext) return `${st.ext.slice(1).toUpperCase()} dosyası`;
    return 'Dosya';
  }

  function longDate(ts) {
    return `${U.formatDate(ts, { day: 'numeric', month: 'long', year: 'numeric' })}, ${U.formatTime(ts, true)}`;
  }

  function propertiesDialog(path) {
    const fs = P.fs;
    let st = null;
    try { st = fs && typeof fs.stat === 'function' ? fs.stat(path) : null; } catch (e) { st = null; }
    if (!st) {
      return alertDialog({ title: 'Özellikler', message: `"${text(path)}" bulunamadı.`, icon: 'warning' });
    }

    let displayName = typeof fs.displayName === 'function' ? fs.displayName(st.path) : st.name;
    let iconName = P.icons && typeof P.icons.forFile === 'function' ? P.icons.forFile(st) : (st.type === 'dir' ? 'folder' : 'file');
    let target = null;
    if (st.type === 'file' && st.ext === '.app') {
      try {
        const def = JSON.parse(fs.readFile(st.path));
        const app = P.apps && P.apps.get ? P.apps.get(def.appId) : null;
        if (app) {
          target = app.name;
          iconName = app.icon || iconName;
        }
      } catch (e) { /* broken shortcut: keep generic icon */ }
    }

    const rows = [['Tür', typeLabel(st)]];
    rows.push(['Konum', typeof fs.dirname === 'function' ? fs.dirname(st.path) : st.path]);
    if (target) rows.push(['Hedef', target]);
    const bytes = Number(st.size) || 0;
    rows.push(['Boyut', U.formatBytes(bytes) + (bytes >= 1024 ? ` (${bytes.toLocaleString('tr-TR')} bayt)` : '')]);
    if (st.type === 'dir') {
      let files = 0;
      let dirs = 0;
      try {
        if (typeof fs.walk === 'function') {
          fs.walk(st.path, (s) => { if (s.type === 'dir') dirs++; else files++; });
        } else {
          fs.list(st.path).forEach((s) => { if (s.type === 'dir') dirs++; else files++; });
        }
      } catch (e) { /* leave zeros */ }
      rows.push(['İçerik', `${files} dosya, ${dirs} klasör`]);
    }
    if (st.created) rows.push(['Oluşturulma', longDate(st.created)]);
    if (st.modified) rows.push(['Değiştirilme', longDate(st.modified)]);

    const dl = U.el('dl', { class: 'dlg-props' });
    rows.forEach(([k, v]) => {
      dl.appendChild(U.el('dt', { text: k }));
      dl.appendChild(U.el('dd', { class: 'selectable', text: v }));
    });

    const titleId = U.uid('dlg-title');
    const ok = button('Tamam', 'primary', () => h.close(), true);
    const card = U.el('div', { class: 'dlg-card props', role: 'dialog', tabindex: '-1', 'aria-labelledby': titleId },
      U.el('div', { class: 'dlg-prop-head' },
        U.el('div', { class: 'dlg-prop-icon', html: iconMarkup(iconName, st.type === 'dir' ? 'folder' : 'file') }),
        U.el('div', { class: 'dlg-prop-name selectable', id: titleId, text: displayName })
      ),
      dl,
      U.el('div', { class: 'dlg-footer' }, ok)
    );
    card.setAttribute('aria-modal', 'true');
    const h = present({ card, onEscape: () => h.close(), onEnter: () => h.close(), initialFocus: ok });
    return h.promise.then(() => undefined);
  }

  // ---------------------------------------------------------------- file picker
  const PLACES = [
    ['Ana klasör', '', 'home'],
    ['Masaüstü', 'Masaüstü', 'desktop'],
    ['Belgeler', 'Belgeler', 'document'],
    ['Resimler', 'Resimler', 'image'],
    ['Müzik', 'Müzik', 'note'],
    ['İndirilenler', 'İndirilenler', 'download']
  ];

  function pickFile(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    const fs = P.fs;
    if (!fs || typeof fs.list !== 'function' || typeof fs.isDir !== 'function') {
      console.warn('[dialog] pickFile: dosya sistemi hazır değil, işlem iptal edildi');
      return Promise.resolve(null);
    }

    const mode = opts.mode === 'save' ? 'save' : 'open';
    const exts = (Array.isArray(opts.extensions) ? opts.extensions : [])
      .map((x) => String(x).trim().toLowerCase())
      .filter(Boolean)
      .map((x) => (x.startsWith('.') ? x : '.' + x));
    const HOME = fs.HOME || '/home/panda';

    let cwd = HOME;
    let start = opts.dir || HOME;
    try {
      start = fs.normalize(start);
      if (fs.isFile(start)) start = fs.dirname(start);
    } catch (e) { start = HOME; }
    cwd = fs.isDir(start) ? start : (fs.isDir(HOME) ? HOME : '/');

    const past = [];           // back history
    let selected = null;       // selected entry stat
    let rows = [];             // [{ stat, el }]
    let busy = false;
    let baseStatus = '';

    // ---- DOM
    const titleId = U.uid('dlg-title');
    const closeBtn = U.el('button', { class: 'p-btn icon small fp-x', type: 'button', 'aria-label': 'Kapat', html: iconMarkup('close', 'close'), on: { click: () => h.close(null) } });
    const head = U.el('div', { class: 'fp-head' },
      U.el('div', { class: 'fp-title', id: titleId, text: text(opts.title) || (mode === 'save' ? 'Farklı kaydet' : 'Aç') }),
      closeBtn);

    const backBtn = U.el('button', { class: 'p-btn icon small', type: 'button', title: 'Geri', 'aria-label': 'Geri', html: iconMarkup('arrow-left', 'arrow-left'), on: { click: () => back() } });
    const upBtn = U.el('button', { class: 'p-btn icon small', type: 'button', title: 'Üst klasör', 'aria-label': 'Üst klasör', html: iconMarkup('arrow-up', 'arrow-up'), on: { click: () => up() } });
    const crumbs = U.el('div', { class: 'fp-crumbs' });
    const pathBox = U.el('div', { class: 'fp-path', title: 'Yolu düzenlemek için boş alana tıklayın' }, crumbs);
    const newBtn = U.el('button', { class: 'p-btn small', type: 'button', html: iconMarkup('folder-plus', 'folder-plus'), on: { click: () => newFolder() } });
    newBtn.appendChild(document.createTextNode('Yeni klasör'));
    const toolbar = U.el('div', { class: 'fp-toolbar' }, backBtn, upBtn, pathBox, newBtn);

    const placesList = U.el('div', { class: 'p-list' });
    const placeEls = [];
    PLACES.forEach(([label, sub, icon]) => {
      const path = sub ? fs.join(HOME, sub) : HOME;
      if (sub && !fs.isDir(path)) return;
      const el = U.el('button', { class: 'p-list-item fp-place', type: 'button', on: { click: () => navigate(path) } });
      el.innerHTML = iconMarkup(icon, icon);
      el.appendChild(U.el('span', { text: label }));
      placesList.appendChild(el);
      placeEls.push({ el, path });
    });
    const side = U.el('div', { class: 'p-sidebar fp-side' }, placesList);

    const cols = U.el('div', { class: 'fp-cols' },
      U.el('span', { text: 'Ad' }), U.el('span', { text: 'Değiştirilme' }), U.el('span', { class: 'r', text: 'Boyut' }));
    const list = U.el('div', { class: 'fp-list', role: 'listbox', tabindex: '0', 'aria-label': 'Dosyalar' });
    const main = U.el('div', { class: 'fp-main' }, cols, list);
    const body = U.el('div', { class: 'fp-body' }, side, main);

    const nameInput = U.el('input', { class: 'p-input fp-name-input', type: 'text', placeholder: 'Dosya adı', value: mode === 'save' ? text(opts.name) : '' });
    nameInput.setAttribute('spellcheck', 'false');
    nameInput.setAttribute('autocomplete', 'off');
    nameInput.setAttribute('aria-label', 'Dosya adı');
    const filterLabel = U.el('span', { class: 'fp-filter', text: exts.length ? exts.map((x) => '*' + x).join('  ') : 'Tüm dosyalar' });
    const status = U.el('div', { class: 'fp-status', role: 'status' });
    const cancelBtn = button('İptal', '', () => h.close(null));
    const okBtn = button(mode === 'save' ? 'Kaydet' : 'Aç', 'primary', () => submit(), true);
    const foot = U.el('div', { class: 'fp-foot' },
      status,
      U.el('div', { class: 'fp-foot-row' }, U.el('label', { class: 'fp-label', text: 'Dosya adı' }), nameInput, filterLabel, cancelBtn, okBtn));

    const card = U.el('div', { class: 'dlg-card fp', role: 'dialog', tabindex: '-1', 'aria-labelledby': titleId }, head, toolbar, body, foot);
    card.setAttribute('aria-modal', 'true');

    const h = present({
      card,
      onEscape: () => h.close(null),
      onEnter: () => submit(),
      initialFocus: mode === 'save' ? nameInput : list
    });
    const offFs = P.bus.on('fs:change', U.debounce(() => { if (!h.rec.closed) refresh(); }, 40));
    h.promise.then(() => offFs());

    // ---- helpers
    // the resting text is the item count; messages (usually errors) replace it until the next action
    function setStatus(msg, isError) {
      status.textContent = msg || baseStatus;
      status.classList.toggle('error', !!msg && !!isError);
    }

    function matches(stat) {
      return stat.type === 'dir' || !exts.length || exts.includes(stat.ext);
    }

    function flashInput() {
      nameInput.classList.add('invalid');
      nudge(nameInput, true);
      setTimeout(() => nameInput.classList.remove('invalid'), 900);
      nameInput.focus();
    }

    // ---- navigation
    function navigate(dir, o) {
      const push = !o || o.push !== false;
      let d;
      try { d = fs.normalize(dir); } catch (e) { return false; }
      if (!fs.isDir(d)) return false;
      if (push && d !== cwd) past.push(cwd);
      cwd = d;
      selected = null;
      if (mode === 'open') nameInput.value = '';
      renderAll();
      list.scrollTop = 0;
      return true;
    }

    function back() {
      while (past.length) {
        const prev = past.pop();
        if (fs.isDir(prev)) {
          navigate(prev, { push: false });
          return;
        }
      }
    }

    function up() {
      if (cwd === '/') return;
      navigate(fs.dirname(cwd));
    }

    function refresh() {
      if (!fs.isDir(cwd)) {
        let d = cwd;
        while (d !== '/' && !fs.isDir(d)) d = fs.dirname(d);
        cwd = d;
        selected = null;
      } else if (selected && !fs.exists(selected.path)) {
        selected = null;
      }
      renderAll();
    }

    // ---- rendering
    function renderCrumbs() {
      crumbs.textContent = '';
      const parts = [];
      let rest;
      let base;
      if (cwd === HOME || cwd.startsWith(HOME + '/')) {
        parts.push({ label: 'Ana klasör', path: HOME, icon: 'home' });
        rest = cwd.slice(HOME.length).split('/').filter(Boolean);
        base = HOME;
      } else {
        parts.push({ label: 'Bilgisayar', path: '/', icon: 'computer' });
        rest = cwd.split('/').filter(Boolean);
        base = '';
      }
      rest.forEach((seg) => {
        base = base + '/' + seg;
        parts.push({ label: seg, path: base });
      });
      parts.forEach((part, i) => {
        if (i) crumbs.appendChild(U.el('span', { class: 'fp-sep', html: iconMarkup('chevron-right', 'chevron-right') }));
        const isCurrent = i === parts.length - 1;
        const el = U.el('button', {
          class: 'fp-crumb' + (isCurrent ? ' current' : ''),
          type: 'button',
          dataset: { path: part.path },
          text: part.label,
          on: { click: (e) => { e.stopPropagation(); navigate(part.path); } }
        });
        if (isCurrent) el.setAttribute('aria-current', 'location');
        crumbs.appendChild(el);
      });
      crumbs.scrollLeft = crumbs.scrollWidth;
    }

    function editPath() {
      if (pathBox.classList.contains('editing')) return;
      pathBox.classList.add('editing');
      const input = U.el('input', { class: 'fp-pathinput', type: 'text', value: cwd, 'aria-label': 'Yol' });
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('data-dlg-self', 'Enter Escape');
      let done = false;
      const finish = (go) => {
        if (done) return;
        done = true;
        if (go) {
          const v = input.value.trim();
          if (v && !navigate(v)) setStatus(`"${v}" klasörü bulunamadı.`, true);
        }
        pathBox.classList.remove('editing');
        input.remove();
        crumbs.hidden = false;
        renderCrumbs();
        list.focus();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(false));
      crumbs.hidden = true;
      pathBox.appendChild(input);
      input.focus();
      input.select();
    }
    pathBox.addEventListener('mousedown', (e) => {
      if (e.target === pathBox || e.target === crumbs) {
        e.preventDefault();
        editPath();
      }
    });

    function renderPlaces() {
      placeEls.forEach(({ el, path }) => el.classList.toggle('selected', path === cwd));
    }

    function iconFor(stat) {
      let name = stat.type === 'dir' ? 'folder' : 'file';
      try {
        if (P.icons && typeof P.icons.forFile === 'function') name = P.icons.forFile(stat) || name;
      } catch (e) { /* keep default */ }
      return iconMarkup(name, stat.type === 'dir' ? 'folder' : 'file');
    }

    function renderList() {
      let entries = [];
      try { entries = fs.list(cwd); } catch (e) { entries = []; }
      entries = entries.filter(matches);
      list.textContent = '';
      rows = [];
      if (!entries.length) {
        list.appendChild(U.el('div', { class: 'p-empty fp-empty', text: exts.length ? 'Eşleşen dosya yok' : 'Bu klasör boş' }));
      }
      entries.forEach((stat) => {
        const label = typeof fs.displayName === 'function' ? fs.displayName(stat.path) : stat.name;
        const row = U.el('div', { class: 'fp-row', role: 'option', dataset: { path: stat.path, type: stat.type }, title: label },
          U.el('span', { class: 'fp-name' },
            U.el('span', { class: 'fp-ico', html: iconFor(stat) }),
            U.el('span', { class: 'fp-label-text', text: label })),
          U.el('span', { class: 'fp-date', text: stat.modified ? U.formatDateTime(stat.modified) : '' }),
          U.el('span', { class: 'fp-size', text: stat.type === 'file' ? U.formatBytes(stat.size) : '' }));
        row.addEventListener('click', () => select(stat, true));
        row.addEventListener('dblclick', () => activateEntry(stat));
        list.appendChild(row);
        rows.push({ stat, el: row });
      });
      rows.forEach((r) => {
        const on = !!selected && selected.path === r.stat.path;
        r.el.classList.toggle('selected', on);
        r.el.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const folders = entries.filter((e) => e.type === 'dir').length;
      baseStatus = entries.length ? `${entries.length} öğe${folders ? ` (${folders} klasör)` : ''}` : '';
      setStatus('');
    }

    function renderAll() {
      renderCrumbs();
      renderPlaces();
      renderList();
      backBtn.disabled = !past.length;
      upBtn.disabled = cwd === '/';
    }

    // ---- selection
    function select(stat, fromClick) {
      selected = stat;
      rows.forEach((r) => {
        const on = r.stat.path === stat.path;
        r.el.classList.toggle('selected', on);
        r.el.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && !fromClick) r.el.scrollIntoView({ block: 'nearest' });
      });
      if (stat.type === 'file') {
        nameInput.value = stat.name;
      } else if (mode === 'open') {
        nameInput.value = '';
      }
      setStatus('');
      if (fromClick) list.focus({ preventScroll: true });
    }

    function activateEntry(stat) {
      if (stat.type === 'dir') {
        navigate(stat.path);
        return;
      }
      select(stat, true);
      submit();
    }

    list.addEventListener('keydown', (e) => {
      const idx = selected ? rows.findIndex((r) => r.stat.path === selected.path) : -1;
      let next = null;
      if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, idx + 1);
      else if (e.key === 'ArrowUp') next = Math.max(0, idx < 0 ? 0 : idx - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = rows.length - 1;
      else if (e.key === 'Backspace') {
        e.preventDefault();
        up();
        return;
      } else if (e.key === 'ArrowLeft' && e.altKey) {
        e.preventDefault();
        back();
        return;
      }
      if (next != null && rows.length) {
        e.preventDefault();
        select(rows[next].stat, false);
      }
    });

    // ---- actions
    async function newFolder() {
      const base = typeof fs.uniqueName === 'function' ? fs.uniqueName(cwd, 'Yeni Klasör') : 'Yeni Klasör';
      const name = await promptDialog({
        title: 'Yeni klasör',
        message: 'Klasör için bir ad girin.',
        value: base,
        okText: 'Oluştur',
        validate: (v) => {
          const n = v.trim();
          if (!n) return 'Ad boş olamaz.';
          if (n.includes('/')) return 'Ad "/" karakterini içeremez.';
          if (n === '.' || n === '..') return 'Bu ad kullanılamaz.';
          if (fs.exists(fs.join(cwd, n))) return 'Bu adda bir öğe zaten var.';
          return null;
        }
      });
      if (h.rec.closed || name == null) return;
      const path = fs.join(cwd, name.trim());
      try {
        fs.mkdir(path);
      } catch (e) {
        await alertDialog({ title: 'Klasör oluşturulamadı', message: e.message || String(e), icon: 'error' });
        return;
      }
      renderList();
      const made = rows.find((r) => r.stat.path === path);
      if (made) select(made.stat, false);
    }

    async function submit() {
      if (busy || h.rec.closed) return;
      busy = true;
      try {
        let typed = nameInput.value.trim();
        if (mode === 'open') {
          let target = null;
          if (typed) target = typed.startsWith('/') ? fs.normalize(typed) : fs.join(cwd, typed);
          else if (selected) target = selected.path;
          if (!target) {
            setStatus('Açmak için bir dosya seçin.', true);
            return;
          }
          if (fs.isDir(target)) {
            navigate(target);
            return;
          }
          if (fs.isFile(target)) {
            h.close(target);
            return;
          }
          setStatus(`"${typed || fs.basename(target)}" bulunamadı.`, true);
          flashInput();
          return;
        }

        // save mode
        if (!typed) {
          if (selected && selected.type === 'dir') {
            navigate(selected.path);
            return;
          }
          setStatus('Bir dosya adı girin.', true);
          flashInput();
          return;
        }
        let dir = cwd;
        let name = typed;
        if (typed.startsWith('/')) {
          dir = fs.dirname(fs.normalize(typed));
          name = fs.basename(typed);
        }
        if (name.includes('/') || name === '.' || name === '..') {
          setStatus('Geçersiz dosya adı.', true);
          flashInput();
          return;
        }
        if (!fs.isDir(dir)) {
          setStatus(`"${dir}" klasörü bulunamadı.`, true);
          flashInput();
          return;
        }
        if (!fs.extname(name) && exts.length) name += exts[0];
        const target = fs.join(dir, name);
        if (fs.isDir(target)) {
          navigate(target);
          nameInput.value = '';
          return;
        }
        if (fs.isFile(target)) {
          const ok = await confirmDialog({
            title: 'Kaydetmeyi onayla',
            message: `"${name}" zaten var. Değiştirilsin mi?`,
            okText: 'Değiştir',
            danger: true
          });
          if (!ok || h.rec.closed) {
            if (!h.rec.closed) nameInput.focus();
            return;
          }
        }
        h.close(target);
      } catch (e) {
        console.error('[dialog] pickFile', e);
        setStatus(e && e.message ? e.message : 'İşlem tamamlanamadı.', true);
      } finally {
        busy = false;
      }
    }

    nameInput.addEventListener('input', () => setStatus(''));
    renderAll();
    if (mode === 'save') selectStem(nameInput);
    return h.promise;
  }

  // ---------------------------------------------------------------- slider fill helper
  // `.p-range` draws its filled track from the --p variable (0..1). Keep it in sync when the
  // user drags, when a slider appears, and when code assigns .value / .min / .max.
  function syncRange(el) {
    if (!el || el.type !== 'range' || !el.classList.contains('p-range')) return;
    const min = el.min === '' ? 0 : Number(el.min);
    const max = el.max === '' ? 100 : Number(el.max);
    const v = Number(el.value);
    const p = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
    el.style.setProperty('--p', String(p));
  }

  function initControls() {
    if (initControls.done) return;
    initControls.done = true;
    const sync = (e) => syncRange(e.target);
    document.addEventListener('input', sync, true);
    document.addEventListener('change', sync, true);
    document.addEventListener('animationstart', (e) => {
      if (e.animationName === 'p-range-init') syncRange(e.target);
    }, true);
    // sliders that are inserted into the document pick up their initial value
    if (typeof MutationObserver === 'function') {
      const scan = (node) => {
        if (node.nodeType !== 1) return;
        if (node.classList.contains('p-range')) syncRange(node);
        else if (node.firstElementChild) node.querySelectorAll('input.p-range').forEach(syncRange);
      };
      new MutationObserver((records) => {
        for (const rec of records) rec.addedNodes.forEach(scan);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
    try {
      const proto = HTMLInputElement.prototype;
      ['value', 'valueAsNumber', 'min', 'max'].forEach((prop) => {
        const d = Object.getOwnPropertyDescriptor(proto, prop);
        if (!d || !d.set || !d.get) return;
        Object.defineProperty(proto, prop, {
          configurable: true,
          enumerable: d.enumerable,
          get: d.get,
          set(v) {
            d.set.call(this, v);
            if (this.type === 'range') syncRange(this);
          }
        });
      });
    } catch (e) {
      console.warn('[dialog] kaydırıcı eşitleme kurulamadı', e);
    }
  }
  initControls();

  // ---------------------------------------------------------------- public API
  function init() {
    getLayer();
    initControls();
  }

  P.dialog = {
    init,
    alert: alertDialog,
    confirm: confirmDialog,
    prompt: promptDialog,
    pickFile,
    properties: propertiesDialog,
    isOpen: () => stack.length > 0,
    /** Extra (not in the contract): cancels every open dialog, topmost first (restart / shutdown). */
    closeAll() {
      for (let guard = 0; stack.length && guard < 32; guard++) {
        const top = stack[stack.length - 1];
        try { if (typeof top.escape === 'function') top.escape(); } catch (e) { console.error('[dialog] closeAll', e); }
        if (stack[stack.length - 1] === top) {
          // an escape handler that refused to close: drop it without resolving through its own path
          top.closed = true;
          stack.pop();
          top.backdrop.remove();
        }
      }
      if (!stack.length) unlisten();
    }
  };
})();
