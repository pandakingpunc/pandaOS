/* Cross-module integration tests (fs <-> desktop <-> apps <-> wm <-> taskbar <-> session <-> ui kit).
   Run: bash tools/test.sh integration
   Screenshot scenes: bash tools/shot.sh out.png "fast=1&test=integration&shot=<scene>&theme=dark|light"
   scenes: desktop, windows, snap, start, search, calendar, quick, notifications, ctx, ctxicon, confirm, alert,
           picker, toasts, taskbar */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T = window.PandaTest;
  const DIR = P.desktop.DIR;
  const DUMMY = 'intdummy';
  const DUMMY_SINGLE = 'intsingle';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => [...(root || document).querySelectorAll(sel)];

  // ------------------------------------------------------------------ icon audit (installed at load time)
  // Only requests made while one of THIS suite's tests runs are audited: other suites ask for unknown
  // names on purpose, to test the fallback.
  const iconRequests = new Set();
  let auditing = false;
  (function hookIcons() {
    const icons = P.icons;
    if (!icons || icons.__integrationHook) return;
    const orig = icons.get;
    icons.get = function (name) {
      if (auditing && typeof name === 'string' && name && !/^\s*<svg/i.test(name)) iconRequests.add(name);
      return orig.apply(this, arguments);
    };
    icons.__integrationHook = true;
  })();

  // ------------------------------------------------------------------ stand-in apps
  // The real apps are written separately; these stand-ins give the shell something to launch with the
  // right ids / names / icons / fileTypes (docs/API.md §11). Real apps registered earlier always win.
  const STAND_INS = [
    { id: 'files', name: 'Dosyalar', category: 'system', window: { width: 760, height: 500, minWidth: 420, minHeight: 280 } },
    { id: 'terminal', name: 'Terminal', category: 'system', window: { width: 640, height: 420 } },
    { id: 'notepad', name: 'Not Defteri', category: 'productivity', fileTypes: ['.txt', '.md', '.log', '.json', '.js', '.css', '.html', '.csv'], window: { width: 620, height: 440 } },
    { id: 'calculator', name: 'Hesap Makinesi', category: 'utilities', window: { width: 340, height: 500, minWidth: 300, minHeight: 440 } },
    { id: 'music', name: 'Müzik Çalar', category: 'media', singleInstance: true, fileTypes: ['.pmus'], window: { width: 700, height: 480 } },
    { id: 'minesweeper', name: 'Mayın Tarlası', category: 'games', singleInstance: true, window: { width: 420, height: 520, resizable: false } },
    { id: 'game2048', name: '2048', category: 'games', singleInstance: true, window: { width: 440, height: 560, resizable: false } },
    { id: 'settings', name: 'Ayarlar', category: 'system', singleInstance: true, window: { width: 760, height: 520 } },
    { id: 'paint', name: 'Çizim', category: 'media', fileTypes: ['.png'], window: { width: 760, height: 540 } },
    { id: 'taskmanager', name: 'Görev Yöneticisi', category: 'system', singleInstance: true, window: { width: 600, height: 440 } },
    { id: 'clock', name: 'Saat', category: 'utilities', singleInstance: true, window: { width: 460, height: 420 } }
  ];

  function standInBody(win, id, args) {
    const el = P.util.el;
    const icon = (n, s) => P.icons.el(n, { size: s || 18 });
    win.state.args = args || {};
    if (id === 'files') {
      const items = P.fs.list(P.fs.HOME, {});
      win.body.append(
        el('div', { class: 'p-toolbar' },
          el('button', { class: 'p-btn icon ghost', title: 'Geri' }, icon('arrow-left')),
          el('button', { class: 'p-btn icon ghost', title: 'Yukarı' }, icon('arrow-up')),
          el('input', { class: 'p-input', value: P.fs.HOME, style: { flex: '1' }, readOnly: true }),
          el('span', { class: 'spacer' }),
          el('button', { class: 'p-btn small' }, icon('folder-plus', 16), ' Yeni klasör')),
        el('div', { style: { display: 'flex', flex: '1', minHeight: '0' } },
          el('div', { class: 'p-sidebar', style: { width: '170px' } },
            ...['Masaüstü', 'Belgeler', 'Resimler', 'Müzik', 'İndirilenler', 'Çöp Kutusu'].map((n, i) =>
              el('div', { class: 'p-list-item' + (i === 1 ? ' selected' : '') }, icon(i === 5 ? 'trash' : 'folder', 20), n))),
          el('div', { class: 'p-list', style: { flex: '1', overflow: 'auto', padding: '8px' } },
            ...items.map((st, i) => el('div', { class: 'p-list-item' + (i === 2 ? ' selected' : '') }, icon(P.icons.forFile(st), 22),
              el('span', { text: st.name, style: { flex: '1' } }),
              el('span', { class: 'p-badge', text: st.type === 'dir' ? 'Klasör' : P.util.formatBytes(st.size) }))))),
        el('div', { class: 'p-statusbar' }, `${items.length} öğe`));
    } else if (id === 'notepad') {
      const text = args && args.path && P.fs.isFile(args.path) ? P.fs.readFile(args.path) : 'Bambu ormanında sabah sisi...\n\nYapılacaklar:\n- bambu ye\n- uyu';
      win.body.append(
        el('div', { class: 'p-toolbar' },
          el('button', { class: 'p-btn small ghost' }, icon('open', 16), ' Aç'),
          el('button', { class: 'p-btn small ghost' }, icon('save', 16), ' Kaydet'),
          el('span', { class: 'spacer' }),
          el('button', { class: 'p-btn small ghost' }, icon('search', 16))),
        el('textarea', { class: 'p-input', text, style: { flex: '1', border: '0', borderRadius: '0', resize: 'none', fontFamily: 'var(--font-mono)' } }),
        el('div', { class: 'p-statusbar' }, 'Satır 1, Sütun 1'));
    } else if (id === 'terminal') {
      win.body.append(el('pre', {
        class: 'selectable',
        style: { margin: '0', flex: '1', padding: '12px', background: 'var(--bg-sunken)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '13px', overflow: 'auto' },
        text: 'PandaOS 1.0.0 (Bambu)\nYardım için "help" yazın.\n\npanda@pandaos:~$ ls\nBelgeler  İndirilenler  Masaüstü  Müzik  Resimler\npanda@pandaos:~$ █'
      }));
    } else if (id === 'calculator') {
      const keys = ['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='];
      win.body.append(
        el('div', { style: { padding: '24px 16px 8px', textAlign: 'right', fontSize: '40px', fontFamily: 'var(--font-display)' }, text: '1.234,5' }),
        el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', padding: '12px', flex: '1' } },
          ...keys.map((k) => el('button', { class: 'p-btn' + (k === '=' ? ' primary' : ''), text: k, style: k === '0' ? { gridColumn: 'span 2' } : {} }))));
    } else {
      win.body.append(el('div', { class: 'p-empty', style: { flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' } },
        icon(id, 64), el('div', { text: win.getTitle() }), el('div', { class: 'p-badge', text: 'deneme uygulaması' })));
    }
  }

  function ensureApps() {
    STAND_INS.forEach((d) => {
      if (P.apps.get(d.id)) return;
      P.apps.register(Object.assign({
        icon: d.id, description: d.name, fileTypes: [], launch(win, args) { standInBody(win, d.id, args); }
      }, d));
    });
    if (!P.apps.get(DUMMY)) {
      P.apps.register({
        id: DUMMY, name: 'Entegrasyon Deneme', icon: 'folder', showInStartMenu: false, window: { width: 360, height: 240 },
        launch(win, args) { win.state.args = args || {}; win.body.textContent = 'entegrasyon'; }
      });
    }
    if (!P.apps.get(DUMMY_SINGLE)) {
      P.apps.register({
        id: DUMMY_SINGLE, name: 'Tek Pencere', icon: 'star', showInStartMenu: false, singleInstance: true, window: { width: 300, height: 200 },
        launch(win, args) { win.state.args = args || {}; win.state.launches = 1; win.body.textContent = 'tek'; },
        relaunch(win, args) { win.state.args = args || {}; win.state.launches = (win.state.launches || 0) + 1; }
      });
    }
  }

  // ------------------------------------------------------------------ helpers
  const rootEl = () => document.getElementById('desktop');
  const iconEl = (key) => qa('#desktop .desk-icon').find((e) => e.dataset.key === key) || null;
  const innerEl = (key) => { const i = iconEl(key); return i ? i.querySelector('.desk-inner') : null; };
  const deskItem = (key) => P.desktop.items().find((i) => i.key === key) || null;
  const trashItem = () => P.desktop.items().find((i) => i.kind === 'trash');
  const menuItems = () => qa('#context-menu-layer .ctx-item');
  const menuItem = (label) => menuItems().find((e) => (q('.ctx-label', e) || {}).textContent === label) || null;
  const tbBtn = (id) => q(`#taskbar .tb-app[data-app="${id}"]:not(.leaving)`);
  const lockRoot = () => q('#lock-screen .lock-root');

  function cleanFile(path) {
    try { if (P.fs.exists(path)) P.fs.remove(path, { recursive: true }); } catch (e) { /* ignore */ }
  }

  async function closeDialogs(t) {
    for (let i = 0; i < 5 && P.dialog.isOpen(); i++) {
      t.key(document.activeElement || document.body, 'Escape');
      await t.sleep(20);
    }
  }

  async function reset(t) {
    ensureApps();
    if (P.session.isLocked()) {
      if (P.session.state() === 'off') {
        t.click(q('.boot-power'));
        await t.waitFor(() => P.session.state() === 'locked', 6000);
      }
      if (P.session.state() === 'locked') await P.session.unlock();
    }
    await closeDialogs(t);
    if (P.contextMenu.isOpen()) P.contextMenu.hide();
    P.startMenu.close();
    P.taskbar.closePanel();
    P.wm.list().slice().forEach((w) => w.forceClose());
    P.notify.clear();
    P.settings.set('dnd', false);
    P.settings.set('muted', false);
    P.theme.set('dark');
    P.clipboard.clear();
    P.desktop.select([]);
    await t.sleep(10);
  }

  function IT(name, fn) {
    T.test(name, async (t) => {
      await reset(t);
      auditing = true;
      try { await fn(t); } finally { auditing = false; await reset(t); }
    });
  }

  function lum(color) {
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return null;
    const [r, g, b] = m[1].split(',').slice(0, 3).map((v) => {
      const c = parseFloat(v) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** Solid surface colour of an element: its own background, or the first ancestor that has one. */
  function surfaceLum(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(bg);
      if (!m) continue;
      const parts = m[1].split(',').map(parseFloat);
      if (parts.length === 3 || parts[3] > 0.5) return lum(bg);
    }
    return null;
  }

  // ------------------------------------------------------------------ screenshot scenes
  const SHOT = P.params.get('shot');
  if (SHOT) {
    T.test('sahne: ' + SHOT, async (t) => {
      ensureApps();
      const noMotion = document.createElement('style');
      noMotion.textContent = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}';
      document.head.appendChild(noMotion);
      const blockResize = () => window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);
      const pt = (x, y) => ({ clientX: x, clientY: y });
      const launch = (id, args, b) => {
        const w = P.apps.launch(id, args);
        if (w && b) { w.setSize(b.width, b.height); w.setPosition(b.x, b.y); }
        return w;
      };
      const seedNotifications = () => {
        P.settings.set('dnd', true); // history only: no toasts covering the picture
        P.notify({ title: 'Yedekleme tamamlandı', message: 'Belgeler klasörü başarıyla yedeklendi.', icon: 'folder' });
        P.notify({ title: 'Zamanlayıcı bitti', message: 'Çay demlendi! Afiyet olsun.', icon: 'clock', appId: 'clock' });
        P.notify({ title: 'Disk neredeyse dolu', message: 'Depolama alanının %92\'si kullanılıyor.', icon: 'warning' });
        P.notify({ title: 'PandaOS\'a hoş geldin!', message: 'Başlat menüsünü açmak için panda simgesine tıkla.', icon: 'panda' });
        P.settings.set('dnd', false);
      };

      if (SHOT === 'desktop' || SHOT === 'e2e') {
        // nothing to prepare (e2e: only the stand-in apps are registered, for the real-input driver)
      } else if (SHOT === 'windows') {
        launch('files', {}, { x: 90, y: 60, width: 760, height: 470 });
        launch('notepad', {}, { x: 380, y: 190, width: 620, height: 420 });
      } else if (SHOT === 'snap') {
        const a = launch('terminal', {}, { x: 140, y: 80, width: 640, height: 420 });
        launch('notepad', {}, { x: 320, y: 200, width: 600, height: 400 });
        const b = launch('files', {});
        b.snap('left');
        a.focus();
        await t.sleep(30);
        P.wm.list().find((w) => w.appId === 'notepad').snap('right');
        P.wm.list().find((w) => w.appId === 'notepad').focus();
      } else if (SHOT === 'start') {
        launch('files', {}, { x: 200, y: 80, width: 700, height: 440 });
        P.startMenu.open();
      } else if (SHOT === 'search') {
        P.startMenu.open();
        const input = q('.sm-input');
        input.value = 'not';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (SHOT === 'calendar') {
        launch('notepad', {}, { x: 300, y: 120, width: 620, height: 420 });
        P.taskbar.openPanel('calendar');
      } else if (SHOT === 'quick') {
        launch('notepad', {}, { x: 300, y: 120, width: 620, height: 420 });
        P.taskbar.openPanel('quicksettings');
      } else if (SHOT === 'notifications') {
        launch('notepad', {}, { x: 300, y: 120, width: 620, height: 420 });
        seedNotifications();
        P.taskbar.openPanel('notifications');
      } else if (SHOT === 'taskbar') {
        launch('files'); launch('terminal'); launch('notepad'); launch('notepad'); launch('calculator');
        seedNotifications();
      } else if (SHOT === 'ctx' || SHOT === 'ctxicon') {
        launch('terminal', {}, { x: 420, y: 160, width: 600, height: 380 });
        blockResize();
        if (SHOT === 'ctx') {
          t.contextmenu(rootEl(), pt(560, 300));
          await t.sleep(80);
          t.click(menuItem('Yeni'));
        } else {
          t.contextmenu(innerEl('Beni Oku.txt'));
        }
      } else if (SHOT === 'confirm' || SHOT === 'alert') {
        launch('notepad', {}, { x: 300, y: 120, width: 620, height: 420 });
        if (SHOT === 'confirm') {
          P.dialog.confirm({ title: 'Kalıcı olarak sil', message: '“Beni Oku.txt” kalıcı olarak silinecek. Bu işlem geri alınamaz.', okText: 'Sil', danger: true });
        } else {
          P.dialog.alert({ title: 'Kaydedilemedi', message: 'Depolama alanı dolu. Biraz yer açıp tekrar dene.', icon: 'error' });
        }
      } else if (SHOT === 'picker') {
        launch('notepad', {}, { x: 300, y: 120, width: 620, height: 420 });
        P.dialog.pickFile({ mode: 'open', title: 'Dosya aç', dir: P.fs.HOME + '/Belgeler', extensions: ['.txt', '.md'] });
        await t.waitFor(() => q('.dlg-card.fp'));
        const row = q('.fp-row[data-path$="Notlar.txt"]');
        if (row) row.click();
      } else if (SHOT === 'toasts') {
        launch('files', {}, { x: 200, y: 80, width: 700, height: 440 });
        P.notify({ title: 'Yedekleme tamamlandı', message: 'Belgeler klasörü başarıyla yedeklendi.', icon: 'folder', timeout: 0 });
        P.notify({ title: 'Zamanlayıcı bitti', message: 'Çay demlendi!', icon: 'clock', appId: 'clock', timeout: 0, actions: [{ label: 'Tekrarla', action() {} }] });
        P.notify({ title: 'Disk neredeyse dolu', message: 'Depolama alanının %92\'si kullanılıyor.', icon: 'warning', timeout: 0 });
      } else {
        throw new Error('bilinmeyen sahne: ' + SHOT);
      }
      await t.sleep(350);
      document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* infinite */ } });
      await t.sleep(120);
    });
    return;
  }

  // ------------------------------------------------------------------ fs <-> desktop <-> apps <-> wm <-> taskbar
  IT('fs -> masaüstü: dosya oluşturunca simge belirir, silince kaybolur, simge türe uyar', async (t) => {
    const path = DIR + '/Entegrasyon.txt';
    const dir = DIR + '/Entegrasyon Klasörü';
    P.fs.writeFile(path, 'merhaba');
    P.fs.mkdir(dir);
    await t.waitFor(() => iconEl('Entegrasyon.txt') && iconEl('Entegrasyon Klasörü'), 2000, 'simgeler gelmedi');
    t.eq(deskItem('Entegrasyon.txt').icon, 'file-text');
    t.eq(deskItem('Entegrasyon Klasörü').icon, 'folder');
    t.ok(P.icons.has(deskItem('Entegrasyon.txt').icon));
    const cells = P.desktop.items().map((i) => `${i.col},${i.row}`);
    t.eq(new Set(cells).size, cells.length, 'simgeler üst üste binmemeli');
    P.fs.remove(path);
    P.fs.remove(dir, { recursive: true });
    await t.waitFor(() => !iconEl('Entegrasyon.txt') && !iconEl('Entegrasyon Klasörü'), 2000, 'simgeler kalktı mı');
  });

  IT('.app kısayoluna çift tık: pencere açılır, görev çubuğunda görünür, görev çubuğundan küçült / geri yükle', async (t) => {
    const lnk = DIR + '/Entegrasyon Deneme.app';
    P.fs.writeFile(lnk, JSON.stringify({ appId: DUMMY, args: { from: 'kisayol' } }));
    try {
      await t.waitFor(() => innerEl('Entegrasyon Deneme.app'));
      t.eq(deskItem('Entegrasyon Deneme.app').icon, 'folder', '.app simgesi hedef uygulamanınki olmalı');
      t.eq(deskItem('Entegrasyon Deneme.app').name, 'Entegrasyon Deneme', '.app uzantısı gösterilmemeli');
      t.dblclick(innerEl('Entegrasyon Deneme.app'));
      await t.waitFor(() => P.wm.byApp(DUMMY).length === 1, 2000, 'pencere açılmadı');
      const win = P.wm.byApp(DUMMY)[0];
      t.eq(win.state.args, { from: 'kisayol' }, 'args kısayoldan geçmeli');
      t.ok(win.isFocused(), 'yeni pencere odakta olmalı');
      const btn = tbBtn(DUMMY);
      t.ok(btn && btn.classList.contains('running') && btn.classList.contains('active'), 'görev çubuğunda çalışan/etkin düğme');
      const rect = P.taskbar.getButtonRect(win.id);
      const bar = q('#taskbar').getBoundingClientRect();
      t.ok(rect && rect.width > 10 && rect.top >= bar.top - 1 && rect.bottom <= bar.bottom + 1, 'getButtonRect görev çubuğu içinde olmalı');
      // taskbar button: focused window -> minimize
      t.click(btn);
      t.ok(win.isMinimized(), 'odaktaki pencere düğmeyle küçülmeli');
      t.ok(!win.isFocused() && !btn.classList.contains('active'), 'küçülen pencere etkin görünmemeli');
      t.ok(btn.classList.contains('running'), 'küçültülmüş pencere görev çubuğunda kalmalı');
      // and again -> restore + focus
      t.click(btn);
      t.ok(!win.isMinimized() && win.isFocused(), 'düğme pencereyi geri getirmeli');
      t.ok(tbBtn(DUMMY).classList.contains('active'));
      // close: button disappears (not pinned)
      await win.close();
      await t.waitFor(() => !tbBtn(DUMMY), 2000, 'kapanan pencerenin düğmesi kalktı mı');
    } finally {
      cleanFile(lnk);
    }
  });

  IT('tohum kısayolları: masaüstündeki her .app kayıtlı bir uygulamayı açar ve pencere başlığı uygulama adıdır', async (t) => {
    const apps = P.desktop.items().filter((i) => i.kind === 'app');
    t.ok(apps.length >= 9, 'tohum kısayolları görünmeli');
    for (const it of apps) {
      const target = JSON.parse(P.fs.readFile(it.path));
      const def = P.apps.get(target.appId);
      t.ok(def, `${it.name}: ${target.appId} uygulaması kayıtlı olmalı`);
      t.eq(it.icon, def.icon, `${it.name}: simge hedef uygulamanınki`);
      t.ok(P.icons.has(def.icon), `${def.id}: simge adı icons'ta var`);
      t.eq(it.name, def.name, `${it.name}: kısayol adı uygulama adıyla aynı`);
    }
    const w = P.apps.openFile(DIR + '/Hesap Makinesi.app');
    t.ok(w && w.appId === 'calculator');
    t.eq(w.getTitle(), P.apps.get('calculator').name);
  });

  IT('singleInstance: ikinci başlatma mevcut pencereyi odaklar ve relaunch çağırır', async (t) => {
    const a = P.apps.launch(DUMMY_SINGLE, {});
    const other = P.apps.launch(DUMMY, {});
    t.ok(other.isFocused());
    a.minimize();
    const b = P.apps.launch(DUMMY_SINGLE, { x: 1 });
    t.ok(a === b, 'aynı pencere');
    t.ok(!a.isMinimized() && a.isFocused(), 'küçültülmüşse geri gelmeli');
    t.eq(a.state.launches, 2);
    t.eq(P.wm.byApp(DUMMY_SINGLE).length, 1);
    t.eq(qa('#taskbar .tb-app[data-app="' + DUMMY_SINGLE + '"]').length, 1, 'tek düğme');
  });

  IT('Çöp Kutusu simgesine çift tık: Dosyalar trash: yoluyla açılır', async (t) => {
    t.dblclick(innerEl('::trash'));
    await t.waitFor(() => P.wm.byApp('files').length === 1, 2000);
    t.eq(P.wm.byApp('files')[0].state.args, { path: 'trash:' });
  });

  IT('Delete ile çöpe taşıma: simge kalkar, Çöp Kutusu dolar, geri yükleyince simge döner', async (t) => {
    P.fs.emptyTrash();
    await t.waitFor(() => trashItem().icon === 'trash');
    const path = DIR + '/Silinecek.txt';
    P.fs.writeFile(path, 'x');
    await t.waitFor(() => iconEl('Silinecek.txt'));
    P.desktop.select(['Silinecek.txt']);
    t.key(rootEl(), 'Delete');
    t.ok(!P.fs.exists(path), 'dosya çöpe gitmeli');
    t.eq(P.fs.trashCount(), 1);
    await t.waitFor(() => !iconEl('Silinecek.txt'), 2000, 'simge kalktı mı');
    t.eq(trashItem().icon, 'trash-full', 'çöp kutusu dolu simgesi');
    t.ok(String(P.desktop.tipText('::trash')).includes('1 öğe'), 'ipucu doluluğu göstermeli');
    const id = P.fs.listTrash()[0].id;
    const back = P.fs.restore(id);
    t.eq(back, path);
    await t.waitFor(() => iconEl('Silinecek.txt'), 2000, 'simge geri geldi mi');
    t.eq(trashItem().icon, 'trash', 'çöp kutusu yeniden boş');
    cleanFile(path);
  });

  IT('sağ tık menüsü: simge menüsünden çöpe taşı, boş alan menüsünden Yeni > Klasör', async (t) => {
    const path = DIR + '/Menü Deneme.txt';
    P.fs.writeFile(path, 'x');
    await t.waitFor(() => innerEl('Menü Deneme.txt'));
    t.contextmenu(innerEl('Menü Deneme.txt'));
    await t.waitFor(() => P.contextMenu.isOpen() && menuItem('Çöp kutusuna taşı'), 2000, 'menü açılmadı');
    t.ok(menuItem('Aç') && menuItem('Kopyala') && menuItem('Özellikler'));
    t.click(menuItem('Çöp kutusuna taşı'));
    t.ok(!P.contextMenu.isOpen(), 'eylem menüyü kapatmalı');
    t.ok(!P.fs.exists(path) && P.fs.trashCount() >= 1);
    P.fs.emptyTrash();

    // background menu
    const before = P.fs.list(DIR).length;
    t.contextmenu(rootEl(), { clientX: 700, clientY: 400 });
    await t.waitFor(() => P.contextMenu.isOpen() && menuItem('Yeni'), 2000);
    t.click(menuItem('Yeni'));
    await t.waitFor(() => menuItem('Klasör'), 2000, 'alt menü açılmadı');
    t.click(menuItem('Klasör'));
    await t.waitFor(() => q('#desktop .desk-rename'), 2000, 'yeniden adlandırma kutusu açılmadı');
    t.ok(P.fs.isDir(DIR + '/Yeni Klasör'), 'klasör fs\'de oluşmalı');
    const ta = q('#desktop .desk-rename');
    ta.value = 'Fikirler';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    t.key(ta, 'Enter');
    await t.waitFor(() => P.fs.isDir(DIR + '/Fikirler'), 2000, 'yeni ad uygulanmadı');
    t.ok(!P.fs.exists(DIR + '/Yeni Klasör'));
    t.eq(P.fs.list(DIR).length, before + 1);
    cleanFile(DIR + '/Fikirler');
  });

  IT('boş masaüstüne tıklamak etkin pencereyi pasifleştirir (wm.blurAll)', async (t) => {
    const w = P.apps.launch(DUMMY);
    t.ok(w.isFocused());
    t.ok(tbBtn(DUMMY).classList.contains('active'));
    t.click(q('#desktop .desk-icons'), { clientX: 900, clientY: 300 });
    t.ok(!w.isFocused(), 'masaüstüne tıklayınca pencere pasif olmalı');
    t.ok(!w.el.classList.contains('wm-focused'));
    t.eq(P.wm.getFocused(), null);
    t.ok(!tbBtn(DUMMY).classList.contains('active'), 'görev çubuğu düğmesi de pasif');
    // keyboard now belongs to the desktop, not to the (inactive) window
    let n = 0;
    w.on('keydown', () => n++);
    t.key(document.body, 'ArrowDown');
    t.eq(n, 0);
    // clicking the window brings it back
    t.click(w.el.querySelector('.wm-body'));
    t.ok(w.isFocused());
  });

  IT('klavye sahipliği: pencere odaktayken Delete masaüstü dosyasını silmez; masaüstü odaktayken siler', async (t) => {
    const path = DIR + '/Klavye.txt';
    P.fs.writeFile(path, 'x');
    await t.waitFor(() => iconEl('Klavye.txt'));
    P.desktop.select(['Klavye.txt']);
    const w = P.apps.launch(DUMMY);
    let keys = 0;
    w.on('keydown', (e) => { if (e.key === 'Delete') keys++; });
    t.key(document.body, 'Delete');
    t.eq(keys, 1, 'pencere tuşu almalı');
    t.ok(P.fs.exists(path), 'masaüstü, pencere odaktayken dosyayı silmemeli');
    t.key(w.el, 'Delete');
    t.eq(keys, 2);
    t.ok(P.fs.exists(path));
    cleanFile(path);
  });

  IT('panolar ve diyaloglar: Ctrl+C/V kopya üretir, dışarıdan kesilen dosya yapıştırınca taşınır, çöp kutusunu boşaltma onay ister, Terminalde aç cwd verir', async (t) => {
    const src = DIR + '/Pano.txt';
    P.fs.writeFile(src, 'pano');
    await t.waitFor(() => iconEl('Pano.txt'));
    P.desktop.select(['Pano.txt']);
    t.key(rootEl(), 'c', { ctrlKey: true });
    t.eq(P.clipboard.get(), { op: 'copy', paths: [src] });
    t.key(rootEl(), 'v', { ctrlKey: true });
    t.ok(P.fs.exists(DIR + '/Pano (kopya).txt'), 'Ctrl+V kopya üretmeli');
    await t.waitFor(() => iconEl('Pano (kopya).txt'));
    t.eq(P.desktop.selection(), ['Pano (kopya).txt'], 'yapıştırılan seçili olmalı');
    P.fs.remove(DIR + '/Pano (kopya).txt');

    // cut elsewhere (as the file manager would), paste on the desktop
    const other = '/home/panda/Belgeler/Pano Taşı.txt';
    P.fs.writeFile(other, 'taşı');
    P.clipboard.set({ op: 'cut', paths: [other] });
    t.key(rootEl(), 'v', { ctrlKey: true });
    t.ok(P.fs.exists(DIR + '/Pano Taşı.txt') && !P.fs.exists(other), 'kesilen dosya masaüstüne taşınmalı');
    t.eq(P.clipboard.get(), null, 'kesme yapıştırınca pano temizlenmeli');
    cleanFile(DIR + '/Pano Taşı.txt');

    // empty trash through the trash icon's menu: confirm dialog first
    P.fs.trash(src);
    await t.waitFor(() => trashItem().icon === 'trash-full');
    t.contextmenu(innerEl('::trash'));
    await t.waitFor(() => menuItem('Çöp kutusunu boşalt'), 2000);
    t.ok(!menuItem('Çöp kutusunu boşalt').classList.contains('disabled') && !menuItem('Çöp kutusunu boşalt').hasAttribute('aria-disabled'), 'doluyken boşalt etkin olmalı');
    t.click(menuItem('Çöp kutusunu boşalt'));
    await t.waitFor(() => P.dialog.isOpen(), 2000, 'onay diyaloğu açılmalı');
    t.eq(P.fs.trashCount(), 1, 'onaydan önce silinmemeli');
    t.key(document.activeElement, 'Escape');
    await t.waitFor(() => !P.dialog.isOpen());
    t.eq(P.fs.trashCount(), 1, 'iptal edince çöp kutusu dolu kalmalı');
    t.contextmenu(innerEl('::trash'));
    await t.waitFor(() => menuItem('Çöp kutusunu boşalt'));
    t.click(menuItem('Çöp kutusunu boşalt'));
    await t.waitFor(() => P.dialog.isOpen());
    t.ok(!document.activeElement.classList.contains('dlg-primary'), 'tehlikeli onay İptal üzerinde açılmalı');
    t.click(t.$('#dialog-layer .dlg-primary'));
    await t.waitFor(() => P.fs.trashCount() === 0, 2000, 'onaylayınca boşalmalı');
    await t.waitFor(() => trashItem().icon === 'trash');

    // "Terminalde aç"
    t.contextmenu(rootEl(), { clientX: 900, clientY: 400 });
    await t.waitFor(() => menuItem('Terminalde aç'));
    t.click(menuItem('Terminalde aç'));
    await t.waitFor(() => P.wm.byApp('terminal').length === 1);
    t.eq(P.wm.byApp('terminal')[0].state.args, { cwd: DIR }, 'terminale cwd geçmeli');
    // "Kişiselleştir" / "Duvar kağıdını değiştir" -> settings pages
    t.contextmenu(rootEl(), { clientX: 900, clientY: 400 });
    await t.waitFor(() => menuItem('Duvar kağıdını değiştir'));
    t.click(menuItem('Duvar kağıdını değiştir'));
    await t.waitFor(() => P.wm.byApp('settings').length === 1);
    t.eq(P.wm.byApp('settings')[0].state.args, { page: 'wallpaper' });
  });

  IT('kapatma: açık diyaloglar iptal edilir (söz çözülür), pencereler kapanır, güç düğmesiyle geri açılır', async (t) => {
    P.apps.launch(DUMMY);
    let result = 'bekliyor';
    P.dialog.confirm({ title: 'Silinsin mi?', message: 'x' }).then((v) => { result = v; });
    await t.waitFor(() => P.dialog.isOpen());
    P.session.shutdown();
    await t.waitFor(() => result === false, 2000, 'diyalog iptal edilmeli');
    t.ok(!P.dialog.isOpen(), 'kapanışta diyalog kalmamalı');
    t.eq(P.wm.list().length, 0, 'pencereler kapanmalı');
    await t.waitFor(() => P.session.state() === 'off', 6000);
    t.ok(blockers([[600, 300]]).length > 0, 'kapalıyken siyah ekran tıklamayı yakalamalı');
    t.click(q('.boot-power'));
    await t.waitFor(() => P.session.state() === 'locked', 8000, 'yeniden açılınca kilit ekranı');
    t.ok(!P.dialog.isOpen(), 'eski diyalog geri gelmemeli');
    await P.session.unlock();
  });

  IT('kapat / yeniden başlat: kaydedilmemiş iş soran pencere (beforeClose) isteği iptal edebilir; izin verirse oturum kapanır', async (t) => {
    const w = P.apps.launch(DUMMY);
    const other = P.apps.launch(DUMMY); // no guard: simply closes with the session
    let asked = 0;
    let allow = false;
    w.beforeClose = () => { asked++; return allow; };
    P.session.shutdown();
    await t.waitFor(() => asked === 1, 2000, 'pencere sorulmalı');
    await t.sleep(60);
    t.eq(P.session.state(), 'running', 'iptal edilince oturum sürmeli');
    t.ok(!w.isClosed() && !other.isClosed(), 'pencereler açık kalmalı');
    t.ok(w.isFocused(), 'soran pencere öne gelmeli');
    allow = true;
    P.session.restart();
    await t.waitFor(() => P.session.state() === 'shuttingDown', 2000, 'izin verilince yeniden başlamalı');
    t.eq(asked, 2);
    t.eq(P.wm.list().length, 0, 'tüm pencereler kapanmalı');
    await t.waitFor(() => P.session.state() === 'locked', 8000, 'yeniden açılış kilit ekranı');
    await P.session.unlock();
  });

  IT('gerçek bilgisayardan sürüklenen dosya pencereye / görev çubuğuna bırakılınca sayfa gezinmez', async (t) => {
    const w = P.apps.launch(DUMMY);
    const targets = [w.body, q('#taskbar'), rootEl()];
    for (const target of targets) {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'dis.txt', { type: 'text/plain' }));
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
      target.dispatchEvent(over);
      t.ok(over.defaultPrevented, 'dragover iptal edilmeli (aksi halde tarayıcı dosyayı açar): ' + (target.id || target.className));
    }
    // internal drags (our own paths mime type) are left alone by the safety net
    const dt2 = new DataTransfer();
    dt2.setData('application/x-pandaos-paths', JSON.stringify([DIR]));
    const over2 = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2 });
    w.body.dispatchEvent(over2);
    t.ok(!over2.defaultPrevented, 'iç sürükleme güvenlik ağına takılmamalı');
  });

  IT('küçültülmüş ve kapanan pencereler tıklamayı engellemez', async (t) => {
    const w = P.apps.launch(DUMMY);
    w.setSize(400, 300);
    w.setPosition(300, 200);
    const point = [w.getBounds().x + 100, w.getBounds().y + 100];
    t.ok(document.elementFromPoint(...point).closest('.wm-window') === w.el);
    w.minimize();
    await t.sleep(30);
    t.ok(!document.elementFromPoint(...point).closest('.wm-window'), 'küçültülmüş pencere tıklamayı yakalamamalı');
    w.restore();
    t.ok(document.elementFromPoint(...point).closest('.wm-window') === w.el);
    P.wm.forceAnimations = true;
    try {
      await w.close();
      t.ok(!document.elementFromPoint(...point).closest('.wm-window'), 'kapanma animasyonundaki pencere tıklamayı yakalamamalı');
    } finally { P.wm.forceAnimations = false; }
  });

  // ------------------------------------------------------------------ session <-> wm <-> start menu <-> ui
  IT('kilit: başlat menüsü ve bağlam menüsü kapanır, tuşlar pencereye/masaüstüne gitmez, açınca gider', async (t) => {
    const w = P.apps.launch(DUMMY);
    let n = 0;
    w.on('keydown', () => n++);
    t.key(document.body, 'a');
    t.eq(n, 1, 'kilitten önce pencere tuşu alır');
    P.startMenu.open();
    t.ok(P.startMenu.isOpen());
    t.contextmenu(rootEl(), { clientX: 800, clientY: 300 });
    await t.sleep(30);
    const path = DIR + '/Kilit.txt';
    P.fs.writeFile(path, 'x');
    await t.waitFor(() => iconEl('Kilit.txt'));
    P.desktop.select(['Kilit.txt']);
    t.ok(!w.isFocused(), 'masaüstü sağ tık menüsü pencereyi pasifleştirir');
    w.focus();
    t.ok(P.contextMenu.isOpen(), 'pencereyi odaklamak menüyü kapatmamalı (kilit kapatmalı)');
    const done = P.session.lock();
    t.ok(P.session.isLocked() && P.session.state() === 'locked');
    t.ok(!P.startMenu.isOpen(), 'kilit başlat menüsünü kapatmalı');
    t.ok(!P.contextMenu.isOpen(), 'kilit bağlam menüsünü kapatmalı');
    t.ok(lockRoot().classList.contains('active'));
    t.key(document.body, 'b');
    t.key(w.el, 'c');
    t.key(rootEl(), 'Delete');
    t.eq(n, 1, 'kilitliyken pencere tuş almamalı');
    t.ok(P.fs.exists(path), 'kilitliyken masaüstü Delete işlemeli değil');
    t.ok(!P.startMenu.isOpen());
    // Ctrl+Esc / Meta must not open the start menu on the lock screen
    t.key(document.body, 'Escape', { ctrlKey: true });
    t.ok(!P.startMenu.isOpen(), 'kilitliyken başlat menüsü açılmamalı');
    P.session.unlock();
    await done;
    await t.waitFor(() => !lockRoot().classList.contains('active'), 2000);
    t.key(document.body, 'd');
    t.eq(n, 2, 'açıldıktan sonra tuş yeniden pencereye gider');
    cleanFile(path);
  });

  IT('kilit + açık diyalog: odak kavgası yok, Enter kilidi açar (diyaloğu onaylamaz), açınca diyalog durur', async (t) => {
    const errBefore = window.__pandaErrors.length;
    let result = 'bekliyor';
    P.dialog.confirm({ title: 'Silinsin mi?', message: 'deneme', danger: true }).then((v) => { result = v; });
    await t.waitFor(() => P.dialog.isOpen());
    const done = P.session.lock();
    await t.sleep(80);
    t.eq(window.__pandaErrors.length, errBefore, 'kilit + diyalog JS hatası vermemeli: ' + window.__pandaErrors.slice(errBefore).join(' | ').slice(0, 300));
    const root = lockRoot();
    t.ok(root.contains(document.activeElement), 'odak kilit ekranında olmalı');
    // type a key: lock screen shows the sign-in view
    t.key(document.activeElement, 'x');
    await t.waitFor(() => root.classList.contains('is-signin'), 2000, 'oturum açma görünümü açılmadı');
    t.eq(result, 'bekliyor', 'kilit ekranındaki tuş diyaloğu kapatmamalı');
    const input = q('.lock-input');
    t.key(input, 'Escape');
    t.eq(result, 'bekliyor', 'Escape diyaloğu kapatmamalı');
    t.ok(!root.classList.contains('is-signin'), 'Escape saate dönmeli');
    t.key(document.activeElement, 'y');
    await t.waitFor(() => root.classList.contains('is-signin'));
    t.key(q('.lock-input'), 'Enter');
    await done;
    t.eq(result, 'bekliyor', 'Enter diyaloğu onaylamamalı, kilidi açmalı');
    t.ok(P.dialog.isOpen(), 'diyalog kilit açılınca hâlâ açık olmalı');
    await t.waitFor(() => !root.classList.contains('active'), 2000);
    t.key(document.activeElement, 'Escape');
    await t.waitFor(() => result === false, 2000, 'diyalog Escape ile kapanmalı');
    t.eq(window.__pandaErrors.length, errBefore, 'JS hatası: ' + window.__pandaErrors.slice(errBefore).join(' | ').slice(0, 300));
  });

  IT('diyalog açıkken klavye pencereye ve masaüstüne sızmaz', async (t) => {
    const w = P.apps.launch(DUMMY);
    let n = 0;
    w.on('keydown', () => n++);
    const path = DIR + '/Diyalog.txt';
    P.fs.writeFile(path, 'x');
    await t.waitFor(() => iconEl('Diyalog.txt'));
    P.desktop.select(['Diyalog.txt']);
    const p = P.dialog.alert({ title: 'Merhaba', message: 'deneme' });
    await t.waitFor(() => P.dialog.isOpen());
    t.key(document.body, 'a');
    t.key(w.el, 'b');
    t.key(rootEl(), 'Delete');
    t.eq(n, 0, 'pencere tuş almamalı');
    t.ok(P.fs.exists(path), 'masaüstü Delete işlememeli');
    t.key(document.activeElement, 'Escape', { ctrlKey: true }); // Ctrl+Esc would toggle the start menu
    t.ok(!P.startMenu.isOpen(), 'diyalog varken Ctrl+Esc başlat menüsünü açmamalı');
    if (P.dialog.isOpen()) t.key(document.activeElement, 'Enter');
    await p;
    t.ok(!P.dialog.isOpen());
    t.key(w.el, 'c');
    t.eq(n, 1);
    cleanFile(path);
  });

  IT('başlat menüsü: pencereye tıklayınca kapanır; kilitten sonra Meta ile açılır; menü açıkken tuş masaüstüne gitmez', async (t) => {
    const w = P.apps.launch(DUMMY);
    P.startMenu.open();
    t.ok(P.startMenu.isOpen());
    t.click(w.el.querySelector('.wm-body'));
    t.ok(!P.startMenu.isOpen(), 'dışarı (pencere) tıklaması menüyü kapatmalı');
    t.ok(w.isFocused());
    P.startMenu.toggle();
    t.ok(P.startMenu.isOpen());
    t.click(q('#desktop .desk-icons'), { clientX: 900, clientY: 300 });
    t.ok(!P.startMenu.isOpen(), 'masaüstü tıklaması menüyü kapatmalı');
  });

  // ------------------------------------------------------------------ notify <-> taskbar
  IT('bildirimler: toast + çan rozeti + merkezde liste; merkez açılınca okundu; DND toast göstermez', async (t) => {
    const bell = q('#taskbar .tb-bell');
    const badge = q('#taskbar .tb-badge');
    t.ok(badge.hidden, 'başlangıçta rozet gizli');
    const id = P.notify({ title: 'Entegrasyon', message: 'Merhaba dünya', icon: 'info', timeout: 0 });
    t.ok(q(`#toasts .toast[data-id="${id}"]`), 'toast görünmeli');
    t.ok(!badge.hidden && badge.textContent === '1', 'rozet 1 olmalı: ' + badge.textContent);
    P.notify({ title: 'İkinci', message: 'x', timeout: 0 });
    t.eq(badge.textContent, '2');
    t.eq(P.notify.unreadCount(), 2);
    t.click(bell);
    await t.waitFor(() => P.taskbar.isPanelOpen('notifications'), 2000);
    t.eq(qa('#panels .nc-panel .nc-item').length, 2, 'merkezde iki bildirim');
    t.ok(qa('#panels .nc-panel').some((p) => p.textContent.includes('Entegrasyon')));
    await t.waitFor(() => badge.hidden, 2000, 'merkez açılınca rozet kalkmalı');
    t.eq(P.notify.unreadCount(), 0);
    P.taskbar.closePanel();
    // do not disturb: history only
    P.settings.set('dnd', true);
    const toastsBefore = qa('#toasts .toast').length;
    P.notify({ title: 'Sessiz', message: 'DND', timeout: 0 });
    t.eq(qa('#toasts .toast').length, toastsBefore, 'DND toast göstermemeli');
    t.eq(P.notify.unreadCount(), 1);
    t.ok(!badge.hidden && badge.textContent === '1', 'DND bildirimi rozeti artırmalı');
    P.notify.clear();
    await t.waitFor(() => badge.hidden);
    await t.waitFor(() => qa('#toasts .toast:not(.leaving)').length === 0, 1500, 'clear toastları da kapatmalı');
  });

  IT('bildirim merkezi açıkken yeni bildirim toast göstermez ama listeye eklenir ve okunmuş sayılır', async (t) => {
    const early = P.notify({ title: 'Önceki', message: 'toast olarak görünüyor', timeout: 0 });
    t.ok(q('#toasts .toast[data-id="' + early + '"]:not(.leaving)'), 'önce toast görünür');
    P.taskbar.openPanel('notifications');
    await t.waitFor(() => P.taskbar.isPanelOpen('notifications'));
    await t.waitFor(() => qa('#toasts .toast:not(.leaving)').length === 0, 1500, 'merkez açılınca ekrandaki toastlar kalkmalı');
    t.ok(P.notify.history().some((n) => n.id === early), 'geçmişte kalmalı');
    const before = qa('#toasts .toast:not(.leaving)').length;
    P.notify({ title: 'Canlı bildirim', message: 'merkez açıkken', timeout: 0 });
    t.eq(qa('#toasts .toast:not(.leaving)').length, before, 'merkezin üstüne toast binmemeli');
    await t.waitFor(() => qa('#panels .nc-item').some((n) => n.textContent.includes('Canlı bildirim')), 2000, 'liste canlı güncellenmeli');
    await t.waitFor(() => P.notify.unreadCount() === 0, 1000, 'açık merkezde gelen bildirim okunmuş sayılmalı');
    P.taskbar.closePanel();
    P.notify({ title: 'Kapalı merkez', message: 'toast gelmeli', timeout: 0 });
    t.eq(qa('#toasts .toast:not(.leaving)').length, before + 1, 'merkez kapanınca toast yine görünür');
  });

  IT('toast tıklaması: appId varsa uygulamayı açar; onClick varsa onu çağırır (uygulamayı açmaz)', async (t) => {
    const id = P.notify({ title: 'Saat', message: 'zamanlayıcı bitti', appId: 'clock', timeout: 0 });
    const toast = q('#toasts .toast[data-id="' + id + '"]');
    t.ok(toast, 'toast görünmeli');
    t.click(toast);
    await t.waitFor(() => P.wm.byApp('clock').length === 1, 2000, 'toast tıklaması uygulamayı açmalı');
    t.ok(!q('#toasts .toast[data-id="' + id + '"]:not(.leaving)'), 'tıklanan toast kapanmalı');
    P.wm.byApp('clock')[0].forceClose();
    let clicked = 0;
    const id2 = P.notify({ title: 'Özel', message: 'x', appId: 'clock', timeout: 0, onClick() { clicked++; } });
    t.click(q('#toasts .toast[data-id="' + id2 + '"]'));
    t.eq(clicked, 1);
    t.eq(P.wm.byApp('clock').length, 0, 'onClick varken uygulama açılmamalı');
  });

  IT('bildirime tıklayınca uygulama açılır ve bildirim merkezinden de açılır', async (t) => {
    P.notify({ title: 'Saat', message: 'zamanlayıcı', appId: 'clock', timeout: 0 });
    P.taskbar.openPanel('notifications');
    await t.waitFor(() => q('#panels .nc-item'));
    t.click(q('#panels .nc-item'));
    await t.waitFor(() => P.wm.byApp('clock').length === 1, 2000, 'bildirim uygulamayı açmalı');
  });

  // ------------------------------------------------------------------ start menu <-> fs <-> apps
  IT('başlat menüsü araması tohum dosyayı bulur ve Enter ile uygun uygulamada açar', async (t) => {
    P.startMenu.open();
    const input = q('.sm-input');
    input.value = 'notlar';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await t.waitFor(() => q('.sm-result[data-path="/home/panda/Belgeler/Notlar.txt"]'), 2000, 'dosya sonucu yok');
    const row = q('.sm-result[data-path="/home/panda/Belgeler/Notlar.txt"]');
    t.click(row);
    await t.waitFor(() => P.wm.byApp('notepad').length === 1, 2000, 'dosya Not Defteri\'nde açılmalı');
    t.eq(P.wm.byApp('notepad')[0].state.args.path || (P.wm.byApp('notepad')[0].state.args || {}).path, '/home/panda/Belgeler/Notlar.txt');
    t.ok(!P.startMenu.isOpen(), 'açınca menü kapanmalı');
    // an app match
    P.startMenu.open();
    const input2 = q('.sm-input');
    input2.value = 'hesap';
    input2.dispatchEvent(new Event('input', { bubbles: true }));
    await t.waitFor(() => q('.sm-result[data-app="calculator"]'));
    t.key(input2, 'Enter');
    await t.waitFor(() => P.wm.byApp('calculator').length === 1, 2000);
  });

  IT('yeni kayıtlı uygulama başlat menüsünde, masaüstü kısayol simgesinde ve görev çubuğunda görünür', async (t) => {
    const id = 'intlate';
    const lnk = DIR + '/Geç Uygulama.app';
    P.fs.writeFile(lnk, JSON.stringify({ appId: id }));
    await t.waitFor(() => iconEl('Geç Uygulama.app'));
    t.eq(deskItem('Geç Uygulama.app').icon, 'file-app', 'uygulama kayıtlı değilken yedek simge');
    P.apps.register({ id, name: 'Geç Uygulama', icon: 'star', launch(win) { win.body.textContent = 'geç'; } });
    t.eq(deskItem('Geç Uygulama.app').icon, 'star', 'kayıt olunca masaüstü simgesi güncellenmeli');
    P.startMenu.open();
    t.ok(qa('.sm-app').some((b) => b.dataset.app === id), 'başlat menüsünde olmalı');
    P.startMenu.close();
    P.apps.launch(id);
    t.ok(tbBtn(id), 'görev çubuğunda olmalı');
    cleanFile(lnk);
  });

  // ------------------------------------------------------------------ layers: nothing invisible may block clicks
  const OVERLAYS = '#start-menu, #panels, #toasts, #context-menu-layer, #dialog-layer, #lock-screen, #boot-screen';
  function blockers(points) {
    const bad = [];
    points.forEach(([x, y]) => {
      document.elementsFromPoint(x, y).forEach((el) => {
        const layer = el.closest(OVERLAYS);
        if (layer && el !== layer) bad.push(`${layer.id} > ${el.className || el.tagName} @${x},${y}`);
        else if (layer) bad.push(`${layer.id} @${x},${y}`);
        if (el.id === 'windows') bad.push(`#windows @${x},${y}`);
      });
    });
    return bad;
  }
  /** Every hit-testable (pointer-events != none) box inside the overlay layers: in the idle state there must be none. */
  function interactiveOverlayBoxes() {
    const out = [];
    qa(OVERLAYS).forEach((layer) => {
      qa('*', layer).forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.pointerEvents === 'none' || cs.display === 'none' || cs.visibility === 'hidden') return;
        if (el.closest('[hidden]') || el.closest('[inert]')) return;
        if (el instanceof SVGElement) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return;
        // a child of an element that already is pointer-events:none cannot be hit unless it re-enables them
        out.push(layer.id + ' > ' + (el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' op=' + cs.opacity);
      });
    });
    return out;
  }
  function gridPoints() {
    const pts = [];
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 1; i < 14; i++) for (let j = 1; j < 10; j++) pts.push([Math.round((w * i) / 14), Math.round((h * j) / 10)]);
    pts.push([2, 2], [w - 2, 2], [2, h - 2], [w - 2, h - 2], [w / 2, h - 24]);
    return pts;
  }

  IT('katmanlar: boştayken hiçbir örtü katmanı tıklamayı yakalamaz; menü/panel/diyalog/toast kapanınca da', async (t) => {
    const pts = gridPoints();
    t.eq(blockers(pts), [], 'boşta engelleyen katman');
    t.eq(interactiveOverlayBoxes(), [], 'boşta tıklanabilir (pointer-events != none) kutu');
    // everything open at once
    P.startMenu.open();
    P.notify({ title: 'a', message: 'b', timeout: 0 });
    await t.sleep(30);
    P.startMenu.close();
    P.taskbar.openPanel('calendar');
    await t.sleep(30);
    P.taskbar.closePanel();
    t.contextmenu(rootEl(), { clientX: 500, clientY: 300 });
    await t.sleep(30);
    P.contextMenu.hide();
    P.dialog.alert({ title: 'x', message: 'y' });
    await t.waitFor(() => P.dialog.isOpen());
    t.key(document.activeElement, 'Enter');
    await t.waitFor(() => !P.dialog.isOpen());
    P.notify.clear();
    const w = P.apps.launch(DUMMY);
    w.close();
    await t.sleep(250);
    const bad = blockers(pts);
    t.eq(bad, [], 'kapatıldıktan sonra engelleyen katman: ' + bad.slice(0, 4).join('; '));
    t.eq(interactiveOverlayBoxes(), [], 'kapatıldıktan sonra tıklanabilir kutu');
    // after a lock / unlock cycle as well
    const done = P.session.lock();
    t.ok(blockers([[600, 300]]).some((s) => s.startsWith('lock-screen')), 'kilitliyken kilit ekranı tıklamayı yakalamalı');
    P.session.unlock();
    await done;
    await t.waitFor(() => !lockRoot().classList.contains('active'), 2000);
    const bad2 = blockers(pts);
    t.eq(bad2, [], 'kilit açıldıktan sonra engelleyen katman: ' + bad2.slice(0, 4).join('; '));
    t.eq(interactiveOverlayBoxes(), [], 'kilit açıldıktan sonra tıklanabilir kutu');
  });

  IT('katmanlar: pencerenin içi pencereye, masaüstü boşluğu masaüstüne, görev çubuğu görev çubuğuna gider', async (t) => {
    const w = P.apps.launch(DUMMY);
    w.setSize(400, 300);
    w.setPosition(200, 100);
    const body = w.body.getBoundingClientRect();
    const hit = (x, y) => document.elementFromPoint(x, y);
    t.ok(hit(body.left + 50, body.top + 50).closest('.wm-window') === w.el, 'pencere içi');
    t.ok(hit(900, 400).closest('#desktop'), 'boş masaüstü');
    t.ok(hit(700, window.innerHeight - 20).closest('#taskbar'), 'görev çubuğu');
    // z-order: window above desktop icons, taskbar above windows
    w.setPosition(0, 0);
    w.setSize(400, 300);
    const icon = innerEl('::trash').getBoundingClientRect();
    t.ok(hit(icon.left + 10, icon.top + 10).closest('.wm-window') === w.el, 'pencere simgelerin üstünde');
    w.maximize();
    await t.sleep(30);
    const wb = w.el.getBoundingClientRect();
    const bar = q('#taskbar').getBoundingClientRect();
    t.ok(wb.bottom <= bar.top + 1, 'büyütülmüş pencere görev çubuğuna taşmamalı');
  });

  // ------------------------------------------------------------------ theme across modules
  IT('tema: pencere, görev çubuğu, başlat menüsü, menü, diyalog ve bildirim her iki temada okunur', async (t) => {
    const w = P.apps.launch('notepad');
    const fg = (el) => (el ? lum(getComputedStyle(el).color) : null);
    async function phase(theme) {
      P.theme.set(theme);
      await t.sleep(20);
      P.startMenu.open();
      const id = P.notify({ title: 'Tema', message: 'x', timeout: 0 });
      P.dialog.alert({ title: 'Tema', message: 'x' });
      await t.waitFor(() => P.dialog.isOpen());
      t.contextmenu(rootEl(), { clientX: 900, clientY: 200 });
      w.focus(); // the desktop right-click deactivated it; the title bar colours are probed in the active state
      await t.sleep(20);
      const out = {
        window: [surfaceLum(q('.wm-body', w.el)), fg(q('.wm-body', w.el))],
        titlebar: [null, fg(q('.wm-title', w.el))],
        taskbar: [null, fg(q('#taskbar .tb-clock'))],
        start: [surfaceLum(q('.sm-panel')), fg(q('.sm-panel .sm-input'))],
        toast: [surfaceLum(q('#toasts .toast:not(.leaving)')), fg(q('#toasts .toast:not(.leaving) .toast-title'))],
        dialog: [surfaceLum(q('.dlg-card')), fg(q('.dlg-title'))],
        menu: [surfaceLum(q('#context-menu-layer .ctx-menu')), fg(q('#context-menu-layer .ctx-label'))]
      };
      P.contextMenu.hide();
      await closeDialogs(t);
      P.startMenu.close();
      P.notify.dismiss(id);
      return out;
    }
    const dark = await phase('dark');
    const light = await phase('light');
    for (const k of Object.keys(dark)) {
      const [dbg, dfg] = dark[k];
      const [lbg, lfg] = light[k];
      t.ok(dfg != null && lfg != null, k + ': yazı rengi okunamadı');
      t.ok(dfg > 0.5, k + ': koyu temada yazı açık olmalı (' + dfg + ')');
      t.ok(lfg < 0.3, k + ': açık temada yazı koyu olmalı (' + lfg + ')');
      if (dbg != null || lbg != null) {
        t.ok(dbg != null && lbg != null, k + ': yüzey rengi okunamadı');
        t.ok(dbg < 0.25, k + ': koyu temada yüzey koyu olmalı (' + dbg + ')');
        t.ok(lbg > 0.5, k + ': açık temada yüzey açık olmalı (' + lbg + ')');
      }
    }
  });

  IT('tema ↔ accent: vurgu rengi değişince CSS değişkeni ve düğmeler güncellenir', async (t) => {
    const old = P.settings.get('accent');
    P.settings.set('accent', '#3b82f6');
    t.eq(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), '#3b82f6');
    const btn = P.util.el('button', { class: 'p-btn primary', text: 'x' });
    document.body.appendChild(btn);
    const bg = getComputedStyle(btn).backgroundColor;
    btn.remove();
    // the primary fill is the accent, darkened just enough to carry white text (--accent-solid): same hue, never lighter
    const solid = P.ui.accentPair('#3b82f6').solid;
    const rgb = (h) => 'rgb(' + [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)).join(', ') + ')';
    t.eq(bg, rgb(solid), 'primary düğme vurgudan türeyen dolguyu almalı');
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    t.ok(b > r && b >= g && r <= 59 && g <= 130 && b <= 246, 'dolgu vurgu renginin koyulaştırılmış hali olmalı: ' + bg);
    P.settings.set('accent', old);
  });

  IT('ayarlar: değiştirilip settings.reset() ile sıfırlanınca tema, vurgu, masaüstü, görev çubuğu ve ses varsayılana döner', async (t) => {
    const pinnedBtns = () => qa('#taskbar .tb-app:not(.leaving)').map((b) => b.dataset.app);
    const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    P.settings.set('theme', 'light');
    P.settings.set('accent', '#e0498f');
    P.settings.set('desktop.iconSize', 'large');
    P.settings.set('taskbar.pinned', ['calculator']);
    P.settings.set('muted', true);
    P.settings.set('dnd', true);
    P.settings.set('animations', false);
    t.eq(document.documentElement.dataset.theme, 'light');
    t.eq(accent(), '#e0498f');
    t.eq(rootEl().dataset.iconSize, 'large');
    t.eq(pinnedBtns(), ['calculator'], 'görev çubuğu sabitlenenleri izlemeli');
    t.ok(document.documentElement.classList.contains('no-anim'));
    t.eq(P.sound.master().gain.value, 0, 'sessiz');
    t.ok(q('#taskbar .tb-sys'), 'tepsi var');
    P.settings.reset();
    t.eq(document.documentElement.dataset.theme, 'dark');
    t.eq(accent(), '#2f9e6b');
    t.eq(rootEl().dataset.iconSize, 'medium');
    t.eq(pinnedBtns(), ['files', 'terminal', 'notepad', 'music'], 'sabitlenenler varsayılana dönmeli');
    t.ok(!document.documentElement.classList.contains('no-anim'));
    t.ok(P.sound.master().gain.value > 0, 'ses geri gelmeli');
    P.notify({ title: 'DND kapalı', message: 'toast görünmeli', timeout: 0 });
    t.ok(qa('#toasts .toast:not(.leaving)').length >= 1, 'dnd sıfırlanınca toast görünmeli');
  });

  // ------------------------------------------------------------------ sound <-> settings, wm <-> taskbar
  IT('ses ↔ ayarlar: ana kazanç volume/muted ayarını izler', async (t) => {
    const gain = () => P.sound.master().gain.value;
    P.settings.set('muted', false);
    P.settings.set('volume', 100);
    const hi = gain();
    P.settings.set('volume', 20);
    const lo = gain();
    t.ok(hi > lo && lo > 0, `volume kazancı değiştirmeli (${hi} > ${lo} > 0)`);
    P.settings.set('muted', true);
    t.eq(gain(), 0, 'sessize alınca kazanç 0');
    P.settings.set('muted', false);
    t.ok(gain() > 0);
    P.settings.set('volume', 70);
  });

  IT('wm ↔ görev çubuğu: flash düğmeyi titreştirir, odak gelince söner; çok pencereli uygulama tek düğme', async (t) => {
    const a = P.apps.launch(DUMMY);
    const b = P.apps.launch(DUMMY);
    t.eq(qa('#taskbar .tb-app[data-app="' + DUMMY + '"]:not(.leaving)').length, 1, 'aynı uygulamanın pencereleri tek düğmede');
    t.ok(tbBtn(DUMMY).classList.contains('multi'), 'çoklu pencere işareti');
    a.focus();
    b.flash();
    await t.waitFor(() => tbBtn(DUMMY).classList.contains('flash'), 1000, 'flash sınıfı');
    b.focus();
    await t.waitFor(() => !tbBtn(DUMMY).classList.contains('flash'), 1000, 'odakla flash sönmeli');
    // minimizeAll (show desktop) and back
    P.wm.minimizeAll();
    t.ok(a.isMinimized() && b.isMinimized());
    t.ok(tbBtn(DUMMY).classList.contains('running'));
    P.wm.minimizeAll();
    t.ok(!a.isMinimized() && !b.isMinimized());
  });

  IT('pencere küçültme animasyonu görev çubuğu düğmesine doğru gider (getButtonRect)', async (t) => {
    const w = P.apps.launch(DUMMY);
    const asked = [];
    const orig = P.taskbar.getButtonRect;
    P.taskbar.getButtonRect = function (id) { const r = orig.call(this, id); asked.push([id, !!r]); return r; };
    try {
      P.wm.forceAnimations = true;
      w.minimize();
      t.ok(asked.some(([id, ok]) => id === w.id && ok), 'wm görev çubuğu düğmesini sormalı: ' + JSON.stringify(asked));
      await t.sleep(320);
      t.ok(w.el.classList.contains('wm-minimized'));
      w.restore();
      await t.sleep(300);
      t.ok(!w.el.classList.contains('wm-minimized') && w.isFocused());
    } finally {
      P.taskbar.getButtonRect = orig;
      P.wm.forceAnimations = false;
    }
  });

  // ------------------------------------------------------------------ dialogs <-> fs
  IT('dosya seçici ve özellikler diyaloğu gerçek dosya sistemini kullanır', async (t) => {
    const pick = P.dialog.pickFile({ mode: 'open', title: 'Aç', dir: '/home/panda/Belgeler', extensions: ['.txt'] });
    await t.waitFor(() => q('.dlg-card.fp'));
    const row = await t.waitFor(() => q('.fp-row[data-path="/home/panda/Belgeler/Notlar.txt"]'));
    t.dblclick(row);
    t.eq(await pick, '/home/panda/Belgeler/Notlar.txt');
    const done = P.dialog.properties('/home/panda/Belgeler/Notlar.txt');
    await t.waitFor(() => P.dialog.isOpen());
    t.ok(q('.dlg-card').textContent.includes('Notlar.txt'), 'özellikler dosya adını göstermeli');
    t.key(document.activeElement, 'Escape');
    await t.waitFor(() => !P.dialog.isOpen());
    void done;
  });

  // ------------------------------------------------------------------ randomized whole-OS run
  // A seeded random walk over the real UI (windows, taskbar, start menu, flyouts, menus, dialogs, lock screen,
  // notifications, desktop file operations, theme/settings). Every few steps the invariants that tie the
  // modules together are checked; any JS error fails the run.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function invariants(t, log) {
    const where = ' (son işlemler: ' + log.slice(-6).join(' > ') + ')';
    t.ok(qa('#panels .tb-flyout.open').length <= 1, 'aynı anda en çok bir flyout açık olmalı' + where);
    const wins = P.wm.list();
    const domWins = qa('#windows .wm-window:not(.wm-closing)');
    t.eq(domWins.length, wins.length, 'DOM penceresi sayısı wm.list() ile aynı olmalı' + where);
    const f = P.wm.getFocused();
    t.ok(!f || (wins.includes(f) && !f.isMinimized()), 'odaktaki pencere listede ve görünür olmalı' + where);
    t.ok(wins.filter((w) => w.isFocused()).length <= 1, 'en çok bir odaklı pencere' + where);
    const running = new Set(wins.map((w) => w.appId));
    const pinned = P.settings.get('taskbar.pinned').filter((id) => P.apps.get(id) || running.has(id));
    const want = new Set([...pinned, ...running]);
    const have = new Set(qa('#taskbar .tb-app:not(.leaving)').map((b) => b.dataset.app));
    t.eq([...have].sort(), [...want].sort(), 'görev çubuğu düğmeleri sabit + çalışan uygulamalar olmalı' + where);
    qa('#taskbar .tb-app:not(.leaving)').forEach((b) => {
      t.eq(b.classList.contains('running'), running.has(b.dataset.app), b.dataset.app + ' running işareti' + where);
    });
    const files = P.fs.list(DIR);
    const items = P.desktop.items();
    t.eq(items.length, files.length + 1, 'masaüstü simge sayısı fs ile aynı olmalı' + where);
    const cells = items.map((i) => i.col + ',' + i.row);
    t.eq(new Set(cells).size, cells.length, 'simgeler üst üste binmemeli' + where);
    t.eq(trashItem().icon, P.fs.trashCount() ? 'trash-full' : 'trash', 'çöp simgesi doluluğu' + where);
    const badge = q('#taskbar .tb-badge');
    t.eq(badge.hidden, P.notify.unreadCount() === 0, 'rozet okunmamış sayıyla uyumlu olmalı' + where);
  }

  function fuzzRun(seed, steps, animated) {
    T.test('rastgele yürüyüş (seed ' + seed + (animated ? ', animasyonlu' : '') + '): ' + steps + ' işlem, değişmezler bozulmaz, JS hatası olmaz', async (t) => {
      await reset(t);
      P.wm.forceAnimations = !!animated;
      auditing = true;
      const rnd = mulberry32(seed);
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
      const log = [];
      const errBefore = window.__pandaErrors.length;
      const appIds = ['files', 'terminal', 'notepad', 'calculator', 'music', 'minesweeper', 'game2048', 'settings', 'paint', 'taskmanager', 'clock', DUMMY, DUMMY_SINGLE];
      const names = ['Rapor', 'Fikir', 'Liste', 'Not', 'Çalışma', 'Şarkı'];
      const made = [];
      const wm = P.wm;
      const randWin = () => pick(wm.list());
      const protectedName = (n) => /\.app$/.test(n) || n === 'Beni Oku.txt';
      const ops = {
        launch() { P.apps.launch(pick(appIds), rnd() < 0.3 ? { path: '/home/panda/Belgeler/Notlar.txt' } : {}); },
        close() { const w = randWin(); if (w) return w.close(); },
        forceClose() { const w = randWin(); if (w) w.forceClose(); },
        minimize() { const w = randWin(); if (w) w.minimize(); },
        maximize() { const w = randWin(); if (w) w.toggleMaximize(); },
        restore() { const w = randWin(); if (w) w.restore(); },
        snap() { const w = randWin(); if (w) w.snap(pick(['left', 'right'])); },
        focus() { const w = randWin(); if (w) w.focus(); },
        move() { const w = randWin(); if (w) w.setPosition(Math.floor(rnd() * 900) - 100, Math.floor(rnd() * 600) - 40); },
        size() { const w = randWin(); if (w) w.setSize(200 + Math.floor(rnd() * 900), 150 + Math.floor(rnd() * 600)); },
        dragTitle() {
          const w = randWin();
          if (!w || w.isMinimized()) return;
          const tb = q('.wm-titlebar', w.el);
          if (tb) t.drag(tb, Math.floor(rnd() * 400) - 200, Math.floor(rnd() * 300) - 150);
        },
        taskbarClick() { const b = pick(qa('#taskbar .tb-app:not(.leaving)')); if (b) t.click(b); },
        taskbarMiddle() { const b = pick(qa('#taskbar .tb-app:not(.leaving)')); if (b) t.mouse(b, 'auxclick', { button: 1 }); },
        taskbarMenu() { const b = pick(qa('#taskbar .tb-app:not(.leaving)')); if (b) t.contextmenu(b); },
        showDesktop() { wm.minimizeAll(); },
        startToggle() { P.startMenu.toggle(); },
        startSearch() {
          P.startMenu.open();
          const input = q('.sm-input');
          if (input) { input.value = pick(['not', 'hesap', 'term', 'zzz', 'notlar', 'ç', '']); input.dispatchEvent(new Event('input', { bubbles: true })); }
        },
        startEnter() { if (P.startMenu.isOpen()) t.key(q('.sm-input'), 'Enter'); },
        panel() { P.taskbar.togglePanel(pick(['calendar', 'notifications', 'quicksettings'])); },
        panelClose() { P.taskbar.closePanel(); },
        ctxDesktop() { t.contextmenu(rootEl(), { clientX: 300 + Math.floor(rnd() * 900), clientY: 100 + Math.floor(rnd() * 600) }); },
        ctxIcon() { const i = pick(P.desktop.items()); const n = i && innerEl(i.key); if (n) t.contextmenu(n); },
        ctxPick() {
          const it = pick(menuItems().filter((e) => !e.classList.contains('disabled') && !/Yeni|Görünüm|Sırala|Kalıcı|Boşalt/.test(e.textContent)));
          if (it) t.click(it);
        },
        escape() { t.key(document.activeElement || document.body, 'Escape'); },
        notify() {
          P.notify({
            title: pick(names), message: 'm' + Math.floor(rnd() * 100), appId: rnd() < 0.3 ? pick(['clock', 'files', 'yok']) : undefined,
            icon: pick(['info', 'warning', 'error', 'panda', 'folder']), timeout: pick([0, 800, 3000])
          });
        },
        notifyClear() { P.notify.clear(); },
        notifyDismiss() { const h = P.notify.history()[0]; if (h) P.notify.dismiss(h.id); },
        dnd() { P.settings.set('dnd', !P.settings.get('dnd')); },
        theme() { P.theme.toggle(); },
        accent() { P.settings.set('accent', pick(P.settings.ACCENTS).value); },
        iconSize() { P.settings.set('desktop.iconSize', pick(['small', 'medium', 'large'])); },
        pin() { P.settings.set('taskbar.pinned', [...appIds].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 5))); },
        volume() { P.settings.set('volume', Math.floor(rnd() * 100)); P.settings.set('muted', rnd() < 0.2); },
        resize() { window.dispatchEvent(new Event('resize')); },
        createFile() {
          const n = pick(names) + ' ' + Math.floor(rnd() * 50) + (rnd() < 0.5 ? '.txt' : '');
          const path = DIR + '/' + n;
          if (P.fs.exists(path)) return;
          if (rnd() < 0.5) P.fs.writeFile(path, 'x'); else P.fs.mkdir(path);
          made.push(path);
        },
        trashFile() { const s1 = pick(P.fs.list(DIR).filter((s) => !protectedName(s.name))); if (s1) P.fs.trash(s1.path); },
        restoreTrash() { const tr = P.fs.listTrash(); if (tr.length) P.fs.restore(pick(tr).id); },
        emptyTrash() { if (rnd() < 0.3) P.fs.emptyTrash(); },
        deleteKey() {
          const k = pick(P.desktop.items().filter((i) => i.kind !== 'trash' && !protectedName(i.name)));
          if (k) { P.desktop.select([k.key]); t.key(rootEl(), 'Delete'); }
        },
        selectAll() { t.key(rootEl(), 'a', { ctrlKey: true }); },
        arrow() { t.key(rootEl(), pick(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])); },
        copyPaste() { t.key(rootEl(), 'c', { ctrlKey: true }); t.key(rootEl(), 'v', { ctrlKey: true }); },
        dblclickIcon() { const i = pick(P.desktop.items()); const n = i && innerEl(i.key); if (n) t.dblclick(n); },
        wallClick() { t.click(q('#desktop .desk-icons'), { clientX: 700 + Math.floor(rnd() * 600), clientY: 150 + Math.floor(rnd() * 500) }); },
        keyBody() { t.key(document.body, pick(['a', 'b', 'F2', 'Enter', 'Delete', ' ', 'ArrowDown'])); },
        async dialog() {
          const kind = pick(['alert', 'confirm', 'prompt']);
          const pr = P.dialog[kind]({ title: 'Fuzz', message: 'x', value: 'v' });
          await t.waitFor(() => P.dialog.isOpen(), 500);
          t.key(document.activeElement, pick(['Enter', 'Escape']));
          await Promise.race([pr, t.sleep(100)]);
        },
        async lock() {
          const done = P.session.lock();
          t.key(document.activeElement || document.body, 'x');
          t.key(document.activeElement || document.body, 'Escape');
          await t.sleep(10);
          P.session.unlock();
          await done;
        }
      };
      const weights = {
        launch: 8, close: 3, forceClose: 1, minimize: 3, maximize: 2, restore: 2, snap: 2, focus: 3, move: 2, size: 2, dragTitle: 2,
        taskbarClick: 6, taskbarMiddle: 1, taskbarMenu: 2, showDesktop: 1, startToggle: 3, startSearch: 2, startEnter: 1, panel: 4,
        panelClose: 1, ctxDesktop: 2, ctxIcon: 2, ctxPick: 2, escape: 3, notify: 5, notifyClear: 1, notifyDismiss: 1, dnd: 1,
        theme: 1, accent: 1, iconSize: 1, pin: 1, volume: 1, resize: 1, createFile: 3, trashFile: 2, restoreTrash: 2, emptyTrash: 1,
        deleteKey: 2, selectAll: 1, arrow: 1, copyPaste: 1, dblclickIcon: 2, wallClick: 2, keyBody: 2, dialog: 1, lock: 1.2
      };
      const bag = [];
      Object.keys(weights).forEach((k) => { for (let i = 0; i < Math.round(weights[k] * 10); i++) bag.push(k); });
      try {
        for (let i = 0; i < steps; i++) {
          const name = pick(bag);
          log.push(name);
          try {
            await ops[name]();
          } catch (e) {
            throw new Error('işlem ' + name + ' hata verdi: ' + (e && e.message) + ' (son işlemler: ' + log.slice(-6).join(' > ') + ')');
          }
          if (i % 7 === 6) {
            await t.sleep(animated ? 30 : 2);
            invariants(t, log);
            t.eq(window.__pandaErrors.slice(errBefore), [], 'JS hatası (son işlemler: ' + log.slice(-6).join(' > ') + ')');
          }
        }
        await t.sleep(30);
        invariants(t, log);
      } finally {
        P.wm.forceAnimations = false;
        made.forEach(cleanFile);
        P.fs.emptyTrash();
        P.settings.set('desktop.iconSize', 'medium');
        P.settings.set('taskbar.pinned', P.settings.DEFAULTS['taskbar.pinned'].slice());
        P.settings.set('accent', '#2f9e6b');
        P.settings.set('volume', 70);
        await reset(t);
      }
      t.eq(window.__pandaErrors.slice(errBefore), [], 'JS hatası');
      t.eq(interactiveOverlayBoxes(), [], 'yürüyüş sonunda tıklanabilir örtü kutusu kalmamalı');
      if (P.params.get('fuzzdebug')) { const counts = {}; log.forEach((n) => { counts[n] = (counts[n] || 0) + 1; }); throw new Error('özet: ' + JSON.stringify(counts) + ' pencere=' + P.wm.list().length); }
    });
  }
  // extra seeds for bug hunting: test=integration&fuzzseeds=1,2,3&fuzzsteps=300
  const fuzzSeeds = (P.params.get('fuzzseeds') || '').split(',').map(Number).filter(Boolean);
  (fuzzSeeds.length ? fuzzSeeds : [20241, 7, 99173]).forEach((seed) => fuzzRun(seed, parseInt(P.params.get('fuzzsteps'), 10) || 140));
  (fuzzSeeds.length ? fuzzSeeds : [31337, 4242]).forEach((seed) => fuzzRun(seed, parseInt(P.params.get('fuzzsteps'), 10) || 120, true));

  // ------------------------------------------------------------------ icon audit (keep last)
  T.test('simgeler: arayüzde istenen her simge adı icons modülünde tanımlı', async (t) => {
    // shell modules with their own glyph fallbacks (taskbar quick-settings tiles) are allowed
    const local = new Set(['bluetooth', 'theme', 'sparkle', 'night']);
    const unknown = [...iconRequests].filter((n) => !P.icons.has(n) && !local.has(n));
    t.eq(unknown, [], 'bilinmeyen simge adları');
    t.ok(iconRequests.size > 30, 'yeterince simge istenmeli (' + iconRequests.size + ')');
  });
})();
