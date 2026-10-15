(function () {
  'use strict';
  const P = window.PandaOS;
  const E = () => P.apps.get('minesweeper')._engine;

  function check(b, label) {
    let rev = 0, flags = 0, mines = 0;
    for (let i = 0; i < b.size; i++) {
      if (b.state[i] === 1) rev++;
      if (b.state[i] === 2) flags++;
      mines += b.mine[i];
      if (b.state[i] === 1 && b.mine[i]) throw new Error(label + ': revealed a mine without loss at ' + i + ' status ' + b.status);
    }
    if (b.placed && mines !== b.mines) throw new Error(label + ': mine count ' + mines + ' vs ' + b.mines);
    if (rev !== b.revealed) throw new Error(label + ': revealed ' + rev + ' vs counter ' + b.revealed);
    if (flags !== b.flags) throw new Error(label + ': flags ' + flags + ' vs counter ' + b.flags);
    if (b.status === 'won' && b.revealed !== b.size - b.mines) throw new Error(label + ': won but revealed ' + b.revealed);
    if (b.status === 'won') for (let i = 0; i < b.size; i++) if (b.mine[i] && b.state[i] !== 2) throw new Error(label + ': won but mine not flagged ' + i);
    if (b.status === 'playing' && b.revealed === b.size - b.mines) throw new Error(label + ': all safe revealed but still playing');
  }

  PandaTest.test('QA engine fuzz: invariants over random games', (t) => {
    const e = E();
    let wins = 0, losses = 0, games = 0;
    let s = 1234567;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let g = 0; g < 400; g++) {
      const w = 8 + Math.floor(rnd() * 12), h = 8 + Math.floor(rnd() * 10);
      const mines = 1 + Math.floor(rnd() * Math.min(60, w * h - 9));
      const b = e.createBoard(w, h, mines, g + 1);
      const q = rnd() < 0.5;
      for (let step = 0; step < 400 && b.status !== 'won' && b.status !== 'lost'; step++) {
        const i = Math.floor(rnd() * b.size);
        const op = rnd();
        if (op < 0.55) { const before = b.status; const r = e.reveal(b, i); if (before === 'ready' && b.status !== 'lost' && b.mine[i]) throw new Error('first click mine'); if (before === 'ready' && b.status === 'lost') throw new Error('first click lost ' + g); }
        else if (op < 0.8) e.toggleFlag(b, i, q);
        else e.chord(b, i);
        check(b, 'g' + g + ' step' + step);
      }
      // solver: reveal every non-mine cell; should always win
      if (b.status === 'playing' || b.status === 'ready') {
        // unflag everything non-mine
        for (let i = 0; i < b.size; i++) if (!b.mine[i] && (b.state[i] === 2 || b.state[i] === 3)) { while (b.state[i] !== 0) e.toggleFlag(b, i, true); }
        for (let i = 0; i < b.size; i++) if (!b.mine[i] && b.state[i] === 0) e.reveal(b, i);
        check(b, 'solve g' + g);
        if (b.status !== 'won') throw new Error('solver did not win g' + g + ' ' + b.status + ' revealed ' + b.revealed + '/' + (b.size - b.mines));
      }
      games++;
      if (b.status === 'won') wins++; else losses++;
    }
    t.ok(games === 400 && wins > 0 && losses >= 0, 'ran');
  });
})();
