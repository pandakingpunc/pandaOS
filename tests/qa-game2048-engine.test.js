/* QA scratch (to be deleted): independent engine verification */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const E = () => P.apps.get('game2048')._engine;

  // independent reference: compress, merge, compress
  function refRowLeft(row) {
    let a = row.filter((x) => x);
    let score = 0;
    for (let i = 0; i < a.length - 1; i++) {
      if (a[i] === a[i + 1]) { a[i] *= 2; score += a[i]; a.splice(i + 1, 1); }
    }
    while (a.length < 4) a.push(0);
    return { row: a, score };
  }
  const rot = (g) => g[0].map((_, c) => g.map((row) => row[c]).reverse()); // 90 deg clockwise
  function refMove(g, dir) {
    // rotate so that the move becomes "left"
    const turns = { left: 0, down: 1, right: 2, up: 3 }[dir];
    let x = g.map((r) => r.slice());
    for (let i = 0; i < turns; i++) x = rot(x);
    let score = 0;
    x = x.map((r) => { const o = refRowLeft(r); score += o.score; return o.row; });
    for (let i = 0; i < (4 - turns) % 4; i++) x = rot(x);
    return { grid: x, score };
  }

  T.test('qa engine: independent reference over 30000 random boards x 4 dirs', async (t) => {
    const e = E();
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const vals = [0, 0, 0, 2, 2, 4, 4, 8, 16];
    let bad = 0; let msg = '';
    for (let n = 0; n < 30000; n++) {
      const g = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => vals[Math.floor(rnd() * vals.length)]));
      for (const d of ['left', 'right', 'up', 'down']) {
        const a = e.move(g, d);
        const b = refMove(g, d);
        const moved = JSON.stringify(g) !== JSON.stringify(b.grid);
        if (JSON.stringify(a.grid) !== JSON.stringify(b.grid) || a.score !== b.score || a.moved !== moved) {
          bad++;
          if (!msg) msg = JSON.stringify({ g, d, a: a.grid, as: a.score, am: a.moved, b: b.grid, bs: b.score, bm: moved });
        }
      }
    }
    t.ok(bad === 0, 'mismatches: ' + bad + ' ' + msg);
  });

  T.test('qa engine: spec examples + default RNG spawn distribution', async (t) => {
    const e = E();
    const L = (row) => e.move([row, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 'left').grid[0];
    t.eq(L([2, 2, 2, 2]), [4, 4, 0, 0]);
    t.eq(L([2, 2, 4, 0]), [4, 4, 0, 0]);
    t.eq(L([4, 0, 4, 4]), [8, 4, 0, 0]);
    t.eq(L([2, 2, 4, 4]), [4, 8, 0, 0]);
    t.eq(L([4, 2, 2, 0]), [4, 4, 0, 0]);
    t.eq(L([8, 8, 8, 0]), [16, 8, 0, 0]);
    e.setRandom();
    let fours = 0; const N = 40000;
    const cellHits = new Array(16).fill(0);
    for (let i = 0; i < N; i++) {
      const s = e.spawn([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
      if (s.v === 4) fours++;
      cellHits[s.r * 4 + s.c]++;
    }
    const p = fours / N;
    console.error('[qa] four ratio', p.toFixed(4), 'cell hit min/max', Math.min(...cellHits), Math.max(...cellHits));
    t.ok(p > 0.09 && p < 0.11, 'four ratio ' + p);
    t.ok(Math.min(...cellHits) > N / 16 * 0.9, 'uniform cells');
    t.eq(e.spawn([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]), null, 'no spawn on full board');
  });

  T.test('qa engine: input grid is not mutated; bad input handled', async (t) => {
    const e = E();
    const g = [[2, 2, 0, 0], [0, 0, 0, 0], [4, 4, 4, 4], [0, 0, 0, 0]];
    const copy = JSON.stringify(g);
    e.move(g, 'left'); e.move(g, 'ArrowRight'); e.move(g, 'UP');
    t.eq(JSON.stringify(g), copy, 'pure');
    let threw = false;
    try { e.move(g, 'diagonal'); } catch (err) { threw = true; }
    t.ok(threw, 'invalid dir throws');
    // short / ragged grid should not crash the engine
    let crashed = false;
    try { e.move([[2, 2], [], [0, 0, 0, 0]], 'left'); } catch (err) { crashed = true; }
    console.error('[qa] ragged grid crashed:', crashed);
  });
})();
