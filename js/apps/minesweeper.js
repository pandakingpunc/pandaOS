/* Mayın Tarlası — PandaOS Minesweeper.
   Part 1: a pure rules engine (no DOM) exposed as PandaOS.apps.get('minesweeper')._engine.
   Part 2: the window UI — LED counters, panda face, board, keyboard play, statistics, custom games.
   Everything the user sees is Turkish; persisted state lives in PandaOS.storage 'app.minesweeper'. */
(function () {
  'use strict';

  const P = window.PandaOS;
  if (!P || !P.apps || !P.util) return;
  const U = P.util;
  const el = U.el;

  // ====================================================================================================
  // Engine
  // ====================================================================================================
  const HIDDEN = 0;
  const REVEALED = 1;
  const FLAG = 2;
  const QUESTION = 3;

  const PRESETS = {
    easy: { id: 'easy', name: 'Kolay', width: 9, height: 9, mines: 10 },
    medium: { id: 'medium', name: 'Orta', width: 16, height: 16, mines: 40 },
    hard: { id: 'hard', name: 'Zor', width: 30, height: 16, mines: 99 }
  };
  const NAMES = { easy: 'Kolay', medium: 'Orta', hard: 'Zor', custom: 'Özel' };
  const DIFFS = ['easy', 'medium', 'hard', 'custom'];
  const LIMITS = { minW: 8, maxW: 50, minH: 8, maxH: 30, maxMines: 999 };

  function hashSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
    const s = String(seed);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** mulberry32: small, fast, well distributed; same seed → same sequence. */
  function makeRng(seed) {
    let a = hashSeed(seed);
    return function rng() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function maxMines(width, height) {
    return Math.max(1, Math.min(LIMITS.maxMines, width * height - 9));
  }

  /** Validation used by the custom game form. Returns { ok, errors: { width?, height?, mines? } } (Turkish messages). */
  function validate(width, height, mines) {
    const errors = {};
    const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
    if (!isInt(width)) errors.width = 'Genişlik için bir tam sayı gir.';
    else if (width < LIMITS.minW || width > LIMITS.maxW) errors.width = `Genişlik ${LIMITS.minW} ile ${LIMITS.maxW} arasında olmalı.`;
    if (!isInt(height)) errors.height = 'Yükseklik için bir tam sayı gir.';
    else if (height < LIMITS.minH || height > LIMITS.maxH) errors.height = `Yükseklik ${LIMITS.minH} ile ${LIMITS.maxH} arasında olmalı.`;
    if (!isInt(mines)) errors.mines = 'Mayın sayısı için bir tam sayı gir.';
    else if (mines < 1) errors.mines = 'En az 1 mayın olmalı.';
    else if (!errors.width && !errors.height) {
      const cap = maxMines(width, height);
      if (mines > cap) errors.mines = `Bu boyutta en fazla ${cap.toLocaleString('tr-TR')} mayın olabilir.`;
    }
    return { ok: Object.keys(errors).length === 0, errors };
  }

  function inRange(b, i) {
    return Number.isInteger(i) && i >= 0 && i < b.size;
  }

  function isOver(b) {
    return b.status === 'won' || b.status === 'lost';
  }

  function blankResult() {
    return { changed: [], depth: [], started: false, lost: false, won: false, chorded: false };
  }

  function normalizeCell(b, cell) {
    if (cell == null) return null;
    if (typeof cell === 'object' && 'x' in cell && 'y' in cell) return cell.y * b.width + cell.x;
    return Number.isInteger(cell) ? cell : null;
  }

  function neighbors(b, i) {
    const w = b.width;
    const h = b.height;
    const x = i % w;
    const y = (i / w) | 0;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        out.push(yy * w + xx);
      }
    }
    return out;
  }

  function computeAdjacent(b) {
    for (let i = 0; i < b.size; i++) {
      if (b.mine[i]) { b.adj[i] = 0; continue; }
      let n = 0;
      for (const j of neighbors(b, i)) n += b.mine[j];
      b.adj[i] = n;
    }
  }

  /** Spreads the mines with the board's seed, keeping `safe` and its neighbours free (as far as the mine count allows). */
  function placeMines(b, safe) {
    const rng = makeRng(b.seed);
    const zone = new Uint8Array(b.size);
    if (safe != null && inRange(b, safe)) {
      zone[safe] = 1;
      for (const j of neighbors(b, safe)) zone[j] = 1;
      let free = 0;
      for (let i = 0; i < b.size; i++) if (!zone[i]) free++;
      if (free < b.mines) { zone.fill(0); zone[safe] = 1; }
    }
    const pool = [];
    for (let i = 0; i < b.size; i++) if (!zone[i]) pool.push(i);
    for (let k = 0; k < b.mines; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      const tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
      b.mine[pool[k]] = 1;
    }
    computeAdjacent(b);
    b.placed = true;
  }

  function newBoard(width, height, mines, seed) {
    const size = width * height;
    return {
      width, height, size, mines, seed,
      mine: new Uint8Array(size),
      adj: new Uint8Array(size),
      state: new Uint8Array(size),
      revealed: 0,
      flags: 0,
      placed: false,
      status: 'ready',      // ready → playing → won | lost
      exploded: []          // indices of the mines that went off
    };
  }

  /** createBoard(width, height, mines, seed?, safeCell?) — with `safeCell` (index or {x,y}) the mines are placed right away
   *  around it; without, they are placed on the first reveal so the first click is always safe. */
  function createBoard(width, height, mines, seed, safeCell) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError('Geçersiz tahta boyutu');
    }
    if (!Number.isInteger(mines) || mines < 0 || mines > width * height - 1) {
      throw new RangeError('Geçersiz mayın sayısı');
    }
    if (seed == null) seed = (Math.random() * 4294967296) >>> 0;
    const b = newBoard(width, height, mines, seed);
    const safe = normalizeCell(b, safeCell);
    if (safe != null && inRange(b, safe)) placeMines(b, safe);
    return b;
  }

  /** A board with mines at exactly the given indices (for tests and puzzles). */
  function createBoardFromMines(width, height, indices, seed) {
    const list = Array.from(new Set(indices));
    const b = newBoard(width, height, list.length, seed == null ? 0 : seed);
    for (const i of list) {
      if (!inRange(b, i)) throw new RangeError('Mayın tahtanın dışında');
      b.mine[i] = 1;
    }
    computeAdjacent(b);
    b.placed = true;
    return b;
  }

  /** Reveals `start` (hidden, not a mine) and, through zeros, everything connected to it. Breadth first, so
   *  `depth` is the distance in steps (the UI staggers its pop animation with it). Flags are never opened. */
  function flood(b, start, res) {
    const { state, adj } = b;
    let head = res.changed.length;
    state[start] = REVEALED;
    b.revealed++;
    res.changed.push(start);
    res.depth.push(0);
    while (head < res.changed.length) {
      const i = res.changed[head];
      const d = res.depth[head];
      head++;
      if (adj[i] !== 0) continue;
      for (const n of neighbors(b, i)) {
        if (state[n] === HIDDEN || state[n] === QUESTION) {
          state[n] = REVEALED;
          b.revealed++;
          res.changed.push(n);
          res.depth.push(d + 1);
        }
      }
    }
  }

  function explode(b, list, res) {
    b.status = 'lost';
    for (const m of list) {
      if (!b.exploded.includes(m)) b.exploded.push(m);
      res.changed.push(m);
      res.depth.push(0);
    }
    res.lost = true;
    return res;
  }

  /** All safe cells are open: flag the mines that are still unmarked. */
  function finishWin(b, res) {
    b.status = 'won';
    for (let i = 0; i < b.size; i++) {
      if (b.mine[i] && b.state[i] !== FLAG) {
        b.state[i] = FLAG;
        b.flags++;
        res.changed.push(i);
        res.depth.push(0);
      }
    }
    res.won = true;
  }

  function reveal(b, i) {
    const res = blankResult();
    if (!inRange(b, i) || isOver(b)) return res;
    if (b.state[i] === REVEALED || b.state[i] === FLAG) return res;
    if (!b.placed) placeMines(b, i);
    if (b.status === 'ready') { b.status = 'playing'; res.started = true; }
    if (b.mine[i]) return explode(b, [i], res);
    flood(b, i, res);
    if (b.revealed === b.size - b.mines) finishWin(b, res);
    return res;
  }

  /** Chording: a revealed number whose neighbouring flag count equals the number opens its other neighbours. */
  function chord(b, i) {
    const res = blankResult();
    if (!inRange(b, i) || isOver(b) || b.state[i] !== REVEALED || b.adj[i] === 0) return res;
    const around = neighbors(b, i);
    let flags = 0;
    for (const n of around) if (b.state[n] === FLAG) flags++;
    if (flags !== b.adj[i]) return res;
    res.chorded = true;
    const hit = [];
    for (const n of around) {
      const s = b.state[n];
      if (s !== HIDDEN && s !== QUESTION) continue;
      if (b.mine[n]) hit.push(n);
      else flood(b, n, res);
    }
    if (hit.length) return explode(b, hit, res);
    if (b.revealed === b.size - b.mines) finishWin(b, res);
    return res;
  }

  /** hidden → flag → (question mark when `allowQuestion`) → hidden. Revealed cells and finished games are untouched. */
  function toggleFlag(b, i, allowQuestion) {
    const res = blankResult();
    if (!inRange(b, i) || isOver(b)) return res;
    const s = b.state[i];
    if (s === REVEALED) return res;
    if (s === HIDDEN) { b.state[i] = FLAG; b.flags++; }
    else if (s === FLAG) { b.flags--; b.state[i] = allowQuestion ? QUESTION : HIDDEN; }
    else b.state[i] = HIDDEN;
    res.changed.push(i);
    res.depth.push(0);
    return res;
  }

  /** mines − flags (negative when the player flagged too much). */
  function remaining(b) {
    return b.mines - b.flags;
  }

  function countFlagsAround(b, i) {
    let n = 0;
    for (const j of neighbors(b, i)) if (b.state[j] === FLAG) n++;
    return n;
  }

  /** Text picture of the board, one row per line: # hidden, F flag, ? question, . empty, 1-8 numbers, * mine (opt-in). */
  function dump(b, opts) {
    const showMines = !!(opts && opts.showMines);
    const rows = [];
    for (let y = 0; y < b.height; y++) {
      let line = '';
      for (let x = 0; x < b.width; x++) {
        const i = y * b.width + x;
        const s = b.state[i];
        if (s === REVEALED) line += b.adj[i] ? String(b.adj[i]) : '.';
        else if (showMines && b.mine[i]) line += '*';
        else if (s === FLAG) line += 'F';
        else if (s === QUESTION) line += '?';
        else line += '#';
      }
      rows.push(line);
    }
    return rows.join('\n');
  }

  const Engine = {
    HIDDEN, REVEALED, FLAG, QUESTION,
    PRESETS, LIMITS,
    makeRng, maxMines, validate,
    createBoard, createBoardFromMines,
    neighbors, reveal, toggleFlag, chord,
    remaining, countFlagsAround, dump
  };

  // ====================================================================================================
  // Persistence ('app.minesweeper')
  // ====================================================================================================
  const KEY = 'app.minesweeper';

  const blankStat = () => ({ played: 0, won: 0, streak: 0, bestStreak: 0, totalTime: 0 });

  function defaultState() {
    return {
      version: 1,
      difficulty: 'easy',
      custom: { width: 20, height: 12, mines: 40 },
      questionMarks: false,
      sound: true,
      best: { easy: null, medium: null, hard: null },
      records: { easy: [], medium: [], hard: [] },
      stats: { easy: blankStat(), medium: blankStat(), hard: blankStat(), custom: blankStat() }
    };
  }

  function loadState() {
    const d = defaultState();
    let raw = null;
    try { raw = P.storage.get(KEY, null); } catch (_) { raw = null; }
    if (!raw || typeof raw !== 'object') return d;
    const int = (v, lo, hi, fb) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fb);
    if (DIFFS.includes(raw.difficulty)) d.difficulty = raw.difficulty;
    if (raw.custom && typeof raw.custom === 'object') {
      const c = {
        width: int(raw.custom.width, LIMITS.minW, LIMITS.maxW, d.custom.width),
        height: int(raw.custom.height, LIMITS.minH, LIMITS.maxH, d.custom.height),
        mines: int(raw.custom.mines, 1, LIMITS.maxMines, d.custom.mines)
      };
      if (validate(c.width, c.height, c.mines).ok) d.custom = c;
    }
    d.questionMarks = raw.questionMarks === true;
    d.sound = raw.sound !== false;
    for (const id of ['easy', 'medium', 'hard']) {
      d.best[id] = int(raw.best && raw.best[id], 1, 999, null);
      const recs = raw.records && Array.isArray(raw.records[id]) ? raw.records[id] : [];
      d.records[id] = recs
        .filter((r) => r && int(r.t, 1, 999, 0) && Number.isFinite(r.at))
        .map((r) => ({ t: r.t, at: r.at }))
        .sort((a, b) => a.t - b.t || a.at - b.at)
        .slice(0, 5);
    }
    for (const id of DIFFS) {
      const s = raw.stats && raw.stats[id];
      if (!s || typeof s !== 'object') continue;
      const played = int(s.played, 0, 1e9, 0);
      d.stats[id] = {
        played,
        won: Math.min(played, int(s.won, 0, 1e9, 0)),
        streak: int(s.streak, 0, 1e9, 0),
        bestStreak: int(s.bestStreak, 0, 1e9, 0),
        totalTime: int(s.totalTime, 0, 1e12, 0)
      };
    }
    return d;
  }

  function saveState(state) {
    try { P.storage.set(KEY, state); } catch (_) { /* storage is optional */ }
  }

  // ====================================================================================================
  // Artwork: LED digits, panda face
  // ====================================================================================================
  const SEG_NAMES = 'abcdefg';
  const SEG_MAP = {
    0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g'
  };

  const DIGIT_SVG = (() => {
    const h = 1.3; const g = 0.45; const xl = 1.3; const xr = 12.7; const yt = 1.3; const ym = 12; const yb = 22.7;
    const hseg = (cy) => [[xl + g, cy], [xl + g + h, cy - h], [xr - g - h, cy - h], [xr - g, cy], [xr - g - h, cy + h], [xl + g + h, cy + h]];
    const vseg = (cx, y0, y1) => [[cx, y0 + g], [cx + h, y0 + g + h], [cx + h, y1 - g - h], [cx, y1 - g], [cx - h, y1 - g - h], [cx - h, y0 + g + h]];
    const polys = {
      a: hseg(yt), b: vseg(xr, yt, ym), c: vseg(xr, ym, yb), d: hseg(yb), e: vseg(xl, ym, yb), f: vseg(xl, yt, ym), g: hseg(ym)
    };
    const body = SEG_NAMES.split('').map((k) => {
      const pts = polys[k].map((p) => `${+p[0].toFixed(2)},${+p[1].toFixed(2)}`).join(' ');
      return `<polygon points="${pts}"/>`;
    }).join('');
    return `<svg class="ms-digit" viewBox="0 0 14 24" aria-hidden="true">${body}</svg>`;
  })();

  /** A 3-digit seven-segment LED box. set(n) accepts −99…999 (anything else is clamped). */
  function createLed(kind, iconName, label) {
    const root = el('div', { class: 'ms-led', role: 'img', dataset: { kind } });
    const digits = el('div', { class: 'ms-digits' });
    const tpl = document.createElement('template');
    const cells = [];
    for (let k = 0; k < 3; k++) {
      tpl.innerHTML = DIGIT_SVG;
      const svg = tpl.content.firstChild;
      digits.appendChild(svg);
      cells.push(Array.from(svg.querySelectorAll('polygon')));
    }
    if (iconName && P.icons && P.icons.el) root.appendChild(P.icons.el(iconName, { size: 15 }));
    root.appendChild(digits);
    let last = '';
    function format(v) {
      v = Math.trunc(Number(v) || 0);
      if (v > 999) v = 999;
      if (v < -99) v = -99;
      return v < 0 ? '-' + String(-v).padStart(2, '0') : String(v).padStart(3, '0');
    }
    function set(v) {
      const text = format(v);
      if (text === last) return;
      last = text;
      for (let k = 0; k < 3; k++) {
        const on = SEG_MAP[text[k]] || '';
        cells[k].forEach((poly, idx) => poly.classList.toggle('on', on.indexOf(SEG_NAMES[idx]) >= 0));
      }
      root.dataset.value = text;
      root.setAttribute('aria-label', `${label}: ${Number(text)}`);
    }
    return { el: root, set, get text() { return last; } };
  }

  /** The panda face. kind: normal | oh | cool | dead. */
  function faceSVG(kind) {
    const ink = '#1b1e25';
    const ears = `<circle cx="11.4" cy="11.6" r="6.7" fill="${ink}"/><circle cx="36.6" cy="11.6" r="6.7" fill="${ink}"/>
<circle cx="11.6" cy="11.9" r="2.8" fill="#4a5163" fill-opacity=".55"/><circle cx="36.4" cy="11.9" r="2.8" fill="#4a5163" fill-opacity=".55"/>`;
    const head = `<ellipse cx="24" cy="26.2" rx="18.6" ry="16.6" fill="url(#msw)" stroke="#2a2e38" stroke-width="1.5"/>`;
    const patches = `<ellipse cx="16.1" cy="25.2" rx="4.5" ry="6.1" transform="rotate(24 16.1 25.2)" fill="${ink}"/>
<ellipse cx="31.9" cy="25.2" rx="4.5" ry="6.1" transform="rotate(-24 31.9 25.2)" fill="${ink}"/>`;
    const cheeks = '<ellipse cx="10.8" cy="32.6" rx="2.6" ry="1.7" fill="#ff8fa6" fill-opacity=".55"/><ellipse cx="37.2" cy="32.6" rx="2.6" ry="1.7" fill="#ff8fa6" fill-opacity=".55"/>';
    const nose = `<path d="M20.8 29.6c0-1.3 1.4-2.1 3.2-2.1s3.2.8 3.2 2.1c0 1.5-1.7 2.6-3.2 2.6s-3.2-1.1-3.2-2.6z" fill="${ink}"/><ellipse cx="22.9" cy="28.5" rx="1.2" ry=".6" fill="#fff" fill-opacity=".45"/>`;
    const stroke = `stroke="${ink}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
    let eyes;
    let mouth;
    let extra = '';
    if (kind === 'oh') {
      eyes = `<circle cx="16.6" cy="24.4" r="2.9" fill="#fff"/><circle cx="31.4" cy="24.4" r="2.9" fill="#fff"/>
<circle cx="16.9" cy="24.7" r="1.5" fill="${ink}"/><circle cx="31.1" cy="24.7" r="1.5" fill="${ink}"/>`;
      extra = `<path d="M12.6 17.4q3.4-2.6 6.6-.2M35.4 17.4q-3.4-2.6-6.6-.2" ${stroke}/>`;
      mouth = `<ellipse cx="24" cy="36" rx="2.5" ry="3" fill="${ink}"/><ellipse cx="24" cy="37.3" rx="1.4" ry="1.1" fill="#ff7a95"/>`;
    } else if (kind === 'cool') {
      eyes = `<defs><linearGradient id="msl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4d86"/><stop offset="1" stop-color="#0f1630"/></linearGradient></defs>
<path d="M10.4 23.2 7.6 21.6M37.6 23.2l2.8-1.6" stroke="#eef1f8" stroke-width="1.5" stroke-linecap="round"/>
<path d="M22.6 24.2q1.4-1.3 2.8 0" stroke="#eef1f8" stroke-width="1.6" stroke-linecap="round" fill="none"/>
<path d="M10.8 22.4h11a1 1 0 0 1 1 1.1c-.4 3.6-2.2 6-5.4 6-3.6 0-6.2-2.4-6.8-6a1 1 0 0 1 .2-1.1z" fill="url(#msl)" stroke="#eef1f8" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M37.2 22.4h-11a1 1 0 0 0-1 1.1c.4 3.6 2.2 6 5.4 6 3.6 0 6.2-2.4 6.8-6a1 1 0 0 0-.2-1.1z" fill="url(#msl)" stroke="#eef1f8" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M12.4 27.2l3.2-3.6M14.8 28l3.2-3.6M29.6 27.2l3.2-3.6M32 28l3.2-3.6" stroke="#fff" stroke-opacity=".5" stroke-width="1.1" stroke-linecap="round"/>`;
      mouth = `<path d="M19.4 33.4c1.2 3.6 7.9 3.6 9.2 0" ${stroke}/><path d="M24 31.8v1.2" ${stroke}/>`;
    } else if (kind === 'dead') {
      eyes = `<path d="M13.4 22.2l6.4 6.4M19.8 22.2l-6.4 6.4M28.2 22.2l6.4 6.4M34.6 22.2l-6.4 6.4" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>`;
      mouth = `<path d="M24 31.8v1M19.8 36.2q1.2-1.8 2.1 0t2.1 0 2.1 0 2.1 0" ${stroke}/><path d="M25.4 37v2.2a1.5 1.5 0 0 0 3 0V37z" fill="#ff7a95" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/>`;
    } else {
      eyes = `<circle cx="16.9" cy="24.3" r="2.2" fill="#fff"/><circle cx="31.1" cy="24.3" r="2.2" fill="#fff"/>
<circle cx="17.2" cy="24.7" r="1.1" fill="${ink}"/><circle cx="30.8" cy="24.7" r="1.1" fill="${ink}"/>
<circle cx="16.4" cy="23.6" r=".55" fill="#fff"/><circle cx="30.4" cy="23.6" r=".55" fill="#fff"/>`;
      mouth = `<path d="M24 32.1v1.3M20.8 33.9c1.1 1.6 2.4 1.6 3.2-.5.8 2.1 2.1 2.1 3.2.5" ${stroke}/>`;
    }
    return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs><radialGradient id="msw" cx=".38" cy=".25" r=".95"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f1f3f8"/><stop offset="1" stop-color="#d9dfea"/></radialGradient></defs>${ears}${head}${patches}${cheeks}${eyes}${extra}${kind === 'cool' ? '' : nose}${kind === 'cool' ? nose : ''}${mouth}</svg>`;
  }

  function icon(name, size) {
    try {
      if (P.icons && P.icons.el) return P.icons.el(name, { size: size || 16 });
    } catch (_) { /* fall through */ }
    return document.createTextNode('');
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmtInt = (n) => Number(n).toLocaleString('tr-TR');

  // ====================================================================================================
  // UI
  // ====================================================================================================
  const GAP = 2;          // px between cells (matches --ms-gap)
  const MAX_CS = 28;      // preferred cell size
  const MIN_CS = 16;      // smallest cell size when the board has to fit a small screen
  const MIN_WIN_W = 340;
  const MIN_WIN_H = 520;   // tall enough for the statistics panel on the smallest board

  function launch(win, args) {
    const state = loadState();
    const disposers = [];
    const timeouts = new Set();
    let disposed = false;

    const later = (fn, ms) => {
      const id = setTimeout(() => { timeouts.delete(id); if (!disposed) fn(); }, ms);
      timeouts.add(id);
      return id;
    };
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      disposers.push(() => target.removeEventListener(type, fn, opts));
    };
    const tip = (node, text) => {
      try {
        const off = P.ui && typeof P.ui.tip === 'function' ? P.ui.tip(node, text) : null;
        if (typeof off === 'function') disposers.push(off);
      } catch (_) { /* tooltips are optional */ }
    };

    // ----------------------------------------------------------------------------- layout
    const root = win.body;

    const menuBtn = el('button', { class: 'p-btn ghost small ms-menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Oyun menüsü' },
      el('span', { text: 'Oyun' }), icon('chevron-down', 14));
    const segBtns = {};
    const seg = el('div', { class: 'p-segmented ms-diff', role: 'group', 'aria-label': 'Zorluk' });
    for (const id of DIFFS) {
      segBtns[id] = el('button', { type: 'button', dataset: { d: id }, text: NAMES[id], 'aria-pressed': 'false' });
      seg.appendChild(segBtns[id]);
    }
    const statsBtn = el('button', { class: 'p-btn icon small ms-stats-btn', type: 'button', 'aria-label': 'İstatistikler' }, icon('star', 16));
    const toolbar = el('div', { class: 'p-toolbar ms-toolbar' }, menuBtn, seg, el('span', { class: 'spacer' }), statsBtn);

    const mineLed = createLed('mines', 'bomb', 'Kalan mayın');
    const timeLed = createLed('time', 'timer', 'Geçen süre');
    const face = el('button', { class: 'ms-face', type: 'button', 'aria-label': 'Yeni oyun' });
    const header = el('div', { class: 'ms-header' }, mineLed.el, face, timeLed.el);

    const board = el('div', { class: 'ms-board', role: 'grid', tabIndex: 0, 'aria-label': 'Mayın tarlası' });
    const frame = el('div', { class: 'ms-frame' }, board);
    const bannerHost = el('div', { class: 'ms-bannerhost', hidden: true });
    const stage = el('div', { class: 'ms-stage' }, frame, bannerHost);
    const main = el('div', { class: 'ms-main' }, header, stage);
    const scroll = el('div', { class: 'ms-scroll' }, main);

    const stState = el('span', { class: 'ms-st-state' });
    const stInfo = el('span', { class: 'ms-st-info' });
    const stBest = el('span', { class: 'ms-st-best' });
    const status = el('div', { class: 'p-statusbar ms-status' }, stState, el('span', { class: 'spacer' }), stInfo, stBest);

    const overlay = el('div', { class: 'ms-overlay', hidden: true });

    root.append(toolbar, scroll, status, overlay);

    tip(face, 'Yeni oyun\nF2');
    tip(statsBtn, 'İstatistikler');
    tip(menuBtn, 'Oyun menüsü');
    tip(mineLed.el, 'Kalan mayın');
    tip(timeLed.el, 'Geçen süre');
    for (const id of DIFFS) {
      tip(segBtns[id], () => {
        const c = configFor(id);
        return `${NAMES[id]}\n${c.width}×${c.height} · ${c.mines} mayın`;
      });
    }

    // ----------------------------------------------------------------------------- game state
    let cfg = configFor(state.difficulty);
    let brd = null;               // engine board
    let cellEls = [];
    let cursor = 0;
    let kb = false;               // keyboard cursor visible
    let over = false;
    let cs = MAX_CS;
    let faceKind = '';
    let drag = null;              // { mode: 'reveal' | 'chord', i }
    let rightDown = false;
    let menuOpen = false;
    let menuPressOnBtn = false;
    let panel = null;             // { name, close }
    const pressed = new Set();
    const clock = { started: false, acc: 0, t0: null, timer: 0, paused: new Set() };

    function configFor(id) {
      if (id === 'custom') return { id, width: state.custom.width, height: state.custom.height, mines: state.custom.mines };
      const p = PRESETS[id] || PRESETS.easy;
      return { id: p.id, width: p.width, height: p.height, mines: p.mines };
    }

    const ctl = {
      get board() { return brd; },
      get config() { return cfg; },
      get state() { return state; },
      get clock() { return clock; },
      get cellSize() { return cs; },
      get cursor() { return cursor; },
      get faceKind() { return faceKind; },
      get over() { return over; },
      get panel() { return panel ? panel.name : null; },
      engine: Engine,
      now: () => Date.now(),
      cell: (i) => cellEls[i],
      newGame, reveal: doReveal, flag: flagAt, chord: doChord,
      openStats, openCustom, openHelp, closePanel, fit: fitWindow, applyArgs,
      seconds: clockSeconds
    };
    win.state.ms = ctl;

    // ----------------------------------------------------------------------------- clock
    function clockMs() {
      return clock.acc + (clock.t0 != null ? ctl.now() - clock.t0 : 0);
    }
    function clockSeconds() {
      return Math.min(999, Math.floor(clockMs() / 1000));
    }
    function tick() {
      timeLed.set(clockSeconds());
    }
    function clockStart() {
      clock.started = true;
      clock.acc = 0;
      clock.t0 = clock.paused.size ? null : ctl.now();
      clearInterval(clock.timer);
      clock.timer = setInterval(tick, 250);
      tick();
    }
    function clockStop() {
      if (clock.t0 != null) { clock.acc += ctl.now() - clock.t0; clock.t0 = null; }
      clearInterval(clock.timer);
      clock.timer = 0;
    }
    function clockReset() {
      clockStop();
      clock.started = false;
      clock.acc = 0;
      timeLed.set(0);
    }
    function pauseClock(reason) {
      clock.paused.add(reason);
      if (clock.t0 != null) { clock.acc += ctl.now() - clock.t0; clock.t0 = null; }
    }
    function resumeClock(reason) {
      clock.paused.delete(reason);
      if (!clock.paused.size && clock.started && !over && clock.t0 == null) clock.t0 = ctl.now();
    }

    // ----------------------------------------------------------------------------- face
    function setFace(kind) {
      if (kind === faceKind) return;
      faceKind = kind;
      face.dataset.face = kind;
      face.innerHTML = faceSVG(kind);
    }
    function restFace() {
      setFace(brd && brd.status === 'won' ? 'cool' : brd && brd.status === 'lost' ? 'dead' : 'normal');
    }

    // ----------------------------------------------------------------------------- sound
    function sfxContext(fn) {
      try {
        if (!state.sound) return false;
        if (P.settings && P.settings.get('sounds') === false) return false;
        const c = P.sound && P.sound.context && P.sound.context();
        const out = P.sound && P.sound.master && P.sound.master();
        if (!c || !out) return false;
        const run = () => { try { fn(c, out, c.currentTime + 0.02); } catch (_) { /* audio is optional */ } };
        if (c.state === 'running') run();
        else if (navigator.userActivation && navigator.userActivation.hasBeenActive) {
          const p = c.resume();
          if (p && p.then) p.then(() => { if (c.state === 'running') run(); }).catch(() => {});
        }
        return true;
      } catch (_) { return false; }
    }
    function tone(c, out, type, freq, t, dur, gain, glideTo) {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    const sfx = {
      tick() {
        try { if (state.sound && P.sound && P.sound.play) P.sound.play('click'); } catch (_) { /* ignore */ }
      },
      win() {
        sfxContext((c, out, t) => {
          [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => {
            tone(c, out, 'triangle', f, t + k * 0.09, 0.5, 0.15);
            tone(c, out, 'sine', f * 2, t + k * 0.09, 0.36, 0.045);
          });
          tone(c, out, 'sine', 1567.98, t + 0.4, 0.8, 0.06);
        });
      },
      boom() {
        sfxContext((c, out, t) => {
          const len = Math.floor(c.sampleRate * 0.6);
          const buf = c.createBuffer(1, len, c.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
          const src = c.createBufferSource();
          src.buffer = buf;
          const lp = c.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(2000, t);
          lp.frequency.exponentialRampToValueAtTime(140, t + 0.55);
          const g = c.createGain();
          g.gain.setValueAtTime(0.5, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
          src.connect(lp);
          lp.connect(g);
          g.connect(out);
          src.start(t);
          src.stop(t + 0.65);
          tone(c, out, 'sine', 95, t, 0.4, 0.34, 34);
        });
      }
    };

    // ----------------------------------------------------------------------------- painting
    function cellLabel(i) {
      const x = i % brd.width;
      const y = (i / brd.width) | 0;
      return `${y + 1}. satır, ${x + 1}. sütun`;
    }

    function paintCell(i) {
      const node = cellEls[i];
      if (!node) return;
      const s = brd.state[i];
      const m = brd.mine[i];
      const a = brd.adj[i];
      const lost = brd.status === 'lost';
      let cls = 'ms-cell';
      let txt = '';
      let label;
      if (s === REVEALED) {
        cls += ' open';
        if (a) { cls += ' n' + a; txt = String(a); label = `${cellLabel(i)}: ${a}`; } else label = `${cellLabel(i)}: boş`;
      } else if (s === FLAG) {
        if (lost && !m) { cls += ' open wrong'; label = `${cellLabel(i)}: yanlış bayrak`; } else { cls += ' flag'; label = `${cellLabel(i)}: bayrak`; }
      } else if (lost && m) {
        cls += ' open mine';
        if (brd.exploded.indexOf(i) >= 0) cls += ' boom';
        label = `${cellLabel(i)}: mayın`;
      } else if (s === QUESTION) {
        cls += ' q';
        txt = '?';
        label = `${cellLabel(i)}: soru işareti`;
      } else {
        cls += ' hid';
        label = `${cellLabel(i)}: kapalı`;
      }
      if (i === cursor) cls += ' cursor';
      if (pressed.has(i)) cls += ' press';
      if (node.className !== cls) node.className = cls;
      if (node.textContent !== txt) node.textContent = txt;
      node.setAttribute('aria-label', label);
    }

    function paintAll() {
      for (let i = 0; i < brd.size; i++) paintCell(i);
    }

    function repaint(changed, depth) {
      const animated = [];
      for (let k = 0; k < changed.length; k++) {
        const i = changed[k];
        paintCell(i);
        if (depth && brd.state[i] === REVEALED) {
          const node = cellEls[i];
          node.classList.add('just');
          node.style.setProperty('--d', String(Math.min(depth[k], 14)));
          animated.push(node);
        }
      }
      if (animated.length) {
        later(() => {
          for (const node of animated) { node.classList.remove('just'); node.style.removeProperty('--d'); }
        }, 650);
      }
    }

    function setPressed(list) {
      const prev = Array.from(pressed);
      pressed.clear();
      for (const i of list) pressed.add(i);
      prev.forEach(paintCell);
      list.forEach(paintCell);
    }

    function setCursor(i) {
      if (i === cursor || !cellEls[i]) return;
      const old = cursor;
      cursor = i;
      if (cellEls[old]) paintCell(old);
      paintCell(i);
    }

    function setKb(on) {
      kb = !!on;
      root.classList.toggle('kb', kb);
    }

    function buildGrid() {
      board.textContent = '';
      board.style.setProperty('--cols', String(brd.width));
      board.style.setProperty('--rows', String(brd.height));
      board.setAttribute('aria-rowcount', String(brd.height));
      board.setAttribute('aria-colcount', String(brd.width));
      cellEls = new Array(brd.size);
      const frag = document.createDocumentFragment();
      for (let y = 0; y < brd.height; y++) {
        const row = document.createElement('div');
        row.className = 'ms-row';
        row.setAttribute('role', 'row');
        for (let x = 0; x < brd.width; x++) {
          const i = y * brd.width + x;
          const node = document.createElement('div');
          node.dataset.i = String(i);
          node.setAttribute('role', 'gridcell');
          cellEls[i] = node;
          row.appendChild(node);
        }
        frag.appendChild(row);
      }
      board.appendChild(frag);
      paintAll();
    }

    // ----------------------------------------------------------------------------- chrome sync
    function updateMines() {
      mineLed.set(Engine.remaining(brd));
    }

    function bestFor(id) {
      return id === 'custom' ? null : state.best[id];
    }

    function updateStatus() {
      const st = brd.status;
      const safe = brd.size - brd.mines;
      const pct = safe > 0 ? Math.floor((brd.revealed / safe) * 100) : 100;
      let text = 'Hazır';
      if (st === 'playing') text = `Oynanıyor · %${pct}`;
      else if (st === 'won') text = 'Kazandın!';
      else if (st === 'lost') text = 'Mayına bastın';
      stState.textContent = text;
      stState.dataset.status = st;
      stInfo.textContent = `${brd.width}×${brd.height} · ${brd.mines} mayın`;
      const best = bestFor(cfg.id);
      stBest.textContent = cfg.id === 'custom' ? '' : `En iyi: ${best != null ? best + ' sn' : '—'}`;
      board.dataset.status = st;
      board.classList.toggle('over', st === 'won' || st === 'lost');
      board.classList.toggle('won', st === 'won');
      board.classList.toggle('lost', st === 'lost');
      frame.classList.toggle('won', st === 'won');
      frame.classList.toggle('lost', st === 'lost');
      root.dataset.status = st;
    }

    function syncDifficulty() {
      for (const id of DIFFS) {
        const on = id === cfg.id;
        segBtns[id].classList.toggle('active', on);
        segBtns[id].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    // ----------------------------------------------------------------------------- window fitting
    function workArea() {
      try {
        if (P.wm && typeof P.wm.workArea === 'function') return P.wm.workArea();
      } catch (_) { /* fall back */ }
      return { x: 0, y: 0, width: window.innerWidth, height: Math.max(300, window.innerHeight - 48) };
    }

    function ensureVisible() {
      const wa = workArea();
      const b = win.getBounds();
      const x = clamp(b.x, 0, Math.max(0, wa.width - b.width));
      const y = clamp(b.y, 0, Math.max(0, wa.height - b.height));
      if (x !== b.x || y !== b.y) win.setPosition(x, y);
    }

    /** Picks the cell size so the whole board fits the work area, then sizes the window to the board. */
    function fitWindow(center) {
      if (disposed || win.isClosed() || !brd) return;
      const wa = workArea();
      const chromeW = win.el.offsetWidth - root.clientWidth;
      const chromeH = win.el.offsetHeight - root.clientHeight;
      const fixedH = toolbar.offsetHeight + status.offsetHeight;
      const mcs = getComputedStyle(main);
      const mainPadX = parseFloat(mcs.paddingLeft) + parseFloat(mcs.paddingRight);
      const mainPadY = parseFloat(mcs.paddingTop) + parseFloat(mcs.paddingBottom);
      const mainGap = parseFloat(mcs.rowGap) || 0;
      const frameX = frame.offsetWidth - board.offsetWidth;
      const frameY = frame.offsetHeight - board.offsetHeight;
      const availW = wa.width - chromeW - mainPadX - frameX;
      const availH = wa.height - chromeH - fixedH - mainPadY - mainGap - header.offsetHeight - frameY;
      const byW = (availW - (brd.width - 1) * GAP) / brd.width;
      const byH = (availH - (brd.height - 1) * GAP) / brd.height;
      cs = clamp(Math.floor(Math.min(byW, byH)), MIN_CS, MAX_CS);
      root.style.setProperty('--ms-cs', cs + 'px');
      const w = Math.max(MIN_WIN_W, main.offsetWidth + chromeW);
      const h = Math.max(MIN_WIN_H, main.offsetHeight + fixedH + chromeH);
      const old = win.getBounds();
      win.setSize(w, h);
      if (center) {
        win.center();
      } else {
        // grow / shrink around the window centre so switching difficulty does not push it off screen
        const now = win.getBounds();
        win.setPosition(Math.round(old.x + (old.width - now.width) / 2), Math.round(old.y + (old.height - now.height) / 2));
        ensureVisible();
      }
    }

    // ----------------------------------------------------------------------------- game flow
    function newGame(opts) {
      opts = opts || {};
      closeBanner();
      clockReset();
      drag = null;
      pressed.clear();
      if (opts.board) {
        brd = opts.board;
        cfg = { id: opts.id && DIFFS.includes(opts.id) ? opts.id : 'custom', width: brd.width, height: brd.height, mines: brd.mines };
      } else {
        cfg = configFor(state.difficulty);
        brd = createBoard(cfg.width, cfg.height, cfg.mines, opts.seed);
      }
      over = false;
      cursor = Math.floor((brd.height - 1) / 2) * brd.width + Math.floor((brd.width - 1) / 2);
      board.classList.remove('shake');
      frame.classList.remove('shake');
      buildGrid();
      setFace('normal');
      syncDifficulty();
      updateMines();
      updateStatus();
      fitWindow(!!opts.center);
    }

    function selectDifficulty(id) {
      if (id === 'custom') { openCustom(); return; }
      if (!PRESETS[id]) return;
      state.difficulty = id;
      saveState(state);
      newGame();
    }

    function doReveal(i) {
      if (over || !brd) return false;
      if (brd.state[i] === REVEALED) return doChord(i);
      return afterMove(Engine.reveal(brd, i), i);
    }

    function doChord(i) {
      if (over || !brd) return false;
      return afterMove(Engine.chord(brd, i), i);
    }

    function flagAt(i) {
      if (over || !brd) return false;
      const r = Engine.toggleFlag(brd, i, state.questionMarks);
      if (!r.changed.length) return false;
      repaint(r.changed);
      updateMines();
      sfx.tick();
      return true;
    }

    function afterMove(r, i) {
      if (!r.changed.length && !r.lost && !r.won) return false;
      if (r.started) clockStart();
      setCursor(i);
      if (r.lost || r.won) {
        over = true;
        clockStop();
        finish(r);
      } else {
        repaint(r.changed, r.depth);
        sfx.tick();
      }
      updateMines();
      updateStatus();
      return true;
    }

    function recordResult(won, secs) {
      const id = cfg.id;
      const st = state.stats[id] || (state.stats[id] = blankStat());
      st.played++;
      let record = false;
      let prevBest = null;
      if (won) {
        st.won++;
        st.streak++;
        st.bestStreak = Math.max(st.bestStreak, st.streak);
        st.totalTime += secs;
        if (id !== 'custom') {
          prevBest = state.best[id];
          if (prevBest == null || secs < prevBest) { state.best[id] = secs; record = true; }
          const recs = state.records[id];
          recs.push({ t: secs, at: Date.now() });
          recs.sort((a, b) => a.t - b.t || a.at - b.at);
          recs.length = Math.min(recs.length, 5);
        }
      } else {
        st.streak = 0;
      }
      saveState(state);
      return { record, prevBest };
    }

    function finish(r) {
      const won = !!r.won;
      let secs = clockSeconds();
      if (won) secs = Math.max(1, secs);
      timeLed.set(secs);
      paintAll();
      if (won) {
        // the flags do a little wave from the top-left corner
        for (let k = 0; k < brd.size; k++) {
          if (brd.mine[k]) cellEls[k].style.setProperty('--d', String(Math.min(14, Math.floor(((k % brd.width) + ((k / brd.width) | 0)) / 2))));
        }
      }
      setFace(won ? 'cool' : 'dead');
      const res = recordResult(won, secs);
      if (won) {
        sfx.win();
        showBanner({ kind: 'win', secs, record: res.record, prevBest: res.prevBest });
      } else {
        shake();
        sfx.boom();
        showBanner({ kind: 'lose', secs });
      }
    }

    function shake() {
      frame.classList.remove('shake');
      void frame.offsetWidth;
      frame.classList.add('shake');
      later(() => frame.classList.remove('shake'), 520);
    }

    // ----------------------------------------------------------------------------- banner
    function closeBanner() {
      bannerHost.hidden = true;
      bannerHost.textContent = '';
    }

    function showBanner(info) {
      const won = info.kind === 'win';
      const safe = brd.size - brd.mines;
      const pct = safe > 0 ? Math.floor((brd.revealed / safe) * 100) : 100;
      const title = won ? `Kazandın! ${fmtInt(info.secs)} saniye` : 'Mayına bastın!';
      const sub = won
        ? (info.record
          ? (info.prevBest != null ? `Önceki rekor: ${fmtInt(info.prevBest)} saniye` : 'İlk zaferin, tebrikler!')
          : (bestFor(cfg.id) != null ? `En iyi süre: ${fmtInt(bestFor(cfg.id))} saniye` : 'Tebrikler!'))
        : `%${pct} tamamlandı · ${fmtInt(info.secs)} saniye`;
      const faceBox = el('div', { class: 'ms-banner-face', html: faceSVG(won ? 'cool' : 'dead') });
      const text = el('div', { class: 'ms-banner-text' },
        el('div', { class: 'ms-banner-title', text: title }),
        el('div', { class: 'ms-banner-sub', text: sub }),
        won && info.record ? el('span', { class: 'p-badge ms-record' }, icon('star', 12), 'Yeni rekor!') : null);
      const again = el('button', { class: 'p-btn primary small ms-banner-new', type: 'button', text: won ? 'Yeni Oyun' : 'Tekrar Dene', on: { click: () => { newGame(); focusBoard(); } } });
      const stats = el('button', { class: 'p-btn small ms-banner-stats', type: 'button', text: 'İstatistikler', on: { click: () => openStats() } });
      const close = el('button', { class: 'p-btn icon small ms-banner-close', type: 'button', 'aria-label': 'Kapat', on: { click: () => { closeBanner(); focusBoard(); } } }, icon('x', 14));
      const card = el('div', { class: 'ms-banner ' + info.kind, role: 'status' },
        close,
        el('div', { class: 'ms-banner-top' }, faceBox, text),
        el('div', { class: 'ms-banner-actions' }, again, stats));
      bannerHost.textContent = '';
      bannerHost.appendChild(card);
      bannerHost.hidden = false;
    }

    // ----------------------------------------------------------------------------- pointer input
    function cellOf(target) {
      const node = target && target.closest ? target.closest('.ms-cell') : null;
      return node && board.contains(node) ? Number(node.dataset.i) : -1;
    }

    function pressList(mode, i) {
      if (i < 0 || over) return [];
      if (mode === 'chord') {
        const list = [];
        const s = brd.state[i];
        if (s === HIDDEN || s === QUESTION) list.push(i);
        for (const n of Engine.neighbors(brd, i)) {
          const t = brd.state[n];
          if (t === HIDDEN || t === QUESTION) list.push(n);
        }
        return list;
      }
      const s = brd.state[i];
      return s === HIDDEN || s === QUESTION ? [i] : [];
    }

    function startDrag(mode, i) {
      drag = { mode, i };
      setPressed(pressList(mode, i));
      setFace('oh');
    }

    function endDrag() {
      drag = null;
      setPressed([]);
      restFace();
    }

    function focusBoard() {
      try { board.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }

    function onMouseDown(e) {
      const i = cellOf(e.target);
      if (i < 0) return;
      e.preventDefault();
      if (panel) return;
      focusBoard();
      setKb(false);
      setCursor(i);
      if (over) return;
      const bit = e.button === 2 ? 2 : e.button === 1 ? 4 : 1;
      const btns = (e.buttons || 0) | bit;
      if (e.button === 1 || (btns & 3) === 3) { startDrag('chord', i); return; }
      if (e.button === 2 || (e.button === 0 && e.ctrlKey)) { rightDown = true; flagAt(i); return; }
      if (e.button !== 0) return;
      if (e.shiftKey) { startDrag('chord', i); return; }
      startDrag(brd.state[i] === REVEALED ? 'chord' : 'reveal', i);
    }

    function onMouseMove(e) {
      if (!drag) return;
      if (e.isTrusted && e.buttons === 0) { endDrag(); return; }
      const i = cellOf(e.target);
      if (i === drag.i) return;
      drag.i = i;
      setPressed(pressList(drag.mode, i));
    }

    function onMouseUp(e) {
      if (e.button === 2) later(() => { rightDown = false; }, 200);
      if (!drag) return;
      const d = drag;
      const i = board.contains(e.target) ? cellOf(e.target) : -1;
      endDrag();
      if (i < 0 || over) return;
      if (d.mode === 'chord') doChord(i); else doReveal(i);
    }

    listen(board, 'mousedown', onMouseDown);
    listen(board, 'mousemove', onMouseMove);
    listen(board, 'mouseleave', () => { if (drag) setPressed([]); });
    listen(document, 'mouseup', onMouseUp, true);
    listen(board, 'dragstart', (e) => e.preventDefault());
    listen(board, 'contextmenu', (e) => {
      e.preventDefault();
      const i = cellOf(e.target);
      if (i < 0) return;
      if (rightDown) { rightDown = false; return; }
      // no right-button press came first (long press on a touch screen): treat it as "flag"
      setKb(false);
      setCursor(i);
      flagAt(i);
    });
    // the keyboard cursor appears when the board is reached with Tab (never for programmatic focus or the mouse)
    let tabbing = false;
    listen(root, 'keydown', (e) => { tabbing = e.key === 'Tab'; }, true);
    listen(root, 'mousedown', () => { tabbing = false; }, true);
    listen(board, 'focus', () => {
      if (tabbing) setKb(true);
      tabbing = false;
    });
    listen(board, 'blur', () => setKb(false));

    // ----------------------------------------------------------------------------- keyboard
    function moveCursor(dx, dy) {
      const w = brd.width;
      const x = clamp((cursor % w) + dx, 0, w - 1);
      const y = clamp(((cursor / w) | 0) + dy, 0, brd.height - 1);
      setCursor(y * w + x);
    }

    function onKey(e) {
      if (disposed) return;
      const t = e.target;
      if (U.isEditable(t)) return;
      const k = e.key;
      if (k === 'Escape') {
        if (panel) { e.preventDefault(); closePanel(); return; }
        if (!bannerHost.hidden) { e.preventDefault(); closeBanner(); focusBoard(); }
        return;
      }
      if (panel) return;
      if (k === 'F2') { e.preventDefault(); newGame(); focusBoard(); return; }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const onButton = !!(t && t.tagName === 'BUTTON');
      const nav = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      const isAct = k === ' ' || k === 'Enter' || k === 'f' || k === 'F';
      if (!nav && !isAct && k !== 'Home' && k !== 'End') return;
      if (isAct && onButton && (k === ' ' || k === 'Enter')) return; // let the focused button handle its own activation
      e.preventDefault();
      if (!kb) { setKb(true); paintCell(cursor); return; }  // the first key press only shows where the cursor is
      if (nav) { moveCursor(nav[0], nav[1]); return; }
      if (k === 'Home') { setCursor(Math.floor(cursor / brd.width) * brd.width); return; }
      if (k === 'End') { setCursor(Math.floor(cursor / brd.width) * brd.width + brd.width - 1); return; }
      if (over) return;
      if (k === 'f' || k === 'F') { flagAt(cursor); return; }
      doReveal(cursor);
    }
    disposers.push(win.on('keydown', onKey));

    // ----------------------------------------------------------------------------- toolbar, menu
    function menuItems() {
      const preset = (id) => {
        const p = PRESETS[id];
        return { label: `${p.name} — ${p.width}×${p.height}, ${p.mines} mayın`, checked: cfg.id === id, action: () => selectDifficulty(id) };
      };
      return [
        { label: 'Yeni Oyun', icon: 'refresh', shortcut: 'F2', action: () => { newGame(); focusBoard(); } },
        { type: 'separator' },
        preset('easy'), preset('medium'), preset('hard'),
        { label: cfg.id === 'custom' ? `Özel — ${cfg.width}×${cfg.height}, ${cfg.mines} mayın…` : 'Özel…', checked: cfg.id === 'custom', action: () => openCustom() },
        { type: 'separator' },
        { label: 'Soru işaretleri (?)', checked: state.questionMarks, action: () => { state.questionMarks = !state.questionMarks; saveState(state); } },
        { label: 'Oyun sesleri', checked: state.sound, action: () => { state.sound = !state.sound; saveState(state); } },
        { type: 'separator' },
        { label: 'İstatistikler', icon: 'star', action: () => openStats() },
        { label: 'Nasıl oynanır?', icon: 'info-glyph', action: () => openHelp() }
      ];
    }

    function showMenu(x, y) {
      if (!P.contextMenu || typeof P.contextMenu.show !== 'function') return;
      menuOpen = true;
      menuBtn.setAttribute('aria-expanded', 'true');
      P.contextMenu.show(x, y, menuItems(), { onClose: () => { menuOpen = false; menuBtn.setAttribute('aria-expanded', 'false'); } });
    }

    const keepFocus = (e) => e.preventDefault();
    [menuBtn, statsBtn, face].forEach((b) => listen(b, 'mousedown', keepFocus));
    // the open menu closes itself on any outside press (capture phase, registered after this one); remember that the press
    // landed on its own button so the click that follows closes the menu instead of reopening it
    listen(document, 'pointerdown', (e) => {
      menuPressOnBtn = menuBtn.contains(e.target) && !!(P.contextMenu && P.contextMenu.isOpen && P.contextMenu.isOpen());
    }, true);
    listen(menuBtn, 'click', () => {
      if (menuPressOnBtn) { menuPressOnBtn = false; return; }
      const r = menuBtn.getBoundingClientRect();
      showMenu(r.left, r.bottom + 4);
    });
    listen(statsBtn, 'click', () => openStats());
    listen(face, 'click', () => { newGame(); focusBoard(); });
    for (const id of DIFFS) listen(segBtns[id], 'click', () => selectDifficulty(id));
    listen(main, 'contextmenu', (e) => {
      if (board.contains(e.target)) return;
      e.preventDefault();
      showMenu(e.clientX, e.clientY);
    });

    // ----------------------------------------------------------------------------- panels (statistics, custom game, help)
    const inertTargets = [toolbar, scroll, status];

    function focusables(node) {
      return Array.from(node.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((n) => !n.disabled && n.offsetParent !== null);
    }

    function openPanel(name, title, content, footer, opts) {
      closePanel(true);
      opts = opts || {};
      const closeBtn = el('button', { class: 'p-btn icon small ms-panel-close', type: 'button', 'aria-label': 'Kapat', on: { click: () => closePanel() } }, icon('x', 16));
      const card = el('div', { class: 'ms-panel ms-panel-' + name, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabIndex: -1 },
        el('div', { class: 'ms-panel-head' }, el('h2', { class: 'ms-panel-title', text: title }), closeBtn),
        el('div', { class: 'ms-panel-body' }, content),
        footer ? el('div', { class: 'ms-panel-foot' }, footer) : null);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
        if (e.key !== 'Tab') return;
        const list = focusables(card);
        if (!list.length) { e.preventDefault(); return; }
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      overlay.textContent = '';
      overlay.appendChild(card);
      overlay.hidden = false;
      inertTargets.forEach((n) => { n.inert = true; });
      pauseClock('panel');
      const onBackdrop = (e) => { if (e.target === overlay) closePanel(); };
      overlay.addEventListener('mousedown', onBackdrop);
      panel = {
        name,
        card,
        close(quiet) {
          overlay.removeEventListener('mousedown', onBackdrop);
          overlay.hidden = true;
          overlay.textContent = '';
          inertTargets.forEach((n) => { n.inert = false; });
          resumeClock('panel');
          panel = null;
          if (!quiet && !disposed) later(focusBoard, 0);
        }
      };
      later(() => {
        const target = opts.focus ? opts.focus() : null;
        const first = target || card.querySelector('.ms-panel-foot .primary') || closeBtn;
        try { first.focus({ preventScroll: true }); if (first.select && first.tagName === 'INPUT') first.select(); } catch (_) { /* ignore */ }
      }, 0);
      return panel;
    }

    function closePanel(quiet) {
      if (panel) panel.close(quiet === true);
    }

    function openHelp() {
      const row = (key, text) => el('div', { class: 'ms-help-row' }, el('span', { class: 'ms-help-key', text: key }), el('span', { class: 'ms-help-text', text }));
      const body = el('div', { class: 'ms-help' },
        el('p', { class: 'ms-help-lead', text: 'Mayın olmayan tüm kareleri aç. Bir sayı, o karenin çevresindeki mayın sayısını gösterir. İlk tıklama her zaman güvenlidir.' }),
        row('Sol tık', 'Kareyi açar; boş alanlar kendiliğinden genişler.'),
        row('Sağ tık', 'Bayrak koyar. Soru işaretleri açıksa bir tık daha ? yapar.'),
        row('Sayıya tık', 'Çevresindeki bayrak sayısı sayıya eşitse kalan komşuları açar (sol+sağ ya da orta tık da çalışır).'),
        row('Ok tuşları', 'Klavye imlecini taşır; Boşluk veya Enter açar, F bayrak koyar.'),
        row('F2', 'Yeni oyun başlatır.'));
      const done = el('button', { class: 'p-btn primary', type: 'button', text: 'Anladım', on: { click: () => closePanel() } });
      openPanel('help', 'Nasıl oynanır?', body, done);
    }

    function openCustom() {
      const init = cfg.id === 'custom' ? { width: cfg.width, height: cfg.height, mines: cfg.mines } : state.custom;
      const fields = {};
      const errs = {};
      const mk = (key, label, hint) => {
        const id = 'ms-f-' + key + '-' + win.id;
        const input = el('input', { class: 'p-input ms-num', type: 'number', inputmode: 'numeric', step: '1', id, value: String(init[key]), dataset: { field: key } });
        const err = el('div', { class: 'ms-err', 'aria-live': 'polite' });
        fields[key] = input;
        errs[key] = err;
        return el('div', { class: 'ms-field' },
          el('label', { for: id, text: label }),
          input,
          el('span', { class: 'ms-hint', text: hint }),
          err);
      };
      const summary = el('div', { class: 'ms-summary' });
      const form = el('form', { class: 'ms-form', novalidate: true },
        mk('width', 'Genişlik', `${LIMITS.minW}–${LIMITS.maxW}`),
        mk('height', 'Yükseklik', `${LIMITS.minH}–${LIMITS.maxH}`),
        mk('mines', 'Mayın', '1+'),
        summary);
      const read = () => ({
        width: fields.width.value.trim() === '' ? NaN : Number(fields.width.value),
        height: fields.height.value.trim() === '' ? NaN : Number(fields.height.value),
        mines: fields.mines.value.trim() === '' ? NaN : Number(fields.mines.value)
      });
      const check = () => {
        const v = read();
        const r = validate(v.width, v.height, v.mines);
        for (const key of ['width', 'height', 'mines']) {
          const msg = r.errors[key] || '';
          errs[key].textContent = msg;
          fields[key].classList.toggle('invalid', !!msg);
          fields[key].setAttribute('aria-invalid', msg ? 'true' : 'false');
        }
        if (r.ok) {
          const total = v.width * v.height;
          summary.textContent = `${fmtInt(total)} kare · yoğunluk %${Math.round((v.mines / total) * 100)}`;
        } else {
          summary.textContent = 'Değerleri düzeltince oyun başlatılabilir.';
        }
        return { ok: r.ok, v };
      };
      const submit = () => {
        const r = check();
        if (!r.ok) {
          const bad = ['width', 'height', 'mines'].find((k) => fields[k].classList.contains('invalid'));
          if (bad) fields[bad].focus();
          return false;
        }
        state.custom = { width: r.v.width, height: r.v.height, mines: r.v.mines };
        state.difficulty = 'custom';
        saveState(state);
        closePanel(true);
        newGame();
        focusBoard();
        return true;
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      form.addEventListener('input', check);
      const cancel = el('button', { class: 'p-btn', type: 'button', text: 'İptal', on: { click: () => closePanel() } });
      const start = el('button', { class: 'p-btn primary ms-custom-start', type: 'button', text: 'Başlat', on: { click: submit } });
      openPanel('custom', 'Özel oyun', form, [cancel, start], { focus: () => fields.width });
      check();
      ctl.customForm = { fields, errs, submit, check };
    }

    function openStats(tabId) {
      let tab = tabId && DIFFS.includes(tabId) ? tabId : cfg.id;
      const tabsEl = el('div', { class: 'p-tabs ms-tabs', role: 'tablist' });
      const tabBtns = {};
      for (const id of DIFFS) {
        tabBtns[id] = el('button', { class: 'p-tab', type: 'button', role: 'tab', dataset: { d: id }, text: NAMES[id], on: { click: () => { tab = id; render(); } } });
        tabsEl.appendChild(tabBtns[id]);
      }
      const grid = el('div', { class: 'ms-stat-grid' });
      const listWrap = el('div', { class: 'ms-top-wrap' });
      const body = el('div', { class: 'ms-stats' }, tabsEl, grid, listWrap);

      function card(label, value, sub) {
        return el('div', { class: 'ms-stat' },
          el('div', { class: 'ms-stat-label', text: label }),
          el('div', { class: 'ms-stat-value' }, el('span', { class: 'ms-stat-num', text: value }), sub ? el('span', { class: 'ms-stat-sub', text: sub }) : null));
      }

      function render() {
        for (const id of DIFFS) {
          tabBtns[id].classList.toggle('active', id === tab);
          tabBtns[id].setAttribute('aria-selected', id === tab ? 'true' : 'false');
        }
        const st = state.stats[tab] || blankStat();
        const best = tab === 'custom' ? null : state.best[tab];
        const rate = st.played ? `%${Math.round((st.won / st.played) * 100)}` : '—';
        const avg = st.won && st.totalTime ? `${fmtInt(Math.round(st.totalTime / st.won))} sn` : '—';
        grid.textContent = '';
        grid.append(
          card('Oynanan', fmtInt(st.played)),
          card('Kazanılan', fmtInt(st.won)),
          card('Başarı', rate),
          card('En iyi süre', best != null ? `${fmtInt(best)} sn` : '—'),
          card('Ortalama', avg),
          card('Seri', fmtInt(st.streak), `en uzun ${fmtInt(st.bestStreak)}`));
        listWrap.textContent = '';
        listWrap.appendChild(el('div', { class: 'ms-top-title', text: 'En iyi 5 süre' }));
        const recs = tab === 'custom' ? [] : state.records[tab];
        if (tab === 'custom') {
          listWrap.appendChild(el('div', { class: 'ms-top-empty', text: 'Özel oyunlarda rekor tutulmaz.' }));
        } else if (!recs.length) {
          listWrap.appendChild(el('div', { class: 'ms-top-empty', text: 'Henüz kazanılmış oyun yok.' }));
        } else {
          const ol = el('ol', { class: 'ms-top' });
          recs.forEach((r, k) => {
            ol.appendChild(el('li', { class: 'ms-top-item' },
              el('span', { class: 'ms-rank', text: String(k + 1) }),
              el('span', { class: 'ms-top-time', text: `${fmtInt(r.t)} saniye` }),
              el('span', { class: 'ms-top-date', text: U.formatDate(r.at, { day: 'numeric', month: 'short' }) })));
          });
          listWrap.appendChild(ol);
        }
      }

      const reset = el('button', {
        class: 'p-btn ghost ms-reset', type: 'button', text: 'Sıfırla',
        on: {
          click: async () => {
            let ok = false;
            try {
              ok = await P.dialog.confirm({
                title: 'İstatistikleri sıfırla',
                message: 'Tüm zorluk seviyelerindeki istatistikler ve rekorlar silinecek. Bu işlem geri alınamaz.',
                okText: 'Sıfırla',
                danger: true
              });
            } catch (e) { console.error('[minesweeper] onay penceresi açılamadı', e); }
            if (!ok || disposed) return;
            const fresh = defaultState();
            state.stats = fresh.stats;
            state.best = fresh.best;
            state.records = fresh.records;
            saveState(state);
            updateStatus();
            if (panel && panel.name === 'stats') render();
            try { P.notify && P.notify({ title: 'Mayın Tarlası', message: 'İstatistikler sıfırlandı.', icon: 'minesweeper', timeout: 3000 }); } catch (_) { /* ignore */ }
          }
        }
      });
      const close = el('button', { class: 'p-btn primary ms-stats-close', type: 'button', text: 'Kapat', on: { click: () => closePanel() } });
      render();
      openPanel('stats', 'İstatistikler', body, [reset, el('span', { class: 'spacer' }), close]);
    }

    // ----------------------------------------------------------------------------- args, lifecycle
    function applyArgs(a) {
      if (!a || typeof a !== 'object' || !Object.keys(a).length) return false;
      closePanel(true);
      const opts = {};
      if (a.seed != null) opts.seed = a.seed;
      if (a.width != null || a.height != null || a.mines != null) {
        const c = {
          width: Number(a.width != null ? a.width : state.custom.width),
          height: Number(a.height != null ? a.height : state.custom.height),
          mines: Number(a.mines != null ? a.mines : state.custom.mines)
        };
        if (validate(c.width, c.height, c.mines).ok) {
          state.custom = c;
          state.difficulty = 'custom';
          saveState(state);
        }
      } else if (a.difficulty && PRESETS[a.difficulty]) {
        state.difficulty = a.difficulty;
        saveState(state);
      } else if (a.seed == null) {
        return false;
      }
      newGame(opts);
      return true;
    }

    listen(window, 'resize', U.debounce(() => { if (!disposed) fitWindow(); }, 120));
    disposers.push(win.on('minimize', () => pauseClock('minimized')));
    disposers.push(win.on('restore', () => resumeClock('minimized')));
    disposers.push(win.on('blur', () => { if (drag) endDrag(); }));

    win.on('close', () => {
      disposed = true;
      clearInterval(clock.timer);
      clock.timer = 0;
      timeouts.forEach((id) => clearTimeout(id));
      timeouts.clear();
      if (panel) { try { panel.close(true); } catch (_) { /* ignore */ } }
      disposers.splice(0).forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
      try { if (P.ui && P.ui.tip && P.ui.tip.hide) P.ui.tip.hide(); } catch (_) { /* ignore */ }
      try { if (menuOpen && P.contextMenu) P.contextMenu.hide(); } catch (_) { /* ignore */ }
    });

    if (!applyArgs(args)) newGame();
    fitWindow(true);
    focusBoard();
  }

  P.apps.register({
    id: 'minesweeper',
    name: 'Mayın Tarlası',
    icon: 'minesweeper',
    description: 'Klasik mayın tarlası bulmacası',
    category: 'games',
    fileTypes: [],
    singleInstance: true,
    window: { width: 340, height: 480, minWidth: 300, minHeight: 300, resizable: false, maximizable: false },
    launch,
    relaunch(win, args) {
      const ms = win && win.state && win.state.ms;
      if (ms && ms.applyArgs) ms.applyArgs(args);
    },
    _engine: Engine
  });
})();
