/* QA scratch (to be deleted): UI behaviours */
(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const api = (w) => w.state.api;
  const log = (...a) => console.error('[qa]', ...a);
  const OVER = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];

  T.test('sound plays on restoring a finished game at launch?', async (t) => {
    P.storage.remove('app.game2048');
    let w = P.apps.launch('game2048');
    await t.sleep(50);
    api(w).setBoard(OVER, { score: 100 });
    await w.close();
    const orig = P.sound.play;
    const played = [];
    P.sound.play = (n) => { played.push(n); };
    w = P.apps.launch('game2048');
    await t.sleep(100);
    P.sound.play = orig;
    log('sounds on reopening a game-over state:', JSON.stringify(played), 'overlay:', $('.g48-overlay', w.body).classList.contains('show'));
    await w.close();
  });

  T.test('move blocked while overlay + N key with overlay + Escape on game over', async (t) => {
    P.storage.remove('app.game2048');
    const w = P.apps.launch('game2048');
    await t.sleep(50);
    api(w).setBoard(OVER, { score: 100 });
    t.key(w.el, 'Escape');
    await t.sleep(30);
    t.ok(api(w).state().over, 'Escape does not dismiss game over');
    t.key(w.el, 'ArrowLeft');
    t.eq(api(w).state().moves, 0);
    const focus = document.activeElement;
    log('focus on game over:', focus && focus.className);
    t.key(w.el, 'z');
    await t.sleep(20);
    log('z with no history -> ok');
    await w.close();
  });

  T.test('undo keyboard while overlay (win): focus afterwards', async (t) => {
    P.storage.remove('app.game2048');
    const w = P.apps.launch('game2048');
    await t.sleep(50);
    api(w).setBoard([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2, 4, 8, 16]]);
    api(w).move('left');
    t.ok(api(w).state().won, 'won');
    log('focus on win:', document.activeElement && document.activeElement.className);
    t.key(w.el, 'z');
    await t.sleep(30);
    log('after z: won=', api(w).state().won, 'focus', document.activeElement && (document.activeElement.className || document.activeElement.tagName));
    t.key(w.el, 'ArrowRight');
    await t.sleep(30);
    log('arrow right after undo moves', api(w).state().moves);
    await w.close();
  });

  T.test('best score / bestStart semantics', async (t) => {
    P.storage.remove('app.game2048');
    const w = P.apps.launch('game2048');
    await t.sleep(50);
    // best 1000; play a game scoring 300 -> no badge; then 1500 -> badge
    api(w).setBoard(OVER, { score: 300, best: 1000, bestStart: 1000 });
    log('badge when score<best:', !$('.g48-ov-record', w.body).hidden);
    api(w).setBoard(OVER, { score: 1500, best: 1000, bestStart: 1000 });
    log('badge when score>bestStart:', !$('.g48-ov-record', w.body).hidden);
    // undo a new game back into old game
    api(w).setBoard([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], { score: 1200, best: 1200, bestStart: 800, moves: 5 });
    api(w).newGame();
    api(w).undo();
    const s = api(w).state();
    log('after newGame+undo: score', s.score, 'best', s.best, 'bestStart', s.bestStart, '(old game started with best 800)');
    await w.close();
  });

  T.test('undo button disabled while focused; Enter/Space on overlay buttons', async (t) => {
    P.storage.remove('app.game2048');
    const w = P.apps.launch('game2048');
    await t.sleep(50);
    api(w).setBoard([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    api(w).move('left');
    const ub = $('.g48-undo', w.body);
    ub.focus();
    t.click(ub);
    await t.sleep(20);
    log('undo btn disabled', ub.disabled, 'activeElement', document.activeElement && (document.activeElement.className || document.activeElement.tagName));
    t.key(document.activeElement, 'ArrowLeft');
    await t.sleep(20);
    log('moves after arrow with disabled-focused button', api(w).state().moves);
    await w.close();
  });

  T.test('rapid undo+move interleaving DOM sync (200 random ops)', async (t) => {
    P.storage.remove('app.game2048');
    const E = P.apps.get('game2048')._engine;
    E.seed(99);
    const w = P.apps.launch('game2048');
    await t.sleep(50);
    let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    let bad = 0;
    for (let i = 0; i < 400; i++) {
      const r = rnd();
      if (r < 0.1) t.key(w.el, 'z');
      else if (r < 0.12) t.key(w.el, 'n');
      else t.key(w.el, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][Math.floor(rnd() * 4)]);
      if (rnd() < 0.3) await t.sleep(Math.floor(rnd() * 140));
      const s = api(w).state(); const d = api(w).domGrid();
      if (JSON.stringify(s.grid) !== JSON.stringify(d.grid)) bad++;
    }
    await t.sleep(450);
    const s = api(w).state(); const d = api(w).domGrid();
    t.ok(JSON.stringify(s.grid) === JSON.stringify(d.grid) && bad === 0, 'desync count ' + bad);
    t.ok($$('.g48-tile', w.body).length === s.grid.flat().filter(Boolean).length, 'tile count after settle');
    E.setRandom();
    await w.close();
  });
})();
