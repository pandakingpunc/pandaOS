/* Icon set tests (C5) + a visual gallery.
   The last test appends a fixed full-screen gallery (kept only when icons is the last suite of test=) (every icon at 48 / 24 / 16 px on a dark and a light
   panel side by side). Screenshot it with:
     bash tools/shot.sh /tmp/gallery.png "fast=1&test=icons" 1440x1300
   Optional gallery params: gset=color|glyph|all (default all), gsize=<big px, default 48>, gtheme=both|dark|light,
   gnames=name1,name2 (only these icons, handy together with a large gsize to inspect details) */
(function () {
  'use strict';

  const COLOR_NAMES = ('files terminal notepad calculator music minesweeper game2048 settings paint taskmanager clock '
    + 'trash trash-full folder folder-open file file-text file-code file-image file-audio file-app computer panda avatar error warning info').split(' ');

  const GLYPH_NAMES = ('close minimize maximize restore search chevron-left chevron-right chevron-up chevron-down arrow-up arrow-left arrow-right '
    + 'refresh plus minus folder-plus file-plus delete edit copy cut paste info-glyph check x bell bell-off volume volume-low volume-mute wifi battery '
    + 'power lock restart logout sun moon grid list play pause stop next prev shuffle repeat home star flag bomb undo redo save open gear palette image '
    + 'note monitor cpu memory time alarm timer stopwatch globe download upload eye eye-off menu more sort filter desktop document brush eraser bucket '
    + 'line rect ellipse pencil zoom-in zoom-out terminal-glyph sidebar external').split(' ');

  const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml');
  const idsOf = (svg) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const refsOf = (svg) => [...svg.matchAll(/url\(#([^)]+)\)/g), ...svg.matchAll(/\bhref="#([^"]+)"/g)].map((m) => m[1]);

  PandaTest.test('PandaOS.icons API mevcut', (t) => {
    const I = PandaOS.icons;
    t.ok(I, 'PandaOS.icons yok');
    for (const fn of ['get', 'el', 'has', 'forFile']) t.eq(typeof I[fn], 'function', `icons.${fn}`);
  });

  PandaTest.test('sözleşmedeki her simge adı tanımlı', (t) => {
    const I = PandaOS.icons;
    const missing = COLOR_NAMES.concat(GLYPH_NAMES).filter((n) => !I.has(n));
    t.eq(missing, [], 'eksik simgeler');
    t.eq(COLOR_NAMES.length, 27, 'renkli simge sayısı');
    t.eq(GLYPH_NAMES.length, 89, 'glif sayısı');
    t.ok(!I.has('yok-boyle-bir-simge') && !I.has('') && !I.has(null) && !I.has('constructor'), 'has() sahte ad için true döndü');
  });

  PandaTest.test('her simge geçerli SVG üretiyor', (t) => {
    const I = PandaOS.icons;
    for (const name of COLOR_NAMES.concat(GLYPH_NAMES)) {
      const svg = I.get(name);
      t.ok(typeof svg === 'string' && svg.startsWith('<svg'), `${name}: <svg ile başlamıyor`);
      const doc = parse(svg);
      t.ok(!doc.querySelector('parsererror'), `${name}: SVG ayrıştırılamadı`);
      const root = doc.documentElement;
      t.eq(root.nodeName, 'svg', `${name}: kök öğe`);
      const isColor = COLOR_NAMES.includes(name);
      t.eq(root.getAttribute('viewBox'), isColor ? '0 0 48 48' : '0 0 24 24', `${name}: viewBox`);
      if (isColor) t.ok(!/currentColor/.test(svg), `${name}: renkli simgede currentColor olmamalı`);
      else {
        t.eq(root.getAttribute('stroke'), 'currentColor', `${name}: stroke`);
        t.eq(root.getAttribute('fill'), 'none', `${name}: fill`);
        t.eq(root.getAttribute('stroke-width'), '1.75', `${name}: stroke-width`);
      }
      const ids = idsOf(svg);
      for (const ref of refsOf(svg)) t.ok(ids.includes(ref), `${name}: çözümlenmeyen referans #${ref}`);
      t.eq(new Set(ids).size, ids.length, `${name}: aynı SVG içinde yinelenen id`);
    }
  });

  PandaTest.test('id\'ler her get() çağrısında benzersiz', (t) => {
    const I = PandaOS.icons;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(host);
    try {
      let withIds = 0;
      for (const name of COLOR_NAMES.concat(GLYPH_NAMES)) {
        const a = I.get(name);
        const b = I.get(name);
        const idsA = idsOf(a);
        const idsB = idsOf(b);
        if (!idsA.length) { t.eq(a, b, `${name}: id'siz simge iki çağrıda aynı olmalı`); continue; }
        withIds++;
        t.ok(idsA.length === idsB.length, `${name}: id sayısı`);
        t.ok(idsA.every((id) => !idsB.includes(id)), `${name}: iki çağrı aynı id'leri paylaşıyor`);
        // references of each copy must point at its own ids
        for (const ref of refsOf(a)) t.ok(idsA.includes(ref), `${name}: A kopyası kendi dışına referans veriyor (#${ref})`);
        for (const ref of refsOf(b)) t.ok(idsB.includes(ref), `${name}: B kopyası kendi dışına referans veriyor (#${ref})`);
        const wrap = document.createElement('div');
        wrap.innerHTML = a + b;
        host.appendChild(wrap);
      }
      t.ok(withIds >= 25, `id içeren simge sayısı beklenenden az (${withIds})`);
      // after mounting every copy, the document must not contain a single duplicated id
      const seen = new Set();
      const dupes = [];
      host.querySelectorAll('[id]').forEach((n) => { if (seen.has(n.id)) dupes.push(n.id); seen.add(n.id); });
      t.eq(dupes, [], 'DOM içinde yinelenen id\'ler');
      // a display:none copy must not break the visible one: gradient refs resolve inside the live DOM
      host.innerHTML = `<div style="display:none">${I.get('files')}</div>${I.get('files')}`;
      const live = host.children[1];
      const fillRef = /url\(#([^)]+)\)/.exec(live.querySelector('[fill^="url"]').getAttribute('fill'))[1];
      t.ok(live.querySelector(`[id="${fillRef}"]`), 'görünür kopya kendi gradient\'ini bulamıyor');
    } finally {
      host.remove();
    }
  });

  PandaTest.test('bilinmeyen ad: yedek simge + tek sefer console.warn (error değil)', (t) => {
    const I = PandaOS.icons;
    const origWarn = console.warn;
    const origErr = console.error;
    const warns = [];
    const errs = [];
    console.warn = (...a) => warns.push(a.join(' '));
    console.error = (...a) => errs.push(a.join(' '));
    try {
      const name = `bilinmeyen-${Date.now()}`;
      const a = I.get(name);
      const b = I.get(name);
      t.ok(a.startsWith('<svg') && b.startsWith('<svg'), 'yedek simge SVG olmalı');
      t.ok(!parse(a).querySelector('parsererror'), 'yedek simge geçerli SVG olmalı');
      t.eq(warns.length, 1, 'ad başına tek uyarı');
      t.ok(warns[0].includes(name), 'uyarı adı içermeli');
      I.get(null);
      I.get(undefined);
      I.get('');
      t.eq(errs.length, 0, 'console.error çağrılmamalı');
      t.ok(!I.has(name), 'has() false olmalı');
    } finally {
      console.warn = origWarn;
      console.error = origErr;
    }
  });

  PandaTest.test('ham <svg> olduğu gibi döner', (t) => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="a" r="4"/></svg>';
    t.eq(PandaOS.icons.get(raw), raw);
    t.eq(PandaOS.icons.get(`  ${raw}`), `  ${raw}`);
  });

  PandaTest.test('el(): boyut, sınıf, svg %100', (t) => {
    const I = PandaOS.icons;
    const def = I.el('folder');
    t.eq(def.tagName, 'SPAN');
    t.ok(def.classList.contains('p-icon'), 'p-icon sınıfı');
    t.eq([def.style.width, def.style.height], ['24px', '24px'], 'varsayılan boyut 24');
    const el = I.el('files', { size: 40, className: 'ekstra' });
    t.eq([el.style.width, el.style.height], ['40px', '40px']);
    t.ok(el.classList.contains('p-icon') && el.classList.contains('ekstra'), 'className eklenmedi');
    const svg = el.firstElementChild;
    t.eq(svg.tagName.toLowerCase(), 'svg');
    t.eq([svg.getAttribute('width'), svg.getAttribute('height')], ['100%', '100%']);
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    el.remove();
    t.eq([Math.round(r.width), Math.round(r.height)], [40, 40], 'ölçülen kapsayıcı boyutu');
    t.eq([Math.round(sr.width), Math.round(sr.height)], [40, 40], 'svg kapsayıcıyı doldurmalı');
    t.eq(I.el('x', { size: '2em' }).style.width, '2em', 'sayı olmayan boyut');
    t.ok(I.el('yok-bu-simge-da').firstElementChild, 'bilinmeyen adla da svg dönmeli');
  });

  PandaTest.test('forFile eşlemesi (Stat nesnesi)', (t) => {
    const I = PandaOS.icons;
    const f = (ext, extra) => I.forFile(Object.assign({ type: 'file', ext, name: `a${ext}`, path: `/tmp/__yok__/a${ext}` }, extra));
    t.eq(I.forFile({ type: 'dir', ext: '', name: 'Belgeler', path: '/yok/Belgeler' }), 'folder');
    for (const e of ['.txt', '.md', '.log']) t.eq(f(e), 'file-text', e);
    for (const e of ['.js', '.css', '.html', '.json', '.csv']) t.eq(f(e), 'file-code', e);
    for (const e of ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']) t.eq(f(e), 'file-image', e);
    for (const e of ['.pmus', '.mp3', '.wav']) t.eq(f(e), 'file-audio', e);
    t.eq(f('.xyz'), 'file');
    t.eq(f(''), 'file');
    t.eq(f('.PNG'), 'file-image', 'büyük harfli uzantı');
    t.eq(I.forFile({ type: 'file', name: 'foto.JPG' }), 'file-image', 'ext yokken addan türetme');
    t.eq(I.forFile({ type: 'file', name: '.gizli' }), 'file', 'uzantısız gizli dosya');
    t.eq(f('.app'), 'file-app', 'hedefi olmayan .app');
    for (const n of ['folder', 'file-text', 'file-code', 'file-image', 'file-audio', 'file-app', 'file']) t.ok(I.has(n), n);
  });

  PandaTest.test('forFile eşlemesi (yol dizesi)', (t) => {
    const I = PandaOS.icons;
    t.eq(I.forFile('/yok/__x__/notlar.txt'), 'file-text');
    t.eq(I.forFile('/yok/__x__/Foto.PNG'), 'file-image');
    t.eq(I.forFile('/yok/__x__/sarki.pmus'), 'file-audio');
    t.eq(I.forFile('/yok/__x__/kod.js'), 'file-code');
    t.eq(I.forFile('/yok/__x__/readme'), 'file');
    t.eq(I.forFile('/yok/__x__/Kisayol.app'), 'file-app');
    t.eq(I.forFile('/yok/__x__/klasor/'), 'folder', 'sonda / olan yol klasördür');
    t.eq(I.forFile('/'), PandaOS.fs ? 'folder' : 'file', 'kök yolu');
    t.ok(['trash', 'trash-full'].includes(I.forFile('trash:')), 'trash:');
    t.eq(I.forFile(null), 'file');
    t.eq(I.forFile(undefined), 'file');
    if (PandaOS.fs && PandaOS.fs.isDir && PandaOS.fs.exists(PandaOS.fs.HOME)) {
      t.eq(I.forFile(PandaOS.fs.HOME), 'folder', 'gerçek klasör yolu');
    }
  });

  PandaTest.test('forFile: .app hedef uygulamanın simgesini kullanır', (t) => {
    const I = PandaOS.icons;
    const fs = PandaOS.fs;
    if (!fs || typeof fs.writeFile !== 'function' || typeof fs.exists !== 'function') return; // vfs henüz yok: atla
    const path = '/tmp/__icons_test__.app';
    const origGet = PandaOS.apps.get;
    PandaOS.apps.get = function (id) {
      if (id === '__icons_app') return { id, icon: 'star' };
      if (id === '__icons_raw') return { id, icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"></svg>' };
      return origGet.call(PandaOS.apps, id);
    };
    try {
      fs.writeFile(path, JSON.stringify({ appId: '__icons_app' }));
      t.eq(I.forFile(path), 'star', 'yol dizesi');
      t.eq(I.forFile(fs.stat(path)), 'star', 'Stat nesnesi');
      fs.writeFile(path, JSON.stringify({ appId: '__icons_raw' }));
      t.ok(I.forFile(path).startsWith('<svg'), 'ham svg ikonu aynen döner');
      fs.writeFile(path, JSON.stringify({ appId: '__kayitli_degil__' }));
      t.eq(I.forFile(path), 'file-app', 'bilinmeyen uygulama');
      fs.writeFile(path, 'bozuk json {');
      t.eq(I.forFile(path), 'file-app', 'bozuk içerik');
      // a real registered app
      const real = PandaOS.apps.list().find((a) => a.icon && I.has(a.icon));
      if (real) {
        fs.writeFile(path, JSON.stringify({ appId: real.id }));
        t.eq(I.forFile(path), real.icon, `${real.id} kısayolu`);
      }
    } finally {
      PandaOS.apps.get = origGet;
      try { fs.remove(path); } catch (e) { /* ignore */ }
    }
  });

  PandaTest.test('dataUrl ve names yardımcıları', (t) => {
    const I = PandaOS.icons;
    const url = I.dataUrl('check', { color: '#ff0000' });
    t.ok(url.startsWith('data:image/svg+xml'), 'data URL');
    const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    t.ok(svg.includes('stroke="#ff0000"') && !svg.includes('currentColor'), 'renk uygulanmalı');
    t.ok(I.names('color').length === COLOR_NAMES.length, 'renkli ad listesi');
    t.ok(I.names('glyph').length >= GLYPH_NAMES.length, 'glif ad listesi');
    t.ok(!I.names().includes('__fallback'), 'yedek simge listede görünmemeli');
  });

  // ---------------------------------------------------------------- gallery (kept in the DOM on purpose)
  PandaTest.test('galeri oluştur', (t) => {
    const I = PandaOS.icons;
    const q = PandaOS.params;
    const set = q.get('gset') || 'all';
    const big = parseInt(q.get('gsize'), 10) || 48;
    const themes = (q.get('gtheme') || 'both') === 'both' ? ['dark', 'light'] : [q.get('gtheme')];
    document.getElementById('icons-gallery')?.remove();

    const root = document.createElement('div');
    root.id = 'icons-gallery';
    root.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;overflow:hidden;font:11px/1.2 "Segoe UI",system-ui,sans-serif;';
    const PAL = {
      dark: { bg: '#1d1f25', fg: '#eceef3', mute: '#8b92a1', line: 'rgba(255,255,255,.08)', cell: 'rgba(255,255,255,.035)' },
      light: { bg: '#f4f5f8', fg: '#1b1e24', mute: '#6a7180', line: 'rgba(0,0,0,.09)', cell: 'rgba(0,0,0,.03)' }
    };
    const cw = Math.max(92, big + 24 + 16 + 40);

    function section(title, names, pal) {
      const sec = document.createElement('section');
      const h = document.createElement('div');
      h.textContent = `${title} (${names.length})`;
      h.style.cssText = `font-weight:600;font-size:12px;margin:8px 0 6px;color:${pal.mute};text-transform:uppercase;letter-spacing:.06em;`;
      sec.appendChild(h);
      const grid = document.createElement('div');
      grid.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(${cw}px,1fr));gap:4px;`;
      names.forEach((name) => {
        const cell = document.createElement('div');
        cell.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 2px 5px;border-radius:8px;background:${pal.cell};color:${pal.fg};`;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-end;gap:8px;';
        [big, 24, 16].forEach((s) => row.appendChild(I.el(name, { size: s })));
        const label = document.createElement('div');
        label.textContent = name;
        label.style.cssText = `font-size:10px;color:${pal.mute};white-space:nowrap;`;
        cell.append(row, label);
        grid.appendChild(cell);
      });
      sec.appendChild(grid);
      return sec;
    }

    themes.forEach((theme) => {
      const pal = PAL[theme];
      const panel = document.createElement('div');
      panel.dataset.theme = theme;
      panel.style.cssText = `flex:1 1 0;min-width:0;overflow:auto;padding:10px 12px;background:${pal.bg};color:${pal.fg};border-right:1px solid ${pal.line};`;
      const title = document.createElement('div');
      title.textContent = `PandaOS simge seti - ${theme === 'dark' ? 'koyu' : 'açık'} (${big} / 24 / 16 px)`;
      title.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:2px;';
      panel.appendChild(title);
      const only = (q.get('gnames') || '').split(',').filter(Boolean);
      if (only.length) panel.appendChild(section('Seçili', only, pal));
      else {
        if (set === 'all' || set === 'color') panel.appendChild(section('Renkli', I.names('color'), pal));
        if (set === 'all' || set === 'glyph') panel.appendChild(section('Glifler', I.names('glyph'), pal));
      }
      root.appendChild(panel);
    });
    document.body.appendChild(root);
    t.ok(root.querySelectorAll('.p-icon').length > 0, 'galeri boş');
    // The gallery only stays (for screenshots) when this is the last suite; otherwise its full-screen
    // overlay would swallow the clicks of every suite that runs after it.
    const suites = (q.get('test') || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (suites[suites.length - 1] !== 'icons') root.remove();
  });
})();
