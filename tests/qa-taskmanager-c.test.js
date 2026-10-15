/* QA scratch probes C for taskmanager (deleted at the end) */
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

  T.test('C1 Delete on dirty notepad', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    const np = P.apps.launch('notepad');
    await sleep(200);
    const ta = np.body.querySelector('textarea');
    ta.focus();
    ta.value = 'x'; ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await sleep(50);
    log('np.dirty', np.dirty);
    tm.tick(1);
    const g = tm.grid('processes');
    t.click(row(t, tmw.el, 'app:notepad'));
    log('selected', g.selected, 'activeElement', document.activeElement && document.activeElement.className);
    const ev = t.key(g.el, 'Delete');
    log('default prevented', ev.defaultPrevented);
    await sleep(300);
    log('dialog open after Delete', P.dialog.isOpen(), 'np closed', np.isClosed());
    clean();
  });

  T.test('C2 Delete via focused grid for non-dirty window', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    const c = P.apps.launch('calculator');
    await sleep(100);
    tm.tick(1);
    const g = tm.grid('processes');
    t.click(row(t, tmw.el, 'app:calculator'));
    g.el.focus();
    t.key(g.el, 'Delete');
    await sleep(200);
    log('calc closed after Delete', c.isClosed(), 'selected after', g.selected);
    log('focused element after kill', document.activeElement && (document.activeElement.className || document.activeElement.tagName), 'focused win', P.wm.getFocused() && P.wm.getFocused().appId);
    clean();
  });

  T.test('zz report', () => { throw new Error('\n' + LOG.join('\n')); });
})();
