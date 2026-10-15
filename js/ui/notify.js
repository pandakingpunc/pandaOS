/* PandaOS notifications — toast popups (bottom right, above the taskbar) + a persisted
   history that the notification center in the taskbar renders.
   History is returned NEWEST FIRST. Renders into #toasts. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const U = P.util;

  const STORE_KEY = 'notifications';
  const MAX_HISTORY = 50;
  const MAX_VISIBLE = 4;
  const ROW_GAP = 10;
  const DEFAULT_TIMEOUT = 5000;

  let items = [];              // history, newest first
  let loaded = false;
  let stackEl = null;
  const live = new Map();      // visible toasts: id -> record (insertion order = oldest first)

  // ---------------------------------------------------------------- helpers
  const GLYPHS = {
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2H4.4L6 16.5z"/><path d="M10 21.2a2.2 2.2 0 0 0 4 0"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'
  };

  function glyph(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
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

  const str = (v) => (v == null ? '' : String(v));
  const copy = (item) => Object.assign({}, item);
  const animated = () => !document.documentElement.classList.contains('no-anim');

  function persist() {
    P.storage.set(STORE_KEY, items.map((n) => ({
      id: n.id, title: n.title, message: n.message, icon: n.icon, appId: n.appId, time: n.time, read: !!n.read
    })));
  }

  function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    const raw = P.storage.get(STORE_KEY, []);
    items = (Array.isArray(raw) ? raw : [])
      .filter((n) => n && typeof n === 'object' && n.id)
      .map((n) => ({
        id: String(n.id),
        title: str(n.title),
        message: str(n.message),
        icon: n.icon || 'panda',
        appId: n.appId || null,
        time: Number(n.time) || Date.now(),
        read: !!n.read
      }))
      .slice(0, MAX_HISTORY);
  }

  function getStack() {
    if (stackEl && stackEl.isConnected) return stackEl;
    let host = document.getElementById('toasts');
    if (!host) {
      host = U.el('div', { id: 'toasts' });
      (document.getElementById('os-root') || document.body).appendChild(host);
    }
    stackEl = host.querySelector('.toast-stack');
    if (!stackEl) {
      stackEl = U.el('div', { class: 'toast-stack' });
      host.appendChild(stackEl);
    }
    return stackEl;
  }

  // ---------------------------------------------------------------- toast timers
  function startTimer(rec) {
    if (!rec.timeout || rec.leaving) return;
    rec.started = Date.now();
    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => dismissToast(rec.id), Math.max(0, rec.remaining));
    rec.el.classList.remove('paused');
  }

  function hold(rec, reason, on) {
    if (rec.leaving || !rec.timeout) return;
    const before = rec.holds.size;
    if (on) rec.holds.add(reason);
    else rec.holds.delete(reason);
    if (!before && rec.holds.size) {
      clearTimeout(rec.timer);
      rec.remaining = Math.max(60, rec.remaining - (Date.now() - rec.started));
      rec.el.classList.add('paused');
    } else if (before && !rec.holds.size) {
      startTimer(rec);
    }
  }

  // ---------------------------------------------------------------- toast DOM
  function showToast(item, opts) {
    const stack = getStack();
    // 0 (or Infinity / negative) = sticky; anything unparsable falls back to the default
    let timeout = opts.timeout == null ? DEFAULT_TIMEOUT : Number(opts.timeout);
    if (Number.isNaN(timeout)) timeout = DEFAULT_TIMEOUT;
    if (!Number.isFinite(timeout) || timeout < 0) timeout = 0;
    const actions = Array.isArray(opts.actions) ? opts.actions.filter((a) => a && a.label) : [];

    const wrap = U.el('div', { class: 'toast-wrap' });
    const el = U.el('div', { class: 'toast', role: 'status', tabindex: '0', dataset: { id: item.id } });
    el.setAttribute('aria-live', 'polite');

    el.appendChild(U.el('div', { class: 'toast-icon', html: iconMarkup(item.icon, 'bell') }));

    const main = U.el('div', { class: 'toast-main' });
    if (item.title) main.appendChild(U.el('div', { class: 'toast-title', text: item.title }));
    if (item.message) main.appendChild(U.el('div', { class: 'toast-msg', text: item.message }));
    if (actions.length) {
      const bar = U.el('div', { class: 'toast-actions' });
      actions.forEach((a) => {
        bar.appendChild(U.el('button', {
          class: 'p-btn small',
          type: 'button',
          text: String(a.label),
          on: {
            click: (e) => {
              e.stopPropagation();
              try {
                if (typeof a.action === 'function') a.action(item.id);
              } catch (err) {
                console.error('[notify] eylem hatası', err);
              }
              dismissToast(item.id);
            }
          }
        }));
      });
      main.appendChild(bar);
    }
    el.appendChild(main);

    el.appendChild(U.el('button', {
      class: 'toast-close',
      type: 'button',
      'aria-label': 'Kapat',
      html: iconMarkup('close', 'x'),
      on: { click: (e) => { e.stopPropagation(); dismissToast(item.id); } }
    }));

    if (timeout) {
      const bar = U.el('div', { class: 'toast-progress' });
      const fill = U.el('i');
      fill.style.animationDuration = timeout + 'ms';
      bar.appendChild(fill);
      el.appendChild(bar);
    }

    const rec = { id: item.id, wrap, el, timeout, remaining: timeout, started: 0, timer: 0, holds: new Set(), leaving: false };

    el.addEventListener('mouseenter', () => hold(rec, 'hover', true));
    el.addEventListener('mouseleave', () => hold(rec, 'hover', false));
    el.addEventListener('focusin', () => hold(rec, 'focus', true));
    el.addEventListener('focusout', () => hold(rec, 'focus', false));
    el.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.toast-close, .toast-actions')) return;
      if (typeof opts.onClick === 'function') {
        try { opts.onClick(copy(item)); } catch (err) { console.error('[notify] onClick hatası', err); }
      } else if (item.appId && P.apps && typeof P.apps.get === 'function' && P.apps.get(item.appId)) {
        // same as clicking the entry in the notification center: open the app the notification belongs to
        try { P.apps.launch(item.appId); } catch (err) { console.error('[notify] uygulama açılamadı', err); }
      }
      dismissToast(item.id);
    });
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      } else if (e.key === 'Escape' || e.key === 'Delete') {
        e.preventDefault();
        dismissToast(item.id);
      }
    });

    wrap.appendChild(el);
    stack.appendChild(wrap);
    live.set(item.id, rec);

    // the stack grows smoothly instead of the older toasts jumping up
    if (animated() && wrap.animate) {
      const h = wrap.offsetHeight;
      try {
        wrap.animate(
          [{ height: '0px', marginTop: -ROW_GAP + 'px' }, { height: h + 'px', marginTop: '0px' }],
          { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
      } catch (e) { /* cosmetic only */ }
    }

    startTimer(rec);

    // too many on screen: the oldest ones collapse (they stay in the history)
    const visible = [...live.values()];
    while (visible.length > MAX_VISIBLE) dismissToast(visible.shift().id);
    return rec;
  }

  function dismissToast(id) {
    const rec = live.get(id);
    if (!rec || rec.leaving) return false;
    rec.leaving = true;
    live.delete(id);
    clearTimeout(rec.timer);
    const { wrap, el } = rec;
    el.classList.add('leaving');
    el.setAttribute('aria-hidden', 'true');
    if (animated() && wrap.animate) {
      const h = wrap.offsetHeight;
      wrap.style.height = h + 'px';
      try {
        wrap.animate(
          [{ height: h + 'px', marginTop: '0px' }, { height: '0px', marginTop: -ROW_GAP + 'px' }],
          { duration: 240, delay: 110, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }
        );
      } catch (e) { /* cosmetic only */ }
      setTimeout(() => wrap.remove(), 420);
    } else {
      wrap.remove();
    }
    return true;
  }

  function centerOpen() {
    try { return !!(P.taskbar && typeof P.taskbar.isPanelOpen === 'function' && P.taskbar.isPanelOpen('notifications')); } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- public API
  function notify(opts) {
    ensureLoaded();
    if (typeof opts === 'string') opts = { title: opts };
    opts = opts && typeof opts === 'object' ? opts : {};
    const app = opts.appId && P.apps && typeof P.apps.get === 'function' ? P.apps.get(opts.appId) : null;
    const item = {
      id: U.uid('ntf'),
      title: str(opts.title),
      message: str(opts.message),
      icon: opts.icon || (app && app.icon) || 'panda',
      appId: opts.appId || null,
      time: Date.now(),
      read: false
    };
    items.unshift(item);
    if (items.length > MAX_HISTORY) items.length = MAX_HISTORY;
    persist();

    if (P.settings.get('dnd') !== true) {
      try {
        // while the notification center is open the new entry appears in its list; a toast would just cover the panel
        if (!centerOpen()) showToast(item, opts);
        if (opts.sound !== false && P.sound && typeof P.sound.play === 'function') P.sound.play('notify');
      } catch (e) {
        console.error('[notify] bildirim gösterilemedi', e);
      }
    }
    P.bus.emit('notify:new', copy(item));
    P.bus.emit('notify:change');
    return item.id;
  }

  let wired = false;
  // another PandaOS tab changed the history (new / read / cleared items): follow it instead of overwriting it later
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== null && e.key !== 'pandaos.' + STORE_KEY) return;
      if (!loaded) return; // never read yet: the first use reads the fresh value anyway
      loaded = false;
      ensureLoaded();
      P.bus.emit('notify:change');
    });
  } catch (e) { /* no window events (non-browser host) */ }

  notify.init = function init() {
    ensureLoaded();
    getStack();
    if (wired) return;
    wired = true;
    // opening the notification center shows everything in its list, so the toasts on screen would only be duplicates
    // covering the panel: they leave (the history keeps them)
    P.bus.on('taskbar:panel', (e) => {
      if (e && e.name === 'notifications' && e.open) [...live.keys()].forEach(dismissToast);
    });
  };

  /**
   * Revokes a notification: closes its toast AND removes it from the history (this is what the
   * notification center's per-item × button calls). Toasts that close by themselves (timeout,
   * × button, click) stay in the history.
   */
  notify.dismiss = function dismiss(id) {
    ensureLoaded();
    const hadToast = dismissToast(id);
    const before = items.length;
    items = items.filter((n) => n.id !== id);
    const hadItem = items.length !== before;
    if (hadItem) {
      persist();
      P.bus.emit('notify:change');
    }
    return hadToast || hadItem;
  };

  /** All notifications, newest first. */
  notify.history = function history() {
    ensureLoaded();
    return items.map(copy);
  };

  /** Alias of dismiss(). */
  notify.remove = function remove(id) {
    return notify.dismiss(id);
  };

  notify.clear = function clear() {
    ensureLoaded();
    [...live.keys()].forEach(dismissToast);
    if (!items.length) return;
    items = [];
    persist();
    P.bus.emit('notify:change');
  };

  notify.markAllRead = function markAllRead() {
    ensureLoaded();
    let changed = false;
    items.forEach((n) => {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    });
    if (!changed) return;
    persist();
    P.bus.emit('notify:change');
  };

  notify.unreadCount = function unreadCount() {
    ensureLoaded();
    return items.reduce((n, item) => n + (item.read ? 0 : 1), 0);
  };

  P.notify = notify;
})();
