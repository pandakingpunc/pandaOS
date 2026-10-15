/* Tests for C3a: wallpapers, desktop (icons, selection, DnD, rename, clipboard, menus) and session (lock, shutdown).
   Run: bash tools/test.sh desktop
   Screenshot helper: add "shot=<mode>" (a single scene is prepared instead of the tests), e.g.
   bash tools/shot.sh out.png "fast=1&test=desktop&shot=signin" */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T = window.PandaTest;
  const DIR = P.desktop.DIR;
  const MIME = 'application/x-pandaos-paths';
  const DUMMY = 'desktop-test-app';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ helpers
  const rootEl = () => document.getElementById('desktop');
  const iconEl = (key) => [...document.querySelectorAll('#desktop .desk-icon')].find((e) => e.dataset.key === key) || null;
  const innerEl = (key) => { const i = iconEl(key); return i ? i.querySelector('.desk-inner') : null; };
  const labelOf = (key) => { const i = iconEl(key); return i ? i.querySelector('.desk-label-text').textContent : null; };
  const itemOf = (key) => P.desktop.items().find((i) => i.key === key) || null;
  const selection = () => P.desktop.selection().slice().sort();
  const lockRoot = () => document.querySelector('#lock-screen .lock-root');
  const menuItems = () => [...document.querySelectorAll('#context-menu-layer .ctx-item')];
  const menuItem = (label) => menuItems().find((e) => e.querySelector('.ctx-label').textContent === label) || null;
  const menuLabels = () => menuItems().map((e) => e.querySelector('.ctx-label').textContent);

  function registerDummy() {
    if (P.apps.get(DUMMY)) return;
    P.apps.register({
      id: DUMMY, name: 'Test Uygulaması', icon: 'notepad', showInStartMenu: false,
      window: { width: 320, height: 220 },
      launch(win) { win.body.textContent = 'merhaba'; }
    });
  }

  function closeAllWindows() {
    P.wm.list().forEach((w) => w.forceClose());
  }

  function cellPoint(col, row) {
    const g = document.querySelector('#desktop .desk-icons').getBoundingClientRect();
    const m = { small: [84, 82], medium: [96, 100], large: [112, 122] }[P.desktop.grid().size];
    return { clientX: g.left + 8 + col * m[0] + m[0] / 2, clientY: g.top + 8 + row * m[1] + m[1] / 2 };
  }

  function freeCell() {
    const g = P.desktop.grid();
    const used = new Set(P.desktop.items().map((i) => `${i.col},${i.row}`));
    for (let c = g.cols - 1; c >= 0; c--) {
      for (let r = 0; r < g.rows; r++) if (!used.has(`${c},${r}`)) return { col: c, row: r };
    }
    return null;
  }

  function dnd(type, target, init, dt) {
    const ev = new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, dataTransfer: dt }, init));
    target.dispatchEvent(ev);
    return ev;
  }

  /** Full HTML5 drag of one desktop icon: dragstart → dragover → drop → dragend. */
  function dragIcon(key, point, opts) {
    const o = opts || {};
    const dt = new DataTransfer();
    const src = innerEl(key);
    const r = src.getBoundingClientRect();
    dnd('dragstart', src, { clientX: r.left + 6, clientY: r.top + 6 }, dt);
    const target = o.onto || rootEl();
    const init = Object.assign({ ctrlKey: !!o.ctrl }, point || { clientX: r.left, clientY: r.top });
    dnd('dragover', target, init, dt);
    if (o.cancel) return dt;
    dnd('drop', target, init, dt);
    dnd('dragend', src, init, dt);
    return dt;
  }

  function externalDrop(paths, point, opts) {
    const o = opts || {};
    const dt = new DataTransfer();
    dt.setData(MIME, JSON.stringify(paths));
    dt.setData('text/plain', paths.join('\n'));
    const target = o.onto || rootEl();
    const init = Object.assign({ ctrlKey: !!o.ctrl }, point);
    dnd('dragover', target, init, dt);
    dnd('drop', target, init, dt);
  }

  async function withNotifyCapture(fn) {
    const orig = P.notify;
    const calls = [];
    const stub = function (o) { calls.push(o); return 0; };
    Object.keys(orig || {}).forEach((k) => { stub[k] = orig[k]; });
    P.notify = stub;
    try { await fn(calls); } finally { P.notify = orig; }
  }

  function cleanupFile(path) {
    try { if (P.fs.exists(path)) P.fs.remove(path, { recursive: true }); } catch (e) { /* ignore */ }
  }

  async function ensureRunning(t) {
    if (P.session.isLocked()) {
      if (P.session.state() === 'off') {
        t.click(document.querySelector('.boot-power'));
        await t.waitFor(() => P.session.state() === 'locked', 6000);
      }
      if (P.session.state() === 'locked') await P.session.unlock();
    }
  }

  // ------------------------------------------------------------------ screenshot scenes
  const SHOT = P.params.get('shot');
  if (SHOT) {
    T.test(`sahne: ${SHOT}`, async (t) => {
      registerDummy();
      // stand-ins so the screenshots show the real app icons even while the apps are still being written
      [['files', 'Dosyalar'], ['terminal', 'Terminal'], ['notepad', 'Not Defteri'], ['calculator', 'Hesap Makinesi'], ['music', 'Müzik Çalar'],
        ['minesweeper', 'Mayın Tarlası'], ['game2048', '2048'], ['settings', 'Ayarlar'], ['paint', 'Çizim']].forEach(([id, name]) => {
        if (!P.apps.get(id)) P.apps.register({ id, name, icon: id, launch() {} });
      });
      await sleep(50);
      const set = (k, v) => P.settings.set(k, v);
      const [mode, arg] = SHOT.split(':');
      const pt = (x, y) => ({ clientX: x, clientY: y });
      // headless virtual time stalls CSS transitions (even the 1ms ones of .no-anim); static scenes render deterministically without them
      if (!/^(locked|signin|splash|shutdown|restart|off)$/.test(SHOT.split(':')[0])) {
        const st = document.createElement('style');
        st.textContent = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}';
        document.head.appendChild(st);
      }
      if (mode === 'wall') {
        set('wallpaper', arg);
        await sleep(900);
      } else if (mode === 'locked') {
        if (arg) set('wallpaper', arg);
        P.session.lock();
        await sleep(900);
      } else if (mode === 'signin') {
        if (arg) set('wallpaper', arg);
        P.session.lock();
        await sleep(600);
        t.click(lockRoot());
        await sleep(900);
      } else if (mode === 'menu-bg') {
        // the screenshot tool resizes the window right before capturing, which would close the menu
        window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);
        t.contextmenu(rootEl(), pt(560, 300));
        await sleep(250);
        t.click(menuItem('Yeni'));
        await sleep(300);
      } else if (mode === 'menu-icon') {
        window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);
        const key = P.desktop.items().find((i) => i.kind === 'app').key;
        t.contextmenu(innerEl(key));
        await sleep(300);
      } else if (mode === 'selected') {
        const keys = P.desktop.items().filter((i) => i.kind !== 'trash').slice(0, 3).map((i) => i.key);
        P.desktop.select(keys);
        const hover = innerEl(P.desktop.items()[5].key);
        hover.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(250);
      } else if (mode === 'rename') {
        P.desktop.newFolder({ col: 3, row: 1 });
        await sleep(300);
      } else if (mode === 'band') {
        rootEl().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 420, clientY: 90, button: 0, buttons: 1, pointerId: 1 }));
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 330, button: 0, buttons: 1, pointerId: 1 }));
        await sleep(300);
      } else if (mode === 'dragover') {
        const key = P.desktop.items().find((i) => i.kind === 'app').key;
        dragIcon(key, cellPoint(4, 2), { cancel: true });
        await sleep(300);
      } else if (mode === 'shutdown' || mode === 'restart' || mode === 'off') {
        if (mode === 'restart') P.session.restart();
        else P.session.shutdown();
        if (mode === 'off') await t.waitFor(() => P.session.state() === 'off', 8000);
      } else if (mode === 'splash') {
        P.session.bootSplash();
        await sleep(100);
      } else if (mode === 'ghost') {
        const keys = P.desktop.items().filter((i) => i.kind === 'app').slice(0, 3).map((i) => i.key);
        P.desktop.select(keys);
        dnd('dragstart', innerEl(keys[0]), pt(60, 60), new DataTransfer());
        const g = document.querySelector('.desk-ghost');
        if (g) { const c = g.cloneNode(true); c.style.left = '500px'; c.style.top = '300px'; c.style.zIndex = '99999'; c.style.background = 'rgba(0,0,0,.2)'; document.body.appendChild(c); }
        await sleep(100);
      } else if (mode === 'size') {
        set('desktop.iconSize', arg);
        await sleep(300);
      } else if (mode === 'light') {
        P.theme.set('light');
        await sleep(300);
      } else if (mode === 'apps') {
        closeAllWindows();
        await sleep(100);
      }
    });
    return;
  }

  // ------------------------------------------------------------------ wallpapers
  T.test('duvar kağıtları: en az 8 adet, her biri geçerli css', (t) => {
    const w = P.wallpapers;
    t.ok(Array.isArray(w) && w.length >= 8, 'en az 8 duvar kağıdı olmalı');
    const ids = w.map((x) => x.id);
    ['bamboo', 'aurora', 'sunset', 'ocean', 'mountains', 'blobs', 'midnight', 'pastel'].forEach((id) => t.ok(ids.includes(id), `${id} eksik`));
    t.eq(new Set(ids).size, ids.length, 'id\'ler benzersiz olmalı');
    w.forEach((x) => {
      t.ok(typeof x.name === 'string' && x.name.length > 2, `${x.id} adı yok`);
      t.ok(typeof x.css === 'string' && /url\(|gradient/.test(x.css), `${x.id} css geçersiz`);
      const probe = document.createElement('div');
      probe.style.background = x.css;
      t.ok(probe.style.background !== '', `${x.id} tarayıcıda çözümlenmedi`);
    });
    t.eq(w.css('yok-boyle-bir-sey'), w.css('bamboo'), 'bilinmeyen değer bamboo olmalı');
    t.eq(w.css(undefined), w.css('bamboo'));
    t.eq(w.css('vfs:/yok/dosya.png'), w.css('bamboo'), 'olmayan dosya bamboo olmalı');
  });

  T.test('duvar kağıdı: vfs: yolu görüntü dosyasından okunur', (t) => {
    const path = '/home/panda/Resimler/test-duvar.png';
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    try {
      P.fs.writeFile(path, png);
      t.ok(P.wallpapers.css(`vfs:${path}`).includes('data:image/png;base64,iVBOR'), 'png verisi css içinde olmalı');
      P.fs.writeFile(path, 'bu bir resim değil');
      t.eq(P.wallpapers.css(`vfs:${path}`), P.wallpapers.css('bamboo'), 'resim olmayan içerik bamboo\'ya düşmeli');
    } finally {
      cleanupFile(path);
    }
  });

  T.test('masaüstü: duvar kağıdı ayarı arka planı günceller', async (t) => {
    const probe = (id) => {
      const d = document.createElement('div');
      d.style.background = P.wallpapers.css(id);
      return d.style.backgroundImage;
    };
    const current = () => {
      const layers = document.querySelectorAll('#desktop .desk-wall');
      return layers[layers.length - 1].style.backgroundImage;
    };
    const original = P.settings.get('wallpaper');
    try {
      t.eq(current(), probe(original), 'başlangıç duvar kağıdı');
      P.settings.set('wallpaper', 'sunset');
      await t.waitFor(() => current() === probe('sunset'), 2000, 'sunset uygulanmadı');
      await t.waitFor(() => document.querySelectorAll('#desktop .desk-wall').length === 1, 3000, 'eski katman kaldırılmadı');
      P.settings.set('wallpaper', 'pastel');
      await t.waitFor(() => current() === probe('pastel'), 2000);
      t.eq(rootEl().dataset.wallTone, 'light', 'pastel açık tonlu olmalı');
      P.settings.set('wallpaper', 'ocean');
      await t.waitFor(() => rootEl().dataset.wallTone === 'dark');
    } finally {
      P.settings.set('wallpaper', original);
      await sleep(900);
    }
  });

  // ------------------------------------------------------------------ desktop icons
  T.test('masaüstü: her giriş ve çöp kutusu için simge çizilir', (t) => {
    const names = P.fs.list(DIR).map((s) => s.name);
    t.ok(names.length >= 5, 'tohum masaüstü dosyaları eksik');
    const icons = [...document.querySelectorAll('#desktop .desk-icon')];
    t.eq(icons.length, names.length + 1, 'simge sayısı = girişler + çöp kutusu');
    names.forEach((n) => {
      t.ok(iconEl(n), `${n} için simge yok`);
      const expected = P.fs.displayName(`${DIR}/${n}`);
      t.eq(labelOf(n), expected, `${n} etiketi`);
      t.ok(innerEl(n).querySelector('.desk-img svg'), `${n} simgesinin svg'si yok`);
    });
    t.ok(iconEl('Dosyalar.app') && !/\.app/.test(labelOf('Dosyalar.app')), '.app uzantısı etikette görünmemeli');
    t.eq(labelOf('::trash'), 'Çöp Kutusu');
    t.ok(P.desktop.DIR === '/home/panda/Masaüstü');
  });

  T.test('masaüstü: simgeler çakışmaz ve ızgara içinde kalır', (t) => {
    const g = P.desktop.grid();
    const seen = new Set();
    P.desktop.items().forEach((i) => {
      const k = `${i.col},${i.row}`;
      t.ok(!seen.has(k), `çakışma: ${i.key} → ${k}`);
      seen.add(k);
      t.ok(i.row < g.rows, `${i.key} satırı ızgara dışında`);
    });
    const layout = P.storage.get('desktop.layout');
    P.desktop.items().forEach((i) => t.eq(layout[i.key], { col: i.col, row: i.row }, `${i.key} düzeni kayıtlı olmalı`));
    t.eq(itemOf('::trash').col + ',' + itemOf('::trash').row, '0,0', 'çöp kutusu sol üstte');
  });

  T.test('masaüstü: simge boyutu ayarı', async (t) => {
    const px = () => parseFloat(getComputedStyle(innerEl('::trash').querySelector('.desk-img')).width);
    try {
      P.settings.set('desktop.iconSize', 'large');
      await t.waitFor(() => px() === 64, 2000, 'büyük boyut uygulanmadı');
      P.settings.set('desktop.iconSize', 'small');
      await t.waitFor(() => px() === 32, 2000);
      P.settings.set('desktop.iconSize', 'medium');
      await t.waitFor(() => px() === 48, 2000);
      const seen = new Set();
      P.desktop.items().forEach((i) => { t.ok(!seen.has(`${i.col},${i.row}`), 'çakışma'); seen.add(`${i.col},${i.row}`); });
    } finally {
      P.settings.set('desktop.iconSize', 'medium');
    }
  });

  T.test('masaüstü: büyük simge boyutunda sığmayan simgeler çakışmadan yeniden dizilir', async (t) => {
    const before = P.desktop.items().map((i) => `${i.key}:${i.col},${i.row}`).join('|');
    try {
      P.settings.set('desktop.iconSize', 'large');
      await sleep(80);
      const g = P.desktop.grid();
      const seen = new Set();
      P.desktop.items().forEach((i) => {
        t.ok(i.row < g.rows, `${i.key} ızgara dışında`);
        t.ok(!seen.has(`${i.col},${i.row}`), 'çakışma');
        seen.add(`${i.col},${i.row}`);
      });
    } finally {
      P.settings.set('desktop.iconSize', 'medium');
    }
    await sleep(80);
    t.eq(P.desktop.items().map((i) => `${i.key}:${i.col},${i.row}`).join('|'), before, 'küçülünce kayıtlı konumlar geri gelmeli');
  });

  T.test('.app kısayolu çift tıklanınca pencere açılır', async (t) => {
    registerDummy();
    const path = `${DIR}/Deneme.app`;
    try {
      P.fs.writeFile(path, JSON.stringify({ appId: DUMMY }));
      await t.waitFor(() => iconEl('Deneme.app'), 1000, 'Deneme simgesi oluşmadı');
      t.eq(labelOf('Deneme.app'), 'Deneme');
      t.ok(innerEl('Deneme.app').querySelector('.desk-img svg'), 'uygulama simgesi görünmeli');
      t.eq(P.apps.running(DUMMY).length, 0);
      t.dblclick(innerEl('Deneme.app'));
      await t.waitFor(() => P.apps.running(DUMMY).length === 1, 2000, 'pencere açılmadı');
      t.eq(P.wm.list().find((w) => w.appId === DUMMY).body.textContent, 'merhaba');
    } finally {
      closeAllWindows();
      cleanupFile(path);
    }
  });

  T.test('uygulama sonradan kaydedilirse .app simgesi güncellenir', async (t) => {
    const path = `${DIR}/Geç Gelen.app`;
    try {
      P.fs.writeFile(path, JSON.stringify({ appId: 'desktop-late-app' }));
      await t.waitFor(() => itemOf('Geç Gelen.app'), 500);
      t.eq(itemOf('Geç Gelen.app').icon, 'file-app', 'bilinmeyen uygulama için yedek simge');
      P.apps.register({ id: 'desktop-late-app', name: 'Geç', icon: 'calculator', showInStartMenu: false, launch() {} });
      t.eq(itemOf('Geç Gelen.app').icon, 'calculator', 'uygulama kaydolunca simge değişmeli');
    } finally {
      cleanupFile(path);
    }
  });

  T.test('çöp kutusu simgesi çift tıklanınca Dosyalar trash: ile açılır', async (t) => {
    const orig = P.apps.launch;
    const calls = [];
    P.apps.launch = (id, args) => { calls.push([id, args]); return null; };
    try {
      t.dblclick(innerEl('::trash'));
      t.eq(calls, [['files', { path: 'trash:' }]]);
      calls.length = 0;
      P.desktop.select(['::trash']);
      t.key(rootEl(), 'Enter');
      t.eq(calls, [['files', { path: 'trash:' }]], 'Enter ile de açılmalı');
    } finally {
      P.apps.launch = orig;
    }
  });

  T.test('klasör çift tıklanınca Dosyalar o yolla açılır', (t) => {
    const orig = P.apps.launch;
    const calls = [];
    P.apps.launch = (id, args) => { calls.push([id, args]); return null; };
    const path = `${DIR}/Açılacak Klasör`;
    try {
      P.fs.mkdir(path);
      t.dblclick(innerEl('Açılacak Klasör'));
      t.eq(calls, [['files', { path }]]);
    } finally {
      P.apps.launch = orig;
      cleanupFile(path);
    }
  });

  // ------------------------------------------------------------------ selection
  T.test('seçim: tıklama, Ctrl, Shift, boş alan, Ctrl+A, Escape', async (t) => {
    const apps = P.desktop.items().filter((i) => i.kind === 'app').map((i) => i.key);
    t.ok(apps.length >= 4);
    t.click(innerEl(apps[0]));
    t.eq(selection(), [apps[0]], 'tek seçim');
    t.ok(iconEl(apps[0]).classList.contains('selected'));
    t.click(innerEl(apps[1]), { ctrlKey: true });
    t.eq(selection(), [apps[0], apps[1]].sort(), 'Ctrl ile ekleme');
    t.click(innerEl(apps[0]), { ctrlKey: true });
    t.eq(selection(), [apps[1]], 'Ctrl ile çıkarma');
    t.click(innerEl(apps[3]));
    t.click(innerEl(apps[1]), { shiftKey: true });
    const order = P.desktop.items().slice().sort((a, b) => (a.col - b.col) || (a.row - b.row)).map((i) => i.key);
    const lo = Math.min(order.indexOf(apps[3]), order.indexOf(apps[1]));
    const hi = Math.max(order.indexOf(apps[3]), order.indexOf(apps[1]));
    t.eq(selection(), order.slice(lo, hi + 1).sort(), 'Shift ile aralık');
    // plain press on one of several selected icons keeps the group until the click completes
    t.click(innerEl(apps[3]));
    t.eq(selection(), [apps[3]], 'çoklu seçimde düz tıklama tek seçime iner');
    // press on empty space clears
    t.click(rootEl(), { clientX: 900, clientY: 300 });
    t.eq(selection(), [], 'boş alan seçimi temizler');
    t.key(rootEl(), 'a', { ctrlKey: true });
    t.eq(selection().length, P.desktop.items().length, 'Ctrl+A hepsini seçer');
    t.key(rootEl(), 'Escape');
    t.eq(selection(), [], 'Escape seçimi temizler');
  });

  T.test('seçim: lastik bant', async (t) => {
    P.desktop.select([]);
    const target = P.desktop.items().find((i) => i.kind === 'app');
    const r = innerEl(target.key).getBoundingClientRect();
    // start far from every icon, drag a rectangle that only covers `target`
    const sx = r.right + 60;
    const sy = r.bottom + 40;
    const root = rootEl();
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sx, clientY: sy, button: 0, buttons: 1, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10, button: 0, buttons: 1, pointerId: 1 }));
    const band = document.querySelector('#desktop .desk-band');
    t.ok(!band.hidden, 'bant görünür olmalı');
    t.ok(parseFloat(band.style.width) > 20 && parseFloat(band.style.height) > 20, 'bant boyutu');
    t.ok(selection().includes(target.key), 'bant altındaki simge seçilmeli');
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10, button: 0, pointerId: 1 }));
    t.ok(band.hidden, 'bırakınca bant gizlenmeli');
    t.ok(selection().includes(target.key));

    // the harness' own drag helper: a big sweep selects many icons
    P.desktop.select([]);
    t.drag(root, -700, -400);
    t.ok(selection().length >= 4, `geniş bant en az 4 simge seçmeli (${selection().length})`);
    // a click without movement clears
    t.click(root, { clientX: 1000, clientY: 400 });
    t.eq(selection(), []);
  });

  T.test('klavye: ok tuşları, Enter, F5', async (t) => {
    const calls = [];
    const orig = P.apps.launch;
    P.apps.launch = (id, args) => { calls.push([id, args]); return null; };
    try {
      P.desktop.select(['::trash']);
      t.key(rootEl(), 'ArrowDown');
      const first = P.desktop.selection()[0];
      t.ok(first && first !== '::trash', 'aşağı ok bir sonraki simgeyi seçer');
      t.eq(itemOf(first).col, 0);
      t.eq(itemOf(first).row, 1);
      t.key(rootEl(), 'ArrowUp');
      t.eq(selection(), ['::trash']);
      t.key(rootEl(), 'ArrowRight');
      const right = P.desktop.selection()[0];
      t.ok(itemOf(right).col > 0, 'sağ ok bir sonraki sütuna geçer');
      t.key(rootEl(), 'Home');
      t.eq(selection(), ['::trash']);
      t.key(rootEl(), 'ArrowDown', { shiftKey: true });
      t.eq(selection().length, 2, 'Shift+ok seçimi genişletir');
      t.key(rootEl(), 'F5');
      t.eq(selection().length, 2, 'yenileme seçimi korur');
    } finally {
      P.apps.launch = orig;
      P.desktop.select([]);
    }
  });

  T.test('klavye: masaüstü odakta değilken (pencere odakta) tuşları yutmaz', async (t) => {
    registerDummy();
    const win = P.apps.launch(DUMMY);
    try {
      P.desktop.select(['::trash']);
      const input = document.createElement('input');
      win.body.appendChild(input);
      input.focus();
      t.key(input, 'a', { ctrlKey: true });
      t.eq(selection(), ['::trash'], 'pencere içindeki Ctrl+A masaüstünü etkilememeli');
    } finally {
      closeAllWindows();
      P.desktop.select([]);
    }
  });

  // ------------------------------------------------------------------ context menus
  T.test('sağ tık: boş alan menüsü ▸ Yeni ▸ Klasör klasör oluşturur ve adlandırmayı başlatır', async (t) => {
    const base = 'Yeni Klasör';
    const root = rootEl();
    try {
      t.contextmenu(root, cellPoint(5, 4));
      await t.waitFor(() => P.contextMenu.isOpen(), 1000, 'menü açılmadı');
      const labels = menuLabels();
      ['Görünüm', 'Sırala', 'Yenile', 'Yapıştır', 'Yeni', 'Terminalde aç', 'Duvar kağıdını değiştir', 'Kişiselleştir'].forEach((l) => t.ok(labels.includes(l), `${l} menüde yok`));
      t.click(menuItem('Yeni'));
      await t.waitFor(() => menuItem('Klasör'), 1000, 'alt menü açılmadı');
      t.ok(menuItem('Metin Belgesi'));
      t.click(menuItem('Klasör'));
      await t.waitFor(() => P.fs.isDir(`${DIR}/${base}`), 1000, 'klasör oluşmadı');
      t.ok(!P.contextMenu.isOpen(), 'menü kapanmalı');
      const ta = await t.waitFor(() => t.$('#desktop .desk-rename'), 1000, 'yeniden adlandırma alanı açılmadı');
      t.eq(ta.value, base);
      t.eq([ta.selectionStart, ta.selectionEnd], [0, base.length], 'klasör adı tamamen seçili olmalı');
      const it = itemOf(base);
      t.ok(it, 'yeni klasör simgesi yok');
      t.eq([it.col, it.row], [5, 4], 'yeni klasör tıklanan hücrede olmalı');
      ta.value = 'Menüden Klasör';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      t.key(ta, 'Enter');
      await t.waitFor(() => P.fs.isDir(`${DIR}/Menüden Klasör`), 1000, 'yeniden adlandırma işlenmedi');
      t.ok(!P.fs.exists(`${DIR}/${base}`));
      t.ok(!t.$('#desktop .desk-rename'), 'düzenleyici kapanmalı');
      const moved = itemOf('Menüden Klasör');
      t.eq([moved.col, moved.row], [5, 4], 'konum yeniden adlandırmada korunmalı');
      t.eq(selection(), ['Menüden Klasör']);
    } finally {
      cleanupFile(`${DIR}/${base}`);
      cleanupFile(`${DIR}/Menüden Klasör`);
      P.contextMenu.hide();
    }
  });

  T.test('sağ tık: Yeni ▸ Metin Belgesi uzantısız ada odaklanır', async (t) => {
    try {
      t.contextmenu(rootEl(), cellPoint(6, 1));
      await t.waitFor(() => menuItem('Yeni'));
      t.click(menuItem('Yeni'));
      await t.waitFor(() => menuItem('Metin Belgesi'));
      t.click(menuItem('Metin Belgesi'));
      await t.waitFor(() => P.fs.isFile(`${DIR}/Yeni Metin Belgesi.txt`), 1000);
      const ta = await t.waitFor(() => t.$('#desktop .desk-rename'), 1000);
      t.eq(ta.value, 'Yeni Metin Belgesi.txt');
      t.eq([ta.selectionStart, ta.selectionEnd], [0, 'Yeni Metin Belgesi'.length], 'uzantı seçili olmamalı');
      t.key(ta, 'Escape');
      t.ok(!t.$('#desktop .desk-rename'), 'Escape iptal etmeli');
      t.ok(P.fs.isFile(`${DIR}/Yeni Metin Belgesi.txt`), 'dosya kalmalı');
    } finally {
      cleanupFile(`${DIR}/Yeni Metin Belgesi.txt`);
      P.contextMenu.hide();
    }
  });

  T.test('sağ tık: boş alan menüsü — Görünüm ve Sırala alt menüleri', async (t) => {
    try {
      t.contextmenu(rootEl(), cellPoint(7, 2));
      await t.waitFor(() => menuItem('Görünüm'));
      t.click(menuItem('Görünüm'));
      await t.waitFor(() => menuItem('Küçük simgeler'));
      t.ok(menuItem('Orta simgeler').classList.contains('checked'), 'orta işaretli olmalı');
      t.ok(!menuItem('Küçük simgeler').classList.contains('checked'));
      t.click(menuItem('Küçük simgeler'));
      t.eq(P.settings.get('desktop.iconSize'), 'small');
      await t.waitFor(() => P.desktop.grid().size === 'small');
      t.contextmenu(rootEl(), cellPoint(7, 2));
      await t.waitFor(() => menuItem('Görünüm'));
      t.click(menuItem('Görünüm'));
      await t.waitFor(() => menuItem('Küçük simgeler'));
      t.ok(menuItem('Küçük simgeler').classList.contains('checked'), 'küçük işaretli olmalı');
      t.click(menuItem('Orta simgeler'));
      t.eq(P.settings.get('desktop.iconSize'), 'medium');

      t.contextmenu(rootEl(), cellPoint(7, 2));
      await t.waitFor(() => menuItem('Sırala'));
      t.click(menuItem('Sırala'));
      await t.waitFor(() => menuItem('Ada göre'));
      t.ok(menuItem('Türe göre') && menuItem('Değiştirilme tarihine göre'));
      t.click(menuItem('Ada göre'));
      const order = P.desktop.items().slice().sort((a, b) => (a.col - b.col) || (a.row - b.row));
      t.eq(order[0].key, '::trash', 'çöp kutusu hep ilk');
      const rest = order.slice(1);
      const g = P.desktop.grid();
      rest.forEach((i, idx) => t.eq([i.col, i.row], [Math.floor((idx + 1) / g.rows), (idx + 1) % g.rows], `${i.key} ızgara sırası`));
      const names = rest.map((i) => i.name);
      const expected = rest.slice().sort((a, b) => ((b.kind === 'dir') - (a.kind === 'dir')) || P.util.compareNames(a.name, b.name)).map((i) => i.name);
      t.eq(names, expected, 'ada göre sıralı olmalı');
    } finally {
      P.settings.set('desktop.iconSize', 'medium');
      P.contextMenu.hide();
    }
  });

  T.test('sağ tık: Yenile, Terminalde aç, Duvar kağıdı, Kişiselleştir', async (t) => {
    const orig = P.apps.launch;
    const calls = [];
    P.apps.launch = (id, args) => { calls.push([id, args]); return null; };
    try {
      for (const [label, expected] of [
        ['Terminalde aç', ['terminal', { cwd: DIR }]],
        ['Duvar kağıdını değiştir', ['settings', { page: 'wallpaper' }]],
        ['Kişiselleştir', ['settings', { page: 'appearance' }]]
      ]) {
        t.contextmenu(rootEl(), cellPoint(7, 3));
        await t.waitFor(() => menuItem(label));
        t.click(menuItem(label));
        t.eq(calls.pop(), expected, label);
      }
      t.contextmenu(rootEl(), cellPoint(7, 3));
      await t.waitFor(() => menuItem('Yenile'));
      t.click(menuItem('Yenile'));
      t.ok(!P.contextMenu.isOpen());
      // paste is disabled while the clipboard is empty
      P.clipboard.clear();
      t.contextmenu(rootEl(), cellPoint(7, 3));
      await t.waitFor(() => menuItem('Yapıştır'));
      t.ok(menuItem('Yapıştır').classList.contains('disabled'), 'pano boşken Yapıştır devre dışı');
    } finally {
      P.apps.launch = orig;
      P.contextMenu.hide();
    }
  });

  T.test('sağ tık: simge menüsü öğeleri ve işlevleri', async (t) => {
    const path = `${DIR}/Menü Deneme.txt`;
    const orig = P.apps.launch;
    P.apps.launch = () => null;
    const origProps = P.dialog.properties;
    const propCalls = [];
    P.dialog.properties = (p) => { propCalls.push(p); };
    try {
      P.fs.writeFile(path, 'x');
      t.contextmenu(innerEl('Menü Deneme.txt'));
      await t.waitFor(() => menuItem('Aç'));
      t.eq(selection(), ['Menü Deneme.txt'], 'sağ tık simgeyi seçer');
      ['Aç', 'Kes', 'Kopyala', 'Yeniden adlandır', 'Çöp kutusuna taşı', 'Özellikler'].forEach((l) => t.ok(menuItem(l), `${l} yok`));
      t.click(menuItem('Özellikler'));
      t.eq(propCalls, [path]);
      t.contextmenu(innerEl('Menü Deneme.txt'));
      await t.waitFor(() => menuItem('Kopyala'));
      t.click(menuItem('Kopyala'));
      t.eq(P.clipboard.get(), { op: 'copy', paths: [path] });
      t.contextmenu(innerEl('Menü Deneme.txt'));
      await t.waitFor(() => menuItem('Kes'));
      t.click(menuItem('Kes'));
      t.eq(P.clipboard.get(), { op: 'cut', paths: [path] });
      await t.waitFor(() => iconEl('Menü Deneme.txt').classList.contains('cut'), 500, 'kesilen simge soluk olmalı');
      P.clipboard.clear();
      await t.waitFor(() => !iconEl('Menü Deneme.txt').classList.contains('cut'));
      t.contextmenu(innerEl('Menü Deneme.txt'));
      await t.waitFor(() => menuItem('Yeniden adlandır'));
      t.click(menuItem('Yeniden adlandır'));
      t.ok(t.$('#desktop .desk-rename'), 'yeniden adlandırma açılmalı');
      t.key(t.$('#desktop .desk-rename'), 'Escape');
      t.contextmenu(innerEl('Menü Deneme.txt'));
      await t.waitFor(() => menuItem('Çöp kutusuna taşı'));
      const before = P.fs.trashCount();
      t.click(menuItem('Çöp kutusuna taşı'));
      t.ok(!P.fs.exists(path), 'dosya taşınmalı');
      t.eq(P.fs.trashCount(), before + 1);
      t.ok(!iconEl('Menü Deneme.txt'), 'simge kalkmalı');
    } finally {
      P.apps.launch = orig;
      P.dialog.properties = origProps;
      cleanupFile(path);
      P.fs.emptyTrash();
      P.contextMenu.hide();
    }
  });

  T.test('sağ tık: çöp kutusu menüsü (boşken devre dışı, doluyken boşaltır)', async (t) => {
    const path = `${DIR}/Çöpe Gidecek.txt`;
    const origConfirm = P.dialog.confirm;
    const confirmCalls = [];
    P.dialog.confirm = (o) => { confirmCalls.push(o); return Promise.resolve(true); };
    try {
      P.fs.emptyTrash();
      t.contextmenu(innerEl('::trash'));
      await t.waitFor(() => menuItem('Çöp kutusunu boşalt'));
      t.ok(menuItem('Aç'));
      t.ok(menuItem('Çöp kutusunu boşalt').classList.contains('disabled'), 'boşken devre dışı olmalı');
      P.contextMenu.hide();

      P.fs.writeFile(path, 'x');
      P.fs.trash(path);
      t.contextmenu(innerEl('::trash'));
      await t.waitFor(() => menuItem('Çöp kutusunu boşalt'));
      t.ok(!menuItem('Çöp kutusunu boşalt').classList.contains('disabled'), 'doluyken etkin olmalı');
      t.click(menuItem('Çöp kutusunu boşalt'));
      await t.waitFor(() => P.fs.trashCount() === 0, 1000, 'çöp boşaltılmadı');
      t.eq(confirmCalls.length, 1, 'onay istenmeli');
      t.ok(confirmCalls[0].danger, 'onay tehlikeli türde olmalı');
    } finally {
      P.dialog.confirm = origConfirm;
      P.fs.emptyTrash();
      P.contextMenu.hide();
    }
  });

  // ------------------------------------------------------------------ rename / delete
  T.test('F2: satır içi yeniden adlandırma (Enter işler, Escape iptal eder, hata bildirilir)', async (t) => {
    const a = `${DIR}/Ad Bir.txt`;
    const b = `${DIR}/Ad İki.txt`;
    try {
      P.fs.writeFile(a, 'a');
      P.fs.writeFile(b, 'b');
      const pos = itemOf('Ad Bir.txt');
      const elBefore = iconEl('Ad Bir.txt');
      P.desktop.select(['Ad Bir.txt']);
      t.key(rootEl(), 'F2');
      let ta = await t.waitFor(() => t.$('#desktop .desk-rename'), 500, 'düzenleyici açılmadı');
      t.eq(ta.value, 'Ad Bir.txt');
      t.eq([ta.selectionStart, ta.selectionEnd], [0, 'Ad Bir'.length]);
      t.eq(document.activeElement, ta, 'odak düzenleyicide olmalı');
      // typing in the editor must not leak to the desktop shortcuts
      t.key(ta, 'a', { ctrlKey: true });
      t.eq(selection(), ['Ad Bir.txt']);
      // empty / unchanged value → cancel quietly
      t.key(ta, 'Enter');
      t.ok(!t.$('#desktop .desk-rename'));
      t.ok(P.fs.exists(a));

      // collision → error toast and the editor stays open
      await withNotifyCapture(async (calls) => {
        P.desktop.select(['Ad Bir.txt']);
        t.key(rootEl(), 'F2');
        ta = await t.waitFor(() => t.$('#desktop .desk-rename'));
        ta.value = 'Ad İki.txt';
        t.key(ta, 'Enter');
        t.eq(calls.length, 1, 'hata bildirimi beklenir');
        t.eq(calls[0].icon, 'error');
        t.ok(t.$('#desktop .desk-rename'), 'hatada düzenleyici açık kalmalı');
        ta.value = 'a/b';
        t.key(ta, 'Enter');
        t.eq(calls.length, 2, '"/" için hata bildirimi');
        t.ok(P.fs.exists(a), 'dosya değişmemeli');
        t.key(ta, 'Escape');
      });

      // success path keeps the grid position
      P.desktop.select(['Ad Bir.txt']);
      t.key(rootEl(), 'F2');
      ta = await t.waitFor(() => t.$('#desktop .desk-rename'));
      ta.value = 'Yeni Ad.txt';
      t.key(ta, 'Enter');
      await t.waitFor(() => P.fs.exists(`${DIR}/Yeni Ad.txt`), 500);
      t.ok(!P.fs.exists(a));
      const moved = itemOf('Yeni Ad.txt');
      t.eq([moved.col, moved.row], [pos.col, pos.row], 'konum korunmalı');
      t.ok(!iconEl('Ad Bir.txt'));
      t.eq(iconEl('Yeni Ad.txt'), elBefore, 'yeniden adlandırmada aynı öğe korunmalı (yeniden belirme animasyonu olmamalı)');

      // blur commits like a real file manager
      P.desktop.select(['Yeni Ad.txt']);
      t.key(rootEl(), 'F2');
      ta = await t.waitFor(() => t.$('#desktop .desk-rename'));
      ta.value = 'Odak Kaybı.txt';
      ta.blur();
      await t.waitFor(() => P.fs.exists(`${DIR}/Odak Kaybı.txt`), 500, 'blur ile adlandırma işlenmedi');
    } finally {
      cleanupFile(a);
      cleanupFile(b);
      cleanupFile(`${DIR}/Yeni Ad.txt`);
      cleanupFile(`${DIR}/Odak Kaybı.txt`);
    }
  });

  T.test('.app kısayolu yeniden adlandırılınca uzantı korunur', async (t) => {
    const path = `${DIR}/Kısayol Bir.app`;
    try {
      P.fs.writeFile(path, JSON.stringify({ appId: 'terminal' }));
      P.desktop.select(['Kısayol Bir.app']);
      t.key(rootEl(), 'F2');
      const ta = await t.waitFor(() => t.$('#desktop .desk-rename'));
      t.eq(ta.value, 'Kısayol Bir');
      ta.value = 'Kısayol İki';
      t.key(ta, 'Enter');
      await t.waitFor(() => P.fs.exists(`${DIR}/Kısayol İki.app`), 500);
      t.eq(labelOf('Kısayol İki.app'), 'Kısayol İki');
    } finally {
      cleanupFile(path);
      cleanupFile(`${DIR}/Kısayol İki.app`);
    }
  });

  T.test('Delete tuşu çöp kutusuna taşır, çöp simgesi dolu olur; boşaltınca eski haline döner', async (t) => {
    const path = `${DIR}/Silinecek.txt`;
    try {
      P.fs.emptyTrash();
      await t.waitFor(() => itemOf('::trash').icon === 'trash');
      P.fs.writeFile(path, 'x');
      P.desktop.select(['Silinecek.txt']);
      t.key(rootEl(), 'Delete');
      t.ok(!P.fs.exists(path), 'dosya silinmeli');
      t.eq(P.fs.trashCount(), 1);
      t.ok(!iconEl('Silinecek.txt'), 'simge kalkmalı');
      t.eq(itemOf('::trash').icon, 'trash-full', 'çöp simgesi dolu olmalı');
      t.ok(P.fs.listTrash().some((x) => x.originalPath === path), 'geri yüklenebilir olmalı');
      P.fs.emptyTrash();
      t.eq(itemOf('::trash').icon, 'trash', 'boşalınca boş simge');
    } finally {
      cleanupFile(path);
      P.fs.emptyTrash();
    }
  });

  T.test('Delete: çöp kutusu simgesi silinmez; çoklu seçim hepsini taşır', async (t) => {
    const a = `${DIR}/Çoklu A.txt`;
    const b = `${DIR}/Çoklu B.txt`;
    try {
      P.fs.emptyTrash();
      P.fs.writeFile(a, 'a');
      P.fs.writeFile(b, 'b');
      P.desktop.select(['::trash']);
      t.key(rootEl(), 'Delete');
      t.ok(iconEl('::trash'), 'çöp simgesi yerinde');
      P.desktop.select(['::trash', 'Çoklu A.txt', 'Çoklu B.txt']);
      t.key(rootEl(), 'Delete');
      t.ok(!P.fs.exists(a) && !P.fs.exists(b));
      t.eq(P.fs.trashCount(), 2);
      t.ok(iconEl('::trash'));
    } finally {
      cleanupFile(a);
      cleanupFile(b);
      P.fs.emptyTrash();
    }
  });

  T.test('Shift+Delete: onay sorar, onaylanırsa kalıcı siler', async (t) => {
    const a = `${DIR}/Kalıcı Sil.txt`;
    const b = `${DIR}/Kalıcı Kalsın.txt`;
    const orig = P.dialog.confirm;
    const calls = [];
    let answer = false;
    P.dialog.confirm = (o) => { calls.push(o); return Promise.resolve(answer); };
    try {
      P.fs.emptyTrash();
      P.fs.writeFile(a, 'a');
      P.fs.writeFile(b, 'b');
      P.desktop.select(['Kalıcı Sil.txt']);
      t.key(rootEl(), 'Delete', { shiftKey: true });
      await sleep(30);
      t.eq(calls.length, 1);
      t.ok(calls[0].danger && /kalıcı/i.test(calls[0].message), 'tehlikeli onay + kalıcı uyarısı');
      t.ok(P.fs.exists(a), 'reddedilince dosya kalmalı');
      answer = true;
      t.key(rootEl(), 'Delete', { shiftKey: true });
      await t.waitFor(() => !P.fs.exists(a), 500, 'onaylanınca silinmeli');
      t.eq(P.fs.trashCount(), 0, 'çöp kutusuna girmemeli');
      t.ok(P.fs.exists(b));
    } finally {
      P.dialog.confirm = orig;
      cleanupFile(a);
      cleanupFile(b);
    }
  });

  // ------------------------------------------------------------------ clipboard
  T.test('pano: Ctrl+C / Ctrl+X / Ctrl+V', async (t) => {
    const src = `${DIR}/Pano Kaynağı.txt`;
    const other = '/home/panda/Belgeler/Pano Dışarıdan.txt';
    try {
      P.fs.writeFile(src, 'içerik');
      P.desktop.select(['Pano Kaynağı.txt']);
      t.key(rootEl(), 'c', { ctrlKey: true });
      t.eq(P.clipboard.get(), { op: 'copy', paths: [src] });
      t.key(rootEl(), 'v', { ctrlKey: true });
      const copyName = P.fs.list(DIR).map((s) => s.name).find((n) => n !== 'Pano Kaynağı.txt' && n.startsWith('Pano Kaynağı'));
      t.ok(copyName, 'kopya oluşmalı (ad çakışmasında yeniden adlandırılır)');
      t.eq(P.fs.readFile(`${DIR}/${copyName}`), 'içerik');
      t.ok(iconEl(copyName), 'kopyanın simgesi görünmeli');
      t.eq(selection(), [copyName], 'yapıştırılan seçili olmalı');
      t.ok(P.clipboard.get(), 'kopyalamadan sonra pano durur');

      // cut from another folder → moved into the desktop, clipboard cleared
      P.fs.writeFile(other, 'dış');
      P.clipboard.set({ op: 'cut', paths: [other] });
      await t.waitFor(() => true);
      t.key(rootEl(), 'v', { ctrlKey: true });
      t.ok(!P.fs.exists(other), 'kaynak taşınmalı');
      t.eq(P.fs.readFile(`${DIR}/Pano Dışarıdan.txt`), 'dış');
      t.eq(P.clipboard.get(), null, 'kesme sonrası pano temizlenmeli');
      t.ok(iconEl('Pano Dışarıdan.txt'));

      // pasting a cut item whose name is taken keeps both
      P.fs.writeFile(other, 'yeni dış');
      P.clipboard.set({ op: 'cut', paths: [other] });
      t.key(rootEl(), 'v', { ctrlKey: true });
      t.ok(!P.fs.exists(other));
      t.ok(P.fs.list(DIR).filter((s) => s.name.startsWith('Pano Dışarıdan')).length === 2, 'ad çakışması yeni ad almalı');
    } finally {
      P.fs.list(DIR).filter((s) => s.name.startsWith('Pano ')).forEach((s) => cleanupFile(s.path));
      cleanupFile(other);
      P.clipboard.clear();
    }
  });

  // ------------------------------------------------------------------ drag & drop
  T.test('sürükle-bırak: simgeyi boş hücreye taşıma ve düzenin kalıcılığı', async (t) => {
    const key = P.desktop.items().find((i) => i.kind === 'app').key;
    const cell = freeCell();
    t.ok(cell, 'boş hücre bulunamadı');
    dragIcon(key, cellPoint(cell.col, cell.row));
    const moved = itemOf(key);
    t.eq([moved.col, moved.row], [cell.col, cell.row], 'simge hedef hücreye taşınmalı');
    t.eq(P.storage.get('desktop.layout')[key], cell, 'konum depoda kayıtlı olmalı');
    await sleep(60);
    P.desktop.refresh();
    t.eq([itemOf(key).col, itemOf(key).row], [cell.col, cell.row], 'yenilemeden sonra da yerinde');
    // dragging data carries the path for other windows (file manager)
    const dt = dragIcon(key, cellPoint(cell.col, cell.row), { cancel: true });
    t.eq(JSON.parse(dt.getData(MIME)), [`${DIR}/${key}`], 'x-pandaos-paths verisi');
    t.ok(dt.getData('text/plain').includes(`${DIR}/${key}`));
    dnd('dragend', innerEl(key), cellPoint(cell.col, cell.row), dt);
  });

  T.test('sürükle-bırak: dolu hücreye bırakınca en yakın boş hücre seçilir', (t) => {
    const apps = P.desktop.items().filter((i) => i.kind === 'app');
    const a = apps[0];
    const b = apps[1];
    const before = { col: a.col, row: a.row };
    dragIcon(a.key, cellPoint(b.col, b.row));
    const after = itemOf(a.key);
    t.ok(!(after.col === b.col && after.row === b.row), 'dolu hücre işgal edilmemeli');
    const seen = new Set();
    P.desktop.items().forEach((i) => { t.ok(!seen.has(`${i.col},${i.row}`), `çakışma: ${i.key}`); seen.add(`${i.col},${i.row}`); });
    t.ok(Math.abs(after.col - b.col) <= 1 && Math.abs(after.row - b.row) <= 1, 'hedefe yakın olmalı');
    t.ok(before.col !== undefined);
  });

  T.test('sürükle-bırak: çoklu seçim birlikte taşınır', async (t) => {
    const cell = freeCell();
    const apps = P.desktop.items().filter((i) => i.kind === 'app').slice(0, 3);
    P.desktop.select(apps.map((i) => i.key));
    const startCells = apps.map((i) => `${i.col},${i.row}`);
    dragIcon(apps[0].key, cellPoint(Math.min(cell.col, P.desktop.grid().cols - 3), 0));
    const seen = new Set();
    P.desktop.items().forEach((i) => { t.ok(!seen.has(`${i.col},${i.row}`), 'çakışma'); seen.add(`${i.col},${i.row}`); });
    const moved = apps.map((i) => itemOf(i.key)).map((i) => `${i.col},${i.row}`);
    t.ok(moved.some((m, idx) => m !== startCells[idx]), 'seçili simgeler hareket etmeli');
  });

  T.test('sürükle-bırak: klasör simgesine bırakınca dosya klasöre taşınır', async (t) => {
    const folder = `${DIR}/Hedef Klasör`;
    const file = `${DIR}/Taşınacak.txt`;
    try {
      P.fs.mkdir(folder);
      P.fs.writeFile(file, 'z');
      dragIcon('Taşınacak.txt', cellPoint(0, 0), { onto: innerEl('Hedef Klasör') });
      t.ok(!P.fs.exists(file), 'dosya masaüstünden kalkmalı');
      t.eq(P.fs.readFile(`${folder}/Taşınacak.txt`), 'z');
      t.ok(!iconEl('Taşınacak.txt'));
      // a folder can not be dropped into itself
      await withNotifyCapture(async (calls) => {
        dragIcon('Hedef Klasör', cellPoint(0, 0), { onto: innerEl('Hedef Klasör') });
        t.eq(calls.length, 0, 'kendi üstüne bırakma sessizce yok sayılmalı');
        t.ok(P.fs.isDir(folder));
      });
    } finally {
      cleanupFile(folder);
      cleanupFile(file);
    }
  });

  T.test('sürükle-bırak: çöp kutusu simgesine bırakınca çöpe taşınır', async (t) => {
    const file = `${DIR}/Çöpe Sürüklenen.txt`;
    try {
      P.fs.emptyTrash();
      P.fs.writeFile(file, 'z');
      dragIcon('Çöpe Sürüklenen.txt', cellPoint(0, 0), { onto: innerEl('::trash') });
      t.ok(!P.fs.exists(file));
      t.eq(P.fs.trashCount(), 1);
      t.eq(itemOf('::trash').icon, 'trash-full');
    } finally {
      cleanupFile(file);
      P.fs.emptyTrash();
    }
  });

  T.test('sürükle-bırak: bırakma hedefi vurgusu ve hücre önizlemesi', async (t) => {
    const key = P.desktop.items().find((i) => i.kind === 'app').key;
    const folder = `${DIR}/Vurgu Klasörü`;
    try {
      P.fs.mkdir(folder);
      const dt = new DataTransfer();
      const src = innerEl(key);
      dnd('dragstart', src, {}, dt);
      dnd('dragover', innerEl('Vurgu Klasörü'), {}, dt);
      t.ok(iconEl('Vurgu Klasörü').classList.contains('drop-target'), 'klasör vurgulanmalı');
      t.ok(document.querySelector('#desktop .desk-snap').hidden, 'klasör üstünde hücre önizlemesi gizli');
      dnd('dragover', rootEl(), cellPoint(7, 2), dt);
      t.ok(!iconEl('Vurgu Klasörü').classList.contains('drop-target'));
      t.ok(!document.querySelector('#desktop .desk-snap').hidden, 'boş alanda hücre önizlemesi görünmeli');
      dnd('dragend', src, {}, dt);
      t.ok(document.querySelector('#desktop .desk-snap').hidden, 'sürükleme bitince önizleme gizlenmeli');
    } finally {
      cleanupFile(folder);
    }
  });

  T.test('dosya yöneticisinden sürükleme: masaüstüne taşıma ve Ctrl ile kopyalama', async (t) => {
    const src = '/home/panda/Belgeler/Dışarıdan Gelen.txt';
    const src2 = '/home/panda/Belgeler/Kopyalanan.txt';
    try {
      P.fs.writeFile(src, 'gelen');
      P.fs.writeFile(src2, 'kopya');
      const cell = freeCell();
      externalDrop([src], cellPoint(cell.col, cell.row));
      t.ok(!P.fs.exists(src), 'kaynak taşınmalı');
      t.eq(P.fs.readFile(`${DIR}/Dışarıdan Gelen.txt`), 'gelen');
      t.ok(iconEl('Dışarıdan Gelen.txt'), 'simge görünmeli');
      const it = itemOf('Dışarıdan Gelen.txt');
      t.eq([it.col, it.row], [cell.col, cell.row], 'bırakılan hücreye yerleşmeli');
      t.eq(selection(), ['Dışarıdan Gelen.txt']);

      externalDrop([src2], cellPoint(cell.col, 0), { ctrl: true });
      t.ok(P.fs.exists(src2), 'Ctrl ile kaynak kalmalı');
      t.eq(P.fs.readFile(`${DIR}/Kopyalanan.txt`), 'kopya', 'kopya masaüstünde olmalı');

      // dropping on the trash icon / a folder icon
      P.fs.emptyTrash();
      P.fs.writeFile(src, 'çöp');
      externalDrop([src], cellPoint(0, 0), { onto: innerEl('::trash') });
      t.ok(!P.fs.exists(src) && P.fs.trashCount() === 1, 'çöp kutusuna bırakma');
    } finally {
      cleanupFile(src);
      cleanupFile(src2);
      cleanupFile(`${DIR}/Dışarıdan Gelen.txt`);
      cleanupFile(`${DIR}/Kopyalanan.txt`);
      P.fs.emptyTrash();
    }
  });

  T.test('gerçek bilgisayardan dosya sürükleme: metin ve resim aktarılır, desteklenmeyen bildirilir', async (t) => {
    const names = ['Dışarıdan Metin.txt', 'Dışarıdan Resim.png', 'program.exe'];
    try {
      const dt = new DataTransfer();
      dt.items.add(new File(['merhaba dünya'], names[0], { type: 'text/plain' }));
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], names[1], { type: 'image/png' }));
      dt.items.add(new File(['MZ'], names[2], { type: 'application/octet-stream' }));
      const cell = freeCell();
      await withNotifyCapture(async (calls) => {
        const over = dnd('dragover', rootEl(), cellPoint(cell.col, cell.row), dt);
        t.ok(over.defaultPrevented, 'dosya sürüklemesi kabul edilmeli (tarayıcı sayfadan ayrılmasın)');
        dnd('drop', rootEl(), cellPoint(cell.col, cell.row), dt);
        await t.waitFor(() => P.fs.exists(`${DIR}/${names[0]}`) && P.fs.exists(`${DIR}/${names[1]}`), 2000, 'dosyalar aktarılmadı');
        t.eq(P.fs.readFile(`${DIR}/${names[0]}`), 'merhaba dünya');
        t.ok(P.fs.readFile(`${DIR}/${names[1]}`).startsWith('data:image/png;base64,'), 'resim data URL olarak saklanmalı');
        t.ok(!P.fs.exists(`${DIR}/${names[2]}`), 'desteklenmeyen dosya aktarılmamalı');
        t.eq(calls.length, 1, 'desteklenmeyen dosya için bildirim');
        t.ok(iconEl(names[0]) && iconEl(names[1]), 'simgeler görünmeli');
      });
    } finally {
      names.forEach((n) => cleanupFile(`${DIR}/${n}`));
    }
  });

  T.test('sürükle-bırak: Ctrl ile boş alana bırakmak çoğaltır', (t) => {
    const file = `${DIR}/Çoğalt.txt`;
    try {
      P.fs.writeFile(file, 'c');
      const cell = freeCell();
      dragIcon('Çoğalt.txt', cellPoint(cell.col, cell.row), { ctrl: true });
      t.ok(P.fs.exists(file), 'özgün kalmalı');
      const copies = P.fs.list(DIR).filter((s) => s.name.startsWith('Çoğalt') && s.name !== 'Çoğalt.txt');
      t.eq(copies.length, 1, 'bir kopya oluşmalı');
    } finally {
      P.fs.list(DIR).filter((s) => s.name.startsWith('Çoğalt')).forEach((s) => cleanupFile(s.path));
    }
  });

  // ------------------------------------------------------------------ refresh behaviour
  T.test('fs değişince masaüstü kendiliğinden yenilenir (seçim korunur)', async (t) => {
    const a = `${DIR}/Yenile A.txt`;
    const b = `${DIR}/Yenile B.txt`;
    try {
      P.fs.writeFile(a, 'a');
      P.desktop.select(['Yenile A.txt']);
      P.fs.writeFile(b, 'b');
      t.ok(iconEl('Yenile B.txt'), 'yeni dosya anında görünmeli');
      t.eq(selection(), ['Yenile A.txt'], 'seçim korunmalı');
      P.fs.remove(a);
      t.ok(!iconEl('Yenile A.txt'));
      t.eq(selection(), [], 'kaybolan öğe seçimden düşmeli');
      t.ok(!('Yenile A.txt' in P.storage.get('desktop.layout')), 'kaybolan öğenin konumu atılmalı');
    } finally {
      cleanupFile(a);
      cleanupFile(b);
    }
  });

  T.test('yeni öğeler ilk boş hücreyi alır', (t) => {
    const file = `${DIR}/Yeni Gelen.txt`;
    try {
      const g = P.desktop.grid();
      const used = new Set(P.desktop.items().map((i) => `${i.col},${i.row}`));
      let expected = null;
      for (let c = 0; c < g.cols + 5 && !expected; c++) {
        for (let r = 0; r < g.rows && !expected; r++) if (!used.has(`${c},${r}`)) expected = [c, r];
      }
      P.fs.writeFile(file, 'x');
      const it = itemOf('Yeni Gelen.txt');
      t.eq([it.col, it.row], expected, 'sütun-öncelikli ilk boş hücre');
    } finally {
      cleanupFile(file);
    }
  });

  T.test('yeniden adlandırma sürerken dış fs değişimi düzenleyiciyi bozmaz', async (t) => {
    const a = `${DIR}/Düzenlenen.txt`;
    const b = `${DIR}/Arka Plan.txt`;
    try {
      P.fs.writeFile(a, 'a');
      P.desktop.select(['Düzenlenen.txt']);
      t.key(rootEl(), 'F2');
      const ta = await t.waitFor(() => t.$('#desktop .desk-rename'));
      ta.value = 'Yazılan Yarım';
      P.fs.writeFile(b, 'b');
      t.eq(t.$('#desktop .desk-rename'), ta, 'düzenleyici aynı kalmalı');
      t.eq(ta.value, 'Yazılan Yarım', 'yazılan korunmalı');
      t.key(ta, 'Escape');
      await t.waitFor(() => iconEl('Arka Plan.txt'), 500, 'ertelenen yenileme uygulanmalı');
    } finally {
      cleanupFile(a);
      cleanupFile(b);
    }
  });

  T.test('masaüstü simgelerini gizle / göster', async (t) => {
    try {
      t.contextmenu(rootEl(), cellPoint(7, 2));
      await t.waitFor(() => menuItem('Görünüm'));
      t.click(menuItem('Görünüm'));
      await t.waitFor(() => menuItem('Masaüstü simgelerini göster'));
      t.ok(menuItem('Masaüstü simgelerini göster').classList.contains('checked'));
      t.click(menuItem('Masaüstü simgelerini göster'));
      t.ok(rootEl().classList.contains('desk-hide-icons'));
      t.eq(getComputedStyle(document.querySelector('#desktop .desk-icons')).display, 'none');
    } finally {
      P.storage.set('desktop.showIcons', true);
      rootEl().classList.remove('desk-hide-icons');
      P.contextMenu.hide();
    }
  });

  // ------------------------------------------------------------------ session: lock screen
  T.test('kilit ekranı: gösterilir, saat/tarih/ipucu var, tıklayınca giriş görünümü, Enter ile açılır', async (t) => {
    const events = [];
    const off1 = P.bus.on('session:lock', () => events.push('lock'));
    const off2 = P.bus.on('session:unlock', () => events.push('unlock'));
    let resolved = false;
    try {
      t.ok(!P.session.isLocked());
      const promise = P.session.lock().then(() => { resolved = true; });
      t.ok(P.session.isLocked(), 'isLocked true olmalı');
      t.eq(P.session.state(), 'locked');
      const root = await t.waitFor(() => t.$('#lock-screen .lock-root.active'), 500, 'kilit ekranı görünmedi');
      t.ok(/^\d{1,2}:\d{2}/.test(t.$('.lock-hm', root).textContent), 'saat biçimi');
      const date = t.$('.lock-date', root).textContent;
      t.ok(/^\d{1,2} \p{L}+ \p{L}+$/u.test(date), `Türkçe uzun tarih beklenir: "${date}"`);
      const dtExpected = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
      t.eq(date, dtExpected);
      t.ok(t.$('.lock-hint', root).textContent.includes('Kilidi açmak için tıklayın veya bir tuşa basın'), 'ipucu metni');
      t.ok(!root.classList.contains('is-signin'));
      // the lock screen covers everything: it must be the top element at the centre
      t.ok(root.contains(document.elementFromPoint(300, 300)), 'kilit ekranı en üstte olmalı');
      // blocked: windows must not get keystrokes while locked
      let leaked = 0;
      const spy = () => { leaked++; };
      document.addEventListener('keydown', spy);
      const ta = document.createElement('textarea');
      document.body.appendChild(ta);
      ta.focus();
      const evt = new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true, cancelable: true });
      ta.dispatchEvent(evt);
      document.removeEventListener('keydown', spy);
      ta.remove();
      t.eq(leaked, 0, 'kilitliyken arka plan tuş almamalı');

      t.click(root);
      t.ok(root.classList.contains('is-signin'), 'tıklayınca giriş görünümü açılmalı');
      const input = t.$('.lock-input', root);
      t.ok(input && input.type === 'password');
      t.eq(t.$('.lock-name', root).textContent, 'Panda');
      t.ok(t.$('.lock-avatar svg', root), 'avatar svg olmalı');
      t.ok(t.$('.lock-sub', root).textContent.includes('Şifre gerekmez — Enter\'a basman yeterli'), 'ipucu');
      await t.waitFor(() => document.activeElement === input, 500, 'şifre alanı odakta olmalı');
      t.key(input, 'Enter');
      await promise;
      t.ok(resolved, 'lock() sözü çözülmeli');
      t.ok(!P.session.isLocked(), 'açıldı');
      t.ok(!t.$('#lock-screen .lock-root.active'), 'kilit ekranı kalkmalı');
      t.eq(events, ['lock', 'unlock']);
    } finally {
      off1();
      off2();
      await ensureRunning(t);
    }
  });

  T.test('kilit ekranı: bir tuşa basınca açılır, yazılan karakter şifre alanına gider, Escape saate döner', async (t) => {
    try {
      P.session.lock();
      const root = await t.waitFor(() => t.$('#lock-screen .lock-root.active'));
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true, cancelable: true }));
      t.ok(root.classList.contains('is-signin'), 'tuş giriş görünümünü açmalı');
      t.eq(t.$('.lock-input', root).value, 'x', 'yazılan karakter alana gitmeli');
      t.key(t.$('.lock-input', root), 'Escape');
      t.ok(!root.classList.contains('is-signin'), 'Escape saate döndürmeli');
      t.eq(t.$('.lock-input', root).value, '', 'şifre alanı temizlenmeli');
      // the arrow button also signs in
      t.click(root);
      t.click(t.$('.lock-go', root));
      await t.waitFor(() => !P.session.isLocked(), 2000, 'ok düğmesi kilidi açmalı');
      await t.waitFor(() => !t.$('#lock-screen .lock-root.active'), 1500);
    } finally {
      await ensureRunning(t);
    }
  });

  T.test('kilit ekranı: Ctrl+Alt+L kilitler; unlock() programatik açar', async (t) => {
    try {
      t.key(document.body, 'l', { ctrlKey: true, altKey: true });
      t.ok(P.session.isLocked(), 'Ctrl+Alt+L kilitlemeli');
      t.ok(t.$('#lock-screen .lock-root.active'));
      const p = P.session.unlock();
      t.ok(!P.session.isLocked(), 'unlock() hemen isLocked=false yapar');
      await p;
      t.ok(!t.$('#lock-screen .lock-root.active'));
      // lock() twice returns promises that resolve on the single unlock
      const a = P.session.lock();
      const b = P.session.lock();
      t.eq(t.$$('#lock-screen .lock-root').length, 1, 'tek kilit ekranı olmalı');
      await P.session.unlock();
      await Promise.all([a, b]);
    } finally {
      await ensureRunning(t);
    }
  });

  T.test('kilit ekranı: duvar kağıdı bulanık ve ayar değişince güncellenir', async (t) => {
    const original = P.settings.get('wallpaper');
    try {
      P.session.lock();
      const root = await t.waitFor(() => t.$('#lock-screen .lock-root.active'));
      const bg = t.$('.lock-bg-img', root);
      const probe = (id) => { const d = document.createElement('div'); d.style.background = P.wallpapers.css(id); return d.style.backgroundImage; };
      t.eq(bg.style.backgroundImage, probe(original));
      t.ok(/blur\(/.test(getComputedStyle(bg).filter), 'duvar kağıdı bulanık olmalı');
      P.settings.set('wallpaper', 'aurora');
      t.eq(bg.style.backgroundImage, probe('aurora'), 'ayar değişince kilit ekranı güncellenmeli');
    } finally {
      P.settings.set('wallpaper', original);
      await ensureRunning(t);
      await sleep(900);
    }
  });

  T.test('kilitlenince başlat menüsü ve bağlam menüsü kapanır', async (t) => {
    try {
      P.startMenu.open();
      t.contextmenu(rootEl(), cellPoint(7, 2));
      await t.waitFor(() => P.contextMenu.isOpen());
      P.session.lock();
      t.ok(!P.startMenu.isOpen(), 'başlat menüsü kapanmalı');
      t.ok(!P.contextMenu.isOpen(), 'bağlam menüsü kapanmalı');
    } finally {
      await ensureRunning(t);
    }
  });

  T.test('kilit ekranı: güç düğmesi menüsü', async (t) => {
    try {
      P.session.lock();
      const root = await t.waitFor(() => t.$('#lock-screen .lock-root.active'));
      const menu = t.$('.lock-menu', root);
      t.ok(menu.hidden);
      t.click(t.$('.lock-power', root));
      t.ok(!menu.hidden, 'güç menüsü açılmalı');
      const labels = t.$$('.lock-menu-item span', root).map((e) => e.textContent);
      t.eq(labels, ['Yeniden Başlat', 'Kapat']);
      t.key(t.$('.lock-power', root), 'Escape');
      t.ok(menu.hidden, 'Escape menüyü kapatmalı');
      t.ok(!root.classList.contains('is-signin'), 'Escape önce menüyü kapatır, görünümü değil');
    } finally {
      await ensureRunning(t);
    }
  });

  // ------------------------------------------------------------------ session: boot / shutdown / restart
  T.test('açılış ekranı: bootSplash() logo, ad ve ilerleme çubuğu gösterir, sonra kaybolur', async (t) => {
    const p = P.session.bootSplash();
    const layer = await t.waitFor(() => t.$('#boot-screen .boot-splash'), 300, 'açılış ekranı görünmedi');
    t.ok(layer.querySelector('.boot-logo svg'), 'logo svg');
    t.eq(layer.querySelector('.boot-word').textContent, 'PandaOS');
    t.ok(layer.querySelector('.boot-progress'));
    t.eq(P.session.state(), 'booting');
    await p;
    await t.waitFor(() => !t.$('#boot-screen .boot-splash'), 2000, 'açılış ekranı kalkmalı');
    t.eq(P.session.state(), 'running');
  });

  T.test('kapat: pencereler kapanır, "Kapatılıyor...", sonra güç düğmesi; tıklayınca açılış → kilit', async (t) => {
    registerDummy();
    const events = [];
    const off = P.bus.on('session:shutdown', () => events.push('shutdown'));
    try {
      P.apps.launch(DUMMY);
      P.apps.launch(DUMMY);
      t.eq(P.wm.list().length, 2);
      P.session.shutdown();
      t.eq(P.wm.list().length, 0, 'tüm pencereler zorla kapatılmalı');
      t.eq(events, ['shutdown']);
      t.ok(P.session.isLocked(), 'kapanırken kilitli sayılır');
      t.eq(P.session.state(), 'shuttingDown');
      const wait = await t.waitFor(() => t.$('#boot-screen .boot-wait'), 500);
      t.eq(wait.querySelector('.boot-msg').textContent, 'Kapatılıyor...');
      t.ok(wait.querySelector('.boot-ring'), 'dönen gösterge');
      const offLayer = await t.waitFor(() => t.$('#boot-screen .boot-off'), 4000, 'kapalı ekran görünmedi');
      t.eq(P.session.state(), 'off');
      t.eq(offLayer.querySelector('.boot-off-text').textContent, 'PandaOS kapatıldı. Açmak için güç düğmesine bas.');
      t.ok(offLayer.querySelector('.boot-power svg'), 'güç düğmesi');
      // nothing may react to keys while off
      t.ok(P.session.isLocked());
      t.click(offLayer.querySelector('.boot-power'));
      await t.waitFor(() => P.session.state() === 'booting', 1000, 'açılış ekranı başlamalı');
      await t.waitFor(() => P.session.state() === 'locked', 5000, 'sonra kilit ekranı gelmeli');
      t.ok(t.$('#lock-screen .lock-root.active'));
      await t.waitFor(() => !t.$('#boot-screen .boot-off') && !t.$('#boot-screen .boot-splash'), 3000, 'geçici ekranlar kalkmalı');
      await P.session.unlock();
    } finally {
      off();
      closeAllWindows();
      await ensureRunning(t);
    }
  });

  T.test('yeniden başlat: pencereler kapanır, "Yeniden başlatılıyor...", açılış ekranı, kilit ekranı', async (t) => {
    registerDummy();
    try {
      P.apps.launch(DUMMY);
      P.session.restart();
      t.eq(P.wm.list().length, 0);
      const wait = await t.waitFor(() => t.$('#boot-screen .boot-wait'), 500);
      t.eq(wait.querySelector('.boot-msg').textContent, 'Yeniden başlatılıyor...');
      t.eq(P.session.state(), 'shuttingDown');
      await t.waitFor(() => P.session.state() === 'booting', 3000, 'açılış ekranı beklenir');
      await t.waitFor(() => P.session.state() === 'locked', 5000, 'kilit ekranı beklenir');
      await P.session.unlock();
      t.eq(P.session.state(), 'running');
    } finally {
      closeAllWindows();
      await ensureRunning(t);
    }
  });

  T.test('kilitliyken kapat: kilit ekranından güç menüsü, sonra tekrar giriş', async (t) => {
    try {
      let resolved = false;
      P.session.lock().then(() => { resolved = true; });
      const root = await t.waitFor(() => t.$('#lock-screen .lock-root.active'));
      t.click(t.$('.lock-power', root));
      const shutdownBtn = t.$$('.lock-menu-item', root).find((b) => b.textContent.includes('Kapat'));
      t.click(shutdownBtn);
      t.ok(!t.$('#lock-screen .lock-root.active'), 'kapanırken kilit ekranı kalkmalı');
      await t.waitFor(() => P.session.state() === 'off', 5000);
      t.ok(!resolved, 'oturum açılmadan lock() sözü çözülmemeli');
      t.click(t.$('#boot-screen .boot-power'));
      await t.waitFor(() => P.session.state() === 'locked', 6000);
      await P.session.unlock();
      await sleep(30);
      t.ok(resolved, 'gerçek girişte bekleyen söz çözülmeli');
    } finally {
      await ensureRunning(t);
    }
  });

  T.test('oturum sonrası masaüstü yeniden odaklanır ve klavye çalışır', async (t) => {
    P.session.lock();
    await t.waitFor(() => t.$('#lock-screen .lock-root.active'));
    await P.session.unlock();
    await t.waitFor(() => document.activeElement === rootEl(), 1000, 'masaüstü odakta olmalı');
    P.desktop.select([]);
    t.key(rootEl(), 'a', { ctrlKey: true });
    t.ok(selection().length > 3);
    P.desktop.select([]);
  });

  // ------------------------------------------------------------------ review fixes (focus, layout, hidden icons, overflow...)
  const posOf = (key) => { const it = itemOf(key); return it ? `${it.col},${it.row}` : null; };

  function registerTextApp() {
    if (P.apps.get('desk-text-app')) return;
    P.apps.register({
      id: 'desk-text-app', name: 'Metin Uygulaması', icon: 'notepad', showInStartMenu: false,
      window: { width: 320, height: 220 },
      launch(win) {
        const ta = document.createElement('textarea');
        ta.value = 'benim notum';
        win.body.appendChild(ta);
        win.state.input = ta;
      }
    });
  }

  T.test('yeniden adlandırma çakışması (EEXIST) başka simgenin kayıtlı hücresini bozmaz', async (t) => {
    const a = `${DIR}/RenA.txt`;
    const b = `${DIR}/RenB.txt`;
    try {
      P.fs.writeFile(a, '');
      P.fs.writeFile(b, '');
      await t.waitFor(() => iconEl('RenA.txt') && iconEl('RenB.txt'));
      dragIcon('RenB.txt', cellPoint(5, 4));
      await sleep(30);
      const bPos = posOf('RenB.txt');
      t.eq(bPos, '5,4', 'önkoşul: B hedef hücreye taşındı');
      await withNotifyCapture(async (calls) => {
        P.desktop.startRename('RenA.txt');
        const ta = document.querySelector('.desk-rename');
        ta.value = 'RenB.txt';
        t.key(ta, 'Enter');
        await sleep(30);
        t.ok(calls.length >= 1, 'hata bildirilmeli');
      });
      t.ok(document.querySelector('.desk-rename'), 'ad kutusu açık kalır');
      t.key(document.querySelector('.desk-rename'), 'Escape');
      await sleep(30);
      P.desktop.refresh();
      window.dispatchEvent(new Event('resize'));
      await sleep(80);
      t.eq(posOf('RenB.txt'), bPos, 'B simgesi yerinden oynamamalı');
    } finally {
      cleanupFile(a);
      cleanupFile(b);
    }
  });

  T.test('başka yerden (Dosyalar, terminal mv) yeniden adlandırılan masaüstü öğesi hücresini korur', async (t) => {
    const from = `${DIR}/ExtOne.txt`;
    const to = `${DIR}/ExtTwo.txt`;
    try {
      P.fs.writeFile(from, '');
      await t.waitFor(() => iconEl('ExtOne.txt'));
      dragIcon('ExtOne.txt', cellPoint(6, 3));
      await sleep(30);
      const before = posOf('ExtOne.txt');
      t.eq(before, '6,3', 'önkoşul');
      P.fs.rename(from, 'ExtTwo.txt');
      await sleep(60);
      t.eq(posOf('ExtTwo.txt'), before, 'simge yeni adıyla aynı hücrede kalmalı');
      P.desktop.refresh();
      window.dispatchEvent(new Event('resize'));
      await sleep(60);
      t.eq(posOf('ExtTwo.txt'), before, 'yeniden yerleşimden sonra da');
    } finally {
      cleanupFile(from);
      cleanupFile(to);
    }
  });

  T.test('çok sayıda öğe: sığmayanlar yana kaydırılarak erişilebilir kalır, yerleşim kararlıdır', async (t) => {
    const names = [];
    for (let i = 0; i < 150; i++) names.push(`ov${String(i).padStart(3, '0')}.txt`);
    const iconsEl = document.querySelector('#desktop .desk-icons');
    try {
      names.forEach((n) => P.fs.writeFile(`${DIR}/${n}`, ''));
      P.desktop.refresh();
      await sleep(80);
      const g = P.desktop.grid();
      const items = P.desktop.items();
      t.ok(items.length > g.cols * g.rows, `önkoşul: ${items.length} öğe ${g.cols}x${g.rows} hücreye sığmamalı`);
      t.ok(iconsEl.classList.contains('desk-scroll'), 'kaydırma kipi açılmalı');
      t.ok(getComputedStyle(iconsEl).pointerEvents === 'auto', 'kaydırma çubuğu tutulabilmeli (pointer-events)');
      const maxCol = Math.max(...items.map((i) => i.col));
      t.ok(maxCol >= g.cols, 'sığmayanlar görünür sütunların ötesine konur');
      t.ok(items.every((i) => i.row < g.rows), 'hiçbir simge satır sınırını aşmaz');
      t.eq(new Set(items.map((i) => `${i.col},${i.row}`)).size, items.length, 'iki simge aynı hücrede olmamalı');
      const cw = { small: 84, medium: 96, large: 112 }[g.size];
      t.ok(iconsEl.scrollWidth >= 8 + (maxCol + 1) * cw - 1, `kaydırılabilir genişlik son sütunu kapsamalı (${iconsEl.scrollWidth})`);

      // keyboard navigation to the far end scrolls the icon into view
      iconsEl.scrollLeft = 0;
      t.key(rootEl(), 'End');
      await sleep(40);
      const lastKey = P.desktop.selection()[0];
      const r = innerEl(lastKey).getBoundingClientRect();
      const vr = iconsEl.getBoundingClientRect();
      t.ok(iconsEl.scrollLeft > 0 && r.right <= vr.right + 1 && r.left >= vr.left - 1, `son simge görünür alana kaydırılmalı (${lastKey})`);

      // the wheel scrolls sideways
      iconsEl.scrollLeft = 0;
      iconsEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }));
      t.ok(iconsEl.scrollLeft > 0, 'tekerlek yana kaydırır');

      // a relayout (resize) keeps every icon where it is
      const snap = () => JSON.stringify(P.desktop.items().map((i) => [i.key, i.col, i.row]));
      const before = snap();
      window.dispatchEvent(new Event('resize'));
      await sleep(80);
      t.eq(snap(), before, 'yeniden yerleşimde simgeler yerinde kalır');

      // dropping into the scrolled-in columns works (cell math includes the scroll offset)
      iconsEl.scrollLeft = iconsEl.scrollWidth;
      const cell = cellPoint(0, 0);
      const vr2 = iconsEl.getBoundingClientRect();
      const pt = { clientX: vr2.right - 40, clientY: cell.clientY };
      dragIcon(names[0], pt);
      await sleep(40);
      t.ok(itemOf(names[0]).col >= g.cols, 'kaydırılmış alana bırakılan simge oradaki sütuna yerleşir: ' + posOf(names[0]));
    } finally {
      names.forEach((n) => cleanupFile(`${DIR}/${n}`));
      P.desktop.refresh();
      await sleep(80);
    }
    t.ok(!iconsEl.classList.contains('desk-scroll'), 'sığınca kaydırma kipi kapanır');
    t.eq(iconsEl.scrollLeft, 0);
    t.ok(P.desktop.items().every((i) => i.col < P.desktop.grid().cols), 'her şey görünür ızgarada');
  });

  T.test('kilit açılınca klavye, kilitten önce aktif olan pencereye gider (masaüstü kısayolları tetiklenmez)', async (t) => {
    registerTextApp();
    closeAllWindows();
    const w = P.apps.launch('desk-text-app');
    const ta = w.state.input;
    ta.focus();
    const got = [];
    const off = w.on('keydown', (e) => got.push(e.key));
    try {
      P.session.lock();
      await t.waitFor(() => P.session.state() === 'locked');
      await P.session.unlock();
      await sleep(120);
      t.ok(w.isFocused(), 'pencere aktif kalmalı');
      t.ok(document.activeElement === ta, 'metin alanı odakta: ' + (document.activeElement && (document.activeElement.className || document.activeElement.tagName)));
      const before = P.fs.list(DIR).length;
      t.key(undefined, 'h');
      t.key(undefined, 'a', { ctrlKey: true });
      t.key(undefined, 'Delete');
      await sleep(40);
      t.eq(P.fs.list(DIR).length, before, 'masaüstü dosyaları çöpe gitmemeli');
      t.eq(P.fs.trashCount(), 0);
      t.eq(P.desktop.selection(), [], 'masaüstünde seçim olmamalı');
      t.ok(got.includes('Delete') && got.includes('h'), 'pencere tuşları almalı: ' + got.join(','));
    } finally {
      off();
      closeAllWindows();
      await ensureRunning(t);
    }
  });

  T.test('kilit açılınca pencere yokken klavye masaüstüne gider', async (t) => {
    closeAllWindows();
    try {
      P.session.lock();
      await t.waitFor(() => P.session.state() === 'locked');
      await P.session.unlock();
      await t.waitFor(() => document.activeElement === rootEl(), 1000, 'masaüstü odakta olmalı');
    } finally {
      await ensureRunning(t);
    }
  });

  T.test('yeniden adlandırma kutusu başka pencerenin metin alanına tıklanınca kapanırsa o alanın odağını çalmaz', async (t) => {
    registerTextApp();
    closeAllWindows();
    const f = `${DIR}/BlurRename.txt`;
    try {
      P.fs.writeFile(f, '');
      await t.waitFor(() => iconEl('BlurRename.txt'));
      const w = P.apps.launch('desk-text-app');
      P.desktop.startRename('BlurRename.txt');
      t.ok(document.querySelector('.desk-rename'));
      w.state.input.focus(); // the user clicks into the other window's text field
      await sleep(80);
      t.ok(document.activeElement === w.state.input, 'odak metin alanında kalmalı: ' + (document.activeElement && document.activeElement.className));
      t.ok(!document.querySelector('.desk-rename'), 'ad kutusu kapanmış olmalı');
    } finally {
      cleanupFile(f);
      closeAllWindows();
    }
  });

  T.test('simgeler gizliyken klavye masaüstü öğelerine dokunmaz; gizlenince seçim temizlenir', async (t) => {
    const f = `${DIR}/GizliDeneme.txt`;
    try {
      P.fs.writeFile(f, '');
      await t.waitFor(() => iconEl('GizliDeneme.txt'));
      P.desktop.select(['GizliDeneme.txt']);
      t.contextmenu(rootEl(), cellPoint(7, 2));
      await t.waitFor(() => menuItem('Görünüm'));
      t.click(menuItem('Görünüm'));
      await t.waitFor(() => menuItem('Masaüstü simgelerini göster'));
      t.click(menuItem('Masaüstü simgelerini göster'));
      t.ok(rootEl().classList.contains('desk-hide-icons'));
      t.eq(P.desktop.selection(), [], 'gizlenen simgeler seçili kalmamalı');
      rootEl().focus();
      t.key(rootEl(), 'g'); // type-ahead would pick it
      t.eq(P.desktop.selection(), [], 'tür-ahead seçmemeli');
      t.key(rootEl(), 'Delete');
      t.key(rootEl(), 'a', { ctrlKey: true });
      t.key(rootEl(), 'Delete');
      await sleep(30);
      t.ok(P.fs.exists(f), 'gizli simge klavyeyle silinmemeli');
      t.eq(P.fs.trashCount(), 0);
    } finally {
      P.storage.set('desktop.showIcons', true);
      rootEl().classList.remove('desk-hide-icons');
      P.contextMenu.hide();
      cleanupFile(f);
    }
  });

  T.test('masaüstü simgeleri yerel title yerine OS ipucunu kullanır', async (t) => {
    t.ok(P.ui && typeof P.ui.tip === 'function', 'PandaOS.ui.tip var');
    const inner = innerEl('Beni Oku.txt');
    t.ok(!inner.hasAttribute('title'), 'yerel title baloncuğu yok');
    t.ok(inner.getAttribute('aria-label'), 'aria-label korunur');
    t.ok(P.desktop.tipText('Beni Oku.txt').split('\n').length >= 3, 'ad / tür / boyut satırları');
    inner.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = document.querySelector('.tb-tip');
    await t.waitFor(() => tip.classList.contains('show'), 2000, 'ipucu görünmeli');
    t.ok(tip.classList.contains('multi') && tip.textContent.startsWith('Beni Oku.txt'), 'çok satırlı ipucu: ' + tip.textContent);
    inner.dispatchEvent(new MouseEvent('mouseleave'));
    t.ok(!tip.classList.contains('show'));
  });

  // ------------------------------------------------------------------ session: shutdown / unload / other tabs (review fixes)
  T.test('kilit ekranından kapat: bekleyen "kaydet?" isteği olsa bile kapanır', async (t) => {
    registerDummy();
    closeAllWindows();
    const w = P.apps.launch(DUMMY);
    w.beforeClose = () => P.dialog.confirm({ title: 'Kaydet?', message: '?' });
    try {
      P.session.shutdown();
      await t.waitFor(() => P.dialog.isOpen(), 2000, 'kaydet iletişim kutusu açılmalı');
      P.session.lock();
      await t.waitFor(() => P.session.state() === 'locked');
      t.click(document.querySelector('.lock-power'));
      t.click(document.querySelector('.lock-menu-item:last-child')); // Kapat
      await t.waitFor(() => P.session.state() === 'off', 5000, 'kilit ekranındaki Kapat yok sayıldı');
    } finally {
      if (P.session.state() === 'off') {
        t.click(document.querySelector('.boot-power'));
        await t.waitFor(() => P.session.state() === 'locked', 8000);
      }
      await ensureRunning(t);
      P.dialog.closeAll();
      closeAllWindows();
    }
  });

  T.test('sekme kapanırken: kaydedilmemiş iş (beforeClose) varsa tarayıcı uyarır, temizse uyarmaz', async (t) => {
    registerDummy();
    closeAllWindows();
    const fire = () => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; };
    t.ok(!fire(), 'pencere yokken uyarı yok');
    const w = P.apps.launch(DUMMY);
    t.ok(!fire(), 'beforeClose olmayan pencere uyarmaz');
    w.beforeClose = () => true;
    t.ok(fire(), 'beforeClose olan pencere uyarır');
    w.dirty = false;
    t.ok(!fire(), 'temiz (dirty=false) pencere uyarmaz');
    w.dirty = true;
    t.ok(fire(), 'kirli pencere uyarır');
    w.forceClose();
    t.ok(!fire(), 'pencere kapanınca uyarı kalkar');
  });

  T.test('başka sekmede değişen ayarlar benimsenir; sonraki set() onları ezmez', async (t) => {
    const before = P.settings.all();
    try {
      P.settings.set('volume', 55);
      const stored = JSON.parse(localStorage.getItem('pandaos.settings'));
      const other = Object.assign({}, stored, { wallpaper: 'aurora', accent: '#8b5cf6' });
      localStorage.setItem('pandaos.settings', JSON.stringify(other));
      window.dispatchEvent(new StorageEvent('storage', { key: 'pandaos.settings', newValue: JSON.stringify(other) }));
      t.eq(P.settings.get('wallpaper'), 'aurora');
      t.eq(P.settings.get('accent'), '#8b5cf6');
      P.settings.set('volume', 33);
      const after = JSON.parse(localStorage.getItem('pandaos.settings'));
      t.eq(after.wallpaper, 'aurora', 'diğer sekmenin duvar kağıdı ezilmemeli');
      t.eq(after.volume, 33);
      t.eq(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), '#8b5cf6', 'tema vurguyu izler');
    } finally {
      P.settings.reset();
      Object.keys(before).forEach((k) => P.settings.set(k, before[k]));
    }
  });

  T.test('başka sekmede değişen masaüstü düzeni (simge konumları) benimsenir', async (t) => {
    const f = `${DIR}/Sekme.txt`;
    try {
      P.fs.writeFile(f, '');
      await t.waitFor(() => iconEl('Sekme.txt'));
      const lay = P.storage.get('desktop.layout', {});
      const cell = { col: 9, row: 2 };
      const next = Object.assign({}, lay, { 'Sekme.txt': cell });
      localStorage.setItem('pandaos.desktop.layout', JSON.stringify(next));
      window.dispatchEvent(new StorageEvent('storage', { key: 'pandaos.desktop.layout', newValue: JSON.stringify(next) }));
      await sleep(80);
      t.eq(posOf('Sekme.txt'), '9,2', 'diğer sekmedeki konum uygulanmalı');
    } finally {
      cleanupFile(f);
    }
  });
})();
