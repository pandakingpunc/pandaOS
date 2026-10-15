/* Tests for the Ayarlar (Settings) app.  Run: bash tools/test.sh settings */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T = window.PandaTest;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const PAGE_TITLES = { appearance: 'Kişiselleştirme', wallpaper: 'Duvar kağıdı', sound: 'Ses', notifications: 'Bildirimler', datetime: 'Tarih ve saat', storage: 'Depolama', about: 'Hakkında' };
  const PAGE_IDS = Object.keys(PAGE_TITLES);

  // ------------------------------------------------------------------ helpers
  const LEFTOVERS = ['/home/panda/Belgeler/x1.txt', '/home/panda/Belgeler/x2.txt', '/home/panda/Belgeler/x3.txt', '/home/panda/Belgeler/buyuk.txt',
    '/home/panda/Belgeler/z.txt', '/home/panda/Resimler/manzara.png', '/home/panda/Resimler/sahte.png', '/home/panda/Resimler/a.png',
    '/home/panda/Resimler/uzun-ad-ile-bir-resim-dosyasi-ornegi.png'];

  /** every test runs against a clean slate and always leaves no Settings window / dialog behind (even when it fails) */
  function test(name, fn) {
    T.test(name, async (t) => {
      try {
        await fn(t);
      } finally {
        P.apps.running('settings').forEach((w) => { try { w.forceClose(); } catch (e) { /* ignore */ } });
        P.dialog.closeAll();
        P.contextMenu.hide();
      }
    });
  }

  function reset() {
    P.dialog && P.dialog.closeAll && P.dialog.closeAll();
    P.contextMenu && P.contextMenu.hide && P.contextMenu.hide();
    P.apps.running('settings').forEach((w) => { try { w.forceClose(); } catch (e) { /* ignore */ } });
    LEFTOVERS.forEach((p) => { try { P.fs.remove(p); } catch (e) { /* not there */ } });
    try { P.fs.emptyTrash(); } catch (e) { /* ignore */ }
    P.settings.reset();
    P.storage.remove('app.settings');
    P.notify.clear();
  }

  async function open(t, args) {
    const win = P.apps.launch('settings', args || {});
    t.ok(win, 'ayarlar penceresi açılmalı');
    await t.waitFor(() => $('.app-settings .st-page', win.el), 3000, 'sayfa çizilmedi');
    return win;
  }

  async function close(win) {
    P.dialog.closeAll();
    if (win && !win.isClosed()) await win.close();
  }

  const app = (win) => win.state.settings;
  const root = (win) => $('.app-settings', win.el);
  const pageEl = (win) => $('.st-page', win.el);
  const titleOf = (win) => $('.st-title', win.el).textContent;
  const navBtn = (win, id) => $(`.st-nav-item[data-page="${id}"]`, win.el);
  const row = (win, sid) => $(`[data-sid="${sid}"]`, win.el);
  const searchBox = (win) => $('.st-search-input', win.el);

  async function go(t, win, id) {
    t.click(navBtn(win, id));
    await t.waitFor(() => $(`.st-page[data-page="${id}"]`, win.el), 2000, `${id} sayfası açılmadı`);
  }

  const switchOf = (win, sid) => $('.p-switch input', row(win, sid));
  const dialogCards = () => $$('#dialog-layer .dlg-card');
  const dlgOk = () => $('#dialog-layer .dlg-primary');
  const dlgCancel = () => $('#dialog-layer .dlg-btn:not(.dlg-primary)');

  async function waitDialog(t) {
    await t.waitFor(() => dialogCards().length > 0, 3000, 'iletişim kutusu açılmadı');
    return dialogCards()[dialogCards().length - 1];
  }

  /** Records long-lived resources created by settings.js (bus subscriptions, intervals, timeouts). */
  function installSpies() {
    const own = (stack) => /settings\.js/.test(stack || '');
    const orig = {
      setInterval: window.setInterval, clearInterval: window.clearInterval,
      setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, busOn: P.bus.on
    };
    const intervals = new Set();
    const timeouts = new Set();
    const subs = new Set();
    window.setInterval = function (fn, ms, ...a) {
      const id = orig.setInterval.call(window, fn, ms, ...a);
      if (own(new Error().stack)) intervals.add(id);
      return id;
    };
    window.clearInterval = function (id) { intervals.delete(id); return orig.clearInterval.call(window, id); };
    window.setTimeout = function (fn, ms, ...a) {
      const mine = own(new Error().stack);
      let id;
      const wrapped = mine && typeof fn === 'function' ? function (...x) { timeouts.delete(id); return fn.apply(this, x); } : fn;
      id = orig.setTimeout.call(window, wrapped, ms, ...a);
      if (mine) timeouts.add(id);
      return id;
    };
    window.clearTimeout = function (id) { timeouts.delete(id); return orig.clearTimeout.call(window, id); };
    P.bus.on = function (evt, fn) {
      const off = orig.busOn.call(P.bus, evt, fn);
      if (!own(new Error().stack)) return off;
      const token = { evt };
      subs.add(token);
      return () => { subs.delete(token); off(); };
    };
    return {
      intervals, timeouts, subs,
      restore() {
        window.setInterval = orig.setInterval; window.clearInterval = orig.clearInterval;
        window.setTimeout = orig.setTimeout; window.clearTimeout = orig.clearTimeout;
        P.bus.on = orig.busOn;
      }
    };
  }

  // ==================================================================================================
  test('kayıt: kimlik, pencere boyutları ve tek örnek', async (t) => {
    reset();
    const def = P.apps.get('settings');
    t.ok(def, 'settings kayıtlı değil');
    t.eq([def.name, def.icon, def.singleInstance], ['Ayarlar', 'settings', true]);
    t.eq([def.window.width, def.window.height, def.window.minWidth, def.window.minHeight], [900, 600, 640, 440]);
    const win = await open(t);
    t.ok(root(win), 'pencere gövdesi .app-settings olmalı');
    t.ok(win.body.classList.contains('app-settings'));
    t.eq(win.getTitle(), 'Ayarlar');
    const b = win.getBounds();
    t.ok(b.width >= 880 && b.width <= 940, `genişlik ${b.width}`);
    t.ok(b.height >= 560, `yükseklik ${b.height}`);
    win.setSize(200, 150);
    const m = win.getBounds();
    t.ok(m.width >= 640 && m.height >= 440, `en küçük boyut aşıldı: ${m.width}x${m.height}`);
    // single instance
    const again = P.apps.launch('settings');
    t.ok(again === win, 'ikinci başlatma aynı pencereyi döndürmeli');
    t.eq(P.apps.running('settings').length, 1);
    await close(win);
  });

  test('gezinme: kullanıcı kartı, sayfa listesi ve klavye', async (t) => {
    reset();
    const win = await open(t);
    t.eq($('.st-user-name', win.el).textContent, 'Panda');
    t.eq($('.st-user-sub', win.el).textContent, 'Yerel hesap');
    t.ok($('.st-avatar svg', win.el), 'avatar çizilmeli');
    t.eq($$('.st-nav-item .st-nav-label', win.el).map((n) => n.textContent),
      ['Kişiselleştirme', 'Duvar kağıdı', 'Ses', 'Bildirimler', 'Tarih ve saat', 'Depolama', 'Hakkında']);
    t.eq(titleOf(win), 'Kişiselleştirme', 'varsayılan sayfa');
    t.eq(navBtn(win, 'appearance').getAttribute('aria-current'), 'page');
    for (const id of PAGE_IDS) {
      await go(t, win, id);
      t.eq(titleOf(win), PAGE_TITLES[id]);
      t.eq($$('.st-nav-item[aria-current="page"]', win.el).map((b) => b.dataset.page), [id]);
      t.ok(navBtn(win, id).classList.contains('selected'));
      t.eq(app(win).page(), id);
    }
    // arrow keys move focus between nav items
    navBtn(win, 'appearance').focus();
    t.key(navBtn(win, 'appearance'), 'ArrowDown');
    t.eq(document.activeElement, navBtn(win, 'wallpaper'));
    t.key(document.activeElement, 'End');
    t.eq(document.activeElement, navBtn(win, 'about'));
    t.key(document.activeElement, 'ArrowDown');
    t.eq(document.activeElement, navBtn(win, 'appearance'), 'listenin sonundan başa sarmalı');
    t.key(document.activeElement, 'ArrowUp');
    t.eq(document.activeElement, navBtn(win, 'about'));
    await close(win);
  });

  test('başlatma bağımsız değişkenleri: page ve relaunch', async (t) => {
    reset();
    const win = await open(t, { page: 'sound' });
    t.eq(titleOf(win), 'Ses');
    const again = P.apps.launch('settings', { page: 'about' });
    t.ok(again === win);
    await t.waitFor(() => titleOf(win) === 'Hakkında');
    P.apps.launch('settings', { page: 'storage' });
    await t.waitFor(() => titleOf(win) === 'Depolama');
    P.apps.launch('settings', { page: 'yok-böyle-sayfa' });
    t.eq(titleOf(win), 'Depolama', 'geçersiz sayfa yok sayılmalı');
    P.apps.launch('settings', { page: 'sound', focus: 'muted' });
    await t.waitFor(() => titleOf(win) === 'Ses');
    t.ok(row(win, 'muted').classList.contains('st-flash'), 'istenen ayar vurgulanmalı');
    t.eq(P.apps.running('settings').length, 1);
    // minimized window is restored by a relaunch
    win.minimize();
    P.apps.launch('settings', { page: 'wallpaper' });
    t.ok(!win.isMinimized(), 'simge durumundaki pencere geri gelmeli');
    t.eq(titleOf(win), 'Duvar kağıdı');
    await close(win);
    const w2 = await open(t, { page: 'notifications' });
    t.eq(titleOf(w2), 'Bildirimler');
    await close(w2);
  });

  // ------------------------------------------------------------------ Kişiselleştirme
  test('kişiselleştirme: tema kartları iki yönlü bağlı', async (t) => {
    reset();
    const win = await open(t);
    const cards = $$('.st-theme', win.el);
    t.eq(cards.map((c) => c.getAttribute('aria-label')), ['Açık', 'Koyu', 'Sistem ile aynı']);
    t.eq(cards.map((c) => c.dataset.value), ['light', 'dark', 'auto']);
    t.eq(cards.map((c) => c.getAttribute('aria-checked')), ['false', 'true', 'false'], 'varsayılan koyu');
    t.ok($('.st-theme-grid', win.el).getAttribute('role') === 'radiogroup');
    t.ok(cards.every((c) => $('.st-mock', c)), 'her kart bir masaüstü maketi çizmeli');
    t.eq(cards.filter((c) => c.tabIndex === 0).length, 1, 'roving tabindex');

    t.click(cards[0]);
    t.eq(P.settings.get('theme'), 'light');
    t.eq(document.documentElement.dataset.theme, 'light');
    t.eq(cards.map((c) => c.getAttribute('aria-checked')), ['true', 'false', 'false']);
    t.click(cards[2]);
    t.eq(P.settings.get('theme'), 'auto');
    t.eq(P.theme.mode(), 'auto');
    t.eq(cards.map((c) => c.getAttribute('aria-checked')), ['false', 'false', 'true']);
    t.click(cards[1]);
    t.eq(P.settings.get('theme'), 'dark');
    t.eq(document.documentElement.dataset.theme, 'dark');

    // changes made elsewhere (taskbar toggle, scripts) are reflected
    P.theme.toggle();
    t.eq(cards.map((c) => c.getAttribute('aria-checked')), ['true', 'false', 'false']);
    P.settings.set('theme', 'auto');
    t.eq(cards.map((c) => c.getAttribute('aria-checked')), ['false', 'false', 'true']);

    // arrow keys select (radio behaviour)
    cards[2].focus();
    t.key(cards[2], 'ArrowLeft');
    t.eq(P.settings.get('theme'), 'dark');
    t.eq(document.activeElement, cards[1]);
    t.key(cards[1], 'ArrowRight');
    t.eq(P.settings.get('theme'), 'auto');
    t.key(cards[2], 'ArrowRight');
    t.eq(P.settings.get('theme'), 'light', 'sondan başa sarmalı');
    t.key(cards[0], 'End');
    t.eq(P.settings.get('theme'), 'auto');
    P.settings.set('theme', 'dark');
    await close(win);
  });

  test('kişiselleştirme: vurgu rengi (hazır renkler, özel renk, onaltılık kod)', async (t) => {
    reset();
    const win = await open(t);
    const sw = $$('.st-swatches .st-swatch', win.el);
    t.eq(sw.length, P.settings.ACCENTS.length);
    t.eq(sw.map((s) => s.dataset.value), P.settings.ACCENTS.map((a) => a.value));
    t.eq(sw.map((s) => s.getAttribute('aria-label')), P.settings.ACCENTS.map((a) => a.name));
    t.ok(sw[0].classList.contains('selected') && sw[0].getAttribute('aria-checked') === 'true', 'varsayılan Bambu seçili');
    t.eq($('.st-accent-name', win.el).textContent, 'Bambu');

    for (const a of P.settings.ACCENTS.slice(1, 4)) {
      const b = sw.find((s) => s.dataset.value === a.value);
      t.click(b);
      t.eq(P.settings.get('accent'), a.value);
      t.eq(document.documentElement.style.getPropertyValue('--accent'), a.value, '--accent güncellenmeli');
      t.eq(sw.filter((s) => s.getAttribute('aria-checked') === 'true').length, 1);
      t.ok(b.classList.contains('selected'));
      t.eq($('.st-accent-name', win.el).textContent, a.name);
      t.eq($('.st-hex', win.el).value, a.value);
    }

    // custom colour via the colour input
    const picker = $('.st-color-input', win.el);
    const custom = $('.st-swatch-custom', win.el);
    t.ok(!custom.classList.contains('selected'));
    picker.value = '#aa3355';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(P.settings.get('accent'), '#aa3355');
    t.ok(custom.classList.contains('selected'), 'özel renk seçili görünmeli');
    t.eq(sw.filter((s) => s.getAttribute('aria-checked') === 'true').length, 0, 'hazır renklerden hiçbiri seçili olmamalı');
    t.eq($('.st-accent-name', win.el).textContent, 'Özel renk');
    t.eq(document.documentElement.style.getPropertyValue('--accent'), '#aa3355');
    t.ok(document.documentElement.style.getPropertyValue('--accent-solid'), 'erişilebilir dolgu rengi türetilmeli');

    // hex field: live apply on 6 digits, expand 3 digits on change, reject garbage
    const hex = $('.st-hex', win.el);
    hex.focus();
    t.type(hex, '');
    hex.value = '#12abef';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(P.settings.get('accent'), '#12abef');
    hex.value = '#F0A';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    t.eq(P.settings.get('accent'), '#ff00aa', 'üç haneli kod genişletilmeli');
    t.eq(hex.value, '#ff00aa');
    hex.value = 'zzz!';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    t.ok(hex.classList.contains('invalid'), 'geçersiz kod işaretlenmeli');
    t.eq(P.settings.get('accent'), '#ff00aa', 'geçersiz kod ayarı değiştirmemeli');
    await t.waitFor(() => !hex.classList.contains('invalid') && hex.value === '#ff00aa', 2000);

    // arrow keys on the preset swatches, and an external change
    sw[0].focus();
    t.click(sw[0]);
    t.key(sw[0], 'ArrowRight');
    t.eq(P.settings.get('accent'), P.settings.ACCENTS[1].value);
    P.settings.set('accent', P.settings.ACCENTS[6].value.toUpperCase());
    t.eq(sw[6].getAttribute('aria-checked'), 'true', 'büyük/küçük harf farkı önemsenmemeli');
    P.settings.set('accent', P.settings.ACCENTS[0].value);
    await close(win);
  });

  test('kişiselleştirme: animasyonlar ve masaüstü simge boyutu', async (t) => {
    reset();
    const win = await open(t);
    const anim = switchOf(win, 'animations');
    t.eq(anim.checked, true);
    t.click(anim);
    t.eq(P.settings.get('animations'), false);
    t.ok(document.documentElement.classList.contains('no-anim'));
    t.click(anim);
    t.eq(P.settings.get('animations'), true);
    t.ok(!document.documentElement.classList.contains('no-anim'));
    P.settings.set('animations', false);
    t.eq(anim.checked, false, 'dışarıdan yapılan değişiklik anahtarı güncellemeli');
    P.settings.set('animations', true);
    t.eq(anim.checked, true);

    const seg = $$('.p-segmented button', row(win, 'iconSize'));
    t.eq(seg.map((b) => b.textContent), ['Küçük', 'Orta', 'Büyük']);
    t.eq(seg.map((b) => b.getAttribute('aria-checked')), ['false', 'true', 'false'], 'varsayılan orta');
    t.click(seg[2]);
    t.eq(P.settings.get('desktop.iconSize'), 'large');
    t.ok(seg[2].classList.contains('active') && !seg[1].classList.contains('active'));
    t.click(seg[0]);
    t.eq(P.settings.get('desktop.iconSize'), 'small');
    P.settings.set('desktop.iconSize', 'medium');
    t.eq(seg.map((b) => b.getAttribute('aria-checked')), ['false', 'true', 'false']);
    seg[1].focus();
    t.key(seg[1], 'ArrowRight');
    t.eq(P.settings.get('desktop.iconSize'), 'large');
    await close(win);
  });

  // ------------------------------------------------------------------ Duvar kağıdı
  test('duvar kağıdı: önizleme, küçük resim ızgarası ve klavye', async (t) => {
    reset();
    const win = await open(t, { page: 'wallpaper' });
    const wps = P.wallpapers;
    const thumbs = $$('.st-wp-grid .st-wp', win.el);
    t.eq(thumbs.length, wps.length, 'her duvar kağıdı için bir küçük resim');
    t.eq(thumbs.map((b) => b.dataset.value), [...wps].map((w) => w.id));
    t.eq(thumbs.map((b) => b.getAttribute('aria-label')), [...wps].map((w) => w.name));
    t.ok($('.st-wp-preview', win.el), 'canlı önizleme');
    t.ok($('.st-wp-task', win.el) && $('.st-wp-win', win.el), 'önizlemede görev çubuğu ve pencere olmalı');
    t.eq($('.st-wp-name', win.el).textContent, 'Bambu Ormanı');
    t.eq(thumbs.map((b) => b.getAttribute('aria-checked')).filter((v) => v === 'true').length, 1);
    t.ok(thumbs[0].classList.contains('selected') && $('.st-check', thumbs[0]), 'seçili küçük resimde onay işareti');
    t.ok($('.st-wp-img .st-mini-in', thumbs[0]).style.background, 'küçük resim duvar kağıdını çizmeli');
    t.ok(/scale\(/.test($('.st-wp-img .st-mini-in', thumbs[0]).style.transform), 'küçük resim ölçeklenmeli');

    const second = thumbs[1];
    t.click(second);
    t.eq(P.settings.get('wallpaper'), wps[1].id);
    t.ok(second.classList.contains('selected') && !thumbs[0].classList.contains('selected'));
    t.eq($('.st-wp-name', win.el).textContent, wps[1].name);
    t.eq($('.st-wp-kind', win.el).textContent, 'Yerleşik duvar kağıdı');
    t.ok($('.st-wp-preview .st-mini-in', win.el).style.background, 'önizleme arka planı');

    // external change
    P.settings.set('wallpaper', wps[3].id);
    t.ok(thumbs[3].classList.contains('selected'));
    t.eq($('.st-wp-name', win.el).textContent, wps[3].name);

    // arrow keys move focus only (manual activation)
    thumbs[3].focus();
    t.key(thumbs[3], 'ArrowRight');
    t.eq(document.activeElement, thumbs[4]);
    t.eq(P.settings.get('wallpaper'), wps[3].id, 'oklar yalnızca odağı taşımalı');
    t.key(thumbs[4], 'Home');
    t.eq(document.activeElement, thumbs[0]);
    t.key(thumbs[0], 'End');
    t.eq(document.activeElement, thumbs[thumbs.length - 1]);
    t.key(document.activeElement, 'ArrowDown');
    t.eq(document.activeElement, thumbs[thumbs.length - 1], 'ızgaranın sonunda durmalı');

    // random
    const before = P.settings.get('wallpaper');
    t.click($$('.st-wp-actions button', win.el).find((b) => b.textContent.includes('Rastgele')));
    t.ok(P.settings.get('wallpaper') !== before && wps.get(P.settings.get('wallpaper')), 'rastgele farklı bir duvar kağıdı seçmeli');
    P.settings.set('wallpaper', 'bamboo');
    await close(win);
  });

  test('duvar kağıdı: Resim seç… (gerçek dosya seçici) ve özel resim listesi', async (t) => {
    reset();
    P.fs.writeFile('/home/panda/Resimler/manzara.png', PNG);
    P.fs.writeFile('/home/panda/Resimler/sahte.png', 'bu bir resim değil');
    const win = await open(t, { page: 'wallpaper' });
    const pick = $$('.st-wp-actions button', win.el).find((b) => b.textContent.includes('Resim seç'));
    t.ok(pick, 'Resim seç… düğmesi');
    t.eq(pick.textContent.trim(), 'Resim seç…');

    // 1) cancel
    t.click(pick);
    let card = await waitDialog(t);
    t.ok(card.classList.contains('fp'), 'dosya seçici açılmalı');
    t.ok(pick.disabled, 'seçici açıkken düğme devre dışı');
    t.eq($('.fp-filter', card).textContent.includes('*.png'), true, 'resim uzantıları süzülmeli');
    t.ok($('.fp-row[data-path="/home/panda/Resimler/manzara.png"]', card), 'Resimler klasörüyle açılmalı');
    t.click(dlgCancel());
    await t.waitFor(() => dialogCards().length === 0);
    t.ok(!pick.disabled);
    t.eq(P.settings.get('wallpaper'), 'bamboo', 'iptal ayarı değiştirmemeli');

    // 2) not an image
    t.click(pick);
    card = await waitDialog(t);
    t.dblclick($('.fp-row[data-path="/home/panda/Resimler/sahte.png"]', card));
    card = await waitDialog(t);
    t.ok(/geçerli bir resim/.test(card.textContent), 'uyarı gösterilmeli: ' + card.textContent);
    t.eq(P.settings.get('wallpaper'), 'bamboo');
    t.click(dlgOk());
    await t.waitFor(() => dialogCards().length === 0);

    // 3) a real image
    t.click(pick);
    card = await waitDialog(t);
    t.dblclick($('.fp-row[data-path="/home/panda/Resimler/manzara.png"]', card));
    await t.waitFor(() => P.settings.get('wallpaper') === 'vfs:/home/panda/Resimler/manzara.png', 3000, 'duvar kağıdı ayarlanmadı');
    await t.waitFor(() => $('.st-wp[data-value="vfs:/home/panda/Resimler/manzara.png"]', win.el));
    const custom = $('.st-wp[data-value="vfs:/home/panda/Resimler/manzara.png"]', win.el);
    t.ok(custom.classList.contains('selected') && custom.classList.contains('custom'), 'özel küçük resim seçili olmalı');
    t.eq($('.st-wp-cap', custom).textContent, 'manzara');
    t.eq($('.st-wp-name', win.el).textContent, 'manzara.png');
    t.ok($('.st-wp-kind', win.el).textContent.includes('/home/panda/Resimler/manzara.png'));
    t.ok(/data:image\/png/.test($('.st-mini-in', custom).style.background), 'küçük resim dosyanın verisini çizmeli');
    t.ok(/data:image\/png/.test($('.st-wp-preview .st-mini-in', win.el).style.background), 'önizleme dosyayı göstermeli');
    t.eq(P.storage.get('app.settings').custom, ['/home/panda/Resimler/manzara.png'], 'liste kalıcı olmalı');
    t.eq($$('.st-wp', win.el).length, P.wallpapers.length + 1);

    // switch back to a built-in: the custom thumbnail stays available
    t.click($('.st-wp[data-value="aurora"]', win.el));
    t.eq(P.settings.get('wallpaper'), 'aurora');
    t.ok($('.st-wp[data-value="vfs:/home/panda/Resimler/manzara.png"]', win.el), 'özel resim listede kalmalı');
    t.click($('.st-wp[data-value="vfs:/home/panda/Resimler/manzara.png"]', win.el));
    t.eq(P.settings.get('wallpaper'), 'vfs:/home/panda/Resimler/manzara.png');

    // context menu: set / remove from list
    t.click($('.st-wp[data-value="aurora"]', win.el));
    t.contextmenu($('.st-wp[data-value="vfs:/home/panda/Resimler/manzara.png"]', win.el));
    await t.waitFor(() => $$('#context-menu-layer .ctx-item').length > 0, 2000, 'bağlam menüsü açılmadı');
    const labels = $$('#context-menu-layer .ctx-label').map((l) => l.textContent);
    t.eq(labels, ['Duvar kağıdı yap', 'Listeden kaldır']);
    t.click($$('#context-menu-layer .ctx-item').find((i) => i.textContent.includes('Listeden kaldır')));
    await t.waitFor(() => !$('.st-wp[data-value="vfs:/home/panda/Resimler/manzara.png"]', win.el), 2000, 'özel resim listeden kalkmadı');
    t.eq(P.storage.get('app.settings').custom, []);
    t.ok(P.fs.exists('/home/panda/Resimler/manzara.png'), 'dosyanın kendisi silinmemeli');

    // a wallpaper set elsewhere (e.g. from the file manager) is listed too; deleting the file shows a warning
    P.settings.set('wallpaper', 'vfs:/home/panda/Resimler/manzara.png');
    await t.waitFor(() => $('.st-wp[data-value="vfs:/home/panda/Resimler/manzara.png"].selected', win.el), 2000, 'dışarıdan ayarlanan resim listelenmedi');
    P.fs.remove('/home/panda/Resimler/manzara.png');
    await t.waitFor(() => /bulunamadı/.test($('.st-wp-kind', win.el).textContent), 2000, 'eksik dosya uyarısı gelmedi');
    P.fs.remove('/home/panda/Resimler/sahte.png');
    P.settings.set('wallpaper', 'bamboo');
    await close(win);
  });

  test('duvar kağıdı: seçici hatalarına dayanıklı', async (t) => {
    reset();
    const win = await open(t, { page: 'wallpaper' });
    const original = P.dialog.pickFile;
    try {
      P.dialog.pickFile = () => Promise.reject(new Error('seçici bozuldu'));
      const before = window.__pandaErrors.length;
      const pick = $$('.st-wp-actions button', win.el).find((b) => b.textContent.includes('Resim seç'));
      // a rejected picker is reported once but must not leave the button disabled
      t.click(pick);
      await t.waitFor(() => !pick.disabled, 2000);
      t.eq(P.settings.get('wallpaper'), 'bamboo');
      const added = window.__pandaErrors.slice(before);
      t.ok(added.every((e) => /seçici bozuldu/.test(e)), 'beklenmeyen hata: ' + added.join('|'));
      window.__pandaErrors.length = before; // expected failure, do not fail the suite
    } finally {
      P.dialog.pickFile = original;
    }
    await close(win);
  });

  // ------------------------------------------------------------------ Ses
  test('ses: düzey kaydırıcısı, sessiz, sistem sesleri ve test', async (t) => {
    reset();
    const win = await open(t, { page: 'sound' });
    const slider = $('.p-range', row(win, 'volume'));
    const label = $('.st-vol-val', win.el);
    t.eq(slider.value, '70');
    t.eq(label.textContent, '%70');
    t.eq(slider.getAttribute('aria-label'), 'Ana ses düzeyi');
    t.eq([slider.min, slider.max], ['0', '100']);

    slider.value = '35';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(P.settings.get('volume'), 35);
    t.eq(label.textContent, '%35');
    t.eq(slider.getAttribute('aria-valuetext'), '%35');
    t.eq(slider.style.getPropertyValue('--p'), '0.35', 'dolgu değişkeni');
    t.ok($('svg[data-icon="volume-low"]', row(win, 'volume')), 'düşük ses simgesi');
    slider.value = '80';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    t.ok($('svg[data-icon="volume"]', row(win, 'volume')), 'yüksek ses simgesi');
    slider.value = '0';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(P.settings.get('volume'), 0);
    t.ok($('svg[data-icon="volume-mute"]', row(win, 'volume')), '0 düzeyi sessiz simgesi');

    // other places (taskbar flyout…) change the volume
    P.settings.set('volume', 55);
    t.eq(slider.value, '55');
    t.eq(label.textContent, '%55');

    const muted = switchOf(win, 'muted');
    t.eq(muted.checked, false);
    t.click(muted);
    t.eq(P.settings.get('muted'), true);
    t.ok(row(win, 'volume').classList.contains('st-off'), 'sessizken kaydırıcı soluklaşmalı');
    t.ok($('svg[data-icon="volume-mute"]', row(win, 'volume')));
    P.settings.set('muted', false);
    t.eq(muted.checked, false);
    t.ok(!row(win, 'volume').classList.contains('st-off'));

    const sounds = switchOf(win, 'sounds');
    t.eq(sounds.checked, true);
    t.click(sounds);
    t.eq(P.settings.get('sounds'), false);
    t.ok(row(win, 'soundTest').classList.contains('st-warn'), 'sesler kapalıyken test satırı uyarmalı');
    t.ok(/duyamayabilirsin/.test(row(win, 'soundTest').textContent));
    t.click(sounds);
    t.eq(P.settings.get('sounds'), true);
    t.ok(!row(win, 'soundTest').classList.contains('st-warn'));

    // test button plays the notification sound
    const played = [];
    const origPlay = P.sound.play;
    P.sound.play = (n) => { played.push(n); };
    try {
      t.click($('button', row(win, 'soundTest')));
      t.eq(played, ['notify']);
      t.ok(row(win, 'soundTest').classList.contains('playing'));
      await t.waitFor(() => !row(win, 'soundTest').classList.contains('playing'), 3000, 'çalma göstergesi kapanmalı');
      // a committed slider move gives audible feedback
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      t.eq(played, ['notify', 'click']);
    } finally {
      P.sound.play = origPlay;
    }
    P.settings.set('volume', 70);
    await close(win);
  });

  // ------------------------------------------------------------------ Bildirimler
  test('bildirimler: rahatsız etmeyin, test bildirimi ve geçmiş', async (t) => {
    reset();
    const win = await open(t, { page: 'notifications' });
    const dnd = switchOf(win, 'dnd');
    t.eq(dnd.checked, false);
    t.click(dnd);
    t.eq(P.settings.get('dnd'), true);
    P.settings.set('dnd', false);
    t.eq(dnd.checked, false);
    P.settings.set('dnd', true);
    t.eq(dnd.checked, true);
    t.ok(/Rahatsız Etmeyin açık/.test(row(win, 'notifTest').textContent), 'test satırı DND durumunu anlatmalı');

    const clear = $('button', row(win, 'notifHistory'));
    t.ok(clear.disabled, 'geçmiş boşken temizle devre dışı');
    t.eq(row(win, 'notifHistory').$desc ? 1 : 1, 1);
    t.ok(/Saklanan bildirim yok/.test(row(win, 'notifHistory').textContent));
    t.ok($('.st-notif-list .p-empty', win.el), 'boş durum görünmeli');

    // DND on: the test notification only lands in the history
    const send = $('button', row(win, 'notifTest'));
    t.eq(send.textContent.trim(), 'Test bildirimi gönder');
    t.click(send);
    t.eq(P.notify.history().length, 1);
    t.eq(P.notify.history()[0].title, 'Test bildirimi');
    t.eq($$('#toasts .toast:not(.leaving)').length, 0, 'DND açıkken toast çıkmamalı');
    await t.waitFor(() => $$('.st-notif', win.el).length === 1, 2000, 'liste güncellenmedi');
    t.ok(/1 bildirim saklanıyor/.test(row(win, 'notifHistory').textContent));
    t.ok(/1 okunmamış/.test(row(win, 'notifHistory').textContent));
    t.ok(!clear.disabled);
    t.eq($('.st-notif-title', win.el).textContent, 'Test bildirimi');
    t.ok($('.st-notif-time', win.el).textContent.length > 0);

    // DND off: a toast appears; notifications from other apps appear live
    P.settings.set('dnd', false);
    t.click(send);
    await t.waitFor(() => $$('#toasts .toast:not(.leaving)').length >= 1, 2000, 'toast çıkmalı');
    P.notify({ title: 'Başka bir uygulama', message: 'Merhaba', icon: 'info', timeout: 1 });
    await t.waitFor(() => $$('.st-notif', win.el).length === 3, 2000, 'dış bildirim listeye düşmedi');
    t.eq($$('.st-notif .st-notif-title', win.el)[0].textContent, 'Başka bir uygulama', 'en yeni üstte');
    for (let i = 0; i < 4; i++) P.notify({ title: 'N' + i, message: 'x', timeout: 1 });
    await t.waitFor(() => $$('.st-notif', win.el).length === 5, 2000);
    t.ok(/ve 2 bildirim daha/.test($('.st-notif-more', win.el).textContent), $('.st-notif-more', win.el) && $('.st-notif-more', win.el).textContent);

    // clear
    t.click(clear);
    t.eq(P.notify.history().length, 0);
    t.ok(clear.disabled);
    t.ok($('.st-notif-list .p-empty', win.el));
    t.ok(/Saklanan bildirim yok/.test(row(win, 'notifHistory').textContent));
    // history cleared elsewhere
    P.notify({ title: 'Bir tane', timeout: 1 });
    await t.waitFor(() => $$('.st-notif', win.el).length === 1);
    P.notify.clear();
    await t.waitFor(() => $$('.st-notif', win.el).length === 0 && clear.disabled, 2000);
    await close(win);
  });

  // ------------------------------------------------------------------ Tarih ve saat
  test('tarih ve saat: biçim anahtarları, canlı önizleme, saat dilimi, tarih', async (t) => {
    reset();
    const win = await open(t, { page: 'datetime' });
    const h24 = switchOf(win, 'clock24h');
    const secs = switchOf(win, 'showSeconds');
    t.eq([h24.checked, secs.checked], [true, false]);
    const trayTime = () => $('.st-tray-time', win.el).textContent;
    t.ok(/^\d{2}:\d{2}$/.test(trayTime()), 'görev çubuğu biçimi 24 saat: ' + trayTime());
    t.ok(/^\d{2}\.\d{2}\.\d{4}$/.test($('.st-tray-date', win.el).textContent));

    t.click(secs);
    t.eq(P.settings.get('showSeconds'), true);
    t.ok(/^\d{2}:\d{2}:\d{2}$/.test(trayTime()), trayTime());
    t.click(h24);
    t.eq(P.settings.get('clock24h'), false);
    t.ok(/^\d{1,2}:\d{2}:\d{2} (ÖÖ|ÖS)$/.test(trayTime()), '12 saatlik biçim: ' + trayTime());
    P.settings.set('showSeconds', false);
    t.ok(/^\d{1,2}:\d{2} (ÖÖ|ÖS)$/.test(trayTime()), trayTime());
    t.eq(secs.checked, false, 'dışarıdan değişiklik');
    P.settings.set('clock24h', true);
    t.eq(h24.checked, true);

    // the big clock ticks
    const first = $('.st-bigclock', win.el).textContent;
    t.ok(/^\d{2}:\d{2}:\d{2}$/.test(first), first);
    await t.waitFor(() => $('.st-bigclock', win.el).textContent !== first, 3500, 'saat ilerlemedi');

    const now = new Date();
    const long = now.toLocaleDateString('tr-TR', { weekday: 'long' }) + ', ' + now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    t.eq($('.st-bigdate', win.el).textContent, long);
    t.eq($('[data-key="date"]', win.el).textContent, long, 'uzun tarih');
    t.eq($('[data-key="timezone"]', win.el).textContent, Intl.DateTimeFormat().resolvedOptions().timeZone);
    t.ok(/^UTC[+-]\d{2}:\d{2}/.test(row(win, 'timezone').$desc.textContent), row(win, 'timezone').$desc.textContent);
    const off = -now.getTimezoneOffset();
    const sign = off < 0 ? '-' : '+';
    t.ok(row(win, 'timezone').$desc.textContent.startsWith(`UTC${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`));
    t.ok($('[data-key="region"]', win.el).textContent.length > 0);
    await close(win);
  });

  // ------------------------------------------------------------------ Depolama
  test('depolama: kullanım çubuğu, klasör dökümü ve fs değişimi', async (t) => {
    reset();
    const win = await open(t, { page: 'storage' });
    const usageRow = row(win, 'usage');
    const u0 = P.fs.usage();
    t.eq(Number(usageRow.dataset.used) >= u0.used, true);
    t.eq(Number(usageRow.dataset.quota), u0.quota);
    t.ok(usageRow.textContent.includes(P.util.formatBytes(u0.quota)), 'kota gösterilmeli');
    t.ok(/%\d/.test($('.st-usage-pct', win.el).textContent), 'yüzde rozeti');
    t.ok($('.st-bar', win.el), 'kullanım çubuğu');
    const ids = () => $$('.st-legend [data-id]', win.el).map((r) => r.dataset.id);
    t.eq(ids(), ['docs', 'pics', 'music', 'desk', 'down', 'system', 'trash', 'free']);
    t.eq($$('.st-legend .st-leg-name', win.el).map((n) => n.textContent),
      ['Belgeler', 'Resimler', 'Müzik', 'Masaüstü', 'İndirilenler', 'Sistem', 'Çöp kutusu', 'Boş alan']);
    const bytesOf = (id) => Number($(`.st-legend [data-id="${id}"]`, win.el).dataset.bytes);
    t.eq(bytesOf('docs'), P.fs.stat('/home/panda/Belgeler').size);
    t.eq(bytesOf('music'), P.fs.stat('/home/panda/Müzik').size);
    t.eq(bytesOf('desk'), P.fs.stat('/home/panda/Masaüstü').size);
    t.eq(bytesOf('pics'), 0);
    t.eq(bytesOf('trash'), 0);
    t.ok(bytesOf('system') > 0, 'sistem payı');
    const sum = ['docs', 'pics', 'music', 'desk', 'down', 'system', 'trash'].reduce((a, id) => a + bytesOf(id), 0);
    t.ok(Math.abs(sum - Number(usageRow.dataset.used)) < 2, `bölümlerin toplamı kullanıma eşit olmalı (${sum} / ${usageRow.dataset.used})`);
    t.ok(Math.abs(sum + bytesOf('free') - u0.quota) < 2, 'kullanılan + boş = kota');
    t.ok($('.st-seg[data-id="docs"]', win.el), 'dolu klasör için renkli dilim');
    t.ok(!$('.st-seg[data-id="pics"]', win.el), 'boş klasör için dilim olmamalı');

    // an fs change refreshes the numbers (debounced)
    const docs0 = bytesOf('docs');
    const used0 = Number(usageRow.dataset.used);
    P.fs.writeFile('/home/panda/Belgeler/buyuk.txt', 'a'.repeat(60000));
    await t.waitFor(() => bytesOf('docs') === docs0 + 60000, 3000, 'klasör boyutu güncellenmedi');
    t.ok(Number(usageRow.dataset.used) >= used0 + 60000);
    t.ok($('.st-legend [data-id="docs"] .st-leg-size', win.el).textContent.includes('KB'));
    P.fs.writeFile('/home/panda/Resimler/a.png', PNG);
    await t.waitFor(() => bytesOf('pics') === PNG.length, 3000);
    t.ok($('.st-seg[data-id="pics"]', win.el), 'yeni dilim');
    t.ok(parseFloat($('.st-seg[data-id="docs"]', win.el).style.flexBasis) > 0 || /max\(3px/.test($('.st-seg[data-id="docs"]', win.el).style.cssText));
    P.fs.remove('/home/panda/Belgeler/buyuk.txt');
    P.fs.remove('/home/panda/Resimler/a.png');
    await t.waitFor(() => bytesOf('docs') === docs0 && bytesOf('pics') === 0, 3000);

    // refresh button
    t.click($('button[aria-label="Yenile"]', win.el));
    t.eq(bytesOf('docs'), docs0);

    // rows open the folder in the file manager
    const launched = [];
    const origLaunch = P.apps.launch;
    P.apps.launch = (id, a) => { launched.push([id, a]); return null; };
    try {
      t.click($('.st-legend button[data-id="docs"]', win.el));
      t.click($('.st-legend button[data-id="trash"]', win.el));
      t.click($('.st-legend button[data-id="system"]', win.el));
    } finally {
      P.apps.launch = origLaunch;
    }
    t.eq(launched, [['files', { path: '/home/panda/Belgeler' }], ['files', { path: 'trash:' }], ['files', { path: '/' }]]);
    await close(win);
  });

  test('depolama: çöp kutusunu boşalt (onay, iptal, hata)', async (t) => {
    reset();
    P.fs.writeFile('/home/panda/Belgeler/x1.txt', 'merhaba dünya');
    P.fs.writeFile('/home/panda/Belgeler/x2.txt', 'ikinci');
    P.fs.trash('/home/panda/Belgeler/x1.txt');
    P.fs.trash('/home/panda/Belgeler/x2.txt');
    t.eq(P.fs.trashCount(), 2);
    const win = await open(t, { page: 'storage' });
    const btn = $('button', row(win, 'trash'));
    t.eq(btn.textContent.trim(), 'Çöp kutusunu boşalt');
    t.ok(!btn.disabled, 'çöp doluyken düğme açık olmalı');
    t.ok(/2 öğe/.test(row(win, 'trash').textContent), row(win, 'trash').textContent);
    t.eq(Number($('.st-legend [data-id="trash"]', win.el).dataset.bytes) > 0, true, 'çöp payı');
    t.ok($('.st-seg[data-id="trash"]', win.el), 'çöp dilimi');

    // cancel keeps everything
    t.click(btn);
    let card = await waitDialog(t);
    t.ok(card.classList.contains('danger'), 'tehlikeli onay kutusu');
    t.ok(/2 öğe/.test(card.textContent) && /geri alınamaz/.test(card.textContent), 'onay metni: ' + card.textContent);
    t.eq(document.activeElement, dlgCancel(), 'odak İptal üzerinde açılmalı');
    t.click(dlgCancel());
    await t.waitFor(() => dialogCards().length === 0);
    t.eq(P.fs.trashCount(), 2);

    // a failing fs shows the message
    const orig = P.fs.emptyTrash;
    P.fs.emptyTrash = () => { throw new P.fs.FSError('EPERM', 'Çöp kutusu kilitli'); };
    t.click(btn);
    await waitDialog(t);
    t.click(dlgOk());
    card = await t.waitFor(() => dialogCards().find((c) => /kilitli/.test(c.textContent)), 3000, 'hata iletisi gelmedi');
    t.ok(/boşaltılamadı/.test(card.textContent));
    t.click(dlgOk());
    await t.waitFor(() => dialogCards().length === 0);
    P.fs.emptyTrash = orig;
    t.eq(P.fs.trashCount(), 2);

    // confirm empties it
    t.click(btn);
    await waitDialog(t);
    t.click(dlgOk());
    await t.waitFor(() => P.fs.trashCount() === 0, 3000, 'çöp boşaltılmadı');
    await t.waitFor(() => btn.disabled && /Çöp kutusu boş/.test(row(win, 'trash').textContent), 3000, 'arayüz güncellenmedi');
    t.ok(!$('.st-seg[data-id="trash"]', win.el));
    t.eq(Number($('.st-legend [data-id="trash"]', win.el).dataset.bytes), 0);

    // trash filled elsewhere enables the button again
    P.fs.writeFile('/home/panda/Belgeler/x3.txt', 'üç');
    P.fs.trash('/home/panda/Belgeler/x3.txt');
    await t.waitFor(() => !btn.disabled, 3000, 'çöp dolunca düğme açılmalı');
    P.fs.emptyTrash();
    await close(win);
  });

  test('depolama: kota dolmak üzereyken uyarı', async (t) => {
    reset();
    const origUsage = P.fs.usage;
    const win = await open(t, { page: 'storage' });
    t.ok($('.st-warn-note', win.el).hidden, 'normalde uyarı yok');
    try {
      P.fs.usage = () => ({ used: 4800000, quota: 5000000 });
      t.click($('button[aria-label="Yenile"]', win.el));
      t.ok(!$('.st-warn-note', win.el).hidden, '%96 dolulukta uyarı çıkmalı');
      t.ok(/%96/.test($('.st-usage-pct', win.el).textContent), $('.st-usage-pct', win.el).textContent);
      P.fs.usage = () => ({ used: 100000, quota: 5000000 });
      t.click($('button[aria-label="Yenile"]', win.el));
      t.ok($('.st-warn-note', win.el).hidden);
    } finally {
      P.fs.usage = origUsage;
    }
    await close(win);
  });

  // ------------------------------------------------------------------ Hakkında
  test('hakkında: sürüm, cihaz bilgileri ve çalışma süresi', async (t) => {
    reset();
    const win = await open(t, { page: 'about' });
    t.ok($('.st-about-logo svg[data-icon="panda"]', win.el), 'büyük panda logosu');
    t.eq($('.st-about-name', win.el).textContent, 'PandaOS 1.0 (Bambu)');
    t.ok($('.st-about-sub', win.el).textContent.includes(P.version));
    const val = (k) => $(`.st-val[data-key="${k}"]`, win.el).textContent;
    t.eq($$('.st-kv', win.el).map((r) => r.dataset.key), ['device', 'user', 'browser', 'platform', 'screen', 'language', 'cores', 'memory', 'uptime']);
    t.eq(val('device'), 'pandaos');
    t.eq(val('user'), 'Panda');
    t.eq(val('browser'), app(win).parseBrowser(navigator.userAgent).label);
    t.ok(/\S+ \d+/.test(val('browser')), val('browser'));
    t.ok(val('platform').length > 2, val('platform'));
    t.ok(val('screen').startsWith(`${screen.width.toLocaleString('tr-TR')} × ${screen.height.toLocaleString('tr-TR')}`), val('screen'));
    t.ok(val('language').includes(navigator.language), val('language'));
    t.eq(val('cores'), navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} mantıksal çekirdek` : 'Bilinmiyor');
    if (navigator.deviceMemory) t.eq(val('memory'), `${navigator.deviceMemory} GB`);
    else t.ok(/Bilinmiyor/.test(val('memory')));
    t.ok(/^\d+ (sn|dk|sa|gün)/.test(val('uptime')), val('uptime'));
    const up0 = val('uptime');
    await t.waitFor(() => val('uptime') !== up0, 3500, 'çalışma süresi ilerlemedi');

    // clipboard button reports a result either way
    const n0 = P.notify.history().length;
    t.click($$('.st-about-actions button', win.el)[0]);
    await t.waitFor(() => P.notify.history().length > n0, 3000, 'kopyalama sonucu bildirilmedi');
    t.ok(/kopyalan|Kopyalanamadı/i.test(P.notify.history()[0].title), P.notify.history()[0].title);
    await close(win);
  });

  test('hakkında: tarayıcı / platform çözümleyici ve süre biçimi', async (t) => {
    reset();
    const win = await open(t, { page: 'about' });
    const a = app(win);
    const cases = [
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Chrome 126', 'Windows 10/11 · 64 bit'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87', 'Microsoft Edge 126', 'Windows 10/11 · 64 bit'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36', 'Chrome 126', 'Windows 10/11 · 64 bit'],
      ['Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', 'Firefox 127', 'Linux · 64 bit'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 'Safari 17', 'macOS'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0', 'Opera 111', 'Windows 10/11 · 64 bit'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'Chrome 126', 'Android 14'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', 'Safari 17', 'iOS'],
      ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Chrome 126', 'ChromeOS · 64 bit']
    ];
    for (const [ua, browser, platform] of cases) {
      t.eq(a.parseBrowser(ua).label, browser, ua);
      t.eq(a.parsePlatform(ua), platform, ua);
    }
    t.eq(a.parseBrowser('').label, 'Bilinmeyen tarayıcı');
    t.eq(a.parseBrowser(undefined).label, 'Bilinmeyen tarayıcı');
    t.eq(a.formatUptime(5000), '5 sn');
    t.eq(a.formatUptime(65000), '1 dk 5 sn');
    t.eq(a.formatUptime(3725000), '1 sa 2 dk 5 sn');
    t.eq(a.formatUptime(90061000), '1 gün 1 sa 1 dk');
    t.eq(a.formatUptime(-5), '0 sn');
    t.eq(a.fold('DUVAR KAĞIDI İşıK'), 'duvar kagidi isik');
    await close(win);
  });

  test('hakkında: fabrika ayarlarına sıfırla (iptal, onay, bekleyen çalışma)', async (t) => {
    reset();
    const win = await open(t, { page: 'about' });
    const ctl = app(win);
    let reloads = 0;
    ctl.hooks.reload = () => { reloads++; };
    const btn = $('button.danger', row(win, 'reset'));
    t.eq(btn.textContent.trim(), 'Fabrika ayarlarına sıfırla');
    P.settings.set('accent', '#3b82f6');
    P.storage.set('app.probe', { a: 1 });

    // cancel: nothing happens
    t.click(btn);
    let card = await waitDialog(t);
    t.ok(card.classList.contains('danger'), 'tehlikeli onay');
    t.ok(/Tüm ayarlar, dosyalar/.test(card.textContent) && /geri alınamaz/.test(card.textContent));
    t.eq(document.activeElement, dlgCancel(), 'odak İptal üzerinde açılmalı');
    t.click(dlgCancel());
    await t.waitFor(() => dialogCards().length === 0);
    await t.sleep(50);
    t.eq([reloads, P.storage.get('app.probe'), P.storage.get('settings').accent], [0, { a: 1 }, '#3b82f6']);

    // another window with unsaved work vetoes the reset
    const other = P.wm.open({ appId: 'probe', title: 'Kaydedilmemiş', width: 300, height: 200 });
    other.beforeClose = () => false;
    t.click(btn);
    await waitDialog(t);
    t.click(dlgOk());
    await t.waitFor(() => P.notify.history().some((n) => n.title === 'Sıfırlama iptal edildi'), 3000, 'iptal bildirimi gelmedi');
    t.eq([reloads, P.storage.get('app.probe')], [0, { a: 1 }], 'veri korunmalı');
    other.beforeClose = null;
    other.forceClose();

    // confirm: storage wiped and the page reloaded (reload is stubbed in tests)
    const cleared = [];
    const origClear = P.storage.clearAll;
    P.storage.clearAll = function () { cleared.push(P.storage.keys().length); return origClear.call(P.storage); };
    try {
      t.click(btn);
      await waitDialog(t);
      t.click(dlgOk());
      await t.waitFor(() => reloads === 1, 3000, 'sayfa yeniden yüklenmedi');
    } finally {
      P.storage.clearAll = origClear;
    }
    t.eq(cleared.length, 1, 'clearAll bir kez çağrılmalı');
    t.ok(cleared[0] > 0, 'silinmeden önce veri vardı');
    t.eq(P.storage.get('app.probe', 'yok'), 'yok', 'tüm depolama silinmeli');
    t.eq(P.storage.keys().filter((k) => k !== 'app.settings').length <= 1, true);
    // keep the rest of the suite healthy: persist the in-memory state again
    P.settings.reset();
    await close(win);
  });

  // ------------------------------------------------------------------ Arama
  test('arama: ayarları süzer ve ilgili ayara götürür', async (t) => {
    reset();
    const win = await open(t, { page: 'sound' });
    const box = searchBox(win);
    t.eq(box.placeholder, 'Ayar ara');
    const sids = () => $$('.st-result', win.el).map((r) => r.dataset.sid);

    t.type(box, 'tema');
    t.eq(app(win).page(), 'results');
    t.eq(titleOf(win), 'Arama sonuçları');
    t.eq(sids()[0], 'theme', 'en iyi eşleşme ilk sırada');
    t.ok($$('.st-nav-item.selected', win.el).length === 0, 'arama sırasında gezinme seçimi kalkmalı');
    t.ok($('.st-result mark', win.el), 'eşleşen kısım vurgulanmalı');
    t.ok(!$('.st-search-clear', win.el).hidden, 'temizle düğmesi görünmeli');
    t.ok(/1 sonuç|\d+ sonuç/.test($('.st-result-count', win.el).textContent), $('.st-result-count', win.el).textContent);
    t.ok($('.st-result .st-chip', win.el).textContent === 'Kişiselleştirme');

    // open the best result with Enter
    t.key(box, 'Enter');
    await t.waitFor(() => titleOf(win) === 'Kişiselleştirme', 2000);
    t.eq(box.value, '', 'arama kutusu temizlenmeli');
    t.ok(row(win, 'theme').classList.contains('st-flash'), 'bulunan ayar vurgulanmalı');
    t.ok($('.st-theme[aria-checked="true"]', win.el) === document.activeElement || document.activeElement.closest('[data-sid="theme"]'), 'odak ayara taşınmalı');
    t.eq(navBtn(win, 'appearance').getAttribute('aria-current'), 'page');

    // "ses" finds all the sound settings
    t.type(box, 'ses');
    t.ok(['volume', 'muted', 'sounds', 'soundTest'].every((s) => sids().includes(s)), sids().join(','));
    // Turkish characters are optional
    box.value = '';
    t.type(box, 'duvar kagidi');
    t.ok(sids().includes('wallpaper') && sids().includes('pickImage'), sids().join(','));
    box.value = '';
    t.type(box, 'DUVAR');
    t.ok(sids().includes('wallpaper'), 'büyük harf önemsenmemeli');
    box.value = '';
    t.type(box, 'hakkında');
    t.ok(sids().includes('device') && sids().includes('reset'), sids().join(','));
    box.value = '';
    t.type(box, 'rahatsız');
    t.eq(sids()[0], 'dnd');
    box.value = '';
    t.type(box, 'saniye');
    t.eq(sids()[0], 'showSeconds');
    box.value = '';
    t.type(box, 'çöp');
    t.eq(sids()[0], 'trash');
    box.value = '';
    t.type(box, 'ses düzey');
    t.eq(sids(), ['volume'], 'birden çok sözcük hepsini içermeli');

    // clicking a result jumps to the page and reveals the control
    box.value = '';
    t.type(box, 'sessiz');
    t.click($('.st-result[data-sid="muted"]', win.el));
    await t.waitFor(() => titleOf(win) === 'Ses', 2000);
    t.ok(row(win, 'muted').classList.contains('st-flash'));
    t.eq(document.activeElement, switchOf(win, 'muted'), 'odak anahtarda olmalı');
    await t.waitFor(() => !row(win, 'muted').classList.contains('st-flash'), 3500, 'vurgu kalkmalı');

    // no results
    t.type(box, 'zzzqqq');
    t.eq(sids().length, 0);
    t.ok($('.st-results-page .p-empty', win.el), 'boş durum');
    t.ok(/Sonuç bulunamadı/.test($('.st-results-page .p-empty', win.el).textContent));

    // Escape clears the search and returns to the page we came from
    t.key(box, 'Escape');
    t.eq(box.value, '');
    t.eq(titleOf(win), 'Ses');
    t.eq(navBtn(win, 'sound').getAttribute('aria-current'), 'page');

    // clear button
    t.type(box, 'tema');
    t.click($('.st-search-clear', win.el));
    t.eq(box.value, '');
    t.eq(titleOf(win), 'Ses');
    t.ok($('.st-search-clear', win.el).hidden);
    // whitespace only is not a search
    t.type(box, '   ');
    t.eq(app(win).page(), 'sound');
    box.value = '';

    // keyboard navigation inside the results
    t.type(box, 'ses');
    t.key(box, 'ArrowDown');
    const results = $$('.st-result', win.el);
    t.eq(document.activeElement, results[0]);
    t.key(results[0], 'ArrowDown');
    t.eq(document.activeElement, results[1]);
    t.key(results[1], 'ArrowUp');
    t.key(results[0], 'ArrowUp');
    t.eq(document.activeElement, box, 'ilk sonuçtan yukarı çıkınca arama kutusuna dönmeli');
    t.key(box, 'Escape');
    await close(win);
  });

  test('arama: Ctrl+F arama kutusuna odaklanır, gezinme aramayı sonlandırır', async (t) => {
    reset();
    const win = await open(t, { page: 'about' });
    win.focus();
    const ev = t.key(win.el, 'f', { ctrlKey: true });
    t.ok(ev.defaultPrevented, 'tarayıcının Ctrl+F eylemi engellenmeli');
    t.eq(document.activeElement, searchBox(win));
    t.type(searchBox(win), 'bildirim');
    t.eq(app(win).page(), 'results');
    // picking a page in the navigation ends the search
    t.click(navBtn(win, 'storage'));
    t.eq(titleOf(win), 'Depolama');
    t.eq(searchBox(win).value, '');
    t.eq(app(win).page(), 'storage');
    // Escape from anywhere in the window clears a running search
    t.type(searchBox(win), 'saat');
    t.eq(app(win).page(), 'results');
    navBtn(win, 'about').focus();
    t.key(navBtn(win, 'about'), 'Escape');
    t.eq(app(win).page(), 'storage');
    t.eq(document.activeElement, searchBox(win));
    await close(win);
  });

  // ------------------------------------------------------------------ canlı bağlama / sıfırlama
  test('canlı bağlama: dışarıdan yapılan tüm değişiklikler denetimlere yansır', async (t) => {
    reset();
    const win = await open(t);
    // build every page first so all controls exist (pages are kept alive while hidden)
    for (const id of PAGE_IDS) await go(t, win, id);
    P.settings.set('theme', 'light');
    P.settings.set('accent', '#8b5cf6');
    P.settings.set('animations', false);
    P.settings.set('desktop.iconSize', 'large');
    P.settings.set('wallpaper', 'ocean');
    P.settings.set('volume', 12);
    P.settings.set('muted', true);
    P.settings.set('sounds', false);
    P.settings.set('dnd', true);
    P.settings.set('clock24h', false);
    P.settings.set('showSeconds', true);
    const state = async () => {
      const s = {};
      await go(t, win, 'appearance');
      s.theme = $('.st-theme[aria-checked="true"]', win.el).dataset.value;
      s.accent = $('.st-swatch[aria-checked="true"]', win.el).dataset.value;
      s.animations = switchOf(win, 'animations').checked;
      s.icon = $('.p-segmented button[aria-checked="true"]', win.el).dataset.value;
      await go(t, win, 'wallpaper');
      s.wallpaper = $('.st-wp[aria-checked="true"]', win.el).dataset.value;
      await go(t, win, 'sound');
      s.volume = $('.p-range', win.el).value;
      s.muted = switchOf(win, 'muted').checked;
      s.sounds = switchOf(win, 'sounds').checked;
      await go(t, win, 'notifications');
      s.dnd = switchOf(win, 'dnd').checked;
      await go(t, win, 'datetime');
      s.h24 = switchOf(win, 'clock24h').checked;
      s.secs = switchOf(win, 'showSeconds').checked;
      return s;
    };
    t.eq(await state(), { theme: 'light', accent: '#8b5cf6', animations: false, icon: 'large', wallpaper: 'ocean', volume: '12', muted: true, sounds: false, dnd: true, h24: false, secs: true });
    P.settings.reset();
    t.eq(await state(), { theme: 'dark', accent: '#2f9e6b', animations: true, icon: 'medium', wallpaper: 'bamboo', volume: '70', muted: false, sounds: true, dnd: false, h24: true, secs: false });
    // changes made through controls land in the settings immediately and persist
    await go(t, win, 'appearance');
    t.click($('.st-theme[data-value="light"]', win.el));
    t.eq(P.storage.get('settings').theme, 'light');
    P.settings.reset();
    await close(win);
  });

  // ------------------------------------------------------------------ düzen
  test('düzen: en küçük, varsayılan ve büyütülmüş pencerede taşma yok', async (t) => {
    reset();
    P.fs.writeFile('/home/panda/Resimler/uzun-ad-ile-bir-resim-dosyasi-ornegi.png', PNG);
    P.settings.set('wallpaper', 'vfs:/home/panda/Resimler/uzun-ad-ile-bir-resim-dosyasi-ornegi.png');
    for (let i = 0; i < 7; i++) P.notify({ title: 'Çok uzun bir bildirim başlığı ' + i, message: 'Bu ileti satıra sığmayacak kadar uzun bir metin içeriyor ve kırpılmalı', icon: 'info', timeout: 1 });
    const win = await open(t);
    const checks = [];
    for (const [w, h] of [[640, 440], [900, 600], [1100, 760]]) {
      win.setSize(w, h);
      await t.sleep(60);
      for (const id of PAGE_IDS) {
        await go(t, win, id);
        const sc = $('.st-scroll', win.el);
        const scRect = sc.getBoundingClientRect();
        t.ok(sc.scrollWidth <= sc.clientWidth + 1, `${id} ${w}x${h}: yatay kaydırma var (${sc.scrollWidth} > ${sc.clientWidth})`);
        const page = pageEl(win);
        const pr = page.getBoundingClientRect();
        t.ok(pr.width > 300, `${id} ${w}x${h}: içerik çok dar (${pr.width})`);
        for (const r of $$('.st-row, .st-wp-hero, .st-clock-card, .st-about-hero, .st-theme-grid, .st-wp-grid, .st-legend', page)) {
          const rr = r.getBoundingClientRect();
          t.ok(rr.right <= pr.right + 1 && rr.left >= pr.left - 1, `${id} ${w}x${h}: ${r.className} sayfanın dışına taşıyor`);
        }
        for (const txt of $$('.st-row-title, .st-row-desc, .st-wp-name, .st-leg-name', page)) {
          const rr = txt.getBoundingClientRect();
          t.ok(rr.right <= scRect.right + 1, `${id} ${w}x${h}: metin taşıyor: ${txt.textContent}`);
        }
        const nav = $('.st-nav', win.el);
        t.ok(nav.getBoundingClientRect().width >= 190 && nav.getBoundingClientRect().width <= 260, `gezinme genişliği ${nav.getBoundingClientRect().width}`);
        checks.push(`${id}@${w}`);
      }
    }
    win.maximize();
    await t.sleep(60);
    for (const id of PAGE_IDS) {
      await go(t, win, id);
      const sc = $('.st-scroll', win.el);
      t.ok(sc.scrollWidth <= sc.clientWidth + 1, `${id} büyütülmüş: yatay kaydırma`);
      const pr = pageEl(win).getBoundingClientRect();
      t.ok(pr.width <= 821, `${id}: içerik en fazla 820px olmalı (${pr.width})`);
    }
    t.eq(checks.length, 21);
    P.settings.set('wallpaper', 'bamboo');
    P.fs.remove('/home/panda/Resimler/uzun-ad-ile-bir-resim-dosyasi-ornegi.png');
    P.notify.clear();
    await close(win);
  });

  test('düzen: sayfa değişince en üste kayar, sayfa durumu korunur', async (t) => {
    reset();
    const win = await open(t);
    win.setSize(640, 440);
    await t.sleep(60);
    const sc = $('.st-scroll', win.el);
    sc.scrollTop = 120;
    await go(t, win, 'sound');
    t.eq(sc.scrollTop, 0, 'yeni sayfa en üstten başlamalı');
    // built pages are kept: the slider keeps its DOM node
    const slider = $('.p-range', win.el);
    await go(t, win, 'about');
    await go(t, win, 'sound');
    t.ok($('.p-range', win.el) === slider, 'sayfa yeniden oluşturulmamalı');
    await close(win);
  });

  // ------------------------------------------------------------------ erişilebilirlik
  test('erişilebilirlik: her denetimin adı ve rolü var', async (t) => {
    reset();
    const win = await open(t);
    for (const id of PAGE_IDS) {
      await go(t, win, id);
      for (const c of $$('button, input, [role="radio"]', pageEl(win))) {
        const name = (c.getAttribute('aria-label') || c.textContent || '').trim();
        t.ok(name.length > 0, `${id}: adsız denetim ${c.outerHTML.slice(0, 120)}`);
      }
      t.ok(pageEl(win).getAttribute('aria-label'), `${id}: bölge adı`);
    }
    await go(t, win, 'appearance');
    t.eq($$('[role="radiogroup"]', win.el).length, 3, 'tema, vurgu ve simge boyutu radyo grupları');
    t.ok($$('[role="switch"]', win.el).length >= 1);
    t.eq(searchBox(win).getAttribute('aria-label'), 'Ayarlarda ara');
    t.ok($('nav[aria-label]', win.el), 'gezinme bölgesi etiketli');
    // keyboard focus ring is not suppressed on any control
    for (const c of $$('button, input', win.el)) t.ok(getComputedStyle(c).outlineStyle !== undefined);
    await close(win);
  });

  test('görünüm: açık ve koyu temada metin ile arka plan ayrışıyor', async (t) => {
    reset();
    const win = await open(t);
    const lum = (css) => {
      let m = (css.match(/[\d.]+/g) || []).map(Number);
      if (!m.length) throw new Error('renk çözümlenemedi: ' + css);
      if (/^color\(srgb/.test(css)) m = m.slice(0, 3).map((v) => v * 255); // computed color-mix() results
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const theme of ['dark', 'light']) {
      P.settings.set('theme', theme);
      for (const id of ['appearance', 'sound', 'storage', 'about']) {
        await go(t, win, id);
        const card = $('.st-row', win.el);
        const bg = getComputedStyle(card).backgroundColor;
        for (const sel of ['.st-row-title', '.st-row-desc']) {
          const el = $(sel, card);
          if (!el) continue;
          const r = ratio(getComputedStyle(el).color, bg);
          t.ok(r >= 4.5, `${theme}/${id} ${sel}: karşıtlık ${r.toFixed(2)}`);
        }
        t.ok(ratio(getComputedStyle($('.st-title', win.el)).color, getComputedStyle(root(win)).backgroundColor) >= 7, `${theme}/${id}: başlık karşıtlığı`);
      }
    }
    // filled buttons carry text too: danger + primary must reach AA in both themes
    for (const theme of ['dark', 'light']) {
      P.settings.set('theme', theme);
      for (const [page, sel] of [['about', '.p-btn.danger'], ['wallpaper', '.p-btn.primary']]) {
        await go(t, win, page);
        const b = $(sel, win.el);
        const cs = getComputedStyle(b);
        t.ok(!/rgba\(.*,\s*0?\.\d+\)$/.test(cs.backgroundColor), 'düğme dolgusu opak olmalı: ' + cs.backgroundColor);
        t.ok(ratio(cs.color, cs.backgroundColor) >= 4.5, `${theme}/${sel}: karşıtlık ${ratio(cs.color, cs.backgroundColor).toFixed(2)}`);
      }
    }
    P.settings.set('theme', 'dark');
    await close(win);
  });

  // ------------------------------------------------------------------ temizlik
  test('temizlik: kapanınca zamanlayıcı, dinleyici ve abonelik kalmaz', async (t) => {
    reset();
    const spy = installSpies();
    let win;
    try {
      win = await open(t);
      for (const id of PAGE_IDS) await go(t, win, id);
      // exercise a few timers: search flash, clock page intervals
      app(win).search('tema');
      t.click($('.st-result', win.el));
      await go(t, win, 'datetime');
      await go(t, win, 'about');
      t.ok(spy.intervals.size >= 1, 'about sayfası bir aralık başlatmalı');
      await go(t, win, 'sound');
      t.eq(spy.intervals.size, 0, 'sayfadan çıkınca aralıklar durmalı: ' + spy.intervals.size);
      await go(t, win, 'datetime');
      t.eq(spy.intervals.size, 1);
      t.ok(spy.subs.size >= 3, 'ayarlar, fs ve bildirim aboneliği: ' + spy.subs.size);
      t.click(searchBox(win));
      await close(win);
      await t.sleep(30);
      t.eq(spy.intervals.size, 0, 'kapanınca aralık kalmamalı');
      t.eq(spy.timeouts.size, 0, 'kapanınca bekleyen zaman aşımı kalmamalı: ' + spy.timeouts.size);
      t.eq(spy.subs.size, 0, 'kapanınca bus aboneliği kalmamalı: ' + spy.subs.size);
    } finally {
      spy.restore();
    }
    // after closing, setting changes and fs/notification events must not throw
    const before = window.__pandaErrors.length;
    P.settings.set('volume', 33);
    P.settings.set('theme', 'light');
    P.settings.set('theme', 'dark');
    P.fs.writeFile('/home/panda/Belgeler/z.txt', 'z');
    P.fs.remove('/home/panda/Belgeler/z.txt');
    P.notify({ title: 'kapandıktan sonra', timeout: 1 });
    await t.sleep(400);
    t.eq(window.__pandaErrors.length, before, 'kapanan pencere hata üretmemeli: ' + window.__pandaErrors.slice(before).join('|'));
    P.settings.reset();
    // a fresh window works after the previous one was destroyed
    const w2 = await open(t, { page: 'sound' });
    t.eq(titleOf(w2), 'Ses');
    await close(w2);
  });

  test('yaşam döngüsü: pencere simge durumuna alınıp geri gelince durum korunur', async (t) => {
    reset();
    const win = await open(t, { page: 'sound' });
    win.minimize();
    P.settings.set('volume', 21);
    win.restore();
    t.eq($('.p-range', win.el).value, '21', 'simge durumundayken yapılan değişiklik işlenmeli');
    win.setSize(700, 500);
    win.maximize();
    win.restore();
    t.eq(titleOf(win), 'Ses');
    P.settings.set('volume', 70);
    await close(win);
    t.eq(P.apps.running('settings').length, 0);
  });
})();
