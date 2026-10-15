/* QA scratch scenes for screenshots of Ayarlar (deleted at the end) */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const q = (k, d) => P.params.get(k) || d;
  const page = q('qpage', 'appearance');
  const size = q('qsize', 'default');
  const scene = q('qscene', '');

  function makePng(w, h, c1, c2) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(w * 0.7, h * 0.3, h * 0.14, 0, 7); g.fill();
    return c.toDataURL('image/png');
  }

  T.test('qa scene ' + page + ' ' + size + ' ' + scene, async (t) => {
    window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);
    const D = '/home/panda/Belgeler';
    if (scene === 'data' || scene === 'trash' || scene === 'full') {
      P.fs.writeFile(`${D}/a.txt`, 'x'.repeat(40000));
      P.fs.writeFile(`${D}/b.txt`, 'x'.repeat(9000));
      P.fs.writeFile('/home/panda/Resimler/manzara.png', makePng(400, 260, '#2b6cb0', '#f6ad55'));
      P.fs.writeFile('/home/panda/Müzik/s.txt', 'x'.repeat(3000));
      P.fs.writeFile('/home/panda/İndirilenler/dl.bin', 'x'.repeat(20000));
    }
    if (scene === 'trash') {
      P.fs.trash(`${D}/a.txt`);
      P.fs.trash(`${D}/b.txt`);
    }
    if (scene === 'full') {
      let i = 0;
      try { for (;;) { P.fs.writeFile(`${D}/f${i++}.txt`, 'x'.repeat(200000)); } } catch (e) { /* quota */ }
    }
    if (scene === 'notifs') {
      P.settings.set('dnd', true);
      for (let i = 0; i < 7; i++) P.notify({ title: 'Bildirim ' + i, message: 'Bu bir deneme bildirimidir ' + i, timeout: 1 });
      P.settings.set('dnd', false);
    }
    if (scene === 'muted') { P.settings.set('muted', true); P.settings.set('volume', 35); }
    if (scene === 'accent') { P.settings.set('accent', '#ff00aa'); }
    if (scene === 'lime') { P.settings.set('accent', '#d4e600'); }
    if (scene === 'wpcustom') {
      P.fs.writeFile('/home/panda/Resimler/manzara.png', makePng(400, 260, '#2b6cb0', '#f6ad55'));
      P.fs.writeFile('/home/panda/Resimler/uzun-ad-ile-bir-resim-dosyasi-ornegi.png', makePng(400, 260, '#276749', '#9ae6b4'));
      P.settings.set('wallpaper', 'vfs:/home/panda/Resimler/manzara.png');
    }
    if (scene === 'wpmissing') {
      P.settings.set('wallpaper', 'vfs:/home/panda/Resimler/yok.png');
    }
    if (scene === 'ampm') { P.settings.set('clock24h', false); P.settings.set('showSeconds', true); }
    if (scene === 'iconlarge') { P.settings.set('desktop.iconSize', 'large'); }

    const win = P.apps.launch('settings', { page });
    win.focus();
    if (size === 'min') win.setSize(640, 440);
    if (size === 'max') win.maximize();
    await t.sleep(250);
    if (scene === 'search') { win.state.settings.search(q('qquery', 'ses')); await t.sleep(100); }
    if (scene === 'searchnone') { win.state.settings.search('zzzq'); await t.sleep(100); }
    if (scene === 'hover') { /* nothing */ }
    if (scene === 'confirmtrash' || scene === 'confirmreset') {
      const btn = win.body.querySelector(scene === 'confirmtrash' ? '[data-sid="trash"] button' : '[data-sid="reset"] button');
      t.click(btn);
      await t.sleep(200);
    }
    window.__qaWin = win;
  });
})();
