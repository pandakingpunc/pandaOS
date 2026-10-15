/* SCRATCH — screenshot scenes for the terminal (deleted before finishing). */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const scene = P.params.get('scene') || 'start';

  T.test('sahne', async (t) => {
    const win = P.apps.launch('terminal', {});
    const term = win.state.terminal;
    win.setSize(820, 520);
    await term.run('ls');
    await term.run('echo merhaba dünya');
    await term.run('cat Belgeler/Notlar.txt | head -3');
    if (scene === 'ghost') {
      t.type(term.input, 'cat Belge');
    }
    if (scene === 'search') {
      t.key(term.input, 'r', { ctrlKey: true });
      t.type(term.input, 'echo');
    }
    if (scene === 'menu') {
      const r = term.screen.getBoundingClientRect();
      t.contextmenu(term.screen, { clientX: r.left + 300, clientY: r.top + 150 });
    }
    if (scene === 'sl') {
      term.run('sl');
      await t.sleep(900);
    }
    if (scene === 'complete') {
      t.type(term.input, 'ls B');
      t.key(term.input, 'Tab');
      t.key(term.input, 'Tab');
      t.type(term.input, 'e');
    }
    await t.sleep(100);
  });
})();
