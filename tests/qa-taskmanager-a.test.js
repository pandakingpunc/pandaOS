/* QA scratch probes for taskmanager (deleted at the end) */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LOG = [];
  const log = (...a) => LOG.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

  function clean() {
    try { P.contextMenu.hide(); } catch (e) { /* */ }
    try { if (P.dialog.closeAll) P.dialog.closeAll(); } catch (e) { /* */ }
    P.wm.list().forEach((w) => w.forceClose());
    P.storage.remove('app.taskmanager');
  }
  const row = (t, root, key) => t.$(`.tm-row[data-key="${key}"]`, root);
  const cells = (r) => [...r.querySelectorAll('.tm-c')].map((c) => c.textContent.trim());

  T.test('A1 music heuristic against the real music app', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    const mw = P.apps.launch('music');
    await sleep(300);
    const prof = () => { tm.tick(1); const M = tm.model.wins.get(mw.id); return M ? { cpu: +M.cpu.toFixed(2), disk: +M.disk.toFixed(2) } : null; };
    const settle = async (n) => { for (let i = 0; i < n; i++) { tm.tick(1); await sleep(30); } };
    await settle(25);
    const idle = prof();
    const btn = [...mw.body.querySelectorAll('button')].filter((b) => /Oynat|Çal|play/i.test(b.getAttribute('aria-label') || '') );
    log('music buttons', btn.map((b) => b.getAttribute('aria-label')));
    log('music state before', Object.keys(mw.state), mw.state.music && mw.state.music.player && mw.state.music.player.state);
    if (btn[0]) t.click(btn[0]); else log('NO PLAY BUTTON');
    await sleep(500);
    log('music state after click', mw.state.music && mw.state.music.player && mw.state.music.player.state);
    await settle(25);
    const playing = prof();
    log('music profile idle', idle, 'playing', playing, 'detected', 'aria Duraklat', !!mw.body.querySelector('[aria-label="Duraklat"]'));
    const pause = [...mw.body.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Duraklat');
    if (pause) t.click(pause);
    await sleep(300);
    await settle(25);
    log('music after pause', prof(), mw.state.music && mw.state.music.player && mw.state.music.player.state);
    // paint comparison
    const pw = P.apps.launch('paint');
    await sleep(200);
    await settle(25);
    const pM = tm.model.wins.get(pw.id);
    log('paint idle', { cpu: +pM.cpu.toFixed(2), mem: +pM.mem.toFixed(1) });
    clean();
  });

  T.test('A2 dirty notepad kill confirm', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    const np = P.apps.launch('notepad');
    await sleep(300);
    const ta = np.body.querySelector('textarea');
    log('notepad textarea', !!ta, 'dirty before', np.dirty);
    if (ta) { ta.focus(); ta.value = 'yazı'; ta.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    await sleep(100);
    log('dirty after typing', np.dirty, 'beforeClose', typeof np.beforeClose);
    tm.tick(2);
    const r = row(t, tmw.el, 'app:notepad');
    t.click(r);
    t.click(t.$('.tm-btn-end', tmw.el));
    await sleep(300);
    log('dialog open after end task', P.dialog.isOpen(), t.$('#dialog-layer .dlg-message, #dialog-layer .dlg-body') && t.$('#dialog-layer .dlg-message, #dialog-layer .dlg-body').textContent);
    log('notepad closed?', np.isClosed());
    if (P.dialog.isOpen()) {
      const cancel = t.$('#dialog-layer .dlg-secondary, #dialog-layer .dlg-cancel');
      log('cancel btn', !!cancel);
      if (cancel) t.click(cancel);
      await sleep(200);
      log('after cancel closed?', np.isClosed(), 'dialog', P.dialog.isOpen());
    }
    clean();
  });

  T.test('A3 self-kill', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    tm.tick(1);
    t.click(row(t, tmw.el, 'app:taskmanager'));
    log('end btn disabled?', t.$('.tm-btn-end', tmw.el).disabled);
    t.click(t.$('.tm-btn-end', tmw.el));
    await sleep(500);
    log('closed?', tmw.isClosed(), 'timer', tm.timerActive(), 'raf', tm.rafActive(), 'destroyed', tm.destroyed());
    log('wm list', P.wm.list().map((w) => w.appId));
    log('stored', P.storage.get('app.taskmanager'));
    clean();
  });

  T.test('A4 dpr 2 canvas', async (t) => {
    clean();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 2 });
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    tm.go('performance');
    tm.tick(2);
    const cv = t.$('.tm-chart', tmw.el);
    log('dpr2 chart', cv.width, cv.clientWidth, cv.height, cv.clientHeight);
    const sp = t.$('.tm-spark', tmw.el);
    log('dpr2 spark', sp.width, sp.clientWidth, sp.height, sp.clientHeight);
    delete window.devicePixelRatio;
    clean();
  });

  T.test('A5 text sanity on all pages (NaN/undefined)', async (t) => {
    clean();
    for (const id of ['files', 'notepad', 'notepad', 'terminal', 'calculator', 'paint', 'clock', 'settings', 'music', 'minesweeper', 'game2048']) P.apps.launch(id);
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    await sleep(300);
    const bad = [];
    for (const p of ['processes', 'performance', 'history', 'details']) {
      tm.go(p);
      for (const res of (p === 'performance' ? ['cpu', 'mem', 'disk', 'net'] : [null])) {
        if (res) t.click(t.$(`.tm-res[data-res="${res}"]`, tmw.el));
        for (let i = 0; i < 3; i++) { tm.tick(1); await sleep(20); }
        const txt = tmw.el.innerText;
        if (/NaN|undefined|Infinity|\[object/.test(txt)) bad.push(p + '/' + res + ': ' + (txt.match(/.{0,30}(NaN|undefined|Infinity|\[object).{0,30}/) || [''])[0]);
      }
    }
    log('bad text', bad);
    // render cost with 15 windows
    tm.go('processes');
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) tm.tick(1);
    log('processes tick avg ms', ((performance.now() - t0) / 50).toFixed(2));
    tm.go('performance');
    const t1 = performance.now();
    for (let i = 0; i < 50; i++) tm.tick(1);
    log('performance tick avg ms', ((performance.now() - t1) / 50).toFixed(2));
    tm.go('details');
    const t2 = performance.now();
    for (let i = 0; i < 50; i++) tm.tick(1);
    log('details tick avg ms', ((performance.now() - t2) / 50).toFixed(2));
    clean();
  });

  T.test('A6 history tracker', async (t) => {
    clean();
    const a = P.apps.launch('calculator');
    await sleep(1100);
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    tm.go('history');
    tm.tick(1);
    const grid = tm.grid('history');
    log('history rows', grid.items.map((i) => [i.id, i.launches, Math.round(i.total / 100) / 10, i.count]));
    a.forceClose();
    P.apps.launch('calculator');
    P.apps.launch('calculator');
    await sleep(50);
    tm.tick(1);
    log('history after 2 launches', grid.items.map((i) => [i.id, i.launches, Math.round(i.total / 100) / 10, i.count]));
    // wm.open directly
    const w = P.wm.open({ appId: 'zzz', title: 'zzz' });
    tm.tick(1);
    log('direct wm.open present in history', grid.items.some((i) => i.id === 'zzz'));
    w.forceClose();
    clean();
  });

  T.test('A7 details sizes maximized/snapped', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager', { page: 'details' });
    const tm = tmw.state.tm;
    const f = P.apps.launch('files');
    f.maximize();
    const n = P.apps.launch('notepad');
    n.snap('left');
    await sleep(100);
    tm.tick(1);
    log('details rows', tm.grid('details').items.map((i) => [i.name, i.size, i.pos, i.status]));
    clean();
  });

  T.test('A8 rapid open/close timers', async (t) => {
    clean();
    let live = 0; let total = 0;
    const oi = window.setInterval; const oc = window.clearInterval;
    const ids = new Set();
    window.setInterval = function (...a) { const id = oi.apply(window, a); if (/taskmanager\.js/.test(new Error().stack)) { ids.add(id); total++; } return id; };
    window.clearInterval = function (id) { ids.delete(id); return oc.call(window, id); };
    for (let i = 0; i < 15; i++) { const w = P.apps.launch('taskmanager'); w.state.tm.go(['processes', 'performance', 'history', 'details'][i % 4]); await sleep(15); if (i % 2) w.forceClose(); else await w.close(); }
    window.setInterval = oi; window.clearInterval = oc;
    log('intervals created', total, 'still live', ids.size);
    clean();
  });

  T.test('zz report', () => {
    throw new Error('\n' + LOG.join('\n'));
  });
})();
