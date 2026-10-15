/* PandaOS in-page test harness. Loaded by boot.js when ?test=<suite> is present.
   Results are written to <pre id="test-results"> (hidden) and document.title, then read
   back by tools/test.sh through headless Chrome's --dump-dom. */
(function () {
  'use strict';

  const tests = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class AssertionError extends Error {}

  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  }

  function fire(el, type, init, Ctor) {
    const ev = new (Ctor || MouseEvent)(type, Object.assign({ bubbles: true, cancelable: true, composed: true, view: window }, init));
    el.dispatchEvent(ev);
    return ev;
  }

  function pointerAndMouse(el, kind, init) {
    // kind: down | move | up
    const pInit = Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, init);
    const P = window.PointerEvent || MouseEvent;
    fire(el, `pointer${kind}`, pInit, P);
    fire(el, `mouse${kind}`, init);
  }

  const t = {
    sleep,
    ok(cond, msg) {
      if (!cond) throw new AssertionError(msg || 'beklenen koşul sağlanmadı');
    },
    eq(actual, expected, msg) {
      if (!deepEqual(actual, expected)) {
        throw new AssertionError(`${msg ? msg + ': ' : ''}beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`);
      }
    },
    throws(fn, code) {
      try {
        fn();
      } catch (e) {
        if (code && e.code !== code) throw new AssertionError(`beklenen hata kodu ${code}, gelen ${e.code || e.message}`);
        return e;
      }
      throw new AssertionError(`hata bekleniyordu${code ? ' (' + code + ')' : ''}`);
    },
    async waitFor(fn, timeout = 3000, msg) {
      const start = Date.now();
      for (;;) {
        let v;
        try { v = fn(); } catch (e) { v = false; }
        if (v) return v;
        if (Date.now() - start > timeout) throw new AssertionError(msg || `waitFor zaman aşımı (${timeout} ms)`);
        await sleep(25);
      }
    },
    $(sel, root) {
      return (root || document).querySelector(sel);
    },
    $$(sel, root) {
      return [...(root || document).querySelectorAll(sel)];
    },
    mouse(el, type, init) {
      return fire(el, type, Object.assign(center(el), init));
    },
    click(el, init) {
      const c = Object.assign(center(el), { button: 0, buttons: 1 }, init);
      pointerAndMouse(el, 'down', c);
      pointerAndMouse(el, 'up', Object.assign({}, c, { buttons: 0 }));
      fire(el, 'click', Object.assign({}, c, { buttons: 0, detail: 1 }));
    },
    dblclick(el, init) {
      t.click(el, init);
      const c = Object.assign(center(el), { button: 0, detail: 2 }, init);
      pointerAndMouse(el, 'down', Object.assign({}, c, { buttons: 1 }));
      pointerAndMouse(el, 'up', c);
      fire(el, 'click', c);
      fire(el, 'dblclick', c);
    },
    contextmenu(el, init) {
      const c = Object.assign(center(el), { button: 2, buttons: 2 }, init);
      pointerAndMouse(el, 'down', c);
      pointerAndMouse(el, 'up', Object.assign({}, c, { buttons: 0 }));
      return fire(el, 'contextmenu', c);
    },
    drag(el, dx, dy, init) {
      const s = Object.assign(center(el), { button: 0, buttons: 1 }, init);
      pointerAndMouse(el, 'down', s);
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const m = Object.assign({}, s, { clientX: s.clientX + (dx * i) / steps, clientY: s.clientY + (dy * i) / steps });
        const target = document.elementFromPoint(m.clientX, m.clientY) || document;
        pointerAndMouse(target, 'move', m);
      }
      const e = Object.assign({}, s, { clientX: s.clientX + dx, clientY: s.clientY + dy, buttons: 0 });
      const target = document.elementFromPoint(e.clientX, e.clientY) || document;
      pointerAndMouse(target, 'up', e);
    },
    key(target, key, init) {
      target = target || document.activeElement || document.body;
      const codeMap = { ' ': 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace' };
      const kInit = Object.assign({
        key,
        code: codeMap[key] || (key.length === 1 ? (/[0-9]/.test(key) ? 'Digit' + key : 'Key' + key.toUpperCase()) : key)
      }, init);
      const down = fire(target, 'keydown', kInit, KeyboardEvent);
      fire(target, 'keyup', kInit, KeyboardEvent);
      return down;
    },
    type(el, text) {
      el.focus();
      for (const ch of text) {
        t.key(el, ch, { shiftKey: false });
        el.value = (el.value || '') + ch;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  async function run() {
    const results = [];
    for (const { name, fn } of tests) {
      const started = Date.now();
      try {
        await Promise.race([
          Promise.resolve().then(() => fn(t)),
          sleep(20000).then(() => { throw new Error('test zaman aşımı (20 sn)'); })
        ]);
        results.push({ name, ok: true, ms: Date.now() - started });
      } catch (e) {
        results.push({ name, ok: false, ms: Date.now() - started, error: String(e && e.message || e), stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join('\n') : '' });
      }
    }
    const passed = results.filter((r) => r.ok).length;
    const errors = (window.__pandaErrors || []).slice();
    const report = { passed, total: results.length, results, errors };
    let pre = document.getElementById('test-results');
    if (!pre) {
      pre = document.createElement('pre');
      pre.id = 'test-results';
      document.body.appendChild(pre);
    }
    pre.textContent = JSON.stringify(report);
    document.title = `TESTS ${passed}/${results.length} ${passed === results.length && !errors.length ? 'PASS' : 'FAIL'}`;
    window.__testReport = report;
    return report;
  }

  window.PandaTest = Object.assign(t, {
    test(name, fn) { tests.push({ name, fn }); },
    run
  });
})();
