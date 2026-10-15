/* scratch: screenshot scenes for the music player (deleted before finishing) */
(function () {
  'use strict';
  const P = PandaOS;
  PandaTest.test('music shot', async (t) => {
    const scene = P.params.get('scene') || 'playing';
    const win = P.apps.launch('music', scene === 'invalid' ? {} : {});
    await t.waitFor(() => win.state.music);
    const app = win.state.music;
    const player = app.player;
    const clk = { t: 100, now() { return this.t; } };
    player.setClock(() => clk.now());
    const fakeSpec = () => {
      const eng = player.engine;
      if (!eng) return;
      let tt = 0;
      eng.spectrum = () => {
        tt += 0.35;
        const a = new Uint8Array(512);
        for (let i = 0; i < 512; i++) {
          const f = i / 512;
          const base = 230 * Math.pow(1 - f, 1.6) * (0.55 + 0.45 * Math.sin(tt + i * 0.21)) * (0.7 + 0.3 * Math.sin(tt * 0.7 + i * 0.05));
          a[i] = Math.max(0, Math.min(255, base + 18 * Math.sin(i * 0.9 + tt)));
        }
        return a;
      };
      eng.waveform = () => {
        tt += 0.2;
        return Uint8Array.from({ length: 1024 }, (_, i) => 128 + Math.round(70 * Math.sin(i / 11 + tt) * Math.sin(i / 97) + 25 * Math.sin(i / 3.1)));
      };
    };
    const advance = async (sec) => { for (let i = 0; i < sec * 10; i++) { clk.t += 0.1; await t.sleep(10); } };
    if (scene === 'stopped') return;
    if (scene === 'search') {
      const s = t.$('.mu-search-input', win.el);
      s.value = 'xyz'; s.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (scene === 'empty') {
      for (const f of P.fs.list('/home/panda/Müzik')) P.fs.remove(f.path);
      await t.sleep(400);
      return;
    }
    player.play(player.queue()[0]);
    fakeSpec();
    await advance(scene === 'light' ? 31 : 38);
    if (scene === 'wave') { app.toggleViz(); }
    if (scene === 'small' || scene === 'smalllib') {
      win.setSize(520, 420);
      await t.sleep(300);
      if (scene === 'smalllib') t.click(t.$('.mu-lib-toggle', win.el));
    }
    if (scene === 'max') { win.maximize(); await t.sleep(300); }
    if (scene === 'mid') { win.setSize(700, 500); await t.sleep(300); }
    if (scene === 'paused') player.pause();
    if (scene === 'menu') {
      const row = t.$$('.mu-row', win.el)[3];
      t.contextmenu(row);
    }
    if (scene === 'invalid') {
      P.fs.writeFile('/home/panda/Müzik/Bozuk.pmus', '{bozuk');
      P.apps.launch('music', { path: '/home/panda/Müzik/Bozuk.pmus' });
      await t.sleep(300);
    }
    if (scene === 'hover') {
      const row = t.$$('.mu-row', win.el)[2];
      t.mouse(row, 'mouseover');
    }
    await t.sleep(900);
  });
})();
