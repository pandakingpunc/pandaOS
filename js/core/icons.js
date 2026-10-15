/* PandaOS icon set (C5).
   - Colorful icons: 48x48 art (squircle app tiles, folder / document silhouettes, brand panda).
   - Glyphs: 24x24, fill none, stroke currentColor, 1.75 round (Lucide / Fluent like).
   Every get() call returns a fresh SVG string whose ids (gradients, clipPaths, filters, <use> targets)
   are rewritten to unique ones, because inline SVGs share the id namespace of the document. */
(function () {
  'use strict';

  const P = (window.PandaOS = window.PandaOS || {});
  const NS = 'http://www.w3.org/2000/svg';
  const num = (n) => String(+n.toFixed(2));

  // ------------------------------------------------------------------ geometry helpers
  // Closed Catmull-Rom spline through points of a superellipse -> smooth Apple-like squircle.
  function squircle(cx, cy, hw, hh, n, count) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      pts.push([
        cx + hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
        cy + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)
      ]);
    }
    let d = `M${num(pts[0][0])} ${num(pts[0][1])}`;
    for (let i = 0; i < count; i++) {
      const p0 = pts[(i - 1 + count) % count];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % count];
      const p3 = pts[(i + 2) % count];
      d += `C${num(p1[0] + (p2[0] - p0[0]) / 6)} ${num(p1[1] + (p2[1] - p0[1]) / 6)} `
        + `${num(p2[0] - (p3[0] - p1[0]) / 6)} ${num(p2[1] - (p3[1] - p1[1]) / 6)} ${num(p2[0])} ${num(p2[1])}`;
    }
    return `${d}Z`;
  }

  // Gear outline: `teeth` trapezoid teeth around (cx, cy).
  function gearPath(cx, cy, rOut, rIn, teeth, tipDeg, baseDeg) {
    const pts = [];
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * 360;
      [[rIn, a - baseDeg], [rOut, a - tipDeg], [rOut, a + tipDeg], [rIn, a + baseDeg]].forEach(([r, deg]) => {
        const t = ((deg - 90) * Math.PI) / 180;
        pts.push(`${num(cx + r * Math.cos(t))} ${num(cy + r * Math.sin(t))}`);
      });
    }
    return `M${pts.join('L')}Z`;
  }

  const circlePath = (cx, cy, r) => `M${num(cx + r)} ${cy}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0z`;

  function clockTicks(cx, cy, rOut) {
    let major = '';
    let minor = '';
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      const s = Math.sin(a);
      const c = -Math.cos(a);
      const isMajor = i % 3 === 0;
      const r1 = isMajor ? rOut - 3.4 : rOut - 2.1;
      const seg = `M${num(cx + s * r1)} ${num(cy + c * r1)}L${num(cx + s * rOut)} ${num(cy + c * rOut)}`;
      if (isMajor) major += seg; else minor += seg;
    }
    return { major, minor };
  }

  // ------------------------------------------------------------------ svg wrappers + tables
  const COLOR = new Map();
  const GLYPH = new Map();

  const color = (name, body) => {
    COLOR.set(name, `<svg xmlns="${NS}" viewBox="0 0 48 48" width="48" height="48" fill="none" aria-hidden="true" focusable="false" data-icon="${name}">${body}</svg>`);
  };
  const glyph = (name, body) => {
    GLYPH.set(name, `<svg xmlns="${NS}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="${name}">${body}</svg>`);
  };

  // ------------------------------------------------------------------ colorful building blocks
  const SQ = squircle(24, 22.5, 20.5, 20.5, 5, 64);

  // Squircle app tile: soft drop shadow, vertical gradient, top highlight, bottom shade, inner rim.
  function tile(top, bottom) {
    return `<defs>
<path id="sq" d="${SQ}"/>
<linearGradient id="tb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
<linearGradient id="th" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="ts" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
<linearGradient id="tr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
<clipPath id="tc"><use href="#sq"/></clipPath>
<filter id="tf" x="-20%" y="-20%" width="140%" height="155%"><feGaussianBlur stdDeviation="1.25"/></filter>
</defs>
<use href="#sq" fill="#070b18" fill-opacity=".42" filter="url(#tf)" transform="translate(0 1.5)"/>
<use href="#sq" fill="url(#tb)"/>
<g clip-path="url(#tc)"><rect x="0" y="0" width="48" height="25" fill="url(#th)"/><rect x="0" y="24" width="48" height="24" fill="url(#ts)"/></g>
<use href="#sq" fill="none" stroke="url(#tr)" stroke-width="1.4" clip-path="url(#tc)"/>
<use href="#sq" fill="none" stroke="#000" stroke-opacity=".16" stroke-width=".6"/>`;
  }

  // Soft ground shadow for silhouette icons (folder, bin, ...).
  const groundShadow = (cx, cy, rx, ry, op) => `<defs><radialGradient id="gs"><stop offset="0" stop-color="#0b1020" stop-opacity="${op || 0.34}"/><stop offset="1" stop-color="#0b1020" stop-opacity="0"/></radialGradient></defs><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#gs)"/>`;

  // The brand panda face; used by `panda` and `avatar`. All ids are local (rewritten by get()).
  const PANDA_FACE = `<defs>
<radialGradient id="pw" cx=".38" cy=".25" r=".95"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f1f3f8"/><stop offset="1" stop-color="#dde2ec"/></radialGradient>
<radialGradient id="pk" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#3a3f4c"/><stop offset="1" stop-color="#14161b"/></radialGradient>
</defs>
<circle cx="11.4" cy="11.6" r="6.7" fill="url(#pk)" stroke="#4a5163" stroke-width="1"/>
<circle cx="36.6" cy="11.6" r="6.7" fill="url(#pk)" stroke="#4a5163" stroke-width="1"/>
<circle cx="11.6" cy="11.9" r="2.9" fill="#4a5163" fill-opacity=".55"/>
<circle cx="36.4" cy="11.9" r="2.9" fill="#4a5163" fill-opacity=".55"/>
<ellipse cx="24" cy="26.2" rx="18.6" ry="16.6" fill="url(#pw)" stroke="#252932" stroke-width="1.5"/>
<ellipse cx="16.1" cy="25.2" rx="4.4" ry="6" transform="rotate(24 16.1 25.2)" fill="url(#pk)"/>
<ellipse cx="31.9" cy="25.2" rx="4.4" ry="6" transform="rotate(-24 31.9 25.2)" fill="url(#pk)"/>
<circle cx="16.9" cy="24.3" r="2.1" fill="#fff"/>
<circle cx="31.1" cy="24.3" r="2.1" fill="#fff"/>
<circle cx="17.2" cy="24.6" r="1" fill="#14161b"/>
<circle cx="30.8" cy="24.6" r="1" fill="#14161b"/>
<ellipse cx="11.6" cy="32.4" rx="2.7" ry="1.8" fill="#ff8fa6" fill-opacity=".5"/>
<ellipse cx="36.4" cy="32.4" rx="2.7" ry="1.8" fill="#ff8fa6" fill-opacity=".5"/>
<path d="M20.8 29.6c0-1.3 1.4-2.1 3.2-2.1s3.2.8 3.2 2.1c0 1.5-1.7 2.6-3.2 2.6s-3.2-1.1-3.2-2.6z" fill="#14161b"/>
<ellipse cx="22.9" cy="28.5" rx="1.2" ry=".6" fill="#fff" fill-opacity=".45"/>
<path d="M24 32.1v1.2M20.9 33.8c1.1 1.5 2.4 1.5 3.1-.5.7 2 2 2 3.1.5" stroke="#14161b" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`;

  // ------------------------------------------------------------------ colorful icons: apps
  // files: sky tile, amber folder, document peeking, panda paw print on the front panel
  color('files', `${tile('#66cfff', '#2472f2')}
<defs>
<linearGradient id="fb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f9b93a"/><stop offset="1" stop-color="#df8a0c"/></linearGradient>
<linearGradient id="ff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe784"/><stop offset="1" stop-color="#ffb81f"/></linearGradient>
</defs>
<path d="M8.5 14.6a2.4 2.4 0 0 1 2.4-2.4h6.6c.9 0 1.7.4 2.2 1.1l1.2 1.6h16.2a2.4 2.4 0 0 1 2.4 2.4V33H8.5z" fill="url(#fb)"/>
<g transform="rotate(-3.5 23.5 19)"><rect x="12.5" y="11" width="22" height="16" rx="1.8" fill="#fff"/><path d="M15.6 15.4h11M15.6 19h15.2M15.6 22.6h8.6" stroke="#b6c4e0" stroke-width="1.5" stroke-linecap="round"/></g>
<path d="M7.4 21.4a2.4 2.4 0 0 1 2.4-2.4h28.4a2.4 2.4 0 0 1 2.4 2.4V35a2.4 2.4 0 0 1-2.4 2.4H9.8A2.4 2.4 0 0 1 7.4 35z" fill="url(#ff)"/>
<path d="M9.8 19.4h28.4" stroke="#fff" stroke-opacity=".65" stroke-width="1"/>
<g fill="#9a5600" fill-opacity=".42"><path d="M24 35.2c-3.3 0-5.4-1.5-5.4-3.3 0-1.8 1.7-3.3 2.9-3.3.9 0 1.6.5 2.5.5s1.6-.5 2.5-.5c1.2 0 2.9 1.5 2.9 3.3 0 1.8-2.1 3.3-5.4 3.3z"/><ellipse cx="17.8" cy="27.4" rx="1.4" ry="1.9" transform="rotate(-25 17.8 27.4)"/><ellipse cx="21.7" cy="24.3" rx="1.5" ry="2.1" transform="rotate(-8 21.7 24.3)"/><ellipse cx="26.3" cy="24.3" rx="1.5" ry="2.1" transform="rotate(8 26.3 24.3)"/><ellipse cx="30.2" cy="27.4" rx="1.4" ry="1.9" transform="rotate(25 30.2 27.4)"/></g>`);

  // terminal: dark tile, window dots, glowing green >_ prompt
  color('terminal', `${tile('#3b404d', '#14161c')}
<circle cx="9.6" cy="9" r="1.2" fill="#ff5f57"/><circle cx="13.5" cy="9" r="1.2" fill="#febc2e"/><circle cx="17.4" cy="9" r="1.2" fill="#28c840"/>
<path d="M7 13.2h34" stroke="#fff" stroke-opacity=".1" stroke-width=".8"/>
<g stroke="#3ee08f" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20l8.2 6.2L12 32.4M24.5 33.2h10.5" stroke-width="7" stroke-opacity=".16"/><path d="M12 20l8.2 6.2L12 32.4M24.5 33.2h10.5" stroke-width="3.3"/></g>`);

  // notepad: warm tile, memo pad with coral header and ruled lines, blue pencil
  color('notepad', `${tile('#ffe27c', '#ffa91c')}
<defs>
<linearGradient id="pp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9edf6"/></linearGradient>
<linearGradient id="pb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6aa8ff"/><stop offset="1" stop-color="#2b63e8"/></linearGradient>
</defs>
<rect x="10.4" y="9.2" width="22" height="29" rx="2.8" fill="#7a4a00" fill-opacity=".22"/>
<rect x="10.4" y="8" width="22" height="29" rx="2.8" fill="url(#pp)"/>
<path d="M10.4 10.8A2.8 2.8 0 0 1 13.2 8h16.4a2.8 2.8 0 0 1 2.8 2.8v3H10.4z" fill="#f2655b"/>
<circle cx="15.2" cy="10.9" r="1" fill="#fff" fill-opacity=".75"/><circle cx="21.4" cy="10.9" r="1" fill="#fff" fill-opacity=".75"/><circle cx="27.6" cy="10.9" r="1" fill="#fff" fill-opacity=".75"/>
<path d="M14.2 19.2h14M14.2 23.6h14M14.2 28h14M14.2 32.4h8" stroke="#b4c1dc" stroke-width="1.5" stroke-linecap="round"/>
<g transform="translate(33 30.5) rotate(40)">
<rect x="-2.3" y="-9" width="5.2" height="15" rx=".6" fill="#000" fill-opacity=".2"/>
<rect x="-2.6" y="-10" width="5.2" height="15.4" fill="url(#pb)"/>
<path d="M-.6 -10v15.4" stroke="#fff" stroke-opacity=".38" stroke-width=".9"/>
<rect x="-2.6" y="-12.4" width="5.2" height="2.6" fill="#d8deea"/>
<path d="M-2.6 -11.2h5.2" stroke="#9aa5bb" stroke-width=".6"/>
<path d="M-2.6 -12.4v-.6a1.7 1.7 0 0 1 1.7-1.7h1.8a1.7 1.7 0 0 1 1.7 1.7v.6z" fill="#ff8fa6"/>
<path d="M-2.6 5.4h5.2L0 11z" fill="#f3d3a1"/>
<path d="M-.95 8.6h1.9L0 11z" fill="#3a3f4c"/>
</g>`);

  // calculator: slate tile, LCD display, keypad with orange operator column
  (function () {
    const cols = [9.6, 17.3, 25, 32.7];
    const KW = 6;
    const keys = [];
    const fn = '#b3bbcd';
    const nm = '#f1f3f8';
    [[20.2, fn], [26.9, nm], [33.6, nm]].forEach(([y, c], row) => {
      for (let i = 0; i < 3; i++) keys.push(`<rect x="${cols[i]}" y="${y}" width="${KW}" height="5.4" rx="1.7" fill="${c}"/>`);
      if (row === 0) keys.push(`<rect x="${cols[3]}" y="${y}" width="${KW}" height="5.4" rx="1.7" fill="url(#ok)"/>`);
    });
    keys.push(`<rect x="${cols[3]}" y="26.9" width="${KW}" height="12.1" rx="1.7" fill="url(#ok)"/>`);
    color('calculator', `${tile('#5d667b', '#262b39')}
<defs>
<linearGradient id="ok" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb340"/><stop offset="1" stop-color="#ff8a00"/></linearGradient>
<linearGradient id="lcd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9f6e5"/><stop offset="1" stop-color="#a5dfc0"/></linearGradient>
</defs>
<rect x="9.6" y="8.4" width="29.1" height="9.4" rx="2.4" fill="url(#lcd)"/>
<path d="M28.4 13.1h7.8" stroke="#2b6a4d" stroke-width="2.4" stroke-linecap="round"/><path d="M24 13.1h1.4" stroke="#2b6a4d" stroke-opacity=".4" stroke-width="2.4" stroke-linecap="round"/>
${keys.join('')}`);
  })();

  // music: pink -> violet tile, bokeh, white beamed notes
  color('music', `${tile('#ff80b5', '#7a3df0')}
<defs><linearGradient id="nw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffd9ec"/></linearGradient></defs>
<g clip-path="url(#tc)"><circle cx="38" cy="10" r="10" fill="#fff" fill-opacity=".12"/><circle cx="8" cy="38" r="12" fill="#fff" fill-opacity=".08"/></g>
<g fill="#3a0a6e" fill-opacity=".28" transform="translate(.7 1.3)"><ellipse cx="17.6" cy="32.4" rx="3.9" ry="3" transform="rotate(-20 17.6 32.4)"/><ellipse cx="30.6" cy="29.2" rx="3.9" ry="3" transform="rotate(-20 30.6 29.2)"/><path d="M20.4 14.6L33.6 11.8V16L20.4 18.8z"/><rect x="19.9" y="15" width="2.4" height="17"/><rect x="32.9" y="12" width="2.4" height="17"/></g>
<g fill="url(#nw)"><ellipse cx="17.6" cy="32.4" rx="3.9" ry="3" transform="rotate(-20 17.6 32.4)"/><ellipse cx="30.6" cy="29.2" rx="3.9" ry="3" transform="rotate(-20 30.6 29.2)"/><path d="M20.4 14.6L33.6 11.8V16L20.4 18.8z"/><rect x="19.9" y="15" width="2.4" height="17"/><rect x="32.9" y="12" width="2.4" height="17"/></g>`);

  // minesweeper: silver tile, raised cell grid, spiky mine, red flag
  (function () {
    const cells = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        cells.push(`<rect x="${num(9.65 + c * 9.9)}" y="${num(8.15 + r * 9.9)}" width="8.9" height="8.9" rx="1.7" fill="url(#cl)"/>`);
      }
    }
    let spikes = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      spikes += `M${num(Math.cos(a) * 5.2)} ${num(Math.sin(a) * 5.2)}L${num(Math.cos(a) * 9.3)} ${num(Math.sin(a) * 9.3)}`;
    }
    color('minesweeper', `${tile('#e6ecf8', '#9aa7c2')}
<defs>
<linearGradient id="cl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#bfcae0"/></linearGradient>
<linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b5e"/><stop offset="1" stop-color="#e0262a"/></linearGradient>
<radialGradient id="mb" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#5f667a"/><stop offset="1" stop-color="#12141a"/></radialGradient>
</defs>
${cells.join('')}
<g transform="translate(20.8 26)">
<g transform="translate(.7 1.2)" opacity=".28"><path d="${spikes}" stroke="#0b1020" stroke-width="2.4" stroke-linecap="round"/><circle r="6.4" fill="#0b1020"/></g>
<path d="${spikes}" stroke="#171a22" stroke-width="2.4" stroke-linecap="round"/>
<circle r="6.4" fill="url(#mb)"/>
<circle cx="-2.2" cy="-2.5" r="1.8" fill="#fff" fill-opacity=".85"/>
</g>
<path d="M33.6 9.2V26.6" stroke="#2b2f3a" stroke-width="1.9" stroke-linecap="round"/>
<path d="M33.6 9.2L26.6 12.8 33.6 16.4z" fill="url(#fl)"/>
<path d="M32.6 27.6h6.6" stroke="#2b2f3a" stroke-width="2.4" stroke-linecap="round"/>`);
  })();

  // game2048: golden tile with chunky 2048 digits
  color('game2048', `${tile('#ffdc66', '#f29500')}
<defs>
<g id="dg" fill="none" stroke-linecap="round" stroke-linejoin="round">
<path transform="translate(9.4 17.2)" d="M.5 3C.5 1.4 1.5.5 2.7.5 4 .5 5 1.4 5 2.9c0 1.5-.9 2.3-2.1 3.3C1.8 7.2.9 8.2.5 10.5h4.8"/>
<rect transform="translate(17.3 17.2)" x=".4" y=".5" width="4.6" height="10" rx="2.3"/>
<path transform="translate(25.2 17.2)" d="M3.9 10.6V.5L.3 7h5.1"/>
<g transform="translate(33.1 17.2)"><ellipse cx="2.7" cy="2.9" rx="2" ry="2.2"/><ellipse cx="2.7" cy="7.8" rx="2.5" ry="2.7"/></g>
</g>
</defs>
<use href="#dg" stroke="#8a4a00" stroke-opacity=".38" stroke-width="2.4" transform="translate(0 1.2)"/>
<use href="#dg" stroke="#fffdf2" stroke-width="2.4"/>`);

  // settings: silver tile with a metallic gear
  (function () {
    const gear = gearPath(24, 22.5, 14.2, 11.2, 8, 8.5, 15.5) + circlePath(24, 22.5, 4.9);
    color('settings', `${tile('#bfc7d6', '#667084')}
<defs>
<linearGradient id="gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cdd4e2"/></linearGradient>
</defs>
<path d="${gear}" fill="#232a3a" fill-opacity=".38" fill-rule="evenodd" transform="translate(0 1.4)"/>
<path d="${gear}" fill="url(#gg)" fill-rule="evenodd"/>
<circle cx="24" cy="22.5" r="3.4" fill="#4d576c" fill-opacity=".85"/>
<circle cx="24" cy="22.5" r="4.9" fill="none" stroke="#7d879b" stroke-width=".8"/>`);
  })();

  // paint: teal tile, cream palette with colour dabs, blue-tipped brush
  color('paint', `${tile('#5ddccc', '#1b87b6')}
<defs>
<linearGradient id="pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#f1dcae"/></linearGradient>
<linearGradient id="bh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb04d"/><stop offset="1" stop-color="#d9631e"/></linearGradient>
<linearGradient id="bf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4f6fa"/><stop offset="1" stop-color="#aab3c4"/></linearGradient>
</defs>
<path d="M20.4 10.2C12.9 10.2 7.6 15.7 7.6 22.6c0 7.1 5.4 12.7 12.3 12.7 2.2 0 3.4-1.4 3.2-2.9-.2-1.5.8-3 2.8-3H29c3.3 0 5.4-2.4 5.4-5.6 0-7.8-6-13.6-14-13.6z" fill="#0a3a52" fill-opacity=".25" transform="translate(.6 1.4)"/>
<path d="M20.4 10.2C12.9 10.2 7.6 15.7 7.6 22.6c0 7.1 5.4 12.7 12.3 12.7 2.2 0 3.4-1.4 3.2-2.9-.2-1.5.8-3 2.8-3H29c3.3 0 5.4-2.4 5.4-5.6 0-7.8-6-13.6-14-13.6zM14.6 30.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z" fill="url(#pl)" fill-rule="evenodd"/>
<circle cx="13.4" cy="21" r="2.5" fill="#ff5a5f"/><circle cx="18.6" cy="15.6" r="2.5" fill="#ffd23f"/><circle cx="26.2" cy="15.4" r="2.5" fill="#35d07f"/><circle cx="12.8" cy="31.2" r="0" fill="none"/>
<g fill="#fff" fill-opacity=".6"><circle cx="12.7" cy="20.3" r=".8"/><circle cx="17.9" cy="14.9" r=".8"/><circle cx="25.5" cy="14.7" r=".8"/></g>
<g transform="translate(31 20.5) rotate(42)">
<path d="M-1.5 -14.6h3.2a1 1 0 0 1 1 1l.4 11.4h-6l.4-11.4a1 1 0 0 1 1-1z" fill="#000" fill-opacity=".2" transform="translate(.9 .9)"/>
<path d="M-1.5 -14.6h3a1 1 0 0 1 1 1l.4 11.4h-5.8l.4-11.4a1 1 0 0 1 1-1z" fill="url(#bh)"/>
<rect x="-2.9" y="-2.2" width="5.8" height="5" rx=".7" fill="url(#bf)"/>
<path d="M-2.9 .3h5.8" stroke="#8d97a9" stroke-width=".6"/>
<path d="M-2.9 2.8h5.8c.5 5.2-.9 8.9-2.9 12.2-2-3.3-3.4-7-2.9-12.2z" fill="#2b6cf0"/>
<path d="M-1.2 4.2c-.1 3.4.5 6 1.4 8.4" stroke="#fff" stroke-opacity=".45" stroke-width=".9" stroke-linecap="round"/>
</g>`);

  // taskmanager: navy tile, soft grid, glowing performance graph
  color('taskmanager', `${tile('#2f4466', '#0d1628')}
<defs>
<linearGradient id="gl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3fd9ff"/><stop offset="1" stop-color="#46f0a0"/></linearGradient>
<linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fe3d0" stop-opacity=".5"/><stop offset="1" stop-color="#3fe3d0" stop-opacity="0"/></linearGradient>
</defs>
<path d="M8 15h32M8 23h32M8 31h32M16 11v26M24 11v26M32 11v26" stroke="#fff" stroke-opacity=".09" stroke-width=".8"/>
<path d="M8 33.5L13.5 29l5 2.6L24.2 20l5.2 5.2 5.1-11.6 5.5 3.2V38H8z" fill="url(#ga)"/>
<path d="M8 33.5L13.5 29l5 2.6L24.2 20l5.2 5.2 5.1-11.6 5.5 3.2" stroke="url(#gl)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".28" transform="translate(0 .4)"/>
<path d="M8 33.5L13.5 29l5 2.6L24.2 20l5.2 5.2 5.1-11.6 5.5 3.2" stroke="url(#gl)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="40" cy="16.8" r="2.6" fill="#46f0a0" fill-opacity=".3"/><circle cx="40" cy="16.8" r="1.5" fill="#d7fff0"/>`);

  // clock: black tile, white dial, 10:10 hands, orange second hand
  (function () {
    const t = clockTicks(24, 22.5, 14.4);
    color('clock', `${tile('#3a3b42', '#0b0b0e')}
<defs><radialGradient id="cf" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe3ec"/></radialGradient></defs>
<circle cx="24" cy="23.4" r="16.6" fill="#000" fill-opacity=".35"/>
<circle cx="24" cy="22.5" r="16.6" fill="url(#cf)"/>
<circle cx="24" cy="22.5" r="16.6" fill="none" stroke="#9aa3b5" stroke-width=".7"/>
<path d="${t.minor}" stroke="#7b8394" stroke-width="1" stroke-linecap="round"/>
<path d="${t.major}" stroke="#1b1d24" stroke-width="1.9" stroke-linecap="round"/>
<path d="M24 22.5l-6.1-3.6" stroke="#1b1d24" stroke-width="2.6" stroke-linecap="round"/>
<path d="M24 22.5l9.4-5.2" stroke="#1b1d24" stroke-width="2.1" stroke-linecap="round"/>
<path d="M25.4 25.2l-2.6-5.4" stroke="#ff9500" stroke-width="1.1" stroke-linecap="round" transform="rotate(168 24 22.5) translate(0 -1)"/>
<path d="M24 22.5v-12" stroke="#ff9500" stroke-width="1.1" stroke-linecap="round" transform="rotate(168 24 22.5)"/>
<circle cx="24" cy="22.5" r="2" fill="#ff9500"/><circle cx="24" cy="22.5" r=".8" fill="#1b1d24"/>`);
  })();

  // ------------------------------------------------------------------ colorful icons: system objects
  color('trash', `${groundShadow(24, 42.6, 13.5, 2.5, 0.34)}
<defs>
<linearGradient id="bd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a0b0cf"/><stop offset=".45" stop-color="#dde6f6"/><stop offset="1" stop-color="#8c9fc2"/></linearGradient>
<linearGradient id="ld" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fafcff"/><stop offset="1" stop-color="#c0cce3"/></linearGradient>
</defs>
<path d="M20 12.8v-1.4a2.4 2.4 0 0 1 2.4-2.4h3.2a2.4 2.4 0 0 1 2.4 2.4v1.4" stroke="#b9c6df" stroke-width="2.6" stroke-linecap="round"/>
<path d="M11.2 17h25.6l-2.4 21.4a3.2 3.2 0 0 1-3.2 2.8H16.8a3.2 3.2 0 0 1-3.2-2.8z" fill="url(#bd)" stroke="#61759e" stroke-opacity=".9" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M18.3 21.6l.5 14.2M24 21.6v14.2M29.7 21.6l-.5 14.2" stroke="#6d80a6" stroke-opacity=".55" stroke-width="1.9" stroke-linecap="round"/>
<rect x="8.4" y="12" width="31.2" height="5.6" rx="2.8" fill="url(#ld)" stroke="#61759e" stroke-opacity=".9" stroke-width="1.2"/>
<path d="M11.4 13.2h25.2" stroke="#fff" stroke-opacity=".8" stroke-width=".9" stroke-linecap="round"/>`);

  color('trash-full', `${groundShadow(24, 42.6, 13.5, 2.5, 0.34)}
<defs>
<linearGradient id="bd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a0b0cf"/><stop offset=".45" stop-color="#dde6f6"/><stop offset="1" stop-color="#8c9fc2"/></linearGradient>
<linearGradient id="ld" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fafcff"/><stop offset="1" stop-color="#c0cce3"/></linearGradient>
<radialGradient id="cb" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d4e9"/></radialGradient>
</defs>
<ellipse cx="24" cy="15.4" rx="14.6" ry="3" fill="#56648a"/>
<g transform="rotate(-11 17 16)"><rect x="10.8" y="3.6" width="12.4" height="15" rx="1.4" fill="#fff" stroke="#9fb0cf" stroke-width="1"/><path d="M13.6 8.4h6.8M13.6 11.8h6.8" stroke="#b4c2dc" stroke-width="1.3" stroke-linecap="round"/></g>
<g transform="rotate(13 31 16)"><rect x="25" y="2.8" width="11.6" height="16" rx="1.4" fill="#fff4bf" stroke="#d9c56a" stroke-width="1"/><path d="M27.6 7.6h6.4M27.6 11h4.4" stroke="#dccb7c" stroke-width="1.3" stroke-linecap="round"/></g>
<circle cx="23.6" cy="10.8" r="5.1" fill="url(#cb)" stroke="#9fb0cf" stroke-width="1"/><path d="M20.4 9.4l2.6 1.5 2.4-2.8M22.2 14.6l1-3 3.2.9" stroke="#9fb0cf" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M11.2 18h25.6l-2.4 20.4a3.2 3.2 0 0 1-3.2 2.8H16.8a3.2 3.2 0 0 1-3.2-2.8z" fill="url(#bd)" stroke="#61759e" stroke-opacity=".9" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M18.3 23.4l.5 12.6M24 23.4v12.6M29.7 23.4l-.5 12.6" stroke="#6d80a6" stroke-opacity=".55" stroke-width="1.9" stroke-linecap="round"/>
<rect x="8.4" y="14.4" width="31.2" height="5.6" rx="2.8" fill="url(#ld)" stroke="#61759e" stroke-opacity=".9" stroke-width="1.2"/>
<path d="M11.4 15.6h25.2" stroke="#fff" stroke-opacity=".85" stroke-width=".9" stroke-linecap="round"/>`);

  const FOLDER_BACK = 'M4.5 12.4a3 3 0 0 1 3-3h9c1.1 0 2.1.5 2.8 1.3l2.1 2.7H40.5a3 3 0 0 1 3 3V36.5H4.5z';

  color('folder', `${groundShadow(24, 42.4, 17.5, 2.6, 0.32)}
<defs>
<linearGradient id="fb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b13d"/><stop offset="1" stop-color="#d98608"/></linearGradient>
<linearGradient id="ff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe888"/><stop offset=".55" stop-color="#ffc533"/><stop offset="1" stop-color="#f7a40d"/></linearGradient>
</defs>
<path d="${FOLDER_BACK}" fill="url(#fb)"/>
<rect x="7.4" y="14.6" width="33.2" height="6" rx="1.2" fill="#fff" fill-opacity=".92"/>
<path d="M4.5 21.6a3 3 0 0 1 3-3h33a3 3 0 0 1 3 3V37a3 3 0 0 1-3 3h-33a3 3 0 0 1-3-3z" fill="url(#ff)"/>
<path d="M7.8 19.2h32.4" stroke="#fff" stroke-opacity=".7" stroke-width="1" stroke-linecap="round"/>
<path d="M4.5 37a3 3 0 0 0 3 3h33a3 3 0 0 0 3-3v-1.2a3 3 0 0 1-3 3h-33a3 3 0 0 1-3-3z" fill="#b86a00" fill-opacity=".25"/>`);

  color('folder-open', `${groundShadow(24, 42.6, 18, 2.6, 0.32)}
<defs>
<linearGradient id="fb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b13d"/><stop offset="1" stop-color="#d98608"/></linearGradient>
<linearGradient id="ff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe888"/><stop offset=".55" stop-color="#ffc533"/><stop offset="1" stop-color="#f7a40d"/></linearGradient>
</defs>
<path d="M4.5 12.4a3 3 0 0 1 3-3h9c1.1 0 2.1.5 2.8 1.3l2.1 2.7H36.5a3 3 0 0 1 3 3V36.5H4.5z" fill="url(#fb)"/>
<g transform="rotate(-4 20 18)"><rect x="9.5" y="11.6" width="25" height="17" rx="1.4" fill="#fff"/><path d="M13 16.4h12M13 20.2h17" stroke="#b9c6e0" stroke-width="1.5" stroke-linecap="round"/></g>
<path d="M11.9 21.4a2.8 2.8 0 0 1 2.7-2.1h28.4a2 2 0 0 1 1.9 2.6l-4.3 15.8a3 3 0 0 1-2.9 2.3H6.5a2 2 0 0 1-1.9-2.6l4.5-15.9" fill="url(#ff)" transform="translate(-.4 0)"/>
<path d="M12.2 19.8h30.4" stroke="#fff" stroke-opacity=".7" stroke-width="1" stroke-linecap="round"/>`);

  // -- document sheets
  const SHEET = 'M13 4H28.4L38 13.6V41a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z';
  const FOLD = 'M28.4 4v6.6a3 3 0 0 0 3 3H38z';

  function sheet(body) {
    return `<defs>
<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dde3ef"/></linearGradient>
<linearGradient id="sf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f6fb"/><stop offset="1" stop-color="#bcc6da"/></linearGradient>
</defs>
<path d="${SHEET}" fill="#0b1020" fill-opacity=".1" transform="translate(0 2.2)"/>
<path d="${SHEET}" fill="#0b1020" fill-opacity=".14" transform="translate(0 1)"/>
<path d="${SHEET}" fill="url(#sh)" stroke="#7e8ca9" stroke-width="1.6" stroke-linejoin="round"/>
<path d="${FOLD}" fill="url(#sf)" stroke="#7e8ca9" stroke-width="1.6" stroke-linejoin="round"/>
${body}`;
  }

  color('file', sheet('<path d="M15 20h18M15 25h18M15 30h12" stroke="#c9d1e1" stroke-width="2" stroke-linecap="round"/>'));

  color('file-text', sheet(`<path d="M15 19h10" stroke="#3b82f6" stroke-width="2.8" stroke-linecap="round"/>
<path d="M15 25h18M15 29.4h18M15 33.8h18M15 38.2h10" stroke="#b3bed4" stroke-width="1.9" stroke-linecap="round"/>`));

  color('file-code', sheet(`<defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fdc9c"/><stop offset="1" stop-color="#0a9a68"/></linearGradient></defs>
<path d="M15 17.5h9M15 21.5h14" stroke="#b3bed4" stroke-width="1.9" stroke-linecap="round"/>
<rect x="13" y="26" width="22" height="13.5" rx="3.2" fill="url(#gb)"/>
<path d="M21 29.6l-3.1 3.2 3.1 3.2M27 29.6l3.1 3.2-3.1 3.2M25.2 28.8l-2.4 8" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`));

  color('file-image', sheet(`<defs>
<linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fdcff"/><stop offset="1" stop-color="#3aa8f2"/></linearGradient>
<clipPath id="fr"><rect x="13" y="19" width="22" height="19" rx="2.8"/></clipPath>
</defs>
<g clip-path="url(#fr)"><rect x="13" y="19" width="22" height="19" fill="url(#sk)"/>
<circle cx="29.6" cy="24.4" r="2.5" fill="#ffe45c"/>
<path d="M13 38v-5.4l6.6-7.2 5.4 5.6 3.4-3.4L35 31.6V38z" fill="#2fbf6c"/><path d="M13 38v-2.2l8-5.6 5 4 3.2-2.2L35 36v2z" fill="#169652"/></g>
<rect x="13" y="19" width="22" height="19" rx="2.8" stroke="#fff" stroke-opacity=".6" stroke-width=".8"/>`));

  color('file-audio', sheet(`<defs><linearGradient id="au" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d28bff"/><stop offset="1" stop-color="#7a3df0"/></linearGradient></defs>
<path d="M15 16.5h9" stroke="#b3bed4" stroke-width="1.9" stroke-linecap="round"/>
<circle cx="24" cy="30.4" r="9.6" fill="url(#au)"/>
<ellipse cx="21.5" cy="33.6" rx="2.5" ry="2" transform="rotate(-20 21.5 33.6)" fill="#fff"/>
<path d="M23.7 33.2V24l4.9 1.9v2.6l-4.9-1.8" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`));

  color('file-app', sheet(`<defs>
<linearGradient id="wn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6aaeff"/><stop offset="1" stop-color="#2b63e8"/></linearGradient>
<clipPath id="wc"><rect x="13" y="19" width="22" height="19" rx="3.2"/></clipPath>
</defs>
<rect x="13" y="19" width="22" height="19" rx="3.2" fill="url(#wn)"/>
<g clip-path="url(#wc)"><rect x="13" y="19" width="22" height="5.2" fill="#1b3fa8" fill-opacity=".75"/></g>
<circle cx="16.3" cy="21.6" r=".9" fill="#fff" fill-opacity=".85"/><circle cx="19.1" cy="21.6" r=".9" fill="#fff" fill-opacity=".85"/><circle cx="21.9" cy="21.6" r=".9" fill="#fff" fill-opacity=".85"/>
<rect x="16" y="27" width="6" height="4.6" rx="1.2" fill="#fff" fill-opacity=".92"/><rect x="25" y="27" width="6" height="4.6" rx="1.2" fill="#fff" fill-opacity=".6"/><rect x="16" y="33" width="15" height="2.4" rx="1.2" fill="#fff" fill-opacity=".4"/>`));

  color('computer', `${groundShadow(24, 42.8, 16, 2.2, 0.3)}
<defs>
<linearGradient id="bz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6073"/><stop offset="1" stop-color="#1b1e27"/></linearGradient>
<linearGradient id="sc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fe8c1"/><stop offset=".5" stop-color="#2eb887"/><stop offset="1" stop-color="#0c6e56"/></linearGradient>
<linearGradient id="st" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa3b6"/><stop offset=".5" stop-color="#e3e8f2"/><stop offset="1" stop-color="#9aa3b6"/></linearGradient>
<clipPath id="sk"><rect x="7.6" y="9.6" width="32.8" height="19.8" rx="1.6"/></clipPath>
</defs>
<path d="M20.2 32h7.6l1.5 6.2H18.7z" fill="url(#st)"/>
<rect x="13.2" y="37.6" width="21.6" height="3.4" rx="1.7" fill="url(#st)" stroke="#7f889c" stroke-width=".6"/>
<rect x="4.6" y="6.6" width="38.8" height="26.2" rx="3.4" fill="url(#bz)"/>
<rect x="4.6" y="6.6" width="38.8" height="26.2" rx="3.4" stroke="#fff" stroke-opacity=".2" stroke-width=".8"/>
<rect x="7.6" y="9.6" width="32.8" height="19.8" rx="1.6" fill="url(#sc)"/>
<g clip-path="url(#sk)"><path d="M13 9.6v19.8M18.6 9.6v19.8M31 9.6v19.8" stroke="#fff" stroke-opacity=".16" stroke-width="2.2"/><path d="M7.6 9.6h20l-14 19.8H7.6z" fill="#fff" fill-opacity=".14"/><rect x="7.6" y="25.6" width="32.8" height="3.8" fill="#0a2a24" fill-opacity=".5"/><circle cx="12.4" cy="27.5" r="1.1" fill="#fff" fill-opacity=".85"/><rect x="16" y="26.6" width="2.6" height="1.8" rx=".5" fill="#fff" fill-opacity=".5"/><rect x="20" y="26.6" width="2.6" height="1.8" rx=".5" fill="#fff" fill-opacity=".5"/><g><rect x="14" y="12.6" width="17" height="11.4" rx="1.7" fill="#000" fill-opacity=".18" transform="translate(.7 1)"/><rect x="14" y="12.6" width="17" height="11.4" rx="1.7" fill="#fff" fill-opacity=".95"/><path d="M14 14.3a1.7 1.7 0 0 1 1.7-1.7h13.6a1.7 1.7 0 0 1 1.7 1.7v1.5H14z" fill="#2f7bf0"/><path d="M16.6 19h9M16.6 21.4h5.6" stroke="#b6c3dd" stroke-width="1.2" stroke-linecap="round"/></g></g>
<circle cx="24" cy="31" r=".6" fill="#8d95a8"/>`);

  // brand logo: panda face
  color('panda', PANDA_FACE);

  // avatar: panda in a circle, soft green bamboo grove behind
  color('avatar', `<defs>
<clipPath id="ac"><circle cx="24" cy="24" r="21.6"/></clipPath>
<radialGradient id="ab" cx=".35" cy=".22" r=".95"><stop offset="0" stop-color="#d8f7cf"/><stop offset=".55" stop-color="#8bdc92"/><stop offset="1" stop-color="#2f9e6b"/></radialGradient>
<filter id="af" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2"/></filter>
</defs>
<circle cx="24" cy="25.4" r="21.6" fill="#070b18" fill-opacity=".38" filter="url(#af)"/>
<circle cx="24" cy="24" r="21.6" fill="url(#ab)"/>
<g clip-path="url(#ac)">
<g fill="#4fb36a" fill-opacity=".8"><rect x="6" y="0" width="5" height="48" rx="2.5"/><rect x="36.6" y="0" width="4.4" height="48" rx="2.2"/><rect x="42" y="0" width="3.2" height="48" rx="1.6" fill-opacity=".5"/></g>
<g stroke="#2f8a52" stroke-opacity=".7" stroke-width="1.1" stroke-linecap="round"><path d="M6 12h5M6 25h5M6 38h5M36.6 8h4.4M36.6 21h4.4M36.6 34h4.4"/></g>
<path d="M10.6 21c4-2 7.6-1.4 9.4.6-3.6 1.6-7 1.4-9.4-.6zM36.6 15.5c-3.6-2.4-7.6-1.8-9.4.4 3.6 1.8 7 1.6 9.4-.4z" fill="#2f9e6b" fill-opacity=".55"/>
<g transform="translate(24 28) scale(.78) translate(-24 -26)">${PANDA_FACE}</g>
</g>
<circle cx="24" cy="24" r="21" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.2"/>`);

  // status icons
  color('error', `<defs>
<linearGradient id="eb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7d7d"/><stop offset="1" stop-color="#d4202f"/></linearGradient>
<linearGradient id="eh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="ef" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="1.2"/></filter>
</defs>
<circle cx="24" cy="24.6" r="20.4" fill="#5b0710" fill-opacity=".45" filter="url(#ef)"/>
<circle cx="24" cy="23.4" r="20.4" fill="url(#eb)"/>
<path d="M5.6 20.5C7 11.6 14.6 5.6 24 5.6s17 6 18.4 14.9C34.6 17 13.4 17 5.6 20.5z" fill="url(#eh)"/>
<circle cx="24" cy="23.4" r="19.8" stroke="#fff" stroke-opacity=".35" stroke-width=".9"/>
<path d="M16.8 16.2l14.4 14.4M31.2 16.2L16.8 30.6" stroke="#7a0b15" stroke-opacity=".3" stroke-width="4.6" stroke-linecap="round" transform="translate(0 .9)"/>
<path d="M16.8 16.2l14.4 14.4M31.2 16.2L16.8 30.6" stroke="#fff" stroke-width="4.4" stroke-linecap="round"/>`);

  color('warning', `<defs>
<linearGradient id="wb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#ff9d0a"/></linearGradient>
<filter id="wf" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="1.2"/></filter>
</defs>
<path d="M24 7.4L42 38.6H6z" fill="#5a3300" fill-opacity=".45" stroke="#5a3300" stroke-opacity=".45" stroke-width="5" stroke-linejoin="round" filter="url(#wf)" transform="translate(0 1.4)"/>
<path d="M24 7.4L42 38.6H6z" fill="url(#wb)" stroke="url(#wb)" stroke-width="5" stroke-linejoin="round"/>
<path d="M24 5.9L41.4 36" stroke="#fff" stroke-opacity=".0"/>
<path d="M24 8.4L9.4 33.6" stroke="#fff" stroke-opacity=".42" stroke-width="1.2" stroke-linecap="round"/>
<path d="M24 17.2c-1.6 0-2.6 1.1-2.5 2.6l.6 8c.1 1 .8 1.6 1.9 1.6s1.8-.6 1.9-1.6l.6-8c.1-1.5-.9-2.6-2.5-2.6z" fill="#3d2800"/>
<circle cx="24" cy="33.6" r="2.3" fill="#3d2800"/>`);

  color('info', `<defs>
<linearGradient id="ib" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#78c0ff"/><stop offset="1" stop-color="#1767e0"/></linearGradient>
<linearGradient id="ih" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="if" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="1.2"/></filter>
</defs>
<circle cx="24" cy="24.6" r="20.4" fill="#06204f" fill-opacity=".45" filter="url(#if)"/>
<circle cx="24" cy="23.4" r="20.4" fill="url(#ib)"/>
<path d="M5.6 20.5C7 11.6 14.6 5.6 24 5.6s17 6 18.4 14.9C34.6 17 13.4 17 5.6 20.5z" fill="url(#ih)"/>
<circle cx="24" cy="23.4" r="19.8" stroke="#fff" stroke-opacity=".35" stroke-width=".9"/>
<circle cx="24" cy="14.6" r="2.8" fill="#fff"/>
<rect x="21.2" y="19.8" width="5.6" height="14.6" rx="2.8" fill="#fff"/>`);

  // neutral fallback for unknown names
  color('__fallback', `${tile('#b3bbca', '#707a8e')}
<path d="M18.4 18.2c0-3.3 2.5-5.6 5.8-5.6 3.4 0 5.9 2.1 5.9 5.3 0 2.5-1.5 3.7-3.2 4.8-1.4.9-2.4 1.7-2.4 3.5" stroke="#fff" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="24.5" cy="33" r="2" fill="#fff"/>`);

  // ------------------------------------------------------------------ glyphs (24x24, stroke)
  const SPEAKER = '<path d="M11 5L6.5 9H3.5v6h3L11 19z"/>';
  const FOLDER_OUTLINE = '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8a2 2 0 0 1 1.6.8l.9 1.2h6.7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>';
  const SHEET_OUTLINE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v4a1 1 0 0 0 1 1h4"/>';

  const GLYPHS = {
    // window controls + chevrons + arrows
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    minimize: '<path d="M6 12h12"/>',
    maximize: '<rect x="6" y="6" width="12" height="12" rx="1.8"/>',
    restore: '<rect x="5.5" y="9" width="9.5" height="9.5" rx="1.8"/><path d="M9 9V7.3A1.8 1.8 0 0 1 10.8 5.5H16.7A1.8 1.8 0 0 1 18.5 7.3V13.2A1.8 1.8 0 0 1 16.7 15H15"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2L20 20"/>',
    'chevron-left': '<path d="M14.5 6l-6 6 6 6"/>',
    'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
    'chevron-up': '<path d="M6 14.5l6-6 6 6"/>',
    'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
    'arrow-up': '<path d="M12 19.5V5M5.5 11.5L12 5l6.5 6.5"/>',
    'arrow-down': '<path d="M12 4.5V19M5.5 12.5L12 19l6.5-6.5"/>',
    'arrow-left': '<path d="M19.5 12H5M11.5 5.5L5 12l6.5 6.5"/>',
    'arrow-right': '<path d="M4.5 12H19M12.5 5.5L19 12l-6.5 6.5"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.5 2.5"/><path d="M20.5 3.5v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',

    // file operations
    'folder-plus': `${FOLDER_OUTLINE}<path d="M12 11v5M9.5 13.5h5"/>`,
    'file-plus': `${SHEET_OUTLINE}<path d="M12 11.5v5M9.5 14h5"/>`,
    'folder-glyph': FOLDER_OUTLINE,
    'file-glyph': SHEET_OUTLINE,
    delete: '<path d="M4 7h16"/><path d="M6 7l.9 11.7a2 2 0 0 0 2 1.8h6.2a2 2 0 0 0 2-1.8L18 7"/><path d="M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/><path d="M10 11v5.5M14 11v5.5"/>',
    edit: '<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6.5A2 2 0 0 0 13 4.5H6.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2H9"/>',
    cut: '<circle cx="6" cy="6.5" r="2.8"/><circle cx="6" cy="17.5" r="2.8"/><path d="M20 4L8.3 15.5M14.5 14.5L20 20M8.3 8.5L12 12"/>',
    paste: '<rect x="5" y="4.5" width="14" height="17" rx="2.4"/><rect x="9" y="2.5" width="6" height="4" rx="1.3"/><path d="M9 12.5h6M9 16.5h4"/>',
    'info-glyph': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>',

    // system tray
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    'bell-off': '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M2.5 2.5l19 19"/>',
    volume: `${SPEAKER}<path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.3 6.2a8 8 0 0 1 0 11.6"/>`,
    'volume-low': `${SPEAKER}<path d="M15.5 9a4.2 4.2 0 0 1 0 6"/>`,
    'volume-mute': `${SPEAKER}<path d="M16 9.5l5 5M21 9.5l-5 5"/>`,
    wifi: '<path d="M12 20h.01"/><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.9a10 10 0 0 1 14 0"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/>',
    battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.6"/><path d="M22 10.8v2.4"/><rect x="5" y="9.5" width="9.5" height="5" rx="1.2" fill="currentColor" stroke="none"/>',
    power: '<path d="M12 3v8.5"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.4"/><path d="M8 11V7.8a4 4 0 0 1 8 0V11"/><path d="M12 15v2"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2.4"/><path d="M8 11V7.8a4 4 0 0 1 7.6-1.7"/><path d="M12 15v2"/>',
    restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',

    // layout + media
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
    list: '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12"/><path d="M3.8 6.5h.01M3.8 12h.01M3.8 17.5h.01"/>',
    play: '<path d="M8 5.5L18.5 12 8 18.5z" fill="currentColor" stroke-width="2"/>',
    pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.2" fill="currentColor" stroke="none"/>',
    next: '<path d="M6 6l9.5 6L6 18z" fill="currentColor" stroke-width="1.6"/><path d="M19 5.5v13"/>',
    prev: '<path d="M18 6l-9.5 6 9.5 6z" fill="currentColor" stroke-width="1.6"/><path d="M5 5.5v13"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="M18 2l4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="M18 14l4 4-4 4"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    home: '<path d="M3 11l9-7.5L21 11"/><path d="M5.5 9.5v10a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-10"/><path d="M10 21v-6h4v6"/>',
    star: '<path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.4l-5.8 3 1.1-6.45-4.7-4.6 6.5-.95z"/>',
    flag: '<path d="M5.5 21V3.5"/><path d="M5.5 4.5h12.5l-2.8 4 2.8 4H5.5"/>',
    bomb: '<circle cx="10.5" cy="14" r="7"/><path d="M14.8 8.8L17 6.6a1.9 1.9 0 0 1 2.7 0"/><path d="M21.4 3.6l1.1-1.1M20.2 2.4V1.3M22.7 5.2h1.1" stroke-width="1.4"/><path d="M6.9 13.6a3.6 3.6 0 0 1 2.4-2.5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    open: '<path d="M6 14l1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2"/>',

    // tools + hardware
    gear: `<path d="${gearPath(12, 12, 9.4, 7.5, 8, 9.5, 17)}"/><circle cx="12" cy="12" r="3"/>`,
    palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4A1.75 1.75 0 0 1 12 22z"/><circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor" stroke="none"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-4.2-4.2a1.5 1.5 0 0 0-2.1 0L5 19.5"/>',
    note: '<path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v9.5L14 21H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M20.5 14.5h-5a1.5 1.5 0 0 0-1.5 1.5v5"/><path d="M7.5 8.5h9M7.5 12h5"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2.2"/><path d="M8 20h8M12 16v4"/>',
    cpu: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v2.5M15 2v2.5M9 19.5V22M15 19.5V22M2 9h2.5M2 15h2.5M19.5 9H22M19.5 15H22"/>',
    memory: '<rect x="2.5" y="6.5" width="19" height="10" rx="1.8"/><rect x="5.5" y="9.5" width="3" height="4" rx=".6"/><rect x="10.5" y="9.5" width="3" height="4" rx=".6"/><rect x="15.5" y="9.5" width="3" height="4" rx=".6"/><path d="M6 16.5V19M10 16.5V19M14 16.5V19M18 16.5V19"/>',
    time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.2 2.2"/><path d="M5 3L2 6M22 6l-3-3M6.4 18.7L4 21M17.6 18.7L20 21"/>',
    timer: '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5l3-3M10 2.5h4M12 2.5V6M18.7 6.5l1.2-1.2"/>',
    globe: '<circle cx="12" cy="12" r="9.5"/><path d="M12 2.5a14.5 14.5 0 0 0 0 19 14.5 14.5 0 0 0 0-19"/><path d="M2.5 12h19"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15"/>',
    upload: '<path d="M12 15V4M7 8.5l5-5 5 5M4.5 19.5h15"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14"/><path d="M2 2l20 20"/>',
    menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
    more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    sort: '<path d="M4 6.5h9M4 12h6M4 17.5h3"/><path d="M17 5v14M13.5 15.5l3.5 3.5 3.5-3.5"/>',
    filter: '<path d="M3.5 5h17L14 12.8V19l-4 2v-8.2z"/>',
    desktop: '<rect x="3" y="4" width="18" height="13" rx="2.2"/><path d="M3 13h18"/><path d="M8 20.5h8M12 17v3.5"/>',
    document: `${SHEET_OUTLINE}<path d="M9 13h6M9 17h4"/>`,

    // drawing tools
    brush: '<path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
    eraser: '<path d="M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="M5 11l9 9"/>',
    bucket: '<path d="M19 11l-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0z"/><path d="M5 2l5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4z"/>',
    line: '<path d="M5.5 18.5l13-13"/>',
    rect: '<rect x="4" y="6.5" width="16" height="11" rx="1.8"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
    pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="M15 5l4 4"/>',
    'zoom-in': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5M10.5 8v5M8 10.5h5"/>',
    'zoom-out': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5M8 10.5h5"/>',
    'terminal-glyph': '<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.6"/><path d="M9.5 4v16"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
  };
  Object.keys(GLYPHS).forEach((name) => glyph(name, GLYPHS[name]));

  // ------------------------------------------------------------------ id uniquifier
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prepared = new Map(); // name -> { svg, re }
  let counter = 0;

  function prepare(name, svg) {
    let entry = prepared.get(name);
    if (entry) return entry;
    const ids = [];
    svg.replace(/\bid="([^"]+)"/g, (_, id) => { ids.push(id); return _; });
    entry = {
      svg,
      re: ids.length
        ? new RegExp(`(\\bid="|url\\(#|href="#)(${ids.sort((a, b) => b.length - a.length).map(escapeRe).join('|')})("|\\))`, 'g')
        : null
    };
    prepared.set(name, entry);
    return entry;
  }

  // ------------------------------------------------------------------ public API
  const warned = new Set();
  const isRawSvg = (v) => typeof v === 'string' && /^\s*<svg[\s>]/i.test(v);

  function lookup(name) {
    return COLOR.get(name) || GLYPH.get(name) || null;
  }

  function get(name) {
    if (isRawSvg(name)) return name;
    let svg = typeof name === 'string' ? lookup(name) : null;
    let key = name;
    if (!svg) {
      const label = String(name);
      if (!warned.has(label)) {
        warned.add(label);
        console.warn(`[icons] bilinmeyen simge: "${label}"`);
      }
      svg = COLOR.get('__fallback');
      key = '__fallback';
    }
    const entry = prepare(key, svg);
    if (!entry.re) return entry.svg;
    const n = ++counter;
    return entry.svg.replace(entry.re, (_, a, id, z) => `${a}p${n}-${id}${z}`);
  }

  function has(name) {
    return typeof name === 'string' && name !== '__fallback' && lookup(name) !== null;
  }

  function el(name, opts) {
    const { size = 24, className } = opts || {};
    const px = typeof size === 'number' ? `${size}px` : String(size);
    const span = document.createElement('span');
    span.className = className ? `p-icon ${className}` : 'p-icon';
    span.style.cssText = `display:inline-flex;flex:none;align-items:center;justify-content:center;width:${px};height:${px};line-height:0;`;
    span.innerHTML = get(name);
    const svg = span.firstElementChild;
    if (svg && svg.tagName.toLowerCase() === 'svg') {
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.display = 'block';
    }
    return span;
  }

  function names(kind) {
    const colorNames = [...COLOR.keys()].filter((n) => n !== '__fallback');
    const glyphNames = [...GLYPH.keys()];
    if (kind === 'color') return colorNames;
    if (kind === 'glyph') return glyphNames;
    return colorNames.concat(glyphNames);
  }

  // SVG as a data: URL (e.g. drag images, CSS backgrounds). Glyphs get a concrete colour.
  function dataUrl(name, opts) {
    let svg = get(name);
    const colour = (opts && opts.color) || '#ffffff';
    svg = svg.replace(/currentColor/g, colour);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  // ---- file type -> icon
  const EXT_ICON = {
    '.txt': 'file-text', '.md': 'file-text', '.log': 'file-text',
    '.js': 'file-code', '.css': 'file-code', '.html': 'file-code', '.json': 'file-code', '.csv': 'file-code',
    '.png': 'file-image', '.jpg': 'file-image', '.jpeg': 'file-image', '.gif': 'file-image', '.svg': 'file-image', '.webp': 'file-image',
    '.pmus': 'file-audio', '.mp3': 'file-audio', '.wav': 'file-audio'
  };

  function extOf(nameOrPath) {
    const base = String(nameOrPath || '').split('/').pop();
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i).toLowerCase() : '';
  }

  function attempt(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function appIcon(path) {
    const fs = P.fs;
    if (!fs || !path || !attempt(() => fs.isFile(path), false)) return null;
    const target = attempt(() => JSON.parse(fs.readFile(path)), null);
    const def = target && target.appId && P.apps && typeof P.apps.get === 'function' ? attempt(() => P.apps.get(target.appId), null) : null;
    return def && def.icon ? def.icon : null;
  }

  function forFile(arg) {
    let path = null;
    let type = null;
    let ext = null;
    if (arg && typeof arg === 'object') {
      path = arg.path || null;
      type = arg.type || null;
      ext = arg.ext != null ? String(arg.ext).toLowerCase() : null;
      if (ext === null) ext = extOf(arg.name || path);
    } else if (typeof arg === 'string') {
      path = arg;
    }

    if (path === 'trash:') {
      const full = P.fs && typeof P.fs.trashCount === 'function' && attempt(() => P.fs.trashCount(), 0) > 0;
      return full ? 'trash-full' : 'trash';
    }
    if (!type && path) {
      if (P.fs && typeof P.fs.isDir === 'function' && attempt(() => P.fs.isDir(path), false)) type = 'dir';
      else if (path.length > 1 && /\/$/.test(path)) type = 'dir';
    }
    if (type === 'dir' || type === 'directory') return 'folder';

    if (ext === null) ext = extOf(path);
    if (ext && ext[0] !== '.') ext = `.${ext}`;
    if (ext === '.app') return appIcon(path) || 'file-app';
    return EXT_ICON[ext] || 'file';
  }

  P.icons = { get, el, has, forFile, names, dataUrl };
})();
