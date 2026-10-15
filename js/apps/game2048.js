/* PandaOS — 2048 (id: game2048, single instance).
   - Pure engine (move / canMove / spawn with a seedable RNG) exposed as PandaOS.apps.get('game2048')._engine.
   - Tiles are absolutely positioned DOM nodes moved with CSS transforms. The game state (g) is authoritative;
     animations are only decoration: every transient class is removed by a timer (never by transitionend), and a new
     move first "settles" whatever is still animating, so rapid key presses can never desync DOM and state.
   - Persistence: PandaOS.storage 'app.game2048' (best score, current game, undo history). */
(function () {
  'use strict';

  const P = window.PandaOS;
  if (!P || !P.apps) return;

  const SIZE = 4;
  const WIN_VALUE = 2048;
  const UNDO_LIMIT = 10;
  const STORE_KEY = 'app.game2048';
  const SWIPE_MIN = 30;       // px of drag before a swipe counts
  const SLIDE_MS = 110;       // tile slide duration (keep in sync with css)
  const SETTLE_MS = 330;      // all decorative classes are gone after this

  // ================================================================== engine (pure)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let rng = Math.random;

  const emptyGrid = () => Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  const cloneGrid = (g) => g.map((row) => row.slice());

  function normDir(dir) {
    const d = String(dir == null ? '' : dir).toLowerCase().replace(/^arrow/, '');
    if (d === 'left' || d === 'right' || d === 'up' || d === 'down') return d;
    throw new Error('Geçersiz yön: ' + dir);
  }

  /** The four cells of line i, ordered from the wall the tiles slide towards. */
  function lineCoords(dir, i) {
    const out = [];
    for (let k = 0; k < SIZE; k++) {
      if (dir === 'left') out.push([i, k]);
      else if (dir === 'right') out.push([i, SIZE - 1 - k]);
      else if (dir === 'up') out.push([k, i]);
      else out.push([SIZE - 1 - k, i]);
    }
    return out;
  }

  /** Slides/merges the grid. Pure: returns a new grid.
   *  -> { grid, score, moved, moves: [{from:[r,c], to:[r,c], value, merged}], merges: [{r, c, v}] }
   *  Every tile merges at most once per move: [2,2,2,2] -> [4,4], [4,0,4,4] -> [8,4]. */
  function move(grid, dir) {
    dir = normDir(dir);
    const out = emptyGrid();
    const moves = [];
    const merges = [];
    let score = 0;
    for (let i = 0; i < SIZE; i++) {
      const line = lineCoords(dir, i);
      const packed = [];
      for (const [r, c] of line) {
        const v = (grid[r] && grid[r][c]) || 0;
        if (!v) continue;
        const last = packed[packed.length - 1];
        if (last && !last.merged && last.v === v) {
          last.v = v * 2;
          last.merged = true;
          last.src.push({ r, c, v });
          score += last.v;
        } else {
          packed.push({ v, merged: false, src: [{ r, c, v }] });
        }
      }
      packed.forEach((p, k) => {
        const [tr, tc] = line[k];
        out[tr][tc] = p.v;
        if (p.merged) merges.push({ r: tr, c: tc, v: p.v });
        for (const s of p.src) moves.push({ from: [s.r, s.c], to: [tr, tc], value: s.v, merged: p.merged });
      });
    }
    let moved = false;
    for (let r = 0; r < SIZE && !moved; r++) {
      for (let c = 0; c < SIZE; c++) {
        if ((grid[r] && grid[r][c] || 0) !== out[r][c]) { moved = true; break; }
      }
    }
    return { grid: out, score, moved, moves, merges };
  }

  function emptyCells(grid) {
    const out = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!grid[r][c]) out.push([r, c]);
    return out;
  }

  function canMove(grid) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c];
        if (!v) return true;
        if (c + 1 < SIZE && grid[r][c + 1] === v) return true;
        if (r + 1 < SIZE && grid[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  function maxTile(grid) {
    let m = 0;
    for (const row of grid) for (const v of row) if (v > m) m = v;
    return m;
  }

  /** Picks a random empty cell and a value (90 % 2, 10 % 4) with the engine RNG. Does not modify the grid. */
  function spawn(grid) {
    const cells = emptyCells(grid);
    if (!cells.length) return null;
    const [r, c] = cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))];
    return { r, c, v: rng() < 0.9 ? 2 : 4 };
  }

  function addTile(grid) {
    const t = spawn(grid);
    const out = cloneGrid(grid);
    if (t) out[t.r][t.c] = t.v;
    return { grid: out, tile: t };
  }

  const engine = {
    SIZE,
    WIN_VALUE,
    move,
    canMove,
    emptyCells,
    maxTile,
    spawn,
    addTile,
    emptyGrid,
    cloneGrid,
    seed(n) { rng = mulberry32(Number(n) || 0); },
    setRandom(fn) { rng = typeof fn === 'function' ? fn : Math.random; },
    random() { return rng(); }
  };

  // ================================================================== helpers
  const fmt = (n) => Number(n || 0).toLocaleString('tr-TR');
  const isTileValue = (v) => Number.isInteger(v) && v >= 2 && v <= 1048576 && (v & (v - 1)) === 0;
  const nonNeg = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

  function validTiles(list) {
    if (!Array.isArray(list)) return null;
    const seenId = new Set();
    const seenCell = new Set();
    const out = [];
    for (const t of list) {
      if (!Array.isArray(t) || t.length < 4) return null;
      const [id, r, c, v] = t;
      if (!Number.isInteger(id) || id < 1 || seenId.has(id)) return null;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= SIZE || c >= SIZE) return null;
      if (!isTileValue(v) || seenCell.has(r * SIZE + c)) return null;
      seenId.add(id);
      seenCell.add(r * SIZE + c);
      out.push([id, r, c, v]);
    }
    return out;
  }

  function tilesFromGrid(grid, startId) {
    if (!Array.isArray(grid) || grid.length !== SIZE) return null;
    const out = [];
    let id = startId || 1;
    for (let r = 0; r < SIZE; r++) {
      if (!Array.isArray(grid[r]) || grid[r].length !== SIZE) return null;
      for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c];
        if (v === 0) continue;
        if (!isTileValue(v)) return null;
        out.push([id++, r, c, v]);
      }
    }
    return out;
  }

  function gridFromSpecs(specs) {
    const g = emptyGrid();
    for (const [, r, c, v] of specs) g[r][c] = v;
    return g;
  }

  const KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down'
  };
  const CODES = { KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down' };

  // ================================================================== app
  function launch(win) {
    const U = P.util;
    const el = U.el;
    const timers = new Set();
    const disposers = [];
    let closed = false;

    const later = (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); if (!closed) fn(); }, ms);
      timers.add(id);
      return id;
    };
    const cancel = (id) => { clearTimeout(id); timers.delete(id); };

    // ---------------------------------------------------------------- game state
    const g = {
      tiles: [],            // { id, r, c, v, el }
      score: 0,
      best: 0,
      bestStart: 0,         // best score when this game began ("Yeni rekor!")
      moves: 0,
      nextId: 1,
      won: false,           // the 2048 overlay is pending
      keep: false,          // the player chose "Devam et" (no more win overlays)
      over: false,
      history: []           // [{ tiles:[[id,r,c,v]], score, moves, keep }]
    };
    let dying = [];         // tile elements sliding into a merge, removed shortly after the slide
    let settleIds = [];
    let swipe = null;
    let shownOverlay = '';

    const gridOf = () => gridFromSpecs(g.tiles.map((t) => [t.id, t.r, t.c, t.v]));
    const specs = () => g.tiles.map((t) => [t.id, t.r, t.c, t.v]);

    // ---------------------------------------------------------------- DOM
    const iconEl = (name, size) => (P.icons && P.icons.el ? P.icons.el(name, { size: size || 16 }) : null);

    const scoreVal = el('span', { class: 'g48-score-val', text: '0' });
    const bestVal = el('span', { class: 'g48-score-val', text: '0' });
    const scoreBox = el('div', { class: 'g48-score', role: 'group', 'aria-label': 'Skor' },
      el('span', { class: 'g48-score-label', text: 'SKOR' }), scoreVal);
    const bestBox = el('div', { class: 'g48-score', role: 'group', 'aria-label': 'En iyi skor' },
      el('span', { class: 'g48-score-label', text: 'EN İYİ' }), bestVal);

    const newBtn = el('button', { class: 'p-btn primary g48-new', type: 'button' }, iconEl('refresh'), el('span', { text: 'Yeni oyun' }));
    const undoCount = el('span', { class: 'g48-undo-count', text: '0' });
    const undoBtn = el('button', { class: 'p-btn g48-undo', type: 'button', disabled: true }, iconEl('undo'), el('span', { text: 'Geri al' }), undoCount);
    const movesEl = el('span', { class: 'g48-moves', text: 'Hamle: 0' });

    const cellsEl = el('div', { class: 'g48-cells', 'aria-hidden': 'true' });
    for (let i = 0; i < SIZE * SIZE; i++) cellsEl.appendChild(el('div', { class: 'g48-cell' }));
    const layer = el('div', { class: 'g48-tiles' });

    const ovTitle = el('div', { class: 'g48-ov-title' });
    const ovSub = el('div', { class: 'g48-ov-sub' });
    const ovRecord = el('div', { class: 'g48-ov-record', text: 'Yeni rekor!' });
    const ovContinue = el('button', { class: 'p-btn primary g48-ov-continue', type: 'button', text: 'Devam et' });
    const ovNew = el('button', { class: 'p-btn g48-ov-new', type: 'button', text: 'Yeni oyun' });
    const overlay = el('div', { class: 'g48-overlay', role: 'alertdialog', 'aria-labelledby': 'g48-ov-title-' + win.id },
      ovTitle, ovSub, ovRecord, el('div', { class: 'g48-ov-actions' }, ovContinue, ovNew));
    ovTitle.id = 'g48-ov-title-' + win.id;

    const board = el('div', { class: 'g48-board', tabindex: 0, role: 'application', 'aria-label': '2048 tahtası. Ok tuşları veya WASD ile karoları kaydır.' },
      cellsEl, layer, overlay);
    const live = el('div', { class: 'g48-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });

    const header = el('div', { class: 'g48-header' },
      el('h1', { class: 'g48-title', text: '2048' }),
      el('div', { class: 'g48-scores' }, scoreBox, bestBox));
    const bar = el('div', { class: 'g48-bar' }, newBtn, undoBtn, movesEl);
    const hint = el('p', { class: 'g48-hint', text: 'Ok tuşları veya WASD ile karoları kaydır' });
    const col = el('div', { class: 'g48-col' }, header, bar, hint, board, live);
    const root = el('div', { class: 'g48-root' }, col);
    win.body.appendChild(root);

    // tooltips (PandaOS.ui.tip returns a detach function)
    try {
      if (P.ui && P.ui.tip) {
        disposers.push(P.ui.tip(newBtn, 'Yeni oyun\nN'));
        disposers.push(P.ui.tip(undoBtn, 'Son hamleyi geri al\nCtrl+Z'));
      }
    } catch (_) { /* tooltips are optional */ }

    // ---------------------------------------------------------------- tiles
    function paint(t) {
      const e = t.el;
      e.dataset.v = t.v <= 131072 ? String(t.v) : 'max';
      e.dataset.d = String(String(t.v).length);
      e.firstChild.textContent = String(t.v);
      e.style.setProperty('--x', t.c);
      e.style.setProperty('--y', t.r);
    }

    function buildTile(id, r, c, v, cls) {
      const t = { id, r, c, v, el: el('div', { class: 'g48-tile' + (cls ? ' ' + cls : '') }, el('div', { class: 'g48-face' })) };
      paint(t);
      layer.appendChild(t.el);
      return t;
    }

    function addTileAt(r, c, v, cls) {
      return buildTile(g.nextId++, r, c, v, cls);
    }

    function clearTiles() {
      for (const t of g.tiles) t.el.remove();
      g.tiles = [];
      for (const d of dying) d.remove();
      dying = [];
    }

    /** Finish every in-flight animation right now (DOM already holds the final positions). */
    function settle() {
      settleIds.forEach(cancel);
      settleIds = [];
      for (const d of dying) d.remove();
      dying = [];
      board.classList.remove('moving');
      for (const t of g.tiles) t.el.classList.remove('is-new', 'is-merged', 'is-back');
      overlay.classList.remove('entering');
    }

    function scheduleSettle() {
      settleIds.forEach(cancel);
      settleIds = [
        later(() => { for (const d of dying) d.remove(); dying = []; }, SLIDE_MS + 12),
        later(settle, SETTLE_MS)
      ];
    }

    // ---------------------------------------------------------------- persistence
    function save() {
      try {
        P.storage.set(STORE_KEY, {
          v: 1,
          best: g.best,
          score: g.score,
          moves: g.moves,
          grid: gridOf(),
          tiles: specs(),
          nextId: g.nextId,
          won: g.won,
          keep: g.keep,
          over: g.over,
          bestStart: g.bestStart,
          history: g.history
        });
      } catch (_) { /* storage is best effort */ }
    }

    function load() {
      let s = null;
      try { s = P.storage.get(STORE_KEY, null); } catch (_) { s = null; }
      if (!s || typeof s !== 'object') return false;
      g.best = nonNeg(s.best);
      let tiles = validTiles(s.tiles);
      if (!tiles || !tiles.length) tiles = tilesFromGrid(s.grid, 1);
      if (!tiles || !tiles.length) return false;
      g.tiles = [];
      layer.textContent = '';
      let maxId = 0;
      for (const [id, r, c, v] of tiles) {
        g.tiles.push(buildTile(id, r, c, v));
        if (id > maxId) maxId = id;
      }
      g.nextId = Math.max(maxId + 1, nonNeg(s.nextId), 1);
      g.score = nonNeg(s.score);
      g.moves = nonNeg(s.moves);
      g.keep = !!s.keep;
      g.bestStart = Math.min(nonNeg(s.bestStart), g.best);
      g.best = Math.max(g.best, g.score);
      g.history = [];
      if (Array.isArray(s.history)) {
        for (const h of s.history.slice(-UNDO_LIMIT)) {
          const ht = h && validTiles(h.tiles);
          if (!ht || !ht.length) continue;
          g.history.push({ tiles: ht, score: nonNeg(h.score), moves: nonNeg(h.moves), keep: !!h.keep });
          for (const [id] of ht) if (id >= g.nextId) g.nextId = id + 1;
        }
      }
      refreshFlags();
      return true;
    }

    /** Recomputes won/over from the board: a 2048 tile that the player has not dismissed yet keeps the win overlay pending. */
    function refreshFlags() {
      const grid = gridOf();
      g.won = !g.keep && maxTile(grid) >= WIN_VALUE;
      g.over = !g.won && !canMove(grid);
    }

    // ---------------------------------------------------------------- rendering of the chrome
    function announce(text) {
      live.textContent = '';
      later(() => { live.textContent = text; }, 30);
    }

    function render() {
      scoreVal.textContent = fmt(g.score);
      bestVal.textContent = fmt(g.best);
      scoreVal.dataset.long = String(scoreVal.textContent.length >= 7);
      bestVal.dataset.long = String(bestVal.textContent.length >= 7);
      movesEl.textContent = 'Hamle: ' + fmt(g.moves);
      undoBtn.disabled = !g.history.length;
      undoCount.textContent = String(g.history.length);
      undoCount.hidden = !g.history.length;
      syncOverlay();
    }

    function syncOverlay() {
      const kind = g.won ? 'win' : g.over ? 'over' : '';
      if (kind) {
        overlay.dataset.kind = kind;
        if (kind === 'win') {
          ovTitle.textContent = 'Kazandın!';
          ovSub.textContent = '2048 karosuna ulaştın. Skor: ' + fmt(g.score);
          ovRecord.hidden = true;
        } else {
          ovTitle.textContent = 'Oyun bitti';
          ovSub.textContent = 'Skor: ' + fmt(g.score);
          ovRecord.hidden = !(g.score > 0 && g.score > g.bestStart && g.score >= g.best);
        }
        ovContinue.hidden = kind !== 'win';
        ovContinue.classList.toggle('primary', kind === 'win');
        ovNew.classList.toggle('primary', kind === 'over');
      }
      overlay.classList.toggle('show', !!kind);
      overlay.setAttribute('aria-hidden', kind ? 'false' : 'true');
      if (kind && kind !== shownOverlay) {
        overlay.classList.add('entering');
        settleIds.push(later(() => overlay.classList.remove('entering'), 800));
        const target = kind === 'win' ? ovContinue : ovNew;
        try { target.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        announce(kind === 'win' ? 'Kazandın! 2048 karosuna ulaştın.' : 'Oyun bitti. Skor: ' + fmt(g.score));
        try { if (P.sound && P.sound.play) P.sound.play(kind === 'win' ? 'notify' : 'error'); } catch (_) { /* ignore */ }
      } else if (!kind && shownOverlay) {
        if (overlay.contains(document.activeElement)) {
          try { board.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        }
      }
      shownOverlay = kind;
    }

    function floatPlus(n) {
      const f = el('span', { class: 'g48-plus', text: '+' + fmt(n) });
      scoreBox.appendChild(f);
      const old = scoreBox.querySelectorAll('.g48-plus');
      if (old.length > 4) old[0].remove();
      later(() => f.remove(), 760);
    }

    // ---------------------------------------------------------------- game actions
    function snapshot() {
      return { tiles: specs(), score: g.score, moves: g.moves, keep: g.keep };
    }

    function pushHistory(snap) {
      g.history.push(snap);
      while (g.history.length > UNDO_LIMIT) g.history.shift();
    }

    function doMove(dir) {
      if (closed || g.won || g.over) return false;
      settle();
      const res = move(gridOf(), dir);
      if (!res.moved) return false;
      pushHistory(snapshot());

      const at = new Map(g.tiles.map((t) => [t.r * SIZE + t.c, t]));
      const keepers = [];
      const losers = [];
      for (const m of res.moves) {
        const t = at.get(m.from[0] * SIZE + m.from[1]);
        if (!t) continue;
        t.r = m.to[0];
        t.c = m.to[1];
        t.el.style.setProperty('--x', t.c);
        t.el.style.setProperty('--y', t.r);
        (m.merged ? losers : keepers).push(t);
      }
      board.classList.add('moving');
      for (const l of losers) dying.push(l.el);
      const born = res.merges.map((m) => addTileAt(m.r, m.c, m.v, 'is-merged'));
      g.tiles = keepers.concat(born);
      const sp = spawn(res.grid);
      if (sp) g.tiles.push(addTileAt(sp.r, sp.c, sp.v, 'is-new'));

      g.score += res.score;
      g.moves += 1;
      if (g.score > g.best) g.best = g.score;
      const wonNow = !g.keep && res.merges.some((m) => m.v >= WIN_VALUE);
      g.won = wonNow;
      g.over = !wonNow && !canMove(gridOf());
      if (res.score > 0) floatPlus(res.score);
      scheduleSettle();
      render();
      save();
      return true;
    }

    function undo() {
      if (closed || !g.history.length) return false;
      settle();
      const snap = g.history.pop();
      const old = new Map(g.tiles.map((t) => [t.id, t]));
      const next = [];
      for (const [id, r, c, v] of snap.tiles) {
        let t = old.get(id);
        if (t) {
          old.delete(id);
          t.r = r; t.c = c; t.v = v;
          paint(t);
        } else {
          t = buildTile(id, r, c, v, 'is-back');
        }
        next.push(t);
        if (id >= g.nextId) g.nextId = id + 1;
      }
      old.forEach((t) => t.el.remove());
      board.classList.add('moving');
      g.tiles = next;
      g.score = snap.score;
      g.moves = snap.moves;
      g.keep = !!snap.keep;
      refreshFlags();
      scheduleSettle();
      render();
      save();
      announce('Geri alındı. Skor: ' + fmt(g.score));
      return true;
    }

    function newGame() {
      if (closed) return;
      settle();
      if (g.moves > 0) pushHistory(snapshot());   // an accidental "Yeni oyun" can be undone
      clearTiles();
      g.score = 0;
      g.moves = 0;
      g.won = false;
      g.over = false;
      g.keep = false;
      g.bestStart = g.best;
      for (let i = 0; i < 2; i++) {
        const sp = spawn(gridOf());
        if (sp) g.tiles.push(addTileAt(sp.r, sp.c, sp.v, 'is-new'));
      }
      scheduleSettle();
      render();
      save();
      announce('Yeni oyun başladı');
    }

    function keepPlaying() {
      if (!g.won) return;
      g.won = false;
      g.keep = true;
      g.over = !canMove(gridOf());
      render();
      save();
      try { board.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }

    async function resetBest() {
      if (!g.best) return;
      let ok = false;
      try {
        ok = await P.dialog.confirm({
          title: 'En iyi skoru sıfırla',
          message: `Kayıtlı en iyi skor (${fmt(g.best)}) silinecek. Bu işlem geri alınamaz.`,
          okText: 'Sıfırla',
          danger: true
        });
      } catch (_) { ok = false; }
      if (!ok || closed) return;
      g.best = g.score;
      g.bestStart = 0;
      render();
      save();
    }

    // ---------------------------------------------------------------- input
    const unKey = win.on('keydown', (e) => {
      try {
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key;
        if (mod && !e.altKey && (k === 'z' || k === 'Z')) { e.preventDefault(); undo(); return; }
        if (mod || e.altKey) return;
        const dir = KEYS[k] || KEYS[String(k).toLowerCase()] || CODES[e.code];
        if (dir) { e.preventDefault(); doMove(dir); return; }
        if (k === 'n' || k === 'N') { e.preventDefault(); newGame(); return; }
        if (k === 'z' || k === 'Z') { e.preventDefault(); undo(); return; }
        if (k === 'Escape' && g.won) { e.preventDefault(); keepPlaying(); }
      } catch (err) { console.error('[game2048] tuş işlenemedi', err); }
    });
    disposers.push(unKey);

    function dirFromDelta(dx, dy) {
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }

    function onPointerMove(e) {
      if (!swipe || swipe.done || (swipe.id != null && e.pointerId != null && e.pointerId !== swipe.id)) return;
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_MIN) {
        swipe.done = true;
        doMove(dirFromDelta(dx, dy));
      }
    }

    function endSwipe(e) {
      if (!swipe) return;
      if (swipe.id != null && e && e.pointerId != null && e.pointerId !== swipe.id) return;
      if (!swipe.done && e && e.type === 'pointerup') {
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_MIN) doMove(dirFromDelta(dx, dy));
      }
      swipe = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endSwipe);
      window.removeEventListener('pointercancel', endSwipe);
    }

    board.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (swipe) endSwipe(null);
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', endSwipe);
      window.addEventListener('pointercancel', endSwipe);
    });
    disposers.push(() => endSwipe(null));

    newBtn.addEventListener('click', () => newGame());
    undoBtn.addEventListener('click', () => undo());
    ovContinue.addEventListener('click', () => keepPlaying());
    ovNew.addEventListener('click', () => newGame());

    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!P.contextMenu || !P.contextMenu.show) return;
      P.contextMenu.show(e.clientX, e.clientY, [
        { label: 'Yeni oyun', icon: 'refresh', shortcut: 'N', action: () => newGame() },
        { label: 'Geri al', icon: 'undo', shortcut: 'Ctrl+Z', disabled: !g.history.length, action: () => undo() },
        { type: 'separator' },
        { label: 'En iyi skoru sıfırla', icon: 'delete', danger: true, disabled: !g.best, action: () => resetBest() }
      ]);
    });

    // ---------------------------------------------------------------- lifecycle
    if (!load()) {
      g.best = nonNeg(g.best);
      newGame();
      g.history = [];
    }
    g.bestStart = Math.min(g.bestStart, g.best);
    render();
    save();

    win.on('close', () => {
      closed = true;
      try { save(); } catch (_) { /* ignore */ }
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      while (disposers.length) {
        try { disposers.pop()(); } catch (_) { /* ignore */ }
      }
      swipe = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endSwipe);
      window.removeEventListener('pointercancel', endSwipe);
      try { if (P.ui && P.ui.tip && P.ui.tip.hide) P.ui.tip.hide(); } catch (_) { /* ignore */ }
    });

    // Test / tooling hooks (the UI itself never needs them).
    win.state.api = {
      state() {
        return {
          grid: gridOf(), score: g.score, best: g.best, moves: g.moves, won: g.won, over: g.over,
          keep: g.keep, history: g.history.length, nextId: g.nextId, bestStart: g.bestStart
        };
      },
      /** Replaces the board (4x4 numbers). opts: score, best, moves, keep, keepHistory. */
      setBoard(grid, opts) {
        opts = opts || {};
        const tiles = tilesFromGrid(grid, g.nextId);
        if (!tiles) throw new Error('Geçersiz tahta');
        settle();
        clearTiles();
        layer.textContent = '';
        for (const [id, r, c, v] of tiles) {
          g.tiles.push(buildTile(id, r, c, v));
          if (id >= g.nextId) g.nextId = id + 1;
        }
        g.score = nonNeg(opts.score);
        g.moves = nonNeg(opts.moves);
        g.keep = !!opts.keep;
        if (opts.best != null) g.best = nonNeg(opts.best);
        g.best = Math.max(g.best, g.score);
        g.bestStart = opts.bestStart != null ? nonNeg(opts.bestStart) : Math.min(g.bestStart, g.best);
        if (!opts.keepHistory) g.history = [];
        refreshFlags();
        render();
        save();
      },
      /** DOM <-> state consistency: every tile node shows the right value at the right cell. */
      domGrid() {
        const out = emptyGrid();
        let count = 0;
        for (const n of layer.querySelectorAll('.g48-tile')) {
          if (dying.indexOf(n) >= 0) continue;
          const r = Number(n.style.getPropertyValue('--y'));
          const c = Number(n.style.getPropertyValue('--x'));
          out[r][c] = Number(n.firstChild.textContent);
          count++;
        }
        return { grid: out, count };
      },
      settle,
      move: doMove,
      undo,
      newGame
    };
  }

  P.apps.register({
    id: 'game2048',
    name: '2048',
    icon: 'game2048',
    description: 'Karoları kaydır, 2048\'e ulaş',
    category: 'games',
    fileTypes: [],
    singleInstance: true,
    window: { width: 460, height: 640, minWidth: 360, minHeight: 520, resizable: true, maximizable: true },
    launch,
    _engine: engine
  });
})();
