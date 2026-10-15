/* PandaOS context menu — glass popup menus with submenus, keyboard navigation and viewport
   clamping. Also owns the global rule "no native browser context menu inside the OS,
   except in editable fields". Renders into #context-menu-layer. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const U = P.util;

  // ---------------------------------------------------------------- icon helpers
  const GLYPHS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'chevron-right': '<path d="M9 5.5l6.5 6.5L9 18.5"/>'
  };

  function glyph(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (GLYPHS[name] || '') + '</svg>';
  }

  /** Markup for an icon name / raw svg; falls back to a built-in glyph (or nothing). */
  function iconMarkup(name, fallbackGlyph) {
    if (typeof name === 'string' && name.trim().startsWith('<svg')) return name;
    const icons = P.icons;
    if (name && icons && typeof icons.get === 'function' && (typeof icons.has !== 'function' || icons.has(name))) {
      try { return icons.get(name); } catch (e) { /* fall through */ }
    }
    return fallbackGlyph ? glyph(fallbackGlyph) : '';
  }

  // accent surfaces (--accent-solid*, --on-accent) are published by PandaOS.theme.apply() in the kernel
  P.ui = P.ui || {};
  P.ui.accentPair = (hex) => (P.theme && P.theme.accentPair ? P.theme.accentPair(hex) : null);

  // ---------------------------------------------------------------- state
  let layer = null;
  let levels = [];            // open menus: [root, sub, subsub…]
  let focusIdx = 0;           // which level the keyboard drives
  let onCloseCb = null;
  let attached = false;
  let inited = false;
  let pointerDownPending = false;
  let skipNextMouseDown = false;

  const MARGIN = 8;
  const OPEN_DELAY = 140;
  const CLOSE_DELAY = 240;

  function getLayer() {
    if (!layer || !layer.isConnected) {
      layer = document.getElementById('context-menu-layer');
      if (!layer) {
        layer = U.el('div', { id: 'context-menu-layer' });
        (document.getElementById('os-root') || document.body).appendChild(layer);
      }
    }
    return layer;
  }

  // ---------------------------------------------------------------- building
  function normalize(items) {
    const out = [];
    (Array.isArray(items) ? items : []).forEach((it) => {
      if (!it || typeof it !== 'object') return;
      if (it.type === 'separator') {
        if (!out.length || out[out.length - 1].type === 'separator') return;
      }
      out.push(it);
    });
    while (out.length && out[out.length - 1].type === 'separator') out.pop();
    return out;
  }

  function buildLevel(items, depth, parentEntry) {
    const list = normalize(items);
    const hasLead = list.some((it) => it.type !== 'separator' && (it.icon || typeof it.checked === 'boolean'));
    const el = U.el('div', { class: 'ctx-menu' + (depth ? ' ctx-sub' : '') + (hasLead ? ' has-lead' : ''), role: 'menu', tabindex: '-1' });
    el.setAttribute('aria-orientation', 'vertical');
    const level = { el, depth, entries: [], active: -1, hover: null, timer: 0, parentEntry: parentEntry || null, left: 0, top: 0, width: 0, height: 0 };

    list.forEach((def) => {
      if (def.type === 'separator') {
        el.appendChild(U.el('div', { class: 'ctx-sep', role: 'separator' }));
        return;
      }
      const sub = Array.isArray(def.submenu) && normalize(def.submenu).length ? def.submenu : null;
      const enabled = !def.disabled;
      const isCheck = typeof def.checked === 'boolean';
      const itemEl = U.el('div', {
        class: 'ctx-item' + (enabled ? '' : ' disabled') + (def.danger ? ' danger' : '') + (def.checked ? ' checked' : ''),
        role: isCheck ? 'menuitemcheckbox' : 'menuitem'
      });
      if (isCheck) itemEl.setAttribute('aria-checked', def.checked ? 'true' : 'false');
      if (!enabled) itemEl.setAttribute('aria-disabled', 'true');
      if (sub) {
        itemEl.setAttribute('aria-haspopup', 'menu');
        itemEl.setAttribute('aria-expanded', 'false');
      }

      if (hasLead) {
        const lead = U.el('span', { class: 'ctx-lead' });
        if (def.icon) {
          lead.innerHTML = iconMarkup(def.icon);
          if (def.checked) lead.classList.add('on');
        } else if (def.checked) {
          lead.innerHTML = iconMarkup('check', 'check');
        }
        itemEl.appendChild(lead);
      }
      itemEl.appendChild(U.el('span', { class: 'ctx-label', text: String(def.label == null ? '' : def.label) }));
      if (sub) {
        itemEl.appendChild(U.el('span', { class: 'ctx-arrow', html: iconMarkup('chevron-right', 'chevron-right') }));
      } else if (def.shortcut) {
        itemEl.appendChild(U.el('span', { class: 'ctx-shortcut', text: String(def.shortcut) }));
      }

      const entry = { def, el: itemEl, index: level.entries.length, enabled, sub, level };
      itemEl._ctx = entry;
      level.entries.push(entry);

      itemEl.addEventListener('mouseenter', () => hoverEnter(level, entry));
      itemEl.addEventListener('click', (e) => {
        if (e.button > 0) return;
        activate(level, entry, false);
      });
      el.appendChild(itemEl);
    });

    // mouse handling shared by the whole menu
    el.addEventListener('mouseover', (e) => {
      const itemEl = e.target && e.target.closest ? e.target.closest('.ctx-item') : null;
      if (itemEl && itemEl._ctx && el.contains(itemEl)) hoverEnter(level, itemEl._ctx);
    });
    el.addEventListener('mouseenter', () => {
      // entering a (sub)menu cancels pending close/open timers of the menus above it
      for (let i = 0; i < level.depth; i++) if (levels[i]) clearTimeout(levels[i].timer);
      focusIdx = Math.max(0, levels.indexOf(level));
    });
    el.addEventListener('mouseleave', () => {
      level.hover = null;
      // keep the highlight while a submenu hangs off this menu, otherwise the pointer left for good
      if (!levels[level.depth + 1]) setActive(level, null);
    });
    // keep the focus where it is (a text area stays focused while its menu is open)
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return level;
  }

  // ---------------------------------------------------------------- positioning
  function viewport() {
    const L = getLayer();
    return { w: L.clientWidth || window.innerWidth, h: L.clientHeight || window.innerHeight };
  }

  function placeRoot(level, x, y) {
    const { w: vw, h: vh } = viewport();
    const el = level.el;
    el.style.maxHeight = Math.max(120, vh - MARGIN * 2) + 'px';
    el.style.left = '0px';
    el.style.top = '0px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w > vw - MARGIN) left = x - w;        // flip to the left of the cursor
    if (top + h > vh - MARGIN) top = y - h;          // flip above the cursor
    left = U.clamp(left, MARGIN, Math.max(MARGIN, vw - w - MARGIN));
    top = U.clamp(top, MARGIN, Math.max(MARGIN, vh - h - MARGIN));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.transformOrigin = `${U.clamp(x - left, 0, w)}px ${U.clamp(y - top, 0, h)}px`;
    Object.assign(level, { left, top, width: w, height: h });
  }

  function placeSub(parent, level, entry) {
    const { w: vw, h: vh } = viewport();
    const el = level.el;
    el.style.maxHeight = Math.max(120, vh - MARGIN * 2) + 'px';
    el.style.left = '0px';
    el.style.top = '0px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const itemTop = parent.top + parent.el.clientTop + entry.el.offsetTop - parent.el.scrollTop;
    const itemH = entry.el.offsetHeight;
    let left = parent.left + parent.width - 4;
    let flipped = false;
    if (left + w > vw - MARGIN) {
      left = parent.left - w + 4;
      flipped = true;
    }
    left = U.clamp(left, MARGIN, Math.max(MARGIN, vw - w - MARGIN));
    const top = U.clamp(itemTop - 5, MARGIN, Math.max(MARGIN, vh - h - MARGIN));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.transformOrigin = `${flipped ? w : 0}px ${U.clamp(itemTop + itemH / 2 - top, 0, h)}px`;
    Object.assign(level, { left, top, width: w, height: h });
  }

  // ---------------------------------------------------------------- selection + submenus
  function setActive(level, entry) {
    if (level.active >= 0 && level.entries[level.active]) level.entries[level.active].el.classList.remove('active');
    level.active = entry ? entry.index : -1;
    if (entry) entry.el.classList.add('active');
  }

  function move(level, dir) {
    const n = level.entries.length;
    if (!n) return;
    let i = level.active;
    for (let k = 0; k < n; k++) {
      i = i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n;
      if (level.entries[i].enabled) {
        setActive(level, level.entries[i]);
        level.entries[i].el.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
  }

  function edge(level, last) {
    const list = level.entries.filter((e) => e.enabled);
    const entry = last ? list[list.length - 1] : list[0];
    if (entry) {
      setActive(level, entry);
      entry.el.scrollIntoView({ block: 'nearest' });
    }
  }

  function typeahead(level, ch) {
    const c = ch.toLocaleLowerCase('tr');
    const n = level.entries.length;
    for (let k = 1; k <= n; k++) {
      const entry = level.entries[(level.active + k + n) % n];
      if (entry.enabled && String(entry.def.label || '').toLocaleLowerCase('tr').startsWith(c)) {
        setActive(level, entry);
        entry.el.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
  }

  function closeFrom(depth) {
    while (levels.length > depth) {
      const l = levels.pop();
      clearTimeout(l.timer);
      l.el.remove();
      if (l.parentEntry) {
        l.parentEntry.el.classList.remove('sub-open');
        l.parentEntry.el.setAttribute('aria-expanded', 'false');
      }
    }
    if (focusIdx >= levels.length) focusIdx = Math.max(0, levels.length - 1);
  }

  function openSub(depth, entry, viaKeyboard) {
    const parent = levels[depth];
    if (!parent || !entry.sub || !entry.enabled) return;
    const existing = levels[depth + 1];
    if (existing && existing.parentEntry === entry) {
      if (viaKeyboard) {
        focusIdx = depth + 1;
        if (existing.active < 0) move(existing, 1);
      }
      return;
    }
    closeFrom(depth + 1);
    const child = buildLevel(entry.sub, depth + 1, entry);
    if (!child.entries.length) return;
    levels.push(child);
    getLayer().appendChild(child.el);
    placeSub(parent, child, entry);
    entry.el.classList.add('sub-open');
    entry.el.setAttribute('aria-expanded', 'true');
    if (viaKeyboard) {
      focusIdx = depth + 1;
      move(child, 1);
    }
  }

  function hoverEnter(level, entry) {
    if (level.hover === entry) return;
    level.hover = entry;
    focusIdx = Math.max(0, levels.indexOf(level));
    clearTimeout(level.timer);
    if (!entry.enabled) {
      setActive(level, null);
      level.timer = setTimeout(() => closeFrom(level.depth + 1), CLOSE_DELAY);
      return;
    }
    setActive(level, entry);
    const child = levels[level.depth + 1];
    if (entry.sub) {
      if (child && child.parentEntry === entry) return;
      level.timer = setTimeout(() => {
        if (levels[level.depth] === level) openSub(level.depth, entry, false);
      }, OPEN_DELAY);
    } else if (child) {
      level.timer = setTimeout(() => closeFrom(level.depth + 1), CLOSE_DELAY);
    }
  }

  function run(def) {
    hide();
    if (typeof def.action === 'function') {
      try {
        def.action(def);
      } catch (e) {
        console.error('[contextMenu] menü işlemi başarısız', e);
      }
    }
  }

  function activate(level, entry, viaKeyboard) {
    if (!entry || !entry.enabled) return;
    if (entry.sub) {
      clearTimeout(level.timer);
      openSub(level.depth, entry, viaKeyboard);
      return;
    }
    run(entry.def);
  }

  // ---------------------------------------------------------------- global listeners
  function insideMenu(target) {
    return !!(target && target.closest && target.closest('.ctx-menu'));
  }

  function onPress(e) {
    if (!levels.length) return;
    if (e.type === 'mousedown' && skipNextMouseDown) {
      skipNextMouseDown = false;
      return;
    }
    if (insideMenu(e.target)) return;
    hide();
  }

  function onKey(e) {
    if (!levels.length) return;
    const lvl = levels[Math.min(focusIdx, levels.length - 1)];
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const entry = lvl.active >= 0 ? lvl.entries[lvl.active] : null;
    switch (e.key) {
      case 'Escape': stop(); hide(); return;
      case 'ArrowDown': stop(); move(lvl, 1); return;
      case 'ArrowUp': stop(); move(lvl, -1); return;
      case 'Home': stop(); edge(lvl, false); return;
      case 'End': stop(); edge(lvl, true); return;
      case 'ArrowRight':
        stop();
        if (entry && entry.sub) openSub(lvl.depth, entry, true);
        return;
      case 'ArrowLeft':
        stop();
        if (lvl.depth > 0) {
          closeFrom(lvl.depth);
          focusIdx = lvl.depth - 1;
        }
        return;
      case 'Enter':
      case ' ':
        stop();
        if (entry) activate(lvl, entry, true);
        return;
      case 'Tab': stop(); hide(); return;
      default:
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          stop();
          typeahead(lvl, e.key);
        }
    }
  }

  function onWheel(e) {
    if (levels.length && !insideMenu(e.target)) hide();
  }

  function onScroll(e) {
    if (levels.length && !insideMenu(e.target)) hide();
  }

  function attach() {
    if (attached) return;
    attached = true;
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('mousedown', onPress, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
  }

  function detach() {
    if (!attached) return;
    attached = false;
    document.removeEventListener('pointerdown', onPress, true);
    document.removeEventListener('mousedown', onPress, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('wheel', onWheel, { capture: true });
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('blur', hide);
    window.removeEventListener('resize', hide);
  }

  // ---------------------------------------------------------------- public API
  function hide() {
    if (!levels.length) return;
    const closing = levels;
    levels = [];
    focusIdx = 0;
    closing.forEach((l) => {
      clearTimeout(l.timer);
      l.el.remove();
    });
    detach();
    const cb = onCloseCb;
    onCloseCb = null;
    if (typeof cb === 'function') {
      try { cb(); } catch (e) { console.error('[contextMenu] onClose hatası', e); }
    }
    P.bus.emit('contextmenu:close');
  }

  function show(x, y, items, opts) {
    // convenience: show(event, items, opts)
    if (x && typeof x === 'object' && 'clientX' in x) {
      opts = items;
      items = y;
      y = x.clientY;
      x = x.clientX;
    }
    init();
    hide();
    x = Number.isFinite(Number(x)) ? Number(x) : 0;
    y = Number.isFinite(Number(y)) ? Number(y) : 0;
    const level = buildLevel(items, 0, null);
    if (!level.entries.length) return null;
    levels = [level];
    focusIdx = 0;
    onCloseCb = opts && typeof opts.onClose === 'function' ? opts.onClose : null;
    getLayer().appendChild(level.el);
    placeRoot(level, x, y);
    // a menu opened from a pointerdown handler must survive that same press' mousedown
    skipNextMouseDown = pointerDownPending;
    attach();
    P.bus.emit('contextmenu:open', { x, y });
    return { el: level.el, close: hide };
  }

  function isOpen() {
    return levels.length > 0;
  }

  /** Editable controls keep the browser's native menu (copy / paste / spellcheck). */
  function wantsNativeMenu(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const field = el.closest ? el.closest('textarea, input') : null;
    if (!field) return false;
    if (field.tagName === 'TEXTAREA') return true;
    const type = (field.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'url', 'email', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'].includes(type);
  }

  function init() {
    if (inited) return;
    inited = true;
    getLayer();
    document.addEventListener('contextmenu', (e) => {
      if (wantsNativeMenu(e.target)) return;
      e.preventDefault();
    });
    // remember whether a pointerdown is being dispatched right now (see show())
    document.addEventListener('pointerdown', () => {
      pointerDownPending = true;
      setTimeout(() => { pointerDownPending = false; skipNextMouseDown = false; }, 0);
    }, true);
    document.addEventListener('mousedown', () => { pointerDownPending = false; }, true);
    ['session:lock', 'session:shutdown', 'theme:change'].forEach((evt) => P.bus.on(evt, hide));
  }

  P.contextMenu = { init, show, hide, isOpen };
})();
