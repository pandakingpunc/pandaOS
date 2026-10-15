/* 2048 tests: pure engine (exhaustive merge rules), UI keys / swipe, undo, overlays, persistence, layout, cleanup.
   Screenshot scenes: bash tools/shot.sh out.png "fast=1&test=game2048&shot=<name>&theme=dark|light"
   with <name> in: start, mid, big, win, over, min, max, mergeanim. (The suite then leaves the window open.) */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T0 = window.PandaTest;
  const SHOT = P.params.get('shot');
  // screenshot mode: only the scene runs (so a small BUDGET can catch the animation mid-flight)
  const T = SHOT ? Object.assign({}, T0, { test() {} }) : T0;
  const def = () => P.apps.get('game2048');
  const E = () => def()._engine;

  const STORE = 'app.game2048';
  const SETTLE_WAIT = 450;
  const DIRS = ['left', 'right', 'up', 'down'];
  const KEY_OF = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const zeros = () => [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const nonzero = (g) => g.flat().filter(Boolean).length;
  const sum = (g) => g.flat().reduce((a, b) => a + b, 0);
  const fmt = (n) => Number(n).toLocaleString('tr-TR');

  function fresh(seed) {
    P.storage.remove(STORE);
    E().seed(seed == null ? 1 : seed);
  }

  function open(seed) {
    fresh(seed);
    const w = P.apps.launch('game2048');
    if (!w) throw new Error('2048 açılamadı');
    return w;
  }

  async function shut(w) {
    if (w && !w.isClosed()) await w.close();
    E().setRandom();
  }

  const api = (w) => w.state.api;
  const board = (w) => $('.g48-board', w.body);
  const overlay = (w) => $('.g48-overlay', w.body);
  const press = (w, k, init) => T.key(w.el, k, init);
  const liveTiles = (w) => $$('.g48-tile', w.body);
  const text = (w, sel) => $(sel, w.body).textContent;

  /** DOM tiles must mirror the state grid exactly (dying tiles of a merge excluded). */
  function assertSynced(t, w, msg) {
    const s = api(w).state();
    const d = api(w).domGrid();
    t.eq(d.grid, s.grid, (msg || 'DOM') + ': ızgara eşleşmeli');
    t.eq(d.count, nonzero(s.grid), (msg || 'DOM') + ': karo sayısı');
  }

  /** Once settled, every tile sits exactly on its cell. */
  function assertGeometry(t, w) {
    api(w).settle();
    const cells = $$('.g48-cell', w.body).map((c) => c.getBoundingClientRect());
    const br = board(w).getBoundingClientRect();
    const s = api(w).state();
    const tiles = liveTiles(w);
    t.eq(tiles.length, nonzero(s.grid), 'yerleşik karo sayısı');
    for (const n of tiles) {
      const r = Number(n.style.getPropertyValue('--y'));
      const c = Number(n.style.getPropertyValue('--x'));
      const tr = n.getBoundingClientRect();
      const cr = cells[r * 4 + c];
      t.ok(Math.abs(tr.left - cr.left) < 1.2 && Math.abs(tr.top - cr.top) < 1.2, `karo (${r},${c}) hücreyle hizalı: ${tr.left - cr.left}, ${tr.top - cr.top}`);
      t.ok(Math.abs(tr.width - cr.width) < 1.2, 'karo boyutu = hücre boyutu');
      t.ok(tr.left >= br.left - 0.5 && tr.right <= br.right + 0.5 && tr.top >= br.top - 0.5 && tr.bottom <= br.bottom + 0.5, 'karo tahtanın içinde');
    }
  }

  // reference implementation (simple 1-D algorithm) to cross-check the engine
  function refLeft(line) {
    const a = line.filter(Boolean);
    const out = [];
    let score = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i + 1] === a[i]) { out.push(a[i] * 2); score += a[i] * 2; i++; } else out.push(a[i]);
    }
    while (out.length < 4) out.push(0);
    return { line: out, score };
  }

  function refMove(grid, dir) {
    const out = zeros();
    let score = 0;
    for (let i = 0; i < 4; i++) {
      let line;
      if (dir === 'left') line = grid[i].slice();
      else if (dir === 'right') line = grid[i].slice().reverse();
      else if (dir === 'up') line = grid.map((row) => row[i]);
      else line = grid.map((row) => row[i]).reverse();
      const r = refLeft(line);
      score += r.score;
      const res = r.line;
      for (let k = 0; k < 4; k++) {
        if (dir === 'left') out[i][k] = res[k];
        else if (dir === 'right') out[i][3 - k] = res[k];
        else if (dir === 'up') out[k][i] = res[k];
        else out[3 - k][i] = res[k];
      }
    }
    return { grid: out, score };
  }

  // ===================================================================== registration
  T.test('uygulama kaydı', (t) => {
    const d = def();
    t.ok(d, 'game2048 kayıtlı değil');
    t.eq([d.id, d.name, d.icon, d.singleInstance], ['game2048', '2048', 'game2048', true]);
    t.eq([d.window.width, d.window.height, d.window.minWidth, d.window.minHeight], [460, 640, 360, 520]);
    t.ok(d.window.resizable !== false, 'yeniden boyutlandırılabilir');
    t.ok(d._engine && typeof d._engine.move === 'function', 'motor dışa açık');
    t.eq(d.category, 'games');
  });

  // ===================================================================== engine
  T.test('motor: örnek satırlar (her karo bir hamlede en çok bir kez birleşir)', (t) => {
    const m = (row, dir) => E().move([row, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], dir);
    t.eq(m([2, 2, 2, 2], 'left').grid[0], [4, 4, 0, 0]);
    t.eq(m([2, 2, 2, 2], 'left').score, 8);
    t.eq(m([2, 2, 4, 0], 'left').grid[0], [4, 4, 0, 0]);
    t.eq(m([4, 0, 4, 4], 'left').grid[0], [8, 4, 0, 0]);
    t.eq(m([4, 0, 4, 4], 'left').score, 8);
    t.eq(m([2, 2, 2, 0], 'left').grid[0], [4, 2, 0, 0]);
    t.eq(m([2, 4, 8, 16], 'left').moved, false, 'hareket yoksa moved=false');
    t.eq(m([2, 4, 8, 16], 'left').score, 0);
    t.eq(m([4, 4, 8, 8], 'left').grid[0], [8, 16, 0, 0]);
    t.eq(m([8, 4, 4, 0], 'left').grid[0], [8, 8, 0, 0], 'yeni oluşan 8 aynı hamlede tekrar birleşmez');
    t.eq(m([2, 2, 2, 2], 'right').grid[0], [0, 0, 4, 4]);
    t.eq(m([0, 2, 2, 4], 'right').grid[0], [0, 0, 4, 4]);
    t.eq(m([4, 4, 4, 0], 'right').grid[0], [0, 0, 4, 8], 'sağa: duvara yakın olan önce birleşir');
    t.eq(m([4, 4, 4, 0], 'left').grid[0], [8, 4, 0, 0], 'sola: duvara yakın olan önce birleşir');
    // vertical
    const col = [[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [4, 0, 0, 0]];
    const up = E().move(col, 'up');
    t.eq(up.grid.map((r) => r[0]), [4, 8, 0, 0]);
    t.eq(up.score, 12);
    const down = E().move(col, 'down');
    t.eq(down.grid.map((r) => r[0]), [0, 0, 4, 8]);
    t.eq(E().move([[2, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0], [2, 0, 0, 0]], 'down').grid.map((r) => r[0]), [0, 0, 2, 4]);
    t.eq(E().move([[2, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0], [2, 0, 0, 0]], 'up').grid.map((r) => r[0]), [4, 2, 0, 0]);
  });

  T.test('motor: 4 hücrelik tüm satırlar (0,2,4,8,16) × 4 yön referansla aynı', (t) => {
    const vals = [0, 2, 4, 8, 16];
    let n = 0;
    for (const a of vals) for (const b of vals) for (const c of vals) for (const d of vals) {
      const line = [a, b, c, d];
      for (const dir of DIRS) {
        const grid = zeros();
        for (let k = 0; k < 4; k++) {
          if (dir === 'left' || dir === 'right') grid[0][k] = line[k];
          else grid[k][0] = line[k];
        }
        const got = E().move(grid, dir);
        const exp = refMove(grid, dir);
        if (JSON.stringify(got.grid) !== JSON.stringify(exp.grid) || got.score !== exp.score) {
          throw new Error(`${dir} ${JSON.stringify(line)}: beklenen ${JSON.stringify(exp.grid[0])}/${exp.score}, gelen ${JSON.stringify(got.grid[0])}/${got.score}`);
        }
        t.eq(got.moved, JSON.stringify(got.grid) !== JSON.stringify(grid), 'moved bayrağı');
        n++;
      }
    }
    t.eq(n, 625 * 4);
  });

  T.test('motor: rastgele tahtalar — referans, saflık, toplam korunumu, hareket haritası', (t) => {
    E().seed(2024);
    const pool = [0, 0, 0, 2, 2, 4, 4, 8, 16, 32, 64, 128];
    for (let i = 0; i < 400; i++) {
      const grid = zeros().map((row) => row.map(() => pool[Math.floor(E().random() * pool.length)]));
      const frozen = JSON.stringify(grid);
      for (const dir of DIRS) {
        const res = E().move(grid, dir);
        const ref = refMove(grid, dir);
        t.eq(res.grid, ref.grid, `${dir} #${i}`);
        t.eq(res.score, ref.score, `skor ${dir} #${i}`);
        t.eq(JSON.stringify(grid), frozen, 'giriş değiştirilmemeli');
        t.eq(sum(res.grid), sum(grid), 'karo toplamı korunmalı');
        // movement map: each source tile once; merged targets receive two equal tiles
        t.eq(res.moves.length, nonzero(grid), 'her karo için bir hareket kaydı');
        const byDest = new Map();
        for (const mv of res.moves) {
          t.eq(grid[mv.from[0]][mv.from[1]], mv.value, 'kaynak değer');
          const key = mv.to.join(',');
          if (!byDest.has(key)) byDest.set(key, []);
          byDest.get(key).push(mv);
        }
        for (const [key, list] of byDest) {
          const [r, c] = key.split(',').map(Number);
          if (list.length === 2) {
            t.ok(list[0].merged && list[1].merged && list[0].value === list[1].value, 'birleşen çift eşit değerli');
            t.eq(res.grid[r][c], list[0].value * 2);
          } else {
            t.eq(list.length, 1);
            t.ok(!list[0].merged);
            t.eq(res.grid[r][c], list[0].value);
          }
        }
        t.eq(res.merges.length, [...byDest.values()].filter((l) => l.length === 2).length, 'birleşme sayısı');
        t.eq(res.merges.reduce((a, m) => a + m.v, 0), res.score, 'skor = birleşen değerlerin toplamı');
      }
    }
  });

  T.test('motor: yön adları, canMove, maxTile, geçersiz yön', (t) => {
    const e = E();
    const g = [[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    t.eq(e.move(g, 'ArrowRight').grid[0], [0, 0, 0, 2]);
    t.eq(e.move(g, 'RIGHT').grid[0], [0, 0, 0, 2]);
    t.throws(() => e.move(g, 'yukarıya'));
    t.ok(e.canMove(g), 'boş hücre varken hareket var');
    const dead = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
    t.ok(!e.canMove(dead), 'dolu ve eşleşmesiz tahta ölü');
    t.ok(e.canMove([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]]), 'yatay eşleşme');
    t.ok(e.canMove([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [2, 2, 4, 2]].map((r, i) => (i === 3 ? [2, 2, 4, 2] : r))), 'yatay eşleşme 2');
    t.ok(e.canMove([[2, 4, 2, 4], [4, 2, 4, 2], [4, 4, 2, 4], [2, 2, 4, 8]].map((r) => r.slice())), 'dikey/yatay eşleşme');
    t.ok(!e.move(dead, 'left').moved);
    t.eq(e.maxTile([[2, 0, 0, 0], [0, 128, 0, 0], [0, 0, 0, 0], [0, 0, 0, 64]]), 128);
    t.eq(e.SIZE, 4);
    t.eq(e.WIN_VALUE, 2048);
  });

  T.test('motor: tohumlu RNG — spawn %90 iki / %10 dört, boş hücreler, determinizm', (t) => {
    const e = E();
    e.seed(42);
    const a = [];
    for (let i = 0; i < 20; i++) a.push(JSON.stringify(e.spawn(zeros())));
    e.seed(42);
    const b = [];
    for (let i = 0; i < 20; i++) b.push(JSON.stringify(e.spawn(zeros())));
    t.eq(a, b, 'aynı tohum aynı dizi');
    e.seed(43);
    const c = [];
    for (let i = 0; i < 20; i++) c.push(JSON.stringify(e.spawn(zeros())));
    t.ok(JSON.stringify(a) !== JSON.stringify(c), 'farklı tohum farklı dizi');

    e.seed(7);
    let twos = 0;
    let fours = 0;
    for (let i = 0; i < 4000; i++) {
      const s = e.spawn(zeros());
      if (s.v === 2) twos++; else if (s.v === 4) fours++; else throw new Error('geçersiz değer ' + s.v);
    }
    const ratio = fours / (twos + fours);
    t.ok(ratio > 0.08 && ratio < 0.12, '4 oranı ~%10: ' + ratio);

    // only empty cells are used; none left -> null
    const almost = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]];
    for (let i = 0; i < 20; i++) {
      const s = e.spawn(almost);
      t.eq([s.r, s.c], [3, 3]);
    }
    t.eq(e.spawn([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]), null);
    const withTile = e.addTile(almost);
    t.ok(withTile.grid[3][3] === 2 || withTile.grid[3][3] === 4);
    t.eq(almost[3][3], 0, 'addTile girişi değiştirmez');
    // setRandom: constant 0 -> first empty cell, value 2
    e.setRandom(() => 0);
    t.eq(e.spawn(zeros()), { r: 0, c: 0, v: 2 });
    e.setRandom(() => 0.95);
    t.eq(e.spawn(zeros()).v, 4);
    e.setRandom();
  });

  // ===================================================================== UI basics
  T.test('arayüz: başlık, skor kutuları, düğmeler, ipucu, başlangıç karoları', async (t) => {
    const w = open(5);
    try {
      t.ok(w.body.classList.contains('app-game2048'));
      t.eq(text(w, '.g48-title'), '2048');
      const labels = $$('.g48-score-label', w.body).map((n) => n.textContent);
      t.eq(labels, ['SKOR', 'EN İYİ']);
      t.eq($$('.g48-score-val', w.body).map((n) => n.textContent), ['0', '0']);
      const btns = $$('button', w.body).filter((b) => !b.closest('.g48-overlay'));
      t.eq(btns.map((b) => b.textContent.replace(/\d+$/, '').trim()), ['Yeni oyun', 'Geri al']);
      t.ok(btns[1].disabled, 'başlangıçta Geri al kapalı');
      t.eq(text(w, '.g48-hint'), 'Ok tuşları veya WASD ile karoları kaydır');
      t.eq($$('.g48-cell', w.body).length, 16);
      const s = api(w).state();
      t.eq(nonzero(s.grid), 2, 'iki başlangıç karosu');
      t.ok(s.grid.flat().filter(Boolean).every((v) => v === 2 || v === 4));
      t.eq([s.score, s.moves, s.history, s.won, s.over], [0, 0, 0, false, false]);
      assertSynced(t, w);
      assertGeometry(t, w);
      t.ok(!overlay(w).classList.contains('show'), 'başlangıçta kaplama yok');
      t.eq(board(w).getAttribute('role'), 'application');
      t.ok(board(w).getAttribute('aria-label').includes('2048'));
      t.ok($('.g48-sr', w.body), 'ekran okuyucu bölgesi');
      t.eq($('.g48-sr', w.body).getAttribute('aria-live'), 'polite');
      t.eq(text(w, '.g48-moves'), 'Hamle: 0');
    } finally { await shut(w); }
  });

  T.test('tek örnek: ikinci başlatma aynı pencereyi odaklar', async (t) => {
    const w = open(1);
    try {
      const again = P.apps.launch('game2048');
      t.ok(again === w, 'aynı pencere');
      t.eq(P.apps.running('game2048').length, 1);
    } finally { await shut(w); }
  });

  T.test('klavye: oklar ve WASD (büyük/küçük) doğru yöne kaydırır, preventDefault çağrılır', async (t) => {
    const w = open(1);
    try {
      E().setRandom(() => 0); // spawn: first empty cell, value 2
      const expect = {
        left: [[2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        right: [[2, 0, 0, 0], [0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0]],
        up: [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        down: [[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 2, 0, 0]]
      };
      // (1,1) tile; first empty cell is (0,0) except when the tile itself ends in (0,0) / row 0
      const keys = {
        left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'], up: ['ArrowUp', 'w', 'W'], down: ['ArrowDown', 's', 'S']
      };
      for (const dir of DIRS) {
        for (const k of keys[dir]) {
          api(w).setBoard([[0, 0, 0, 0], [0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
          const ev = press(w, k);
          t.ok(ev.defaultPrevented, `${k}: preventDefault`);
          let exp = expect[dir];
          if (dir === 'up') exp = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
          t.eq(api(w).state().grid, exp, `${k} → ${dir}`);
          t.eq(api(w).state().moves, 1);
          assertSynced(t, w, k);
        }
      }
    } finally { await shut(w); }
  });

  T.test('geçersiz hamle: yeni karo yok, hamle sayılmaz, geçmiş artmaz', async (t) => {
    const w = open(9);
    try {
      api(w).setBoard([[2, 0, 0, 0], [4, 0, 0, 0], [8, 0, 0, 0], [16, 0, 0, 0]]);
      const before = JSON.stringify(api(w).state());
      press(w, 'ArrowLeft');
      press(w, 'ArrowUp');
      t.eq(JSON.stringify(api(w).state()), before, 'durum aynı');
      t.eq(liveTiles(w).length, 4);
      t.eq($('.g48-undo', w.body).disabled, true);
      press(w, 'ArrowRight'); // valid
      t.eq(nonzero(api(w).state().grid), 5, 'geçerli hamlede bir yeni karo');
      t.eq(api(w).state().moves, 1);
    } finally { await shut(w); }
  });

  T.test('hamle sonrası: tam bir yeni karo (%90 iki / %10 dört), skor ve en iyi güncellenir, +N yüzer', async (t) => {
    const w = open(3);
    try {
      E().setRandom(() => 0);
      api(w).setBoard([[2, 2, 0, 0], [4, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], { score: 100, best: 100 });
      press(w, 'ArrowLeft');
      const s = api(w).state();
      t.eq(s.grid, [[4, 2, 0, 0], [8, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 'birleşme + yeni karo ilk boş hücreye');
      t.eq(s.score, 112);
      t.eq(s.best, 112, 'en iyi skor canlı güncellenir');
      t.eq(text(w, '.g48-score-val'), '112');
      const pl = $$('.g48-plus', w.body);
      t.eq(pl.length, 1);
      t.eq(pl[0].textContent, '+12');
      t.ok(pl[0].closest('.g48-score') === $$('.g48-score', w.body)[0], '+N SKOR kutusunda');
      await t.sleep(900);
      t.eq($$('.g48-plus', w.body).length, 0, '+N kaybolur');
      // a move without merge shows no "+"
      press(w, 'ArrowRight');
      t.eq($$('.g48-plus', w.body).length, 0);
      // 5 quick merges never leave more than 4 floaters
      for (let i = 0; i < 6; i++) {
        api(w).setBoard([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], { score: 10, best: 112, keepHistory: true });
        press(w, 'ArrowLeft');
      }
      t.ok($$('.g48-plus', w.body).length <= 4, 'en çok 4 yüzen +N');
      // best score survives: score below best leaves best untouched
      t.eq(api(w).state().best, 112);
    } finally { await shut(w); }
  });

  T.test('animasyon sınıfları: hamlede geçici sınıflar, zamanlayıcıyla temizlenir', async (t) => {
    const w = open(4);
    try {
      E().setRandom(() => 0);
      api(w).setBoard([[2, 2, 0, 0], [0, 0, 0, 4], [0, 0, 0, 0], [0, 0, 0, 0]]);
      press(w, 'ArrowLeft');
      t.ok(board(w).classList.contains('moving'), 'kayma sınıfı');
      t.eq($$('.g48-tile.is-merged', w.body).length, 1, 'birleşen karo pop sınıfı');
      t.eq($$('.g48-tile.is-new', w.body).length, 1, 'yeni karo sınıfı');
      // 2 sliding tiles of the merge are still in the DOM while sliding: 4 (2 sources + merged + ... ) + moved 4 + new
      t.ok(liveTiles(w).length >= nonzero(api(w).state().grid) + 2, 'kayan kaynak karolar henüz DOM\'da');
      assertSynced(t, w, 'hamle hemen sonrası');
      await t.sleep(SETTLE_WAIT);
      t.ok(!board(w).classList.contains('moving'), 'kayma sınıfı kalkar');
      t.eq($$('.g48-tile.is-merged, .g48-tile.is-new', w.body).length, 0, 'pop/belirme sınıfları kalkar');
      t.eq(liveTiles(w).length, nonzero(api(w).state().grid), 'kaynak karolar silinir');
      assertGeometry(t, w);
    } finally { await shut(w); }
  });

  T.test('geçişler: layout okunurken başlayan kayma settle ile iptal edilir (karolar hücrede kalır)', async (t) => {
    const w = open(12);
    try {
      E().setRandom(() => 0);
      api(w).setBoard([[0, 0, 0, 0], [0, 2, 0, 0], [0, 0, 0, 4], [0, 0, 0, 0]]);
      board(w).getBoundingClientRect(); // style recalc before the move
      const dirs = ['right', 'down', 'left', 'up', 'right', 'down'];
      for (const d of dirs) {
        t.ok(api(w).move(d) || true);
        board(w).getBoundingClientRect(); // style recalc while .moving is on: transitions start (and stay unfinished without frames)
        assertSynced(t, w, d);
      }
      assertGeometry(t, w); // settles first
      for (const n of liveTiles(w)) t.eq(n.getAnimations().length, 0, 'çalışan geçiş/animasyon kalmaz');
      // the timer path alone also ends the slide
      api(w).move('left');
      board(w).getBoundingClientRect();
      await t.sleep(SETTLE_WAIT);
      const cells = $$('.g48-cell', w.body).map((c) => c.getBoundingClientRect());
      for (const n of liveTiles(w)) {
        const cr = cells[Number(n.style.getPropertyValue('--y')) * 4 + Number(n.style.getPropertyValue('--x'))];
        t.ok(Math.abs(n.getBoundingClientRect().left - cr.left) < 1.2, 'zamanlayıcı sonrası hücrede');
      }
    } finally { await shut(w); }
  });

  T.test('hızlı tuşlar: DOM ile durum hiçbir zaman ayrışmaz', async (t) => {
    const w = open(11);
    try {
      E().seed(99);
      const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
      // burst: 80 key presses in the same tick
      for (let i = 0; i < 80; i++) {
        press(w, KEY_OF[DIRS[Math.floor(rnd() * 4)]]);
        if (api(w).state().over) break;
      }
      assertSynced(t, w, 'ani seri');
      // realistic fast typing: a key every 15 ms while timers run in between
      api(w).setBoard([[2, 4, 8, 16], [0, 2, 4, 0], [0, 0, 2, 0], [0, 0, 0, 2]]);
      for (let i = 0; i < 60; i++) {
        press(w, KEY_OF[DIRS[Math.floor(rnd() * 4)]]);
        assertSynced(t, w, 'adım ' + i);
        if (api(w).state().over) break;
        await t.sleep(15);
      }
      await t.sleep(SETTLE_WAIT);
      assertSynced(t, w, 'dinlenme');
      assertGeometry(t, w);
      t.ok(!board(w).classList.contains('moving'));
      t.eq($$('.g48-tile.is-merged, .g48-tile.is-new, .g48-tile.is-back', w.body).length, 0);
      // history never exceeds 10
      t.ok(api(w).state().history <= 10);
    } finally { await shut(w); }
  });

  // ===================================================================== undo
  T.test('geri al: son 10 durum, düğme/klavye, DOM senkron, skor geri gelir', async (t) => {
    const w = open(21);
    try {
      const undoBtn = $('.g48-undo', w.body);
      t.ok(undoBtn.disabled);
      const states = [api(w).state()];
      let guard = 0;
      while (states.length < 13 && guard++ < 200) {
        const dir = DIRS[guard % 4];
        if (api(w).move(dir)) states.push(api(w).state());
        if (api(w).state().over) break;
      }
      t.eq(states.length, 13, '12 geçerli hamle yapıldı');
      t.eq(api(w).state().history, 10, 'en çok 10 durum saklanır');
      t.ok(!undoBtn.disabled);
      t.eq(undoBtn.querySelector('.g48-undo-count').textContent, '10');
      assertSynced(t, w);
      // undo via button
      t.click(undoBtn);
      let s = api(w).state();
      t.eq(s.grid, states[11].grid, '1 geri');
      t.eq(s.score, states[11].score);
      t.eq(s.moves, 11);
      assertSynced(t, w, 'geri 1');
      // undo via Ctrl+Z and plain Z
      const ev = press(w, 'z', { ctrlKey: true });
      t.ok(ev.defaultPrevented);
      t.eq(api(w).state().grid, states[10].grid, 'Ctrl+Z');
      press(w, 'z');
      t.eq(api(w).state().grid, states[9].grid, 'Z');
      assertSynced(t, w, 'geri 3');
      // remaining 7
      for (let i = 0; i < 7; i++) t.click(undoBtn);
      t.eq(api(w).state().grid, states[2].grid, '10 geri → hamle 2 sonrası');
      t.eq(api(w).state().moves, 2);
      t.ok(undoBtn.disabled, 'geçmiş bitince düğme kapalı');
      press(w, 'z', { ctrlKey: true }); // no-op
      t.eq(api(w).state().grid, states[2].grid);
      assertSynced(t, w, 'geri 10');
      assertGeometry(t, w);
      // the best score is never undone
      t.ok(api(w).state().best >= states[12].score);
      // a new move after undo works and rebuilds history
      t.ok(api(w).move('left') || api(w).move('right') || api(w).move('up') || api(w).move('down'));
      t.eq(api(w).state().history, 1);
    } finally { await shut(w); }
  });

  T.test('geri al: birleşme geri alınınca iki karo yerine gelir; hızlı geri al/hamle karışmaz', async (t) => {
    const w = open(2);
    try {
      E().setRandom(() => 0);
      api(w).setBoard([[4, 4, 0, 0], [2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0]], { score: 7 });
      press(w, 'ArrowLeft');
      t.eq(api(w).state().score, 7 + 8 + 4);
      t.click($('.g48-undo', w.body));
      t.eq(api(w).state().grid, [[4, 4, 0, 0], [2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0]]);
      t.eq(api(w).state().score, 7);
      assertSynced(t, w);
      for (let i = 0; i < 12; i++) {
        press(w, KEY_OF[DIRS[i % 4]]);
        if (i % 3 === 2) press(w, 'z', { ctrlKey: true });
        assertSynced(t, w, 'karışık ' + i);
      }
      await t.sleep(SETTLE_WAIT);
      assertSynced(t, w);
      assertGeometry(t, w);
    } finally { await shut(w); }
  });

  // ===================================================================== new game
  T.test('yeni oyun: sıfırlar, en iyiyi korur, yanlışlıkla basılırsa geri alınabilir', async (t) => {
    const w = open(8);
    try {
      let guard = 0;
      while (api(w).state().moves < 6 && guard++ < 100) api(w).move(DIRS[guard % 4]);
      const old = api(w).state();
      t.ok(old.score > 0 && old.moves === 6);
      t.click($('.g48-new', w.body));
      let s = api(w).state();
      t.eq([s.score, s.moves, s.won, s.over], [0, 0, false, false]);
      t.eq(nonzero(s.grid), 2);
      t.eq(s.best, old.best, 'en iyi skor korunur');
      t.eq(text(w, '.g48-score-val'), '0');
      t.eq($$('.g48-score-val', w.body)[1].textContent, fmt(old.best));
      t.ok(!$('.g48-undo', w.body).disabled, 'yeni oyun geri alınabilir');
      assertSynced(t, w);
      t.click($('.g48-undo', w.body));
      s = api(w).state();
      t.eq(s.grid, old.grid, 'önceki oyun geri geldi');
      t.eq(s.score, old.score);
      t.eq(s.moves, 6);
      assertSynced(t, w);
      // N shortcut
      const ev = press(w, 'n');
      t.ok(ev.defaultPrevented);
      t.eq(api(w).state().score, 0);
      t.eq(api(w).state().moves, 0);
      // a fresh game without moves does not pile up history
      const h = api(w).state().history;
      press(w, 'N');
      t.eq(api(w).state().history, h, 'hamlesiz yeni oyun geçmişe eklenmez');
    } finally { await shut(w); }
  });

  // ===================================================================== overlays
  T.test('kazanma: 2048 oluşunca "Kazandın!" kaplaması, Devam et / Yeni oyun', async (t) => {
    const w = open(6);
    try {
      E().setRandom(() => 0);
      api(w).setBoard([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], { score: 5000 });
      t.ok(!overlay(w).classList.contains('show'));
      press(w, 'ArrowLeft');
      t.ok(overlay(w).classList.contains('show'), 'kaplama görünür');
      t.eq(overlay(w).dataset.kind, 'win');
      t.eq(text(w, '.g48-ov-title'), 'Kazandın!');
      t.ok(text(w, '.g48-ov-sub').includes(fmt(5000 + 2048)), 'skor yazılı: ' + text(w, '.g48-ov-sub'));
      t.eq([api(w).state().won, api(w).state().over], [true, false]);
      t.ok($$('.g48-tile', w.body).some((n) => n.dataset.v === '2048'), '2048 karosu');
      const btns = $$('.g48-ov-actions button', overlay(w)).filter((b) => !b.hidden).map((b) => b.textContent);
      t.eq(btns, ['Devam et', 'Yeni oyun']);
      t.ok(overlay(w).contains(document.activeElement), 'odak kaplamadaki düğmede');
      // moves are blocked while the overlay is up
      const before = JSON.stringify(api(w).state().grid);
      press(w, 'ArrowDown');
      press(w, 'ArrowRight');
      t.eq(JSON.stringify(api(w).state().grid), before, 'kaplama varken hamle yok');
      // keep playing
      t.click($('.g48-ov-continue', w.body));
      t.ok(!overlay(w).classList.contains('show'));
      t.eq([api(w).state().won, api(w).state().keep], [false, true]);
      t.ok(api(w).move('right') || api(w).move('down'), 'devam ederken hamle yapılır');
      // no second win overlay even when 4096 forms
      api(w).setBoard([[2048, 2048, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], { keep: true });
      press(w, 'ArrowLeft');
      t.ok(!overlay(w).classList.contains('show'), 'Devam et sonrası kazanma kaplaması tekrar çıkmaz');
      t.ok($$('.g48-tile', w.body).some((n) => n.dataset.v === '4096'));
    } finally { await shut(w); }
  });

  T.test('kazanma: Escape devam eder; kaplamadaki Yeni oyun sıfırlar; geri al kazanmayı iptal eder', async (t) => {
    const w = open(6);
    try {
      E().setRandom(() => 0);
      api(w).setBoard([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
      press(w, 'ArrowLeft');
      t.ok(overlay(w).classList.contains('show'));
      press(w, 'Escape');
      t.ok(!overlay(w).classList.contains('show'), 'Escape = Devam et');
      t.ok(api(w).state().keep);
      // undo the winning move; overlay must not come back for the undone state
      t.click($('.g48-undo', w.body));
      t.eq(api(w).state().grid.flat().filter((v) => v === 1024).length, 2);
      t.ok(!overlay(w).classList.contains('show'));
      // win again (keep flag restored from the snapshot = false) -> overlay -> Yeni oyun
      press(w, 'ArrowLeft');
      t.ok(overlay(w).classList.contains('show'), 'tekrar kazanınca kaplama');
      t.click($('.g48-ov-new', w.body));
      t.ok(!overlay(w).classList.contains('show'));
      t.eq(api(w).state().score, 0);
      t.eq(nonzero(api(w).state().grid), 2);
      t.eq(api(w).state().won, false);
      assertSynced(t, w);
      // undo the accidental new game: the pending win comes back
      t.click($('.g48-undo', w.body));
      t.ok(overlay(w).classList.contains('show'), 'bekleyen kazanma geri geldi');
      t.eq(overlay(w).dataset.kind, 'win');
    } finally { await shut(w); }
  });

  function deadEnd() {
    return [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [8, 16, 2, 2]];
  }

  T.test('oyun bitti: hamle kalmayınca "Oyun bitti" + skor + Yeni oyun', async (t) => {
    const w = open(10);
    try {
      E().setRandom(() => 0); // the last empty cell gets a 2 -> dead board
      api(w).setBoard(deadEnd(), { score: 4000 });
      t.ok(!overlay(w).classList.contains('show'), 'hamle varken kaplama yok');
      press(w, 'ArrowLeft');
      const s = api(w).state();
      t.eq(s.grid, [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [8, 16, 4, 2]]);
      t.eq([s.over, s.won], [true, false]);
      t.ok(overlay(w).classList.contains('show'));
      t.eq(overlay(w).dataset.kind, 'over');
      t.eq(text(w, '.g48-ov-title'), 'Oyun bitti');
      t.ok(text(w, '.g48-ov-sub').includes(fmt(4004)), 'skor: ' + text(w, '.g48-ov-sub'));
      t.ok(!$('.g48-ov-record', w.body).hidden, 'yeni rekor rozeti');
      const visible = $$('.g48-ov-actions button', overlay(w)).filter((b) => !b.hidden);
      t.eq(visible.map((b) => b.textContent), ['Yeni oyun']);
      // keys do nothing now
      const before = JSON.stringify(s.grid);
      for (const d of DIRS) press(w, KEY_OF[d]);
      t.eq(JSON.stringify(api(w).state().grid), before);
      // undo from the game-over state brings the game back
      t.click($('.g48-undo', w.body));
      t.ok(!overlay(w).classList.contains('show'), 'geri alınca kaplama kapanır');
      t.eq(api(w).state().over, false);
      t.eq(api(w).state().grid, deadEnd());
      assertSynced(t, w);
      // play the dead end again and start a new game from the overlay
      press(w, 'ArrowLeft');
      t.ok(overlay(w).classList.contains('show'));
      t.click($('.g48-ov-new', w.body));
      t.ok(!overlay(w).classList.contains('show'));
      t.eq([api(w).state().score, api(w).state().over], [0, false]);
      t.eq(api(w).state().best, 4004, 'en iyi skor yeni oyunda korunur');
      t.eq(nonzero(api(w).state().grid), 2);
    } finally { await shut(w); }
  });

  T.test('oyun bitti: rekor rozeti yalnızca rekor kırılınca', async (t) => {
    const w = open(10);
    try {
      E().setRandom(() => 0);
      api(w).setBoard(deadEnd(), { score: 40, best: 99999, bestStart: 99999 });
      press(w, 'ArrowLeft');
      t.eq(overlay(w).dataset.kind, 'over');
      t.ok($('.g48-ov-record', w.body).hidden, 'rekor yok');
      t.eq(api(w).state().best, 99999);
    } finally { await shut(w); }
  });

  // ===================================================================== swipe
  T.test('kaydırma: işaretçi sürüklemesi (eşik ~30px), baskın eksen, sağ tuş yok sayılır', async (t) => {
    const w = open(1);
    try {
      E().setRandom(() => 0);
      const start = () => api(w).setBoard([[0, 0, 0, 0], [0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
      const b = board(w);
      start();
      t.drag(b, 80, 0);
      t.eq(api(w).state().grid[1], [0, 0, 0, 2], 'sağa sürükle');
      t.eq(api(w).state().moves, 1);
      start();
      t.drag(b, -80, 5);
      t.eq(api(w).state().grid[1], [2, 0, 0, 0], 'sola sürükle');
      start();
      t.drag(b, 4, 90);
      t.eq(api(w).state().grid[3][1], 2, 'aşağı sürükle');
      start();
      t.drag(b, -3, -90);
      t.eq(api(w).state().grid[0][1], 2, 'yukarı sürükle');
      start();
      t.drag(b, 60, 40);
      t.eq(api(w).state().grid[1], [0, 0, 0, 2], 'baskın eksen yatay');
      // below threshold: nothing
      start();
      const snap = JSON.stringify(api(w).state());
      t.drag(b, 20, 10);
      t.drag(b, 0, -25);
      t.eq(JSON.stringify(api(w).state()), snap, 'eşik altı sürükleme hamle değil');
      // a single swipe moves once even if the pointer keeps travelling
      start();
      t.drag(b, 200, 0);
      t.eq(api(w).state().moves, 1, 'tek kaydırma tek hamle');
      // right button is ignored
      start();
      const ptr = (type, init) => new PointerEvent(type, Object.assign({ bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true }, init));
      const r = b.getBoundingClientRect();
      b.dispatchEvent(ptr('pointerdown', { button: 2, buttons: 2, clientX: r.left + 50, clientY: r.top + 50 }));
      window.dispatchEvent(ptr('pointermove', { clientX: r.left + 200, clientY: r.top + 50 }));
      window.dispatchEvent(ptr('pointerup', { clientX: r.left + 200, clientY: r.top + 50 }));
      t.eq(api(w).state().moves, 0, 'sağ tuş sürüklemesi yok sayılır');
      // a pointer that ends on a far-away element still ends the gesture (drag from the board to outside)
      start();
      b.dispatchEvent(ptr('pointerdown', { button: 0, buttons: 1, clientX: r.left + 50, clientY: r.top + 50 }));
      document.body.dispatchEvent(ptr('pointerup', { clientX: r.left + 50 + 70, clientY: r.top + 50 }));
      t.eq(api(w).state().moves, 1, 'bırakma tahta dışında olsa da hareket sayılır');
      assertSynced(t, w);
    } finally { await shut(w); }
  });

  // ===================================================================== persistence
  T.test('kalıcılık: oyun, en iyi skor ve geçmiş pencere kapanıp açılınca geri gelir', async (t) => {
    let w = open(31);
    try {
      let guard = 0;
      while (api(w).state().moves < 8 && guard++ < 200) api(w).move(DIRS[guard % 4]);
      const s1 = api(w).state();
      const saved = P.storage.get(STORE);
      t.eq(saved.best, s1.best);
      t.eq(saved.score, s1.score);
      t.eq(saved.grid, s1.grid);
      t.eq(saved.moves, s1.moves);
      t.ok(Array.isArray(saved.history) && saved.history.length === s1.history);
      await w.close();
      t.eq(P.apps.running('game2048').length, 0);
      w = P.apps.launch('game2048');
      const s2 = api(w).state();
      t.eq(s2.grid, s1.grid, 'ızgara korunur');
      t.eq([s2.score, s2.best, s2.moves, s2.history], [s1.score, s1.best, s1.moves, s1.history]);
      assertSynced(t, w);
      assertGeometry(t, w);
      t.eq(text(w, '.g48-score-val'), fmt(s1.score));
      t.eq($$('.g48-score-val', w.body)[1].textContent, fmt(s1.best));
      // undo still works after the restart
      t.click($('.g48-undo', w.body));
      t.eq(api(w).state().moves, s1.moves - 1);
      assertSynced(t, w);
      // best persists through new games and re-opens
      press(w, 'n');
      const best = api(w).state().best;
      await w.close();
      w = P.apps.launch('game2048');
      t.eq(api(w).state().best, best);
      t.eq($$('.g48-score-val', w.body)[1].textContent, fmt(best));
    } finally { await shut(w); }
  });

  T.test('kalıcılık: bekleyen kazanma / bitmiş oyun yeniden açılınca kaplama görünür', async (t) => {
    let w = open(6);
    try {
      E().setRandom(() => 0);
      api(w).setBoard([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
      press(w, 'ArrowLeft');
      await w.close();
      w = P.apps.launch('game2048');
      t.ok(overlay(w).classList.contains('show') && overlay(w).dataset.kind === 'win', 'kazanma bekliyor');
      t.click($('.g48-ov-continue', w.body));
      await w.close();
      w = P.apps.launch('game2048');
      t.ok(!overlay(w).classList.contains('show'), 'devam seçimi hatırlanır');
      api(w).setBoard(deadEnd());
      press(w, 'ArrowLeft');
      await w.close();
      w = P.apps.launch('game2048');
      t.ok(overlay(w).classList.contains('show') && overlay(w).dataset.kind === 'over', 'bitmiş oyun');
    } finally { await shut(w); }
  });

  T.test('kalıcılık: bozuk / eksik kayıt zarifçe yeni oyuna döner', async (t) => {
    const cases = [
      { name: 'çöp', data: 'xyz', best: 0 },
      { name: 'şekilsiz ızgara', data: { best: 12, grid: [[1, 2], [3]] }, best: 12 },
      { name: 'geçersiz değerler', data: { best: 5, grid: [[3, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }, best: 5 },
      { name: 'boş tahta', data: { best: 9, grid: zeros() }, best: 9 },
      { name: 'çakışan karolar', data: { best: 3, tiles: [[1, 0, 0, 2], [2, 0, 0, 4]] }, best: 3 },
      { name: 'negatif/NaN', data: { best: -4, score: 'abc', tiles: null }, best: 0 }
    ];
    for (const c of cases) {
      P.storage.set(STORE, c.data);
      const w = P.apps.launch('game2048');
      try {
        const s = api(w).state();
        t.eq(nonzero(s.grid), 2, c.name + ': yeni oyun');
        t.eq([s.best, s.score, s.moves, s.history], [c.best, 0, 0, 0], c.name);
        assertSynced(t, w, c.name);
      } finally { await shut(w); }
    }
    // old format (grid only) is migrated
    P.storage.set(STORE, { best: 64, score: 20, moves: 3, grid: [[2, 2, 0, 0], [0, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 8]] });
    const w = P.apps.launch('game2048');
    try {
      t.eq(api(w).state().grid, [[2, 2, 0, 0], [0, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 8]]);
      t.eq([api(w).state().score, api(w).state().best, api(w).state().moves], [20, 64, 3]);
      assertSynced(t, w);
    } finally { await shut(w); }
  });

  // ===================================================================== context menu / dialogs
  T.test('bağlam menüsü: Yeni oyun / Geri al / En iyi skoru sıfırla (onaylı)', async (t) => {
    const w = open(14);
    try {
      E().setRandom(() => 0);
      api(w).setBoard([[2, 2, 0, 0], [0, 0, 0, 4], [0, 0, 0, 0], [0, 0, 0, 0]], { score: 50, best: 500 });
      press(w, 'ArrowLeft');
      const bestBefore = api(w).state().best;
      t.eq([bestBefore, api(w).state().score, api(w).state().moves], [500, 54, 1]);
      t.contextmenu(board(w));
      await t.waitFor(() => $('#context-menu-layer .ctx-menu'));
      let items = $$('#context-menu-layer .ctx-item');
      t.eq(items.map((i) => $('.ctx-label', i).textContent), ['Yeni oyun', 'Geri al', 'En iyi skoru sıfırla']);
      t.ok(!items[1].classList.contains('disabled'), 'geri al açık');
      // Geri al
      const movesBefore = api(w).state().moves;
      t.click(items[1]);
      t.eq(api(w).state().moves, movesBefore - 1);
      t.eq(api(w).state().score, 50);
      await t.waitFor(() => !$('#context-menu-layer .ctx-menu'));
      // Reset best: cancel first
      t.contextmenu(w.body.querySelector('.g48-title'));
      await t.waitFor(() => $('#context-menu-layer .ctx-menu'));
      items = $$('#context-menu-layer .ctx-item');
      t.click(items[2]);
      await t.waitFor(() => $('#dialog-layer .dlg-card'));
      t.ok($('#dialog-layer').textContent.includes(fmt(bestBefore)), 'diyalog skoru gösterir');
      // keys are not delivered to the window while a dialog is open
      const g0 = JSON.stringify(api(w).state().grid);
      press(w, 'ArrowLeft');
      press(w, 'ArrowUp');
      t.eq(JSON.stringify(api(w).state().grid), g0, 'diyalog açıkken hamle yok');
      t.click($('#dialog-layer .dlg-btn:not(.dlg-primary)'));
      await t.waitFor(() => !$('#dialog-layer .dlg-card'));
      t.eq(api(w).state().best, bestBefore, 'İptal en iyi skoru korur');
      // confirm
      t.contextmenu(board(w));
      await t.waitFor(() => $('#context-menu-layer .ctx-menu'));
      t.click($$('#context-menu-layer .ctx-item')[2]);
      await t.waitFor(() => $('#dialog-layer .dlg-primary'));
      t.click($('#dialog-layer .dlg-primary'));
      await t.waitFor(() => api(w).state().best !== bestBefore);
      t.eq(api(w).state().best, 50, 'en iyi = geçerli skora iner');
      t.eq($$('.g48-score-val', w.body)[1].textContent, fmt(api(w).state().score));
      // Yeni oyun from the menu
      t.contextmenu(board(w));
      await t.waitFor(() => $('#context-menu-layer .ctx-menu'));
      t.click($$('#context-menu-layer .ctx-item')[0]);
      t.eq([api(w).state().score, api(w).state().moves], [0, 0]);
    } finally {
      P.dialog.closeAll && P.dialog.closeAll();
      P.contextMenu.hide && P.contextMenu.hide();
      await shut(w);
    }
  });

  // ===================================================================== look & layout
  T.test('karo görünümü: klasik palet, rakam boyutu 4–6 haneli sayılarda küçülür ve sığar', async (t) => {
    const w = open(1);
    try {
      api(w).setBoard([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2048, 4096], [8192, 16384, 131072, 262144]]);
      const tile = (v) => liveTiles(w).find((n) => n.firstChild.textContent === String(v));
      const face = (v) => tile(v).firstChild;
      const bg = (v) => getComputedStyle(face(v)).backgroundColor;
      t.eq(bg(2), 'rgb(238, 228, 218)');
      t.eq(bg(4), 'rgb(237, 224, 200)');
      t.eq(bg(8), 'rgb(242, 177, 121)');
      t.eq(bg(2048), 'rgb(237, 194, 46)');
      t.eq(getComputedStyle(face(2)).color, 'rgb(119, 110, 101)');
      t.eq(getComputedStyle(face(8)).color, 'rgb(249, 246, 242)');
      const fs = (v) => parseFloat(getComputedStyle(face(v)).fontSize);
      t.eq(fs(2), fs(64), '1–2 hane aynı boy');
      t.ok(fs(128) < fs(64) && fs(1024) < fs(128) && fs(16384) < fs(1024) && fs(131072) < fs(16384) && fs(131072) > 0, 'basamak arttıkça küçülür');
      t.eq(tile(131072).dataset.d, '6');
      t.eq(tile(131072).dataset.v, '131072');
      t.eq(tile(262144).dataset.v, 'max', '131072 üzeri ortak stil');
      // every number fits inside its tile, also at the minimum window size
      for (const size of [[460, 640], [360, 520]]) {
        w.setSize(size[0], size[1]);
        await t.sleep(80);
        for (const n of liveTiles(w)) {
          const f = n.firstChild;
          const r = document.createRange();
          r.selectNodeContents(f);
          const tw = r.getBoundingClientRect().width;
          const fw = f.getBoundingClientRect().width;
          t.ok(tw <= fw - 2, `${n.firstChild.textContent} sığmalı (${Math.round(tw)} ≤ ${Math.round(fw)}) @${size.join('x')}`);
        }
      }
      // score formatting (tr-TR) and the long-number style
      api(w).setBoard([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], { score: 1234567, best: 7654321 });
      t.eq(text(w, '.g48-score-val'), '1.234.567');
      t.eq($$('.g48-score-val', w.body)[1].textContent, '7.654.321');
      t.eq($('.g48-score-val', w.body).dataset.long, 'true');
    } finally { await shut(w); }
  });

  T.test('yerleşim: pencere boyutuna göre ölçeklenir (en küçük, varsayılan, büyük, ekranı kapla)', async (t) => {
    const w = open(1);
    try {
      const check = async (label) => {
        await t.sleep(80);
        const body = w.body.getBoundingClientRect();
        const b = board(w).getBoundingClientRect();
        const root = $('.g48-root', w.body);
        t.ok(Math.abs(b.width - b.height) < 1, `${label}: tahta kare ${b.width}x${b.height}`);
        t.ok(b.left >= body.left && b.right <= body.right + 0.5 && b.top >= body.top && b.bottom <= body.bottom + 0.5, `${label}: tahta pencerenin içinde`);
        t.ok(Math.abs((b.left + b.right) / 2 - (body.left + body.right) / 2) < 2, `${label}: yatay ortalı`);
        t.ok(root.scrollWidth <= root.clientWidth + 1 && root.scrollHeight <= root.clientHeight + 1, `${label}: taşma yok`);
        const header = $('.g48-header', w.body).getBoundingClientRect();
        t.ok(header.top >= body.top && header.right <= body.right + 0.5, `${label}: başlık içeride`);
        const boxes = $$('.g48-score', w.body).map((n) => n.getBoundingClientRect());
        t.ok(boxes[1].right <= body.right && boxes[0].left > $('.g48-title', w.body).getBoundingClientRect().right, `${label}: skor kutuları başlıkla çakışmaz`);
        t.ok(b.width >= 200, `${label}: tahta yeterince büyük (${b.width})`);
        const bar = $$('.g48-bar > *', w.body).map((n) => n.getBoundingClientRect());
        t.ok(bar.every((r) => r.right <= body.right && r.width > 0), `${label}: araç satırı sığar`);
        assertGeometry(t, w);
        return b.width;
      };
      api(w).setBoard([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2048, 0], [0, 0, 0, 0]], { keep: true });
      w.setSize(360, 520);
      const small = await check('en küçük');
      w.setSize(460, 640);
      const normal = await check('varsayılan');
      w.setSize(900, 800);
      const large = await check('büyük');
      w.setSize(1000, 520);
      const wide = await check('geniş ve kısa');
      t.ok(small < normal && normal <= large, `ölçek: ${small} < ${normal} ≤ ${large}`);
      t.ok(wide <= small + 2, 'kısa pencerede yükseklik belirleyici');
      w.maximize();
      const max = await check('ekranı kapla');
      t.ok(max >= large - 1);
      t.ok(max <= 780, 'üst sınır');
      w.restore();
      await check('geri yüklendi');
      // minimum size is enforced by the window
      w.setSize(100, 100);
      t.eq([w.getBounds().width, w.getBounds().height], [360, 520]);
    } finally { await shut(w); }
  });

  T.test('tema: tahta koyu/açık temaya uyar, karo renkleri klasik kalır', async (t) => {
    const w = open(1);
    const old = P.theme.mode();
    try {
      P.theme.set('light');
      await t.sleep(30);
      const lightBoard = getComputedStyle(board(w)).backgroundColor;
      const lightPage = getComputedStyle(w.body).backgroundColor;
      const lightTile = getComputedStyle($('.g48-face', w.body)).backgroundColor;
      P.theme.set('dark');
      await t.sleep(30);
      const darkBoard = getComputedStyle(board(w)).backgroundColor;
      const darkPage = getComputedStyle(w.body).backgroundColor;
      const darkTile = getComputedStyle($('.g48-face', w.body)).backgroundColor;
      t.eq(lightBoard, 'rgb(187, 173, 160)', 'açık tema: klasik bej tahta');
      t.ok(darkBoard !== lightBoard, 'koyu temada tahta farklı');
      const lum = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      t.ok(lum(darkBoard) < lum(lightBoard) - 60, 'koyu tahta belirgin biçimde daha koyu');
      t.ok(lum(darkPage) < 80 && lum(lightPage) > 200, 'sayfa arka planı temayı izler');
      t.eq(lightTile, darkTile, 'karo rengi temadan bağımsız');
    } finally { P.theme.set(old); await shut(w); }
  });

  // ===================================================================== cleanup / robustness
  T.test('temizlik: dinleyiciler ve zamanlayıcılar pencere kapanınca kalmaz', async (t) => {
    const added = [];
    const removed = [];
    const origAdd = { w: window.addEventListener, d: document.addEventListener };
    const origRem = { w: window.removeEventListener, d: document.removeEventListener };
    const track = (target, key) => {
      target.addEventListener = function (type, fn, opts) { if (/game2048.js/.test(new Error().stack || '')) added.push([target, type, fn]); return origAdd[key].call(this, type, fn, opts); };
      target.removeEventListener = function (type, fn, opts) { removed.push([target, type, fn]); return origRem[key].call(this, type, fn, opts); };
    };
    const mine = new Set();
    const fired = new Set();
    const cleared = new Set();
    const origST = window.setTimeout;
    const origCT = window.clearTimeout;
    window.setTimeout = function (fn, ms, ...rest) {
      let id;
      const wrapped = function () { fired.add(id); return typeof fn === 'function' ? fn.apply(this, arguments) : undefined; };
      id = origST.call(this, wrapped, ms, ...rest);
      if (/game2048.js/.test(new Error().stack || '')) mine.add(id);
      return id;
    };
    window.clearTimeout = function (id) { cleared.add(id); return origCT.call(this, id); };
    track(window, 'w');
    track(document, 'd');
    let w;
    try {
      w = open(2);
      press(w, 'ArrowLeft');
      press(w, 'ArrowUp');
      t.drag(board(w), 60, 0);
      // gesture left open when the window closes
      const b = board(w);
      const r = b.getBoundingClientRect();
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + 10, clientY: r.top + 10 }));
      t.ok(mine.size > 0, 'uygulama zamanlayıcı kullanıyor');
      await w.close();
    } finally {
      window.setTimeout = origST;
      window.clearTimeout = origCT;
      window.addEventListener = origAdd.w;
      document.addEventListener = origAdd.d;
      window.removeEventListener = origRem.w;
      document.removeEventListener = origRem.d;
      E().setRandom();
    }
    const sig = (e) => e[0] === window ? 'w' : 'd';
    const unbalanced = added.filter((a) => !removed.some((r) => r[0] === a[0] && r[1] === a[1] && r[2] === a[2]));
    t.eq(unbalanced.map((a) => sig(a) + ':' + a[1]), [], 'eklenen her dinleyici kaldırılmış olmalı');
    const outstanding = [...mine].filter((id) => !fired.has(id) && !cleared.has(id));
    t.eq(outstanding, [], 'bekleyen zamanlayıcı kalmamalı');
    // events after close are harmless
    const errs = (window.__pandaErrors || []).length;
    T.key(document.body, 'ArrowLeft');
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }));
    await t.sleep(900);
    t.eq((window.__pandaErrors || []).length, errs, 'kapandıktan sonra hata yok');
    t.eq(P.apps.running('game2048').length, 0);
    t.eq($$('.g48-board').length, 0, 'DOM kalmadı');
  });

  T.test('kapanışta oyun kaydedilir; bus dinleyicisi eklenmez', async (t) => {
    const origOn = P.bus.on;
    let busCalls = 0;
    P.bus.on = function () { busCalls++; return origOn.apply(this, arguments); };
    let w;
    try {
      w = open(5);
      api(w).move('left') || api(w).move('right') || api(w).move('up') || api(w).move('down');
    } finally { P.bus.on = origOn; }
    t.eq(busCalls, 0, 'uygulama bus dinleyicisi eklemez');
    P.storage.remove(STORE); // proves close() writes the state again
    const grid = api(w).state().grid;
    await w.close();
    t.eq(P.storage.get(STORE).grid, grid, 'kapanışta kaydedildi');
    E().setRandom();
  });

  T.test('kendi eklenen pencere başlığı/simgesi ve tuş odağı', async (t) => {
    const w = open(1);
    try {
      t.eq(w.getTitle(), '2048');
      t.eq(w.appId, 'game2048');
      t.ok(w.isFocused(), 'pencere odakta');
      // keys with modifiers other than Ctrl+Z are ignored
      const before = JSON.stringify(api(w).state());
      press(w, 'ArrowLeft', { ctrlKey: true });
      press(w, 'ArrowLeft', { altKey: true });
      t.eq(JSON.stringify(api(w).state()), before, 'değiştirici tuşlarla hamle yok');
      // unrelated keys do not preventDefault
      const ev = press(w, 'F5');
      t.ok(!ev.defaultPrevented, 'ilgisiz tuş engellenmez');
    } finally { await shut(w); }
  });

  // ===================================================================== screenshot scenes
  if (SHOT) {
    T0.test('ekran görüntüsü sahnesi: ' + SHOT, async (t) => {
      fresh(17);
      const w = P.apps.launch('game2048');
      E().setRandom(() => 0);
      const scenes = {
        start: () => {},
        mid: () => api(w).setBoard([[2, 4, 8, 16], [4, 32, 64, 2], [128, 256, 2, 0], [2, 4, 1024, 512]], { score: 11248, best: 20516, moves: 482 }),
        big: () => api(w).setBoard([[2048, 1024, 512, 256], [4096, 8192, 128, 64], [16384, 32, 16, 8], [131072, 4, 2, 0]], { score: 123456, best: 987654, moves: 3000, keep: true }),
        win: () => {
          api(w).setBoard([[1024, 1024, 8, 2], [4, 2, 16, 4], [2, 8, 4, 32], [64, 4, 2, 0]], { score: 20450, best: 20450, moves: 900 });
          press(w, 'ArrowLeft');
        },
        over: () => {
          api(w).setBoard([[2, 4, 8, 16], [4, 32, 2, 8], [16, 8, 64, 4], [128, 256, 2, 2]].map((r) => r.slice()), { score: 2644, best: 5120, moves: 233 });
          press(w, 'ArrowLeft');
        },
        min: () => { api(w).setBoard([[2, 4, 8, 16], [4, 32, 64, 2], [128, 256, 2, 0], [2, 4, 1024, 512]], { score: 11248, best: 20516, moves: 482 }); w.setSize(360, 520); },
        max: () => { api(w).setBoard([[2, 4, 8, 16], [4, 32, 64, 2], [128, 256, 2, 0], [2, 4, 1024, 512]], { score: 11248, best: 20516, moves: 482 }); w.maximize(); },
        mergeanim: () => { api(w).setBoard([[2, 2, 0, 0], [0, 0, 4, 4], [8, 0, 0, 8], [0, 0, 0, 0]], { score: 120, best: 500 }); press(w, 'ArrowLeft'); }
      };
      (scenes[SHOT] || scenes.start)();
      if (SHOT !== 'mergeanim') await t.sleep(SETTLE_WAIT);
      // leave the window open for the screenshot
    });
  }
})();
