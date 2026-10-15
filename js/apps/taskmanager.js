/* PandaOS — Görev Yöneticisi (taskmanager)
   Windows 11 Görev Yöneticisi'nden esinlenen, tek örnekli sistem izleyici:
   İşlemler (uygulama grupları + sistem), Performans (60 sn'lik canlı grafikler), Uygulama geçmişi ve Ayrıntılar.
   Değerler gerçek pencere listesinden (PandaOS.wm) türetilir; CPU / bellek / disk / ağ rakamları pencere başına
   düzgün bir rastgele yürüyüşle benzetilir. Kalıcı durum: PandaOS.storage 'app.taskmanager'. */
(function () {
  'use strict';

  const P = window.PandaOS;
  if (!P) return;
  const U = P.util;
  const el = U.el;
  const clamp = U.clamp;

  const APP_ID = 'taskmanager';
  const STORE_KEY = 'app.taskmanager';

  // ---------------------------------------------------------------- constants
  const TOTAL_MEM_MB = 8192;        // simulated machine memory
  const OTHER_MEM_MB = 2260;        // everything "outside" PandaOS the fake machine is running
  const HISTORY_MS = 60000;         // length of every chart
  const GRID_MS = 6000;             // vertical grid spacing (scrolls with the data)
  const KEEP_MS = HISTORY_MS + 6000;
  const BASE_GHZ = 3.2;
  const MIN_RENDER_GAP = 50;
  const PAGES = ['processes', 'performance', 'history', 'details'];
  const NAV = [
    { id: 'processes', label: 'İşlemler', icon: 'grid' },
    { id: 'performance', label: 'Performans', icon: 'cpu' },
    { id: 'history', label: 'Uygulama geçmişi', icon: 'time' },
    { id: 'details', label: 'Ayrıntılar', icon: 'list' }
  ];
  const RES = [
    { id: 'cpu', label: 'CPU', icon: 'cpu' },
    { id: 'mem', label: 'Bellek', icon: 'memory' },
    { id: 'disk', label: 'Disk', icon: 'disk', note: 'localStorage' },
    { id: 'net', label: 'Ağ', icon: 'net', note: 'Wi-Fi' }
  ];
  const SPEEDS = {
    high: { label: 'Yüksek', hint: '0,5 sn', ms: 500 },
    normal: { label: 'Normal', hint: '1 sn', ms: 1000 },
    low: { label: 'Düşük', hint: '4 sn', ms: 4000 },
    paused: { label: 'Duraklatıldı', hint: '', ms: 0 }
  };

  // Simulated per-app behaviour: idle CPU %, extra CPU % at full activity, resident MB, idle disk MB/s, disk burst MB/s.
  const PROFILES = {
    files: { cpu: 0.7, burst: 9, mem: 82, disk: 0.12, dburst: 2.6 },
    terminal: { cpu: 0.4, burst: 6, mem: 54, disk: 0.04, dburst: 0.6 },
    notepad: { cpu: 0.25, burst: 4, mem: 38, disk: 0.02, dburst: 0.9 },
    calculator: { cpu: 0.12, burst: 3, mem: 31, disk: 0, dburst: 0 },
    music: { cpu: 1.6, burst: 4, mem: 104, disk: 0.08, dburst: 0.6, play: 9, playDisk: 0.45 },
    minesweeper: { cpu: 2.4, burst: 8, mem: 47, disk: 0, dburst: 0.1 },
    game2048: { cpu: 2.1, burst: 8, mem: 51, disk: 0, dburst: 0.1 },
    settings: { cpu: 0.35, burst: 6, mem: 68, disk: 0.05, dburst: 0.5 },
    paint: { cpu: 2.6, burst: 26, mem: 146, disk: 0.3, dburst: 3.4 },
    taskmanager: { cpu: 0.9, burst: 3, mem: 58, disk: 0.02, dburst: 0.2 },
    clock: { cpu: 0.7, burst: 2, mem: 43, disk: 0, dburst: 0 },
    default: { cpu: 0.5, burst: 5, mem: 48, disk: 0.03, dburst: 0.4 }
  };

  const SYSTEM = [
    { id: 'kernel', name: 'PandaOS Çekirdeği', icon: 'panda' },
    { id: 'wm', name: 'Pencere Yöneticisi', icon: 'window' },
    { id: 'desktop', name: 'Masaüstü', icon: 'desktop' },
    { id: 'taskbar', name: 'Görev çubuğu', icon: 'taskbar' }
  ];

  // ---------------------------------------------------------------- formatting (tr-TR)
  const nf = (a, b) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: a, maximumFractionDigits: b });
  const NF0 = nf(0, 0);
  const NF1 = nf(1, 1);
  const NF2 = nf(2, 2);
  const fmtPct = (v) => (v < 0.05 ? '%0' : v >= 99.95 ? '%100' : '%' + NF1.format(v));
  const fmtPct0 = (v) => '%' + NF0.format(Math.round(v));
  const fmtMB = (v) => (v >= 1024 ? NF1.format(v / 1024) + ' GB' : NF1.format(v) + ' MB');
  const fmtGB = (mb) => NF1.format(mb / 1024) + ' GB';
  const fmtRate = (v) => (v < 0.05 ? '0 MB/sn' : NF1.format(v) + ' MB/sn');
  const fmtKBs = (kb) => (kb >= 1000 ? NF1.format(kb / 1024) + ' MB/sn' : NF1.format(kb) + ' KB/sn');
  const p2 = (n) => String(n).padStart(2, '0');

  function fmtClock(ms) {
    let s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return (d ? d + ':' : '') + p2(h) + ':' + p2(m) + ':' + p2(s);
  }

  function fmtDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + ' sn';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' dk ' + p2(s % 60) + ' sn';
    const h = Math.floor(m / 60);
    return h + ' sa ' + p2(m % 60) + ' dk';
  }

  const ghzOf = (cpu) => BASE_GHZ + (Math.max(0, cpu - 10) / 90) * 1.2;
  const lower = (s) => String(s == null ? '' : s).toLocaleLowerCase('tr');
  const pidOf = (win) => 1000 + (parseInt(String(win.id).replace(/\D+/g, ''), 10) || 0) * 4;

  function niceMax(v, floor) {
    v = Math.max(v * 1.15, floor);
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  // ---------------------------------------------------------------- icons
  const SVG_ATTR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const OWN = {
    disk: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    net: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9z"/>',
    window: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9.5h18"/><path d="M6.5 7h.01M9.5 7h.01"/>',
    taskbar: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 15h18"/><path d="M8 17.5h.01M12 17.5h.01M16 17.5h.01"/>',
    'chevron-right': '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
    'sort-up': '<path d="M6 14.5l6-6 6 6"/>',
    'sort-down': '<path d="M6 9.5l6 6 6-6"/>'
  };

  function icon(name, size, cls) {
    size = size || 16;
    try {
      if (OWN[name]) {
        return el('span', {
          class: 'p-icon' + (cls ? ' ' + cls : ''),
          html: `<svg ${SVG_ATTR} width="${size}" height="${size}">${OWN[name]}</svg>`
        });
      }
      if (P.icons && typeof P.icons.el === 'function') return P.icons.el(name, { size, className: cls });
    } catch (e) { /* fall through */ }
    return el('span', { class: 'p-icon' + (cls ? ' ' + cls : '') });
  }

  // ---------------------------------------------------------------- small DOM helpers
  const setText = (node, v) => { if (node._v !== v) { node._v = v; node.textContent = v; } };
  const setCls = (node, c) => { if (node._c !== c) { node._c = c; node.className = c; } };
  const setAttr = (node, name, v) => {
    const key = '_a' + name;
    if (node[key] !== v) { node[key] = v; node.setAttribute(name, v); }
  };
  let rowSeq = 0;

  function winIdOf(target) {
    const w = target && target.closest ? target.closest('.wm-window') : null;
    return w ? w.dataset.winId : null;
  }

  function rgbOf(color) {
    try {
      rgbOf.cx = rgbOf.cx || document.createElement('canvas').getContext('2d');
      rgbOf.cx.fillStyle = '#000000';
      rgbOf.cx.fillStyle = color;
      const v = String(rgbOf.cx.fillStyle);
      if (v[0] === '#') return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
      const m = v.match(/[\d.]+/g);
      if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
    } catch (e) { /* fall through */ }
    return [47, 158, 107];
  }

  // ---------------------------------------------------------------- history tracker (lives from script load)
  const tracker = (function () {
    const apps = new Map();   // appId -> { launches, total, since, count, last }
    const live = new Map();   // winId -> appId
    let bootAt = performance.now();

    const rec = (id) => {
      let r = apps.get(id);
      if (!r) { r = { id, launches: 0, total: 0, since: 0, count: 0, last: 0 }; apps.set(id, r); }
      return r;
    };

    function opened(win) {
      if (!win || live.has(win.id)) return;
      const r = rec(win.appId);
      live.set(win.id, win.appId);
      if (r.count === 0) r.since = Date.now();
      r.count++;
    }

    function closed(win) {
      const id = win && live.get(win.id);
      if (!id) return;
      live.delete(win.id);
      const r = rec(id);
      r.count = Math.max(0, r.count - 1);
      if (r.count === 0 && r.since) { r.total += Date.now() - r.since; r.since = 0; }
    }

    P.bus.on('apps:launch', (e) => {
      if (!e || !e.id || !e.win) return;
      const r = rec(e.id);
      r.launches++;
      r.last = Date.now();
      opened(e.win);
    });
    P.bus.on('wm:close', closed);
    P.bus.on('session:restart', () => { api.reset(true); bootAt = performance.now(); });

    const api = {
      snapshot() {
        const now = Date.now();
        return [...apps.values()].map((r) => ({
          id: r.id,
          launches: r.launches,
          total: r.total + (r.count > 0 && r.since ? now - r.since : 0),
          count: r.count,
          last: r.last
        }));
      },
      reset(all) {
        const now = Date.now();
        if (all) { apps.clear(); live.clear(); return; }
        apps.forEach((r) => {
          r.launches = 0; r.total = 0; r.last = 0;
          r.since = r.count > 0 ? now : 0;
        });
      },
      uptime() { return performance.now() - bootAt; }
    };
    return api;
  })();

  // ---------------------------------------------------------------- simulation model
  // The player is considered busy when its window exposes a play state (win.state.playing, a .playing class, a
  // "Duraklat" control) or shows the shared "pause" glyph on one of its buttons (the play/pause toggle while playing).
  let pauseInner;
  function pauseGlyphInner() {
    if (pauseInner === undefined) {
      pauseInner = '';
      try {
        const svg = P.icons && P.icons.has('pause') ? P.icons.get('pause') : '';
        const tpl = document.createElement('div');
        tpl.innerHTML = svg;                       // serialise it the way a button's innerHTML will be
        pauseInner = tpl.firstElementChild ? tpl.firstElementChild.innerHTML : '';
      } catch (e) { pauseInner = ''; }
    }
    return pauseInner;
  }

  function isPlaying(win) {
    try {
      const s = win.state || {};
      if (s.playing === true || s.isPlaying === true) return true;
      if (typeof s.isPlaying === 'function') return !!s.isPlaying();
      const b = win.body;
      if (b.classList.contains('playing') || b.classList.contains('is-playing')) return true;
      if (b.querySelector('[data-playing="true"], .is-playing, .playing, [aria-label="Duraklat"]')) return true;
      const glyph = pauseGlyphInner();
      if (glyph) {
        for (const btn of b.querySelectorAll('button')) if (btn.innerHTML.includes(glyph)) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  const areaMB = (win) => {
    const b = win.getBounds();
    return (b.width * b.height * 8) / 1048576;
  };

  class Model {
    constructor() {
      this.wins = new Map();      // winId -> { cpu, mem, disk, phase }
      this.act = new Map();       // winId -> activity 0..1.5 (decays)
      this.sys = SYSTEM.map((s) => ({ id: s.id, cpu: 0, mem: 0, disk: 0, init: false }));
      this.samples = [];
      this.pulse = 0;             // file system activity
      this.bgBurst = 0;           // short background work (indexing, sync...) shown on the kernel process
      this.other = OTHER_MEM_MB;
      this.rdFrac = 0.6;
      this.net = { rx: 6, tx: 1.5, spike: 0, totalRx: 0, totalTx: 0 };
      this.lastT = null;
      this.last = null;
      this.procs = SYSTEM.length;
      this.threads = 190;
      const n = clamp(navigator.hardwareConcurrency || 4, 1, 16);
      this.cores = Array.from({ length: n }, () => 0);
    }

    bump(winId, v) {
      if (!winId) return;
      this.act.set(winId, Math.min(1.5, (this.act.get(winId) || 0) + v));
    }

    /** Where a window's numbers are heading right now (CPU %, MB/s, resident MB). */
    targets(win, M, t) {
      const prof = PROFILES[win.appId] || PROFILES.default;
      const act = Math.min(1.5, this.act.get(win.id) || 0);
      const isFocus = P.wm.getFocused() === win;
      const playing = prof.play ? isPlaying(win) : false;
      const wob = 1 + 0.22 * Math.sin(t / 4300 + M.phase);
      let cpu = (prof.cpu * (isFocus ? 1.7 : 1) + act * prof.burst + (playing ? prof.play : 0)) * wob;
      let disk = prof.disk + act * prof.dburst * 0.3 + (isFocus ? this.pulse * prof.dburst * 0.5 : 0) + (playing ? prof.playDisk : 0);
      let mem = prof.mem + areaMB(win);
      if (win.isMinimized()) { cpu *= 0.04; disk = 0; mem *= 0.72; }
      return { cpu, disk, mem };
    }

    /** Metrics for a window the model has not seen yet: a short start-up spike (or steady state while warming). */
    ensure(win, t, quiet) {
      let M = this.wins.get(win.id);
      if (M) return M;
      M = { cpu: 0, mem: 0, disk: 0, phase: Math.random() * 6.283 };
      const T = this.targets(win, M, t == null ? performance.now() : t);
      M.cpu = quiet ? T.cpu : T.cpu * 2.2 + 5 + Math.random() * 4;
      M.mem = quiet ? T.mem : T.mem * 0.55;
      M.disk = quiet ? T.disk : 0.9;
      this.wins.set(win.id, M);
      return M;
    }

    step(t, quiet) {
      const dt = clamp(this.lastT == null ? 1 : (t - this.lastT) / 1000, 0.1, 8);
      this.lastT = t;
      const kk = (k) => 1 - Math.pow(1 - k, dt);
      const jit = (a) => (Math.random() - 0.5) * 2 * a * Math.sqrt(dt);
      const list = P.wm.list();
      const n = list.length;
      const pulse = this.pulse;
      let cpuSum = 0; let memSum = 0; let diskSum = 0; let area = 0; let actSum = 0;
      const alive = new Set();

      for (const win of list) {
        alive.add(win.id);
        let M = this.wins.get(win.id);
        const fresh = !M;
        if (fresh) M = this.ensure(win, t, quiet);
        actSum += Math.min(1.5, this.act.get(win.id) || 0);
        area += areaMB(win);
        if (!fresh) {
          const T = this.targets(win, M, t);
          const min = win.isMinimized();
          M.cpu = Math.max(0, M.cpu + (T.cpu - M.cpu) * kk(0.42) + jit(0.14 * T.cpu + (min ? 0.01 : 0.03)));
          M.disk = Math.max(0, M.disk + (T.disk - M.disk) * kk(0.5) + (T.disk > 0 ? jit(0.02 + 0.1 * T.disk) : 0));
          M.mem = Math.max(6, M.mem + (T.mem - M.mem) * kk(0.07) + jit(0.3));
          if (!quiet && Math.random() < 0.02 * dt) M.mem -= M.mem * (0.01 + Math.random() * 0.03);
        }
        cpuSum += M.cpu; memSum += M.mem; diskSum += M.disk;
      }
      for (const id of [...this.wins.keys()]) if (!alive.has(id)) { this.wins.delete(id); this.act.delete(id); }

      const sysT = {
        kernel: { cpu: 0.5 + n * 0.05 + pulse * 0.25 + this.bgBurst, mem: 112 + n * 1.8, disk: 0.02 + pulse * 0.45 },
        wm: { cpu: 0.22 + n * 0.06 + actSum * 0.25, mem: 56 + n * 2.4 + area * 0.25, disk: 0 },
        desktop: { cpu: 0.16 + actSum * 0.05, mem: 66, disk: 0 },
        taskbar: { cpu: 0.1 + n * 0.012, mem: 36 + n * 0.8, disk: 0 }
      };
      for (const s of this.sys) {
        const T = sysT[s.id];
        if (!s.init) { s.init = true; s.cpu = T.cpu; s.mem = T.mem; s.disk = T.disk; } else {
          s.cpu = Math.max(0, s.cpu + (T.cpu - s.cpu) * kk(0.4) + jit(0.04 + 0.12 * T.cpu));
          s.mem = Math.max(8, s.mem + (T.mem - s.mem) * kk(0.1) + jit(0.25));
          s.disk = Math.max(0, s.disk + (T.disk - s.disk) * kk(0.5) + (T.disk > 0 ? jit(0.04) : 0));
        }
        cpuSum += s.cpu; memSum += s.mem; diskSum += s.disk;
      }

      if (Math.random() < 0.04 * dt) this.bgBurst = Math.max(this.bgBurst, 3 + Math.random() * 11);
      this.bgBurst *= Math.pow(0.62, dt);
      if (this.bgBurst < 0.05) this.bgBurst = 0;
      // decays
      this.pulse *= Math.pow(0.45, dt);
      if (this.pulse < 0.02) this.pulse = 0;
      for (const [id, v] of this.act) {
        const nv = v * Math.pow(0.55, dt);
        if (nv < 0.02) this.act.delete(id); else this.act.set(id, nv);
      }

      const bg = Math.max(0.3, 1.1 + 0.9 * Math.sin(t / 9000) + 0.6 * Math.sin(t / 2300 + 1.3) + jit(0.25));
      const cpu = clamp(cpuSum + bg, 0, 100);
      this.other += (OTHER_MEM_MB - this.other) * kk(0.03) + jit(1.4);
      const mem = memSum + this.other;
      this.rdFrac = clamp(this.rdFrac + jit(0.05), 0.3, 0.8);
      const rd = diskSum * this.rdFrac;
      const wr = diskSum - rd;

      const nt = this.net;
      if (!quiet && Math.random() < 0.05 * dt) nt.spike = 200 + Math.random() * 900;
      nt.spike *= Math.pow(0.5, dt);
      if (nt.spike < 1) nt.spike = 0;
      nt.rx = clamp(nt.rx + (6 - nt.rx) * kk(0.35) + jit(5), 0.5, 5000);
      nt.tx = clamp(nt.tx + (1.5 - nt.tx) * kk(0.35) + jit(1.5) + (nt.spike > 50 ? 2 * dt : 0), 0.1, 800);
      const rx = nt.rx + nt.spike;
      const tx = nt.tx;
      nt.totalRx += rx * dt;
      nt.totalTx += tx * dt;

      const cores = this.cores;
      let mean = 0;
      for (let i = 0; i < cores.length; i++) {
        const tgt = clamp(cpu * (0.45 + Math.random() * 1.1) + jit(0.6), 0, 100);
        cores[i] += (tgt - cores[i]) * kk(0.5);
        mean += cores[i];
      }
      mean /= cores.length;
      const f = mean > 0.05 ? cpu / mean : 1;

      this.procs = n + SYSTEM.length;
      this.threads = 190 + n * 13;
      const s = {
        t, cpu, mem, memPct: (mem / TOTAL_MEM_MB) * 100, disk: diskSum, rd, wr, rx, tx,
        cores: cores.map((v) => clamp(v * f, 0, 100))
      };
      this.samples.push(s);
      while (this.samples.length && t - this.samples[0].t > KEEP_MS) this.samples.shift();
      this.last = s;
      return s;
    }

    /** Pre-fills the last minute so the charts are never empty when the window opens. */
    warm(now) {
      const list = P.wm.list();
      for (let i = 60; i >= 1; i--) {
        if (list.length && Math.random() < 0.1) this.bump(list[Math.floor(Math.random() * list.length)].id, 0.5 + Math.random() * 0.6);
        if (Math.random() < 0.05) this.pulse += 1;
        this.step(now - i * 1000, true);
      }
      this.step(now, false);
    }
  }

  // ---------------------------------------------------------------- canvas chart
  function chartPoints(S, get, tr, w, yOf) {
    const pts = [];
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (s.t <= tr) {
        const x = w - ((tr - s.t) / HISTORY_MS) * w;
        if (x < -30) continue;
        pts.push([x, yOf(get(s))]);
      } else {
        const p = S[i - 1];
        if (p) {
          const f = (tr - p.t) / (s.t - p.t);
          pts.push([w, yOf(get(p) + (get(s) - get(p)) * f)]);
        }
        break;
      }
    }
    return pts;
  }

  function tracePath(ctx, pts) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 2) { ctx.lineTo(pts[1][0], pts[1][1]); return; }
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l[0], l[1]);
  }

  class Chart {
    constructor(cv) {
      this.cv = cv;
      this.ctx = cv.getContext ? cv.getContext('2d') : null;
    }

    /** series: [{ get(sample), fill, dash, soft }]; o: { max, tr, theme, grid, rows, spark } */
    draw(S, series, o) {
      const cv = this.cv;
      const ctx = this.ctx;
      if (!ctx) return false;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (w < 4 || h < 4) return false;
      const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const [r, g, b] = o.theme.rgb;
      const rgba = (a) => `rgba(${r},${g},${b},${a})`;
      const max = o.max || 100;
      const pad = o.spark ? 2 : 1.5;
      const yOf = (v) => h - pad - clamp(v / max, 0, 1) * (h - pad * 2);

      if (o.grid) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(o.theme.dark ? 0.2 : 0.22);
        ctx.beginPath();
        const rows = o.rows || 5;
        for (let i = 1; i < rows; i++) {
          const y = Math.round((h * i) / rows) + 0.5;
          ctx.moveTo(0, y); ctx.lineTo(w, y);
        }
        const step = (GRID_MS / HISTORY_MS) * w;
        for (let x = w - (((o.tr % GRID_MS) / HISTORY_MS) * w); x > 0; x -= step) {
          const xx = Math.round(x) + 0.5;
          ctx.moveTo(xx, 0); ctx.lineTo(xx, h);
        }
        ctx.stroke();
      }

      for (const s of series) {
        const pts = chartPoints(S, s.get, o.tr, w, yOf);
        if (pts.length < 2) continue;
        if (s.fill) {
          const grad = ctx.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, rgba(o.spark ? 0.42 : 0.38));
          grad.addColorStop(1, rgba(0.05));
          ctx.beginPath();
          tracePath(ctx, pts);
          ctx.lineTo(pts[pts.length - 1][0], h);
          ctx.lineTo(pts[0][0], h);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        }
        ctx.beginPath();
        tracePath(ctx, pts);
        ctx.lineWidth = o.spark ? 1.25 : 1.7;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(s.soft ? 0.75 : 1);
        ctx.setLineDash(s.dash || []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      return true;
    }
  }

  // ---------------------------------------------------------------- grid view (keyed rows, selection, keyboard)
  class GridView {
    constructor(o) {
      this.o = o;
      // callbacks run from DOM events: never let an exception escape
      ['onSort', 'onSelect', 'onToggle', 'onActivate', 'onDelete', 'onContext'].forEach((k) => {
        const f = o[k];
        if (typeof f !== 'function') return;
        o[k] = (...a) => {
          try { return f(...a); } catch (e) { console.error('[taskmanager]', k, e); return undefined; }
        };
      });
      this.rows = new Map();
      this.items = [];
      this.byKey = new Map();
      this.selected = null;
      this.heads = {};
      this.gid = ++rowSeq;
      const root = (this.el = el('div', {
        class: 'tm-grid ' + (o.cls || ''),
        role: o.tree ? 'treegrid' : 'grid',
        tabindex: '0',
        'aria-label': o.label
      }));
      this.head = el('div', { class: 'tm-head', role: 'row' });
      this.body = el('div', { class: 'tm-body', role: 'rowgroup' });
      this.emptyEl = el('div', { class: 'p-empty tm-empty', hidden: true });
      root.append(this.head, this.body, this.emptyEl);
      this.buildHead();
      this.body.addEventListener('mousedown', (e) => this.onDown(e));
      this.body.addEventListener('click', (e) => this.onClick(e));
      this.body.addEventListener('dblclick', (e) => this.onDbl(e));
      this.body.addEventListener('contextmenu', (e) => this.onCtx(e));
      root.addEventListener('keydown', (e) => this.onKey(e));
      this.hover = false;
      this.body.addEventListener('mouseenter', () => { this.hover = true; });
      this.body.addEventListener('mouseleave', () => { this.hover = false; });
    }

    buildHead() {
      for (const c of this.o.columns) {
        const total = c.total ? el('span', { class: 'tm-th-total' }) : null;
        const arrow = el('span', { class: 'tm-th-arrow' });
        const btn = el('button', {
          class: 'tm-th', type: 'button', dataset: { col: c.id },
          on: { click: () => this.o.onSort && this.o.onSort(c.id) }
        }, total, el('span', { class: 'tm-th-bot' }, el('span', { class: 'tm-th-label', text: c.label }), arrow));
        const cell = el('div', {
          class: 'tm-hc tm-c-' + c.id + (c.num ? ' tm-num' : ''),
          role: 'columnheader', 'aria-sort': 'none'
        }, btn);
        this.heads[c.id] = { cell, total, arrow };
        this.head.appendChild(cell);
      }
    }

    setSort(sort) {
      for (const c of this.o.columns) {
        const h = this.heads[c.id];
        const on = sort && sort.key === c.id;
        h.cell.classList.toggle('sorted', !!on);
        setAttr(h.cell, 'aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        const want = on ? sort.dir : '';
        if (h.arrow._dir !== want) {
          h.arrow._dir = want;
          h.arrow.innerHTML = on ? `<svg ${SVG_ATTR} width="12" height="12">${OWN[sort.dir === 'asc' ? 'sort-up' : 'sort-down']}</svg>` : '';
        }
      }
    }

    setTotals(totals) {
      for (const c of this.o.columns) {
        if (c.total && totals && totals[c.id] != null) setText(this.heads[c.id].total, totals[c.id]);
      }
    }

    update(items, opts) {
      opts = opts || {};
      this.items = items;
      this.byKey = new Map(items.map((i) => [i.key, i]));
      const used = new Set();
      for (const item of items) {
        let rec = this.rows.get(item.key);
        if (!rec) {
          rec = this.o.createRow(item);
          rec.el.dataset.key = item.key;
          rec.el.id = `tm-g${this.gid}-r${++rowSeq}`;
          this.rows.set(item.key, rec);
        }
        rec.update(item, item.key === this.selected);
        used.add(item.key);
      }
      for (const [k, rec] of [...this.rows]) {
        if (!used.has(k)) { rec.el.remove(); this.rows.delete(k); }
      }
      if (!opts.freeze) {
        let cursor = this.body.firstChild;
        for (const item of items) {
          const rec = this.rows.get(item.key);
          if (rec.el === cursor) cursor = cursor.nextSibling;
          else this.body.insertBefore(rec.el, cursor);
        }
      } else {
        for (const item of items) {
          const rec = this.rows.get(item.key);
          if (!rec.el.parentNode) this.body.appendChild(rec.el);
        }
      }
      if (this.selected) {
        const sel = this.byKey.get(this.selected);
        if (!sel || sel.selectable === false) this.select(null);
      }
      if (items.length) {
        this.emptyEl.hidden = true;
      } else if (opts.empty) {
        this.emptyEl.hidden = false;
        if (this.emptyEl._k !== opts.empty.title) {
          this.emptyEl._k = opts.empty.title;
          this.emptyEl.replaceChildren(icon(opts.empty.icon || 'search', 40), el('strong', { text: opts.empty.title }), el('p', { text: opts.empty.sub || '' }));
        }
      }
    }

    selectableKeys() {
      return this.items.filter((i) => i.selectable !== false).map((i) => i.key);
    }

    select(key, opts) {
      opts = opts || {};
      if (key === this.selected) {
        if (key && opts.scroll) this.reveal(key);
        return;
      }
      this.selected = key || null;
      for (const [k, rec] of this.rows) {
        const on = k === this.selected;
        rec.el.classList.toggle('selected', on);
        rec.el.setAttribute('aria-selected', String(on));
      }
      const rec = this.selected && this.rows.get(this.selected);
      if (rec) this.el.setAttribute('aria-activedescendant', rec.el.id);
      else this.el.removeAttribute('aria-activedescendant');
      if (rec && opts.scroll) this.reveal(this.selected);
      if (this.o.onSelect) this.o.onSelect(this.selected, this.byKey.get(this.selected) || null);
    }

    reveal(key) {
      const rec = this.rows.get(key);
      if (!rec) return;
      const c = this.el;
      const top = rec.el.offsetTop;
      const bottom = top + rec.el.offsetHeight;
      const headH = this.head.offsetHeight;
      if (top - headH < c.scrollTop) c.scrollTop = Math.max(0, top - headH);
      else if (bottom > c.scrollTop + c.clientHeight) c.scrollTop = bottom - c.clientHeight;
    }

    itemOf(e) {
      const row = e.target && e.target.closest ? e.target.closest('.tm-row') : null;
      if (!row || !this.body.contains(row)) return null;
      return this.byKey.get(row.dataset.key) || null;
    }

    onDown(e) {
      if (e.button !== 0 && e.button !== 2) return;
      if (e.target.closest && e.target.closest('.tm-twisty') && e.button === 0) return;
      const item = this.itemOf(e);
      if (!item) { if (e.target === this.body && e.button === 0) this.select(null); return; }
      if (item.selectable !== false) this.select(item.key);
    }

    onClick(e) {
      const item = this.itemOf(e);
      if (!item || e.detail > 1) return;   // the second click of a double click must not toggle back
      const tw = e.target.closest && e.target.closest('.tm-twisty');
      if ((tw && item.canExpand) || item.kind === 'section') {
        if (this.o.onToggle) this.o.onToggle(item);
      }
    }

    onDbl(e) {
      const item = this.itemOf(e);
      if (!item || item.kind === 'section') return;
      if (e.target.closest && e.target.closest('.tm-twisty')) return;
      if (this.o.onActivate) this.o.onActivate(item);
    }

    onCtx(e) {
      e.preventDefault();
      const item = this.itemOf(e);
      if (!item || item.kind === 'section') return;
      if (item.selectable !== false) this.select(item.key);
      if (this.o.onContext) this.o.onContext(item, e);
    }

    onKey(e) {
      if (e.target !== this.el || e.ctrlKey || e.metaKey || e.altKey) return;
      const keys = this.selectableKeys();
      const i = keys.indexOf(this.selected);
      const item = this.selected ? this.byKey.get(this.selected) : null;
      const go = (n) => { if (keys.length) this.select(keys[clamp(n, 0, keys.length - 1)], { scroll: true }); };
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); go(i < 0 ? 0 : i + 1); break;
        case 'ArrowUp': e.preventDefault(); go(i < 0 ? keys.length - 1 : i - 1); break;
        case 'Home': e.preventDefault(); go(0); break;
        case 'End': e.preventDefault(); go(keys.length - 1); break;
        case 'PageDown': e.preventDefault(); go(i < 0 ? 0 : i + 8); break;
        case 'PageUp': e.preventDefault(); go(i < 0 ? 0 : i - 8); break;
        case 'ArrowRight':
          if (item && item.canExpand) {
            e.preventDefault();
            if (!item.expanded) { if (this.o.onToggle) this.o.onToggle(item); } else go(i + 1);
          }
          break;
        case 'ArrowLeft':
          if (item) {
            if (item.canExpand && item.expanded) { e.preventDefault(); if (this.o.onToggle) this.o.onToggle(item); } else if (item.parent) { e.preventDefault(); this.select(item.parent, { scroll: true }); }
          }
          break;
        case 'Enter':
          if (item && this.o.onActivate) { e.preventDefault(); this.o.onActivate(item); }
          break;
        case ' ':
          if (item && item.canExpand) { e.preventDefault(); if (this.o.onToggle) this.o.onToggle(item); }
          break;
        case 'Delete':
          if (item && this.o.onDelete) { e.preventDefault(); this.o.onDelete(item); }
          break;
        case 'ContextMenu':
        case 'F10':
          if ((e.key === 'ContextMenu' || e.shiftKey) && item && this.o.onContext) {
            e.preventDefault();
            const rec = this.rows.get(item.key);
            const r = rec.el.getBoundingClientRect();
            this.o.onContext(item, { clientX: r.left + 48, clientY: r.bottom - 4, preventDefault() {} });
          }
          break;
        default: break;
      }
    }
  }

  // ---------------------------------------------------------------- the app
  const NUMERIC_FIRST_DESC = new Set(['cpu', 'mem', 'disk', 'launches', 'total', 'live', 'last']);

  const PROC_COLS = [
    { id: 'name', label: 'Ad', sortable: true },
    { id: 'state', label: 'Durum', sortable: true },
    { id: 'cpu', label: 'CPU', num: true, total: true, sortable: true },
    { id: 'mem', label: 'Bellek', num: true, total: true, sortable: true },
    { id: 'disk', label: 'Disk', num: true, total: true, sortable: true }
  ];
  const HIST_COLS = [
    { id: 'name', label: 'Ad' },
    { id: 'launches', label: 'Başlatma', num: true },
    { id: 'total', label: 'Açık kalma süresi' },
    { id: 'live', label: 'Şu an' },
    { id: 'last', label: 'Son açılış' }
  ];
  const DET_COLS = [
    { id: 'pid', label: 'PID', num: true },
    { id: 'name', label: 'Ad' },
    { id: 'state', label: 'Durum' },
    { id: 'title', label: 'Pencere başlığı' },
    { id: 'size', label: 'Boyut' },
    { id: 'pos', label: 'Konum' }
  ];

  function validSort(s, keys, def) {
    return s && keys.includes(s.key) && (s.dir === 'asc' || s.dir === 'desc') ? { key: s.key, dir: s.dir } : def;
  }

  function findApp(q) {
    const s = lower(q).trim();
    if (!s) return null;
    const list = P.apps.list();
    return list.find((d) => lower(d.id) === s || lower(d.name) === s) ||
      list.find((d) => lower(d.name).startsWith(s) || lower(d.id).startsWith(s)) || null;
  }

  function heat(v, ref) {
    const n = v / ref;
    return n < 0.015 ? 0 : n < 0.1 ? 1 : n < 0.25 ? 2 : n < 0.5 ? 3 : 4;
  }

  class TaskManager {
    constructor(win, args) {
      this.win = win;
      this.closed = false;
      this.cleanups = [];
      this.model = new Model();
      this.searches = [];
      this.groups = [];
      this.sysItems = [];
      this.timer = 0;
      this.raf = 0;
      this.rafLive = false;
      this.dirtyTimer = 0;
      this.lastRender = 0;
      this.stale = false;
      this.pressed = false;
      this.pressedAt = 0;
      this.unfreezeOnce = false;   // one render that may reorder rows even while the table is "held still"
      this.fsInfo = { files: 0, dirs: 0 };
      this._th = null;

      const saved = P.storage.get(STORE_KEY, {}) || {};
      this.state = {
        page: PAGES.includes(saved.page) ? saved.page : 'processes',
        sort: validSort(saved.sort, ['name', 'state', 'cpu', 'mem', 'disk'], { key: 'name', dir: 'asc' }),
        hsort: validSort(saved.hsort, ['name', 'launches', 'total', 'live', 'last'], { key: 'total', dir: 'desc' }),
        dsort: validSort(saved.dsort, ['pid', 'name', 'state', 'title', 'size', 'pos'], { key: 'pid', dir: 'asc' }),
        collapsed: { apps: !!(saved.collapsed && saved.collapsed.apps), sys: !!(saved.collapsed && saved.collapsed.sys) },
        expanded: new Set(Array.isArray(saved.expanded) ? saved.expanded : []),
        speed: SPEEDS[saved.speed] ? saved.speed : 'normal',
        res: RES.some((r) => r.id === saved.res) ? saved.res : 'cpu',
        cpuView: saved.cpuView === 'cores' ? 'cores' : 'overall',
        rail: saved.rail === true || saved.rail === false ? saved.rail : null,
        query: ''
      };
      if (args && PAGES.includes(args.page)) this.state.page = args.page;
      this.saveSoon = U.debounce(() => this.saveNow(), 250);
      // async actions are started from click handlers: report failures instead of leaving a rejected promise behind
      ['endTask', 'runNewTask', 'resetHistory'].forEach((m) => {
        const f = this[m].bind(this);
        this[m] = (...a) => {
          try {
            const r = f(...a);
            return r && typeof r.catch === 'function' ? r.catch((e) => console.error('[taskmanager]', m, e)) : r;
          } catch (e) { console.error('[taskmanager]', m, e); return undefined; }
        };
      });

      this.build();
      this.bind();
      this.model.warm(performance.now());
      this.applySize();
      this.scanFs();
      this.go(this.state.page);
      this.startTimer();
      this.exposeApi();
    }

    // ------------------------------------------------------------ plumbing
    guard(fn, ...args) {
      try {
        return fn.apply(this, args);
      } catch (e) {
        console.error('[taskmanager]', e);
        return undefined;
      }
    }

    tip(node, getText) {
      if (P.ui && typeof P.ui.tip === 'function') {
        try { this.cleanups.push(P.ui.tip(node, getText)); } catch (e) { /* tooltips are optional */ }
      }
    }

    saveNow() {
      const s = this.state;
      P.storage.set(STORE_KEY, {
        page: s.page, sort: s.sort, hsort: s.hsort, dsort: s.dsort, collapsed: s.collapsed,
        expanded: [...s.expanded], speed: s.speed, res: s.res, cpuView: s.cpuView, rail: s.rail
      });
    }

    save() { this.saveSoon(); }

    isVisible() {
      return !this.closed && !this.win.isMinimized() && !document.hidden;
    }

    frozen() {
      return this.pressed && performance.now() - this.pressedAt < 4000;
    }

    menuOpen() {
      return !!(P.contextMenu && P.contextMenu.isOpen && P.contextMenu.isOpen());
    }

    exposeApi() {
      const self = this;
      this.win.state.tm = {
        go: (p) => self.go(p),
        tick: (n) => { for (let i = 0; i < (n || 1); i++) self.tick(); },
        render: () => self.render(),
        model: self.model,
        tracker,
        getState: () => ({
          page: self.state.page, sort: self.state.sort, hsort: self.state.hsort, dsort: self.state.dsort,
          speed: self.state.speed, res: self.state.res, cpuView: self.state.cpuView, query: self.state.query,
          compact: self.compact, size: self.root.dataset.size, expanded: [...self.state.expanded]
        }),
        grid: (p) => (p === 'processes' ? self.pGrid : p === 'history' ? self.hGrid : self.dGrid),
        destroyed: () => self.closed,
        timerActive: () => !!self.timer,
        rafActive: () => !!self.raf
      };
    }

    // ------------------------------------------------------------ build
    build() {
      this.root = el('div', { class: 'tm-shell' });
      this.rail = this.buildRail();
      this.main = el('main', { class: 'tm-main' });
      this.pages = {
        processes: this.buildProcesses(),
        performance: this.buildPerf(),
        history: this.buildHistory(),
        details: this.buildDetails()
      };
      this.main.append(...PAGES.map((p) => this.pages[p]));
      this.root.append(this.rail, this.main);
      this.win.body.appendChild(this.root);
    }

    buildRail() {
      const rail = el('nav', { class: 'tm-rail', 'aria-label': 'Görev Yöneticisi' });
      const tabs = el('div', { class: 'tm-tabs', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Bölümler' });
      this.burger = el('button', {
        class: 'tm-nav tm-burger', type: 'button', 'aria-label': 'Gezinmeyi daralt veya genişlet',
        on: { click: () => this.toggleRail() }
      }, icon('menu', 18));
      this.tip(this.burger, () => (this.compact ? 'Gezinmeyi genişlet' : 'Gezinmeyi daralt'));
      rail.appendChild(this.burger);
      this.navs = {};
      NAV.forEach((n) => {
        const b = el('button', {
          class: 'tm-nav', type: 'button', role: 'tab', id: 'tm-tab-' + n.id, dataset: { page: n.id },
          'aria-controls': 'tm-panel-' + n.id, 'aria-selected': 'false',
          on: { click: () => this.go(n.id) }
        }, icon(n.icon, 18), el('span', { class: 'tm-nav-label', text: n.label }));
        this.tip(b, () => (this.compact ? n.label : ''));
        this.navs[n.id] = b;
        tabs.appendChild(b);
      });
      rail.appendChild(tabs);
      rail.appendChild(el('span', { class: 'tm-rail-spacer' }));
      this.speedBtn = el('button', {
        class: 'tm-nav tm-speed', type: 'button', 'aria-label': 'Güncelleme hızı', 'aria-haspopup': 'menu',
        on: { click: (e) => this.speedMenu(e) }
      }, icon('timer', 18), el('span', { class: 'tm-nav-label' }, 'Güncelleme hızı'));
      this.tip(this.speedBtn, () => 'Güncelleme hızı: ' + SPEEDS[this.state.speed].label);
      rail.appendChild(this.speedBtn);
      tabs.addEventListener('keydown', (e) => {
        const i = PAGES.indexOf(this.state.page);
        let n = -1;
        if (e.key === 'ArrowDown') n = (i + 1) % PAGES.length;
        else if (e.key === 'ArrowUp') n = (i + PAGES.length - 1) % PAGES.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = PAGES.length - 1;
        if (n >= 0) { e.preventDefault(); this.go(PAGES[n]); this.navs[PAGES[n]].focus(); }
      });
      return rail;
    }

    makePage(id, title, controls) {
      const children = [];
      if (title) {
        children.push(el('div', { class: 'p-toolbar tm-toolbar' },
          el('h2', { class: 'tm-title', text: title }), el('span', { class: 'spacer' }), ...(controls || [])));
      }
      return el('section', {
        class: 'tm-page tm-page-' + id, role: 'tabpanel', id: 'tm-panel-' + id, 'aria-labelledby': 'tm-tab-' + id,
        hidden: true, dataset: { page: id }
      }, ...children);
    }

    makeSearch() {
      const input = el('input', {
        class: 'p-input small tm-search-input', type: 'text', placeholder: 'Ara', 'aria-label': 'Ara',
        spellcheck: 'false', autocomplete: 'off'
      });
      const clear = el('button', {
        class: 'tm-search-clear', type: 'button', 'aria-label': 'Aramayı temizle', hidden: true, tabindex: '-1',
        on: { click: () => { this.setQuery(''); input.focus(); } }
      }, icon('x', 12));
      const wrap = el('div', { class: 'tm-search' }, icon('search', 14, 'tm-search-ico'), input, clear);
      input.addEventListener('input', () => this.setQuery(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) {
          e.preventDefault(); e.stopPropagation();
          this.setQuery('');
        } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
          const g = this.currentGrid();
          if (g) { e.preventDefault(); g.el.focus(); if (!g.selected) { const k = g.selectableKeys()[0]; if (k) g.select(k); } }
        }
      });
      this.searches.push({ input, clear });
      return wrap;
    }

    setQuery(q) {
      this.state.query = q;
      this.unfreezeOnce = true;
      for (const s of this.searches) {
        if (s.input.value !== q) s.input.value = q;
        s.clear.hidden = !q;
      }
      this.render();
    }

    query() { return lower(this.state.query).trim(); }

    // ---- İşlemler
    buildProcesses() {
      const search = this.makeSearch();
      this.btnNew = el('button', {
        class: 'p-btn small tm-btn-new', type: 'button', 'aria-label': 'Yeni görev çalıştır',
        on: { click: () => this.runNewTask() }
      }, icon('plus', 14), el('span', { class: 'tm-btn-label', text: 'Yeni görev çalıştır' }));
      this.tip(this.btnNew, () => (this.root.dataset.size === 'sm' ? 'Yeni görev çalıştır' : ''));
      this.btnEnd = el('button', {
        class: 'p-btn small danger tm-btn-end', type: 'button', disabled: true,
        on: { click: () => this.endSelected() }
      }, el('span', { text: 'Görevi sonlandır' }));
      const page = this.makePage('processes', 'İşlemler', [search, this.btnNew, this.btnEnd]);
      this.pGrid = new GridView({
        label: 'İşlemler', tree: true, cls: 'tm-proc', columns: PROC_COLS,
        createRow: (item) => this.createProcRow(item),
        onSort: (c) => this.sortBy('sort', c),
        onSelect: () => this.syncButtons(),
        onToggle: (item) => this.toggleItem(item),
        onActivate: (item) => this.activateItem(item),
        onDelete: (item) => this.endTask(this.targetsOf(item.key)),
        onContext: (item, e) => this.rowMenu(item, e)
      });
      this.pStatus = el('div', { class: 'p-statusbar tm-status' },
        this.pStat1 = el('span'), el('span', { class: 'spacer' }), this.pStat2 = el('span'));
      page.append(this.pGrid.el, this.pStatus);
      return page;
    }

    createProcRow(item) {
      const row = el('div', { class: 'tm-row', role: 'row' });
      const rec = { el: row };
      if (item.kind === 'section') {
        const lab = el('span', { class: 'tm-sec-label' });
        const cnt = el('span', { class: 'tm-sec-count' });
        row.append(el('div', { class: 'tm-sec-cell', role: 'gridcell' }, el('span', { class: 'tm-twisty' }, icon('chevron-right', 12)), lab, cnt));
        rec.update = (it) => {
          setCls(row, 'tm-row tm-sec' + (it.collapsed ? '' : ' expanded'));
          setAttr(row, 'aria-expanded', String(!it.collapsed));
          setAttr(row, 'aria-level', '1');
          setText(lab, it.label);
          setText(cnt, '(' + it.count + ')');
        };
        return rec;
      }
      const tw = el('span', { class: 'tm-twisty' }, icon('chevron-right', 12));
      const ico = el('span', { class: 'tm-ico' });
      const lab = el('span', { class: 'tm-label' });
      const sub = el('span', { class: 'tm-sub' });
      const cName = el('div', { class: 'tm-c tm-c-name', role: 'gridcell' }, tw, ico, lab, sub);
      const dot = el('i', { class: 'tm-dot' });
      const stx = el('span');
      const cState = el('div', { class: 'tm-c tm-c-state', role: 'gridcell' }, dot, stx);
      const cCpu = el('div', { class: 'tm-c tm-num', role: 'gridcell' });
      const cMem = el('div', { class: 'tm-c tm-num', role: 'gridcell' });
      const cDisk = el('div', { class: 'tm-c tm-num', role: 'gridcell' });
      row.append(cName, cState, cCpu, cMem, cDisk);
      rec.update = (it, selected) => {
        setCls(row, 'tm-row tm-' + it.kind + (it.child ? ' tm-child' : '') + (it.minimized ? ' is-min' : '') +
          (it.canExpand ? ' has-kids' : '') + (it.expanded ? ' expanded' : '') + (selected ? ' selected' : ''));
        setAttr(row, 'aria-level', it.child ? '2' : '1');
        setAttr(row, 'aria-selected', String(!!selected));
        if (it.canExpand) setAttr(row, 'aria-expanded', String(!!it.expanded));
        if (ico._ik !== it.iconKey) {
          ico._ik = it.iconKey;
          ico.replaceChildren(it.iconKind === 'tile' ? el('span', { class: 'tm-tile' }, icon(it.icon, 14)) : icon(it.icon, 20));
        }
        setText(lab, it.name);
        setText(sub, it.sub || '');
        setCls(dot, 'tm-dot ' + (it.minimized ? 'idle' : 'run'));
        setText(stx, it.status);
        setCls(cCpu, 'tm-c tm-num heat-' + heat(it.cpu, 25));
        setText(cCpu, fmtPct(it.cpu));
        setCls(cMem, 'tm-c tm-num heat-' + heat(it.mem, 800));
        setText(cMem, fmtMB(it.mem));
        setCls(cDisk, 'tm-c tm-num heat-' + heat(it.disk, 5));
        setText(cDisk, fmtRate(it.disk));
      };
      return rec;
    }

    // ---- Performans
    buildPerf() {
      const page = this.makePage('performance', null);
      const list = el('div', { class: 'tm-reslist', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Kaynaklar' });
      this.resBtns = {};
      this.sparks = {};
      this.resSubs = {};
      RES.forEach((r) => {
        const cv = el('canvas', { class: 'tm-spark', 'aria-hidden': 'true' });
        const sub = el('span', { class: 'tm-res-sub' });
        const b = el('button', {
          class: 'tm-res', type: 'button', role: 'tab', dataset: { res: r.id }, 'aria-selected': 'false',
          on: { click: () => this.selectRes(r.id) }
        }, cv, el('span', { class: 'tm-res-txt' },
          el('span', { class: 'tm-res-name' }, r.label, r.note ? el('small', { text: r.note }) : null), sub));
        this.resBtns[r.id] = b;
        this.resSubs[r.id] = sub;
        this.sparks[r.id] = new Chart(cv);
        list.appendChild(b);
      });
      list.addEventListener('keydown', (e) => {
        const ids = RES.map((r) => r.id);
        const i = ids.indexOf(this.state.res);
        let n = -1;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % ids.length;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i + ids.length - 1) % ids.length;
        if (n >= 0) { e.preventDefault(); this.selectRes(ids[n]); this.resBtns[ids[n]].focus(); }
      });

      this.dTitle = el('h2', { class: 'tm-dtitle' });
      this.dModel = el('span', { class: 'tm-dmodel' });
      this.viewSeg = el('div', { class: 'p-segmented tm-viewseg', role: 'group', 'aria-label': 'Grafik görünümü' },
        el('button', { type: 'button', dataset: { view: 'overall' }, text: 'Genel kullanım', on: { click: () => this.setCpuView('overall') } }),
        el('button', { type: 'button', dataset: { view: 'cores' }, text: 'Mantıksal işlemciler', on: { click: () => this.setCpuView('cores') } }));
      const head = el('div', { class: 'tm-dhead' }, el('div', { class: 'tm-dtitles' }, this.dTitle, this.dModel), this.viewSeg);

      this.axisLeft = el('span');
      this.axisMax = el('span', { class: 'tm-axis-max' });
      this.mainCv = el('canvas', { class: 'tm-chart', role: 'img' });
      this.mainChart = new Chart(this.mainCv);
      this.coreGrid = el('div', { class: 'tm-coregrid', hidden: true });
      this.cores = [];
      this.plotArea = el('div', { class: 'tm-plot-area' }, this.mainCv, this.coreGrid);
      const plot = el('div', { class: 'tm-plot' },
        el('div', { class: 'tm-plot-top' }, this.axisLeft, this.axisMax),
        this.plotArea,
        el('div', { class: 'tm-plot-bot' }, el('span', { text: '60 saniye' }), el('span', { text: '0' })));

      this.extraEl = el('div', { class: 'tm-extra' });
      this.statsEl = el('div', { class: 'tm-stats' });
      this.infoEl = el('div', { class: 'tm-info' });
      this.detail = el('div', { class: 'tm-detail' }, head, plot, this.extraEl, this.statsEl, this.infoEl);
      page.append(list, this.detail);
      return page;
    }

    // ---- Uygulama geçmişi
    buildHistory() {
      const search = this.makeSearch();
      const reset = el('button', {
        class: 'p-btn small', type: 'button', on: { click: () => this.resetHistory() }
      }, icon('refresh', 14), el('span', { class: 'tm-btn-label', text: 'Geçmişi sıfırla' }));
      reset.setAttribute('aria-label', 'Geçmişi sıfırla');
      this.tip(reset, () => (this.root.dataset.size === 'sm' ? 'Geçmişi sıfırla' : ''));
      const page = this.makePage('history', 'Uygulama geçmişi', [search, reset]);
      this.hGrid = new GridView({
        label: 'Uygulama geçmişi', cls: 'tm-hist', columns: HIST_COLS,
        createRow: (item) => this.createHistRow(item),
        onSort: (c) => this.sortBy('hsort', c)
      });
      this.hStatus = el('div', { class: 'p-statusbar tm-status' }, this.hStat1 = el('span'), el('span', { class: 'spacer' }), this.hStat2 = el('span'));
      page.append(this.hGrid.el, this.hStatus);
      return page;
    }

    createHistRow() {
      const row = el('div', { class: 'tm-row', role: 'row' });
      const ico = el('span', { class: 'tm-ico' });
      const lab = el('span', { class: 'tm-label' });
      const cName = el('div', { class: 'tm-c tm-c-name', role: 'gridcell' }, ico, lab);
      const cL = el('div', { class: 'tm-c tm-num tm-c-launches', role: 'gridcell' });
      const bar = el('i', { class: 'tm-bar' });
      const dur = el('span', { class: 'tm-dur' });
      const cT = el('div', { class: 'tm-c tm-c-total', role: 'gridcell' }, bar, dur);
      const dot = el('i', { class: 'tm-dot' });
      const liveTx = el('span');
      const cLive = el('div', { class: 'tm-c tm-c-live', role: 'gridcell' }, dot, liveTx);
      const cLast = el('div', { class: 'tm-c tm-c-last', role: 'gridcell' });
      row.append(cName, cL, cT, cLive, cLast);
      return {
        el: row,
        update: (it, selected) => {
          setCls(row, 'tm-row tm-hist-row' + (selected ? ' selected' : ''));
          if (ico._ik !== it.icon) { ico._ik = it.icon; ico.replaceChildren(icon(it.icon, 20)); }
          setText(lab, it.name);
          setText(cL, NF0.format(it.launches));
          setText(dur, fmtDuration(it.total));
          bar.style.setProperty('--r', it.ratio.toFixed(3));
          setCls(dot, 'tm-dot ' + (it.count > 0 ? 'run' : 'off'));
          setText(liveTx, it.count > 0 ? (it.count > 1 ? `Çalışıyor (${it.count})` : 'Çalışıyor') : 'Kapalı');
          setText(cLast, it.last ? U.formatTime(it.last, true) : '—');
        }
      };
    }

    // ---- Ayrıntılar
    buildDetails() {
      const search = this.makeSearch();
      this.btnEnd2 = el('button', {
        class: 'p-btn small danger tm-btn-end', type: 'button', disabled: true,
        on: { click: () => this.endSelected() }
      }, el('span', { text: 'Görevi sonlandır' }));
      const page = this.makePage('details', 'Ayrıntılar', [search, this.btnEnd2]);
      this.dGrid = new GridView({
        label: 'Pencere ayrıntıları', cls: 'tm-det', columns: DET_COLS,
        createRow: (item) => this.createDetRow(item),
        onSort: (c) => this.sortBy('dsort', c),
        onSelect: () => this.syncButtons(),
        onActivate: (item) => this.bring(this.targetsOf(item.key)),
        onDelete: (item) => this.endTask(this.targetsOf(item.key)),
        onContext: (item, e) => this.rowMenu(item, e)
      });
      this.dStatus = el('div', { class: 'p-statusbar tm-status' }, this.dStat1 = el('span'), el('span', { class: 'spacer' }), this.dStat2 = el('span'));
      page.append(this.dGrid.el, this.dStatus);
      return page;
    }

    createDetRow() {
      const row = el('div', { class: 'tm-row', role: 'row' });
      // text lives in an inner span so a long value is cut with an ellipsis (flex cells cannot do that themselves)
      const mk = (cls) => {
        const t = el('span', { class: 'tm-t' });
        const cell = el('div', { class: 'tm-c ' + cls, role: 'gridcell' }, t);
        cell._t = t;
        return cell;
      };
      const cPid = mk('tm-num tm-c-pid');
      const ico = el('span', { class: 'tm-ico' });
      const lab = el('span', { class: 'tm-label' });
      const cName = el('div', { class: 'tm-c tm-c-name', role: 'gridcell' }, ico, lab);
      const dot = el('i', { class: 'tm-dot' });
      const stx = el('span');
      const cState = el('div', { class: 'tm-c tm-c-state', role: 'gridcell' }, dot, stx);
      const cTitle = mk('tm-c-title');
      const cSize = mk('tm-c-size');
      const cPos = mk('tm-c-pos');
      row.append(cPid, cName, cState, cTitle, cSize, cPos);
      return {
        el: row,
        update: (it, selected) => {
          setCls(row, 'tm-row tm-det-row' + (it.minimized ? ' is-min' : '') + (selected ? ' selected' : ''));
          setAttr(row, 'aria-selected', String(!!selected));
          setText(cPid._t, String(it.pid));
          if (ico._ik !== it.icon) { ico._ik = it.icon; ico.replaceChildren(icon(it.icon, 20)); }
          setText(lab, it.name);
          setCls(dot, 'tm-dot ' + (it.minimized ? 'idle' : 'run'));
          setText(stx, it.status);
          setText(cTitle._t, it.title);
          setText(cSize._t, it.size);
          setText(cPos._t, it.pos);
        }
      };
    }

    // ------------------------------------------------------------ events
    bind() {
      const w = this.win;
      const onWin = (evt, fn) => this.cleanups.push(w.on(evt, (...a) => this.guard(fn, ...a)));
      const onBus = (evt, fn) => this.cleanups.push(P.bus.on(evt, (d) => this.guard(fn, d)));
      const onDoc = (evt, fn, opts) => {
        const h = (e) => this.guard(fn, e);
        document.addEventListener(evt, h, opts);
        this.cleanups.push(() => document.removeEventListener(evt, h, opts));
      };

      onWin('close', () => this.destroy());
      onWin('minimize', () => { this.stopRaf(); });
      onWin('restore', () => {
        if (w.isMinimized()) return;
        this.applySize();
        this.render();
        this.syncRaf();
      });
      onWin('resize', () => {
        this.applySize();
        if (this.state.page === 'performance') this.drawAll();
      });
      onWin('keydown', (e) => this.onWinKey(e));

      ['wm:open', 'wm:close', 'wm:minimize', 'wm:restore', 'wm:title', 'wm:snap'].forEach((evt) => onBus(evt, () => this.schedule()));
      onBus('wm:close', (win) => { if (win) this.model.act.delete(win.id); });
      onBus('wm:move', (win) => { if (win) this.model.bump(win.id, 0.15); this.schedule(); });
      onBus('wm:maximize', (win) => { if (win) this.model.bump(win.id, 0.8); this.schedule(); });
      onBus('wm:minimize', (win) => { if (win) this.model.bump(win.id, 0.5); });
      onBus('apps:launch', (e) => { if (e && e.win) this.model.bump(e.win.id, 0.8); this.schedule(); });
      onBus('fs:change', () => {
        this.model.pulse = Math.min(3, this.model.pulse + 1);
        clearTimeout(this.fsTimer);
        this.fsTimer = setTimeout(() => this.scanFs(), 400);
      });
      onBus('theme:change', () => this.themeChanged());
      onBus('settings:change', (e) => { if (e && (e.key === 'accent' || e.key === 'animations')) this.themeChanged(); });

      onDoc('pointerdown', (e) => {
        this.pressed = true; this.pressedAt = performance.now();
        this.model.bump(winIdOf(e.target), 0.8);
      }, true);
      const release = () => { this.pressed = false; };
      onDoc('pointerup', release, true);
      onDoc('pointercancel', release, true);
      onDoc('pointermove', (e) => {
        if (e.buttons) this.model.bump(winIdOf(e.target), 0.12);
        else if (this.pressed) this.pressed = false;
      }, true);
      onDoc('keydown', () => { const f = P.wm.getFocused(); if (f) this.model.bump(f.id, 0.5); }, true);
      onDoc('wheel', (e) => this.model.bump(winIdOf(e.target), 0.3), { capture: true, passive: true });
      onDoc('visibilitychange', () => { if (!document.hidden) { this.render(); this.syncRaf(); } else this.stopRaf(); });
    }

    onWinKey(e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        this.go(PAGES[Number(e.key) - 1]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && lower(e.key) === 'f') {
        e.preventDefault();
        this.focusSearch();
        return;
      }
      if (e.key === 'F5') { e.preventDefault(); this.render(); }
    }

    focusSearch() {
      const page = this.pages[this.state.page];
      const input = page && page.querySelector('.tm-search-input');
      if (input) { input.focus(); input.select(); }
    }

    themeChanged() {
      this._th = null;
      if (!this.closed) this.render();
    }

    // ------------------------------------------------------------ navigation
    go(page) {
      if (!PAGES.includes(page) || this.closed) return;
      this.state.page = page;
      PAGES.forEach((p) => { this.pages[p].hidden = p !== page; });
      for (const [id, b] of Object.entries(this.navs)) {
        const on = id === page;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      this.save();
      this.render();
      this.syncRaf();
    }

    toggleRail() {
      this.state.rail = !!this.compact;   // opposite of the current effective state
      this.save();
      this.applySize();
      if (this.state.page === 'performance') this.drawAll();
    }

    applySize() {
      if (this.closed) return;
      const w = this.win.body.clientWidth || 780;
      const compact = w < 600 || this.state.rail === false || (this.state.rail === null && w < 760);
      this.compact = compact;
      const main = w - (compact ? 48 : 176);
      this.root.dataset.size = main < 560 ? 'sm' : 'md';
      this.root.classList.toggle('compact', compact);
      this.burger.setAttribute('aria-expanded', String(!compact));
    }

    sortBy(which, col) {
      const cur = this.state[which];
      const dir = cur.key === col ? (cur.dir === 'asc' ? 'desc' : 'asc') : (NUMERIC_FIRST_DESC.has(col) ? 'desc' : 'asc');
      this.state[which] = { key: col, dir };
      this.save();
      this.pressed = false;
      this.unfreezeOnce = true;
      this.render();
    }

    speedMenu(e) {
      const items = Object.entries(SPEEDS).map(([id, s]) => ({
        label: s.label + (s.hint ? '  (' + s.hint + ')' : ''), checked: this.state.speed === id,
        action: () => this.setSpeed(id)
      }));
      const r = this.speedBtn.getBoundingClientRect();
      if (P.contextMenu) P.contextMenu.show(r.right + 6, Math.max(8, r.top - items.length * 32 + 32), items);
    }

    setSpeed(id) {
      if (!SPEEDS[id] || this.closed) return;
      this.state.speed = id;
      this.save();
      this.startTimer();
      this.syncRaf();
      this.render();
    }

    setCpuView(v) {
      this.state.cpuView = v === 'cores' ? 'cores' : 'overall';
      this.save();
      this.buildDetail();
      this.render();
    }

    selectRes(id) {
      if (!RES.some((r) => r.id === id)) return;
      this.state.res = id;
      this.save();
      this.buildDetail();
      this.render();
    }

    // ------------------------------------------------------------ timers / rendering
    startTimer() {
      clearInterval(this.timer);
      this.timer = 0;
      const ms = SPEEDS[this.state.speed].ms;
      if (ms > 0) this.timer = setInterval(() => this.guard(this.tick), ms);
    }

    tick() {
      if (this.closed) return;
      this.model.step(performance.now(), false);
      this.render();
    }

    schedule() {
      if (this.dirtyTimer || this.closed) return;
      const wait = Math.max(0, MIN_RENDER_GAP - (performance.now() - this.lastRender));
      this.dirtyTimer = setTimeout(() => {
        this.dirtyTimer = 0;
        this.guard(this.render);
      }, wait);
    }

    render() {
      if (this.closed) return;
      this.lastRender = performance.now();
      if (!this.isVisible()) { this.stale = true; return; }
      this.stale = false;
      try {
        this.collect();
        switch (this.state.page) {
          case 'processes': this.renderProcesses(); break;
          case 'performance': this.renderPerf(); break;
          case 'history': this.renderHistory(); break;
          default: this.renderDetails(); break;
        }
      } catch (e) {
        console.error('[taskmanager] çizim hatası', e);
      }
    }

    // ------------------------------------------------------------ data
    collect() {
      const list = P.wm.list();
      const groups = new Map();
      for (const win of list) {
        const M = this.model.ensure(win);
        const def = P.apps.get(win.appId);
        let g = groups.get(win.appId);
        if (!g) {
          g = {
            key: 'app:' + win.appId, kind: 'app', appId: win.appId,
            name: (def && def.name) || win.getTitle() || win.appId,
            icon: (def && def.icon) || win.getIcon() || win.appId,
            wins: [], cpu: 0, mem: 0, disk: 0
          };
          groups.set(win.appId, g);
        }
        const min = win.isMinimized();
        g.wins.push({
          key: 'win:' + win.id, kind: 'win', win, name: win.getTitle() || g.name, title: win.getTitle() || '',
          icon: win.getIcon() || g.icon, minimized: min, cpu: M.cpu, mem: M.mem, disk: M.disk
        });
        g.cpu += M.cpu; g.mem += M.mem; g.disk += M.disk;
      }
      this.groups = [...groups.values()];
      this.groups.forEach((g) => { g.minimized = g.wins.every((x) => x.minimized); });
      this.sysItems = SYSTEM.map((s, i) => {
        const M = this.model.sys[i];
        return { key: 'sys:' + s.id, kind: 'sys', system: true, name: s.name, icon: s.icon, cpu: M.cpu, mem: M.mem, disk: M.disk };
      });
      this.totals = this.model.last || { cpu: 0, mem: OTHER_MEM_MB, memPct: 0, disk: 0 };
    }

    cmpFor(sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      return (a, b) => {
        let r;
        switch (sort.key) {
          case 'cpu': case 'mem': case 'disk': r = a[sort.key] - b[sort.key]; break;
          case 'state': r = (a.minimized ? 1 : 0) - (b.minimized ? 1 : 0); break;
          default: r = U.compareNames(a.name, b.name); break;
        }
        return r === 0 ? U.compareNames(a.name, b.name) : r * dir;
      };
    }

    renderProcesses() {
      const s = this.state;
      const q = this.query();
      const cmp = this.cmpFor(s.sort);
      const match = (t) => lower(t).includes(q);
      let apps = this.groups;
      if (q) apps = apps.filter((g) => match(g.name) || g.wins.some((w) => match(w.title)));
      apps = apps.slice().sort(cmp);
      let sys = q ? this.sysItems.filter((x) => match(x.name)) : this.sysItems;
      sys = sys.slice().sort(cmp);

      const items = [];
      if (apps.length) {
        items.push({ key: 'sec:apps', kind: 'section', label: 'Uygulamalar', count: apps.length, collapsed: s.collapsed.apps, selectable: false, section: 'apps' });
        if (!s.collapsed.apps) {
          for (const g of apps) {
            const multi = g.wins.length > 1;
            const open = multi && s.expanded.has(g.appId);
            const one = g.wins[0];
            const sub = multi ? '(' + g.wins.length + ')' : (one && one.title && one.title !== g.name ? one.title : '');
            items.push({
              key: g.key, kind: 'app', appId: g.appId, name: g.name, sub, icon: g.icon, iconKey: g.icon,
              minimized: g.minimized, status: g.minimized ? 'Simge durumunda' : 'Etkin',
              cpu: g.cpu, mem: g.mem, disk: g.disk, canExpand: multi, expanded: open
            });
            if (open) {
              for (const w of g.wins.slice().sort(cmp)) {
                items.push({
                  key: w.key, kind: 'win', child: true, parent: g.key, name: w.name, icon: w.icon, iconKey: w.icon,
                  minimized: w.minimized, status: w.minimized ? 'Simge durumunda' : 'Etkin', cpu: w.cpu, mem: w.mem, disk: w.disk
                });
              }
            }
          }
        }
      }
      if (sys.length) {
        items.push({ key: 'sec:sys', kind: 'section', label: 'Sistem işlemleri', count: sys.length, collapsed: s.collapsed.sys, selectable: false, section: 'sys' });
        if (!s.collapsed.sys) {
          for (const x of sys) {
            items.push({
              key: x.key, kind: 'sys', system: true, name: x.name, icon: x.icon,
              iconKey: x.icon, iconKind: x.icon === 'panda' ? 'color' : 'tile',
              minimized: false, status: 'Çalışıyor', cpu: x.cpu, mem: x.mem, disk: x.disk
            });
          }
        }
      }
      this.pGrid.setSort(s.sort);
      this.pGrid.setTotals({ cpu: fmtPct0(this.totals.cpu), mem: fmtPct0(this.totals.memPct), disk: fmtRate(this.totals.disk) });
      this.pGrid.update(items, {
        // rows stay put while the pointer is over a live-sorted table (or a press / menu is in progress)
        freeze: !this.unfreezeOnce && (this.frozen() || this.menuOpen() || (this.pGrid.hover && ['cpu', 'mem', 'disk'].includes(s.sort.key))),
        empty: { title: 'Eşleşen işlem yok', sub: '“' + this.state.query + '” için sonuç bulunamadı.' }
      });
      this.unfreezeOnce = false;
      const winCount = this.groups.reduce((n, g) => n + g.wins.length, 0);
      setText(this.pStat1, `${NF0.format(this.groups.length)} uygulama · ${NF0.format(winCount)} pencere · ${NF0.format(this.sysItems.length)} sistem işlemi`);
      setText(this.pStat2, s.speed === 'paused' ? 'Güncelleme duraklatıldı' : 'Güncelleme hızı: ' + SPEEDS[s.speed].label);
    }

    renderHistory() {
      const s = this.state;
      const q = this.query();
      let rows = tracker.snapshot().filter((r) => r.launches > 0 || r.count > 0).map((r) => {
        const def = P.apps.get(r.id);
        return Object.assign(r, {
          key: 'h:' + r.id, kind: 'hist', name: (def && def.name) || r.id, icon: (def && def.icon) || r.id, live: r.count
        });
      });
      if (q) rows = rows.filter((r) => lower(r.name).includes(q));
      const dir = s.hsort.dir === 'asc' ? 1 : -1;
      const k = s.hsort.key;
      rows.sort((a, b) => {
        const r = k === 'name' ? U.compareNames(a.name, b.name) : (a[k] || 0) - (b[k] || 0);
        return r === 0 ? U.compareNames(a.name, b.name) : r * dir;
      });
      const max = rows.reduce((m, r) => Math.max(m, r.total), 1);
      rows.forEach((r) => { r.ratio = r.total / max; });
      this.hGrid.setSort(s.hsort);
      this.hGrid.update(rows, {
        freeze: this.frozen(),
        empty: q ? { title: 'Eşleşen uygulama yok', sub: '“' + this.state.query + '” için sonuç bulunamadı.' } : { icon: 'time', title: 'Henüz geçmiş yok', sub: 'Uygulamalar açıldıkça burada listelenir.' }
      });
      const total = rows.reduce((n, r) => n + r.launches, 0);
      setText(this.hStat1, `${NF0.format(rows.length)} uygulama · ${NF0.format(total)} başlatma`);
      setText(this.hStat2, 'Oturum süresi: ' + fmtClock(tracker.uptime()));
    }

    renderDetails() {
      const s = this.state;
      const q = this.query();
      let rows = P.wm.list().map((win) => {
        const def = P.apps.get(win.appId);
        const b = win.getBounds();
        const min = win.isMinimized();
        return {
          key: 'win:' + win.id, kind: 'win', win, pid: pidOf(win), name: (def && def.name) || win.appId,
          icon: win.getIcon() || (def && def.icon) || win.appId, minimized: min, status: min ? 'Simge durumunda' : 'Etkin',
          title: win.getTitle() || '', size: `${b.width} × ${b.height}`, pos: `${b.x}, ${b.y}`, w: b.width * 100000 + b.height, x: b.x * 100000 + b.y
        };
      });
      if (q) rows = rows.filter((r) => lower(r.name).includes(q) || lower(r.title).includes(q) || String(r.pid).includes(q));
      const dir = s.dsort.dir === 'asc' ? 1 : -1;
      const k = s.dsort.key;
      rows.sort((a, b) => {
        let r;
        switch (k) {
          case 'pid': r = a.pid - b.pid; break;
          case 'size': r = a.w - b.w; break;
          case 'pos': r = a.x - b.x; break;
          case 'state': r = (a.minimized ? 1 : 0) - (b.minimized ? 1 : 0); break;
          case 'title': r = U.compareNames(a.title, b.title); break;
          default: r = U.compareNames(a.name, b.name); break;
        }
        return r === 0 ? a.pid - b.pid : r * dir;
      });
      this.dGrid.setSort(s.dsort);
      this.dGrid.update(rows, {
        freeze: this.frozen() || this.menuOpen(),
        empty: { title: q ? 'Eşleşen pencere yok' : 'Açık pencere yok', sub: q ? '“' + this.state.query + '” için sonuç bulunamadı.' : '' }
      });
      setText(this.dStat1, `${NF0.format(rows.length)} pencere`);
      setText(this.dStat2, s.speed === 'paused' ? 'Güncelleme duraklatıldı' : 'Güncelleme hızı: ' + SPEEDS[s.speed].label);
    }

    // ------------------------------------------------------------ performance page
    chartTheme() {
      if (!this._th) {
        let acc = '#2f9e6b';
        try { acc = getComputedStyle(this.win.body).getPropertyValue('--accent').trim() || acc; } catch (e) { /* default */ }
        this._th = { rgb: rgbOf(acc), dark: !P.theme || P.theme.get() === 'dark' };
      }
      return this._th;
    }

    motionOk() {
      if (document.documentElement.classList.contains('no-anim')) return false;
      try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* ignore */ }
      return typeof requestAnimationFrame === 'function';
    }

    wantRaf() {
      return !this.closed && this.state.page === 'performance' && this.state.speed !== 'paused' && this.isVisible() && this.motionOk();
    }

    syncRaf() {
      if (this.raf || !this.wantRaf()) return;
      this.raf = requestAnimationFrame(() => this.guard(this.loopRaf));
    }

    stopRaf() {
      if (this.raf) { try { cancelAnimationFrame(this.raf); } catch (e) { /* ignore */ } this.raf = 0; }
    }

    loopRaf() {
      this.raf = 0;
      this.rafLive = true;
      if (!this.wantRaf()) return;
      this.drawMain();
      this.raf = requestAnimationFrame(() => this.guard(this.loopRaf));
    }

    /** The time shown at the right edge: one sample behind while animating so the head can glide in. */
    trNow() {
      const S = this.model.samples;
      const last = S[S.length - 1];
      if (!last) return performance.now();
      if (this.state.speed === 'paused' || !this.rafLive || !this.motionOk()) return last.t;
      return Math.min(last.t, performance.now() - SPEEDS[this.state.speed].ms);
    }

    perfSpec(id) {
      const m = this.model;
      const L = () => m.last || { cpu: 0, mem: 0, memPct: 0, disk: 0, rd: 0, wr: 0, rx: 0, tx: 0 };
      const cores = m.cores.length;
      const usage = () => (P.fs && P.fs.usage ? P.fs.usage() : { used: 0, quota: 1 });
      const heap = () => (performance && performance.memory) || null;
      switch (id) {
        case 'cpu': return {
          title: 'CPU', model: `PandaOS Sanal İşlemci @ ${NF2.format(BASE_GHZ)} GHz`, axis: '% Kullanım', maxLabel: () => '%100',
          series: [{ get: (s) => s.cpu, fill: true }], max: () => 100,
          stats: [
            { label: 'Kullanım', get: () => fmtPct(L().cpu) },
            { label: 'Hız', get: () => NF2.format(ghzOf(L().cpu)) + ' GHz' },
            { label: 'İşlem sayısı', get: () => NF0.format(P.wm.list().length + SYSTEM.length) },
            { label: 'İş parçacığı sayısı', get: () => NF0.format(190 + P.wm.list().length * 13) },
            { label: 'Çalışma süresi', get: () => fmtClock(tracker.uptime()) }
          ],
          info: [
            ['Temel hız', NF2.format(BASE_GHZ) + ' GHz'], ['Çekirdek', String(navigator.hardwareConcurrency || cores)],
            ['Mantıksal işlemci', String(navigator.hardwareConcurrency || cores)], ['Sanallaştırma', 'Etkin'], ['L2 önbellek', '8,0 MB']
          ]
        };
        case 'mem': return {
          title: 'Bellek', model: fmtGB(TOTAL_MEM_MB) + ' PandaOS Sanal Bellek', axis: 'Bellek kullanımı', maxLabel: () => fmtGB(TOTAL_MEM_MB),
          series: [{ get: (s) => s.mem, fill: true }], max: () => TOTAL_MEM_MB, bar: 'mem',
          stats: [
            { label: 'Kullanımda', get: () => `${NF1.format(L().mem / 1024)} / ${NF1.format(TOTAL_MEM_MB / 1024)} GB` },
            { label: 'Kullanılabilir', get: () => fmtGB(TOTAL_MEM_MB - L().mem) },
            { label: 'Kullanım oranı', get: () => fmtPct(L().memPct) },
            { label: 'Önbelleğe alınan', get: () => fmtGB(L().mem * 0.34) },
            heap() ? { label: 'JS yığını (gerçek)', get: () => fmtMB(heap().usedJSHeapSize / 1048576) } : null
          ].filter(Boolean),
          info: [
            ['Toplam', fmtGB(TOTAL_MEM_MB)], ['Hız', '3200 MHz'], ['Yuva kullanımı', '2 / 2'],
            heap() ? ['JS yığın sınırı', fmtMB(heap().jsHeapSizeLimit / 1048576)] : null
          ].filter(Boolean)
        };
        case 'disk': return {
          title: 'Disk', model: 'localStorage · PandaOS dosya sistemi', axis: 'Disk etkinliği (MB/sn)',
          series: [{ get: (s) => s.rd, fill: true }, { get: (s) => s.wr, dash: [4, 3], soft: true }],
          max: (S, tr) => niceMax(Math.max(...S.filter((s) => s.t > tr - HISTORY_MS).map((s) => Math.max(s.rd, s.wr)), 0), 0.5),
          maxLabel: (mx) => fmtRate(mx), bar: 'disk',
          stats: [
            { label: 'Kullanım', get: () => { const u = usage(); return `${U.formatBytes(u.used)} / ${U.formatBytes(u.quota)}`; } },
            { label: 'Doluluk', get: () => { const u = usage(); return fmtPct((u.used / Math.max(1, u.quota)) * 100); } },
            { label: 'Okuma hızı', get: () => fmtRate(L().rd) },
            { label: 'Yazma hızı', get: () => fmtRate(L().wr) },
            { label: 'Dosya sayısı', get: () => NF0.format(this.fsInfo.files) }
          ],
          info: [
            ['Tür', 'localStorage'], ['Klasör sayısı', null, () => NF0.format(this.fsInfo.dirs)],
            ['Çöp kutusu', null, () => NF0.format(P.fs && P.fs.trashCount ? P.fs.trashCount() : 0) + ' öğe'],
            ['Kota', null, () => U.formatBytes(usage().quota)]
          ]
        };
        default: return {
          title: 'Ağ', model: 'PandaOS Sanal Ağ (Wi-Fi)', axis: 'Ağ üretilen iş hacmi',
          series: [{ get: (s) => s.rx, fill: true }, { get: (s) => s.tx, dash: [4, 3], soft: true }],
          max: (S, tr) => niceMax(Math.max(...S.filter((s) => s.t > tr - HISTORY_MS).map((s) => Math.max(s.rx, s.tx)), 0), 50),
          maxLabel: (mx) => fmtKBs(mx),
          stats: [
            { label: 'Alma', get: () => fmtKBs(L().rx) },
            { label: 'Gönderme', get: () => fmtKBs(L().tx) },
            { label: 'Toplam alınan', get: () => fmtMB(m.net.totalRx / 1024) },
            { label: 'Toplam gönderilen', get: () => fmtMB(m.net.totalTx / 1024) }
          ],
          info: [
            ['Bağdaştırıcı', 'PandaOS Sanal Ağ'], ['Bağlantı türü', 'Wi-Fi'],
            ['Durum', null, () => (navigator.onLine === false ? 'Bağlı değil' : 'Bağlı')],
            ['IPv4 adresi', '192.168.1.42'],
            navigator.connection && navigator.connection.effectiveType ? ['Bağlantı kalitesi', null, () => String(navigator.connection.effectiveType).toUpperCase()] : null
          ].filter(Boolean)
        };
      }
    }

    buildDetail() {
      const id = this.state.res;
      const spec = (this.spec = this.perfSpec(id));
      this._specRes = id;
      this._specView = this.state.cpuView;
      for (const r of RES) {
        const on = r.id === id;
        this.resBtns[r.id].classList.toggle('active', on);
        this.resBtns[r.id].setAttribute('aria-selected', String(on));
        this.resBtns[r.id].tabIndex = on ? 0 : -1;
      }
      setText(this.dTitle, spec.title);
      setText(this.dModel, spec.model);
      setText(this.axisLeft, spec.axis);
      this.viewSeg.hidden = id !== 'cpu';
      this.viewSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === this.state.cpuView));
      const cores = id === 'cpu' && this.state.cpuView === 'cores';
      this.mainCv.hidden = cores;
      this.coreGrid.hidden = !cores;
      this.plotArea.classList.toggle('is-cores', cores);
      this.axisMax.hidden = cores;
      this.mainCv.setAttribute('aria-label', `${spec.title} grafiği, son 60 saniye`);
      if (cores) {
        const n = this.model.cores.length;
        this.coreGrid.style.setProperty('--cols', String(n <= 2 ? n : n <= 6 ? Math.ceil(n / 2) : n <= 12 ? Math.ceil(n / 3) : 4));
        this.coreGrid.replaceChildren();
        this.cores = [];
        for (let i = 0; i < n; i++) {
          const cv = el('canvas', { class: 'tm-corecv', 'aria-hidden': 'true' });
          this.coreGrid.appendChild(el('div', { class: 'tm-core' }, cv, el('span', { class: 'tm-core-lab', text: 'CPU ' + i })));
          this.cores.push(new Chart(cv));
        }
      }
      // extra bar
      this.extraEl.replaceChildren();
      this.bars = null;
      if (spec.bar === 'mem') {
        const seg = (c) => el('i', { class: 'tm-seg ' + c });
        this.bars = { used: seg('used'), cache: seg('cache') };
        this.extraEl.append(
          el('div', { class: 'tm-barlab' }, el('span', { text: 'Bellek bileşimi' })),
          el('div', { class: 'tm-membar', role: 'img', 'aria-label': 'Bellek bileşimi' }, this.bars.used, this.bars.cache),
          el('div', { class: 'tm-legend' },
            el('span', {}, el('i', { class: 'tm-sw used' }), 'Kullanımda'),
            el('span', {}, el('i', { class: 'tm-sw cache' }), 'Önbelleğe alınan'),
            el('span', {}, el('i', { class: 'tm-sw free' }), 'Boş')));
      } else if (spec.bar === 'disk') {
        const fill = el('i', { class: 'tm-seg used' });
        this.bars = { fill };
        this.extraEl.append(
          el('div', { class: 'tm-barlab' }, el('span', { text: 'Kullanılan alan' })),
          el('div', { class: 'tm-membar', role: 'img', 'aria-label': 'Disk doluluğu' }, fill));
      }
      // stats
      this.statsEl.replaceChildren();
      this.statEls = spec.stats.map((st) => {
        const v = el('span', { class: 'tm-stat-v' });
        this.statsEl.appendChild(el('div', { class: 'tm-stat' }, el('span', { class: 'tm-stat-k', text: st.label }), v));
        return v;
      });
      this.infoEl.replaceChildren();
      this.infoVals = spec.info.map((row) => {
        const dd = el('span', { class: 'v', text: row[1] == null ? '' : row[1] });
        this.infoEl.appendChild(el('div', { class: 'tm-irow' }, el('span', { class: 'k', text: row[0] }), dd));
        return { dd, get: row[2] };
      });
    }

    renderPerf() {
      if (!this.spec || this._specRes !== this.state.res || this._specView !== this.state.cpuView) {
        this._specRes = this.state.res;
        this._specView = this.state.cpuView;
        this.buildDetail();
      }
      const S = this.model.samples;
      const L = this.model.last;
      if (!L) return;
      const th = this.chartTheme();
      // resource list
      const u = P.fs && P.fs.usage ? P.fs.usage() : { used: 0, quota: 1 };
      const subs = {
        cpu: `${fmtPct(L.cpu)} · ${NF2.format(ghzOf(L.cpu))} GHz`,
        mem: `${NF1.format(L.mem / 1024)}/${NF1.format(TOTAL_MEM_MB / 1024)} GB (${fmtPct0(L.memPct)})`,
        disk: `${U.formatBytes(u.used)} / ${U.formatBytes(u.quota)} (${fmtPct0((u.used / Math.max(1, u.quota)) * 100)})`,
        net: `G: ${fmtKBs(L.tx)}
A: ${fmtKBs(L.rx)}`
      };
      const sparkTr = S[S.length - 1].t;
      const sparkSeries = {
        cpu: [{ get: (s) => s.cpu, fill: true }], mem: [{ get: (s) => s.mem, fill: true }],
        disk: [{ get: (s) => s.rd + s.wr, fill: true }], net: [{ get: (s) => s.rx, fill: true }]
      };
      const sparkMax = {
        cpu: 100, mem: TOTAL_MEM_MB,
        disk: niceMax(Math.max(...S.map((s) => s.rd + s.wr), 0), 0.5),
        net: niceMax(Math.max(...S.map((s) => s.rx), 0), 50)
      };
      for (const r of RES) {
        setText(this.resSubs[r.id], subs[r.id]);
        this.sparks[r.id].draw(S, sparkSeries[r.id], { max: sparkMax[r.id], tr: sparkTr, theme: th, spark: true });
      }
      // stats
      this.spec.stats.forEach((st, i) => setText(this.statEls[i], st.get()));
      this.infoVals.forEach((iv) => { if (iv.get) setText(iv.dd, iv.get()); });
      if (this.bars) {
        if (this.bars.used && this.bars.cache) {
          this.bars.used.style.width = (L.memPct).toFixed(1) + '%';
          this.bars.cache.style.width = Math.min(100 - L.memPct, L.memPct * 0.34).toFixed(1) + '%';
        } else if (this.bars.fill) {
          this.bars.fill.style.width = clamp((u.used / Math.max(1, u.quota)) * 100, 0, 100).toFixed(1) + '%';
        }
      }
      this.drawMain();
    }

    drawMain() {
      if (this.closed || !this.spec || this.state.page !== 'performance') return;
      const S = this.model.samples;
      if (!S.length) return;
      const th = this.chartTheme();
      const tr = this.trNow();
      if (this.state.res === 'cpu' && this.state.cpuView === 'cores') {
        this.cores.forEach((ch, i) => ch.draw(S, [{ get: (s) => s.cores[i] || 0, fill: true }], { max: 100, tr, theme: th, grid: true, rows: 4 }));
        return;
      }
      const mx = this.spec.max(S, tr);
      this.mainChart.draw(S, this.spec.series, { max: mx, tr, theme: th, grid: true });
      if (this.spec.maxLabel) setText(this.axisMax, this.spec.maxLabel(mx));
    }

    drawAll() {
      if (this.closed || !this.isVisible()) return;
      this.render();
    }

    scanFs() {
      try {
        let files = 0; let dirs = 0;
        if (P.fs && P.fs.walk) {
          P.fs.walk('/', (st) => { if (st.type === 'dir') dirs++; else files++; });
        }
        this.fsInfo = { files, dirs };
      } catch (e) { /* keep the previous numbers */ }
    }

    // ------------------------------------------------------------ actions
    targetsOf(key) {
      if (!key) return [];
      if (key.startsWith('app:')) return P.wm.byApp(key.slice(4));
      if (key.startsWith('win:')) { const w = P.wm.get(key.slice(4)); return w ? [w] : []; }
      return [];
    }

    currentGrid() {
      const p = this.state.page;
      return p === 'processes' ? this.pGrid : p === 'details' ? this.dGrid : p === 'history' ? this.hGrid : null;
    }

    canEnd(key) {
      return !!key && (key.startsWith('app:') || key.startsWith('win:'));
    }

    syncButtons() {
      if (this.btnEnd) this.btnEnd.disabled = !this.canEnd(this.pGrid.selected);
      if (this.btnEnd2) this.btnEnd2.disabled = !this.canEnd(this.dGrid.selected);
    }

    endSelected() {
      const g = this.currentGrid();
      if (g && g.selected) this.endTask(this.targetsOf(g.selected));
    }

    async endTask(targets) {
      targets = (targets || []).filter((w) => w && !w.isClosed());
      if (!targets.length) return;
      const dirty = targets.filter((w) => w.dirty === true);
      if (dirty.length && P.dialog && P.dialog.confirm) {
        const def = P.apps.get(dirty[0].appId);
        const name = (def && def.name) || dirty[0].getTitle();
        const ok = await P.dialog.confirm({
          title: 'Görevi sonlandır',
          message: `${name} kaydedilmemiş değişiklikler içeriyor. Görevi sonlandırırsanız bu değişiklikler kaybolur.`,
          okText: 'Sonlandır', danger: true
        });
        if (!ok || this.closed) return;
      }
      targets.forEach((w) => {
        try { w.forceClose(); } catch (e) { console.error('[taskmanager] sonlandırılamadı', e); }
      });
      if (this.closed) return;
      this.render();
      if (!this.win.isMinimized()) this.win.focus();
    }

    bring(targets) {
      const order = P.wm.list();
      targets = targets.filter((w) => w && !w.isClosed()).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      targets.forEach((w) => { if (w.isMinimized()) w.restore(); w.focus(); });
    }

    minimizeTargets(targets) {
      targets.forEach((w) => { if (!w.isClosed() && !w.isMinimized()) w.minimize(); });
    }

    maximizeTargets(targets) {
      const all = targets.every((w) => w.isMaximized());
      const order = P.wm.list();
      targets.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach((w) => {
        if (w.isClosed()) return;
        if (all) { w.restore(); return; }
        if (w.isMinimized()) w.restore();
        w.maximize();
        w.focus();
      });
    }

    activateItem(item) {
      if (item.kind === 'section') return;
      if (item.system) return;
      if (item.canExpand) { this.toggleItem(item); return; }
      this.bring(this.targetsOf(item.key));
    }

    toggleItem(item) {
      const s = this.state;
      if (item.kind === 'section') s.collapsed[item.section] = !s.collapsed[item.section];
      else if (item.canExpand) {
        if (s.expanded.has(item.appId)) s.expanded.delete(item.appId); else s.expanded.add(item.appId);
      } else return;
      this.save();
      this.pressed = false;
      this.unfreezeOnce = true;
      this.render();
    }

    rowMenu(item, e) {
      if (!P.contextMenu) return;
      if (item.system) {
        P.contextMenu.show(e, [{ label: 'Görevi sonlandır', icon: 'close', disabled: true, danger: true }]);
        return;
      }
      const targets = this.targetsOf(item.key);
      if (!targets.length) return;
      const allMin = targets.every((w) => w.isMinimized());
      const allMax = targets.every((w) => w.isMaximized());
      const canMin = targets.some((w) => w.minimizable && !w.isMinimized());
      const canMax = targets.some((w) => w.maximizable);
      P.contextMenu.show(e, [
        { label: 'Öne getir', icon: 'external', action: () => this.bring(targets) },
        { label: 'Simge durumuna küçült', icon: 'minimize', disabled: !canMin || allMin, action: () => this.minimizeTargets(targets) },
        { label: allMax ? 'Önceki boyuta getir' : 'Ekranı kapla', icon: allMax ? 'restore' : 'maximize', disabled: !canMax, action: () => this.maximizeTargets(targets) },
        item.canExpand ? { label: item.expanded ? 'Daralt' : 'Genişlet', icon: item.expanded ? 'chevron-up' : 'chevron-down', action: () => this.toggleItem(item) } : null,
        { type: 'separator' },
        { label: 'Görevi sonlandır', icon: 'close', danger: true, action: () => this.endTask(targets) }
      ]);
    }

    async runNewTask() {
      if (!P.dialog || !P.dialog.prompt) return;
      const q = await P.dialog.prompt({
        title: 'Yeni görev çalıştır', message: 'Açmak istediğiniz uygulamanın adını yazın.', placeholder: 'Örn. Not Defteri',
        okText: 'Çalıştır', validate: (v) => (findApp(v) ? null : 'Bu adla bir uygulama bulunamadı.')
      });
      if (q == null) return;
      const def = findApp(q);
      if (def) P.apps.launch(def.id);
    }

    async resetHistory() {
      if (!P.dialog || !P.dialog.confirm) { tracker.reset(false); this.render(); return; }
      const ok = await P.dialog.confirm({
        title: 'Geçmişi sıfırla', message: 'Bu oturumdaki başlatma sayıları ve açık kalma süreleri silinecek.',
        okText: 'Sıfırla', danger: true
      });
      if (!ok || this.closed) return;
      tracker.reset(false);
      this.render();
    }

    // ------------------------------------------------------------ teardown
    destroy() {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.timer);
      this.timer = 0;
      clearTimeout(this.dirtyTimer);
      clearTimeout(this.fsTimer);
      this.stopRaf();
      this.cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
      this.saveNow();
    }
  }

  // ---------------------------------------------------------------- register
  P.apps.register({
    id: APP_ID,
    name: 'Görev Yöneticisi',
    icon: 'taskmanager',
    description: 'Çalışan uygulamaları ve sistem kaynaklarını izle',
    category: 'system',
    fileTypes: [],
    singleInstance: true,
    showInStartMenu: true,
    window: { width: 780, height: 540, minWidth: 560, minHeight: 380 },
    launch(win, args) {
      new TaskManager(win, args || {});
    },
    relaunch(win, args) {
      const tm = win.state && win.state.tm;
      if (tm && args && args.page) tm.go(args.page);
    }
  });
})();
