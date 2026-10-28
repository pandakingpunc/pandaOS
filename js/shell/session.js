/* PandaOS session — boot splash, lock screen, restart and shutdown.
   Renders into #boot-screen and #lock-screen. API: docs/API.md §7. */
(function () {
  'use strict';

  const P = (window.PandaOS = window.PandaOS || {});
  const util = P.util;
  const el = util.el;

  // In ?fast=1 runs every wait is shortened so test suites stay quick.
  const T = P.params && P.params.get('fast') === '1' && P.params.get('slow') !== '1' ? 0.2 : 1;

  let inited = false;
  let bootEl = null;
  let lockEl = null;
  let ui = null;              // lock screen DOM refs (built lazily)

  let locked = false;
  let unlocking = false;
  let unlockPromise = null;
  let off = false;            // powered off (black screen)
  let shutting = false;       // shutdown / restart in progress
  let booting = false;        // boot splash showing
  let view = 'clock';
  let tickTimer = 0;
  let enterTimer = 0;
  const resolvers = [];       // pending lock() promises

  // ------------------------------------------------------------------ helpers
  function iconMarkup(name, fallback) {
    try {
      if (P.icons && typeof P.icons.get === 'function') return P.icons.get(name);
    } catch (e) { /* use fallback */ }
    return fallback || '';
  }

  const PANDA_FALLBACK = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="10" fill="#111"/><circle cx="48" cy="16" r="10" fill="#111"/><circle cx="32" cy="36" r="24" fill="#fff" stroke="#111" stroke-width="3"/><ellipse cx="23" cy="34" rx="6" ry="8" fill="#111" transform="rotate(-20 23 34)"/><ellipse cx="41" cy="34" rx="6" ry="8" fill="#111" transform="rotate(20 41 34)"/><circle cx="24" cy="33" r="2" fill="#fff"/><circle cx="40" cy="33" r="2" fill="#fff"/><ellipse cx="32" cy="46" rx="4" ry="3" fill="#111"/></svg>';
  const AVATAR_FALLBACK = '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="#4b6a62"/><circle cx="24" cy="19" r="8" fill="#e8f0ee"/><path d="M8 46c2-11 9-15 16-15s14 4 16 15z" fill="#e8f0ee"/></svg>';
  const POWER_FALLBACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>';
  const PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';

  function playSound(name) {
    try { if (P.sound && typeof P.sound.play === 'function') P.sound.play(name); } catch (e) { /* ignore */ }
  }

  function ensureLayers() {
    if (!bootEl) {
      bootEl = document.getElementById('boot-screen');
      if (!bootEl) {
        bootEl = el('div', { id: 'boot-screen' });
        (document.getElementById('os-root') || document.body).appendChild(bootEl);
      }
    }
    if (!lockEl) {
      lockEl = document.getElementById('lock-screen');
      if (!lockEl) {
        lockEl = el('div', { id: 'lock-screen' });
        (document.getElementById('os-root') || document.body).appendChild(lockEl);
      }
    }
  }

  function wallpaperCss() {
    try {
      if (P.wallpapers && typeof P.wallpapers.css === 'function') return P.wallpapers.css(P.settings.get('wallpaper'));
    } catch (e) { console.warn('[session] duvar kağıdı çözülemedi', e); }
    return '#0b1210';
  }

  function closeWindows() {
    try {
      const list = P.wm && typeof P.wm.list === 'function' ? P.wm.list() : [];
      list.forEach((w) => {
        try { w.forceClose(); } catch (e) { console.error('[session] pencere kapatılamadı', e); }
      });
    } catch (e) { console.error('[session] pencereler kapatılamadı', e); }
  }

  function closeTransient() {
    try { if (P.startMenu && P.startMenu.close) P.startMenu.close(); } catch (e) { /* ignore */ }
    try { if (P.contextMenu && P.contextMenu.hide) P.contextMenu.hide(); } catch (e) { /* ignore */ }
  }

  /** Put a full-screen layer on top; whatever was there before is removed once the new one is solid. */
  function pushLayer(layer) {
    ensureLayers();
    const prev = [...bootEl.children];
    bootEl.appendChild(layer);
    if (prev.length) {
      setTimeout(() => prev.forEach((n) => { if (n.parentNode === bootEl && n !== layer) n.remove(); }), 480);
    }
  }

  // ------------------------------------------------------------------ boot splash
  function buildSplash() {
    return el('div', { class: 'boot-layer boot-splash in', role: 'status', 'aria-label': 'PandaOS başlatılıyor' },
      el('div', { class: 'boot-logo', html: iconMarkup('panda', PANDA_FALLBACK) }),
      el('div', { class: 'boot-word', text: 'PandaOS' }),
      el('div', { class: 'boot-progress' }),
      el('div', { class: 'boot-version', text: `Sürüm ${P.version || '1.0'}${P.codename ? ` · ${P.codename}` : ''}` }));
  }

  function bootSplash(opts) {
    ensureLayers();
    return new Promise((resolve) => {
      booting = true;
      const layer = buildSplash();
      pushLayer(layer);
      const duration = opts && typeof opts.duration === 'number' ? opts.duration : 1850 * T;
      setTimeout(() => {
        booting = false;
        layer.classList.add('out');
        // resolved as the fade starts: the lock screen is built underneath and shows through
        resolve();
        setTimeout(() => layer.remove(), 520);
      }, duration);
    });
  }

  // ------------------------------------------------------------------ lock screen
  function clockParts(d) {
    const h24 = P.settings.get('clock24h') !== false;
    let h = d.getHours();
    const m = d.getMinutes();
    let suffix = '';
    if (!h24) {
      suffix = h >= 12 ? 'ÖS' : 'ÖÖ';
      h = h % 12 || 12;
    }
    return { hm: `${h24 ? String(h).padStart(2, '0') : h}:${String(m).padStart(2, '0')}`, suffix };
  }

  function tick() {
    if (!ui) return;
    const d = new Date();
    const p = clockParts(d);
    if (ui.hm.textContent !== p.hm) ui.hm.textContent = p.hm;
    if (ui.ampm.textContent !== p.suffix) ui.ampm.textContent = p.suffix;
    const ds = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
    if (ui.date.textContent !== ds) ui.date.textContent = ds;
  }

  function startTick() {
    stopTick();
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  function stopTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
  }

  function setLockWallpaper() {
    if (!ui) return;
    ui.bgImg.style.background = wallpaperCss();
    let dim = 0.8;
    try { if (P.wallpapers && P.wallpapers.dim) dim = P.wallpapers.dim(P.settings.get('wallpaper')); } catch (e) { /* default */ }
    ui.root.style.setProperty('--lock-b', String(dim));
  }

  function buildLock() {
    if (ui) return ui;
    ensureLayers();
    const root = el('div', { class: 'lock-root', tabindex: '-1', role: 'dialog', 'aria-label': 'Kilit ekranı' });
    const bgImg = el('div', { class: 'lock-bg-img' });
    const bg = el('div', { class: 'lock-bg' }, bgImg);
    const shade = el('div', { class: 'lock-shade' });

    // clock view
    const hm = el('span', { class: 'lock-hm' });
    const ampm = el('span', { class: 'lock-ampm' });
    const date = el('div', { class: 'lock-date' });
    const clockView = el('div', { class: 'lock-view lock-clockview' },
      el('div', { class: 'lock-clock' }, el('div', { class: 'lock-time' }, hm, ampm), date),
      el('div', { class: 'lock-hint' },
        el('span', { class: 'lock-chev', html: iconMarkup('chevron-up') }),
        el('span', { text: 'Kilidi açmak için tıklayın veya bir tuşa basın' })));

    // sign-in view
    const input = el('input', {
      class: 'lock-input', type: 'password', placeholder: 'Parola', autocomplete: 'off', spellcheck: false, 'aria-label': 'Parola'
    });
    const go = el('button', { class: 'lock-go', type: 'submit', 'aria-label': 'Oturum aç', html: iconMarkup('arrow-right') }, el('span', { class: 'lock-spin' }));
    const form = el('form', { class: 'lock-form', autocomplete: 'off' },
      el('div', { class: 'lock-avatar', html: iconMarkup('avatar', AVATAR_FALLBACK) }),
      el('div', { class: 'lock-name', text: (P.user && P.user.displayName) || 'Panda' }),
      el('div', { class: 'lock-pass' }, input, go),
      el('div', { class: 'lock-sub', text: 'Şifre gerekmez — Enter\'a basman yeterli' }));
    const signView = el('div', { class: 'lock-view lock-signview', 'aria-hidden': 'true' }, form);

    // bottom-right: status glyphs + power
    const restartBtn = el('button', { class: 'lock-menu-item', type: 'button', html: iconMarkup('restart') }, el('span', { text: 'Yeniden Başlat' }));
    const shutdownBtn = el('button', { class: 'lock-menu-item', type: 'button', html: iconMarkup('power', POWER_FALLBACK) }, el('span', { text: 'Kapat' }));
    const menu = el('div', { class: 'lock-menu', hidden: true, role: 'menu' }, restartBtn, shutdownBtn);
    const powerBtn = el('button', { class: 'lock-power', type: 'button', 'aria-label': 'Güç', 'aria-haspopup': 'menu', html: iconMarkup('power', POWER_FALLBACK) });
    const corner = el('div', { class: 'lock-corner' },
      el('div', { class: 'lock-status', html: `${iconMarkup('wifi')}${iconMarkup('battery')}` }),
      powerBtn, menu);
    // bottom-left: switch to the PandamOS phone build (mobile/index.html)
    const mobileLink = el('a', { class: 'lock-mobile', href: 'mobile/index.html', 'aria-label': 'Mobil sürüme geç (PandamOS)', html: PHONE_ICON },
      el('span', { text: 'Mobil' }));

    root.append(bg, shade, clockView, signView, corner, mobileLink);
    lockEl.appendChild(root);

    ui = { root, bgImg, hm, ampm, date, input, go, form, signView, clockView, menu, powerBtn, restartBtn, shutdownBtn };

    // reveal the sign-in view on click
    root.addEventListener('click', (e) => {
      if (!locked || unlocking) return;
      if (e.target.closest('.lock-corner, .lock-mobile')) return;
      if (view === 'clock') showSignin();
    });
    root.addEventListener('keydown', onLockKey);
    // the wallpaper drifts a few pixels against the pointer
    let parallaxQueued = false;
    root.addEventListener('pointermove', (e) => {
      if (parallaxQueued) return;
      parallaxQueued = true;
      const x = e.clientX;
      const y = e.clientY;
      requestAnimationFrame(() => {
        parallaxQueued = false;
        const w = root.clientWidth || 1;
        const h = root.clientHeight || 1;
        bgImg.style.setProperty('--px', ((x / w) * 2 - 1).toFixed(3));
        bgImg.style.setProperty('--py', ((y / h) * 2 - 1).toFixed(3));
      });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    powerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    restartBtn.addEventListener('click', () => { menu.hidden = true; restart(); });
    shutdownBtn.addEventListener('click', () => { menu.hidden = true; shutdown(); });
    root.addEventListener('pointerdown', (e) => {
      if (!menu.hidden && !e.target.closest('.lock-menu, .lock-power')) menu.hidden = true;
    });
    return ui;
  }

  function showSignin() {
    if (!ui || view === 'signin') return;
    view = 'signin';
    ui.root.classList.add('is-signin');
    ui.signView.setAttribute('aria-hidden', 'false');
    ui.clockView.setAttribute('aria-hidden', 'true');
    try { ui.input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function showClock() {
    if (!ui || view === 'clock') return;
    view = 'clock';
    ui.root.classList.remove('is-signin', 'is-busy');
    ui.signView.setAttribute('aria-hidden', 'true');
    ui.clockView.setAttribute('aria-hidden', 'false');
    ui.menu.hidden = true;
    ui.input.value = '';
    ui.input.disabled = false;
    try { ui.root.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function submit() {
    if (!locked || unlocking || !ui) return;
    if (ui.root.classList.contains('is-busy')) return;
    // any (or empty) password signs in; a short "signing in" beat keeps it feeling real
    ui.root.classList.add('is-busy');
    ui.input.disabled = true;
    setTimeout(() => { if (locked && !unlocking) unlock(); }, 520 * T);
  }

  function onLockKey(e) {
    if (!locked || unlocking || !ui) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!ui.menu.hidden) ui.menu.hidden = true;
      else showClock();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onPower = e.target.closest && e.target.closest('.lock-corner, .lock-mobile');
    if (onPower) return;
    if (e.key === 'Enter' && e.target === ui.input) {
      e.preventDefault();
      submit();
      return;
    }
    if (view === 'clock') {
      e.preventDefault();
      showSignin();
      if (e.key && e.key.length === 1) ui.input.value += e.key;
      return;
    }
    if (document.activeElement !== ui.input) {
      // focus drifted (e.g. clicked the wallpaper): route the key into the password field
      try { ui.input.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key && e.key.length === 1) { e.preventDefault(); ui.input.value += e.key; }
    }
  }

  function lock(opts) {
    ensureLayers();
    if (off || shutting) return Promise.resolve();
    if (unlocking && unlockPromise) return unlockPromise.then(() => lock(opts));
    const promise = new Promise((resolve) => resolvers.push(resolve));
    if (locked) return promise;

    buildLock();
    locked = true;
    view = 'clock';
    ui.root.classList.remove('is-signin', 'is-busy', 'unlocking');
    ui.signView.setAttribute('aria-hidden', 'true');
    ui.clockView.setAttribute('aria-hidden', 'false');
    ui.input.value = '';
    ui.input.disabled = false;
    ui.menu.hidden = true;
    setLockWallpaper();
    startTick();
    closeTransient();
    try {
      const a = document.activeElement;
      if (a && a !== document.body && !lockEl.contains(a) && typeof a.blur === 'function') a.blur();
    } catch (e) { /* ignore */ }

    ui.root.classList.add('active');
    ui.root.classList.remove('entering');
    void ui.root.offsetWidth; // restart the entrance animation
    ui.root.classList.add('entering');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => { if (ui) ui.root.classList.remove('entering'); }, 1200);
    try { ui.root.focus({ preventScroll: true }); } catch (e) { /* ignore */ }

    P.bus.emit('session:lock', { initial: !!(opts && opts.initial) });
    return promise;
  }

  function unlock() {
    if (!locked) return unlockPromise || Promise.resolve();
    if (unlocking) return unlockPromise;
    unlocking = true;
    locked = false;
    clearTimeout(enterTimer);
    ui.root.classList.remove('entering');
    ui.root.classList.add('unlocking');
    ui.menu.hidden = true;
    playSound('startup');
    P.bus.emit('session:unlock');
    // lock() blurred whatever had focus: the active window gets its caret / keyboard back (an empty desktop takes it
    // itself, see desktop.js). Without this every key typed after unlocking would land on the desktop.
    try { if (P.wm && typeof P.wm.refocus === 'function') P.wm.refocus(); } catch (e) { /* ignore */ }
    unlockPromise = new Promise((resolve) => {
      setTimeout(() => {
        stopTick();
        ui.root.classList.remove('active', 'unlocking', 'is-signin', 'is-busy');
        ui.input.value = '';
        ui.input.disabled = false;
        view = 'clock';
        unlocking = false;
        unlockPromise = null;
        resolvers.splice(0).forEach((r) => r());
        resolve();
      }, 470);
    });
    return unlockPromise;
  }

  /** Remove the lock screen without signing in (used when the machine goes down while locked). */
  function dropLock() {
    if (!ui) return;
    locked = false;
    unlocking = false;
    unlockPromise = null;
    clearTimeout(enterTimer);
    stopTick();
    ui.root.classList.remove('active', 'unlocking', 'is-signin', 'is-busy', 'entering');
    view = 'clock';
  }

  // ------------------------------------------------------------------ shutdown / restart
  function buildWait(message) {
    return el('div', { class: 'boot-layer boot-wait in', role: 'status' },
      el('div', { class: 'boot-ring' }),
      el('div', { class: 'boot-msg', text: message }));
  }

  function buildOff() {
    const btn = el('button', { class: 'boot-power', type: 'button', 'aria-label': 'Güç düğmesi', html: iconMarkup('power', POWER_FALLBACK) });
    const layer = el('div', { class: 'boot-layer boot-off in' },
      btn,
      el('div', { class: 'boot-off-text', text: 'PandaOS kapatıldı. Açmak için güç düğmesine bas.' }));
    btn.addEventListener('click', powerOn);
    setTimeout(() => { try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
    return layer;
  }

  function goingDown(kind) {
    closeTransient();
    // a dialog left over from the old session must not pop up again after the reboot
    try { if (P.dialog && typeof P.dialog.closeAll === 'function') P.dialog.closeAll(); } catch (e) { /* ignore */ }
    dropLock();
    playSound('shutdown');
    closeWindows();
    P.bus.emit(kind === 'restart' ? 'session:restart' : 'session:shutdown');
  }

  /** Windows that may want to veto being closed (an editor with unsaved changes sets win.beforeClose). */
  function guardedWindows() {
    try {
      return (P.wm && typeof P.wm.list === 'function' ? P.wm.list() : [])
        .filter((w) => w && !w.isClosed() && typeof w.beforeClose === 'function');
    } catch (e) { return []; }
  }

  /** Asks every guarded window to close (topmost first, so its dialog is the one the user sees). False = someone said no. */
  async function askWindowsToClose() {
    const list = guardedWindows().reverse();
    for (const w of list) {
      if (w.isClosed()) continue;
      try { w.focus(); } catch (e) { /* ignore */ }
      let closed = true;
      try { closed = await w.close(); } catch (e) { console.error('[session] pencere kapatılamadı', e); }
      if (closed === false) return false;
    }
    return true;
  }

  let leaving = false; // a shutdown / restart request is waiting for the windows' answers

  /** Shutdown / restart entry. Windows with unsaved work get to ask first; cancelling any of them cancels the request.
   *  (From the lock screen nobody could answer a dialog, so everything just closes.) */
  function leave(kind) {
    if (shutting || off) return;
    if (locked) {
      // nobody can answer a "save changes?" dialog from the lock screen: drop a request that is still waiting on one
      leaving = false;
      goingNow(kind);
      return;
    }
    if (leaving) return;
    if (!guardedWindows().length) { goingNow(kind); return; }
    leaving = true;
    askWindowsToClose().then((ok) => {
      leaving = false;
      if (ok && !shutting && !off) goingNow(kind);
    }, () => {
      leaving = false;
      goingNow(kind);
    });
  }

  function goingNow(kind) {
    shutting = true;
    goingDown(kind);
    if (kind === 'restart') {
      pushLayer(buildWait('Yeniden başlatılıyor...'));
      setTimeout(() => {
        shutting = false;
        bootSplash().then(() => lock({ initial: true }));
      }, 1400 * T);
    } else {
      pushLayer(buildWait('Kapatılıyor...'));
      setTimeout(() => {
        pushLayer(buildOff());
        off = true;
        shutting = false;
      }, 1500 * T);
    }
  }

  function shutdown() { leave('shutdown'); }

  function restart() { leave('restart'); }

  function powerOn() {
    if (!off) return;
    off = false;
    bootSplash().then(() => lock({ initial: true }));
  }

  // ------------------------------------------------------------------ input guard
  function blocked() {
    return locked || off || shutting || booting;
  }

  function onGuardKey(e) {
    if (e.type === 'keydown' && !blocked() && e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey
      && (e.code === 'KeyL' || e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      e.stopPropagation();
      lock();
      return;
    }
    if (!blocked()) return;
    const t = e.target;
    const inside = t && t.nodeType === 1 && ((lockEl && lockEl.contains(t)) || (bootEl && bootEl.contains(t)));
    if (inside) return;
    // nothing behind the lock / boot screens may receive keystrokes
    e.stopImmediatePropagation();
    if (e.type === 'keydown' && locked && ui) {
      e.preventDefault();
      try { ui.root.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      onLockKey(e);
    } else if (e.type === 'keydown') e.preventDefault();
  }

  // ------------------------------------------------------------------ unsaved work & other tabs
  /** Closing the tab / reloading with an editor that still has unsaved changes asks first, like any web app.
   *  A window announces unsaved work with `win.beforeClose`; one that keeps a permanent beforeClose can say
   *  `win.dirty = false` while it is clean (an undefined `dirty` counts as unsaved). */
  function initUnloadGuard() {
    window.addEventListener('beforeunload', (e) => {
      let unsaved = false;
      try {
        unsaved = (P.wm && typeof P.wm.list === 'function' ? P.wm.list() : [])
          .some((w) => w && !w.isClosed() && typeof w.beforeClose === 'function' && w.dirty !== false);
      } catch (err) { unsaved = false; }
      if (!unsaved) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  // ------------------------------------------------------------------ init & API
  function init() {
    if (inited) return;
    inited = true;
    ensureLayers();
    ['keydown', 'keyup', 'keypress'].forEach((type) => document.addEventListener(type, onGuardKey, true));
    document.addEventListener('focusin', (e) => {
      if (!locked || unlocking || !ui) return;
      const t = e.target;
      if (t && t.nodeType === 1 && !lockEl.contains(t)) {
        try { ui.root.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      }
    });
    P.bus.on('settings:change', (e) => {
      if (e.key === 'wallpaper') setLockWallpaper();
      else if (e.key === 'clock24h') tick();
    });
    initUnloadGuard();
    P.bus.on('fs:change', () => {
      if (ui && String(P.settings.get('wallpaper')).startsWith('vfs:')) setLockWallpaper();
    });
    // Storage health, checked once the desktop is reachable: when the browser refuses to persist anything (blocked
    // site data, private window, full quota) the fs keeps working in memory and every setting is lost on reload.
    P.bus.once('os:ready', () => {
      setTimeout(() => {
        try {
          if (P.storage.set('health', Date.now()) || typeof P.notify !== 'function') return;
          P.notify({
            title: 'Depolama kullanılamıyor',
            message: 'Tarayıcı depolaması kapalı ya da dolu. Dosyaların ve ayarların sekme kapanınca kaybolabilir.',
            icon: 'warning',
            timeout: 0
          });
        } catch (e) { /* ignore */ }
      }, 1200);
    });
  }

  P.session = {
    init,
    bootSplash,
    lock,
    unlock,
    isLocked: () => locked || off || shutting,
    restart,
    shutdown,
    /** 'running' | 'booting' | 'locked' | 'shuttingDown' | 'off' */
    state: () => (off ? 'off' : shutting ? 'shuttingDown' : locked ? 'locked' : booting ? 'booting' : 'running')
  };
})();
