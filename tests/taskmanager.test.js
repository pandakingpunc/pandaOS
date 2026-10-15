/* Görev Yöneticisi (taskmanager) — drives the real UI: tabs, process table, charts, history, details, shortcuts, cleanup. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const U = P.util;
  const TA = 'tmtest-a';
  const TB = 'tmtest-b';
  if (!P.apps.get(TA)) P.apps.register({ id: TA, name: 'Test Uygulaması A', icon: 'notepad', launch(win) { win.body.textContent = 'A'; } });
  if (!P.apps.get(TB)) P.apps.register({ id: TB, name: 'Deneme Programı', icon: 'calculator', singleInstance: true, launch(win) { win.body.textContent = 'B'; } });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function clean() {
    try { P.contextMenu.hide(); } catch (e) { /* ignore */ }
    try { if (P.dialog.closeAll) P.dialog.closeAll(); } catch (e) { /* ignore */ }
    P.wm.list().forEach((w) => w.forceClose());
    P.storage.remove('app.taskmanager');
    P.settings.set('theme', 'dark');
    P.settings.set('accent', '#2f9e6b');
  }

  function openTM(page) {
    const win = P.apps.launch('taskmanager');
    const tm = win.state.tm;
    if (page) tm.go(page);
    return { win, tm, root: win.el };
  }

  const row = (t, root, key) => t.$(`.tm-row[data-key="${key}"]`, root);
  const cells = (r) => [...r.querySelectorAll('.tm-c')].map((c) => c.textContent.trim());
  const menuItems = (t) => t.$$('#context-menu-layer .ctx-item');
  const menuItem = (t, label) => menuItems(t).find((i) => i.querySelector('.ctx-label').textContent === label);
  const hasInk = (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  };
  const statOf = (t, root, label) => {
    const s = t.$$('.tm-stat', root).find((e) => e.querySelector('.tm-stat-k').textContent === label);
    return s ? s.querySelector('.tm-stat-v').textContent : null;
  };
  const infoOf = (t, root, label) => {
    const s = t.$$('.tm-irow', root).find((e) => e.querySelector('.k').textContent === label);
    return s ? s.querySelector('.v').textContent : null;
  };
  const appKeys = (grid) => grid.items.filter((i) => i.kind === 'app').map((i) => i.key);

  PandaTest.test('kayıt: kimlik, ad, simge, pencere ölçüleri', (t) => {
    const d = P.apps.get('taskmanager');
    t.ok(d, 'uygulama kayıtlı değil');
    t.eq([d.id, d.name, d.icon, d.singleInstance], ['taskmanager', 'Görev Yöneticisi', 'taskmanager', true]);
    t.eq([d.window.width, d.window.height, d.window.minWidth, d.window.minHeight], [780, 540, 560, 380]);
  });

  PandaTest.test('açılış: tek örnek, dört bölüm, varsayılan İşlemler', async (t) => {
    clean();
    const w1 = P.apps.launch('taskmanager');
    const w2 = P.apps.launch('taskmanager');
    t.ok(w1 && w1 === w2, 'ikinci başlatma aynı pencereyi vermeli');
    t.eq(P.wm.byApp('taskmanager').length, 1);
    t.eq(w1.getTitle(), 'Görev Yöneticisi');
    const tabs = t.$$('.tm-rail [role=tab]', w1.el);
    t.eq(tabs.map((b) => b.textContent.trim()), ['İşlemler', 'Performans', 'Uygulama geçmişi', 'Ayrıntılar']);
    t.ok(tabs[0].classList.contains('active') && tabs[0].getAttribute('aria-selected') === 'true', 'İşlemler etkin değil');
    t.eq(t.$$('.tm-page', w1.el).filter((p) => !p.hidden).map((p) => p.dataset.page), ['processes']);
    t.eq(t.$$('[title]', w1.el).length, 0, 'yerel title özniteliği kullanılmamalı');
    w1.forceClose();
  });

  PandaTest.test('işlemler: bölümler, sistem işlemleri, başlıklar ve toplamlar', async (t) => {
    clean();
    const { win, root } = openTM();
    t.eq(t.$$('.tm-page-processes .tm-head .tm-th-label', root).map((e) => e.textContent), ['Ad', 'Durum', 'CPU', 'Bellek', 'Disk']);
    t.eq(t.$$('.tm-row.tm-sec', root).map((r) => r.querySelector('.tm-sec-label').textContent + r.querySelector('.tm-sec-count').textContent),
      ['Uygulamalar(1)', 'Sistem işlemleri(4)']);
    const sys = t.$$('.tm-row.tm-sys .tm-label', root).map((e) => e.textContent);
    t.eq(sys.slice().sort(), ['Görev çubuğu', 'Masaüstü', 'PandaOS Çekirdeği', 'Pencere Yöneticisi']);
    const own = row(t, root, 'app:taskmanager');
    t.ok(own, 'kendi satırı yok');
    t.eq(own.querySelector('.tm-label').textContent, 'Görev Yöneticisi');
    t.eq(cells(own)[1], 'Etkin');
    const [cpu, mem, disk] = t.$$('.tm-th-total', root).map((e) => e.textContent);
    t.ok(/^%\d+$/.test(cpu) && /^%\d+$/.test(mem), 'CPU/Bellek toplamı biçimi: ' + cpu + ' ' + mem);
    t.ok(/MB\/sn$/.test(disk), 'disk toplamı: ' + disk);
    const g = t.$('.tm-proc', root);
    t.eq(g.getAttribute('role'), 'treegrid');
    t.eq(g.getAttribute('tabindex'), '0');
    t.ok(row(t, root, 'app:taskmanager').getAttribute('aria-level') === '1');
    // metrics look plausible: tr-TR numbers
    t.ok(/^%\d+(,\d)?$/.test(cells(own)[2]), 'CPU hücresi: ' + cells(own)[2]);
    t.ok(/^\d+(\.\d{3})*(,\d)? (MB|GB)$/.test(cells(own)[3]), 'bellek hücresi: ' + cells(own)[3]);
    t.ok(/^\d+(,\d)? MB\/sn$/.test(cells(own)[4]), 'disk hücresi: ' + cells(own)[4]);
    win.forceClose();
  });

  PandaTest.test('canlı: pencere açılıp kapanınca satır hemen eklenir/silinir', async (t) => {
    clean();
    const { win, root } = openTM();
    const a = P.apps.launch(TA);
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000, 'satır görünmedi');
    t.eq(row(t, root, 'app:' + TA).querySelector('.tm-label').textContent, 'Test Uygulaması A');
    t.eq(t.$('.tm-row.tm-sec .tm-sec-count', root).textContent, '(2)');
    t.eq(t.$$('.tm-row.tm-app', root).length, 2);
    a.setTitle('Yeni başlık');
    await t.waitFor(() => /Yeni başlık/.test(row(t, root, 'app:' + TA).textContent), 1000, 'başlık güncellenmedi');
    a.forceClose();
    await t.waitFor(() => !row(t, root, 'app:' + TA), 1000, 'satır silinmedi');
    t.eq(t.$('.tm-row.tm-sec .tm-sec-count', root).textContent, '(1)');
    win.forceClose();
  });

  PandaTest.test('gruplama: çok pencereli uygulama genişletilir, durum kalıcıdır', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const a1 = P.apps.launch(TA);
    const a2 = P.apps.launch(TA);
    a2.setTitle('İkinci pencere');
    await t.waitFor(() => { const r = row(t, root, 'app:' + TA); return r && r.classList.contains('has-kids'); }, 1000, 'grup satırı yok');
    const r = row(t, root, 'app:' + TA);
    t.eq(r.querySelector('.tm-sub').textContent, '(2)');
    t.eq(t.$$('.tm-row.tm-child', root).length, 0, 'varsayılan daraltılmış olmalı');
    t.eq(r.getAttribute('aria-expanded'), 'false');
    t.click(r.querySelector('.tm-twisty'));
    await t.waitFor(() => t.$$('.tm-row.tm-child', root).length === 2, 1000, 'alt satırlar çıkmadı');
    t.eq(row(t, root, 'app:' + TA).getAttribute('aria-expanded'), 'true');
    t.eq(t.$$('.tm-row.tm-child .tm-label', root).map((e) => e.textContent).sort(U.compareNames), ['Test Uygulaması A', 'İkinci pencere'].sort(U.compareNames));
    t.eq(t.$$('.tm-row.tm-child', root)[0].getAttribute('aria-level'), '2');
    t.ok(tm.getState().expanded.includes(TA), 'genişletme durumu tutulmalı');
    // child windows follow their window: closing one drops the group to a plain row
    a1.forceClose();
    await t.waitFor(() => t.$$('.tm-row.tm-child', root).length === 0, 1000, 'alt satırlar kalkmadı');
    t.ok(!row(t, root, 'app:' + TA).classList.contains('has-kids'));
    t.eq(row(t, root, 'app:' + TA).querySelector('.tm-sub').textContent, 'İkinci pencere');
    a2.forceClose();
    win.forceClose();
  });

  PandaTest.test('durum: simge durumundaki pencere soluk ve düşük CPU ile gösterilir', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const a = P.apps.launch(TA);
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    t.eq(cells(row(t, root, 'app:' + TA))[1], 'Etkin');
    a.minimize();
    await t.waitFor(() => cells(row(t, root, 'app:' + TA))[1] === 'Simge durumunda', 1000, 'durum değişmedi');
    t.ok(row(t, root, 'app:' + TA).classList.contains('is-min'));
    t.ok(t.$('.tm-dot.idle', row(t, root, 'app:' + TA)), 'boş nokta bekleniyordu');
    for (let i = 0; i < 12; i++) tm.model.step(tm.model.lastT + 1000, false);
    t.ok(tm.model.wins.get(a.id).cpu < 0.3, 'simge durumundaki pencere CPU kullanmamalı: ' + tm.model.wins.get(a.id).cpu);
    a.restore();
    await t.waitFor(() => cells(row(t, root, 'app:' + TA))[1] === 'Etkin', 1000, 'geri yüklenince Etkin olmalı');
    a.forceClose();
    win.forceClose();
  });

  PandaTest.test('model: uygulama profilleri (paint/müzik > hesap makinesi), sınırlar, temizlik', async (t) => {
    clean();
    const { win, tm } = openTM();
    const paint = P.wm.open({ appId: 'paint', title: 'Çizim', icon: 'paint' });
    const calc = P.wm.open({ appId: 'calculator', title: 'Hesap Makinesi', icon: 'calculator' });
    const play = P.wm.open({ appId: 'music', title: 'Müzik Çalar', icon: 'music' });
    const idle = P.wm.open({ appId: 'music', title: 'Müzik Çalar 2', icon: 'music' });
    play.state.playing = true;
    const byGlyph = P.wm.open({ appId: 'music', title: 'Müzik Çalar 3', icon: 'music' });
    byGlyph.body.innerHTML = '<button type="button">' + P.icons.get('pause') + '</button>';
    const notYet = P.wm.open({ appId: 'music', title: 'Müzik Çalar 4', icon: 'music' });
    notYet.body.innerHTML = '<button type="button">' + P.icons.get('play') + '</button>';
    const m = tm.model;
    for (let i = 0; i < 20; i++) m.step(m.lastT + 1000, false);
    const stats = {};
    const wins = { paint, calc, play, idle, byGlyph, notYet };
    // run 10 more steps, accumulating for all windows at once
    const acc = {};
    Object.keys(wins).forEach((k) => { acc[k] = { cpu: 0, mem: 0, disk: 0 }; });
    for (let i = 0; i < 10; i++) {
      m.step(m.lastT + 1000, false);
      Object.entries(wins).forEach(([k, w]) => { const M = m.wins.get(w.id); acc[k].cpu += M.cpu / 10; acc[k].mem += M.mem / 10; acc[k].disk += M.disk / 10; });
    }
    Object.assign(stats, acc);
    t.ok(stats.paint.cpu > stats.calc.cpu, `paint CPU (${stats.paint.cpu}) > hesap makinesi (${stats.calc.cpu})`);
    t.ok(stats.paint.mem > stats.calc.mem + 60, 'paint belleği daha büyük olmalı');
    t.ok(stats.play.cpu > stats.idle.cpu + 4, `çalan müzik (${stats.play.cpu}) boştakinden (${stats.idle.cpu}) belirgin ağır olmalı`);
    t.ok(stats.play.disk > stats.idle.disk, 'çalan müzik diski daha çok kullanmalı');
    t.ok(stats.byGlyph.cpu > stats.notYet.cpu + 4, `duraklat simgesi gösteren oynatıcı çalıyor sayılmalı (${stats.byGlyph.cpu} vs ${stats.notYet.cpu})`);
    const last = m.last;
    t.ok(last.cpu >= 0 && last.cpu <= 100, 'toplam CPU 0..100');
    t.ok(last.mem > 1000 && last.mem < 8192, 'bellek makul aralıkta: ' + last.mem);
    t.ok(last.cores.length >= 1 && last.cores.length <= 16 && last.cores.every((c) => c >= 0 && c <= 100));
    t.ok(m.samples.length >= 61, 'geçmiş önceden doldurulmalı: ' + m.samples.length);
    t.ok(m.samples[m.samples.length - 1].t - m.samples[0].t >= 59000, 'son 60 sn geçmiş olmalı');
    t.ok(m.samples.every((s, i) => i === 0 || s.t > m.samples[i - 1].t), 'zaman damgaları artmalı');
    play.forceClose();
    m.step(m.lastT + 1000, false);
    t.ok(!m.wins.has(play.id), 'kapanan pencerenin ölçümü silinmeli');
    [paint, calc, idle, byGlyph, notYet].forEach((w) => w.forceClose());
    win.forceClose();
  });

  PandaTest.test('ısı haritası: değer büyüdükçe hücre sınıfı yükselir', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const a = P.apps.launch(TA);
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    const M = tm.model.wins.get(a.id);
    const heatOf = (key, i) => { const c = row(t, root, key).querySelectorAll('.tm-num')[i]; return Number((/heat-(\d)/.exec(c.className) || [])[1]); };
    M.cpu = 0; M.mem = 4; M.disk = 0; tm.render();
    t.eq([heatOf('app:' + TA, 0), heatOf('app:' + TA, 1), heatOf('app:' + TA, 2)], [0, 0, 0]);
    M.cpu = 40; M.mem = 700; M.disk = 6; tm.render();
    t.eq([heatOf('app:' + TA, 0), heatOf('app:' + TA, 1), heatOf('app:' + TA, 2)], [4, 4, 4]);
    M.cpu = 3; tm.render();
    t.ok(heatOf('app:' + TA, 0) >= 1 && heatOf('app:' + TA, 0) <= 3, 'orta değer orta ısıda olmalı');
    const c = row(t, root, 'app:' + TA).querySelectorAll('.tm-num')[0];
    t.ok(getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)', 'ısı rengi uygulanmalı');
    a.forceClose();
    win.forceClose();
  });

  PandaTest.test('sıralama: başlığa tıklayınca yön değişir, satırlar sıralanır, durum saklanır', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const a = P.apps.launch(TA);
    const b = P.apps.launch(TB);
    await t.waitFor(() => row(t, root, 'app:' + TA) && row(t, root, 'app:' + TB), 1000);
    const grid = tm.grid('processes');
    t.eq(tm.getState().sort, { key: 'name', dir: 'asc' });
    t.eq(appKeys(grid), ['app:' + TB, 'app:taskmanager', 'app:' + TA], 'ada göre (tr) artan');
    tm.model.wins.get(a.id).cpu = 12;
    tm.model.wins.get(b.id).cpu = 3;
    tm.model.wins.get(win.id).cpu = 0.5;
    const th = (c) => t.$(`.tm-head .tm-th[data-col="${c}"]`, root);
    t.click(th('cpu'));
    t.eq(tm.getState().sort, { key: 'cpu', dir: 'desc' });
    t.eq(appKeys(grid)[0], 'app:' + TA, 'en yüksek CPU en üstte');
    t.eq(th('cpu').parentElement.getAttribute('aria-sort'), 'descending');
    t.eq(th('name').parentElement.getAttribute('aria-sort'), 'none');
    t.eq(t.$$('.tm-row.tm-app', root).map((r) => r.dataset.key), appKeys(grid), 'DOM sırası modelle uyuşmalı');
    t.click(th('cpu'));
    t.eq(tm.getState().sort, { key: 'cpu', dir: 'asc' });
    t.eq(appKeys(grid)[appKeys(grid).length - 1], 'app:' + TA);
    t.eq(th('cpu').parentElement.getAttribute('aria-sort'), 'ascending');
    t.click(th('name'));
    t.eq(tm.getState().sort, { key: 'name', dir: 'asc' });
    t.click(th('name'));
    t.eq(appKeys(grid)[0], 'app:' + TA, 'ada göre azalan');
    t.click(th('mem'));
    t.eq(tm.getState().sort, { key: 'mem', dir: 'desc' });
    t.ok(t.$('.tm-th-arrow svg', th('mem')), 'sıralama oku görünmeli');
    t.click(th('state'));
    t.eq(tm.getState().sort, { key: 'state', dir: 'asc' });
    await sleep(400);
    t.eq(P.storage.get('app.taskmanager').sort, { key: 'state', dir: 'asc' }, 'sıralama kaydedilmeli');
    a.forceClose(); b.forceClose();
    win.forceClose();
  });

  PandaTest.test('seçim: satır seçilir, Görevi sonlandır düğmesi etkinleşir (sistem satırı hariç)', async (t) => {
    clean();
    const { win, root } = openTM();
    const a = P.apps.launch(TA);
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    const btn = t.$('.tm-page-processes .tm-btn-end', root);
    t.ok(btn.disabled, 'başlangıçta devre dışı');
    t.click(row(t, root, 'app:' + TA));
    t.ok(row(t, root, 'app:' + TA).classList.contains('selected'));
    t.eq(row(t, root, 'app:' + TA).getAttribute('aria-selected'), 'true');
    t.ok(!btn.disabled, 'uygulama seçilince etkin');
    t.click(t.$('.tm-row.tm-sys', root));
    t.ok(t.$('.tm-row.tm-sys', root).classList.contains('selected'));
    t.ok(!row(t, root, 'app:' + TA).classList.contains('selected'));
    t.ok(btn.disabled, 'sistem işlemi sonlandırılamaz');
    t.click(t.$('.tm-row.tm-sec', root));
    t.ok(!t.$('.tm-row.tm-sec', root).classList.contains('selected'), 'bölüm başlığı seçilmez');
    t.eq(t.$('.tm-row.tm-sec', root).getAttribute('aria-expanded'), 'false', 'bölüm başlığı daraltır');
    t.ok(!row(t, root, 'app:' + TA), 'daraltılan bölümün satırları gizlenmeli');
    t.click(t.$('.tm-row.tm-sec', root));
    t.ok(row(t, root, 'app:' + TA), 'yeniden genişletilmeli');
    // blank area deselects
    t.click(row(t, root, 'app:' + TA));
    const body = t.$('.tm-proc .tm-body', root);
    t.mouse(body, 'mousedown', { button: 0 });
    t.ok(!t.$('.tm-row.selected', root), 'boş alan seçimi kaldırmalı');
    t.ok(btn.disabled);
    a.forceClose();
    win.forceClose();
  });

  PandaTest.test('görevi sonlandır: düğme, grup ve kaydedilmemiş çalışma onayı', async (t) => {
    clean();
    const { win, root } = openTM();
    const a = P.apps.launch(TA);
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    const btn = t.$('.tm-page-processes .tm-btn-end', root);
    t.click(row(t, root, 'app:' + TA));
    t.click(btn);
    await t.waitFor(() => a.isClosed(), 1000, 'pencere kapanmadı');
    await t.waitFor(() => !row(t, root, 'app:' + TA), 1000, 'satır silinmedi');
    t.ok(btn.disabled, 'seçili satır kalkınca düğme devre dışı olmalı');
    t.ok(win.isFocused(), 'Görev Yöneticisi odağı korumalı');

    // a group ends all of its windows
    const g1 = P.apps.launch(TA); const g2 = P.apps.launch(TA);
    await t.waitFor(() => { const r = row(t, root, 'app:' + TA); return r && r.classList.contains('has-kids'); }, 1000);
    t.click(row(t, root, 'app:' + TA));
    t.click(btn);
    await t.waitFor(() => g1.isClosed() && g2.isClosed(), 1000, 'grubun tüm pencereleri kapanmalı');

    // unsaved work: asks first
    const d = P.apps.launch(TA);
    d.dirty = true;
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    t.click(row(t, root, 'app:' + TA));
    t.click(btn);
    await t.waitFor(() => t.$('#dialog-layer .dlg-primary'), 1000, 'onay penceresi açılmadı');
    t.ok(/kaydedilmemiş/.test(t.$('#dialog-layer .dlg-message').textContent), 'mesaj: ' + t.$('#dialog-layer .dlg-message').textContent);
    t.click(t.$('#dialog-layer .dlg-btn:not(.dlg-primary)'));
    await t.waitFor(() => !P.dialog.isOpen(), 1000);
    t.ok(!d.isClosed(), 'İptal pencereyi kapatmamalı');
    t.click(btn);
    await t.waitFor(() => t.$('#dialog-layer .dlg-primary'), 1000);
    t.click(t.$('#dialog-layer .dlg-primary'));
    await t.waitFor(() => d.isClosed(), 1000, 'onaylanınca kapanmalı');

    // ending itself simply closes the task manager
    t.click(row(t, root, 'app:taskmanager'));
    t.click(btn);
    await t.waitFor(() => win.isClosed(), 1000, 'kendini sonlandırabilmeli');
  });

  PandaTest.test('bağlam menüsü: Öne getir, Simge durumuna küçült, Ekranı kapla, Görevi sonlandır', async (t) => {
    clean();
    const { win, root } = openTM();
    const a = P.apps.launch(TA);
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    t.contextmenu(row(t, root, 'app:' + TA));
    await t.waitFor(() => menuItems(t).length, 1000, 'menü açılmadı');
    t.ok(row(t, root, 'app:' + TA).classList.contains('selected'), 'sağ tık satırı seçmeli');
    t.eq(menuItems(t).map((i) => i.querySelector('.ctx-label').textContent),
      ['Öne getir', 'Simge durumuna küçült', 'Ekranı kapla', 'Görevi sonlandır']);
    t.ok(menuItem(t, 'Görevi sonlandır').classList.contains('danger'));
    t.click(menuItem(t, 'Simge durumuna küçült'));
    await t.waitFor(() => a.isMinimized(), 1000, 'küçültülmedi');
    await t.waitFor(() => cells(row(t, root, 'app:' + TA))[1] === 'Simge durumunda', 1000);

    t.contextmenu(row(t, root, 'app:' + TA));
    await t.waitFor(() => menuItems(t).length, 1000);
    t.ok(menuItem(t, 'Simge durumuna küçült').classList.contains('disabled'), 'zaten küçük: devre dışı');
    t.click(menuItem(t, 'Öne getir'));
    await t.waitFor(() => !a.isMinimized() && a.isFocused(), 1000, 'öne gelmedi');

    t.contextmenu(row(t, root, 'app:' + TA));
    await t.waitFor(() => menuItems(t).length, 1000);
    t.click(menuItem(t, 'Ekranı kapla'));
    await t.waitFor(() => a.isMaximized(), 1000, 'büyütülmedi');
    t.contextmenu(row(t, root, 'app:' + TA));
    await t.waitFor(() => menuItems(t).length, 1000);
    t.ok(menuItem(t, 'Önceki boyuta getir'), 'büyütülmüşse geri alma seçeneği');
    t.click(menuItem(t, 'Önceki boyuta getir'));
    await t.waitFor(() => !a.isMaximized(), 1000);

    t.contextmenu(row(t, root, 'app:' + TA));
    await t.waitFor(() => menuItems(t).length, 1000);
    t.click(menuItem(t, 'Görevi sonlandır'));
    await t.waitFor(() => a.isClosed(), 1000, 'sonlandırılmadı');

    // system rows: only a disabled "Görevi sonlandır"
    t.contextmenu(t.$('.tm-row.tm-sys', root));
    await t.waitFor(() => menuItems(t).length, 1000);
    t.eq(menuItems(t).map((i) => i.querySelector('.ctx-label').textContent), ['Görevi sonlandır']);
    t.ok(menuItems(t)[0].classList.contains('disabled'));
    P.contextMenu.hide();
    win.forceClose();
  });

  PandaTest.test('klavye: oklar, Home/End, Sağ/Sol ile genişlet, Enter, Delete, Alt+rakam, Ctrl+F', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const a1 = P.apps.launch(TA);
    const a2 = P.apps.launch(TA);
    const b = P.apps.launch(TB);
    await t.waitFor(() => { const r = row(t, root, 'app:' + TA); return r && r.classList.contains('has-kids') && row(t, root, 'app:' + TB); }, 1000);
    win.focus();
    const grid = tm.grid('processes');
    grid.el.focus();
    t.key(grid.el, 'ArrowDown');
    t.eq(grid.selected, 'app:' + TB, 'ilk seçilebilir satır');
    t.eq(grid.el.getAttribute('aria-activedescendant'), row(t, root, 'app:' + TB).id);
    t.key(grid.el, 'ArrowDown');
    t.eq(grid.selected, 'app:taskmanager');
    t.key(grid.el, 'ArrowDown');
    t.eq(grid.selected, 'app:' + TA);
    t.key(grid.el, 'End');
    t.ok(/^sys:/.test(grid.selected), 'End son satıra gider: ' + grid.selected);
    t.key(grid.el, 'Home');
    t.eq(grid.selected, 'app:' + TB);
    t.key(grid.el, 'ArrowUp');
    t.eq(grid.selected, 'app:' + TB, 'başta yukarı ok durmalı');
    // expand / collapse with arrows
    grid.select('app:' + TA);
    t.key(grid.el, 'ArrowRight');
    await t.waitFor(() => t.$$('.tm-row.tm-child', root).length === 2, 1000, 'Sağ ok genişletmeli');
    t.key(grid.el, 'ArrowRight');
    t.ok(grid.selected === 'win:' + a1.id || grid.selected === 'win:' + a2.id, 'ikinci Sağ ok ilk alt satıra geçmeli: ' + grid.selected);
    t.key(grid.el, 'ArrowLeft');
    t.eq(grid.selected, 'app:' + TA, 'Sol ok üst satıra döner');
    t.key(grid.el, 'ArrowLeft');
    await t.waitFor(() => t.$$('.tm-row.tm-child', root).length === 0, 1000, 'Sol ok daraltmalı');
    // Enter brings to front / restores
    b.minimize();
    await t.waitFor(() => cells(row(t, root, 'app:' + TB))[1] === 'Simge durumunda', 1000);
    grid.select('app:' + TB);
    t.key(grid.el, 'Enter');
    await t.waitFor(() => !b.isMinimized() && b.isFocused(), 1000, 'Enter öne getirmeli');
    // Delete ends the task
    win.focus();
    grid.el.focus();
    grid.select('app:' + TB);
    t.key(grid.el, 'Delete');
    await t.waitFor(() => b.isClosed(), 1000, 'Delete görevi sonlandırmalı');
    // shortcuts on the window
    win.focus();
    t.key(win.el, '2', { altKey: true });
    t.eq(tm.getState().page, 'performance');
    t.key(win.el, '4', { altKey: true });
    t.eq(tm.getState().page, 'details');
    t.key(win.el, '3', { altKey: true });
    t.eq(tm.getState().page, 'history');
    t.key(win.el, '1', { altKey: true });
    t.eq(tm.getState().page, 'processes');
    const ev = t.key(win.el, 'f', { ctrlKey: true });
    t.ok(ev.defaultPrevented, 'Ctrl+F tarayıcıya gitmemeli');
    t.ok(document.activeElement === t.$('.tm-page-processes .tm-search-input', root), 'Ctrl+F aramaya odaklanmalı');
    // rail arrows
    const tab = t.$('.tm-nav.active', root);
    tab.focus();
    t.key(tab, 'ArrowDown', {});
    t.eq(tm.getState().page, 'performance');
    t.key(document.activeElement, 'End');
    t.eq(tm.getState().page, 'details');
    a1.forceClose(); a2.forceClose();
    win.forceClose();
  });

  PandaTest.test('arama: süzme, boş durum, Esc ile temizleme', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const a = P.apps.launch(TA);
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    const input = t.$('.tm-page-processes .tm-search-input', root);
    t.type(input, 'görev');
    await t.waitFor(() => !row(t, root, 'app:' + TA), 1000, 'süzme çalışmadı');
    t.ok(row(t, root, 'app:taskmanager'), 'eşleşen uygulama kalmalı');
    t.eq(t.$$('.tm-row.tm-sys .tm-label', root).map((e) => e.textContent), ['Görev çubuğu'], 'sistem işlemleri de süzülür');
    t.ok(!t.$('.tm-page-processes .tm-search-clear', root).hidden, 'temizle düğmesi görünmeli');
    input.value = '';
    t.type(input, 'zzzz');
    await t.waitFor(() => t.$$('.tm-page-processes .tm-row', root).length === 0, 1000);
    const empty = t.$('.tm-page-processes .tm-empty', root);
    t.ok(!empty.hidden && /Eşleşen işlem yok/.test(empty.textContent), 'boş durum görünmeli');
    t.key(input, 'Escape');
    t.eq(input.value, '');
    t.ok(row(t, root, 'app:' + TA), 'temizlenince satırlar dönmeli');
    t.ok(empty.hidden);
    // the query is shared between pages
    t.type(input, 'test');
    tm.go('details');
    t.eq(t.$('.tm-page-details .tm-search-input', root).value, 'test');
    t.eq(t.$$('.tm-page-details .tm-row', root).length, 1);
    t.click(t.$('.tm-page-details .tm-search-clear', root));
    t.eq(t.$('.tm-page-details .tm-search-input', root).value, '');
    a.forceClose();
    win.forceClose();
  });

  PandaTest.test('performans: kaynak listesi, canvas grafikler, CPU/Bellek/Disk/Ağ ayrıntıları', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const a = P.apps.launch(TA);
    t.click(t.$('.tm-nav[data-page="performance"]', root));
    t.eq(tm.getState().page, 'performance');
    t.eq(t.$$('.tm-page', root).filter((p) => !p.hidden).map((p) => p.dataset.page), ['performance']);
    const res = t.$$('.tm-res', root);
    t.eq(res.map((b) => b.querySelector('.tm-res-name').firstChild.textContent), ['CPU', 'Bellek', 'Disk', 'Ağ']);
    t.ok(res[0].classList.contains('active') && res[0].getAttribute('aria-selected') === 'true');
    t.eq(t.$('.tm-dtitle', root).textContent, 'CPU');
    t.ok(hasInk(t.$('.tm-chart', root)), 'ana grafik çizilmeli');
    res.forEach((b, i) => t.ok(hasInk(b.querySelector('canvas')), 'mini grafik çizilmeli: ' + i));
    const cv = t.$('.tm-chart', root);
    t.eq(cv.width, Math.round(cv.clientWidth * (window.devicePixelRatio || 1)), 'canvas boyutu görüntüye uymalı');
    t.eq(t.$('.tm-axis-max', root).textContent, '%100');
    t.ok(/^%\d+(,\d)?$/.test(statOf(t, root, 'Kullanım')), 'CPU kullanımı: ' + statOf(t, root, 'Kullanım'));
    t.ok(/^\d,\d\d GHz$/.test(statOf(t, root, 'Hız')), 'hız: ' + statOf(t, root, 'Hız'));
    t.eq(statOf(t, root, 'İşlem sayısı'), String(P.wm.list().length + 4), 'işlem sayısı = pencereler + sistem');
    t.ok(/^\d+$/.test(statOf(t, root, 'İş parçacığı sayısı')));
    t.ok(/^\d{2}:\d{2}:\d{2}$/.test(statOf(t, root, 'Çalışma süresi')), 'çalışma süresi: ' + statOf(t, root, 'Çalışma süresi'));
    t.eq(infoOf(t, root, 'Çekirdek'), String(navigator.hardwareConcurrency || t.$$('.tm-core', root).length || 4));
    t.eq(infoOf(t, root, 'Temel hız'), '3,20 GHz');
    t.ok(/GHz/.test(t.$('.tm-res.active .tm-res-sub', root).textContent), 'liste altyazısı hız içermeli');

    // memory
    t.click(res[1]);
    t.eq(tm.getState().res, 'mem');
    t.eq(t.$('.tm-dtitle', root).textContent, 'Bellek');
    t.ok(/^\d+,\d \/ 8,0 GB$/.test(statOf(t, root, 'Kullanımda')), 'bellek: ' + statOf(t, root, 'Kullanımda'));
    t.ok(/GB$/.test(statOf(t, root, 'Kullanılabilir')));
    t.eq(t.$('.tm-axis-max', root).textContent, '8,0 GB');
    t.ok(t.$('.tm-membar', root), 'bellek bileşimi çubuğu');
    t.ok(parseFloat(t.$('.tm-seg.used', root).style.width) > 0, 'kullanılan dilim genişliği');
    if (performance.memory) t.ok(/MB$/.test(statOf(t, root, 'JS yığını (gerçek)')), 'gerçek JS yığını gösterilmeli');
    t.ok(hasInk(t.$('.tm-chart', root)));

    // disk = fs usage
    t.click(res[2]);
    tm.render();
    const u = P.fs.usage();
    t.eq(statOf(t, root, 'Kullanım'), `${U.formatBytes(u.used)} / ${U.formatBytes(u.quota)}`, 'disk kullanımı fs.usage() ile aynı olmalı');
    t.ok(/^%[\d,]+$/.test(statOf(t, root, 'Doluluk')), 'doluluk yüzdesi');
    t.ok(/MB\/sn$/.test(statOf(t, root, 'Okuma hızı')) && /MB\/sn$/.test(statOf(t, root, 'Yazma hızı')));
    t.ok(/^\d+$/.test(statOf(t, root, 'Dosya sayısı')) && Number(statOf(t, root, 'Dosya sayısı')) > 5);
    t.ok(t.$('.tm-membar .tm-seg.used', root), 'disk doluluk çubuğu');

    // network
    t.click(res[3]);
    t.eq(t.$('.tm-dtitle', root).textContent, 'Ağ');
    t.ok(/KB\/sn$|MB\/sn$/.test(statOf(t, root, 'Alma')) && /KB\/sn$|MB\/sn$/.test(statOf(t, root, 'Gönderme')));
    t.ok(hasInk(t.$('.tm-chart', root)));
    t.ok(/Bağlı/.test(infoOf(t, root, 'Durum')));

    // logical processors
    t.click(res[0]);
    t.click(t.$('.tm-viewseg [data-view="cores"]', root));
    const n = Math.min(16, Math.max(1, navigator.hardwareConcurrency || 4));
    t.eq(t.$$('.tm-core', root).length, n, 'mantıksal işlemci grafiği sayısı');
    t.ok(t.$('.tm-chart', root).hidden && !t.$('.tm-coregrid', root).hidden);
    t.ok(hasInk(t.$('.tm-corecv', root)), 'çekirdek grafiği çizilmeli');
    t.click(t.$('.tm-viewseg [data-view="overall"]', root));
    t.ok(!t.$('.tm-chart', root).hidden && t.$('.tm-coregrid', root).hidden);
    a.forceClose();
    win.forceClose();
  });

  PandaTest.test('grafikler: aksan rengini kullanır, tema/aksan/boyut değişince yeniden çizilir', async (t) => {
    clean();
    const { win, tm, root } = openTM('performance');
    const cv = t.$('.tm-chart', root);
    const accentRgb = () => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let best = null;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 250) { best = [d[i], d[i + 1], d[i + 2]]; break; }
      return best;
    };
    const near = (c, hex) => {
      const n = parseInt(hex.slice(1), 16);
      const want = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      return c && Math.abs(c[0] - want[0]) + Math.abs(c[1] - want[1]) + Math.abs(c[2] - want[2]) < 90;
    };
    t.ok(near(accentRgb(), '#2f9e6b'), 'varsayılan aksan: ' + accentRgb());
    P.settings.set('accent', '#3b82f6');
    t.ok(near(accentRgb(), '#3b82f6'), 'aksan değişince grafik rengi değişmeli: ' + accentRgb());
    P.theme.set('light');
    t.ok(hasInk(cv), 'açık temada çizilmeli');
    P.theme.set('dark');
    // resize
    win.setSize(560, 380);
    t.eq(cv.width, Math.round(cv.clientWidth * (window.devicePixelRatio || 1)), 'küçük pencerede canvas yeniden boyutlanmalı');
    t.ok(hasInk(cv));
    const small = cv.clientWidth;
    win.setSize(1200, 700);
    t.ok(cv.clientWidth > small + 100, 'büyüyünce grafik genişlemeli: ' + small + ' -> ' + cv.clientWidth);
    t.eq(cv.width, Math.round(cv.clientWidth * (window.devicePixelRatio || 1)));
    t.ok(hasInk(cv));
    tm.tick(2);
    win.forceClose();
  });

  PandaTest.test('uygulama geçmişi: başlatma sayısı, açık kalma süresi, sıfırlama (modül yüklenmesinden beri izlenir)', async (t) => {
    clean();
    const HID = 'tmtest-hist';
    P.apps.register({ id: HID, name: 'Geçmiş Deneme', icon: 'notepad', launch(win) { win.body.textContent = 'H'; } });
    // launched BEFORE the task manager exists: the tracker has been listening since script load
    const h1 = P.apps.launch(HID);
    const h2 = P.apps.launch(HID);
    await sleep(1200);
    h1.forceClose();
    const { win, tm, root } = openTM('history');
    const hrow = () => row(t, root, 'h:' + HID);
    t.ok(hrow(), 'önceden açılan uygulama geçmişte olmalı');
    t.eq(t.$$('.tm-head .tm-th-label', root).filter((e) => e.closest('.tm-page-history')).map((e) => e.textContent),
      ['Ad', 'Başlatma', 'Açık kalma süresi', 'Şu an', 'Son açılış']);
    t.eq(hrow().querySelector('.tm-label').textContent, 'Geçmiş Deneme');
    t.eq(cells(hrow())[1], '2', 'başlatma sayısı');
    t.ok(/^[1-9]\d* sn$/.test(cells(hrow())[2]), 'açık kalma süresi: ' + cells(hrow())[2]);
    t.ok(/Çalışıyor/.test(cells(hrow())[3]), 'bir pencere hâlâ açık: ' + cells(hrow())[3]);
    t.ok(/^\d{2}:\d{2}:\d{2}$/.test(cells(hrow())[4]), 'son açılış saati: ' + cells(hrow())[4]);
    t.ok(row(t, root, 'h:taskmanager'), 'Görev Yöneticisi kendi başlatmasını da gösterir');
    h2.forceClose();
    await t.waitFor(() => { tm.render(); return cells(hrow())[3] === 'Kapalı'; }, 1500, 'kapanınca "Kapalı" olmalı');
    const closedDur = cells(hrow())[2];
    await sleep(1100);
    tm.render();
    t.eq(cells(hrow())[2], closedDur, 'kapalı uygulamanın süresi artmamalı');
    const h3 = P.apps.launch(HID);
    tm.render();
    t.eq(cells(hrow())[1], '3');
    // sorting
    const th = (c) => t.$(`.tm-page-history .tm-th[data-col="${c}"]`, root);
    t.click(th('launches'));
    t.eq(tm.getState().hsort, { key: 'launches', dir: 'desc' });
    t.eq(th('launches').parentElement.getAttribute('aria-sort'), 'descending');
    const counts = t.$$('.tm-page-history .tm-row', root).map((r) => Number(cells(r)[1]));
    t.ok(counts.every((v, i) => i === 0 || counts[i - 1] >= v), 'başlatma sayısına göre azalan: ' + counts);
    // reset
    h3.forceClose();
    t.click(t.$('.tm-page-history .p-btn', root));
    await t.waitFor(() => t.$('#dialog-layer .dlg-primary'), 1000, 'sıfırlama onayı açılmadı');
    t.click(t.$('#dialog-layer .dlg-primary'));
    await t.waitFor(() => !hrow(), 1000, 'sıfırlanınca kapalı uygulamalar listeden kalkmalı');
    t.eq(cells(row(t, root, 'h:taskmanager'))[1], '0', 'açık uygulamalar 0 başlatma ile kalır');
    win.forceClose();
  });

  PandaTest.test('ayrıntılar: PID, ad, durum, başlık, boyut, konum; seçim, sıralama, çift tık, Delete', async (t) => {
    clean();
    const { win, tm, root } = openTM('details');
    const a = P.apps.launch(TA);
    const b = P.apps.launch(TB);
    await t.waitFor(() => row(t, root, 'win:' + a.id) && row(t, root, 'win:' + b.id), 1000);
    t.eq(t.$$('.tm-page-details .tm-head .tm-th-label', root).map((e) => e.textContent), ['PID', 'Ad', 'Durum', 'Pencere başlığı', 'Boyut', 'Konum']);
    const rows = t.$$('.tm-page-details .tm-row', root);
    t.eq(rows.length, P.wm.list().length);
    const pids = rows.map((r) => cells(r)[0]);
    t.ok(pids.every((p) => /^\d+$/.test(p)) && new Set(pids).size === pids.length, 'PID değerleri sayısal ve benzersiz: ' + pids);
    const ra = row(t, root, 'win:' + a.id);
    const bb = a.getBounds();
    t.eq(cells(ra).slice(1), ['Test Uygulaması A', 'Etkin', 'Test Uygulaması A', `${bb.width} × ${bb.height}`, `${bb.x}, ${bb.y}`]);
    a.setSize(520, 410);
    a.setPosition(90, 70);
    tm.render();
    t.eq(cells(ra).slice(4), ['520 × 410', '90, 70'], 'boyut/konum güncellenmeli');
    a.setTitle('Başka başlık');
    await t.waitFor(() => cells(ra)[3] === 'Başka başlık', 1000);
    b.minimize();
    await t.waitFor(() => cells(row(t, root, 'win:' + b.id))[2] === 'Simge durumunda', 1000);
    // sort by PID desc
    const th = (c) => t.$(`.tm-page-details .tm-th[data-col="${c}"]`, root);
    t.eq(tm.getState().dsort, { key: 'pid', dir: 'asc' });
    t.click(th('pid'));
    t.eq(tm.getState().dsort, { key: 'pid', dir: 'desc' });
    const order = t.$$('.tm-page-details .tm-row', root).map((r) => Number(cells(r)[0]));
    t.ok(order.every((v, i) => i === 0 || order[i - 1] > v), 'PID azalan: ' + order);
    t.click(th('name'));
    t.eq(tm.getState().dsort, { key: 'name', dir: 'asc' });
    // selection + buttons
    const btn = t.$('.tm-page-details .tm-btn-end', root);
    t.ok(btn.disabled);
    t.click(row(t, root, 'win:' + a.id));
    t.ok(!btn.disabled);
    // double click = bring to front (and restore)
    t.dblclick(row(t, root, 'win:' + b.id));
    await t.waitFor(() => !b.isMinimized() && b.isFocused(), 1000, 'çift tık öne getirmeli');
    // context menu works here too
    t.contextmenu(row(t, root, 'win:' + a.id));
    await t.waitFor(() => menuItems(t).length, 1000);
    t.ok(menuItem(t, 'Görevi sonlandır'));
    P.contextMenu.hide();
    // Delete
    win.focus();
    const grid = tm.grid('details');
    grid.el.focus();
    grid.select('win:' + a.id);
    t.key(grid.el, 'Delete');
    await t.waitFor(() => a.isClosed(), 1000);
    await t.waitFor(() => !row(t, root, 'win:' + a.id), 1000);
    b.forceClose();
    win.forceClose();
  });

  PandaTest.test('güncelleme hızı: menü, duraklat/sürdür, kalıcılık', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    t.ok(tm.timerActive(), 'zamanlayıcı çalışmalı');
    t.click(t.$('.tm-speed', root));
    await t.waitFor(() => menuItems(t).length === 4, 1000, 'hız menüsü açılmadı');
    t.eq(menuItems(t).map((i) => i.querySelector('.ctx-label').textContent.replace(/\s+/g, ' ')),
      ['Yüksek (0,5 sn)', 'Normal (1 sn)', 'Düşük (4 sn)', 'Duraklatıldı']);
    t.ok(menuItems(t)[1].classList.contains('checked'), 'Normal işaretli olmalı');
    t.click(menuItems(t)[3]);
    t.eq(tm.getState().speed, 'paused');
    t.ok(!tm.timerActive(), 'duraklatılınca zamanlayıcı durmalı');
    t.eq(t.$('.tm-page-processes .tm-status span:last-child', root).textContent, 'Güncelleme duraklatıldı');
    const n = tm.model.samples.length;
    await sleep(2200);
    t.eq(tm.model.samples.length, n, 'duraklatılmışken örnek eklenmemeli');
    t.click(t.$('.tm-speed', root));
    await t.waitFor(() => menuItems(t).length === 4, 1000);
    t.click(menuItems(t)[0]);
    t.eq(tm.getState().speed, 'high');
    t.ok(tm.timerActive());
    await sleep(1300);
    t.ok(tm.model.samples.length >= n + 2, 'yüksek hızda 1,3 sn içinde en az 2 örnek: ' + (tm.model.samples.length - n));
    await sleep(400);
    t.eq(P.storage.get('app.taskmanager').speed, 'high', 'hız kaydedilmeli');
    win.forceClose();
    const again = openTM();
    t.eq(again.tm.getState().speed, 'high', 'hız yeniden açılışta korunmalı');
    again.win.forceClose();
  });

  PandaTest.test('simge durumunda çizim durur, geri yüklenince güncellenir', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const status = () => t.$('.tm-page-processes .tm-status span', root).textContent;
    const before = status();
    t.eq(before, '1 uygulama · 1 pencere · 4 sistem işlemi');
    win.minimize();
    const a = P.apps.launch(TA);
    await sleep(200);
    tm.tick(3);
    t.eq(status(), before, 'küçültülmüşken DOM güncellenmemeli');
    t.ok(!tm.rafActive(), 'küçültülmüşken animasyon karesi istenmemeli');
    win.restore();
    t.eq(status(), '2 uygulama · 2 pencere · 4 sistem işlemi', 'geri yüklenince hemen güncellenmeli');
    a.forceClose();
    win.forceClose();
  });

  PandaTest.test('duyarlı düzen: küçük/büyük boyut, daraltılmış kenar çubuğu, burger', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const shell = t.$('.tm-shell', root);
    win.setSize(780, 540);
    t.eq(tm.getState().size, 'md');
    t.ok(!shell.classList.contains('compact'), '780 px: kenar çubuğu açık');
    t.ok(t.$('.tm-nav-label', root).offsetWidth > 0, 'etiketler görünmeli');
    t.ok(getComputedStyle(t.$('.tm-head .tm-c-state', root)).display !== 'none', 'Durum sütunu görünmeli');
    win.setSize(560, 380);
    t.eq(tm.getState().size, 'sm');
    t.ok(shell.classList.contains('compact'), '560 px: kenar çubuğu daralmalı');
    t.eq(t.$('.tm-nav-label', root).offsetWidth, 0, 'etiketler gizli');
    t.eq(getComputedStyle(t.$('.tm-head .tm-c-state', root)).display, 'none', 'Durum sütunu gizlenmeli');
    t.ok(t.$('.tm-grid', root).clientHeight > 100, 'tablo görünür alana sahip olmalı');
    t.eq(t.$('.tm-proc', root).scrollWidth, t.$('.tm-proc', root).clientWidth, 'yatay kaydırma olmamalı');
    // very wide
    win.setSize(1100, 700);
    t.eq(tm.getState().size, 'md');
    t.ok(!shell.classList.contains('compact'));
    // burger toggles
    t.click(t.$('.tm-burger', root));
    t.ok(shell.classList.contains('compact'), 'burger daraltmalı');
    t.eq(t.$('.tm-burger', root).getAttribute('aria-expanded'), 'false');
    t.click(t.$('.tm-burger', root));
    t.ok(!shell.classList.contains('compact'), 'burger genişletmeli');
    // maximize
    win.maximize();
    t.ok(!shell.classList.contains('compact'));
    tm.go('performance');
    t.ok(t.$('.tm-chart', root).clientHeight > 150, 'büyük pencerede grafik yüksek olmalı');
    win.restore();
    win.setSize(560, 380);
    // performance page strip layout at the minimum size
    t.eq(getComputedStyle(t.$('.tm-reslist', root)).flexDirection, 'row', 'dar pencerede kaynak listesi şerit olmalı');
    t.ok(t.$('.tm-detail', root).clientHeight > 150, 'ayrıntı alanı görünür');
    tm.go('details');
    tm.go('history');
    win.forceClose();
  });

  PandaTest.test('yeni görev çalıştır: uygulama adıyla başlatır, geçersiz adı reddeder', async (t) => {
    clean();
    const { win, root } = openTM();
    t.click(t.$('.tm-btn-new', root));
    await t.waitFor(() => t.$('#dialog-layer .dlg-input'), 1000, 'istem açılmadı');
    const input = t.$('#dialog-layer .dlg-input');
    t.type(input, 'yokboyleuygulama');
    t.click(t.$('#dialog-layer .dlg-primary'));
    t.ok(t.$('#dialog-layer .dlg-error.show'), 'hata gösterilmeli');
    t.ok(P.dialog.isOpen(), 'geçersiz adda pencere açık kalmalı');
    input.value = '';
    t.type(input, 'test uygulaması a');
    t.click(t.$('#dialog-layer .dlg-primary'));
    await t.waitFor(() => P.wm.byApp(TA).length === 1, 1000, 'uygulama başlamadı');
    await t.waitFor(() => !P.dialog.isOpen(), 1000);
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    P.wm.byApp(TA).forEach((w) => w.forceClose());
    win.forceClose();
  });

  PandaTest.test('disk: dosya değişince sayaçlar güncellenir', async (t) => {
    clean();
    const { win, tm, root } = openTM('performance');
    t.click(t.$('.tm-res[data-res="disk"]', root));
    tm.render();
    const before = Number(statOf(t, root, 'Dosya sayısı'));
    P.fs.writeFile('/tmp/tm-test-dosya.txt', 'merhaba');
    await sleep(600);
    tm.render();
    t.eq(Number(statOf(t, root, 'Dosya sayısı')), before + 1, 'dosya sayısı artmalı');
    const u = P.fs.usage();
    t.eq(statOf(t, root, 'Kullanım'), `${U.formatBytes(u.used)} / ${U.formatBytes(u.quota)}`);
    P.fs.remove('/tmp/tm-test-dosya.txt');
    win.forceClose();
  });

  PandaTest.test('kalıcılık ve yeniden başlatma: sayfa, sıralama, kaynak; relaunch({page})', async (t) => {
    clean();
    const { win, tm, root } = openTM('performance');
    t.click(t.$('.tm-res[data-res="net"]', root));
    tm.go('history');
    const w2 = P.apps.launch('taskmanager', { page: 'details' });
    t.ok(w2 === win, 'aynı pencere');
    t.eq(tm.getState().page, 'details', 'relaunch sayfayı değiştirmeli');
    t.click(t.$('.tm-page-details .tm-th[data-col="name"]', root));
    await sleep(400);
    const saved = P.storage.get('app.taskmanager');
    t.eq([saved.page, saved.res, saved.dsort], ['details', 'net', { key: 'name', dir: 'asc' }]);
    win.forceClose();
    const again = openTM();
    t.eq(again.tm.getState().page, 'details', 'kapatıp açınca sayfa korunmalı');
    t.eq(again.tm.getState().res, 'net');
    t.eq(again.tm.getState().dsort, { key: 'name', dir: 'asc' });
    again.win.forceClose();
    // corrupted storage must not break the app
    P.storage.set('app.taskmanager', { page: 'nope', sort: { key: 'zzz', dir: 'sideways' }, speed: 'warp', res: 9, expanded: 5 });
    const bad = openTM();
    t.eq([bad.tm.getState().page, bad.tm.getState().speed, bad.tm.getState().sort], ['processes', 'normal', { key: 'name', dir: 'asc' }]);
    bad.win.forceClose();
  });

  PandaTest.test('temizlik: kapanınca zamanlayıcı, animasyon karesi, bus ve document dinleyicileri kalmaz', async (t) => {
    clean();
    // true when the function that called the wrapped API (stack frame `skip`) lives in js/apps/taskmanager.js
    const mine = (skip) => /taskmanager\.js/.test(String(new Error().stack).split('\n')[skip]);
    const docAdds = []; const docRemoves = [];
    const intervals = []; const cleared = [];
    const rafs = []; const cancelled = [];
    const busOns = []; const busOffs = [];
    const o = {
      add: document.addEventListener, remove: document.removeEventListener,
      si: window.setInterval, ci: window.clearInterval, raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame, bus: P.bus.on
    };
    const cap = (x) => !!(x && (x === true || x.capture));
    document.addEventListener = function (type, fn, opts) {
      if (mine(3)) docAdds.push([type, fn, cap(opts)]);
      return o.add.call(this, type, fn, opts);
    };
    document.removeEventListener = function (type, fn, opts) {
      docRemoves.push([type, fn, cap(opts)]);
      return o.remove.call(this, type, fn, opts);
    };
    window.setInterval = function (...a) { const id = o.si.apply(window, a); if (mine(3)) intervals.push(id); return id; };
    window.clearInterval = function (id) { cleared.push(id); return o.ci.call(window, id); };
    window.requestAnimationFrame = function (fn) { const id = o.raf.call(window, fn); if (mine(3)) rafs.push(id); return id; };
    window.cancelAnimationFrame = function (id) { cancelled.push(id); return o.caf.call(window, id); };
    P.bus.on = function (evt, fn) {
      const off = o.bus.call(P.bus, evt, fn);
      if (!mine(3)) return off;
      const rec = { evt, called: false };
      busOns.push(rec);
      return () => { rec.called = true; busOffs.push(evt); return off(); };
    };
    let win;
    let tm;
    try {
      ({ win, tm } = openTM('performance'));
      await sleep(100);
    } finally {
      document.addEventListener = o.add; document.removeEventListener = o.remove;
      window.setInterval = o.si; window.clearInterval = o.ci; window.requestAnimationFrame = o.raf; window.cancelAnimationFrame = o.caf;
      P.bus.on = o.bus;
    }
    t.ok(docAdds.length >= 5, 'document dinleyicileri eklenmeli: ' + docAdds.length);
    t.ok(intervals.length >= 1, 'bir zamanlayıcı kurulmalı');
    t.ok(busOns.length >= 5, 'bus abonelikleri: ' + busOns.length);
    // spy again to record the removals made while closing
    document.removeEventListener = function (type, fn, opts) { docRemoves.push([type, fn, cap(opts)]); return o.remove.call(this, type, fn, opts); };
    window.clearInterval = function (id) { cleared.push(id); return o.ci.call(window, id); };
    window.cancelAnimationFrame = function (id) { cancelled.push(id); return o.caf.call(window, id); };
    try { win.forceClose(); } finally {
      document.removeEventListener = o.remove; window.clearInterval = o.ci; window.cancelAnimationFrame = o.caf;
    }
    t.ok(tm.destroyed(), 'destroy çalışmalı');
    t.ok(!tm.timerActive(), 'zamanlayıcı kapalı olmalı');
    t.ok(!tm.rafActive(), 'animasyon karesi iptal edilmeli');
    t.ok(intervals.every((id) => cleared.includes(id)), 'tüm setInterval kayıtları temizlenmeli');
    t.ok(!rafs.length || cancelled.includes(rafs[rafs.length - 1]), 'bekleyen requestAnimationFrame iptal edilmeli');
    t.ok(docAdds.every(([type, fn, c]) => docRemoves.some((r) => r[0] === type && r[1] === fn && r[2] === c)), 'her document dinleyicisi kaldırılmalı');
    t.ok(busOns.every((r) => r.called), 'her bus aboneliği iptal edilmeli');
    // nothing keeps running afterwards
    const html = win.body.innerHTML;
    P.apps.launch(TA);
    await sleep(1300);
    t.eq(win.body.innerHTML, html, 'kapalı pencerenin DOM\'u değişmemeli');
    P.wm.byApp(TA).forEach((w) => w.forceClose());
  });

  PandaTest.test('hatasız çalışma: çok sayıda pencere, hızlı aç/kapa, sıkı döngü', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const ws = [];
    for (let i = 0; i < 12; i++) ws.push(P.apps.launch(TA));
    await t.waitFor(() => row(t, root, 'app:' + TA), 1000);
    tm.tick(5);
    t.eq(t.$$('.tm-row.tm-app', root).length, 2);
    tm.go('details');
    t.eq(t.$$('.tm-page-details .tm-row', root).length, 13);
    ws.slice(0, 6).forEach((w) => w.forceClose());
    tm.go('processes');
    tm.tick(2);
    await t.waitFor(() => row(t, root, 'app:' + TA).querySelector('.tm-sub').textContent === '(6)', 1000);
    ws.forEach((w) => w.forceClose());
    await t.waitFor(() => !row(t, root, 'app:' + TA), 1000);
    for (let i = 0; i < 4; i++) { P.apps.launch(TB).forceClose(); }
    PAGES().forEach((p) => { tm.go(p); tm.tick(1); });
    t.ok(!win.isClosed());
    win.forceClose();
  });

  PandaTest.test('etkileşim: tablo üstünde canlı sıralama donar, başlık Enter tuşu satırı etkinleştirmez, bölüm çift tık', async (t) => {
    clean();
    const { win, tm, root } = openTM();
    const a = P.apps.launch(TA);
    const b = P.apps.launch(TB);
    await t.waitFor(() => row(t, root, 'app:' + TA) && row(t, root, 'app:' + TB), 1000);
    const th = (c) => t.$(`.tm-page-processes .tm-head .tm-th[data-col="${c}"]`, root);
    const grid = tm.grid('processes');
    tm.model.wins.get(a.id).cpu = 20; tm.model.wins.get(b.id).cpu = 5; tm.model.wins.get(win.id).cpu = 1;
    t.click(th('cpu'));
    t.eq(appKeys(grid)[0], 'app:' + TA);
    const domOrder = () => t.$$('.tm-row.tm-app', root).map((r) => r.dataset.key);
    // pointer over the live-sorted body: the order is frozen but the numbers keep moving
    t.mouse(t.$('.tm-proc .tm-body', root), 'mouseenter');
    tm.model.wins.get(a.id).cpu = 0.5; tm.model.wins.get(b.id).cpu = 30;
    tm.render();
    t.eq(domOrder()[0], 'app:' + TA, 'fare tablonun üstündeyken sıra değişmemeli');
    t.ok(/%30/.test(cells(row(t, root, 'app:' + TB))[2]), 'değerler yine de güncellenmeli: ' + cells(row(t, root, 'app:' + TB))[2]);
    t.mouse(t.$('.tm-proc .tm-body', root), 'mouseleave');
    tm.render();
    t.eq(domOrder()[0], 'app:' + TB, 'fare ayrılınca sıra güncellenmeli');
    // name sorting is never frozen: a new app lands in its sorted place even while hovering
    t.click(th('name'));
    t.mouse(t.$('.tm-proc .tm-body', root), 'mouseenter');
    const c = P.wm.open({ appId: 'aaa-test', title: 'Aaa Pencere', icon: 'notepad' });
    tm.render();
    t.eq(domOrder()[0], 'app:aaa-test', 'ada göre sıralamada yeni satır yerine oturmalı');
    t.mouse(t.$('.tm-proc .tm-body', root), 'mouseleave');
    // Enter on a focused header button must not bring the selected window forward
    a.minimize();
    await t.waitFor(() => cells(row(t, root, 'app:' + TA))[1] === 'Simge durumunda', 1000);
    t.click(row(t, root, 'app:' + TA));
    const btn = th('cpu');
    btn.focus();
    t.key(btn, 'Enter');
    t.key(btn, 'ArrowDown');
    t.ok(a.isMinimized(), 'başlıktaki tuş vuruşları satırı etkinleştirmemeli');
    // double click on a section header = one toggle, not two
    const sec = t.$('.tm-row.tm-sec', root);
    t.dblclick(sec);
    t.eq(sec.getAttribute('aria-expanded'), 'false', 'çift tık bir kez değiştirmeli');
    t.click(sec);
    t.eq(sec.getAttribute('aria-expanded'), 'true');
    // expanding a group while the live-sorted table is "held still" must still put the children under their parent
    const a2 = P.apps.launch(TA);
    await t.waitFor(() => row(t, root, 'app:' + TA).classList.contains('has-kids'), 1000);
    a.restore();
    t.click(th('cpu'));
    t.mouse(t.$('.tm-proc .tm-body', root), 'mouseenter');
    t.click(row(t, root, 'app:' + TA).querySelector('.tm-twisty'));
    const keys = t.$$('.tm-page-processes .tm-row', root).map((r) => r.dataset.key);
    const gi = keys.indexOf('app:' + TA);
    t.eq(keys.slice(gi + 1, gi + 3), ['win:' + a.id, 'win:' + a2.id].sort((x, y) => keys.indexOf(x) - keys.indexOf(y)), 'çocuk satırlar ebeveynin hemen altında olmalı');
    t.ok(keys.slice(gi + 1, gi + 3).every((k) => /^win:/.test(k)), 'çocuk satırlar: ' + keys.slice(gi + 1, gi + 3));
    t.mouse(t.$('.tm-proc .tm-body', root), 'mouseleave');
    a2.forceClose();
    [a, b, c].forEach((w) => w.forceClose());
    win.forceClose();
  });

  function PAGES() { return ['processes', 'performance', 'history', 'details']; }
})();
