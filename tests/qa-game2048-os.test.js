/* QA scratch suite (to be deleted): OS integration of 2048 */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const api = (w) => w.state.api;
  const log = (...a) => console.error('[qa]', ...a);

  async function open() {
    P.storage.remove('app.game2048');
    const w = P.apps.launch('game2048');
    await T.sleep(50);
    return w;
  }

  T.test('desktop shortcut + single instance + minimized relaunch', async (t) => {
    const w = await open();
    t.ok(w, 'window');
    const w2 = P.apps.openFile('/home/panda/Masaüstü/2048.app');
    t.ok(w2 === w, 'shortcut focuses same window');
    t.eq(P.apps.running('game2048').length, 1, 'one window');
    w.minimize();
    await t.sleep(100);
    t.ok(w.isMinimized(), 'minimized');
    P.apps.launch('game2048');
    await t.sleep(150);
    t.ok(!w.isMinimized(), 'launch restores minimized single instance');
    t.ok(w.isFocused(), 'focused');
    // key after restore
    const before = api(w).state().moves;
    const ev = t.key(document.activeElement, 'ArrowLeft');
    await t.sleep(50);
    log('focus after restore', document.activeElement && document.activeElement.className, 'moves', before, '->', api(w).state().moves);
    await w.close();
  });

  T.test('keys do not reach the game while the session is locked', async (t) => {
    const w = await open();
    api(w).setBoard([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const p = P.session.lock();
    await t.sleep(200);
    t.key(document.body, 'ArrowLeft');
    await t.sleep(50);
    log('locked: moves', api(w).state().moves);
    t.eq(api(w).state().moves, 0, 'no move while locked');
    P.session.unlock();
    await t.sleep(300);
    await w.close();
  });

  T.test('keys do not reach the game when another window has focus', async (t) => {
    const w = await open();
    const n = P.apps.launch('notepad');
    await t.sleep(200);
    const ta = $('textarea', n.body);
    if (ta) ta.focus();
    t.key(document.activeElement, 'a');
    t.key(document.activeElement, 'ArrowLeft');
    await t.sleep(50);
    t.eq(api(w).state().moves, 0, 'game window not moved by keys typed in notepad');
    await n.close();
    await w.close();
  });

  T.test('live theme switch recolours board; tile colours stay', async (t) => {
    const w = await open();
    P.theme.set('dark');
    await t.sleep(50);
    const cd = getComputedStyle($('.g48-board', w.body)).backgroundColor;
    const bd = getComputedStyle($('.g48-root', w.body).parentElement).backgroundColor;
    P.theme.set('light');
    await t.sleep(50);
    const cl = getComputedStyle($('.g48-board', w.body)).backgroundColor;
    const bl = getComputedStyle($('.g48-root', w.body).parentElement).backgroundColor;
    log('board dark/light', cd, cl, ' app bg dark/light', bd, bl);
    t.ok(cd !== cl, 'board colour differs');
    P.theme.set('dark');
    await w.close();
  });

  T.test('animations setting off: still consistent', async (t) => {
    const w = await open();
    P.settings.set('animations', false);
    await t.sleep(50);
    api(w).setBoard([[2, 2, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    t.key(w.el, 'ArrowLeft');
    await t.sleep(30);
    const s = api(w).state();
    const d = api(w).domGrid();
    t.eq(d.grid, s.grid, 'synced');
    await t.sleep(500);
    t.ok(!$('.g48-board', w.body).classList.contains('moving'), 'moving removed');
    P.settings.set('animations', true);
    await w.close();
  });

  T.test('sizes: board inside body, header fits, no scroll', async (t) => {
    const w = await open();
    api(w).setBoard([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2, 4], [8, 16, 32, 0]], { score: 9999999, best: 12345678, moves: 12345 });
    const sizes = [[360, 520], [361, 521], [380, 600], [460, 640], [520, 520], [700, 520], [900, 560], [520, 900], [1100, 800]];
    for (const [W, H] of sizes) {
      w.setSize(W, H);
      await t.sleep(60);
      const body = w.body.getBoundingClientRect();
      const col = $('.g48-col', w.body).getBoundingClientRect();
      const board = $('.g48-board', w.body).getBoundingClientRect();
      const hdr = $('.g48-header', w.body);
      const hr = hdr.getBoundingClientRect();
      const sc = $('.g48-scores', w.body).getBoundingClientRect();
      const title = $('.g48-title', w.body).getBoundingClientRect();
      const root = $('.g48-root', w.body);
      const rr = root.getBoundingClientRect();
      const msgs = [];
      if (board.left < body.left - 0.5 || board.right > body.right + 0.5 || board.top < body.top - 0.5 || board.bottom > body.bottom + 0.5) msgs.push('board outside body');
      if (sc.right > hr.right + 0.5) msgs.push('scores overflow header by ' + (sc.right - hr.right).toFixed(1));
      if (sc.left < title.right - 0.5) msgs.push('scores overlap title by ' + (title.right - sc.left).toFixed(1));
      if (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1) msgs.push('root scrolls ' + root.scrollWidth + 'x' + root.scrollHeight + ' vs ' + root.clientWidth + 'x' + root.clientHeight);
      log(`size ${W}x${H}: body ${body.width.toFixed(0)}x${body.height.toFixed(0)} board ${board.width.toFixed(0)} col ${col.width.toFixed(0)} hdr ${hr.width.toFixed(0)} ${msgs.join('; ') || 'ok'}`);
    }
    await w.close();
  });

  T.test('keys: capital, caps lock, non-latin layout via code', async (t) => {
    const w = await open();
    const setup = () => api(w).setBoard([[0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    setup();
    t.key(w.el, 'A');
    await t.sleep(30);
    t.eq(api(w).state().moves, 1, 'A moves');
    setup();
    // Cyrillic layout: key 'ф' code KeyA
    const ev = new KeyboardEvent('keydown', { key: 'ф', code: 'KeyA', bubbles: true, cancelable: true });
    w.el.dispatchEvent(ev);
    await t.sleep(30);
    log('cyrillic ф/KeyA moves', api(w).state().moves, 'prevented', ev.defaultPrevented);
    // Ctrl+Z on non-latin layout
    const ev2 = new KeyboardEvent('keydown', { key: 'я', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    w.el.dispatchEvent(ev2);
    await t.sleep(30);
    log('cyrillic ctrl+я/KeyZ undo -> moves', api(w).state().moves);
    // numpad / Shift+Arrow
    setup();
    t.key(w.el, 'ArrowLeft', { shiftKey: true });
    await t.sleep(30);
    log('shift+arrow moves', api(w).state().moves);
    // repeated keydown (held key)
    setup();
    const ev3 = new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', repeat: true, bubbles: true, cancelable: true });
    w.el.dispatchEvent(ev3);
    log('repeat keydown prevented', ev3.defaultPrevented);
    await w.close();
  });
})();
