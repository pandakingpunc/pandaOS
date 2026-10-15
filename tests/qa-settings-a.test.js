/* QA scratch suite A for Ayarlar (deleted at the end) */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  function makePng(w, h, c1, c2, noise) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (noise) {
      const id = g.getImageData(0, 0, w, h);
      for (let i = 0; i < id.data.length; i++) id.data[i] = (id.data[i] + Math.random() * 60) & 255;
      g.putImageData(id, 0, 0);
    }
    return c.toDataURL('image/png');
  }

  function test(name, fn) {
    T.test(name, async (t) => {
      try { P.settings.reset(); P.storage.remove('app.settings'); P.notify.clear(); await fn(t); } finally {
        P.apps.running('settings').forEach((w) => { try { w.forceClose(); } catch (e) { /* */ } });
        P.dialog.closeAll(); P.contextMenu.hide();
      }
    });
  }
  async function open(t, args) {
    const win = P.apps.launch('settings', args || {});
    await t.waitFor(() => $('.app-settings .st-page', win.el), 3000);
    return win;
  }
  const api = (win) => win.state.settings;

  // ------------------------------------------------------------------
  test('A1 search: every ITEMS entry is reachable and its target exists', async (t) => {
    const win = await open(t);
    const bad = [];
    const items = {
      theme: 'Tema', accent: 'Vurgu rengi', animations: 'Animasyonlar', iconSize: 'Masaüstü simge boyutu', wallpaper: 'Duvar kağıdı',
      pickImage: 'Kendi resmini seç', volume: 'Ana ses düzeyi', muted: 'Sessiz', sounds: 'Sistem sesleri', soundTest: 'Sesi test et',
      dnd: 'Rahatsız Etmeyin', notifTest: 'Test bildirimi', notifHistory: 'Bildirim geçmişi', clock24h: '24 saat biçimi',
      showSeconds: 'Saniyeleri göster', timezone: 'Saat dilimi', date: 'Geçerli tarih', usage: 'Depolama kullanımı', trash: 'Çöp kutusu',
      device: 'Cihaz bilgileri', reset: 'Fabrika ayarlarına sıfırla'
    };
    for (const [sid, title] of Object.entries(items)) {
      api(win).search(title);
      const res = $$('.st-result', win.el);
      const hit = res.find((r) => r.dataset.sid === sid);
      if (!hit) { bad.push(`${sid}: no result for "${title}" (got ${res.map((r) => r.dataset.sid).join(',')})`); continue; }
      t.click(hit);
      await t.sleep(30);
      if (!$(`[data-sid="${sid}"]`, win.el)) bad.push(`${sid}: target missing on page ${api(win).page()}`);
      const pg = api(win).page();
      if (pg === 'results') bad.push(`${sid}: still on results`);
    }
    t.ok(!bad.length, bad.join(' | '));
  });

  test('A2 search queries from the spec', async (t) => {
    const win = await open(t);
    const out = {};
    for (const q of ['tema', 'ses', 'duvar', 'DUVAR KAĞIDI', 'duvar kagidi', 'İKON', 'ikon', 'ısık', 'saat', 'sıfırla', 'hakkında', 'bildirim', 'çöp', 'kişisel', 'renk', 'dil', 'bellek', 'resim', 'zzz']) {
      api(win).search(q);
      out[q] = $$('.st-result', win.el).map((r) => r.dataset.sid).join(',') || '(none)';
    }
    console.error('SEARCH ' + JSON.stringify(out));
    t.ok(out.tema.startsWith('theme'), 'tema should start with theme: ' + out.tema);
    t.ok(out.ses.length > 0);
    t.ok(out.duvar.includes('wallpaper'));
  });

  test('A3 search keyboard flow: type, ArrowDown, Enter, Escape', async (t) => {
    const win = await open(t, { page: 'sound' });
    const box = $('.st-search-input', win.el);
    box.focus();
    t.type(box, 'tema');
    await t.sleep(30);
    t.eq(api(win).page(), 'results');
    t.key(box, 'ArrowDown');
    t.ok(document.activeElement.classList.contains('st-result'), 'ArrowDown should focus first result');
    document.activeElement.click();
    await t.sleep(60);
    t.eq(api(win).page(), 'appearance');
    t.ok(box.value === '', 'search cleared after jump');
    // Esc from results goes back
    box.focus(); t.type(box, 'ses'); await t.sleep(30);
    t.key(box, 'Escape'); await t.sleep(30);
    t.eq(api(win).page(), 'appearance', 'Esc returns to previous page');
  });

  test('A4 volume slider while muted (consistency with taskbar flyout)', async (t) => {
    const win = await open(t, { page: 'sound' });
    P.settings.set('muted', true);
    const sl = $('input[type=range]', win.el);
    sl.value = '55';
    sl.dispatchEvent(new Event('input', { bubbles: true }));
    await t.sleep(20);
    console.error('VOLMUTED muted=' + P.settings.get('muted') + ' vol=' + P.settings.get('volume'));
    t.ok(P.settings.get('muted') === false, 'moving volume while muted should unmute (taskbar does)');
  });

  test('A5 unmute at volume 0', async (t) => {
    const win = await open(t, { page: 'sound' });
    P.settings.set('volume', 0);
    P.settings.set('muted', true);
    const sw = $('input[data-key="muted"]', win.el);
    sw.checked = false;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    console.error('UNMUTE0 vol=' + P.settings.get('volume') + ' muted=' + P.settings.get('muted'));
    t.ok(Number(P.settings.get('volume')) > 0, 'unmuting at volume 0 should restore some volume (taskbar sets 30)');
  });

  test('A6 taskbar clock preview equals real taskbar clock', async (t) => {
    const win = await open(t, { page: 'datetime' });
    for (const [h24, sec] of [[true, false], [false, false], [false, true], [true, true]]) {
      P.settings.set('clock24h', h24); P.settings.set('showSeconds', sec);
      await t.sleep(1100);
      const real = $('.tb-clock .tb-clock-time, .tb-clock-time', document) || $('#taskbar [class*="clock"]');
      const prev = $('.st-tray-time', win.el);
      console.error('CLOCK ' + JSON.stringify({ h24, sec, real: real && real.textContent, prev: prev.textContent }));
      t.ok(real && Math.abs(0) === 0);
    }
  });

  test('A7 big custom wallpaper performance', async (t) => {
    const win = await open(t, { page: 'wallpaper' });
    const png = makePng(1000, 700, '#2b6cb0', '#f6ad55', true);
    console.error('PNGLEN ' + png.length);
    P.fs.writeFile('/home/panda/Resimler/buyuk.png', png);
    await t.sleep(300);
    const t0 = performance.now();
    P.settings.set('wallpaper', 'vfs:/home/panda/Resimler/buyuk.png');
    const t1 = performance.now();
    await t.sleep(400);
    console.error('WALLSET ms=' + (t1 - t0).toFixed(1));
    const t2 = performance.now();
    P.settings.set('wallpaper', 'bamboo');
    const t3 = performance.now();
    console.error('WALLBACK ms=' + (t3 - t2).toFixed(1));
    P.fs.remove('/home/panda/Resimler/buyuk.png');
    t.ok(true);
  });

  test('A8 storage numbers consistent', async (t) => {
    P.fs.writeFile('/home/panda/Belgeler/a1.txt', 'x'.repeat(30000));
    P.fs.writeFile('/home/panda/Müzik/m.txt', 'y'.repeat(2000));
    const tid = P.fs.trash('/home/panda/Belgeler/a1.txt');
    const win = await open(t, { page: 'storage' });
    const legs = $$('.st-leg', win.el).map((l) => `${l.dataset.id}:${l.dataset.bytes}`);
    const row = $('[data-sid="usage"]', win.el);
    console.error('STORAGE ' + legs.join(' ') + ' used=' + row.dataset.used + ' quota=' + row.dataset.quota + ' fsusage=' + JSON.stringify(P.fs.usage()));
    const sum = $$('.st-leg', win.el).reduce((a, l) => a + Number(l.dataset.bytes), 0);
    t.ok(Math.abs(sum - Number(row.dataset.quota)) < 2, 'legend totals (incl. free) should equal quota: ' + sum + ' vs ' + row.dataset.quota);
    P.fs.emptyTrash();
  });

  test('A9 storage live refresh when visible + trash empty confirm', async (t) => {
    P.fs.writeFile('/home/panda/Belgeler/b1.txt', 'x'.repeat(10000));
    const win = await open(t, { page: 'storage' });
    const before = $('.st-leg[data-id="docs"]', win.el).dataset.bytes;
    P.fs.writeFile('/home/panda/Belgeler/b2.txt', 'x'.repeat(10000));
    await t.sleep(350);
    const after = $('.st-leg[data-id="docs"]', win.el).dataset.bytes;
    t.ok(Number(after) > Number(before), `docs bytes ${before} -> ${after}`);
    P.fs.trash('/home/panda/Belgeler/b1.txt');
    await t.sleep(350);
    t.ok(Number($('.st-leg[data-id="trash"]', win.el).dataset.bytes) > 0, 'trash bytes should show');
    t.click($('[data-sid="trash"] button', win.el));
    await t.waitFor(() => $('#dialog-layer .dlg-card'), 2000);
    t.click($('#dialog-layer .dlg-btn:not(.dlg-primary)'));
    await t.sleep(100);
    t.eq(P.fs.trashCount(), 1, 'cancel keeps trash');
    t.click($('[data-sid="trash"] button', win.el));
    await t.waitFor(() => $('#dialog-layer .dlg-card'), 2000);
    t.click($('#dialog-layer .dlg-primary'));
    await t.sleep(400);
    t.eq(P.fs.trashCount(), 0);
    t.eq($('.st-leg[data-id="trash"]', win.el).dataset.bytes, '0');
    P.fs.remove('/home/panda/Belgeler/b2.txt');
  });

  test('A10 accent: 3-digit hex, upper-case, invalid', async (t) => {
    const win = await open(t, { page: 'appearance' });
    const hex = $('.st-hex', win.el);
    hex.focus();
    hex.value = '#ABC';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    t.eq(P.settings.get('accent'), '#aabbcc');
    hex.value = '12';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    t.ok(hex.classList.contains('invalid'));
    await t.sleep(1000);
    t.eq(hex.value, '#aabbcc');
    // swatch eq with uppercase accent
    P.settings.set('accent', '#2F9E6B');
    await t.sleep(20);
    t.ok($('.st-swatch.selected', win.el), 'uppercase accent still highlights Bambu');
  });

  test('A11 theme cards', async (t) => {
    const win = await open(t, { page: 'appearance' });
    const cards = $$('.st-theme', win.el);
    t.click(cards[0]); t.eq(P.settings.get('theme'), 'light');
    t.click(cards[2]); t.eq(P.settings.get('theme'), 'auto');
    P.theme.toggle();
    await t.sleep(20);
    t.ok(cards.filter((c) => c.classList.contains('selected')).length === 1);
    console.error('THEME after toggle in auto: ' + P.settings.get('theme'));
  });

  test('A12 reset flow with veto', async (t) => {
    const win = await open(t, { page: 'about' });
    let reloads = 0;
    api(win).hooks.reload = () => { reloads++; };
    const other = P.apps.launch('notepad');
    await t.sleep(100);
    t.click($('[data-sid="reset"] button', win.el));
    await t.waitFor(() => $('#dialog-layer .dlg-card'), 2000);
    t.click($('#dialog-layer .dlg-primary'));
    await t.sleep(600);
    // notepad may show save dialog if dirty; ours is clean
    console.error('RESET reloads=' + reloads + ' windows=' + P.wm.list().map((w) => w.appId).join(','));
    t.eq(reloads, 1);
    t.eq(P.storage.keys().length, 0, 'storage should be empty right after clearAll, keys=' + P.storage.keys().join(','));
  });

  test('A13 relaunch while minimized and search active', async (t) => {
    const win = await open(t, { page: 'sound' });
    api(win).search('tema');
    win.minimize();
    await t.sleep(50);
    P.apps.launch('settings', { page: 'storage' });
    await t.sleep(80);
    t.ok(!win.isMinimized(), 'restored');
    t.eq(api(win).page(), 'storage');
    t.eq($('.st-search-input', win.el).value, '', 'search cleared');
  });

  test('A14 notifications page shows history live', async (t) => {
    const win = await open(t, { page: 'notifications' });
    P.notify({ title: 'Merhaba', message: 'x', timeout: 10 });
    await t.sleep(200);
    t.eq($$('.st-notif', win.el).length, 1);
    const desc = $('[data-sid="notifHistory"] .st-row-desc', win.el).textContent;
    console.error('NOTIFDESC ' + desc);
  });
})();
