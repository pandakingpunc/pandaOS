/* QA scratch probes B for taskmanager (deleted at the end) */
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

  T.test('B1 shutdown + power on resets session history?', async (t) => {
    clean();
    P.apps.launch('calculator');
    P.apps.launch('notepad');
    await sleep(1200);
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    tm.go('history');
    tm.tick(1);
    log('before shutdown rows', tm.grid('history').items.map((i) => [i.id, i.launches]), 'uptime ms', Math.round(tm.tracker.uptime()));
    tmw.forceClose();
    await P.session.shutdown();
    await sleep(2500);
    const pw = t.$('.boot-power');
    log('power btn', !!pw);
    if (pw) t.click(pw);
    await sleep(4500);
    log('session locked?', P.session.isLocked && P.session.isLocked());
    const w2 = P.apps.launch('taskmanager', { page: 'history' });
    const tm2 = w2.state.tm;
    tm2.tick(1);
    log('after power-on rows', tm2.grid('history').items.map((i) => [i.id, i.launches]), 'uptime ms', Math.round(tm2.tracker.uptime()));
    clean();
  });

  T.test('B2 context menu + keyboard on multi-window group', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    const c1 = P.apps.launch('calculator');
    const c2 = P.apps.launch('calculator');
    await sleep(200);
    tm.tick(1);
    const r = row(t, tmw.el, 'app:calculator');
    t.contextmenu(r);
    await sleep(100);
    const items = t.$$('#context-menu-layer .ctx-item').map((i) => i.textContent.trim() + (i.classList.contains('disabled') ? '[x]' : ''));
    log('group menu', items);
    // focus a menu item "Ekranı kapla"
    const mx = t.$$('#context-menu-layer .ctx-item').find((i) => /Ekranı kapla/.test(i.textContent));
    if (mx) t.click(mx);
    await sleep(100);
    log('maximized states', c1.isMaximized(), c2.isMaximized());
    tm.tick(1);
    t.contextmenu(row(t, tmw.el, 'app:calculator'));
    await sleep(50);
    log('group menu after max', t.$$('#context-menu-layer .ctx-item').map((i) => i.textContent.trim() + (i.classList.contains('disabled') ? '[x]' : '')));
    P.contextMenu.hide();
    clean();
  });

  T.test('B3 minimize menu on minimized & restore', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    const c1 = P.apps.launch('calculator');
    await sleep(100);
    tm.tick(1);
    t.contextmenu(row(t, tmw.el, 'app:calculator'));
    const mi = t.$$('#context-menu-layer .ctx-item').find((i) => /Simge durumuna/.test(i.textContent));
    t.click(mi);
    await sleep(100);
    log('calc minimized', c1.isMinimized(), 'tm focused', tmw.isFocused(), 'focused', P.wm.getFocused() && P.wm.getFocused().appId);
    tm.tick(1);
    log('row text', row(t, tmw.el, 'app:calculator').textContent.replace(/\s+/g, ' '));
    // double click on minimized row restores it
    t.dblclick(row(t, tmw.el, 'app:calculator'));
    await sleep(100);
    log('after dblclick minimized', c1.isMinimized(), 'focused', P.wm.getFocused() && P.wm.getFocused().appId);
    clean();
  });

  T.test('B4 dialog interplay: killing a window whose confirm dialog is open', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    const np = P.apps.launch('notepad');
    await sleep(200);
    const ta = np.body.querySelector('textarea');
    ta.value = 'x'; ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await sleep(50);
    tm.tick(1);
    t.click(row(t, tmw.el, 'app:notepad'));
    t.key(tm.grid('processes').el, 'Delete');
    await sleep(200);
    log('dialog open after Delete', P.dialog.isOpen());
    // confirm via primary
    const ok = t.$('#dialog-layer .dlg-primary');
    if (ok) t.click(ok);
    await sleep(300);
    log('notepad closed after confirm', np.isClosed(), 'any extra dialog (notepad save prompt)?', P.dialog.isOpen());
    clean();
  });

  T.test('B5 search + sort + selection edge cases', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    P.apps.launch('calculator'); P.apps.launch('notepad'); P.apps.launch('files');
    await sleep(100);
    tm.tick(1);
    // select calculator, then filter so it disappears; button must disable
    t.click(row(t, tmw.el, 'app:calculator'));
    log('end btn enabled after select', !t.$('.tm-btn-end', tmw.el).disabled);
    const input = t.$('.tm-page-processes .tm-search-input', tmw.el);
    t.type(input, 'not');
    await sleep(50);
    log('rows filtered', t.$$('.tm-page-processes .tm-row', tmw.el).map((r) => r.dataset.key));
    log('end btn after filter hides selection', t.$('.tm-btn-end', tmw.el).disabled, 'grid.selected', tm.grid('processes').selected);
    // search is shared across pages
    tm.go('details');
    log('details query value', t.$('.tm-page-details .tm-search-input', tmw.el).value, 'rows', t.$$('.tm-page-details .tm-row', tmw.el).length);
    // search for window title text on system rows
    tm.go('processes');
    t.type(input, 'xyz');
    await sleep(50);
    log('empty state', t.$('.tm-page-processes .tm-empty', tmw.el).hidden, t.$('.tm-page-processes .tm-empty', tmw.el).textContent);
    clean();
  });

  T.test('B6 many windows rendering and scroll/selection reveal', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager');
    const tm = tmw.state.tm;
    for (let i = 0; i < 40; i++) P.apps.launch(i % 3 ? 'calculator' : 'notepad');
    await sleep(100);
    tm.tick(2);
    const g = tm.grid('processes');
    g.el.focus();
    t.key(g.el, 'End');
    log('selected after End', g.selected, 'scrollTop', g.el.scrollTop, 'clientH', g.el.clientHeight, 'scrollH', g.el.scrollHeight);
    t.key(g.el, 'Home');
    log('selected after Home', g.selected, 'scrollTop', g.el.scrollTop);
    clean();
  });

  T.test('B7 theme change and accent', async (t) => {
    clean();
    const tmw = P.apps.launch('taskmanager', { page: 'performance' });
    const tm = tmw.state.tm;
    tm.tick(2);
    const rgbAt = (cv) => { const d = cv.getContext('2d').getImageData(cv.width / 2, 0, 1, cv.height).data; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) return [d[i], d[i + 1], d[i + 2]]; return null; };
    const cv = t.$('.tm-chart', tmw.el);
    const before = rgbAt(cv);
    P.settings.set('accent', '#d4e600');
    await sleep(100);
    const after = rgbAt(cv);
    log('chart colour before/after accent', before, after);
    P.settings.set('accent', '#2f9e6b');
    P.settings.set('theme', 'light');
    await sleep(100);
    log('light grid alpha check ok');
    P.settings.set('theme', 'dark');
    clean();
  });

  T.test('zz report', () => {
    throw new Error('\n' + LOG.join('\n'));
  });
})();
