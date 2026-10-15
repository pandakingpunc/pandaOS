/* Not Defteri tests: registration, window, menus, files, save sheet, find/replace, go to line, zoom/prefs,
   markdown preview, external changes, drag & drop, cleanup, plus seeded random walks that check the editor's
   invariants (title / dirty flag / status bar / find highlights / preview) after every step
   (more walks: bash tools/test.sh notepad "npseeds=3,4,5&npsteps=150" with a larger BUDGET).
   Screenshot scenes: bash tools/shot.sh out.png "fast=1&test=notepad&shot=<name>&theme=dark|light"
   with <name> in: text, menu, menuview, find, findnone, replace, sheet, markdown, mdstack, small, smallfind, smallsheet, smallnotice,
   notice, nowrap, zoom, max (the normal tests are skipped when shot= is given). */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T = window.PandaTest;
  const fs = P.fs;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const DOCS = '/home/panda/Belgeler';

  // ------------------------------------------------------------------ helpers
  const ctxItems = () => $$('#context-menu-layer .ctx-menu .ctx-item');
  const ctxLabel = (it) => $('.ctx-label', it).textContent;
  const ctxLabels = () => ctxItems().map(ctxLabel);
  const ctxItem = (label) => ctxItems().find((i) => ctxLabel(i) === label);
  const menuBtn = (w, id) => $(`.np-menu-btn[data-menu="${id}"]`, w.body);
  const ed = (w) => $('.np-editor', w.body);
  const q = (w, sel) => $(sel, w.body);
  const st = (w) => ({
    pos: q(w, '.np-st-pos').textContent,
    chars: q(w, '.np-st-chars').textContent,
    zoom: q(w, '.np-st-zoom').textContent,
    enc: q(w, '.np-st-enc').textContent
  });
  const title = (w) => $('.wm-title', w.el).textContent;
  const nowin = () => P.wm.list().filter((w) => w.appId === 'notepad');

  async function open(args) {
    const w = P.apps.launch('notepad', args || {});
    if (!w) throw new Error('Not Defteri açılamadı');
    w.focus();
    await T.sleep(10);
    return w;
  }

  function cleanup() {
    try { P.dialog.closeAll(); } catch (e) { /* ignore */ }
    try { P.contextMenu.hide(); } catch (e) { /* ignore */ }
    nowin().forEach((w) => w.forceClose());
    P.storage.remove('app.notepad');
  }

  /** Runs `fn(win)` with a fresh window and always cleans up afterwards. */
  function scene(name, args, fn) {
    T.test(name, async (t) => {
      cleanup();
      const w = await open(typeof args === 'function' ? {} : args);
      try {
        await (typeof args === 'function' ? args : fn)(t, w);
      } finally {
        cleanup();
      }
    });
  }

  function setText(w, text, caret) {
    const e = ed(w);
    e.value = text;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    const c = caret == null ? text.length : caret;
    e.setSelectionRange(c, c);
    e.dispatchEvent(new Event('select', { bubbles: true }));
  }

  function select(w, a, b) {
    const e = ed(w);
    e.setSelectionRange(a, b);
    e.dispatchEvent(new Event('select', { bubbles: true }));
  }

  const key = (w, k, init) => T.key(ed(w), k, init);
  const ctrl = (w, k, init) => T.key(ed(w), k, Object.assign({ ctrlKey: true }, init));

  async function clickMenu(t, w, id, label) {
    t.click(menuBtn(w, id));
    await t.waitFor(() => ctxItems().length, 1000, 'menü açılmadı');
    if (label) {
      const it = ctxItem(label);
      t.ok(it, `"${label}" menü öğesi yok: ${ctxLabels().join(' | ')}`);
      t.click(it);
    }
  }

  const topCard = () => { const c = $$('#dialog-layer .dlg-card'); return c[c.length - 1]; };
  const picker = () => $('#dialog-layer .dlg-card.fp');

  async function pickerSave(t, name, overwrite) {
    const card = await t.waitFor(picker, 2000, 'kaydet penceresi açılmadı');
    const input = $('.fp-name-input', card);
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.click($('.dlg-primary', card));
    if (overwrite) {
      await t.waitFor(() => $$('#dialog-layer .dlg-card').length > 1, 1000, 'üzerine yazma onayı yok');
      t.click($('.dlg-primary', topCard()));
    }
    await t.waitFor(() => !picker(), 2000, 'kaydet penceresi kapanmadı');
    await t.sleep(30);
  }

  const sheet = (w) => $('.np-sheet', w.body);
  const sheetBtn = (w, choice) => $(`.np-sheet [data-choice="${choice}"]`, w.body);

  function mk(path, content) {
    fs.writeFile(path, content);
    return path;
  }

  // ------------------------------------------------------------------ screenshot scenes
  const shot = P.params.get('shot');
  if (shot) {
    T.test('ekran görüntüsü: ' + shot, async (t) => {
      cleanup();
      // headless frames never advance: show menus / dialogs in their final state
      const style = document.createElement('style');
      style.textContent = '#context-menu-layer *, #dialog-layer *, #toasts * { animation: none !important; transition: none !important; }';
      document.head.appendChild(style);
      // the headless screenshot step resizes the viewport right before capturing, which closes menus: hide that resize from the OS
      window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);
      const long = 'Notlar\n======\n\nBugün yapılacaklar\n  [x] PandaOS\'a giriş yap\n  [x] Masaüstünü gez\n  [ ] Terminalde "help" yaz\n\n' +
        'Panda hakkında bir iki cümle: Dev pandalar günde on iki saate kadar bambu yer. Bambu yaprağı da, sapı da lezzetlidir; ' +
        'ama en çok körpe sürgünleri severler.\n\n\tgirintili satır\n\nFikirler\n  - Masaüstüne yeni bir duvar kâğıdı seç\n  - Çizim ile bir panda çiz\n';
      const md = '# PandaOS Fikirleri\n\nBu bir **Markdown** belgesi: *eğik*, `kod` ve [bağlantı](https://example.com).\n\n## Yapılacaklar\n\n- [x] Not Defteri\n- [ ] Takvim\n  - alt madde\n  - bir tane daha\n\n1. Birinci\n2. İkinci\n\n> Alıntı satırı: bambu sessizce büyür.\n\n```js\nconst panda = "bambu";\nconsole.log(panda);\n```\n\n| Ad | Değer |\n|----|------:|\n| Panda | 1 |\n| Bambu | 12 |\n';
      let w;
      if (shot === 'markdown') {
        mk(DOCS + '/PandaOS Fikirleri.md', md);
        P.storage.set('app.notepad', { preview: true });
        w = await open({ path: DOCS + '/PandaOS Fikirleri.md' });
        w.setSize(900, 580);
      } else if (shot === 'small') {
        w = await open({ path: DOCS + '/Notlar.txt' });
        w.setSize(380, 260);
      } else if (shot === 'smallfind' || shot === 'smallsheet' || shot === 'smallnotice') {
        w = await open({ path: DOCS + '/Notlar.txt' });
        w.setSize(380, 260);
        if (shot === 'smallfind') {
          ctrl(w, 'h');
          T.type(q(w, '.np-find-input'), 'bir');
          T.type(q(w, '.np-replace-input'), 'iki');
        } else if (shot === 'smallsheet') {
          setText(w, 'değişti');
          w.close();
        } else {
          setText(w, 'değişti');
          fs.writeFile(DOCS + '/Notlar.txt', fs.readFile(DOCS + '/Notlar.txt') + ' ');
        }
      } else if (shot === 'nowrap' || shot === 'zoom') {
        w = await open();
        const wide = Array.from({ length: 30 }, (_, i) => 'Satır ' + (i + 1) + ': ' + 'bambu '.repeat(i % 5 === 0 ? 24 : 6)).join('\n');
        setText(w, wide, 0);
        if (shot === 'nowrap') {
          t.click(menuBtn(w, 'view'));
          await T.sleep(10);
          t.click(ctxItem('Sözcük kaydırma'));
          ctrl(w, 'f');
          T.type(q(w, '.np-find-input'), 'bambu');
          T.key(q(w, '.np-find-input'), 'Enter');
          T.key(q(w, '.np-find-input'), 'Enter');
        } else {
          for (let i = 0; i < 10; i++) ctrl(w, '+');
          ctrl(w, 'f');
          T.type(q(w, '.np-find-input'), 'Satır 7');
        }
      } else if (shot === 'mdstack') {
        mk(DOCS + '/PandaOS Fikirleri.md', md);
        P.storage.set('app.notepad', { preview: true });
        w = await open({ path: DOCS + '/PandaOS Fikirleri.md' });
        w.setSize(480, 520);
      } else if (shot === 'max') {
        w = await open({ path: DOCS + '/Notlar.txt' });
        w.maximize();
      } else if (shot === 'menu' || shot === 'menuview') {
        w = await open({ path: DOCS + '/Notlar.txt' });
        select(w, 0, 6);
        t.click(menuBtn(w, shot === 'menu' ? 'edit' : 'view'));
      } else {
        w = await open();
        setText(w, long, 62);
      }
      if (shot === 'find' || shot === 'replace') {
        setText(w, long, 0);
        ctrl(w, shot === 'find' ? 'f' : 'h');
        const fi = q(w, '.np-find-input');
        T.type(fi, 'bir');
        if (shot === 'replace') T.type(q(w, '.np-replace-input'), 'iki');
        T.key(fi, 'Enter');
      }
      if (shot === 'findnone') {
        setText(w, long, 0);
        ctrl(w, 'f');
        T.type(q(w, '.np-find-input'), 'zzz');
        t.click(q(w, '.np-case'));
      }
      if (shot === 'sheet') { w.close(); }
      if (shot === 'notice') {
        mk(DOCS + '/geçici.txt', 'merhaba');
        w.forceClose();
        w = await open({ path: DOCS + '/geçici.txt' });
        setText(w, 'merhaba dünya');
        fs.remove(DOCS + '/geçici.txt');
      }
      await T.sleep(150);
      document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* infinite */ } });
      document.body.dataset.npShot = shot;
    });
    return;
  }

  // ------------------------------------------------------------------ registration & window
  T.test('uygulama kaydı: id, ad, simge, dosya türleri', (t) => {
    const def = P.apps.get('notepad');
    t.ok(def, 'notepad kayıtlı değil');
    t.eq(def.name, 'Not Defteri');
    t.eq(def.icon, 'notepad');
    t.eq(def.singleInstance, false);
    t.eq(def.fileTypes, ['.txt', '.md', '.log', '.json', '.js', '.css', '.html', '.csv']);
    t.eq([def.window.width, def.window.height, def.window.minWidth, def.window.minHeight], [760, 540, 380, 260]);
    ['.txt', '.md', '.json'].forEach((e) => t.ok(P.apps.forExtension(e).some((d) => d.id === 'notepad'), e));
  });

  scene('pencere: başlık, boyut, boş durum ve durum çubuğu', async (t, w) => {
    t.eq(title(w), 'Adsız - Not Defteri');
    t.eq(w.getTitle(), 'Adsız - Not Defteri');
    t.eq([w.getBounds().width, w.getBounds().height], [760, 540]);
    t.eq([w.minWidth, w.minHeight], [380, 260]);
    t.eq(t.$$('.np-menu-btn', w.body).map((b) => b.textContent), ['Dosya', 'Düzen', 'Görünüm']);
    t.ok(ed(w) && ed(w).tagName === 'TEXTAREA', 'düzenleyici yok');
    t.eq(getComputedStyle(ed(w)).resize, 'none');
    t.eq(ed(w).getAttribute('placeholder'), 'Yazmaya başlayın…');
    t.eq(st(w), { pos: 'Satır 1, Sütun 1', chars: '0 karakter', zoom: '%100', enc: 'UTF-8' });
    t.ok(document.activeElement === ed(w), 'odak düzenleyicide değil');
    t.eq(ed(w).spellcheck, false);
    t.eq(w.dirty, false);
    t.ok(typeof w.beforeClose === 'function', 'beforeClose tanımlı olmalı');
    t.ok(w.body.classList.contains('app-notepad'));
  });

  scene('yazı yazınca durum çubuğu, başlık ve kirli işareti güncellenir', async (t, w) => {
    const e = ed(w);
    t.type(e, 'merhaba');
    t.eq(st(w).pos, 'Satır 1, Sütun 8');
    t.eq(st(w).chars, '7 karakter');
    t.eq(title(w), '• Adsız - Not Defteri');
    t.eq(w.dirty, true);
    setText(w, 'ilk\nikinci satır\nüç', 'ilk\nikinci'.length);
    t.eq(st(w).pos, 'Satır 2, Sütun 7');
    select(w, 0, 3);
    t.eq(st(w).chars, '3 / 19 karakter');
    setText(w, 'x'.repeat(1234));
    t.eq(st(w).chars, '1.234 karakter');
    setText(w, '');
    t.eq(title(w), 'Adsız - Not Defteri', 'boşaltınca başlık temizlenmeli');
    t.eq(w.dirty, false);
  });

  // ------------------------------------------------------------------ menus
  scene('menü çubuğu: Dosya / Düzen / Görünüm içerikleri', async (t, w) => {
    t.click(menuBtn(w, 'file'));
    await t.waitFor(() => ctxItems().length);
    t.eq(ctxLabels(), ['Yeni', 'Yeni pencere', 'Aç…', 'Kaydet', 'Farklı kaydet…', 'Kapat']);
    t.eq(t.$$('.ctx-shortcut', $('#context-menu-layer .ctx-menu')).map((s) => s.textContent), ['Ctrl+O', 'Ctrl+S', 'Ctrl+Shift+S']);
    t.eq(menuBtn(w, 'file').getAttribute('aria-expanded'), 'true');
    t.ok(menuBtn(w, 'file').classList.contains('open'));
    // hovering another label switches menus
    t.mouse(menuBtn(w, 'edit'), 'mouseenter');
    t.eq(ctxLabels(), ['Geri al', 'Kes', 'Kopyala', 'Yapıştır', 'Sil', 'Bul…', 'Değiştir…', 'Git…', 'Tümünü seç', 'Saat/Tarih']);
    t.eq(t.$$('.ctx-shortcut', $('#context-menu-layer .ctx-menu')).map((s) => s.textContent),
      ['Ctrl+Z', 'Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Del', 'Ctrl+F', 'Ctrl+H', 'Ctrl+G', 'Ctrl+A', 'F5']);
    t.ok(menuBtn(w, 'edit').classList.contains('open') && !menuBtn(w, 'file').classList.contains('open'));
    t.eq($$('#context-menu-layer .ctx-menu').length, 1, 'aynı anda tek menü açık olmalı');
    t.mouse(menuBtn(w, 'view'), 'mouseenter');
    t.eq(ctxLabels(), ['Yakınlaştır', 'Uzaklaştır', 'Varsayılan yakınlaştırma', 'Sözcük kaydırma', 'Durum çubuğu', 'Eş aralıklı yazı tipi']);
    t.eq(ctxItems().map((i) => i.classList.contains('checked')), [false, false, false, true, true, true]);
    // the dropdown sits under its label
    const m = $('#context-menu-layer .ctx-menu').getBoundingClientRect();
    const b = menuBtn(w, 'view').getBoundingClientRect();
    t.ok(Math.abs(m.left - b.left) < 24 && m.top >= b.bottom - 1 && m.top < b.bottom + 12, `menü etiketin altında değil (${m.left},${m.top} / ${b.left},${b.bottom})`);
    // clicking the open label closes the menu, Escape closes too
    t.click(menuBtn(w, 'view'));
    t.eq(ctxItems().length, 0, 'açık etikete tıklamak menüyü kapatmalı');
    t.ok(!menuBtn(w, 'view').classList.contains('open'));
    t.click(menuBtn(w, 'file'));
    await t.waitFor(() => ctxItems().length);
    t.key(document.activeElement, 'Escape');
    t.eq(ctxItems().length, 0, 'Escape menüyü kapatmalı');
    t.eq(menuBtn(w, 'file').getAttribute('aria-expanded'), 'false');
    // keyboard: F10 opens Dosya, Right/Left switch between menus
    key(w, 'F10');
    await t.waitFor(() => ctxItems().length);
    t.eq(ctxLabel(ctxItems()[0]), 'Yeni');
    t.key(document.activeElement, 'ArrowRight');
    t.eq(ctxLabel(ctxItems()[0]), 'Geri al');
    t.key(document.activeElement, 'ArrowLeft');
    t.key(document.activeElement, 'ArrowLeft');
    t.eq(ctxLabel(ctxItems()[0]), 'Yakınlaştır');
    P.contextMenu.hide();
    t.ok(document.activeElement === ed(w), 'menü kapanınca odak düzenleyicide kalmalı');
  });

  scene('Düzen menüsü: seçim yokken Kes/Kopyala/Sil devre dışı', async (t, w) => {
    setText(w, 'abc def', 0);
    await clickMenu(t, w, 'edit');
    const dis = (l) => ctxItem(l).classList.contains('disabled');
    t.ok(dis('Kes') && dis('Kopyala') && dis('Sil'), 'seçim yokken devre dışı olmalı');
    t.ok(!dis('Yapıştır') && !dis('Bul…') && !dis('Tümünü seç'));
    P.contextMenu.hide();
    select(w, 0, 3);
    await clickMenu(t, w, 'edit');
    t.ok(!dis('Kes') && !dis('Kopyala') && !dis('Sil'), 'seçimle etkin olmalı');
    t.click(ctxItem('Sil'));
    t.eq(ed(w).value, ' def');
    t.eq(title(w), '• Adsız - Not Defteri');
  });

  scene('Düzen: Tümünü seç, Kes, Saat/Tarih', async (t, w) => {
    setText(w, 'bir iki üç', 0);
    await clickMenu(t, w, 'edit', 'Tümünü seç');
    t.eq([ed(w).selectionStart, ed(w).selectionEnd], [0, 10]);
    t.eq(st(w).chars, '10 / 10 karakter');
    select(w, 4, 8);
    await clickMenu(t, w, 'edit', 'Kes');
    t.eq(ed(w).value, 'bir üç');
    setText(w, '');
    await clickMenu(t, w, 'edit', 'Saat/Tarih');
    t.ok(/^\d{2}:\d{2} \d{2}\.\d{2}\.\d{4}$/.test(ed(w).value), `tarih biçimi beklenmedik: "${ed(w).value}"`);
    setText(w, 'x', 0);
    key(w, 'F5');
    t.ok(/^\d{2}:\d{2} \d{2}\.\d{2}\.\d{4}x$/.test(ed(w).value), 'F5 imleç konumuna eklemeli: ' + ed(w).value);
    t.eq(title(w), '• Adsız - Not Defteri');
  });

  scene('düzenleyicide sağ tık: PandaOS bağlam menüsü', async (t, w) => {
    setText(w, 'metin', 0);
    const ev = t.contextmenu(ed(w));
    t.ok(ev.defaultPrevented, 'tarayıcının kendi menüsü engellenmeli');
    await t.waitFor(() => ctxItems().length);
    t.eq(ctxLabels(), ['Geri al', 'Kes', 'Kopyala', 'Yapıştır', 'Sil', 'Tümünü seç', 'Bul…', 'Saat/Tarih']);
    t.click(ctxItem('Bul…'));
    t.ok(!q(w, '.np-find').hidden, 'Bul çubuğu açılmalı');
    // keyboard invoked (no pointer coordinates): anchored inside the editor
    ed(w).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
    await t.waitFor(() => ctxItems().length);
    const m = $('#context-menu-layer .ctx-menu').getBoundingClientRect();
    const er = ed(w).getBoundingClientRect();
    t.ok(m.left >= er.left && m.top >= er.top, 'klavye ile açılan menü editörün içinde olmalı');
    // closing the window dismisses the menu it owns
    w.forceClose();
    t.eq(ctxItems().length, 0, 'pencere kapanınca bağlam menüsü de kapanmalı');
  });

  // ------------------------------------------------------------------ files
  scene('dosya aç: args.path içeriği yükler, başlık ve yol etiketi', { path: DOCS + '/Notlar.txt' }, async (t, w) => {
    const text = fs.readFile(DOCS + '/Notlar.txt');
    t.eq(ed(w).value, text);
    t.eq(title(w), 'Notlar.txt - Not Defteri');
    t.eq(q(w, '.np-path').textContent, '~/Belgeler/Notlar.txt');
    t.eq(w.dirty, false);
    t.eq(st(w).chars, text.length.toLocaleString('tr-TR') + ' karakter');
    t.ok(ed(w).scrollTop === 0);
  });

  T.test('dosya aç: CRLF ve BOM temizlenir, kirli olmaz', async (t) => {
    cleanup();
    mk(DOCS + '/crlf.txt', String.fromCharCode(0xFEFF) + 'bir\r\niki\r\nüç');
    const w = await open({ path: DOCS + '/crlf.txt' });
    try {
      t.eq(ed(w).value, 'bir\niki\nüç');
      t.eq(w.dirty, false);
      t.eq(st(w).pos, 'Satır 1, Sütun 1');
    } finally { cleanup(); fs.remove(DOCS + '/crlf.txt'); }
  });

  T.test('Kaydet: CRLF dosyanın satır sonları korunur', async (t) => {
    cleanup();
    const p = mk(DOCS + '/crlf2.txt', 'bir\r\niki');
    const w = await open({ path: p });
    try {
      setText(w, 'bir\niki\nüç');
      ctrl(w, 's');
      await t.waitFor(() => fs.readFile(p).includes('üç'), 1000);
      t.eq(fs.readFile(p), 'bir\r\niki\r\nüç');
      t.eq(w.dirty, false);
      // LF files stay LF
      const p2 = mk(DOCS + '/lf2.txt', 'a\nb');
      const w2 = await open({ path: p2 });
      setText(w2, 'a\nb\nc');
      w2.focus();
      ctrl(w2, 's');
      await t.waitFor(() => fs.readFile(p2).includes('c'), 1000);
      t.eq(fs.readFile(p2), 'a\nb\nc');
      fs.remove(p2);
      // a document without a file takes LF
      const w3 = await open();
      setText(w3, 'x\ny');
      ctrl(w3, 's');
      await pickerSave(t, 'crlf3.txt');
      t.eq(fs.readFile(DOCS + '/crlf3.txt'), 'x\ny');
      fs.remove(DOCS + '/crlf3.txt');
    } finally { cleanup(); fs.remove(p); }
  });

  T.test('dosya aç: .xyz gibi bilinmeyen uzantılar Not Defteri ile açılır', async (t) => {
    cleanup();
    mk(DOCS + '/bilinmeyen.xyz', 'gizemli içerik');
    const w = P.apps.openFile(DOCS + '/bilinmeyen.xyz');
    try {
      t.ok(w && w.appId === 'notepad', 'Not Defteri açılmalı');
      t.eq(ed(w).value, 'gizemli içerik');
    } finally { cleanup(); fs.remove(DOCS + '/bilinmeyen.xyz'); }
  });

  T.test('dosya aç: var olmayan dosya adı yeni dosya gibi açılır, ilk kayıtta oluşur', async (t) => {
    cleanup();
    const p = DOCS + '/yeni-dosya.txt';
    t.ok(!fs.exists(p));
    const w = await open({ path: p });
    try {
      t.eq(title(w), 'yeni-dosya.txt - Not Defteri');
      t.eq(w.dirty, false);
      t.ok(!fs.exists(p), 'kaydetmeden dosya oluşmamalı');
      t.type(ed(w), 'ilk satır');
      ctrl(w, 's');
      await t.waitFor(() => fs.exists(p), 1000, 'dosya oluşmadı');
      t.eq(fs.readFile(p), 'ilk satır');
      t.ok(!picker(), 'yolu belli belgede kaydet penceresi açılmamalı');
      t.eq(title(w), 'yeni-dosya.txt - Not Defteri');
    } finally { cleanup(); if (fs.exists(p)) fs.remove(p); }
  });

  T.test('dosya aç: klasör yolu uyarı verir, yanlış yol hata', async (t) => {
    cleanup();
    const w = await open({ path: DOCS });
    try {
      await t.waitFor(() => P.dialog.isOpen(), 1000, 'uyarı yok');
      t.ok(/klasör/i.test($('.dlg-message', topCard()).textContent));
      P.dialog.closeAll();
    } finally { cleanup(); }
    const w2 = await open({ path: '/yok/olmayan/dosya.txt' });
    try {
      await t.waitFor(() => P.dialog.isOpen(), 1000, 'uyarı yok');
      t.ok(/bulunamadı/.test($('.dlg-message', topCard()).textContent));
      t.eq(title(w2), 'Adsız - Not Defteri');
    } finally { cleanup(); }
  });

  scene('Kaydet: yolu belli belge doğrudan yazılır', { path: DOCS + '/Notlar.txt' }, async (t, w) => {
    const orig = fs.readFile(DOCS + '/Notlar.txt');
    try {
      setText(w, orig + '\nyeni satır');
      t.eq(title(w), '• Notlar.txt - Not Defteri');
      ctrl(w, 's');
      await t.waitFor(() => fs.readFile(DOCS + '/Notlar.txt').endsWith('yeni satır'), 1000, 'yazılmadı');
      t.ok(!picker(), 'kaydet penceresi açılmamalı');
      t.eq(title(w), 'Notlar.txt - Not Defteri');
      t.eq(w.dirty, false);
      t.ok(/Kaydedildi/.test(q(w, '.np-st-flash').textContent));
    } finally { fs.writeFile(DOCS + '/Notlar.txt', orig); }
  });

  scene('Kaydet: adsız belge Farklı kaydet açar (Belgeler, Adsız.txt)', async (t, w) => {
    const p = DOCS + '/kayit-testi.txt';
    try {
      setText(w, 'kaydedilecek\nmetin');
      await clickMenu(t, w, 'file', 'Kaydet');
      const card = await t.waitFor(picker, 1000, 'kaydet penceresi açılmadı');
      t.eq($('.fp-title', card).textContent, 'Farklı kaydet');
      t.eq($('.fp-crumb.current', card).textContent, 'Belgeler');
      t.eq($('.fp-name-input', card).value, 'Adsız.txt');
      t.ok(/\.txt/.test($('.fp-filter', card).textContent), 'uzantı süzgeci gösterilmeli');
      await pickerSave(t, 'kayit-testi.txt');
      t.eq(fs.readFile(p), 'kaydedilecek\nmetin');
      t.eq(title(w), 'kayit-testi.txt - Not Defteri');
      t.eq(w.dirty, false);
      t.eq(q(w, '.np-path').textContent, '~/Belgeler/kayit-testi.txt');
    } finally { if (fs.exists(p)) fs.remove(p); }
  });

  scene('Ctrl+S adsız belgede ve uzantısız ad: .txt eklenir', async (t, w) => {
    const p = DOCS + '/uzantisiz.txt';
    try {
      setText(w, 'x');
      ctrl(w, 's');
      await pickerSave(t, 'uzantisiz');
      t.ok(fs.exists(p), 'uzantısız adın sonuna .txt eklenmeli');
      t.eq(title(w), 'uzantisiz.txt - Not Defteri');
    } finally { if (fs.exists(p)) fs.remove(p); }
  });

  scene('Farklı kaydet (Ctrl+Shift+S): yeni dosya, eski dosya değişmez, üzerine yazma onayı', { path: DOCS + '/Notlar.txt' }, async (t, w) => {
    const orig = fs.readFile(DOCS + '/Notlar.txt');
    const p = DOCS + '/notlar-kopya.txt';
    try {
      setText(w, 'değiştirilmiş');
      ctrl(w, 's', { shiftKey: true });
      const card = await t.waitFor(picker, 1000);
      t.eq($('.fp-name-input', card).value, 'Notlar.txt', 'geçerli ad önerilmeli');
      await pickerSave(t, 'notlar-kopya.txt');
      t.eq(fs.readFile(p), 'değiştirilmiş');
      t.eq(fs.readFile(DOCS + '/Notlar.txt'), orig, 'özgün dosya değişmemeli');
      t.eq(title(w), 'notlar-kopya.txt - Not Defteri');
      // saving over an existing file asks first
      setText(w, 'üzerine');
      ctrl(w, 's', { shiftKey: true });
      await pickerSave(t, 'Alışveriş Listesi.txt', true);
      t.eq(fs.readFile(DOCS + '/Alışveriş Listesi.txt'), 'üzerine');
    } finally {
      fs.writeFile(DOCS + '/Notlar.txt', orig);
      if (fs.exists(p)) fs.remove(p);
      fs.writeFile(DOCS + '/Alışveriş Listesi.txt', 'Süt\nEkmek\nBambu filizi\n');
    }
  });

  scene('Kaydet: yazma hatası uyarı olarak gösterilir, belge kirli kalır', async (t, w) => {
    setText(w, 'metin');
    ctrl(w, 's');
    await pickerSave(t, '../../yok-klasor/x.txt').catch(() => {});
    // fp rejects the invalid folder in its own status line; cancel it and check nothing was written
    const card = picker();
    if (card) t.click($('.dlg-btn:not(.dlg-primary)', card));
    await t.waitFor(() => !picker(), 1000);
    t.eq(title(w), '• Adsız - Not Defteri');
  });

  scene('Aç… (Ctrl+O): dosya seçici, içerik yüklenir', async (t, w) => {
    ctrl(w, 'o');
    const card = await t.waitFor(picker, 1000, 'aç penceresi açılmadı');
    t.eq($('.fp-title', card).textContent, 'Aç');
    t.eq($('.fp-crumb.current', card).textContent, 'Belgeler');
    const rows = t.$$('.fp-row', card).map((r) => r.dataset.path);
    t.ok(rows.includes(DOCS + '/Notlar.txt'), 'Notlar.txt listelenmeli');
    const row = t.$$('.fp-row', card).find((r) => r.dataset.path === DOCS + '/Notlar.txt');
    t.dblclick(row);
    await t.waitFor(() => !picker(), 1000);
    await t.waitFor(() => title(w) === 'Notlar.txt - Not Defteri', 1000);
    t.eq(ed(w).value, fs.readFile(DOCS + '/Notlar.txt'));
  });

  scene('Aç…: seçicide yalnızca metin uzantıları görünür', async (t, w) => {
    mk(DOCS + '/resim.png', 'data:image/png;base64,AAAA');
    try {
      await clickMenu(t, w, 'file', 'Aç…');
      const card = await t.waitFor(picker, 1000);
      const rows = t.$$('.fp-row', card).map((r) => r.dataset.path);
      t.ok(rows.includes(DOCS + '/Notlar.txt'));
      t.ok(!rows.includes(DOCS + '/resim.png'), '.png listelenmemeli');
      t.click($('.dlg-btn:not(.dlg-primary)', card));
      await t.waitFor(() => !picker());
    } finally { fs.remove(DOCS + '/resim.png'); }
  });

  scene('Yeni: temiz belge hemen sıfırlanır; kirli belge önce sorar', { path: DOCS + '/Notlar.txt' }, async (t, w) => {
    await clickMenu(t, w, 'file', 'Yeni');
    await t.waitFor(() => title(w) === 'Adsız - Not Defteri', 1000);
    t.eq(ed(w).value, '');
    t.ok(!sheet(w), 'temiz belgede soru çıkmamalı');
    setText(w, 'kirli metin');
    await clickMenu(t, w, 'file', 'Yeni');
    await t.waitFor(() => sheet(w), 1000, 'kaydetme sorusu çıkmadı');
    t.eq($('.np-sheet-msg', w.body).textContent, 'Adsız dosyasındaki değişiklikler kaydedilsin mi?');
    t.click(sheetBtn(w, 'cancel'));
    await t.waitFor(() => !sheet(w));
    t.eq(ed(w).value, 'kirli metin', 'İptal belgeyi korumalı');
    await clickMenu(t, w, 'file', 'Yeni');
    await t.waitFor(() => sheet(w));
    t.click(sheetBtn(w, 'discard'));
    await t.waitFor(() => !sheet(w));
    await t.sleep(30);
    t.eq(ed(w).value, '');
    t.eq(title(w), 'Adsız - Not Defteri');
  });

  scene('Aç… kirli belgede önce sorar: İptal / Kaydetme / Kaydet', { path: DOCS + '/Notlar.txt' }, async (t, w) => {
    const orig = fs.readFile(DOCS + '/Notlar.txt');
    try {
      setText(w, 'değişti');
      ctrl(w, 'o');
      await t.waitFor(() => sheet(w), 1000, 'soru çıkmadı');
      t.eq($('.np-sheet-msg', w.body).textContent, 'Notlar.txt dosyasındaki değişiklikler kaydedilsin mi?');
      t.click(sheetBtn(w, 'cancel'));
      await t.waitFor(() => !sheet(w));
      t.ok(!picker(), 'İptal seçiciyi açmamalı');
      t.eq(ed(w).value, 'değişti');
      // Kaydetme → picker opens, document untouched on disk
      ctrl(w, 'o');
      await t.waitFor(() => sheet(w));
      t.click(sheetBtn(w, 'discard'));
      const card = await t.waitFor(picker, 1000, 'seçici açılmadı');
      t.eq(fs.readFile(DOCS + '/Notlar.txt'), orig, 'Kaydetme dosyayı değiştirmemeli');
      t.click($('.dlg-btn:not(.dlg-primary)', card));
      await t.waitFor(() => !picker());
      // Kaydet → written first
      ctrl(w, 'o');
      await t.waitFor(() => sheet(w));
      t.click(sheetBtn(w, 'save'));
      await t.waitFor(() => picker(), 1000);
      t.eq(fs.readFile(DOCS + '/Notlar.txt'), 'değişti', 'Kaydet önce yazmalı');
      t.click($('.dlg-btn:not(.dlg-primary)', picker()));
    } finally { fs.writeFile(DOCS + '/Notlar.txt', orig); }
  });

  scene('Yeni pencere: ikinci bir Not Defteri açar', async (t, w) => {
    const before = nowin().length;
    await clickMenu(t, w, 'file', 'Yeni pencere');
    t.eq(nowin().length, before + 1);
    t.eq(title(nowin()[nowin().length - 1]), 'Adsız - Not Defteri');
  });

  scene('Dosya > Kapat temiz pencereyi kapatır', async (t, w) => {
    await clickMenu(t, w, 'file', 'Kapat');
    await t.waitFor(() => w.isClosed(), 1000, 'pencere kapanmadı');
  });

  // ------------------------------------------------------------------ unsaved changes sheet
  scene('kapatırken: kaydedilmemiş değişiklik sayfası (İptal / Kaydetme / Kaydet)', { path: DOCS + '/Notlar.txt' }, async (t, w) => {
    const orig = fs.readFile(DOCS + '/Notlar.txt');
    try {
      setText(w, orig + 'EK');
      const closing = w.close();
      await t.waitFor(() => sheet(w), 1000, 'sayfa açılmadı');
      t.eq($('.np-sheet-msg', w.body).textContent, 'Notlar.txt dosyasındaki değişiklikler kaydedilsin mi?');
      t.eq(t.$$('.np-sheet-foot button', w.body).map((b) => b.textContent), ['Kaydet', 'Kaydetme', 'İptal']);
      t.ok($('.np-sheet-foot .primary', w.body).textContent === 'Kaydet', 'Kaydet birincil düğme olmalı');
      t.ok(q(w, '.np-root').inert, 'arka plan etkisiz olmalı');
      t.ok(w.body.contains(sheet(w)), 'sayfa pencerenin içinde olmalı');
      t.ok($$('#dialog-layer .dlg-card').length === 0, 'sistem iletişim kutusu kullanılmamalı');
      t.ok(document.activeElement === sheetBtn(w, 'save'), 'odak Kaydet düğmesinde olmalı');
      // a second close request while the sheet is open shares the same sheet
      const again = w.close();
      t.eq($$('.np-sheet', w.body).length, 1);
      t.click(sheetBtn(w, 'cancel'));
      t.eq(await closing, false);
      t.eq(await again, false);
      t.ok(!w.isClosed(), 'İptal pencereyi kapatmamalı');
      t.ok(!q(w, '.np-root').inert);
      t.ok(document.activeElement === ed(w), 'odak düzenleyiciye dönmeli');
      // Kaydetme: closes, file unchanged
      const c2 = w.close();
      await t.waitFor(() => sheet(w));
      t.click(sheetBtn(w, 'discard'));
      t.eq(await c2, true);
      t.ok(w.isClosed());
      t.eq(fs.readFile(DOCS + '/Notlar.txt'), orig);
    } finally { fs.writeFile(DOCS + '/Notlar.txt', orig); }
  });

  scene('kapatırken Kaydet: dosya yazılır ve pencere kapanır', { path: DOCS + '/Notlar.txt' }, async (t, w) => {
    const orig = fs.readFile(DOCS + '/Notlar.txt');
    try {
      setText(w, 'kaydedilen içerik');
      const closing = w.close();
      await t.waitFor(() => sheet(w));
      t.click(sheetBtn(w, 'save'));
      t.eq(await closing, true);
      t.eq(fs.readFile(DOCS + '/Notlar.txt'), 'kaydedilen içerik');
      t.ok(w.isClosed());
    } finally { fs.writeFile(DOCS + '/Notlar.txt', orig); }
  });

  scene('kapatırken adsız belge: Kaydet seçiciyi açar, vazgeçmek kapatmayı iptal eder', async (t, w) => {
    setText(w, 'adsız metin');
    const closing = w.close();
    await t.waitFor(() => sheet(w));
    t.eq($('.np-sheet-msg', w.body).textContent, 'Adsız dosyasındaki değişiklikler kaydedilsin mi?');
    t.click(sheetBtn(w, 'save'));
    const card = await t.waitFor(picker, 1000, 'kaydet penceresi açılmadı');
    t.click($('.dlg-btn:not(.dlg-primary)', card));
    t.eq(await closing, false, 'seçiciden vazgeçmek kapatmayı iptal etmeli');
    t.ok(!w.isClosed());
    t.eq(ed(w).value, 'adsız metin');
    // and saving there really closes
    const p = DOCS + '/kapatirken.txt';
    try {
      const c2 = w.close();
      await t.waitFor(() => sheet(w));
      t.click(sheetBtn(w, 'save'));
      await pickerSave(t, 'kapatirken.txt');
      t.eq(await c2, true);
      t.eq(fs.readFile(p), 'adsız metin');
    } finally { if (fs.exists(p)) fs.remove(p); }
  });

  scene('kaydetme sayfası: klavye (Esc, Enter, Tab, oklar)', async (t, w) => {
    setText(w, 'x');
    let closing = w.close();
    await t.waitFor(() => sheet(w));
    t.key(document.activeElement, 'Escape');
    t.eq(await closing, false);
    t.ok(!sheet(w));
    closing = w.close();
    await t.waitFor(() => sheet(w));
    const btns = t.$$('.np-sheet-foot button', w.body);
    t.key(btns[0], 'Tab');
    t.ok(document.activeElement === btns[1], 'Tab sonraki düğmeye geçmeli');
    t.key(btns[1], 'Tab');
    t.key(btns[2], 'Tab');
    t.ok(document.activeElement === btns[0], 'Tab döngüsel olmalı');
    t.key(btns[0], 'Tab', { shiftKey: true });
    t.ok(document.activeElement === btns[2], 'Shift+Tab geriye gitmeli');
    t.key(btns[2], 'ArrowLeft');
    t.ok(document.activeElement === btns[1]);
    // Enter on "Kaydetme" discards and closes
    t.key(btns[1], 'Enter');
    t.eq(await closing, true);
    t.ok(w.isClosed());
  });

  scene('temiz pencere sorusuz kapanır; win.dirty güncel kalır', async (t, w) => {
    t.eq(w.dirty, false);
    setText(w, 'a');
    t.eq(w.dirty, true);
    setText(w, '');
    t.eq(w.dirty, false);
    t.eq(await w.close(), true);
    t.ok(w.isClosed());
  });

  // ------------------------------------------------------------------ find
  scene('Bul: Ctrl+F çubuğu açar, eşleşmeler seçilir, sayaç ve gezinme', async (t, w) => {
    setText(w, 'foo bar foo\nbaz foo\n', 0);
    t.ok(q(w, '.np-find').hidden, 'başlangıçta kapalı olmalı');
    ctrl(w, 'f');
    t.ok(!q(w, '.np-find').hidden, 'çubuk açılmalı');
    t.ok(q(w, '.np-replace-row').hidden, 'Ctrl+F değiştirme satırını açmamalı');
    t.ok(document.activeElement === q(w, '.np-find-input'), 'odak bul kutusunda olmalı');
    t.eq(q(w, '.np-find-count').textContent, '');
    const fi = q(w, '.np-find-input');
    t.type(fi, 'foo');
    t.eq(q(w, '.np-find-count').textContent, '1/3');
    t.eq([ed(w).selectionStart, ed(w).selectionEnd], [0, 3], 'ilk eşleşme editörde seçilmeli');
    t.eq(st(w).chars, '3 / 20 karakter');
    t.key(fi, 'Enter');
    t.eq(q(w, '.np-find-count').textContent, '2/3');
    t.eq([ed(w).selectionStart, ed(w).selectionEnd], [8, 11]);
    t.key(fi, 'Enter');
    t.eq(q(w, '.np-find-count').textContent, '3/3');
    t.eq(ed(w).selectionStart, 16);
    t.key(fi, 'Enter');
    t.eq(q(w, '.np-find-count').textContent, '1/3', 'sona gelince başa sarmalı');
    t.key(fi, 'Enter', { shiftKey: true });
    t.eq(q(w, '.np-find-count').textContent, '3/3', 'Shift+Enter geriye gitmeli');
    t.click(q(w, '[aria-label="Önceki eşleşme"]'));
    t.eq(q(w, '.np-find-count').textContent, '2/3');
    t.click(q(w, '[aria-label="Sonraki eşleşme"]'));
    t.eq(q(w, '.np-find-count').textContent, '3/3');
    // F3 / Shift+F3 work from anywhere in the window
    key(w, 'F3');
    t.eq(q(w, '.np-find-count').textContent, '1/3');
    key(w, 'F3', { shiftKey: true });
    t.eq(q(w, '.np-find-count').textContent, '3/3');
    // highlights: all matches, the current one emphasised
    const marks = t.$$('.np-hl mark', w.body);
    t.eq(marks.length, 3);
    t.eq(marks.filter((m) => m.classList.contains('cur')).length, 1);
    t.eq(marks.map((m) => m.textContent), ['foo', 'foo', 'foo']);
    t.ok(marks[2].classList.contains('cur'));
    // no match
    fi.value = 'yok';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(q(w, '.np-find-count').textContent, 'Sonuç yok');
    t.ok(fi.classList.contains('invalid'));
    t.eq(t.$$('.np-hl mark', w.body).length, 0);
    t.ok(q(w, '[aria-label="Sonraki eşleşme"]').disabled);
    // Escape closes the bar and hands the focus back to the editor with the match selected
    fi.value = 'bar';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    t.key(fi, 'Escape');
    t.ok(q(w, '.np-find').hidden, 'Esc çubuğu kapatmalı');
    t.ok(document.activeElement === ed(w), 'odak editöre dönmeli');
    t.eq(ed(w).value.slice(ed(w).selectionStart, ed(w).selectionEnd), 'bar');
    t.eq(t.$$('.np-hl mark', w.body).length, 0, 'vurgular temizlenmeli');
  });

  scene('Bul: seçili metin sorguya doldurulur; Aa büyük/küçük harf; Türkçe harfler', async (t, w) => {
    setText(w, 'Foo foo FOO', 4);
    select(w, 4, 7);
    ctrl(w, 'f');
    const fi = q(w, '.np-find-input');
    t.eq(fi.value, 'foo', 'seçili metin bul kutusuna gelmeli');
    t.eq(q(w, '.np-find-count').textContent, '2/3', 'seçili eşleşme geçerli olmalı');
    const aa = q(w, '.np-case');
    t.eq(aa.getAttribute('aria-pressed'), 'false');
    t.click(aa);
    t.eq(aa.getAttribute('aria-pressed'), 'true');
    t.ok(aa.classList.contains('active'));
    t.eq(q(w, '.np-find-count').textContent, '1/1', 'duyarlı aramada tek eşleşme');
    t.click(aa);
    t.eq(q(w, '.np-find-count').textContent, '2/3');
    // Turkish: I/ı and İ/i pair up, not I/i
    setText(w, 'Işık ışık İSTANBUL istanbul Istanbul', 0);
    fi.value = 'ışık';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(q(w, '.np-find-count').textContent, '1/2');
    fi.value = 'isik';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(q(w, '.np-find-count').textContent, 'Sonuç yok');
    fi.value = 'istanbul';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(q(w, '.np-find-count').textContent, '1/2', 'İSTANBUL ve istanbul eşleşmeli, Istanbul değil');
  });

  scene('Bul: çubuk kapalıyken F3, önceki sorguyla sonraki eşleşmeye gider', async (t, w) => {
    setText(w, 'ab ab ab', 0);
    key(w, 'F3');
    t.ok(q(w, '.np-find').hidden === false, 'F3 çubuğu açmalı');
    t.eq(q(w, '.np-find-count').textContent, '');
    const fi = q(w, '.np-find-input');
    t.type(fi, 'ab');
    t.key(fi, 'Escape');
    t.ok(q(w, '.np-find').hidden);
    t.eq([ed(w).selectionStart, ed(w).selectionEnd], [0, 2]);
    key(w, 'F3');
    t.ok(!q(w, '.np-find').hidden, 'F3 çubuğu yeniden açmalı');
    t.eq(q(w, '.np-find-count').textContent, '2/3', 'önceki sorguyla bir sonraki eşleşmeye geçmeli');
    t.eq(ed(w).selectionStart, 3);
    key(w, 'F3', { shiftKey: true });
    t.eq(q(w, '.np-find-count').textContent, '1/3');
  });

  scene('Bul: metin değişince eşleşmeler güncellenir; imleç sonrası ilk eşleşme', async (t, w) => {
    setText(w, 'a b a b a', 3);
    ctrl(w, 'f');
    const fi = q(w, '.np-find-input');
    t.type(fi, 'a');
    t.eq(q(w, '.np-find-count').textContent, '2/3', 'imleçten sonraki ilk eşleşme seçilmeli');
    ed(w).focus();
    setText(w, 'a b a b a a a', 0);
    await t.waitFor(() => q(w, '.np-find-count').textContent.endsWith('/5'), 1000, 'eşleşmeler güncellenmedi');
    t.eq(t.$$('.np-hl mark', w.body).length, 5);
  });

  scene('Bul: eşleşme görünür alana kaydırılır, vurgu katmanı editörle hizalı', async (t, w) => {
    const lines = [];
    for (let i = 1; i <= 200; i++) lines.push(`satır ${i}: ` + 'bambu '.repeat(i % 7 === 0 ? 30 : 3));
    lines[149] += ' HEDEFKELİME';
    const text = lines.join('\n');
    setText(w, text, 0);
    const e = ed(w);
    t.eq(e.scrollTop, 0);
    ctrl(w, 'f');
    t.type(q(w, '.np-find-input'), 'hedefkelime');
    t.eq(q(w, '.np-find-count').textContent, '1/1');
    t.ok(e.scrollTop > 1500, 'uzaktaki eşleşmeye kaydırılmalı: ' + e.scrollTop);
    const hl = q(w, '.np-hl');
    t.ok(Math.abs(hl.scrollTop - e.scrollTop) < 2, 'vurgu katmanı aynı kaydırmada olmalı');
    const lh = parseFloat(getComputedStyle(e).lineHeight);
    t.ok(Math.abs(hl.scrollHeight - e.scrollHeight) <= lh * 1.6, `katman yüksekliği editörle uyuşmuyor (${hl.scrollHeight} / ${e.scrollHeight})`);
    // same for no-wrap
    await clickMenu(t, w, 'view', 'Sözcük kaydırma');
    t.ok(Math.abs(hl.scrollHeight - e.scrollHeight) <= lh * 1.6, 'kaydırmasız modda da uyuşmalı');
    t.eq(getComputedStyle(hl).whiteSpace, 'pre');
  });

  // ------------------------------------------------------------------ replace
  scene('Değiştir: Ctrl+H, tek tek değiştirme ve tümünü değiştirme', async (t, w) => {
    setText(w, 'a-a-a', 0);
    ctrl(w, 'h');
    t.ok(!q(w, '.np-find').hidden && !q(w, '.np-replace-row').hidden, 'değiştirme satırı görünmeli');
    t.eq(q(w, '.np-find-toggle').getAttribute('aria-expanded'), 'true');
    const fi = q(w, '.np-find-input');
    const ri = q(w, '.np-replace-input');
    t.type(fi, 'a');
    t.type(ri, 'bb');
    const [btnOne, btnAll] = t.$$('.np-replace-row .p-btn', w.body);
    t.eq([btnOne.textContent, btnAll.textContent], ['Değiştir', 'Tümünü değiştir']);
    t.click(btnOne);
    t.eq(ed(w).value, 'bb-a-a');
    t.eq(q(w, '.np-find-count').textContent, '1/2', 'sonraki eşleşme seçilmeli');
    t.eq(ed(w).selectionStart, 3);
    t.eq(title(w), '• Adsız - Not Defteri');
    t.click(btnOne);
    t.eq(ed(w).value, 'bb-bb-a');
    t.click(btnOne);
    t.eq(ed(w).value, 'bb-bb-bb');
    t.eq(q(w, '.np-find-count').textContent, 'Sonuç yok');
    t.ok(btnOne.disabled && btnAll.disabled, 'eşleşme yokken düğmeler devre dışı olmalı');
    // replace all
    setText(w, 'kedi köpek kedi kedi', 0);
    fi.value = 'kedi';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    ri.value = 'panda';
    ri.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(q(w, '.np-find-count').textContent, '1/3');
    t.click(btnAll);
    t.eq(ed(w).value, 'panda köpek panda panda');
    t.eq(q(w, '.np-find-count').textContent, '3 değişiklik');
    t.ok(/3 değişiklik yapıldı/.test(q(w, '.np-st-flash').textContent));
    // Enter in the replace box replaces the current match
    setText(w, 'x x', 0);
    fi.value = 'x';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    ri.value = 'y';
    t.key(ri, 'Enter');
    t.eq(ed(w).value, 'y x');
  });

  scene('Değiştir: eşleşme yoksa/boşsa değişiklik yapmaz; kendini içeren değiştirme döngüye girmez', async (t, w) => {
    setText(w, 'aaa', 0);
    ctrl(w, 'h');
    const fi = q(w, '.np-find-input');
    const ri = q(w, '.np-replace-input');
    t.type(fi, 'a');
    ri.value = 'aa';
    const [btnOne, btnAll] = t.$$('.np-replace-row .p-btn', w.body);
    t.click(btnOne);
    t.eq(ed(w).value, 'aaaa');
    t.eq(q(w, '.np-find-count').textContent, '3/4', 'değiştirilen metin tekrar bulunmamalı');
    t.click(btnAll);
    t.eq(ed(w).value, 'aaaaaaaa');
    fi.value = '';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(q(w, '.np-find-count').textContent, '');
    t.click(btnAll);
    t.eq(ed(w).value, 'aaaaaaaa', 'boş sorgu hiçbir şeyi değiştirmemeli');
  });

  scene('Değiştir: tümünü değiştirme tek geri alma adımıdır', async (t, w) => {
    setText(w, 'bir bir bir', 0);
    ctrl(w, 'h');
    const fi = q(w, '.np-find-input');
    t.type(fi, 'bir');
    t.type(q(w, '.np-replace-input'), 'iki');
    t.click(t.$$('.np-replace-row .p-btn', w.body)[1]);
    t.eq(ed(w).value, 'iki iki iki');
    ed(w).focus();
    await clickMenu(t, w, 'edit', 'Geri al');
    t.eq(ed(w).value, 'bir bir bir', 'tek Geri al hepsini döndürmeli');
  });

  scene('Bul çubuğu: değiştirme açma düğmesi ve düğme etiketleri', async (t, w) => {
    ctrl(w, 'f');
    const tg = q(w, '.np-find-toggle');
    t.ok(q(w, '.np-replace-row').hidden);
    t.click(tg);
    t.ok(!q(w, '.np-replace-row').hidden);
    t.click(tg);
    t.ok(q(w, '.np-replace-row').hidden);
    t.click(q(w, '[aria-label="Bulmayı kapat"]'));
    t.ok(q(w, '.np-find').hidden);
    t.ok(document.activeElement === ed(w));
    // Düzen > Bul… / Değiştir…
    await clickMenu(t, w, 'edit', 'Değiştir…');
    t.ok(!q(w, '.np-replace-row').hidden);
    t.click(q(w, '[aria-label="Bulmayı kapat"]'));
    await clickMenu(t, w, 'edit', 'Bul…');
    t.ok(!q(w, '.np-find').hidden);
  });

  // ------------------------------------------------------------------ go to line
  scene('Git… (Ctrl+G): satıra gider, geçersiz değeri reddeder', async (t, w) => {
    const text = Array.from({ length: 120 }, (_, i) => `satır numarası ${i + 1}`).join('\n');
    setText(w, text, 0);
    ctrl(w, 'g');
    const card = await t.waitFor(() => $('#dialog-layer .dlg-card.prompt'), 1000, 'Git penceresi açılmadı');
    t.eq($('.dlg-title', card).textContent, 'Satıra git');
    t.ok(/1 – 120/.test($('.dlg-message', card).textContent), $('.dlg-message', card).textContent);
    const input = $('.dlg-input', card);
    t.eq(input.value, '1', 'geçerli satır önerilmeli');
    input.value = '999';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.ok($('.dlg-error.show', card), 'aralık dışı değer reddedilmeli');
    t.key(input, 'Enter');
    t.ok($('#dialog-layer .dlg-card.prompt'), 'geçersizken pencere kapanmamalı');
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.ok($('.dlg-error.show', card));
    input.value = '77';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.ok(!$('.dlg-error.show', card));
    t.key(input, 'Enter');
    await t.waitFor(() => !$('#dialog-layer .dlg-card'), 1000);
    await t.sleep(30);
    t.eq(st(w).pos, 'Satır 77, Sütun 1');
    t.eq(ed(w).selectionStart, text.split('\n').slice(0, 76).join('\n').length + 1);
    t.ok(ed(w).scrollTop > 800, 'satır görünür alana kaydırılmalı: ' + ed(w).scrollTop);
    t.ok(document.activeElement === ed(w), 'odak editöre dönmeli');
    // Escape cancels
    await clickMenu(t, w, 'edit', 'Git…');
    await t.waitFor(() => $('#dialog-layer .dlg-card.prompt'));
    t.eq($('.dlg-input').value, '77');
    t.key($('.dlg-input'), 'Escape');
    await t.waitFor(() => !$('#dialog-layer .dlg-card'));
    await t.sleep(30);
    t.eq(st(w).pos, 'Satır 77, Sütun 1');
  });

  // ------------------------------------------------------------------ Tab key
  scene('Tab tuşu: sekme ekler, odak editörden çıkmaz; çok satırda girinti', async (t, w) => {
    setText(w, 'abc', 0);
    const ev = key(w, 'Tab');
    t.ok(ev.defaultPrevented, 'Tab varsayılan davranışı engellenmeli');
    t.eq(ed(w).value, '\tabc');
    t.eq(ed(w).selectionStart, 1);
    t.ok(document.activeElement === ed(w));
    t.eq(title(w), '• Adsız - Not Defteri');
    // Shift+Tab removes it
    key(w, 'Tab', { shiftKey: true });
    t.eq(ed(w).value, 'abc');
    t.eq(ed(w).selectionStart, 0);
    // multi-line selection: indent / outdent
    setText(w, 'bir\niki\nüç', 0);
    select(w, 1, 9);
    key(w, 'Tab');
    t.eq(ed(w).value, '\tbir\n\tiki\n\tüç');
    t.eq(ed(w).value.slice(ed(w).selectionStart, ed(w).selectionEnd), '\tbir\n\tiki\n\tüç');
    key(w, 'Tab', { shiftKey: true });
    t.eq(ed(w).value, 'bir\niki\nüç');
    // spaces are outdented too, a selection ending at a line start excludes that line
    setText(w, '    a\n    b\n    c', 0);
    select(w, 0, 12);
    key(w, 'Tab', { shiftKey: true });
    t.eq(ed(w).value, 'a\nb\n    c');
    // Ctrl+Tab is not ours
    const ev2 = key(w, 'Tab', { ctrlKey: true });
    t.ok(!ev2.defaultPrevented);
  });

  // ------------------------------------------------------------------ zoom & view prefs
  scene('yakınlaştırma: Ctrl++ / Ctrl+- / Ctrl+0, durum çubuğu ve kalıcılık', async (t, w) => {
    const e = ed(w);
    const base = parseFloat(getComputedStyle(e).fontSize);
    t.eq(base, 14);
    const ev = ctrl(w, '+');
    t.ok(ev.defaultPrevented, 'tarayıcı yakınlaştırması engellenmeli');
    ctrl(w, '=');
    t.eq(st(w).zoom, '%120');
    t.eq(parseFloat(getComputedStyle(e).fontSize), 16.8);
    ctrl(w, '-');
    t.eq(st(w).zoom, '%110');
    t.eq(P.storage.get('app.notepad').zoom, 110, 'kalıcı olmalı');
    ctrl(w, '0');
    t.eq(st(w).zoom, '%100');
    t.eq(parseFloat(getComputedStyle(e).fontSize), 14);
    // wheel with Ctrl
    const wev = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    e.dispatchEvent(wev);
    t.ok(wev.defaultPrevented);
    t.eq(st(w).zoom, '%110');
    e.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    t.eq(st(w).zoom, '%110', 'Ctrl olmadan tekerlek yakınlaştırmamalı');
    // limits
    for (let i = 0; i < 60; i++) ctrl(w, '-');
    t.eq(st(w).zoom, '%30');
    await clickMenu(t, w, 'view');
    t.ok(ctxItem('Uzaklaştır').classList.contains('disabled'), 'alt sınırda Uzaklaştır devre dışı olmalı');
    P.contextMenu.hide();
    for (let i = 0; i < 60; i++) ctrl(w, '+');
    t.eq(st(w).zoom, '%500');
    await clickMenu(t, w, 'view');
    t.ok(ctxItem('Yakınlaştır').classList.contains('disabled'));
    t.ok(!ctxItem('Varsayılan yakınlaştırma').classList.contains('disabled'));
    t.click(ctxItem('Varsayılan yakınlaştırma'));
    t.eq(st(w).zoom, '%100');
    // the zoom label opens a small menu
    t.click(q(w, '.np-st-zoom'));
    await t.waitFor(() => ctxItems().length);
    t.eq(ctxLabels(), ['Yakınlaştır', 'Uzaklaştır', 'Varsayılan yakınlaştırma']);
    t.click(ctxItem('Yakınlaştır'));
    t.eq(st(w).zoom, '%110');
    // a new window starts with the saved zoom
    const w2 = await open();
    t.eq(st(w2).zoom, '%110');
    t.eq(parseFloat(getComputedStyle(ed(w2)).fontSize), 15.4);
  });

  scene('Görünüm: sözcük kaydırma, durum çubuğu ve yazı tipi kalıcıdır', async (t, w) => {
    const e = ed(w);
    const root = q(w, '.np-root');
    t.eq(e.getAttribute('wrap'), 'soft');
    t.eq(getComputedStyle(e).whiteSpace, 'pre-wrap');
    const monoFont = getComputedStyle(e).fontFamily;
    await clickMenu(t, w, 'view', 'Sözcük kaydırma');
    t.eq(e.getAttribute('wrap'), 'off');
    t.eq(getComputedStyle(e).whiteSpace, 'pre');
    t.ok(root.classList.contains('np-nowrap'));
    await clickMenu(t, w, 'view', 'Durum çubuğu');
    t.ok(q(w, '.np-status').hidden);
    t.eq(getComputedStyle(q(w, '.np-status')).display, 'none');
    await clickMenu(t, w, 'view', 'Eş aralıklı yazı tipi');
    t.ok(getComputedStyle(e).fontFamily !== monoFont, 'yazı tipi değişmeli');
    t.ok(!root.classList.contains('np-mono'));
    await clickMenu(t, w, 'view');
    t.eq(ctxItems().map((i) => i.classList.contains('checked')), [false, false, false, false, false, false]);
    P.contextMenu.hide();
    t.eq(P.storage.get('app.notepad'), { wrap: false, statusBar: false, mono: false });
    // a new window picks them up
    const w2 = await open();
    t.eq(ed(w2).getAttribute('wrap'), 'off');
    t.ok(q(w2, '.np-status').hidden);
    t.ok(!q(w2, '.np-root').classList.contains('np-mono'));
    await clickMenu(t, w2, 'view');
    t.eq(ctxItems().map((i) => i.classList.contains('checked')), [false, false, false, false, false, false]);
    P.contextMenu.hide();
    // toggle back on
    await clickMenu(t, w2, 'view', 'Sözcük kaydırma');
    await clickMenu(t, w2, 'view', 'Durum çubuğu');
    await clickMenu(t, w2, 'view', 'Eş aralıklı yazı tipi');
    t.eq(P.storage.get('app.notepad'), { wrap: true, statusBar: true, mono: true });
    t.ok(!q(w2, '.np-status').hidden);
    t.eq(getComputedStyle(ed(w2)).fontFamily, monoFont);
  });

  T.test('kalıcı tercihler: bozuk değerler yok sayılır', async (t) => {
    cleanup();
    P.storage.set('app.notepad', { zoom: 'çok', wrap: 'evet', statusBar: false, mono: 3, preview: 'x', baska: 1 });
    const w = await open();
    try {
      t.eq(st(w).zoom, '%100');
      t.eq(ed(w).getAttribute('wrap'), 'soft');
      t.ok(q(w, '.np-status').hidden, 'geçerli statusBar:false uygulanmalı');
    } finally { cleanup(); }
    P.storage.set('app.notepad', { zoom: 9999 });
    const w2 = await open();
    try {
      t.eq(st(w2).zoom, '%500');
      // writing one preference keeps the unrelated keys
      await clickMenu(t, w2, 'view', 'Eş aralıklı yazı tipi');
      t.eq(P.storage.get('app.notepad').zoom, 9999);
      t.eq(P.storage.get('app.notepad').mono, false);
    } finally { cleanup(); }
  });

  // ------------------------------------------------------------------ markdown
  const MD = '# Başlık\n\nBu **kalın**, bu *eğik*, bu `kod` ve [bağlantı](https://example.com/a(b)).\n\n' +
    '- bir\n- iki\n  - iç bir\n  - iç iki\n- üç\n\n3. üçüncü\n4. dördüncü\n\n- [x] yapıldı\n- [ ] yapılacak\n\n' +
    '> alıntı **kalın**\n\n```js\nconst a = "<b>";\n```\n\n| Ad | Sayı |\n|:---|---:|\n| elma | 3 |\n| armut | 12 |\n\n---\n\n~~silinen~~ ve \\*kaçış\\*\n\n' +
    'Ayarlar\n=======\n\nhttps://panda.os adresi.\n';

  scene('Markdown: .md dosyasında önizleme menüsü, bölünmüş görünüm ve çizim', async (t, w0) => {
    cleanup();
    mk(DOCS + '/deneme.md', MD);
    const w = await open({ path: DOCS + '/deneme.md' });
    try {
      t.ok(q(w, '.np-preview').hidden, 'önizleme varsayılan olarak kapalı');
      t.ok(!q(w, '.np-md-toggle').hidden, 'önizleme düğmesi .md için görünmeli');
      await clickMenu(t, w, 'view');
      t.eq(ctxLabels(), ['Yakınlaştır', 'Uzaklaştır', 'Varsayılan yakınlaştırma', 'Sözcük kaydırma', 'Durum çubuğu', 'Eş aralıklı yazı tipi', 'Markdown önizleme']);
      t.ok(!ctxItem('Markdown önizleme').classList.contains('checked'));
      t.click(ctxItem('Markdown önizleme'));
      const pv = q(w, '.np-preview');
      t.ok(!pv.hidden, 'önizleme açılmalı');
      t.ok(q(w, '.np-main').classList.contains('np-split'));
      // editor and preview side by side
      const a = ed(w).getBoundingClientRect();
      const b = pv.getBoundingClientRect();
      t.ok(b.left >= a.right - 2 && Math.abs(b.top - a.top) < 40, 'yan yana olmalı');
      t.eq($('h1', pv).textContent, 'Başlık');
      t.eq($('strong', pv).textContent, 'kalın');
      t.eq($('em', pv).textContent, 'eğik');
      t.ok(t.$$('code', pv).some((c) => c.textContent === 'kod'));
      t.eq(t.$$('.np-md-link', pv).map((l) => l.textContent), ['bağlantı', 'https://panda.os']);
      t.eq(t.$$('a', pv).length, 0, 'bağlantılar metin olarak çizilmeli');
      const uls = t.$$('ul', pv);
      t.eq(uls[0].children.length, 3);
      t.eq(t.$$('li', uls[0]).length, 5, 'iç içe liste');
      t.eq($('ul ul', pv).children.length, 2);
      t.eq($('ol', pv).getAttribute('start'), '3');
      t.eq(t.$$('ol > li', pv).map((l) => l.textContent), ['üçüncü', 'dördüncü']);
      t.eq(t.$$('li.np-task .np-md-check', pv).length, 2);
      t.eq(t.$$('.np-md-check.on', pv).length, 1);
      t.eq($('blockquote', pv).textContent.trim(), 'alıntı kalın');
      t.eq($('pre code', pv).textContent, 'const a = "<b>";');
      t.eq($('table th:nth-child(2)', pv).style.textAlign, 'right');
      t.eq(t.$$('tbody tr', pv).length, 2);
      t.eq(t.$$('tbody tr:nth-child(2) td', pv).map((c) => c.textContent), ['armut', '12']);
      t.ok($('hr', pv));
      t.eq($('del', pv).textContent, 'silinen');
      t.ok(pv.textContent.includes('*kaçış*'), 'kaçış karakterleri çözülmeli');
      t.eq(t.$$('h1', pv).map((h) => h.textContent), ['Başlık', 'Ayarlar'], 'setext başlığı');
      // live update
      setText(w, '# Yeni\n\nmetin');
      await t.waitFor(() => $('h1', pv).textContent === 'Yeni', 1000, 'önizleme güncellenmedi');
      t.eq(pv.textContent.includes('Başlık'), false);
      // the toolbar button and the persisted preference
      t.click(q(w, '.np-md-toggle'));
      t.ok(pv.hidden, 'düğme önizlemeyi kapatmalı');
      t.eq(P.storage.get('app.notepad').preview, false);
      t.click(q(w, '.np-md-toggle'));
      t.ok(!pv.hidden);
      t.eq(P.storage.get('app.notepad').preview, true);
      // a new window on a .md file opens with the preview; a .txt file never shows it
      setText(w, MD);
      const w2 = await open({ path: DOCS + '/deneme.md' });
      t.ok(!q(w2, '.np-preview').hidden);
      const w3 = await open({ path: DOCS + '/Notlar.txt' });
      t.ok(q(w3, '.np-preview').hidden, '.txt için önizleme gösterilmemeli');
      t.ok(q(w3, '.np-md-toggle').hidden);
      await clickMenu(t, w3, 'view');
      t.ok(!ctxLabels().includes('Markdown önizleme'), '.txt için menü öğesi olmamalı');
      P.contextMenu.hide();
      // saving an untitled document as .md reveals the preview
      const w4 = await open();
      t.ok(q(w4, '.np-preview').hidden);
      setText(w4, '# a');
      w4.focus();
      ctrl(w4, 's');
      await pickerSave(t, 'yeni.md');
      t.ok(!q(w4, '.np-preview').hidden, '.md olarak kaydedince önizleme açılmalı');
      fs.remove(DOCS + '/yeni.md');
    } finally { cleanup(); fs.remove(DOCS + '/deneme.md'); }
  });

  scene('Markdown: güvenli çizim (HTML metin olarak kalır)', async (t, w0) => {
    cleanup();
    mk(DOCS + '/guvenli.md', '# <script>window.__xss = 1</script>\n\n<img src=x onerror="window.__xss = 2"> ve [x](javascript:window.__xss=3)\n\n```\n<script>window.__xss = 4</script>\n```\n');
    P.storage.set('app.notepad', { preview: true });
    const w = await open({ path: DOCS + '/guvenli.md' });
    try {
      const pv = q(w, '.np-preview');
      t.ok(!pv.hidden);
      t.eq(t.$$('script, img, a, iframe, style, [onerror]', pv).length, 0, 'işaretleme enjekte edilmemeli');
      t.eq(window.__xss, undefined);
      t.ok(pv.textContent.includes('<script>window.__xss = 1</script>'));
      t.ok(pv.textContent.includes('<img src=x onerror="window.__xss = 2">'));
    } finally { cleanup(); fs.remove(DOCS + '/guvenli.md'); }
  });

  scene('Markdown çizici: köşe durumları', async (t, w) => {
    const r = (src) => { const d = document.createElement('div'); w.state.notepad.renderMarkdown(src, d); return d; };
    t.eq(r('').children.length, 0);
    t.eq(r('düz metin\nikinci satır').innerHTML, '<p>düz metin ikinci satır</p>');
    t.eq(r('a  \nb').innerHTML, '<p>a<br>b</p>', 'iki boşluk satır sonu');
    t.eq(r('**a** ve __b__ ve *c* ve _d_').innerHTML, '<p><strong>a</strong> ve <strong>b</strong> ve <em>c</em> ve <em>d</em></p>');
    t.eq(r('***ikisi***').innerHTML, '<p><strong><em>ikisi</em></strong></p>');
    t.eq(r('snake_case_word 2*3*4').innerHTML, '<p>snake_case_word 2<em>3</em>4</p>');
    t.eq(r('a * b * c').innerHTML, '<p>a * b * c</p>');
    t.eq(r('`a*b*c`').innerHTML, '<p><code>a*b*c</code></p>');
    t.eq(r('``a ` b``').innerHTML, '<p><code>a ` b</code></p>');
    t.eq(r('###### altı\n####### yedi').innerHTML, '<h6>altı</h6><p>####### yedi</p>');
    t.eq(r('# Başlık #').innerHTML, '<h1>Başlık</h1>');
    t.eq(r('#hashtag').innerHTML, '<p>#hashtag</p>');
    t.eq(r('![resim](a.png)').textContent, '[Görsel: resim]');
    t.eq(r('[a **b**](u)').innerHTML, '<p><span class="np-md-link">a <strong>b</strong></span></p>');
    t.eq(r('[eksik](').innerHTML, '<p>[eksik](</p>');
    t.eq(r('* a\n* b\n\n- c').innerHTML, '<ul><li>a</li><li>b</li></ul><ul><li>c</li></ul>');
    t.eq(r('1. a\n1. b').innerHTML, '<ol><li>a</li><li>b</li></ol>');
    t.eq(r('- a\n\n  devam\n- b').innerHTML, '<ul><li>a<p>devam</p></li><li>b</li></ul>');
    t.eq(r('- a\nlazy\n- b').innerHTML, '<ul><li>a lazy</li><li>b</li></ul>');
    t.eq(r('> a\n> b\n\nc').innerHTML, '<blockquote><p>a b</p></blockquote><p>c</p>');
    t.eq(r('    kod\n    blok').innerHTML, '<pre><code>kod\nblok</code></pre>');
    t.eq(r('~~~\nx\n~~~').innerHTML, '<pre><code>x</code></pre>');
    t.eq(r('```\nkapanmayan').innerHTML, '<pre><code>kapanmayan</code></pre>');
    t.eq(r('***\n---\n___').querySelectorAll('hr').length, 3);
    t.eq(r('a | b\n--|--\n1 | 2').querySelectorAll('td').length, 2);
    t.eq(r('a | b\nsıradan').innerHTML, '<p>a | b sıradan</p>');
    t.eq(r('Başlık\n---').innerHTML, '<h2>Başlık</h2>');
    t.eq(r('\\# kaçış \\[x\\]').textContent, '# kaçış [x]');
    t.eq(r('<https://a.b/c>').textContent, 'https://a.b/c');
    // a huge document renders without trouble
    const big = Array.from({ length: 800 }, (_, i) => `## Bölüm ${i}\n\nparagraf **${i}** ve \`kod\`\n\n- madde\n- madde\n`).join('\n');
    const d = r(big);
    t.eq(d.querySelectorAll('h2').length, 800);
    // pathological single line: stays linear (rendered as plain text beyond the inline limit)
    t.eq(r('*a '.repeat(30000)).textContent.length, 90000 - 1);
    t.eq(r('_x '.repeat(3000) + '[y](z) '.repeat(500)).querySelectorAll('.np-md-link').length, 500);
    // the preview itself is capped for giant documents
    mk(DOCS + '/dev.md', '# dev\n\n' + 'x'.repeat(320000));
    P.storage.set('app.notepad', { preview: true });
    const wb = await open({ path: DOCS + '/dev.md' });
    try {
      const pv = q(wb, '.np-preview');
      t.ok(!pv.hidden);
      t.ok(pv.textContent.length < 305000 && /sınırlıdır/.test(pv.textContent), 'dev belgede önizleme sınırlanmalı');
      t.eq($('h1', pv).textContent, 'dev');
    } finally { wb.forceClose(); fs.remove(DOCS + '/dev.md'); }
  });

  // ------------------------------------------------------------------ external changes
  scene('dış değişiklik: temiz belge sessizce yeniden yüklenir', async (t, w0) => {
    cleanup();
    const p = mk(DOCS + '/dis1.txt', 'bir');
    const w = await open({ path: p });
    try {
      t.eq(ed(w).value, 'bir');
      fs.writeFile(p, 'iki');
      t.eq(ed(w).value, 'iki', 'dışarıdan yazılan içerik yüklenmeli');
      t.eq(w.dirty, false);
      t.ok(q(w, '.np-notice').hidden, 'bildirim çubuğu görünmemeli');
      t.ok(!sheet(w));
      t.eq(title(w), 'dis1.txt - Not Defteri');
      // caret and scroll stay
      fs.writeFile(p, 'x'.repeat(50) + '\n' + 'y');
      select(w, 5, 5);
      fs.writeFile(p, 'x'.repeat(50) + '\nz');
      t.eq(ed(w).selectionStart, 5);
      // same size, same millisecond: still noticed (content is compared)
      fs.writeFile(p, 'a'); fs.writeFile(p, 'b');
      t.eq(ed(w).value, 'b');
    } finally { cleanup(); fs.remove(p); }
  });

  scene('dış değişiklik: kirli belgede bildirim çubuğu ve "Yeniden yükle"', async (t, w0) => {
    cleanup();
    const p = mk(DOCS + '/dis2.txt', 'bir');
    const w = await open({ path: p });
    try {
      setText(w, 'benim değişikliğim');
      fs.writeFile(p, 'dışarıdan');
      t.eq(ed(w).value, 'benim değişikliğim', 'kirli belge ezilmemeli');
      const n = q(w, '.np-notice');
      t.ok(!n.hidden);
      t.eq(n.dataset.kind, 'changed');
      t.ok(/dis2\.txt/.test(n.textContent) && /değiştirildi/.test(n.textContent), n.textContent);
      t.eq(title(w), '• dis2.txt - Not Defteri');
      // more writes with the same content do not rebuild the notice
      const first = $('.np-notice-text', n);
      fs.writeFile(DOCS + '/baska.txt', 'x');
      t.ok($('.np-notice-text', n) === first);
      fs.remove(DOCS + '/baska.txt');
      t.click($$('.p-btn', n).find((b) => b.textContent === 'Yeniden yükle'));
      t.eq(ed(w).value, 'dışarıdan');
      t.ok(n.hidden);
      t.eq(title(w), 'dis2.txt - Not Defteri');
      t.eq(w.dirty, false);
      // saving overwrites and clears the notice
      setText(w, 'yerel');
      fs.writeFile(p, 'yine dışarıdan');
      t.ok(!n.hidden);
      ctrl(w, 's');
      await t.waitFor(() => fs.readFile(p) === 'yerel', 1000);
      t.ok(n.hidden);
      // the notice can be dismissed
      setText(w, 'yerel 2');
      fs.writeFile(p, 'üçüncü');
      t.ok(!n.hidden);
      t.click(q(w, '.np-notice-x'));
      t.ok(n.hidden);
    } finally { cleanup(); fs.remove(p); }
  });

  scene('dış değişiklik: aynı içeriğin yazılması belgeyi temiz bırakır', async (t, w0) => {
    cleanup();
    const p = mk(DOCS + '/dis2b.txt', 'bir');
    const w = await open({ path: p });
    try {
      setText(w, 'iki');
      t.eq(w.dirty, true);
      fs.writeFile(p, 'iki');
      t.eq(w.dirty, false, 'dosya editörle aynıysa kirli olmamalı');
      t.ok(q(w, '.np-notice').hidden);
    } finally { cleanup(); fs.remove(p); }
  });

  scene('dış değişiklik: dosya silinirse adsız-kirli olur ve uyarı çıkar', async (t, w0) => {
    cleanup();
    const p = mk(DOCS + '/dis3.txt', 'önemli');
    const w = await open({ path: p });
    try {
      fs.remove(p);
      t.eq(title(w), '• Adsız - Not Defteri');
      t.eq(w.dirty, true);
      t.eq(ed(w).value, 'önemli', 'içerik korunmalı');
      const n = q(w, '.np-notice');
      t.ok(!n.hidden);
      t.eq(n.dataset.kind, 'gone');
      t.ok(/dis3\.txt/.test(n.textContent) && /silindi/.test(n.textContent), n.textContent);
      t.eq(q(w, '.np-path').textContent, '');
      // closing asks, saving again works with the old name suggested
      ctrl(w, 's');
      const card = await t.waitFor(picker, 1000);
      t.eq($('.fp-name-input', card).value, 'dis3.txt');
      await pickerSave(t, 'dis3-geri.txt');
      t.eq(fs.readFile(DOCS + '/dis3-geri.txt'), 'önemli');
      t.ok(n.hidden, 'kaydedince bildirim kapanmalı');
      t.eq(title(w), 'dis3-geri.txt - Not Defteri');
    } finally { cleanup(); if (fs.exists(p)) fs.remove(p); if (fs.exists(DOCS + '/dis3-geri.txt')) fs.remove(DOCS + '/dis3-geri.txt'); }
  });

  scene('dış değişiklik: taşıma, çöpe atma ve klasör yeniden adlandırma', async (t, w0) => {
    cleanup();
    fs.mkdir(DOCS + '/dis-klasor');
    const cases = [
      ['taşındı', (p) => fs.move(p, DOCS)],
      ['yeniden adlandırıldı', (p) => fs.rename(p, 'baska-ad.txt')],
      ['çöpe atıldı', (p) => fs.trash(p)],
      ['klasör adı değişti', (p) => fs.rename(DOCS + '/dis-klasor', 'dis-klasor2')]
    ];
    for (const [label, act] of cases) {
      const p = mk(DOCS + '/dis-klasor/tasinan.txt', 'içerik ' + label);
      const w = await open({ path: p });
      try {
        setText(w, 'düzenlendi');
        act(p);
        t.eq(title(w), '• Adsız - Not Defteri', label);
        t.eq(q(w, '.np-notice').dataset.kind, 'gone', label);
        t.eq(ed(w).value, 'düzenlendi', label);
      } finally { w.forceClose(); }
      // restore the fixture
      if (label === 'klasör adı değişti') fs.rename(DOCS + '/dis-klasor2', 'dis-klasor');
      [DOCS + '/tasinan.txt', DOCS + '/baska-ad.txt', DOCS + '/dis-klasor/tasinan.txt', DOCS + '/dis-klasor/baska-ad.txt'].forEach((x) => { if (fs.exists(x)) fs.remove(x); });
      fs.listTrash().forEach((e) => fs.deleteFromTrash(e.id));
    }
    fs.remove(DOCS + '/dis-klasor', { recursive: true });
    cleanup();
  });

  scene('dış değişiklik: kendi kaydımız bildirim üretmez; başka pencere değişikliği algılanır', async (t, w0) => {
    cleanup();
    const p = mk(DOCS + '/dis4.txt', 'a');
    const w1 = await open({ path: p });
    const w2 = await open({ path: p });
    try {
      setText(w1, 'ilk pencerede yazıldı');
      w1.focus();
      ctrl(w1, 's');
      await t.waitFor(() => fs.readFile(p) === 'ilk pencerede yazıldı');
      t.ok(q(w1, '.np-notice').hidden, 'kendi kaydımız uyarı göstermemeli');
      t.eq(w1.dirty, false);
      t.eq(ed(w2).value, 'ilk pencerede yazıldı', 'ikinci pencere temizdi: sessizce yenilenmeli');
      t.ok(q(w2, '.np-notice').hidden);
    } finally { cleanup(); fs.remove(p); }
  });

  // ------------------------------------------------------------------ drag & drop
  scene('sürükle-bırak: dosya yöneticisinden bırakılan dosya açılır; kirliyse sorar', async (t, w) => {
    const drop = (paths) => {
      const dt = new DataTransfer();
      dt.setData('application/x-pandaos-paths', JSON.stringify(paths));
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
      q(w, '.np-root').dispatchEvent(over);
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      q(w, '.np-root').dispatchEvent(ev);
      return { over, ev };
    };
    const r = drop([DOCS + '/Notlar.txt']);
    t.ok(r.over.defaultPrevented, 'dragover kabul edilmeli');
    t.ok(r.ev.defaultPrevented);
    await t.waitFor(() => title(w) === 'Notlar.txt - Not Defteri', 1000, 'dosya açılmadı');
    t.ok(!q(w, '.np-root').classList.contains('np-drop'));
    setText(w, 'kirli');
    drop([DOCS + '/Alışveriş Listesi.txt']);
    await t.waitFor(() => sheet(w), 1000, 'kirli belgede sorulmalı');
    t.click(sheetBtn(w, 'discard'));
    await t.waitFor(() => title(w) === 'Alışveriş Listesi.txt - Not Defteri', 1000);
    // unrelated drags are ignored
    const dt = new DataTransfer();
    dt.setData('text/plain', 'x');
    const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    q(w, '.np-root').dispatchEvent(ev);
    t.ok(!ev.defaultPrevented);
  });

  // ------------------------------------------------------------------ layout
  scene('boyut: en küçük pencerede taşma yok, bölümler görünür', async (t, w) => {
    w.setSize(380, 260);
    t.eq([w.getBounds().width, w.getBounds().height], [380, 260]);
    t.ok(q(w, '.np-root').classList.contains('np-tiny'));
    const wb = w.body.getBoundingClientRect();
    const inside = (el, label) => {
      const r = el.getBoundingClientRect();
      t.ok(r.left >= wb.left - 1 && r.right <= wb.right + 1, `${label} pencerenin dışına taşıyor (${r.left}-${r.right} / ${wb.left}-${wb.right})`);
    };
    t.eq(w.body.scrollWidth <= w.body.clientWidth, true, 'yatay taşma olmamalı');
    t.$$('.np-menu-btn', w.body).forEach((b) => inside(b, b.textContent));
    inside(q(w, '.np-st-pos'), 'konum');
    inside(q(w, '.np-st-chars'), 'karakter');
    inside(q(w, '.np-st-zoom'), 'yakınlaştırma');
    t.ok(ed(w).getBoundingClientRect().height > 100, 'editör görünür kalmalı');
    setText(w, 'x'.repeat(100000));
    ctrl(w, 'h');
    t.$$('.np-find button, .np-find input', w.body).filter((b) => !b.closest('[hidden]')).forEach((b) => inside(b, b.getAttribute('aria-label') || b.textContent || 'giriş'));
    t.eq(w.body.scrollWidth <= w.body.clientWidth, true, 'bul çubuğu yatay taşma yapmamalı');
    // sheet fits too
    const closing = w.close();
    await t.waitFor(() => sheet(w));
    inside($('.np-sheet-card', w.body), 'sayfa kartı');
    t.$$('.np-sheet-foot button', w.body).forEach((b) => inside(b, b.textContent));
    t.click(sheetBtn(w, 'cancel'));
    await closing;
    // preview stacks under the editor in narrow windows
    mk(DOCS + '/dar.md', '# dar');
    try {
      P.storage.set('app.notepad', { preview: true });
      const w2 = await open({ path: DOCS + '/dar.md' });
      w2.setSize(500, 400);
      t.ok(q(w2, '.np-main').classList.contains('np-stack'));
      const a = ed(w2).getBoundingClientRect();
      const b = q(w2, '.np-preview').getBoundingClientRect();
      t.ok(b.top >= a.bottom - 2, 'dar pencerede önizleme altta olmalı');
      w2.setSize(900, 400);
      t.ok(!q(w2, '.np-main').classList.contains('np-stack'));
    } finally { cleanup(); fs.remove(DOCS + '/dar.md'); }
  });

  scene('büyük belge: 20 bin satır hızlı açılır, durum doğru, bul çalışır', async (t, w) => {
    const text = Array.from({ length: 20000 }, (_, i) => `satır ${i + 1} bambu`).join('\n');
    const t0 = Date.now();
    setText(w, text, text.length);
    t.eq(st(w).pos, 'Satır 20.000, Sütun 18');
    ctrl(w, 'f');
    t.type(q(w, '.np-find-input'), 'bambu');
    t.eq(q(w, '.np-find-count').textContent, '1/20.000');
    t.ok(t.$$('.np-hl mark', w.body).length === 5000, 'çok eşleşmede yalnız çevredekiler vurgulanmalı: ' + t.$$('.np-hl mark', w.body).length);
    ctrl(w, 'g');
    await t.waitFor(() => $('#dialog-layer .dlg-input'));
    const input = $('#dialog-layer .dlg-input');
    input.value = '15000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.key(input, 'Enter');
    await t.waitFor(() => !$('#dialog-layer .dlg-card'));
    await t.sleep(30);
    t.eq(st(w).pos, 'Satır 15.000, Sütun 1');
    t.ok(Date.now() - t0 < 8000, 'çok yavaş: ' + (Date.now() - t0));
  });

  // ------------------------------------------------------------------ misc
  // ------------------------------------------------------------------ seeded random walk
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FUZZ_WORDS = ['bambu', 'panda', 'Işık', 'ışık', 'İstanbul', 'istanbul', 'çay', 'ğüşiöç', 'foo', 'Foo', 'a', 'bb', ' ', '  ', '\t', '1234', '\n', 'x\ny'];
  const fmtN = (n) => Number(n).toLocaleString('tr-TR');

  async function fuzzWalk(t, seed, steps) {
    const rand = rng(seed);
    const int = (n) => Math.floor(rand() * n);
    const pick = (arr) => arr[int(arr.length)];
    const fA = DOCS + '/fz-a.txt';
    const fB = DOCS + '/fz-b.md';
    const created = new Set([fA, fB]);
    cleanup();
    fs.writeFile(fA, 'bambu panda\nIşık ışık\nİstanbul istanbul\n');
    fs.writeFile(fB, '# başlık\n\n- bir\n- iki\n');
    let w = await open();
    const log = [];
    const e = () => ed(w);
    const np = () => w.state.notepad;
    const settle = () => t.sleep(70);

    async function answerSheet(choice) {
      await t.waitFor(() => sheet(w), 1000, 'sayfa çıkmadı');
      t.click(sheetBtn(w, choice));
      await t.sleep(30);
    }
    const savePicker = () => { const c = picker(); return c && $('.fp-title', c).textContent === 'Farklı kaydet' ? c : null; };
    async function saveDialog(name, cancel) {
      const card = await t.waitFor(savePicker, 1000, 'kaydet penceresi yok');
      if (cancel) {
        t.click($('.dlg-btn:not(.dlg-primary)', card));
      } else {
        const input = $('.fp-name-input', card);
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        t.click($('.dlg-primary', card));
        for (let i = 0; i < 20 && savePicker(); i++) {
          await t.sleep(20);
          if ($$('#dialog-layer .dlg-card').length > 1) t.click($('.dlg-primary', topCard()));
        }
      }
      await t.waitFor(() => !savePicker(), 1000, 'kaydet penceresi kapanmadı');
      await t.sleep(30);
    }
    async function maybeSheet() {
      await t.sleep(20);
      if (!sheet(w)) return;
      const c = pick(['save', 'discard', 'cancel']);
      log.push('sayfa:' + c);
      await answerSheet(c);
      if (c === 'save' && savePicker()) await saveDialog('fz-' + int(1000) + '.txt', rand() < 0.3);
    }

    function check() {
      const x = e();
      const n = np();
      const dirty = n.isDirty();
      t.eq(w.dirty, dirty, 'win.dirty');
      const name = n.doc.path ? fs.basename(n.doc.path) : 'Adsız';
      t.eq(title(w), `${dirty ? '• ' : ''}${name} - Not Defteri`, 'başlık');
      x.dispatchEvent(new Event('keyup', { bubbles: true }));
      const caret = x.selectionDirection === 'backward' ? x.selectionStart : x.selectionEnd;
      const head = x.value.slice(0, caret);
      t.eq(st(w).pos, `Satır ${fmtN(head.split('\n').length)}, Sütun ${fmtN(caret - head.lastIndexOf('\n'))}`, 'konum');
      const sel = x.selectionEnd - x.selectionStart;
      t.eq(st(w).chars, sel > 0 ? `${fmtN(sel)} / ${fmtN(x.value.length)} karakter` : `${fmtN(x.value.length)} karakter`, 'karakter');
      t.eq(st(w).zoom, '%' + n.prefs.zoom);
      const f = n.find();
      const qv = q(w, '.np-find-input').value;
      if (f.open && qv) {
        const cs = f.caseSensitive;
        const norm = (s) => (cs ? s : s.toLocaleLowerCase('tr'));
        let prev = -1;
        f.matches.forEach((m) => {
          t.ok(m >= prev, 'eşleşmeler sıralı ve çakışmasız olmalı');
          t.eq(norm(x.value.substr(m, qv.length)), norm(qv), 'eşleşme sorguyla uyuşmuyor @' + m);
          prev = m + qv.length;
        });
        const count = q(w, '.np-find-count').textContent;
        if (/değişiklik/.test(count)) { /* "N değişiklik" note after replace all */ }
        else if (!f.matches.length) t.eq(count, 'Sonuç yok');
        else t.eq(count, `${fmtN(f.index + 1)}/${fmtN(f.matches.length)}`, 'sayaç');
        t.eq(t.$$('.np-hl mark', w.body).length, Math.min(f.matches.length, 5000), 'vurgu sayısı');
        if (f.matches.length) t.eq(q(w, '.np-hl').textContent, x.value + '\n' + String.fromCharCode(0x200B), 'vurgu katmanı metni');
      } else {
        t.eq(t.$$('.np-hl mark', w.body).length, 0, 'çubuk kapalıyken/boşken vurgu olmamalı');
      }
      // the markdown preview follows the document and the preference
      const pv = q(w, '.np-preview');
      const mdDoc = !!n.doc.path && /\.md$/i.test(n.doc.path);
      t.eq(pv.hidden, !(mdDoc && n.prefs.preview), 'önizleme görünürlüğü');
      if (!pv.hidden) {
        const ref = document.createElement('div');
        n.renderMarkdown(x.value, ref);
        t.eq(pv.innerHTML, ref.innerHTML, 'önizleme içeriği güncel değil');
      }
      t.eq(q(w, '.np-md-toggle').hidden, !mdDoc, 'önizleme düğmesi');
      t.eq($$('#dialog-layer .dlg-card').length, 0, 'açık iletişim kutusu kalmamalı');
      t.eq(ctxItems().length, 0, 'açık menü kalmamalı');
      t.ok(!sheet(w), 'açık sayfa kalmamalı');
    }

    let i = 0;
    try {
      for (; i < steps; i++) {
        const op = int(27);
        const x = e();
        const len = x.value.length;
        if (op <= 4) {
          const s = pick(FUZZ_WORDS);
          log.push('yaz:' + JSON.stringify(s));
          x.focus();
          document.execCommand('insertText', false, s);
        } else if (op === 5) {
          const a = int(len + 1);
          const b = rand() < 0.5 ? a : int(len + 1);
          log.push(`seç:${Math.min(a, b)}-${Math.max(a, b)}`);
          x.focus();
          x.setSelectionRange(Math.min(a, b), Math.max(a, b));
        } else if (op === 6) {
          log.push('sil');
          x.focus();
          document.execCommand('delete');
        } else if (op === 7) {
          log.push('geri al');
          x.focus();
          document.execCommand('undo');
        } else if (op === 8) {
          log.push('yinele');
          x.focus();
          document.execCommand('redo');
        } else if (op === 9) {
          const sh = rand() < 0.4;
          log.push('Tab' + (sh ? '+Shift' : ''));
          x.focus();
          T.key(x, 'Tab', { shiftKey: sh });
        } else if (op === 10) {
          log.push('F5');
          x.focus();
          T.key(x, 'F5');
        } else if (op === 11 || op === 12) {
          const query = rand() < 0.5 ? pick(['bambu', 'ışık', 'istanbul', 'foo', 'a', 'bb', ' ', 'x']) : (len ? x.value.substr(int(len), 1 + int(3)).replace(/\n/g, '') : 'a');
          log.push('bul:' + JSON.stringify(query));
          ctrl(w, 'f');
          const fi = q(w, '.np-find-input');
          fi.value = query;
          fi.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (op === 13) {
          const k = pick(['Enter', 'Enter', 'F3']);
          const sh = rand() < 0.4;
          log.push('gezin:' + k + (sh ? '+Shift' : ''));
          if (np().find().open) T.key(k === 'Enter' ? q(w, '.np-find-input') : x, k, { shiftKey: sh });
        } else if (op === 14) {
          log.push('Aa');
          if (np().find().open) t.click(q(w, '.np-case'));
        } else if (op === 15 || op === 16) {
          const rep = pick(['', 'zz', 'bambu', 'İ', 'aa']);
          log.push('değiştir:' + JSON.stringify(rep));
          if (!np().find().open || !np().find().replace) ctrl(w, 'h');
          const ri = q(w, '.np-replace-input');
          ri.value = rep;
          ri.dispatchEvent(new Event('input', { bubbles: true }));
          const btns = t.$$('.np-replace-row .p-btn', w.body);
          if (!btns[0].disabled) t.click(btns[op === 15 ? 0 : 1]);
        } else if (op === 17) {
          log.push('Esc');
          T.key(x, 'Escape');
        } else if (op === 18) {
          const k = pick(['+', '-', '0']);
          log.push('yakınlaştır:' + k);
          ctrl(w, k);
        } else if (op === 19) {
          const which = pick(['Sözcük kaydırma', 'Durum çubuğu', 'Eş aralıklı yazı tipi']);
          log.push('görünüm:' + which);
          await clickMenu(t, w, 'view', which);
        } else if (op === 20) {
          const n = 1 + int(Math.max(1, x.value.split('\n').length));
          log.push('git:' + n);
          ctrl(w, 'g');
          const input = await t.waitFor(() => $('#dialog-layer .dlg-input'), 1000, 'Git penceresi açılmadı');
          input.value = String(n);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          T.key(input, 'Enter');
          await t.waitFor(() => !$('#dialog-layer .dlg-card'), 1000);
          await t.sleep(30);
        } else if (op === 21) {
          log.push('kaydet');
          const had = !!np().doc.path;
          ctrl(w, 's');
          if (!had) await saveDialog('fz-' + int(100) + '.txt', rand() < 0.2);
          else await t.sleep(20);
        } else if (op === 22) {
          const target = pick([fA, fB]);
          log.push('aç:' + fs.basename(target));
          ctrl(w, 'o');
          await t.sleep(20);
          if (sheet(w)) {
            const c = pick(['save', 'discard', 'cancel']);
            log.push('sayfa:' + c);
            await answerSheet(c);
            if (c === 'save' && savePicker()) await saveDialog('fz-' + int(1000) + '.txt', false);
          }
          const card = picker();
          if (card) {
            if (rand() < 0.2) {
              t.click($('.dlg-btn:not(.dlg-primary)', card));
            } else {
              const row = t.$$('.fp-row', card).find((r) => r.dataset.path === target);
              if (row) t.dblclick(row); else t.click($('.dlg-btn:not(.dlg-primary)', card));
            }
            await t.waitFor(() => !picker(), 1000);
            await t.sleep(30);
          }
        } else if (op === 23) {
          const path = np().doc.path;
          const what = pick(['yaz', 'sil', 'aynısı']);
          log.push('dış:' + what);
          if (path && fs.exists(path)) {
            if (what === 'yaz') fs.writeFile(path, 'dışarıdan ' + int(1000) + '\nbambu');
            else if (what === 'sil') { fs.remove(path); created.add(path); }
            else fs.writeFile(path, fs.readFile(path));
          }
        } else if (op === 24) {
          log.push('yeni');
          await clickMenu(t, w, 'file', 'Yeni');
          await maybeSheet();
        } else if (op === 26) {
          log.push('önizleme');
          const btn = q(w, '.np-md-toggle');
          if (!btn.hidden) t.click(btn);
        } else {
          log.push('pencere kapat/aç');
          const closing = w.close();
          await t.sleep(20);
          if (sheet(w)) {
            const c = pick(['save', 'discard', 'cancel']);
            log.push('sayfa:' + c);
            await answerSheet(c);
            if (c === 'save' && savePicker()) await saveDialog('fz-' + int(1000) + '.txt', rand() < 0.3);
          }
          if (await closing) {
            const again = pick([fA, fB, null]);
            if (again && !fs.exists(again)) fs.writeFile(again, 'yeniden\nbambu');
            w = await open(again ? { path: again } : {});
          }
        }
        await settle();
        check();
      }
    } catch (err) {
      let extra = '';
      try { extra = JSON.stringify(w.state.notepad.menuState()); } catch (e2) { extra = '?'; }
      err.message = `tohum ${seed}, adım ${i}: ${log.slice(-8).join(' → ')} [menü: ${extra}]\n      ${err.message}`;
      throw err;
    } finally {
      nowin().forEach((x) => x.forceClose());
      cleanup();
      created.forEach((p) => { if (fs.exists(p)) fs.remove(p); });
      fs.list(DOCS).filter((s) => /^fz-/.test(s.name)).forEach((s) => fs.remove(s.path));
    }
  }

  // more / longer walks: ?npseeds=3,4,5&npsteps=300 (needs a larger BUDGET)
  const fuzzSeeds = (P.params.get('npseeds') || '1,2').split(',').map(Number).filter(Number.isFinite);
  const fuzzSteps = Number(P.params.get('npsteps')) || 80;
  fuzzSeeds.forEach((seed) => {
    T.test(`rastgele işlem yürüyüşü (tohum ${seed}): tutarlılık değişmezleri`, async (t) => { await fuzzWalk(t, seed, fuzzSteps); });
  });

  T.test('çoklu örnek: pencereler bağımsızdır, başlıklar ayrı', async (t) => {
    cleanup();
    const a = await open({ path: DOCS + '/Notlar.txt' });
    const b = await open();
    try {
      t.ok(a !== b && a.id !== b.id);
      t.eq([title(a), title(b)], ['Notlar.txt - Not Defteri', 'Adsız - Not Defteri']);
      setText(b, 'sadece b');
      t.eq([a.dirty, b.dirty], [false, true]);
      t.eq([title(a), title(b)], ['Notlar.txt - Not Defteri', '• Adsız - Not Defteri']);
      t.ok(ed(a).value !== ed(b).value);
      // the taskbar shows the same titles
      t.eq(P.wm.byApp('notepad').length, 2);
    } finally { cleanup(); }
  });

  T.test('masaüstü Not Defteri kısayolu ve apps.openFile .txt/.md/.json', async (t) => {
    cleanup();
    mk(DOCS + '/a.json', '{"a": 1}');
    try {
      const w = P.apps.openFile(DOCS + '/a.json');
      t.eq(w.appId, 'notepad');
      t.eq(ed(w).value, '{"a": 1}');
      t.eq(title(w), 'a.json - Not Defteri');
      const w2 = P.apps.openFile('/home/panda/Masaüstü/Not Defteri.app');
      t.eq(w2.appId, 'notepad');
      t.eq(title(w2), 'Adsız - Not Defteri');
    } finally { cleanup(); fs.remove(DOCS + '/a.json'); }
  });

  T.test('kapatınca temizlik: dinleyici, zamanlayıcı ve veri yolu sızıntısı yok', async (t) => {
    cleanup();
    await t.sleep(30);
    // track document/window listeners, bus subscriptions
    const live = new Map();
    const idOf = new WeakMap();
    let n = 0;
    const fid = (fn) => { if (!idOf.has(fn)) idOf.set(fn, ++n); return idOf.get(fn); };
    const sig = (type, fn, opts) => `${type}|${fid(fn)}|${opts === true || (opts && opts.capture) ? 'c' : 'b'}`;
    const wrap = (target, tag) => {
      const add = target.addEventListener;
      const rem = target.removeEventListener;
      target.addEventListener = function (type, fn, opts) { if (typeof fn === 'function') live.set(tag + sig(type, fn, opts), type); return add.call(this, type, fn, opts); };
      target.removeEventListener = function (type, fn, opts) { if (typeof fn === 'function') live.delete(tag + sig(type, fn, opts)); return rem.call(this, type, fn, opts); };
      return () => { target.addEventListener = add; target.removeEventListener = rem; };
    };
    const unDoc = wrap(document, 'doc:');
    const unWin = wrap(window, 'win:');
    let bus = 0;
    const origOn = P.bus.on;
    P.bus.on = function (evt, fn) {
      const off = origOn.call(this, evt, fn);
      bus++;
      let done = false;
      return () => { if (!done) { done = true; bus--; } off(); };
    };
    let w;
    try {
      const before = live.size;
      const busBefore = bus;
      w = await open({ path: DOCS + '/Notlar.txt' });
      // exercise features that register things
      ctrl(w, 'f');
      t.type(q(w, '.np-find-input'), 'a');
      setText(w, 'değişti');
      t.click(menuBtn(w, 'file'));
      await t.waitFor(() => ctxItems().length);
      P.contextMenu.hide();
      t.click(menuBtn(w, 'edit'));
      await t.waitFor(() => ctxItems().length);          // leave a menu open on purpose
      const closing = w.close();
      await t.waitFor(() => sheet(w), 1000);
      t.eq(ctxItems().length, 0, 'sayfa açılınca menü kapalı olmalı');
      t.click(sheetBtn(w, 'discard'));
      await closing;
      await t.sleep(80);
      t.ok(w.isClosed());
      t.eq(w.state.notepad.pendingTimers(), 0, 'bekleyen zamanlayıcı kalmamalı');
      t.eq(ctxItems().length, 0, 'açık menü kalmamalı');
      const leaked = [...live.entries()].filter(([k]) => k.startsWith('doc:') || k.startsWith('win:')).map(([, v]) => v);
      t.eq(live.size, before, 'document/window dinleyicisi sızdı: ' + leaked.join(','));
      t.eq(bus, busBefore, 'bus aboneliği sızdı');
      // events after close do nothing and do not throw
      const errs = (window.__pandaErrors || []).length;
      fs.writeFile(DOCS + '/Notlar.txt', fs.readFile(DOCS + '/Notlar.txt'));
      P.bus.emit('theme:change', { theme: 'dark' });
      await t.sleep(60);
      t.eq((window.__pandaErrors || []).length, errs, 'kapanıştan sonra hata oluştu');
    } finally {
      P.bus.on = origOn;
      unDoc();
      unWin();
      cleanup();
    }
  });

  T.test('sahip olunmayan katmanlar etkilenmez: açıkken tooltip/menü kalıntısı yok', async (t) => {
    cleanup();
    const w = await open();
    t.ok(w);
    w.forceClose();
    await t.sleep(20);
    t.eq($$('#context-menu-layer .ctx-menu').length, 0);
    t.eq($$('#dialog-layer .dlg-backdrop').length, 0);
    t.eq(nowin().length, 0);
    cleanup();
  });
})();
