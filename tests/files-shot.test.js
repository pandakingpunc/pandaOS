/* scratch scenes for screenshots of Dosyalar (deleted before the hand-in) */
(function () {
  'use strict';
  const P = window.PandaOS;
  const fs = P.fs;
  const T = window.PandaTest;
  const scene = P.params.get('shot') || 'details';
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
  const png = makePng(240, 160, '#2b6cb0', '#f6ad55');
  const png2 = makePng(120, 200, '#276749', '#9ae6b4');

  T.test('scene ' + scene, async (t) => {
    const D = '/home/panda/Belgeler';
    fs.writeFile(`${D}/Rapor 2026.txt`, 'x'.repeat(4200));
    fs.writeFile(`${D}/Bütçe.csv`, 'a,b\n1,2\n'.repeat(80));
    fs.writeFile(`${D}/gunluk.log`, 'z'.repeat(98000));
    fs.writeFile(`${D}/ayarlar.json`, '{"a":1}');
    fs.writeFile(`${D}/çok uzun bir dosya adı örneği ki iki satıra sığmayacak kadar uzun olsun.txt`, 'x');
    fs.writeFile(`${D}/manzara.png`, png);
    fs.writeFile(`${D}/.gizli`, 'x');
    fs.mkdir(`${D}/Fotoğraflar`);
    fs.mkdir(`${D}/Arşiv`);
    fs.writeFile(`${D}/Arşiv/eski.txt`, 'old');
    fs.writeFile('/home/panda/Resimler/manzara.png', png);
    fs.writeFile(`${D}/portre.png`, png2);
    fs.writeFile('/home/panda/Resimler/gunbatimi.png', png);

    if (scene === 'trash') {
      ['Rapor 2026.txt', 'Bütçe.csv', 'Arşiv', 'gunluk.log'].forEach((n) => fs.trash(`${D}/${n}`));
      const win = P.apps.launch('files', { path: 'trash:' });
      win.focus();
      const rows = [...win.body.querySelectorAll('.fm-item')];
      if (rows[1]) t.click(rows[1]);
      return;
    }
    window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);
    const win = P.apps.launch('files', { path: scene === 'home' ? '/home/panda' : D });
    win.focus();
    const fm = win.state.fm;
    const b = win.body;
    const items = () => [...b.querySelectorAll('.fm-item')];
    const by = (n) => items().find((i) => i.querySelector('.fm-nm').textContent === n);
    switch (scene) {
      case 'details': fm.setView('details'); t.click(by('Bütçe.csv')); t.click(by('gunluk.log'), { ctrlKey: true }); break;
      case 'medium': t.click(by('Fotoğraflar')); break;
      case 'large': fm.setView('large'); t.click(by('Rapor 2026.txt')); t.click(by('manzara.png'), { ctrlKey: true }); break;
      case 'home': break;
      case 'search': {
        const input = b.querySelector('.fm-search-input');
        t.type(input, 'ra');
        t.key(input, 'Enter');
        break;
      }
      case 'rename': t.click(by('Rapor 2026.txt')); t.key(win.el, 'F2'); break;
      case 'renamegrid': fm.setView('details'); fm.setView('medium'); t.click(by('Fotoğraflar')); t.key(win.el, 'F2'); break;
      case 'ctx': t.contextmenu(by('Rapor 2026.txt')); break;
      case 'ctxbg': t.contextmenu(b.querySelector('.fm-view')); break;
      case 'newmenu': t.click(b.querySelector('.fm-cmd[data-cmd="new"]')); break;
      case 'small': win.setSize(520, 340); fm.setView('details'); await t.sleep(80); fm.applyLayout(); t.click(by('Bütçe.csv')); break;
      case 'smallgrid': win.setSize(520, 340); await t.sleep(80); fm.applyLayout(); break;
      case 'maxi': win.maximize(); fm.setView('details'); await t.sleep(200); fm.applyLayout(); t.click(by('Bütçe.csv')); break;
      case 'drop': {
        const dt = new DataTransfer();
        const src = by('Rapor 2026.txt');
        t.click(src);
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        by('Fotoğraflar').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        break;
      }
      case 'desk': fm.go('/home/panda/Masaüstü'); fm.setView('large'); break;
      case 'root': fm.go('/'); fm.setView('details'); break;
      case 'kbd': fm.setView('details'); t.key(win.el, 'ArrowDown'); t.key(win.el, 'ArrowDown'); t.key(win.el, 'ArrowDown', { shiftKey: true }); t.key(win.el, 'ArrowDown', { shiftKey: true }); break;
      case 'kbdgrid': t.key(win.el, 'ArrowRight'); t.key(win.el, 'ArrowRight'); t.key(win.el, 'ArrowDown'); break;
      case 'addr': t.key(win.el, 'F4'); break;
      case 'band': {
        const view = b.querySelector('.fm-view');
        const r = view.getBoundingClientRect();
        t.mouse(view, 'mousedown', { clientX: r.left + 560, clientY: r.top + 330, button: 0, buttons: 1 });
        t.mouse(document.body, 'mousemove', { clientX: r.left + 100, clientY: r.top + 40, buttons: 1 });
        break;
      }
      case 'cut': t.click(by('Rapor 2026.txt')); t.key(win.el, 'x', { ctrlKey: true }); t.click(by('Arşiv')); break;
      case 'empty': fm.go('/home/panda/Resimler'); fm.go('/home/panda/İndirilenler'); break;
      default: break;
    }
  });
}());
