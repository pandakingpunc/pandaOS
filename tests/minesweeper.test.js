/* Mayın Tarlası tests: the rules engine (pure) and the window UI driven through real DOM events. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const STORE = 'app.minesweeper';
  const def = () => P.apps.get('minesweeper');
  const E = () => def()._engine;

  // 9x9 with 10 mines: five on the top row, five on the bottom row. Clicking the centre opens rows 1-7 and leaves
  // the 8 safe cells of rows 0 and 8 (odd columns) to be opened by hand.
  const EASY_MINES = [0, 2, 4, 6, 8, 72, 74, 76, 78, 80];
  const EASY_REST = [1, 3, 5, 7, 73, 75, 77, 79];

  // ---------------------------------------------------------------- helpers
  function closeAll() {
    try { if (P.dialog && P.dialog.closeAll) P.dialog.closeAll(); } catch (e) { /* ignore */ }
    try { P.contextMenu.hide(); } catch (e) { /* ignore */ }
    P.wm.byApp('minesweeper').forEach((w) => w.forceClose());
  }

  function fresh(args, seedStorage) {
    closeAll();
    P.storage.remove(STORE);
    if (seedStorage) P.storage.set(STORE, seedStorage);
    return P.apps.launch('minesweeper', args || {});
  }

  function test(name, fn) {
    PandaTest.test(name, async (t) => {
      try { await fn(t); } finally { closeAll(); }
    });
  }

  const ms = (w) => w.state.ms;
  const $ = (w, sel) => w.body.querySelector(sel);
  const $$ = (w, sel) => Array.from(w.body.querySelectorAll(sel));
  const cellEl = (w, i) => w.body.querySelector(`.ms-cell[data-i="${i}"]`);
  const led = (w, kind) => w.body.querySelector(`.ms-led[data-kind="${kind}"]`).dataset.value;
  const faceOf = (w) => $(w, '.ms-face').dataset.face;
  const bannerText = (w) => { const b = $(w, '.ms-banner'); return b ? b.textContent : ''; };
  const classes = (w, i) => cellEl(w, i).className.replace(/\bcursor\b|\bjust\b/g, '').replace(/\s+/g, ' ').trim();
  const stored = () => P.storage.get(STORE, null);
  const dump = (w) => E().dump(ms(w).board);

  function nbrs(width, height, i) {
    const out = [];
    const x = i % width;
    const y = Math.floor(i / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < width && yy >= 0 && yy < height) out.push(yy * width + xx);
      }
    }
    return out;
  }

  function layoutBoard(w, width, height, mines, id) {
    ms(w).newGame({ board: E().createBoardFromMines(width, height, mines), id: id || 'easy' });
    return ms(w).board;
  }

  function rightClick(t, el) {
    return t.contextmenu(el);
  }

  function rgb(str) {
    let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(str);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(str);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
    return null;
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function contrast(a, b) {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // ================================================================ engine
  PandaTest.test('motor: tahta oluşturma, mayın sayısı ve komşu sayıları', (t) => {
    const e = E();
    t.ok(e && typeof e.createBoard === 'function' && typeof e.reveal === 'function' && typeof e.toggleFlag === 'function' && typeof e.chord === 'function', 'motor dışa açılmamış');
    const b = e.createBoard(9, 9, 10, 123, 40);
    t.eq([b.width, b.height, b.size, b.mines, b.status, b.placed], [9, 9, 81, 10, 'ready', true]);
    t.eq(Array.from(b.mine).reduce((a, v) => a + v, 0), 10, 'mayın sayısı');
    t.eq([b.mine[40], ...nbrs(9, 9, 40).map((i) => b.mine[i])].every((v) => v === 0), true, 'güvenli bölge mayınsız olmalı');
    for (let i = 0; i < 81; i++) {
      if (b.mine[i]) continue;
      const want = nbrs(9, 9, i).reduce((a, j) => a + b.mine[j], 0);
      if (b.adj[i] !== want) throw new Error(`komşu sayısı yanlış: ${i} → ${b.adj[i]} (beklenen ${want})`);
    }
    // the safe cell may also be given as {x, y}
    const c = e.createBoard(9, 9, 10, 123, { x: 4, y: 4 });
    t.eq(Array.from(c.mine), Array.from(b.mine), '{x,y} ile indeks aynı sonucu vermeli');
    // lazily placed: nothing on the board until the first reveal
    const lazy = e.createBoard(9, 9, 10, 5);
    t.eq([lazy.placed, Array.from(lazy.mine).reduce((a, v) => a + v, 0)], [false, 0]);
    t.throws(() => e.createBoard(0, 5, 1, 1));
    t.throws(() => e.createBoard(5, 5, 25, 1));
    t.throws(() => e.createBoard(5, 5, -1, 1));
  });

  PandaTest.test('motor: aynı tohum aynı dağılım, farklı tohum farklı dağılım', (t) => {
    const e = E();
    const a = e.createBoard(16, 16, 40, 'merhaba', 120);
    const b = e.createBoard(16, 16, 40, 'merhaba', 120);
    const c = e.createBoard(16, 16, 40, 'dünya', 120);
    t.eq(Array.from(a.mine), Array.from(b.mine));
    t.ok(Array.from(a.mine).join('') !== Array.from(c.mine).join(''), 'farklı tohum aynı dağılımı verdi');
    // lazily placed boards: same seed + same first click → same layout
    const l1 = e.createBoard(16, 16, 40, 77);
    const l2 = e.createBoard(16, 16, 40, 77);
    e.reveal(l1, 100);
    e.reveal(l2, 100);
    t.eq(Array.from(l1.mine), Array.from(l2.mine));
    // the mine count is an invariant
    for (let seed = 1; seed <= 25; seed++) {
      const x = e.createBoard(30, 16, 99, seed);
      e.reveal(x, seed * 13 % 480);
      if (Array.from(x.mine).reduce((s, v) => s + v, 0) !== 99) throw new Error('mayın sayısı bozuldu: tohum ' + seed);
    }
  });

  PandaTest.test('motor: ilk tıklama her zaman güvenli (her hücre, çok tohum)', (t) => {
    const e = E();
    let checks = 0;
    for (let seed = 1; seed <= 12; seed++) {
      for (let i = 0; i < 81; i++) {
        const b = e.createBoard(9, 9, 10, seed * 1000 + i);
        const r = e.reveal(b, i);
        if (r.lost || b.status === 'lost') throw new Error(`ilk tıklama mayına denk geldi (tohum ${seed}, hücre ${i})`);
        if (b.mine[i] || nbrs(9, 9, i).some((j) => b.mine[j])) throw new Error(`ilk tıklama çevresinde mayın var (tohum ${seed}, hücre ${i})`);
        if (!r.started || !r.changed.includes(i)) throw new Error('ilk açılış started/changed bildirmedi');
        if (b.adj[i] !== 0) throw new Error(`ilk tıklanan hücre boş olmalı (tohum ${seed}, hücre ${i})`);
        checks++;
      }
    }
    // densest legal board (81 − 9 = 72 → a 3×3 free zone still fits)
    for (let i = 0; i < 81; i += 7) {
      const b = e.createBoard(9, 9, 72, i + 1);
      const r = e.reveal(b, i);
      t.ok(!r.lost && !b.mine[i], 'yoğun tahtada ilk tıklama güvenli olmalı');
      checks++;
    }
    // a board with fewer free cells than mines falls back to protecting the clicked cell only
    const tiny = e.createBoard(8, 8, 60, 9);
    const r = e.reveal(tiny, 27);
    t.ok(!r.lost && !tiny.mine[27], 'sıkışık tahtada tıklanan hücre güvenli olmalı');
    t.ok(checks > 100);
  });

  PandaTest.test('motor: boş alan yayılması (flood fill) ve derinlik sırası', (t) => {
    const e = E();
    // a column of mines splits the board: opening the left side must not leak to the right
    const b = e.createBoardFromMines(5, 5, [2, 7, 12, 17, 22]);
    const r = e.reveal(b, 0);
    t.eq(e.dump(b), '.2###\n.3###\n.3###\n.3###\n.2###');
    t.eq([r.started, r.lost, r.won, b.status, b.revealed], [true, false, false, 'playing', 10]);
    t.eq(r.changed.length, 10);
    t.eq(r.depth[0], 0);
    for (let i = 1; i < r.depth.length; i++) if (r.depth[i] < r.depth[i - 1]) throw new Error('derinlik azalmamalı (genişlik öncelikli)');
    // flags are never opened by a flood
    const f = e.createBoardFromMines(5, 5, [2, 7, 12, 17, 22]);
    e.toggleFlag(f, 5, false);
    e.reveal(f, 0);
    t.eq(e.dump(f).split('\n').slice(0, 3), ['.2###', 'F3###', '#####']);
    // a mine in the far corner: one click wins the whole game
    const w = e.createBoardFromMines(6, 6, [35]);
    const rw = e.reveal(w, 0);
    t.eq([rw.won, w.status, w.revealed, w.flags, e.remaining(w)], [true, 'won', 35, 1, 0]);
    t.eq(w.state[35], e.FLAG, 'kazanınca mayın bayraklanmalı');
    t.ok(rw.changed.includes(35), 'otomatik bayrak changed içinde olmalı');
  });

  PandaTest.test('motor: bayrak / soru işareti döngüsü ve sayaç', (t) => {
    const e = E();
    const b = e.createBoardFromMines(5, 5, [6]);
    t.eq(e.remaining(b), 1);
    e.toggleFlag(b, 0, false);
    t.eq([b.state[0], b.flags, e.remaining(b)], [e.FLAG, 1, 0]);
    e.toggleFlag(b, 0, false);
    t.eq([b.state[0], b.flags, e.remaining(b)], [e.HIDDEN, 0, 1]);
    // with question marks: hidden → flag → ? → hidden
    e.toggleFlag(b, 1, true);
    e.toggleFlag(b, 1, true);
    t.eq([b.state[1], b.flags], [e.QUESTION, 0]);
    e.toggleFlag(b, 1, true);
    t.eq([b.state[1], b.flags], [e.HIDDEN, 0]);
    // the counter goes negative when you flag too much
    [0, 1, 2].forEach((i) => e.toggleFlag(b, i, false));
    t.eq(e.remaining(b), -2);
    // flagged cells cannot be revealed, revealed cells cannot be flagged
    t.eq(e.reveal(b, 0).changed, []);
    e.toggleFlag(b, 0, false);
    e.reveal(b, 24);
    t.eq(e.toggleFlag(b, 24, false).changed, []);
    t.eq(e.toggleFlag(b, 999, false).changed, [], 'aralık dışı indeks yok sayılmalı');
    // a question-marked cell can still be opened
    const q = e.createBoardFromMines(5, 5, [6]);
    e.toggleFlag(q, 3, true);
    e.toggleFlag(q, 3, true);
    t.eq(q.state[3], e.QUESTION);
    t.eq(e.reveal(q, 3).changed.length > 0, true);
    t.eq(q.state[3], e.REVEALED);
  });

  PandaTest.test('motor: sayıya tıklama (chord) kuralları', (t) => {
    const e = E();
    // single mine at (1,1): the number at (0,0) is 1
    let b = e.createBoardFromMines(5, 5, [6]);
    e.reveal(b, 0);
    t.eq(e.dump(b).split('\n')[0], '1####');
    t.eq(e.chord(b, 0).chorded, false, 'bayrak yokken chord işlemez');
    e.toggleFlag(b, 6, false);
    const r = e.chord(b, 0);
    t.eq([r.chorded, r.changed.length, r.lost], [true, 2, false]);
    t.eq(e.dump(b).split('\n').slice(0, 2), ['11###', '1F###']);
    // too many flags: no chord
    b = e.createBoardFromMines(5, 5, [6]);
    e.reveal(b, 0);
    e.toggleFlag(b, 6, false);
    e.toggleFlag(b, 1, false);
    t.eq(e.chord(b, 0).chorded, false, 'bayrak sayısı sayıdan fazlaysa chord işlemez');
    // wrong flag: the real mine is opened → loss
    b = e.createBoardFromMines(5, 5, [6]);
    e.reveal(b, 0);
    e.toggleFlag(b, 1, false);
    const bad = e.chord(b, 0);
    t.eq([bad.lost, b.status, b.exploded], [true, 'lost', [6]]);
    // chording on a hidden cell or an empty cell does nothing
    b = e.createBoardFromMines(5, 5, [24]);
    e.reveal(b, 0);
    t.eq(e.chord(b, 3).chorded, false);
    t.eq(e.chord(b, 0).chorded, false);
    // chording can finish the game (and floods through zeros)
    b = e.createBoardFromMines(4, 1, [0]);
    e.reveal(b, 1);
    e.toggleFlag(b, 0, false);
    const win = e.chord(b, 1);
    t.eq([win.chorded, win.won, b.status, b.revealed], [true, true, 'won', 3]);
  });

  PandaTest.test('motor: kazanma, kaybetme ve oyun sonrası kilit', (t) => {
    const e = E();
    // loss
    let b = e.createBoardFromMines(9, 9, EASY_MINES);
    e.reveal(b, 40);
    const lose = e.reveal(b, 2);
    t.eq([lose.lost, lose.won, b.status, b.exploded], [true, false, 'lost', [2]]);
    t.eq(e.reveal(b, 1).changed, [], 'kayıptan sonra açılamaz');
    t.eq(e.toggleFlag(b, 1, false).changed, [], 'kayıptan sonra bayrak konamaz');
    t.eq(e.chord(b, 10).changed, [], 'kayıptan sonra chord çalışmaz');
    // win: every safe cell open, mines flagged automatically, counter at zero
    b = e.createBoardFromMines(9, 9, EASY_MINES);
    e.reveal(b, 40);
    t.eq([b.status, b.revealed], ['playing', 81 - 10 - EASY_REST.length]);
    let last = null;
    EASY_REST.forEach((i) => { last = e.reveal(b, i); });
    t.eq([last.won, b.status, b.revealed, b.flags, e.remaining(b)], [true, 'won', 71, 10, 0]);
    t.ok(EASY_MINES.every((i) => b.state[i] === e.FLAG), 'tüm mayınlar bayraklanmalı');
    t.eq(e.reveal(b, 0).changed, [], 'kazandıktan sonra açılamaz');
    t.eq(e.toggleFlag(b, 0, false).changed, []);
    // question-marked mines become flags on a win; not winning while a safe cell is still hidden
    b = e.createBoardFromMines(9, 9, EASY_MINES);
    e.reveal(b, 40);
    e.toggleFlag(b, 0, true);
    e.toggleFlag(b, 0, true);
    EASY_REST.slice(0, -1).forEach((i) => e.reveal(b, i));
    t.eq(b.status, 'playing', 'son güvenli kare açılmadan kazanılmamalı');
    e.reveal(b, EASY_REST[EASY_REST.length - 1]);
    t.eq([b.status, b.state[0], b.flags], ['won', e.FLAG, 10]);
    // a flag on a safe cell prevents the win until it is removed
    b = e.createBoardFromMines(9, 9, EASY_MINES);
    e.reveal(b, 40);
    e.toggleFlag(b, 1, false);
    EASY_REST.filter((i) => i !== 1).forEach((i) => e.reveal(b, i));
    t.eq(b.status, 'playing');
    e.toggleFlag(b, 1, false);
    e.reveal(b, 1);
    t.eq(b.status, 'won');
  });

  PandaTest.test('motor: dump ve özel oyun doğrulaması', (t) => {
    const e = E();
    t.eq(e.validate(20, 12, 40).ok, true);
    t.eq(e.validate(9, 9, 72).ok, true);
    t.eq(e.validate(9, 9, 73).errors.mines.includes('72'), true, 'üst sınır 72 olmalı');
    t.eq(e.validate(7, 12, 10).errors.width, 'Genişlik 8 ile 50 arasında olmalı.');
    t.eq(e.validate(51, 12, 10).ok, false);
    t.eq(e.validate(12, 31, 10).errors.height, 'Yükseklik 8 ile 30 arasında olmalı.');
    t.eq(e.validate(12, 12, 0).errors.mines, 'En az 1 mayın olmalı.');
    t.eq(e.validate(NaN, 12, 10).errors.width, 'Genişlik için bir tam sayı gir.');
    t.eq(e.validate(12.5, 12, 10).ok, false);
    t.eq(e.validate(50, 30, 5000).errors.mines.includes('999'), true, 'sayaç 999’da sınırlı');
    const b = e.createBoardFromMines(3, 2, [4]);
    e.toggleFlag(b, 0, false);
    e.toggleFlag(b, 1, true);
    e.toggleFlag(b, 1, true);
    e.reveal(b, 5);
    t.eq(e.dump(b), 'F?#\n##1');
    t.eq(e.dump(b, { showMines: true }), 'F?#\n#*1');
  });

  // ================================================================ app registration + layout
  test('uygulama kaydı, tek örnek ve ilk görünüm', async (t) => {
    const d = def();
    t.ok(d, 'minesweeper kayıtlı değil');
    t.eq([d.id, d.name, d.icon, d.singleInstance, d.category], ['minesweeper', 'Mayın Tarlası', 'minesweeper', true, 'games']);
    t.ok(d._engine, '_engine dışa açık olmalı');
    const w = fresh({ seed: 11 });
    t.ok(w && !w.isClosed(), 'pencere açılmadı');
    t.ok(w.body.classList.contains('app-minesweeper'));
    t.eq(w.getTitle(), 'Mayın Tarlası');
    t.eq(P.apps.launch('minesweeper'), w, 'tek örnekli uygulama aynı pencereyi döndürmeli');
    t.eq(P.apps.running('minesweeper').length, 1);
    t.eq($$(w, '.ms-cell').length, 81);
    t.eq([led(w, 'mines'), led(w, 'time'), faceOf(w)], ['010', '000', 'normal']);
    t.eq($$(w, '.ms-diff button.active').map((b) => b.textContent), ['Kolay']);
    t.eq(w.body.querySelector('.ms-st-state').textContent, 'Hazır');
    t.eq(w.body.querySelector('.ms-st-info').textContent, '9×9 · 10 mayın');
    t.eq(w.body.querySelector('.ms-st-best').textContent, 'En iyi: —');
    t.ok(!w.resizable && !w.maximizable, 'pencere yeniden boyutlandırılamaz olmalı');
    t.ok($(w, '.ms-board').getAttribute('role') === 'grid');
    t.ok($$(w, '.ms-cell.hid').length === 81, 'tüm kareler kapalı başlamalı');
  });

  test('pencere tahtaya göre boyutlanır ve ekrana sığar', async (t) => {
    const w = fresh({ difficulty: 'easy', seed: 1 });
    const sizes = {};
    const wa = P.wm.workArea();
    for (const id of ['easy', 'medium', 'hard']) {
      $(w, `.ms-diff button[data-d="${id}"]`).click();
      const b = w.getBounds();
      sizes[id] = b;
      const sc = $(w, '.ms-scroll');
      t.ok(sc.scrollWidth <= sc.clientWidth + 1 && sc.scrollHeight <= sc.clientHeight + 1, `${id}: tahta pencereye sığmalı (${sc.scrollWidth}x${sc.scrollHeight} / ${sc.clientWidth}x${sc.clientHeight})`);
      t.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= wa.width && b.y + b.height <= wa.height, `${id}: pencere çalışma alanında olmalı`);
      t.eq(ms(w).cellSize, 28, `${id}: hücre boyutu`);
      const cell = cellEl(w, 0).getBoundingClientRect();
      t.ok(Math.abs(cell.width - 28) < 0.6 && Math.abs(cell.height - 28) < 0.6, `${id}: hücre 28px olmalı (${cell.width}x${cell.height})`);
    }
    t.ok(sizes.easy.width < sizes.medium.width && sizes.medium.width < sizes.hard.width, 'pencere zorlukla genişlemeli');
    t.ok(sizes.easy.height < sizes.medium.height, 'pencere zorlukla yükselmeli');
    t.ok(sizes.easy.width >= 340, 'en küçük genişlik 340');
  });

  test('küçük ekranda hücreler küçülür, taşan tahta kaydırılır', async (t) => {
    const w = fresh({ difficulty: 'hard', seed: 1 });
    const real = P.wm.workArea;
    try {
      P.wm.workArea = () => ({ x: 0, y: 0, width: 700, height: 520 });
      ms(w).fit();
      const cs = ms(w).cellSize;
      t.ok(cs >= 16 && cs < 28, `hücre küçülmeli (${cs})`);
      const sc = $(w, '.ms-scroll');
      t.ok(sc.clientWidth > 0 && sc.clientHeight > 0);
      P.wm.workArea = () => ({ x: 0, y: 0, width: 1440, height: 852 });
      ms(w).fit();
      t.eq(ms(w).cellSize, 28, 'geniş ekranda 28px’e dönmeli');
    } finally {
      P.wm.workArea = real;
    }
  });

  // ================================================================ mouse play
  test('sol tık: ilk tıklama güvenli, alanı açar, süre başlar', async (t) => {
    const w = fresh({ seed: 7 });
    const m = ms(w);
    t.eq(m.clock.started, false);
    t.click(cellEl(w, 40));
    const b = m.board;
    t.eq(b.status, 'playing');
    t.ok(b.state[40] === 1 && !b.mine[40], 'tıklanan kare açılmalı');
    t.ok(nbrs(9, 9, 40).every((i) => !b.mine[i]), 'komşular mayınsız olmalı');
    t.ok($$(w, '.ms-cell.open').length === b.revealed && b.revealed > 1, 'DOM, motor durumuyla uyuşmalı');
    t.eq(m.clock.started, true);
    t.ok(m.clock.timer, 'zamanlayıcı çalışmalı');
    t.eq(led(w, 'mines'), '010');
    t.eq(w.body.querySelector('.ms-st-state').textContent.startsWith('Oynanıyor'), true);
    // numbers are painted with their class and text
    const numbered = $$(w, '.ms-cell.open').filter((c) => /\bn[1-8]\b/.test(c.className));
    t.ok(numbered.length > 0 && numbered.every((c) => c.className.includes('n' + c.textContent)), 'sayı sınıfı metinle eşleşmeli');
    t.eq(dump(w), E().dump(b), 'çift kontrol');
    // opening an already open empty cell does nothing
    const before = b.revealed;
    t.click(cellEl(w, 40));
    t.eq(b.revealed, before);
  });

  test('sağ tık: bayrak, soru işareti, sayaç ve yerel menü engeli', async (t) => {
    const w = fresh({ seed: 3 });
    const m = ms(w);
    const el = cellEl(w, 10);
    const ev = rightClick(t, el);
    t.ok(ev.defaultPrevented, 'sağ tık yerel menüsü engellenmeli');
    t.ok(el.classList.contains('flag'), 'bayrak konmalı');
    t.eq([led(w, 'mines'), m.board.flags], ['009', 1]);
    t.ok(!P.contextMenu.isOpen(), 'sağ tık PandaOS menüsünü açmamalı');
    t.eq(m.clock.started, false, 'bayrak koymak süreyi başlatmaz');
    rightClick(t, el);
    t.ok(el.classList.contains('hid') && !el.classList.contains('flag'));
    t.eq(led(w, 'mines'), '010');
    // flagged cells are not opened by a left click
    rightClick(t, el);
    t.click(el);
    t.ok(el.classList.contains('flag'), 'bayraklı kare açılmamalı');
    t.eq(m.board.status, 'ready');
    // too many flags → negative counter
    for (let i = 20; i < 31; i++) rightClick(t, cellEl(w, i));
    t.eq(led(w, 'mines'), '-02');
    // long press on touch screens: a contextmenu event without a preceding right mousedown flags too
    const target = cellEl(w, 60);
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    t.ok(target.classList.contains('flag'), 'uzun basma bayrak koymalı');
  });

  test('soru işareti açıkken döngü: bayrak → ? → boş', async (t) => {
    const w = fresh({ seed: 3 }, { questionMarks: true });
    t.eq(ms(w).state.questionMarks, true);
    const el = cellEl(w, 5);
    rightClick(t, el);
    t.ok(el.classList.contains('flag'));
    rightClick(t, el);
    t.ok(el.classList.contains('q') && el.textContent === '?', 'soru işareti görünmeli');
    t.eq(led(w, 'mines'), '010', 'soru işareti sayacı etkilemez');
    rightClick(t, el);
    t.ok(el.classList.contains('hid') && el.textContent === '');
    // a ? cell opens with a normal click
    rightClick(t, el);
    rightClick(t, el);
    t.ok(el.classList.contains('q'));
    t.click(el);
    t.ok(el.classList.contains('open'));
  });

  test('boş alan yayılması arayüzde de doğru görünür', async (t) => {
    const w = fresh({});
    const b = layoutBoard(w, 5, 5, [2, 7, 12, 17, 22]);
    t.click(cellEl(w, 0));
    t.eq(dump(w), '.2###\n.3###\n.3###\n.3###\n.2###');
    t.eq(classes(w, 0), 'ms-cell open');
    t.eq(classes(w, 1), 'ms-cell open n2');
    t.eq(cellEl(w, 6).textContent, '3');
    t.ok(cellEl(w, 2).classList.contains('hid'));
    t.eq(b.revealed, 10);
  });

  test('sayıya tıklama: sol tık, orta tık ve sol+sağ ile komşuları açar', async (t) => {
    const w = fresh({});
    layoutBoard(w, 5, 5, [6]);
    t.click(cellEl(w, 0));
    t.eq(classes(w, 0), 'ms-cell open n1');
    // no flag yet: the click on the number does nothing, and the pressed look is cleared afterwards
    t.click(cellEl(w, 0));
    t.eq([classes(w, 1), classes(w, 5)], ['ms-cell hid', 'ms-cell hid']);
    t.eq($$(w, '.ms-cell.press').length, 0, 'basılı görünüm kalmamalı');
    // a wrong flag count (2 flags for a 1) does not chord either
    rightClick(t, cellEl(w, 6));
    rightClick(t, cellEl(w, 1));
    t.click(cellEl(w, 0));
    t.eq([classes(w, 5), classes(w, 1)], ['ms-cell hid', 'ms-cell flag']);
    rightClick(t, cellEl(w, 1));
    // correct flag count: left click on the number opens the rest of the neighbourhood
    t.click(cellEl(w, 0));
    t.eq([classes(w, 1), classes(w, 5)], ['ms-cell open n1', 'ms-cell open n1']);

    // middle click
    layoutBoard(w, 5, 5, [6]);
    t.click(cellEl(w, 0));
    rightClick(t, cellEl(w, 6));
    t.mouse(cellEl(w, 0), 'mousedown', { button: 1, buttons: 4 });
    t.ok($$(w, '.ms-cell.press').length > 0, 'orta tuş basılıyken komşular basık görünmeli');
    t.eq(faceOf(w), 'oh');
    t.mouse(cellEl(w, 0), 'mouseup', { button: 1, buttons: 0 });
    t.eq([classes(w, 1), classes(w, 5)], ['ms-cell open n1', 'ms-cell open n1']);
    t.eq(faceOf(w), 'normal');

    // left + right together
    layoutBoard(w, 5, 5, [6]);
    t.click(cellEl(w, 0));
    rightClick(t, cellEl(w, 6));
    t.mouse(cellEl(w, 0), 'mousedown', { button: 0, buttons: 1 });
    t.mouse(cellEl(w, 0), 'mousedown', { button: 2, buttons: 3 });
    t.mouse(cellEl(w, 0), 'mouseup', { button: 2, buttons: 1 });
    t.mouse(cellEl(w, 0), 'mouseup', { button: 0, buttons: 0 });
    t.eq([classes(w, 1), classes(w, 5)], ['ms-cell open n1', 'ms-cell open n1']);
    t.eq(faceOf(w), 'normal');

    // shift + click is a chord as well
    layoutBoard(w, 5, 5, [6]);
    t.click(cellEl(w, 0));
    rightClick(t, cellEl(w, 6));
    t.click(cellEl(w, 0), { shiftKey: true });
    t.eq(classes(w, 1), 'ms-cell open n1');
  });

  test('yanlış bayrakla sayıya tıklamak mayını patlatır', async (t) => {
    const w = fresh({});
    layoutBoard(w, 5, 5, [6]);
    t.click(cellEl(w, 0));
    rightClick(t, cellEl(w, 1));
    t.click(cellEl(w, 0));
    t.eq(ms(w).board.status, 'lost');
    t.ok(cellEl(w, 6).classList.contains('boom'), 'patlayan mayın kırmızı olmalı');
    t.ok(cellEl(w, 1).classList.contains('wrong'), 'yanlış bayrak işaretlenmeli');
    t.eq(faceOf(w), 'dead');
  });

  test('kaybetme: mayınlar açılır, patlayan kırmızı, yanlış bayrak çizili, yüz ölü', async (t) => {
    const w = fresh({ seed: 1 });
    const m = ms(w);
    const b = layoutBoard(w, 9, 9, EASY_MINES);
    t.click(cellEl(w, 40));
    t.ok(m.clock.started);
    rightClick(t, cellEl(w, 0));   // correct flag
    rightClick(t, cellEl(w, 1));   // wrong flag
    t.eq(led(w, 'mines'), '008');
    t.click(cellEl(w, 2));         // boom
    t.eq([b.status, m.over, faceOf(w)], ['lost', true, 'dead']);
    t.ok(cellEl(w, 2).classList.contains('boom') && cellEl(w, 2).classList.contains('mine'), 'patlayan mayın');
    [4, 6, 8, 72, 74, 76, 78, 80].forEach((i) => t.ok(cellEl(w, i).classList.contains('mine') && !cellEl(w, i).classList.contains('boom'), `mayın ${i} görünmeli`));
    t.ok(cellEl(w, 0).classList.contains('flag'), 'doğru bayrak yerinde kalmalı');
    t.ok(cellEl(w, 1).classList.contains('wrong'), 'yanlış bayrak çizilmeli');
    t.ok(cellEl(w, 3).classList.contains('hid'), 'diğer kapalı kareler kapalı kalmalı');
    t.eq(w.body.querySelector('.ms-st-state').textContent, 'Mayına bastın');
    t.ok(bannerText(w).includes('Mayına bastın!'), 'kayıp bandı: ' + bannerText(w));
    t.ok($(w, '.ms-banner.lose'));
    t.eq(m.clock.timer, 0, 'süre durmalı');
    t.ok($(w, '.ms-frame').classList.contains('shake'), 'sallanma animasyonu');
    t.eq(stored().stats.easy, { played: 1, won: 0, streak: 0, bestStreak: 0, totalTime: 0 });
    t.eq(stored().best.easy, null);
    // the board is frozen
    t.click(cellEl(w, 3));
    rightClick(t, cellEl(w, 3));
    t.ok(cellEl(w, 3).classList.contains('hid'));
    t.eq(led(w, 'mines'), '008');
    await t.sleep(700);
    t.ok(!$(w, '.ms-frame').classList.contains('shake'), 'sallanma sonra bitmeli');
    // F2 starts over
    t.key(w.el, 'F2');
    t.eq([ms(w).board.status, faceOf(w), $(w, '.ms-banner')], ['ready', 'normal', null]);
    t.eq($$(w, '.ms-cell.hid').length, 81);
  });

  test('kazanma: afiş, otomatik bayrak, rekor ve istatistikler', async (t) => {
    const w = fresh({ seed: 1 });
    const m = ms(w);
    const clk = { t: 5000000 };
    m.now = () => clk.t;
    async function play(seconds) {
      const b = layoutBoard(w, 9, 9, EASY_MINES);
      t.click(cellEl(w, 40));
      t.eq(b.status, 'playing');
      clk.t += seconds * 1000 + 300;
      for (const i of EASY_REST) t.click(cellEl(w, i));
      return b;
    }

    let b = await play(42);
    t.eq([b.status, m.over, faceOf(w)], ['won', true, 'cool']);
    t.ok(bannerText(w).includes('Kazandın! 42 saniye'), 'afiş metni: ' + bannerText(w));
    t.ok(bannerText(w).includes('Yeni rekor!'), 'ilk zafer rekor sayılmalı');
    t.eq(led(w, 'time'), '042');
    t.eq(led(w, 'mines'), '000', 'tüm mayınlar bayraklanınca sayaç 0');
    EASY_MINES.forEach((i) => t.ok(cellEl(w, i).classList.contains('flag'), `mayın ${i} bayraklanmalı`));
    t.eq(w.body.querySelector('.ms-st-state').textContent, 'Kazandın!');
    t.eq(w.body.querySelector('.ms-st-best').textContent, 'En iyi: 42 sn');
    t.eq(m.clock.timer, 0);
    let s = stored();
    t.eq([s.best.easy, s.stats.easy.played, s.stats.easy.won, s.stats.easy.streak, s.stats.easy.bestStreak, s.stats.easy.totalTime], [42, 1, 1, 1, 1, 42]);
    t.eq(s.records.easy.map((r) => r.t), [42]);
    // banner buttons exist, close hides it
    t.ok($(w, '.ms-banner-new').textContent === 'Yeni Oyun');
    t.click($(w, '.ms-banner-close'));
    t.ok(!$(w, '.ms-banner'), 'afiş kapanmalı');

    // slower win: no record
    b = await play(60);
    t.ok(bannerText(w).includes('Kazandın! 60 saniye'));
    t.ok(!bannerText(w).includes('Yeni rekor!'), 'daha yavaş süre rekor olmamalı');
    t.ok(bannerText(w).includes('En iyi süre: 42 saniye'));
    s = stored();
    t.eq([s.best.easy, s.stats.easy.played, s.stats.easy.won, s.stats.easy.streak], [42, 2, 2, 2]);

    // faster win: record again, top list sorted
    b = await play(30);
    t.ok(bannerText(w).includes('Kazandın! 30 saniye') && bannerText(w).includes('Yeni rekor!'));
    t.ok(bannerText(w).includes('Önceki rekor: 42 saniye'));
    s = stored();
    t.eq(s.best.easy, 30);
    t.eq(s.records.easy.map((r) => r.t), [30, 42, 60]);
    t.eq([s.stats.easy.played, s.stats.easy.won, s.stats.easy.bestStreak], [3, 3, 3]);

    // a loss resets the streak but keeps the best
    layoutBoard(w, 9, 9, EASY_MINES);
    t.click(cellEl(w, 40));
    t.click(cellEl(w, 0));
    s = stored();
    t.eq([s.stats.easy.played, s.stats.easy.won, s.stats.easy.streak, s.stats.easy.bestStreak, s.best.easy], [4, 3, 0, 3, 30]);
  });

  test('sesler: kazanma ve patlama ses üretir, "Oyun sesleri" kapalıyken sessiz kalır', async (t) => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const counts = { osc: 0, buf: 0 };
    const proto = AC.prototype;
    const origOsc = proto.createOscillator;
    const origBuf = proto.createBufferSource;
    proto.createOscillator = function () { counts.osc++; return origOsc.apply(this, arguments); };
    proto.createBufferSource = function () { counts.buf++; return origBuf.apply(this, arguments); };
    try {
      const w = fresh({ seed: 1 });
      const ctx = P.sound.context();
      if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch (e) { /* ignore */ } }
      if (!ctx || ctx.state !== 'running') return;   // headless without audio output: nothing to measure
      layoutBoard(w, 9, 9, EASY_MINES);
      t.click(cellEl(w, 40));
      EASY_REST.slice(0, -1).forEach((i) => t.click(cellEl(w, i)));
      counts.osc = 0; counts.buf = 0;
      t.click(cellEl(w, EASY_REST[EASY_REST.length - 1]));
      t.eq(ms(w).board.status, 'won');
      t.eq([counts.osc, counts.buf], [9, 0], 'kazanma melodisi: 4 nota x 2 + parıltı');
      layoutBoard(w, 9, 9, EASY_MINES);
      t.click(cellEl(w, 40));
      counts.osc = 0; counts.buf = 0;
      t.click(cellEl(w, 0));
      t.eq([counts.osc, counts.buf], [1, 1], 'patlama: gürültü patlaması + alçak vuruş');
      // sounds off → silence
      ms(w).state.sound = false;
      layoutBoard(w, 9, 9, EASY_MINES);
      t.click(cellEl(w, 40));
      counts.osc = 0; counts.buf = 0;
      t.click(cellEl(w, 0));
      t.eq([counts.osc, counts.buf], [0, 0], 'ses kapalıyken ses çıkmamalı');
    } finally {
      proto.createOscillator = origOsc;
      proto.createBufferSource = origBuf;
    }
  });

  test('yüz: basılıyken "oh", bırakınca normal, tahta dışında bırakmak iptal eder', async (t) => {
    const w = fresh({ seed: 9 });
    const el = cellEl(w, 20);
    t.eq(faceOf(w), 'normal');
    t.mouse(el, 'mousedown', { button: 0, buttons: 1 });
    t.eq(faceOf(w), 'oh');
    t.ok(el.classList.contains('press'), 'basılan kare basık görünmeli');
    t.mouse(cellEl(w, 21), 'mousemove', { buttons: 1 });
    t.ok(!el.classList.contains('press') && cellEl(w, 21).classList.contains('press'), 'basık görünüm fareyi izlemeli');
    // release outside the board: nothing is opened, the face recovers
    t.mouse(document.body, 'mouseup', { button: 0, buttons: 0 });
    t.eq(faceOf(w), 'normal');
    t.eq(ms(w).board.status, 'ready');
    t.eq($$(w, '.ms-cell.press').length, 0);
    // the face button starts a new game
    t.click(cellEl(w, 20));
    t.eq(ms(w).board.status, 'playing');
    t.click($(w, '.ms-face'));
    t.eq([ms(w).board.status, led(w, 'time')], ['ready', '000']);
  });

  // ================================================================ difficulty, menu, custom
  test('zorluk seçimi: boyut, mayın, pencere ve kalıcılık', async (t) => {
    let w = fresh({ seed: 2 });
    $(w, '.ms-diff button[data-d="medium"]').click();
    t.eq([$$(w, '.ms-cell').length, led(w, 'mines'), ms(w).config.id], [256, '040', 'medium']);
    t.eq(w.body.querySelector('.ms-st-info').textContent, '16×16 · 40 mayın');
    t.eq($$(w, '.ms-diff button.active').map((b) => b.dataset.d), ['medium']);
    t.eq(stored().difficulty, 'medium');
    $(w, '.ms-diff button[data-d="hard"]').click();
    t.eq([$$(w, '.ms-cell').length, led(w, 'mines'), ms(w).board.width, ms(w).board.height], [480, '099', 30, 16]);
    t.eq(w.body.querySelector('.ms-st-best').textContent, 'En iyi: —');
    // reopening restores the last difficulty
    w.forceClose();
    w = P.apps.launch('minesweeper');
    t.eq([ms(w).config.id, $$(w, '.ms-cell').length], ['hard', 480]);
    t.eq($$(w, '.ms-diff button.active').map((b) => b.dataset.d), ['hard']);
    // switching during a game starts a fresh board
    t.click(cellEl(w, 100));
    t.eq(ms(w).board.status, 'playing');
    $(w, '.ms-diff button[data-d="easy"]').click();
    t.eq([ms(w).board.status, $$(w, '.ms-cell').length, ms(w).clock.started], ['ready', 81, false]);
  });

  test('Oyun menüsü: öğeler, zorluk, soru işareti ve ses seçenekleri', async (t) => {
    const w = fresh({ seed: 2 });
    const btn = $(w, '.ms-menu-btn');
    t.click(btn);
    await t.sleep(30);
    const labels = () => t.$$('#context-menu-layer .ctx-item').map((i) => i.textContent);
    let items = labels();
    t.ok(items.length >= 8, 'menü öğeleri yok: ' + items.join('|'));
    ['Yeni Oyun', 'Kolay', 'Orta', 'Zor', 'Özel', 'Soru işaretleri', 'Oyun sesleri', 'İstatistikler', 'Nasıl oynanır'].forEach((l) => {
      t.ok(items.some((x) => x.includes(l)), `"${l}" menüde yok`);
    });
    t.ok(t.$$('#context-menu-layer .ctx-item.checked').some((i) => i.textContent.includes('Kolay')), 'geçerli zorluk işaretli olmalı');
    // pick "Orta"
    t.click(t.$$('#context-menu-layer .ctx-item').find((i) => i.textContent.includes('Orta')));
    await t.sleep(30);
    t.eq(ms(w).config.id, 'medium');
    t.ok(!P.contextMenu.isOpen(), 'menü kapanmalı');
    // toggle question marks
    t.click(btn);
    await t.sleep(30);
    t.click(t.$$('#context-menu-layer .ctx-item').find((i) => i.textContent.includes('Soru işaretleri')));
    await t.sleep(30);
    t.eq([ms(w).state.questionMarks, stored().questionMarks], [true, true]);
    const el = cellEl(w, 3);
    rightClick(t, el);
    rightClick(t, el);
    t.ok(el.classList.contains('q'), 'soru işareti artık devrede olmalı');
    // toggle sound off
    t.click(btn);
    await t.sleep(30);
    items = t.$$('#context-menu-layer .ctx-item');
    t.ok(items.find((i) => i.textContent.includes('Oyun sesleri')).classList.contains('checked'));
    t.click(items.find((i) => i.textContent.includes('Oyun sesleri')));
    await t.sleep(30);
    t.eq(stored().sound, false);
    // statistics item opens the panel
    t.click(btn);
    await t.sleep(30);
    t.click(t.$$('#context-menu-layer .ctx-item').find((i) => i.textContent.includes('İstatistikler')));
    await t.sleep(30);
    t.eq(ms(w).panel, 'stats');
    // clicking the button while its menu is open closes it instead of reopening
    ms(w).closePanel();
    t.click(btn);
    await t.sleep(30);
    t.ok(P.contextMenu.isOpen());
    t.click(btn);
    await t.sleep(30);
    t.ok(!P.contextMenu.isOpen(), 'düğmeye tekrar basmak menüyü kapatmalı');
    // right click on the header area offers the same menu
    t.contextmenu($(w, '.ms-header'));
    await t.sleep(30);
    t.ok(P.contextMenu.isOpen(), 'başlık alanında sağ tık menü açmalı');
    P.contextMenu.hide();
  });

  test('özel oyun formu: doğrulama, hata iletileri ve başlatma', async (t) => {
    const w = fresh({ seed: 2 });
    t.click($(w, '.ms-diff button[data-d="custom"]'));
    await t.sleep(30);
    t.eq(ms(w).panel, 'custom');
    const f = ms(w).customForm.fields;
    t.eq([f.width.value, f.height.value, f.mines.value], ['20', '12', '40'], 'varsayılan değerler');
    t.ok(!w.body.querySelector('.ms-overlay').hidden);
    t.eq(w.body.querySelector('.ms-scroll').inert, true, 'arka plan etkisiz olmalı');
    const err = (k) => $(w, `.ms-field:has([data-field="${k}"]) .ms-err`).textContent;
    t.eq([err('width'), err('height'), err('mines')], ['', '', '']);
    // invalid width
    f.width.value = '';
    f.width.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(err('width'), 'Genişlik için bir tam sayı gir.');
    f.width.value = '4';
    f.width.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(err('width'), 'Genişlik 8 ile 50 arasında olmalı.');
    t.eq(f.width.getAttribute('aria-invalid'), 'true');
    t.ok(f.width.classList.contains('invalid'));
    // the form refuses to start
    const before = ms(w).board;
    t.click($(w, '.ms-custom-start'));
    t.eq(ms(w).panel, 'custom', 'geçersiz değerle panel açık kalmalı');
    t.ok(ms(w).board === before, 'geçersiz değerle yeni oyun başlamamalı');
    // too many mines for the size
    f.width.value = '10'; f.height.value = '10'; f.mines.value = '92';
    f.mines.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(err('mines'), 'Bu boyutta en fazla 91 mayın olabilir.');
    f.mines.value = '0';
    f.mines.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(err('mines'), 'En az 1 mayın olmalı.');
    f.mines.value = '3.5';
    f.mines.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq(err('mines'), 'Mayın sayısı için bir tam sayı gir.');
    // valid → starts a custom game
    f.width.value = '12'; f.height.value = '10'; f.mines.value = '20';
    f.mines.dispatchEvent(new Event('input', { bubbles: true }));
    t.eq([err('width'), err('height'), err('mines')], ['', '', '']);
    t.ok($(w, '.ms-summary').textContent.includes('120 kare'));
    t.click($(w, '.ms-custom-start'));
    await t.sleep(30);
    t.eq(ms(w).panel, null);
    t.eq([ms(w).config.id, $$(w, '.ms-cell').length, led(w, 'mines'), ms(w).board.width, ms(w).board.height], ['custom', 120, '020', 12, 10]);
    t.eq($$(w, '.ms-diff button.active').map((b) => b.dataset.d), ['custom']);
    t.eq(stored().custom, { width: 12, height: 10, mines: 20 });
    t.eq(stored().difficulty, 'custom');
    t.eq(w.body.querySelector('.ms-st-best').textContent, '', 'özel oyunda rekor gösterilmez');
    t.eq(w.body.querySelector('.ms-scroll').inert, false);

    // reopening starts from the saved custom values; Enter submits; Escape cancels
    t.click($(w, '.ms-diff button[data-d="custom"]'));
    await t.sleep(30);
    const g = ms(w).customForm.fields;
    t.eq([g.width.value, g.height.value, g.mines.value], ['12', '10', '20']);
    g.mines.value = '25';
    g.mines.dispatchEvent(new Event('input', { bubbles: true }));
    $(w, '.ms-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await t.sleep(30);
    t.eq([ms(w).board.mines, led(w, 'mines')], [25, '025']);
    t.click($(w, '.ms-diff button[data-d="custom"]'));
    await t.sleep(30);
    t.key(w.el, 'Escape');
    await t.sleep(30);
    t.eq(ms(w).panel, null);
    t.eq(ms(w).board.mines, 25, 'Escape yeni oyun başlatmamalı');

    // custom wins and losses are counted, without a best time
    layoutBoard(w, 8, 8, [0], 'custom');
    t.click(cellEl(w, 63));
    t.eq(ms(w).board.status, 'won');
    t.eq(stored().stats.custom.won, 1);
    t.eq(stored().best.easy, null);
    t.ok(!bannerText(w).includes('Yeni rekor!'), 'özel oyunda rekor yok');
  });

  test('açılışta argümanlar: zorluk, tohum, özel boyut ve yeniden başlatma', async (t) => {
    const w = fresh({ difficulty: 'hard', seed: 5 });
    t.eq([ms(w).config.id, ms(w).board.seed, $$(w, '.ms-cell').length], ['hard', 5, 480]);
    // launching a running single-instance app with arguments reconfigures it
    const same = P.apps.launch('minesweeper', { width: 10, height: 9, mines: 12, seed: 8 });
    t.eq(same, w);
    t.eq([ms(w).config.id, ms(w).board.width, ms(w).board.height, ms(w).board.mines, ms(w).board.seed], ['custom', 10, 9, 12, 8]);
    P.apps.launch('minesweeper', { difficulty: 'medium' });
    t.eq(ms(w).config.id, 'medium');
    // the seed makes boards reproducible through the UI
    P.apps.launch('minesweeper', { difficulty: 'easy', seed: 99 });
    t.click(cellEl(w, 40));
    const first = Array.from(ms(w).board.mine).join('');
    P.apps.launch('minesweeper', { difficulty: 'easy', seed: 99 });
    t.click(cellEl(w, 40));
    t.eq(Array.from(ms(w).board.mine).join(''), first);
    // invalid sizes are ignored (the game keeps working)
    P.apps.launch('minesweeper', { width: 3, height: 3, mines: 50 });
    t.ok(ms(w).board.width >= 8);
  });

  // ================================================================ keyboard
  test('klavye: ok tuşları, Boşluk/Enter, F, Home/End ve F2', async (t) => {
    const w = fresh({ seed: 3 });
    P.wm.focus(w.id);
    const m = ms(w);
    const board = $(w, '.ms-board');
    board.focus();
    t.eq(w.body.classList.contains('kb'), false, 'imleç başta görünmemeli');
    t.eq(m.cursor, 40, 'imleç ortada başlar');
    t.key(board, 'ArrowRight');
    t.ok(w.body.classList.contains('kb'), 'ilk tuş imleci göstermeli');
    t.eq(m.cursor, 40, 'ilk tuş imleci oynatmaz');
    t.ok(cellEl(w, 40).classList.contains('cursor'));
    t.key(board, 'ArrowRight');
    t.eq(m.cursor, 41);
    t.key(board, 'ArrowDown');
    t.eq(m.cursor, 50);
    t.key(board, 'ArrowUp');
    t.key(board, 'ArrowUp');
    t.eq(m.cursor, 32);
    t.ok(cellEl(w, 32).classList.contains('cursor') && !cellEl(w, 41).classList.contains('cursor'), 'imleç sınıfı taşınmalı');
    t.key(board, 'Home');
    t.eq(m.cursor, 27);
    t.key(board, 'ArrowLeft');
    t.eq(m.cursor, 27, 'sol kenarda durmalı');
    t.key(board, 'End');
    t.eq(m.cursor, 35);
    t.key(board, 'ArrowRight');
    t.eq(m.cursor, 35, 'sağ kenarda durmalı');
    for (let i = 0; i < 10; i++) t.key(board, 'ArrowUp');
    t.eq(m.cursor, 8, 'üst kenarda durmalı');
    // flag with F
    t.key(board, 'f');
    t.ok(cellEl(w, 8).classList.contains('flag'));
    t.eq(led(w, 'mines'), '009');
    t.key(board, 'F');
    t.ok(cellEl(w, 8).classList.contains('hid'));
    // Space reveals
    t.key(board, 'ArrowLeft');
    t.key(board, 'ArrowLeft');
    t.eq(m.cursor, 6);
    t.key(board, ' ');
    t.eq(m.board.status, 'playing');
    t.ok(m.board.state[6] === 1);
    // Enter on the same (now open) number is a chord attempt: harmless without flags
    const before = m.board.revealed;
    t.key(board, 'Enter');
    t.eq(m.board.revealed, before);
    // F2: new game
    const old = m.board;
    t.key(board, 'F2');
    t.ok(m.board !== old && m.board.status === 'ready');
    // a mouse click hides the keyboard cursor again
    t.click(cellEl(w, 12));
    t.eq(w.body.classList.contains('kb'), false);
    t.eq(m.cursor, 12, 'tıklanan kare imleç olur');
  });

  test('klavye: Enter ile chord, panel açıkken tuşlar yok sayılır', async (t) => {
    const w = fresh({});
    P.wm.focus(w.id);
    const m = ms(w);
    layoutBoard(w, 5, 5, [6]);
    const board = $(w, '.ms-board');
    board.focus();
    t.key(board, 'ArrowRight');           // show the cursor (centre = 12)
    t.eq(m.cursor, 12);
    t.key(board, 'ArrowUp'); t.key(board, 'ArrowUp'); t.key(board, 'ArrowLeft'); t.key(board, 'ArrowLeft');
    t.eq(m.cursor, 0);
    t.key(board, ' ');
    t.eq(classes(w, 0), 'ms-cell open n1');
    t.key(board, 'ArrowRight'); t.key(board, 'ArrowDown');
    t.eq(m.cursor, 6);
    t.key(board, 'f');
    t.ok(cellEl(w, 6).classList.contains('flag'));
    t.key(board, 'Home'); t.key(board, 'ArrowUp');
    t.eq(m.cursor, 0);
    t.key(board, 'Enter');
    t.eq([classes(w, 1), classes(w, 5)], ['ms-cell open n1', 'ms-cell open n1']);
    // with a panel open the board ignores the keyboard
    ms(w).openStats();
    await t.sleep(30);
    const cur = m.cursor;
    t.key(w.el, 'ArrowRight');
    t.key(w.el, 'f');
    t.eq(m.cursor, cur);
    t.eq(m.board.flags, 1);
    const same = m.board;
    t.key(w.el, 'F2');
    t.ok(m.board === same, 'panel açıkken F2 oyunu sıfırlamamalı');
    t.key(w.el, 'Escape');
    await t.sleep(30);
    t.eq(m.panel, null);
  });

  // ================================================================ clock
  test('süre: ilk açılışta başlar, 999’da sınırlanır, küçültünce ve panel açıkken durur', async (t) => {
    const w = fresh({ seed: 4 });
    const m = ms(w);
    const clk = { t: 10000000 };
    m.now = () => clk.t;
    rightClick(t, cellEl(w, 0));
    clk.t += 5000;
    await t.sleep(300);
    t.eq([m.clock.started, led(w, 'time')], [false, '000'], 'bayrak süreyi başlatmaz');
    t.click(cellEl(w, 40));
    t.eq(m.clock.started, true);
    clk.t += 5400;
    await t.sleep(300);
    t.eq(led(w, 'time'), '005', 'süre saniye cinsinden akmalı');
    // minimizing pauses the clock
    w.minimize();
    t.ok(m.clock.paused.has('minimized'));
    clk.t += 60000;
    await t.sleep(300);
    t.eq(led(w, 'time'), '005', 'küçültülmüşken süre akmamalı');
    w.restore();
    t.ok(!m.clock.paused.has('minimized'));
    clk.t += 2000;
    await t.sleep(300);
    t.eq(led(w, 'time'), '007');
    // an open panel pauses it too
    m.openStats();
    await t.sleep(30);
    t.ok(m.clock.paused.has('panel'));
    clk.t += 50000;
    await t.sleep(300);
    t.eq(led(w, 'time'), '007');
    m.closePanel();
    await t.sleep(30);
    t.ok(!m.clock.paused.has('panel'));
    clk.t += 3000;
    await t.sleep(300);
    t.eq(led(w, 'time'), '010');
    // capped at 999
    clk.t += 5000 * 1000;
    await t.sleep(300);
    t.eq(led(w, 'time'), '999');
    t.eq(m.seconds(), 999);
  });

  // ================================================================ statistics
  test('istatistik paneli: sekmeler, değerler, en iyi 5 süre ve sıfırlama', async (t) => {
    const seed = {
      stats: { easy: { played: 10, won: 4, streak: 2, bestStreak: 3, totalTime: 200 }, hard: { played: 3, won: 0, streak: 0, bestStreak: 0, totalTime: 0 } },
      best: { easy: 31, medium: null, hard: null },
      records: { easy: [{ t: 31, at: Date.now() }, { t: 45, at: Date.now() }, { t: 60, at: Date.now() }] }
    };
    const w = fresh({ seed: 1 }, seed);
    t.click($(w, '.ms-stats-btn'));
    await t.sleep(30);
    t.eq(ms(w).panel, 'stats');
    t.ok(!w.body.querySelector('.ms-overlay').hidden);
    t.eq($$(w, '.ms-tabs .p-tab').map((b) => b.textContent), ['Kolay', 'Orta', 'Zor', 'Özel']);
    t.eq($$(w, '.ms-tabs .p-tab.active').map((b) => b.textContent), ['Kolay'], 'geçerli zorluk sekmesi açık gelmeli');
    const grid = () => $$(w, '.ms-stat').map((c) => `${c.querySelector('.ms-stat-label').textContent}=${c.querySelector('.ms-stat-num').textContent}`);
    t.eq(grid(), ['Oynanan=10', 'Kazanılan=4', 'Başarı=%40', 'En iyi süre=31 sn', 'Ortalama=50 sn', 'Seri=2']);
    t.eq($(w, '.ms-stat-sub').textContent, 'en uzun 3');
    t.eq($$(w, '.ms-top-item').map((li) => li.querySelector('.ms-top-time').textContent), ['31 saniye', '45 saniye', '60 saniye']);
    // other tabs
    t.click($$(w, '.ms-tabs .p-tab')[1]);
    t.eq(grid().slice(0, 4), ['Oynanan=0', 'Kazanılan=0', 'Başarı=—', 'En iyi süre=—']);
    t.ok($(w, '.ms-top-empty').textContent.includes('Henüz'));
    t.click($$(w, '.ms-tabs .p-tab')[2]);
    t.eq(grid().slice(0, 3), ['Oynanan=3', 'Kazanılan=0', 'Başarı=%0']);
    t.click($$(w, '.ms-tabs .p-tab')[3]);
    t.ok($(w, '.ms-top-empty').textContent.includes('Özel oyunlarda rekor tutulmaz'));
    t.click($$(w, '.ms-tabs .p-tab')[0]);
    // reset needs confirmation; cancelling keeps everything
    t.click($(w, '.ms-reset'));
    await t.waitFor(() => P.dialog.isOpen());
    t.click(t.$('#dialog-layer .dlg-btn:not(.dlg-primary)'));
    await t.waitFor(() => !P.dialog.isOpen());
    t.eq(stored().best.easy, 31);
    t.eq(stored().stats.easy.played, 10);
    // confirming wipes it
    t.click($(w, '.ms-reset'));
    await t.waitFor(() => P.dialog.isOpen());
    t.click(t.$('#dialog-layer .dlg-primary'));
    await t.waitFor(() => !P.dialog.isOpen());
    await t.sleep(30);
    t.eq(stored().best.easy, null);
    t.eq(stored().stats.easy, { played: 0, won: 0, streak: 0, bestStreak: 0, totalTime: 0 });
    t.eq(stored().records.easy, []);
    t.eq(grid()[0], 'Oynanan=0');
    t.eq(w.body.querySelector('.ms-st-best').textContent, 'En iyi: —', 'durum çubuğu da güncellenmeli');
    // the close button and the backdrop close the panel
    t.click($(w, '.ms-stats-close'));
    await t.sleep(30);
    t.eq(ms(w).panel, null);
    t.ok(w.body.querySelector('.ms-overlay').hidden);
    ms(w).openStats();
    await t.sleep(30);
    t.mouse(w.body.querySelector('.ms-overlay'), 'mousedown', { button: 0, buttons: 1 });
    t.eq(ms(w).panel, null, 'arka plana tıklamak paneli kapatmalı');
  });

  test('nasıl oynanır paneli açılır ve kapanır', async (t) => {
    const w = fresh({ seed: 1 });
    ms(w).openHelp();
    await t.sleep(30);
    t.eq(ms(w).panel, 'help');
    t.ok($(w, '.ms-panel').textContent.includes('Sağ tık') && $(w, '.ms-panel').textContent.includes('F2'));
    t.click($(w, '.ms-panel-foot .primary'));
    await t.sleep(30);
    t.eq(ms(w).panel, null);
    t.ok(document.activeElement === $(w, '.ms-board') || w.el.contains(document.activeElement), 'odak pencerede kalmalı');
  });

  test('bozuk kayıtlı veri varsayılanlarla toparlanır', async (t) => {
    closeAll();
    P.storage.set(STORE, { difficulty: 'bilinmeyen', custom: { width: 3, height: 'x', mines: -4 }, best: { easy: -5, medium: 'a', hard: 5000 }, stats: { easy: { played: 'x', won: 99 } }, records: { easy: [{ t: 'a' }, null, { t: 20, at: 1 }] }, questionMarks: 'evet', sound: 0 });
    const w = P.apps.launch('minesweeper');
    t.ok(w, 'bozuk veriyle açılmalı');
    const s = ms(w).state;
    t.eq([s.difficulty, s.custom, s.best.easy, s.best.medium, s.best.hard], ['easy', { width: 20, height: 12, mines: 40 }, null, null, null]);
    t.eq(s.stats.easy, { played: 0, won: 0, streak: 0, bestStreak: 0, totalTime: 0 });
    t.eq(s.records.easy, [{ t: 20, at: 1 }]);
    t.eq([s.questionMarks, s.sound], [false, true]);
    w.forceClose();
    localStorage.setItem('pandaos.' + STORE, '{kırık json');
    const w2 = P.apps.launch('minesweeper');
    t.ok(w2 && $$(w2, '.ms-cell').length === 81, 'geçersiz JSON ile de açılmalı');
  });

  // ================================================================ look
  test('sayı renkleri her iki temada okunur (>= 4,5:1) ve karolar ayırt edilir', async (t) => {
    const w = fresh({ seed: 1 });
    const board = $(w, '.ms-board');
    const orig = P.theme.get();
    try {
      for (const mode of ['dark', 'light']) {
        P.theme.set(mode);
        await t.sleep(30);
        const probe = (cls) => { const c = document.createElement('div'); c.className = 'ms-cell ' + cls; board.appendChild(c); const cs = getComputedStyle(c); const r = { color: rgb(cs.color), bg: rgb(cs.backgroundColor), img: getComputedStyle(c, '::before').backgroundImage }; c.remove(); return r; };
        for (let n = 1; n <= 8; n++) {
          const p = probe('open n' + n);
          t.ok(p.color && p.bg, `${mode}: renk okunamadı (n${n})`);
          const cr = contrast(p.color, p.bg);
          t.ok(cr >= 4.5, `${mode}: ${n} sayısı kontrastı ${cr.toFixed(2)} < 4,5`);
        }
        const hid = probe('hid');
        const open = probe('open');
        t.ok(hid.bg && open.bg, `${mode}: karo rengi okunamadı`);
        t.ok(Math.abs(lum(hid.bg) - lum(open.bg)) > 0.03 || hid.bg.join() !== open.bg.join(), `${mode}: kapalı ve açık kare ayırt edilmeli`);
        t.ok(probe('flag').img.includes('svg'), `${mode}: bayrak çizimi`);
        t.ok(probe('mine').img.includes('svg'), `${mode}: mayın çizimi`);
        const wrong = probe('open wrong');
        t.ok(wrong.img.includes('svg'), `${mode}: yanlış bayrak çizimi`);
        const q = probe('q');
        t.ok(contrast(q.color, rgb(getComputedStyle(board).backgroundColor) || [0, 0, 0]) > 1, `${mode}: soru işareti`);
      }
    } finally {
      P.theme.set(orig);
    }
  });

  test('LED sayaçları: -99…999 aralığı ve segment durumları', async (t) => {
    const w = fresh({ seed: 1 });
    const mines = $(w, '.ms-led[data-kind="mines"]');
    const segs = (k) => Array.from(mines.querySelectorAll('.ms-digit')[k].querySelectorAll('polygon')).map((p, i) => (p.classList.contains('on') ? 'abcdefg'[i] : '')).join('');
    t.eq([segs(0), segs(1), segs(2)], ['abcdef', 'bc', 'abcdef'], '010 segmentleri');
    for (let i = 20; i < 29; i++) rightClick(t, cellEl(w, i));
    t.eq(led(w, 'mines'), '001');
    rightClick(t, cellEl(w, 30));
    t.eq(led(w, 'mines'), '000');
    t.eq([segs(0), segs(1), segs(2)], ['abcdef', 'abcdef', 'abcdef']);
    rightClick(t, cellEl(w, 31));
    t.eq(led(w, 'mines'), '-01');
    t.eq([segs(0), segs(1), segs(2)], ['g', 'abcdef', 'bc']);
    t.ok(mines.getAttribute('aria-label').includes('-1'), 'erişilebilir ad güncellenmeli');
  });

  // ================================================================ lifecycle
  test('kapatınca zamanlayıcı, dinleyici ve gecikmeli işler temizlenir', async (t) => {
    const addDoc = document.addEventListener;
    const remDoc = document.removeEventListener;
    const addWin = window.addEventListener;
    const remWin = window.removeEventListener;
    const setI = window.setInterval;
    const clrI = window.clearInterval;
    const live = [];
    const intervals = new Set();
    let recording = true;
    const key = (target, type, fn, opts) => ({ target, type, fn, cap: typeof opts === 'object' ? !!(opts && opts.capture) : !!opts });
    document.addEventListener = function (type, fn, opts) { if (recording) live.push(key('document', type, fn, opts)); return addDoc.call(this, type, fn, opts); };
    document.removeEventListener = function (type, fn, opts) {
      const k = key('document', type, fn, opts);
      const j = live.findIndex((x) => x.target === k.target && x.type === k.type && x.fn === k.fn && x.cap === k.cap);
      if (j >= 0) live.splice(j, 1);
      return remDoc.call(this, type, fn, opts);
    };
    window.addEventListener = function (type, fn, opts) { if (recording) live.push(key('window', type, fn, opts)); return addWin.call(this, type, fn, opts); };
    window.removeEventListener = function (type, fn, opts) {
      const k = key('window', type, fn, opts);
      const j = live.findIndex((x) => x.target === k.target && x.type === k.type && x.fn === k.fn && x.cap === k.cap);
      if (j >= 0) live.splice(j, 1);
      return remWin.call(this, type, fn, opts);
    };
    window.setInterval = function (...a) { const id = setI.apply(window, a); if (recording) intervals.add(id); return id; };
    window.clearInterval = function (id) { intervals.delete(id); return clrI.call(window, id); };
    let w;
    try {
      closeAll();
      P.storage.remove(STORE);
      w = P.apps.launch('minesweeper', { seed: 6 });
      const m = ms(w);
      t.click(cellEl(w, 40));              // starts the clock interval
      t.ok(intervals.size >= 1, 'zamanlayıcı kurulmalı');
      m.openStats();
      await t.sleep(30);
      m.closePanel();
      // leave a shake timer pending as well
      layoutBoard(w, 9, 9, EASY_MINES);
      t.click(cellEl(w, 40));
      t.click(cellEl(w, 0));
      recording = false;
      w.forceClose();
      await t.sleep(50);
      t.eq(live.map((x) => `${x.target}:${x.type}`), [], 'kapatınca kalan dinleyici olmamalı');
      t.eq(intervals.size, 0, 'kapatınca kalan interval olmamalı');
      t.ok(m.clock.timer === 0);
      // stray events after close must not throw or leak into a dead window
      const errBefore = (window.__pandaErrors || []).length;
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      window.dispatchEvent(new Event('resize'));
      await t.sleep(200);
      t.eq((window.__pandaErrors || []).length, errBefore, 'kapanış sonrası hata oluşmamalı');
    } finally {
      document.addEventListener = addDoc;
      document.removeEventListener = remDoc;
      window.addEventListener = addWin;
      window.removeEventListener = remWin;
      window.setInterval = setI;
      window.clearInterval = clrI;
      if (w) w.forceClose();
    }
  });

  test('tooltip ve erişilebilirlik adları', async (t) => {
    const w = fresh({ seed: 1 });
    t.eq($(w, '.ms-face').getAttribute('aria-label'), 'Yeni oyun');
    t.eq($(w, '.ms-stats-btn').getAttribute('aria-label'), 'İstatistikler');
    t.ok($$(w, '[title]').length === 0, 'yerel title kullanılmamalı');
    t.eq($(w, '.ms-led[data-kind="mines"]').getAttribute('aria-label'), 'Kalan mayın: 10');
    t.eq($(w, '.ms-led[data-kind="time"]').getAttribute('aria-label'), 'Geçen süre: 0');
    t.ok(cellEl(w, 0).getAttribute('aria-label').includes('1. satır, 1. sütun'));
    t.eq($(w, '.ms-diff button.active').getAttribute('aria-pressed'), 'true');
    t.ok(!cellEl(w, 0).hasAttribute('title'));
  });
})();
