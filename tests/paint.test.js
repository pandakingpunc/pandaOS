/* Çizim (Paint) tests. Run: bash tools/test.sh paint */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T = window.PandaTest;
  const fs = P.fs;
  const PICS = '/home/panda/Resimler';

  const q = (win, sel) => win.body.querySelector(sel);
  const qa = (win, sel) => [...win.body.querySelectorAll(sel)];
  const RED = [237, 28, 36, 255];
  const BLUE = [63, 72, 204, 255];
  const WHITE = [255, 255, 255, 255];
  const BLACK = [0, 0, 0, 255];
  const YELLOW = [255, 242, 0, 255];
  const hexOf = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');

  // ------------------------------------------------------------------ helpers
  function px(win, x, y) {
    const d = win.state.paint.canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }
  const same = (a, b, tol = 0) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  /** colour check with a small tolerance (anti-aliased strokes are not bit-exact) */
  const col = (t, win, x, y, exp, msg, tol = 6) => {
    const got = px(win, x, y);
    t.ok(same(got, exp, tol), `${msg || 'piksel'} (${x},${y}): beklenen ${JSON.stringify(exp)}, gelen ${JSON.stringify(got)}`);
  };

  function countPixels(win, x, y, w, h, pred) {
    const d = win.state.paint.canvas.getContext('2d').getImageData(x, y, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (pred([d[i], d[i + 1], d[i + 2], d[i + 3]])) n++;
    return n;
  }

  /** dispatches a pointer event on the overlay at canvas coordinates (x, y) */
  function ptr(win, type, x, y, o) {
    o = o || {};
    const ov = q(win, '.pt-overlay');
    const r = ov.getBoundingClientRect();
    const z = r.width / ov.width;
    ov.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: r.left + x * z, clientY: r.top + y * z, pointerId: o.pointerId || 1, pointerType: 'mouse', isPrimary: true,
      button: o.button || 0, buttons: type === 'pointerup' ? 0 : (o.button === 2 ? 2 : 1),
      shiftKey: !!o.shift
    }));
  }

  function stroke(win, pts, o) {
    ptr(win, 'pointerdown', pts[0][0], pts[0][1], o);
    for (let i = 1; i < pts.length; i++) ptr(win, 'pointermove', pts[i][0], pts[i][1], o);
    const l = pts[pts.length - 1];
    ptr(win, 'pointerup', l[0], l[1], o);
  }

  const dot = (win, x, y, o) => stroke(win, [[x, y]], o);

  function line(a, b, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    return pts;
  }

  function setRange(input, v) {
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const toolBtn = (win, id) => q(win, `.pt-tool[data-tool="${id}"]`);
  const swatch = (win, hex) => q(win, `.pt-color[data-color="${hex}"]`);
  const pickTool = (t, win, id) => t.click(toolBtn(win, id));
  const setPrimary = (t, win, hex) => t.click(swatch(win, hex));
  const setSecondary = (t, win, hex) => t.contextmenu(swatch(win, hex));
  const setFill = (t, win, mode) => t.click(q(win, `.pt-fillseg [data-fill="${mode}"]`));
  const setSize = (win, v) => setRange(q(win, '.pt-size'), v);
  const cmd = (win, label) => qa(win, '.pt-cmd').find((b) => b.getAttribute('aria-label') === label);
  const dirtyTitle = (win) => win.getTitle();

  const dlgCards = () => [...document.querySelectorAll('#dialog-layer .dlg-card')];
  const topDlg = () => { const c = dlgCards(); return c[c.length - 1]; };
  const dlgButton = (label) => [...(topDlg() || document).querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const sheetOf = (win) => q(win, '.pt-modal');
  const sheetBtn = (win, label) => qa(win, '.pt-modal button').find((b) => b.textContent.trim() === label);

  function clearPics() {
    try { fs.list(PICS).forEach((s) => fs.remove(s.path, { recursive: true })); } catch (e) { /* ignore */ }
  }

  function dataUrl(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    if (paint) paint(g);
    return c.toDataURL('image/png');
  }

  async function launch(t, args) {
    P.storage.remove('app.paint');
    const win = P.apps.launch('paint', args || {});
    t.ok(win, 'pencere açıldı');
    await t.waitFor(() => win.state.paint && !win.isClosed(), 2000, 'uygulama başlamadı');
    return win;
  }

  async function savePicker(t, name) {
    const card = await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'), 3000, 'dosya seçici açılmadı');
    if (name) card.querySelector('.fp-name-input').value = name;
    t.click(card.querySelector('.dlg-primary'));
    await t.waitFor(() => !document.querySelector('#dialog-layer .dlg-card.fp'), 3000, 'dosya seçici kapanmadı');
  }

  function P1(name, fn) {
    T.test(name, async (t) => {
      P.dialog.closeAll();
      P.contextMenu.hide();
      P.wm.closeAll();
      clearPics();
      P.notify.clear();
      const wallpaper = P.settings.get('wallpaper');
      const origWrite = fs.writeFile;
      try {
        await fn(t);
      } finally {
        fs.writeFile = origWrite;
        P.dialog.closeAll();
        P.contextMenu.hide();
        P.wm.closeAll();
        P.settings.set('wallpaper', wallpaper);
        clearPics();
        P.storage.remove('app.paint');
      }
    });
  }

  // ================================================================== registration + layout
  P1('kayıt: kimlik, ad, simge, dosya türü, pencere boyutları', (t) => {
    const def = P.apps.get('paint');
    t.ok(def, 'kayıtlı değil');
    t.eq([def.id, def.name, def.icon, def.singleInstance, def.fileTypes], ['paint', 'Çizim', 'paint', false, ['.png']]);
    t.eq([def.window.width, def.window.height, def.window.minWidth, def.window.minHeight], [980, 660, 600, 420]);
    t.eq(P.apps.forExtension('.png').map((d) => d.id), ['paint']);
  });

  P1('açılış: başlık, tuval, şerit grupları, durum çubuğu', async (t) => {
    const win = await launch(t);
    t.eq(win.getTitle(), 'Adsız - Çizim');
    t.ok(win.body.classList.contains('app-paint'));
    const cv = win.state.paint.canvas;
    t.eq([cv.width, cv.height], [800, 600]);
    t.eq(px(win, 0, 0), WHITE);
    t.eq(px(win, 799, 599), WHITE);
    t.eq(qa(win, '.pt-cmd .pt-cmd-label').map((s) => s.textContent), ['Yeni', 'Aç', 'Kaydet', 'Farklı kaydet', 'Arka plan yap', 'Geri al', 'Yinele']);
    t.eq(qa(win, '.pt-gcap').map((s) => s.textContent), ['Araçlar', 'Şekiller', 'Boyut', 'Renkler']);
    t.eq(qa(win, '.pt-tool').map((b) => b.dataset.tool), ['pencil', 'brush', 'eraser', 'bucket', 'dropper', 'text', 'line', 'rect', 'ellipse', 'rrect', 'arrow']);
    t.eq(qa(win, '.pt-tool').map((b) => b.getAttribute('aria-label')),
      ['Kalem', 'Fırça', 'Silgi', 'Kova', 'Damlalık', 'Metin', 'Çizgi', 'Dikdörtgen', 'Elips', 'Yuvarlak dikdörtgen', 'Ok']);
    t.eq(qa(win, '.pt-color').length, 28, '28 renkli palet');
    t.eq(q(win, '.pt-sizebtn').textContent, '800 × 600 px');
    t.eq(q(win, '.pt-zoomlabel').textContent, '100%');
    t.eq(q(win, '.pt-toolname').textContent, 'Fırça');
    t.ok(q(win, '.pt-handle.pt-h-se'), 'sağ alt köşede yeniden boyutlandırma tutamacı');
    t.ok(q(win, '.pt-ribbon .p-range.pt-size'), 'boyut kaydırıcısı');
    t.eq([q(win, '.pt-size').min, q(win, '.pt-size').max], ['1', '64']);
    t.ok(q(win, '.pt-fillseg'), 'dolgu anahtarı');
    t.ok(cmd(win, 'Geri al').disabled && cmd(win, 'Yinele').disabled, 'geçmiş boşken geri al / yinele kapalı');
    t.eq(win.dirty, false);
    win.forceClose();
  });

  P1('çok örnekli: iki pencere bağımsız çalışır', async (t) => {
    const a = await launch(t);
    const b = P.apps.launch('paint');
    await t.waitFor(() => b.state.paint);
    t.ok(a !== b);
    t.eq(P.apps.running('paint').length, 2);
    dot(a, 100, 100);
    t.ok(a.state.paint.isDirty());
    t.ok(!b.state.paint.isDirty());
    t.eq(px(b, 100, 100), WHITE);
    a.forceClose();
    b.forceClose();
  });

  // ================================================================== drawing tools
  P1('fırça: sol tuş birincil, sağ tuş ikincil renkle çizer, yuvarlak uçlu kalın çizgi', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 8);
    setPrimary(t, win, '#ed1c24');
    setSecondary(t, win, '#3f48cc');
    stroke(win, line([100, 100], [200, 100], 10));
    col(t, win, 150, 100, RED, 'çizgi ortası');
    col(t, win, 150, 102, RED, 'yarıçap içi');
    col(t, win, 150, 108, WHITE, 'çizgi dışı');
    col(t, win, 150, 92, WHITE, 'çizgi dışı (üst)');
    col(t, win, 98, 100, RED, 'yuvarlak uç soldan taşar');
    col(t, win, 90, 100, WHITE);
    stroke(win, line([100, 200], [200, 200], 10), { button: 2 });
    col(t, win, 150, 200, BLUE, 'sağ tuş ikincil renk');
    t.eq(win.state.paint.historyLength(), 2, 'her çizgi tek geri alma adımı');
    // single click = a round dot
    dot(win, 300, 300);
    col(t, win, 300, 300, RED);
    col(t, win, 302, 300, RED);
    col(t, win, 310, 300, WHITE);
    win.forceClose();
  });

  P1('fırça: yumuşatma — köşeli noktalar eğriye dönüşür, çizgi kesintisizdir', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 6);
    setPrimary(t, win, '#000000');
    stroke(win, [[100, 100], [160, 100], [160, 160], [220, 160]]);
    // start and end are on the path, a corner point is rounded off (path stays inside the control polygon)
    t.eq(px(win, 110, 100), BLACK);
    t.eq(px(win, 215, 160), BLACK);
    t.ok(countPixels(win, 90, 90, 150, 90, (c) => c[0] < 128) > 500, 'çizgi boyanmış');
    // the sharp corner (160,100) is cut: the pixel exactly on the control point is white-ish or partially covered
    t.ok(px(win, 168, 96)[0] > 200, 'dış köşe yuvarlatıldı');
    // no gaps: walk along the first segment
    for (let x = 105; x < 150; x += 5) t.ok(px(win, x, 100)[0] < 100, `boşluk var x=${x}`);
    win.forceClose();
  });

  P1('kalem: 1 piksel, kenar yumuşatma yok, boyut kaydırıcısı kapalı', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'pencil');
    t.ok(q(win, '.pt-size').disabled, 'kalemde boyut sabit');
    t.eq(q(win, '.pt-ribbon .pt-srow .pt-val').textContent, '1 px');
    setPrimary(t, win, '#000000');
    stroke(win, [[50.4, 50.4], [60.4, 50.4]]);
    for (let x = 50; x <= 60; x++) t.eq(px(win, x, 50), BLACK, `x=${x}`);
    t.eq(px(win, 55, 49), WHITE);
    t.eq(px(win, 55, 51), WHITE);
    t.eq(px(win, 49, 50), WHITE);
    t.eq(px(win, 61, 50), WHITE);
    // diagonal (Bresenham) – no anti-aliasing: only pure black or pure white pixels
    stroke(win, [[10, 10], [20, 20]]);
    t.eq(px(win, 15, 15), BLACK);
    t.eq(px(win, 15, 14), WHITE);
    const grey = countPixels(win, 0, 0, 100, 100, (c) => c[0] > 0 && c[0] < 255);
    t.eq(grey, 0, 'ara ton yok');
    stroke(win, line([70, 70], [80, 72], 6), { button: 2 });
    t.eq(px(win, 75, 71), WHITE, 'ikincil renk beyazken fark yok (sağ tuş çalışıyor)');
    win.forceClose();
  });

  P1('silgi: ikincil rengi (varsayılan beyaz) boyar', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 20);
    setPrimary(t, win, '#ed1c24');
    stroke(win, line([100, 100], [300, 100], 10));
    col(t, win, 200, 100, RED);
    pickTool(t, win, 'eraser');
    t.eq(q(win, '.pt-toolname').textContent, 'Silgi');
    setSize(win, 10);
    stroke(win, line([150, 100], [250, 100], 10));
    col(t, win, 200, 100, WHITE, 'silindi');
    col(t, win, 200, 107, RED, 'silgi dışı (boyut 10)');
    col(t, win, 120, 100, RED);
    setSecondary(t, win, '#fff200');
    stroke(win, line([100, 100], [120, 100], 4));
    col(t, win, 110, 100, YELLOW, 'ikincil renk sarı');
    // erasing white on white changes nothing and adds no history
    const n = win.state.paint.historyLength();
    stroke(win, line([500, 500], [520, 500], 4));
    col(t, win, 510, 500, YELLOW);
    setSecondary(t, win, '#ffffff');
    const m = win.state.paint.historyLength();
    stroke(win, line([600, 500], [620, 500], 4));
    t.eq(win.state.paint.historyLength(), m, 'değişmeyen darbe geçmişe eklenmez');
    t.ok(n >= 2);
    win.forceClose();
  });

  P1('boyut: araç başına ayrı, kaydırıcı ve önizleme noktası', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 30);
    t.eq(q(win, '.pt-ribbon .pt-srow .pt-val').textContent, '30 px');
    t.eq(q(win, '.pt-dot').style.width, '28px', 'önizleme noktası en çok 28px');
    setSize(win, 12);
    t.eq(q(win, '.pt-dot').style.width, '12px');
    pickTool(t, win, 'eraser');
    t.eq(q(win, '.pt-size').value, '18', 'silginin kendi boyutu');
    setSize(win, 40);
    pickTool(t, win, 'brush');
    t.eq(q(win, '.pt-size').value, '12', 'fırça boyutu korunur');
    pickTool(t, win, 'bucket');
    t.ok(q(win, '.pt-size').disabled, 'kovada boyut yok');
    t.ok(!q(win, '.pt-tol').disabled, 'kovada tolerans açık');
    pickTool(t, win, 'brush');
    t.ok(q(win, '.pt-tol').disabled);
    setSize(win, 99);
    t.eq(win.state.paint.prefs.sizes.brush, 64, '64 üst sınır');
    setSize(win, 0);
    t.eq(win.state.paint.prefs.sizes.brush, 1, '1 alt sınır');
    win.forceClose();
  });

  // ================================================================== shapes
  P1('dikdörtgen: çerçeve / dolgu / ikisi, sağ tuş renkleri tersler', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'rect');
    t.ok(q(win, '.pt-ribbon').classList.contains('pt-shape-tool'));
    setPrimary(t, win, '#ed1c24');
    setSecondary(t, win, '#fff200');
    // outline
    setFill(t, win, 'outline');
    stroke(win, [[20, 20], [100, 80]]);
    t.eq(px(win, 21, 50), RED, 'sol kenar');
    t.eq(px(win, 99, 50), RED, 'sağ kenar');
    t.eq(px(win, 60, 21), RED, 'üst kenar');
    t.eq(px(win, 60, 50), WHITE, 'iç boş');
    t.eq(px(win, 19, 50), WHITE, 'dış boş');
    // fill only
    setFill(t, win, 'fill');
    stroke(win, [[200, 20], [280, 80]]);
    t.eq(px(win, 240, 50), RED);
    t.eq(px(win, 200, 20), RED);
    t.eq(px(win, 280, 80), RED);
    t.eq(px(win, 199, 20), WHITE);
    t.eq(px(win, 281, 50), WHITE);
    // both: outline primary, inside secondary
    setFill(t, win, 'both');
    stroke(win, [[400, 20], [480, 80]]);
    t.eq(px(win, 401, 50), RED);
    t.eq(px(win, 440, 50), YELLOW);
    // right button swaps the roles
    stroke(win, [[600, 20], [680, 80]], { button: 2 });
    t.eq(px(win, 601, 50), YELLOW);
    t.eq(px(win, 640, 50), RED);
    t.eq(win.state.paint.historyLength(), 4);
    win.forceClose();
  });

  P1('şekiller: elips, yuvarlak dikdörtgen, çizgi, ok', async (t) => {
    const win = await launch(t);
    setPrimary(t, win, '#3f48cc');
    setFill(t, win, 'fill');
    pickTool(t, win, 'ellipse');
    stroke(win, [[200, 200], [300, 260]]);
    t.eq(px(win, 250, 230), BLUE, 'merkez dolu');
    t.eq(px(win, 250, 201), BLUE, 'üst orta dolu');
    t.eq(px(win, 202, 202), WHITE, 'köşe boş (elips)');
    pickTool(t, win, 'rrect');
    stroke(win, [[400, 200], [500, 280]]);
    t.eq(px(win, 450, 240), BLUE);
    t.eq(px(win, 400, 200), WHITE, 'yuvarlak köşe');
    t.eq(px(win, 450, 200), BLUE, 'kenar ortası');
    t.eq(px(win, 400, 240), BLUE);
    setFill(t, win, 'outline');
    pickTool(t, win, 'line');
    setSize(win, 5);
    stroke(win, [[50, 400], [250, 400]]);
    t.eq(px(win, 150, 400), BLUE);
    t.eq(px(win, 150, 398), BLUE, 'kalınlık 5');
    t.eq(px(win, 150, 395), WHITE);
    pickTool(t, win, 'arrow');
    setSize(win, 3);
    stroke(win, [[300, 450], [400, 450]]);
    t.eq(px(win, 330, 450), BLUE, 'gövde');
    t.ok(px(win, 392, 454)[0] < 200, 'ok başı kanadı');
    t.eq(px(win, 380, 456), WHITE, 'ok başının gerisinde boşluk');
    t.ok(px(win, 399, 450)[0] < 200, 'uç');
    win.forceClose();
  });

  P1('şekiller: Shift ile kare, daire ve 45° çizgi', async (t) => {
    const win = await launch(t);
    setPrimary(t, win, '#ed1c24');
    setFill(t, win, 'fill');
    pickTool(t, win, 'rect');
    stroke(win, [[400, 400], [500, 430]], { shift: true });
    t.eq(px(win, 450, 480), RED, 'kare: yükseklik genişliğe eşitlendi');
    t.eq(px(win, 450, 505), WHITE);
    pickTool(t, win, 'ellipse');
    stroke(win, [[100, 400], [200, 420]], { shift: true });
    t.eq(px(win, 150, 450), RED, 'daire merkezi');
    t.eq(px(win, 102, 402), WHITE, 'daire köşesi boş');
    pickTool(t, win, 'line');
    setSize(win, 3);
    stroke(win, [[50, 100], [150, 40]], { shift: true });
    // 100,60 -> snapped to -45° (length 116): runs through x=90,y=60
    t.ok(px(win, 90, 60)[0] > 200 && px(win, 90, 60)[1] < 100, '45° çizgi üzerinde');
    t.eq(px(win, 120, 70), WHITE, 'eğimli çizgi dışında');
    pickTool(t, win, 'line');
    stroke(win, [[50, 200], [250, 215]], { shift: true });
    t.eq(px(win, 150, 200)[1], 28, 'yatay çizgiye kenetlendi');
    t.eq(px(win, 150, 208), WHITE);
    win.forceClose();
  });

  P1('şekiller: önizleme kaplamada, bırakınca işlenir; Escape iptal eder', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'rect');
    setPrimary(t, win, '#ed1c24');
    setFill(t, win, 'fill');
    ptr(win, 'pointerdown', 50, 50);
    ptr(win, 'pointermove', 150, 120);
    const ov = q(win, '.pt-overlay').getContext('2d');
    t.eq(Array.from(ov.getImageData(100, 80, 1, 1).data), RED, 'önizleme kaplamada');
    t.eq(px(win, 100, 80), WHITE, 'ana tuval henüz boş');
    ptr(win, 'pointerup', 150, 120);
    t.eq(px(win, 100, 80), RED);
    t.eq(Array.from(ov.getImageData(100, 80, 1, 1).data), [0, 0, 0, 0], 'kaplama temizlendi');
    // cancel with Escape
    ptr(win, 'pointerdown', 300, 300);
    ptr(win, 'pointermove', 400, 400);
    t.key(win.el, 'Escape');
    ptr(win, 'pointerup', 400, 400);
    t.eq(px(win, 350, 350), WHITE, 'iptal edildi');
    t.eq(win.state.paint.historyLength(), 1);
    // a click without dragging draws nothing
    ptr(win, 'pointerdown', 600, 100);
    ptr(win, 'pointerup', 600, 100);
    t.eq(win.state.paint.historyLength(), 1);
    win.forceClose();
  });

  // ================================================================== bucket, dropper
  P1('kova: kapalı alanı doldurur, sınırı aşmaz', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'rect');
    setPrimary(t, win, '#ed1c24');
    setFill(t, win, 'outline');
    stroke(win, [[100, 100], [300, 200]]);
    pickTool(t, win, 'bucket');
    setPrimary(t, win, '#3f48cc');
    dot(win, 200, 150);
    t.eq(px(win, 200, 150), BLUE);
    t.eq(px(win, 104, 104), BLUE, 'köşe dahil');
    t.eq(px(win, 101, 150), RED, 'çerçeve korunur');
    t.eq(px(win, 102, 102), RED, 'çerçeve köşesi korunur');
    t.eq(px(win, 50, 50), WHITE, 'dışarısı boş kalır');
    // outside area
    setPrimary(t, win, '#22b14c');
    dot(win, 10, 10);
    t.eq(px(win, 10, 10), '#22b14c' && [34, 177, 76, 255]);
    t.eq(px(win, 799, 599), [34, 177, 76, 255], 'tüm dış alan');
    t.eq(px(win, 200, 150), BLUE, 'iç alan etkilenmez');
    // right click fills with the secondary colour
    setSecondary(t, win, '#fff200');
    dot(win, 200, 150, { button: 2 });
    t.eq(px(win, 200, 150), YELLOW);
    const n = win.state.paint.historyLength();
    dot(win, 200, 150, { button: 2 });
    t.eq(win.state.paint.historyLength(), n, 'aynı renge doldurmak geçmiş eklemez');
    win.forceClose();
  });

  P1('kova: tolerans benzer renkleri doldurur', async (t) => {
    const win = await launch(t);
    // a light grey rectangle on white (difference 15/255 ≈ 6%)
    pickTool(t, win, 'rect');
    setFill(t, win, 'fill');
    setPrimary(t, win, '#e6e6e6');
    stroke(win, [[100, 100], [300, 200]]);
    pickTool(t, win, 'bucket');
    setPrimary(t, win, '#ed1c24');
    setRange(q(win, '.pt-tol'), 0);
    t.eq(q(win, '.pt-trow .pt-val').textContent, '0%');
    dot(win, 10, 10);
    t.eq(px(win, 10, 10), RED);
    t.eq(px(win, 200, 150), [230, 230, 230, 255], 'tolerans 0: gri alan ayrı');
    // undo, then with a generous tolerance the grey area is flooded as well
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq(px(win, 10, 10), WHITE);
    setRange(q(win, '.pt-tol'), 30);
    t.eq(win.state.paint.prefs.tolerance, 30);
    dot(win, 10, 10);
    t.eq(px(win, 200, 150), RED, 'tolerans 30: gri alan da dolar');
    t.eq(px(win, 799, 599), RED);
    // persisted
    t.eq(P.storage.get('app.paint').tolerance, 30);
    win.forceClose();
  });

  P1('kova: 1000×700 tuvalde hızlı ve doğru', async (t) => {
    const win = await launch(t);
    t.click(cmd(win, 'Yeni'));
    await t.waitFor(() => sheetOf(win));
    const [w, h] = qa(win, '.pt-modal input');
    w.value = '1000';
    h.value = '700';
    t.click(sheetBtn(win, 'Oluştur'));
    await t.waitFor(() => !sheetOf(win) && win.state.paint.canvas.width === 1000, 3000, 'yeni tuval oluşmadı');
    t.eq([win.state.paint.canvas.width, win.state.paint.canvas.height], [1000, 700]);
    // draw a spiral-ish barrier so the fill has non-trivial geometry
    pickTool(t, win, 'brush');
    setSize(win, 4);
    setPrimary(t, win, '#000000');
    for (let y = 40; y < 700; y += 40) stroke(win, line([0, y], [960, y], 4));
    for (let y = 60; y < 700; y += 80) stroke(win, line([960, y - 20], [960, y + 20], 2));
    pickTool(t, win, 'bucket');
    setPrimary(t, win, '#22b14c');
    const t0 = performance.now();
    dot(win, 500, 20);
    const dt = performance.now() - t0;
    t.eq(px(win, 500, 20), [34, 177, 76, 255]);
    t.eq(px(win, 5, 10), [34, 177, 76, 255]);
    t.eq(px(win, 500, 60), WHITE, 'diğer şerit boş');
    t.ok(dt < 1500, `doldurma çok yavaş: ${Math.round(dt)} ms`);
    const t1 = performance.now();
    dot(win, 990, 5, { button: 2 });
    t.ok(performance.now() - t1 < 1500, 'büyük alan doldurma');
    t.ok(win.state.paint.historyLength() > 2);
    win.forceClose();
  });

  P1('damlalık: sol tık birincil, sağ tık ikincil renk seçer', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'rect');
    setFill(t, win, 'fill');
    setPrimary(t, win, '#ed1c24');
    stroke(win, [[10, 10], [60, 60]]);
    setPrimary(t, win, '#3f48cc');
    stroke(win, [[100, 10], [150, 60]]);
    setPrimary(t, win, '#000000');
    pickTool(t, win, 'dropper');
    dot(win, 30, 30);
    t.eq(win.state.paint.prefs.primary, '#ed1c24');
    t.eq(q(win, '.pt-sw-primary').style.backgroundColor, 'rgb(237, 28, 36)');
    dot(win, 120, 30, { button: 2 });
    t.eq(win.state.paint.prefs.secondary, '#3f48cc');
    t.ok(swatch(win, '#ed1c24').classList.contains('is-primary'), 'paletteki renk işaretlenir');
    t.eq(win.state.paint.historyLength(), 2, 'damlalık geçmişe eklenmez');
    // dragging keeps sampling
    ptr(win, 'pointerdown', 30, 30);
    ptr(win, 'pointermove', 120, 30);
    t.eq(win.state.paint.prefs.primary, '#3f48cc');
    ptr(win, 'pointerup', 120, 30);
    win.forceClose();
  });

  // ================================================================== text
  P1('metin: tıkla, yaz, Enter ile uygula; boyut yazı boyutudur', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'text');
    setPrimary(t, win, '#000000');
    setSize(win, 40);
    t.eq(win.state.paint.prefs.sizes.text, 40);
    ptr(win, 'pointerdown', 100, 100);
    ptr(win, 'pointerup', 100, 100);
    const input = await t.waitFor(() => q(win, '.pt-text'), 1000, 'metin kutusu açılmadı');
    t.eq(document.activeElement, input, 'odak metin kutusunda');
    t.eq(input.style.fontSize, '40px', 'yazı boyutu = boyut');
    t.eq(input.style.left, '100px');
    t.eq(input.style.top, '100px');
    t.type(input, 'Merhaba Çizim');
    t.eq(countPixels(win, 90, 90, 400, 80, (c) => c[0] < 128), 0, 'Enter öncesi tuvalde yok');
    t.key(input, 'Enter');
    t.ok(!q(win, '.pt-text'), 'kutu kapandı');
    const dark = countPixels(win, 95, 95, 500, 90, (c) => c[0] < 100 && c[1] < 100);
    t.ok(dark > 300, `yazı çizilmedi (${dark})`);
    t.eq(px(win, 50, 50), WHITE);
    // the glyphs sit inside a box starting at the click, one line of 40px
    t.eq(countPixels(win, 0, 0, 800, 95, (c) => c[0] < 200), 0, 'yazının üstü boş');
    t.eq(countPixels(win, 0, 160, 800, 100, (c) => c[0] < 200), 0, 'yazının altı boş');
    t.eq(win.state.paint.historyLength(), 1);
    t.ok(win.state.paint.isDirty());
    win.forceClose();
  });

  P1('metin: Escape iptal eder, boş metin çizilmez, sağ tık ikincil renk', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'text');
    setSize(win, 30);
    ptr(win, 'pointerdown', 60, 60);
    ptr(win, 'pointerup', 60, 60);
    let input = await t.waitFor(() => q(win, '.pt-text'));
    t.type(input, 'iptal');
    t.key(input, 'Escape');
    t.ok(!q(win, '.pt-text'));
    t.eq(win.state.paint.historyLength(), 0);
    ptr(win, 'pointerdown', 60, 60);
    ptr(win, 'pointerup', 60, 60);
    input = await t.waitFor(() => q(win, '.pt-text'));
    t.type(input, '   ');
    t.key(input, 'Enter');
    t.eq(win.state.paint.historyLength(), 0, 'boş metin eklenmez');
    // right button: secondary colour
    setSecondary(t, win, '#ed1c24');
    ptr(win, 'pointerdown', 60, 200, { button: 2 });
    ptr(win, 'pointerup', 60, 200, { button: 2 });
    input = await t.waitFor(() => q(win, '.pt-text'));
    t.eq(input.style.color, 'rgb(237, 28, 36)');
    t.type(input, 'HHHH');
    t.key(input, 'Enter');
    t.ok(countPixels(win, 55, 195, 200, 50, (c) => same(c, RED)) > 100, 'kırmızı yazı');
    win.forceClose();
  });

  P1('metin: başka yere tıklamak / araç değiştirmek metni uygular', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'text');
    setPrimary(t, win, '#3f48cc');
    setSize(win, 36);
    ptr(win, 'pointerdown', 40, 40);
    ptr(win, 'pointerup', 40, 40);
    let input = await t.waitFor(() => q(win, '.pt-text'));
    t.type(input, 'AAA');
    // second click elsewhere commits the first and opens a new field
    ptr(win, 'pointerdown', 40, 300);
    ptr(win, 'pointerup', 40, 300);
    t.eq(win.state.paint.historyLength(), 1, 'ilk metin uygulandı');
    t.ok(countPixels(win, 35, 35, 150, 60, (c) => same(c, BLUE)) > 100);
    input = await t.waitFor(() => q(win, '.pt-text') && q(win, '.pt-text').style.top === '300px' && q(win, '.pt-text'));
    t.type(input, 'BBB');
    pickTool(t, win, 'brush'); // tool change commits
    t.ok(!q(win, '.pt-text'));
    t.eq(win.state.paint.historyLength(), 2);
    t.ok(countPixels(win, 35, 295, 150, 60, (c) => same(c, BLUE)) > 100);
    win.forceClose();
  });

  // ================================================================== history
  P1('geri al / yinele: 40 adım, kısayollar Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'pencil');
    setPrimary(t, win, '#000000');
    for (let i = 0; i < 40; i++) dot(win, 10 + i * 5, 10);
    t.eq(win.state.paint.historyLength(), 40);
    t.ok(win.state.paint.isDirty());
    t.ok(win.getTitle().startsWith('• '), 'başlıkta nokta');
    t.ok(!cmd(win, 'Geri al').disabled);
    t.ok(cmd(win, 'Yinele').disabled);
    for (let i = 0; i < 40; i++) t.key(win.el, 'z', { ctrlKey: true });
    t.eq(win.state.paint.historyIndex(), 0);
    for (let i = 0; i < 40; i++) t.eq(px(win, 10 + i * 5, 10), WHITE, `geri alınmadı ${i}`);
    t.ok(!win.state.paint.isDirty(), 'başa dönünce temiz');
    t.eq(win.getTitle(), 'Adsız - Çizim');
    t.ok(cmd(win, 'Geri al').disabled);
    t.ok(!cmd(win, 'Yinele').disabled);
    t.key(win.el, 'y', { ctrlKey: true });
    t.eq(px(win, 10, 10), BLACK);
    t.eq(px(win, 15, 10), WHITE);
    t.key(win.el, 'z', { ctrlKey: true, shiftKey: true });
    t.eq(px(win, 15, 10), BLACK, 'Ctrl+Shift+Z yineler');
    for (let i = 0; i < 38; i++) t.key(win.el, 'y', { ctrlKey: true });
    t.eq(win.state.paint.historyIndex(), 40);
    t.eq(px(win, 10 + 39 * 5, 10), BLACK);
    // new action after undo drops the redo branch
    for (let i = 0; i < 5; i++) t.key(win.el, 'z', { ctrlKey: true });
    dot(win, 700, 500);
    t.eq(win.state.paint.historyLength(), 36);
    t.ok(cmd(win, 'Yinele').disabled);
    // buttons work too
    t.click(cmd(win, 'Geri al'));
    t.eq(px(win, 700, 500), WHITE);
    t.click(cmd(win, 'Yinele'));
    t.eq(px(win, 700, 500), BLACK);
    win.forceClose();
  });

  P1('geri al: şekil, kova ve boyut değişikliği tek adım; geçmiş sınırlıdır', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'ellipse');
    setFill(t, win, 'fill');
    setPrimary(t, win, '#ed1c24');
    stroke(win, [[100, 100], [200, 200]]);
    pickTool(t, win, 'bucket');
    setPrimary(t, win, '#3f48cc');
    dot(win, 10, 10);
    t.eq(px(win, 10, 10), BLUE);
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq(px(win, 10, 10), WHITE);
    t.eq(px(win, 150, 150), RED);
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq(px(win, 150, 150), WHITE);
    t.key(win.el, 'y', { ctrlKey: true });
    t.key(win.el, 'y', { ctrlKey: true });
    t.eq(px(win, 10, 10), BLUE);
    // long histories are capped (≥ 30 steps kept)
    pickTool(t, win, 'pencil');
    setPrimary(t, win, '#000000');
    for (let i = 0; i < 130; i++) dot(win, 5 + (i % 100) * 7, 300 + Math.floor(i / 100) * 5);
    const len = win.state.paint.historyLength();
    t.ok(len >= 30 && len <= 100, `geçmiş uzunluğu ${len}`);
    for (let i = 0; i < len; i++) t.key(win.el, 'z', { ctrlKey: true });
    t.eq(win.state.paint.historyIndex(), 0);
    t.ok(win.state.paint.isDirty(), 'eski adımlar atıldığı için başlangıç durumuna dönülemez: kirli kalır');
    win.forceClose();
  });

  // ================================================================== zoom
  P1('yakınlaştırma: 25–400%, düğmeler, Ctrl+tekerlek, klavye', async (t) => {
    const win = await launch(t);
    const sheet = q(win, '.pt-sheet');
    const label = () => q(win, '.pt-zoomlabel').textContent;
    t.eq(label(), '100%');
    t.eq(sheet.style.width, '800px');
    const zin = q(win, '.pt-stbtn[aria-label="Yakınlaştır"]');
    const zout = q(win, '.pt-stbtn[aria-label="Uzaklaştır"]');
    t.click(zin);
    t.eq(label(), '125%');
    t.eq(sheet.style.width, '1000px');
    for (let i = 0; i < 10; i++) t.click(zin);
    t.eq(label(), '400%');
    t.ok(zin.disabled, 'üst sınırda kapalı');
    t.eq(sheet.style.width, '3200px');
    t.ok(sheet.classList.contains('pt-pixel'), 'yüksek yakınlaştırmada piksel görünümü');
    for (let i = 0; i < 20; i++) t.click(zout);
    t.eq(label(), '25%');
    t.ok(zout.disabled, 'alt sınırda kapalı');
    t.eq(sheet.style.width, '200px');
    // ctrl + wheel
    const ov = q(win, '.pt-overlay');
    const wheel = (dy) => ov.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    wheel(-100);
    t.eq(label(), '33%');
    wheel(-100);
    t.eq(label(), '50%');
    wheel(100);
    t.eq(label(), '33%');
    // plain wheel does nothing to the zoom
    ov.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    t.eq(label(), '33%');
    // keyboard
    t.key(win.el, '0', { ctrlKey: true });
    t.eq(label(), '100%');
    t.key(win.el, '+', { ctrlKey: true });
    t.eq(label(), '125%');
    t.key(win.el, '-', { ctrlKey: true });
    t.key(win.el, '-', { ctrlKey: true });
    t.eq(label(), '75%');
    // slider
    setRange(q(win, '.pt-zoomrange'), 8);
    t.eq(label(), '200%');
    // menu
    t.click(q(win, '.pt-zoomlabel'));
    const items = [...document.querySelectorAll('#context-menu-layer .ctx-item')].map((i) => i.textContent.trim());
    t.ok(items.includes('Pencereye sığdır') && items.includes('100%') && items.includes('400%'), 'yakınlaştırma menüsü: ' + items.join('|'));
    P.contextMenu.hide();
    win.forceClose();
  });

  P1('yakınlaştırma: çizim koordinatları yakınlaştırmayla doğru eşlenir', async (t) => {
    const win = await launch(t);
    const zin = q(win, '.pt-stbtn[aria-label="Yakınlaştır"]');
    for (let i = 0; i < 3; i++) t.click(zin);
    t.eq(q(win, '.pt-zoomlabel').textContent, '200%');
    pickTool(t, win, 'brush');
    setSize(win, 6);
    setPrimary(t, win, '#ed1c24');
    dot(win, 120, 80);
    col(t, win, 120, 80, RED);
    col(t, win, 121, 80, RED);
    col(t, win, 130, 80, WHITE);
    ptr(win, 'pointermove', 200, 150);
    t.eq(q(win, '.pt-pos').textContent, '200, 150 px', 'imleç konumu belge koordinatında');
    // zoom out and draw again
    for (let i = 0; i < 5; i++) t.click(q(win, '.pt-stbtn[aria-label="Uzaklaştır"]'));
    t.eq(q(win, '.pt-zoomlabel').textContent, '67%');
    dot(win, 400, 300);
    col(t, win, 400, 300, RED);
    win.forceClose();
  });

  // ================================================================== canvas resize
  P1('tuval boyutu: köşe tutamacıyla büyütme / küçültme, geri alınabilir', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 10);
    setPrimary(t, win, '#ed1c24');
    dot(win, 700, 500);
    dot(win, 100, 100);
    const cv = win.state.paint.canvas;
    const handle = q(win, '.pt-h-se');
    const hr = handle.getBoundingClientRect();
    const hx = hr.left + hr.width / 2;
    const hy = hr.top + hr.height / 2;
    const hptr = (type, dx, dy) => handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: hx + dx, clientY: hy + dy, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
    }));
    hptr('pointerdown', 0, 0);
    hptr('pointermove', 60, 30);
    hptr('pointermove', 100, 50);
    t.eq(q(win, '.pt-sizebtn').textContent, '900 × 650 px', 'canlı boyut gösterimi');
    t.eq(q(win, '.pt-ghost').style.width, '900px', 'boyut hayaleti');
    t.eq([cv.width, cv.height], [800, 600], 'bırakmadan değişmez');
    hptr('pointerup', 100, 50);
    t.eq([cv.width, cv.height], [900, 650]);
    t.eq(q(win, '.pt-sheet').style.width, '900px');
    t.eq(px(win, 700, 500), RED, 'eski içerik korunur');
    t.eq(px(win, 850, 600), WHITE, 'yeni alan beyaz');
    t.eq(q(win, '.pt-sizebtn').textContent, '900 × 650 px');
    t.ok(win.state.paint.isDirty());
    // shrink: content outside is cropped
    const hr2 = handle.getBoundingClientRect();
    const sx = hr2.left + hr2.width / 2;
    const sy = hr2.top + hr2.height / 2;
    const h2 = (type, dx, dy) => handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: sx + dx, clientY: sy + dy, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
    }));
    h2('pointerdown', 0, 0);
    h2('pointermove', -500, -400);
    h2('pointerup', -500, -400);
    t.eq([cv.width, cv.height], [400, 250]);
    t.eq(px(win, 100, 100), RED);
    // undo restores both sizes and pixels
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq([cv.width, cv.height], [900, 650]);
    t.eq(px(win, 700, 500), RED);
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq([cv.width, cv.height], [800, 600]);
    t.eq(px(win, 700, 500), RED);
    t.eq(q(win, '.pt-sizebtn').textContent, '800 × 600 px');
    t.key(win.el, 'y', { ctrlKey: true });
    t.eq([cv.width, cv.height], [900, 650]);
    win.forceClose();
  });

  P1('tuval boyutu: durum çubuğundan ölçüyle; geçersiz değerler reddedilir', async (t) => {
    const win = await launch(t);
    t.click(q(win, '.pt-sizebtn'));
    await t.waitFor(() => sheetOf(win));
    const [w, h] = qa(win, '.pt-modal input');
    t.eq([w.value, h.value], ['800', '600']);
    w.value = '0';
    t.click(sheetBtn(win, 'Uygula'));
    t.ok(q(win, '.pt-error').textContent.includes('1 ile 4.000'), 'hata iletisi');
    t.ok(sheetOf(win), 'kutu açık kalır');
    w.value = '5000';
    t.click(sheetBtn(win, 'Uygula'));
    t.ok(sheetOf(win), 'çok büyük değer');
    w.value = '4000';
    h.value = '4000';
    t.click(sheetBtn(win, 'Uygula'));
    t.ok(q(win, '.pt-error').textContent.includes('çok büyük'), 'piksel sınırı: ' + q(win, '.pt-error').textContent);
    w.value = '321';
    h.value = '123';
    t.click(sheetBtn(win, 'Uygula'));
    await t.waitFor(() => !sheetOf(win));
    t.eq([win.state.paint.canvas.width, win.state.paint.canvas.height], [321, 123]);
    t.eq(q(win, '.pt-sizebtn').textContent, '321 × 123 px');
    win.forceClose();
  });

  // ================================================================== new image
  P1('yeni resim: boyut kutusu, varsayılan 800×600, özel boyut, iptal', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 20);
    dot(win, 100, 100);
    t.click(cmd(win, 'Yeni'));
    const sh = await t.waitFor(() => sheetOf(win));
    t.eq(sh.querySelector('.pt-card-title').textContent, 'Yeni resim');
    const [w, h] = qa(win, '.pt-modal input');
    t.eq([w.value, h.value], ['800', '600'], 'varsayılan boyut');
    t.eq(document.activeElement, w, 'odak genişlikte');
    t.ok(q(win, '.pt-root').inert, 'arka plan etkileşime kapalı');
    // preset button fills in the fields
    t.click(qa(win, '.pt-presets button').find((b) => b.textContent === '1024 × 768'));
    t.eq([w.value, h.value], ['1024', '768']);
    // Escape cancels
    t.key(w, 'Escape');
    t.ok(!sheetOf(win), 'Escape kapatır');
    t.ok(!q(win, '.pt-root').inert);
    t.eq(px(win, 100, 100), BLACK, 'tuval değişmedi');
    // create a custom size: the dirty doc asks for a save first
    t.click(cmd(win, 'Yeni'));
    await t.waitFor(() => sheetOf(win));
    const [w2, h2] = qa(win, '.pt-modal input');
    w2.value = '320';
    h2.value = '240';
    t.key(w2, 'Enter'); // Enter confirms
    await t.waitFor(() => sheetOf(win) && sheetOf(win).querySelector('.pt-card-title').textContent === 'Değişiklikler kaydedilsin mi?');
    t.click(sheetBtn(win, 'İptal'));
    await t.waitFor(() => !sheetOf(win));
    t.eq(win.state.paint.canvas.width, 800, 'iptal: tuval değişmedi');
    t.ok(win.state.paint.isDirty());
    t.click(cmd(win, 'Yeni'));
    await t.waitFor(() => sheetOf(win));
    const [w3, h3] = qa(win, '.pt-modal input');
    w3.value = '320';
    h3.value = '240';
    t.click(sheetBtn(win, 'Oluştur'));
    await t.waitFor(() => sheetOf(win) && sheetBtn(win, 'Kaydetme'));
    t.click(sheetBtn(win, 'Kaydetme'));
    await t.waitFor(() => !sheetOf(win) && win.state.paint.canvas.width === 320, 3000, 'yeni tuval oluşmadı');
    t.eq([win.state.paint.canvas.width, win.state.paint.canvas.height], [320, 240]);
    t.eq(px(win, 100, 100), WHITE);
    t.eq(win.getTitle(), 'Adsız - Çizim');
    t.ok(!win.state.paint.isDirty());
    t.eq(win.state.paint.historyLength(), 0, 'geçmiş sıfırlandı');
    t.eq(q(win, '.pt-sizebtn').textContent, '320 × 240 px');
    win.forceClose();
  });

  // ================================================================== save / open
  P1('kaydet: Ctrl+S → Resimler klasörü, resim.png, data URL, başlık, ikinci kayıt sessiz', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 10);
    setPrimary(t, win, '#ed1c24');
    dot(win, 50, 60);
    t.ok(win.state.paint.isDirty());
    t.key(win.el, 's', { ctrlKey: true });
    const card = await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'), 3000, 'kaydetme penceresi açılmadı');
    t.eq(card.querySelector('.fp-title').textContent, 'Farklı kaydet');
    t.eq(card.querySelector('.fp-crumb.current').textContent, 'Resimler', 'varsayılan klasör');
    t.eq(card.querySelector('.fp-name-input').value, 'resim.png', 'varsayılan ad');
    t.eq(card.querySelector('.fp-filter').textContent, '*.png');
    t.click(card.querySelector('.dlg-primary'));
    await t.waitFor(() => fs.exists(PICS + '/resim.png'), 3000, 'dosya yazılmadı');
    const data = fs.readFile(PICS + '/resim.png');
    t.ok(data.startsWith('data:image/png;base64,'), 'PNG data URL');
    t.eq(win.getTitle(), 'resim.png - Çizim');
    t.ok(!win.state.paint.isDirty());
    t.eq(win.dirty, false);
    t.eq(win.state.paint.path(), PICS + '/resim.png');
    t.ok(q(win, '.pt-msg').textContent.includes('Kaydedildi'), 'durum çubuğunda ileti');
    // the stored image really contains the stroke
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = data; });
    t.eq([img.width, img.height], [800, 600]);
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    t.eq(Array.from(g.getImageData(50, 60, 1, 1).data), RED);
    t.eq(Array.from(g.getImageData(400, 300, 1, 1).data), WHITE);
    // draw more: title gets a bullet again, Ctrl+S overwrites silently
    dot(win, 300, 300);
    t.eq(win.getTitle(), '• resim.png - Çizim');
    const before = fs.stat(PICS + '/resim.png').modified;
    t.key(win.el, 's', { ctrlKey: true });
    await t.waitFor(() => !win.state.paint.isDirty(), 2000);
    t.ok(!document.querySelector('#dialog-layer .dlg-card'), 'ikinci kayıtta pencere yok');
    t.ok(fs.stat(PICS + '/resim.png').modified > before, 'dosya güncellendi');
    t.eq(win.getTitle(), 'resim.png - Çizim');
    win.forceClose();
  });

  P1('farklı kaydet: Ctrl+Shift+S, uzantı eklenir, ad çakışmasında (2) önerilir', async (t) => {
    fs.writeFile(PICS + '/resim.png', dataUrl(10, 10));
    const win = await launch(t);
    dot(win, 10, 10);
    t.key(win.el, 's', { ctrlKey: true, shiftKey: true });
    const card = await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'));
    t.eq(card.querySelector('.fp-name-input').value, 'resim (2).png', 'benzersiz ad önerilir');
    await savePicker(t, 'manzara');
    await t.waitFor(() => fs.exists(PICS + '/manzara.png'));
    t.eq(win.getTitle(), 'manzara.png - Çizim');
    t.eq(win.state.paint.path(), PICS + '/manzara.png');
    // "Farklı kaydet" button on a saved file proposes its own name and folder
    t.click(cmd(win, 'Farklı kaydet'));
    const card2 = await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'));
    t.eq(card2.querySelector('.fp-name-input').value, 'manzara.png');
    t.click(dlgButton('İptal'));
    await t.waitFor(() => !document.querySelector('#dialog-layer .dlg-card'));
    t.eq(win.state.paint.path(), PICS + '/manzara.png', 'iptal yolu değiştirmez');
    win.forceClose();
  });

  P1('aç: args.path ile piksel piksel geri yüklenir', async (t) => {
    fs.writeFile(PICS + '/orijinal.png', dataUrl(120, 80, (g) => {
      g.fillStyle = '#ff7f27';
      g.fillRect(0, 0, 60, 80);
      g.fillStyle = '#3f48cc';
      g.fillRect(70, 20, 30, 30);
    }));
    const win = await launch(t, { path: PICS + '/orijinal.png' });
    await t.waitFor(() => win.state.paint.canvas.width === 120, 3000, 'resim açılmadı');
    t.eq(win.state.paint.canvas.height, 80);
    t.eq(px(win, 10, 10), [255, 127, 39, 255]);
    t.eq(px(win, 80, 30), BLUE);
    t.eq(px(win, 65, 10), WHITE);
    t.eq(win.getTitle(), 'orijinal.png - Çizim');
    t.ok(!win.state.paint.isDirty());
    t.eq(q(win, '.pt-sizebtn').textContent, '120 × 80 px');
    t.eq(win.state.paint.path(), PICS + '/orijinal.png');
    // draw on it, undo returns to the opened pixels
    pickTool(t, win, 'brush');
    setSize(win, 10);
    setPrimary(t, win, '#000000');
    dot(win, 30, 40);
    t.eq(px(win, 30, 40), BLACK);
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq(px(win, 30, 40), [255, 127, 39, 255]);
    win.forceClose();
  });

  P1('aç: Aç düğmesi + dosya seçici; PandaOS.apps.openFile .png dosyasını Çizim ile açar', async (t) => {
    fs.writeFile(PICS + '/a.png', dataUrl(64, 48, (g) => { g.fillStyle = '#22b14c'; g.fillRect(0, 0, 64, 48); }));
    const win = await launch(t);
    t.click(cmd(win, 'Aç'));
    const card = await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'));
    t.eq(card.querySelector('.fp-title').textContent, 'Resim aç');
    t.eq(card.querySelector('.fp-crumb.current').textContent, 'Resimler');
    t.click(card.querySelector(`.fp-row[data-path="${PICS}/a.png"]`));
    t.click(card.querySelector('.dlg-primary'));
    await t.waitFor(() => win.state.paint.canvas.width === 64, 3000);
    t.eq(px(win, 5, 5), [34, 177, 76, 255]);
    t.eq(win.getTitle(), 'a.png - Çizim');
    // via the OS
    fs.writeFile(PICS + '/b.png', dataUrl(30, 20, (g) => { g.fillStyle = '#ed1c24'; g.fillRect(0, 0, 30, 20); }));
    const w2 = P.apps.openFile(PICS + '/b.png');
    t.ok(w2 && w2.appId === 'paint', 'openFile paint açar');
    await t.waitFor(() => w2.state.paint && w2.state.paint.canvas.width === 30, 3000);
    t.eq(px(w2, 3, 3), RED);
    win.forceClose();
    w2.forceClose();
  });

  P1('aç: veri URL’si olmayan / bozuk dosya hata iletişim kutusu verir', async (t) => {
    fs.writeFile(PICS + '/metin.png', 'bu bir resim değil');
    fs.writeFile(PICS + '/bozuk.png', 'data:image/png;base64,AAAA');
    const win = await launch(t);
    dot(win, 5, 5);
    // bad content via args
    const w2 = await launch(t, { path: PICS + '/metin.png' });
    await t.waitFor(() => topDlg(), 3000, 'hata iletişim kutusu yok');
    t.eq(topDlg().querySelector('.dlg-title').textContent, 'Dosya açılamadı');
    t.ok(topDlg().querySelector('.dlg-message').textContent.includes('metin.png'));
    t.click(dlgButton('Tamam'));
    await t.waitFor(() => !topDlg());
    t.eq([w2.state.paint.canvas.width, w2.state.paint.canvas.height], [800, 600], 'boş tuvalle kalır');
    t.eq(w2.getTitle(), 'Adsız - Çizim');
    // corrupt data URL
    const pr = w2.state.paint.openPath(PICS + '/bozuk.png');
    await t.waitFor(() => topDlg(), 3000, 'bozuk dosya iletisi yok');
    t.ok(topDlg().querySelector('.dlg-message').textContent.includes('bozuk'), 'bozuk dosya iletisi');
    t.click(dlgButton('Tamam'));
    t.ok((await pr) === false);
    await t.waitFor(() => !topDlg());
    // missing file
    const pr2 = w2.state.paint.openPath(PICS + '/yok.png');
    await t.waitFor(() => topDlg());
    t.click(dlgButton('Tamam'));
    t.ok((await pr2) === false);
    win.forceClose();
    w2.forceClose();
  });

  P1('sürükle bırak: dosya yöneticisinden .png bırakılınca açılır', async (t) => {
    fs.writeFile(PICS + '/surukle.png', dataUrl(50, 40, (g) => { g.fillStyle = '#a349a4'; g.fillRect(0, 0, 50, 40); }));
    const win = await launch(t);
    const work = q(win, '.pt-work');
    const dt = new DataTransfer();
    dt.setData('application/x-pandaos-paths', JSON.stringify([PICS + '/surukle.png']));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    work.dispatchEvent(over);
    t.ok(over.defaultPrevented, 'bırakmaya izin verir');
    t.ok(work.classList.contains('pt-dragover'));
    work.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await t.waitFor(() => win.state.paint.canvas.width === 50, 3000, 'bırakılan resim açılmadı');
    t.eq(px(win, 10, 10), [163, 73, 164, 255]);
    t.ok(!work.classList.contains('pt-dragover'));
    // unrelated drags are ignored
    const dt2 = new DataTransfer();
    dt2.setData('text/plain', 'merhaba');
    const o2 = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2 });
    work.dispatchEvent(o2);
    t.ok(!o2.defaultPrevented);
    win.forceClose();
  });

  P1('depolama dolu: ENOSPC dostça iletişim kutusu, resim kirli kalır', async (t) => {
    const win = await launch(t);
    dot(win, 20, 20);
    fs.writeFile = () => { throw new fs.FSError('ENOSPC', 'Depolama alanı doldu'); };
    t.key(win.el, 's', { ctrlKey: true });
    await savePicker(t, 'dolu.png');
    await t.waitFor(() => topDlg(), 3000, 'uyarı yok');
    t.eq(topDlg().querySelector('.dlg-title').textContent, 'Depolama alanı dolu');
    t.ok(topDlg().querySelector('.dlg-message').textContent.includes('depolama alanı doldu'));
    t.click(dlgButton('Tamam'));
    await t.waitFor(() => !topDlg());
    t.ok(win.state.paint.isDirty(), 'kaydedilemedi: kirli');
    t.eq(win.state.paint.path(), null);
    t.eq(win.getTitle(), '• Adsız - Çizim');
    // another error type shows its own message
    fs.writeFile = () => { throw new fs.FSError('EPERM', 'Bu öğe korumalı'); };
    t.key(win.el, 's', { ctrlKey: true });
    await savePicker(t, 'korumali.png');
    await t.waitFor(() => topDlg());
    t.eq(topDlg().querySelector('.dlg-title').textContent, 'Kaydedilemedi');
    t.eq(topDlg().querySelector('.dlg-message').textContent, 'Bu öğe korumalı');
    t.click(dlgButton('Tamam'));
    await t.waitFor(() => !topDlg());
    win.forceClose();
  });


  P1('aç: büyük resim pencereye sığdırılarak açılır, küçük resim %100', async (t) => {
    fs.writeFile(PICS + '/buyuk.png', dataUrl(2000, 1500, (g) => { g.fillStyle = '#ed1c24'; g.fillRect(0, 0, 2000, 1500); }));
    fs.writeFile(PICS + '/kucuk.png', dataUrl(200, 100));
    const win = await launch(t, { path: PICS + '/buyuk.png' });
    await t.waitFor(() => win.state.paint.canvas.width === 2000, 4000, 'büyük resim açılmadı');
    const z = win.state.paint.zoom();
    t.ok(z < 0.5 && z >= 0.25, 'sığdırıldı: ' + z);
    const sheet = q(win, '.pt-sheet').getBoundingClientRect();
    const work = q(win, '.pt-work').getBoundingClientRect();
    t.ok(sheet.width <= work.width && sheet.height <= work.height, 'tamamı görünür');
    t.eq(q(win, '.pt-zoomlabel').textContent, Math.round(z * 100) + '%');
    t.eq(px(win, 1999, 1499), RED);
    const ok = await win.state.paint.openPath(PICS + '/kucuk.png');
    t.ok(ok);
    t.eq(win.state.paint.zoom(), 1, 'küçük resim gerçek boyutta');
    win.forceClose();
  });

  P1('dosya başka yerden yeniden adlandırılırsa başlık izler', async (t) => {
    fs.writeFile(PICS + '/eski.png', dataUrl(40, 40));
    const win = await launch(t, { path: PICS + '/eski.png' });
    await t.waitFor(() => win.state.paint.path());
    t.eq(win.getTitle(), 'eski.png - Çizim');
    fs.rename(PICS + '/eski.png', 'yeni.png');
    t.eq(win.state.paint.path(), PICS + '/yeni.png');
    t.eq(win.getTitle(), 'yeni.png - Çizim');
    fs.mkdir(PICS + '/Alt');
    fs.move(PICS + '/yeni.png', PICS + '/Alt');
    t.eq(win.state.paint.path(), PICS + '/Alt/yeni.png');
    fs.rename(PICS + '/Alt', 'Albüm');
    t.eq(win.state.paint.path(), PICS + '/Albüm/yeni.png', 'üst klasör adı değişince de izler');
    // deleted behind our back: the next save asks for a new name instead of failing
    fs.remove(PICS + '/Albüm', { recursive: true });
    dot(win, 5, 5);
    t.key(win.el, 's', { ctrlKey: true });
    const card = await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'), 3000, 'yeni ad sorulmadı');
    t.ok(card);
    t.click(dlgButton('İptal'));
    win.forceClose();
  });

  P1('tuval boyutu: kenar tutamaçları yalnızca genişlik / yükseklik değiştirir', async (t) => {
    const win = await launch(t);
    const cv = win.state.paint.canvas;
    const drag = (sel, dx, dy) => {
      const h = q(win, sel);
      const r = h.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const ev = (type, ox, oy) => h.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x + ox, clientY: y + oy, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      ev('pointerdown', 0, 0);
      ev('pointermove', dx / 2, dy / 2);
      ev('pointermove', dx, dy);
      ev('pointerup', dx, dy);
    };
    drag('.pt-h-e', 120, 80);
    t.eq([cv.width, cv.height], [920, 600], 'doğu tutamacı: yalnızca genişlik');
    drag('.pt-h-s', 60, -100);
    t.eq([cv.width, cv.height], [920, 500], 'güney tutamacı: yalnızca yükseklik');
    // at 50% zoom a 50 px drag is 100 canvas pixels
    for (let i = 0; i < 3; i++) t.click(q(win, '.pt-stbtn[aria-label="Uzaklaştır"]'));
    t.eq(win.state.paint.zoom(), 0.5);
    drag('.pt-h-se', 50, 25);
    t.eq([cv.width, cv.height], [1020, 550]);
    // minimum size 1
    drag('.pt-h-se', -4000, -4000);
    t.eq([cv.width, cv.height], [1, 1]);
    win.forceClose();
  });

  // ================================================================== dirty / beforeClose
  P1('kapatma: temiz tuval sorusuz kapanır', async (t) => {
    const win = await launch(t);
    t.eq(win.dirty, false);
    const closed = await win.close();
    t.ok(closed === true && win.isClosed());
  });

  P1('kapatma: kirli tuval — İptal pencereyi açık bırakır', async (t) => {
    const win = await launch(t);
    dot(win, 10, 10);
    t.eq(win.dirty, true);
    const p = win.close();
    await t.waitFor(() => sheetOf(win), 2000, 'kaydetme sorusu yok');
    t.eq(sheetOf(win).querySelector('.pt-card-title').textContent, 'Değişiklikler kaydedilsin mi?');
    t.eq(qa(win, '.pt-modal .pt-card-btn').map((b) => b.textContent), ['Kaydet', 'Kaydetme', 'İptal']);
    t.ok(sheetOf(win).querySelector('.pt-card-msg').textContent.includes('Adsız'));
    t.eq(document.activeElement.textContent, 'Kaydet', 'varsayılan düğme odakta');
    t.click(sheetBtn(win, 'İptal'));
    t.eq(await p, false, 'close() false döner');
    t.ok(!win.isClosed());
    t.ok(!sheetOf(win));
    t.ok(win.state.paint.isDirty());
    // Escape also cancels
    const p2 = win.close();
    await t.waitFor(() => sheetOf(win));
    t.key(sheetBtn(win, 'Kaydet'), 'Escape');
    t.eq(await p2, false);
    t.ok(!win.isClosed());
    win.forceClose();
  });

  P1('kapatma: Kaydetme çizimi atıp kapatır', async (t) => {
    const win = await launch(t);
    dot(win, 10, 10);
    const p = win.close();
    await t.waitFor(() => sheetOf(win));
    t.click(sheetBtn(win, 'Kaydetme'));
    t.eq(await p, true);
    t.ok(win.isClosed());
    t.eq(fs.list(PICS).length, 0, 'dosya yazılmadı');
  });

  P1('kapatma: Kaydet → dosya seçici → yazıp kapatır; seçici iptal edilirse pencere kalır', async (t) => {
    const win = await launch(t);
    dot(win, 10, 10);
    let p = win.close();
    await t.waitFor(() => sheetOf(win));
    t.click(sheetBtn(win, 'Kaydet'));
    const card = await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'));
    t.click(dlgButton('İptal'));
    t.eq(await p, false, 'seçici iptali kapatmayı iptal eder');
    t.ok(!win.isClosed());
    t.ok(win.state.paint.isDirty());
    p = win.close();
    await t.waitFor(() => sheetOf(win));
    t.click(sheetBtn(win, 'Kaydet'));
    await savePicker(t, 'kapanis.png');
    t.eq(await p, true);
    t.ok(win.isClosed());
    t.ok(fs.exists(PICS + '/kapanis.png'), 'kaydedildi');
    t.ok(card, 'seçici göründü');
    // saved file: closing again right away asks nothing
    const w2 = await launch(t, { path: PICS + '/kapanis.png' });
    await t.waitFor(() => w2.state.paint.path());
    t.eq(await w2.close(), true);
  });

  P1('kapatma: kayıtlı dosyada değişiklik → Kaydet doğrudan üzerine yazar', async (t) => {
    fs.writeFile(PICS + '/var.png', dataUrl(100, 100));
    const win = await launch(t, { path: PICS + '/var.png' });
    await t.waitFor(() => win.state.paint.path());
    pickTool(t, win, 'brush');
    setSize(win, 10);
    setPrimary(t, win, '#ed1c24');
    dot(win, 50, 50);
    const p = win.close();
    await t.waitFor(() => sheetOf(win));
    t.ok(sheetOf(win).querySelector('.pt-card-msg').textContent.includes('var.png'));
    t.click(sheetBtn(win, 'Kaydet'));
    t.eq(await p, true);
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = fs.readFile(PICS + '/var.png'); });
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 100;
    c.getContext('2d').drawImage(img, 0, 0);
    t.eq(Array.from(c.getContext('2d').getImageData(50, 50, 1, 1).data), RED);
  });

  P1('kapatma: kaydedilen sonra geri alınan durum yine kirlidir; kaydedilene dönmek temizdir', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'pencil');
    dot(win, 5, 5);
    t.key(win.el, 's', { ctrlKey: true });
    await savePicker(t, 'durum.png');
    await t.waitFor(() => !win.state.paint.isDirty());
    dot(win, 9, 9);
    t.ok(win.state.paint.isDirty());
    t.key(win.el, 'z', { ctrlKey: true });
    t.ok(!win.state.paint.isDirty(), 'kaydedilen duruma dönüş temiz');
    t.eq(win.getTitle(), 'durum.png - Çizim');
    t.key(win.el, 'z', { ctrlKey: true });
    t.ok(win.state.paint.isDirty(), 'kaydedilenin gerisi kirli');
    t.eq(win.dirty, true);
    win.forceClose();
  });

  P1('kapatma: oturumu kapatırken (session) kirli pencere sorar', async (t) => {
    const win = await launch(t);
    dot(win, 10, 10);
    win.minimize();
    const p = win.close();
    await t.waitFor(() => sheetOf(win), 2000, 'küçültülmüş pencerede soru gösterilmedi');
    t.ok(!win.isMinimized(), 'soru için pencere geri yüklendi');
    t.click(sheetBtn(win, 'Kaydetme'));
    t.eq(await p, true);
  });


  P1('Ctrl+O dosya seçiciyi açar; pointercancel çizimi bitirir; ikinci işaretçi yok sayılır', async (t) => {
    const win = await launch(t);
    t.key(win.el, 'o', { ctrlKey: true });
    const card = await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'), 3000, 'Ctrl+O seçiciyi açmadı');
    t.eq(card.querySelector('.fp-title').textContent, 'Resim aç');
    t.eq(card.querySelector('.fp-filter').textContent, '*.png');
    t.click(dlgButton('İptal'));
    await t.waitFor(() => !document.querySelector('#dialog-layer .dlg-card'));
    pickTool(t, win, 'brush');
    setSize(win, 10);
    setPrimary(t, win, '#ed1c24');
    ptr(win, 'pointerdown', 100, 100);
    ptr(win, 'pointermove', 150, 100);
    // a second pointer (second finger) is ignored while the first one draws
    ptr(win, 'pointerdown', 300, 300, { pointerId: 2 });
    ptr(win, 'pointermove', 320, 320, { pointerId: 2 });
    ptr(win, 'pointerup', 320, 320, { pointerId: 2 });
    t.eq(px(win, 310, 310), WHITE, 'ikinci işaretçi çizmedi');
    q(win, '.pt-overlay').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    t.eq(win.state.paint.historyLength(), 1, 'iptal edilen darbe de işlenir');
    col(t, win, 120, 100, RED);
    // the next stroke works normally afterwards
    stroke(win, line([100, 200], [200, 200], 5));
    col(t, win, 150, 200, RED);
    t.eq(win.state.paint.historyLength(), 2);
    win.forceClose();
  });

  // ================================================================== wallpaper
  P1('arka plan yap: gerekirse kaydeder, duvar kağıdını ayarlar, bildirim gösterir', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 30);
    setPrimary(t, win, '#ed1c24');
    dot(win, 100, 100);
    t.click(cmd(win, 'Arka plan yap'));
    await savePicker(t, 'duvar.png');
    await t.waitFor(() => P.settings.get('wallpaper') === 'vfs:' + PICS + '/duvar.png', 3000, 'duvar kağıdı ayarlanmadı');
    const n = P.notify.history()[0];
    t.eq(n.title, 'Arka plan değiştirildi');
    t.ok(n.message.includes('duvar.png'));
    t.eq(win.getTitle(), 'duvar.png - Çizim');
    t.ok(!win.state.paint.isDirty());
    t.ok(String(P.wallpapers.css('vfs:' + PICS + '/duvar.png')).includes('data:image/png'), 'wallpapers çözebilir');
    // saved + clean: no dialogs, just sets it again
    P.settings.set('wallpaper', 'bamboo');
    t.click(cmd(win, 'Arka plan yap'));
    await t.waitFor(() => P.settings.get('wallpaper') === 'vfs:' + PICS + '/duvar.png');
    t.ok(!document.querySelector('#dialog-layer .dlg-card'));
    // dirty again: saved first, silently
    dot(win, 300, 300);
    const before = fs.stat(PICS + '/duvar.png').modified;
    P.settings.set('wallpaper', 'bamboo');
    t.click(cmd(win, 'Arka plan yap'));
    await t.waitFor(() => P.settings.get('wallpaper') === 'vfs:' + PICS + '/duvar.png');
    t.ok(fs.stat(PICS + '/duvar.png').modified > before, 'önce kaydedildi');
    t.ok(!win.state.paint.isDirty());
    // cancel the picker: nothing changes
    const win2 = await launch(t);
    dot(win2, 4, 4);
    P.settings.set('wallpaper', 'bamboo');
    t.click(cmd(win2, 'Arka plan yap'));
    await t.waitFor(() => document.querySelector('#dialog-layer .dlg-card.fp'));
    t.click(dlgButton('İptal'));
    await t.waitFor(() => !document.querySelector('#dialog-layer .dlg-card'));
    t.eq(P.settings.get('wallpaper'), 'bamboo');
    win.forceClose();
    win2.forceClose();
  });

  // ================================================================== keyboard / palette / ribbon
  P1('klavye: araç kısayolları P B E G I L R O T (+ U A), X renkleri değiştirir', async (t) => {
    const win = await launch(t);
    const map = { p: 'pencil', b: 'brush', e: 'eraser', g: 'bucket', i: 'dropper', l: 'line', r: 'rect', o: 'ellipse', t: 'text', u: 'rrect', a: 'arrow' };
    for (const [k, tool] of Object.entries(map)) {
      t.key(win.el, k);
      t.eq(win.state.paint.tool(), tool, `${k} → ${tool}`);
      t.ok(toolBtn(win, tool).classList.contains('active'));
      t.eq(toolBtn(win, tool).getAttribute('aria-pressed'), 'true');
      t.eq(qa(win, '.pt-tool.active').length, 1, 'tek etkin araç');
      t.eq(q(win, '.pt-toolname').textContent, win.getTitle() && q(win, `.pt-tool[data-tool="${tool}"]`).getAttribute('aria-label'));
    }
    // upper-case and the physical key (Turkish layouts produce dotless ı for the I key)
    t.key(win.el, 'B', { shiftKey: true });
    t.eq(win.state.paint.tool(), 'brush');
    const ev = new KeyboardEvent('keydown', { key: 'ı', code: 'KeyI', bubbles: true, cancelable: true });
    win.el.dispatchEvent(ev);
    t.eq(win.state.paint.tool(), 'dropper', 'ı tuşu damlalık');
    // modifiers are ignored
    t.key(win.el, 'p', { altKey: true });
    t.eq(win.state.paint.tool(), 'dropper');
    // X swaps the colours
    setPrimary(t, win, '#ed1c24');
    setSecondary(t, win, '#3f48cc');
    t.key(win.el, 'x');
    t.eq([win.state.paint.prefs.primary, win.state.paint.prefs.secondary], ['#3f48cc', '#ed1c24']);
    t.click(q(win, '.pt-swap'));
    t.eq([win.state.paint.prefs.primary, win.state.paint.prefs.secondary], ['#ed1c24', '#3f48cc']);
    // [ and ] change the size
    pickTool(t, win, 'brush');
    setSize(win, 10);
    t.key(win.el, ']');
    t.eq(win.state.paint.prefs.sizes.brush, 11);
    t.key(win.el, '[');
    t.key(win.el, '[');
    t.eq(win.state.paint.prefs.sizes.brush, 9);
    t.eq(q(win, '.pt-size').value, '9');
    win.forceClose();
  });

  P1('klavye: yazı yazarken kısayollar tetiklenmez', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'text');
    ptr(win, 'pointerdown', 50, 50);
    ptr(win, 'pointerup', 50, 50);
    const input = await t.waitFor(() => q(win, '.pt-text'));
    t.type(input, 'pbegi');
    t.eq(win.state.paint.tool(), 'text', 'araç değişmedi');
    t.eq(input.value, 'pbegi');
    win.forceClose();
  });

  P1('palet: sol tık birincil, sağ tık ikincil, özel renk, kalıcılık', async (t) => {
    const win = await launch(t);
    t.eq(win.state.paint.prefs.primary, '#000000');
    t.eq(win.state.paint.prefs.secondary, '#ffffff');
    t.click(swatch(win, '#22b14c'));
    t.eq(win.state.paint.prefs.primary, '#22b14c');
    t.eq(q(win, '.pt-sw-primary').style.backgroundColor, 'rgb(34, 177, 76)');
    const ev = t.contextmenu(swatch(win, '#00a2e8'));
    t.ok(ev.defaultPrevented, 'yerel bağlam menüsü yok');
    t.eq(win.state.paint.prefs.secondary, '#00a2e8');
    t.eq(q(win, '.pt-sw-secondary').style.backgroundColor, 'rgb(0, 162, 232)');
    // custom colour via the colour inputs
    const custom = q(win, '.pt-custom input');
    custom.value = '#123456';
    custom.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(win.state.paint.prefs.primary, '#123456');
    const sec = q(win, '.pt-sw-secondary input');
    sec.value = '#abcdef';
    sec.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(win.state.paint.prefs.secondary, '#abcdef');
    // drawing uses the custom colour
    pickTool(t, win, 'brush');
    setSize(win, 10);
    dot(win, 100, 100);
    t.eq(px(win, 100, 100), [0x12, 0x34, 0x56, 255]);
    // persisted and restored by a new window
    const saved = P.storage.get('app.paint');
    t.eq([saved.primary, saved.secondary, saved.tool], ['#123456', '#abcdef', 'brush']);
    win.forceClose();
    const w2 = P.apps.launch('paint');
    await t.waitFor(() => w2.state.paint);
    t.eq([w2.state.paint.prefs.primary, w2.state.paint.prefs.secondary, w2.state.paint.tool()], ['#123456', '#abcdef', 'brush']);
    t.eq(q(w2, '.pt-size').value, '10');
    w2.forceClose();
  });

  P1('şerit: daralt/genişlet kalıcıdır; dolgu anahtarı tek seçimli', async (t) => {
    const win = await launch(t);
    const root = q(win, '.pt-root');
    const toggle = q(win, '.pt-ribbon-toggle');
    t.ok(!root.classList.contains('pt-collapsed'));
    t.eq(toggle.getAttribute('aria-expanded'), 'true');
    t.click(toggle);
    t.ok(root.classList.contains('pt-collapsed'));
    t.eq(getComputedStyle(q(win, '.pt-ribbon')).display, 'none');
    t.eq(toggle.getAttribute('aria-expanded'), 'false');
    t.eq(P.storage.get('app.paint').collapsed, true);
    win.forceClose();
    const w2 = P.apps.launch('paint');
    await t.waitFor(() => w2.state.paint);
    t.ok(q(w2, '.pt-root').classList.contains('pt-collapsed'), 'durum hatırlanır');
    t.click(q(w2, '.pt-ribbon-toggle'));
    t.ok(!q(w2, '.pt-root').classList.contains('pt-collapsed'));
    // fill toggle
    t.eq(qa(w2, '.pt-fillseg button.active').length, 1);
    setFill(t, w2, 'both');
    t.eq(qa(w2, '.pt-fillseg button.active').map((b) => b.dataset.fill), ['both']);
    t.eq(w2.state.paint.prefs.fill, 'both');
    w2.forceClose();
  });

  P1('tuval bağlam menüsü yok; sağ tuş çizer', async (t) => {
    const win = await launch(t);
    const ov = q(win, '.pt-overlay');
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 });
    ov.dispatchEvent(ev);
    t.ok(ev.defaultPrevented, 'tuvalde yerel menü engellenir');
    t.ok(!document.querySelector('#context-menu-layer .ctx-menu'), 've OS menüsü de açılmaz');
    const ev2 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    q(win, '.pt-work').dispatchEvent(ev2);
    t.ok(ev2.defaultPrevented);
    win.forceClose();
  });

  // ================================================================== canvas menu
  P1('… menüsü: temizle, çevir, döndür, boyut — hepsi geri alınabilir', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    setSize(win, 10);
    setPrimary(t, win, '#ed1c24');
    dot(win, 100, 50);
    const openMenu = () => {
      t.click(q(win, '.pt-more'));
      return [...document.querySelectorAll('#context-menu-layer .ctx-item')];
    };
    const labels = openMenu().map((i) => i.querySelector('.ctx-label').textContent);
    t.eq(labels, ['Tuval boyutu…', 'Tuvali temizle', 'Yatay çevir', 'Dikey çevir', 'Sağa döndür (90°)', 'Pencereye sığdır', 'Gerçek boyut (%100)']);
    const pick = (label) => {
      const item = openMenu().find((i) => i.querySelector('.ctx-label').textContent === label);
      t.click(item);
    };
    P.contextMenu.hide();
    pick('Yatay çevir');
    t.eq(px(win, 699, 50), RED, 'yatay çevrildi');
    t.eq(px(win, 100, 50), WHITE);
    pick('Dikey çevir');
    t.eq(px(win, 699, 549), RED, 'dikey çevrildi');
    t.key(win.el, 'z', { ctrlKey: true });
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq(px(win, 100, 50), RED, 'iki geri alma');
    pick('Sağa döndür (90°)');
    t.eq([win.state.paint.canvas.width, win.state.paint.canvas.height], [600, 800]);
    t.eq(px(win, 550, 100), RED, '(x,y) → (h-y, x)');
    t.eq(q(win, '.pt-sizebtn').textContent, '600 × 800 px');
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq([win.state.paint.canvas.width, win.state.paint.canvas.height], [800, 600]);
    pick('Tuvali temizle');
    t.eq(px(win, 100, 50), WHITE);
    t.key(win.el, 'z', { ctrlKey: true });
    t.eq(px(win, 100, 50), RED, 'temizleme geri alındı');
    win.forceClose();
  });

  // ================================================================== responsive
  P1('küçük pencere: en küçük boyutta taşma yok, etiketler gizlenir, geniş pencerede tam görünüm', async (t) => {
    const win = await launch(t);
    win.setSize(600, 420);
    await t.waitFor(() => q(win, '.pt-root').classList.contains('pt-narrow'), 2000, 'dar düzen uygulanmadı');
    const b = win.getBounds();
    t.eq([b.width, b.height], [600, 420], 'en küçük boyut');
    t.ok(q(win, '.pt-root').classList.contains('pt-compact'));
    t.eq(getComputedStyle(q(win, '.pt-cmd-label')).display, 'none', 'etiketler gizli');
    t.ok(win.body.scrollWidth <= win.body.clientWidth + 1, 'yatay taşma yok');
    const body = win.body.getBoundingClientRect();
    for (const sel of ['.pt-cmdbar', '.pt-ribbon', '.pt-work', '.pt-status']) {
      const r = q(win, sel).getBoundingClientRect();
      t.ok(r.right <= body.right + 1 && r.left >= body.left - 1, `${sel} pencere dışına taşıyor`);
    }
    const work = q(win, '.pt-work').getBoundingClientRect();
    t.ok(work.height > 100, `çalışma alanı çok küçük: ${work.height}`);
    // every ribbon group is still reachable (wrapped onto a second line, not clipped)
    for (const g of qa(win, '.pt-group')) {
      const r = g.getBoundingClientRect();
      t.ok(r.right <= body.right + 1, 'şerit grubu taşıyor');
    }
    // collapse the ribbon to gain room
    t.click(q(win, '.pt-ribbon-toggle'));
    t.ok(q(win, '.pt-work').getBoundingClientRect().height > work.height + 80, 'şerit daralınca alan büyür');
    win.setSize(1200, 800);
    await t.waitFor(() => !q(win, '.pt-root').classList.contains('pt-narrow'), 2000);
    t.ok(!q(win, '.pt-root').classList.contains('pt-compact'));
    t.ok(getComputedStyle(q(win, '.pt-cmd-label')).display !== 'none');
    win.maximize();
    t.ok(win.body.scrollWidth <= win.body.clientWidth + 1);
    win.forceClose();
  });

  P1('varsayılan pencere: şerit tek satırda sığar', async (t) => {
    const win = await launch(t);
    const ribbon = q(win, '.pt-ribbon');
    const groups = qa(win, '.pt-group').map((g) => g.getBoundingClientRect());
    t.eq(new Set(groups.map((r) => Math.round(r.top))).size, 1, 'tüm gruplar aynı satırda');
    t.ok(ribbon.getBoundingClientRect().height < 110, 'şerit alçak kalır');
    t.ok(ribbon.scrollWidth <= ribbon.clientWidth + 1);
    const b = win.getBounds();
    t.eq([b.width, b.height], [980, 660]);
    win.forceClose();
  });

  P1('tema: açık ve koyu temada şerit ve çalışma alanı temaya uyar', async (t) => {
    const win = await launch(t);
    const bg = () => getComputedStyle(q(win, '.pt-ribbon')).backgroundColor;
    const work = () => getComputedStyle(q(win, '.pt-work')).backgroundColor;
    P.theme.set('dark');
    const darkRibbon = bg();
    const darkWork = work();
    P.theme.set('light');
    t.ok(bg() !== darkRibbon, 'şerit rengi temayla değişir');
    t.ok(work() !== darkWork, 'çalışma alanı temayla değişir');
    t.eq(getComputedStyle(q(win, '.pt-sheet')).backgroundColor, 'rgb(255, 255, 255)', 'kâğıt her temada beyaz');
    P.theme.set('dark');
    win.forceClose();
  });

  // ================================================================== lifecycle
  P1('temizlik: kapanınca belge dinleyicileri kaldırılır, zamanlayıcı kalmaz', async (t) => {
    const added = new Map();
    const removed = new Map();
    const origAdd = document.addEventListener;
    const origRemove = document.removeEventListener;
    document.addEventListener = function (type, fn, opts) {
      if (/^pointer/.test(type)) added.set(fn, type);
      return origAdd.call(this, type, fn, opts);
    };
    document.removeEventListener = function (type, fn, opts) {
      if (/^pointer/.test(type)) removed.set(fn, type);
      return origRemove.call(this, type, fn, opts);
    };
    try {
      const win = await launch(t);
      t.ok(added.size >= 3, 'pointermove/up/cancel dinleyicileri eklendi');
      pickTool(t, win, 'text');
      ptr(win, 'pointerdown', 20, 20);
      ptr(win, 'pointerup', 20, 20);
      await t.waitFor(() => q(win, '.pt-text'));
      await win.close(); // text field pending but nothing committed => not dirty
      t.ok(win.isClosed());
      for (const [fn, type] of added) t.ok(removed.get(fn) === type, `${type} dinleyicisi kaldırılmadı`);
      // stray events after close are harmless
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5, pointerId: 1 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 5, pointerId: 1 }));
    } finally {
      document.addEventListener = origAdd;
      document.removeEventListener = origRemove;
    }
    t.eq(P.apps.running('paint').length, 0);
  });

  P1('çizim sırasında pencere kapatılırsa hata olmaz', async (t) => {
    const win = await launch(t);
    pickTool(t, win, 'brush');
    ptr(win, 'pointerdown', 10, 10);
    ptr(win, 'pointermove', 50, 50);
    win.forceClose();
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 60, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, clientY: 60, pointerId: 1 }));
    t.ok(true);
  });

  P1('araç ipuçları: yerel title yok, aria-label var', async (t) => {
    const win = await launch(t);
    for (const b of qa(win, 'button')) {
      t.ok(!b.hasAttribute('title'), 'yerel title kullanılmamalı');
      t.ok(b.getAttribute('aria-label') || b.textContent.trim(), 'erişilebilir ad yok: ' + b.className);
    }
    win.forceClose();
  });
})();
