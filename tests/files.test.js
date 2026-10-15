/* Dosyalar (file manager) tests: drives the real UI of the app through DOM events.
   Run:  bash tools/test.sh files          (shot scenes: shot=<name>, see the bottom of this file) */
(function () {
  'use strict';

  const P = window.PandaOS;
  const fs = P.fs;
  const T = window.PandaTest;
  const HOME = '/home/panda';
  const DOCS = `${HOME}/Belgeler`;
  const MIME = 'application/x-pandaos-paths';

  // "Birlikte aç" lists Not Defteri; keep this suite independent of whether that app is installed
  if (!P.apps.get('notepad')) {
    P.apps.register({ id: 'notepad', name: 'Not Defteri', icon: 'notepad', fileTypes: ['.txt', '.md', '.log', '.json'], launch() {} });
  }

  // ------------------------------------------------------------------ helpers
  async function fresh() {
    try { P.contextMenu.hide(); } catch (e) { /* ignore */ }
    try { P.dialog.closeAll(); } catch (e) { /* ignore */ }
    P.wm.closeAll();
    fs.reset();
    P.storage.remove('app.files');
    P.clipboard.clear();
    if (P.notify && P.notify.clear) P.notify.clear();
  }

  function launch(args) {
    const win = P.apps.launch('files', args || {});
    if (!win) throw new Error('Dosyalar açılamadı');
    win.focus();
    return win;
  }

  const fmOf = (win) => win.state.fm;
  const q = (win, sel) => win.body.querySelector(sel);
  const qa = (win, sel) => [...win.body.querySelectorAll(sel)];
  const names = (win) => qa(win, '.fm-item .fm-nm').map((n) => n.textContent);
  const itemByName = (win, name) => qa(win, '.fm-item').find((i) => i.querySelector('.fm-nm').textContent === name);
  const itemByKey = (win, key) => qa(win, '.fm-item').find((i) => i.dataset.key === key);
  const selectedNames = (win) => qa(win, '.fm-item.selected .fm-nm').map((n) => n.textContent);
  const status = (win) => q(win, '.fm-status-text').textContent;
  const cmd = (win, id) => q(win, `.fm-cmd[data-cmd="${id}"]`);
  const crumbs = (win) => qa(win, '.fm-crumb[data-path]').map((b) => b.textContent);

  function ctxLabels(level) {
    const menus = [...document.querySelectorAll('#context-menu-layer .ctx-menu')];
    const m = menus[level || 0];
    return m ? [...m.querySelectorAll('.ctx-item .ctx-label')].map((x) => x.textContent) : [];
  }

  function ctxItem(label, level) {
    const menus = [...document.querySelectorAll('#context-menu-layer .ctx-menu')];
    const m = menus[level || 0];
    return m ? [...m.querySelectorAll('.ctx-item')].find((i) => i.querySelector('.ctx-label').textContent === label) : null;
  }

  function ctxClick(t, label, level) {
    const it = ctxItem(label, level);
    if (!it) throw new Error(`Menü öğesi yok: ${label} (var: ${ctxLabels(level).join(' | ')})`);
    t.click(it);
  }

  async function confirmDialog(t, ok) {
    await t.waitFor(() => P.dialog.isOpen(), 2000, 'onay penceresi açılmadı');
    t.click(document.querySelector(ok ? '#dialog-layer .dlg-primary' : '#dialog-layer .dlg-btn:not(.dlg-primary)'));
    await t.waitFor(() => !P.dialog.isOpen(), 2000, 'onay penceresi kapanmadı');
  }

  function dnd(type, target, dt, init) {
    const ev = new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, dataTransfer: dt }, init));
    target.dispatchEvent(ev);
    return ev;
  }

  // a scratch folder with a few files of known sizes
  function scratch(name) {
    const dir = `${DOCS}/${name || 'fmt'}`;
    fs.mkdir(dir, { recursive: true });
    return dir;
  }

  function lastNotice() {
    const h = P.notify.history();
    return h.length ? h[0] : null;
  }

  // ------------------------------------------------------------------ registration + first look
  T.test('uygulama kaydı ve varsayılan konum', async (t) => {
    await fresh();
    const def = P.apps.get('files');
    t.ok(def, 'files kayıtlı değil');
    t.eq([def.name, def.icon, def.singleInstance], ['Dosyalar', 'files', false]);
    t.eq([def.window.width, def.window.height, def.window.minWidth, def.window.minHeight], [880, 560, 520, 340]);
    const win = launch();
    const fm = fmOf(win);
    t.eq(fm.cwd, HOME);
    t.eq(win.getTitle(), 'panda');
    t.ok(win.body.classList.contains('app-files'), 'kapsayıcı sınıf yok');
    t.eq(crumbs(win), ['PandaOS', 'home', 'panda']);
    t.eq(names(win), ['Belgeler', 'İndirilenler', 'Masaüstü', 'Müzik', 'Resimler']);
    t.eq(status(win), '5 öğe');
    t.eq(q(win, '.fm-side-item.selected').dataset.path, HOME, 'Ana klasör vurgulu değil');
    t.eq(q(win, '.fm-search-input').placeholder, 'Ara: panda');
    t.ok(q(win, '.fm-nav[data-nav="back"]').disabled, 'Geri açık');
    t.ok(q(win, '.fm-nav[data-nav="forward"]').disabled, 'İleri açık');
    t.ok(!q(win, '.fm-nav[data-nav="up"]').disabled, 'Yukarı kapalı');
    win.close();
  });

  T.test('çoklu pencere ve konum bağımsızlığı', async (t) => {
    await fresh();
    const a = launch();
    const b = launch({ path: DOCS });
    t.eq([fmOf(a).cwd, fmOf(b).cwd], [HOME, DOCS]);
    t.eq(P.apps.running('files').length, 2);
    t.eq(b.getTitle(), 'Belgeler');
    a.close();
    b.close();
  });

  T.test('args.path: dosya → üst klasör + seçili, trash:, geçersiz yol', async (t) => {
    await fresh();
    const w1 = launch({ path: `${DOCS}/Notlar.txt` });
    t.eq(fmOf(w1).cwd, DOCS);
    t.eq(selectedNames(w1), ['Notlar.txt']);
    w1.close();
    const w2 = launch({ path: 'trash:' });
    t.eq(fmOf(w2).mode, 'trash');
    t.eq(w2.getTitle(), 'Çöp Kutusu');
    t.ok(q(w2, '.fm-empty'), 'çöp kutusu boş durumu yok');
    t.eq(q(w2, '.fm-empty h3').textContent, 'Çöp kutusu boş');
    w2.close();
    const w3 = launch({ path: '/yok/boyle/bir/yer' });
    t.eq(fmOf(w3).cwd, HOME);
    t.ok(lastNotice() && /bulunamadı/.test(lastNotice().title), 'hata bildirimi yok');
    w3.close();
  });

  // ------------------------------------------------------------------ navigation
  T.test('kenar çubuğu, geri / ileri / yukarı', async (t) => {
    await fresh();
    const win = launch();
    const fm = fmOf(win);
    const side = (path) => q(win, `.fm-side-item[data-path="${path}"]`);
    t.eq(qa(win, '.fm-side-item').map((b) => b.querySelector('.fm-side-label').textContent),
      ['Ana klasör', 'Masaüstü', 'Belgeler', 'Resimler', 'Müzik', 'İndirilenler', 'PandaOS (/)', 'Çöp Kutusu']);
    t.click(side(DOCS));
    t.eq(fm.cwd, DOCS);
    t.eq(win.getTitle(), 'Belgeler');
    t.ok(side(DOCS).classList.contains('selected'));
    t.ok(!side(HOME).classList.contains('selected'));
    t.eq(crumbs(win), ['PandaOS', 'home', 'panda', 'Belgeler']);
    t.eq(names(win), ['Projeler', 'Alışveriş Listesi.txt', 'Notlar.txt']);
    t.ok(!q(win, '.fm-nav[data-nav="back"]').disabled);
    // up selects the folder we came from
    t.click(q(win, '.fm-nav[data-nav="up"]'));
    t.eq(fm.cwd, HOME);
    t.eq(selectedNames(win), ['Belgeler']);
    // back goes to Belgeler, forward returns
    t.click(q(win, '.fm-nav[data-nav="back"]'));
    t.eq(fm.cwd, DOCS);
    t.click(q(win, '.fm-nav[data-nav="forward"]'));
    t.eq(fm.cwd, HOME);
    t.ok(q(win, '.fm-nav[data-nav="forward"]').disabled);
    // PandaOS root
    t.click(side('/'));
    t.eq(win.getTitle(), 'PandaOS');
    t.ok(q(win, '.fm-nav[data-nav="up"]').disabled, 'kökte Yukarı açık');
    t.ok(names(win).includes('home') && names(win).includes('etc'));
    win.close();
  });

  T.test('klavye: Alt+Sol / Alt+Sağ / Alt+Yukarı / Backspace / F5', async (t) => {
    await fresh();
    const win = launch({ path: `${DOCS}/Projeler` });
    const fm = fmOf(win);
    t.key(win.el, 'ArrowUp', { altKey: true });
    t.eq(fm.cwd, DOCS);
    t.key(win.el, 'ArrowLeft', { altKey: true });
    t.eq(fm.cwd, `${DOCS}/Projeler`);
    t.key(win.el, 'ArrowRight', { altKey: true });
    t.eq(fm.cwd, DOCS);
    t.key(win.el, 'Backspace');
    t.eq(fm.cwd, `${DOCS}/Projeler`);
    // F5 re-reads: a file written behind the app's back is shown
    fs.writeFile(`${DOCS}/Projeler/dis-dosya.txt`, 'x');
    t.key(win.el, 'F5');
    t.ok(names(win).includes('dis-dosya.txt'));
    win.close();
  });

  T.test('çift tıklama: klasör aynı pencerede, dosya PandaOS.apps.openFile', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    const fm = fmOf(win);
    const opened = [];
    const orig = P.apps.openFile;
    P.apps.openFile = (p) => { opened.push(p); return null; };
    try {
      t.dblclick(itemByName(win, 'Notlar.txt'));
      t.eq(opened, [`${DOCS}/Notlar.txt`]);
      t.dblclick(itemByName(win, 'Projeler'));
      t.eq(fm.cwd, `${DOCS}/Projeler`);
      t.eq(win.getTitle(), 'Projeler');
      t.eq(P.apps.running('files').length, 1, 'yeni pencere açıldı');
      // Enter opens the selection
      t.key(win.el, 'Backspace');
      t.click(itemByName(win, 'Alışveriş Listesi.txt'));
      t.key(win.el, 'Enter');
      t.eq(opened[1], `${DOCS}/Alışveriş Listesi.txt`);
      // a .app shortcut shows the target icon + name without extension and launches the app
      t.eq(fm.cwd, DOCS);
    } finally { P.apps.openFile = orig; }
    win.close();
  });

  T.test('.app kısayolları: ad uzantısız, simge hedef uygulamanın', async (t) => {
    await fresh();
    const win = launch({ path: `${HOME}/Masaüstü` });
    t.ok(names(win).includes('Terminal'), 'Terminal kısayolu uzantısız görünmüyor');
    t.ok(!names(win).includes('Terminal.app'));
    const item = itemByName(win, 'Terminal');
    t.ok(item.querySelector('.fm-ico svg'), 'simge yok');
    const launched = [];
    const orig = P.apps.openFile;
    P.apps.openFile = (p) => { launched.push(p); return null; };
    try { t.dblclick(item); } finally { P.apps.openFile = orig; }
    t.eq(launched, [`${HOME}/Masaüstü/Terminal.app`]);
    win.close();
  });

  // ------------------------------------------------------------------ address bar
  T.test('adres çubuğu: breadcrumb, düzenleme, Enter / Escape / geçersiz yol', async (t) => {
    await fresh();
    const win = launch();
    const fm = fmOf(win);
    // breadcrumb click
    t.click(q(win, '.fm-crumb[data-path="/home"]'));
    t.eq(fm.cwd, '/home');
    t.eq(names(win), ['panda']);
    // clicking the empty part turns it into an input
    t.click(q(win, '.fm-fill'));
    const input = q(win, '.fm-addr-input');
    t.ok(input, 'giriş alanı açılmadı');
    t.eq(input.value, '/home');
    t.ok(q(win, '.fm-address').classList.contains('editing'));
    // Escape cancels
    t.key(input, 'Escape');
    t.ok(!q(win, '.fm-addr-input'));
    t.eq(fm.cwd, '/home');
    // F4 opens, type a path, Enter navigates
    t.key(win.el, 'F4');
    const i2 = q(win, '.fm-addr-input');
    i2.value = '~/Belgeler';
    t.key(i2, 'Enter');
    t.eq(fm.cwd, DOCS);
    t.ok(!q(win, '.fm-addr-input'));
    // invalid path: shake + notification, input stays
    t.key(win.el, 'l', { ctrlKey: true });
    const i3 = q(win, '.fm-addr-input');
    i3.value = '/olmayan/klasor';
    const before = P.notify.history().length;
    t.key(i3, 'Enter');
    t.ok(q(win, '.fm-address').classList.contains('shake'), 'sallanma yok');
    t.ok(P.notify.history().length > before, 'bildirim yok');
    t.ok(/bulunamadı/i.test(lastNotice().title + lastNotice().message));
    t.ok(q(win, '.fm-addr-input'), 'geçersiz yolda giriş kapandı');
    t.eq(fm.cwd, DOCS);
    t.key(i3, 'Escape');
    // a file path navigates to its folder and selects it
    t.key(win.el, 'F4');
    const i4 = q(win, '.fm-addr-input');
    i4.value = `${HOME}/Belgeler/Notlar.txt`;
    t.key(i4, 'Enter');
    t.eq(selectedNames(win), ['Notlar.txt']);
    // typing trash: goes to the trash
    t.key(win.el, 'F4');
    const i5 = q(win, '.fm-addr-input');
    i5.value = 'trash:';
    t.key(i5, 'Enter');
    t.eq(fm.mode, 'trash');
    win.close();
  });

  T.test('breadcrumb: ok ile alt klasör menüsü ve uzun yolda taşma', async (t) => {
    await fresh();
    const deep = `${DOCS}/Projeler/a-cok-uzun-bir-klasor-adi/ikinci-cok-uzun-klasor-adi/ucuncu-uzun-klasor-adi`;
    fs.mkdir(deep, { recursive: true });
    const win = launch({ path: deep });
    win.setSize(520, 400);
    await t.sleep(30);
    const fm = fmOf(win);
    fm.fitCrumbs();
    const more = q(win, '.fm-more');
    t.ok(!more.hidden, 'taşan yolda … düğmesi görünmüyor');
    t.click(more);
    t.ok(P.contextMenu.isOpen());
    t.ok(ctxLabels(0).length > 0);
    ctxClick(t, ctxLabels(0)[ctxLabels(0).length - 1]);
    t.ok(fm.cwd.length < deep.length, 'menüden üst konuma gidilmedi');
    // chevron after a crumb lists its sub-folders
    t.click(q(win, '.fm-crumb[data-path="/home/panda"]').nextElementSibling);
    t.ok(ctxLabels(0).includes('Belgeler'));
    ctxClick(t, 'Resimler');
    t.eq(fm.cwd, `${HOME}/Resimler`);
    win.close();
  });

  // ------------------------------------------------------------------ views + sorting
  T.test('görünüm menüsü ve kalıcılık', async (t) => {
    await fresh();
    let win = launch({ path: DOCS });
    const fm = fmOf(win);
    t.eq(q(win, '.fm-view').dataset.layout, 'grid');
    t.eq(q(win, '.fm-view').dataset.size, 'medium');
    t.click(cmd(win, 'view'));
    t.eq(ctxLabels(0), ['Büyük simgeler', 'Orta simgeler', 'Ayrıntılar', 'Gizli öğeleri göster']);
    ctxClick(t, 'Büyük simgeler');
    t.eq(q(win, '.fm-view').dataset.size, 'large');
    t.click(cmd(win, 'view'));
    ctxClick(t, 'Ayrıntılar');
    t.eq(q(win, '.fm-view').dataset.layout, 'details');
    t.eq(qa(win, '.fm-head .fm-col').map((c) => c.querySelector('.fm-col-label').textContent), ['Ad', 'Değiştirilme tarihi', 'Tür', 'Boyut']);
    t.eq(P.storage.get('app.files').view, 'details');
    // status bar switch
    t.click(q(win, '.fm-seg [data-view="medium"]'));
    t.eq(q(win, '.fm-view').dataset.layout, 'grid');
    t.ok(q(win, '.fm-seg [data-view="medium"]').classList.contains('active'));
    // persisted for new windows
    t.click(q(win, '.fm-seg [data-view="details"]'));
    win.close();
    win = launch({ path: DOCS });
    t.eq(q(win, '.fm-view').dataset.layout, 'details');
    t.ok(q(win, '.fm-seg [data-view="details"]').classList.contains('active'));
    t.eq(fmOf(win).prefs.view, 'details');
    win.close();
  });

  T.test('ayrıntılar: başlığa tıklayarak sıralama + ok göstergesi', async (t) => {
    await fresh();
    const dir = scratch('sirala');
    fs.writeFile(`${dir}/b.txt`, '1234567890');
    fs.writeFile(`${dir}/a.txt`, '1');
    fs.writeFile(`${dir}/c.md`, '1'.repeat(300));
    fs.mkdir(`${dir}/Klasör Z`);
    fs.mkdir(`${dir}/Klasör A`);
    const win = launch({ path: dir });
    const fm = fmOf(win);
    fm.setView('details');
    t.eq(names(win), ['Klasör A', 'Klasör Z', 'a.txt', 'b.txt', 'c.md']);
    const head = (id) => q(win, `.fm-col[data-col="${id}"]`);
    t.eq(head('name').getAttribute('aria-sort'), 'ascending');
    t.ok(head('name').querySelector('.fm-sort-arrow'), 'ok yok');
    // click the active column: descending (folders stay first)
    t.click(head('name'));
    t.eq(names(win), ['Klasör Z', 'Klasör A', 'c.md', 'b.txt', 'a.txt']);
    t.eq(head('name').getAttribute('aria-sort'), 'descending');
    // size
    t.click(head('size'));
    t.eq(names(win).slice(2), ['a.txt', 'b.txt', 'c.md']);
    t.click(head('size'));
    t.eq(names(win).slice(2), ['c.md', 'b.txt', 'a.txt']);
    // type groups by type label
    t.click(head('type'));
    t.eq(fm.prefs.sort, { key: 'type', dir: 'asc' });
    t.eq(names(win).slice(2).sort(), ['a.txt', 'b.txt', 'c.md']);
    t.eq(names(win).slice(2)[0], 'c.md', 'tür sıralamasında Markdown belgesi, Metin belgesinden önce gelmeli');
    // modified: newest first on first click
    fs.writeFile(`${dir}/a.txt`, 'yeni içerik');
    t.click(head('modified'));
    t.eq(fm.prefs.sort, { key: 'modified', dir: 'desc' });
    t.eq(names(win)[2], 'a.txt', 'en yeni dosya başta değil');
    t.eq(P.storage.get('app.files').sort, { key: 'modified', dir: 'desc' });
    win.close();
  });

  T.test('Sırala menüsü: anahtar + artan / azalan', async (t) => {
    await fresh();
    const dir = scratch('sirala2');
    fs.writeFile(`${dir}/b.txt`, '1234567890');
    fs.writeFile(`${dir}/a.txt`, '1');
    const win = launch({ path: dir });
    t.click(cmd(win, 'sort'));
    t.eq(ctxLabels(0), ['Ad', 'Değiştirilme tarihi', 'Tür', 'Boyut', 'Artan', 'Azalan']);
    t.ok(ctxItem('Ad').classList.contains('checked') && ctxItem('Artan').classList.contains('checked'));
    ctxClick(t, 'Azalan');
    t.eq(names(win), ['b.txt', 'a.txt']);
    t.click(cmd(win, 'sort'));
    ctxClick(t, 'Boyut');
    t.eq(fmOf(win).prefs.sort, { key: 'size', dir: 'desc' });
    t.eq(names(win), ['b.txt', 'a.txt']);
    t.click(cmd(win, 'sort'));
    ctxClick(t, 'Artan');
    t.eq(names(win), ['a.txt', 'b.txt']);
    win.close();
  });

  T.test('gizli öğeleri göster', async (t) => {
    await fresh();
    const dir = scratch('gizli');
    fs.writeFile(`${dir}/.gizli.txt`, 'x');
    fs.writeFile(`${dir}/acik.txt`, 'x');
    const win = launch({ path: dir });
    t.eq(names(win), ['acik.txt']);
    t.click(cmd(win, 'view'));
    ctxClick(t, 'Gizli öğeleri göster');
    t.eq(names(win), ['.gizli.txt', 'acik.txt']);
    t.ok(itemByName(win, '.gizli.txt').classList.contains('is-hidden'));
    t.eq(P.storage.get('app.files').hidden, true);
    t.click(cmd(win, 'view'));
    t.ok(ctxItem('Gizli öğeleri göster').classList.contains('checked'));
    P.contextMenu.hide();
    win.close();
  });

  T.test('boş klasör durumu', async (t) => {
    await fresh();
    const win = launch({ path: `${HOME}/Resimler` });
    t.ok(q(win, '.fm-empty'));
    t.eq(q(win, '.fm-empty h3').textContent, 'Bu klasör boş');
    t.eq(status(win), '0 öğe');
    fmOf(win).setView('details');
    t.eq(q(win, '.fm-empty h3').textContent, 'Bu klasör boş');
    // the empty area still offers the background menu
    t.contextmenu(q(win, '.fm-view'));
    t.ok(ctxLabels(0).includes('Yeni'));
    P.contextMenu.hide();
    win.close();
  });

  // ------------------------------------------------------------------ selection
  T.test('seçim: tıklama, Ctrl, Shift, Ctrl+A, Escape + durum çubuğu', async (t) => {
    await fresh();
    const dir = scratch('secim');
    fs.writeFile(`${dir}/a.txt`, '1'.repeat(1024));
    fs.writeFile(`${dir}/b.txt`, '1'.repeat(2048));
    fs.writeFile(`${dir}/c.txt`, '1'.repeat(1024));
    fs.writeFile(`${dir}/d.txt`, '1');
    fs.mkdir(`${dir}/Klasor`);
    const win = launch({ path: dir });
    t.eq(status(win), '5 öğe');
    t.click(itemByName(win, 'a.txt'));
    t.eq(selectedNames(win), ['a.txt']);
    t.eq(status(win), '1 öğe seçili · 1 KB');
    t.click(itemByName(win, 'c.txt'), { ctrlKey: true });
    t.eq(selectedNames(win), ['a.txt', 'c.txt']);
    t.eq(status(win), '2 öğe seçili · 2 KB');
    t.click(itemByName(win, 'c.txt'), { ctrlKey: true });
    t.eq(selectedNames(win), ['a.txt']);
    // shift range from the anchor (the last plain / ctrl click)
    t.click(itemByName(win, 'a.txt'));
    t.click(itemByName(win, 'd.txt'), { shiftKey: true });
    t.eq(selectedNames(win), ['a.txt', 'b.txt', 'c.txt', 'd.txt']);
    t.eq(status(win), '4 öğe seçili · 4 KB');
    t.click(itemByName(win, 'b.txt'), { shiftKey: true });
    t.eq(selectedNames(win), ['a.txt', 'b.txt'], 'shift+tık aralığı yeniden hesaplamalı');
    t.click(itemByName(win, 'Klasor'));
    t.eq(selectedNames(win), ['Klasor']);
    t.eq(status(win), '1 öğe seçili', 'klasör boyutu gösterilmemeli');
    t.key(win.el, 'Escape');
    t.eq(selectedNames(win), []);
    t.eq(status(win), '5 öğe');
    t.key(win.el, 'a', { ctrlKey: true });
    t.eq(selectedNames(win).length, 5);
    t.key(win.el, 'Escape');
    // clicking one of several selected items collapses on click, not on mousedown
    t.key(win.el, 'a', { ctrlKey: true });
    t.click(itemByName(win, 'b.txt'));
    t.eq(selectedNames(win), ['b.txt']);
    // clicking the background clears
    t.click(q(win, '.fm-view'));
    t.eq(selectedNames(win), []);
    win.close();
  });

  T.test('seçim: ok tuşları, Home/End, yazarak arama, Ctrl+ok + Boşluk', async (t) => {
    await fresh();
    const win = launch();
    const fm = fmOf(win);
    // grid: Right/Left move through the folders
    t.key(win.el, 'ArrowRight');
    t.eq(selectedNames(win), ['Belgeler']);
    t.key(win.el, 'ArrowRight');
    t.eq(selectedNames(win), ['İndirilenler']);
    t.key(win.el, 'ArrowLeft');
    t.eq(selectedNames(win), ['Belgeler']);
    t.key(win.el, 'End');
    t.eq(selectedNames(win), ['Resimler']);
    t.key(win.el, 'Home');
    t.eq(selectedNames(win), ['Belgeler']);
    t.key(win.el, 'ArrowRight', { shiftKey: true });
    t.key(win.el, 'ArrowRight', { shiftKey: true });
    t.eq(selectedNames(win), ['Belgeler', 'İndirilenler', 'Masaüstü']);
    // ctrl+arrow moves only the cursor, ctrl+space toggles
    t.key(win.el, 'ArrowRight', { ctrlKey: true });
    t.eq(fm.cursor, `${HOME}/Müzik`);
    t.eq(selectedNames(win).length, 3);
    t.key(win.el, ' ', { ctrlKey: true });
    t.eq(selectedNames(win).length, 4);
    // type-ahead
    t.key(win.el, 'r');
    t.eq(selectedNames(win), ['Resimler']);
    // details: Down/Up
    fm.setView('details');
    t.key(win.el, 'Home');
    t.key(win.el, 'ArrowDown');
    t.eq(selectedNames(win), ['İndirilenler']);
    t.key(win.el, 'ArrowUp');
    t.eq(selectedNames(win), ['Belgeler']);
    t.ok(q(win, '.fm-view').classList.contains('kbd'), 'klavye halkası açılmadı');
    win.close();
  });

  T.test('seçim: fare ile dikdörtgen (rubber band)', async (t) => {
    await fresh();
    const win = launch();
    const view = q(win, '.fm-view');
    const vr = view.getBoundingClientRect();
    const first = itemByName(win, 'Belgeler').getBoundingClientRect();
    const third = itemByName(win, 'Masaüstü').getBoundingClientRect();
    const sx = third.right - 8;
    const sy = third.bottom + 40;
    t.ok(sy < vr.bottom, 'boş alan yok');
    // drag from below-right of the third item up to the middle of the first
    t.mouse(view, 'mousedown', { clientX: sx, clientY: sy, button: 0, buttons: 1 });
    t.mouse(document.body, 'mousemove', { clientX: sx - 30, clientY: sy - 30, buttons: 1 });
    t.ok(q(win, '.fm-band') && !q(win, '.fm-band').hidden, 'seçim dikdörtgeni görünmüyor');
    t.mouse(document.body, 'mousemove', { clientX: first.left + 10, clientY: first.top + 10, buttons: 1 });
    t.eq(selectedNames(win), ['Belgeler', 'İndirilenler', 'Masaüstü']);
    t.mouse(document.body, 'mouseup', { clientX: first.left + 10, clientY: first.top + 10, button: 0 });
    t.ok(q(win, '.fm-band').hidden, 'dikdörtgen kapanmadı');
    t.eq(selectedNames(win), ['Belgeler', 'İndirilenler', 'Masaüstü']);
    // moving after mouseup changes nothing
    t.mouse(document.body, 'mousemove', { clientX: vr.left + 5, clientY: vr.bottom - 5, buttons: 0 });
    t.eq(selectedNames(win).length, 3);
    // ctrl + band adds to the selection
    const mz = itemByName(win, 'Müzik').getBoundingClientRect();
    t.mouse(view, 'mousedown', { clientX: mz.left - 4, clientY: mz.bottom + 30, button: 0, buttons: 1, ctrlKey: true });
    t.mouse(document.body, 'mousemove', { clientX: mz.left + 20, clientY: mz.top + 20, buttons: 1, ctrlKey: true });
    t.mouse(document.body, 'mouseup', { clientX: mz.left + 20, clientY: mz.top + 20, button: 0 });
    t.eq(selectedNames(win), ['Belgeler', 'İndirilenler', 'Masaüstü', 'Müzik']);
    win.close();
  });

  // ------------------------------------------------------------------ create + rename
  T.test('Yeni → Klasör / Metin belgesi: benzersiz ad + anında yeniden adlandırma', async (t) => {
    await fresh();
    const dir = scratch('yeni');
    const win = launch({ path: dir });
    const fm = fmOf(win);
    t.click(cmd(win, 'new'));
    t.eq(ctxLabels(0), ['Klasör', 'Metin belgesi']);
    ctxClick(t, 'Klasör');
    t.ok(fs.isDir(`${dir}/Yeni Klasör`), 'klasör oluşmadı');
    const input = q(win, '.fm-rename');
    t.ok(input, 'satır içi ad düzenleme açılmadı');
    t.eq(input.value, 'Yeni Klasör');
    t.eq(win.el.contains(document.activeElement), true);
    t.ok(document.activeElement === input, 'odak giriş alanında değil');
    // second folder gets "(2)"
    t.key(input, 'Escape');
    t.ok(!q(win, '.fm-rename'));
    t.click(cmd(win, 'new'));
    ctxClick(t, 'Klasör');
    t.ok(fs.isDir(`${dir}/Yeni Klasör (2)`));
    // type a new name and commit with Enter
    const in2 = q(win, '.fm-rename');
    in2.value = 'Fotoğraflar';
    t.key(in2, 'Enter');
    t.ok(fs.isDir(`${dir}/Fotoğraflar`));
    t.ok(!fs.exists(`${dir}/Yeni Klasör (2)`));
    t.ok(!q(win, '.fm-rename'));
    t.eq(selectedNames(win), ['Fotoğraflar']);
    // text document
    t.click(cmd(win, 'new'));
    ctxClick(t, 'Metin belgesi');
    t.ok(fs.isFile(`${dir}/Yeni Metin Belgesi.txt`));
    const in3 = q(win, '.fm-rename');
    t.eq(in3.value, 'Yeni Metin Belgesi.txt');
    t.eq([in3.selectionStart, in3.selectionEnd], [0, 'Yeni Metin Belgesi'.length], 'yalnızca ad seçili olmalı');
    in3.value = 'günlük.md';
    t.key(in3, 'Enter');
    t.ok(fs.isFile(`${dir}/günlük.md`));
    // Ctrl+Shift+N
    t.key(win.el, 'N', { ctrlKey: true, shiftKey: true });
    t.ok(q(win, '.fm-rename'));
    t.key(q(win, '.fm-rename'), 'Escape');
    win.close();
  });

  T.test('yeniden adlandırma: F2, menü, Escape, hata, boşluk, kısayol uzantısı', async (t) => {
    await fresh();
    const dir = scratch('adlandir');
    fs.writeFile(`${dir}/rapor.txt`, 'x');
    fs.writeFile(`${dir}/baska.txt`, 'x');
    fs.writeFile(`${dir}/Selam.app`, JSON.stringify({ appId: 'terminal' }));
    const win = launch({ path: dir });
    const fm = fmOf(win);
    t.click(itemByName(win, 'rapor.txt'));
    t.key(win.el, 'F2');
    let input = q(win, '.fm-rename');
    t.ok(input);
    t.eq([input.selectionStart, input.selectionEnd], [0, 5], 'uzantı hariç seçilmeli');
    // Escape cancels
    input.value = 'degisti.txt';
    t.key(input, 'Escape');
    t.ok(fs.exists(`${dir}/rapor.txt`) && !fs.exists(`${dir}/degisti.txt`));
    t.ok(!q(win, '.fm-rename'));
    // via the command bar
    t.click(cmd(win, 'rename'));
    input = q(win, '.fm-rename');
    input.value = 'rapor-v2.txt';
    t.key(input, 'Enter');
    t.ok(fs.exists(`${dir}/rapor-v2.txt`));
    t.eq(selectedNames(win), ['rapor-v2.txt']);
    // an existing name: error via notify, the input stays open and marked
    t.key(win.el, 'F2');
    input = q(win, '.fm-rename');
    input.value = 'baska.txt';
    const n0 = P.notify.history().length;
    t.key(input, 'Enter');
    t.ok(P.notify.history().length > n0, 'hata bildirimi yok');
    t.ok(q(win, '.fm-rename') && q(win, '.fm-rename').classList.contains('invalid'), 'giriş açık kalmalı');
    t.ok(fs.exists(`${dir}/rapor-v2.txt`));
    // a name with a slash is rejected too, then escape
    input = q(win, '.fm-rename');
    input.value = 'a/b';
    t.key(input, 'Enter');
    t.ok(fs.exists(`${dir}/rapor-v2.txt`));
    t.key(input, 'Escape');
    // blur commits
    t.key(win.el, 'F2');
    input = q(win, '.fm-rename');
    input.value = 'blur.txt';
    input.blur();
    t.ok(fs.exists(`${dir}/blur.txt`), 'odak kaybında ad uygulanmadı');
    // shortcut: edits the name without .app, keeps the extension
    t.click(itemByName(win, 'Selam'));
    t.key(win.el, 'F2');
    input = q(win, '.fm-rename');
    t.eq(input.value, 'Selam');
    input.value = 'Merhaba';
    t.key(input, 'Enter');
    t.ok(fs.exists(`${dir}/Merhaba.app`), '.app uzantısı korunmadı');
    // protected items cannot be renamed
    P.notify.clear();
    fm.go(HOME);
    t.click(itemByName(win, 'Masaüstü'));
    t.ok(cmd(win, 'rename').disabled, 'korumalı öğe için Yeniden adlandır açık');
    t.ok(cmd(win, 'delete').disabled);
    t.ok(cmd(win, 'cut').disabled);
    win.close();
  });

  T.test('yeniden adlandırma sırasında dışarıdan değişiklik girişi bozmaz', async (t) => {
    await fresh();
    const dir = scratch('canli-ad');
    fs.writeFile(`${dir}/x.txt`, 'x');
    const win = launch({ path: dir });
    t.click(itemByName(win, 'x.txt'));
    t.key(win.el, 'F2');
    const input = q(win, '.fm-rename');
    input.value = 'yazdigim';
    fs.writeFile(`${dir}/baska.txt`, 'y');
    t.ok(q(win, '.fm-rename') === input, 'giriş alanı yok edildi');
    t.eq(input.value, 'yazdigim');
    t.key(input, 'Escape');
    t.ok(names(win).includes('baska.txt'), 'bekleyen yenileme uygulanmadı');
    win.close();
  });

  // ------------------------------------------------------------------ delete
  T.test('Sil → çöp kutusu, Shift+Sil → onay + kalıcı silme, çoklu öğe', async (t) => {
    await fresh();
    const dir = scratch('sil');
    ['a.txt', 'b.txt', 'c.txt', 'd.txt'].forEach((n) => fs.writeFile(`${dir}/${n}`, n));
    fs.mkdir(`${dir}/Alt`);
    fs.writeFile(`${dir}/Alt/i.txt`, 'i');
    const win = launch({ path: dir });
    const before = fs.trashCount();
    t.click(itemByName(win, 'a.txt'));
    t.key(win.el, 'Delete');
    t.ok(!fs.exists(`${dir}/a.txt`));
    t.eq(fs.trashCount(), before + 1);
    t.eq(fs.listTrash()[0].name, 'a.txt');
    t.ok(!names(win).includes('a.txt'));
    // the sidebar badge follows the trash
    t.eq(q(win, '.fm-badge').textContent, String(fs.trashCount()));
    t.ok(!q(win, '.fm-badge').hidden);
    // multi-select with the command bar button
    t.click(itemByName(win, 'b.txt'));
    t.click(itemByName(win, 'c.txt'), { ctrlKey: true });
    t.click(cmd(win, 'delete'));
    t.eq(names(win), ['Alt', 'd.txt']);
    t.eq(fs.trashCount(), before + 3);
    // shift+delete: confirm (danger) -> cancel keeps it
    t.click(itemByName(win, 'd.txt'));
    t.key(win.el, 'Delete', { shiftKey: true });
    await confirmDialog(t, false);
    t.ok(fs.exists(`${dir}/d.txt`), 'iptal edildi ama dosya silindi');
    // confirm removes recursively and permanently
    t.click(itemByName(win, 'Alt'));
    t.key(win.el, 'Delete', { shiftKey: true });
    await t.waitFor(() => P.dialog.isOpen());
    t.ok(document.querySelector('#dialog-layer .dlg-card.danger, #dialog-layer .dlg-card'), 'onay kartı yok');
    t.ok(/kalıcı/i.test(document.querySelector('#dialog-layer').textContent));
    t.click(document.querySelector('#dialog-layer .dlg-primary'));
    await t.waitFor(() => !fs.exists(`${dir}/Alt`), 2000, 'Alt klasör silinmedi');
    t.eq(fs.trashCount(), before + 3, 'kalıcı silme çöp kutusuna eklemiş');
    win.close();
  });

  T.test('Sil: sağ tık menüsünden, korumalı öğe hatası', async (t) => {
    await fresh();
    const dir = scratch('sil2');
    fs.writeFile(`${dir}/x.txt`, 'x');
    const win = launch({ path: dir });
    t.contextmenu(itemByName(win, 'x.txt'));
    ctxClick(t, 'Sil');
    t.ok(!fs.exists(`${dir}/x.txt`));
    win.close();
  });

  // ------------------------------------------------------------------ clipboard
  T.test('pano: kopyala / kes / yapıştır, kesilenler yarı saydam, aynı klasörde etkisiz', async (t) => {
    await fresh();
    const dir = scratch('pano');
    const dst = `${dir}/Hedef`;
    fs.mkdir(dst);
    fs.writeFile(`${dir}/a.txt`, 'A');
    fs.writeFile(`${dir}/b.txt`, 'B');
    const win = launch({ path: dir });
    const fm = fmOf(win);
    t.ok(cmd(win, 'paste').disabled, 'pano boşken Yapıştır açık');
    t.click(itemByName(win, 'a.txt'));
    t.key(win.el, 'c', { ctrlKey: true });
    t.eq(P.clipboard.get(), { op: 'copy', paths: [`${dir}/a.txt`] });
    t.ok(!cmd(win, 'paste').disabled);
    // paste into the same folder → copy with a new name
    t.key(win.el, 'v', { ctrlKey: true });
    t.ok(fs.exists(`${dir}/a (kopya).txt`), 'kopya oluşmadı');
    t.eq(selectedNames(win), ['a (kopya).txt']);
    // cut → semi-transparent, paste into a folder (context menu "Klasöre yapıştır")
    t.click(itemByName(win, 'b.txt'));
    t.key(win.el, 'x', { ctrlKey: true });
    t.eq(P.clipboard.get().op, 'cut');
    t.ok(itemByName(win, 'b.txt').classList.contains('cut'), 'kesilen öğe işaretlenmedi');
    // pasting cut items into the same folder is a no-op (clipboard is kept)
    t.key(win.el, 'v', { ctrlKey: true });
    t.ok(fs.exists(`${dir}/b.txt`));
    t.ok(P.clipboard.get() && P.clipboard.get().op === 'cut', 'etkisiz yapıştırma panoyu temizledi');
    t.contextmenu(itemByName(win, 'Hedef'));
    ctxClick(t, 'Klasöre yapıştır');
    t.ok(fs.exists(`${dst}/b.txt`) && !fs.exists(`${dir}/b.txt`), 'taşıma olmadı');
    t.eq(P.clipboard.get(), null, 'kesme yapıştırılınca pano temizlenmeli');
    // paste into a folder window, cut state is gone
    t.ok(!itemByName(win, 'Hedef').classList.contains('cut'));
    // background menu paste
    fm.go(dst);
    t.click(itemByName(win, 'b.txt'));
    t.click(cmd(win, 'copy'));
    fm.go(dir);
    t.contextmenu(q(win, '.fm-view'));
    ctxClick(t, 'Yapıştır');
    t.ok(fs.exists(`${dir}/b.txt`));
    // missing source → error notification, no crash
    P.clipboard.set({ op: 'copy', paths: [`${dir}/yok.txt`] });
    const n0 = P.notify.history().length;
    t.key(win.el, 'v', { ctrlKey: true });
    t.ok(P.notify.history().length > n0, 'eksik kaynak için hata yok');
    win.close();
  });

  T.test('pano: pencereler arası (başka Dosyalar penceresinde kesilen buraya yapıştırılır)', async (t) => {
    await fresh();
    const dir = scratch('pano2');
    fs.mkdir(`${dir}/Kutu`);
    fs.writeFile(`${dir}/not.txt`, 'n');
    const a = launch({ path: dir });
    const b = launch({ path: `${dir}/Kutu` });
    a.focus();
    t.click(itemByName(a, 'not.txt'));
    t.key(a.el, 'x', { ctrlKey: true });
    b.focus();
    t.ok(!cmd(b, 'paste').disabled, 'ikinci pencerede Yapıştır kapalı');
    t.key(b.el, 'v', { ctrlKey: true });
    t.ok(fs.exists(`${dir}/Kutu/not.txt`) && !fs.exists(`${dir}/not.txt`));
    t.ok(!itemByName(a, 'not.txt'), 'ilk pencere güncellenmedi');
    t.eq(selectedNames(b), ['not.txt']);
    a.close();
    b.close();
  });

  // ------------------------------------------------------------------ context menus
  T.test('sağ tık menüsü: öğe (dosya)', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    t.contextmenu(itemByName(win, 'Notlar.txt'));
    t.eq(selectedNames(win), ['Notlar.txt'], 'sağ tıklanan öğe seçilmedi');
    t.eq(ctxLabels(0), ['Aç', 'Birlikte aç', 'Kes', 'Kopyala', 'Yeniden adlandır', 'Sil', 'Özellikler']);
    // Birlikte aç ▸ Not Defteri
    t.click(ctxItem('Birlikte aç'));
    t.ok(ctxLabels(1).includes('Not Defteri'), 'alt menüde Not Defteri yok: ' + ctxLabels(1).join('|'));
    const launched = [];
    const orig = P.apps.launch;
    P.apps.launch = (id, args) => { launched.push([id, args]); return null; };
    try { ctxClick(t, 'Not Defteri', 1); } finally { P.apps.launch = orig; }
    t.eq(launched, [['notepad', { path: `${DOCS}/Notlar.txt` }]]);
    // Özellikler opens the properties dialog
    t.contextmenu(itemByName(win, 'Notlar.txt'));
    ctxClick(t, 'Özellikler');
    await t.waitFor(() => P.dialog.isOpen(), 2000, 'özellikler açılmadı');
    t.ok(/Notlar/.test(document.querySelector('#dialog-layer').textContent));
    P.dialog.closeAll();
    win.close();
  });

  T.test('sağ tık menüsü: klasör, çoklu seçim, zemin', async (t) => {
    await fresh();
    const win = launch();
    const fm = fmOf(win);
    t.contextmenu(itemByName(win, 'Belgeler'));
    t.eq(ctxLabels(0), ['Aç', 'Yeni pencerede aç', 'Kes', 'Kopyala', 'Klasöre yapıştır', 'Yeniden adlandır', 'Sil', 'Terminalde aç', 'Özellikler']);
    // Terminalde aç
    const launched = [];
    const orig = P.apps.launch;
    P.apps.launch = (id, args) => { launched.push([id, args]); return null; };
    try {
      ctxClick(t, 'Terminalde aç');
      t.eq(launched, [['terminal', { cwd: DOCS }]]);
      t.contextmenu(itemByName(win, 'Belgeler'));
      ctxClick(t, 'Yeni pencerede aç');
      t.eq(launched[1], ['files', { path: DOCS }]);
    } finally { P.apps.launch = orig; }
    // Aç navigates
    t.contextmenu(itemByName(win, 'Belgeler'));
    ctxClick(t, 'Aç');
    t.eq(fm.cwd, DOCS);
    // multi selection: rename + properties disabled
    fm.go(HOME);
    t.key(win.el, 'a', { ctrlKey: true });
    t.contextmenu(itemByName(win, 'Müzik'));
    t.eq(selectedNames(win).length, 5, 'çoklu seçim bozuldu');
    t.ok(ctxItem('Yeniden adlandır').classList.contains('disabled'));
    t.ok(ctxItem('Özellikler').classList.contains('disabled'));
    P.contextMenu.hide();
    // background
    t.contextmenu(q(win, '.fm-view'));
    t.eq(selectedNames(win), [], 'zemin sağ tıkında seçim temizlenmeli');
    t.eq(ctxLabels(0), ['Görünüm', 'Sırala', 'Yenile', 'Yapıştır', 'Yeni', 'Terminalde aç', 'Özellikler']);
    t.ok(ctxItem('Yapıştır').classList.contains('disabled'));
    t.click(ctxItem('Görünüm'));
    t.eq(ctxLabels(1), ['Büyük simgeler', 'Orta simgeler', 'Ayrıntılar', 'Gizli öğeleri göster']);
    t.click(ctxItem('Sırala'));
    t.eq(ctxLabels(1), ['Ad', 'Değiştirilme tarihi', 'Tür', 'Boyut', 'Artan', 'Azalan']);
    t.click(ctxItem('Görünüm'));
    ctxClick(t, 'Ayrıntılar', 1);
    t.eq(q(win, '.fm-view').dataset.layout, 'details');
    win.close();
  });

  T.test('sağ tık: zemin menüsü Yeni ▸ Klasör ve Yenile', async (t) => {
    await fresh();
    const dir = scratch('zemin');
    const win = launch({ path: dir });
    t.contextmenu(q(win, '.fm-view'));
    t.click(ctxItem('Yeni'));
    t.eq(ctxLabels(1), ['Klasör', 'Metin belgesi']);
    ctxClick(t, 'Klasör', 1);
    t.ok(fs.isDir(`${dir}/Yeni Klasör`));
    t.key(q(win, '.fm-rename'), 'Escape');
    t.contextmenu(q(win, '.fm-view'));
    ctxClick(t, 'Yenile');
    t.ok(!P.contextMenu.isOpen());
    win.close();
  });

  // ------------------------------------------------------------------ search
  T.test('arama: özyinelemeli sonuçlar + klasör yolu + temizleme', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    const fm = fmOf(win);
    const input = q(win, '.fm-search-input');
    t.eq(input.placeholder, 'Ara: Belgeler');
    t.type(input, 'fikir');
    t.key(input, 'Enter');
    t.eq(names(win), ['PandaOS Fikirleri.md'], 'özyinelemeli arama sonucu yok');
    t.eq(q(win, '.fm-view').dataset.layout, 'details');
    t.eq(q(win, '.fm-row .fm-c-where').textContent, `${DOCS}/Projeler`, 'klasör yolu gösterilmiyor');
    t.eq(status(win), '1 sonuç');
    t.ok(!q(win, '.fm-search-clear').hidden);
    // double click on a result opens the file; "Klasörü aç" goes to its folder with the file selected
    t.contextmenu(itemByName(win, 'PandaOS Fikirleri.md'));
    t.ok(ctxLabels(0).includes('Klasörü aç'));
    ctxClick(t, 'Klasörü aç');
    t.eq(fm.cwd, `${DOCS}/Projeler`);
    t.eq(input.value, '', 'arama kutusu temizlenmeli');
    t.eq(selectedNames(win), ['PandaOS Fikirleri.md']);
    // no results
    fm.go(HOME);
    t.type(input, 'zzzyok');
    t.key(input, 'Enter');
    t.eq(q(win, '.fm-empty h3').textContent, 'Sonuç bulunamadı');
    // Escape clears the search
    t.key(input, 'Escape');
    t.eq(input.value, '');
    t.eq(fm.query, '');
    t.eq(names(win).length, 5);
    // the clear button
    t.type(input, 'not');
    t.key(input, 'Enter');
    t.ok(names(win).includes('Notlar.txt'));
    t.click(q(win, '.fm-search-clear'));
    t.eq(fm.query, '');
    // Ctrl+F focuses the box
    t.key(win.el, 'f', { ctrlKey: true });
    t.ok(document.activeElement === input);
    win.close();
  });

  T.test('arama: sonuç sütunları sıralanabilir, gizli öğeler ayarı', async (t) => {
    await fresh();
    const dir = scratch('ara');
    fs.mkdir(`${dir}/k1`);
    fs.mkdir(`${dir}/k2`);
    fs.writeFile(`${dir}/k2/dosya-b.txt`, '12345');
    fs.writeFile(`${dir}/k1/dosya-a.txt`, '1');
    fs.writeFile(`${dir}/.dosya-gizli.txt`, '1');
    const win = launch({ path: dir });
    const input = q(win, '.fm-search-input');
    t.type(input, 'dosya');
    t.key(input, 'Enter');
    t.eq(names(win).sort(), ['dosya-a.txt', 'dosya-b.txt']);
    t.click(q(win, '.fm-col[data-col="size"]'));
    t.eq(names(win), ['dosya-a.txt', 'dosya-b.txt']);
    t.click(q(win, '.fm-col[data-col="size"]'));
    t.eq(names(win), ['dosya-b.txt', 'dosya-a.txt']);
    t.click(q(win, '.fm-col[data-col="where"]'));
    t.eq(names(win), ['dosya-a.txt', 'dosya-b.txt']);
    win.close();
  });

  // ------------------------------------------------------------------ trash
  T.test('çöp kutusu görünümü: sütunlar, geri yükle, kalıcı sil, boşalt', async (t) => {
    await fresh();
    const dir = scratch('cop');
    fs.writeFile(`${dir}/bir.txt`, '1');
    fs.writeFile(`${dir}/iki.txt`, '22');
    fs.mkdir(`${dir}/Uc`);
    fs.trash(`${dir}/bir.txt`);
    fs.trash(`${dir}/iki.txt`);
    fs.trash(`${dir}/Uc`);
    const win = launch({ path: 'trash:' });
    const fm = fmOf(win);
    t.eq(win.getTitle(), 'Çöp Kutusu');
    t.eq(q(win, '.fm-view').dataset.layout, 'details');
    t.eq(qa(win, '.fm-head .fm-col .fm-col-label').map((c) => c.textContent), ['Ad', 'Özgün konum', 'Silinme tarihi', 'Boyut']);
    t.eq(names(win), ['Uc', 'iki.txt', 'bir.txt'], 'en yeni silinen en üstte olmalı');
    t.eq(q(win, '.fm-row .fm-c-origin').textContent, dir);
    t.eq(status(win), '3 öğe');
    t.eq(qa(win, '.fm-cmd').map((b) => b.dataset.cmd), ['restore', 'purge', 'empty', 'sort']);
    t.ok(cmd(win, 'restore').disabled && cmd(win, 'purge').disabled, 'seçim yokken geri yükle açık');
    t.ok(!cmd(win, 'empty').disabled);
    t.eq(q(win, '.fm-side-item[data-path="trash:"]').classList.contains('selected'), true);
    // trash items are not draggable
    t.ok(!itemByName(win, 'bir.txt').draggable, 'çöp öğesi sürüklenebilir');
    // restore one
    t.click(itemByName(win, 'bir.txt'));
    t.ok(!cmd(win, 'restore').disabled);
    t.click(cmd(win, 'restore'));
    t.ok(fs.exists(`${dir}/bir.txt`), 'geri yüklenmedi');
    t.eq(names(win), ['Uc', 'iki.txt']);
    t.ok(/Geri yüklendi/.test(lastNotice().title));
    // context menu
    t.contextmenu(itemByName(win, 'iki.txt'));
    t.eq(ctxLabels(0), ['Geri yükle', 'Kalıcı olarak sil']);
    ctxClick(t, 'Kalıcı olarak sil');
    await confirmDialog(t, false);
    t.eq(fs.trashCount(), 2, 'iptal sonrası öğe silinmiş');
    t.click(cmd(win, 'purge'));
    await confirmDialog(t, true);
    await t.waitFor(() => fs.trashCount() === 1, 2000, 'kalıcı silinmedi');
    t.eq(names(win), ['Uc']);
    // empty the trash
    t.click(cmd(win, 'empty'));
    await t.waitFor(() => P.dialog.isOpen());
    t.ok(/kalıcı/i.test(document.querySelector('#dialog-layer').textContent));
    t.click(document.querySelector('#dialog-layer .dlg-primary'));
    await t.waitFor(() => fs.trashCount() === 0, 2000, 'çöp boşaltılmadı');
    t.ok(q(win, '.fm-empty'));
    t.eq(q(win, '.fm-empty h3').textContent, 'Çöp kutusu boş');
    t.ok(cmd(win, 'empty').disabled);
    t.ok(q(win, '.fm-badge').hidden, 'rozet gizlenmeli');
    // leaving the trash restores the folder toolbar
    fm.go(HOME);
    t.ok(cmd(win, 'new'), 'klasör komut çubuğu geri gelmedi');
    win.close();
  });

  T.test('çöp kutusu: Delete kalıcı siler, çift tık geri yüklemeyi önerir, arama', async (t) => {
    await fresh();
    const dir = scratch('cop2');
    fs.writeFile(`${dir}/elma.txt`, '1');
    fs.writeFile(`${dir}/armut.txt`, '1');
    fs.trash(`${dir}/elma.txt`);
    fs.trash(`${dir}/armut.txt`);
    const win = launch({ path: 'trash:' });
    // search inside the trash
    const input = q(win, '.fm-search-input');
    t.eq(input.placeholder, 'Ara: Çöp Kutusu');
    t.type(input, 'elm');
    t.key(input, 'Enter');
    t.eq(names(win), ['elma.txt']);
    t.key(input, 'Escape');
    t.eq(names(win).length, 2);
    // double click offers to restore
    t.dblclick(itemByName(win, 'armut.txt'));
    await confirmDialog(t, true);
    await t.waitFor(() => fs.exists(`${dir}/armut.txt`), 2000, 'çift tıkla geri yüklenmedi');
    // Delete key: permanent deletion after confirmation
    t.click(itemByName(win, 'elma.txt'));
    t.key(win.el, 'Delete');
    await confirmDialog(t, true);
    await t.waitFor(() => fs.trashCount() === 0);
    win.close();
  });

  T.test('çöp kutusu: kenar çubuğu rozeti ve bırakma ile silme', async (t) => {
    await fresh();
    const dir = scratch('cop3');
    fs.writeFile(`${dir}/surukle.txt`, 'x');
    fs.writeFile(`${dir}/surukle2.txt`, 'x');
    const win = launch({ path: dir });
    const trashItem = q(win, '.fm-side-item[data-path="trash:"]');
    t.ok(q(win, '.fm-badge').hidden, 'boş çöp kutusunda rozet var');
    const dt = new DataTransfer();
    const src = itemByName(win, 'surukle.txt');
    t.click(src);
    t.ok(dnd('dragstart', src, dt));
    t.ok(dt.types.includes(MIME), 'sürükleme verisi yazılmadı');
    t.eq(JSON.parse(dt.getData(MIME)), [`${dir}/surukle.txt`]);
    const over = dnd('dragover', trashItem, dt);
    t.ok(over.defaultPrevented, 'çöp kutusu bırakma hedefi değil');
    t.ok(trashItem.classList.contains('drop-target'), 'bırakma vurgusu yok');
    dnd('drop', trashItem, dt);
    dnd('dragend', src, dt);
    t.ok(!fs.exists(`${dir}/surukle.txt`));
    t.eq(fs.trashCount(), 1);
    t.eq(q(win, '.fm-badge').textContent, '1');
    t.ok(!trashItem.classList.contains('drop-target'));
    win.close();
  });

  // ------------------------------------------------------------------ drag & drop
  T.test('sürükle-bırak: klasöre taşıma / Ctrl ile kopyalama / kenar çubuğu', async (t) => {
    await fresh();
    const dir = scratch('dnd');
    fs.mkdir(`${dir}/Hedef`);
    fs.mkdir(`${dir}/Hedef2`);
    ['a.txt', 'b.txt', 'c.txt'].forEach((n) => fs.writeFile(`${dir}/${n}`, n));
    const win = launch({ path: dir });
    // multi-drag onto a folder moves both
    t.click(itemByName(win, 'a.txt'));
    t.click(itemByName(win, 'b.txt'), { ctrlKey: true });
    let dt = new DataTransfer();
    const src = itemByName(win, 'b.txt');
    dnd('dragstart', src, dt);
    t.eq(JSON.parse(dt.getData(MIME)).sort(), [`${dir}/a.txt`, `${dir}/b.txt`]);
    t.ok(win.state.fm.dragging);
    const target = itemByName(win, 'Hedef');
    const ov = dnd('dragover', target, dt);
    t.ok(ov.defaultPrevented);
    t.ok(target.classList.contains('drop-target'));
    // the dragged folder itself is not a target
    dnd('drop', target, dt);
    dnd('dragend', src, dt);
    t.ok(fs.exists(`${dir}/Hedef/a.txt`) && fs.exists(`${dir}/Hedef/b.txt`));
    t.ok(!fs.exists(`${dir}/a.txt`));
    t.eq(names(win), ['Hedef', 'Hedef2', 'c.txt'], 'liste dragend sonrası güncellenmedi');
    t.ok(!win.state.fm.dragging);
    // ctrl copies
    dt = new DataTransfer();
    const c = itemByName(win, 'c.txt');
    t.click(c);
    dnd('dragstart', c, dt);
    const ov2 = dnd('dragover', itemByName(win, 'Hedef2'), dt, { ctrlKey: true });
    t.ok(ov2.defaultPrevented);
    dnd('drop', itemByName(win, 'Hedef2'), dt, { ctrlKey: true });
    dnd('dragend', c, dt);
    t.ok(fs.exists(`${dir}/c.txt`) && fs.exists(`${dir}/Hedef2/c.txt`), 'kopyalama başarısız');
    // sidebar location as a target
    dt = new DataTransfer();
    const c2 = itemByName(win, 'c.txt');
    t.click(c2);
    dnd('dragstart', c2, dt);
    const side = q(win, `.fm-side-item[data-path="${HOME}/Resimler"]`);
    t.ok(dnd('dragover', side, dt).defaultPrevented);
    dnd('drop', side, dt);
    dnd('dragend', c2, dt);
    t.ok(fs.exists(`${HOME}/Resimler/c.txt`) && !fs.exists(`${dir}/c.txt`), 'kenar çubuğuna taşıma olmadı');
    // a folder cannot be dropped onto itself
    dt = new DataTransfer();
    const h = itemByName(win, 'Hedef');
    t.click(h);
    dnd('dragstart', h, dt);
    t.ok(!dnd('dragover', h, dt).defaultPrevented, 'klasör kendi üstüne bırakılabiliyor');
    dnd('dragend', h, dt);
    // breadcrumbs are targets too
    dt = new DataTransfer();
    const h2 = itemByName(win, 'Hedef2');
    t.click(h2);
    dnd('dragstart', h2, dt);
    const crumb = q(win, '.fm-crumb[data-path="/home/panda"]');
    t.ok(dnd('dragover', crumb, dt).defaultPrevented);
    dnd('drop', crumb, dt);
    dnd('dragend', h2, dt);
    t.ok(fs.isDir(`${HOME}/Hedef2`), 'breadcrumb hedefine taşınmadı');
    win.close();
  });

  T.test('sürükle-bırak: pencereler arası ve zemin', async (t) => {
    await fresh();
    const dir = scratch('dnd2');
    fs.mkdir(`${dir}/Kutu`);
    fs.writeFile(`${dir}/x.txt`, 'x');
    const a = launch({ path: dir });
    const b = launch({ path: `${dir}/Kutu` });
    const dt = new DataTransfer();
    const src = itemByName(a, 'x.txt');
    a.focus();
    t.click(src);
    dnd('dragstart', src, dt);
    // drop on the background of the other window
    const view = q(b, '.fm-view');
    const ov = dnd('dragover', view, dt);
    t.ok(ov.defaultPrevented, 'diğer pencere bırakmayı kabul etmiyor');
    t.ok(view.classList.contains('drop-bg'), 'zemin vurgusu yok');
    dnd('drop', view, dt);
    dnd('dragend', src, dt);
    t.ok(fs.exists(`${dir}/Kutu/x.txt`) && !fs.exists(`${dir}/x.txt`));
    t.eq(names(b), ['x.txt']);
    t.ok(!names(a).includes('x.txt'), 'kaynak pencere güncellenmedi');
    t.ok(!view.classList.contains('drop-bg'));
    // dropping onto the same folder's background is a no-op
    const dt2 = new DataTransfer();
    const s2 = itemByName(b, 'x.txt');
    t.click(s2);
    dnd('dragstart', s2, dt2);
    t.ok(!dnd('dragover', q(b, '.fm-view'), dt2).defaultPrevented, 'aynı klasöre bırakma kabul edildi');
    dnd('dragend', s2, dt2);
    // data coming from the desktop (no module state) still lands in the folder
    const dt3 = new DataTransfer();
    fs.writeFile(`${dir}/masa.txt`, 'm');
    dt3.setData(MIME, JSON.stringify([`${dir}/masa.txt`]));
    t.ok(dnd('dragover', q(b, '.fm-view'), dt3).defaultPrevented);
    dnd('drop', q(b, '.fm-view'), dt3);
    t.ok(fs.exists(`${dir}/Kutu/masa.txt`));
    // an unrelated drag is ignored
    const dt4 = new DataTransfer();
    dt4.setData('text/plain', 'merhaba');
    t.ok(!dnd('dragover', q(b, '.fm-view'), dt4).defaultPrevented);
    a.close();
    b.close();
  });

  // ------------------------------------------------------------------ live updates + lifecycle
  T.test('canlı güncelleme: seçim ve kaydırma korunur', async (t) => {
    await fresh();
    const dir = scratch('canli');
    for (let i = 1; i <= 60; i++) fs.writeFile(`${dir}/dosya-${String(i).padStart(2, '0')}.txt`, 'x');
    const win = launch({ path: dir });
    const fm = fmOf(win);
    fm.setView('details');
    const view = q(win, '.fm-view');
    t.click(itemByName(win, 'dosya-05.txt'));
    view.scrollTop = 220;
    const top = view.scrollTop;
    t.ok(top > 0, 'kaydırılamadı');
    fs.writeFile(`${dir}/yeni-dosya.txt`, 'y');
    t.ok(names(win).includes('yeni-dosya.txt'), 'yeni dosya listelenmedi');
    t.eq(selectedNames(win), ['dosya-05.txt'], 'seçim kayboldu');
    t.eq(view.scrollTop, top, 'kaydırma konumu kayboldu');
    // removing a selected item drops it from the selection
    fs.remove(`${dir}/dosya-05.txt`);
    t.eq(selectedNames(win), []);
    t.eq(status(win), '60 öğe');
    // a change elsewhere does not re-render
    const spy = view.firstElementChild;
    fs.writeFile(`${HOME}/Müzik/baska.txt`, 'z');
    t.ok(view.firstElementChild === spy, 'ilgisiz değişiklik yeniden çizdi');
    // renaming a selected item from outside keeps it selected
    t.click(itemByName(win, 'dosya-06.txt'));
    fs.rename(`${dir}/dosya-06.txt`, 'adi-degisti.txt');
    t.eq(selectedNames(win), ['adi-degisti.txt']);
    win.close();
  });

  T.test('canlı güncelleme: açık klasör yeniden adlandırılır / silinir', async (t) => {
    await fresh();
    const dir = scratch('izle');
    fs.mkdir(`${dir}/Alt`);
    const win = launch({ path: `${dir}/Alt` });
    const fm = fmOf(win);
    fs.rename(`${dir}/Alt`, 'Yeni Ad');
    t.eq(fm.cwd, `${dir}/Yeni Ad`, 'yeniden adlandırma izlenmedi');
    t.eq(win.getTitle(), 'Yeni Ad');
    t.eq(crumbs(win).slice(-1), ['Yeni Ad']);
    fs.remove(`${dir}/Yeni Ad`, { recursive: true });
    t.eq(fm.cwd, dir, 'silinen klasörde üst klasöre dönülmedi');
    t.eq(win.getTitle(), 'izle');
    // back through a deleted history entry lands on the nearest existing folder
    t.click(q(win, '.fm-nav[data-nav="back"]'));
    t.ok(fs.isDir(fm.cwd));
    win.close();
  });

  T.test('pencere kapanınca dinleyiciler kaldırılır', async (t) => {
    await fresh();
    const win = launch();
    const fm = fmOf(win);
    let calls = 0;
    const orig = fm.refresh.bind(fm);
    fm.refresh = (...a) => { calls++; return orig(...a); };
    fs.mkdir(`${HOME}/canli-test`);
    t.ok(calls > 0, 'açıkken dinlemiyor');
    const n = calls;
    win.close();
    await t.sleep(30);
    t.ok(fm.closed);
    fs.mkdir(`${HOME}/canli-test-2`);
    P.clipboard.set({ op: 'copy', paths: [`${HOME}/Belgeler/Notlar.txt`] });
    P.clipboard.clear();
    t.eq(calls, n, 'kapalı pencere fs:change dinlemeye devam ediyor');
    // timers / band listeners are gone as well
    t.eq(fm.timers.size, 0);
    t.eq(fm.bandOff, null);
  });

  T.test('kapanış: devam eden seçim dikdörtgeni ve menüler temizlenir', async (t) => {
    await fresh();
    const win = launch();
    const view = q(win, '.fm-view');
    const vr = view.getBoundingClientRect();
    t.mouse(view, 'mousedown', { clientX: vr.left + 400, clientY: vr.top + 300, button: 0, buttons: 1 });
    t.mouse(document.body, 'mousemove', { clientX: vr.left + 100, clientY: vr.top + 100, buttons: 1 });
    t.ok(fmOf(win).bandOff, 'band başlamadı');
    t.click(cmd(win, 'sort'));
    t.ok(P.contextMenu.isOpen());
    const fm = fmOf(win);
    win.close();
    await t.sleep(30);
    t.ok(!P.contextMenu.isOpen(), 'menü açık kaldı');
    t.mouse(document.body, 'mousemove', { clientX: vr.left + 50, clientY: vr.top + 50, buttons: 1 });
    t.mouse(document.body, 'mouseup', { clientX: vr.left + 50, clientY: vr.top + 50, button: 0 });
    t.eq(fm.bandOff, null);
  });

  T.test('araç çubuğu menüleri: aynı düğmeye tekrar basınca kapanır', async (t) => {
    await fresh();
    const win = launch();
    const b = cmd(win, 'sort');
    t.click(b);
    t.ok(P.contextMenu.isOpen());
    t.ok(b.classList.contains('open'));
    t.click(b);
    t.ok(!P.contextMenu.isOpen(), 'ikinci basış menüyü kapatmadı');
    t.ok(!b.classList.contains('open'));
    t.click(b);
    t.ok(P.contextMenu.isOpen(), 'üçüncü basış yeniden açmadı');
    // another button switches menus
    t.click(cmd(win, 'view'));
    t.eq(ctxLabels(0)[0], 'Büyük simgeler');
    P.contextMenu.hide();
    win.close();
  });

  // ------------------------------------------------------------------ responsive
  T.test('küçük pencere: kenar çubuğu daralır, sütunlar gizlenir, simge etiketleri kalkar', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    const fm = fmOf(win);
    fm.setView('details');
    t.eq(qa(win, '.fm-head .fm-col').length, 4);
    win.setSize(520, 340);
    await t.sleep(60);
    fm.applyLayout();
    const b = win.body;
    t.ok(b.classList.contains('fm-compact'), 'kenar çubuğu daralmadı');
    t.ok(b.classList.contains('fm-tiny'));
    t.ok(qa(win, '.fm-head .fm-col').length < 4, 'dar pencerede sütunlar gizlenmedi');
    t.eq(win.getBounds().width, 520);
    t.ok(q(win, '.fm-side').getBoundingClientRect().width < 70);
    t.ok(!q(win, '.fm-cmdbar').scrollWidth || q(win, '.fm-cmdbar').scrollWidth <= q(win, '.fm-cmdbar').clientWidth + 1, 'komut çubuğu taşıyor');
    // the min size is enforced by the window manager
    win.setSize(300, 200);
    t.eq([win.getBounds().width, win.getBounds().height], [520, 340]);
    win.setSize(1100, 700);
    await t.sleep(60);
    fm.applyLayout();
    t.ok(!b.classList.contains('fm-compact') && !b.classList.contains('fm-tiny'));
    t.eq(qa(win, '.fm-head .fm-col').length, 4);
    win.close();
  });

  T.test('sütun genişliği sürükleyerek değiştirilir ve saklanır', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    const fm = fmOf(win);
    fm.setView('details');
    const col = q(win, '.fm-col[data-col="type"]');
    const w0 = col.getBoundingClientRect().width;
    const grip = col.querySelector('.fm-grip');
    t.mouse(grip, 'mousedown', { button: 0, buttons: 1 });
    const r = grip.getBoundingClientRect();
    t.mouse(document.body, 'mousemove', { clientX: r.left + 40, clientY: r.top + 5, buttons: 1 });
    t.mouse(document.body, 'mouseup', { clientX: r.left + 40, clientY: r.top + 5, button: 0 });
    const w1 = q(win, '.fm-col[data-col="type"]').getBoundingClientRect().width;
    t.ok(w1 > w0 + 20, `sütun genişlemedi (${w0} → ${w1})`);
    t.ok(P.storage.get('app.files').cols.type > 0);
    // the drag did not sort
    t.eq(fm.prefs.sort.key, 'name');
    win.close();
  });

  T.test('küçük resim önizlemesi ve simgeler', async (t) => {
    await fresh();
    const dir = scratch('resim');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    fs.writeFile(`${dir}/pembe.png`, png);
    fs.writeFile(`${dir}/not.txt`, 'x');
    const win = launch({ path: dir });
    const img = itemByName(win, 'pembe.png').querySelector('img.fm-thumb');
    t.ok(img, 'png için önizleme yok');
    t.eq(img.getAttribute('src'), png);
    t.ok(!itemByName(win, 'not.txt').querySelector('img'));
    t.ok(itemByName(win, 'not.txt').querySelector('.fm-ico svg'));
    fmOf(win).setView('details');
    t.ok(!itemByName(win, 'pembe.png').querySelector('img'), 'ayrıntılarda önizleme gösterilmemeli');
    win.close();
  });

  T.test('klavye menü tuşu ve Alt+Enter özellikler', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    t.click(itemByName(win, 'Notlar.txt'));
    t.key(win.el, 'ContextMenu');
    t.ok(P.contextMenu.isOpen(), 'ContextMenu tuşu menü açmadı');
    t.ok(ctxLabels(0).includes('Aç'));
    P.contextMenu.hide();
    t.key(win.el, 'Enter', { altKey: true });
    await t.waitFor(() => P.dialog.isOpen(), 2000, 'özellikler açılmadı');
    P.dialog.closeAll();
    win.close();
  });

  T.test('Escape: önce seçimi, sonra aramayı temizler; tooltip title kullanılmaz', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    t.eq(qa(win, '[title]').length, 0, 'yerel title özniteliği kullanılmış');
    t.click(itemByName(win, 'Notlar.txt'));
    t.key(win.el, 'Escape');
    t.eq(selectedNames(win), []);
    win.close();
  });

  T.test('depolama: görünüm ve sıralama kullanıcı başına saklanır', async (t) => {
    await fresh();
    let win = launch({ path: DOCS });
    const fm = fmOf(win);
    fm.setView('large');
    fm.setSort('size', 'desc');
    win.close();
    const saved = P.storage.get('app.files');
    t.eq([saved.view, saved.sort.key, saved.sort.dir], ['large', 'size', 'desc']);
    win = launch({ path: DOCS });
    t.eq(fmOf(win).prefs.view, 'large');
    t.eq(fmOf(win).prefs.sort, { key: 'size', dir: 'desc' });
    t.eq(q(win, '.fm-view').dataset.size, 'large');
    // two windows changing different settings never overwrite each other
    const other = launch({ path: DOCS });
    fmOf(win).setView('details');
    fmOf(other).toggleHidden();
    const merged = P.storage.get('app.files');
    t.eq([merged.view, merged.hidden], ['details', true], 'ikinci pencere ayarları ezdi');
    other.close();
    win.close();
  });

  // ------------------------------------------------------------------ more behaviours
  T.test('taşıma çakışması: aynı adlı öğe → "İkisini de tut" / "Atla"', async (t) => {
    await fresh();
    const dir = scratch('cakisma');
    fs.mkdir(`${dir}/Alt`);
    fs.writeFile(`${dir}/x.txt`, 'ust');
    fs.writeFile(`${dir}/Alt/x.txt`, 'alt');
    fs.writeFile(`${dir}/y.txt`, 'y');
    fs.writeFile(`${dir}/Alt/y.txt`, 'alt-y');
    const win = launch({ path: dir });
    // cut x.txt, paste into Alt → conflict dialog; "Atla" leaves everything as it is
    t.click(itemByName(win, 'x.txt'));
    t.key(win.el, 'x', { ctrlKey: true });
    t.contextmenu(itemByName(win, 'Alt'));
    ctxClick(t, 'Klasöre yapıştır');
    await t.waitFor(() => P.dialog.isOpen(), 2000, 'çakışma penceresi açılmadı');
    t.ok(/zaten var/.test(document.querySelector('#dialog-layer').textContent));
    t.click(document.querySelector('#dialog-layer .dlg-btn:not(.dlg-primary)'));
    await t.waitFor(() => !P.dialog.isOpen());
    t.eq(fs.readFile(`${dir}/x.txt`), 'ust');
    t.eq(fs.readFile(`${dir}/Alt/x.txt`), 'alt');
    t.ok(P.clipboard.get(), 'iptal edilen taşımada pano korunmalı');
    // paste again and keep both
    t.contextmenu(itemByName(win, 'Alt'));
    ctxClick(t, 'Klasöre yapıştır');
    await t.waitFor(() => P.dialog.isOpen());
    t.click(document.querySelector('#dialog-layer .dlg-primary'));
    await t.waitFor(() => !fs.exists(`${dir}/x.txt`), 2000, 'özgün dosya taşınmadı');
    t.eq(fs.readFile(`${dir}/Alt/x.txt`), 'alt');
    t.eq(fs.readFile(`${dir}/Alt/x (kopya).txt`), 'ust', 'kopya adıyla eklenmedi');
    t.eq(P.clipboard.get(), null);
    // the same through drag & drop
    const dt = new DataTransfer();
    const src = itemByName(win, 'y.txt');
    t.click(src);
    dnd('dragstart', src, dt);
    const target = itemByName(win, 'Alt');
    t.ok(dnd('dragover', target, dt).defaultPrevented);
    dnd('drop', target, dt);
    dnd('dragend', src, dt);
    await t.waitFor(() => P.dialog.isOpen(), 2000, 'sürüklemede çakışma sorulmadı');
    t.click(document.querySelector('#dialog-layer .dlg-primary'));
    await t.waitFor(() => !fs.exists(`${dir}/y.txt`));
    t.ok(fs.exists(`${dir}/Alt/y (kopya).txt`));
    win.close();
  });

  T.test('orta tık: klasör yeni pencerede açılır', async (t) => {
    await fresh();
    const win = launch();
    const launched = [];
    const orig = P.apps.launch;
    P.apps.launch = (id, args) => { launched.push([id, args]); return null; };
    try {
      t.mouse(itemByName(win, 'Belgeler'), 'auxclick', { button: 1 });
      t.mouse(q(win, `.fm-side-item[data-path="${HOME}/Müzik"]`), 'auxclick', { button: 1 });
      t.mouse(q(win, '.fm-crumb[data-path="/home"]'), 'auxclick', { button: 1 });
    } finally { P.apps.launch = orig; }
    t.eq(launched, [['files', { path: DOCS }], ['files', { path: `${HOME}/Müzik` }], ['files', { path: '/home' }]]);
    t.eq(fmOf(win).cwd, HOME, 'asıl pencere gezinmemeli');
    win.close();
  });

  T.test('Ctrl + tekerlek: görünüm kipleri arasında gezinir', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    const fm = fmOf(win);
    const view = q(win, '.fm-view');
    const wheel = (dy) => view.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: dy }));
    t.eq(fm.prefs.view, 'medium');
    t.ok(!wheel(100), 'tarayıcı yakınlaştırması engellenmedi');
    t.eq(fm.prefs.view, 'details');
    await t.sleep(200);
    wheel(-100);
    t.eq(fm.prefs.view, 'medium');
    await t.sleep(200);
    wheel(-100);
    t.eq(fm.prefs.view, 'large');
    await t.sleep(200);
    wheel(-100);
    t.eq(fm.prefs.view, 'large', 'üst sınır aşıldı');
    // without Ctrl the wheel is left alone
    t.ok(view.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })));
    win.close();
  });

  T.test('ayrıntılar görünümünde yeni öğe + yeniden adlandırma + arama vurgusu', async (t) => {
    await fresh();
    const dir = scratch('detay');
    const win = launch({ path: dir });
    const fm = fmOf(win);
    fm.setView('details');
    t.click(cmd(win, 'new'));
    ctxClick(t, 'Metin belgesi');
    const input = q(win, '.fm-row .fm-rename');
    t.ok(input, 'satırda ad düzenleme yok');
    t.eq(input.tagName, 'INPUT');
    t.eq([input.selectionStart, input.selectionEnd], [0, 'Yeni Metin Belgesi'.length]);
    input.value = 'Rapor-Özet.txt';
    t.key(input, 'Enter');
    t.ok(fs.isFile(`${dir}/Rapor-Özet.txt`));
    t.eq(selectedNames(win), ['Rapor-Özet.txt']);
    // search: the match is emphasised, case-insensitive (Turkish folding)
    const si = q(win, '.fm-search-input');
    t.type(si, 'özet');
    t.key(si, 'Enter');
    t.eq(names(win), ['Rapor-Özet.txt']);
    const hit = q(win, '.fm-row .fm-nm mark.fm-hit');
    t.ok(hit, 'eşleşme vurgulanmadı');
    t.eq(hit.textContent, 'Özet');
    t.eq(q(win, '.fm-row .fm-nm').textContent, 'Rapor-Özet.txt');
    win.close();
  });

  T.test('liste düğümleri yeniden kullanılır, değişen öğe yeniden çizilir', async (t) => {
    await fresh();
    const dir = scratch('dugum');
    fs.writeFile(`${dir}/a.txt`, 'a');
    fs.writeFile(`${dir}/b.txt`, 'b');
    const win = launch({ path: dir });
    const a = itemByName(win, 'a.txt');
    const b = itemByName(win, 'b.txt');
    fs.writeFile(`${dir}/c.txt`, 'c');
    t.ok(itemByName(win, 'a.txt') === a && itemByName(win, 'b.txt') === b, 'değişmeyen öğeler yeniden oluşturuldu');
    fs.writeFile(`${dir}/a.txt`, 'a değişti');
    t.ok(itemByName(win, 'a.txt') !== a, 'değişen dosya yeniden çizilmedi');
    t.ok(itemByName(win, 'b.txt') === b);
    t.click(b);
    t.ok(itemByName(win, 'b.txt').classList.contains('selected'));
    fs.remove(`${dir}/c.txt`);
    t.ok(itemByName(win, 'b.txt').classList.contains('selected'), 'seçim sınıfı kayboldu');
    win.close();
  });

  T.test('klasör açma: Enter, birden çok klasör, kenar çubuğunda silinmiş klasör', async (t) => {
    await fresh();
    const win = launch();
    const fm = fmOf(win);
    t.click(itemByName(win, 'Müzik'));
    t.key(win.el, 'Enter');
    t.eq(fm.cwd, `${HOME}/Müzik`);
    t.eq(names(win), ['Neşeye Övgü.pmus']);
    t.ok(itemByName(win, 'Neşeye Övgü.pmus').querySelector('svg'));
    // a missing quick-access folder: error, stays where it is
    fs.remove(`${HOME}/İndirilenler`, { recursive: true });
    const n0 = P.notify.history().length;
    t.click(q(win, `.fm-side-item[data-path="${HOME}/İndirilenler"]`));
    t.eq(fm.cwd, `${HOME}/Müzik`);
    t.ok(P.notify.history().length > n0, 'hata bildirimi yok');
    // several folders selected + Enter opens one window each
    fm.go(HOME);
    t.key(win.el, 'a', { ctrlKey: true });
    const launched = [];
    const orig = P.apps.launch;
    P.apps.launch = (id, args) => { launched.push([id, args]); return null; };
    try { t.key(win.el, 'Enter'); } finally { P.apps.launch = orig; }
    t.eq(launched.length, 4, 'her klasör için pencere açılmadı');
    t.ok(launched.every(([id]) => id === 'files'));
    win.close();
  });

  T.test('olay işleyicileri hata fırlatmaz', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    const fm = fmOf(win);
    const orig = console.error;
    let logged = 0;
    console.error = () => { logged++; };
    let threw = false;
    try {
      fm.entries = null; // corrupt the state on purpose
      try { fm.onKey({ key: 'ArrowRight', target: win.el, preventDefault() {} }); } catch (e) { threw = true; }
    } finally { console.error = orig; }
    t.ok(!threw, 'işleyici hata fırlattı');
    t.ok(logged > 0, 'hata günlüğe yazılmadı');
    t.ok(lastNotice() && /hata/i.test(lastNotice().title), 'kullanıcıya bildirilmedi');
    fm.refresh({ full: true, force: true });
    win.close();
  });

  T.test('küçük pencere: kısa pencerede sıkışık düzen', async (t) => {
    await fresh();
    const win = launch({ path: DOCS });
    win.setSize(700, 340);
    await t.sleep(60);
    fmOf(win).applyLayout();
    t.ok(win.body.classList.contains('fm-short'), 'kısa pencere sınıfı yok');
    win.setSize(880, 560);
    await t.sleep(60);
    fmOf(win).applyLayout();
    t.ok(!win.body.classList.contains('fm-short'));
    win.close();
  });

  T.test('çöp kutusu: Sırala menüsü sütunları, Yenile ve boşalt menü öğeleri', async (t) => {
    await fresh();
    const win = launch({ path: 'trash:' });
    t.click(cmd(win, 'sort'));
    t.eq(ctxLabels(0), ['Ad', 'Özgün konum', 'Silinme tarihi', 'Boyut', 'Artan', 'Azalan']);
    t.ok(ctxItem('Silinme tarihi').classList.contains('checked'));
    ctxClick(t, 'Artan');
    t.eq(fmOf(win).trashSort, { key: 'deleted', dir: 'asc' });
    t.contextmenu(q(win, '.fm-view'));
    t.eq(ctxLabels(0), ['Sırala', 'Yenile', 'Çöp kutusunu boşalt']);
    t.ok(ctxItem('Çöp kutusunu boşalt').classList.contains('disabled'), 'boş çöpte boşalt açık');
    P.contextMenu.hide();
    // sidebar context menu
    t.contextmenu(q(win, '.fm-side-item[data-path="trash:"]'));
    t.ok(ctxLabels(0).includes('Çöp kutusunu boşalt'));
    P.contextMenu.hide();
    win.close();
  });

  T.test('başlık çubuğundaki simge çöp kutusunda değişir', async (t) => {
    await fresh();
    const dir = scratch('simge');
    fs.writeFile(`${dir}/x.txt`, 'x');
    const win = launch({ path: dir });
    t.eq(win.getIcon(), 'files');
    fmOf(win).go('trash:');
    t.eq(win.getIcon(), 'trash');
    fs.trash(`${dir}/x.txt`);
    t.eq(win.getIcon(), 'trash-full');
    fmOf(win).go(dir);
    t.eq(win.getIcon(), 'files');
    win.close();
  });

  T.test('gerçek bilgisayardan bırakılan metin / resim dosyaları içe aktarılır', async (t) => {
    await fresh();
    const dir = scratch('ice');
    fs.mkdir(`${dir}/Hedef`);
    const win = launch({ path: dir });
    const mk = () => {
      const dt = new DataTransfer();
      dt.items.add(new File(['merhaba dünya'], 'selam.txt', { type: 'text/plain' }));
      dt.items.add(new File(['MZ'], 'garip.exe', { type: 'application/octet-stream' }));
      return dt;
    };
    const view = q(win, '.fm-view');
    let dt = mk();
    const ov = dnd('dragover', view, dt);
    t.ok(ov.defaultPrevented, 'dosya bırakma kabul edilmedi');
    t.ok(view.classList.contains('drop-bg'));
    dnd('drop', view, dt);
    await t.waitFor(() => fs.exists(`${dir}/selam.txt`), 3000, 'metin dosyası aktarılmadı');
    t.eq(fs.readFile(`${dir}/selam.txt`), 'merhaba dünya');
    t.ok(!fs.exists(`${dir}/garip.exe`), 'desteklenmeyen dosya aktarıldı');
    await t.waitFor(() => P.notify.history().some((n) => /desteklenmiyor/.test(n.message)), 2000, 'hata bildirimi yok');
    t.eq(selectedNames(win), ['selam.txt']);
    // onto a folder item; same name gets a number
    dt = mk();
    const hedef = itemByName(win, 'Hedef');
    t.ok(dnd('dragover', hedef, dt).defaultPrevented);
    t.ok(hedef.classList.contains('drop-target'));
    dnd('drop', hedef, dt);
    await t.waitFor(() => fs.exists(`${dir}/Hedef/selam.txt`), 3000);
    // an image becomes a data URL
    const img = new DataTransfer();
    img.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'resim.png', { type: 'image/png' }));
    dnd('drop', view, img);
    await t.waitFor(() => fs.exists(`${dir}/resim.png`), 3000, 'resim aktarılmadı');
    t.ok(/^data:image\/png;base64,/.test(fs.readFile(`${dir}/resim.png`)));
    // not accepted in the trash or while searching
    win.state.fm.go('trash:');
    dnd('dragover', q(win, '.fm-view'), mk());
    t.ok(!q(win, '.fm-view').classList.contains('drop-bg'), 'çöp kutusu dosya kabul ediyor');
    dnd('drop', q(win, '.fm-view'), mk());
    await t.sleep(80);
    t.eq(fs.trashCount(), 0);
    win.close();
  });

  T.test('geri / yukarı: klasörün kaydırma konumu geri gelir', async (t) => {
    await fresh();
    const dir = scratch('kaydir');
    for (let i = 1; i <= 80; i++) fs.writeFile(`${dir}/dosya-${String(i).padStart(2, '0')}.txt`, 'x');
    fs.mkdir(`${dir}/Alt`);
    const win = launch({ path: dir });
    const fm = fmOf(win);
    fm.setView('details');
    const view = q(win, '.fm-view');
    view.scrollTop = 300;
    const at = view.scrollTop;
    t.ok(at > 100, 'kaydırılamadı');
    fm.go(`${dir}/Alt`);
    t.eq(view.scrollTop, 0, 'yeni klasör en üstten başlamalı');
    t.click(q(win, '.fm-nav[data-nav="back"]'));
    t.eq(fm.cwd, dir);
    t.eq(view.scrollTop, at, 'geri dönüşte kaydırma konumu kayboldu');
    win.close();
  });
}());
