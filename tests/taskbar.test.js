/* Taskbar, start menu, calendar, quick settings and notification center tests (C3b).
   Extra mode for screenshots: add "shot=<name>" to the URL (start, search, calendar, notifications,
   quick, windows, power, taskbar, menu) and the suite only prepares that UI state and leaves it open. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const DUMMY = 'tbdummy';
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const pad = (n) => String(n).padStart(2, '0');
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const hasNotify = () => typeof P.notify === 'function' && typeof P.notify.history === 'function';

  // ------------------------------------------------------------------ setup helpers
  function ensureDummy() {
    if (P.apps.get(DUMMY)) return;
    P.apps.register({
      id: DUMMY,
      name: 'Panda Deneme Uygulaması',
      icon: 'folder',
      description: 'Görev çubuğu testi için sahte uygulama',
      category: 'utilities',
      launch(win, args) {
        win.body.textContent = 'tbdummy';
        if (args && args.title) win.setTitle(args.title);
      }
    });
  }

  const restores = [];
  function patch(obj, key, value) {
    const orig = obj[key];
    obj[key] = value;
    restores.push(() => { obj[key] = orig; });
    return orig;
  }

  function closeAllWindows() {
    if (!P.wm || !P.wm.list) return;
    P.wm.list().slice().forEach((w) => { try { w.forceClose(); } catch (e) { /* ignore */ } });
  }

  async function cleanup(t) {
    while (restores.length) restores.pop()();
    if (P.startMenu) P.startMenu.close();
    if (P.taskbar) P.taskbar.closePanel();
    closeAllWindows();
    P.settings.set('taskbar.pinned', P.settings.DEFAULTS['taskbar.pinned'].slice());
    P.settings.set('dnd', false);
    P.settings.set('muted', false);
    P.settings.set('clock24h', true);
    P.settings.set('showSeconds', false);
    P.settings.set('animations', true);
    P.storage.remove('recent');
    P.storage.set('brightness', 100);
    if (hasNotify() && typeof P.notify.clear === 'function') P.notify.clear();
    if (t) await t.sleep(10);
  }

  function T(name, fn) {
    PandaTest.test(name, async (t) => {
      ensureDummy();
      await cleanup(t);
      try { await fn(t); } finally { await cleanup(t); }
    });
  }

  const btn = (id) => q(`#taskbar .tb-app[data-app="${id}"]:not(.leaving)`);
  const dummyWins = () => P.wm.list().filter((w) => w.appId === DUMMY);
  const pinOnly = (list) => P.settings.set('taskbar.pinned', list);
  const startOpen = () => !!q('#start-menu .sm-panel.open');
  const panelOpen = (cls) => !!q(`#panels .${cls}.open`);

  // ------------------------------------------------------------------ screenshot mode
  const shot = P.params.get('shot');
  if (shot) {
    PandaTest.test('ekran görüntüsü hazırlığı: ' + shot, async (t) => {
      ensureDummy();
      if (P.params.get('anim') === '0') P.settings.set('animations', false);
      const fs = P.fs;
      // sample content
      if (fs) {
        try {
          fs.writeFile('/home/panda/Belgeler/Proje Notları.txt', 'Merhaba');
          fs.writeFile('/home/panda/Belgeler/Bütçe 2026.csv', 'a,b');
          fs.writeFile('/home/panda/Belgeler/Toplantı Özeti.md', '# Özet');
        } catch (e) { /* ignore */ }
        ['/home/panda/Belgeler/Proje Notları.txt', '/home/panda/Belgeler/Bütçe 2026.csv', '/home/panda/Belgeler/Toplantı Özeti.md', '/home/panda/Belgeler/Notlar.txt']
          .forEach((p) => { if (fs.exists(p)) P.bus.emit('apps:launch', { id: 'notepad', args: { path: p } }); });
      }
      const launch = (id) => (P.apps.get(id) ? P.apps.launch(id) : P.apps.launch(DUMMY));
      if (['taskbar', 'windows', 'menu', 'power', 'start', 'search', 'quick', 'calendar', 'notifications'].includes(shot)) {
        launch('files');
        launch('terminal');
        launch('notepad');
        if (shot === 'windows' || shot === 'taskbar') { P.apps.launch(DUMMY); P.apps.launch(DUMMY); P.apps.launch(DUMMY); }
      }
      if (hasNotify() && ['notifications', 'quick', 'taskbar', 'calendar', 'start'].includes(shot)) {
        P.settings.set('dnd', true); // history only, no toasts covering the shot
        P.notify({ title: 'Güncelleme hazır', message: 'PandaOS 1.0.1 yüklenmeye hazır. Yeniden başlatınca uygulanacak.', icon: 'info' });
        P.notify({ title: 'Müzik Çalar', message: 'Neşeye Övgü çalıyor — L. v. Beethoven', icon: 'music', appId: 'music' });
        P.notify({ title: 'Dosya kaydedildi', message: 'Proje Notları.txt Belgeler klasörüne kaydedildi.', icon: 'file-text', appId: 'notepad' });
        P.notify({ title: 'Zamanlayıcı bitti', message: 'Çay demlendi.', icon: 'clock', appId: 'clock' });
        P.settings.set('dnd', shot === 'notifications' && P.params.get('dnd') === '1');
      }
      await t.sleep(300);
      if (shot === 'start') P.startMenu.open();
      else if (shot === 'search') {
        P.startMenu.open();
        const input = q('.sm-input');
        t.type(input, P.params.get('q') || 'not');
      } else if (shot === 'power') {
        P.startMenu.open();
        t.click(q('.sm-power'));
      } else if (shot === 'calendar') P.taskbar.openPanel('calendar');
      else if (shot === 'notifications') P.taskbar.openPanel('notifications');
      else if (shot === 'quick') P.taskbar.openPanel('quicksettings');
      else if (shot === 'windows') {
        const b = btn(DUMMY);
        t.mouse(b, 'mouseenter');
        await t.sleep(700);
      } else if (shot === 'taskbar') {
        t.mouse(btn('files') || btn(DUMMY), 'mouseenter');
        await t.sleep(900);
      } else if (shot === 'menu') {
        const b = btn('files') || btn(DUMMY);
        t.contextmenu(b);
        await t.sleep(300);
      }
      await t.sleep(600);
    });
    return;
  }

  // ------------------------------------------------------------------ taskbar
  T('görev çubuğu çizilir: başlat, tepsi, saat', (t) => {
    t.ok(q('#taskbar .tb-bar'), 'bar yok');
    t.ok(q('#taskbar .tb-start'), 'başlat düğmesi yok');
    t.ok(q('#taskbar .tb-start svg'), 'başlat düğmesinde logo yok');
    t.ok(q('#taskbar .tb-sys'), 'hızlı ayarlar düğmesi yok');
    t.ok(q('#taskbar .tb-bell'), 'zil yok');
    t.ok(q('#taskbar .tb-show-desktop'), 'masaüstünü göster şeridi yok');
    const now = new Date();
    t.ok(/^\d{2}:\d{2}$/.test(q('.tb-clock-time').textContent), 'saat biçimi: ' + q('.tb-clock-time').textContent);
    t.eq(q('.tb-clock-date').textContent, `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`, 'tarih biçimi');
    t.eq(Math.round(q('.tb-show-desktop').getBoundingClientRect().width), 6, 'sliver 6px');
    const tb = q('#taskbar').getBoundingClientRect();
    t.eq(Math.round(tb.height), 48, 'görev çubuğu yüksekliği');
  });

  T('sabitlenmiş uygulamalar çizilir ve ayardan güncellenir', async (t) => {
    pinOnly([DUMMY]);
    t.ok(btn(DUMMY), 'sabitlenmiş düğme yok');
    t.ok(!btn(DUMMY).classList.contains('running'), 'çalışmıyorken gösterge olmamalı');
    t.eq(btn(DUMMY).getAttribute('aria-label'), 'Panda Deneme Uygulaması');
    pinOnly([]);
    t.ok(!btn(DUMMY), 'kaldırılan sabit düğme gitmeli');
    pinOnly(['olmayan-uygulama', DUMMY]);
    t.ok(btn(DUMMY) && !q('#taskbar .tb-app[data-app="olmayan-uygulama"]'), 'kayıtsız uygulama çizilmemeli');
  });

  T('açılan uygulama gösterge çubuğu alır, kapanınca kaybolur', async (t) => {
    pinOnly([]);
    t.ok(!btn(DUMMY));
    const win = P.apps.launch(DUMMY);
    t.ok(win, 'uygulama açılmadı');
    t.ok(btn(DUMMY), 'çalışan uygulama için düğme yok');
    t.ok(btn(DUMMY).classList.contains('running'), 'running sınıfı yok');
    t.ok(btn(DUMMY).classList.contains('active'), 'odaklı pencere için active yok');
    t.ok(q('.tb-pill', btn(DUMMY)), 'gösterge çubuğu yok');
    win.forceClose();
    t.ok(!btn(DUMMY), 'pencere kapanınca düğme gitmeli');
  });

  T('düğmeye tıklama: aç, küçült, geri getir', async (t) => {
    pinOnly([DUMMY]);
    t.eq(dummyWins().length, 0);
    t.click(btn(DUMMY));
    await t.waitFor(() => dummyWins().length === 1, 2000, 'tıklayınca uygulama açılmadı');
    const win = dummyWins()[0];
    t.ok(win.isFocused(), 'yeni pencere odakta olmalı');
    t.click(btn(DUMMY));
    await t.waitFor(() => win.isMinimized(), 2000, 'odaklı pencere küçültülmedi');
    t.ok(!btn(DUMMY).classList.contains('active'), 'küçültülünce active kalkmalı');
    t.ok(btn(DUMMY).classList.contains('running'), 'küçültülmüş pencere running kalmalı');
    t.click(btn(DUMMY));
    await t.waitFor(() => !win.isMinimized() && win.isFocused(), 2000, 'pencere geri yüklenmedi');
    t.eq(dummyWins().length, 1, 'ikinci pencere açılmamalı');
    // an unfocused, non-minimized window is just focused
    const other = P.apps.launch('files') || P.apps.launch('calculator');
    if (other) {
      await t.waitFor(() => !win.isFocused());
      t.click(btn(DUMMY));
      await t.waitFor(() => win.isFocused(), 2000, 'odaksız pencere öne gelmedi');
      t.ok(!win.isMinimized());
    }
  });

  T('getButtonRect: düğmenin dikdörtgenini verir', async (t) => {
    pinOnly([DUMMY]);
    const win = P.apps.launch(DUMMY);
    const r = P.taskbar.getButtonRect(win.id);
    t.ok(r && r.width > 20 && r.height > 20, 'dikdörtgen geçersiz');
    const b = btn(DUMMY).getBoundingClientRect();
    t.eq([Math.round(r.left), Math.round(r.top)], [Math.round(b.left), Math.round(b.top)], 'konum düğmeyle aynı olmalı');
    t.ok(r.top > window.innerHeight - 60, 'görev çubuğu içinde olmalı');
    t.eq(P.taskbar.getButtonRect('yok-boyle-bir-pencere'), null);
    // not pinned: the button is created on demand
    pinOnly([]);
    const r2 = P.taskbar.getButtonRect(win.id);
    t.ok(r2 && r2.width > 0, 'sabitsiz uygulama için de dikdörtgen gerekli');
  });

  T('çoklu pencere: istif işareti ve pencere listesi', async (t) => {
    pinOnly([DUMMY]);
    const w1 = P.apps.launch(DUMMY, { title: 'Birinci' });
    const w2 = P.apps.launch(DUMMY, { title: 'İkinci' });
    t.ok(btn(DUMMY).classList.contains('multi'), 'multi sınıfı yok');
    t.click(btn(DUMMY));
    await t.waitFor(() => q('#panels .tb-wl.open'), 1500, 'pencere listesi açılmadı');
    const rows = qa('#panels .tb-wl .tb-wl-row');
    t.eq(rows.length, 2);
    t.eq(rows.map((r) => q('.tb-wl-title', r).textContent).sort(), ['Birinci', 'İkinci']);
    t.ok(w2.isFocused(), 'son pencere odakta');
    // pick the older window
    t.click(rows.find((r) => q('.tb-wl-title', r).textContent === 'Birinci'));
    await t.waitFor(() => w1.isFocused(), 1500, 'listeden seçilen pencere odaklanmadı');
    t.ok(!q('#panels .tb-wl.open'), 'seçince liste kapanmalı');
    // close via ×
    t.click(btn(DUMMY));
    await t.waitFor(() => q('#panels .tb-wl.open'));
    t.click(q('#panels .tb-wl .tb-wl-row .tb-wl-x'));
    await t.waitFor(() => dummyWins().length === 1, 1500, '× pencereyi kapatmadı');
    await t.waitFor(() => !q('#panels .tb-wl.open'), 1500, 'tek pencere kalınca liste kapanmalı');
  });

  T('sürükleyerek yeniden sıralama: sabitli düğmeler ve tıklama bastırma', async (t) => {
    const ids = ['tbdrag1', 'tbdrag2', 'tbdrag3'];
    ids.forEach((id, i) => {
      if (!P.apps.get(id)) P.apps.register({ id, name: 'Sürükle ' + (i + 1), icon: 'folder', showInStartMenu: false, launch() {} });
    });
    pinOnly(ids);
    const order = () => qa('#taskbar .tb-app:not(.leaving)').map((b) => b.dataset.app);
    t.eq(order(), ids);
    t.drag(btn('tbdrag1'), 3, 0); // too small: stays a click
    t.eq(order(), ids, 'küçük hareket sıralamayı değiştirmemeli');
    t.drag(btn('tbdrag1'), 100, 0);
    t.eq(order(), ['tbdrag2', 'tbdrag3', 'tbdrag1'], 'ilk düğme sona taşınmalı');
    t.eq(P.settings.get('taskbar.pinned'), ['tbdrag2', 'tbdrag3', 'tbdrag1'], 'sıra ayara yazılmalı');
    t.ok(!qa('#taskbar .tb-app').some((b) => b.style.transform || b.classList.contains('dragging') || b.classList.contains('shiftable')), 'sürükleme artıkları temizlenmeli');
    // the click right after a drag must not launch the app
    btn('tbdrag1').click();
    t.eq(P.wm.list().filter((w) => w.appId === 'tbdrag1').length, 0, 'sürükleme sonrası tıklama bastırılmalı');
    await t.sleep(100);
    btn('tbdrag1').click();
    t.eq(P.wm.list().filter((w) => w.appId === 'tbdrag1').length, 1, 'normal tıklama çalışmalı');
    // drag back to the left
    await t.sleep(10);
    t.drag(btn('tbdrag1'), -100, 0);
    t.eq(order(), ['tbdrag1', 'tbdrag2', 'tbdrag3'], 'sola sürükleme');
    // running (unpinned) apps reorder among themselves, pinned ones stay first
    P.apps.launch(DUMMY);
    P.apps.launch('tbdrag1');
    pinOnly(['tbdrag2']);
    P.apps.launch('tbdrag3');
    const o2 = order();
    t.eq(o2[0], 'tbdrag2', 'sabitli düğme başta kalmalı');
    const running = o2.slice(1);
    t.eq(running.length, 3);
    await t.sleep(320); // let removed buttons finish collapsing
    t.drag(btn(running[0]), 110, 0);
    const o3 = order();
    t.eq(o3[0], 'tbdrag2');
    t.eq(o3.slice(1), [running[1], running[2], running[0]], 'çalışan düğmeler kendi aralarında sıralanmalı');
  });

  T('orta tık yeni pencere açar', async (t) => {
    pinOnly([DUMMY]);
    P.apps.launch(DUMMY);
    t.eq(dummyWins().length, 1);
    t.mouse(btn(DUMMY), 'auxclick', { button: 1 });
    t.eq(dummyWins().length, 2, 'orta tık yeni pencere açmadı');
  });

  T('ipucu: üzerine gelince uygulama adı görünür', async (t) => {
    pinOnly([DUMMY]);
    t.mouse(btn(DUMMY), 'mouseenter');
    await t.waitFor(() => q('#panels .tb-tip.show'), 1500, 'ipucu görünmedi');
    t.eq(q('#panels .tb-tip').textContent, 'Panda Deneme Uygulaması');
    t.mouse(btn(DUMMY), 'mouseleave');
    await t.waitFor(() => !q('#panels .tb-tip.show'), 1000, 'ipucu gizlenmedi');
    // with one window the tooltip shows the window title
    P.apps.launch(DUMMY, { title: 'Özel Başlık' });
    t.mouse(btn(DUMMY), 'mouseenter');
    await t.waitFor(() => q('#panels .tb-tip.show'));
    t.eq(q('#panels .tb-tip').textContent, 'Özel Başlık');
    t.mouse(btn(DUMMY), 'mouseleave');
  });

  T('sağ tık menüleri: uygulama düğmesi ve boş alan', async (t) => {
    const shown = [];
    patch(P.contextMenu, 'show', (x, y, items) => { shown.push(items.filter(Boolean)); });
    pinOnly([DUMMY]);
    t.contextmenu(btn(DUMMY));
    let labels = shown[0].map((i) => i.label).filter(Boolean);
    t.eq(labels[0], 'Panda Deneme Uygulaması');
    t.ok(shown[0][0].disabled, 'başlık pasif olmalı');
    t.ok(labels.includes('Yeni pencere'));
    t.ok(labels.includes('Görev çubuğundan kaldır'), 'sabitli uygulamada kaldır seçeneği olmalı');
    t.ok(!labels.includes('Pencereyi kapat'), 'çalışmıyorken kapat seçeneği olmamalı');
    // run: new window, then unpin
    shown[0].find((i) => i.label === 'Yeni pencere').action();
    t.eq(dummyWins().length, 1);
    shown[0].find((i) => i.label === 'Görev çubuğundan kaldır').action();
    t.ok(!P.settings.get('taskbar.pinned').includes(DUMMY), 'sabitleme kaldırılmadı');
    // running, not pinned → pin option + close options
    t.contextmenu(btn(DUMMY));
    labels = shown[1].map((i) => i.label).filter(Boolean);
    t.ok(labels.includes('Görev çubuğuna sabitle'));
    t.ok(labels.includes('Pencereyi kapat'));
    shown[1].find((i) => i.label === 'Görev çubuğuna sabitle').action();
    t.ok(P.settings.get('taskbar.pinned').includes(DUMMY), 'sabitlenmedi');
    P.apps.launch(DUMMY);
    t.contextmenu(btn(DUMMY));
    labels = shown[2].map((i) => i.label).filter(Boolean);
    t.ok(labels.includes('Tüm pencereleri kapat'), 'çoklu pencerede tümünü kapat olmalı');
    shown[2].find((i) => i.label === 'Tüm pencereleri kapat').action();
    await t.waitFor(() => dummyWins().length === 0, 1500, 'tüm pencereler kapanmadı');
    // empty taskbar area
    const launched = [];
    patch(P.apps, 'launch', (id) => { launched.push(id); return null; });
    t.contextmenu(q('#taskbar .tb-center'), { clientX: 40, clientY: window.innerHeight - 20 });
    const last = shown[shown.length - 1];
    labels = last.map((i) => i.label).filter(Boolean);
    t.ok(labels.includes('Görev Yöneticisi') && labels.includes('Ayarlar'), 'boş alan menüsü: ' + labels.join(','));
    last.find((i) => i.label === 'Görev Yöneticisi').action();
    last.find((i) => i.label === 'Ayarlar').action();
    t.eq(launched, ['taskmanager', 'settings']);
  });

  T('wm:flash düğmeyi titreştirir', async (t) => {
    pinOnly([DUMMY]);
    const win = P.apps.launch(DUMMY);
    P.bus.emit('wm:flash', win);
    t.ok(btn(DUMMY).classList.contains('flash'), 'flash sınıfı yok');
    P.bus.emit('wm:focus', win);
    t.ok(!btn(DUMMY).classList.contains('flash'), 'odaklanınca flash kalkmalı');
  });

  T('masaüstünü göster şeridi pencereleri küçültür', async (t) => {
    pinOnly([DUMMY]);
    const win = P.apps.launch(DUMMY);
    t.click(q('#taskbar .tb-show-desktop'));
    await t.waitFor(() => win.isMinimized(), 2000, 'pencere küçültülmedi');
    t.click(q('#taskbar .tb-show-desktop'));
    await t.waitFor(() => !win.isMinimized(), 2000, 'ikinci tıklama geri getirmedi');
  });

  T('saat: 12 saat biçimi ve saniye ayarı', async (t) => {
    P.settings.set('clock24h', false);
    t.ok(/^\d{1,2}:\d{2} (ÖÖ|ÖS)$/.test(q('.tb-clock-time').textContent), '12 saat: ' + q('.tb-clock-time').textContent);
    P.settings.set('clock24h', true);
    P.settings.set('showSeconds', true);
    t.ok(/^\d{2}:\d{2}:\d{2}$/.test(q('.tb-clock-time').textContent), 'saniyeli: ' + q('.tb-clock-time').textContent);
  });

  // ------------------------------------------------------------------ start menu
  T('başlat menüsü: düğme, Escape, Ctrl+Esc, Meta ve dışarı tıklama', async (t) => {
    t.ok(!P.startMenu.isOpen());
    t.click(q('#taskbar .tb-start'));
    t.ok(P.startMenu.isOpen(), 'düğme açmadı');
    t.ok(startOpen(), '.open yok');
    t.ok(q('#taskbar .tb-start').classList.contains('active'), 'başlat düğmesi active olmalı');
    t.eq(document.activeElement, q('.sm-input'), 'arama kutusu odakta olmalı');
    t.key(document.body, 'Escape');
    t.ok(!P.startMenu.isOpen() && !startOpen(), 'Escape kapatmadı');
    t.ok(!q('#taskbar .tb-start').classList.contains('active'));
    t.click(q('#taskbar .tb-start'));
    t.click(q('#taskbar .tb-start'));
    t.ok(!P.startMenu.isOpen(), 'düğme ikinci tıklamada kapatmalı');
    t.key(document.body, 'Escape', { ctrlKey: true });
    t.ok(P.startMenu.isOpen(), 'Ctrl+Esc açmadı');
    t.key(document.body, 'Escape', { ctrlKey: true });
    t.ok(!P.startMenu.isOpen(), 'Ctrl+Esc kapatmadı');
    t.key(document.body, 'Meta');
    t.ok(P.startMenu.isOpen(), 'Meta tuşu açmadı');
    t.click(q('#desktop') || document.body);
    t.ok(!P.startMenu.isOpen(), 'dışarı tıklama kapatmadı');
    P.startMenu.toggle();
    t.ok(P.startMenu.isOpen());
    P.bus.emit('session:lock');
    t.ok(!P.startMenu.isOpen(), 'kilitlenince kapanmalı');
    P.startMenu.open();
    P.startMenu.close();
    t.ok(!P.startMenu.isOpen());
  });

  T('başlat menüsü: sabitlenmiş ızgara ve bölümler', async (t) => {
    P.startMenu.open();
    const heads = qa('.sm-home .sm-sec h3').map((h) => h.textContent);
    t.eq(heads, ['Sabitlenmiş', 'Son kullanılanlar']);
    const all = P.apps.list().filter((d) => d.showInStartMenu !== false).map((d) => d.id);
    // pinned apps first (in the taskbar's order), the rest alphabetically
    const pinned = P.settings.get('taskbar.pinned').filter((id) => all.includes(id));
    const expected = pinned.concat(all.filter((id) => !pinned.includes(id)));
    const shown = qa('.sm-grid .sm-app').map((b) => b.dataset.app);
    t.eq(shown, expected, 'ızgara tüm uygulamaları göstermeli: sabitlenmişler önce');
    t.ok(shown.includes(DUMMY));
    qa('.sm-grid .sm-app').forEach((b) => t.ok(q('svg', b), 'simge yok: ' + b.dataset.app));
    t.eq(q('.sm-user-name').textContent, 'Panda');
    t.ok(q('.sm-avatar svg'), 'avatar yok');
    const cols = getComputedStyle(q('.sm-grid')).gridTemplateColumns.split(' ').length;
    t.eq(cols, 6, 'satır başına 6 uygulama');
    // clicking a tile launches and closes
    t.click(q(`.sm-app[data-app="${DUMMY}"]`));
    t.ok(!P.startMenu.isOpen(), 'başlatınca menü kapanmalı');
    await t.waitFor(() => dummyWins().length === 1, 1500, 'uygulama başlamadı');
  });

  T('arama uygulamaları süzer (Türkçe, aksansız) ve Enter başlatır', async (t) => {
    P.startMenu.open();
    const input = q('.sm-input');
    t.type(input, 'deneme');
    t.ok(!q('.sm-results').hidden && q('.sm-home').hidden, 'sonuç görünümüne geçmeli');
    let rows = qa('.sm-result');
    t.eq(rows.map((r) => r.dataset.app), [DUMMY], 'yalnızca eşleşen uygulama');
    t.ok(rows[0].classList.contains('sel'), 'ilk sonuç seçili olmalı');
    t.ok(q('.sm-hl', rows[0]), 'eşleşme vurgulanmalı');
    // diacritic-insensitive: "uygulamasi" matches "Uygulaması"
    input.value = '';
    t.type(input, 'uygulamasi');
    rows = qa('.sm-result');
    t.ok(rows.some((r) => r.dataset.app === DUMMY), 'aksansız arama çalışmalı');
    // capital dotted/dotless I
    input.value = 'PANDA DENEME';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.ok(qa('.sm-result').some((r) => r.dataset.app === DUMMY), 'büyük harf arama');
    // no result
    input.value = 'zzqqxx';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.ok(q('.sm-noresult'), 'sonuç yok mesajı');
    t.eq(qa('.sm-result').length, 0);
    // clear button returns to the grid
    t.click(q('.sm-clear'));
    t.ok(q('.sm-results').hidden && !q('.sm-home').hidden, 'temizleyince ızgaraya dönmeli');
    // Enter launches
    input.value = '';
    t.type(input, 'deneme');
    t.key(input, 'Enter');
    t.ok(!P.startMenu.isOpen(), 'Enter menüyü kapatmalı');
    await t.waitFor(() => dummyWins().length === 1, 1500, 'Enter uygulamayı başlatmadı');
  });

  T('arama: dosyalar, ok tuşları ve Enter ile açma', async (t) => {
    const fs = P.fs;
    t.ok(fs, 'fs yok');
    fs.writeFile('/home/panda/Belgeler/Şeker Pastası.txt', 'tarif');
    const opened = [];
    patch(P.apps, 'openFile', (p) => { opened.push(p); return null; });
    P.startMenu.open();
    const input = q('.sm-input');
    t.type(input, 'seker');
    const row = q('.sm-result[data-path="/home/panda/Belgeler/Şeker Pastası.txt"]');
    t.ok(row, 'dosya sonucu yok (aksansız arama)');
    t.ok(q('.sm-sec h3', q('.sm-results')), 'bölüm başlığı');
    t.ok(row.textContent.includes('Belgeler'), 'klasör yolu gösterilmeli');
    t.ok(!qa('.sm-result').some((r) => /\.app$/.test(r.dataset.path || '')), '.app kısayolları sonuçta olmamalı');
    // arrow navigation across mixed results: 1 app + 2 files all matching "deneme"
    fs.writeFile('/home/panda/Belgeler/Deneme Notu 1.txt', '1');
    fs.writeFile('/home/panda/Belgeler/Deneme Notu 2.txt', '2');
    input.value = '';
    t.type(input, 'deneme');
    const all = qa('.sm-result');
    t.eq(all.length, 3, 'deneme: bir uygulama + iki dosya beklenir');
    t.eq(all.map((r) => (r.dataset.app ? 'app' : 'file')), ['app', 'file', 'file'], 'uygulamalar dosyalardan önce gelir');
    t.eq(all.findIndex((r) => r.classList.contains('sel')), 0);
    t.key(input, 'ArrowDown');
    t.eq(qa('.sm-result').findIndex((r) => r.classList.contains('sel')), 1, 'ArrowDown');
    t.key(input, 'ArrowUp');
    t.eq(qa('.sm-result').findIndex((r) => r.classList.contains('sel')), 0, 'ArrowUp');
    t.key(input, 'ArrowUp');
    t.eq(qa('.sm-result').findIndex((r) => r.classList.contains('sel')), all.length - 1, 'başa sarma');
    // open the file result with Enter
    input.value = '';
    t.type(input, 'seker pasta');
    t.key(input, 'Enter');
    t.eq(opened, ['/home/panda/Belgeler/Şeker Pastası.txt'], 'Enter dosyayı açmalı');
    t.ok(!P.startMenu.isOpen());
    ['Şeker Pastası.txt', 'Deneme Notu 1.txt', 'Deneme Notu 2.txt'].forEach((n) => fs.remove('/home/panda/Belgeler/' + n));
  });

  T('son kullanılanlar: apps:launch ile güncellenir, en çok 6', async (t) => {
    const fs = P.fs;
    const paths = [];
    for (let i = 1; i <= 8; i++) {
      const p = `/home/panda/Belgeler/son-${i}.txt`;
      fs.writeFile(p, String(i));
      paths.push(p);
    }
    P.startMenu.open();
    t.ok(q('.sm-rec-empty'), 'boşken ipucu gösterilmeli');
    P.startMenu.close();
    paths.forEach((p) => P.bus.emit('apps:launch', { id: 'notepad', args: { path: p } }));
    P.bus.emit('apps:launch', { id: 'files', args: { path: '/home/panda/Belgeler' } }); // folders are ignored
    P.bus.emit('apps:launch', { id: 'files', args: { path: 'trash:' } });
    P.bus.emit('apps:launch', { id: 'calculator', args: {} });
    const stored = P.storage.get('recent', []);
    t.eq(stored.length, 6, 'en çok 6 kayıt');
    t.eq(stored[0], paths[7], 'en yeni başta');
    P.bus.emit('apps:launch', { id: 'notepad', args: { path: paths[4] } });
    t.eq(P.storage.get('recent')[0], paths[4], 'yeniden açılan öne geçmeli');
    t.eq(new Set(P.storage.get('recent')).size, 6, 'yinelenen olmamalı');

    const opened = [];
    patch(P.apps, 'openFile', (p) => { opened.push(p); return null; });
    P.startMenu.open();
    const recs = qa('.sm-rec');
    t.eq(recs.length, 6);
    t.eq(recs[0].dataset.path, paths[4]);
    t.ok(q('.sm-rec-name', recs[0]).textContent.startsWith('son-5'), 'ad gösterilmeli');
    t.eq(q('.sm-rec-sub', recs[0]).textContent, 'Belgeler');
    t.click(recs[1]);
    t.eq(opened, [recs[1].dataset.path], 'tıklayınca açmalı');
    t.ok(!P.startMenu.isOpen());
    // deleted files drop out
    fs.remove(paths[4]);
    P.startMenu.open();
    t.ok(!q(`.sm-rec[data-path="${paths[4]}"]`), 'silinen dosya listede kalmamalı');
    P.startMenu.close();
    paths.forEach((p) => { if (fs.exists(p)) fs.remove(p); });
  });

  T('başlat menüsü: uygulama sağ tık menüsü (aç, sabitle, kısayol)', async (t) => {
    const shown = [];
    patch(P.contextMenu, 'show', (x, y, items) => { shown.push(items.filter(Boolean)); });
    P.startMenu.open();
    t.contextmenu(q(`.sm-app[data-app="${DUMMY}"]`));
    t.eq(shown.length, 1);
    const labels = shown[0].map((i) => i.label);
    t.eq(labels, ['Aç', 'Görev çubuğuna sabitle', 'Masaüstüne kısayol ekle']);
    // pin
    shown[0][1].action();
    t.ok(P.settings.get('taskbar.pinned').includes(DUMMY), 'sabitlenmedi');
    // shortcut
    const dir = (P.desktop && P.desktop.DIR) || '/home/panda/Masaüstü';
    shown[0][2].action();
    shown[0][2].action();
    const files = P.fs.list(dir).map((s) => s.name);
    t.ok(files.includes('Panda Deneme Uygulaması.app'), 'kısayol dosyası yok: ' + files.join('|'));
    t.ok(files.includes('Panda Deneme Uygulaması (2).app'), 'uniqueName kullanılmalı');
    t.eq(JSON.parse(P.fs.readFile(dir + '/Panda Deneme Uygulaması.app')), { appId: DUMMY });
    P.fs.remove(dir + '/Panda Deneme Uygulaması.app');
    P.fs.remove(dir + '/Panda Deneme Uygulaması (2).app');
    // unpin shows the opposite label
    t.contextmenu(q(`.sm-app[data-app="${DUMMY}"]`));
    t.eq(shown[1][1].label, 'Görev çubuğundan kaldır');
    // run "Aç"
    shown[1][0].action();
    await t.waitFor(() => dummyWins().length === 1, 1500, 'Aç uygulamayı başlatmadı');
  });

  T('başlat menüsü: klavye ile ızgarada gezinme', async (t) => {
    // make sure there are two full rows even when few real apps are installed
    for (let i = 1; P.apps.list().filter((d) => d.showInStartMenu !== false).length < 8; i++) {
      P.apps.register({ id: 'tbfill' + i, name: 'Dolgu ' + i, icon: 'file', launch() {} });
    }
    P.startMenu.open();
    const input = q('.sm-input');
    const tiles = qa('.sm-grid .sm-app');
    t.key(input, 'ArrowDown');
    t.eq(document.activeElement, tiles[0], 'ArrowDown ilk uygulamaya gitmeli');
    t.key(tiles[0], 'ArrowRight');
    t.eq(document.activeElement, tiles[1]);
    t.key(tiles[1], 'ArrowLeft');
    t.eq(document.activeElement, tiles[0]);
    if (tiles.length > 6) {
      t.key(tiles[0], 'ArrowDown');
      t.eq(document.activeElement, tiles[6], 'ArrowDown bir satır aşağı');
      t.key(tiles[6], 'ArrowUp');
      t.eq(document.activeElement, tiles[0]);
    }
    t.key(tiles[0], 'ArrowUp');
    t.eq(document.activeElement, input, 'ilk satırdan yukarı arama kutusuna dönmeli');
    // typing a printable key while a tile has focus returns focus to the search box
    tiles[0].focus();
    t.key(tiles[0], 'a');
    t.eq(document.activeElement, input, 'yazı yazınca arama kutusuna odaklanmalı');
  });

  T('güç menüsü: Kilitle, Yeniden başlat, Kapat', async (t) => {
    const calls = [];
    if (!P.session) { P.session = {}; restores.push(() => { delete P.session; }); }
    ['lock', 'restart', 'shutdown'].forEach((k) => patch(P.session, k, () => { calls.push(k); return Promise.resolve(); }));
    P.startMenu.open();
    t.ok(!q('.sm-power-menu.open'));
    t.click(q('.sm-power'));
    t.ok(q('.sm-power-menu.open'), 'güç menüsü açılmadı');
    t.eq(qa('.sm-pm-item').map((b) => b.textContent), ['Kilitle', 'Yeniden başlat', 'Kapat']);
    t.key(document.body, 'Escape');
    // Escape on the document closes the whole start menu; use the menu's own Escape first
    P.startMenu.open();
    t.click(q('.sm-power'));
    t.key(q('.sm-pm-item'), 'Escape');
    t.ok(!q('.sm-power-menu.open') && P.startMenu.isOpen(), 'menüdeki Escape yalnızca güç menüsünü kapatmalı');
    for (const [i, kind] of ['lock', 'restart', 'shutdown'].entries()) {
      if (!P.startMenu.isOpen()) P.startMenu.open();
      t.click(q('.sm-power'));
      t.click(qa('.sm-pm-item')[i]);
      t.ok(!P.startMenu.isOpen(), kind + ' menüyü kapatmalı');
    }
    t.eq(calls, ['lock', 'restart', 'shutdown']);
  });

  // ------------------------------------------------------------------ calendar
  T('takvim: açılır, Türkçe ay/gün adları, bugün vurgusu', async (t) => {
    const now = new Date();
    t.click(q('#taskbar .tb-clock'));
    t.ok(panelOpen('cal-panel'), 'takvim açılmadı');
    t.eq(q('.cal-title').textContent, `${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
    t.eq(qa('.cal-weekdays span').map((s) => s.textContent), ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']);
    t.eq(q('.cal-date').textContent, `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
    t.ok(/^\d{2}:\d{2}:\d{2}$/.test(q('.cal-time').textContent), 'büyük saat saniyeli: ' + q('.cal-time').textContent);
    const cells = qa('.cal-day');
    t.eq(cells.length, 42);
    // Monday first: the 1st of the month sits at index (getDay()+6)%7
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    t.eq(cells[(first.getDay() + 6) % 7].dataset.date, `${first.getFullYear()}-${pad(first.getMonth() + 1)}-01`);
    const today = q('.cal-day.today');
    t.ok(today, 'bugün hücresi yok');
    t.eq(today.textContent, String(now.getDate()));
    t.ok(today.classList.contains('selected'), 'bugün seçili başlamalı');
    t.ok(cells.filter((c) => c.classList.contains('other')).length >= 4, 'diğer ay günleri soluk olmalı');
    t.ok(cells.filter((c) => c.classList.contains('weekend')).length === 12, 'her satırda 2 hafta sonu sütunu');
    t.ok(/\d/.test(q('.cal-foot-title').textContent) && q('.cal-foot-title').textContent.includes(MONTHS[now.getMonth()]), 'alt bilgi');
    t.key(document.body, 'Escape');
    t.ok(!panelOpen('cal-panel'), 'Escape kapatmalı');
  });

  T('takvim: ay gezinme, Bugün, tekerlek ve gün seçme', async (t) => {
    const now = new Date();
    t.click(q('#taskbar .tb-clock'));
    const nav = (label) => q(`.cal-nav[aria-label="${label}"]`);
    const title = () => q('.cal-title').textContent;
    const mk = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    t.click(nav('Sonraki ay'));
    t.eq(title(), mk(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
    t.click(nav('Sonraki ay'));
    t.eq(title(), mk(new Date(now.getFullYear(), now.getMonth() + 2, 1)));
    t.click(nav('Önceki ay'));
    t.click(nav('Önceki ay'));
    t.click(nav('Önceki ay'));
    t.eq(title(), mk(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
    t.click(q('.cal-today-btn'));
    t.eq(title(), mk(now), 'Bugün düğmesi geçerli aya dönmeli');
    // year rollover: go back 13 months
    for (let i = 0; i < 13; i++) t.click(nav('Önceki ay'));
    t.eq(title(), mk(new Date(now.getFullYear(), now.getMonth() - 13, 1)), 'yıl geçişi');
    t.click(q('.cal-today-btn'));
    // wheel
    const wheel = (dy) => q('.cal-month').dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
    wheel(120);
    t.eq(title(), mk(new Date(now.getFullYear(), now.getMonth() + 1, 1)), 'tekerlek aşağı = sonraki ay');
    await t.sleep(160);
    wheel(-120);
    t.eq(title(), mk(now), 'tekerlek yukarı = önceki ay');
    // day selection
    const cells = qa('.cal-day');
    const target = cells.find((c) => !c.classList.contains('other') && !c.classList.contains('today'));
    t.click(target);
    t.ok(q(`.cal-day[data-date="${target.dataset.date}"]`).classList.contains('selected'), 'gün seçilmedi');
    t.eq(qa('.cal-day.selected').length, 1);
    const [y, m, d] = target.dataset.date.split('-').map(Number);
    t.ok(q('.cal-foot-title').textContent.startsWith(`${d} ${MONTHS[m - 1]} ${y}`), 'alt bilgi seçilen günü göstermeli: ' + q('.cal-foot-title').textContent);
    // keyboard
    t.key(q('.cal-panel'), 'ArrowRight');
    t.ok(q('.cal-day.selected').dataset.date > target.dataset.date, 'ArrowRight sonraki güne geçmeli');
    t.key(q('.cal-panel'), 'Home');
    t.ok(q('.cal-day.selected').classList.contains('today'));
    // clicking an "other month" day navigates there
    const other = qa('.cal-day.other').pop();
    const oy = Number(other.dataset.date.split('-')[0]);
    const om = Number(other.dataset.date.split('-')[1]);
    t.click(other);
    t.eq(title(), `${MONTHS[om - 1]} ${oy}`, 'diğer ay gününe tıklayınca o aya geçmeli');
  });

  T('takvim: resmi tatiller işaretlenir ve ipucu gösterir', async (t) => {
    t.click(q('#taskbar .tb-clock'));
    const year = new Date().getFullYear();
    const expected = {
      '01-01': 'Yılbaşı',
      '04-23': 'Ulusal Egemenlik ve Çocuk Bayramı',
      '05-01': 'Emek ve Dayanışma Günü',
      '05-19': "Atatürk'ü Anma Gençlik ve Spor Bayramı",
      '07-15': 'Demokrasi ve Millî Birlik Günü',
      '08-30': 'Zafer Bayramı',
      '10-29': 'Cumhuriyet Bayramı'
    };
    const now = new Date();
    for (const [md, name] of Object.entries(expected)) {
      const month = Number(md.slice(0, 2)) - 1;
      // jump: today button, then navigate by the number of months difference
      t.click(q('.cal-today-btn'));
      const diff = month - now.getMonth();
      const nav = q(`.cal-nav[aria-label="${diff >= 0 ? 'Sonraki ay' : 'Önceki ay'}"]`);
      for (let i = 0; i < Math.abs(diff); i++) t.click(nav);
      const cell = q(`.cal-day[data-date="${year}-${md}"]`);
      t.ok(cell, 'hücre yok: ' + md);
      t.ok(cell.classList.contains('holiday'), 'tatil işaretlenmedi: ' + md);
      t.eq(cell.dataset.holiday, name);
    }
    // tooltip on hover (we are on October)
    const cell = q(`.cal-day[data-date="${year}-10-29"]`);
    t.mouse(cell, 'mouseenter');
    await t.waitFor(() => q('#panels .tb-tip.show'), 1500, 'tatil ipucu görünmedi');
    t.ok(q('#panels .tb-tip').textContent.includes('Cumhuriyet Bayramı'), q('#panels .tb-tip').textContent);
    t.click(cell);
    t.eq(q('.cal-foot-sub').textContent, 'Cumhuriyet Bayramı');
    t.ok(q('.cal-foot-sub').classList.contains('holiday'));
    // a normal day shows the next holiday
    t.click(qa('.cal-day:not(.holiday):not(.other)')[0]);
    t.ok(/Sonraki resmi tatil/.test(q('.cal-foot-sub').textContent), q('.cal-foot-sub').textContent);
  });

  // ------------------------------------------------------------------ notification center
  T('bildirim merkezi: liste, rozet, okundu, silme, temizleme', async (t) => {
    t.ok(hasNotify(), 'PandaOS.notify yok');
    P.notify.clear();
    t.eq(P.notify.unreadCount(), 0);
    t.ok(q('.tb-badge').hidden, 'bildirim yokken rozet gizli olmalı');
    P.settings.set('dnd', true); // history only
    P.notify({ title: 'Birinci', message: 'ilk ileti', icon: 'info' });
    P.notify({ title: 'İkinci', message: 'ikinci ileti', icon: 'warning' });
    t.eq(P.notify.unreadCount(), 2);
    t.ok(!q('.tb-badge').hidden && q('.tb-badge').textContent === '2', 'rozet 2 göstermeli: ' + q('.tb-badge').textContent);
    P.notify({ title: 'Üçüncü', message: 'üçüncü ileti' });
    t.eq(q('.tb-badge').textContent, '3');
    t.click(q('#taskbar .tb-bell'));
    t.ok(panelOpen('nc-panel'), 'bildirim merkezi açılmadı');
    t.eq(q('.nc-title').textContent, 'Bildirimler');
    t.eq(P.notify.unreadCount(), 0, 'açınca hepsi okunmuş olmalı');
    t.ok(q('.tb-badge').hidden, 'rozet kaybolmalı');
    const titles = qa('.nc-item .nc-item-title').map((n) => n.textContent);
    t.eq(titles, ['Üçüncü', 'İkinci', 'Birinci'], 'en yeni üstte');
    t.eq(q('.nc-item .nc-time').textContent, 'az önce');
    t.eq(q('.nc-item .nc-msg').textContent, 'üçüncü ileti');
    t.ok(q('.nc-item .nc-ico svg'), 'simge yok');
    // a notification arriving while open is shown (and stays read)
    P.notify({ title: 'Dördüncü', message: 'canlı' });
    t.eq(qa('.nc-item').length, 4, 'açıkken gelen bildirim eklenmeli');
    t.eq(q('.nc-item .nc-item-title').textContent, 'Dördüncü');
    t.eq(P.notify.unreadCount(), 0, 'açıkken gelenler okunmuş sayılmalı');
    // dismiss one
    t.click(q('.nc-item .nc-x'));
    await t.waitFor(() => qa('.nc-item').length === 3, 2000, '× bildirimi kaldırmadı');
    t.eq(P.notify.history().length, 3);
    // clear all
    t.ok(!q('.nc-clear').disabled);
    t.click(q('.nc-clear'));
    await t.waitFor(() => !qa('.nc-item').length, 2500, 'Tümünü temizle çalışmadı');
    t.eq(P.notify.history().length, 0);
    t.eq(q('.nc-empty-title').textContent, 'Yeni bildirim yok');
    t.ok(q('.nc-clear').disabled, 'boşken temizle pasif olmalı');
  });

  T('bildirim merkezi: göreli zaman, uygulama açma, Rahatsız Etmeyin', async (t) => {
    t.ok(hasNotify());
    const now = Date.now();
    const fake = [
      { id: 'a', title: 'Eski', message: 'x', icon: 'info', appId: DUMMY, time: now - 5 * 60000, read: true },
      { id: 'b', title: 'Çok eski', message: 'y', icon: 'info', time: now - 3 * 3600000, read: true },
      { id: 'c', title: 'Dün', message: 'z', icon: 'info', time: now - 30 * 3600000, read: true },
      { id: 'd', title: 'Şimdi', message: 'w', icon: 'info', time: now - 4000, read: true }
    ];
    patch(P.notify, 'history', () => fake.slice());
    t.click(q('#taskbar .tb-bell'));
    const times = Object.fromEntries(qa('.nc-item').map((n) => [q('.nc-item-title', n).textContent, q('.nc-time', n).textContent]));
    t.eq(times, { 'Şimdi': 'az önce', 'Eski': '5 dk önce', 'Çok eski': '3 sa önce', 'Dün': 'dün' });
    t.eq(qa('.nc-item .nc-item-title').map((n) => n.textContent), ['Şimdi', 'Eski', 'Çok eski', 'Dün'], 'zamana göre sıralı');
    // clicking a notification with appId opens that app and closes the panel
    t.click(qa('.nc-item').find((n) => q('.nc-item-title', n).textContent === 'Eski'));
    t.ok(!panelOpen('nc-panel'), 'tıklayınca panel kapanmalı');
    await t.waitFor(() => dummyWins().length === 1, 1500, 'bildirim uygulamayı açmadı');
    // do-not-disturb switch
    t.click(q('#taskbar .tb-bell'));
    const sw = q('.nc-dnd input');
    t.eq(sw.checked, false);
    sw.checked = true;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    t.eq(P.settings.get('dnd'), true, 'anahtar dnd ayarını açmalı');
    t.ok(q('#taskbar .tb-bell').classList.contains('dnd'), 'zil dnd görünümü almalı');
    P.settings.set('dnd', false);
    t.eq(sw.checked, false, 'ayar değişince anahtar güncellenmeli');
  });

  // ------------------------------------------------------------------ quick settings
  T('hızlı ayarlar: açılır, kutucuklar, ses ve parlaklık', async (t) => {
    t.click(q('#taskbar .tb-sys'));
    t.ok(panelOpen('qs-panel'), 'hızlı ayarlar açılmadı');
    const tiles = qa('.qs-tile');
    t.eq(tiles.map((b) => q('.qs-tile-label', b).textContent), ['Wi-Fi', 'Bluetooth', 'Rahatsız Etmeyin', 'Koyu tema', 'Animasyonlar', 'Gece ışığı']);
    t.eq(q('.qs-tile[data-tile="wifi"] .qs-tile-sub').textContent, 'PandaNet');
    // volume slider → setting
    const vol = q('.qs-range[aria-label="Ses düzeyi"]');
    t.eq(vol.value, String(P.settings.get('volume')));
    vol.value = '35';
    vol.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(P.settings.get('volume'), 35, 'kaydırıcı ses ayarını değiştirmedi');
    t.eq(q('.qs-slider-row .qs-val').textContent, '35');
    P.settings.set('volume', 80);
    t.eq(vol.value, '80', 'ayar değişince kaydırıcı güncellenmeli');
    // mute button
    t.click(q('.qs-slider-row .qs-icon-btn'));
    t.eq(P.settings.get('muted'), true, 'sessize alma');
    vol.value = '50';
    vol.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(P.settings.get('muted'), false, 'kaydırınca sessiz kalkmalı');
    // brightness
    const bri = q('.qs-range[aria-label="Parlaklık"]');
    t.eq(bri.min, '30', 'en düşük parlaklık %30');
    bri.value = '60';
    bri.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(P.storage.get('brightness'), 60, 'parlaklık saklanmalı');
    t.ok(document.getElementById('os-root').style.filter.includes('brightness(0.6'), 'filtre uygulanmadı: ' + document.getElementById('os-root').style.filter);
    bri.value = '100';
    bri.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(document.getElementById('os-root').style.filter, '', '%100 filtre olmamalı');
  });

  T('hızlı ayarlar: tema, rahatsız etmeyin, animasyon ve sahte anahtarlar', async (t) => {
    t.click(q('#taskbar .tb-sys'));
    const tile = (id) => q(`.qs-tile[data-tile="${id}"]`);
    // theme
    const before = P.theme.get();
    t.eq(tile('theme').classList.contains('on'), before === 'dark');
    t.click(tile('theme'));
    t.eq(P.theme.get(), before === 'dark' ? 'light' : 'dark', 'tema değişmedi');
    t.eq(document.documentElement.dataset.theme, P.theme.get());
    t.eq(tile('theme').classList.contains('on'), P.theme.get() === 'dark', 'kutucuk durumu temayı izlemeli');
    t.click(tile('theme'));
    t.eq(P.theme.get(), before);
    // dnd
    t.click(tile('dnd'));
    t.eq(P.settings.get('dnd'), true);
    t.ok(tile('dnd').classList.contains('on'));
    t.click(tile('dnd'));
    t.eq(P.settings.get('dnd'), false);
    // animations
    t.click(tile('anim'));
    t.eq(P.settings.get('animations'), false);
    t.ok(!tile('anim').classList.contains('on'));
    t.click(tile('anim'));
    t.eq(P.settings.get('animations'), true);
    // fake toggles
    const wifi = tile('wifi');
    t.ok(wifi.classList.contains('on'));
    t.click(wifi);
    t.ok(!wifi.classList.contains('on'));
    t.eq(q('.qs-tile-sub', wifi).textContent, 'Kapalı');
    t.ok(q('.tb-g-wifi').classList.contains('off'), 'tepsideki Wi-Fi simgesi sönük olmalı');
    t.click(wifi);
    t.ok(wifi.classList.contains('on'));
    t.click(tile('bluetooth'));
    t.eq(P.storage.get('qs').bluetooth, false, 'Bluetooth durumu saklanmalı');
    t.click(tile('bluetooth'));
    // night light
    t.click(tile('night'));
    t.ok(document.getElementById('os-root').style.filter.includes('sepia'), 'gece ışığı filtre uygulamalı');
    t.click(tile('night'));
    t.eq(document.getElementById('os-root').style.filter, '');
    // gear opens settings and closes the panel
    const launched = [];
    patch(P.apps, 'launch', (id) => { launched.push(id); return null; });
    t.click(q('.qs-gear'));
    t.eq(launched, ['settings']);
    t.ok(!panelOpen('qs-panel'), 'ayarlar açılınca panel kapanmalı');
  });

  T('tepsi: ses simgesi ayara göre değişir, tekerlek sesi ayarlar', async (t) => {
    const glyph = () => q('.tb-g-vol').innerHTML;
    P.settings.set('volume', 70);
    const loud = glyph();
    P.settings.set('volume', 20);
    t.ok(glyph() !== loud, 'düşük ses simgesi farklı olmalı');
    P.settings.set('muted', true);
    const muted = glyph();
    t.ok(muted !== loud);
    P.settings.set('muted', false);
    P.settings.set('volume', 50);
    q('.tb-sys').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    t.eq(P.settings.get('volume'), 55, 'tekerlek yukarı sesi artırmalı');
    q('.tb-sys').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    t.eq(P.settings.get('volume'), 50);
    P.settings.set('volume', 70);
  });

  // ------------------------------------------------------------------ mutual exclusion
  T('aynı anda tek panel açık kalır', async (t) => {
    t.click(q('#taskbar .tb-clock'));
    t.ok(panelOpen('cal-panel'));
    t.click(q('#taskbar .tb-bell'));
    t.ok(panelOpen('nc-panel') && !panelOpen('cal-panel'), 'bildirim merkezi takvimi kapatmalı');
    t.click(q('#taskbar .tb-sys'));
    t.ok(panelOpen('qs-panel') && !panelOpen('nc-panel'));
    t.click(q('#taskbar .tb-start'));
    t.ok(P.startMenu.isOpen() && !panelOpen('qs-panel'), 'başlat menüsü paneli kapatmalı');
    t.click(q('#taskbar .tb-clock'));
    t.ok(panelOpen('cal-panel') && !P.startMenu.isOpen(), 'panel başlat menüsünü kapatmalı');
    // toggling the same trigger closes
    t.click(q('#taskbar .tb-clock'));
    t.ok(!panelOpen('cal-panel'), 'aynı düğme ikinci tıklamada kapatmalı');
    // outside click
    t.click(q('#taskbar .tb-bell'));
    t.ok(panelOpen('nc-panel'));
    t.click(q('#desktop') || document.body);
    t.ok(!panelOpen('nc-panel'), 'dışarı tıklama kapatmalı');
    // clicks inside don't close
    t.click(q('#taskbar .tb-sys'));
    t.click(q('.qs-panel'));
    t.ok(panelOpen('qs-panel'), 'panel içi tıklama kapatmamalı');
    // lock closes everything
    P.bus.emit('session:lock');
    t.ok(!panelOpen('qs-panel'), 'kilitleme paneli kapatmalı');
    t.eq(P.taskbar.currentPanel(), null);
    // panels are interactive layers
    t.click(q('#taskbar .tb-clock'));
    t.eq(getComputedStyle(q('.cal-panel')).pointerEvents, 'auto', 'görünür panel pointer-events:auto olmalı');
  });

  T('açık/koyu temada yüzeyler tema değişkenlerini izler', async (t) => {
    t.click(q('#taskbar .tb-clock'));
    P.theme.set('dark');
    const dark = getComputedStyle(q('.cal-panel')).backgroundColor;
    P.theme.set('light');
    const light = getComputedStyle(q('.cal-panel')).backgroundColor;
    t.ok(dark !== light, 'panel arka planı temaya göre değişmeli');
    const bar = getComputedStyle(q('.tb-bar')).backgroundColor;
    P.theme.set('dark');
    t.ok(getComputedStyle(q('.tb-bar')).backgroundColor !== bar, 'görev çubuğu temaya göre değişmeli');
  });

  // ------------------------------------------------------------------ review fixes
  T('açılır pencere kapanınca klavye odağı görev çubuğu düğmesinde kalmaz, aktif pencereye döner', async (t) => {
    const w = P.apps.launch(DUMMY);
    const ta = document.createElement('textarea');
    w.body.appendChild(ta);
    ta.focus();
    let keys = 0;
    const off = w.on('keydown', () => { keys++; });
    const inWindow = () => w.el.contains(document.activeElement);
    try {
      for (const [name, sel] of [['calendar', '.tb-clock'], ['quicksettings', '.tb-sys'], ['notifications', '.tb-bell']]) {
        // Escape
        P.taskbar.openPanel(name);
        await t.sleep(100);
        t.key(document.activeElement, 'Escape');
        await t.sleep(30);
        t.ok(!P.taskbar.isPanelOpen(), name + ' Escape ile kapanır');
        t.ok(inWindow(), `${name}: Escape sonrası odak ${document.activeElement && document.activeElement.className}`);
        t.ok(document.activeElement === ta, name + ': metin alanı odağı geri alır');
        // mouse: the tray button took focus when it was pressed; pressing it again closes the flyout
        const anchor = q('#taskbar ' + sel);
        anchor.focus();
        t.click(anchor);
        await t.sleep(80);
        t.ok(P.taskbar.isPanelOpen(name), name + ' açıldı');
        anchor.focus();
        t.click(anchor);
        await t.sleep(30);
        t.ok(!P.taskbar.isPanelOpen(), name + ' düğmeyle kapandı');
        t.ok(inWindow(), `${name}: düğmeyle kapatınca odak ${document.activeElement && document.activeElement.className}`);
      }
      // start menu toggled with its own button
      const start = q('#taskbar .tb-start');
      start.focus();
      t.click(start);
      await t.sleep(80);
      t.ok(startOpen());
      start.focus();
      t.click(start);
      await t.sleep(30);
      t.ok(!startOpen());
      t.ok(inWindow(), 'başlat düğmesiyle kapatınca odak pencerede: ' + (document.activeElement && document.activeElement.className));
      t.key(undefined, 'ArrowRight');
      t.eq(keys, 1, 'pencere klavye olayını almalı');
      // without any active window the button keeps / gets the focus back
      P.wm.blurAll();
      P.taskbar.openPanel('calendar');
      await t.sleep(100);
      t.key(document.activeElement, 'Escape');
      await t.sleep(30);
      t.ok(document.activeElement === q('#taskbar .tb-clock'), 'aktif pencere yokken odak tray düğmesine döner');
    } finally {
      off();
    }
  });

  T('görev çubuğu ipucu, düğmesi kalkınca asılı kalmaz', async (t) => {
    const w = P.apps.launch(DUMMY);
    await t.sleep(60);
    const b = btn(DUMMY);
    b.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = q('.tb-tip');
    await t.waitFor(() => tip.classList.contains('show'), 2000, 'ipucu görünmeli');
    w.forceClose(); // the app closes itself while the pointer rests on its button
    await t.waitFor(() => !btn(DUMMY), 2000, 'düğme kalkmalı');
    await t.sleep(300);
    t.ok(!tip.classList.contains('show'), 'ipucu düğmeyle birlikte kalkmalı: "' + tip.textContent + '"');
  });

  T('çok pencere + dar ekran: uygulama düğmeleri tepsinin altında kalmaz, tepsi küçülmez', async (t) => {
    for (let i = 0; i < 12; i++) P.wm.open({ appId: 'tbnarrow' + i, title: 'Dar ' + i });
    await t.sleep(80);
    const root = document.getElementById('os-root');
    const orig = { w: root.style.width, h: root.style.height };
    try {
      for (const width of [1440, 1024, 800, 640]) {
        root.style.width = width + 'px';
        await t.sleep(30);
        const tray = q('.tb-tray').getBoundingClientRect();
        const center = q('.tb-center').getBoundingClientRect();
        const apps = qa('#taskbar .tb-center .tb-btn');
        t.ok(apps.length >= 13, 'başlat + 12 uygulama düğmesi: ' + apps.length);
        t.ok(center.right <= tray.left + 0.5, `${width}px: uygulama grubu (${Math.round(center.right)}) tepsiye (${Math.round(tray.left)}) binmemeli`);
        if (width >= 800) { // narrower than that the group clips (buttons bottom out at 30px) instead of running under the tray
          apps.forEach((a) => {
            const r = a.getBoundingClientRect();
            t.ok(r.right <= tray.left + 1, `${width}px: ${a.dataset.app || 'başlat'} düğmesi tepsinin altında kalmamalı`);
          });
          const last = apps[apps.length - 1].getBoundingClientRect();
          const hit = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
          t.ok(hit && hit.closest('.tb-app') === apps[apps.length - 1], `${width}px: son düğmeye tıklanabilir`);
        }
        const mid = document.elementFromPoint(tray.left + 20, tray.top + tray.height / 2);
        t.ok(mid && mid.closest('.tb-tray'), `${width}px: tepsi simgelerine tıklanabilir`);
        t.ok(apps[0].getBoundingClientRect().width === 44, 'başlat düğmesi küçülmez');
        t.ok(tray.width >= 200, 'tepsi küçülmez: ' + tray.width);
        if (width >= 1024) t.ok(apps[1].getBoundingClientRect().width >= 36, `${width}px: düğmeler rahat sığar`);
      }
      // with room to spare the group stays centred on the screen
      root.style.width = '';
      await t.sleep(30);
      closeAllWindows();
      await t.sleep(500);
      const c = q('.tb-center').getBoundingClientRect();
      const mid = (c.left + c.right) / 2;
      t.ok(Math.abs(mid - window.innerWidth / 2) <= 6, 'grup ekranın ortasında (8px sol dolgu payı dahil): ' + mid);
    } finally {
      root.style.width = orig.w;
      root.style.height = orig.h;
    }
  });

  T('kısa ekranda takvim paneli ekranın üstünden taşmaz, ay ızgarası kayar', async (t) => {
    const root = document.getElementById('os-root');
    const orig = root.style.height;
    try {
      root.style.height = '480px';
      await t.sleep(30);
      t.click(q('#taskbar .tb-clock'));
      await t.sleep(250);
      const panel = q('.cal-panel');
      // layout metrics (offset*): the open / close slide transform must not matter
      const host = q('#panels').getBoundingClientRect();
      t.ok(panel.offsetTop >= 0, 'panelin üstü ekranda: ' + panel.offsetTop);
      t.ok(panel.offsetTop + panel.offsetHeight <= host.height, 'panel görev çubuğunun üstünde');
      t.ok(q('.cal-time').offsetTop + panel.offsetTop >= 0, 'büyük saat görünür');
      const month = q('.cal-month');
      t.ok(month.scrollHeight > month.clientHeight, 'ay ızgarası kısalmış alanda kaydırılır');
      t.ok(getComputedStyle(month).overflowY === 'auto');
      // plenty of room: nothing scrolls
      root.style.height = '';
      await t.sleep(60);
      t.ok(month.scrollHeight <= month.clientHeight + 1, 'yeterli yerde kaydırma yok');
    } finally {
      root.style.height = orig;
    }
  });

  T('başlat menüsü içeriğine sarılır: altta boş cam alan kalmaz, pinli uygulamalar başta', async (t) => {
    ['tbpin1', 'tbpin2'].forEach((id, i) => {
      if (!P.apps.get(id)) P.apps.register({ id, name: 'Zz Sabit ' + (i + 1), icon: 'folder', launch() {} });
    });
    pinOnly(['tbpin2', 'tbpin1']);
    P.startMenu.open();
    await t.sleep(80);
    const panel = q('.sm-panel');
    const parts = ['.sm-search', '.sm-body', '.sm-foot'].map((s) => q(s, panel));
    const body = parts[1];
    t.ok(body.scrollHeight <= body.clientHeight + 1, 'varsayılan görünümde içerik kaydırma gerektirmez');
    const sum = parts[0].offsetHeight + body.scrollHeight + parts[2].offsetHeight;
    t.ok(panel.offsetHeight <= sum + 2, `panel yüksekliği (${panel.offsetHeight}) içeriği (${sum}) aşmamalı`);
    t.ok(panel.offsetHeight < 660, 'sabit 660px yüksekliğe zorlanmaz');
    const order = qa('.sm-grid .sm-app').map((b) => b.dataset.app);
    t.eq(order.slice(0, 2), ['tbpin2', 'tbpin1'], 'sabitlenmişler (alfabetik değil) görev çubuğundaki sırayla başta');
    // pins changing while the menu is open reorders the grid
    pinOnly(['tbpin1']);
    await t.sleep(30);
    t.eq(qa('.sm-grid .sm-app').map((b) => b.dataset.app)[0], 'tbpin1');
    // searching still works and may grow the panel up to the cap
    q('.sm-input').value = 'a';
    q('.sm-input').dispatchEvent(new Event('input', { bubbles: true }));
    await t.sleep(30);
    t.ok(panel.offsetHeight <= 660 + 1);
  });

  T('vurgu metni: arama vurgusu ve "Tümünü temizle" açık temada okunur kontrasttadır', async (t) => {
    P.theme.set('light');
    P.settings.set('accent', '#2f9e6b');
    await t.sleep(30);
    const lum = (rgb) => {
      const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const parse = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    P.startMenu.open();
    q('.sm-input').value = 'not';
    q('.sm-input').dispatchEvent(new Event('input', { bubbles: true }));
    await t.sleep(40);
    const hl = q('.sm-hl');
    if (hl) {
      const glass = [250, 251, 252];
      t.ok(ratio(parse(getComputedStyle(hl).color), glass) >= 4.5, 'arama vurgusu kontrastı: ' + getComputedStyle(hl).color);
    }
    P.startMenu.close();
    t.click(q('#taskbar .tb-bell'));
    await t.sleep(200);
    const clr = q('.nc-clear');
    t.ok(ratio(parse(getComputedStyle(clr).color), [250, 251, 252]) >= 4.5, '"Tümünü temizle" kontrastı: ' + getComputedStyle(clr).color);
    P.theme.set('dark');
  });
})();
