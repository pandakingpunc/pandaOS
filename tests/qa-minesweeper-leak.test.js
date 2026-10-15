(function () {
  'use strict';
  const P = window.PandaOS;
  PandaTest.test('QA leak: open/play/close x5 leaves no listeners/timers/bus handlers/DOM', async (t) => {
    P.wm.byApp('minesweeper').forEach((w) => w.forceClose());
    const live = new Map();           // key -> count for targets outside the window
    let curWin = null;
    const outside = (tg) => tg === document || tg === window || tg === document.body || tg === document.documentElement || (tg instanceof Node && tg.isConnected && !curWin.el.contains(tg) && tg.id !== 'windows');
    const origAdd = EventTarget.prototype.addEventListener;
    const origRem = EventTarget.prototype.removeEventListener;
    const keyOf = (tg, type, fn, opts) => (tg === document ? 'document' : tg === window ? 'window' : tg === document.body ? 'body' : (tg.id ? '#' + tg.id : tg.nodeName)) + ':' + type + ':' + (typeof opts === 'object' && opts ? !!opts.capture : !!opts) + ':' + (fn && fn.__id || (fn.__id = Math.random()));
    let recording = false;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (recording && curWin && outside(this) && fn) { const k = keyOf(this, type, fn, opts); live.set(k, (live.get(k) || 0) + 1); }
      return origAdd.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
      if (curWin && fn && fn.__id) { const k = keyOf(this, type, fn, opts); if (live.has(k)) live.delete(k); }
      return origRem.call(this, type, fn, opts);
    };
    const timers = new Set(); const ints = new Set();
    const sT = window.setTimeout, cT = window.clearTimeout, sI = window.setInterval, cI = window.clearInterval;
    window.setTimeout = function (fn, ms, ...a) { const id = sT.call(window, function () { timers.delete(id); return fn.apply(this, arguments); }, ms, ...a); if (recording) timers.add(id); return id; };
    window.clearTimeout = function (id) { timers.delete(id); return cT.call(window, id); };
    window.setInterval = function (...a) { const id = sI.apply(window, a); if (recording) ints.add(id); return id; };
    window.clearInterval = function (id) { ints.delete(id); return cI.call(window, id); };
    const busBefore = JSON.stringify(Object.keys(P.bus).sort());
    let busOn = 0;
    const origBusOn = P.bus.on;
    P.bus.on = function (...a) { busOn++; return origBusOn.apply(this, a); };
    const domBefore = document.querySelectorAll('*').length;
    try {
      for (let round = 0; round < 5; round++) {
        recording = true;
        const w = P.apps.launch('minesweeper', { seed: round + 1 });
        curWin = w;
        const m = w.state.ms;
        const cell = (i) => w.body.querySelector(`.ms-cell[data-i="${i}"]`);
        t.click(cell(40));
        t.contextmenu(cell(3));
        m.openStats(); await t.sleep(20); m.closePanel();
        m.openHelp(); await t.sleep(20); m.closePanel();
        m.openCustom(); await t.sleep(20);
        t.click(w.body.querySelector('.ms-custom-start')); await t.sleep(20);
        t.click(w.body.querySelector('.ms-menu-btn')); await t.sleep(20);
        // leave the menu open on purpose
        const b = m.board;
        for (let i = 0; i < b.size && b.status === 'playing'; i++) if (b.mine[i]) { t.click(cell(i)); break; }
        t.key(w.body.querySelector('.ms-board'), 'F2');
        t.click(cell(10));
        m.openStats(); await t.sleep(20);   // close with panel open
        w.forceClose();
        await t.sleep(80);
        recording = false;
        P.contextMenu.hide();
      }
      await t.sleep(300);
      const left = Array.from(live.keys()).filter((k) => !/^(#windows|#context-menu-layer|#dialog-layer|#toasts):/.test(k));
      t.eq(left, [], 'leftover listeners on global targets');
      t.eq(Array.from(ints), [], 'leftover intervals');
      t.eq(timers.size, 0, 'leftover timeouts: ' + timers.size);
      t.eq(busOn, 0, 'bus subscriptions: ' + busOn);
      const domAfter = document.querySelectorAll('*').length;
      t.ok(Math.abs(domAfter - domBefore) < 15, 'DOM growth ' + (domAfter - domBefore));
    } finally {
      EventTarget.prototype.addEventListener = origAdd;
      EventTarget.prototype.removeEventListener = origRem;
      window.setTimeout = sT; window.clearTimeout = cT; window.setInterval = sI; window.clearInterval = cI;
      P.bus.on = origBusOn;
      P.wm.byApp('minesweeper').forEach((w) => w.forceClose());
    }
  });
})();
