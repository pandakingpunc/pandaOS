/* UI kit tests (C4): context menu, notifications, dialogs, file picker, properties, sound,
   shared component styles.
   Screenshot helpers: `bash tools/shot.sh out.png "fast=1&test=ui&shot=<name>&theme=dark|light"`
   with <name> in: components, ctx, confirm, alert, prompt, picker, pickerSave, props, toasts, all. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T = window.PandaTest;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const el = P.util.el;

  const ui = {
    menus: () => $$('#context-menu-layer .ctx-menu'),
    items: (menu) => $$('.ctx-item', menu),
    activeLabel: (menu) => {
      const a = $('.ctx-item.active .ctx-label', menu);
      return a ? a.textContent : null;
    },
    cards: () => $$('#dialog-layer .dlg-card'),
    top: () => {
      const c = ui.cards();
      return c[c.length - 1];
    },
    btn: (label, root) => $$('button', root || ui.top()).find((b) => b.textContent.trim() === label),
    toasts: () => $$('#toasts .toast:not(.leaving)'),
    toast: (id) => $(`#toasts .toast[data-id="${id}"]:not(.leaving)`)
  };

  // headless virtual time produces no frames, so transitions would never advance: read end states instead
  const NO_TRANSITIONS = '<style>.t-host *, .t-host *::before, .t-host *::after { transition: none !important; }</style>';

  const fsReady = () => !!(P.fs && typeof P.fs.list === 'function' && typeof P.fs.isDir === 'function');

  // ------------------------------------------------------------------------------------------
  // screenshot states
  // ------------------------------------------------------------------------------------------
  function backdrop() {
    const desk = document.getElementById('desktop');
    if (desk && !desk.children.length && !desk.style.background) {
      desk.style.background =
        'radial-gradient(1200px 700px at 15% 10%, #3b7a57 0%, transparent 60%),' +
        'radial-gradient(1000px 800px at 90% 90%, #2c4a7c 0%, transparent 60%),' +
        'linear-gradient(135deg, #17324d, #1f5a45 55%, #3a7d5a)';
    }
  }

  function buildShowcase() {
    const icon = (n) => (P.icons ? P.icons.get(n) : '');
    const host = el('div', { id: 'ui-showcase' });
    host.style.cssText = 'position:absolute;inset:0;z-index:5;overflow:auto;background:var(--bg);padding:20px 24px;box-sizing:border-box;color:var(--text)';
    host.innerHTML = `
      <style>
        #ui-showcase .grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:16px; }
        #ui-showcase h4 { margin:0 0 10px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--text-muted); font-weight:600; }
        #ui-showcase .row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
        #ui-showcase .col { display:flex; flex-direction:column; gap:8px; margin-bottom:10px; }
        #ui-showcase .p-card { padding:14px 16px; }
        #ui-showcase .win { border:1px solid var(--border); border-radius:10px; overflow:hidden; background:var(--bg); }
      </style>
      <div class="grid">
        <div class="p-card">
          <h4>Düğmeler</h4>
          <div class="row"><button class="p-btn">Standart</button><button class="p-btn primary">Birincil</button><button class="p-btn danger">Sil</button><button class="p-btn ghost">Hayalet</button></div>
          <div class="row"><button class="p-btn small">Küçük</button><button class="p-btn small primary">Küçük birincil</button><button class="p-btn small danger">Kaldır</button></div>
          <div class="row"><button class="p-btn icon" aria-label="Ekle">${icon('plus')}</button><button class="p-btn icon">${icon('minus')}</button><button class="p-btn icon small">${icon('gear')}</button><button class="p-btn">${icon('save')} Kaydet</button><button class="p-btn active">Seçili</button></div>
          <div class="row"><button class="p-btn" disabled>Devre dışı</button><button class="p-btn primary" disabled>Devre dışı</button><button class="p-btn icon" disabled>${icon('refresh')}</button></div>
          <h4 style="margin-top:14px">Rozet · Tuş · Ayırıcı</h4>
          <div class="row"><span class="p-badge">3</span><span class="p-badge subtle">Yeni</span><span class="p-badge danger">Hata</span><span class="p-badge success">Tamam</span><span class="p-badge warning">Uyarı</span>
            <span><span class="p-kbd">Ctrl</span> + <span class="p-kbd">Shift</span> + <span class="p-kbd">N</span></span></div>
          <hr class="p-divider">
          <div class="row" style="margin:0"><span class="p-spinner small"></span><span class="p-spinner"></span><span class="p-spinner large"></span><span style="color:var(--text-muted);font-size:12px">Yükleniyor…</span></div>
        </div>

        <div class="p-card">
          <h4>Girdi denetimleri</h4>
          <div class="col">
            <input class="p-input" value="Metin girişi" aria-label="metin">
            <input class="p-input" placeholder="Yer tutucu metin" aria-label="yer tutucu">
            <input class="p-input invalid" value="Geçersiz değer" aria-label="geçersiz">
            <textarea class="p-input" rows="2" aria-label="çok satırlı">Çok satırlı alan
ikinci satır</textarea>
            <select class="p-select" aria-label="seçim"><option>Bambu</option><option>Okyanus</option></select>
          </div>
          <div class="col" style="gap:4px">
            <input class="p-range" type="range" min="0" max="100" value="30" aria-label="a">
            <input class="p-range" type="range" min="0" max="100" value="75" aria-label="b">
            <input class="p-range" type="range" min="0" max="100" value="50" disabled aria-label="c">
          </div>
          <div class="row" style="gap:16px">
            <label class="p-switch"><input type="checkbox" checked aria-label="s1"><span></span></label>
            <label class="p-switch"><input type="checkbox" aria-label="s2"><span></span></label>
            <label class="p-switch"><input type="checkbox" checked disabled aria-label="s3"><span></span></label>
            <label class="p-checkbox"><input type="checkbox" checked> Açık</label>
            <label class="p-checkbox"><input type="checkbox"> Kapalı</label>
          </div>
          <div class="row" style="gap:16px;margin-bottom:0">
            <label class="p-checkbox"><input type="checkbox" id="ui-indet"> Belirsiz</label>
            <label class="p-checkbox"><input type="checkbox" disabled checked> Devre dışı</label>
            <label class="p-radio"><input type="radio" name="r" checked> Bir</label>
            <label class="p-radio"><input type="radio" name="r"> İki</label>
          </div>
        </div>

        <div class="p-card">
          <h4>Gezinti</h4>
          <div class="win" style="margin-bottom:12px">
            <div class="p-toolbar"><button class="p-btn icon small">${icon('arrow-left')}</button><button class="p-btn icon small">${icon('arrow-right')}</button><button class="p-btn small primary">Yeni</button><span class="p-divider vertical" style="margin:0 4px"></span><button class="p-btn small ghost">Düzenle</button><span class="spacer"></span><input class="p-input small" placeholder="Ara…" style="width:110px"></div>
            <div class="p-tabs"><button class="p-tab">Genel</button><button class="p-tab active">Görünüm</button><button class="p-tab">Gelişmiş</button></div>
            <div style="padding:12px"><div class="p-segmented"><button>Gün</button><button class="active">Hafta</button><button>Ay</button></div></div>
            <div class="p-statusbar"><span>12 öğe</span><span>1 seçili</span><span class="spacer"></span><span>1,4 MB</span></div>
          </div>
          <h4>Boş durum</h4>
          <div class="win" style="height:128px;display:flex"><div class="p-empty">${icon('folder-open')}<strong>Bu klasör boş</strong><span class="sub">Buraya dosya sürükleyebilirsin.</span></div></div>
        </div>

        <div class="p-card" style="grid-column: span 2">
          <h4>Kenar çubuğu · Liste</h4>
          <div class="win" style="display:flex;height:196px">
            <div class="p-sidebar" style="width:190px"><div class="p-list">
              <div class="p-list-item selected">${icon('home')}Ana klasör</div>
              <div class="p-list-item">${icon('desktop')}Masaüstü</div>
              <div class="p-list-item">${icon('document')}Belgeler</div>
              <div class="p-list-item">${icon('image')}Resimler</div>
              <div class="p-list-item">${icon('download')}İndirilenler</div>
            </div></div>
            <div class="p-list" style="flex:1">
              <div class="p-list-item">${icon('file-text')}Notlar.txt<span style="flex:1"></span><span class="p-badge subtle">2 KB</span></div>
              <div class="p-list-item selected">${icon('file-text')}Alışveriş Listesi.txt<span style="flex:1"></span><span class="p-badge subtle">1 KB</span></div>
              <div class="p-list-item">${icon('folder')}Projeler</div>
              <div class="p-list-item">${icon('file-audio')}Neşeye Övgü.pmus</div>
              <div class="p-list-item">${icon('file-code')}stil.css</div>
            </div>
          </div>
        </div>

        <div class="p-card">
          <h4>Kart</h4>
          <div class="p-card" style="background:var(--bg);">
            <div style="font-weight:600;margin-bottom:4px">PandaOS Bambu</div>
            <div style="color:var(--text-muted);font-size:13px">Kartlar, ayarlar ve bilgi panellerinde kullanılır.</div>
            <hr class="p-divider">
            <div class="row" style="margin:0"><button class="p-btn small">İptal</button><button class="p-btn small primary">Uygula</button></div>
          </div>
        </div>
      </div>`;
    document.getElementById('os-root').appendChild(host);
    const indet = host.querySelector('#ui-indet');
    if (indet) indet.indeterminate = true;
    return host;
  }

  function showCtx() {
    P.contextMenu.show(330, 150, [
      { label: 'Aç', icon: 'folder-open', shortcut: 'Enter', action() {} },
      { label: 'Birlikte aç', icon: 'open', submenu: [
        { label: 'Not Defteri', icon: 'notepad', action() {} },
        { label: 'Terminal', icon: 'terminal', action() {} },
        { type: 'separator' },
        { label: 'Başka uygulama seç…', action() {} }
      ] },
      { type: 'separator' },
      { label: 'Kes', icon: 'cut', shortcut: 'Ctrl+X', action() {} },
      { label: 'Kopyala', icon: 'copy', shortcut: 'Ctrl+C', action() {} },
      { label: 'Yapıştır', icon: 'paste', shortcut: 'Ctrl+V', disabled: true },
      { type: 'separator' },
      { label: 'Simgeleri göster', checked: true, action() {} },
      { label: 'Yeniden adlandır', icon: 'edit', shortcut: 'F2', action() {} },
      { label: 'Sil', icon: 'delete', shortcut: 'Del', danger: true, action() {} }
    ]);
    T.key(document.body, 'ArrowDown');
    T.key(document.body, 'ArrowDown');
    T.key(document.body, 'ArrowRight');
  }

  // headless virtual time may not tick entrance animations before the screenshot: jump to their end state
  function finishAnimations() {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* infinite animations */ } });
  }

  const shots = {
    components() {
      buildShowcase();
    },
    ctx() {
      backdrop();
      // the headless screenshot step resizes the viewport right before capturing, which (rightly)
      // closes menus; hide that one resize from the OS so the menu is still open in the picture
      window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);
      showCtx();
    },
    async confirm() {
      backdrop();
      P.dialog.confirm({
        title: 'Dosya silinsin mi?',
        message: '"Alışveriş Listesi.txt" çöp kutusuna taşınacak.\nDilersen daha sonra geri yükleyebilirsin.',
        okText: 'Çöpe taşı',
        danger: true
      });
    },
    async alert() {
      backdrop();
      P.dialog.alert({ title: 'İşlem tamamlanamadı', message: 'Disk dolu olduğu için dosya kaydedilemedi.\nBiraz yer açıp tekrar dene.', icon: 'error' });
    },
    async prompt() {
      backdrop();
      P.dialog.prompt({
        title: 'Yeniden adlandır',
        message: 'Yeni adı girin.',
        value: 'rapor taslağı.txt',
        validate: (v) => (v.includes('/') ? 'Ad "/" karakterini içeremez.' : null)
      });
    },
    async picker(t) {
      backdrop();
      P.dialog.pickFile({ mode: 'open', title: 'Dosya aç', dir: P.fs ? P.fs.HOME + '/Belgeler' : undefined, extensions: ['.txt', '.md'] });
      await t.waitFor(() => $('.dlg-card.fp'));
      const row = $('.fp-row[data-path$="Notlar.txt"]');
      if (row) row.click();
    },
    async pickerSave(t) {
      backdrop();
      P.dialog.pickFile({ mode: 'save', title: 'Farklı kaydet', dir: P.fs ? P.fs.HOME + '/Belgeler' : undefined, name: 'Yeni belge', extensions: ['.txt'] });
      await t.waitFor(() => $('.dlg-card.fp'));
    },
    async props() {
      backdrop();
      if (P.fs) P.dialog.properties(P.fs.HOME + '/Belgeler');
    },
    toasts() {
      backdrop();
      P.notify({ title: 'Yedekleme tamamlandı', message: 'Belgeler klasörü başarıyla yedeklendi.', icon: 'folder', timeout: 0 });
      P.notify({ title: 'Zamanlayıcı bitti', message: 'Çay demlendi! Afiyet olsun.', icon: 'clock', appId: 'clock', timeout: 0, actions: [{ label: 'Tekrarla', action() {} }, { label: 'Kapat', action() {} }] });
      P.notify({ title: 'Disk neredeyse dolu', message: 'Depolama alanının %92\'si kullanılıyor. Gereksiz dosyaları temizlemeyi düşün; böylece yeni dosyalar için yer açabilirsin ve sistem daha hızlı çalışır.', icon: 'warning', timeout: 0 });
      P.notify({ title: 'Yeni güncelleme', message: 'PandaOS 1.0.1 kurulmaya hazır.', icon: 'panda', timeout: 600000 });
    },
    async all(t) {
      backdrop();
      shots.toasts();
      shots.ctx();
      await t.sleep(10);
    }
  };

  const shotName = P.params.get('shot');
  if (shotName) {
    T.test('ekran görüntüsü durumu: ' + shotName, async (t) => {
      const make = shots[shotName];
      t.ok(make, 'bilinmeyen shot: ' + shotName);
      await make(t);
      await t.sleep(300);
      finishAnimations();
      await t.sleep(100);
    });
    return;
  }

  // ------------------------------------------------------------------------------------------
  // cleanup helper
  // ------------------------------------------------------------------------------------------
  async function tidy(t) {
    P.contextMenu.hide();
    for (let i = 0; i < 6 && P.dialog.isOpen(); i++) {
      T.key(document.body, 'Escape');
      await t.sleep(10);
    }
    P.notify.clear();
    await t.sleep(10);
  }

  // ------------------------------------------------------------------------------------------
  // context menu
  // ------------------------------------------------------------------------------------------
  T.test('bağlam menüsü: öğeler, ayırıcılar, devre dışı, işaretli, tehlikeli', async (t) => {
    const ran = [];
    let closed = 0;
    P.contextMenu.show(200, 150, [
      { label: 'Aç', icon: 'folder', shortcut: 'Enter', action: () => ran.push('aç') },
      { label: 'Kopyala', shortcut: 'Ctrl+C', action: () => ran.push('kopyala') },
      { type: 'separator' },
      { label: 'Yapıştır', disabled: true, action: () => ran.push('yapıştır') },
      false,
      null,
      { label: 'Ayrıntılar', checked: true, action: () => ran.push('ayrıntı') },
      { type: 'separator' },
      { type: 'separator' },
      { label: 'Sil', danger: true, action: () => ran.push('sil') },
      { type: 'separator' }
    ], { onClose: () => closed++ });
    const menus = ui.menus();
    t.eq(menus.length, 1, 'tek menü açılmalı');
    const m = menus[0];
    t.ok(P.contextMenu.isOpen(), 'isOpen');
    t.eq(m.getAttribute('role'), 'menu');
    const rows = ui.items(m);
    t.eq(rows.length, 5, 'öğe sayısı');
    t.eq($$('.ctx-sep', m).length, 2, 'fazla ayırıcılar temizlenmeli');
    t.eq($('.ctx-label', rows[0]).textContent, 'Aç');
    t.eq($('.ctx-shortcut', rows[0]).textContent, 'Enter');
    t.ok($('.ctx-lead svg', rows[0]), 'simge sütunu');
    t.ok(rows[2].classList.contains('disabled') && rows[2].getAttribute('aria-disabled') === 'true', 'devre dışı');
    t.ok(rows[3].classList.contains('checked') && $('.ctx-lead svg', rows[3]), 'işaretli onay simgesi');
    t.eq(rows[3].getAttribute('aria-checked'), 'true');
    t.ok(rows[4].classList.contains('danger'), 'tehlikeli');
    t.eq(getComputedStyle(rows[4]).color, 'rgb(229, 72, 77)', 'tehlikeli öğe kırmızı');

    t.click(rows[2]);
    await t.sleep(30);
    t.ok(P.contextMenu.isOpen() && ran.length === 0 && closed === 0, 'devre dışı öğe menüyü kapatmamalı');

    t.click(rows[1]);
    t.eq(ran, ['kopyala']);
    t.ok(!P.contextMenu.isOpen() && ui.menus().length === 0, 'eylemden sonra menü kapanmalı');
    t.eq(closed, 1, 'onClose bir kez çağrılmalı');
  });

  T.test('bağlam menüsü: klavye gezinmesi ve Enter', async (t) => {
    let hit = null;
    let closed = 0;
    P.contextMenu.show(120, 120, [
      { label: 'Bir', action: () => { hit = 'bir'; } },
      { label: 'İki', disabled: true },
      { type: 'separator' },
      { label: 'Üç', action: () => { hit = 'üç'; } }
    ], { onClose: () => closed++ });
    const m = ui.menus()[0];
    t.eq(ui.activeLabel(m), null, 'başlangıçta seçili öğe yok');
    T.key(document.body, 'ArrowDown');
    t.eq(ui.activeLabel(m), 'Bir');
    T.key(document.body, 'ArrowDown');
    t.eq(ui.activeLabel(m), 'Üç', 'devre dışı öğe atlanmalı');
    T.key(document.body, 'ArrowDown');
    t.eq(ui.activeLabel(m), 'Bir', 'başa sarmalı');
    T.key(document.body, 'ArrowUp');
    t.eq(ui.activeLabel(m), 'Üç');
    T.key(document.body, 'Home');
    t.eq(ui.activeLabel(m), 'Bir');
    T.key(document.body, 'End');
    t.eq(ui.activeLabel(m), 'Üç');
    T.key(document.body, 'Enter');
    t.eq(hit, 'üç');
    t.ok(!P.contextMenu.isOpen());
    t.eq(closed, 1);

    // type-ahead + Space
    hit = null;
    P.contextMenu.show(120, 120, [{ label: 'Kopyala', action: () => { hit = 'k'; } }, { label: 'Yapıştır', action: () => { hit = 'y'; } }]);
    T.key(document.body, 'y');
    t.eq(ui.activeLabel(ui.menus()[0]), 'Yapıştır');
    T.key(document.body, ' ');
    t.eq(hit, 'y');
  });

  T.test('bağlam menüsü: alt menü (fare, ok tuşları, tıklama)', async (t) => {
    const ran = [];
    const items = () => [
      { label: 'Yeni', submenu: [
        { label: 'Klasör', action: () => ran.push('klasör') },
        { label: 'Metin belgesi', action: () => ran.push('metin') },
        { label: 'Devre dışı', disabled: true }
      ] },
      { label: 'Diğer', action: () => ran.push('diğer') }
    ];
    P.contextMenu.show(150, 150, items());
    const root = ui.menus()[0];
    const [parent, other] = ui.items(root);
    t.ok(parent.querySelector('.ctx-arrow svg'), 'ok simgesi');
    t.eq(parent.getAttribute('aria-haspopup'), 'menu');

    t.mouse(parent, 'mouseenter');
    await t.waitFor(() => ui.menus().length === 2, 1500, 'alt menü açılmadı');
    const sub = ui.menus()[1];
    t.ok(sub.offsetLeft >= root.offsetLeft + root.offsetWidth - 10, 'alt menü ana menünün yanında');
    t.ok(parent.classList.contains('sub-open'));

    t.mouse(other, 'mouseenter');
    await t.waitFor(() => ui.menus().length === 1, 1500, 'alt menü kapanmadı');
    t.ok(P.contextMenu.isOpen(), 'ana menü açık kalmalı');

    // keyboard
    P.contextMenu.hide();
    P.contextMenu.show(150, 150, items());
    T.key(document.body, 'ArrowDown');
    T.key(document.body, 'ArrowRight');
    t.eq(ui.menus().length, 2, 'ArrowRight alt menüyü açmalı');
    t.eq(ui.activeLabel(ui.menus()[1]), 'Klasör', 'alt menüde ilk öğe seçili');
    T.key(document.body, 'ArrowDown');
    t.eq(ui.activeLabel(ui.menus()[1]), 'Metin belgesi');
    T.key(document.body, 'ArrowLeft');
    t.eq(ui.menus().length, 1, 'ArrowLeft alt menüyü kapatmalı');
    t.eq(ui.activeLabel(ui.menus()[0]), 'Yeni');
    T.key(document.body, 'ArrowRight');
    T.key(document.body, 'Enter');
    t.eq(ran, ['klasör']);
    t.ok(!P.contextMenu.isOpen(), 'alt menü eylemi tüm menüyü kapatmalı');

    // click opens immediately, sub item click runs
    P.contextMenu.show(150, 150, items());
    t.click(ui.items(ui.menus()[0])[0]);
    t.eq(ui.menus().length, 2);
    t.click(ui.items(ui.menus()[1])[1]);
    t.eq(ran, ['klasör', 'metin']);
    t.eq(ui.menus().length, 0);
  });

  T.test('bağlam menüsü: olay ile açma ve pointerdown ile açılan menü hemen kapanmaz', async (t) => {
    const host = el('button', { style: 'position:absolute;left:30px;top:30px;z-index:9996', text: 'x' });
    document.getElementById('os-root').appendChild(host);
    try {
      // show(event, items) overload
      let ev = null;
      host.addEventListener('contextmenu', (e) => { ev = e; P.contextMenu.show(e, [{ label: 'Olaydan' }]); });
      t.contextmenu(host);
      t.ok(ev && P.contextMenu.isOpen(), 'olay ile açılır');
      const m = ui.menus()[0];
      t.ok(Math.abs(m.offsetLeft - ev.clientX) <= 1 && Math.abs(m.offsetTop - ev.clientY) <= 1, 'imlecin olduğu yerde açılır');
      P.contextMenu.hide();

      // a menu opened from a pointerdown handler must survive the mousedown of the same press
      host.addEventListener('pointerdown', (e) => P.contextMenu.show(e.clientX, e.clientY, [{ label: 'Hemen' }]));
      t.click(host);
      t.ok(P.contextMenu.isOpen(), 'pointerdown ile açılan menü aynı basışın mousedown olayında kapanmamalı');
      t.click(document.body);
      t.ok(!P.contextMenu.isOpen(), 'sonraki gerçek dış tıklama kapatır');
    } finally {
      P.contextMenu.hide();
      host.remove();
    }
  });

  T.test('bağlam menüsü: Escape, dışarı tıklama, kaydırma ve pencere odağı ile kapanır', async (t) => {
    const mk = () => { let c = 0; P.contextMenu.show(100, 100, [{ label: 'A' }, { label: 'B' }], { onClose: () => c++ }); return () => c; };

    let closed = mk();
    T.key(document.body, 'Escape');
    t.ok(!P.contextMenu.isOpen() && closed() === 1, 'Escape');

    closed = mk();
    t.click(document.body);
    t.ok(!P.contextMenu.isOpen() && closed() === 1, 'dışarı tıklama');

    closed = mk();
    t.click(ui.items(ui.menus()[0])[0]);
    t.ok(!P.contextMenu.isOpen(), 'eylemsiz öğeye tıklama da kapatır');

    closed = mk();
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
    t.ok(!P.contextMenu.isOpen() && closed() === 1, 'tekerlek');

    closed = mk();
    window.dispatchEvent(new Event('blur'));
    t.ok(!P.contextMenu.isOpen() && closed() === 1, 'pencere odağı kaybı');

    // opening a new menu closes the previous one (and fires its onClose)
    closed = mk();
    P.contextMenu.show(40, 40, [{ label: 'C' }]);
    t.eq(closed(), 1, 'yeni menü eskisini kapatır');
    t.eq(ui.menus().length, 1);
    P.contextMenu.hide();
    t.eq(ui.menus().length, 0);
  });

  T.test('bağlam menüsü: görünüm alanı içinde kalır (sağ-alt köşe, uzun menü)', async (t) => {
    const many = (n) => Array.from({ length: n }, (_, i) => ({ label: 'Öğe numarası ' + (i + 1), shortcut: i % 3 ? '' : 'Ctrl+' + i }));
    const vw = innerWidth;
    const vh = innerHeight;
    P.contextMenu.show(vw - 3, vh - 3, many(9));
    let m = ui.menus()[0];
    t.ok(m.offsetLeft >= 0 && m.offsetTop >= 0, 'sol/üst taşma');
    t.ok(m.offsetLeft + m.offsetWidth <= vw, `sağ taşma: ${m.offsetLeft + m.offsetWidth} > ${vw}`);
    t.ok(m.offsetTop + m.offsetHeight <= vh, `alt taşma: ${m.offsetTop + m.offsetHeight} > ${vh}`);
    t.ok(m.offsetLeft + m.offsetWidth <= vw - 3 + 1, 'imlecin soluna çevrilmeli');

    P.contextMenu.show(10, 10, many(80));
    m = ui.menus()[0];
    t.ok(m.offsetHeight <= vh, 'uzun menü ekrandan büyük olmamalı');
    t.ok(m.scrollHeight > m.clientHeight, 'uzun menü kaydırılabilir olmalı');

    // sub menu near the right edge flips to the left
    P.contextMenu.show(vw - 220, 100, [{ label: 'Yeni', submenu: many(4) }]);
    t.click(ui.items(ui.menus()[0])[0]);
    const [root, sub] = ui.menus();
    t.ok(sub.offsetLeft + sub.offsetWidth <= vw, 'alt menü sağdan taşmamalı');
    t.ok(sub.offsetLeft < root.offsetLeft, 'alt menü sola açılmalı');
    P.contextMenu.hide();
  });

  T.test('yerel tarayıcı bağlam menüsü: masaüstünde engellenir, giriş alanlarında engellenmez', async (t) => {
    const root = document.getElementById('os-root');
    const desk = document.getElementById('desktop') || root;
    const ev = t.contextmenu(desk);
    t.ok(ev.defaultPrevented, 'masaüstünde engellenmeli');
    P.contextMenu.hide();

    const host = el('div', { style: 'position:absolute;left:10px;top:10px;z-index:9999' },
      el('input', { type: 'text', id: 'ui-t-text' }),
      el('textarea', { id: 'ui-t-area' }),
      el('input', { type: 'checkbox', id: 'ui-t-check' }),
      el('div', { id: 'ui-t-edit', contenteditable: 'true', text: 'düzenlenebilir' }),
      el('button', { id: 'ui-t-btn', text: 'düğme' }));
    root.appendChild(host);
    try {
      t.ok(!t.contextmenu($('#ui-t-text')).defaultPrevented, '<input> yerel menüyü korumalı');
      t.ok(!t.contextmenu($('#ui-t-area')).defaultPrevented, '<textarea> yerel menüyü korumalı');
      t.ok(!t.contextmenu($('#ui-t-edit')).defaultPrevented, 'contenteditable yerel menüyü korumalı');
      t.ok(t.contextmenu($('#ui-t-check')).defaultPrevented, 'onay kutusu engellenmeli');
      t.ok(t.contextmenu($('#ui-t-btn')).defaultPrevented, 'düğme engellenmeli');
      // a module that handles the event itself still wins
      let seen = false;
      host.addEventListener('contextmenu', (e) => { seen = true; P.contextMenu.show(e.clientX, e.clientY, [{ label: 'Özel' }]); e.preventDefault(); });
      t.contextmenu($('#ui-t-btn'));
      t.ok(seen && P.contextMenu.isOpen(), 'modülün kendi menüsü açılmalı');
    } finally {
      P.contextMenu.hide();
      host.remove();
    }
  });

  // ------------------------------------------------------------------------------------------
  // notifications
  // ------------------------------------------------------------------------------------------
  T.test('bildirim: toast oluşur, zaman aşımıyla kapanır, geçmişte kalır', async (t) => {
    await tidy(t);
    const events = [];
    const off1 = P.bus.on('notify:new', (n) => events.push(['new', n.title]));
    const off2 = P.bus.on('notify:change', () => events.push(['change']));
    const id = P.notify({ title: 'Merhaba', message: 'Dünya\nikinci satır', timeout: 300 });
    off1(); off2();
    t.ok(typeof id === 'string' && id, 'id döner');
    const toast = await t.waitFor(() => ui.toast(id), 1500, 'toast görünmedi');
    t.eq($('.toast-title', toast).textContent, 'Merhaba');
    t.ok($('.toast-msg', toast).textContent.includes('ikinci satır'));
    t.ok($('.toast-icon svg', toast), 'simge');
    t.ok($('.toast-close', toast) && $('.toast-progress i', toast), 'kapat düğmesi ve ilerleme çizgisi');
    t.eq(events[0], ['new', 'Merhaba']);
    t.ok(events.some((e) => e[0] === 'change'), 'notify:change');
    const h = P.notify.history();
    t.eq(h[0].id, id, 'geçmişin başında en yeni');
    t.eq([h[0].title, h[0].message, h[0].read], ['Merhaba', 'Dünya\nikinci satır', false]);
    t.ok(P.notify.unreadCount() >= 1);
    await t.waitFor(() => !$(`#toasts .toast[data-id="${id}"]`), 4000, 'toast zaman aşımıyla kapanmadı');
    t.ok(P.notify.history().some((n) => n.id === id), 'kapanan toast geçmişte kalmalı');
    await tidy(t);
  });

  T.test('bildirim: sabit (timeout 0), üzerine gelince duraklar, kapat, tıklama, eylemler', async (t) => {
    await tidy(t);
    // sticky
    const sticky = P.notify({ title: 'Sabit', timeout: 0 });
    await t.waitFor(() => ui.toast(sticky));
    t.ok(!$('.toast-progress', ui.toast(sticky)), 'sabit toast ilerleme çizgisi göstermez');
    await t.sleep(700);
    t.ok(ui.toast(sticky), 'timeout 0 kapanmamalı');
    t.ok(P.notify.dismiss(sticky), 'dismiss true döner');
    await t.waitFor(() => !$(`#toasts .toast[data-id="${sticky}"]`), 2000);
    t.ok(!P.notify.history().some((n) => n.id === sticky), 'dismiss geçmişten de kaldırır');

    // hover pauses
    const hov = P.notify({ title: 'Duraklat', timeout: 400 });
    const hovEl = await t.waitFor(() => ui.toast(hov));
    t.mouse(hovEl, 'mouseenter');
    t.ok(hovEl.classList.contains('paused'), 'duraklatıldı sınıfı');
    await t.sleep(1000);
    t.ok(ui.toast(hov), 'üzerine gelince kapanmamalı');
    t.mouse(hovEl, 'mouseleave');
    await t.waitFor(() => !ui.toast(hov), 3000, 'fare ayrılınca kapanmalı');

    // close button keeps history
    const c = P.notify({ title: 'Kapatılacak', timeout: 0 });
    const cEl = await t.waitFor(() => ui.toast(c));
    t.click($('.toast-close', cEl));
    await t.waitFor(() => !ui.toast(c), 2000);
    t.ok(P.notify.history().some((n) => n.id === c), '× toast\'u kapatır ama geçmişte kalır');

    // click -> onClick + dismiss
    let clicked = null;
    const k = P.notify({ title: 'Tıkla', message: 'gövde', timeout: 0, onClick: (n) => { clicked = n.title; } });
    const kEl = await t.waitFor(() => ui.toast(k));
    t.click($('.toast-title', kEl));
    t.eq(clicked, 'Tıkla');
    await t.waitFor(() => !ui.toast(k), 2000);

    // actions
    const acted = [];
    const a = P.notify({ title: 'Eylem', timeout: 0, actions: [{ label: 'Tamam', action: () => acted.push('tamam') }, { label: 'Sonra', action: () => acted.push('sonra') }] });
    const aEl = await t.waitFor(() => ui.toast(a));
    const buttons = $$('.toast-actions button', aEl);
    t.eq(buttons.map((b) => b.textContent), ['Tamam', 'Sonra']);
    t.click(buttons[1]);
    t.eq(acted, ['sonra']);
    await t.waitFor(() => !ui.toast(a), 2000);
    await tidy(t);
  });

  T.test('bildirim: en fazla 4 toast görünür, eskiler geçmişte kalır', async (t) => {
    await tidy(t);
    const ids = [];
    for (let i = 1; i <= 6; i++) ids.push(P.notify({ title: 'Bildirim ' + i, timeout: 0 }));
    await t.sleep(50);
    t.eq(ui.toasts().length, 4, 'görünür toast sayısı');
    t.ok(!ui.toast(ids[0]) && !ui.toast(ids[1]), 'en eskiler daralmalı');
    t.ok(ui.toast(ids[5]), 'en yeni görünür');
    t.eq(P.notify.history().length, 6);
    const order = ui.toasts().map((n) => $('.toast-title', n).textContent);
    t.eq(order, ['Bildirim 3', 'Bildirim 4', 'Bildirim 5', 'Bildirim 6'], 'yukarıdan aşağıya eskiden yeniye');
    const stack = $('#toasts .toast-stack');
    const r = stack.getBoundingClientRect();
    t.ok(r.right <= innerWidth && r.bottom <= innerHeight - 40, 'görev çubuğunun üstünde ve sağ altta');
    await tidy(t);
  });

  T.test('bildirim: Rahatsız Etmeyin toast göstermez ama geçmişe yazar', async (t) => {
    await tidy(t);
    P.notify.markAllRead();
    P.settings.set('dnd', true);
    try {
      const id = P.notify({ title: 'Sessiz', message: 'görünmemeli', timeout: 0 });
      await t.sleep(60);
      t.eq(ui.toasts().length, 0, 'toast yok');
      const h = P.notify.history();
      t.eq([h[0].id, h[0].read], [id, false]);
      t.eq(P.notify.unreadCount(), 1, 'okunmamış sayılır');
    } finally {
      P.settings.set('dnd', false);
    }
    await tidy(t);
  });

  T.test('bildirim: geçmiş kalıcı (son 50), okundu işaretleme, temizleme', async (t) => {
    await tidy(t);
    P.notify.clear();
    P.settings.set('dnd', true);
    let changes = 0;
    const off = P.bus.on('notify:change', () => changes++);
    try {
      for (let i = 1; i <= 55; i++) P.notify({ title: 'N' + i, message: 'm' + i, onClick() {}, actions: [{ label: 'x', action() {} }] });
      const h = P.notify.history();
      t.eq(h.length, 50, 'en fazla 50 kayıt');
      t.eq(h[0].title, 'N55');
      t.eq(h[49].title, 'N6');
      const stored = P.storage.get('notifications', null);
      t.ok(Array.isArray(stored) && stored.length === 50, 'storage anahtarı "notifications"');
      t.eq(stored[0].title, 'N55');
      t.eq(Object.keys(stored[0]).sort(), ['appId', 'icon', 'id', 'message', 'read', 'time', 'title'], 'işlevler saklanmaz');
      t.eq(P.notify.unreadCount(), 50);

      const before = changes;
      P.notify.markAllRead();
      t.eq(P.notify.unreadCount(), 0);
      t.ok(P.notify.history().every((n) => n.read));
      t.ok(P.storage.get('notifications').every((n) => n.read), 'okundu durumu kalıcı');
      t.eq(changes, before + 1, 'markAllRead bir notify:change yayar');
      P.notify.markAllRead();
      t.eq(changes, before + 1, 'değişiklik yoksa olay yok');

      P.notify.clear();
      t.eq(P.notify.history().length, 0);
      t.eq(P.storage.get('notifications'), []);
      t.eq(P.notify.unreadCount(), 0);
      t.eq(changes, before + 2, 'clear bir notify:change yayar');
    } finally {
      off();
      P.settings.set('dnd', false);
    }
    await tidy(t);
  });

  // ------------------------------------------------------------------------------------------
  // dialogs
  // ------------------------------------------------------------------------------------------
  T.test('diyalog: alert (düğme, Enter, Escape) ve isOpen', async (t) => {
    t.ok(!P.dialog.isOpen());
    let p = P.dialog.alert({ title: 'Başlık', message: 'Satır 1\nSatır 2', icon: 'warning' });
    t.ok(P.dialog.isOpen(), 'açıkken isOpen');
    const card = ui.top();
    t.eq($('.dlg-title', card).textContent, 'Başlık');
    t.eq($('.dlg-message', card).textContent, 'Satır 1\nSatır 2');
    t.eq(getComputedStyle($('.dlg-message', card)).whiteSpace, 'pre-wrap', '\\n desteklenir');
    t.ok($('.dlg-icon svg', card), 'simge');
    t.eq(document.activeElement, ui.btn('Tamam'), 'Tamam odaklanır');
    t.ok(ui.btn('Tamam').classList.contains('primary'), 'birincil düğme');
    t.click(ui.btn('Tamam'));
    t.eq(await p, undefined);
    t.ok(!P.dialog.isOpen() && !ui.cards().length, 'kapandıktan sonra isOpen false');

    p = P.dialog.alert({ title: 'Enter', message: 'm' });
    T.key(document.body, 'Enter');
    await p;
    p = P.dialog.alert({ title: 'Esc', message: 'm', icon: 'info' });
    T.key(document.body, 'Escape');
    await p;
    t.ok(!P.dialog.isOpen());
  });

  T.test('diyalog: confirm (düğmeler, Enter, Escape, tehlikeli)', async (t) => {
    let p = P.dialog.confirm({ title: 'Emin misin?', message: 'Devam edilsin mi?' });
    t.ok($('.dlg-icon svg', ui.top()), 'soru simgesi');
    t.ok(ui.btn('İptal') && ui.btn('Tamam'), 'varsayılan düğme metinleri');
    t.ok(ui.btn('Tamam').classList.contains('primary'));
    t.eq(document.activeElement, ui.btn('Tamam'), 'birincil düğme odaklı');
    t.click(ui.btn('Tamam'));
    t.eq(await p, true);

    p = P.dialog.confirm({ title: 'x', message: 'y' });
    t.click(ui.btn('İptal'));
    t.eq(await p, false);

    p = P.dialog.confirm({ title: 'x', message: 'y' });
    T.key(document.body, 'Enter');
    t.eq(await p, true, 'Enter = birincil');

    p = P.dialog.confirm({ title: 'x', message: 'y' });
    T.key(document.body, 'Escape');
    t.eq(await p, false, 'Escape = iptal');

    p = P.dialog.confirm({ title: 'Sil', message: 'Silinsin mi?', okText: 'Sil', cancelText: 'Vazgeç', danger: true });
    const ok = ui.btn('Sil');
    t.ok(ok && ui.btn('Vazgeç'), 'özel düğme metinleri');
    t.ok(ok.classList.contains('danger'), 'tehlikeli düğme');
    t.eq(getComputedStyle(ok).backgroundColor, 'rgb(229, 72, 77)', 'kırmızı');
    t.click(ok);
    t.eq(await p, true);
    t.ok(!P.dialog.isOpen());
  });

  T.test('diyalog: prompt (değer, seçim, Enter, Escape, doğrulama)', async (t) => {
    let p = P.dialog.prompt({ title: 'Ad', message: 'Bir ad girin', value: 'rapor.txt', placeholder: 'ad' });
    let input = $('input.dlg-input', ui.top());
    t.eq(document.activeElement, input, 'giriş odaklı');
    t.eq(input.value, 'rapor.txt');
    t.eq([input.selectionStart, input.selectionEnd], [0, 5], 'uzantıya kadar seçili');
    input.value = 'yeni.md';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.click(ui.btn('Tamam'));
    t.eq(await p, 'yeni.md');

    p = P.dialog.prompt({ title: 'Klasör', value: 'Yeni Klasör' });
    input = $('input.dlg-input', ui.top());
    t.eq([input.selectionStart, input.selectionEnd], [0, 11], 'uzantısız ad tamamen seçili');
    T.key(input, 'Enter');
    t.eq(await p, 'Yeni Klasör', 'Enter gönderir');

    p = P.dialog.prompt({ title: 'x', value: 'a' });
    T.key(document.body, 'Escape');
    t.eq(await p, null, 'Escape null döner');

    p = P.dialog.prompt({ title: 'x' });
    t.click(ui.btn('İptal'));
    t.eq(await p, null);

    // validation keeps the dialog open
    p = P.dialog.prompt({ title: 'Doğrula', value: 'ab', validate: (v) => (v.trim().length < 3 ? 'En az 3 karakter girin.' : null) });
    input = $('input.dlg-input', ui.top());
    t.click(ui.btn('Tamam'));
    await t.sleep(20);
    t.ok(P.dialog.isOpen(), 'doğrulama başarısızsa diyalog açık kalır');
    t.eq($('.dlg-error', ui.top()).textContent, 'En az 3 karakter girin.');
    t.ok(input.classList.contains('invalid'), 'geçersiz giriş vurgusu');
    T.key(input, 'Enter');
    t.ok(P.dialog.isOpen(), 'Enter da doğrulamayı geçmeden kapatmaz');
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq($('.dlg-error', ui.top()).textContent, '', 'hata düzelince temizlenir');
    t.click(ui.btn('Tamam'));
    t.eq(await p, 'abc');
    t.ok(!P.dialog.isOpen());
  });

  T.test('diyalog: üst üste açılır, Escape yalnızca en üsttekini kapatır, odak tuzağı', async (t) => {
    const a = P.dialog.confirm({ title: 'Alt', message: 'a' });
    const b = P.dialog.alert({ title: 'Üst', message: 'b' });
    t.eq(ui.cards().length, 2);
    t.ok(P.dialog.isOpen());
    t.ok(ui.cards()[0].parentElement.hasAttribute('inert'), 'alttaki diyalog etkisiz');
    T.key(document.body, 'Escape');
    await b;
    t.eq(ui.cards().length, 1);
    t.ok(!ui.cards()[0].parentElement.hasAttribute('inert'), 'alttaki yeniden etkin');
    t.ok(P.dialog.isOpen());

    // focus trap: Tab on the last button wraps to the first, Shift+Tab goes back
    const first = ui.btn('İptal');
    const last = ui.btn('Tamam');
    last.focus();
    T.key(last, 'Tab');
    t.eq(document.activeElement, first, 'Tab sona gelince başa sarar');
    T.key(first, 'Tab', { shiftKey: true });
    t.eq(document.activeElement, last, 'Shift+Tab başa gelince sona sarar');
    document.body.focus();
    T.key(document.body, 'Tab');
    t.ok(ui.top().contains(document.activeElement), 'odak dışarıdaysa diyaloğa alınır');

    // clicking the dim area does not dismiss
    t.mouse(ui.cards()[0].parentElement, 'mousedown', { clientX: 4, clientY: 4 });
    await t.sleep(20);
    t.ok(P.dialog.isOpen(), 'arka plana tıklamak kapatmaz');
    T.key(document.body, 'Escape');
    t.eq(await a, false);
    t.ok(!P.dialog.isOpen());
  });

  T.test('diyalog: odak eski öğeye geri döner ve klavye alttaki uygulamaya sızmaz', async (t) => {
    const area = el('textarea', { style: 'position:absolute;left:5px;top:5px;z-index:9998' });
    document.getElementById('os-root').appendChild(area);
    try {
      area.focus();
      let leaked = 0;
      const spy = () => leaked++;
      document.addEventListener('keydown', spy);
      const p = P.dialog.confirm({ title: 'x', message: 'y' });
      document.body.focus();
      T.key(document.body, 'a');
      T.key(document.body, 'ArrowLeft');
      document.removeEventListener('keydown', spy);
      t.eq(leaked, 0, 'modal açıkken tuşlar alttaki öğelere ulaşmamalı');
      T.key(document.body, 'Escape');
      await p;
      t.eq(document.activeElement, area, 'odak geri verilir');
    } finally {
      area.remove();
    }
  });

  // ------------------------------------------------------------------------------------------
  // file picker + properties
  // ------------------------------------------------------------------------------------------
  T.test('dosya seçici: açma kipi — gezinme, süzgeç, çift tıklama, yan çubuk', async (t) => {
    if (!fsReady()) { t.ok(true, 'dosya sistemi henüz yok, atlandı'); return; }
    const home = P.fs.HOME;
    let p = P.dialog.pickFile({ mode: 'open', dir: home + '/Belgeler', extensions: ['.txt'] });
    let card = await t.waitFor(() => $('.dlg-card.fp'));
    t.ok(P.dialog.isOpen());
    const rowsOf = () => $$('.fp-row', card).map((r) => r.dataset.path);
    t.ok(rowsOf().includes(home + '/Belgeler/Notlar.txt'), 'Notlar.txt listelenir');
    t.ok(rowsOf().includes(home + '/Belgeler/Projeler'), 'klasörler her zaman görünür');
    t.ok(rowsOf().filter((r) => P.fs.isFile(r)).every((r) => r.endsWith('.txt')), 'yalnızca .txt dosyaları');
    t.ok($('.fp-crumb.current', card).textContent === 'Belgeler', 'yol çubuğu geçerli klasörü gösterir');
    t.ok($$('.fp-place', card).find((b) => b.textContent === 'Belgeler').classList.contains('selected'), 'yan çubuk işaretli');
    t.ok($$('.fp-place', card).map((b) => b.textContent).join('|') === 'Ana klasör|Masaüstü|Belgeler|Resimler|Müzik|İndirilenler', 'yan çubuk öğeleri');

    // open folder by double click, empty filter state, go up and back
    t.dblclick($(`.fp-row[data-path="${home}/Belgeler/Projeler"]`, card));
    t.eq($('.fp-crumb.current', card).textContent, 'Projeler');
    t.ok($('.fp-empty', card), '.md dosyası .txt süzgecinde görünmez → boş durum');
    t.click($('[aria-label="Üst klasör"]', card));
    t.eq($('.fp-crumb.current', card).textContent, 'Belgeler');
    t.click($('[aria-label="Geri"]', card));
    t.eq($('.fp-crumb.current', card).textContent, 'Projeler', 'geri düğmesi');
    t.click($$('.fp-crumb', card)[0]);
    t.eq($('.fp-crumb.current', card).textContent, 'Ana klasör', 'yol çubuğundan gezinme');
    t.click($$('.fp-place', card).find((b) => b.textContent === 'Masaüstü'));
    t.eq($('.fp-crumb.current', card).textContent, 'Masaüstü', 'yan çubuktan gezinme');

    // select a file + click Aç
    t.click($$('.fp-place', card).find((b) => b.textContent === 'Belgeler'));
    t.click($(`.fp-row[data-path="${home}/Belgeler/Notlar.txt"]`, card));
    t.eq($('.fp-name-input', card).value, 'Notlar.txt', 'seçilen ad kutuya yazılır');
    t.click(ui.btn('Aç', card));
    t.eq(await p, home + '/Belgeler/Notlar.txt');
    t.ok(!P.dialog.isOpen());

    // double click on a file chooses it
    p = P.dialog.pickFile({ mode: 'open', dir: home + '/Belgeler' });
    card = await t.waitFor(() => $('.dlg-card.fp'));
    t.dblclick($(`.fp-row[data-path="${home}/Belgeler/Notlar.txt"]`, card));
    t.eq(await p, home + '/Belgeler/Notlar.txt', 'çift tıklama dosyayı seçer');

    // typed name + Enter, then cancel & Escape
    p = P.dialog.pickFile({ mode: 'open', dir: home + '/Belgeler' });
    card = await t.waitFor(() => $('.dlg-card.fp'));
    const input = $('.fp-name-input', card);
    input.value = 'Notlar.txt';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    T.key(input, 'Enter');
    t.eq(await p, home + '/Belgeler/Notlar.txt', 'yazılan ad + Enter');

    p = P.dialog.pickFile({ mode: 'open', title: 'Seç' });
    card = await t.waitFor(() => $('.dlg-card.fp'));
    t.eq($('.fp-title', card).textContent, 'Seç');
    t.click(ui.btn('İptal', card));
    t.eq(await p, null, 'İptal null döner');
    p = P.dialog.pickFile({ mode: 'open' });
    await t.waitFor(() => $('.dlg-card.fp'));
    T.key(document.body, 'Escape');
    t.eq(await p, null, 'Escape null döner');
    t.ok(!P.dialog.isOpen());
  });

  T.test('dosya seçici: klavye ile gezinme (oklar, Enter, Backspace)', async (t) => {
    if (!fsReady()) { t.ok(true, 'dosya sistemi henüz yok, atlandı'); return; }
    const home = P.fs.HOME;
    const p = P.dialog.pickFile({ mode: 'open', dir: home + '/Belgeler', extensions: ['.txt'] });
    const card = await t.waitFor(() => $('.dlg-card.fp'));
    const list = $('.fp-list', card);
    t.eq(document.activeElement, list, 'açma kipinde liste odaklı');
    T.key(list, 'ArrowDown');
    t.eq($('.fp-row.selected', card).dataset.path, home + '/Belgeler/Projeler', 'ilk satır (klasörler önce)');
    T.key(list, 'Enter');
    t.eq($('.fp-crumb.current', card).textContent, 'Projeler', 'Enter klasöre girer');
    T.key(list, 'Backspace');
    t.eq($('.fp-crumb.current', card).textContent, 'Belgeler', 'Backspace üst klasöre çıkar');
    T.key(list, 'End');
    const last = $('.fp-row.selected', card).dataset.path;
    t.ok(P.fs.isFile(last), 'End son satırı seçer');
    T.key(list, 'Home');
    t.eq($('.fp-row.selected', card).dataset.path, home + '/Belgeler/Projeler');
    T.key(list, 'ArrowDown');
    const chosen = $('.fp-row.selected', card).dataset.path;
    T.key(list, 'Enter');
    t.eq(await p, chosen, 'Enter dosyayı seçer');
    t.ok(P.fs.isFile(chosen));
  });

  T.test('dosya seçici: kaydetme kipi — varsayılan uzantı, üzerine yazma onayı, yeni klasör', async (t) => {
    if (!fsReady()) { t.ok(true, 'dosya sistemi henüz yok, atlandı'); return; }
    const home = P.fs.HOME;
    const dir = home + '/Belgeler';
    let p = P.dialog.pickFile({ mode: 'save', dir, name: 'yeni belge', extensions: ['.txt', '.md'] });
    let card = await t.waitFor(() => $('.dlg-card.fp'));
    const input = $('.fp-name-input', card);
    t.eq(input.value, 'yeni belge');
    t.ok(ui.btn('Kaydet', card), 'birincil düğme "Kaydet"');
    t.click(ui.btn('Kaydet', card));
    t.eq(await p, dir + '/yeni belge.txt', 'uzantı eksikse ilk uzantı eklenir');

    p = P.dialog.pickFile({ mode: 'save', dir, name: 'plan.md', extensions: ['.txt'] });
    card = await t.waitFor(() => $('.dlg-card.fp'));
    t.click(ui.btn('Kaydet', card));
    t.eq(await p, dir + '/plan.md', 'uzantı varsa olduğu gibi kalır');

    // overwrite confirmation
    let settled = false;
    p = P.dialog.pickFile({ mode: 'save', dir, name: 'Notlar.txt', extensions: ['.txt'] });
    p.then(() => { settled = true; });
    card = await t.waitFor(() => $('.dlg-card.fp'));
    t.click(ui.btn('Kaydet', card));
    await t.waitFor(() => ui.cards().length === 2, 1500, 'onay diyaloğu açılmadı');
    t.ok(ui.top().textContent.includes('"Notlar.txt" zaten var. Değiştirilsin mi?'), 'onay metni');
    t.click(ui.btn('İptal', ui.top()));
    await t.waitFor(() => ui.cards().length === 1);
    await t.sleep(20);
    t.ok(!settled, 'onay reddedilirse seçici açık kalır');
    t.click(ui.btn('Kaydet', card));
    await t.waitFor(() => ui.cards().length === 2);
    t.click(ui.btn('Değiştir', ui.top()));
    t.eq(await p, dir + '/Notlar.txt');
    t.ok(!P.dialog.isOpen());

    // empty name is refused
    p = P.dialog.pickFile({ mode: 'save', dir });
    card = await t.waitFor(() => $('.dlg-card.fp'));
    t.click(ui.btn('Kaydet', card));
    await t.sleep(20);
    t.ok(P.dialog.isOpen() && $('.fp-status.error', card), 'ad boşsa hata gösterilir');
    t.click(ui.btn('İptal', card));
    t.eq(await p, null);

    // new folder
    const made = dir + '/Yeni Klasör';
    if (P.fs.exists(made)) P.fs.remove(made, { recursive: true });
    p = P.dialog.pickFile({ mode: 'open', dir });
    card = await t.waitFor(() => $('.dlg-card.fp'));
    try {
      t.click($$('button', card).find((b) => b.textContent.trim() === 'Yeni klasör'));
      await t.waitFor(() => ui.cards().length === 2, 1500, 'yeni klasör istemi açılmadı');
      t.eq($('input.dlg-input', ui.top()).value, 'Yeni Klasör');
      t.click(ui.btn('Oluştur', ui.top()));
      await t.waitFor(() => P.fs.isDir(made), 1500, 'klasör oluşmadı');
      await t.waitFor(() => $(`.fp-row[data-path="${made}"].selected`, card), 1500, 'yeni klasör seçilmedi');
    } finally {
      t.click(ui.btn('İptal', card));
      await p;
      if (P.fs.exists(made)) P.fs.remove(made, { recursive: true });
    }
  });

  T.test('dosya seçici: dosya sistemi yoksa null döner', async (t) => {
    const saved = P.fs;
    const warn = console.warn;
    let warned = 0;
    console.warn = () => { warned++; };
    try {
      P.fs = undefined;
      t.eq(await P.dialog.pickFile({ mode: 'open' }), null);
      t.eq(warned, 1, 'console.warn yazılır');
      t.ok(!P.dialog.isOpen());
    } finally {
      P.fs = saved;
      console.warn = warn;
    }
  });

  T.test('özellikler diyaloğu: dosya, klasör, kısayol', async (t) => {
    if (!fsReady()) { t.ok(true, 'dosya sistemi henüz yok, atlandı'); return; }
    const home = P.fs.HOME;
    const rowsOf = (card) => {
      const o = {};
      $$('dt', card).forEach((dt) => { o[dt.textContent] = dt.nextElementSibling.textContent; });
      return o;
    };

    let p = P.dialog.properties(home + '/Belgeler/Notlar.txt');
    let card = ui.top();
    t.eq($('.dlg-prop-name', card).textContent, 'Notlar.txt');
    let r = rowsOf(card);
    t.eq(r['Tür'], 'TXT dosyası');
    t.eq(r['Konum'], home + '/Belgeler');
    t.ok(/\d/.test(r['Boyut']), 'boyut');
    t.ok(r['Oluşturulma'] && r['Değiştirilme'], 'tarihler');
    t.ok(!('İçerik' in r), 'dosyada içerik satırı yok');
    t.ok($('.dlg-prop-icon svg', card), 'simge');
    t.click(ui.btn('Tamam'));
    await p;

    p = P.dialog.properties(home + '/Belgeler');
    card = ui.top();
    r = rowsOf(card);
    t.eq(r['Tür'], 'Klasör');
    t.ok(/^\d+ dosya, \d+ klasör$/.test(r['İçerik']), 'içerik: ' + r['İçerik']);
    T.key(document.body, 'Escape');
    await p;

    const shortcut = P.fs.list(home + '/Masaüstü').find((s) => s.ext === '.app');
    if (shortcut) {
      p = P.dialog.properties(shortcut.path);
      r = rowsOf(ui.top());
      t.eq(r['Tür'], 'Uygulama kısayolu');
      T.key(document.body, 'Enter');
      await p;
    }

    p = P.dialog.properties(home + '/yok/yok.txt');
    t.ok(ui.top().textContent.includes('bulunamadı'), 'olmayan yol');
    T.key(document.body, 'Enter');
    await p;
    t.ok(!P.dialog.isOpen());
  });

  // ------------------------------------------------------------------------------------------
  // sound
  // ------------------------------------------------------------------------------------------
  T.test('ses: play hata vermez, ana kazanç ses/sessiz ayarını izler', async (t) => {
    const S = P.sound;
    ['notify', 'error', 'click', 'startup', 'trash', 'shutdown', 'bilinmeyen', undefined, null, 42].forEach((n) => {
      try { S.play(n); } catch (e) { t.ok(false, 'play(' + n + ') hata verdi: ' + e.message); }
    });
    const ctx = S.context();
    if (!ctx) { t.ok(true, 'AudioContext yok'); return; }
    t.ok(ctx === S.context(), 'tek AudioContext');
    t.ok(typeof ctx.createGain === 'function' && ['running', 'suspended'].includes(ctx.state), 'bağlam durumu: ' + ctx.state);
    const g = S.master();
    t.ok(g && g.gain && typeof g.connect === 'function', 'master() GainNode döner');
    t.ok(g === S.master(), 'master tekil');
    const near = (a, b) => Math.abs(a - b) < 0.002;
    const vol = P.settings.get('volume');
    const muted = P.settings.get('muted');
    const sounds = P.settings.get('sounds');
    try {
      P.settings.set('muted', false);
      P.settings.set('volume', 40);
      t.ok(near(g.gain.value, 0.4), 'volume 40 → 0.4, gelen ' + g.gain.value);
      P.settings.set('volume', 100);
      t.ok(near(g.gain.value, 1), 'volume 100 → 1');
      P.settings.set('muted', true);
      t.ok(near(g.gain.value, 0), 'muted → 0');
      S.play('notify');
      P.settings.set('muted', false);
      t.ok(near(g.gain.value, 1), 'muted kapanınca ses geri gelir');
      P.settings.set('volume', 0);
      t.ok(near(g.gain.value, 0), 'volume 0 → 0');
      P.settings.set('volume', 55);
      P.settings.set('sounds', false);
      S.play('click');
      S.play('startup');
      t.ok(near(g.gain.value, 0.55), 'sounds=false master kazancını etkilemez');
    } finally {
      P.settings.set('volume', vol);
      P.settings.set('muted', muted);
      P.settings.set('sounds', sounds);
    }
  });

  T.test('ses: her sesin ses grafiği hatasız kurulur (gerçek işleme tarayıcıda CDP ile doğrulanır)', async (t) => {
    // OfflineAudioContext needs real time, so the headless virtual-time runner can only check that the
    // graph + envelope scheduling of every sound runs without throwing (play() swallows such errors).
    if (typeof OfflineAudioContext === 'undefined' || typeof P.sound.render !== 'function') { t.ok(true, 'OfflineAudioContext yok'); return; }
    const warn = console.warn;
    const warnings = [];
    console.warn = (...a) => { warnings.push(a.map(String).join(' ')); };
    try {
      for (const name of P.sound.names) {
        const p = P.sound.render(name);
        t.ok(p && typeof p.then === 'function', name + ': söz döner');
      }
      t.eq(warnings, [], 'ses üretimi uyarı vermemeli');
    } finally {
      console.warn = warn;
    }
  });

  // ------------------------------------------------------------------------------------------
  // shared component styles
  // ------------------------------------------------------------------------------------------
  T.test('bileşen stilleri: düğme, girdi, anahtar, onay kutusu, kaydırıcı, sekme', async (t) => {
    const host = el('div', { class: 't-host', style: 'position:absolute;left:0;top:0;width:500px;z-index:9997;background:var(--bg)' });
    host.innerHTML = NO_TRANSITIONS + `
      <button class="p-btn" id="c-btn">Düğme</button>
      <button class="p-btn small" id="c-small">k</button>
      <button class="p-btn primary" id="c-primary">p</button>
      <button class="p-btn danger" id="c-danger">d</button>
      <button class="p-btn" id="c-dis" disabled>x</button>
      <input class="p-input" id="c-input"><textarea class="p-input" id="c-area"></textarea>
      <select class="p-select" id="c-select"><option>a</option></select>
      <label class="p-switch"><input type="checkbox" id="c-sw"><span id="c-sw-track"></span></label>
      <input type="checkbox" class="p-checkbox" id="c-cb">
      <input class="p-range" type="range" min="0" max="100" value="25" id="c-range">
      <div class="p-tabs"><button class="p-tab" id="c-tab">a</button><button class="p-tab active" id="c-tab-on">b</button></div>
      <div class="p-list"><div class="p-list-item selected" id="c-li">x</div></div>
      <div class="p-segmented"><button class="active" id="c-seg">a</button></div>
      <span class="p-spinner" id="c-spin"></span>
      <i id="c-probe" style="background:var(--accent);color:var(--danger)"></i>
      <i id="c-probe-solid" style="background:var(--accent-solid)"></i>`;
    document.getElementById('os-root').appendChild(host);
    const cs = (id, pseudo) => getComputedStyle($('#' + id, host), pseudo);
    try {
      await t.sleep(120);
      const accent = cs('c-probe').backgroundColor;
      t.eq(cs('c-btn').height, '32px', 'düğme yüksekliği');
      t.eq(cs('c-small').height, '26px', 'küçük düğme');
      t.ok(accent && accent !== 'rgba(0, 0, 0, 0)', 'vurgu rengi okunabilmeli');
      t.eq(cs('c-primary').backgroundColor, cs('c-probe-solid').backgroundColor, 'birincil düğme dolgu rengi (--accent-solid)');
      t.eq(cs('c-danger').backgroundColor, 'rgb(229, 72, 77)', 'tehlike düğmesi');
      t.ok(parseFloat(cs('c-dis').opacity) < 0.6, 'devre dışı soluk');
      t.eq(cs('c-input').height, '32px', 'girdi yüksekliği');
      t.ok(parseFloat(cs('c-area').height) > 40, 'textarea daha yüksek');
      t.ok(cs('c-select').backgroundImage.includes('data:image/svg+xml'), 'seçim oku');
      t.eq(cs('c-select').appearance, 'none');
      t.eq(cs('c-sw-track').width, '40px', 'anahtar genişliği');
      const off = cs('c-sw-track', '::before').transform;
      $('#c-sw', host).checked = true;
      await t.sleep(20);
      const on = cs('c-sw-track', '::before').transform;
      t.ok(off !== on && on.includes('18'), `anahtar topuzu kayar: ${off} → ${on}`);
      t.eq(cs('c-sw-track').backgroundColor, cs('c-probe-solid').backgroundColor, 'açık anahtar vurgu dolgusunda (--accent-solid)');
      t.eq(cs('c-cb').width, '18px', 'onay kutusu');
      $('#c-cb', host).checked = true;
      await t.sleep(20);
      t.eq(cs('c-cb').backgroundColor, cs('c-probe-solid').backgroundColor, 'işaretli onay kutusu vurgu dolgusunda (--accent-solid)');
      t.ok(cs('c-tab-on', '::after').transform !== cs('c-tab', '::after').transform, 'etkin sekmenin alt çizgisi');
      t.ok(cs('c-li').backgroundColor !== 'rgba(0, 0, 0, 0)', 'seçili liste öğesi');
      t.ok(cs('c-seg').boxShadow !== 'none', 'etkin segment');
      t.ok(cs('c-spin').animationName === 'p-spin', 'döner gösterge');

      // slider fill follows the value (initial, typed, programmatic)
      const range = $('#c-range', host);
      await t.waitFor(() => range.style.getPropertyValue('--p') === '0.25', 1000, 'başlangıç dolgusu eşitlenmedi: ' + range.style.getPropertyValue('--p'));
      range.value = 80;
      t.eq(range.style.getPropertyValue('--p'), '0.8', 'programatik değer');
      range.max = 200;
      t.eq(range.style.getPropertyValue('--p'), '0.4', 'max değişimi');
      range.value = 150;
      range.dispatchEvent(new Event('input', { bubbles: true }));
      t.eq(range.style.getPropertyValue('--p'), '0.75');
    } finally {
      host.remove();
    }
  });

  T.test('ışık ve koyu tema: bileşenler her iki temada da okunur', async (t) => {
    const host = el('div', { class: 't-host', style: 'position:absolute;left:0;top:0;z-index:9997;background:var(--bg)' },
      el('style', { text: '.t-host *, .t-host *::before, .t-host *::after { transition: none !important; }' }),
      el('button', { class: 'p-btn', id: 'th-btn', text: 'Düğme' }),
      el('input', { class: 'p-input', id: 'th-in' }));
    document.getElementById('os-root').appendChild(host);
    const orig = P.theme.mode();
    try {
      const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      P.theme.set('dark');
      await t.sleep(20);
      const darkText = lum(rgb(getComputedStyle($('#th-btn', host)).color));
      const darkBg = lum(rgb(getComputedStyle($('#th-in', host)).backgroundColor));
      P.theme.set('light');
      await t.sleep(20);
      const lightText = lum(rgb(getComputedStyle($('#th-btn', host)).color));
      const lightBg = lum(rgb(getComputedStyle($('#th-in', host)).backgroundColor));
      t.ok(darkText > darkBg + 100, 'koyu temada metin arka plandan açık');
      t.ok(lightText < lightBg - 100, 'açık temada metin arka plandan koyu');
    } finally {
      P.theme.set(orig);
      host.remove();
    }
  });

  // ------------------------------------------------------------------------------------------
  // review fixes: z-order, accent contrast, faint text, other tabs
  // ------------------------------------------------------------------------------------------
  const lumOf = (rgb) => {
    const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
  const ratioOf = (a, b) => (Math.max(lumOf(a), lumOf(b)) + 0.05) / (Math.min(lumOf(a), lumOf(b)) + 0.05);
  // computed colours are rgb(r, g, b) or - for color-mix() results - color(srgb r g b) with 0..1 components
  const cssRgb = (s) => {
    const v = s.match(/[\d.]+/g).slice(0, 3).map(Number);
    return /^color\(/.test(s) ? v.map((x) => x * 255) : v;
  };

  T.test('toast, modal iletişim kutusunun üstünde kalır (bulanık hayalet değil, tıklanabilir)', async (t) => {
    P.notify.clear();
    const dlg = P.dialog.alert({ title: 'Kaydet', message: 'Bir iletişim kutusu açık.' });
    const id = P.notify({ title: 'Zamanlayıcı bitti', message: 'Çay demlendi.', timeout: 0 });
    try {
      await t.waitFor(() => ui.toast(id), 1000, 'toast görünmeli');
      await t.sleep(60);
      const zOf = (sel) => parseInt(getComputedStyle($(sel)).zIndex, 10);
      t.ok(zOf('#toasts') > zOf('#dialog-layer'), `toast katmanı (${zOf('#toasts')}) iletişim kutusunun (${zOf('#dialog-layer')}) üstünde olmalı`);
      t.ok(zOf('#toasts') < zOf('#lock-screen'), 'kilit ekranının altında kalır');
      const r = ui.toast(id).getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      t.ok(hit && hit.closest('.toast'), 'toast merkezi tıklanabilir: ' + (hit && hit.className));
      t.ok(!hit.closest('.dlg-backdrop'), 'iletişim kutusunun karartması toastı örtmemeli');
      // the layer itself stays click-through, so the dialog underneath still works
      t.eq(getComputedStyle($('#toasts')).pointerEvents, 'none');
    } finally {
      P.dialog.closeAll();
      await dlg;
      P.notify.clear();
    }
  });

  T.test('vurgu çifti: her hazır vurgu ve rastgele renkler için --on-accent, --accent-solid üstünde >= 4.5:1', async (t) => {
    t.ok(typeof P.ui.accentPair === 'function');
    const samples = P.settings.ACCENTS.map((a) => a.value);
    for (let i = 0; i < 400; i++) samples.push('#' + ((Math.random() * 0xffffff) | 0).toString(16).padStart(6, '0'));
    ['#000000', '#ffffff', '#ffff00', '#00ffff', '#ff0000', '#808080', '#f08c1a'].forEach((c) => samples.push(c));
    samples.forEach((hex) => {
      const p = P.ui.accentPair(hex);
      const on = hexRgb(p.on);
      ['solid', 'hover', 'active'].forEach((k) => {
        const r = ratioOf(on, hexRgb(p[k]));
        t.ok(r >= 4.5, `${hex} → ${k} ${p[k]} üstünde ${p.on}: ${r.toFixed(2)}:1`);
      });
    });
    t.eq(P.ui.accentPair('nope'), null, 'geçersiz renk null');
    // the published CSS variables follow the accent setting, for every suggested accent, in both themes
    const old = P.settings.get('accent');
    const oldTheme = P.theme.mode();
    try {
      for (const th of ['dark', 'light']) {
        P.theme.set(th);
        for (const a of P.settings.ACCENTS) {
          P.settings.set('accent', a.value);
          const cs = getComputedStyle(document.documentElement);
          const solid = cs.getPropertyValue('--accent-solid').trim();
          const on = cs.getPropertyValue('--on-accent').trim();
          t.eq(solid, P.ui.accentPair(a.value).solid, `${a.name}: --accent-solid yayınlanır`);
          const btn = el('button', { class: 'p-btn primary', text: 'Tamam' });
          document.body.appendChild(btn);
          const bs = getComputedStyle(btn);
          const r = ratioOf(cssRgb(bs.color), cssRgb(bs.backgroundColor));
          btn.remove();
          t.ok(r >= 4.5, `${th}/${a.name}: birincil düğme metni ${r.toFixed(2)}:1`);
          t.ok(on === '#ffffff' || on === '#111111');
        }
      }
    } finally {
      P.settings.set('accent', old);
      P.theme.set(oldTheme);
    }
  });

  T.test('soluk metin ve pasif başlık metni her iki temada >= 4.5:1; aksan metni cam üstünde okunur', async (t) => {
    const probe = el('div', { style: 'position:absolute;left:0;top:0;width:10px;height:10px;opacity:0;pointer-events:none' });
    document.body.appendChild(probe);
    const colorOf = (varName) => { probe.style.color = `var(${varName})`; return cssRgb(getComputedStyle(probe).color); };
    const bgOf = (varName) => { probe.style.backgroundColor = `var(${varName})`; return cssRgb(getComputedStyle(probe).backgroundColor); };
    const oldTheme = P.theme.mode();
    try {
      for (const th of ['dark', 'light']) {
        P.theme.set(th);
        await t.sleep(10);
        ['--bg', '--bg-elev'].forEach((bg) => {
          t.ok(ratioOf(colorOf('--text-faint'), bgOf(bg)) >= 4.5, `${th}: --text-faint, ${bg} üstünde ${ratioOf(colorOf('--text-faint'), bgOf(bg)).toFixed(2)}:1`);
        });
        const tb = ratioOf(colorOf('--titlebar-text-inactive'), bgOf('--titlebar-bg-inactive'));
        t.ok(tb >= 4.5, `${th}: pasif başlık metni ${tb.toFixed(2)}:1`);
        // accent as text colour on the glass surface (start-menu highlight, "Tümünü temizle")
        const glass = th === 'dark' ? [32, 35, 42] : [250, 251, 252];
        for (const a of P.settings.ACCENTS) {
          P.settings.set('accent', a.value);
          const r = ratioOf(colorOf('--accent-text'), glass);
          t.ok(r >= 4.5, `${th}/${a.name}: --accent-text ${r.toFixed(2)}:1`);
        }
      }
    } finally {
      probe.remove();
      P.settings.set('accent', P.settings.DEFAULTS.accent);
      P.theme.set(oldTheme);
    }
  });

  T.test('başka sekmede değişen bildirim geçmişi benimsenir', async (t) => {
    P.notify.clear();
    const id = P.notify({ title: 'Yerel', message: 'bir', timeout: 1 });
    let changes = 0;
    const off = P.bus.on('notify:change', () => { changes++; });
    try {
      const stored = JSON.parse(localStorage.getItem('pandaos.notifications'));
      const other = [{ id: 'uzak-1', title: 'Başka sekmeden', message: 'x', icon: 'info', appId: null, time: Date.now(), read: false }].concat(stored);
      localStorage.setItem('pandaos.notifications', JSON.stringify(other));
      window.dispatchEvent(new StorageEvent('storage', { key: 'pandaos.notifications', newValue: JSON.stringify(other) }));
      t.ok(P.notify.history().some((n) => n.id === 'uzak-1'), 'uzak bildirim geçmişe girmeli');
      t.ok(changes >= 1, 'notify:change yayılmalı (görev çubuğu rozeti güncellenir)');
      t.ok(P.notify.history().some((n) => n.id === id));
      // our next write keeps the other tab's entry
      P.notify({ title: 'Yeni', message: 'iki', timeout: 1 });
      t.ok(JSON.parse(localStorage.getItem('pandaos.notifications')).some((n) => n.id === 'uzak-1'), 'sonraki yazma diğer sekmeyi ezmemeli');
    } finally {
      off();
      P.notify.clear();
    }
  });
})();
