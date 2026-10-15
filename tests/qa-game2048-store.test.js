/* QA scratch (to be deleted): corrupt storage fuzz */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const $ = (s, r) => (r || document).querySelector(s);
  const api = (w) => w.state.api;
  const log = (...a) => console.error('[qa]', ...a);
  const G = (rows) => rows;
  const full = [[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2, 4], [8, 16, 32, 64]];

  const cases = [
    ['null', null],
    ['true', true],
    ['number', 42],
    ['string', 'hello'],
    ['array', [1, 2, 3]],
    ['empty obj', {}],
    ['legacy best only', { best: 1234 }],
    ['negative best', { best: -5, score: -3 }],
    ['huge best', { best: 1e300 }],
    ['string best', { best: '99999' }],
    ['grid 3x3', { grid: [[0, 0, 0], [0, 2, 0], [0, 0, 0]], best: 10 }],
    ['grid with 3', { grid: [[0, 0, 0, 0], [0, 3, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }],
    ['grid empty', { grid: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }],
    ['grid strings', { grid: [['2', 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }],
    ['valid grid only (legacy)', { grid: [[2, 0, 0, 0], [0, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 8, best: 20 }],
    ['full dead grid', { grid: full, score: 5, best: 5 }],
    ['2048 on grid', { grid: [[2048, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 5, best: 5 }],
    ['tiles dup cell', { tiles: [[1, 0, 0, 2], [2, 0, 0, 4]] }],
    ['tiles dup id', { tiles: [[1, 0, 0, 2], [1, 0, 1, 4]] }],
    ['tiles oob', { tiles: [[1, 4, 0, 2]] }],
    ['tiles float', { tiles: [[1, 0.5, 0, 2]] }],
    ['tiles value 1', { tiles: [[1, 0, 0, 1]] }],
    ['tiles value 2^21', { tiles: [[1, 0, 0, 2097152]] }],
    ['tiles value 2^20', { tiles: [[1, 0, 0, 1048576]], score: 1 }],
    ['history garbage', { tiles: [[1, 0, 0, 2]], history: [null, 5, 'x', { tiles: 'no' }, { tiles: [[1, 9, 9, 2]] }] }],
    ['history huge', { tiles: [[1, 0, 0, 2]], history: Array.from({ length: 500 }, (_, i) => ({ tiles: [[1, 0, 0, 2]], score: i, moves: i, keep: false })) }],
    ['history not array', { tiles: [[1, 0, 0, 2]], history: { a: 1 } }],
    ['nextId low', { tiles: [[5, 0, 0, 2]], nextId: 1 }],
    ['tile id huge', { tiles: [[Number.MAX_SAFE_INTEGER, 0, 0, 2]], nextId: 0 }]
  ];

  T.test('corrupt / legacy storage never breaks the app', async (t) => {
    const E = P.apps.get('game2048')._engine;
    let failures = [];
    for (const [name, val] of cases) {
      P.storage.set('app.game2048', val);
      let w;
      try {
        w = P.apps.launch('game2048');
        await t.sleep(30);
        const s = api(w).state();
        const d = api(w).domGrid();
        const nz = s.grid.flat().filter(Boolean).length;
        const syncOk = JSON.stringify(s.grid) === JSON.stringify(d.grid);
        const problems = [];
        if (!syncOk) problems.push('dom!=state');
        if (nz < 1) problems.push('empty board');
        if (!(s.best >= 0) || !Number.isFinite(s.best)) problems.push('best ' + s.best);
        if (!Number.isFinite(s.score)) problems.push('score ' + s.score);
        const scoreText = $('.g48-score-val', w.body).textContent;
        if (/NaN|undefined|Infinity/.test(scoreText + $$$(w))) problems.push('bad text ' + scoreText);
        // can we play?
        t.key(w.el, 'ArrowLeft'); t.key(w.el, 'ArrowUp'); t.key(w.el, 'ArrowRight'); t.key(w.el, 'ArrowDown');
        await t.sleep(10);
        log(`${name}: nz=${nz} score=${s.score} best=${s.best} won=${s.won} over=${s.over} hist=${s.history} ${problems.join(',') || 'ok'}`);
        if (problems.length) failures.push(name + ': ' + problems.join(','));
      } catch (e) {
        failures.push(name + ' threw ' + e.message);
      } finally {
        if (w && !w.isClosed()) await w.close();
      }
    }
    // raw invalid JSON
    localStorage.setItem('pandaos.app.game2048', '{bad json');
    const w2 = P.apps.launch('game2048');
    await t.sleep(30);
    log('invalid json: nz=' + api(w2).state().grid.flat().filter(Boolean).length);
    await w2.close();
    t.ok(!failures.length, failures.join(' | '));
    E.setRandom();
  });

  function $$$(w) { return Array.from(w.body.querySelectorAll('.g48-score-val, .g48-moves')).map((e) => e.textContent).join(' '); }
})();
