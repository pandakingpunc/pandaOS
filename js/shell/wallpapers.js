/* PandaOS wallpapers — procedural, resolution independent (CSS gradients + inline SVG data URIs).
   PandaOS.wallpapers = [{ id, name, css, tone, bright }]; PandaOS.wallpapers.css(value) resolves an id or
   'vfs:/abs/path' (file content = image data URL) to a CSS `background` shorthand. Every scene is generated
   from a seeded PRNG at first use, so nothing is shipped as an external file and the output is stable. */
(function () {
  'use strict';

  const P = (window.PandaOS = window.PandaOS || {});
  const W = 1920;
  const H = 1080;

  // ------------------------------------------------------------------ helpers
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const f = (n) => Math.round(n * 10) / 10;
  const rad = (d) => (d * Math.PI) / 180;
  const lerp = (a, b, t) => a + (b - a) * t;

  function hex2rgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(c1, c2, t) {
    const a = hex2rgb(c1);
    const b = hex2rgb(c2);
    const out = a.map((v, i) => Math.round(lerp(v, b[i], t)));
    return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function svg(defs, body) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
  }

  function uri(markup) {
    return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
  }

  /** Linear gradient helper. stops: [[offset, color, opacity?], …] */
  function lg(id, stops, attrs) {
    return `<linearGradient id="${id}" ${attrs || 'x1="0" y1="0" x2="0" y2="1"'}>${stops
      .map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"${s[2] != null ? ` stop-opacity="${s[2]}"` : ''}/>`).join('')}</linearGradient>`;
  }

  function rg(id, stops, attrs) {
    return `<radialGradient id="${id}" ${attrs || ''}>${stops
      .map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"${s[2] != null ? ` stop-opacity="${s[2]}"` : ''}/>`).join('')}</radialGradient>`;
  }

  const FULL = `filterUnits="userSpaceOnUse" x="-500" y="-500" width="${W + 1000}" height="${H + 1000}"`;

  function blur(id, dev, region) {
    return `<filter id="${id}" ${region || FULL}><feGaussianBlur stdDeviation="${dev}"/></filter>`;
  }

  /** Midpoint displacement ridge line: returns [[x, y], …] */
  function ridge(seed, y0, y1, amp, rough, iters) {
    const rr = rng(seed);
    let pts = [[-40, y0], [W + 40, y1]];
    let a = amp;
    for (let i = 0; i < iters; i++) {
      const next = [];
      for (let j = 0; j < pts.length - 1; j++) {
        const p = pts[j];
        const q = pts[j + 1];
        next.push(p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + (rr() - 0.5) * 2 * a]);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
      a *= rough;
    }
    return pts;
  }

  function poly(pts, closeY) {
    const last = pts[pts.length - 1];
    return `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}L${f(last[0])} ${closeY}L${f(pts[0][0])} ${closeY}Z`;
  }

  /** Catmull-Rom spline through points → smooth cubic path (optionally closed down to closeY). */
  function smooth(pts, closeY) {
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    if (closeY != null) {
      const last = pts[pts.length - 1];
      d += `L${f(last[0])} ${closeY}L${f(pts[0][0])} ${closeY}Z`;
    }
    return d;
  }

  /** Stack of triangles = pine tree silhouette. */
  function pine(x, baseY, h, fill) {
    const w = h * 0.34;
    let d = '';
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const t0 = i / tiers;
      const top = baseY - h + h * t0 * 0.78;
      const bottom = baseY - h * (1 - (i + 1) / tiers) * 0.78 - h * 0.12;
      const half = w * (0.35 + 0.65 * ((i + 1) / tiers));
      d += `M${f(x)} ${f(top)}L${f(x + half)} ${f(bottom)}L${f(x - half)} ${f(bottom)}Z`;
    }
    d += `M${f(x - h * 0.025)} ${f(baseY - h * 0.12)}h${f(h * 0.05)}v${f(h * 0.12)}h${f(-h * 0.05)}Z`;
    return `<path d="${d}" fill="${fill}"/>`;
  }

  function stars(seed, count, opts) {
    const r = rng(seed);
    const o = Object.assign({ maxY: H, bias: 1.4, bright: 0.06, color: '#ffffff', alpha: 1 }, opts);
    let s = '';
    for (let i = 0; i < count; i++) {
      const x = r() * W;
      const y = Math.pow(r(), o.bias) * o.maxY;
      const big = r() < o.bright;
      const rr = big ? 1.3 + r() * 1.1 : 0.4 + r() * 0.8;
      const op = (big ? 0.9 : 0.25 + r() * 0.6) * o.alpha;
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="${o.color}" opacity="${Math.round(op * 100) / 100}"/>`;
      if (big && r() < 0.5) {
        s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr * 4.5)}" fill="${o.color}" opacity="${Math.round(0.12 * o.alpha * 100) / 100}"/>`;
      }
    }
    return s;
  }

  // ------------------------------------------------------------------ 1. bamboo
  function bamboo() {
    const r = rng(4242);
    const rand = (a, b) => a + (b - a) * r();
    const MX = 1450;
    const MY = 215;

    const defs = [
      lg('sky', [[0, '#02070b'], [0.34, '#07212a'], [0.68, '#103a3b'], [1, '#1b5a52']]),
      rg('halo', [[0, '#e6fff4', 0.7], [0.1, '#a8f0d8', 0.38], [0.4, '#4db8a2', 0.14], [1, '#2a7f74', 0]],
        `cx="${MX}" cy="${MY}" r="760" gradientUnits="userSpaceOnUse"`),
      rg('moon', [[0, '#ffffff'], [0.65, '#eaf8f0'], [1, '#b9ddd0']], 'cx=".4" cy=".38" r=".75"'),
      lg('stA', [[0, '#0e3636'], [0.5, '#1d5a53'], [0.84, '#3e8f7e'], [1, '#103d3b']], 'x1="0" y1="0" x2="1" y2="0"'),
      lg('stB', [[0, '#06191a'], [0.5, '#0c3330'], [0.82, '#1f5f55'], [1, '#071f1d']], 'x1="0" y1="0" x2="1" y2="0"'),
      lg('stC', [[0, '#010605'], [0.55, '#03120f'], [0.85, '#0c382e'], [0.94, '#1f6652'], [1, '#010907']], 'x1="0" y1="0" x2="1" y2="0"'),
      lg('gFar', [[0, '#1f5a52', 0], [0.07, '#1d564f', 0.95], [1, '#0f3a36']]),
      lg('gMid', [[0, '#0e3a34', 0], [0.06, '#0d3731', 0.96], [1, '#06221e']]),
      lg('gNear', [[0, '#0a2d26'], [0.25, '#051a16'], [1, '#010605']]),
      lg('fog', [[0, '#9fe3d3', 0], [0.5, '#9fe3d3', 0.15], [1, '#9fe3d3', 0]]),
      lg('ray', [[0, '#d8fff0', 0.16], [0.7, '#d8fff0', 0.05], [1, '#d8fff0', 0]], `x1="${MX}" y1="${MY}" x2="${MX - 650}" y2="1020" gradientUnits="userSpaceOnUse"`),
      rg('ff', [[0, '#ecffb4', 0.8], [0.3, '#c3f27a', 0.28], [1, '#c3f27a', 0]]),
      rg('vig', [[0, '#000', 0], [0.55, '#000', 0], [1, '#000', 0.62]], `cx="${W / 2}" cy="${H * 0.46}" r="1150" gradientUnits="userSpaceOnUse"`),
      rg('pbody', [[0, '#c9e0da'], [1, '#86a7a2']], 'cx=".62" cy=".3" r=".85"'),
      blur('bFar', 3.2, 'x="-5%" y="-5%" width="110%" height="110%"'),
      blur('bMid', 1.1, 'x="-5%" y="-5%" width="110%" height="110%"'),
      blur('bNearBack', 2.2, 'x="-5%" y="-5%" width="110%" height="110%"'),
      blur('bNearFront', 6, 'x="-10%" y="-5%" width="120%" height="110%"'),
      blur('bFog', 26, 'x="-10%" y="-60%" width="120%" height="220%"'),
      blur('bRay', 9),
      blur('bSoft', 7),
      blur('bBokeh', 4),
      blur('bMoon', 0.8),
      '<filter id="bPanda" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="matrix" values=".8 0 0 0 0  0 .88 0 0 0  0 0 .9 0 0  0 0 0 1 0"/></filter>',
      '<path id="lf" d="M0 0C22 -10 62 -13 100 2C62 9 22 8 0 0Z"/>'
    ].join('');

    const leafCluster = (x, y, dir, size, col) => {
      const len = rand(40, 100) * size;
      const up = rand(8, 42);
      const ex = x + dir * len * Math.cos(rad(up));
      const ey = y - len * Math.sin(rad(up));
      let s = `<path d="M${f(x)} ${f(y)}Q${f(x + dir * len * 0.55)} ${f(y - len * 0.02)} ${f(ex)} ${f(ey)}" fill="none" stroke="${col}" stroke-width="${f(2.4 * size)}" stroke-linecap="round"/>`;
      const n = 4 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const a = rand(-28, 72);
        const base = dir > 0 ? a : 180 - a;
        s += `<use href="#lf" transform="translate(${f(ex)} ${f(ey)}) rotate(${f(base)}) scale(${f(rand(0.5, 1) * size * 0.92)})" opacity="${f(rand(0.75, 1))}"/>`;
      }
      return `<g fill="${col}">${s}</g>`;
    };

    const stalk = (x, w, grad, o) => {
      const tilt = rand(-1.1, 1.1);
      let body = `<rect x="${f(x - w / 2)}" y="-70" width="${f(w)}" height="1240" fill="url(#${grad})"/>`;
      let leaves = '';
      let y = rand(0, o.seg) - 60;
      while (y < H + 40) {
        const nw = w + o.nodeExtra;
        body += `<rect x="${f(x - nw / 2)}" y="${f(y)}" width="${f(nw)}" height="${f(o.nodeH)}" rx="${f(o.nodeH / 2)}" fill="${o.node}"/>`;
        body += `<rect x="${f(x - w / 2)}" y="${f(y + o.nodeH)}" width="${f(w)}" height="${f(Math.max(1, w * 0.04))}" fill="${o.hi}" opacity=".5"/>`;
        if (o.leafMaxY && y > 10 && y < o.leafMaxY && r() < o.leafChance) {
          leaves += leafCluster(x + (r() < 0.5 ? -1 : 1) * w * 0.45, y + o.nodeH / 2, r() < 0.5 ? -1 : 1, o.leafSize, o.leaf);
        }
        y += o.seg * rand(0.72, 1.3);
      }
      return `<g transform="rotate(${f(tilt)} ${f(x)} 540)">${body}${leaves}</g>`;
    };

    const layer = (xs, ws, grad, o) => xs.map((x, i) => stalk(x, ws[i % ws.length] * rand(0.88, 1.12), grad, o)).join('');
    const spread = (n, pad, jitter) => Array.from({ length: n }, (_, i) => pad + (i + 0.5) * ((W - pad * 2) / n) + rand(-jitter, jitter));

    // --- sky, moon, clouds
    let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
    body += stars(31, 90, { maxY: 520, bias: 1.8, bright: 0.05, color: '#d7f4ea', alpha: 0.6 });
    body += `<rect width="${W}" height="${H}" fill="url(#halo)"/>`;
    body += `<circle cx="${MX}" cy="${MY}" r="64" fill="url(#moon)" filter="url(#bMoon)"/>`;
    body += `<g fill="#a7c9be" opacity=".35"><circle cx="${MX - 22}" cy="${MY - 14}" r="9"/><circle cx="${MX + 18}" cy="${MY + 20}" r="13"/><circle cx="${MX - 4}" cy="${MY + 2}" r="5"/></g>`;
    body += `<g filter="url(#bSoft)" opacity=".5"><ellipse cx="${MX - 70}" cy="${MY + 8}" rx="330" ry="11" fill="#0a2a30"/><ellipse cx="${MX + 220}" cy="${MY + 70}" rx="260" ry="9" fill="#0d3238"/><ellipse cx="${MX - 480}" cy="${MY + 150}" rx="360" ry="10" fill="#0a2a30" opacity=".7"/></g>`;

    // --- far layer
    const farOpts = { seg: 150, nodeExtra: 3, nodeH: 5, node: '#12413d', hi: '#4a9a88', leaf: '#16524b', leafMaxY: 380, leafChance: 0.5, leafSize: 0.7 };
    body += `<g filter="url(#bFar)" opacity=".62">${layer(spread(26, 10, 28), [13, 17, 11, 15], 'stA', farOpts)}</g>`;
    body += `<path d="M0 742C260 716 470 735 720 722C1010 706 1240 730 1500 716C1700 706 1830 722 1920 714V1080H0Z" fill="url(#gFar)"/>`;
    body += `<rect y="560" width="${W}" height="260" fill="url(#fog)" filter="url(#bFog)"/>`;

    // --- mid layer
    const midOpts = { seg: 190, nodeExtra: 5, nodeH: 8, node: '#0b2e28', hi: '#3a8a72', leaf: '#0c3a31', leafMaxY: 520, leafChance: 0.6, leafSize: 1.05 };
    body += `<g filter="url(#bMid)">${layer(spread(13, 40, 55), [28, 36, 31, 24], 'stB', midOpts)}</g>`;
    body += `<path d="M0 846C220 826 430 842 690 830C940 818 1180 840 1420 828C1640 818 1810 836 1920 828V1080H0Z" fill="url(#gMid)"/>`;
    body += `<rect y="700" width="${W}" height="240" fill="url(#fog)" filter="url(#bFog)" opacity=".6"/>`;

    // --- moon rays
    let rays = '';
    [[1340, 70], [1080, 46], [840, 90], [610, 40], [380, 64], [160, 50]].forEach((q) => {
      const x0 = MX + rand(-30, 30);
      rays += `<polygon points="${f(x0 - 12)},${MY + 40} ${f(x0 + 16)},${MY + 40} ${f(q[0] + q[1])},1060 ${f(q[0] - q[1])},1060" fill="url(#ray)" opacity="${f(rand(0.5, 1))}"/>`;
    });
    body += `<g filter="url(#bRay)" style="mix-blend-mode:screen" opacity=".9">${rays}</g>`;

    // --- near ground + panda
    body += `<path d="M0 944C230 924 410 942 640 932C880 920 1080 940 1320 930C1560 918 1760 938 1920 928V1080H0Z" fill="url(#gNear)"/>`;
    body += `<path d="M0 944C230 924 410 942 640 932C880 920 1080 940 1320 930C1560 918 1760 938 1920 928" fill="none" stroke="#8ad3bd" stroke-opacity=".22" stroke-width="2"/>`;
    body += `<g transform="translate(1196 806) scale(.62)" filter="url(#bPanda)">
      <ellipse cx="100" cy="214" rx="86" ry="10" fill="#000" opacity=".5"/>
      <path d="M96 188L132 84" stroke="#3f9c70" stroke-width="10" stroke-linecap="round"/>
      <path d="M92 150h9M104 122h9" stroke="#1f6a48" stroke-width="3"/>
      <ellipse cx="100" cy="150" rx="62" ry="62" fill="url(#pbody)"/>
      <path d="M36 122C54 96 146 96 164 122C172 140 160 156 148 154L52 154C40 156 28 140 36 122Z" fill="#071512"/>
      <ellipse cx="54" cy="176" rx="19" ry="36" fill="#071512" transform="rotate(14 54 176)"/>
      <ellipse cx="146" cy="170" rx="19" ry="36" fill="#071512" transform="rotate(-24 146 170)"/>
      <ellipse cx="56" cy="204" rx="31" ry="15" fill="#071512"/>
      <ellipse cx="144" cy="204" rx="31" ry="15" fill="#071512"/>
      <circle cx="100" cy="70" r="43" fill="url(#pbody)"/>
      <circle cx="66" cy="33" r="16" fill="#071512"/><circle cx="134" cy="33" r="16" fill="#071512"/>
      <ellipse cx="80" cy="68" rx="11" ry="15" fill="#071512" transform="rotate(-22 80 68)"/>
      <ellipse cx="120" cy="68" rx="11" ry="15" fill="#071512" transform="rotate(22 120 68)"/>
      <circle cx="81" cy="66" r="2.6" fill="#d8f0e8"/><circle cx="119" cy="66" r="2.6" fill="#d8f0e8"/>
      <path d="M93 85Q100 80 107 85Q104 92 100 92Q96 92 93 85Z" fill="#071512"/>
      <path d="M91 98Q100 104 109 98" fill="none" stroke="#071512" stroke-width="2" stroke-linecap="round"/>
    </g>`;
    body += `<rect y="790" width="${W}" height="230" fill="url(#fog)" filter="url(#bFog)" opacity=".4"/>`;

    // --- near layer
    const nearOpts = { seg: 240, nodeExtra: 8, nodeH: 13, node: '#020d0a', hi: '#3f8f78', leaf: '#02100c', leafMaxY: 640, leafChance: 0.75, leafSize: 1.7 };
    const nearBack = [{ x: 380, w: 52 }, { x: 760, w: 38 }, { x: 1690, w: 62 }];
    const nearFront = [{ x: 70, w: 92 }, { x: 1865, w: 100 }];
    body += `<g filter="url(#bNearBack)">${nearBack.map((s) => stalk(s.x, s.w, 'stC', nearOpts)).join('')}</g>`;
    body += `<g filter="url(#bNearFront)">${nearFront.map((s) => stalk(s.x, s.w, 'stC', Object.assign({}, nearOpts, { leafSize: 2.2, nodeH: 17 }))).join('')}</g>`;

    // --- foreground grass blades
    let grass = '';
    for (let i = 0; i < 150; i++) {
      const x = rand(-20, W + 20);
      const h = rand(36, 150) * (0.5 + Math.abs(Math.sin(x / 300)) * 0.7);
      const bend = rand(-40, 40);
      const wd = rand(2, 5);
      grass += `M${f(x)} 1084Q${f(x + bend * 0.35)} ${f(1084 - h * 0.55)} ${f(x + bend)} ${f(1084 - h)}Q${f(x + bend * 0.55 + wd)} ${f(1084 - h * 0.5)} ${f(x + wd * 2)} 1084Z`;
    }
    body += `<path d="${grass}" fill="#010605"/>`;

    // --- fireflies + bokeh
    let flies = '';
    for (let i = 0; i < 16; i++) {
      const x = rand(120, 1820);
      const y = rand(520, 960);
      const s = rand(0.7, 1.4);
      flies += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(16 * s)}" fill="url(#ff)"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(2 * s)}" fill="#f4ffc8"/>`;
    }
    body += flies;
    let bokeh = '';
    for (let i = 0; i < 9; i++) {
      bokeh += `<circle cx="${f(rand(0, W))}" cy="${f(rand(300, 1000))}" r="${f(rand(16, 48))}" fill="#bff5e4" opacity="${f(rand(0.015, 0.04))}"/>`;
    }
    body += `<g filter="url(#bBokeh)">${bokeh}</g>`;
    body += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;

    return svg(defs, body);
  }

  // ------------------------------------------------------------------ 2. aurora
  function aurora() {
    const r = rng(77);
    const rand = (a, b) => a + (b - a) * r();
    const HOR = 872;

    let defs = [
      lg('sky', [[0, '#01030c'], [0.45, '#050d2b'], [0.8, '#0a2147'], [1, '#12395a']]),
      lg('g1', [[0, '#34f5a5', 0], [0.5, '#34f5a5', 0.5], [0.88, '#8dffd6', 0.95], [1, '#34f5a5', 0]]),
      lg('g2', [[0, '#7c5cff', 0], [0.55, '#8b6bff', 0.5], [0.9, '#d28bff', 0.85], [1, '#a855f7', 0]]),
      lg('g3', [[0, '#22d3ee', 0], [0.5, '#22d3ee', 0.45], [0.9, '#7ef3ff', 0.85], [1, '#22d3ee', 0]]),
      lg('water', [[0, '#071a33'], [0.5, '#030c1d'], [1, '#01040b']]),
      lg('land', [[0, '#0a1a2c'], [1, '#02060d']]),
      lg('mt', [[0, '#10284a'], [0.5, '#081833'], [1, '#050d1e']]),
      lg('rim', [[0, '#34f5a5', 0], [0.5, '#7dffd0', 0.7], [1, '#34f5a5', 0]], 'x1="0" y1="0" x2="1" y2="0"'),
      rg('glow', [[0, '#3ff0b0', 0.4], [1, '#3ff0b0', 0]], `cx="${W / 2}" cy="${HOR}" r="900" gradientUnits="userSpaceOnUse"`),
      rg('vig', [[0, '#000', 0], [0.6, '#000', 0], [1, '#000', 0.55]], `cx="${W / 2}" cy="${H / 2}" r="1150" gradientUnits="userSpaceOnUse"`),
      `<filter id="bCurtain" ${FULL}><feGaussianBlur stdDeviation="3.5 15"/></filter>`,
      `<filter id="bRefl" ${FULL}><feGaussianBlur stdDeviation="8 22"/></filter>`,
      blur('bMw', 70),
      blur('bSoft', 12),
      `<clipPath id="skyClip"><rect width="${W}" height="${HOR}"/></clipPath>`,
      `<clipPath id="lakeClip"><rect y="${HOR}" width="${W}" height="${H - HOR}"/></clipPath>`
    ].join('');

    const ribbon = (base, amp, k, ph, thick, grad, op) => {
      let cols = '';
      for (let x = -30; x < W + 30; x += 8) {
        const top = base + amp * Math.sin(x * k + ph) + amp * 0.45 * Math.sin(x * k * 2.3 + ph * 1.7);
        const bot = top + thick * (0.65 + 0.35 * Math.sin(x * k * 1.4 + ph * 0.6)) * (0.8 + r() * 0.35);
        const edge = Math.min(1, (x + 30) / 260, (W + 30 - x) / 260);
        cols += `<rect x="${x}" y="${f(top)}" width="9" height="${f(bot - top)}" fill="url(#${grad})" opacity="${f(op * (0.45 + r() * 0.55) * edge * 100) / 100}"/>`;
      }
      return cols;
    };

    const auroraGroup = `<g id="au"><g filter="url(#bCurtain)">`
      + ribbon(250, 70, 0.0031, 0.6, 360, 'g2', 0.62)
      + ribbon(330, 85, 0.0027, 2.4, 380, 'g1', 0.82)
      + ribbon(445, 55, 0.0042, 4.1, 250, 'g3', 0.6)
      + `</g></g>`;

    defs += auroraGroup;
    let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
    body += `<g filter="url(#bMw)" opacity=".16" transform="rotate(-24 960 400)"><ellipse cx="960" cy="400" rx="1100" ry="120" fill="#a6b8ff"/></g>`;
    body += stars(12, 320, { maxY: 760, bias: 1.3, bright: 0.06, color: '#e8f0ff' });
    body += `<rect width="${W}" height="${H}" fill="url(#glow)"/>`;
    body += `<g clip-path="url(#skyClip)" style="mix-blend-mode:screen"><use href="#au"/></g>`;

    // distant snowy mountains
    const mts = ridge(5, 800, 820, 90, 0.55, 7);
    body += `<path d="${poly(mts, HOR + 4)}" fill="url(#mt)"/>`;
    body += `<path d="${poly(mts, HOR + 4)}" fill="none" stroke="#6af5c0" stroke-opacity=".28" stroke-width="1.5"/>`;
    const mts2 = ridge(9, 842, 836, 46, 0.5, 7);
    body += `<path d="${poly(mts2, HOR + 4)}" fill="#050e1f"/>`;

    // lake with mirrored aurora
    body += `<rect y="${HOR}" width="${W}" height="${H - HOR}" fill="url(#water)"/>`;
    body += `<g clip-path="url(#lakeClip)"><g transform="translate(0 ${HOR * 2}) scale(1 -1)" opacity=".6" filter="url(#bRefl)"><use href="#au" style="mix-blend-mode:screen"/></g></g>`;
    body += `<rect y="${HOR - 1}" width="${W}" height="3" fill="url(#rim)" opacity=".5"/>`;
    // water shimmer
    let shimmer = '';
    for (let i = 0; i < 80; i++) {
      const y = HOR + 8 + Math.pow(r(), 1.6) * (H - HOR - 20);
      shimmer += `<rect x="${f(rand(0, W))}" y="${f(y)}" width="${f(rand(30, 160))}" height="1.4" rx=".7" fill="#7dffd0" opacity="${f(rand(0.03, 0.12))}"/>`;
    }
    body += shimmer;

    // foreground shores with pines
    const shoreY = (x) => 905 + 235 * Math.pow(Math.min(1, Math.max(0, x / 780)), 2.1);
    const shorePts = [];
    for (let x = -40; x <= 800; x += 60) shorePts.push([x, shoreY(x)]);
    const shoreL = smooth(shorePts, H + 6);
    body += `<path d="${shoreL}" fill="url(#land)"/>`;
    body += `<path d="${shoreL}" fill="url(#land)" transform="translate(${W} 0) scale(-1 1)"/>`;
    let trees = '';
    for (let i = 0; i < 30; i++) {
      const left = i < 16;
      const dx = rand(-10, 700);
      const h = rand(90, 200) * (0.65 + Math.max(0, 1 - dx / 720) * 0.95);
      const x = left ? dx : W - dx;
      trees += pine(x, shoreY(dx) + rand(2, 30), h, '#02050b');
    }
    body += trees;
    body += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;

    return svg(defs, body);
  }

  // ------------------------------------------------------------------ 3. sunset
  function sunset() {
    const r = rng(909);
    const rand = (a, b) => a + (b - a) * r();
    const SX = 1090;
    const SY = 660;

    const defs = [
      lg('sky', [[0, '#150d38'], [0.22, '#3f1a66'], [0.42, '#912a73'], [0.58, '#e2566b'], [0.72, '#ff8d5c'], [0.84, '#ffc374'], [1, '#ffe7ab']]),
      rg('sun', [[0, '#fffbe6'], [0.55, '#ffe9a8'], [1, '#ffc46b']], 'cx=".5" cy=".5" r=".5"'),
      rg('glow', [[0, '#fff2c2', 0.95], [0.12, '#ffd27d', 0.6], [0.4, '#ff8d5c', 0.22], [1, '#ff8d5c', 0]],
        `cx="${SX}" cy="${SY}" r="820" gradientUnits="userSpaceOnUse"`),
      lg('m0', [[0, '#a24a85'], [1, '#d36a7a']]),
      lg('d1', [[0, '#d0617a'], [1, '#a84a76']]),
      lg('d2', [[0, '#a24578'], [1, '#7c3274']]),
      lg('d3', [[0, '#7a2d70'], [1, '#55205f']]),
      lg('d4', [[0, '#521e5e'], [1, '#33164a']]),
      lg('d5', [[0, '#2f1445'], [1, '#170a2b']]),
      lg('haze', [[0, '#ffb878', 0], [0.5, '#ffb878', 0.28], [1, '#ffb878', 0]]),
      rg('vig', [[0, '#1a0630', 0], [0.65, '#1a0630', 0], [1, '#1a0630', 0.55]], `cx="${W / 2}" cy="${H / 2}" r="1150" gradientUnits="userSpaceOnUse"`),
      blur('bCloud', 7),
      blur('bHaze', 20),
      blur('bFar', 1.4)
    ].join('');

    let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
    body += stars(8, 80, { maxY: 330, bias: 2, bright: 0.04, color: '#ffe6f2', alpha: 0.6 });
    body += `<rect width="${W}" height="${H}" fill="url(#glow)"/>`;

    // thin clouds
    let clouds = '';
    const cloudCols = ['#ff9eb8', '#ffb38a', '#e377b4', '#ffc9a0'];
    for (let i = 0; i < 9; i++) {
      const y = rand(300, 620);
      const warm = y > 480;
      clouds += `<ellipse cx="${f(rand(100, 1800))}" cy="${f(y)}" rx="${f(rand(160, 420))}" ry="${f(rand(5, 13))}" fill="${cloudCols[warm ? Math.floor(rand(1, 4)) : Math.floor(rand(0, 3))]}" opacity="${f(rand(0.3, 0.6))}"/>`;
    }
    body += `<g filter="url(#bCloud)">${clouds}</g>`;

    body += `<circle cx="${SX}" cy="${SY}" r="92" fill="url(#sun)"/>`;

    // far jagged mountains (sun hides behind them)
    const far = ridge(14, 700, 712, 70, 0.52, 7);
    body += `<path d="${poly(far, 800)}" fill="url(#m0)" filter="url(#bFar)" opacity=".92"/>`;
    body += `<rect y="660" width="${W}" height="120" fill="url(#haze)" filter="url(#bHaze)"/>`;

    const dunes = [
      { y: 768, amp: 38, g: 'd1', rim: 'rgba(255,200,140,.55)' },
      { y: 830, amp: 52, g: 'd2', rim: 'rgba(255,160,130,.45)' },
      { y: 896, amp: 58, g: 'd3', rim: 'rgba(240,130,160,.38)' },
      { y: 968, amp: 50, g: 'd4', rim: 'rgba(200,100,170,.3)' },
      { y: 1034, amp: 36, g: 'd5', rim: 'rgba(160,80,190,.25)' }
    ];
    dunes.forEach((d, i) => {
      const pts = [];
      const step = 340 - i * 30;
      for (let x = -120; x < W + 160; x += step) pts.push([x + rand(-40, 40), d.y + rand(-d.amp, d.amp)]);
      const path = smooth(pts, H + 4);
      body += `<path d="${path}" fill="url(#${d.g})"/>`;
      body += `<path d="${smooth(pts)}" fill="none" stroke="${d.rim}" stroke-width="2.2" stroke-linecap="round"/>`;
      if (i < 4) body += `<rect y="${d.y + 20}" width="${W}" height="90" fill="url(#haze)" filter="url(#bHaze)" opacity="${f(0.55 - i * 0.1)}"/>`;
    });

    // birds
    let birds = '';
    [[420, 330, 1], [468, 352, 0.75], [380, 362, 0.6], [1530, 270, 0.85], [1580, 292, 0.6]].forEach((b) => {
      const s = b[2] * 16;
      birds += `<path d="M${b[0] - s} ${b[1]}Q${b[0] - s * 0.5} ${b[1] - s * 0.55} ${b[0]} ${b[1]}Q${b[0] + s * 0.5} ${b[1] - s * 0.55} ${b[0] + s} ${b[1]}" fill="none" stroke="#2a0f3d" stroke-width="2.6" stroke-linecap="round" opacity=".75"/>`;
    });
    body += birds;
    body += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
    return svg(defs, body);
  }

  // ------------------------------------------------------------------ 4. ocean
  function ocean() {
    const r = rng(313);
    const rand = (a, b) => a + (b - a) * r();
    const HOR = 590;
    const SX = 1240;

    const defs = [
      lg('sky', [[0, '#3e9be0'], [0.5, '#8ccdf4'], [0.9, '#d6f0fc'], [1, '#f2fbff']], ''),
      rg('sun', [[0, '#ffffff', 1], [0.18, '#fff8dc', 0.85], [0.5, '#ffe9a8', 0.25], [1, '#ffe9a8', 0]],
        `cx="${SX}" cy="360" r="520" gradientUnits="userSpaceOnUse"`),
      lg('sea', [[0, '#5bc0e6'], [0.25, '#2a93cc'], [1, '#07396a']]),
      lg('cloud', [[0, '#ffffff', 0.95], [1, '#e3f3ff', 0.85]]),
      lg('glint', [[0, '#ffffff', 0], [0.5, '#ffffff', 0.9], [1, '#ffffff', 0]], 'x1="0" y1="0" x2="1" y2="0"'),
      rg('vig', [[0, '#021a38', 0], [0.7, '#021a38', 0], [1, '#021a38', 0.4]], `cx="${W / 2}" cy="${H / 2}" r="1150" gradientUnits="userSpaceOnUse"`),
      blur('bCloud', 9),
      blur('bFar', 1)
    ].join('');

    let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
    body += `<rect width="${W}" height="${H}" fill="url(#sun)"/>`;

    // clouds
    const cloud = (cx, cy, s, op) => {
      let c = '';
      [[0, 0, 150, 34], [-110, 18, 110, 26], [120, 14, 120, 28], [40, -26, 90, 30], [-50, -18, 80, 26]].forEach((e) => {
        c += `<ellipse cx="${f(cx + e[0] * s)}" cy="${f(cy + e[1] * s)}" rx="${f(e[2] * s)}" ry="${f(e[3] * s)}"/>`;
      });
      return `<g fill="url(#cloud)" opacity="${op}">${c}</g>`;
    };
    body += `<g filter="url(#bCloud)">${cloud(380, 190, 1.7, 0.9)}${cloud(1480, 130, 1.4, 0.8)}${cloud(900, 330, 1.1, 0.75)}${cloud(1700, 380, 1.2, 0.7)}${cloud(150, 450, 0.9, 0.7)}</g>`;

    // horizon haze + sea
    body += `<rect y="${HOR - 2}" width="${W}" height="${H - HOR + 2}" fill="url(#sea)"/>`;
    body += `<rect y="${HOR - 4}" width="${W}" height="8" fill="#ffffff" opacity=".35" filter="url(#bFar)"/>`;

    // sailboat on the horizon
    body += `<g transform="translate(560 ${HOR - 6}) scale(.8)" opacity=".92"><path d="M0 0L-4 -64L-34 -8Z" fill="#ffffff"/><path d="M6 -4L6 -78L40 -8Z" fill="#fff4e0"/><path d="M-36 0h86l-10 10h-64Z" fill="#17314d"/></g>`;

    // sun glitter column
    let glint = '';
    for (let i = 0; i < 160; i++) {
      const t = Math.pow(r(), 1.2);
      const y = HOR + 6 + t * 430;
      const spread = 40 + t * 280;
      const w = rand(14, 60) * (0.5 + t * 1.2);
      glint += `<rect x="${f(SX + rand(-spread, spread) - w / 2)}" y="${f(y)}" width="${f(w)}" height="${f(1.6 + t * 2.4)}" rx="1.5" fill="url(#glint)" opacity="${f(rand(0.25, 0.9) * (1 - t * 0.55))}"/>`;
    }

    // wave layers (far → near)
    const top = ['#5fc6ea', '#46b3de', '#2f9ad0', '#1d82bf', '#126aa6', '#0b5590', '#07437a'];
    const base = ['#3aa7d8', '#2790c8', '#1b7ab6', '#1265a0', '#0c5189', '#073f73', '#052f5c'];
    top.forEach((tc, i) => {
      const y0 = HOR + 20 + i * 62 + i * i * 4;
      const amp = 3 + i * 4.5;
      const wl = 240 + i * 95;
      const ph = rand(0, 6);
      const pts = [];
      for (let x = -80; x <= W + 120; x += 30) {
        pts.push([x, y0 + amp * Math.sin((x / wl) * Math.PI * 2 + ph) + amp * 0.4 * Math.sin((x / (wl * 0.43)) * Math.PI * 2 + ph * 2)]);
      }
      body += `<defs>${lg('w' + i, [[0, tc], [1, base[i]]])}</defs>`;
      body += `<path d="${smooth(pts, H + 4)}" fill="url(#w${i})"/>`;
      body += `<path d="${smooth(pts)}" fill="none" stroke="#ffffff" stroke-opacity="${f(0.16 + i * 0.045)}" stroke-width="${f(1.2 + i * 0.5)}"/>`;
      if (i === 1) body += glint;
    });

    // seabirds
    let birds = '';
    [[760, 250, 1], [812, 276, 0.7], [1040, 210, 0.8]].forEach((b) => {
      const s = b[2] * 18;
      birds += `<path d="M${b[0] - s} ${b[1]}Q${b[0] - s * 0.5} ${b[1] - s * 0.6} ${b[0]} ${b[1]}Q${b[0] + s * 0.5} ${b[1] - s * 0.6} ${b[0] + s} ${b[1]}" fill="none" stroke="#183a5c" stroke-width="2.4" stroke-linecap="round" opacity=".6"/>`;
    });
    body += birds;
    body += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
    return svg(defs, body);
  }

  // ------------------------------------------------------------------ 5. mountains
  function roughen(pts, rr, passes, amp) {
    let out = pts;
    let a = amp;
    for (let k = 0; k < passes; k++) {
      const next = [];
      for (let i = 0; i < out.length - 1; i++) {
        const p = out[i];
        const q = out[i + 1];
        next.push(p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + (rr() - 0.5) * 2 * a]);
      }
      next.push(out[out.length - 1]);
      out = next;
      a *= 0.55;
    }
    return out;
  }

  /** Alpine skyline: n peaks with shoulders and valleys, then roughened. */
  function peaks(seed, baseY, n, minH, maxH) {
    const rr = rng(seed);
    const step = (W + 80) / n;
    const pts = [[-40, baseY - rr() * 50]];
    for (let i = 0; i < n; i++) {
      const cx = -40 + step * (i + 0.5) + (rr() - 0.5) * step * 0.45;
      const h = minH + rr() * (maxH - minH);
      pts.push([-40 + step * i + step * 0.04, baseY - rr() * 40]);
      pts.push([cx - step * 0.16, baseY - h * (0.5 + rr() * 0.2)]);
      pts.push([cx, baseY - h]);
      pts.push([cx + step * 0.17, baseY - h * (0.45 + rr() * 0.25)]);
    }
    pts.push([W + 40, baseY - rr() * 50]);
    return roughen(pts, rr, 3, 16);
  }

  function mountains() {
    const r = rng(2025);
    const rand = (a, b) => a + (b - a) * r();
    const SX = 1320;

    const defs = [
      lg('sky', [[0, '#27457a'], [0.35, '#5f86b9'], [0.65, '#c3b5c4'], [0.85, '#f5cfa9'], [1, '#ffe9cb']]),
      rg('sun', [[0, '#fffaf0', 0.95], [0.12, '#ffe7b8', 0.65], [0.45, '#ffc38f', 0.22], [1, '#ffc38f', 0]],
        `cx="${SX}" cy="500" r="760" gradientUnits="userSpaceOnUse"`),
      lg('mist', [[0, '#eaf2ff', 0], [0.5, '#eaf2ff', 0.55], [1, '#eaf2ff', 0]]),
      lg('snow', [[0, '#ffffff'], [1, '#d6e3fb']]),
      rg('vig', [[0, '#0a1a30', 0], [0.7, '#0a1a30', 0], [1, '#0a1a30', 0.42]], `cx="${W / 2}" cy="${H / 2}" r="1150" gradientUnits="userSpaceOnUse"`),
      blur('bMist', 18),
      blur('bFar', 1.4),
      blur('bMid', 0.6)
    ];
    const layers = [
      { build: () => peaks(8, 610, 6, 190, 400), top: '#c9d6ee', bot: '#8fa5d0', dark: '#8a9dc8', dx: 38, blur: 'bFar', snowLine: 420, mist: 0.35 },
      { build: () => peaks(19, 690, 8, 90, 230), top: '#a8bae0', bot: '#7189b8', dark: '#7489b5', dx: 26, blur: 'bFar', snowLine: 535, mist: 0.5 },
      { build: () => ridge(17, 745, 760, 120, 0.56, 7), top: '#8299c6', bot: '#566f9b', dark: '#58709b', dx: 18, blur: 'bMid', mist: 0.5 },
      { build: () => ridge(23, 800, 780, 105, 0.54, 7), top: '#5f7ba3', bot: '#3c5a82', mist: 0.45 },
      { build: () => ridge(37, 870, 890, 90, 0.52, 7), top: '#35557a', bot: '#223c5c', pines: '#1e374f', mist: 0.4 },
      { build: () => ridge(41, 960, 940, 70, 0.5, 7), top: '#162a40', bot: '#0b1a2b', pines: '#0b1826' }
    ];
    layers.forEach((l, i) => defs.push(lg('ly' + i, [[0, l.top], [1, l.bot]])));

    let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/><rect width="${W}" height="${H}" fill="url(#sun)"/>`;
    body += stars(61, 40, { maxY: 220, bias: 2, bright: 0.04, alpha: 0.35 });

    let extra = '';
    layers.forEach((l, i) => {
      const pts = l.build();
      const flt = l.blur ? ` filter="url(#${l.blur})"` : '';
      extra += `<path id="rp${i}" d="${poly(pts, H + 4)}"/><clipPath id="fc${i}"><use href="#rp${i}"/></clipPath>`;
      if (l.dx) {
        // left slopes stay in shade: the lit copy is shifted right and clipped to the ridge
        body += `<g${flt}><use href="#rp${i}" fill="${l.dark}"/><g clip-path="url(#fc${i})"><use href="#rp${i}" transform="translate(${l.dx} 0)" fill="url(#ly${i})"/></g></g>`;
      } else {
        body += `<use href="#rp${i}" fill="url(#ly${i})"${flt}/>`;
      }
      if (l.snowLine) {
        let zig = `M-60 -20H${W + 60}V${f(l.snowLine)}`;
        for (let x = W + 40; x >= -60; x -= 14) zig += `L${x} ${f(l.snowLine + 22 * Math.sin(x / 61) + 14 * Math.sin(x / 23 + i) + rand(-9, 9))}`;
        extra += `<clipPath id="sc${i}"><path d="${zig}Z"/></clipPath>`;
        body += `<g clip-path="url(#sc${i})"${flt}><use href="#rp${i}" fill="#b4c4e6"/><g clip-path="url(#fc${i})"><use href="#rp${i}" transform="translate(${l.dx} 0)" fill="url(#snow)"/></g></g>`;
      }
      if (l.pines) {
        let trees = '';
        for (let x = 20; x < W; x += rand(26, 58)) {
          let best = pts[0];
          for (const q of pts) if (Math.abs(q[0] - x) < Math.abs(best[0] - x)) best = q;
          trees += pine(x, best[1] + 14, rand(34, 78) * (0.6 + i * 0.12), l.pines);
        }
        body += trees;
      }
      if (l.mist) {
        body += `<rect y="${[610, 690, 745, 800, 870][i] + 20}" width="${W}" height="150" fill="url(#mist)" filter="url(#bMist)" opacity="${l.mist}"/>`;
      }
    });
    body += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
    return svg(defs.join('') + extra, body);
  }

  // ------------------------------------------------------------------ 6. blobs ("bloom")
  function blobs() {
    const defs = [
      lg('bg', [[0, '#0c0b2e'], [0.5, '#1a1260'], [1, '#2a0f55']], 'x1="0" y1="0" x2="1" y2="1"'),
      lg('petal', [[0, '#ffffff', 0.55], [0.45, '#ffffff', 0.12], [1, '#ffffff', 0.02]]),
      lg('petalEdge', [[0, '#ffffff', 0.7], [1, '#ffffff', 0]]),
      rg('core', [[0, '#fff3d6', 0.95], [0.3, '#ffb36b', 0.5], [1, '#ff4fa3', 0]], `cx="${W / 2}" cy="${H / 2}" r="360" gradientUnits="userSpaceOnUse"`),
      rg('vig', [[0, '#05031a', 0], [0.7, '#05031a', 0], [1, '#05031a', 0.55]], `cx="${W / 2}" cy="${H / 2}" r="1150" gradientUnits="userSpaceOnUse"`),
      blur('bOrb', 95, 'x="-50%" y="-50%" width="200%" height="200%"'),
      blur('bPetal', 1.5),
      blur('bCore', 40)
    ].join('');

    let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
    const orbs = [
      [380, 280, 430, '#ff3d9a', 0.85], [1560, 240, 400, '#1fc8ff', 0.8], [1180, 960, 460, '#ff8a2b', 0.8],
      [260, 900, 380, '#7a4dff', 0.85], [1730, 880, 300, '#2ee6a8', 0.7], [960, 80, 320, '#6a5cff', 0.7]
    ];
    body += `<g filter="url(#bOrb)">${orbs.map((o) => `<circle cx="${o[0]}" cy="${o[1]}" r="${o[2]}" fill="${o[3]}" opacity="${o[4]}"/>`).join('')}</g>`;

    // the bloom: translucent glass petals rotated around the centre
    let petals = '';
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (360 / n) * i + 8;
      petals += `<g transform="rotate(${f(a)} 960 540)"><ellipse cx="960" cy="285" rx="150" ry="290" fill="url(#petal)" stroke="url(#petalEdge)" stroke-width="2.2"/></g>`;
    }
    for (let i = 0; i < n; i++) {
      const a = (360 / n) * i + 27;
      petals += `<g transform="rotate(${f(a)} 960 540)"><ellipse cx="960" cy="375" rx="96" ry="178" fill="url(#petal)" stroke="url(#petalEdge)" stroke-width="2" opacity=".85"/></g>`;
    }
    body += `<g style="mix-blend-mode:screen" filter="url(#bPetal)">${petals}</g>`;
    body += `<circle cx="960" cy="540" r="250" fill="url(#core)" filter="url(#bCore)"/>`;
    body += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
    return svg(defs, body);
  }

  // ------------------------------------------------------------------ 8. pastel
  function pastel() {
    const defs = [
      lg('bg', [[0, '#fff4ea'], [0.5, '#f3ebff'], [1, '#e3f2ff']], 'x1="0" y1="0" x2="1" y2="1"'),
      lg('wave', [[0, '#ffffff', 0.55], [1, '#ffffff', 0.08]]),
      blur('bOrb', 70, 'x="-50%" y="-50%" width="200%" height="200%"'),
      blur('bWave', 1)
    ].join('');
    let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
    const orbs = [
      [300, 240, 400, '#ffc6b0', 0.95], [1560, 180, 420, '#cdbcff', 0.95], [1700, 900, 400, '#b9efd9', 0.95],
      [380, 950, 440, '#b4dbff', 0.95], [980, 540, 330, '#ffc4dd', 0.7], [1200, 120, 260, '#fff0b8', 0.8]
    ];
    body += `<g filter="url(#bOrb)">${orbs.map((o) => `<circle cx="${o[0]}" cy="${o[1]}" r="${o[2]}" fill="${o[3]}" opacity="${o[4]}"/>`).join('')}</g>`;
    const waves = [
      'M-40 700C260 560 520 820 840 700C1160 580 1420 840 1760 700C1860 656 1920 650 1980 660V1100H-40Z',
      'M-40 800C300 700 560 900 900 800C1240 700 1480 920 1800 800C1880 770 1930 770 1980 780V1100H-40Z',
      'M-40 900C340 830 620 980 960 900C1300 820 1560 1000 1980 880V1100H-40Z'
    ];
    body += `<g filter="url(#bWave)">${waves.map((d, i) => `<path d="${d}" fill="url(#wave)" stroke="#fff" stroke-opacity="${f(0.7 - i * 0.15)}" stroke-width="1.6"/>`).join('')}</g>`;
    return svg(defs, body);
  }

  // ------------------------------------------------------------------ 9. cosmos
  function cosmos() {
    const defs = [
      rg('bg', [[0, '#120a2e'], [0.6, '#070419'], [1, '#02010a']], `cx="${W * 0.55}" cy="${H * 0.4}" r="1300" gradientUnits="userSpaceOnUse"`),
      rg('planet', [[0, '#5b7cff'], [0.55, '#2a2f8f'], [1, '#080a30']], 'cx=".34" cy=".3" r=".85"'),
      rg('atmo', [[0.8, '#7dd3fc', 0], [0.93, '#7dd3fc', 0.28], [0.975, '#9ad9ff', 0.5], [1, '#7dd3fc', 0]], 'cx=".5" cy=".5" r=".5"'),
      lg('shade', [[0, '#000', 0], [0.55, '#000', 0.1], [1, '#000', 0.8]], 'x1="0" y1="0" x2="1" y2="1"'),
      rg('vig', [[0, '#000', 0], [0.65, '#000', 0], [1, '#000', 0.6]], `cx="${W / 2}" cy="${H / 2}" r="1150" gradientUnits="userSpaceOnUse"`),
      blur('bNeb', 80, 'x="-50%" y="-50%" width="200%" height="200%"'),
      blur('bSoft', 18)
    ].join('');
    let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
    body += `<g filter="url(#bNeb)">
      <ellipse cx="560" cy="330" rx="560" ry="230" fill="#c026d3" opacity=".42" transform="rotate(-18 560 330)"/>
      <ellipse cx="1300" cy="520" rx="640" ry="250" fill="#4f46e5" opacity=".5" transform="rotate(22 1300 520)"/>
      <ellipse cx="1680" cy="220" rx="320" ry="170" fill="#06b6d4" opacity=".38"/>
      <ellipse cx="900" cy="760" rx="520" ry="150" fill="#7c3aed" opacity=".3" transform="rotate(-8 900 760)"/></g>`;
    body += stars(99, 460, { maxY: H, bias: 1, bright: 0.07, color: '#f2ecff' });
    body += `<g transform="translate(300 1130)"><circle r="470" fill="url(#atmo)" transform="scale(1.06)"/><circle r="440" fill="url(#planet)"/><circle r="440" fill="url(#shade)"/>
      <g filter="url(#bSoft)" opacity=".22" transform="rotate(-14)"><ellipse cx="-60" cy="-300" rx="300" ry="14" fill="#9cc1ff"/><ellipse cx="40" cy="-230" rx="360" ry="10" fill="#b7a6ff"/></g></g>`;
    body += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
    return svg(defs, body);
  }

  // ------------------------------------------------------------------ 7. midnight (mostly CSS)
  function midnightStars() {
    const defs = '';
    return svg(defs, stars(7, 90, { maxY: H, bias: 1.1, bright: 0.04, color: '#c8d3ff', alpha: 0.9 }));
  }

  // ------------------------------------------------------------------ registry
  const SPECS = [
    { id: 'bamboo', name: 'Bambu Ormanı', tone: 'dark', dim: 0.8, fallback: '#07211f', svg: bamboo },
    { id: 'aurora', name: 'Kuzey Işıkları', tone: 'dark', dim: 0.85, fallback: '#050d2b', svg: aurora },
    { id: 'sunset', name: 'Gün Batımı', tone: 'dark', dim: 0.72, fallback: '#4a1d6b', svg: sunset },
    { id: 'ocean', name: 'Okyanus', tone: 'dark', bright: true, dim: 0.6, fallback: '#2a93cc', svg: ocean },
    { id: 'mountains', name: 'Dağlar', tone: 'dark', bright: true, dim: 0.62, fallback: '#4d6c96', svg: mountains },
    { id: 'blobs', name: 'Akışkan Renkler', tone: 'dark', dim: 0.78, fallback: '#1a1260', svg: blobs },
    {
      id: 'midnight',
      name: 'Gece Yarısı',
      tone: 'dark',
      dim: 0.95,
      build() {
        return `${uri(midnightStars())} center / cover no-repeat, `
          + 'radial-gradient(1200px 760px at 12% -10%, color-mix(in srgb, var(--accent, #2f9e6b) 38%, transparent), transparent 72%), '
          + 'radial-gradient(1000px 760px at 108% 116%, rgba(96, 108, 240, .34), transparent 70%), '
          + 'radial-gradient(700px 500px at 70% 30%, rgba(120, 130, 255, .07), transparent 70%), '
          + 'linear-gradient(160deg, #0e1424 0%, #080b16 58%, #05060d 100%)';
      }
    },
    { id: 'pastel', name: 'Pastel', tone: 'light', dim: 0.5, fallback: '#f3ebff', svg: pastel },
    { id: 'cosmos', name: 'Kozmos', tone: 'dark', dim: 0.9, fallback: '#070419', svg: cosmos }
  ];

  const wallpapers = SPECS.map((spec) => {
    let cache = null;
    const item = { id: spec.id, name: spec.name, tone: spec.tone, bright: !!spec.bright, dim: spec.dim == null ? 0.8 : spec.dim };
    Object.defineProperty(item, 'css', {
      enumerable: true,
      get() {
        if (cache == null) {
          try {
            cache = spec.build ? spec.build() : `${uri(spec.svg())} center / cover no-repeat, ${spec.fallback}`;
          } catch (e) {
            console.error(`[wallpapers] "${spec.id}" üretilemedi`, e);
            cache = spec.fallback || '#0b1210';
          }
        }
        return cache;
      }
    });
    return item;
  });

  const DEFAULT_ID = 'bamboo';
  const byId = (id) => wallpapers.find((w) => w.id === id) || null;

  function vfsImage(value) {
    const path = String(value).slice(4);
    const fs = P.fs;
    if (!fs || !path) return null;
    try {
      const data = String(fs.readFile(path) || '').trim();
      if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(data)) return data.replace(/["\\\r\n]/g, (c) => encodeURIComponent(c));
    } catch (e) { /* missing or unreadable → default */ }
    return null;
  }

  /** CSS `background` value for a wallpaper id or 'vfs:/abs/path' (unknown → bamboo). */
  wallpapers.css = function css(value) {
    const v = String(value == null ? '' : value);
    if (v.startsWith('vfs:')) {
      const data = vfsImage(v);
      if (data) return `url("${data}") center / cover no-repeat, #000`;
      return byId(DEFAULT_ID).css;
    }
    return (byId(v) || byId(DEFAULT_ID)).css;
  };

  /** 'dark' | 'light' — the luminance of the wallpaper's top-left region (icon label colour). */
  wallpapers.tone = function tone(value) {
    const w = byId(String(value || ''));
    return w ? w.tone : 'dark';
  };

  /** true for dark-toned wallpapers that still have a pale sky / clouds behind the first icon column (labels need extra help). */
  wallpapers.bright = function bright(value) {
    const w = byId(String(value || ''));
    return !!(w && w.bright);
  };

  /** How strongly the lock screen darkens this wallpaper (0..1 brightness multiplier). */
  wallpapers.dim = function dim(value) {
    const w = byId(String(value || ''));
    return w ? w.dim : 0.8;
  };

  wallpapers.get = byId;
  wallpapers.DEFAULT = DEFAULT_ID;

  P.wallpapers = wallpapers;
})();
