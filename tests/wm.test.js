/* Window manager tests (C2). Run: bash tools/test.sh wm
   Screenshot scenes (no assertions, windows are left on screen):
     bash tools/shot.sh out.png "fast=1&test=wm&wmscene=stack&theme=dark"
   wmscene = stack | snap | max | solo */
(function () {
  'use strict';

  const P = window.PandaOS;
  const wm = P.wm;
  const T = window.PandaTest;

  // throwaway app used by the singleInstance tests
  P.apps.register({
    id: 'wmtest',
    name: 'WM Test',
    icon: 'wmtest',
    category: 'utilities',
    showInStartMenu: false,
    singleInstance: true,
    window: { width: 420, height: 300, minWidth: 300, minHeight: 200 },
    launch(win, args) {
      win.body.textContent = 'wmtest';
      win.state.args = args;
    },
    relaunch(win, args) {
      win.state.relaunched = args;
    }
  });

  // ------------------------------------------------------------------ helpers
  const mk = (o) => wm.open(Object.assign({ appId: 'wmx', title: 'Deneme', width: 400, height: 300 }, o));
  const titlebar = (w) => T.$('.wm-titlebar', w.el);
  const handle = (w, dir) => T.$('.wm-h-' + dir, w.el);
  const btn = (w, cls) => T.$('.wm-btn.' + cls, w.el);
  const z = (w) => Number(w.el.style.zIndex);
  const rect = (el) => el.getBoundingClientRect();
  const center = (el) => { const r = rect(el); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  function ptr(type, target, x, y, extra) {
    target.dispatchEvent(new PointerEvent(type, Object.assign({
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1
    }, extra)));
  }

  function W(name, fn) {
    T.test(name, async (t) => {
      wm.closeAll();
      wm.forceAnimations = false;
      try {
        await fn(t);
      } finally {
        wm.forceAnimations = false;
        wm.closeAll();
        document.body.classList.remove('wm-interacting', 'wm-dragging', 'wm-resizing');
        document.body.style.removeProperty('--wm-cursor');
      }
    });
  }

  // ------------------------------------------------------------------ screenshot scenes
  const scene = P.params.get('wmscene');
  if (scene) {
    buildScene(scene);
    return;
  }

  // ------------------------------------------------------------------ tests
  W('açılış: DOM, odak, başlık, gövde sınıfları', async (t) => {
    const w = mk({ appId: 'wmx', title: 'Merhaba Dünya', icon: 'files' });
    t.ok(document.body.contains(w.el), 'pencere DOM içinde değil');
    t.ok(w.el.parentNode === document.getElementById('windows'), '#windows içinde olmalı');
    t.ok(w.el.classList.contains('wm-window'), 'kök sınıf eksik');
    t.eq(w.el.getAttribute('tabindex'), '-1');
    t.ok(w.isFocused() && wm.getFocused() === w, 'yeni pencere odakta olmalı');
    t.ok(w.el.classList.contains('wm-focused'));
    t.ok(document.activeElement === w.el, 'DOM odağı pencerede olmalı');
    t.eq(w.getTitle(), 'Merhaba Dünya');
    t.eq(T.$('.wm-title', w.el).textContent, 'Merhaba Dünya');
    t.ok(T.$('.wm-icon svg', w.el), 'başlık çubuğunda ikon yok');
    t.ok(w.body.classList.contains('wm-body') && w.body.classList.contains('app-wmx'), 'gövde sınıfları');
    const cs = getComputedStyle(w.body);
    t.eq([cs.display, cs.flexDirection, cs.overflow], ['flex', 'column', 'hidden']);
    t.eq(w.getBounds().width, 400);
    t.eq(w.getBounds().height, 300);
    t.ok(w.id && wm.get(w.id) === w, 'wm.get');
    t.eq(wm.byApp('wmx').map((x) => x.id), [w.id]);
    t.eq(wm.list().map((x) => x.id), [w.id]);
    t.ok(!w.isMinimized() && !w.isMaximized() && !w.isClosed());
    t.ok(w.state && typeof w.state === 'object', 'win.state');
    t.eq(w.beforeClose, null);
    t.eq(T.$$('.wm-h', w.el).length, 8, '8 tutamaç');
    t.eq(rect(titlebar(w)).height, 36, 'başlık çubuğu 36px');
    t.eq(rect(btn(w, 'wm-close')).width, 46, 'düğmeler 46px genişliğinde');
  });

  W('çok pencere: cascade yerleşimi sığıyor', async (t) => {
    const wa = wm.workArea();
    const a = wm.open({ appId: 'wmx', width: 500, height: 320 });
    const b = wm.open({ appId: 'wmx', width: 500, height: 320 });
    const c = wm.open({ appId: 'wmx', width: 500, height: 320 });
    const pa = a.getBounds();
    const pb = b.getBounds();
    const pc = c.getBounds();
    t.eq([pb.x - pa.x, pb.y - pa.y], [32, 32]);
    t.eq([pc.x - pb.x, pc.y - pb.y], [32, 32]);
    for (const w of [a, b, c]) {
      const r = w.getBounds();
      t.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= wa.width && r.y + r.height <= wa.height, 'pencere iş alanına sığmalı');
    }
    // a window bigger than the work area is shrunk to fit
    const big = wm.open({ appId: 'wmx', width: 5000, height: 5000 });
    t.eq([big.getBounds().width, big.getBounds().height], [wa.width, wa.height]);
  });

  W('z-sırası ve odak mousedown ile değişir', async (t) => {
    const a = mk({ title: 'A' });
    const b = mk({ title: 'B' });
    t.ok(z(b) > z(a), 'B üstte olmalı');
    t.ok(b.isFocused() && !a.isFocused());
    t.ok(!a.el.classList.contains('wm-focused'));
    t.mouse(a.el, 'mousedown');
    t.ok(a.isFocused() && !b.isFocused(), 'mousedown odağı değiştirmeli');
    t.ok(z(a) > z(b), 'A öne gelmeli');
    t.eq(wm.list().map((x) => x.id), [b.id, a.id], 'list() alttan üste');
    t.ok(a.el.classList.contains('wm-focused') && !b.el.classList.contains('wm-focused'));
    // pointerdown inside the body works as well
    t.mouse(b.body, 'mousedown');
    t.ok(b.isFocused());
    // wm.focus by id and by object
    wm.focus(a.id);
    t.ok(a.isFocused());
    wm.focus(b);
    t.ok(b.isFocused());
    t.eq(wm.getFocused(), b);
  });

  W('iç öğe odaktayken pencere DOM odağını çalmaz', async (t) => {
    const a = mk({ title: 'A' });
    const input = document.createElement('input');
    a.body.appendChild(input);
    const b = mk({ title: 'B' });
    input.focus();
    t.ok(document.activeElement === input);
    a.focus();
    t.ok(a.isFocused());
    t.ok(document.activeElement === input, 'odak input üzerinde kalmalı');
    b.focus();
    t.ok(document.activeElement === b.el, 'B odaklanınca DOM odağı B penceresine geçer');
  });

  W('küçült / geri yükle ve odak devri', async (t) => {
    const a = mk({ title: 'A' });
    const b = mk({ title: 'B' });
    const c = mk({ title: 'C' });
    c.minimize();
    t.ok(c.isMinimized());
    t.ok(c.el.classList.contains('wm-minimized'));
    t.eq(getComputedStyle(c.el).visibility, 'hidden');
    t.ok(!c.isFocused() && b.isFocused(), 'odak sıradaki görünür pencereye geçmeli');
    b.minimize();
    t.ok(a.isFocused(), 'B de küçülünce A odaklanır');
    a.minimize();
    t.eq(wm.getFocused(), null, 'görünür pencere yok');
    t.eq(wm.list().length, 3, 'küçültülmüş pencereler listede kalır');
    t.ok(!a.isFocused() && !b.isFocused());
    // restore brings it back, visible and focused
    b.restore();
    t.ok(!b.isMinimized() && b.isFocused());
    t.eq(getComputedStyle(b.el).visibility, 'visible');
    // wm.focus on a minimized window restores it
    wm.focus(c.id);
    t.ok(!c.isMinimized() && c.isFocused());
    // minimizing a non-focused window does not change focus
    a.restore();
    t.ok(a.isFocused());
    c.minimize();
    t.ok(a.isFocused(), 'odaktaki pencere değişmemeli');
    // non-minimizable
    const d = mk({ minimizable: false });
    d.minimize();
    t.ok(!d.isMinimized(), 'minimizable:false küçülmemeli');
    t.eq(getComputedStyle(btn(d, 'wm-min')).display, 'none');
  });

  W('büyüt / geri yükle sınırları', async (t) => {
    const w = mk({ x: 150, y: 90, width: 420, height: 310 });
    const before = w.getBounds();
    const wa = wm.workArea();
    w.maximize();
    t.ok(w.isMaximized());
    t.eq(w.getBounds(), { x: wa.x, y: wa.y, width: wa.width, height: wa.height });
    t.eq(w.el.style.width, wa.width + 'px');
    t.ok(w.el.classList.contains('wm-maximized'));
    t.eq(btn(w, 'wm-max').getAttribute('aria-label'), 'Önceki boyuta getir');
    t.eq(getComputedStyle(handle(w, 'se')).display, 'none', 'büyütülmüşken tutamaç kapalı');
    t.eq(getComputedStyle(w.el).borderRadius, '0px');
    w.restore();
    t.ok(!w.isMaximized());
    t.eq(w.getBounds(), before, 'eski boyut ve konum geri gelmeli');
    t.eq(btn(w, 'wm-max').getAttribute('aria-label'), 'Büyüt');
    t.ok(getComputedStyle(w.el).borderRadius !== '0px', 'yuvarlak köşeler geri gelir');
    w.toggleMaximize();
    t.ok(w.isMaximized());
    w.toggleMaximize();
    t.ok(!w.isMaximized());
    t.eq(w.getBounds(), before);
    // minimized + maximized comes back maximized
    w.maximize();
    w.minimize();
    t.ok(w.isMinimized() && w.isMaximized());
    w.restore();
    t.ok(!w.isMinimized() && w.isMaximized(), 'küçültülmüş büyük pencere büyük döner');
    w.restore();
    t.eq(w.getBounds(), before);
  });

  W('başlık çubuğu çift tık büyütür, düğmeler çalışır', async (t) => {
    const w = mk({ x: 120, y: 80 });
    const before = w.getBounds();
    t.dblclick(titlebar(w));
    t.ok(w.isMaximized(), 'çift tık büyütmeli');
    t.dblclick(titlebar(w));
    t.ok(!w.isMaximized(), 'ikinci çift tık geri almalı');
    t.eq(w.getBounds(), before);
    // dblclick on a caption button must not toggle
    t.dblclick(btn(w, 'wm-min'));
    t.ok(w.isMinimized());
    w.restore();
    // caption buttons
    t.click(btn(w, 'wm-max'));
    t.ok(w.isMaximized(), 'büyüt düğmesi');
    t.click(btn(w, 'wm-max'));
    t.ok(!w.isMaximized(), 'geri yükle düğmesi');
    t.click(btn(w, 'wm-min'));
    t.ok(w.isMinimized(), 'küçült düğmesi');
    w.restore();
    t.click(btn(w, 'wm-close'));
    await t.waitFor(() => w.isClosed(), 1000, 'kapat düğmesi pencereyi kapatmalı');
    t.ok(!document.body.contains(w.el));
  });

  W('close: beforeClose iptal / onay, forceClose', async (t) => {
    const w = mk({ title: 'Kaydedilmemiş' });
    const other = mk({ title: 'Diğer' });
    w.beforeClose = () => false;
    t.eq(await w.close(), false, 'false → iptal');
    t.ok(!w.isClosed() && document.body.contains(w.el));
    t.ok(w.isFocused(), 'iptal edilen pencere öne gelir');
    other.focus();
    w.beforeClose = async () => false;
    t.eq(await w.close(), false, 'async false → iptal');
    let calls = 0;
    w.beforeClose = async () => { calls++; await t.sleep(30); return true; };
    const p1 = w.close();
    const p2 = w.close();
    t.eq(await p1, true);
    t.eq(await p2, true);
    t.eq(calls, 1, 'beforeClose bekleyen kapatma için bir kez çalışır');
    t.ok(w.isClosed());
    t.ok(!wm.list().includes(w));
    t.ok(!document.body.contains(w.el), 'DOM temizlenmeli');
    t.ok(other.isFocused(), 'kapanınca odak sıradaki pencereye geçer');
    t.eq(await w.close(), true, 'kapalı pencereyi tekrar kapatmak true döner');
    // truthy / undefined result closes too
    const v = mk();
    v.beforeClose = () => undefined;
    t.eq(await v.close(), true);
    t.ok(v.isClosed());
    // a throwing beforeClose must not make the window unclosable
    const e = mk();
    e.beforeClose = () => { throw new Error('boom'); };
    const originalError = console.error;
    console.error = () => {};
    try { t.eq(await e.close(), true); } finally { console.error = originalError; }
    t.ok(e.isClosed());
    // forceClose ignores beforeClose
    const f = mk();
    f.beforeClose = () => false;
    f.forceClose();
    t.ok(f.isClosed() && !document.body.contains(f.el));
    t.eq(wm.getFocused(), other);
    // methods on a closed window are harmless
    f.focus(); f.minimize(); f.maximize(); f.setTitle('x'); f.setSize(300, 300); f.setPosition(1, 1); f.center(); f.flash();
    t.ok(f.isClosed());
  });

  W('kapatınca odak sıradaki görünür pencerede', async (t) => {
    const a = mk({ title: 'A' });
    const b = mk({ title: 'B' });
    const c = mk({ title: 'C' });
    b.minimize();
    c.forceClose();
    t.ok(a.isFocused(), 'B küçültülmüş, A odaklanmalı');
    a.forceClose();
    t.eq(wm.getFocused(), null);
    t.ok(b.isMinimized());
  });

  W('klavye yalnızca odaktaki pencereye gider', async (t) => {
    const a = mk({ title: 'A' });
    const b = mk({ title: 'B' });
    let ga = 0;
    let gb = 0;
    let lastKey = '';
    a.on('keydown', (e) => { ga++; lastKey = e.key; });
    b.on('keydown', () => { gb++; });
    a.focus();
    T.key(document.body, 'x');
    t.eq([ga, gb], [1, 0], 'yalnızca A almalı');
    t.eq(lastKey, 'x');
    b.focus();
    T.key(document.body, 'y');
    t.eq([ga, gb], [1, 1]);
    // target inside the focused window → delivered
    const inB = document.createElement('input');
    b.body.appendChild(inB);
    T.key(inB, 'a');
    t.eq([ga, gb], [1, 2]);
    // target inside another window → ignored
    const inA = document.createElement('input');
    a.body.appendChild(inA);
    T.key(inA, 'b');
    t.eq([ga, gb], [1, 2], 'başka pencere içindeki hedef yok sayılmalı');
    // target outside every window → ignored
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    T.key(outside, 'c');
    outside.remove();
    t.eq([ga, gb], [1, 2], 'pencere dışındaki hedef yok sayılmalı');
    // unsubscribe
    let n = 0;
    const off = b.on('keydown', () => { n++; });
    T.key(document.body, 'd');
    off();
    T.key(document.body, 'e');
    t.eq(n, 1);
    // locked session
    const hadSession = P.session;
    const oldLocked = hadSession && hadSession.isLocked;
    if (hadSession) hadSession.isLocked = () => true; else P.session = { isLocked: () => true };
    const before = gb;
    try { T.key(document.body, 'f'); } finally {
      if (hadSession) hadSession.isLocked = oldLocked; else delete P.session;
    }
    t.eq(gb, before, 'kilitliyken klavye iletilmemeli');
    // open modal dialog
    const hadDialog = P.dialog;
    const oldOpen = hadDialog && hadDialog.isOpen;
    if (hadDialog) hadDialog.isOpen = () => true; else P.dialog = { isOpen: () => true };
    try { T.key(document.body, 'g'); } finally {
      if (hadDialog) hadDialog.isOpen = oldOpen; else delete P.dialog;
    }
    t.eq(gb, before, 'diyalog açıkken klavye iletilmemeli');
    T.key(document.body, 'h');
    t.eq(gb, before + 1, 'normal duruma dönünce iletilir');
    // minimized windows don't receive keys
    b.minimize();
    a.minimize();
    T.key(document.body, 'i');
    t.eq(gb, before + 1);
  });

  W('başlık çubuğundan sürükleme pencereyi taşır', async (t) => {
    const w = mk({ x: 200, y: 150 });
    const b0 = w.getBounds();
    T.drag(titlebar(w), 120, 60);
    const b1 = w.getBounds();
    t.eq([b1.x, b1.y], [b0.x + 120, b0.y + 60], 'konum fare farkı kadar değişmeli');
    t.eq([b1.width, b1.height], [b0.width, b0.height], 'boyut değişmemeli');
    t.eq(w.el.style.left, b1.x + 'px');
    t.eq(w.el.style.top, b1.y + 'px');
    t.ok(!document.body.classList.contains('wm-interacting'), 'sürükleme bitince sınıf kalkmalı');
    // tiny jitter (below threshold) is a click, not a drag
    const b2 = w.getBounds();
    T.drag(titlebar(w), 1, 1);
    t.eq(w.getBounds(), b2, 'eşik altı hareket taşımaz');
    // caption buttons never start a drag
    T.drag(btn(w, 'wm-min'), 80, 80);
    t.eq(w.getBounds(), b2, 'düğme sürüklemeyi başlatmamalı');
    t.ok(!w.isMinimized());
    // dragging an unfocused window focuses it
    const other = mk();
    t.ok(other.isFocused());
    T.drag(titlebar(w), 10, 10);
    t.ok(w.isFocused(), 'sürüklenen pencere odaklanır');
  });

  W('sürükleme sırasında gövde olayları kapanır, imleç sınıfı konur', async (t) => {
    const w = mk({ x: 200, y: 150 });
    const c = center(titlebar(w));
    ptr('pointerdown', titlebar(w), c.x, c.y);
    ptr('pointermove', document, c.x + 40, c.y + 10);
    t.ok(document.body.classList.contains('wm-interacting'));
    t.ok(document.body.classList.contains('wm-dragging'));
    t.eq(getComputedStyle(w.body).pointerEvents, 'none', 'gövde pointer-events kapalı olmalı');
    t.eq(getComputedStyle(document.body).userSelect, 'none');
    ptr('pointerup', document, c.x + 40, c.y + 10);
    t.ok(!document.body.classList.contains('wm-interacting'));
    t.ok(getComputedStyle(w.body).pointerEvents !== 'none');
  });

  W('pencere erişilebilir kalır (başlık çubuğu çıkamaz)', async (t) => {
    const wa = wm.workArea();
    const w = mk({ x: 300, y: 200 });
    T.drag(titlebar(w), -5000, -5000);
    let b = w.getBounds();
    t.eq(b.y, 0, 'üst kenardan taşmaz');
    t.ok(b.x + b.width >= 100, 'başlık çubuğunun bir kısmı solda görünür kalır');
    t.ok(b.x < 0 || b.x === 0, 'sola kayabilir');
    w.setPosition(300, 200);
    T.drag(titlebar(w), 9000, 9000);
    b = w.getBounds();
    t.ok(b.y <= wa.height - 36, 'başlık çubuğu alt kenara gömülemez');
    t.ok(b.x <= wa.width - 100, 'sağda başlık çubuğunun bir kısmı görünür');
    w.setPosition(-5000, 7000);
    b = w.getBounds();
    t.ok(b.y <= wa.height - 36 && b.x + b.width >= 100, 'setPosition da sınırlar');
    // open with out-of-range coordinates
    const v = mk({ x: 99999, y: 99999 });
    t.ok(v.getBounds().x <= wa.width - 100 && v.getBounds().y <= wa.height - 36);
  });

  W('kenar tutamaçlarıyla yeniden boyutlandırma', async (t) => {
    const wa = wm.workArea();
    const start = { x: 300, y: 200, width: 400, height: 300 };
    const w = mk(Object.assign({ minWidth: 200, minHeight: 150 }, start));
    const reset = () => { w.setSize(start.width, start.height); w.setPosition(start.x, start.y); };

    T.drag(handle(w, 'e'), 80, 0);
    t.eq(w.getBounds(), { x: 300, y: 200, width: 480, height: 300 }, 'doğu');
    reset();
    T.drag(handle(w, 'w'), -60, 0);
    t.eq(w.getBounds(), { x: 240, y: 200, width: 460, height: 300 }, 'batı');
    reset();
    T.drag(handle(w, 's'), 0, 50);
    t.eq(w.getBounds(), { x: 300, y: 200, width: 400, height: 350 }, 'güney');
    reset();
    T.drag(handle(w, 'n'), 0, -40);
    t.eq(w.getBounds(), { x: 300, y: 160, width: 400, height: 340 }, 'kuzey');
    reset();
    T.drag(handle(w, 'se'), 30, 20);
    t.eq(w.getBounds(), { x: 300, y: 200, width: 430, height: 320 }, 'güneydoğu');
    reset();
    T.drag(handle(w, 'nw'), -20, -10);
    t.eq(w.getBounds(), { x: 280, y: 190, width: 420, height: 310 }, 'kuzeybatı');
    reset();
    T.drag(handle(w, 'ne'), 25, -15);
    t.eq(w.getBounds(), { x: 300, y: 185, width: 425, height: 315 }, 'kuzeydoğu');
    reset();
    T.drag(handle(w, 'sw'), -35, 45);
    t.eq(w.getBounds(), { x: 265, y: 200, width: 435, height: 345 }, 'güneybatı');
    t.eq(w.el.style.width, '435px');
    t.ok(!document.body.classList.contains('wm-interacting'), 'bitince sınıf kalkmalı');
    // edges cannot be pushed beyond the work area
    reset();
    T.drag(handle(w, 'e'), 9000, 0);
    t.eq(w.getBounds().x + w.getBounds().width, wa.width, 'sağ kenar iş alanında durur');
    reset();
    T.drag(handle(w, 'n'), 0, -9000);
    t.eq(w.getBounds().y, 0, 'üst kenar iş alanında durur');
    t.eq(w.getBounds().y + w.getBounds().height, 500, 'alt kenar yerinde kalır');
  });

  W('minimum boyuta uyulur', async (t) => {
    const w = mk({ x: 400, y: 250, width: 500, height: 360, minWidth: 320, minHeight: 220 });
    const right = 400 + 500;
    const bottom = 250 + 360;
    T.drag(handle(w, 'e'), -3000, 0);
    t.eq(w.getBounds().width, 320, 'doğu: min genişlik');
    t.eq(w.getBounds().x, 400);
    w.setSize(500, 360);
    T.drag(handle(w, 'w'), 3000, 0);
    t.eq(w.getBounds().width, 320, 'batı: min genişlik');
    t.eq(w.getBounds().x + w.getBounds().width, right, 'sağ kenar sabit kalır');
    w.setSize(500, 360); w.setPosition(400, 250);
    T.drag(handle(w, 's'), 0, -3000);
    t.eq(w.getBounds().height, 220, 'güney: min yükseklik');
    w.setSize(500, 360); w.setPosition(400, 250);
    T.drag(handle(w, 'n'), 0, 3000);
    t.eq(w.getBounds().height, 220, 'kuzey: min yükseklik');
    t.eq(w.getBounds().y + w.getBounds().height, bottom, 'alt kenar sabit kalır');
    w.setSize(500, 360); w.setPosition(400, 250);
    T.drag(handle(w, 'nw'), 3000, 3000);
    t.eq([w.getBounds().width, w.getBounds().height], [320, 220], 'köşe: iki yönde min');
    // setSize also respects the minimum
    w.setSize(10, 10);
    t.eq([w.getBounds().width, w.getBounds().height], [320, 220]);
    // defaults
    const d = mk({ width: 100, height: 100 });
    t.eq([d.getBounds().width, d.getBounds().height], [280, 180], 'varsayılan minimum 280x180');
  });

  W('resizable:false → tutamaç yok, büyütme yok', async (t) => {
    const w = mk({ resizable: false, x: 300, y: 200 });
    const b0 = w.getBounds();
    t.ok(w.el.classList.contains('wm-nonresizable'));
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      t.eq(getComputedStyle(handle(w, dir)).display, 'none', dir + ' tutamacı kapalı olmalı');
    }
    T.drag(handle(w, 'se'), 100, 100);
    t.eq(w.getBounds(), b0, 'boyut değişmemeli');
    w.maximize();
    t.ok(!w.isMaximized(), 'resizable:false pencere büyütülemez');
    t.eq(getComputedStyle(btn(w, 'wm-max')).display, 'none');
    t.dblclick(titlebar(w));
    t.ok(!w.isMaximized());
    w.snap('left');
    t.eq(w.getBounds(), b0, 'yaslanamaz');
    // still draggable
    T.drag(titlebar(w), 30, 30);
    t.eq([w.getBounds().x, w.getBounds().y], [b0.x + 30, b0.y + 30]);
    // explicit maximizable:false on a resizable window
    const v = mk({ maximizable: false });
    v.maximize();
    t.ok(!v.isMaximized());
    t.eq(getComputedStyle(btn(v, 'wm-max')).display, 'none');
    t.ok(getComputedStyle(handle(v, 'se')).display !== 'none', 'yine de yeniden boyutlanabilir');
  });

  W('yasla: sol / sağ / üst ve geri yükleme', async (t) => {
    const wa = wm.workArea();
    const half = Math.floor(wa.width / 2);
    const orig = { x: 200, y: 100, width: 400, height: 300 };
    const w = mk(orig);
    const tb = titlebar(w);
    const c = center(tb);

    // left edge
    T.drag(tb, 2 - c.x, 0);
    t.eq(w.getBounds(), { x: 0, y: 0, width: half, height: wa.height }, 'sol yarım');
    t.ok(!w.isMaximized());
    t.eq(w.isSnapped(), 'left');
    w.restore();
    t.eq(w.getBounds(), orig, 'yaslanmış pencere eski boyuta döner');
    t.eq(w.isSnapped(), null);

    // right edge
    const c2 = center(titlebar(w));
    T.drag(titlebar(w), wa.width - 2 - c2.x, 0);
    t.eq(w.getBounds(), { x: half, y: 0, width: wa.width - half, height: wa.height }, 'sağ yarım');
    w.restore();
    t.eq(w.getBounds(), orig);

    // top edge → maximize
    const c3 = center(titlebar(w));
    T.drag(titlebar(w), 0, 2 - c3.y);
    t.ok(w.isMaximized(), 'üst kenar büyütür');
    t.eq(w.getBounds(), wa);
    w.restore();
    t.eq(w.getBounds(), orig, 'büyütülmüşten eski boyuta');

    // a drag that ends away from the edges does not snap
    const c4 = center(titlebar(w));
    T.drag(titlebar(w), 50 + (200 - c4.x) * 0, 60);
    t.ok(!w.isMaximized() && w.isSnapped() === null);
    t.eq([w.getBounds().width, w.getBounds().height], [400, 300]);

    // programmatic snap, then maximize from snapped, restore → original
    w.setPosition(orig.x, orig.y);
    w.snap('right');
    t.eq(w.isSnapped(), 'right');
    w.maximize();
    t.ok(w.isMaximized() && w.isSnapped() === null);
    w.restore();
    t.eq(w.getBounds(), orig, 'snap → büyüt → geri: ilk boyut');
  });

  W('yasla: önizleme dikdörtgeni gösterilir ve gizlenir', async (t) => {
    const wa = wm.workArea();
    const half = Math.floor(wa.width / 2);
    const w = mk({ x: 200, y: 100, width: 400, height: 300 });
    const tb = titlebar(w);
    const c = center(tb);
    const pv = T.$('.wm-snap-preview');
    t.ok(pv, 'önizleme öğesi var');
    t.ok(!pv.classList.contains('wm-show'));

    ptr('pointerdown', tb, c.x, c.y);
    ptr('pointermove', document, c.x - 60, c.y);
    t.ok(!pv.classList.contains('wm-show'), 'kenardan uzakta önizleme yok');
    ptr('pointermove', document, 8, c.y); // exactly 8px from the edge arms the zone
    t.ok(pv.classList.contains('wm-show'), '8px içinde önizleme görünür');
    t.eq(pv.dataset.zone, 'left');
    t.eq([pv.style.left, pv.style.top, pv.style.width, pv.style.height],
      ['8px', '8px', (half - 16) + 'px', (wa.height - 16) + 'px']);
    t.eq(getComputedStyle(pv).pointerEvents, 'none');
    ptr('pointermove', document, wa.width - 3, c.y);
    t.eq(pv.dataset.zone, 'right');
    t.eq(pv.style.left, (half + 8) + 'px');
    ptr('pointermove', document, wa.width / 2, 4);
    t.eq(pv.dataset.zone, 'top');
    t.eq([pv.style.width, pv.style.height], [(wa.width - 16) + 'px', (wa.height - 16) + 'px']);
    ptr('pointermove', document, wa.width / 2, 300);
    t.ok(!pv.classList.contains('wm-show'), 'bölgeden çıkınca gizlenir');
    ptr('pointermove', document, 3, 300);
    t.ok(pv.classList.contains('wm-show'));
    ptr('pointerup', document, 3, 300);
    t.ok(!pv.classList.contains('wm-show'), 'bırakınca gizlenir');
    t.eq(w.isSnapped(), 'left');
    t.eq(w.getBounds().width, half);

    // pointercancel aborts without snapping
    w.restore();
    const c2 = center(titlebar(w));
    ptr('pointerdown', titlebar(w), c2.x, c2.y);
    ptr('pointermove', document, 3, c2.y);
    t.ok(pv.classList.contains('wm-show'));
    ptr('pointercancel', document, 3, c2.y);
    t.ok(!pv.classList.contains('wm-show'));
    t.eq(w.isSnapped(), null, 'iptal edilen sürükleme yaslamaz');
    t.ok(!document.body.classList.contains('wm-interacting'));
  });

  W('yaslanmış / büyütülmüş pencereyi sürüklemek eski boyuta döndürür', async (t) => {
    const wa = wm.workArea();
    const w = mk({ x: 200, y: 100, width: 420, height: 300 });
    w.maximize();
    const c = center(titlebar(w));
    T.drag(titlebar(w), 300, 150);
    t.ok(!w.isMaximized(), 'sürükleyince geri yüklenir');
    const b = w.getBounds();
    t.eq([b.width, b.height], [420, 300], 'eski boyut');
    t.ok(Math.abs((b.x + b.width / 2) - (c.x + 300)) <= 1, 'imlecin altında (orantılı) kalmalı');
    t.eq(b.y, 150, 'başlık çubuğu imlecin altında');
    t.ok(!w.el.classList.contains('wm-maximized'));
    t.ok(!document.body.classList.contains('wm-interacting'));

    // proportional: grabbing near the left of a maximized window
    w.setPosition(200, 100);
    w.maximize();
    const tb = titlebar(w);
    const r = rect(tb);
    const gx = r.left + 100; // 100px from the left
    ptr('pointerdown', tb, gx, r.top + 10);
    ptr('pointermove', document, gx + 50, r.top + 60);
    const b2 = w.getBounds();
    const frac = 100 / wa.width;
    t.ok(Math.abs((gx + 50) - (b2.x + frac * b2.width)) <= 1, 'orantısal tutma noktası');
    ptr('pointerup', document, gx + 50, r.top + 60);

    // dragging a snapped window restores its pre-snap size
    w.setPosition(200, 100);
    w.snap('left');
    t.eq(w.isSnapped(), 'left');
    T.drag(titlebar(w), 400, 120);
    t.eq(w.isSnapped(), null);
    t.eq([w.getBounds().width, w.getBounds().height], [420, 300]);
  });

  W('bus olayları ve wm:change', async (t) => {
    const seen = [];
    const names = ['open', 'close', 'focus', 'blur', 'minimize', 'restore', 'maximize', 'title', 'flash', 'change'];
    const offs = names.map((n) => P.bus.on('wm:' + n, (w) => seen.push(n + ':' + (w && w.id))));
    const has = (n, id) => seen.includes(n + ':' + id);
    const count = (n) => seen.filter((s) => s.startsWith(n + ':')).length;
    try {
      const a = mk({ title: 'A' });
      t.ok(has('open', a.id) && has('focus', a.id) && has('change', a.id), 'open → open, focus, change');
      t.ok(seen.indexOf('open:' + a.id) < seen.indexOf('focus:' + a.id), 'önce open sonra focus');
      const b = mk({ title: 'B' });
      t.ok(has('blur', a.id) && has('focus', b.id), 'odak değişince blur + focus');
      a.setTitle('A2');
      t.ok(has('title', a.id), 'wm:title');
      a.focus();
      b.minimize();
      t.ok(has('minimize', b.id));
      b.restore();
      t.ok(has('restore', b.id));
      b.maximize();
      t.ok(has('maximize', b.id));
      b.flash();
      t.ok(has('flash', b.id));
      const closed = count('close');
      b.forceClose();
      t.eq(count('close'), closed + 1);
      t.ok(has('close', b.id));
      // every contract event is followed by wm:change (flash is a pure notification)
      const others = seen.filter((s) => !s.startsWith('change:') && !s.startsWith('flash:')).length;
      t.ok(count('change') >= others, 'her olaydan sonra wm:change');
      // window level events
      const b2 = mk({ title: 'C' });
      const got = [];
      ['focus', 'blur', 'minimize', 'restore', 'maximize', 'close'].forEach((n) => b2.on(n, () => got.push(n)));
      a.focus();
      b2.focus();
      b2.minimize();
      b2.restore();
      b2.maximize();
      b2.restore();
      b2.forceClose();
      t.eq(got.filter((x) => x !== 'blur' && x !== 'focus'), ['minimize', 'restore', 'maximize', 'restore', 'close']);
      t.ok(got.includes('focus') && got.includes('blur'));
      // a throwing listener does not break the others
      const c = mk();
      let okCalls = 0;
      const oldErr = console.error;
      console.error = () => {};
      try {
        c.on('minimize', () => { throw new Error('x'); });
        c.on('minimize', () => { okCalls++; });
        c.minimize();
      } finally { console.error = oldErr; }
      t.eq(okCalls, 1);
    } finally {
      offs.forEach((off) => off());
    }
  });

  W('minimizeAll: masaüstünü göster / geri getir', async (t) => {
    const a = mk({ title: 'A' });
    const b = mk({ title: 'B' });
    const c = mk({ title: 'C' });
    const d = mk({ title: 'D' });
    b.minimize(); // user-minimized before "show desktop"
    d.focus();
    wm.minimizeAll();
    t.ok([a, b, c, d].every((w) => w.isMinimized()), 'hepsi küçülmeli');
    t.eq(wm.getFocused(), null);
    wm.minimizeAll();
    t.ok(a.isFocused() === false);
    t.ok(!a.isMinimized() && !c.isMinimized() && !d.isMinimized(), 'küçülttükleri geri gelir');
    t.ok(b.isMinimized(), 'kullanıcının küçülttüğü geri gelmez');
    t.ok(d.isFocused(), 'en üstteki pencere odaklanır');
    // if the user brings one window back manually, the next call hides everything again
    wm.minimizeAll();
    a.restore();
    wm.minimizeAll();
    t.ok([a, b, c, d].every((w) => w.isMinimized()), 'araya giren kullanıcı işlemi sonrası yine gizler');
    wm.minimizeAll();
    t.ok(!a.isMinimized() && c.isMinimized() && d.isMinimized() && b.isMinimized(),
      'yalnızca son çağrının küçülttüğü pencere geri gelir');
    // nothing to do with zero windows
    wm.closeAll();
    wm.minimizeAll();
    t.eq(wm.list().length, 0);
  });

  W('getBounds / setSize / setPosition / center', async (t) => {
    const wa = wm.workArea();
    const w = mk({ x: 100, y: 80, width: 500, height: 350, minWidth: 300, minHeight: 200 });
    t.eq(w.getBounds(), { x: 100, y: 80, width: 500, height: 350 });
    const copy = w.getBounds();
    copy.x = 9999;
    t.eq(w.getBounds().x, 100, 'getBounds kopya döndürür');
    w.setSize(600, 400);
    t.eq(w.getBounds(), { x: 100, y: 80, width: 600, height: 400 });
    t.eq([w.el.style.width, w.el.style.height], ['600px', '400px']);
    const rr = rect(w.el);
    t.eq([rr.width, rr.height], [600, 400], 'gerçek boyut');
    w.setPosition(300, 200);
    t.eq(w.getBounds(), { x: 300, y: 200, width: 600, height: 400 });
    t.eq([w.el.style.left, w.el.style.top], ['300px', '200px']);
    w.center();
    const e = w.getBounds();
    t.eq([e.x, e.y], [Math.round((wa.width - 600) / 2), Math.round((wa.height - 400) / 2)], 'ortala');
    w.setSize(wa.width + 500, wa.height + 500);
    t.eq([w.getBounds().width, w.getBounds().height], [wa.width, wa.height], 'iş alanından büyük olamaz');
    // while maximized, size/position edits apply to the restore bounds
    w.setSize(500, 350);
    w.setPosition(120, 90);
    w.maximize();
    w.setSize(450, 300);
    w.setPosition(140, 110);
    t.eq(w.getBounds(), wa, 'büyükken gerçek sınırlar iş alanı');
    w.restore();
    t.eq(w.getBounds(), { x: 140, y: 110, width: 450, height: 300 }, 'geri yükleme yeni değerleri kullanır');
    t.eq(wm.workArea().x, 0);
    t.ok(wa.width > 0 && wa.height > 0 && wa.height < window.innerHeight, 'iş alanı görev çubuğunun üstünde');
  });

  W('singleInstance: yeniden başlatma mevcut pencereyi odaklar', async (t) => {
    const w1 = P.apps.launch('wmtest');
    t.ok(w1, 'uygulama açıldı');
    t.eq(w1.appId, 'wmtest');
    t.eq(w1.getTitle(), 'WM Test');
    t.ok(w1.body.classList.contains('app-wmtest'));
    t.eq(w1.body.textContent, 'wmtest');
    t.eq([w1.getBounds().width, w1.getBounds().height], [420, 300]);
    const other = mk({ title: 'Başka' });
    t.ok(other.isFocused());
    const w2 = P.apps.launch('wmtest');
    t.ok(w2 === w1, 'aynı pencere dönmeli');
    t.eq(wm.byApp('wmtest').length, 1);
    t.ok(w1.isFocused(), 'mevcut pencere odaklanmalı');
    w1.minimize();
    P.apps.launch('wmtest', { page: 'x' });
    t.ok(!w1.isMinimized() && w1.isFocused(), 'küçültülmüşse geri yüklenir');
    t.eq(w1.state.relaunched, { page: 'x' }, 'relaunch çağrıldı');
  });

  W('başlık ve ikon güncellenir', async (t) => {
    const w = mk({ title: 'İlk', icon: 'files' });
    w.setTitle('Yeni Başlık — ğüşiöçİ');
    t.eq(w.getTitle(), 'Yeni Başlık — ğüşiöçİ');
    t.eq(T.$('.wm-title', w.el).textContent, 'Yeni Başlık — ğüşiöçİ');
    t.eq(w.el.getAttribute('aria-label'), 'Yeni Başlık — ğüşiöçİ');
    w.setIcon('<svg id="wm-test-icon" viewBox="0 0 10 10"></svg>');
    t.ok(T.$('#wm-test-icon', w.el), 'ham svg işaretlemesi kabul edilir');
    // the title ellipsizes instead of overflowing
    w.setTitle('Çok uzun bir pencere başlığı '.repeat(10));
    const title = T.$('.wm-title', w.el);
    const cs = getComputedStyle(title);
    t.eq([cs.overflow, cs.textOverflow, cs.whiteSpace], ['hidden', 'ellipsis', 'nowrap']);
    t.ok(rect(title).right <= rect(T.$('.wm-controls', w.el)).left + 0.5, 'başlık düğmelerin üstüne taşmaz');
  });

  W('resize olayı gövde boyutunu bildirir', async (t) => {
    const w = mk({ width: 420, height: 300 });
    const sizes = [];
    w.on('resize', (s) => sizes.push(s));
    await t.sleep(80);
    w.setSize(520, 380);
    const expected = () => { const r = rect(w.body); return { width: Math.round(r.width), height: Math.round(r.height) }; };
    await t.waitFor(() => { const s = sizes[sizes.length - 1]; return s && s.width === 520; }, 2000, 'resize olayı gelmedi');
    t.eq(sizes[sizes.length - 1], expected());
    t.eq(sizes[sizes.length - 1].height, 380 - rect(titlebar(w)).height);
    const n = sizes.length;
    w.setPosition(200, 200);
    await t.sleep(80);
    t.eq(sizes.length, n, 'taşıma resize olayı üretmez');
    w.setSize(520, 380);
    await t.sleep(80);
    t.eq(sizes.length, n, 'aynı boyut tekrar bildirilmez');
    // maximize also reports
    sizes.length = 0;
    w.maximize();
    const wa = wm.workArea();
    await t.waitFor(() => sizes.length && sizes[sizes.length - 1].width === wa.width, 2000, 'büyütünce resize gelmeli');
    t.eq(sizes[sizes.length - 1].height, wa.height - rect(titlebar(w)).height);
    // edge resize reports as well
    w.restore();
    sizes.length = 0;
    T.drag(handle(w, 'e'), 40, 0);
    await t.waitFor(() => sizes.length > 0, 1000, 'kenardan boyutlandırma resize bildirmeli');
    t.eq(sizes[sizes.length - 1].width, w.getBounds().width);
  });

  W('flash: sınıf + bus olayı', async (t) => {
    const w = mk();
    let got = null;
    const off = P.bus.on('wm:flash', (x) => { got = x; });
    w.flash();
    off();
    t.ok(got === w, 'wm:flash veri olarak pencereyi taşır');
    t.ok(w.el.classList.contains('wm-flash'));
  });

  W('tarayıcı yeniden boyutlanınca pencereler sığdırılır', async (t) => {
    const layer = document.getElementById('windows');
    const full = wm.workArea();
    const a = mk({ x: 300, y: 560, width: 400, height: 240 });
    const m = mk({ x: 100, y: 100 });
    const s = mk({ x: 150, y: 120 });
    m.maximize();
    s.snap('right');
    t.eq(a.getBounds().y, 560);
    layer.style.bottom = 'calc(var(--taskbar-height) + 420px)';
    try {
      window.dispatchEvent(new Event('resize'));
      const wa = wm.workArea();
      t.ok(wa.height < full.height, 'iş alanı küçüldü');
      t.ok(a.getBounds().y <= wa.height - 36, 'başlık çubuğu iş alanında kalır');
      t.eq(m.getBounds(), wa, 'büyük pencere iş alanına sığar');
      t.eq(s.getBounds().height, wa.height, 'yaslı pencere yeni yüksekliğe uyar');
    } finally {
      layer.style.bottom = '';
    }
    window.dispatchEvent(new Event('resize'));
    t.eq(m.getBounds(), full, 'geri büyüyünce tekrar sığar');
    // window narrower than before: horizontal reachability
    a.setPosition(1300, 100);
    layer.style.right = '600px';
    try {
      window.dispatchEvent(new Event('resize'));
      const wa = wm.workArea();
      t.ok(a.getBounds().x <= wa.width - 100, 'sağdan taşan pencerenin başlığı erişilebilir');
    } finally {
      layer.style.right = '';
    }
  });

  W('animasyonlar: açılış, küçültme, büyütme, kapanış (zamanlayıcı yedekli)', async (t) => {
    wm.forceAnimations = true;
    const w = mk({ width: 400, height: 300 });
    t.ok(w.el.classList.contains('wm-opening'), 'açılış animasyon sınıfı');
    await t.waitFor(() => !w.el.classList.contains('wm-opening'), 1500, 'açılış animasyonu bitmeli');

    w.minimize();
    t.ok(w.isMinimized(), 'durum hemen değişir');
    t.ok(/scale\(/.test(w.el.style.transform), 'küçültme: hedefe doğru ölçekle');
    await t.waitFor(() => w.el.classList.contains('wm-minimized'), 1500, 'küçültme bitmeli');
    t.eq(w.el.style.transform, '');
    t.eq(getComputedStyle(w.el).visibility, 'hidden');
    w.restore();
    t.ok(!w.el.classList.contains('wm-minimized'));
    await t.waitFor(() => w.el.style.transition === '', 1500, 'geri yükleme bitmeli');
    t.eq(getComputedStyle(w.el).visibility, 'visible');

    w.maximize();
    t.ok(w.el.classList.contains('wm-animating'), 'sınır geçişi sınıfı');
    t.eq(w.getBounds(), wm.workArea(), 'sınırlar hemen güncellenir');
    await t.waitFor(() => !w.el.classList.contains('wm-animating'), 1500);

    // dragging cancels a running bounds animation
    w.restore();
    t.ok(w.el.classList.contains('wm-animating'));
    T.drag(titlebar(w), 20, 20);
    t.ok(!w.el.classList.contains('wm-animating'), 'sürükleme geçişi iptal eder');

    w.forceClose();
    t.ok(w.isClosed() && !wm.list().includes(w), 'kapanma durumu hemen');
    t.ok(document.body.contains(w.el) && w.el.classList.contains('wm-closing'), 'DOM animasyon bitene dek kalır');
    await t.waitFor(() => !document.body.contains(w.el), 1500, 'DOM temizlenmeli');

    // animations setting off → instant
    wm.forceAnimations = false;
    P.settings.set('animations', false);
    try {
      const v = mk();
      t.ok(!v.el.classList.contains('wm-opening'));
      v.minimize();
      t.ok(v.el.classList.contains('wm-minimized'), 'animasyon kapalıyken anında');
      v.forceClose();
      t.ok(!document.body.contains(v.el));
    } finally {
      P.settings.set('animations', true);
    }
  });

  W('?fast=1: pencere çerçevesi geçişleri kapalı, uygulama içeriği etkilenmez', async (t) => {
    const layer = document.getElementById('windows');
    const w = mk();
    if (P.params.get('fast') === '1') {
      t.ok(layer.classList.contains('wm-instant'), 'fast modunda wm-instant sınıfı');
      t.eq(getComputedStyle(w.el).transitionDuration, '0s');
      t.eq(getComputedStyle(T.$('.wm-btn', w.el)).transitionDuration, '0s');
      t.eq(getComputedStyle(T.$('.wm-title', w.el)).transitionDuration, '0s');
      const inner = document.createElement('div');
      inner.style.transition = 'opacity 300ms';
      w.body.appendChild(inner);
      t.eq(getComputedStyle(inner).transitionDuration, '0.3s', 'uygulama içeriğinin geçişleri korunur');
      wm.forceAnimations = true;
      t.ok(!layer.classList.contains('wm-instant'), 'forceAnimations geçişleri açar');
      t.ok(getComputedStyle(w.el).transitionDuration !== '0s');
      wm.forceAnimations = false;
      t.ok(layer.classList.contains('wm-instant'));
    } else {
      t.ok(!layer.classList.contains('wm-instant'), 'fast dışında sınıf yok');
      t.ok(getComputedStyle(w.el).transitionDuration !== '0s');
    }
  });

  W('başlık çubuğu sağ tık menüsü', async (t) => {
    const w = mk({ title: 'Menülü' });
    let shown = null;
    const hadMenu = P.contextMenu;
    const oldShow = hadMenu && hadMenu.show;
    const fake = (x, y, items) => { shown = { x, y, items }; };
    if (hadMenu) hadMenu.show = fake; else P.contextMenu = { show: fake };
    try {
      const ev = T.contextmenu(titlebar(w));
      t.ok(ev.defaultPrevented, 'tarayıcı menüsü engellenmeli');
      t.ok(shown, 'menü gösterilmeli');
      const labels = shown.items.filter((i) => i.label).map((i) => i.label);
      for (const l of ['Geri Yükle', 'Küçült', 'Büyüt', 'Kapat']) t.ok(labels.includes(l), l + ' menüde olmalı');
      const item = (l) => shown.items.find((i) => i.label === l);
      t.ok(item('Geri Yükle').disabled, 'normal pencerede geri yükle pasif');
      item('Büyüt').action();
      t.ok(w.isMaximized());
      T.contextmenu(titlebar(w));
      t.ok(!item('Geri Yükle').disabled && item('Büyüt').disabled);
      item('Geri Yükle').action();
      t.ok(!w.isMaximized());
      T.contextmenu(titlebar(w));
      item('Ekranın soluna yasla').action();
      t.eq(w.isSnapped(), 'left');
      // right-click on a caption button does not open the window menu
      shown = null;
      const ev2 = T.contextmenu(btn(w, 'wm-min'));
      t.ok(ev2.defaultPrevented);
      t.eq(shown, null);
      T.contextmenu(titlebar(w));
      item('Kapat').action();
      await t.waitFor(() => w.isClosed(), 1000);
    } finally {
      if (hadMenu) hadMenu.show = oldShow; else delete P.contextMenu;
    }
  });

  W('maximized:true seçeneği ve closeAll', async (t) => {
    const wa = wm.workArea();
    const w = mk({ maximized: true, width: 500, height: 330 });
    t.ok(w.isMaximized());
    t.eq(w.getBounds(), wa);
    w.restore();
    t.eq([w.getBounds().width, w.getBounds().height], [500, 330], 'açılış boyutuna döner');
    const a = mk();
    const b = mk();
    b.beforeClose = () => false;
    t.eq(await wm.closeAll({ force: false }), false, 'iptal eden pencere kapanmaz');
    t.ok(!a.isClosed() || !b.isClosed());
    t.ok(!b.isClosed());
    await wm.closeAll();
    t.eq(wm.list().length, 0);
    t.ok(!T.$('.wm-window'), 'DOM boş');
    t.eq(wm.getFocused(), null);
  });

  W('odağı olmayan minimizable pencereler ve z-sırası kararlı', async (t) => {
    const ws = [mk({ title: '1' }), mk({ title: '2' }), mk({ title: '3' }), mk({ title: '4' })];
    ws[0].focus();
    ws[2].focus();
    t.eq(wm.list().map((w) => w.getTitle()), ['2', '4', '1', '3']);
    const zs = wm.list().map(z);
    t.ok(zs.every((v, i) => i === 0 || v > zs[i - 1]), 'z-index sıralı artar');
    ws[3].forceClose();
    t.eq(wm.list().map((w) => w.getTitle()), ['2', '1', '3']);
    t.ok(ws[2].isFocused());
  });

  // ------------------------------------------------------------------ screenshot scenes
  // ---- review fixes: viewport shrink, focus memory, show-desktop, caption tooltips -------------------------------------
  W('tarayıcı küçülünce yüzen pencerelerin boyutu da iş alanına sığar (minWidth/minHeight altına inmez)', async (t) => {
    const layer = document.getElementById('windows');
    const full = wm.workArea();
    const a = mk({ x: 40, y: 30, width: 700, height: 520, minWidth: 300, minHeight: 200 });
    const stiff = mk({ x: 20, y: 20, width: 700, height: 520, minWidth: 600, minHeight: 480 });
    a.maximize(); // its remembered normal size must shrink too
    layer.style.right = '900px';
    layer.style.bottom = 'calc(var(--taskbar-height) + 380px)';
    try {
      window.dispatchEvent(new Event('resize'));
      const wa = wm.workArea();
      t.ok(wa.width < 700 && wa.height < 520, 'iş alanı küçüldü: ' + JSON.stringify(wa));
      const s = stiff.getBounds();
      t.ok(s.width === 600 && s.height === 480, 'minimum boyutun altına inmez: ' + JSON.stringify(s));
      a.restore();
      const b = a.getBounds();
      t.ok(b.width <= wa.width && b.height <= wa.height, 'normal boyut da sığar: ' + JSON.stringify(b) + ' / ' + JSON.stringify(wa));
      t.ok(b.y + b.height <= wa.height && b.x + b.width <= wa.width + 1, 'alt ve sağ kenar iş alanında kalır');
      t.ok(b.width >= 300 && b.height >= 200, 'minimum boyut korunur');
    } finally {
      layer.style.right = '';
      layer.style.bottom = '';
    }
    window.dispatchEvent(new Event('resize'));
    t.eq(wm.workArea(), full);
  });

  W('odak belleği: pencere değişince ve küçültüp geri getirince metin alanı odağı geri gelir', async (t) => {
    const withInput = (title) => {
      const w = mk({ title });
      const ta = document.createElement('textarea');
      w.body.appendChild(ta);
      return { w, ta };
    };
    const A = withInput('A');
    const B = withInput('B');
    A.ta.focus();
    A.w.focus();
    B.ta.focus();
    B.w.focus();
    t.ok(document.activeElement === B.ta, 'B metin alanı odakta');
    A.w.focus(); // taskbar click / alt-tab
    t.ok(document.activeElement === A.ta, 'A metin alanına dönmeli: ' + document.activeElement.tagName);
    A.w.minimize();
    t.ok(B.w.isFocused() && document.activeElement === B.ta, 'küçültünce sıradaki pencerenin alanı odaklanır');
    A.w.restore();
    t.ok(A.w.isFocused() && document.activeElement === A.ta, 'geri getirince alan odakta: ' + document.activeElement.tagName);
    // clicking the blank part of the window drops the memory: the window itself gets focus next time
    A.w.el.focus();
    B.w.focus();
    A.w.focus();
    t.ok(document.activeElement === A.w.el, 'boş alana tıklanınca eski kontrol unutulur');
    // a control that was removed / hidden is never refocused
    A.ta.focus();
    B.w.focus();
    A.ta.remove();
    A.w.focus();
    t.ok(document.activeElement === A.w.el, 'kaldırılan kontrole odaklanmaz');
  });

  W('wm.refocus: odak pencerenin dışında kaldıysa aktif pencereye döner, aktif pencere yoksa dokunmaz', async (t) => {
    const w = mk({ title: 'R' });
    const ta = document.createElement('textarea');
    w.body.appendChild(ta);
    ta.focus();
    const out = document.createElement('button');
    document.body.appendChild(out);
    try {
      out.focus(); // e.g. a taskbar button after its flyout closed
      t.ok(!w.el.contains(document.activeElement));
      t.ok(typeof wm.refocus === 'function', 'wm.refocus var');
      wm.refocus();
      t.ok(document.activeElement === ta, 'metin alanı odağı geri alır');
      wm.blurAll();
      out.focus();
      wm.refocus();
      t.ok(document.activeElement === out, 'odaklı pencere yokken odağı çalmaz');
      w.minimize();
      out.focus();
      wm.refocus();
      t.ok(document.activeElement === out, 'küçültülmüş pencereye odak verilmez');
    } finally {
      out.remove();
    }
  });

  W('başlık çubuğuna basmak metin alanının odağını almaz', async (t) => {
    const w = mk({ title: 'T' });
    const ta = document.createElement('textarea');
    w.body.appendChild(ta);
    ta.focus();
    const tb = titlebar(w);
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    tb.dispatchEvent(ev);
    t.ok(ev.defaultPrevented, 'mousedown varsayılanı (odak kayması) engellenir');
    t.ok(document.activeElement === ta);
  });

  W('masaüstünü göster: simge durumuna küçültülemeyen pencere varken ikinci tık küçültülenleri geri getirir', async (t) => {
    const a = mk({ title: 'A' });
    const b = mk({ title: 'B', minimizable: false });
    wm.minimizeAll();
    t.ok(a.isMinimized() && !b.isMinimized(), 'yalnızca küçültülebilen küçülür');
    wm.minimizeAll();
    t.ok(!a.isMinimized(), 'ikinci tık A\'yı geri getirmeli');
    t.ok(!b.isMinimized());
  });

  W('başlık çubuğu düğmeleri özel ipucu kullanır: title yok, aria-label var, ipucu pencerenin altında açılır', async (t) => {
    t.ok(P.ui && typeof P.ui.tip === 'function', 'PandaOS.ui.tip paylaşılan ipucu bileşeni');
    const w = mk({ title: 'Tip', x: 200, y: 0 });
    ['wm-min', 'wm-max', 'wm-close'].forEach((c) => {
      const b = btn(w, c);
      t.ok(!b.hasAttribute('title'), c + ': yerel title baloncuğu yok');
      t.ok(b.getAttribute('aria-label'), c + ': aria-label korunur');
    });
    const b = btn(w, 'wm-max');
    b.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = T.$('.tb-tip');
    await T.waitFor(() => tip.classList.contains('show'), 2000, 'ipucu görünmeli');
    t.eq(tip.textContent, 'Büyüt');
    t.ok(tip.classList.contains('below') && rect(tip).top >= rect(b).bottom, 'üstte yer yok → düğmenin altında');
    w.maximize();
    b.dispatchEvent(new MouseEvent('mouseleave'));
    b.dispatchEvent(new MouseEvent('mouseenter'));
    await T.waitFor(() => tip.classList.contains('show') && tip.textContent === 'Önceki boyuta getir', 2000, 'metin büyüt/geri yükle durumunu izler: ' + tip.textContent);
    // closing the window while the tooltip is up must not leave it hanging
    w.forceClose();
    await T.waitFor(() => !tip.classList.contains('show'), 2000, 'pencere kapanınca ipucu kalkmalı');
  });

  function buildScene(kind) {
    const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
    const fill = (w, node) => { w.body.appendChild(node); return w; };

    T.test('sahne:' + kind, async () => {
      if (P.params.get('wmhover')) { // inspection only: force hover/pressed looks on the focused window's caption buttons
        const s = document.createElement('style');
        s.textContent = `.wm-window.wm-focused .wm-close { background:#e81123 !important; color:#fff !important }
          .wm-window.wm-focused .wm-max { background: var(--bg-hover) !important }
          .wm-window.wm-focused .wm-min { background: var(--bg-active) !important }`;
        document.head.appendChild(s);
      }
      const desktop = document.getElementById('desktop');
      if (desktop && !desktop.children.length) {
        desktop.style.background = [
          'radial-gradient(900px 600px at 18% 12%, rgba(120, 230, 170, .55), transparent 70%)',
          'radial-gradient(800px 700px at 85% 90%, rgba(40, 120, 200, .55), transparent 70%)',
          'repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 2px, transparent 2px 36px)',
          'linear-gradient(135deg, #123c34, #1f6b57 55%, #2a8f6e)'
        ].join(',');
      }
      if (kind === 'zoom') { // compact scene for 2x close-up inspection of the chrome
        const a = wm.open({ appId: 'files', title: 'Dosyalar — Belgeler', icon: 'files', x: 16, y: 16, width: 360, height: 200 });
        const b = wm.open({ appId: 'notepad', title: 'Notlar.txt — Not Defteri', icon: 'notepad', x: 70, y: 70, width: 360, height: 200 });
        const c = wm.open({ appId: 'calculator', title: 'Hesap Makinesi', icon: 'calculator', x: 470, y: 30, width: 300, height: 220, resizable: false });
        const d = wm.open({ appId: 'terminal', title: 'Çok uzun bir pencere başlığı taşmayı denemek için yazıldı', icon: 'terminal', x: 470, y: 270, width: 300, height: 100, minHeight: 100 });
        [a, b, c, d].forEach((w) => fill(w, el('<div style="flex:1;padding:10px;font-size:12px;color:var(--text-muted)">İçerik alanı</div>')));
        b.focus();
        return;
      }
      const files = wm.open({ appId: 'files', title: 'Dosyalar — Belgeler', icon: 'files', x: 70, y: 56, width: 700, height: 460 });
      fill(files, el(`
        <div style="display:flex;flex:1;min-height:0">
          <div style="width:170px;background:var(--bg-elev);border-right:1px solid var(--border);padding:10px 8px;display:flex;flex-direction:column;gap:2px;font-size:13px">
            <div style="padding:7px 10px;border-radius:6px;background:var(--accent-soft);color:var(--text)">Ev</div>
            <div style="padding:7px 10px;border-radius:6px;color:var(--text-muted)">Masaüstü</div>
            <div style="padding:7px 10px;border-radius:6px;color:var(--text-muted)">Belgeler</div>
            <div style="padding:7px 10px;border-radius:6px;color:var(--text-muted)">Resimler</div>
            <div style="padding:7px 10px;border-radius:6px;color:var(--text-muted)">Müzik</div>
            <div style="padding:7px 10px;border-radius:6px;color:var(--text-muted)">Çöp Kutusu</div>
          </div>
          <div style="flex:1;padding:14px;display:grid;grid-template-columns:repeat(auto-fill,96px);gap:10px;align-content:start;font-size:12px;color:var(--text)">
            ${['Projeler', 'Notlar.txt', 'Alışveriş Listesi.txt', 'Fotoğraflar', 'Müzikler', 'Taslak.md'].map((n) => `
              <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border-radius:8px;text-align:center">
                <div style="width:44px;height:44px;border-radius:10px;background:var(--bg-elev-2);border:1px solid var(--border)"></div>${n}
              </div>`).join('')}
          </div>
        </div>`));

      const note = wm.open({ appId: 'notepad', title: 'Notlar.txt — Not Defteri', icon: 'notepad', x: 300, y: 150, width: 560, height: 380 });
      fill(note, el(`
        <div style="display:flex;flex-direction:column;flex:1;min-height:0">
          <div style="display:flex;gap:6px;padding:6px 10px;background:var(--bg-elev);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)"><span>Dosya</span><span>Düzen</span><span>Görünüm</span></div>
          <div style="flex:1;padding:14px 16px;font-family:var(--font-mono);font-size:13px;line-height:1.6;color:var(--text);overflow:hidden">
            PandaOS yapılacaklar<br>- Pencere yöneticisini cilala<br>- Yasla önizlemesini dene<br>- Koyu ve açık temayı karşılaştır<br>- ğüşiöç İĞÜŞÖÇ karakterlerini kontrol et
          </div>
          <div style="padding:4px 12px;background:var(--bg-elev);border-top:1px solid var(--border);font-size:11px;color:var(--text-faint)">Satır 3, Sütun 14</div>
        </div>`));

      const term = wm.open({ appId: 'terminal', title: 'Terminal', icon: 'terminal', x: 640, y: 90, width: 600, height: 340 });
      fill(term, el(`
        <div style="flex:1;background:var(--bg-sunken);padding:12px 14px;font-family:var(--font-mono);font-size:13px;line-height:1.55;color:var(--text);overflow:hidden">
          <div><span style="color:var(--accent)">panda@pandaos</span>:<span style="color:var(--info)">~</span>$ ls</div>
          <div style="color:var(--text-muted)">Belgeler  Masaüstü  Müzik  Resimler  İndirilenler</div>
          <div><span style="color:var(--accent)">panda@pandaos</span>:<span style="color:var(--info)">~</span>$ cat Belgeler/Notlar.txt</div>
          <div style="color:var(--text-muted)">Merhaba PandaOS!</div>
          <div><span style="color:var(--accent)">panda@pandaos</span>:<span style="color:var(--info)">~</span>$ <span style="display:inline-block;width:8px;height:15px;background:var(--text);vertical-align:-2px"></span></div>
        </div>`));

      const calc = wm.open({ appId: 'calculator', title: 'Hesap Makinesi', icon: 'calculator', x: 980, y: 340, width: 320, height: 440, resizable: false, maximizable: false });
      fill(calc, el(`
        <div style="display:flex;flex-direction:column;flex:1;padding:12px;gap:10px">
          <div style="text-align:right;padding:14px 10px;font-size:34px;font-weight:300;color:var(--text)">1.284</div>
          <div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', ',', '=', ''].map((k, i) => k === '' ? '' : `
              <div style="display:grid;place-items:center;border-radius:8px;font-size:16px;background:${k === '=' ? 'var(--accent)' : 'var(--bg-elev-2)'};color:${k === '=' ? 'var(--accent-contrast)' : 'var(--text)'}">${k}</div>`).join('')}
          </div>
        </div>`));

      if (kind === 'solo') {
        note.forceClose(); term.forceClose(); calc.forceClose();
        files.setPosition(220, 120);
        files.focus();
      } else if (kind === 'max') {
        note.maximize();
      } else if (kind === 'snap') {
        // leave a drag in progress next to the left edge → snap preview visible
        term.focus();
        const tb = titlebar(term);
        const c = center(tb);
        ptr('pointerdown', tb, c.x, c.y);
        ptr('pointermove', document, c.x - 60, c.y + 6);
        ptr('pointermove', document, 4, c.y + 6);
      } else {
        // stack: terminal in front, notepad minimized-free, calculator on top → focus the notepad
        note.focus();
      }
    });
  }
})();
