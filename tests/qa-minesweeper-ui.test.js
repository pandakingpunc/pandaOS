(function () {
  'use strict';
  const P = window.PandaOS;
  const $ = (w, s) => w.body.querySelector(s);
  const $$ = (w, s) => Array.from(w.body.querySelectorAll(s));

  function domMatches(w) {
    const m = w.state.ms; const b = m.board;
    let open = 0, flag = 0;
    for (let i = 0; i < b.size; i++) {
      const c = $(w, `.ms-cell[data-i="${i}"]`).className;
      const st = b.state[i];
      const lost = b.status === 'lost';
      if (st === 1) { if (!/\bopen\b/.test(c)) return 'cell ' + i + ' should be open: ' + c; open++; }
      else if (st === 2) { if (!(/\bflag\b/.test(c) || /\bwrong\b/.test(c))) return 'cell ' + i + ' should be flag: ' + c; flag++; }
      else if (st === 3) { if (!/\bq\b/.test(c) && !(lost && b.mine[i])) return 'cell ' + i + ' should be ?: ' + c; }
      else if (!lost && !/\bhid\b/.test(c)) return 'cell ' + i + ' should be hid: ' + c;
      if (lost && b.mine[i] && st !== 2 && !/\bmine\b/.test(c)) return 'cell ' + i + ' should show mine';
    }
    const led = $(w, '.ms-led[data-kind="mines"]').dataset.value;
    const want = b.mines - b.flags;
    const wantTxt = want < 0 ? '-' + String(-want).padStart(2, '0') : String(Math.min(999, want)).padStart(3, '0');
    if (led !== wantTxt) return 'mine led ' + led + ' vs ' + wantTxt;
    if ($$(w, '.ms-cell.press').length && !m.over) { /* allowed mid-drag only */ }
    return null;
  }

  PandaTest.test('QA ui fuzz: DOM always mirrors the engine', async (t) => {
    P.storage.remove('app.minesweeper');
    P.wm.byApp('minesweeper').forEach((w) => w.forceClose());
    const w = P.apps.launch('minesweeper', { seed: 77 });
    const m = w.state.ms;
    let s = 99;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const cell = (i) => $(w, `.ms-cell[data-i="${i}"]`);
    const board = $(w, '.ms-board');
    board.focus();
    for (let step = 0; step < 1500; step++) {
      const b = m.board;
      const i = Math.floor(rnd() * b.size);
      const op = Math.floor(rnd() * 12);
      const el = cell(i);
      if (op <= 3) t.click(el);
      else if (op <= 5) t.contextmenu(el);
      else if (op === 6) t.click(el, { shiftKey: true });
      else if (op === 7) { t.mouse(el, 'mousedown', { button: 1, buttons: 4 }); t.mouse(el, 'mouseup', { button: 1, buttons: 0 }); }
      else if (op === 8) { t.mouse(el, 'mousedown', { button: 0, buttons: 1 }); t.mouse(el, 'mousedown', { button: 2, buttons: 3 }); t.mouse(el, 'mouseup', { button: 2, buttons: 1 }); t.mouse(el, 'mouseup', { button: 0, buttons: 0 }); }
      else if (op === 9) { t.key(board, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'][Math.floor(rnd() * 6)]); }
      else if (op === 10) { t.key(board, [' ', 'Enter', 'f'][Math.floor(rnd() * 3)]); }
      else if (rnd() < 0.15) { t.key(board, 'F2'); }
      const err = domMatches(w);
      if (err) throw new Error('step ' + step + ' op ' + op + ' status ' + m.board.status + ': ' + err);
      if (m.board.status === 'won' || m.board.status === 'lost') {
        if ($$(w, '.ms-banner').length !== 1) throw new Error('banner count ' + $$(w, '.ms-banner').length);
        const f = $(w, '.ms-face').dataset.face;
        if (f !== (m.board.status === 'won' ? 'cool' : 'dead')) throw new Error('face ' + f + ' at ' + m.board.status);
        if (rnd() < 0.5) t.key(board, 'F2'); else t.click($(w, '.ms-face'));
      }
      if (step % 300 === 299) { t.click($(w, `.ms-diff button[data-d="${['medium', 'hard', 'easy'][step / 300 % 3 | 0]}"]`)); }
    }
    const st = P.storage.get('app.minesweeper', {}).stats;
    const played = Object.values(st).reduce((a, x) => a + x.played, 0);
    const won = Object.values(st).reduce((a, x) => a + x.won, 0);
    if (played < 5) throw new Error('fuzz played too few games: ' + played);
    t.ok(won <= played);
    w.forceClose();
  });
})();
