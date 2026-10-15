/* PandaOS taskbar (C3b) — centered Windows 11 style taskbar with pinned/running apps,
   system tray, Quick Settings, Calendar and Notification Center flyouts.
   Renders into #taskbar and #panels. Public API: PandaOS.taskbar (see docs/API.md §8). */
(function () {
  'use strict';

  const P = window.PandaOS;
  if (!P) return;
  const { el, clamp } = P.util;
  const bus = P.bus;
  const settings = P.settings;
  const storage = P.storage;

  // ------------------------------------------------------------------ data
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  // key = month * 100 + day (fixed-date Turkish public holidays)
  const HOLIDAYS = {
    101: 'Yılbaşı',
    423: 'Ulusal Egemenlik ve Çocuk Bayramı',
    501: 'Emek ve Dayanışma Günü',
    519: "Atatürk'ü Anma Gençlik ve Spor Bayramı",
    715: 'Demokrasi ve Millî Birlik Günü',
    830: 'Zafer Bayramı',
    1029: 'Cumhuriyet Bayramı'
  };

  const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">';
  // 24x24 stroke glyphs that PandaOS.icons does not ship
  const GLYPHS = {
    bluetooth: SVG_OPEN + '<polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>',
    theme: SVG_OPEN + '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    sparkle: SVG_OPEN + '<path d="M11 3l1.9 5.6L18.5 10.5l-5.6 1.9L11 18l-1.9-5.6L3.5 10.5l5.6-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    night: SVG_OPEN + '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>'
  };

  // ------------------------------------------------------------------ helpers
  const pad = (n) => String(n).padStart(2, '0');
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const holidayOf = (d) => HOLIDAYS[(d.getMonth() + 1) * 100 + d.getDate()] || '';
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function fmtTime(d, withSeconds) {
    const sec = withSeconds ? ':' + pad(d.getSeconds()) : '';
    if (settings.get('clock24h') !== false) return pad(d.getHours()) + ':' + pad(d.getMinutes()) + sec;
    const h = d.getHours() % 12 || 12;
    return h + ':' + pad(d.getMinutes()) + sec + ' ' + (d.getHours() < 12 ? 'ÖÖ' : 'ÖS');
  }
  const fmtDateShort = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const fmtDateLong = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const fmtDateFull = (d) => `${DAYS[d.getDay()]}, ${fmtDateLong(d)}`;

  function toMs(t) {
    if (typeof t === 'number') return t;
    const n = new Date(t).getTime();
    return Number.isFinite(n) ? n : Date.now();
  }

  function relTime(t) {
    const diff = Math.max(0, Date.now() - toMs(t));
    const s = diff / 1000;
    if (s < 45) return 'az önce';
    const m = Math.max(1, Math.round(s / 60));
    if (m < 60) return `${m} dk önce`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} sa önce`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'dün';
    if (d < 7) return `${d} gün önce`;
    return fmtDateShort(new Date(toMs(t)));
  }

  function iconMarkup(name) {
    if (!name) name = 'file-app';
    if (typeof name === 'string' && name.trim().startsWith('<svg')) return name;
    const icons = P.icons;
    if (icons && typeof icons.get === 'function' && (GLYPHS[name] == null || (icons.has && icons.has(name)))) {
      try { return icons.get(name); } catch (e) { /* fall through */ }
    }
    if (GLYPHS[name]) return GLYPHS[name];
    return SVG_OPEN + '<circle cx="12" cy="12" r="8"/></svg>';
  }

  function icon(name, cls) {
    const s = el('span', { class: 'tb-i' + (cls ? ' ' + cls : '') });
    s.innerHTML = iconMarkup(name);
    return s;
  }

  function batteryMarkup(level, charging) {
    const w = Math.max(1.2, 12.6 * clamp(level, 0, 1));
    const low = level <= 0.2 && !charging;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="2" y="6.5" width="17" height="11" rx="2.8"/><path d="M21.6 10.4v3.2"/>' +
      `<rect x="4.2" y="8.7" width="${w.toFixed(1)}" height="6.6" rx="1.1" fill="${low ? 'var(--danger)' : 'currentColor'}" stroke="none"/>` +
      (charging ? '<path d="M11.6 8.4l-2.6 4h3.2l-1.6 3.4 3.8-4.6h-3.1z" fill="var(--surface-glass-strong)" stroke="none" opacity=".92"/>' : '') +
      '</svg>';
  }

  function safe(label, fn) {
    try { return fn(); } catch (e) { console.error(`[taskbar] ${label}`, e); return undefined; }
  }

  const allWindows = () => {
    try { return (P.wm && typeof P.wm.list === 'function' ? P.wm.list() : []) || []; } catch (e) { return []; }
  };
  const windowsOf = (appId) => allWindows().filter((w) => w.appId === appId);
  const winTitle = (w) => { try { return w.getTitle() || ''; } catch (e) { return ''; } };
  const winMin = (w) => { try { return !!w.isMinimized(); } catch (e) { return false; } };
  const winFocused = (w) => { try { return !!w.isFocused(); } catch (e) { return false; } };

  // ------------------------------------------------------------------ state
  let inited = false;
  let ready = false;
  let panelsEl;
  let centerEl, startBtn, trayEl, sysBtn, bellBtn, clockBtn, showDeskBtn, badgeEl, bellIconEl;
  let wifiG, volG, batG;
  let clockTimeEl, clockDateEl;
  const buttons = new Map(); // appId -> button element
  const runOrder = []; // running non-pinned appIds in the order they appeared
  const flyouts = {};
  let openName = null;
  const qsState = Object.assign({ wifi: true, bluetooth: true, night: false }, storage.get('qs', {}));
  let battery = null;

  // ================================================================== tooltip
  // One OS-styled tooltip for the whole shell: the taskbar uses it directly, other modules (desktop icons, window caption
  // buttons...) through PandaOS.ui.tip(el, text, delay) so every hover hint looks, times and themes the same way.
  const tip = { el: null, timer: 0, anchor: null, lastHide: 0, watch: 0 };

  function tipHost() {
    return panelsEl || document.getElementById('panels');
  }

  /** the tooltip element lives in #panels; created lazily so PandaOS.ui.tip works before / without taskbar.init() */
  function ensureTip() {
    const host = tipHost();
    if (!host) return null;
    if (!tip.el) tip.el = el('div', { class: 'tb-tip', role: 'tooltip' });
    if (tip.el.parentNode !== host) host.appendChild(tip.el);
    return tip.el;
  }

  function setTipText(text) {
    tip.el.textContent = text;
    tip.el.classList.toggle('multi', String(text).indexOf('\n') >= 0);
  }

  function showTip(anchor, text, delay) {
    if (!anchor || !text || !ensureTip()) return;
    clearTimeout(tip.timer);
    const wait = delay != null ? delay : (Date.now() - tip.lastHide < 350 ? 0 : 450);
    const show = () => {
      if (!anchor.isConnected) return;
      if (openName && flyouts[openName] && flyouts[openName].anchor === anchor) return; // its flyout is already open
      tip.anchor = anchor;
      setTipText(text);
      tip.el.classList.remove('show');
      placeTip();
      void tip.el.offsetWidth; // reflow: the fade/slide starts from the hidden state
      tip.el.classList.add('show');
      // the anchor can vanish (window closed, icon re-rendered, button removed) without a mouseleave ever arriving
      clearInterval(tip.watch);
      tip.watch = setInterval(() => {
        const a = tip.anchor;
        if (!a || !a.isConnected || a.getClientRects().length === 0) hideTip();
      }, 250);
    };
    if (wait <= 0) show(); else tip.timer = setTimeout(show, wait);
  }

  /** centers the tooltip above its anchor, or below it when there is no room above (also re-run on window resize) */
  function placeTip() {
    const anchor = tip.anchor;
    const host = tipHost();
    if (!anchor || !anchor.isConnected || !host || !tip.el) return;
    const pr = host.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    tip.el.style.left = '0px';
    tip.el.style.top = '0px';
    const tw = tip.el.offsetWidth;
    const th = tip.el.offsetHeight;
    const left = clamp(ar.left + ar.width / 2 - tw / 2 - pr.left, 8, Math.max(8, pr.width - tw - 8));
    let top = ar.top - pr.top - th - 10;
    const below = top < 6;
    if (below) top = Math.min(ar.bottom - pr.top + 10, Math.max(6, pr.height - th - 6));
    tip.el.classList.toggle('below', below);
    tip.el.style.left = Math.round(left) + 'px';
    tip.el.style.top = Math.round(top) + 'px';
  }

  function hideTip() {
    clearTimeout(tip.timer);
    clearInterval(tip.watch);
    tip.watch = 0;
    if (!tip.el) return;
    if (tip.el.classList.contains('show')) tip.lastHide = Date.now();
    tip.el.classList.remove('show');
    tip.anchor = null;
  }

  /** hover tooltip for `node`; `getText` is a string or a function (re-evaluated on every hover). Returns detach(). */
  function tipOn(node, getText, delay) {
    const enter = () => showTip(node, typeof getText === 'function' ? getText() : getText, delay);
    const leave = hideTip;
    node.addEventListener('mouseenter', enter);
    node.addEventListener('mouseleave', leave);
    node.addEventListener('pointerdown', hideTip);
    return () => {
      node.removeEventListener('mouseenter', enter);
      node.removeEventListener('mouseleave', leave);
      node.removeEventListener('pointerdown', hideTip);
      if (tip.anchor === node) hideTip();
    };
  }

  P.ui = P.ui || {};
  P.ui.tip = tipOn;
  P.ui.tip.hide = hideTip;

  // ================================================================== context menu helper
  function showMenu(x, y, items) {
    const cm = P.contextMenu;
    if (!cm || typeof cm.show !== 'function') return false;
    hideTip();
    closeWindowList(true);
    safe('contextMenu.show', () => cm.show(x, y, items.filter(Boolean)));
    // taskbar menus must open above the bar, never over it
    safe('menu placement', () => {
      const layer = document.getElementById('context-menu-layer');
      const menu = layer && layer.lastElementChild;
      if (!menu) return;
      const limit = window.innerHeight - 48 - 6;
      const r = menu.getBoundingClientRect();
      if (r.height && r.bottom > limit) {
        const top = Math.max(6, limit - r.height);
        menu.style.top = top + 'px';
      }
    });
    return true;
  }

  // ================================================================== app buttons
  function appInfo(id, wins) {
    const def = P.apps && P.apps.get ? P.apps.get(id) : null;
    return {
      def,
      name: (def && def.name) || (wins[0] && winTitle(wins[0])) || id,
      icon: (def && def.icon) || (def ? id : 'file-app')
    };
  }

  function pinnedList() {
    const list = settings.get('taskbar.pinned');
    return Array.isArray(list) ? list.filter((v, i) => typeof v === 'string' && list.indexOf(v) === i) : [];
  }

  function setPinned(list) { settings.set('taskbar.pinned', list); }

  function togglePin(id) {
    const list = pinnedList();
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    setPinned(list);
  }

  function createButton(id, index) {
    const btn = el('button', { class: 'tb-btn tb-app', type: 'button', dataset: { app: id } },
      el('span', { class: 'tb-ico' }), el('span', { class: 'tb-pill' }));
    if (!ready) {
      btn.classList.add('intro');
      btn.style.setProperty('--i', String(index));
      setTimeout(() => btn.classList.remove('intro'), 700 + index * 50);
    } else {
      btn.classList.add('entering');
      setTimeout(() => btn.classList.remove('entering'), 420);
    }
    btn.addEventListener('click', () => { if (!drag.suppressClick) onAppClick(id); });
    btn.addEventListener('pointerdown', (e) => beginDrag(e, id, btn));
    btn.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    btn.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      hideTip();
      if (P.apps) P.apps.launch(id);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      appMenu(id, r.left + r.width / 2, r.top - 4);
    });
    btn.addEventListener('mouseenter', () => onAppEnter(id, btn));
    btn.addEventListener('mouseleave', () => onAppLeave(id));
    btn.addEventListener('pointerdown', hideTip);
    return btn;
  }

  // ------------------------------------------------------------------ drag to reorder
  const drag = { id: null, btn: null, x0: 0, on: false, group: [], rects: [], from: 0, to: 0, pinned: false, suppressClick: false };

  /** buttons that can be reordered together: pinned apps among themselves, running ones among themselves */
  function dragGroup(id) {
    const pinned = pinnedList().filter((p) => buttons.has(p));
    if (pinned.includes(id)) return { ids: pinned, pinned: true };
    const domOrder = [...centerEl.querySelectorAll('.tb-app:not(.leaving)')].map((b) => b.dataset.app);
    return { ids: domOrder.filter((k) => buttons.has(k) && !pinned.includes(k)), pinned: false };
  }

  function beginDrag(e, id, btn) {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    drag.id = id;
    drag.btn = btn;
    drag.x0 = e.clientX;
    drag.on = false;
    document.addEventListener('pointermove', moveDragEvent);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  function moveDragEvent(e) {
    const rawDx = e.clientX - drag.x0;
    if (!drag.on) {
      if (Math.abs(rawDx) < 8) return;
      const g = dragGroup(drag.id);
      if (g.ids.length < 2) return;
      drag.on = true;
      // settle any neighbour slide (FLIP) animation so the measured positions are the real ones
      buttons.forEach((b) => {
        if (typeof b.getAnimations !== 'function') return;
        b.getAnimations().forEach((a) => {
          const css = (window.CSSAnimation && a instanceof window.CSSAnimation) || (window.CSSTransition && a instanceof window.CSSTransition);
          if (!css) { try { a.finish(); } catch (e) { /* ignore */ } }
        });
      });
      drag.group = g.ids;
      drag.pinned = g.pinned;
      drag.from = g.ids.indexOf(drag.id);
      drag.to = drag.from;
      // natural (untransformed) positions, taken in DOM order
      drag.rects = g.ids.map((k) => buttons.get(k).getBoundingClientRect());
      hideTip();
      closeWindowList(true);
      drag.btn.classList.add('dragging');
      g.ids.forEach((k) => { if (k !== drag.id) buttons.get(k).classList.add('shiftable'); });
    }
    const r0 = drag.rects[drag.from];
    const minDx = drag.rects[0].left - r0.left;
    const maxDx = drag.rects[drag.rects.length - 1].left - r0.left;
    const dx = clamp(rawDx, minDx, maxDx);
    drag.btn.style.transform = `translateX(${dx}px)`;
    const cx = r0.left + r0.width / 2 + dx;
    let to = 0;
    drag.rects.forEach((r, i) => {
      const c = r.left + r.width / 2;
      // the clamped drag reaches exactly the last / first centre, so the far end counts as passed
      if (i !== drag.from && (i > drag.from ? c <= cx : c < cx)) to++;
    });
    drag.to = to;
    const step = (drag.rects[1] ? Math.abs(drag.rects[1].left - drag.rects[0].left) : r0.width + 4);
    drag.group.forEach((k, i) => {
      if (i === drag.from) return;
      let s = 0;
      if (to > drag.from && i > drag.from && i <= to) s = -step;
      else if (to < drag.from && i >= to && i < drag.from) s = step;
      buttons.get(k).style.transform = s ? `translateX(${s}px)` : '';
    });
  }

  function endDrag() {
    document.removeEventListener('pointermove', moveDragEvent);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    if (!drag.on) return;
    drag.on = false;
    const { group, from, to, pinned, id } = drag;
    // drop the transforms and the transition class together so nothing slides back
    drag.btn.classList.remove('dragging');
    drag.btn.style.transform = '';
    group.forEach((k) => {
      const b = buttons.get(k);
      if (b) { b.classList.remove('shiftable'); b.style.transform = ''; }
    });
    drag.suppressClick = true; // the click that follows the release must not launch / minimize
    setTimeout(() => { drag.suppressClick = false; }, 60);
    if (to === from) return;
    const order = group.slice();
    order.splice(from, 1);
    order.splice(to, 0, id);
    if (pinned) {
      setPinned(order.concat(pinnedList().filter((p) => !order.includes(p))));
    } else {
      runOrder.splice(0, runOrder.length, ...order.filter((k) => runOrder.includes(k)));
      render();
    }
  }

  function updateButton(btn, id, wins) {
    const info = appInfo(id, wins);
    const key = typeof info.icon === 'string' ? info.icon : 'x';
    if (btn.dataset.icon !== key) {
      btn.dataset.icon = key;
      btn.firstChild.innerHTML = iconMarkup(info.icon);
    }
    const running = wins.length > 0;
    const active = wins.some((w) => winFocused(w) && !winMin(w));
    btn.classList.toggle('running', running);
    btn.classList.toggle('multi', wins.length > 1);
    btn.classList.toggle('active', active);
    btn.classList.toggle('dimmed', running && wins.every(winMin));
    btn.setAttribute('aria-label', info.name + (running ? ` — ${wins.length} pencere` : ''));
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (!running) btn.classList.remove('flash');
    if (tip.anchor === btn && tip.el && tip.el.classList.contains('show')) setTipText(tipText(id));
  }

  function tipText(id) {
    const wins = windowsOf(id);
    const info = appInfo(id, wins);
    if (wins.length === 1) return winTitle(wins[0]) || info.name;
    return info.name;
  }

  function render() {
    if (!inited) return;
    safe('render', () => {
      const wins = allWindows();
      const groups = new Map();
      for (const w of wins) {
        if (!w.appId) continue;
        if (!groups.has(w.appId)) groups.set(w.appId, []);
        groups.get(w.appId).push(w);
      }
      for (let i = runOrder.length - 1; i >= 0; i--) if (!groups.has(runOrder[i])) runOrder.splice(i, 1);
      for (const id of groups.keys()) if (!runOrder.includes(id)) runOrder.push(id);

      const desired = [];
      for (const id of pinnedList()) {
        if ((P.apps && P.apps.get && P.apps.get(id)) || groups.has(id)) desired.push(id);
      }
      for (const id of runOrder) if (!desired.includes(id)) desired.push(id);

      const structural = desired.length !== buttons.size || desired.some((id) => !buttons.has(id));
      const before = new Map();
      if (structural && ready) buttons.forEach((b, id) => { if (b.isConnected) before.set(id, b.getBoundingClientRect().left); });

      // remove buttons that are gone
      buttons.forEach((b, id) => {
        if (desired.includes(id)) return;
        buttons.delete(id);
        if (tip.anchor === b) hideTip();
        if (!ready) { b.remove(); return; }
        b.classList.add('leaving');
        b.setAttribute('tabindex', '-1');
        setTimeout(() => b.remove(), 260);
      });

      // create / update / order
      let ref = startBtn.nextSibling;
      desired.forEach((id, index) => {
        let b = buttons.get(id);
        if (!b) { b = createButton(id, index); buttons.set(id, b); }
        updateButton(b, id, groups.get(id) || []);
        while (ref && ref.classList && ref.classList.contains('leaving')) ref = ref.nextSibling;
        if (b === ref) ref = ref.nextSibling;
        else centerEl.insertBefore(b, ref);
      });

      // FLIP: neighbours slide instead of jumping when the centered group changes width
      if (structural && ready && settings.get('animations') !== false) {
        buttons.forEach((b, id) => {
          if (!before.has(id) || typeof b.animate !== 'function') return;
          const dx = before.get(id) - b.getBoundingClientRect().left;
          if (Math.abs(dx) < 1) return;
          b.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
        });
      }

      if (wl.appId) refreshWindowList();
    });
  }

  function onAppClick(id) {
    hideTip();
    const wins = windowsOf(id);
    if (!wins.length) {
      closeWindowList(true);
      closePanel();
      if (P.startMenu && P.startMenu.isOpen && P.startMenu.isOpen()) P.startMenu.close();
      if (P.apps) P.apps.launch(id);
      return;
    }
    if (wins.length === 1) {
      closeWindowList(true);
      const w = wins[0];
      if (winMin(w)) { w.restore(); w.focus(); }
      else if (winFocused(w)) w.minimize();
      else w.focus();
      return;
    }
    if (wl.appId === id) closeWindowList();
    else openWindowList(id);
  }

  function appMenu(id, x, y) {
    const wins = windowsOf(id);
    const info = appInfo(id, wins);
    const pinned = pinnedList().includes(id);
    const topWin = wins[wins.length - 1];
    showMenu(x, y, [
      { label: info.name, icon: typeof info.icon === 'string' ? info.icon : undefined, disabled: true },
      { type: 'separator' },
      { label: 'Yeni pencere', icon: 'plus', action: () => P.apps && P.apps.launch(id) },
      { label: pinned ? 'Görev çubuğundan kaldır' : 'Görev çubuğuna sabitle', icon: 'star', action: () => togglePin(id) },
      wins.length ? { type: 'separator' } : null,
      wins.length ? { label: 'Pencereyi kapat', icon: 'close', action: () => topWin && topWin.close() } : null,
      wins.length > 1 ? { label: 'Tüm pencereleri kapat', icon: 'close', danger: true, action: () => wins.slice().forEach((w) => w.close()) } : null
    ]);
  }

  function barMenu(x, y) {
    showMenu(x, y, [
      { label: 'Görev Yöneticisi', icon: 'cpu', action: () => P.apps && P.apps.launch('taskmanager') },
      { label: 'Masaüstünü göster', icon: 'desktop', action: () => P.wm && P.wm.minimizeAll && P.wm.minimizeAll() },
      { type: 'separator' },
      { label: 'Ayarlar', icon: 'gear', action: () => P.apps && P.apps.launch('settings') }
    ]);
  }

  // ------------------------------------------------------------------ window list popup
  const wl = { el: null, appId: null, openTimer: 0, closeTimer: 0 };

  function onAppEnter(id, btn) {
    clearTimeout(wl.closeTimer);
    const wins = windowsOf(id);
    if (wins.length > 1) {
      hideTip();
      clearTimeout(wl.openTimer);
      if (wl.appId === id) return;
      wl.openTimer = setTimeout(() => openWindowList(id), wl.appId ? 0 : 280);
    } else {
      clearTimeout(wl.openTimer);
      showTip(btn, tipText(id));
    }
  }

  function onAppLeave(id) {
    clearTimeout(wl.openTimer);
    hideTip();
    scheduleWindowListClose();
  }

  function scheduleWindowListClose() {
    clearTimeout(wl.closeTimer);
    if (!wl.appId) return;
    wl.closeTimer = setTimeout(() => closeWindowList(), 220);
  }

  function openWindowList(id) {
    const wins = windowsOf(id);
    if (wins.length < 2) return;
    if (openName) closePanel();
    if (P.startMenu && P.startMenu.isOpen && P.startMenu.isOpen()) P.startMenu.close();
    clearTimeout(wl.closeTimer);
    wl.appId = id;
    wl.el.classList.remove('instant');
    buildWindowList(id);
    positionWindowList(id);
    wl.el.classList.add('open');
  }

  function closeWindowList(instant) {
    clearTimeout(wl.openTimer);
    clearTimeout(wl.closeTimer);
    if (!wl.el) return;
    wl.appId = null;
    wl.el.classList.remove('open');
    if (instant) wl.el.classList.add('instant');
    else wl.el.classList.remove('instant');
  }

  function buildWindowList(id) {
    const wins = windowsOf(id);
    const info = appInfo(id, wins);
    wl.el.textContent = '';
    wins.slice().reverse().forEach((w) => {
      const row = el('div', {
        class: 'tb-wl-row' + (winFocused(w) && !winMin(w) ? ' current' : '') + (winMin(w) ? ' min' : ''),
        role: 'button',
        tabIndex: 0,
        dataset: { win: w.id }
      },
        icon(info.icon, 'tb-wl-ico'),
        el('span', { class: 'tb-wl-title', text: winTitle(w) || info.name }),
        el('button', { class: 'tb-wl-x', type: 'button', 'aria-label': 'Pencereyi kapat', html: iconMarkup('close') }));
      const pick = () => {
        closeWindowList(true);
        if (winMin(w)) w.restore();
        w.focus();
      };
      row.addEventListener('click', (e) => {
        if (e.target.closest('.tb-wl-x')) { e.stopPropagation(); w.close(); return; }
        pick();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
        else if (e.key === 'ArrowDown' && row.nextSibling) { e.preventDefault(); row.nextSibling.focus(); }
        else if (e.key === 'ArrowUp' && row.previousSibling) { e.preventDefault(); row.previousSibling.focus(); }
      });
      wl.el.appendChild(row);
    });
  }

  function positionWindowList(id) {
    const btn = buttons.get(id);
    if (!btn) return;
    const pr = panelsEl.getBoundingClientRect();
    const ar = btn.getBoundingClientRect();
    const w = wl.el.offsetWidth || 240;
    const left = clamp(ar.left + ar.width / 2 - w / 2 - pr.left, 8, Math.max(8, pr.width - w - 8));
    wl.el.style.left = Math.round(left) + 'px';
    wl.el.style.bottom = Math.round(pr.bottom - ar.top + 8) + 'px';
    wl.el.style.setProperty('--arrow', Math.round(ar.left + ar.width / 2 - pr.left - left) + 'px');
  }

  function refreshWindowList() {
    if (!wl.appId) return;
    if (windowsOf(wl.appId).length < 2) { closeWindowList(true); return; }
    buildWindowList(wl.appId);
    positionWindowList(wl.appId);
  }

  // ================================================================== panels (flyouts)
  function registerFlyout(name, def) { flyouts[name] = def; }

  function openPanel(name) {
    const f = flyouts[name];
    if (!f || openName === name) return;
    hideTip();
    closeWindowList(true);
    if (openName) closePanel();
    openName = name;
    safe(`${name}.beforeOpen`, () => f.beforeOpen && f.beforeOpen());
    f.el.classList.add('open');
    f.anchor.classList.add('active');
    f.anchor.setAttribute('aria-expanded', 'true');
    bus.emit('popup:open', { name });
    safe(`${name}.onOpen`, () => f.onOpen && f.onOpen());
    bus.emit('taskbar:panel', { name, open: true });
  }

  function closePanel(opts) {
    if (!openName) return;
    const name = openName;
    const f = flyouts[name];
    openName = null;
    const ae = document.activeElement;
    // focus parked in the flyout or on its tray button (toggled with the mouse) must not stay there
    const hadFocus = f.el.contains(ae) || ae === f.anchor;
    f.el.classList.remove('open');
    f.anchor.classList.remove('active');
    f.anchor.setAttribute('aria-expanded', 'false');
    safe(`${name}.onClose`, () => f.onClose && f.onClose());
    if (hadFocus || (opts && opts.restoreFocus)) giveFocusBack(f.anchor);
    bus.emit('taskbar:panel', { name, open: false });
  }

  /** After a popup closes the keyboard belongs to the active window again (its last control, e.g. the textarea);
   *  the popup's own button only gets it back when no window is active. */
  function giveFocusBack(anchor) {
    if (P.session && typeof P.session.isLocked === 'function' && P.session.isLocked()) return;
    const wm = P.wm;
    if (wm && typeof wm.refocus === 'function' && typeof wm.getFocused === 'function' && wm.getFocused()) {
      safe('wm.refocus', () => wm.refocus());
      return;
    }
    if (anchor) { try { anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function togglePanel(name) {
    if (openName === name) closePanel(); else openPanel(name);
  }

  /** moves keyboard focus into a freshly opened flyout (arrow keys / Escape then work) */
  function focusPanel(panel) {
    const grab = () => { if (openName && flyouts[openName] && flyouts[openName].el === panel) panel.focus({ preventScroll: true }); };
    grab();
    setTimeout(grab, 40);
  }

  // ------------------------------------------------------------------ slider
  function makeSlider(opts) {
    const input = el('input', {
      class: 'qs-range', type: 'range', min: String(opts.min), max: String(opts.max), step: '1',
      value: String(opts.value), 'aria-label': opts.label
    });
    const sync = () => {
      const pct = ((Number(input.value) - opts.min) / (opts.max - opts.min)) * 100;
      input.style.setProperty('--p', pct.toFixed(1) + '%');
    };
    input.addEventListener('input', () => { sync(); opts.onInput && opts.onInput(Number(input.value)); });
    input.addEventListener('change', () => { opts.onChange && opts.onChange(Number(input.value)); });
    sync();
    return {
      input,
      set(v) { if (Number(input.value) !== v) input.value = String(v); sync(); }
    };
  }

  // ================================================================== QUICK SETTINGS
  const qs = { tiles: {}, vol: null, bri: null, muteBtn: null, volVal: null, briVal: null, batteryEl: null };

  function saveQs() { storage.set('qs', qsState); }

  function applyDisplayFilter() {
    const root = document.getElementById('os-root');
    if (!root) return;
    const b = clamp(Number(storage.get('brightness', 100)) || 100, 30, 100);
    const parts = [];
    if (b < 100) parts.push(`brightness(${(b / 100).toFixed(2)})`);
    if (qsState.night) parts.push('sepia(.34) saturate(1.12) hue-rotate(-14deg)');
    root.style.filter = parts.join(' ');
  }

  function volumeGlyphName() {
    const v = Number(settings.get('volume')) || 0;
    if (settings.get('muted') || v <= 0) return 'volume-mute';
    return v < 40 ? 'volume-low' : 'volume';
  }

  const TILE_DEFS = [
    {
      id: 'wifi', label: 'Wi-Fi', icon: 'wifi',
      on: () => qsState.wifi,
      sub: () => (qsState.wifi ? (qs.connecting ? 'Bağlanıyor…' : 'PandaNet') : 'Kapalı'),
      toggle() {
        qsState.wifi = !qsState.wifi;
        saveQs();
        clearTimeout(qs.connectTimer);
        qs.connecting = qsState.wifi;
        if (qs.connecting) {
          qs.connectTimer = setTimeout(() => { qs.connecting = false; updateQs(); }, 1100);
        }
        updateTray();
      }
    },
    {
      id: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth',
      on: () => qsState.bluetooth,
      sub: () => (qsState.bluetooth ? 'Açık' : 'Kapalı'),
      toggle() { qsState.bluetooth = !qsState.bluetooth; saveQs(); }
    },
    {
      id: 'dnd', label: 'Rahatsız Etmeyin', icon: 'bell-off',
      on: () => !!settings.get('dnd'),
      sub: () => (settings.get('dnd') ? 'Açık' : 'Kapalı'),
      toggle() { settings.set('dnd', !settings.get('dnd')); }
    },
    {
      id: 'theme', label: 'Koyu tema', icon: 'theme',
      on: () => P.theme.get() === 'dark',
      sub: () => (P.theme.get() === 'dark' ? 'Açık' : 'Kapalı'),
      toggle() { P.theme.toggle(); }
    },
    {
      id: 'anim', label: 'Animasyonlar', icon: 'sparkle',
      on: () => settings.get('animations') !== false,
      sub: () => (settings.get('animations') !== false ? 'Açık' : 'Kapalı'),
      toggle() { settings.set('animations', settings.get('animations') === false); }
    },
    {
      id: 'night', label: 'Gece ışığı', icon: 'night',
      on: () => !!qsState.night,
      sub: () => (qsState.night ? 'Açık' : 'Kapalı'),
      toggle() { qsState.night = !qsState.night; saveQs(); applyDisplayFilter(); }
    }
  ];

  function buildQuickSettings() {
    const tilesWrap = el('div', { class: 'qs-tiles' });
    TILE_DEFS.forEach((def) => {
      const btn = el('button', { class: 'qs-tile', type: 'button', dataset: { tile: def.id }, 'aria-pressed': 'false' },
        icon(def.icon, 'qs-tile-ico'),
        el('span', { class: 'qs-tile-text' },
          el('span', { class: 'qs-tile-label', text: def.label }),
          el('span', { class: 'qs-tile-sub' })));
      btn.addEventListener('click', () => { def.toggle(); updateQs(); });
      qs.tiles[def.id] = btn;
      tilesWrap.appendChild(btn);
    });

    // volume
    qs.muteBtn = el('button', { class: 'qs-icon-btn', type: 'button', 'aria-label': 'Sesi kapat/aç' });
    qs.muteBtn.addEventListener('click', () => {
      const muted = !settings.get('muted');
      settings.set('muted', muted);
      if (!muted && Number(settings.get('volume')) === 0) settings.set('volume', 30);
    });
    qs.volVal = el('span', { class: 'qs-val' });
    qs.vol = makeSlider({
      min: 0, max: 100, value: Number(settings.get('volume')) || 0, label: 'Ses düzeyi',
      onInput(v) {
        settings.set('volume', v);
        if (v > 0 && settings.get('muted')) settings.set('muted', false);
      },
      onChange() { if (P.sound && typeof P.sound.play === 'function') safe('sound', () => P.sound.play('click')); }
    });

    // brightness
    const briIcon = el('span', { class: 'qs-icon-static' }, icon('sun'));
    qs.briVal = el('span', { class: 'qs-val' });
    qs.bri = makeSlider({
      min: 30, max: 100, value: clamp(Number(storage.get('brightness', 100)) || 100, 30, 100), label: 'Parlaklık',
      onInput(v) { storage.set('brightness', v); applyDisplayFilter(); qs.briVal.textContent = String(v); }
    });

    qs.batteryEl = el('div', { class: 'qs-battery', hidden: true });
    const gear = el('button', { class: 'qs-icon-btn qs-gear', type: 'button', 'aria-label': 'Ayarlar', title: '' }, icon('gear'));
    gear.addEventListener('click', () => {
      closePanel();
      if (P.apps) P.apps.launch('settings');
    });
    tipOn(gear, 'Tüm ayarlar');

    const panel = el('div', { class: 'tb-flyout qs-panel', role: 'dialog', 'aria-label': 'Hızlı ayarlar', tabIndex: -1 },
      tilesWrap,
      el('div', { class: 'qs-sliders' },
        el('div', { class: 'qs-slider-row' }, qs.muteBtn, qs.vol.input, qs.volVal),
        el('div', { class: 'qs-slider-row' }, briIcon, qs.bri.input, qs.briVal)),
      el('div', { class: 'qs-foot' }, qs.batteryEl, el('span', { class: 'spacer' }), gear));

    panelsEl.appendChild(panel);
    registerFlyout('quicksettings', {
      el: panel,
      anchor: sysBtn,
      beforeOpen: updateQs,
      onOpen() { focusPanel(panel); }
    });
    updateQs();
  }

  function updateQs() {
    if (!qs.vol) return;
    TILE_DEFS.forEach((def) => {
      const btn = qs.tiles[def.id];
      const on = !!def.on();
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.querySelector('.qs-tile-sub').textContent = def.sub();
    });
    const vol = Number(settings.get('volume')) || 0;
    const muted = !!settings.get('muted');
    qs.vol.set(vol);
    qs.vol.input.classList.toggle('muted', muted);
    qs.volVal.textContent = muted ? '' : String(vol);
    qs.volVal.classList.toggle('is-muted', muted);
    qs.muteBtn.innerHTML = iconMarkup(volumeGlyphName());
    qs.muteBtn.classList.toggle('is-muted', muted);
    qs.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const b = clamp(Number(storage.get('brightness', 100)) || 100, 30, 100);
    qs.bri.set(b);
    qs.briVal.textContent = String(b);
    if (battery) {
      qs.batteryEl.hidden = false;
      qs.batteryEl.innerHTML = '';
      const g = el('span', { class: 'qs-battery-ico' });
      g.innerHTML = batteryMarkup(battery.level, battery.charging);
      qs.batteryEl.appendChild(g);
      qs.batteryEl.appendChild(document.createTextNode(`%${Math.round(battery.level * 100)}${battery.charging ? ' · Şarj oluyor' : ''}`));
    } else {
      qs.batteryEl.hidden = true;
    }
  }

  // ================================================================== CALENDAR
  const cal = { view: null, selected: null, grid: null, title: null, bigTime: null, bigDate: null, foot: null, panel: null, lastWheel: 0, anim: 0 };

  function buildCalendar() {
    cal.bigTime = el('div', { class: 'cal-time' });
    cal.bigDate = el('div', { class: 'cal-date' });
    cal.title = el('div', { class: 'cal-title', 'aria-live': 'polite' });
    cal.grid = el('div', { class: 'cal-grid', role: 'grid' });

    const mkNav = (label, glyph, onClick) => {
      const b = el('button', { class: 'cal-nav', type: 'button', 'aria-label': label }, icon(glyph));
      b.addEventListener('click', onClick);
      return b;
    };
    const todayBtn = el('button', { class: 'cal-today-btn', type: 'button', text: 'Bugün' });
    todayBtn.addEventListener('click', () => goToday(true));

    const weekdays = el('div', { class: 'cal-weekdays', 'aria-hidden': 'true' },
      WEEKDAYS.map((w, i) => el('span', { class: i >= 5 ? 'weekend' : '', text: w })));

    cal.foot = el('div', { class: 'cal-foot' });
    const month = el('div', { class: 'cal-month' }, weekdays, cal.grid);
    month.addEventListener('wheel', (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - cal.lastWheel < 130 || !e.deltaY) return;
      cal.lastWheel = now;
      shiftMonth(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    cal.panel = el('div', { class: 'tb-flyout cal-panel', role: 'dialog', 'aria-label': 'Takvim', tabIndex: -1 },
      el('div', { class: 'cal-head' }, cal.bigTime, cal.bigDate),
      el('div', { class: 'cal-bar' }, cal.title, todayBtn,
        mkNav('Önceki ay', 'chevron-left', () => shiftMonth(-1)),
        mkNav('Sonraki ay', 'chevron-right', () => shiftMonth(1))),
      month,
      cal.foot);

    cal.panel.addEventListener('keydown', (e) => {
      const k = e.key;
      const sel = cal.selected;
      let next = null;
      if (k === 'ArrowLeft') next = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - 1);
      else if (k === 'ArrowRight') next = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() + 1);
      else if (k === 'ArrowUp') next = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - 7);
      else if (k === 'ArrowDown') next = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() + 7);
      else if (k === 'PageUp') { e.preventDefault(); shiftMonth(-1); return; }
      else if (k === 'PageDown') { e.preventDefault(); shiftMonth(1); return; }
      else if (k === 'Home') { e.preventDefault(); goToday(true); return; }
      if (!next) return;
      e.preventDefault();
      selectDate(next);
    });

    panelsEl.appendChild(cal.panel);
    registerFlyout('calendar', {
      el: cal.panel,
      anchor: clockBtn,
      beforeOpen() {
        const now = new Date();
        cal.view = { year: now.getFullYear(), month: now.getMonth() };
        cal.selected = dayStart(now);
        renderCalendar();
        tickCalendarClock();
      },
      onOpen() { focusPanel(cal.panel); }
    });
  }

  function tickCalendarClock() {
    if (!cal.bigTime) return;
    const now = new Date();
    const t = fmtTime(now, true);
    if (cal.bigTime.textContent !== t) cal.bigTime.textContent = t;
    const d = fmtDateFull(now);
    if (cal.bigDate.textContent !== d) cal.bigDate.textContent = d;
  }

  function shiftMonth(delta) {
    if (!cal.view) return;
    let m = cal.view.month + delta;
    let y = cal.view.year;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    cal.view = { year: y, month: m };
    renderCalendar(delta);
  }

  function goToday(select) {
    const now = new Date();
    const dir = (now.getFullYear() * 12 + now.getMonth()) - (cal.view.year * 12 + cal.view.month);
    cal.view = { year: now.getFullYear(), month: now.getMonth() };
    if (select) cal.selected = dayStart(now);
    renderCalendar(Math.sign(dir));
  }

  function selectDate(d) {
    cal.selected = dayStart(d);
    const dir = (d.getFullYear() * 12 + d.getMonth()) - (cal.view.year * 12 + cal.view.month);
    if (dir !== 0) cal.view = { year: d.getFullYear(), month: d.getMonth() };
    renderCalendar(Math.sign(dir));
  }

  function nextHoliday(from) {
    for (let i = 1; i <= 366; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      const h = holidayOf(d);
      if (h) return { date: d, name: h, days: i };
    }
    return null;
  }

  function renderCalendar(dir) {
    if (!cal.view) return;
    const { year, month } = cal.view;
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7; // Monday first
    const today = new Date();
    cal.title.textContent = `${MONTHS[month]} ${year}`;
    cal.grid.textContent = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(year, month, 1 - offset + i);
      const hol = holidayOf(d);
      const cls = ['cal-day'];
      if (d.getMonth() !== month) cls.push('other');
      if (i % 7 >= 5) cls.push('weekend');
      if (sameDay(d, today)) cls.push('today');
      if (sameDay(d, cal.selected)) cls.push('selected');
      if (hol) cls.push('holiday');
      const b = el('button', {
        class: cls.join(' '), type: 'button', tabIndex: -1, text: String(d.getDate()),
        dataset: { date: dateKey(d) },
        'aria-label': `${fmtDateLong(d)} ${DAYS[d.getDay()]}${hol ? ' — ' + hol : ''}`
      });
      if (hol) {
        b.dataset.holiday = hol;
        b.addEventListener('mouseenter', () => showTip(b, `${d.getDate()} ${MONTHS[d.getMonth()]} · ${hol}`, 160));
        b.addEventListener('mouseleave', hideTip);
      }
      b.addEventListener('click', () => { hideTip(); selectDate(d); });
      cal.grid.appendChild(b);
    }
    if (dir) {
      cal.grid.classList.remove('slide-next', 'slide-prev');
      void cal.grid.offsetWidth;
      cal.grid.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
      clearTimeout(cal.anim);
      cal.anim = setTimeout(() => cal.grid.classList.remove('slide-next', 'slide-prev'), 320);
    }
    renderCalendarFoot();
  }

  function renderCalendarFoot() {
    const s = cal.selected;
    const hol = holidayOf(s);
    cal.foot.textContent = '';
    cal.foot.appendChild(el('div', { class: 'cal-foot-title', text: `${fmtDateLong(s)}, ${DAYS[s.getDay()]}` }));
    if (hol) {
      cal.foot.appendChild(el('div', { class: 'cal-foot-sub holiday', text: hol }));
    } else {
      const nh = nextHoliday(s);
      if (nh) {
        cal.foot.appendChild(el('div', {
          class: 'cal-foot-sub',
          text: `Sonraki resmi tatil · ${nh.days === 1 ? 'yarın' : `${nh.days} gün sonra`}`
        }));
        cal.foot.appendChild(el('div', { class: 'cal-foot-next', text: `${nh.date.getDate()} ${MONTHS[nh.date.getMonth()]} · ${nh.name}` }));
      } else {
        cal.foot.appendChild(el('div', { class: 'cal-foot-sub', text: 'Bu gün için kayıtlı bir etkinlik yok.' }));
      }
    }
  }

  // ================================================================== NOTIFICATION CENTER
  const nc = { panel: null, list: null, clearBtn: null, dnd: null, known: new Set(), timer: 0, opening: false };

  function notifyApi() { return P.notify && typeof P.notify === 'function' ? P.notify : null; }

  function history() {
    const n = notifyApi();
    if (!n || typeof n.history !== 'function') return [];
    let list = [];
    try { list = n.history() || []; } catch (e) { list = []; }
    // the UI kit returns newest first; sort by time but keep that order for equal timestamps
    return list.map((item, i) => ({ item, i }))
      .sort((a, b) => (toMs(b.item.time) - toMs(a.item.time)) || (a.i - b.i))
      .map((x) => x.item);
  }

  function unread() {
    const n = notifyApi();
    try { return n && typeof n.unreadCount === 'function' ? Number(n.unreadCount()) || 0 : 0; } catch (e) { return 0; }
  }

  function buildNotificationCenter() {
    nc.clearBtn = el('button', { class: 'nc-clear', type: 'button', text: 'Tümünü temizle' });
    nc.clearBtn.addEventListener('click', clearAllNotifications);

    const dndInput = el('input', { type: 'checkbox', 'aria-label': 'Rahatsız Etmeyin' });
    dndInput.addEventListener('change', () => settings.set('dnd', dndInput.checked));
    nc.dnd = dndInput;
    const dndRow = el('label', { class: 'nc-dnd' },
      el('span', { class: 'nc-dnd-ico' }, icon('bell-off')),
      el('span', { class: 'nc-dnd-text' },
        el('span', { class: 'nc-dnd-label', text: 'Rahatsız Etmeyin' }),
        el('span', { class: 'nc-dnd-sub', text: 'Bildirimler sessize alınır' })),
      el('span', { class: 'nc-switch' }, dndInput, el('span', { class: 'nc-switch-track' })));

    nc.list = el('div', { class: 'nc-list', role: 'list' });
    nc.panel = el('div', { class: 'tb-flyout nc-panel', role: 'dialog', 'aria-label': 'Bildirim merkezi', tabIndex: -1 },
      el('div', { class: 'nc-head' }, el('h2', { class: 'nc-title', text: 'Bildirimler' }), nc.clearBtn),
      dndRow,
      nc.list);
    panelsEl.appendChild(nc.panel);

    registerFlyout('notifications', {
      el: nc.panel,
      anchor: bellBtn,
      beforeOpen() {
        nc.known = new Set();
        const n = notifyApi();
        nc.opening = true; // markAllRead emits notify:change; one staggered render is enough
        try {
          if (n && typeof n.markAllRead === 'function') safe('markAllRead', () => n.markAllRead());
        } finally {
          nc.opening = false;
        }
        renderNotifications(true);
      },
      onOpen() {
        clearInterval(nc.timer);
        nc.timer = setInterval(refreshNcTimes, 20000);
        focusPanel(nc.panel);
      },
      onClose() { clearInterval(nc.timer); }
    });
  }

  function refreshNcTimes() {
    nc.list.querySelectorAll('.nc-time').forEach((t) => { t.textContent = relTime(Number(t.dataset.t)); });
  }

  function clearAllNotifications() {
    const items = nc.list.querySelectorAll('.nc-item');
    const n = notifyApi();
    if (!items.length) return;
    nc.clearBtn.disabled = true;
    items.forEach((it, i) => {
      it.style.animationDelay = Math.min(i, 8) * 28 + 'ms';
      it.classList.add('leaving', 'clearing');
    });
    setTimeout(() => {
      if (n && typeof n.clear === 'function') safe('notify.clear', () => n.clear());
      renderNotifications();
    }, 260 + Math.min(items.length, 8) * 28);
  }

  function dismissNotification(id, node) {
    const n = notifyApi();
    node.classList.add('leaving');
    node.style.height = node.offsetHeight + 'px';
    void node.offsetHeight;
    node.classList.add('collapse');
    setTimeout(() => {
      // dismiss() closes a still visible toast; remove() (when the UI kit has it) drops the history entry
      if (n && typeof n.dismiss === 'function') safe('notify.dismiss', () => n.dismiss(id));
      if (n && typeof n.remove === 'function') safe('notify.remove', () => n.remove(id));
      renderNotifications();
    }, 230);
  }

  function ncItem(n, animate, delay) {
    const ms = toMs(n.time);
    const appDef = n.appId && P.apps && P.apps.get ? P.apps.get(n.appId) : null;
    const node = el('div', { class: 'nc-item' + (animate ? ' entering' : ''), role: 'listitem', tabIndex: 0, dataset: { id: String(n.id) } },
      el('div', { class: 'nc-ico' }, icon(n.icon || (appDef && appDef.icon) || 'info')),
      el('div', { class: 'nc-text' },
        el('div', { class: 'nc-row' },
          el('span', { class: 'nc-item-title', text: n.title || '' }),
          el('span', { class: 'nc-time', text: relTime(ms), dataset: { t: String(ms) } })),
        n.message ? el('div', { class: 'nc-msg', text: n.message }) : null),
      el('button', { class: 'nc-x', type: 'button', 'aria-label': 'Bildirimi kaldır', html: iconMarkup('close') }));
    if (animate) node.style.animationDelay = delay + 'ms';
    node.querySelector('.nc-x').addEventListener('click', (e) => { e.stopPropagation(); dismissNotification(n.id, node); });
    const open = () => {
      if (n.appId && P.apps && P.apps.get && P.apps.get(n.appId)) {
        closePanel();
        P.apps.launch(n.appId);
      }
    };
    node.addEventListener('click', open);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') open();
      else if (e.key === 'Delete' || e.key === 'Backspace') dismissNotification(n.id, node);
    });
    return node;
  }

  function renderNotifications(stagger) {
    if (!nc.list) return;
    const items = history().slice(0, 60);
    const open = openName === 'notifications';
    nc.list.textContent = '';
    nc.clearBtn.disabled = items.length === 0;
    if (!items.length) {
      nc.list.appendChild(el('div', { class: 'nc-empty' },
        icon('bell', 'nc-empty-ico'),
        el('div', { class: 'nc-empty-title', text: 'Yeni bildirim yok' }),
        el('div', { class: 'nc-empty-sub', text: 'Yeni bildirimler burada görünecek.' })));
    } else {
      items.forEach((n, i) => {
        const fresh = open && (stagger || !nc.known.has(n.id));
        nc.list.appendChild(ncItem(n, fresh, stagger ? Math.min(i, 8) * 32 : 0));
        nc.known.add(n.id);
      });
    }
    nc.dnd.checked = !!settings.get('dnd');
  }

  // ================================================================== tray updates
  function updateTray() {
    if (!volG) return;
    volG.innerHTML = iconMarkup(volumeGlyphName());
    wifiG.classList.toggle('off', !qsState.wifi);
    wifiG.innerHTML = iconMarkup('wifi');
    if (battery) {
      batG.hidden = false;
      batG.innerHTML = batteryMarkup(battery.level, battery.charging);
    } else {
      batG.hidden = true;
    }
    const dnd = !!settings.get('dnd');
    const wanted = dnd ? 'bell-off' : 'bell';
    if (bellIconEl.dataset.icon !== wanted) {
      bellIconEl.dataset.icon = wanted;
      bellIconEl.innerHTML = iconMarkup(wanted);
    }
    bellBtn.classList.toggle('dnd', dnd);
    const count = unread();
    const text = count > 9 ? '9+' : String(count);
    if (badgeEl.textContent !== text) {
      badgeEl.textContent = text;
      if (count) { badgeEl.classList.remove('pop'); void badgeEl.offsetWidth; badgeEl.classList.add('pop'); }
    }
    badgeEl.hidden = count <= 0;
    bellBtn.setAttribute('aria-label', count ? `Bildirimler, ${count} okunmamış` : 'Bildirimler');
  }

  function sysTipText() {
    const vol = settings.get('muted') ? 'Sessiz' : `Ses: %${Number(settings.get('volume')) || 0}`;
    const net = qsState.wifi ? 'Ağ: PandaNet' : 'Ağ: bağlı değil';
    const bat = battery ? ` · Pil: %${Math.round(battery.level * 100)}` : '';
    return `${net} · ${vol}${bat}`;
  }

  function tickClock() {
    if (!clockTimeEl) return;
    const now = new Date();
    const t = fmtTime(now, !!settings.get('showSeconds'));
    if (clockTimeEl.textContent !== t) clockTimeEl.textContent = t;
    const d = fmtDateShort(now);
    if (clockDateEl.textContent !== d) clockDateEl.textContent = d;
    clockBtn.setAttribute('aria-label', `${fmtDateFull(now)}, ${fmtTime(now, true)}`);
    if (openName === 'calendar') tickCalendarClock();
    if (tip.anchor === clockBtn && tip.el && tip.el.classList.contains('show')) setTipText(fmtDateFull(now));
  }

  function scheduleClock() {
    tickClock();
    setInterval(tickClock, 1000);
  }

  function initBattery() {
    if (typeof navigator.getBattery !== 'function') return;
    let p;
    try { p = navigator.getBattery(); } catch (e) { return; }
    if (!p || typeof p.then !== 'function') return;
    p.then((b) => {
      battery = b;
      const sync = () => { updateTray(); if (openName === 'quicksettings') updateQs(); };
      ['levelchange', 'chargingchange'].forEach((evt) => b.addEventListener(evt, sync));
      sync();
    }).catch(() => { /* no battery info */ });
  }

  // ================================================================== init
  function init() {
    if (inited) return;
    const root = document.getElementById('taskbar');
    panelsEl = document.getElementById('panels');
    if (!root || !panelsEl) {
      console.error('[taskbar] #taskbar veya #panels bulunamadı');
      return;
    }
    inited = true;
    root.textContent = '';

    // ---- bar
    startBtn = el('button', { class: 'tb-btn tb-start', type: 'button', 'aria-label': 'Başlat', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
      el('span', { class: 'tb-ico', html: iconMarkup('panda') }));
    centerEl = el('div', { class: 'tb-center', role: 'toolbar', 'aria-label': 'Görev çubuğu' }, startBtn);

    wifiG = el('span', { class: 'tb-glyph tb-g-wifi' });
    volG = el('span', { class: 'tb-glyph tb-g-vol' });
    batG = el('span', { class: 'tb-glyph tb-g-bat', hidden: true });
    sysBtn = el('button', { class: 'tb-btn tb-tray-btn tb-sys', type: 'button', 'aria-label': 'Hızlı ayarlar: ağ, ses ve pil', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
      el('span', { class: 'tb-glyphs' }, wifiG, volG, batG));

    bellIconEl = el('span', { class: 'tb-glyph tb-g-bell' });
    badgeEl = el('span', { class: 'tb-badge', hidden: true, 'aria-hidden': 'true' });
    bellBtn = el('button', { class: 'tb-btn tb-tray-btn tb-bell', type: 'button', 'aria-label': 'Bildirimler', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
      bellIconEl, badgeEl);

    clockTimeEl = el('span', { class: 'tb-clock-time' });
    clockDateEl = el('span', { class: 'tb-clock-date' });
    clockBtn = el('button', { class: 'tb-btn tb-tray-btn tb-clock', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
      clockTimeEl, clockDateEl);

    showDeskBtn = el('button', { class: 'tb-show-desktop', type: 'button', 'aria-label': 'Masaüstünü göster' });
    trayEl = el('div', { class: 'tb-tray' }, sysBtn, bellBtn, clockBtn, showDeskBtn);
    const bar = el('div', { class: 'tb-bar' }, centerEl, trayEl);
    root.appendChild(bar);

    // ---- tooltip + window list live in #panels
    ensureTip();
    wl.el = el('div', { class: 'tb-wl', role: 'menu', 'aria-label': 'Pencereler' });
    panelsEl.appendChild(wl.el);
    wl.el.addEventListener('mouseenter', () => clearTimeout(wl.closeTimer));
    wl.el.addEventListener('mouseleave', scheduleWindowListClose);

    // more buttons than fit even at their minimum width: the wheel scrolls the group sideways
    centerEl.addEventListener('wheel', (e) => {
      if (centerEl.scrollWidth <= centerEl.clientWidth + 1 || e.ctrlKey) return;
      centerEl.scrollLeft += e.deltaY || e.deltaX;
      e.preventDefault();
    }, { passive: false });

    // hover glow follows the pointer (see .tb-app:hover in taskbar.css)
    centerEl.addEventListener('mousemove', (e) => {
      const b = e.target.closest && e.target.closest('.tb-btn');
      if (!b) return;
      const r = b.getBoundingClientRect();
      b.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px');
      b.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px');
    });

    // ---- start button
    startBtn.addEventListener('click', () => {
      hideTip();
      closePanel();
      closeWindowList(true);
      if (P.startMenu && typeof P.startMenu.toggle === 'function') P.startMenu.toggle();
    });
    tipOn(startBtn, 'Başlat');
    bus.on('startmenu:toggle', (e) => {
      const open = !!(e && e.open);
      startBtn.classList.toggle('active', open);
      startBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // ---- tray interactions
    sysBtn.addEventListener('click', () => togglePanel('quicksettings'));
    bellBtn.addEventListener('click', () => togglePanel('notifications'));
    clockBtn.addEventListener('click', () => togglePanel('calendar'));
    showDeskBtn.addEventListener('click', () => {
      hideTip();
      closePanel();
      if (P.wm && typeof P.wm.minimizeAll === 'function') P.wm.minimizeAll();
    });
    tipOn(sysBtn, sysTipText);
    tipOn(bellBtn, () => (settings.get('dnd') ? 'Bildirimler (Rahatsız Etmeyin açık)' : 'Bildirimler'));
    tipOn(clockBtn, () => fmtDateFull(new Date()));
    tipOn(showDeskBtn, 'Masaüstünü göster', 300);
    sysBtn.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!e.deltaY) return;
      const step = e.deltaY < 0 ? 5 : -5;
      const v = clamp((Number(settings.get('volume')) || 0) + step, 0, 100);
      settings.set('volume', v);
      if (v > 0 && settings.get('muted')) settings.set('muted', false);
      if (tip.anchor === sysBtn) setTipText(sysTipText());
      else showTip(sysBtn, sysTipText(), 0);
    }, { passive: false });

    // generic taskbar context menu (app buttons stop propagation)
    bar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      barMenu(e.clientX, root.getBoundingClientRect().top - 6);
    });

    buildQuickSettings();
    buildCalendar();
    buildNotificationCenter();

    // ---- global listeners
    document.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (wl.appId && !wl.el.contains(t) && !t.closest('.tb-app[data-app="' + wl.appId + '"]')) closeWindowList(true);
      if (openName) {
        const f = flyouts[openName];
        if (f.el.contains(t) || f.anchor.contains(t)) return;
        if (t.closest('#context-menu-layer, #dialog-layer')) return;
        closePanel();
      }
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.ctrlKey) return;
      if (wl.appId) { closeWindowList(true); return; }
      if (openName) { e.stopPropagation(); closePanel({ restoreFocus: true }); }
    });
    window.addEventListener('blur', () => { hideTip(); });
    window.addEventListener('resize', () => {
      if (tip.anchor) placeTip();
      if (wl.appId) positionWindowList(wl.appId);
    });

    // ---- bus
    bus.on('wm:change', render);
    bus.on('apps:change', render);
    bus.on('wm:focus', (w) => {
      const b = w && buttons.get(w.appId);
      if (b) b.classList.remove('flash');
    });
    bus.on('wm:flash', (w) => {
      const win = w && w.win ? w.win : w;
      const b = win && buttons.get(win.appId);
      if (!b) return;
      b.classList.remove('flash');
      void b.offsetWidth;
      b.classList.add('flash');
      setTimeout(() => b.classList.remove('flash'), 4200);
    });
    bus.on('popup:open', (e) => {
      if (e && e.name === 'start') {
        if (openName) closePanel();
        closeWindowList(true);
        hideTip();
      }
    });
    bus.on('session:lock', () => { closePanel(); closeWindowList(true); hideTip(); });
    let introPlayed = false;
    bus.on('session:unlock', () => {
      // the first intro ran unseen behind the splash / lock screen: play it again when the desktop appears
      if (introPlayed || settings.get('animations') === false) return;
      introPlayed = true;
      let i = 0;
      centerEl.querySelectorAll('.tb-btn').forEach((b) => {
        const n = i++;
        b.classList.remove('intro');
        void b.offsetWidth;
        b.style.setProperty('--i', String(n));
        b.classList.add('intro');
        setTimeout(() => b.classList.remove('intro'), 800 + n * 50);
      });
    });
    bus.on('settings:change', ({ key }) => {
      if (key === 'taskbar.pinned') render();
      else if (key === 'volume' || key === 'muted' || key === 'dnd') { updateTray(); updateQs(); if (key === 'dnd' && nc.dnd) nc.dnd.checked = !!settings.get('dnd'); }
      else if (key === 'theme' || key === 'animations') updateQs();
      else if (key === 'clock24h' || key === 'showSeconds') tickClock();
    });
    bus.on('theme:change', updateQs);
    const onNotify = () => {
      updateTray();
      if (openName === 'notifications' && !nc.opening) {
        const n = notifyApi();
        if (n && typeof n.markAllRead === 'function') safe('markAllRead', () => n.markAllRead());
        renderNotifications();
      }
    };
    bus.on('notify:new', onNotify);
    bus.on('notify:change', onNotify);

    applyDisplayFilter();
    updateTray();
    scheduleClock();
    initBattery();
    render();
    setTimeout(() => { ready = true; }, 900);
  }

  // ================================================================== public API
  function getButtonRect(winId) {
    if (!inited) return null;
    let appId = null;
    let w = null;
    try { w = P.wm && P.wm.get ? P.wm.get(winId) : null; } catch (e) { w = null; }
    if (!w) w = allWindows().find((x) => x.id === winId);
    if (w) appId = w.appId;
    if (!appId) return null;
    let btn = buttons.get(appId);
    if (!btn) { render(); btn = buttons.get(appId); }
    if (!btn || btn.classList.contains('leaving') || !btn.isConnected) return null;
    const r = btn.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }

  P.taskbar = {
    init,
    getButtonRect,
    render,
    openPanel,
    closePanel,
    togglePanel,
    currentPanel() { return openName; },
    isPanelOpen(name) { return name ? openName === name : !!openName; }
  };
})();
