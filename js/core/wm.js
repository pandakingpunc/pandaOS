/* PandaOS window manager (C2) — implements PandaOS.wm and the `win` object (docs/API.md §6).

   Model
   - Every window is a `Win` instance. Public API follows the contract; internals are `_`-prefixed.
   - `windows[]` is the z-order (bottom → top). Minimized windows stay in the array.
   - Geometry lives in `_bounds` (what is on screen; the work area while maximized/snapped).
     `_normal` remembers the free-floating bounds to return to when leaving maximized/snapped state.
   - Minimized, maximized and snapped are tracked as separate flags (a maximized window that is
     minimized comes back maximized, like in Windows).
   - Animations are CSS driven, but completion is always handled by timers (never transitionend)
     and skipped when the `animations` setting is off (or `?fast=1`, see animOn()). */
(function () {
  'use strict';

  const P = window.PandaOS;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const num = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

  // ------------------------------------------------------------------ constants
  const DEF = { width: 640, height: 440, minWidth: 280, minHeight: 180 };
  const KEEP_VISIBLE = 120;       // px of title bar that must stay inside the work area horizontally
  const SNAP_EDGE = 8;            // px from the work-area edge that arms a snap zone
  const SNAP_INSET = 8;           // inset of the snap preview rectangle
  const DRAG_THRESHOLD = 3;       // px before a title-bar press turns into a drag
  const CASCADE = { x: 56, y: 40, step: 32 };
  const MS = { open: 180, close: 150, minimize: 230, restore: 230, bounds: 220, flash: 1800 };

  const CURSORS = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize'
  };
  const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  // Fallback glyphs (10x10, crisp 1px strokes) used when PandaOS.icons has no title-bar glyphs.
  const SVG_HEAD = '<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">';
  const GLYPHS = {
    minimize: SVG_HEAD + '<path d="M0 5.5h10"/></svg>',
    maximize: SVG_HEAD + '<rect x=".5" y=".5" width="9" height="9" rx="1.2"/></svg>',
    restore: SVG_HEAD + '<path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1"/><rect x=".5" y="2.5" width="7" height="7" rx="1.2"/></svg>',
    close: SVG_HEAD + '<path d="M.5.5l9 9M9.5.5l-9 9"/></svg>'
  };
  const FALLBACK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9.5h18"/></svg>';

  // ------------------------------------------------------------------ state
  const windows = [];              // z-order, bottom → top
  const byEl = new WeakMap();
  let layer = null;                // #windows
  let preview = null;              // snap preview element
  let inited = false;
  let seq = 0;
  let cascade = 0;
  let titleH = 36;
  let focused = null;
  let stash = [];                  // windows minimized by the last "show desktop"
  let interaction = null;          // active drag / resize

  // ------------------------------------------------------------------ small helpers
  function animOn() {
    try { if (P.settings && P.settings.get('animations') === false) return false; } catch (_) { /* ignore */ }
    if (wm.forceAnimations) return true;
    return !(P.params && P.params.get('fast') === '1');
  }

  function defer(fn) {
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 60);
  }

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.getElementById('windows');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'windows';
      (document.getElementById('os-root') || document.body).appendChild(layer);
    }
    return layer;
  }

  function workArea() {
    const l = ensureLayer();
    const r = l.getBoundingClientRect();
    const width = r.width || window.innerWidth;
    const height = r.height || Math.max(0, window.innerHeight - 48);
    return { x: 0, y: 0, width: Math.round(width), height: Math.round(height) };
  }

  /** Keeps the title bar reachable: some of it horizontally, all of it vertically inside the area. */
  function clampPos(b) {
    const wa = workArea();
    const keep = Math.min(KEEP_VISIBLE, b.width);
    const minX = wa.x + keep - b.width;
    const maxX = Math.max(minX, wa.x + wa.width - keep);
    const minY = wa.y;
    const maxY = Math.max(minY, wa.y + wa.height - titleH);
    b.x = Math.round(clamp(b.x, minX, maxX));
    b.y = Math.round(clamp(b.y, minY, maxY));
    return b;
  }

  function iconMarkup(name) {
    try {
      if (typeof name === 'string' && name.trim().startsWith('<svg')) return name;
      if (P.icons && typeof P.icons.get === 'function' && name) {
        const s = P.icons.get(name);
        if (s) return s;
      }
    } catch (_) { /* fall through */ }
    return FALLBACK_ICON;
  }

  /** Title-bar glyph: PandaOS.icons when it has it, otherwise our own crisp SVG. */
  function glyph(name) {
    try {
      if (P.icons && typeof P.icons.has === 'function' && P.icons.has(name)) {
        const s = P.icons.get(name);
        if (s) return { html: s, set: true };
      }
    } catch (_) { /* fall through */ }
    return { html: GLYPHS[name], set: false };
  }

  function setGlyph(btn, name) {
    const g = glyph(name);
    btn.innerHTML = g.html;
    btn.classList.toggle('wm-glyph-set', g.set);
  }

  // ------------------------------------------------------------------ events
  function winEmit(w, evt, data) {
    const set = w._listeners.get(evt);
    if (!set || !set.size) return;
    [...set].forEach((fn) => {
      try { fn(data); } catch (e) { console.error(`[wm] "${evt}" dinleyicisi hata verdi`, e); }
    });
  }

  /** Window listeners + bus `wm:<evt>` + `wm:change`. */
  function fire(w, evt) {
    winEmit(w, evt, w);
    P.bus.emit('wm:' + evt, w);
    P.bus.emit('wm:change', w);
  }

  // ------------------------------------------------------------------ z-order / focus
  function applyZ() {
    windows.forEach((w, i) => { w.el.style.zIndex = String(i + 1); });
  }

  function bringToFront(w) {
    const i = windows.indexOf(w);
    if (i === windows.length - 1) return;
    if (i >= 0) windows.splice(i, 1);
    windows.push(w);
    applyZ();
  }

  function topVisible() {
    for (let i = windows.length - 1; i >= 0; i--) {
      const w = windows[i];
      if (!w._minimized && !w._closed) return w;
    }
    return null;
  }

  /** The control inside `w` that had DOM focus last (kept by a focusin listener), if it is still usable. */
  function rememberedFocus(w) {
    const c = w._lastFocus;
    if (!c || c === w.el || !c.isConnected || !w.el.contains(c) || c.disabled) return null;
    if (typeof c.getClientRects === 'function' && c.getClientRects().length === 0) return null; // hidden now
    return c;
  }

  /** Gives DOM focus to a window: back to the control that had it (caret in the textarea...), else the window itself. */
  function domFocus(w) {
    if (!w || w._closed || w._minimized) return;
    if (w.el.contains(document.activeElement)) return;
    const c = rememberedFocus(w);
    if (c) {
      try { c.focus({ preventScroll: true }); } catch (_) { /* fall through */ }
      if (w.el.contains(document.activeElement)) return;
    }
    try { w.el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  }

  /** focusin on the window layer: remember which control owns the keyboard in each window. */
  function onLayerFocusIn(e) {
    const t = e.target;
    const el = t && t.closest ? t.closest('.wm-window') : null;
    const w = el ? byEl.get(el) : null;
    if (!w || w._closed) return;
    w._lastFocus = t === el ? null : t; // focusing the bare window (blank area click) forgets the old control
  }

  function setFocused(next) {
    const prev = focused;
    if (prev === next) return;
    focused = next;
    if (prev) {
      prev.el.classList.remove('wm-focused');
      fire(prev, 'blur');
    }
    if (next) {
      next.el.classList.add('wm-focused');
      fire(next, 'focus');
    }
  }

  function focusWin(w) {
    if (!w || w._closed) return;
    if (w._minimized) unminimizeWin(w);
    bringToFront(w);
    setFocused(w);
    domFocus(w);
  }

  /** After the focused window disappears (closed / minimized): focus the next topmost visible one. */
  function handoffFocus() {
    const next = topVisible();
    setFocused(next);
    if (next) domFocus(next);
    else if (document.activeElement && document.activeElement !== document.body) {
      const a = document.activeElement;
      if (a.closest && a.closest('.wm-window')) { try { a.blur(); } catch (_) { /* ignore */ } }
    }
  }

  // ------------------------------------------------------------------ visual state helpers
  function cancelAnim(w) {
    if (w._animTimer) { clearTimeout(w._animTimer); w._animTimer = 0; }
    const el = w.el;
    el.classList.remove('wm-opening', 'wm-closing');
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
  }

  function cancelBoundsAnim(w) {
    if (w._boundsTimer) { clearTimeout(w._boundsTimer); w._boundsTimer = 0; }
    w.el.classList.remove('wm-animating');
  }

  /** 'resize' event: body size changed. Deduplicated, so RO + synchronous notifications never double up. */
  function emitSize(w, width, height) {
    if (w._closed) return;
    width = Math.round(width);
    height = Math.round(height);
    const last = w._lastSize;
    if (last && last.width === width && last.height === height) return;
    w._lastSize = { width, height };
    winEmit(w, 'resize', { width, height });
  }

  function notifySize(w) {
    if (w._closed || !w.body.isConnected) return;
    emitSize(w, w.body.clientWidth, w.body.clientHeight);
  }

  function applyBounds(w, animate) {
    const el = w.el;
    const b = w._bounds;
    if (animate && animOn()) {
      el.classList.add('wm-animating');
      clearTimeout(w._boundsTimer);
      w._boundsTimer = setTimeout(() => {
        w._boundsTimer = 0;
        el.classList.remove('wm-animating');
      }, MS.bounds + 40);
    } else {
      cancelBoundsAnim(w);
    }
    const s = el.style;
    s.left = b.x + 'px';
    s.top = b.y + 'px';
    s.width = b.width + 'px';
    s.height = b.height + 'px';
    notifySize(w);
  }

  function syncChrome(w) {
    const c = w.el.classList;
    c.toggle('wm-maximized', w._maximized);
    c.toggle('wm-snapped', !!w._snap && !w._maximized);
    c.toggle('wm-nonresizable', !w.resizable);
    c.toggle('wm-no-max', !w.maximizable);
    c.toggle('wm-no-min', !w.minimizable);
    const glyphName = w._maximized ? 'restore' : 'maximize';
    if (w._maxGlyph !== glyphName) {
      w._maxGlyph = glyphName;
      setGlyph(w._btnMax, glyphName);
      const label = w._maximized ? 'Önceki boyuta getir' : 'Büyüt';
      w._btnMax.setAttribute('aria-label', label);
      setCaptionTip(w._btnMax, label);
    }
  }

  // ---- minimize / restore animation
  function minimizePose(w) {
    const r = w.el.getBoundingClientRect();
    const lr = ensureLayer().getBoundingClientRect();
    let tr = null;
    try { tr = P.taskbar && P.taskbar.getButtonRect ? P.taskbar.getButtonRect(w.id) : null; } catch (_) { tr = null; }
    let cx; let cy; let tw;
    if (tr && (tr.width || tr.height)) {
      cx = tr.left + tr.width / 2; cy = tr.top + tr.height / 2; tw = tr.width;
    } else {
      cx = lr.left + lr.width / 2; cy = lr.bottom + 28; tw = 120;
    }
    const s = clamp(tw / Math.max(1, r.width), 0.08, 0.32);
    const dx = cx - (r.left + r.width / 2);
    const dy = cy - (r.top + r.height / 2);
    return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${s.toFixed(3)})`;
  }

  function animateMinimize(w) {
    cancelAnim(w);
    const el = w.el;
    if (!animOn()) { el.classList.add('wm-minimized'); return; }
    const pose = minimizePose(w);
    el.style.transition = `transform ${MS.minimize}ms cubic-bezier(.5, 0, .75, .4), opacity ${MS.minimize - 60}ms ease-in`;
    el.style.transform = pose;
    el.style.opacity = '0';
    w._animTimer = setTimeout(() => {
      w._animTimer = 0;
      el.classList.add('wm-minimized');
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
    }, MS.minimize + 25);
  }

  function animateRestore(w) {
    cancelAnim(w);
    const el = w.el;
    el.classList.remove('wm-minimized');
    if (!animOn()) return;
    el.style.transition = 'none';
    el.style.transform = minimizePose(w);
    el.style.opacity = '0';
    void el.offsetWidth; // commit the start pose
    el.style.transition = `transform ${MS.restore}ms var(--ease-out), opacity ${MS.restore - 40}ms ease-out`;
    el.style.transform = '';
    el.style.opacity = '';
    w._animTimer = setTimeout(() => {
      w._animTimer = 0;
      el.style.transition = '';
    }, MS.restore + 25);
  }

  // ------------------------------------------------------------------ state transitions
  function minimizeWin(w, opts) {
    if (w._closed || w._minimized || !w.minimizable) return;
    if (interaction && interaction.win === w) interaction.cancel();
    w._minimized = true;
    animateMinimize(w);
    fire(w, 'minimize');
    if (focused === w && !(opts && opts.keepFocus)) handoffFocus();
  }

  function unminimizeWin(w) {
    if (w._closed || !w._minimized) return;
    w._minimized = false;
    animateRestore(w);
    fire(w, 'restore');
  }

  function maximizeWin(w, animate) {
    if (w._closed || !w.maximizable || w._maximized) return;
    if (!w._normal) w._normal = { ...w._bounds };
    w._maximized = true;
    w._snap = null;
    w._bounds = workArea();
    applyBounds(w, animate !== false);
    syncChrome(w);
    fire(w, 'maximize');
  }

  /** Leaves maximized / snapped state, going back to `_normal` (or `to`). */
  function leaveSpecial(w, animate, to) {
    const nb = to ? { ...to } : (w._normal ? { ...w._normal } : { ...w._bounds });
    w._maximized = false;
    w._snap = null;
    w._normal = null;
    clampPos(nb);
    w._bounds = nb;
    applyBounds(w, animate);
    syncChrome(w);
    fire(w, 'restore');
  }

  function snapRect(w, side, wa) {
    wa = wa || workArea();
    const half = Math.floor(wa.width / 2);
    const leftW = Math.min(wa.width, Math.max(half, w.minWidth));
    const rightW = Math.min(wa.width, Math.max(wa.width - half, w.minWidth));
    return side === 'left'
      ? { x: wa.x, y: wa.y, width: leftW, height: wa.height }
      : { x: wa.x + wa.width - rightW, y: wa.y, width: rightW, height: wa.height };
  }

  function snapWin(w, side, animate) {
    if (w._closed || !w.resizable || (side !== 'left' && side !== 'right')) return;
    if (!w._normal) w._normal = { ...w._bounds };
    const wasMax = w._maximized;
    w._maximized = false;
    w._snap = side;
    w._bounds = snapRect(w, side);
    applyBounds(w, animate !== false);
    syncChrome(w);
    if (wasMax) winEmit(w, 'restore', w);
    fire(w, 'snap');
  }

  function removeFromWm(w) {
    const i = windows.indexOf(w);
    if (i >= 0) windows.splice(i, 1);
    stash = stash.filter((x) => x !== w);
  }

  function disposeWin(w) {
    if (interaction && interaction.win === w) interaction.cancel();
    const el = w.el;
    if (w._ro) { try { w._ro.disconnect(); } catch (_) { /* ignore */ } w._ro = null; }
    cancelBoundsAnim(w);
    if (!animOn()) { el.remove(); return; }
    cancelAnim(w);
    el.classList.add('wm-closing');
    setTimeout(() => el.remove(), MS.close + 40);
  }

  function forceCloseWin(w) {
    if (w._closed) return;
    const wasFocused = focused === w;
    if (wasFocused) setFocused(null);                 // blur
    w._closed = true;
    removeFromWm(w);
    if (w.el.contains(document.activeElement)) { try { document.activeElement.blur(); } catch (_) { /* ignore */ } }
    fire(w, 'close');
    disposeWin(w);
    if (wasFocused) {
      const next = topVisible();
      if (next) { setFocused(next); domFocus(next); }
    }
  }

  // ------------------------------------------------------------------ drag / resize plumbing
  function inControls(e) {
    const t = e.target;
    return !!(t && t.closest && t.closest('.wm-controls'));
  }

  function beginInteraction(w, mode, cursor, cancel) {
    const cl = document.body.classList;
    cl.add('wm-interacting', 'wm-' + mode);
    document.body.style.setProperty('--wm-cursor', cursor);
    interaction = { win: w, mode, cancel };
  }

  function endInteraction() {
    const cl = document.body.classList;
    cl.remove('wm-interacting', 'wm-dragging', 'wm-resizing');
    document.body.style.removeProperty('--wm-cursor');
    hidePreview();
    interaction = null;
  }

  /** Follows one pointer on the whole document (works with and without real pointer capture). */
  function trackPointer(e, handlers) {
    const pid = e.pointerId;
    const src = e.currentTarget;
    try { src.setPointerCapture(pid); } catch (_) { /* synthetic pointers can't be captured */ }
    let live = true;
    const stop = () => {
      if (!live) return;
      live = false;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      try { src.releasePointerCapture(pid); } catch (_) { /* ignore */ }
    };
    function move(ev) {
      if (ev.pointerId !== pid) return;
      if (ev.isTrusted && ev.pointerType === 'mouse' && ev.buttons === 0) { up(ev); return; }
      handlers.move(ev);
    }
    function up(ev) {
      if (ev.pointerId !== pid) return;
      stop();
      handlers.up(ev, ev.type === 'pointercancel');
    }
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return { cancel() { stop(); handlers.up(null, true); } };
  }

  // ---- snap preview
  function ensurePreview() {
    ensureLayer();
    if (preview && preview.parentNode === layer) return preview;
    preview = document.createElement('div');
    preview.className = 'wm-snap-preview';
    preview.setAttribute('aria-hidden', 'true');
    layer.appendChild(preview);
    return preview;
  }

  function zoneRect(zone) {
    const wa = workArea();
    const half = Math.floor(wa.width / 2);
    if (zone === 'left') return { x: wa.x, y: wa.y, width: half, height: wa.height };
    if (zone === 'right') return { x: wa.x + half, y: wa.y, width: wa.width - half, height: wa.height };
    return wa;
  }

  function showPreview(w, zone) {
    const p = ensurePreview();
    const r = zoneRect(zone);
    const set = (b, inset) => {
      p.style.left = b.x + inset + 'px';
      p.style.top = b.y + inset + 'px';
      p.style.width = Math.max(0, b.width - inset * 2) + 'px';
      p.style.height = Math.max(0, b.height - inset * 2) + 'px';
    };
    if (!p.classList.contains('wm-show')) {
      // grow out of the dragged window
      p.style.transition = 'none';
      set(w._bounds, 0);
      void p.offsetWidth;
      p.style.transition = animOn() ? '' : 'none';
      p.classList.add('wm-show');
    }
    p.dataset.zone = zone;
    set(r, SNAP_INSET);
  }

  function hidePreview() {
    if (!preview) return;
    preview.classList.remove('wm-show');
    delete preview.dataset.zone;
  }

  function detectZone(w, lx, ly) {
    const wa = workArea();
    if (ly <= wa.y + SNAP_EDGE && w.maximizable) return 'top';
    if (!w.resizable) return null;
    if (lx <= wa.x + SNAP_EDGE) return 'left';
    if (lx >= wa.x + wa.width - SNAP_EDGE) return 'right';
    return null;
  }

  // ---- title bar drag
  function startDrag(w, e) {
    if (e.button !== 0 || inControls(e) || interaction || w._closed) return;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    let origin = null;
    let grabX = 0;
    let grabY = 0;
    let zone = null;
    let preNormal = null;

    const tracker = trackPointer(e, {
      move(ev) {
        if (!moved) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
          moved = true;
          origin = ensureLayer().getBoundingClientRect();
          beginInteraction(w, 'dragging', 'default', () => tracker.cancel());
          cancelBoundsAnim(w);
          const sx = start.x - origin.left;
          const sy = start.y - origin.top;
          if (w._maximized || w._snap) {
            // restore under the cursor, keeping the grab point's proportional position
            const b = w._bounds;
            preNormal = w._normal ? { ...w._normal } : { ...b };
            const frac = clamp((sx - b.x) / Math.max(1, b.width), 0, 1);
            leaveSpecial(w, false, {
              x: Math.round(sx - frac * preNormal.width),
              y: b.y,
              width: preNormal.width,
              height: preNormal.height
            });
          } else {
            preNormal = { ...w._bounds };
          }
          grabX = sx - w._bounds.x;
          grabY = sy - w._bounds.y;
        }
        const lx = ev.clientX - origin.left;
        const ly = ev.clientY - origin.top;
        const nb = clampPos({ x: lx - grabX, y: ly - grabY, width: w._bounds.width, height: w._bounds.height });
        w._bounds.x = nb.x;
        w._bounds.y = nb.y;
        w.el.style.left = nb.x + 'px';
        w.el.style.top = nb.y + 'px';
        const z = detectZone(w, lx, ly);
        if (z !== zone) {
          zone = z;
          if (zone) showPreview(w, zone); else hidePreview();
        }
      },
      up(ev, cancelled) {
        if (!moved) return;
        const z = cancelled ? null : zone;
        endInteraction();
        if (z && !w._closed) {
          w._normal = preNormal;
          if (z === 'top') maximizeWin(w, true); else snapWin(w, z, true);
        }
        fire(w, 'move');
      }
    });
  }

  // ---- edge / corner resize
  function startResize(w, dir, e) {
    if (e.button !== 0 || !w.resizable || w._maximized || interaction || w._closed) return;
    const start = { x: e.clientX, y: e.clientY };
    const b0 = { ...w._bounds };
    let moved = false;

    const tracker = trackPointer(e, {
      move(ev) {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved) {
          if (!dx && !dy) return;
          moved = true;
          beginInteraction(w, 'resizing', CURSORS[dir], () => tracker.cancel());
          cancelBoundsAnim(w);
          if (w._snap) { // manual resize ends the snapped state
            w._snap = null;
            w._normal = null;
            syncChrome(w);
          }
        }
        const wa = workArea();
        const minW = w.minWidth;
        const minH = w.minHeight;
        const r0 = b0.x + b0.width;
        const bt0 = b0.y + b0.height;
        let left = b0.x;
        let top = b0.y;
        let right = r0;
        let bottom = bt0;
        if (dir.includes('e')) right = clamp(r0 + dx, b0.x + minW, Math.max(b0.x + minW, wa.x + wa.width, r0));
        if (dir.includes('w')) left = clamp(b0.x + dx, Math.min(wa.x, b0.x, r0 - minW), r0 - minW);
        if (dir.includes('s')) bottom = clamp(bt0 + dy, b0.y + minH, Math.max(b0.y + minH, wa.y + wa.height, bt0));
        if (dir.includes('n')) top = clamp(b0.y + dy, Math.min(wa.y, b0.y, bt0 - minH), bt0 - minH);
        w._bounds = { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
        applyBounds(w, false);
      },
      up() {
        if (!moved) return;
        endInteraction();
      }
    });
  }

  // ------------------------------------------------------------------ window menu (title bar right-click)
  function windowMenu(w, x, y) {
    const cm = P.contextMenu;
    if (!cm || typeof cm.show !== 'function') return;
    const special = w._maximized || !!w._snap;
    const items = [
      { label: 'Geri Yükle', icon: 'restore', disabled: !(special || w._minimized), action: () => w.restore() },
      { label: 'Küçült', icon: 'minimize', disabled: !w.minimizable || w._minimized, action: () => w.minimize() },
      { label: 'Büyüt', icon: 'maximize', disabled: !w.maximizable || w._maximized, action: () => w.maximize() },
      w.resizable && { type: 'separator' },
      w.resizable && { label: 'Ekranın soluna yasla', disabled: w._snap === 'left', action: () => w.snap('left') },
      w.resizable && { label: 'Ekranın sağına yasla', disabled: w._snap === 'right', action: () => w.snap('right') },
      { type: 'separator' },
      { label: 'Kapat', icon: 'close', action: () => w.close() }
    ].filter(Boolean);
    try { cm.show(x, y, items); } catch (e) { console.error('[wm] pencere menüsü açılamadı', e); }
  }

  // ------------------------------------------------------------------ global listeners
  function onLayerDown(e) {
    const t = e.target;
    const el = t && t.closest ? t.closest('.wm-window') : null;
    const w = el ? byEl.get(el) : null;
    if (w && !w._closed) focusWin(w);
  }

  function onKeydown(e) {
    const f = focused;
    if (!f || f._closed || f._minimized) return;
    try {
      if (P.session && typeof P.session.isLocked === 'function' && P.session.isLocked()) return;
      if (P.dialog && typeof P.dialog.isOpen === 'function' && P.dialog.isOpen()) return;
    } catch (_) { /* ignore */ }
    const t = e.target;
    if (!(t === document.body || t === document.documentElement || t === document || (t && f.el.contains(t)))) return;
    winEmit(f, 'keydown', e);
  }

  /** A shrinking viewport must shrink floating windows too (never below their minimum size), then keep them reachable. */
  function fitSize(w, b, wa) {
    b.width = Math.round(Math.max(w.minWidth, Math.min(b.width, wa.width)));
    b.height = Math.round(Math.max(w.minHeight, Math.min(b.height, wa.height)));
    // a window that fits again sits fully inside (resize handles and bottom edge never end up under the taskbar)
    if (b.width <= wa.width) b.x = clamp(b.x, wa.x, wa.x + wa.width - b.width);
    if (b.height <= wa.height) b.y = clamp(b.y, wa.y, wa.y + wa.height - b.height);
    return clampPos(b);
  }

  function refitAll() {
    if (!windows.length) return;
    const wa = workArea();
    windows.forEach((w) => {
      if (w._maximized) w._bounds = { ...wa };
      else if (w._snap) w._bounds = snapRect(w, w._snap, wa);
      else fitSize(w, w._bounds, wa);
      if (w._normal) fitSize(w, w._normal, wa);
      applyBounds(w, false);
    });
  }

  // ------------------------------------------------------------------ Win
  class Win {
    constructor() {
      this.state = {};
      this.beforeClose = null;
      this._listeners = new Map();
      this._minimized = false;
      this._maximized = false;
      this._snap = null;
      this._closed = false;
      this._normal = null;
      this._closing = null;
    }

    // --- title / icon
    setTitle(t) {
      this.title = String(t == null ? '' : t);
      this._titleEl.textContent = this.title;
      this.el.setAttribute('aria-label', this.title);
      winEmit(this, 'title', this);
      P.bus.emit('wm:title', this);
      P.bus.emit('wm:change', this);
    }

    getTitle() { return this.title; }

    setIcon(name) {
      this.icon = name;
      this._iconEl.innerHTML = iconMarkup(name);
      P.bus.emit('wm:change', this);
    }

    getIcon() { return this.icon; }

    // --- focus / state
    focus() { focusWin(this); }
    minimize() { minimizeWin(this); }

    maximize() { maximizeWin(this, true); }

    restore() {
      if (this._closed) return;
      if (this._minimized) { unminimizeWin(this); focusWin(this); return; }
      if (this._maximized || this._snap) leaveSpecial(this, true);
    }

    toggleMaximize() {
      if (this._closed) return;
      if (this._maximized) leaveSpecial(this, true); else maximizeWin(this, true);
    }

    /** Extra (not in the contract): half-screen snap. */
    snap(side) { snapWin(this, side, true); }

    close() {
      if (this._closed) return Promise.resolve(true);
      if (this._closing) return this._closing;
      const run = async () => {
        let ok = true;
        if (typeof this.beforeClose === 'function') {
          try { ok = await this.beforeClose(); } catch (e) { console.error('[wm] beforeClose hata verdi', e); ok = true; }
        }
        if (this._closed) return true;
        if (ok === false) {
          focusWin(this);
          return false;
        }
        forceCloseWin(this);
        return true;
      };
      this._closing = run().finally(() => { this._closing = null; });
      return this._closing;
    }

    forceClose() { forceCloseWin(this); }

    isMinimized() { return this._minimized; }
    isMaximized() { return this._maximized; }
    isSnapped() { return this._snap; }
    isFocused() { return focused === this && !this._closed; }
    isClosed() { return this._closed; }

    // --- geometry
    getBounds() { return { ...this._bounds }; }

    setSize(width, height) {
      if (this._closed) return;
      const wa = workArea();
      const target = (this._maximized || this._snap) ? this._normal : this._bounds;
      target.width = Math.round(clamp(num(width, target.width), this.minWidth, Math.max(this.minWidth, wa.width)));
      target.height = Math.round(clamp(num(height, target.height), this.minHeight, Math.max(this.minHeight, wa.height)));
      clampPos(target);
      if (target === this._bounds) applyBounds(this, false);
    }

    setPosition(x, y) {
      if (this._closed) return;
      const target = (this._maximized || this._snap) ? this._normal : this._bounds;
      target.x = num(x, target.x);
      target.y = num(y, target.y);
      clampPos(target);
      if (target === this._bounds) applyBounds(this, false);
    }

    center() {
      if (this._closed) return;
      const wa = workArea();
      const target = (this._maximized || this._snap) ? this._normal : this._bounds;
      target.x = wa.x + (wa.width - target.width) / 2;
      target.y = wa.y + (wa.height - target.height) / 2;
      clampPos(target);
      if (target === this._bounds) applyBounds(this, false);
    }

    // --- events
    on(evt, fn) {
      if (typeof fn !== 'function') return () => {};
      let set = this._listeners.get(evt);
      if (!set) { set = new Set(); this._listeners.set(evt, set); }
      set.add(fn);
      return () => set.delete(fn);
    }

    flash() {
      if (this._closed) return;
      const c = this.el.classList;
      c.remove('wm-flash');
      void this.el.offsetWidth;
      c.add('wm-flash');
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => c.remove('wm-flash'), MS.flash);
      P.bus.emit('wm:flash', this);
    }
  }

  // ------------------------------------------------------------------ wm
  function resolve(idOrWin) {
    if (idOrWin && typeof idOrWin === 'object') return idOrWin;
    return windows.find((w) => w.id === idOrWin) || null;
  }

  function placeNew(width, height) {
    const wa = workArea();
    if (!windows.length) cascade = 0;
    const baseX = clamp(wa.x + CASCADE.x, wa.x, Math.max(wa.x, wa.x + wa.width - width));
    const baseY = clamp(wa.y + CASCADE.y, wa.y, Math.max(wa.y, wa.y + wa.height - height));
    const steps = Math.max(0, Math.min(
      Math.floor((wa.x + wa.width - width - baseX) / CASCADE.step),
      Math.floor((wa.y + wa.height - height - baseY) / CASCADE.step)
    ));
    const i = cascade % (steps + 1);
    cascade++;
    return { x: baseX + i * CASCADE.step, y: baseY + i * CASCADE.step };
  }

  /** Caption-button tooltip: the shared OS tooltip (PandaOS.ui.tip, same look as the taskbar's); native title as a fallback. */
  function setCaptionTip(btn, label) {
    btn._tipText = label;
    if (btn._tipOn) return;
    if (P.ui && typeof P.ui.tip === 'function') {
      btn._tipOn = true;
      btn.removeAttribute('title');
      P.ui.tip(btn, () => btn._tipText);
    } else {
      btn.title = label;
    }
  }

  function buildButton(cls, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wm-btn ' + cls;
    b.tabIndex = -1;
    b.setAttribute('aria-label', label);
    setCaptionTip(b, label);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // never steal DOM focus from the window
    b.addEventListener('click', () => onClick());
    return b;
  }

  /** ?fast=1 (test / screenshot tooling) turns every wm transition off so captures are never mid-animation. */
  let forced = false;
  function syncInstant() {
    if (!layer) return;
    layer.classList.toggle('wm-instant', !!(P.params && P.params.get('fast') === '1') && !forced);
  }

  const wm = {
    init() {
      if (inited) return;
      inited = true;
      ensureLayer();
      syncInstant();
      try {
        const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-height'));
        if (v > 0) titleH = v;
      } catch (_) { /* keep default */ }
      ensurePreview();
      layer.addEventListener('pointerdown', onLayerDown, true);
      layer.addEventListener('mousedown', onLayerDown, true);
      layer.addEventListener('focusin', onLayerFocusIn);
      document.addEventListener('keydown', onKeydown);
      window.addEventListener('resize', refitAll);
      if (typeof ResizeObserver !== 'undefined') {
        try { new ResizeObserver(() => refitAll()).observe(layer); } catch (_) { /* ignore */ }
      }
    },

    open(opts) {
      wm.init();
      const o = Object.assign({}, opts || {});
      const wa = workArea();
      const appId = o.appId ? String(o.appId) : 'app';
      const resizable = o.resizable !== false;
      const w = new Win();
      w.id = 'win-' + (++seq);
      w.appId = appId;
      w.resizable = resizable;
      w.maximizable = o.maximizable != null ? !!o.maximizable : resizable;
      w.minimizable = o.minimizable !== false;
      w.minWidth = Math.max(120, num(o.minWidth, DEF.minWidth));
      w.minHeight = Math.max(80, num(o.minHeight, DEF.minHeight));
      const width = Math.round(clamp(num(o.width, DEF.width), w.minWidth, Math.max(w.minWidth, wa.width)));
      const height = Math.round(clamp(num(o.height, DEF.height), w.minHeight, Math.max(w.minHeight, wa.height)));
      const hasX = o.x != null && Number.isFinite(Number(o.x));
      const hasY = o.y != null && Number.isFinite(Number(o.y));
      const auto = (!hasX || !hasY) ? placeNew(width, height) : null;
      w._bounds = clampPos({ x: hasX ? Number(o.x) : auto.x, y: hasY ? Number(o.y) : auto.y, width, height });
      w.title = String(o.title != null ? o.title : appId);
      w.icon = o.icon || appId;

      // ---- DOM
      const iconEl = document.createElement('span');
      iconEl.className = 'wm-icon';
      iconEl.innerHTML = iconMarkup(w.icon);

      const titleEl = document.createElement('span');
      titleEl.className = 'wm-title';
      titleEl.textContent = w.title;

      const btnMin = buildButton('wm-min', 'Küçült', () => w.minimize());
      const btnMax = buildButton('wm-max', 'Büyüt', () => w.toggleMaximize());
      const btnClose = buildButton('wm-close', 'Kapat', () => w.close());
      setGlyph(btnMin, 'minimize');
      setGlyph(btnMax, 'maximize');
      setGlyph(btnClose, 'close');
      w._maxGlyph = 'maximize';

      const controls = document.createElement('div');
      controls.className = 'wm-controls';
      controls.append(btnMin, btnMax, btnClose);

      const titlebar = document.createElement('div');
      titlebar.className = 'wm-titlebar';
      titlebar.append(iconEl, titleEl, controls);

      const body = document.createElement('div');
      body.className = 'wm-body app-' + appId;

      const el = document.createElement('div');
      el.className = 'wm-window' + (o.className ? ' ' + o.className : '');
      el.tabIndex = -1;
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', w.title);
      el.dataset.winId = w.id;
      el.dataset.appId = appId;
      el.append(titlebar, body);
      HANDLES.forEach((dir) => {
        const h = document.createElement('div');
        h.className = 'wm-h wm-h-' + dir;
        h.dataset.dir = dir;
        h.addEventListener('pointerdown', (e) => startResize(w, dir, e));
        el.appendChild(h);
      });

      w.el = el;
      w.body = body;
      w._titleEl = titleEl;
      w._iconEl = iconEl;
      w._btnMax = btnMax;
      byEl.set(el, w);

      titlebar.addEventListener('pointerdown', (e) => startDrag(w, e));
      // pressing the title bar must not pull the caret out of the app's text field
      titlebar.addEventListener('mousedown', (e) => { if (!inControls(e)) e.preventDefault(); });
      titlebar.addEventListener('dblclick', (e) => {
        if (inControls(e) || !w.maximizable) return;
        w.toggleMaximize();
      });
      titlebar.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!inControls(e)) windowMenu(w, e.clientX, e.clientY);
      });

      // maximized from the start
      if (o.maximized && w.maximizable) {
        w._normal = { ...w._bounds };
        w._maximized = true;
        w._bounds = { ...wa };
      }
      syncChrome(w);
      el.style.left = w._bounds.x + 'px';
      el.style.top = w._bounds.y + 'px';
      el.style.width = w._bounds.width + 'px';
      el.style.height = w._bounds.height + 'px';

      const animate = animOn();
      if (animate) {
        el.classList.add('wm-opening');
        w._animTimer = setTimeout(() => { w._animTimer = 0; el.classList.remove('wm-opening'); }, MS.open + 40);
      }

      ensureLayer().appendChild(el);
      windows.push(w);
      applyZ();

      if (typeof ResizeObserver !== 'undefined') {
        let scheduled = false;
        w._ro = new ResizeObserver(() => {
          if (scheduled) return;
          scheduled = true;
          defer(() => { // outside the observer callback → no "loop limit" errors from app handlers
            scheduled = false;
            notifySize(w); // re-measure: a synchronous notification may already have reported a newer size
          });
        });
        w._ro.observe(body);
      }

      P.bus.emit('wm:open', w);
      P.bus.emit('wm:change', w);
      focusWin(w);
      return w;
    },

    list() { return windows.slice(); },
    get(id) { return windows.find((w) => w.id === id) || undefined; },
    byApp(appId) { return windows.filter((w) => w.appId === appId); },
    getFocused() { return focused && !focused._closed ? focused : null; },
    focus(id) { focusWin(resolve(id)); },

    /** Extra (not in the contract): gives DOM focus back to the focused window (its last control, else the window)
     *  unless it already owns it. Popups (start menu, flyouts) and the unlock path call this when they go away, so
     *  the keyboard never stays parked on a taskbar button or the lock screen. No-op without a focused window. */
    refocus() {
      const f = focused;
      if (f && !f._closed && !f._minimized) domFocus(f);
    },

    /** Extra (not in the contract): deactivates the focused window without closing or hiding anything.
     *  The desktop calls it when the user clicks the wallpaper, so no window looks active while the
     *  keyboard belongs to the desktop. Clicking any window focuses it again. */
    blurAll() {
      if (focused) setFocused(null);
    },

    /** "Show desktop": minimizes everything; a second call restores what it minimized. */
    minimizeAll() {
      const live = stash.filter((w) => !w._closed && w._minimized);
      const visible = windows.filter((w) => !w._minimized && w.minimizable);
      // nothing left that "show desktop" could hide (non-minimizable windows do not count): bring the hidden ones back
      if (live.length && !visible.length) {
        stash = [];
        live.forEach((w) => unminimizeWin(w));
        const top = topVisible();
        if (top) { setFocused(top); domFocus(top); }
        return;
      }
      if (!visible.length) { stash = []; return; }
      stash = visible.slice();
      visible.forEach((w) => minimizeWin(w, { keepFocus: true }));
      handoffFocus();
    },

    /** Closes every window. Forced by default (restart / shutdown); `{ force: false }` honours beforeClose. */
    closeAll(opts) {
      const list = windows.slice();
      if (opts && opts.force === false) {
        return Promise.all(list.map((w) => w.close())).then((r) => r.every(Boolean));
      }
      list.forEach((w) => w.forceClose());
      return Promise.resolve(true);
    },

    workArea
  };

  // test hook: animate even in ?fast=1 (wm.forceAnimations = true)
  Object.defineProperty(wm, 'forceAnimations', {
    enumerable: true,
    get() { return forced; },
    set(v) { forced = !!v; syncInstant(); }
  });

  P.wm = wm;
})();
