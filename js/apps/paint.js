/* Çizim (Paint) — PandaOS drawing app.
   Ribbon (file actions, tools, shapes, size, colours, history), scrollable workspace with a resizable
   canvas, status bar, undo/redo with patch-based history, flood fill, text tool, PNG open / save,
   "set as wallpaper". All UI text Turkish; state under PandaOS.storage key 'app.paint'. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const U = P.util;
  const el = U.el;
  const clamp = U.clamp;

  const STORE_KEY = 'app.paint';
  const MAX_DIM = 4000;
  const MAX_PIXELS = 9000000;
  const DEFAULT_W = 800;
  const DEFAULT_H = 600;
  const HIST_MAX_STEPS = 100;
  const HIST_MAX_BYTES = 192 * 1024 * 1024;
  const ZOOM_STEPS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4;
  const FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Arial, sans-serif';
  const LOST = { lost: true }; // sentinel: the saved state is no longer reachable through the history

  // 28 colours, 14 x 2
  const PALETTE = [
    '#000000', '#4d4d4d', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200',
    '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#e0498f', '#0ea5a4', '#8a5a2b',
    '#ffffff', '#e6e6e6', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0',
    '#b5e61d', '#99d9ea', '#7092bd', '#c8bfe7', '#ff9d8f', '#9be7c4', '#d9b99b'
  ];

  const TOOLS = {
    pencil: { name: 'Kalem', icon: 'pencil', key: 'P', group: 'pencil', hint: 'Sert kenarlı, 1 piksellik çizgi' },
    brush: { name: 'Fırça', icon: 'brush', key: 'B', group: 'brush', hint: 'Yumuşak, yuvarlak fırça darbeleri' },
    eraser: { name: 'Silgi', icon: 'eraser', key: 'E', group: 'eraser', hint: 'İkincil renkle üzerini boyar' },
    bucket: { name: 'Kova', icon: 'bucket', key: 'G', group: null, hint: 'Alanı seçili renkle doldurur' },
    dropper: { name: 'Damlalık', icon: 'dropper', key: 'I', group: null, hint: 'Tuvalden renk seçer (sağ tık: ikincil)' },
    text: { name: 'Metin', icon: 'text', key: 'T', group: 'text', hint: 'Tuvale yazı yazar, Enter ile uygular' },
    line: { name: 'Çizgi', icon: 'line', key: 'L', group: 'shape', shape: true, hint: 'Düz çizgi, Shift: 45° adımlar' },
    rect: { name: 'Dikdörtgen', icon: 'rect', key: 'R', group: 'shape', shape: true, hint: 'Shift: kare' },
    ellipse: { name: 'Elips', icon: 'ellipse', key: 'O', group: 'shape', shape: true, hint: 'Shift: daire' },
    rrect: { name: 'Yuvarlak dikdörtgen', icon: 'rrect', key: 'U', group: 'shape', shape: true, hint: 'Shift: yuvarlak kare' },
    arrow: { name: 'Ok', icon: 'arrow', key: 'A', group: 'shape', shape: true, hint: 'Ok işareti, Shift: 45° adımlar' }
  };
  const TOOL_ORDER = ['pencil', 'brush', 'eraser', 'bucket', 'dropper', 'text'];
  const SHAPE_ORDER = ['line', 'rect', 'ellipse', 'rrect', 'arrow'];
  const KEY_TO_TOOL = {};
  Object.keys(TOOLS).forEach((id) => { KEY_TO_TOOL[TOOLS[id].key.toLowerCase()] = id; });

  const DEFAULT_PREFS = {
    tool: 'brush',
    sizes: { brush: 6, eraser: 18, shape: 3, text: 24 },
    primary: '#000000',
    secondary: '#ffffff',
    fill: 'outline',
    tolerance: 30,
    collapsed: false
  };

  // ------------------------------------------------------------------ icons
  const SVG_ATTR = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
  const GLYPHS = {
    dropper: '<path d="M20.5 3.5a2.5 2.5 0 0 0-3.5 0l-3 3-1-1-2 2 1 1-7.3 7.3a2 2 0 0 0-.55 1.1L4 20l.2.1.9-.1L5 20l4.1-.1a2 2 0 0 0 1.1-.55L17.5 12l1 1 2-2-1-1 1-1a2.5 2.5 0 0 0 0-3.5z"/><path d="M6 17.5l5.5-5.5"/>',
    text: '<path d="M5 7.5V5.5h14v2"/><path d="M12 5.5V19"/><path d="M9 19h6"/>',
    rrect: '<rect x="3.5" y="6" width="17" height="12" rx="5"/>',
    arrow: '<path d="M5.5 18.5L18 6"/><path d="M9.5 6H18v8.5"/>',
    pointer: '<path d="M5.5 3.8l12.7 6.3-5.4 1.7-1.8 5.6z"/>',
    swap: '<path d="M7 4L3.5 7.5 7 11"/><path d="M3.5 7.5H14"/><path d="M17 13l3.5 3.5L17 20"/><path d="M20.5 16.5H10"/>',
    'fill-outline': '<rect x="4" y="6" width="16" height="12" rx="2.2"/>',
    'fill-solid': '<rect x="4" y="6" width="16" height="12" rx="2.2" fill="currentColor"/>',
    'fill-both': '<rect x="4" y="6" width="16" height="12" rx="2.2" fill="currentColor" fill-opacity=".34"/>',
    'save-as': '<path d="M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10.2a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V11"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/><path d="M7 21v-6a1 1 0 0 1 1-1h3"/><path d="M18 14.5v7M14.5 18h7"/>',
    wallpaper: '<rect x="3" y="4" width="18" height="12.5" rx="2.2"/><path d="M8 20.5h8M12 16.5v4"/><circle cx="9" cy="9.2" r="1.4"/><path d="M21 13.3l-4-3.8a1.4 1.4 0 0 0-1.9 0L8 16"/>',
    flip: '<path d="M12 3.5v17"/><path d="M8.5 7L3.5 17H8.5z"/><path d="M15.5 7l5 10h-5z"/>',
    rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5"/><path d="M20 3.5v5h-5"/>',
    canvas: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><path d="M9 12h6M12 9v6"/>',
    eraseall: '<path d="M4 7h16"/><path d="M6 7l.9 11.7a2 2 0 0 0 2 1.8h6.2a2 2 0 0 0 2-1.8L18 7"/><path d="M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/>',
    fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'
  };

  function icon(name) {
    if (GLYPHS[name]) return `<svg ${SVG_ATTR}>${GLYPHS[name]}</svg>`;
    try { return P.icons && P.icons.get ? P.icons.get(name) : ''; } catch (e) { return ''; }
  }

  // ------------------------------------------------------------------ small helpers
  const nf = (n) => Number(n).toLocaleString('tr-TR');
  const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
  const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const fontSpec = (px) => `${px}px ${FONT_STACK}`;
  const newRect = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  function grow(r, x, y, pad) {
    if (x - pad < r.x0) r.x0 = x - pad;
    if (y - pad < r.y0) r.y0 = y - pad;
    if (x + pad > r.x1) r.x1 = x + pad;
    if (y + pad > r.y1) r.y1 = y + pad;
  }

  function cropImage(src, x, y, w, h) {
    const out = new ImageData(w, h);
    const sd = src.data;
    const od = out.data;
    const sw = src.width;
    const rowBytes = w * 4;
    for (let r = 0; r < h; r++) {
      const so = ((y + r) * sw + x) * 4;
      od.set(sd.subarray(so, so + rowBytes), r * rowBytes);
    }
    return out;
  }

  function pasteImage(dst, img, x, y) {
    const dd = dst.data;
    const id = img.data;
    const dw = dst.width;
    const rowBytes = img.width * 4;
    for (let r = 0; r < img.height; r++) {
      dd.set(id.subarray(r * rowBytes, (r + 1) * rowBytes), ((y + r) * dw + x) * 4);
    }
  }

  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    const a32 = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2);
    const b32 = new Uint32Array(b.buffer, b.byteOffset, b.length >> 2);
    for (let i = 0; i < a32.length; i++) if (a32[i] !== b32[i]) return false;
    return true;
  }

  const cloneImage = (img) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);

  /** Scanline flood fill on an ImageData (in place). Returns the changed bounds or null. */
  function floodFill(img, sx, sy, rgb, tol) {
    const W = img.width;
    const H = img.height;
    const d = img.data;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
    const p0 = (sy * W + sx) * 4;
    const tr = d[p0];
    const tg = d[p0 + 1];
    const tb = d[p0 + 2];
    const ta = d[p0 + 3];
    const fr = rgb[0];
    const fg = rgb[1];
    const fb = rgb[2];
    if (tol <= 0 && tr === fr && tg === fg && tb === fb && ta === 255) return null;
    const thr = Math.round(tol * 2.55);
    const visited = new Uint8Array(W * H);
    const match = (i) => Math.abs(d[i] - tr) <= thr && Math.abs(d[i + 1] - tg) <= thr
      && Math.abs(d[i + 2] - tb) <= thr && Math.abs(d[i + 3] - ta) <= thr;
    const stack = [sx, sy];
    let minX = sx;
    let maxX = sx;
    let minY = sy;
    let maxY = sy;
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      const row = y * W;
      let xl = x;
      while (xl >= 0 && !visited[row + xl] && match((row + xl) * 4)) xl--;
      xl++;
      let up = false;
      let down = false;
      for (let xx = xl; xx < W; xx++) {
        const pi = row + xx;
        if (visited[pi] || !match(pi * 4)) break;
        visited[pi] = 1;
        const i = pi * 4;
        d[i] = fr;
        d[i + 1] = fg;
        d[i + 2] = fb;
        d[i + 3] = 255;
        if (xx > maxX) maxX = xx;
        if (xx < minX) minX = xx;
        if (y > 0) {
          const q = pi - W;
          const m = !visited[q] && match(q * 4);
          if (m && !up) { stack.push(xx, y - 1); up = true; } else if (!m) up = false;
        }
        if (y < H - 1) {
          const q = pi + W;
          const m = !visited[q] && match(q * 4);
          if (m && !down) { stack.push(xx, y + 1); down = true; } else if (!m) down = false;
        }
      }
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
  }

  function loadPrefs() {
    const raw = P.storage.get(STORE_KEY, {}) || {};
    const p = JSON.parse(JSON.stringify(DEFAULT_PREFS));
    if (raw && typeof raw === 'object') {
      if (TOOLS[raw.tool]) p.tool = raw.tool;
      if (raw.sizes && typeof raw.sizes === 'object') {
        Object.keys(p.sizes).forEach((k) => {
          const v = Number(raw.sizes[k]);
          if (v >= 1 && v <= 64) p.sizes[k] = Math.round(v);
        });
      }
      if (isHex(raw.primary)) p.primary = raw.primary.toLowerCase();
      if (isHex(raw.secondary)) p.secondary = raw.secondary.toLowerCase();
      if (['outline', 'fill', 'both'].includes(raw.fill)) p.fill = raw.fill;
      const tol = Number(raw.tolerance);
      if (tol >= 0 && tol <= 100) p.tolerance = Math.round(tol);
      p.collapsed = !!raw.collapsed;
    }
    return p;
  }

  // ================================================================== app
  function launch(win, args) {
    args = args || {};
    const fs = P.fs;
    const prefs = loadPrefs();
    const offs = [];
    const timers = new Set();
    let closed = false;

    const later = (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); if (!closed) fn(); }, ms);
      timers.add(id);
      return id;
    };
    const tip = (node, text) => {
      const f = P.ui && P.ui.tip;
      if (!f) return;
      try { offs.push(f(node, text)); } catch (e) { /* tooltips are cosmetic */ }
    };
    const savePrefs = () => P.storage.set(STORE_KEY, prefs);
    const safe = (fn) => (...a) => {
      try {
        const r = fn(...a);
        if (r && typeof r.then === 'function') r.catch((e) => console.error('[paint]', e));
        return r;
      } catch (e) {
        console.error('[paint]', e);
        return undefined;
      }
    };

    // ---------------------------------------------------------------- state
    const doc = { w: DEFAULT_W, h: DEFAULT_H, path: null };
    let zoom = 1;
    let base = null;           // ImageData of the last committed canvas state
    const hist = [];
    let histIdx = 0;
    let savedEntry = null;
    let extraDirty = false;
    let dirtyFlag = false;
    let drag = null;
    let textEdit = null;
    let sheetApi = null;
    let hoverPos = null;
    let msgTimer = 0;
    const toolBtns = {};

    // ---------------------------------------------------------------- DOM: command bar
    const root = el('div', { class: 'pt-root' });
    win.body.appendChild(root);

    function cmdBtn(iconName, label, tipText, onClick) {
      const b = el('button', { class: 'p-btn ghost pt-cmd', type: 'button', 'aria-label': tipText.split('\n')[0], on: { click: safe(onClick) } });
      b.innerHTML = icon(iconName);
      if (label) b.appendChild(el('span', { class: 'pt-cmd-label', text: label }));
      tip(b, tipText);
      return b;
    }

    const btnNew = cmdBtn('file-plus', 'Yeni', 'Yeni\nBoş bir resim oluşturur', () => cmdNew());
    const btnOpen = cmdBtn('open', 'Aç', 'Aç\nBir PNG dosyası açar (Ctrl+O)', () => cmdOpen());
    const btnSave = cmdBtn('save', 'Kaydet', 'Kaydet\nResmi kaydeder (Ctrl+S)', () => cmdSave());
    const btnSaveAs = cmdBtn('save-as', 'Farklı kaydet', 'Farklı kaydet\nYeni bir dosya adıyla kaydeder (Ctrl+Shift+S)', () => cmdSaveAs());
    const btnWall = cmdBtn('wallpaper', 'Arka plan yap', 'Arka plan yap\nResmi masaüstü arka planı yapar', () => cmdWallpaper());
    const btnUndo = cmdBtn('undo', 'Geri al', 'Geri al\nCtrl+Z', () => undo());
    const btnRedo = cmdBtn('redo', 'Yinele', 'Yinele\nCtrl+Y', () => redo());
    const btnMore = cmdBtn('more', '', 'Daha fazla\nTuval işlemleri', () => showMoreMenu());
    btnMore.classList.add('pt-more');
    const btnRibbon = cmdBtn('chevron-up', '', 'Araç şeridini daralt', () => toggleRibbon());
    btnRibbon.classList.add('pt-ribbon-toggle');

    const group = (label, ...kids) => el('div', { class: 'pt-cgroup', role: 'group', 'aria-label': label }, ...kids);
    const cmdbar = el('div', { class: 'pt-cmdbar' },
      group('Dosya', btnNew, btnOpen, btnSave, btnSaveAs, btnWall),
      el('span', { class: 'pt-vsep', role: 'separator' }),
      group('Geçmiş', btnUndo, btnRedo),
      el('span', { class: 'pt-vsep', role: 'separator' }),
      btnMore,
      el('span', { class: 'pt-spacer' }),
      btnRibbon);

    // ---------------------------------------------------------------- DOM: ribbon
    function toolBtn(id) {
      const t = TOOLS[id];
      const b = el('button', {
        class: 'pt-tool',
        type: 'button',
        'aria-label': t.name,
        'aria-pressed': 'false',
        dataset: { tool: id },
        on: { click: safe(() => setTool(id)) }
      });
      b.innerHTML = icon(t.icon);
      tip(b, `${t.name} (${t.key})\n${t.hint}`);
      toolBtns[id] = b;
      return b;
    }

    const fillBtns = {};
    const fillSeg = el('div', { class: 'p-segmented pt-fillseg', role: 'group', 'aria-label': 'Dolgu' });
    [['outline', 'fill-outline', 'Yalnızca çerçeve'], ['fill', 'fill-solid', 'Yalnızca dolgu'], ['both', 'fill-both', 'Çerçeve ve dolgu']].forEach(([mode, ic, label]) => {
      const b = el('button', { type: 'button', 'aria-label': label, dataset: { fill: mode }, on: { click: safe(() => setFill(mode)) } });
      b.innerHTML = icon(ic);
      tip(b, `Dolgu: ${label}`);
      fillBtns[mode] = b;
      fillSeg.appendChild(b);
    });

    const sizeDot = el('span', { class: 'pt-dot' });
    const sizeDotBox = el('span', { class: 'pt-dotbox', 'aria-hidden': 'true' }, sizeDot);
    const sizeRange = el('input', { class: 'p-range pt-size', type: 'range', min: '1', max: '64', step: '1', 'aria-label': 'Boyut' });
    sizeRange.value = '6';
    const sizeVal = el('output', { class: 'pt-val', 'aria-live': 'off' });
    const tolRange = el('input', { class: 'p-range pt-tol', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Tolerans' });
    tolRange.value = String(prefs.tolerance);
    const tolVal = el('output', { class: 'pt-val' });
    tip(sizeRange, 'Boyut\nFırça, silgi, çizgi kalınlığı ve yazı boyutu ([ ve ])');
    tip(tolRange, 'Tolerans\nKova aracının benzer renkleri ne kadar doldurduğu');

    const swPrimaryInput = el('input', { type: 'color', class: 'pt-colorinput', 'aria-label': 'Birincil renk' });
    const swSecondaryInput = el('input', { type: 'color', class: 'pt-colorinput', 'aria-label': 'İkincil renk' });
    const swPrimary = el('label', { class: 'pt-sw pt-sw-primary' }, swPrimaryInput);
    const swSecondary = el('label', { class: 'pt-sw pt-sw-secondary' }, swSecondaryInput);
    tip(swPrimary, 'Birincil renk\nSol tuşla çizer; rengi değiştirmek için tıklayın');
    tip(swSecondary, 'İkincil renk\nSağ tuşla çizer; rengi değiştirmek için tıklayın');
    const swapBtn = el('button', { class: 'pt-swap', type: 'button', 'aria-label': 'Renkleri değiştir', on: { click: safe(() => swapColors()) } });
    swapBtn.innerHTML = icon('swap');
    tip(swapBtn, 'Renkleri değiştir (X)');
    const swStack = el('div', { class: 'pt-swstack' }, swSecondary, swPrimary, swapBtn);

    const paletteEl = el('div', { class: 'pt-palette', role: 'group', 'aria-label': 'Renk paleti' });
    PALETTE.forEach((hex) => {
      const b = el('button', {
        class: 'pt-color',
        type: 'button',
        'aria-label': hex,
        dataset: { color: hex },
        style: { background: hex },
        on: {
          click: safe(() => setColor('primary', hex)),
          contextmenu: (e) => { e.preventDefault(); safe(() => setColor('secondary', hex))(); }
        }
      });
      paletteEl.appendChild(b);
    });
    tip(paletteEl, () => 'Renk paleti\nSol tık: birincil, sağ tık: ikincil renk');
    const customInput = el('input', { type: 'color', class: 'pt-colorinput', 'aria-label': 'Özel renk' });
    const customBtn = el('label', { class: 'pt-custom' }, customInput);
    customBtn.insertAdjacentHTML('afterbegin', icon('plus'));
    tip(customBtn, 'Özel renk\nBirincil rengi özel bir renkle değiştirir');

    function rgroup(label, body) {
      return el('div', { class: 'pt-group', role: 'group', 'aria-label': label },
        el('div', { class: 'pt-gbody' }, body),
        el('div', { class: 'pt-gcap', text: label }));
    }

    const ribbon = el('div', { class: 'pt-ribbon' },
      rgroup('Araçlar', el('div', { class: 'pt-grid3' }, TOOL_ORDER.map(toolBtn))),
      rgroup('Şekiller', el('div', { class: 'pt-shapes' },
        el('div', { class: 'pt-shaperow' }, SHAPE_ORDER.map(toolBtn)),
        el('div', { class: 'pt-fillrow' }, el('span', { class: 'pt-mini', text: 'Dolgu' }), fillSeg))),
      rgroup('Boyut', el('div', { class: 'pt-sizes' },
        el('div', { class: 'pt-srow' }, sizeDotBox, sizeRange, sizeVal),
        el('div', { class: 'pt-srow pt-trow' }, el('span', { class: 'pt-mini', text: 'Tolerans' }), tolRange, tolVal))),
      rgroup('Renkler', el('div', { class: 'pt-colors' }, swStack, paletteEl, customBtn)));

    // ---------------------------------------------------------------- DOM: workspace
    const cv = el('canvas', { class: 'pt-canvas', role: 'img', 'aria-label': 'Çizim tuvali' });
    const ov = el('canvas', { class: 'pt-overlay', 'aria-hidden': 'true' });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const octx = ov.getContext('2d');
    const ring = el('div', { class: 'pt-ring', 'aria-hidden': 'true' });
    const ghost = el('div', { class: 'pt-ghost', 'aria-hidden': 'true' });
    const handles = ['se', 'e', 's'].map((dir) => el('div', { class: 'pt-handle pt-h-' + dir, dataset: { dir }, 'aria-hidden': 'true' }));
    const sheet = el('div', { class: 'pt-sheet' }, cv, ov, ring, ghost, handles);
    const frame = el('div', { class: 'pt-frame' }, sheet);
    const work = el('div', { class: 'pt-work', tabindex: '-1' }, frame);
    tip(handles[0], 'Tuvali yeniden boyutlandır');
    tip(handles[1], 'Tuval genişliği');
    tip(handles[2], 'Tuval yüksekliği');

    // ---------------------------------------------------------------- DOM: status bar
    const posText = el('span', { class: 'pt-st pt-pos' });
    const posIcon = el('span', { class: 'pt-sticon', html: icon('pointer'), 'aria-hidden': 'true' });
    posIcon.style.visibility = 'hidden';
    const sizeIcon = el('span', { class: 'pt-sticon', html: icon('canvas'), 'aria-hidden': 'true' });
    const sizeBtn = el('button', { class: 'pt-st pt-sizebtn', type: 'button', on: { click: safe(() => cmdCanvasSize()) } });
    tip(sizeBtn, 'Tuval boyutu\nDeğiştirmek için tıklayın');
    const msgText = el('span', { class: 'pt-st pt-msg', role: 'status' });
    const toolText = el('span', { class: 'pt-st pt-toolname' });
    const zoomOutBtn = el('button', { class: 'pt-stbtn', type: 'button', 'aria-label': 'Uzaklaştır', on: { click: safe(() => zoomBy(-1)) } });
    zoomOutBtn.innerHTML = icon('zoom-out');
    const zoomInBtn = el('button', { class: 'pt-stbtn', type: 'button', 'aria-label': 'Yakınlaştır', on: { click: safe(() => zoomBy(1)) } });
    zoomInBtn.innerHTML = icon('zoom-in');
    const zoomLabel = el('button', { class: 'pt-stbtn pt-zoomlabel', type: 'button', 'aria-label': 'Yakınlaştırma düzeyi', on: { click: safe((e) => showZoomMenu(e.currentTarget)) } });
    const zoomRange = el('input', { class: 'p-range pt-zoomrange', type: 'range', min: '0', max: String(ZOOM_STEPS.length - 1), step: '1', 'aria-label': 'Yakınlaştırma' });
    tip(zoomOutBtn, 'Uzaklaştır (Ctrl+-)');
    tip(zoomInBtn, 'Yakınlaştır (Ctrl++)');
    tip(zoomLabel, 'Yakınlaştırma\nSeçenekler için tıklayın');
    const statusbar = el('div', { class: 'p-statusbar pt-status' },
      el('span', { class: 'pt-stgroup' }, posIcon, posText), el('span', { class: 'pt-stgroup' }, sizeIcon, sizeBtn), msgText, el('span', { class: 'spacer' }), toolText,
      el('span', { class: 'pt-zoombox' }, zoomOutBtn, zoomRange, zoomInBtn, zoomLabel));

    root.append(cmdbar, ribbon, work, statusbar);

    // ---------------------------------------------------------------- canvas / document
    function setCanvasSize(w, h) {
      doc.w = w;
      doc.h = h;
      cv.width = w;
      cv.height = h;
      ov.width = w;
      ov.height = h;
      applyZoomStyle();
    }

    function applyZoomStyle() {
      sheet.style.width = Math.round(doc.w * zoom) + 'px';
      sheet.style.height = Math.round(doc.h * zoom) + 'px';
      sheet.classList.toggle('pt-pixel', zoom >= 2);
    }

    function updateStatus() {
      sizeBtn.textContent = `${nf(doc.w)} × ${nf(doc.h)} px`;
      toolText.textContent = TOOLS[prefs.tool].name;
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      let idx = 0;
      let best = Infinity;
      ZOOM_STEPS.forEach((s, i) => { const d = Math.abs(s - zoom); if (d < best) { best = d; idx = i; } });
      zoomRange.value = String(idx);
      zoomOutBtn.disabled = zoom <= ZOOM_MIN + 1e-6;
      zoomInBtn.disabled = zoom >= ZOOM_MAX - 1e-6;
    }

    function resetDoc(w, h, o) {
      o = o || {};
      cancelText();
      drag = null;
      setCanvasSize(w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      if (typeof o.draw === 'function') o.draw(ctx);
      base = ctx.getImageData(0, 0, w, h);
      octx.clearRect(0, 0, w, h);
      hist.length = 0;
      histIdx = 0;
      savedEntry = null;
      extraDirty = !!o.dirty;
      doc.path = o.path || null;
      zoom = 1;
      applyZoomStyle();
      work.scrollLeft = 0;
      work.scrollTop = 0;
      updateStatus();
      refreshState();
    }

    // ---------------------------------------------------------------- history
    function pushHistory(entry) {
      hist.length = histIdx;
      if (savedEntry && savedEntry !== LOST && hist.indexOf(savedEntry) < 0) savedEntry = LOST;
      hist.push(entry);
      histIdx = hist.length;
      let total = 0;
      for (const h of hist) total += h.bytes;
      while ((hist.length > HIST_MAX_STEPS || total > HIST_MAX_BYTES) && hist.length > 1) {
        const old = hist.shift();
        total -= old.bytes;
        histIdx--;
        if (savedEntry === null) savedEntry = LOST;
        else if (savedEntry === old) savedEntry = null;
      }
      refreshState();
    }

    /** Records the pixels changed inside `r` (in canvas coordinates) as one undo step. */
    function commitRect(r) {
      const x0 = clamp(Math.floor(r.x0), 0, doc.w);
      const y0 = clamp(Math.floor(r.y0), 0, doc.h);
      const x1 = clamp(Math.ceil(r.x1), 0, doc.w);
      const y1 = clamp(Math.ceil(r.y1), 0, doc.h);
      if (x1 <= x0 || y1 <= y0) return false;
      const w = x1 - x0;
      const h = y1 - y0;
      const after = ctx.getImageData(x0, y0, w, h);
      const before = cropImage(base, x0, y0, w, h);
      if (sameBytes(before.data, after.data)) return false;
      pasteImage(base, after, x0, y0);
      pushHistory({ kind: 'patch', x: x0, y: y0, before, after, bytes: w * h * 8 });
      return true;
    }

    /** Replaces the whole canvas (resize, flip, rotate, clear) as one undo step. */
    function applyFull(w, h, drawFn) {
      cancelText();
      const before = base;
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const g = tmp.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      drawFn(g, cv);
      setCanvasSize(w, h);
      ctx.drawImage(tmp, 0, 0);
      const after = ctx.getImageData(0, 0, w, h);
      base = cloneImage(after);
      pushHistory({ kind: 'full', before, after, bytes: (before.width * before.height + w * h) * 4 });
      updateStatus();
    }

    function applyEntry(entry, useAfter) {
      const img = useAfter ? entry.after : entry.before;
      if (entry.kind === 'full') {
        if (img.width !== doc.w || img.height !== doc.h) setCanvasSize(img.width, img.height);
        ctx.putImageData(img, 0, 0);
        base = cloneImage(img);
        updateStatus();
      } else {
        ctx.putImageData(img, entry.x, entry.y);
        pasteImage(base, img, entry.x, entry.y);
      }
    }

    function undo() {
      if (drag || sheetApi) return;
      commitText();
      if (!histIdx) return;
      histIdx--;
      applyEntry(hist[histIdx], false);
      refreshState();
    }

    function redo() {
      if (drag || sheetApi) return;
      commitText();
      if (histIdx >= hist.length) return;
      applyEntry(hist[histIdx], true);
      histIdx++;
      refreshState();
    }

    function isDirty() {
      const top = histIdx ? hist[histIdx - 1] : null;
      return extraDirty || top !== savedEntry;
    }

    function refreshState() {
      dirtyFlag = isDirty();
      win.dirty = dirtyFlag;
      const name = doc.path ? fs.basename(doc.path) : 'Adsız';
      win.setTitle(`${dirtyFlag ? '• ' : ''}${name} - Çizim`);
      btnUndo.disabled = histIdx === 0;
      btnRedo.disabled = histIdx >= hist.length;
    }

    // ---------------------------------------------------------------- colours / tool / size state
    function setColor(slot, hex) {
      if (!isHex(hex)) return;
      prefs[slot] = hex.toLowerCase();
      syncColors();
      savePrefs();
    }

    function swapColors() {
      const a = prefs.primary;
      prefs.primary = prefs.secondary;
      prefs.secondary = a;
      syncColors();
      savePrefs();
    }

    function syncColors() {
      swPrimary.style.background = prefs.primary;
      swSecondary.style.background = prefs.secondary;
      swPrimaryInput.value = prefs.primary;
      swSecondaryInput.value = prefs.secondary;
      customInput.value = prefs.primary;
      swPrimary.dataset.color = prefs.primary;
      swSecondary.dataset.color = prefs.secondary;
      [...paletteEl.children].forEach((b) => {
        b.classList.toggle('is-primary', b.dataset.color === prefs.primary);
        b.classList.toggle('is-secondary', b.dataset.color === prefs.secondary);
      });
      sizeDot.style.background = prefs.primary;
      if (textEdit) textEdit.input.style.color = textEdit.color;
    }

    function curSize() {
      const g = TOOLS[prefs.tool].group;
      if (g === 'pencil') return 1;
      return g ? prefs.sizes[g] : prefs.sizes.brush;
    }

    function syncSize() {
      const t = TOOLS[prefs.tool];
      const adjustable = t.group && t.group !== 'pencil';
      sizeRange.disabled = !adjustable;
      if (adjustable) sizeRange.value = String(prefs.sizes[t.group]);
      const v = adjustable ? prefs.sizes[t.group] : (t.group === 'pencil' ? 1 : 0);
      sizeVal.textContent = v ? `${v} px` : '—';
      const d = v ? clamp(v, 2, 28) : 0;
      sizeDot.style.width = sizeDot.style.height = d + 'px';
      sizeDot.style.opacity = v ? '1' : '.25';
      tolRange.disabled = prefs.tool !== 'bucket';
      tolVal.textContent = `${prefs.tolerance}%`;
      ribbon.classList.toggle('pt-bucket', prefs.tool === 'bucket');
      moveRing(hoverPos);
    }

    function setSize(v) {
      const t = TOOLS[prefs.tool];
      if (!t.group || t.group === 'pencil') return;
      prefs.sizes[t.group] = clamp(Math.round(Number(v) || 1), 1, 64);
      syncSize();
      savePrefs();
      if (textEdit) restyleTextInput();
    }

    function setFill(mode) {
      if (!fillBtns[mode]) return;
      prefs.fill = mode;
      Object.keys(fillBtns).forEach((m) => fillBtns[m].classList.toggle('active', m === mode));
      savePrefs();
    }

    function setTool(id) {
      if (!TOOLS[id]) return;
      commitText();
      cancelDragShapes();
      prefs.tool = id;
      Object.keys(toolBtns).forEach((k) => {
        const on = k === id;
        toolBtns[k].classList.toggle('active', on);
        toolBtns[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      sheet.dataset.tool = id;
      ribbon.classList.toggle('pt-shape-tool', !!TOOLS[id].shape);
      syncSize();
      updateStatus();
      updateCursor();
      savePrefs();
    }

    function updateCursor() {
      const t = prefs.tool;
      let c = 'crosshair';
      if (t === 'text') c = 'text';
      else if ((t === 'brush' || t === 'eraser') && curSize() * zoom >= 7) c = 'none';
      ov.style.cursor = c;
    }

    function moveRing(p) {
      const t = prefs.tool;
      if (!p || !(t === 'brush' || t === 'eraser') || curSize() * zoom < 7 || sheetApi) {
        ring.style.display = 'none';
        return;
      }
      const d = curSize() * zoom;
      ring.style.width = d + 'px';
      ring.style.height = d + 'px';
      ring.style.left = p.x * zoom + 'px';
      ring.style.top = p.y * zoom + 'px';
      ring.style.display = 'block';
    }

    function toggleRibbon(force) {
      prefs.collapsed = typeof force === 'boolean' ? force : !prefs.collapsed;
      root.classList.toggle('pt-collapsed', prefs.collapsed);
      btnRibbon.innerHTML = icon(prefs.collapsed ? 'chevron-down' : 'chevron-up');
      btnRibbon.setAttribute('aria-label', prefs.collapsed ? 'Araç şeridini genişlet' : 'Araç şeridini daralt');
      btnRibbon.setAttribute('aria-expanded', prefs.collapsed ? 'false' : 'true');
      savePrefs();
    }

    function flash(msg, ms) {
      msgText.textContent = msg;
      clearTimeout(msgTimer);
      msgTimer = later(() => { msgText.textContent = ''; }, ms || 3000);
    }

    // ---------------------------------------------------------------- zoom
    function setZoom(z, anchor) {
      z = clamp(z, ZOOM_MIN, ZOOM_MAX);
      if (Math.abs(z - zoom) < 1e-6) { updateStatus(); return; }
      let docPt = null;
      if (anchor) {
        const r = ov.getBoundingClientRect();
        if (r.width) docPt = { x: (anchor.x - r.left) / r.width * doc.w, y: (anchor.y - r.top) / r.height * doc.h };
      }
      zoom = z;
      applyZoomStyle();
      if (docPt) {
        const r = ov.getBoundingClientRect();
        work.scrollLeft += r.left + docPt.x * zoom - anchor.x;
        work.scrollTop += r.top + docPt.y * zoom - anchor.y;
      }
      if (textEdit) restyleTextInput();
      moveRing(hoverPos);
      updateCursor();
      updateStatus();
    }

    function zoomBy(dir, anchor) {
      let target = zoom;
      if (dir > 0) {
        const next = ZOOM_STEPS.find((s) => s > zoom + 1e-6);
        target = next || ZOOM_MAX;
      } else {
        const prev = [...ZOOM_STEPS].reverse().find((s) => s < zoom - 1e-6);
        target = prev || ZOOM_MIN;
      }
      setZoom(target, anchor);
    }

    function fitZoom() {
      const aw = Math.max(50, work.clientWidth - 72);
      const ah = Math.max(50, work.clientHeight - 72);
      setZoom(Math.min(aw / doc.w, ah / doc.h, 1));
      work.scrollLeft = 0;
      work.scrollTop = 0;
    }

    function showZoomMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      const items = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25].map((z) => ({
        label: `${Math.round(z * 100)}%`,
        checked: Math.abs(zoom - z) < 0.005,
        action: () => setZoom(z)
      }));
      items.push({ type: 'separator' }, { label: 'Pencereye sığdır', icon: icon('fit'), action: () => fitZoom() });
      P.contextMenu.show(r.left, r.top - 4 - items.length * 32, items);
    }

    // ---------------------------------------------------------------- coordinates / hover
    function docPos(e) {
      const r = ov.getBoundingClientRect();
      const sx = r.width ? doc.w / r.width : 1;
      const sy = r.height ? doc.h / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    }

    function updatePos(p) {
      posText.textContent = p ? `${nf(Math.floor(p.x))}, ${nf(Math.floor(p.y))} px` : '';
      posIcon.style.visibility = p ? 'visible' : 'hidden';
    }

    function hover(e) {
      hoverPos = docPos(e);
      updatePos(hoverPos);
      moveRing(hoverPos);
    }

    function leave() {
      if (drag) return;
      hoverPos = null;
      updatePos(null);
      moveRing(null);
    }

    // ---------------------------------------------------------------- pointer plumbing
    function beginDrag(e, d) {
      d.pointerId = e.pointerId;
      d.button = e.button;
      drag = d;
      try { (e.currentTarget || ov).setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer ids have nothing to capture */ }
    }

    function endDrag() {
      const d = drag;
      drag = null;
      if (d) {
        try { ov.releasePointerCapture(d.pointerId); } catch (_) { /* not captured */ }
      }
      return d;
    }

    function cancelDragShapes() {
      if (drag && drag.cancel) {
        const d = endDrag();
        d.cancel();
      }
    }

    function eventPoints(ev) {
      let list = [];
      try { if (typeof ev.getCoalescedEvents === 'function') list = ev.getCoalescedEvents(); } catch (_) { list = []; }
      return list && list.length ? list : [ev];
    }

    function onPointerDown(e) {
      if (closed || sheetApi) return;
      if (e.button !== 0 && e.button !== 2) return;
      if (drag) return;
      e.preventDefault();
      if (P.ui && P.ui.tip && P.ui.tip.hide) P.ui.tip.hide();
      const pos = docPos(e);
      const tool = prefs.tool;
      if (tool !== 'text') commitText();
      if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') startStroke(e, pos, tool);
      else if (TOOLS[tool].shape) startShape(e, pos, tool);
      else if (tool === 'bucket') startBucket(e, pos);
      else if (tool === 'dropper') startDropper(e, pos);
      else if (tool === 'text') startText(e, pos);
    }

    function onPointerMove(e) {
      if (closed) return;
      if (drag) {
        if (e.pointerId !== drag.pointerId) return;
        drag.move(e);
        return;
      }
      if (e.target === ov && !sheetApi) hover(e);
    }

    function onPointerUp(e) {
      if (closed || !drag || e.pointerId !== drag.pointerId) return;
      const d = endDrag();
      d.up(e);
      if (e.target !== ov) leave();
    }

    function onPointerCancel(e) {
      if (closed || !drag || e.pointerId !== drag.pointerId) return;
      const d = endDrag();
      if (d.cancel) d.cancel(); else d.up(e);
    }

    // ---------------------------------------------------------------- pencil / brush / eraser
    function startStroke(e, pos, tool) {
      const color = tool === 'eraser' ? prefs.secondary : (e.button === 2 ? prefs.secondary : prefs.primary);
      const size = tool === 'pencil' ? 1 : curSize();
      const s = { tool, color, size, last: pos, mid: pos, px: Math.floor(pos.x), py: Math.floor(pos.y), rect: newRect() };
      ctx.save();
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (tool === 'pencil') {
        ctx.fillRect(s.px, s.py, 1, 1);
        grow(s.rect, s.px + 0.5, s.py + 0.5, 1);
      } else {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        grow(s.rect, pos.x, pos.y, size / 2 + 2);
      }
      const finish = () => {
        if (tool !== 'pencil') {
          ctx.beginPath();
          ctx.moveTo(s.mid.x, s.mid.y);
          ctx.lineTo(s.last.x, s.last.y);
          ctx.stroke();
          grow(s.rect, s.last.x, s.last.y, size / 2 + 2);
        }
        ctx.restore();
        commitRect(s.rect);
      };
      beginDrag(e, {
        move(ev) {
          eventPoints(ev).forEach((pe) => {
            const p = docPos(pe);
            if (tool === 'pencil') {
              const nx = Math.floor(p.x);
              const ny = Math.floor(p.y);
              if (nx === s.px && ny === s.py) return;
              plotLine(s.px, s.py, nx, ny, s.rect);
              s.px = nx;
              s.py = ny;
            } else {
              const mid = { x: (s.last.x + p.x) / 2, y: (s.last.y + p.y) / 2 };
              ctx.beginPath();
              ctx.moveTo(s.mid.x, s.mid.y);
              ctx.quadraticCurveTo(s.last.x, s.last.y, mid.x, mid.y);
              ctx.stroke();
              grow(s.rect, s.last.x, s.last.y, size / 2 + 2);
              grow(s.rect, mid.x, mid.y, size / 2 + 2);
              s.last = p;
              s.mid = mid;
            }
          });
          hoverPos = docPos(ev);
          updatePos(hoverPos);
          moveRing(hoverPos);
        },
        up(ev) {
          const p = docPos(ev);
          if (ev && Number.isFinite(p.x) && tool !== 'pencil') {
            // close the stroke at the release point
            if (Math.abs(p.x - s.last.x) + Math.abs(p.y - s.last.y) > 0.01) this.move(ev);
          } else if (tool === 'pencil' && Number.isFinite(p.x)) {
            const nx = Math.floor(p.x);
            const ny = Math.floor(p.y);
            if (nx !== s.px || ny !== s.py) plotLine(s.px, s.py, nx, ny, s.rect);
          }
          finish();
        },
        cancel() { finish(); }
      });
    }

    function plotLine(x0, y0, x1, y1, rect) {
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      grow(rect, x0 + 0.5, y0 + 0.5, 1);
      grow(rect, x1 + 0.5, y1 + 0.5, 1);
      for (let guard = 0; guard < 20000; guard++) {
        ctx.fillRect(x0, y0, 1, 1);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }

    // ---------------------------------------------------------------- shapes
    const snapPt = (p) => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });

    function constrain(tool, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (tool === 'line' || tool === 'arrow') {
        const step = Math.PI / 4;
        const ang = Math.round(Math.atan2(dy, dx) / step) * step;
        const len = Math.hypot(dx, dy);
        return snapPt({ x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len });
      }
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: a.x + (dx < 0 ? -s : s), y: a.y + (dy < 0 ? -s : s) };
    }

    function shapePath(g, tool, x, y, w, h, r) {
      if (tool === 'ellipse') {
        g.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
      } else if (tool === 'rrect') {
        const rr = Math.max(0, Math.min(r, w / 2, h / 2));
        g.moveTo(x + rr, y);
        g.lineTo(x + w - rr, y);
        g.arcTo(x + w, y, x + w, y + rr, rr);
        g.lineTo(x + w, y + h - rr);
        g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        g.lineTo(x + rr, y + h);
        g.arcTo(x, y + h, x, y + h - rr, rr);
        g.lineTo(x, y + rr);
        g.arcTo(x, y, x + rr, y, rr);
        g.closePath();
      } else {
        g.rect(x, y, w, h);
      }
    }

    function arrowHead(size) { return Math.max(12, size * 4.5); }

    function renderShape(g, tool, a, b, btn) {
      const size = prefs.sizes.shape;
      const main = btn === 2 ? prefs.secondary : prefs.primary;
      const alt = btn === 2 ? prefs.primary : prefs.secondary;
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = size;
      if (tool === 'line') {
        g.strokeStyle = main;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
      } else if (tool === 'arrow') {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const hl = Math.min(arrowHead(size), Math.max(len, 1));
        const wing = Math.PI / 7;
        const back = { x: b.x - Math.cos(ang) * hl * 0.7, y: b.y - Math.sin(ang) * hl * 0.7 };
        g.strokeStyle = main;
        g.fillStyle = main;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(back.x, back.y);
        g.stroke();
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - Math.cos(ang - wing) * hl, b.y - Math.sin(ang - wing) * hl);
        g.lineTo(b.x - Math.cos(ang + wing) * hl, b.y - Math.sin(ang + wing) * hl);
        g.closePath();
        g.fill();
        g.lineWidth = Math.max(1, size * 0.5);
        g.stroke();
      } else {
        const mode = prefs.fill;
        const x0 = Math.floor(Math.min(a.x, b.x));
        const y0 = Math.floor(Math.min(a.y, b.y));
        const w = Math.floor(Math.max(a.x, b.x)) + 1 - x0;
        const h = Math.floor(Math.max(a.y, b.y)) + 1 - y0;
        const stroked = mode !== 'fill';
        const filled = mode !== 'outline';
        const ins = stroked ? Math.min(size / 2, w / 2, h / 2) : 0;
        const radius = Math.min(Math.min(w, h) * 0.25, 48);
        if (filled) {
          g.fillStyle = mode === 'fill' ? main : alt;
          g.beginPath();
          shapePath(g, tool, x0 + ins, y0 + ins, w - 2 * ins, h - 2 * ins, Math.max(0, radius - ins));
          g.fill();
        }
        if (stroked) {
          g.strokeStyle = main;
          g.beginPath();
          shapePath(g, tool, x0 + ins, y0 + ins, w - 2 * ins, h - 2 * ins, Math.max(0, radius - ins));
          g.stroke();
        }
      }
      g.restore();
    }

    function shapeBounds(tool, a, b) {
      const size = prefs.sizes.shape;
      const pad = size / 2 + 3 + (tool === 'arrow' ? arrowHead(size) : 0);
      const r = newRect();
      grow(r, a.x, a.y, pad);
      grow(r, b.x, b.y, pad);
      return r;
    }

    function startShape(e, pos, tool) {
      const btn = e.button;
      const a = snapPt(pos);
      let b = a;
      let moved = false;
      const redraw = (ev) => {
        let p = snapPt(docPos(ev));
        if (ev.shiftKey) p = constrain(tool, a, p);
        b = p;
        if (!moved && (Math.abs(b.x - a.x) >= 1 || Math.abs(b.y - a.y) >= 1)) moved = true;
        octx.clearRect(0, 0, doc.w, doc.h);
        renderShape(octx, tool, a, b, btn);
        hoverPos = docPos(ev);
        updatePos(hoverPos);
      };
      redraw(e);
      beginDrag(e, {
        move: redraw,
        up(ev) {
          redraw(ev);
          octx.clearRect(0, 0, doc.w, doc.h);
          if (!moved) return;
          renderShape(ctx, tool, a, b, btn);
          commitRect(shapeBounds(tool, a, b));
        },
        cancel() { octx.clearRect(0, 0, doc.w, doc.h); }
      });
    }

    // ---------------------------------------------------------------- bucket / dropper
    function startBucket(e, pos) {
      const x = Math.floor(pos.x);
      const y = Math.floor(pos.y);
      const color = e.button === 2 ? prefs.secondary : prefs.primary;
      if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
      const img = ctx.getImageData(0, 0, doc.w, doc.h);
      const r = floodFill(img, x, y, hexToRgb(color), prefs.tolerance);
      if (!r) return;
      ctx.putImageData(img, 0, 0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      commitRect(r);
    }

    function pickAt(p, slot) {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
      const d = ctx.getImageData(x, y, 1, 1).data;
      const a = d[3] / 255;
      const mix = (c) => Math.round(c * a + 255 * (1 - a));
      setColor(slot, rgbToHex(mix(d[0]), mix(d[1]), mix(d[2])));
    }

    function startDropper(e, pos) {
      const slot = e.button === 2 ? 'secondary' : 'primary';
      pickAt(pos, slot);
      beginDrag(e, {
        move(ev) { const p = docPos(ev); hoverPos = p; updatePos(p); pickAt(p, slot); },
        up() {},
        cancel() {}
      });
    }

    // ---------------------------------------------------------------- text
    function textMetrics(px) {
      ctx.save();
      ctx.font = fontSpec(px);
      const m = ctx.measureText('Ağjy');
      ctx.restore();
      const asc = m.fontBoundingBoxAscent || px * 0.95;
      const desc = m.fontBoundingBoxDescent || px * 0.3;
      return { asc, desc, lh: asc + desc };
    }

    function startText(e, pos) {
      commitText();
      const btn = e.button;
      const p = { x: Math.floor(pos.x), y: Math.floor(pos.y) };
      beginDrag(e, {
        move() {},
        up() { openTextEditor(p, btn); },
        cancel() {}
      });
    }

    function restyleTextInput() {
      if (!textEdit) return;
      const t = textEdit;
      const m = textMetrics(t.fontPx);
      const s = t.input.style;
      s.left = t.x * zoom + 'px';
      s.top = t.y * zoom + 'px';
      s.fontSize = t.fontPx * zoom + 'px';
      s.lineHeight = m.lh * zoom + 'px';
      s.height = m.lh * zoom + 'px';
      s.color = t.color;
      fitTextInput();
    }

    function fitTextInput() {
      if (!textEdit) return;
      const t = textEdit;
      ctx.save();
      ctx.font = fontSpec(t.fontPx);
      const w = ctx.measureText(t.input.value || '').width;
      ctx.restore();
      t.input.style.width = Math.max(t.fontPx * 4, w + t.fontPx * 1.5) * zoom + 'px';
    }

    function openTextEditor(p, btn) {
      cancelText();
      const fontPx = prefs.sizes.text;
      const color = btn === 2 ? prefs.secondary : prefs.primary;
      const input = el('input', { class: 'pt-text', type: 'text', 'aria-label': 'Metin', autocomplete: 'off', spellcheck: 'false' });
      textEdit = { input, x: p.x, y: p.y, fontPx, color };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); commitText(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancelText(); }
      });
      input.addEventListener('input', fitTextInput);
      input.addEventListener('blur', () => {
        later(() => {
          if (textEdit && textEdit.input === input && document.activeElement !== input) commitText();
        }, 0);
      });
      sheet.appendChild(input);
      restyleTextInput();
      input.focus({ preventScroll: true });
      later(() => { if (textEdit && textEdit.input === input && document.activeElement !== input) input.focus({ preventScroll: true }); }, 0);
    }

    function cancelText() {
      if (!textEdit) return;
      const t = textEdit;
      textEdit = null;
      t.input.remove();
    }

    function commitText() {
      if (!textEdit) return false;
      const t = textEdit;
      textEdit = null;
      const value = t.input.value;
      t.input.remove();
      if (!value.trim()) return false;
      const m = textMetrics(t.fontPx);
      ctx.save();
      ctx.font = fontSpec(t.fontPx);
      ctx.fillStyle = t.color;
      ctx.textBaseline = 'alphabetic';
      const w = ctx.measureText(value).width;
      ctx.fillText(value, t.x, t.y + m.asc);
      ctx.restore();
      return commitRect({ x0: t.x - 2, y0: t.y - 2, x1: t.x + w + t.fontPx, y1: t.y + m.lh + t.fontPx * 0.5 });
    }

    // ---------------------------------------------------------------- canvas resize handles
    function startHandle(e) {
      if (closed || sheetApi || drag || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      commitText();
      const dir = e.currentTarget.dataset.dir;
      const sx = e.clientX;
      const sy = e.clientY;
      const w0 = doc.w;
      const h0 = doc.h;
      let nw = w0;
      let nh = h0;
      ghost.style.display = 'block';
      const upd = (ev) => {
        const dx = dir.includes('e') ? (ev.clientX - sx) / zoom : 0;
        const dy = dir.includes('s') ? (ev.clientY - sy) / zoom : 0;
        nw = clamp(Math.round(w0 + dx), 1, MAX_DIM);
        nh = clamp(Math.round(h0 + dy), 1, MAX_DIM);
        if (nw * nh > MAX_PIXELS) {
          if (dir === 'e') nw = Math.floor(MAX_PIXELS / nh);
          else nh = Math.floor(MAX_PIXELS / nw);
        }
        ghost.style.width = nw * zoom + 'px';
        ghost.style.height = nh * zoom + 'px';
        sizeBtn.textContent = `${nf(nw)} × ${nf(nh)} px`;
      };
      upd(e);
      beginDrag(e, {
        move: upd,
        up(ev) {
          upd(ev);
          ghost.style.display = 'none';
          if (nw !== doc.w || nh !== doc.h) resizeCanvas(nw, nh);
          else updateStatus();
        },
        cancel() { ghost.style.display = 'none'; updateStatus(); }
      });
    }

    function resizeCanvas(w, h) {
      applyFull(w, h, (g, src) => g.drawImage(src, 0, 0));
      flash(`Tuval boyutu: ${nf(w)} × ${nf(h)} px`);
    }

    // ---------------------------------------------------------------- modal sheet
    function modal(o) {
      if (sheetApi) sheetApi.cancel();
      return new Promise((resolve) => {
        const prevFocus = document.activeElement;
        const titleId = U.uid('pt-t');
        let defaultBtn = null;
        const foot = el('div', { class: 'pt-card-foot' + (o.buttons.length === 3 ? ' three' : '') });
        o.buttons.forEach((b) => {
          const btn = el('button', {
            class: 'p-btn pt-card-btn' + (b.kind ? ' ' + b.kind : ''),
            type: 'button',
            text: b.label,
            on: {
              click: () => {
                let res = b.value;
                if (typeof b.onClick === 'function') {
                  const r = b.onClick();
                  if (r === false) return;
                  if (r !== undefined) res = r;
                }
                close(res);
              }
            }
          });
          if (b.default) defaultBtn = btn;
          foot.appendChild(btn);
        });
        const head = el('div', { class: 'pt-card-head' },
          o.icon ? el('span', { class: 'pt-card-icon', html: P.icons && P.icons.has && P.icons.has(o.icon) ? P.icons.get(o.icon) : '' }) : null,
          el('div', { class: 'pt-card-title', id: titleId, text: o.title }));
        const card = el('div', { class: 'pt-card', role: 'dialog', tabindex: '-1', 'aria-labelledby': titleId },
          head,
          o.message ? el('div', { class: 'pt-card-msg', text: o.message }) : null,
          o.content || null,
          foot);
        card.setAttribute('aria-modal', 'true');
        const layer = el('div', { class: 'pt-modal' }, card);
        let done = false;

        function onKey(e) {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            api.cancel();
          } else if (e.key === 'Enter' && !e.isComposing) {
            if (e.target && e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            e.stopPropagation();
            if (defaultBtn) defaultBtn.click();
          } else if (e.key === 'Tab') {
            const list = [...card.querySelectorAll('button, input, select, textarea, [tabindex]')].filter((n) => !n.disabled && n.tabIndex >= 0);
            if (!list.length) return;
            const first = list[0];
            const last = list[list.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }

        function close(v) {
          if (done) return;
          done = true;
          layer.removeEventListener('keydown', onKey, true);
          layer.remove();
          root.inert = false;
          if (sheetApi === api) sheetApi = null;
          if (!closed) {
            if (prevFocus && prevFocus !== document.body && prevFocus.isConnected && win.el.contains(prevFocus)) {
              try { prevFocus.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
            } else {
              try { win.el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
            }
          }
          resolve(v);
        }

        const api = { close, cancel: () => close(o.cancelValue), layer, card };
        layer.addEventListener('keydown', onKey, true);
        layer.addEventListener('mousedown', (e) => {
          if (e.target === layer) {
            e.preventDefault();
            card.classList.remove('nudge');
            void card.offsetWidth;
            card.classList.add('nudge');
          }
        });
        sheetApi = api;
        root.inert = true;
        if (hoverPos) { hoverPos = null; moveRing(null); }
        win.body.appendChild(layer);
        const first = o.initialFocus || defaultBtn || card;
        try { first.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        if (first.select && first.tagName === 'INPUT') { try { first.select(); } catch (_) { /* ignore */ } }
      });
    }

    function askSave() {
      const name = doc.path ? fs.basename(doc.path) : 'Adsız';
      return modal({
        title: 'Değişiklikler kaydedilsin mi?',
        message: `"${name}" dosyasında kaydedilmemiş değişiklikler var.`,
        icon: 'warning',
        buttons: [
          { label: 'Kaydet', value: 'save', kind: 'primary', default: true },
          { label: 'Kaydetme', value: 'discard' },
          { label: 'İptal', value: 'cancel' }
        ],
        cancelValue: 'cancel'
      });
    }

    function sizeSheet(o) {
      const wi = el('input', { class: 'p-input', type: 'number', min: '1', max: String(MAX_DIM), step: '1', 'aria-label': 'Genişlik', inputmode: 'numeric' });
      const hi = el('input', { class: 'p-input', type: 'number', min: '1', max: String(MAX_DIM), step: '1', 'aria-label': 'Yükseklik', inputmode: 'numeric' });
      wi.value = String(o.w);
      hi.value = String(o.h);
      const err = el('div', { class: 'pt-error', role: 'alert' });
      const presets = el('div', { class: 'pt-presets' });
      [[800, 600], [1024, 768], [1280, 720], [1920, 1080], [512, 512]].forEach(([pw, ph]) => {
        presets.appendChild(el('button', {
          class: 'p-btn small',
          type: 'button',
          text: `${pw} × ${ph}`,
          on: { click: () => { wi.value = String(pw); hi.value = String(ph); err.textContent = ''; wi.focus(); } }
        }));
      });
      const content = el('div', { class: 'pt-form' },
        el('div', { class: 'pt-fields' },
          el('label', { class: 'pt-field' }, el('span', { text: 'Genişlik (px)' }), wi),
          el('span', { class: 'pt-times', text: '×', 'aria-hidden': 'true' }),
          el('label', { class: 'pt-field' }, el('span', { text: 'Yükseklik (px)' }), hi)),
        presets,
        err);
      const check = () => {
        const w = Number(wi.value);
        const h = Number(hi.value);
        const okInt = (v) => Number.isInteger(v) && v >= 1 && v <= MAX_DIM;
        if (!okInt(w) || !okInt(h)) {
          err.textContent = `Genişlik ve yükseklik 1 ile ${nf(MAX_DIM)} piksel arasında bir tam sayı olmalı.`;
          (okInt(w) ? hi : wi).focus();
          return false;
        }
        if (w * h > MAX_PIXELS) {
          err.textContent = `Bu boyut çok büyük; toplam piksel sayısı ${nf(MAX_PIXELS)} değerini geçemez.`;
          return false;
        }
        return { w, h };
      };
      return modal({
        title: o.title,
        message: o.message,
        icon: 'paint',
        content,
        initialFocus: wi,
        buttons: [
          { label: 'İptal', value: null },
          { label: o.okText, kind: 'primary', default: true, onClick: check }
        ],
        cancelValue: null
      });
    }

    // ---------------------------------------------------------------- file operations
    function defaultDir() {
      const pics = fs.join(fs.HOME, 'Resimler');
      return fs.isDir(pics) ? pics : fs.HOME;
    }

    function dirForDialog() {
      if (doc.path && fs.isDir(fs.dirname(doc.path))) return fs.dirname(doc.path);
      return defaultDir();
    }

    function fsErrorDialog(e, title) {
      if (e && e.code === 'ENOSPC') {
        return P.dialog.alert({
          title: 'Depolama alanı dolu',
          message: 'Resim kaydedilemedi çünkü depolama alanı doldu. Gereksiz dosyaları silip yeniden deneyin.',
          icon: 'warning'
        });
      }
      return P.dialog.alert({ title, message: (e && e.message) || String(e), icon: 'error' });
    }

    async function guardUnsaved() {
      commitText();
      if (!isDirty()) return true;
      const choice = await askSave();
      if (closed) return true;
      if (choice === 'cancel' || choice == null) return false;
      if (choice === 'discard') return true;
      return cmdSave();
    }

    function writeTo(path) {
      commitText();
      try {
        fs.writeFile(path, cv.toDataURL('image/png'));
      } catch (e) {
        fsErrorDialog(e, 'Kaydedilemedi');
        return false;
      }
      doc.path = path;
      savedEntry = histIdx ? hist[histIdx - 1] : null;
      extraDirty = false;
      refreshState();
      flash(`Kaydedildi: ${fs.basename(path)}`);
      return true;
    }

    async function cmdSave() {
      if (sheetApi) return false;
      commitText();
      if (doc.path && fs.isFile(doc.path)) return writeTo(doc.path);
      return cmdSaveAs();
    }

    async function cmdSaveAs() {
      if (sheetApi) return false;
      commitText();
      const dir = dirForDialog();
      const name = doc.path ? fs.basename(doc.path) : fs.uniqueName(dir, 'resim.png');
      const chosen = await P.dialog.pickFile({ mode: 'save', title: 'Farklı kaydet', dir, name, extensions: ['.png'] });
      if (!chosen || closed) return false;
      let path = chosen;
      if (fs.extname(path) !== '.png') {
        path += '.png';
        if (fs.exists(path)) {
          const ok = await P.dialog.confirm({
            title: 'Kaydetmeyi onayla',
            message: `"${fs.basename(path)}" zaten var. Değiştirilsin mi?`,
            okText: 'Değiştir',
            danger: true
          });
          if (!ok || closed) return false;
        }
      }
      return writeTo(path);
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Resim çözümlenemedi'));
        img.src = src;
      });
    }

    /** Loads a data-URL image as the new document. Resolves true on success. */
    async function openData(data, path, label, dirty) {
      if (typeof data !== 'string' || !/^data:image\/[a-z0-9.+-]+[;,]/i.test(data.trim())) {
        await P.dialog.alert({ title: 'Dosya açılamadı', message: `"${label}" geçerli bir resim dosyası değil.`, icon: 'error' });
        return false;
      }
      let img;
      try {
        img = await loadImage(data.trim());
      } catch (e) {
        if (!closed) await P.dialog.alert({ title: 'Dosya açılamadı', message: `"${label}" bozuk görünüyor ve açılamadı.`, icon: 'error' });
        return false;
      }
      if (closed) return false;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h || w > MAX_DIM || h > MAX_DIM || w * h > MAX_PIXELS) {
        await P.dialog.alert({
          title: 'Resim çok büyük',
          message: `"${label}" (${nf(w)} × ${nf(h)} px) açılamadı. En fazla ${nf(MAX_DIM)} × ${nf(MAX_DIM)} piksellik resimler açılabilir.`,
          icon: 'warning'
        });
        return false;
      }
      try {
        resetDoc(w, h, { path, dirty, draw: (g) => g.drawImage(img, 0, 0) });
      } catch (e) {
        await P.dialog.alert({ title: 'Dosya açılamadı', message: `"${label}" bellek yetersizliği nedeniyle açılamadı.`, icon: 'error' });
        return false;
      }
      // a picture bigger than the workspace opens fitted to it (never enlarged beyond 100%)
      if (work.clientWidth > 0 && (w > work.clientWidth - 72 || h > work.clientHeight - 72)) fitZoom();
      return true;
    }

    async function openPath(path) {
      let content;
      try {
        if (!fs.isFile(path)) throw new fs.FSError('ENOENT', `Böyle bir dosya yok: ${path}`);
        content = fs.readFile(path);
      } catch (e) {
        await P.dialog.alert({ title: 'Dosya açılamadı', message: (e && e.message) || String(e), icon: 'error' });
        return false;
      }
      const ok = await openData(content, path, fs.basename(path), false);
      if (ok) flash(`Açıldı: ${fs.basename(path)}`);
      return ok;
    }

    async function cmdOpen() {
      if (sheetApi) return;
      commitText();
      const chosen = await P.dialog.pickFile({ mode: 'open', title: 'Resim aç', dir: dirForDialog(), extensions: ['.png'] });
      if (!chosen || closed) return;
      if (!(await guardUnsaved()) || closed) return;
      await openPath(chosen);
    }

    async function cmdNew() {
      if (sheetApi) return;
      commitText();
      const size = await sizeSheet({ title: 'Yeni resim', message: 'Yeni resmin boyutunu piksel olarak girin.', okText: 'Oluştur', w: DEFAULT_W, h: DEFAULT_H });
      if (!size || closed) return;
      if (!(await guardUnsaved()) || closed) return;
      resetDoc(size.w, size.h);
      flash('Yeni resim oluşturuldu');
    }

    async function cmdCanvasSize() {
      if (sheetApi) return;
      commitText();
      const size = await sizeSheet({ title: 'Tuval boyutu', message: 'Tuvalin yeni boyutunu girin. Küçültürseniz taşan kısım kesilir.', okText: 'Uygula', w: doc.w, h: doc.h });
      if (!size || closed) return;
      if (size.w !== doc.w || size.h !== doc.h) resizeCanvas(size.w, size.h);
    }

    async function cmdWallpaper() {
      if (sheetApi) return;
      commitText();
      if (!doc.path || isDirty()) {
        const ok = await cmdSave();
        if (!ok || closed) return;
      }
      if (!doc.path) return;
      try {
        P.settings.set('wallpaper', 'vfs:' + doc.path);
      } catch (e) {
        console.error('[paint] wallpaper', e);
        return;
      }
      if (typeof P.notify === 'function') {
        P.notify({
          title: 'Arka plan değiştirildi',
          message: `"${fs.basename(doc.path)}" masaüstü arka planı olarak ayarlandı.`,
          icon: 'paint',
          timeout: 4000
        });
      }
    }

    // ---------------------------------------------------------------- canvas operations menu
    function clearCanvas() {
      applyFull(doc.w, doc.h, () => {});
      flash('Tuval temizlendi');
    }

    function flipCanvas(horizontal) {
      applyFull(doc.w, doc.h, (g, src) => {
        if (horizontal) { g.translate(doc.w, 0); g.scale(-1, 1); } else { g.translate(0, doc.h); g.scale(1, -1); }
        g.drawImage(src, 0, 0);
      });
    }

    function rotateCanvas() {
      const w = doc.w;
      const h = doc.h;
      applyFull(h, w, (g, src) => {
        g.translate(h, 0);
        g.rotate(Math.PI / 2);
        g.drawImage(src, 0, 0);
      });
    }

    function showMoreMenu() {
      const r = btnMore.getBoundingClientRect();
      P.contextMenu.show(r.left, r.bottom + 4, [
        { label: 'Tuval boyutu…', icon: icon('canvas'), action: () => cmdCanvasSize() },
        { label: 'Tuvali temizle', icon: icon('delete'), action: () => clearCanvas() },
        { type: 'separator' },
        { label: 'Yatay çevir', icon: icon('flip'), action: () => flipCanvas(true) },
        { label: 'Dikey çevir', icon: icon('flip'), action: () => flipCanvas(false) },
        { label: 'Sağa döndür (90°)', icon: icon('rotate'), action: () => rotateCanvas() },
        { type: 'separator' },
        { label: 'Pencereye sığdır', icon: icon('fit'), action: () => fitZoom() },
        { label: 'Gerçek boyut (%100)', action: () => setZoom(1) }
      ]);
    }

    // ---------------------------------------------------------------- keyboard
    const isTyping = (t) => {
      if (!t || t.nodeType !== 1) return false;
      if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
      if (t.tagName !== 'INPUT') return false;
      return !['range', 'color', 'checkbox', 'radio', 'button'].includes((t.getAttribute('type') || 'text').toLowerCase());
    };

    const letterOf = (e) => {
      if (/^Key[A-Z]$/.test(e.code || '')) return e.code.slice(3).toLowerCase();
      return e.key && e.key.length === 1 ? e.key.toLowerCase() : '';
    };

    function onKey(e) {
      if (closed || sheetApi) return;
      const typing = isTyping(e.target);
      const ctrl = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        if (drag && drag.cancel) {
          const d = endDrag();
          d.cancel();
          e.preventDefault();
        } else if (textEdit && !typing) {
          cancelText();
          e.preventDefault();
        }
        return;
      }

      if (ctrl && !e.altKey) {
        const k = letterOf(e);
        if (k === 's') { e.preventDefault(); if (e.shiftKey) cmdSaveAs(); else cmdSave(); return; }
        if (k === 'o') { e.preventDefault(); cmdOpen(); return; }
        if (typing) return;
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (k === 'y') { e.preventDefault(); redo(); return; }
        if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.preventDefault(); zoomBy(1); return; }
        if (e.key === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); zoomBy(-1); return; }
        if (e.key === '0' || e.code === 'Numpad0') { e.preventDefault(); setZoom(1); return; }
        return;
      }
      if (ctrl || e.altKey || typing) return;

      const k = letterOf(e);
      if (k && KEY_TO_TOOL[k]) { e.preventDefault(); setTool(KEY_TO_TOOL[k]); return; }
      if (k === 'x') { e.preventDefault(); swapColors(); return; }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const t = TOOLS[prefs.tool];
        if (t.group && t.group !== 'pencil') setSize(prefs.sizes[t.group] + (e.key === ']' ? 1 : -1) * (prefs.sizes[t.group] >= 16 ? 4 : 1));
      }
    }

    function onWheel(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1, { x: e.clientX, y: e.clientY });
    }

    // ---------------------------------------------------------------- drops (files from the file manager / the real computer)
    const hasDroppable = (dt) => !!dt && [...(dt.types || [])].some((t) => t === 'Files' || t === 'application/x-pandaos-paths');

    function onDragOver(e) {
      if (sheetApi || !hasDroppable(e.dataTransfer)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (_) { /* ignore */ }
      work.classList.add('pt-dragover');
    }

    function onDrop(e) {
      work.classList.remove('pt-dragover');
      if (sheetApi || !hasDroppable(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      const dt = e.dataTransfer;
      let paths = [];
      try { paths = JSON.parse(dt.getData('application/x-pandaos-paths') || '[]'); } catch (_) { paths = []; }
      const png = (Array.isArray(paths) ? paths : []).find((p) => typeof p === 'string' && fs.extname(p) === '.png');
      if (png) {
        (async () => { if (await guardUnsaved()) await openPath(png); })().catch((err) => console.error('[paint]', err));
        return;
      }
      const file = dt.files && [...dt.files].find((f) => /^image\//.test(f.type));
      if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
          if (closed) return;
          if (await guardUnsaved()) await openData(String(reader.result), null, file.name, true);
        };
        reader.onerror = () => P.dialog.alert({ title: 'Dosya açılamadı', message: `"${file.name}" okunamadı.`, icon: 'error' });
        reader.readAsDataURL(file);
      } else if (paths.length) {
        P.dialog.alert({ title: 'Dosya açılamadı', message: 'Yalnızca PNG resimleri açılabilir.', icon: 'info' });
      }
    }

    function layoutFor(width) {
      root.classList.toggle('pt-compact', width > 0 && width < 960);
      root.classList.toggle('pt-narrow', width > 0 && width < 860);
    }

    // ---------------------------------------------------------------- wire up
    // listeners never throw out of the event loop: every handler goes through safe()
    const hMove = safe(onPointerMove);
    const hUp = safe(onPointerUp);
    const hCancel = safe(onPointerCancel);
    ov.addEventListener('pointerdown', safe(onPointerDown));
    ov.addEventListener('pointerleave', safe(leave));
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    handles.forEach((h) => h.addEventListener('pointerdown', safe(startHandle)));
    document.addEventListener('pointermove', hMove);
    document.addEventListener('pointerup', hUp);
    document.addEventListener('pointercancel', hCancel);
    work.addEventListener('wheel', safe(onWheel), { passive: false });
    work.addEventListener('dragover', safe(onDragOver));
    work.addEventListener('dragleave', (e) => { if (e.target === work) work.classList.remove('pt-dragover'); });
    work.addEventListener('drop', safe(onDrop));
    work.addEventListener('contextmenu', (e) => e.preventDefault());
    work.addEventListener('pointerdown', (e) => {
      // clicking the grey area commits an open text field (blur does the same) and keeps keyboard focus in the app
      if (e.target === work || e.target === frame) commitText();
    });

    sizeRange.addEventListener('input', () => setSize(sizeRange.value));
    tolRange.addEventListener('input', () => { prefs.tolerance = clamp(Number(tolRange.value) || 0, 0, 100); tolVal.textContent = `${prefs.tolerance}%`; savePrefs(); });
    zoomRange.addEventListener('input', () => setZoom(ZOOM_STEPS[clamp(Number(zoomRange.value) || 0, 0, ZOOM_STEPS.length - 1)]));
    swPrimaryInput.addEventListener('input', () => setColor('primary', swPrimaryInput.value));
    swSecondaryInput.addEventListener('input', () => setColor('secondary', swSecondaryInput.value));
    customInput.addEventListener('input', () => setColor('primary', customInput.value));

    // the file was renamed / moved elsewhere (file manager, terminal): follow it
    offs.push(P.bus.on('fs:change', (e) => {
      if (closed || !doc.path || !e || (e.type !== 'rename' && e.type !== 'move') || !e.oldPath) return;
      if (doc.path === e.oldPath) doc.path = e.path;
      else if (doc.path.startsWith(e.oldPath + '/')) doc.path = e.path + doc.path.slice(e.oldPath.length);
      else return;
      refreshState();
    }));
    offs.push(win.on('keydown', safe(onKey)));
    offs.push(win.on('resize', (s) => layoutFor(s.width)));

    win.on('close', () => {
      closed = true;
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      document.removeEventListener('pointermove', hMove);
      document.removeEventListener('pointerup', hUp);
      document.removeEventListener('pointercancel', hCancel);
      offs.splice(0).forEach((off) => { try { off(); } catch (_) { /* ignore */ } });
      if (sheetApi) { try { sheetApi.layer.remove(); } catch (_) { /* ignore */ } sheetApi = null; }
      drag = null;
      textEdit = null;
    });

    win.beforeClose = async () => {
      commitText();
      if (!isDirty()) return true;
      try {
        if (win.isMinimized()) win.restore();
        win.focus();
      } catch (_) { /* ignore */ }
      return guardUnsaved();
    };

    // debugging / test hooks (read-mostly)
    win.state.paint = {
      canvas: cv,
      overlay: ov,
      doc,
      prefs,
      tool: () => prefs.tool,
      zoom: () => zoom,
      isDirty,
      path: () => doc.path,
      historyLength: () => hist.length,
      historyIndex: () => histIdx,
      setTool,
      setColor,
      openPath,
      floodFill
    };

    // ---------------------------------------------------------------- start
    toggleRibbon(prefs.collapsed);
    syncColors();
    setFill(prefs.fill);
    setTool(prefs.tool);
    resetDoc(DEFAULT_W, DEFAULT_H);
    layoutFor(win.body.clientWidth);
    tolVal.textContent = `${prefs.tolerance}%`;
    if (args.path) {
      openPath(String(args.path)).catch((e) => console.error('[paint]', e));
    }
  }

  P.apps.register({
    id: 'paint',
    name: 'Çizim',
    icon: 'paint',
    description: 'Resim çiz, boya ve kaydet',
    category: 'media',
    fileTypes: ['.png'],
    singleInstance: false,
    window: { width: 980, height: 660, minWidth: 600, minHeight: 420 },
    launch
  });
})();
