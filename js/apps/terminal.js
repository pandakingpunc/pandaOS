/* PandaOS Terminal (id: terminal) — "pandash" kabuğu + terminal arayüzü.
   Üç katman:
     1. Saf kabuk çekirdeği  : lex / parse / expand / glob / complete / calc / ANSI → HTML
        (PandaOS.apps.get('terminal')._shell altında testler için açık)
     2. Komut kütüphanesi    : ls, cd, cat, grep, neofetch … (PandaOS.fs üzerinde çalışır)
     3. Arayüz               : satır düzenleyici, geçmiş, Tab tamamlama, kaydırma geçmişi, bağlam menüsü
   Çıktı ANSI SGR kaçış dizileriyle yazılır; arayüz bunları <span> sınıflarına çevirir, boru/yönlendirmede ise
   renkler atılır (gerçek bir kabuk gibi: renk yalnızca bir terminale yazılırken kullanılır). */
(function () {
  'use strict';

  const P = window.PandaOS;
  const U = P.util;

  const MAX_LINES = 2000;          // kaydırma geçmişi sınırı
  const HIST_KEY = 'app.terminal.history';
  const HIST_MAX = 200;
  const STATE_KEY = 'app.terminal';
  const FONT_MIN = 10;
  const FONT_MAX = 28;
  const FONT_DEFAULT = 14;
  const PANDA = '🐼';

  // ---------------------------------------------------------------- küçük yardımcılar
  const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
  const stripAnsi = (s) => String(s).replace(ANSI_RE, '');
  /** Metni SGR kodlarıyla sarar (kodsuzsa olduğu gibi). */
  const paint = (s, codes) => (codes ? `\x1b[${codes}m${s}\x1b[0m` : String(s));
  const chars = (s) => Array.from(String(s));
  const vlen = (s) => chars(stripAnsi(s)).length;
  const padR = (s, n) => s + ' '.repeat(Math.max(0, n - vlen(s)));
  const padL = (s, n) => ' '.repeat(Math.max(0, n - vlen(s))) + s;
  const fmtNum = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 12 });
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  /** "a\nb\n" → ['a','b'] ; '' → [] */
  function splitLines(text) {
    text = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (text === '') return [];
    if (text.endsWith('\n')) text = text.slice(0, -1);
    return text.split('\n');
  }
  const joinLines = (lines) => (lines.length ? lines.join('\n') + '\n' : '');

  const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const pad2 = (n) => String(n).padStart(2, '0');

  /** "08 Eki 19:42" (altı aydan eski dosyalarda "08 Eki  2025"). */
  function fmtLsDate(ts) {
    const d = new Date(ts);
    const day = pad2(d.getDate());
    const old = Date.now() - ts > 182 * 86400000 || ts - Date.now() > 86400000;
    return old
      ? `${day} ${MONTHS[d.getMonth()]}  ${d.getFullYear()}`
      : `${day} ${MONTHS[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /** Süreyi "2 saat, 14 dk" biçiminde yazar. */
  function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const out = [];
    if (d) out.push(`${d} gün`);
    if (h) out.push(`${h} saat`);
    if (m || (!d && !h && !s)) out.push(`${m} dk`);
    if (!d && !h && !m && s) out.push(`${s} sn`);
    return out.join(', ');
  }

  /** fs hata kodunu kısa, Unix tarzı Türkçe iletiye çevirir. */
  function fsMsg(e) {
    switch (e && e.code) {
      case 'ENOENT': return 'Böyle bir dosya ya da dizin yok';
      case 'EEXIST': return 'Dosya mevcut';
      case 'ENOTDIR': return 'Bir dizin değil';
      case 'EISDIR': return 'Bir dizin';
      case 'ENOTEMPTY': return 'Dizin boş değil';
      case 'EPERM': return 'İşlem korumalı, izin verilmedi';
      case 'ENOSPC': return 'Depolama alanı dolu';
      case 'EINVAL': return (e && e.message) || 'Geçersiz argüman';
      default: return (e && e.message) || String(e);
    }
  }

  /** Dosya adını (tırnaksız) kabuğa güvenle yapıştırılabilecek hale getirir. */
  function shQuote(s) {
    s = String(s);
    if (s === '') return "''";
    let out = s.replace(/([ \t'"\\|&;<>()$`*?#!{}[\]])/g, '\\$1');
    if (out[0] === '~') out = '\\' + out;
    return out;
  }

  // ---------------------------------------------------------------- ANSI → HTML
  const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function newAnsiState() {
    return { fg: null, bg: null, b: false, d: false, i: false, u: false, s: false, inv: false };
  }

  function colorClass(prefix, n) { return `${prefix}${n}`; }

  /** 256 renkli palet → #rrggbb (0-15 sınıf olarak ele alınır, bu yalnızca 16+ için). */
  function xterm256(n) {
    if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
    n -= 16;
    const lv = [0, 95, 135, 175, 215, 255];
    return `rgb(${lv[Math.floor(n / 36)]},${lv[Math.floor((n % 36) / 6)]},${lv[n % 6]})`;
  }

  function applySgr(state, params) {
    if (!params.length) params = [0];
    for (let k = 0; k < params.length; k++) {
      const p = params[k];
      if (p === 0) Object.assign(state, newAnsiState());
      else if (p === 1) state.b = true;
      else if (p === 2) state.d = true;
      else if (p === 3) state.i = true;
      else if (p === 4) state.u = true;
      else if (p === 7) state.inv = true;
      else if (p === 9) state.s = true;
      else if (p === 22) { state.b = false; state.d = false; }
      else if (p === 23) state.i = false;
      else if (p === 24) state.u = false;
      else if (p === 27) state.inv = false;
      else if (p === 29) state.s = false;
      else if (p >= 30 && p <= 37) state.fg = p - 30;
      else if (p >= 90 && p <= 97) state.fg = p - 90 + 8;
      else if (p === 39) state.fg = null;
      else if (p >= 40 && p <= 47) state.bg = p - 40;
      else if (p >= 100 && p <= 107) state.bg = p - 100 + 8;
      else if (p === 49) state.bg = null;
      else if (p === 38 || p === 48) {
        const key = p === 38 ? 'fg' : 'bg';
        if (params[k + 1] === 5 && params[k + 2] != null) {
          const n = params[k + 2];
          state[key] = n < 16 ? n : xterm256(n);
          k += 2;
        } else if (params[k + 1] === 2 && params[k + 4] != null) {
          state[key] = `rgb(${params[k + 2] & 255},${params[k + 3] & 255},${params[k + 4] & 255})`;
          k += 4;
        }
      }
    }
  }

  function spanOpen(state) {
    const cls = [];
    let style = '';
    if (state.b) cls.push('b');
    if (state.d) cls.push('d');
    if (state.i) cls.push('i');
    if (state.u) cls.push('u');
    if (state.s) cls.push('s');
    let fg = state.fg;
    let bg = state.bg;
    if (state.inv) {
      const f = fg, g = bg;
      fg = g; bg = f;
      if (fg == null) cls.push('inv-fg');
      if (bg == null) cls.push('inv-bg');
    }
    if (typeof fg === 'number') cls.push(colorClass('f', fg));
    else if (typeof fg === 'string') style += `color:${fg};`;
    if (typeof bg === 'number') cls.push(colorClass('g', bg));
    else if (typeof bg === 'string') style += `background:${bg};`;
    if (!cls.length && !style) return '';
    return `<span${cls.length ? ` class="${cls.join(' ')}"` : ''}${style ? ` style="${style}"` : ''}>`;
  }

  const BLOCK_RE = /[▀▄█]/;
  const cssColor = (c, fallback) => (typeof c === 'number' ? `var(--c${c})` : typeof c === 'string' ? c : fallback);

  /** Metin parçasını HTML'e çevirir; yarım blok karakterleri (piksel sanat) yazı tipinden bağımsız, satır aralığını dolduran degradelere dönüşür. */
  function renderText(text, state) {
    if (!BLOCK_RE.test(text)) return escHtml(text);
    let out = '';
    let plain = '';
    for (const ch of text) {
      if (ch === '▀' || ch === '▄' || ch === '█') {
        if (plain) { out += escHtml(plain); plain = ''; }
        const fg = cssColor(state.inv ? state.bg : state.fg, 'var(--tm-fg)');
        const bg = cssColor(state.inv ? state.fg : state.bg, 'transparent');
        const grad = ch === '█' ? fg : ch === '▀' ? `linear-gradient(${fg} 50%,${bg} 50%)` : `linear-gradient(${bg} 50%,${fg} 50%)`;
        out += `<span class="blk" style="background:${grad}"> </span>`;
      } else plain += ch;
    }
    return out + escHtml(plain);
  }

  /** Tek satırlık ANSI metnini HTML'e çevirir. `state` satırlar arasında taşınır. */
  function ansiLineToHtml(line, state) {
    let html = '';
    let last = 0;
    const emit = (text) => {
      if (!text) return;
      const open = spanOpen(state);
      html += open ? `${open}${renderText(text, state)}</span>` : renderText(text, state);
    };
    const re = /\x1b\[([0-9;?]*)([ -/]*[@-~])/g;
    let m;
    while ((m = re.exec(line))) {
      emit(line.slice(last, m.index));
      last = re.lastIndex;
      if (m[2] === 'm' && !m[1].includes('?')) {
        applySgr(state, m[1] === '' ? [0] : m[1].split(';').map((x) => parseInt(x || '0', 10) || 0));
      }
    }
    emit(line.slice(last));
    return html;
  }

  /** Çok satırlı metni <div class="t-line"> öğelerine çevirir. */
  function ansiToHtml(text, state) {
    state = state || newAnsiState();
    return String(text).replace(/\r/g, '').split('\n').map((l) => `<div class="t-line">${ansiLineToHtml(l, state)}</div>`).join('');
  }

  // ---------------------------------------------------------------- lexer / parser
  class ParseError extends Error {}

  const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const SEP_OPS = ['|', '||', '&&', ';', '&'];
  const REDIR_OPS = ['>', '>>', '<', '2>', '2>>', '&>', '&>>', '2>&1'];

  /**
   * Satırı sözcük ve işleç simgelerine böler.
   *   { type:'word', parts:[{ q:'n'|'s'|'d'|'e', items:[string | {v:name}] }] }
   *   { type:'op', op:'|' | '||' | '&&' | ';' | '&' | '>' | '>>' | '<' | '2>' | '2>>' | '2>&1' | '&>' | '&>>' }
   * q: n = tırnaksız, s = 'tek', d = "çift", e = \kaçışlı. Değişkenler ({v}) çalışma anında açılır.
   */
  function lex(src) {
    src = String(src);
    const tokens = [];
    const n = src.length;
    let i = 0;
    let parts = null;
    let cur = null;

    const startPart = (q) => {
      if (!parts) parts = [];
      if (!cur || cur.q !== q) { cur = { q, items: [] }; parts.push(cur); }
      return cur;
    };
    const lit = (q, text) => {
      const items = startPart(q).items;
      if (typeof items[items.length - 1] === 'string') items[items.length - 1] += text;
      else items.push(text);
    };
    const endWord = () => {
      if (parts) tokens.push({ type: 'word', parts });
      parts = null;
      cur = null;
    };
    const op = (o, len) => { endWord(); tokens.push({ type: 'op', op: o }); i += len; };

    function readVar(at) {
      const c = src[at + 1];
      if (c === undefined) return null;
      if (c === '?' || c === '$') return { name: c, end: at + 2 };
      if (c === '{') {
        const close = src.indexOf('}', at + 2);
        if (close < 0) return null;
        const name = src.slice(at + 2, close);
        return NAME_RE.test(name) || name === '?' ? { name, end: close + 1 } : null;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = at + 1;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        return { name: src.slice(at + 1, j), end: j };
      }
      if (/[0-9]/.test(c)) return { name: c, end: at + 2 };
      return null;
    }

    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') { endWord(); i++; continue; }
      if (!parts && ch === '#') break; // yorum
      if (ch === '\\') {
        if (i + 1 < n) { lit('e', src[i + 1]); i += 2; } else { lit('e', '\\'); i++; }
        continue;
      }
      if (ch === "'") {
        const j = src.indexOf("'", i + 1);
        if (j < 0) throw new ParseError("eşleşmeyen tırnak: '");
        startPart('s');
        if (j > i + 1) cur.items.push(src.slice(i + 1, j));
        cur = null;
        i = j + 1;
        continue;
      }
      if (ch === '"') {
        const part = { q: 'd', items: [] };
        if (!parts) parts = [];
        parts.push(part);
        cur = null;
        i++;
        let closed = false;
        const add = (text) => {
          const items = part.items;
          if (typeof items[items.length - 1] === 'string') items[items.length - 1] += text;
          else items.push(text);
        };
        while (i < n) {
          const c = src[i];
          if (c === '"') { closed = true; i++; break; }
          if (c === '\\' && i + 1 < n && '"\\$`'.includes(src[i + 1])) { add(src[i + 1]); i += 2; continue; }
          if (c === '$') {
            const v = readVar(i);
            if (v) { part.items.push({ v: v.name }); i = v.end; continue; }
          }
          add(c);
          i++;
        }
        if (!closed) throw new ParseError('eşleşmeyen tırnak: "');
        continue;
      }
      if (ch === '$') {
        const v = readVar(i);
        if (v) { startPart('n').items.push({ v: v.name }); i = v.end; continue; }
        lit('n', '$');
        i++;
        continue;
      }
      // yönlendirme ve ayırıcı işleçleri
      if (!parts && (ch === '2' || ch === '1') && src[i + 1] === '>') {
        if (ch === '1') {
          if (src[i + 2] === '>') op('>>', 3); else op('>', 2);
        } else if (src.startsWith('2>&1', i)) op('2>&1', 4);
        else if (src[i + 2] === '>') op('2>>', 3);
        else op('2>', 2);
        continue;
      }
      if (ch === '|') { op(src[i + 1] === '|' ? '||' : '|', src[i + 1] === '|' ? 2 : 1); continue; }
      if (ch === '&') {
        if (src[i + 1] === '&') op('&&', 2);
        else if (src[i + 1] === '>') { if (src[i + 2] === '>') op('&>>', 3); else op('&>', 2); }
        else op('&', 1);
        continue;
      }
      if (ch === ';') { op(';', 1); continue; }
      if (ch === '>') { if (src[i + 1] === '>') op('>>', 2); else op('>', 1); continue; }
      if (ch === '<') { op('<', 1); continue; }
      lit('n', ch);
      i++;
    }
    endWord();
    return tokens;
  }

  /**
   * Simgeleri çalıştırılabilir yapıya çevirir:
   *   [{ sep: ';'|'&&'|'||', pipeline: { cmds: [{ words:[word], redirs:[{op, target}] }] } }]
   */
  function parse(tokens) {
    const items = [];
    let i = 0;
    const near = (t) => (t ? (t.type === 'op' ? t.op : wordText(t)) : null);
    const syntax = (t) => new ParseError(t ? `sözdizimi hatası: '${near(t)}' yakınında beklenmeyen simge` : 'sözdizimi hatası: beklenmeyen satır sonu');

    function parseCommand() {
      const cmd = { words: [], redirs: [] };
      while (i < tokens.length) {
        const t = tokens[i];
        if (t.type === 'word') { cmd.words.push(t); i++; continue; }
        if (SEP_OPS.includes(t.op)) break;
        // yönlendirme
        i++;
        if (t.op === '2>&1') { cmd.redirs.push({ op: t.op, target: null }); continue; }
        const target = tokens[i];
        if (!target || target.type !== 'word') throw syntax(target || null);
        i++;
        cmd.redirs.push({ op: t.op, target });
      }
      return cmd;
    }

    function parsePipeline() {
      const cmds = [];
      for (;;) {
        const cmd = parseCommand();
        if (!cmd.words.length && !cmd.redirs.length) throw syntax(tokens[i] || null);
        cmds.push(cmd);
        if (i < tokens.length && tokens[i].op === '|') {
          i++;
          if (i >= tokens.length) throw syntax(null);
          continue;
        }
        break;
      }
      return { cmds };
    }

    let sep = ';';
    while (i < tokens.length) {
      const pipeline = parsePipeline();
      items.push({ sep, pipeline });
      if (i >= tokens.length) break;
      const o = tokens[i++].op;
      sep = o === '&' ? ';' : o;
      if (i >= tokens.length && (o === '&&' || o === '||')) throw syntax(null);
    }
    return items;
  }

  /** 'from' konumundan (bir "(" sonrası) başlayarak eşleşen ")" indisini bulur; tırnak ve iç içe parantez duyarlı. */
  function matchParen(src, from) {
    let depth = 1;
    let q = null;
    for (let k = from; k < src.length; k++) {
      const c = src[k];
      if (q) { if (c === '\\' && q === '"') k++; else if (c === q) q = null; continue; }
      if (c === '\\') { k++; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return k;
    }
    return -1;
  }

  /**
   * Satırı en üst düzeydeki ; && || & ve satır sonlarından, parça metinlerini koruyarak böler
   * (tırnak, $( ), ters tırnak duyarlı). parse() ile aynı sayıda parça üretmeyi hedefler.
   */
  function splitList(src) {
    const segs = [];
    let cur = '';
    let q = null;
    const n = src.length;
    for (let i = 0; i < n; i++) {
      const c = src[i];
      if (q) {
        cur += c;
        if (c === '\\' && q === '"' && i + 1 < n) cur += src[++i];
        else if (c === q) q = null;
        continue;
      }
      if (c === '\\' && i + 1 < n) { cur += c + src[++i]; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '$' && src[i + 1] === '(') {
        const end = matchParen(src, i + 2);
        if (end < 0) { cur += src.slice(i); break; }
        cur += src.slice(i, end + 1);
        i = end;
        continue;
      }
      if (c === '`') {
        let end = i + 1;
        while (end < n && src[end] !== '`') end += src[end] === '\\' ? 2 : 1;
        cur += src.slice(i, Math.min(end + 1, n));
        i = end;
        continue;
      }
      if (c === ';' || c === '\n') { segs.push(cur); cur = ''; continue; }
      if (c === '&') {
        if (src[i + 1] === '&') { segs.push(cur); cur = ''; i++; continue; }
        if (src[i - 1] === '>' || src[i - 1] === '<' || src[i + 1] === '>') { cur += c; continue; }
        segs.push(cur);
        cur = '';
        continue;
      }
      if (c === '|' && src[i + 1] === '|') { segs.push(cur); cur = ''; i++; continue; }
      cur += c;
    }
    segs.push(cur);
    return segs.filter((s) => s.trim() !== '');
  }

  /** Sözcüğün ham metni (tırnaksız; değişkenler $AD olarak) — hata iletileri ve vurgulama için. */
  function wordText(word) {
    return word.parts.map((p) => p.items.map((it) => (typeof it === 'string' ? it : `$${it.v}`)).join('')).join('');
  }

  // ---------------------------------------------------------------- açılımlar (~, $DEĞİŞKEN, joker karakterler)
  /** Sözcük → alanlar [{ chars:[{c,q}], forced }]. q = tırnaklı (joker/bölme dışı). */
  function wordFields(word, getVar, home) {
    const fields = [];
    let f = null;
    const newField = () => { f = { chars: [], forced: false }; fields.push(f); };
    newField();
    word.parts.forEach((part, pi) => {
      const quoted = part.q !== 'n';
      if (quoted) f.forced = true;
      part.items.forEach((item, ii) => {
        if (typeof item === 'string') {
          let text = item;
          if (pi === 0 && ii === 0 && part.q === 'n' && text[0] === '~' && (text.length === 1 || text[1] === '/')) {
            for (const ch of home) f.chars.push({ c: ch, q: true });
            text = text.slice(1);
          }
          for (const ch of text) f.chars.push({ c: ch, q: quoted });
        } else {
          const val = String(getVar(item.v));
          if (quoted) {
            for (const ch of val) f.chars.push({ c: ch, q: true });
          } else {
            val.split(/\s+/).forEach((piece, k) => {
              if (k > 0) newField();
              for (const ch of piece) f.chars.push({ c: ch, q: false });
            });
          }
        }
      });
    });
    return fields.filter((fl) => fl.chars.length || fl.forced);
  }

  function hasMagic(seg) {
    for (let k = 0; k < seg.length; k++) {
      const { c, q } = seg[k];
      if (q) continue;
      if (c === '*' || c === '?') return true;
      if (c === '[') {
        for (let j = k + 2; j < seg.length; j++) if (seg[j].c === ']' && !seg[j].q) return true;
      }
    }
    return false;
  }

  const reEsc = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

  /** Joker desenini ({c,q}[] dizisi) düzenli ifadeye çevirir (tek yol parçası için). */
  function segRegex(seg, flags) {
    let re = '^';
    for (let k = 0; k < seg.length; k++) {
      const { c, q } = seg[k];
      if (!q && c === '*') re += '[^/]*';
      else if (!q && c === '?') re += '[^/]';
      else if (!q && c === '[') {
        let j = k + 1;
        if (j < seg.length && !seg[j].q && (seg[j].c === '!' || seg[j].c === '^')) j++;
        if (j < seg.length) j++;
        while (j < seg.length && !(seg[j].c === ']' && !seg[j].q)) j++;
        if (j >= seg.length) { re += '\\['; continue; }
        let body = seg.slice(k + 1, j).map((x) => x.c).join('');
        let neg = false;
        if (body[0] === '!' || body[0] === '^') { neg = true; body = body.slice(1); }
        body = body.replace(/[\\\]^]/g, '\\$&');
        re += `[${neg ? '^' : ''}${body}]`;
        k = j;
      } else re += reEsc(c);
    }
    return new RegExp(re + '$', flags || '');
  }

  /** find -name / grep gibi komutlar için: "*.txt" → RegExp */
  function globToRegex(pattern, ci) {
    return segRegex(chars(pattern).map((c) => ({ c, q: false })), ci ? 'i' : '');
  }

  const joinDisp = (b, name) => (b === '' ? name : b.endsWith('/') ? b + name : `${b}/${name}`);

  /** Joker içeren bir alanı dosya sistemine karşı açar; eşleşme yoksa null. */
  function globExpand(fieldChars, xc) {
    const fs = xc.fs;
    const segs = [];
    let curSeg = [];
    for (const ch of fieldChars) {
      if (ch.c === '/') { segs.push(curSeg); curSeg = []; } else curSeg.push(ch);
    }
    segs.push(curSeg);
    const trailing = segs.length > 1 && segs[segs.length - 1].length === 0;
    if (trailing) segs.pop();
    let bases = [''];
    let start = 0;
    if (segs[0].length === 0 && segs.length > 1) { bases = ['/']; start = 1; }
    for (let k = start; k < segs.length; k++) {
      const seg = segs[k];
      const last = k === segs.length - 1;
      if (!seg.length) continue;
      if (!hasMagic(seg)) {
        const name = seg.map((x) => x.c).join('');
        bases = bases.map((b) => joinDisp(b, name));
        continue;
      }
      const re = segRegex(seg);
      const allowDot = seg[0].c === '.';
      const next = [];
      for (const b of bases) {
        let list;
        try { list = fs.list(fs.normalize(b === '' ? '.' : b, xc.cwd), { hidden: true }); } catch (e) { continue; }
        for (const st of list) {
          if (!allowDot && st.name[0] === '.') continue;
          if (!re.test(st.name)) continue;
          if (!last && st.type !== 'dir') continue;
          next.push(joinDisp(b, st.name));
        }
      }
      bases = next;
    }
    let out = bases.filter((b) => b !== '' && fs.exists(fs.normalize(b, xc.cwd)));
    if (trailing) out = out.filter((b) => fs.isDir(fs.normalize(b, xc.cwd))).map((b) => b + '/');
    out.sort(U.compareNames);
    return out.length ? out : null;
  }

  /** Bir sözcüğü komut argümanlarına açar (değişken, ~, joker). */
  function expandWord(word, xc) {
    const out = [];
    for (const f of wordFields(word, xc.getVar, xc.home)) {
      const text = f.chars.map((x) => x.c).join('');
      if (hasMagic(f.chars)) {
        const hits = globExpand(f.chars, xc);
        if (hits) { out.push(...hits); continue; }
      }
      out.push(text);
    }
    return out;
  }

  /** Joker açmadan tek metin (yönlendirme hedefi, atama değeri). */
  function expandText(word, xc) {
    return wordFields(word, xc.getVar, xc.home).map((f) => f.chars.map((x) => x.c).join('')).join(' ');
  }

  // ---------------------------------------------------------------- calc (eval'siz aritmetik)
  class CalcError extends Error {}

  const CALC_FUNCS = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, ln: Math.log, log: Math.log10, log2: Math.log2,
    exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign,
    min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot,
    rad: (d) => (d * Math.PI) / 180, deg: (r) => (r * 180) / Math.PI
  };
  const CALC_CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

  /** "2+3*4", "sqrt(16)^2", "10 % 3" … → sayı. Hata: CalcError (Türkçe ileti). */
  function calcEval(source) {
    const s = String(source).replace(/×/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi');
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const fail = (msg) => { throw new CalcError(msg); };

    function expr() {
      let v = term();
      for (;;) {
        ws();
        if (s[i] === '+') { i++; v += term(); } else if (s[i] === '-') { i++; v -= term(); } else return v;
      }
    }
    function term() {
      let v = unary();
      for (;;) {
        ws();
        const c = s[i];
        if (c === '*' && s[i + 1] !== '*') { i++; v *= unary(); }
        else if (c === '/') { i++; const d = unary(); if (d === 0) fail('sıfıra bölme'); v /= d; }
        else if (c === '%') { i++; const d = unary(); if (d === 0) fail('sıfıra bölme'); v %= d; }
        else return v;
      }
    }
    function unary() {
      ws();
      if (s[i] === '-') { i++; return -unary(); }
      if (s[i] === '+') { i++; return unary(); }
      return power();
    }
    function power() {
      const base = postfix();
      ws();
      if (s[i] === '^' || (s[i] === '*' && s[i + 1] === '*')) {
        i += s[i] === '^' ? 1 : 2;
        return Math.pow(base, unary());
      }
      return base;
    }
    function postfix() {
      let v = primary();
      ws();
      while (s[i] === '!') {
        i++;
        if (!Number.isInteger(v) || v < 0 || v > 170) fail('faktöriyel yalnızca 0-170 arası tam sayılar için');
        let r = 1;
        for (let k = 2; k <= v; k++) r *= k;
        v = r;
        ws();
      }
      return v;
    }
    function primary() {
      ws();
      if (i >= s.length) fail('ifade eksik');
      if (s[i] === '(') {
        i++;
        const v = expr();
        ws();
        if (s[i] !== ')') fail("')' bekleniyordu");
        i++;
        return v;
      }
      const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
      if (num) { i += num[0].length; return parseFloat(num[0]); }
      const id = /^[A-Za-zçğıöşüÇĞİÖŞÜ_][A-Za-z0-9çğıöşüÇĞİÖŞÜ_]*/.exec(s.slice(i));
      if (id) {
        const name = id[0].toLowerCase();
        i += id[0].length;
        ws();
        if (s[i] === '(') {
          i++;
          const args = [];
          ws();
          if (s[i] !== ')') {
            for (;;) {
              args.push(expr());
              ws();
              if (s[i] === ',') { i++; continue; }
              break;
            }
          }
          if (s[i] !== ')') fail("')' bekleniyordu");
          i++;
          const fn = Object.prototype.hasOwnProperty.call(CALC_FUNCS, name) ? CALC_FUNCS[name] : null;
          if (!fn) fail(`bilinmeyen işlev: ${id[0]}`);
          return fn(...args);
        }
        if (Object.prototype.hasOwnProperty.call(CALC_CONSTS, name)) return CALC_CONSTS[name];
        fail(`bilinmeyen sembol: ${id[0]}`);
      }
      fail(`beklenmeyen karakter: '${s[i]}'`);
      return 0;
    }

    const v = expr();
    ws();
    if (i < s.length) fail(`beklenmeyen karakter: '${s[i]}'`);
    if (!Number.isFinite(v)) fail('sonuç tanımsız');
    return v;
  }

  function fmtCalc(v) {
    if (Object.is(v, -0)) v = 0;
    if (v !== 0 && (Math.abs(v) < 1e-9 || Math.abs(v) >= 1e21)) return v.toExponential(6).replace(/\.?0+e/, 'e').replace('.', ',');
    const r = Number.isInteger(v) ? v : parseFloat(v.toPrecision(12));
    return r.toLocaleString('tr-TR', { maximumFractionDigits: 12 });
  }

  // ---------------------------------------------------------------- kabuk (pandash)
  const CMD = Object.create(null);   // komut tablosu (04-commands bölümünde doldurulur)
  const ALIASES = Object.assign(Object.create(null), {
    ll: ['ls', '-l'], la: ['ls', '-a'], dir: ['ls'], cls: ['clear'], cowsay: ['pandasay'],
    '..': ['cd', '..'], '...': ['cd', '../..'], man: ['help'], quit: ['exit'], logout: ['exit'],
    md: ['mkdir', '-p'], type: ['which']
  });

  function levenshtein(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length];
  }

  const isAssignWord = (w) => {
    const p = w.parts[0];
    return !!p && p.q === 'n' && typeof p.items[0] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(p.items[0]);
  };

  class Shell {
    /**
     * @param {object} opts  { cwd, env, host, fs }
     *   host: arayüze ait kancalar — clear(), exit(), cols(), history(), clearHistory(), setTitle(), openFile(), launch()
     */
    constructor(opts) {
      opts = opts || {};
      this.fs = opts.fs || P.fs;
      this.home = this.fs.HOME;
      this.cwd = this.fs.normalize(opts.cwd || this.home);
      if (!this.fs.isDir(this.cwd)) this.cwd = this.home;
      this.oldpwd = this.cwd;
      this.status = 0;
      this.host = opts.host || {};
      let host = 'pandaos';
      try { host = this.fs.readFile('/etc/hostname').trim() || host; } catch (e) { host = (P.user && P.user.hostname) || host; }
      this.hostname = host;
      this.user = (P.user && P.user.name) || 'panda';
      this.env = Object.assign(Object.create(null), {
        USER: this.user, LOGNAME: this.user, HOME: this.home, HOSTNAME: host, SHELL: 'pandash',
        TERM: 'panda-256color', LANG: 'tr_TR.UTF-8', EDITOR: 'notepad'
      }, opts.env || {});
      this.startedAt = Date.now();
    }

    getVar(name) {
      switch (name) {
        case '?': return String(this.status);
        case '$': return '1';
        case '0': return 'pandash';
        case 'PWD': return this.cwd;
        case 'OLDPWD': return this.oldpwd;
        default: return Object.prototype.hasOwnProperty.call(this.env, name) ? this.env[name] : '';
      }
    }

    xc() {
      return { getVar: (n) => this.getVar(n), home: this.home, cwd: this.cwd, fs: this.fs };
    }

    /** Komut istemindeki yol: ~, ~/Belgeler ya da mutlak yol. */
    promptPath() {
      if (this.cwd === this.home) return '~';
      if (this.cwd.startsWith(this.home + '/')) return '~' + this.cwd.slice(this.home.length);
      return this.cwd;
    }

    commandNames() {
      return [...new Set([...Object.keys(CMD), ...Object.keys(ALIASES)])].sort(U.compareNames);
    }

    hasCommand(name) {
      if (!name) return false;
      if (CMD[name] || ALIASES[name]) return true;
      if (name.includes('/')) {
        const abs = this.fs.normalize(name, this.cwd);
        return this.fs.isFile(abs) && this.fs.extname(abs) === '.app';
      }
      return false;
    }

    suggest(name) {
      if (name.length < 2) return null;
      let best = null;
      let bestD = 3;
      for (const c of this.commandNames()) {
        const d = levenshtein(name.toLowerCase(), c);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    }

    /** Silinen/taşınan bir çalışma klasöründen en yakın var olan üst klasöre çekil. */
    fixCwd() {
      if (this.fs.isDir(this.cwd)) return;
      let p = this.cwd;
      while (p !== '/' && !this.fs.isDir(p)) p = this.fs.dirname(p);
      this.cwd = p;
      if (this.host.cwdChanged) this.host.cwdChanged(this.cwd);
    }

    setCwd(abs) {
      if (abs === this.cwd) return;
      this.oldpwd = this.cwd;
      this.cwd = abs;
      if (this.host.cwdChanged) this.host.cwdChanged(abs);
    }

    /**
     * Bir satırı çalıştırır. io = { out(str), err(str), tty, cols(), signal, live(str|null) }
     * Dönüş: çıkış durumu (0 = başarılı).
     */
    async exec(line, io) {
      io = io || {};
      const fail = (e) => {
        if (!(e instanceof ParseError)) throw e;
        if (io.err) io.err(`pandash: ${e.message}\n`);
        this.status = 2;
        return 2;
      };
      let ast;
      let segs = null; // $(…) içeren satırlar: her parça kendi sırası gelince açılır ("cd x && echo $(pwd)" doğru çalışsın)
      try {
        const hasSubst = line.includes('$(') || line.includes('`');
        // söz dizimi, komutlar çalışmadan önce denetlenir (komut yerine koymalar yer tutucuyla)
        ast = parse(lex(hasSubst ? await this.scanSubst(line, () => 'x') : line));
        if (hasSubst) {
          const parts = splitList(line);
          if (parts.length === ast.length) segs = parts;
          else ast = parse(lex(await this.substitute(line, io)));
        }
      } catch (e) {
        return fail(e);
      }
      let status = this.status;
      for (let idx = 0; idx < ast.length; idx++) {
        const item = ast[idx];
        if (io.signal && io.signal.aborted) { status = 130; break; }
        if (item.sep === '&&' && status !== 0) continue;
        if (item.sep === '||' && status === 0) continue;
        let pipeline = item.pipeline;
        if (segs) {
          try {
            pipeline = parse(lex(await this.substitute(segs[idx], io)))[0].pipeline;
          } catch (e) {
            status = fail(e);
            break;
          }
        }
        status = await this.runPipeline(pipeline, io);
        this.status = status;
        this.fixCwd();
      }
      this.status = status;
      return status;
    }

    /**
     * $(komut), `komut` ve $((aritmetik)) kalıplarını tarar; her biri için replacer(kind, inner, q) çağrılır ve
     * dönen metin satıra yerleştirilir. kind: 'cmd' | 'arith'; q: bulunduğu tırnak ('"' ya da null).
     * Tek tırnak içinde açılım yapılmaz. Eşleşmeyen parantez/ters tırnak → ParseError.
     */
    async scanSubst(src, replacer) {
      if (!src.includes('$(') && !src.includes('`')) return src;
      const n = src.length;
      let out = '';
      let q = null;
      let i = 0;
      while (i < n) {
        const c = src[i];
        if (q === "'") { out += c; if (c === "'") q = null; i++; continue; }
        if (c === '\\' && i + 1 < n) { out += c + src[i + 1]; i += 2; continue; }
        if (c === "'" && q === null) { q = "'"; out += c; i++; continue; }
        if (c === '"') { q = q === '"' ? null : '"'; out += c; i++; continue; }
        if (c === '$' && src[i + 1] === '(') {
          const end = matchParen(src, i + 2);
          if (end < 0) throw new ParseError('eşleşmeyen parantez: $(');
          const inner = src.slice(i + 2, end);
          const arith = inner.startsWith('(') && inner.endsWith(')');
          out += await replacer(arith ? 'arith' : 'cmd', arith ? inner.slice(1, -1) : inner, q);
          i = end + 1;
          continue;
        }
        if (c === '`') {
          let end = i + 1;
          while (end < n && src[end] !== '`') end += src[end] === '\\' ? 2 : 1;
          if (end >= n) throw new ParseError('eşleşmeyen ters tırnak: `');
          out += await replacer('cmd', src.slice(i + 1, end), q);
          i = end + 1;
          continue;
        }
        out += c;
        i++;
      }
      return out;
    }

    /** Komut yerine koymaları gerçekten çalıştırıp çıktılarını (kaçışlayarak) satıra yerleştirir. */
    async substitute(src, io) {
      const run = async (cmd) => {
        const saved = { cwd: this.cwd, old: this.oldpwd, env: Object.assign(Object.create(null), this.env), status: this.status };
        let res;
        try {
          res = await this.capture(cmd, { tty: false, cols: io && io.cols ? io.cols() : 80, signal: io && io.signal });
        } finally {
          // alt kabuk gibi: cd / değişken atamaları dışarı sızmaz
          this.cwd = saved.cwd; this.oldpwd = saved.old; this.env = saved.env; this.status = saved.status;
        }
        if (res.err && io && io.err) io.err(res.err);
        return res.out.replace(/\n+$/, '');
      };
      return this.scanSubst(src, async (kind, inner, q) => {
        if (kind === 'arith') {
          // $AD ve çıplak AD değişken adları değerleriyle değiştirilir (bash gibi); işlev adları ve pi/e sabitleri korunur
          const expr = inner
            .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name) => this.getVar(name) || '0')
            .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()/g, (m, name) => {
              if (Object.prototype.hasOwnProperty.call(CALC_CONSTS, name.toLowerCase())) return m;
              const v = this.getVar(name);
              return v !== '' && /^-?\d+(\.\d+)?$/.test(v) ? v : m;
            });
          try {
            return String(parseFloat(calcEval(expr).toPrecision(12)));
          } catch (e) {
            if (e instanceof CalcError) throw new ParseError(`aritmetik hata: ${e.message}`);
            throw e;
          }
        }
        const text = await run(inner);
        return q === '"' ? text.replace(/(["\\$`])/g, '\\$1') : text.split(/\s+/).filter(Boolean).map(shQuote).join(' ');
      });
    }

    /** Test/betik yardımcısı: çıktıyı toplar. */
    async capture(line, opts) {
      opts = opts || {};
      let out = '';
      let err = '';
      const status = await this.exec(line, {
        tty: !!opts.tty,
        cols: () => opts.cols || 80,
        signal: opts.signal,
        live: opts.live,
        out: (s) => { out += s; },
        err: (s) => { err += s; }
      });
      return { out, err, status };
    }

    async runPipeline(pl, io) {
      let stdin = null;
      let status = 0;
      const n = pl.cmds.length;
      for (let k = 0; k < n; k++) {
        if (io.signal && io.signal.aborted) return 130;
        const last = k === n - 1;
        const res = await this.runCommand(pl.cmds[k], { io, stdin, last });
        status = res.status;
        stdin = last ? null : res.piped;
      }
      return status;
    }

    async runCommand(cmd, { io, stdin, last }) {
      const fs = this.fs;
      const xc = this.xc();
      const errOut = (msg) => { if (io.err) io.err(msg + '\n'); };

      // başa gelen NAME=değer atamaları
      let wi = 0;
      const assigns = [];
      while (wi < cmd.words.length && isAssignWord(cmd.words[wi])) {
        const w = cmd.words[wi];
        const first = w.parts[0].items[0];
        const eq = first.indexOf('=');
        const name = first.slice(0, eq);
        const copy = { parts: w.parts.map((p) => ({ q: p.q, items: p.items.slice() })) };
        copy.parts[0].items[0] = first.slice(eq + 1);
        assigns.push([name, expandText(copy, xc)]);
        wi++;
      }
      const words = [];
      for (let k = wi; k < cmd.words.length; k++) words.push(...expandWord(cmd.words[k], xc));

      if (!words.length && !cmd.redirs.length) {
        for (const [k, v] of assigns) this.env[k] = v;
        return { status: 0, piped: '' };
      }

      // yönlendirmeler
      let stdoutFile = null;
      let errFile = null;
      let devnullOut = false;
      let devnullErr = false;
      let errToOut = false;
      let input = stdin;
      const openOut = (rawPath, append) => {
        if (rawPath === '/dev/null') return 'null';
        const abs = fs.normalize(rawPath, this.cwd);
        if (fs.isDir(abs)) throw new Error(`${rawPath}: Bir dizin`);
        try {
          if (!append || !fs.exists(abs)) fs.writeFile(abs, '');
        } catch (e) { throw new Error(`${rawPath}: ${fsMsg(e)}`); }
        return { abs, buf: [] };
      };
      try {
        for (const r of cmd.redirs) {
          if (r.op === '2>&1') { errToOut = true; continue; }
          const path = expandText(r.target, xc);
          if (r.op === '<') {
            if (path === '/dev/null') { input = ''; continue; }
            const abs = fs.normalize(path, this.cwd);
            try { input = fs.readFile(abs); } catch (e) { throw new Error(`${path}: ${fsMsg(e)}`); }
          } else if (r.op === '>' || r.op === '>>' || r.op === '&>' || r.op === '&>>') {
            const t = openOut(path, r.op.endsWith('>>'));
            if (t === 'null') devnullOut = true; else stdoutFile = t;
            if (r.op[0] === '&') errToOut = true;
          } else if (r.op === '2>' || r.op === '2>>') {
            const t = openOut(path, r.op === '2>>');
            if (t === 'null') devnullErr = true; else errFile = t;
          }
        }
      } catch (e) {
        errOut(`pandash: ${e.message}`);
        return { status: 1, piped: '' };
      }

      const pipeBuf = [];
      const toPipe = !last;
      const writeOut = stdoutFile ? (s) => stdoutFile.buf.push(s)
        : devnullOut ? () => {}
          : toPipe ? (s) => pipeBuf.push(s)
            : (s) => { if (io.out) io.out(s); };
      const writeErr = errToOut ? writeOut
        : errFile ? (s) => errFile.buf.push(s)
          : devnullErr ? () => {}
            : (s) => { if (io.err) io.err(s); };
      const tty = !!io.tty && !toPipe && !stdoutFile && !devnullOut;

      let status = 0;
      if (words.length) {
        let name = words[0];
        let args = words.slice(1);
        if (ALIASES[name]) { args = ALIASES[name].slice(1).concat(args); name = ALIASES[name][0]; }
        const saved = Object.create(null);
        for (const [k, v] of assigns) { saved[k] = this.env[k]; this.env[k] = v; }
        const ctx = {
          shell: this, fs, name, args, stdin: input, tty,
          cols: io.cols ? io.cols() : 80,
          signal: io.signal,
          live: tty && io.live ? io.live : null,
          host: this.host,
          write: writeOut,
          writeln: (s) => writeOut((s == null ? '' : s) + '\n'),
          error: (msg) => writeErr(msg + '\n'),
          paint: (s, codes) => (tty ? paint(s, codes) : String(s)),
          resolve: (p) => fs.normalize(p, this.cwd),
          aborted: () => !!(io.signal && io.signal.aborted)
        };
        try {
          const def = CMD[name];
          if (def) {
            if (args.length === 1 && args[0] === '--help' && !def.rawArgs) status = await CMD.help.run(Object.assign(ctx, { args: [name] }));
            else status = await def.run(ctx);
          } else if (name.includes('/')) {
            status = this.runPath(ctx, name);
          } else {
            ctx.error(`pandash: komut bulunamadı: ${name}`);
            const s = this.suggest(name);
            if (s) ctx.error(ctx.paint(`Belki şunu demek istediniz: ${s}`, '2'));
            status = 127;
          }
          if (typeof status !== 'number') status = 0;
        } catch (e) {
          if (e && e.name === 'AbortError') status = 130;
          else {
            console.error(`[terminal] ${name} komutu çöktü`, e);
            ctx.error(`pandash: ${name}: iç hata: ${(e && e.message) || e}`);
            status = 1;
          }
        } finally {
          for (const [k] of assigns) {
            if (saved[k] === undefined) delete this.env[k]; else this.env[k] = saved[k];
          }
        }
      }

      // dosya yönlendirmelerini yaz
      for (const t of [stdoutFile, errFile]) {
        if (!t || !t.buf.length) continue;
        try { fs.appendFile(t.abs, stripAnsi(t.buf.join(''))); } catch (e) { errOut(`pandash: ${fs.basename(t.abs)}: ${fsMsg(e)}`); status = status || 1; }
      }
      return { status, piped: pipeBuf.join('') };
    }

    /** `./Dosyalar.app` gibi yol ile çalıştırma. */
    runPath(ctx, name) {
      const abs = ctx.resolve(name);
      const st = this.fs.stat(abs);
      if (!st) { ctx.error(`pandash: ${name}: Böyle bir dosya ya da dizin yok`); return 127; }
      if (st.type === 'dir') { ctx.error(`pandash: ${name}: Bir dizin`); return 126; }
      if (st.ext === '.app') {
        const w = this.host.openFile ? this.host.openFile(abs) : P.apps.openFile(abs);
        return w ? 0 : 1;
      }
      ctx.error(`pandash: ${name}: İzin verilmedi (çalıştırılabilir değil)`);
      return 126;
    }
  }

  // ---------------------------------------------------------------- komutlar: ortak yardımcılar
  const GROUPS = [
    ['files', 'Dosya ve klasörler'],
    ['text', 'Metin işleme'],
    ['system', 'Sistem ve uygulamalar'],
    ['shell', 'Kabuk'],
    ['fun', 'Eğlence']
  ];

  function def(name, group, summary, usage, run, extra) {
    CMD[name] = Object.assign({ name, group, summary, usage, run, options: [], examples: [], notes: '' }, extra || {});
  }

  /** Küçük bir getopt: kısa küme (-la), değer alan (-n 5, -n5), uzun (--all), sayısal (-5), '--'. */
  function parseArgs(args, spec) {
    const flags = {};
    const rest = [];
    const bool = spec.bool || '';
    const valued = spec.value || '';
    const long = spec.long || {};
    let error = null;
    let done = false;
    for (let i = 0; i < args.length && !error; i++) {
      const a = args[i];
      if (done || a === '-' || a[0] !== '-') { rest.push(a); continue; }
      if (a === '--') { done = true; continue; }
      if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        const key = a.slice(2, eq < 0 ? undefined : eq);
        const letter = long[key];
        if (!letter) { error = `tanınmayan seçenek -- '${key}'`; break; }
        if (valued.includes(letter)) {
          const val = eq >= 0 ? a.slice(eq + 1) : args[++i];
          if (val === undefined) { error = `'--${key}' seçeneği bir değer gerektiriyor`; break; }
          flags[letter] = val;
        } else flags[letter] = true;
        continue;
      }
      for (let k = 1; k < a.length; k++) {
        const c = a[k];
        if (spec.numeric && /\d/.test(c)) { flags[spec.numeric] = a.slice(k); break; }
        if (valued.includes(c)) {
          const val = k + 1 < a.length ? a.slice(k + 1) : args[++i];
          if (val === undefined) { error = `'-${c}' seçeneği bir değer gerektiriyor`; break; }
          flags[c] = val;
          break;
        }
        if (bool.includes(c)) { flags[c] = true; continue; }
        error = `tanınmayan seçenek -- '${c}'`;
        break;
      }
    }
    return { flags, rest, error };
  }

  const usageErr = (ctx, msg) => {
    ctx.error(`${ctx.name}: ${msg}`);
    ctx.error(`Daha fazla bilgi için '${ctx.name} --help' yazın.`);
    return 2;
  };

  /** Dosyayı okur; hata olursa iletiyi yazıp null döner. */
  function readText(ctx, arg) {
    try {
      return ctx.fs.readFile(ctx.resolve(arg));
    } catch (e) {
      ctx.error(`${ctx.name}: ${arg}: ${fsMsg(e)}`);
      return null;
    }
  }

  /** Sütunlara dizer (ls / Tab listesi). cells = [{ plain, colored }] */
  function layoutColumns(cells, width, gap) {
    gap = gap == null ? 2 : gap;
    const n = cells.length;
    if (!n) return [];
    const lens = cells.map((c) => chars(c.plain).length);
    const minLen = Math.max(1, Math.min(...lens));
    let cols = Math.max(1, Math.min(n, Math.floor((width + gap) / (minLen + gap))));
    let rows = Math.ceil(n / cols);
    let colW = [];
    for (; cols >= 1; cols--) {
      rows = Math.ceil(n / cols);
      colW = [];
      let total = 0;
      for (let j = 0; j < cols; j++) {
        let m = 0;
        for (let r = 0; r < rows; r++) { const idx = j * rows + r; if (idx < n) m = Math.max(m, lens[idx]); }
        colW.push(m);
        total += m + (j ? gap : 0);
      }
      if (total <= width || cols === 1) break;
    }
    const lines = [];
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let j = 0; j < cols; j++) {
        const idx = j * rows + r;
        if (idx >= n) break;
        const hasNext = (j + 1) * rows + r < n;
        line += cells[idx].colored + (hasNext ? ' '.repeat(colW[j] - lens[idx] + gap) : '');
      }
      lines.push(line);
    }
    return lines;
  }

  const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'];
  const AUDIO_EXT = ['.pmus', '.mp3', '.wav', '.ogg'];

  /** ls / tree / tamamlama listesi için ad rengi (SGR). */
  function nameCodes(st) {
    const hidden = st.name[0] === '.' && st.name !== '.' && st.name !== '..';
    let codes = '';
    if (st.type === 'dir') codes = '1;34';
    else if (st.ext === '.app') codes = '1;32';
    else if (IMG_EXT.includes(st.ext)) codes = '35';
    else if (AUDIO_EXT.includes(st.ext)) codes = '36';
    if (hidden) codes = codes ? `2;${codes}` : '2';
    return codes;
  }

  const isExecutable = (st) => st.type === 'dir' || st.ext === '.app' || st.path.startsWith('/bin/');

  function entryCell(st, ctx) {
    const name = st.label || st.name;
    const plain = ctx.tty && st.type === 'dir' && name !== '.' && name !== '..' ? name + '/' : name;
    return { plain, colored: ctx.tty ? paint(plain, nameCodes(st)) : plain };
  }

  function longFormat(ctx, list, f) {
    const rows = list.map((st) => {
      const isDir = st.type === 'dir';
      const perms = (isDir ? 'd' : '-') + (isExecutable(st) ? 'rwxr-xr-x' : 'rw-r--r--');
      const owner = st.path.startsWith(ctx.shell.home) || st.path.startsWith('/tmp') ? ctx.shell.user : 'root';
      const bytes = isDir ? 4096 : st.size;
      return {
        perms, owner,
        size: f.h ? U.formatBytes(bytes) : String(bytes),
        date: fmtLsDate(st.modified),
        cell: entryCell(st, ctx)
      };
    });
    const ow = Math.max(...rows.map((r) => r.owner.length));
    const sw = Math.max(...rows.map((r) => r.size.length));
    return rows.map((r) => `${r.perms}  ${padR(r.owner, ow)}  ${padL(r.size, sw)}  ${r.date}  ${r.cell.colored}`);
  }

  // ---------------------------------------------------------------- komutlar: dosya ve klasörler
  def('ls', 'files', 'Klasör içeriğini listeler', 'ls [SEÇENEK]... [YOL]...', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, {
      bool: 'aAl1hrStd',
      long: { all: 'a', 'almost-all': 'A', 'human-readable': 'h', reverse: 'r', directory: 'd' }
    });
    if (error) return usageErr(ctx, error);
    const showHidden = !!(f.a || f.A);
    const targets = rest.length ? rest : ['.'];
    let status = 0;
    const fileEntries = [];
    const dirs = [];
    for (const arg of targets) {
      const abs = ctx.resolve(arg);
      const st = ctx.fs.stat(abs);
      if (!st) { ctx.error(`ls: '${arg}' erişilemiyor: Böyle bir dosya ya da dizin yok`); status = 2; continue; }
      if (st.type === 'dir' && !f.d) dirs.push({ arg, abs });
      else fileEntries.push(Object.assign({}, st, { label: arg }));
    }
    const order = (list) => {
      if (f.S) { const sz = (st) => (st.type === 'dir' ? 4096 : st.size); list.sort((a, b) => sz(b) - sz(a) || U.compareNames(a.name, b.name)); }
      else if (f.t) list.sort((a, b) => b.modified - a.modified || U.compareNames(a.name, b.name));
      if (f.r) list.reverse();
      return list;
    };
    const format = (list) => {
      if (!list.length) return [];
      if (f.l) return longFormat(ctx, list, f);
      const cells = list.map((st) => entryCell(st, ctx));
      if (!ctx.tty || f['1']) return cells.map((c) => c.colored);
      return layoutColumns(cells, ctx.cols || 80);
    };
    const blocks = [];
    if (fileEntries.length) blocks.push(format(order(fileEntries)));
    for (const d of dirs) {
      let list;
      try { list = ctx.fs.list(d.abs, { hidden: showHidden }); } catch (e) {
        ctx.error(`ls: '${d.arg}' dizini okunamıyor: ${fsMsg(e)}`);
        status = 2;
        continue;
      }
      list = order(list);
      if (f.a) {
        const self = Object.assign({}, ctx.fs.stat(d.abs), { label: '.' });
        const up = ctx.fs.stat(ctx.fs.dirname(d.abs));
        list = [self, Object.assign({}, up, { label: '..' }), ...list];
      }
      const lines = format(list);
      if (targets.length > 1) lines.unshift(`${d.arg}:`);
      blocks.push(lines);
    }
    const text = blocks.filter((b) => b.length).map((b) => b.join('\n')).join('\n\n');
    if (text) ctx.write(text + '\n');
    return status;
  }, {
    options: [['-a', 'gizli dosyaları da göster (. ve .. dahil)'], ['-A', 'gizli dosyaları göster (. ve .. hariç)'],
      ['-l', 'uzun biçim: izinler, sahip, boyut, tarih, ad'], ['-h', 'boyutları okunur yaz (-l ile)'],
      ['-1', 'her satıra bir öğe'], ['-d', 'klasörün kendisini listele, içeriğini değil'],
      ['-r', 'sırayı tersine çevir'], ['-S', 'boyuta göre sırala (büyükten küçüğe)'], ['-t', 'değiştirilme zamanına göre sırala']],
    examples: [['ls -la ~/Belgeler', 'gizlilerle birlikte ayrıntılı liste'], ['ls Belgeler Resimler', 'birden çok klasör']],
    notes: 'Klasörler mavi ve "/" ile, .app kısayolları yeşil, gizli dosyalar soluk görünür.'
  });

  def('cd', 'files', 'Çalışma klasörünü değiştirir', 'cd [klasör]', (ctx) => {
    if (ctx.args.length > 1) { ctx.error('cd: çok fazla argüman'); return 1; }
    const sh = ctx.shell;
    let target = ctx.args[0];
    let echo = false;
    if (target === undefined || target === '~') target = sh.home;
    else if (target === '-') { target = sh.oldpwd; echo = true; }
    const abs = ctx.resolve(target);
    const st = ctx.fs.stat(abs);
    if (!st) { ctx.error(`cd: ${ctx.args[0]}: Böyle bir dosya ya da dizin yok`); return 1; }
    if (st.type !== 'dir') { ctx.error(`cd: ${ctx.args[0]}: Bir dizin değil`); return 1; }
    sh.setCwd(abs);
    if (echo) ctx.writeln(abs);
    return 0;
  }, {
    options: [['(argümansız)', 'ev klasörüne (~) git'], ['-', 'önceki klasöre dön'], ['..', 'bir üst klasöre çık']],
    examples: [['cd ~/Belgeler'], ['cd "Yeni Klasör"', 'boşluklu adlar için tırnak ya da ters bölü kullanın'], ['cd -']]
  });

  def('pwd', 'files', 'Çalışma klasörünün yolunu yazdırır', 'pwd', (ctx) => { ctx.writeln(ctx.shell.cwd); return 0; });

  def('mkdir', 'files', 'Yeni klasör oluşturur', 'mkdir [-p] [-v] klasör...', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'pv', long: { parents: 'p', verbose: 'v' } });
    if (error) return usageErr(ctx, error);
    if (!rest.length) return usageErr(ctx, 'eksik işlenen');
    let status = 0;
    for (const arg of rest) {
      try {
        const abs = ctx.resolve(arg);
        ctx.fs.mkdir(abs, { recursive: !!f.p });
        if (f.v) ctx.writeln(`mkdir: '${arg}' klasörü oluşturuldu`);
      } catch (e) {
        ctx.error(`mkdir: '${arg}' dizini oluşturulamıyor: ${fsMsg(e)}`);
        status = 1;
      }
    }
    return status;
  }, {
    options: [['-p', 'üst klasörleri de oluştur, var olan için hata verme'], ['-v', 'ne yapıldığını yazdır']],
    examples: [['mkdir Projeler'], ['mkdir -p a/b/c', 'iç içe klasörler']]
  });

  def('rmdir', 'files', 'Boş klasörleri siler', 'rmdir klasör...', (ctx) => {
    const { rest, error } = parseArgs(ctx.args, { bool: '' });
    if (error) return usageErr(ctx, error);
    if (!rest.length) return usageErr(ctx, 'eksik işlenen');
    let status = 0;
    for (const arg of rest) {
      const abs = ctx.resolve(arg);
      try {
        if (!ctx.fs.exists(abs)) throw Object.assign(new Error(), { code: 'ENOENT' });
        if (!ctx.fs.isDir(abs)) throw Object.assign(new Error(), { code: 'ENOTDIR' });
        if (ctx.fs.isProtected(abs)) throw Object.assign(new Error(), { code: 'EPERM' });
        ctx.fs.remove(abs);
      } catch (e) {
        ctx.error(`rmdir: '${arg}' silinemedi: ${fsMsg(e)}`);
        status = 1;
      }
    }
    return status;
  }, { notes: 'Yalnızca boş klasörleri siler. Dolu klasörler için: rm -r (çöp kutusuna taşır).' });

  def('touch', 'files', 'Boş dosya oluşturur ya da zamanını günceller', 'touch dosya...', (ctx) => {
    const { rest, error } = parseArgs(ctx.args, { bool: 'c', long: { 'no-create': 'c' } });
    if (error) return usageErr(ctx, error);
    if (!rest.length) return usageErr(ctx, 'eksik dosya işleneni');
    let status = 0;
    for (const arg of rest) {
      const abs = ctx.resolve(arg);
      try {
        if (ctx.fs.isDir(abs)) continue;
        if (ctx.fs.exists(abs)) ctx.fs.appendFile(abs, '');
        else ctx.fs.writeFile(abs, '');
      } catch (e) {
        ctx.error(`touch: '${arg}' dosyasına dokunulamıyor: ${fsMsg(e)}`);
        status = 1;
      }
    }
    return status;
  }, { examples: [['touch notlar.txt a.txt b.txt']] });

  def('rm', 'files', 'Dosya ve klasörleri çöp kutusuna taşır', 'rm [-r] [-f] [-v] yol...', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, {
      bool: 'rRfvd', long: { recursive: 'r', force: 'f', verbose: 'v', dir: 'd' }
    });
    if (error) return usageErr(ctx, error);
    if (!rest.length) {
      if (f.f) return 0;
      return usageErr(ctx, 'eksik işlenen');
    }
    const recursive = !!(f.r || f.R);
    let status = 0;
    for (const arg of rest) {
      const abs = ctx.resolve(arg);
      const last = arg.replace(/\/+$/, '').split('/').pop();
      if (abs === '/') { ctx.error(`rm: '/' silinemez — bu iyi bir fikir değil ${PANDA}`); status = 1; continue; }
      if (last === '.' || last === '..') { ctx.error(`rm: '.' ya da '..' ile biten yollar silinemez: '${arg}'`); status = 1; continue; }
      const st = ctx.fs.stat(abs);
      if (!st) {
        if (!f.f) { ctx.error(`rm: '${arg}' silinemiyor: Böyle bir dosya ya da dizin yok`); status = 1; }
        continue;
      }
      if (ctx.fs.isProtected(abs)) { ctx.error(`rm: '${arg}' silinemez — korumalı bir klasör ${PANDA}`); status = 1; continue; }
      if (st.type === 'dir' && !recursive) {
        if (f.d && !st.childCount) { /* boş klasör: -d ile serbest */ } else {
          ctx.error(`rm: '${arg}' silinemiyor: Bir dizin (klasörler için -r kullanın)`);
          status = 1;
          continue;
        }
      }
      try {
        ctx.fs.trash(abs);
        if (f.v) ctx.writeln(`'${arg}' çöp kutusuna taşındı`);
      } catch (e) {
        ctx.error(`rm: '${arg}' silinemiyor: ${fsMsg(e)}`);
        status = 1;
      }
    }
    return status;
  }, {
    options: [['-r, -R', 'klasörleri içindekilerle birlikte sil'], ['-f', 'olmayan dosyalar için hata verme'],
      ['-d', 'boş klasörleri sil'], ['-v', 'ne yapıldığını yazdır']],
    examples: [['rm eski.txt'], ['rm -r Taslaklar'], ['rm *.tmp', 'joker karakter']],
    notes: 'Silinenler kalıcı olarak yok edilmez: çöp kutusuna gider. Geri almak için: trash restore <n>.'
  });

  /** mv / cp için hedef çözümü: { destDir } (klasöre ekle) ya da { destPath } (yeni ad). */
  function resolveDest(ctx, srcs, destArg, cmd) {
    const dest = ctx.resolve(destArg);
    const st = ctx.fs.stat(dest);
    if (st && st.type === 'dir') return { destDir: dest };
    if (srcs.length > 1) { ctx.error(`${cmd}: hedef '${destArg}' bir dizin değil`); return null; }
    const parent = ctx.fs.dirname(dest);
    if (!ctx.fs.isDir(parent)) { ctx.error(`${cmd}: '${destArg}' hedefi oluşturulamıyor: Böyle bir dosya ya da dizin yok`); return null; }
    return { destPath: dest, existing: st };
  }

  def('mv', 'files', 'Dosya ve klasörleri taşır ya da yeniden adlandırır', 'mv kaynak... hedef', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'vfn', long: { verbose: 'v', force: 'f' } });
    if (error) return usageErr(ctx, error);
    if (rest.length < 2) return usageErr(ctx, rest.length ? `'${rest[0]}' sonrasında hedef işlenen eksik` : 'eksik dosya işleneni');
    const destArg = rest.pop();
    const target = resolveDest(ctx, rest, destArg, 'mv');
    if (!target) return 1;
    let status = 0;
    for (const arg of rest) {
      const src = ctx.resolve(arg);
      try {
        if (!ctx.fs.exists(src)) throw Object.assign(new Error(), { code: 'ENOENT' });
        let result;
        if (target.destDir) {
          result = ctx.fs.move(src, target.destDir);
        } else {
          const dest = target.destPath;
          if (dest === src) { ctx.error(`mv: '${arg}' ve '${destArg}' aynı dosya`); status = 1; continue; }
          if (target.existing) {
            if (target.existing.type === 'dir' || ctx.fs.isDir(src)) throw Object.assign(new Error(), { code: 'EEXIST' });
            ctx.fs.trash(dest); // üzerine yazılan dosya çöp kutusuna gider
          }
          if (ctx.fs.dirname(dest) === ctx.fs.dirname(src)) result = ctx.fs.rename(src, ctx.fs.basename(dest));
          else {
            const moved = ctx.fs.move(src, ctx.fs.dirname(dest));
            result = ctx.fs.basename(dest) === ctx.fs.basename(moved) ? moved : ctx.fs.rename(moved, ctx.fs.basename(dest));
          }
        }
        if (f.v) ctx.writeln(`'${arg}' -> '${result}'`);
      } catch (e) {
        ctx.error(`mv: '${arg}' taşınamıyor: ${fsMsg(e)}`);
        status = 1;
      }
    }
    return status;
  }, {
    options: [['-v', 'ne yapıldığını yazdır']],
    examples: [['mv eski.txt yeni.txt', 'yeniden adlandır'], ['mv *.txt Belgeler/', 'klasöre taşı']],
    notes: 'Hedefte aynı adlı bir dosya varsa o dosya çöp kutusuna taşınır.'
  });

  def('cp', 'files', 'Dosya ve klasörleri kopyalar', 'cp [-r] [-v] kaynak... hedef', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, {
      bool: 'rRavn', long: { recursive: 'r', verbose: 'v', archive: 'a' }
    });
    if (error) return usageErr(ctx, error);
    if (rest.length < 2) return usageErr(ctx, rest.length ? `'${rest[0]}' sonrasında hedef işlenen eksik` : 'eksik dosya işleneni');
    const recursive = !!(f.r || f.R || f.a);
    const destArg = rest.pop();
    const target = resolveDest(ctx, rest, destArg, 'cp');
    if (!target) return 1;
    let status = 0;
    for (const arg of rest) {
      const src = ctx.resolve(arg);
      const st = ctx.fs.stat(src);
      try {
        if (!st) throw Object.assign(new Error(), { code: 'ENOENT' });
        if (st.type === 'dir' && !recursive) { ctx.error(`cp: -r belirtilmedi; '${arg}' klasörü atlanıyor`); status = 1; continue; }
        let result;
        if (st.type === 'file') {
          const dest = target.destDir ? ctx.fs.join(target.destDir, st.name) : target.destPath;
          if (dest === src) { ctx.error(`cp: '${arg}' ve '${destArg}' aynı dosya`); status = 1; continue; }
          if (ctx.fs.isDir(dest)) throw Object.assign(new Error(), { code: 'EISDIR' });
          ctx.fs.writeFile(dest, ctx.fs.readFile(src));
          result = dest;
        } else if (target.destDir) {
          result = ctx.fs.copy(src, target.destDir);
        } else {
          if (target.existing) throw Object.assign(new Error(), { code: 'EEXIST' });
          const copied = ctx.fs.copy(src, ctx.fs.dirname(target.destPath));
          result = ctx.fs.basename(copied) === ctx.fs.basename(target.destPath) ? copied : ctx.fs.rename(copied, ctx.fs.basename(target.destPath));
        }
        if (f.v) ctx.writeln(`'${arg}' -> '${result}'`);
      } catch (e) {
        ctx.error(`cp: '${arg}' kopyalanamıyor: ${fsMsg(e)}`);
        status = 1;
      }
    }
    return status;
  }, {
    options: [['-r, -R', 'klasörleri içindekilerle birlikte kopyala'], ['-v', 'ne yapıldığını yazdır']],
    examples: [['cp Notlar.txt Yedek.txt'], ['cp -r Projeler Yedek/']],
    notes: 'Aynı adlı hedef dosyanın üzerine yazılır. Var olan bir klasör için "ad (kopya)" oluşturulur.'
  });

  def('tree', 'files', 'Klasör ağacını gösterir', 'tree [-a] [-d] [-L düzey] [klasör]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'ad', value: 'L', long: { all: 'a' } });
    if (error) return usageErr(ctx, error);
    const maxDepth = f.L !== undefined ? parseInt(f.L, 10) : Infinity;
    if (f.L !== undefined && !(maxDepth >= 1)) return usageErr(ctx, `geçersiz düzey: '${f.L}'`);
    const targets = rest.length ? rest : ['.'];
    let status = 0;
    const lines = [];
    let dirs = 0;
    let files = 0;
    const nameFmt = (st) => (ctx.tty ? paint(st.type === 'dir' ? st.name + '/' : st.name, nameCodes(st)) : st.name);
    const walkTree = (dir, prefix, depth) => {
      let list;
      try { list = ctx.fs.list(dir, { hidden: !!f.a }); } catch (e) { return; }
      if (f.d) list = list.filter((s) => s.type === 'dir');
      list.forEach((st, idx) => {
        const isLast = idx === list.length - 1;
        lines.push(`${prefix}${isLast ? '└── ' : '├── '}${nameFmt(st)}`);
        if (st.type === 'dir') {
          dirs++;
          if (depth < maxDepth) walkTree(st.path, prefix + (isLast ? '    ' : '│   '), depth + 1);
        } else files++;
      });
    };
    for (const arg of targets) {
      const abs = ctx.resolve(arg);
      const st = ctx.fs.stat(abs);
      if (!st) { ctx.error(`tree: '${arg}': Böyle bir dosya ya da dizin yok`); status = 2; continue; }
      if (st.type !== 'dir') { ctx.error(`tree: '${arg}': Bir dizin değil`); status = 2; continue; }
      lines.push(ctx.tty ? paint(arg, '1;34') : arg);
      walkTree(abs, '', 1);
    }
    if (lines.length) {
      lines.push('');
      lines.push(f.d ? `${dirs} dizin` : `${dirs} dizin, ${files} dosya`);
      ctx.write(lines.join('\n') + '\n');
    }
    return status;
  }, {
    options: [['-a', 'gizli dosyaları da göster'], ['-d', 'yalnızca klasörleri göster'], ['-L n', 'en fazla n düzey derine in']],
    examples: [['tree'], ['tree -L 2 ~'], ['tree -d ~/Belgeler']]
  });

  def('find', 'files', 'Dosya ve klasör arar', 'find [klasör...] [-name desen] [-iname desen] [-type f|d] [-maxdepth n]', (ctx) => {
    const args = ctx.args.slice();
    const starts = [];
    while (args.length && !args[0].startsWith('-')) starts.push(args.shift());
    if (!starts.length) starts.push('.');
    let nameRe = null;
    let type = null;
    let maxdepth = Infinity;
    let mindepth = 0;
    while (args.length) {
      const a = args.shift();
      if (a === '-name' || a === '-iname') {
        const pat = args.shift();
        if (pat === undefined) { ctx.error(`find: '${a}' için argüman eksik`); return 1; }
        nameRe = globToRegex(pat, a === '-iname');
      } else if (a === '-type') {
        type = args.shift();
        if (type !== 'f' && type !== 'd') { ctx.error(`find: '-type' için bilinmeyen tür: '${type}' (f ya da d kullanın)`); return 1; }
      } else if (a === '-maxdepth' || a === '-mindepth') {
        const v = parseInt(args.shift(), 10);
        if (!(v >= 0)) { ctx.error(`find: '${a}' için geçersiz sayı`); return 1; }
        if (a === '-maxdepth') maxdepth = v; else mindepth = v;
      } else {
        ctx.error(`find: tanınmayan ifade: '${a}'`);
        return 1;
      }
    }
    let status = 0;
    const out = [];
    const matches = (st, label) => {
      if (type === 'f' && st.type !== 'file') return false;
      if (type === 'd' && st.type !== 'dir') return false;
      if (nameRe && !nameRe.test(label)) return false;
      return true;
    };
    for (const arg of starts) {
      if (ctx.aborted()) return 130;
      const abs = ctx.resolve(arg);
      const st = ctx.fs.stat(abs);
      if (!st) { ctx.error(`find: '${arg}': Böyle bir dosya ya da dizin yok`); status = 1; continue; }
      const startName = arg.replace(/\/+$/, '').split('/').pop() || '/';
      const base = arg === '/' ? '' : arg.replace(/\/+$/, '');
      if (mindepth === 0 && matches(st, startName)) out.push(arg);
      if (st.type !== 'dir' || maxdepth < 1) continue;
      const relStart = abs === '/' ? 1 : abs.length + 1;
      ctx.fs.walk(abs, (s) => {
        const rel = s.path.slice(relStart);
        const depth = rel.split('/').length;
        if (depth >= mindepth && matches(s, s.name)) out.push(`${base}/${rel}`);
        if (s.type === 'dir' && depth >= maxdepth) return false;
        return undefined;
      });
    }
    if (out.length) ctx.write(out.join('\n') + '\n');
    return status;
  }, {
    options: [['-name desen', 'ada göre ara; * ve ? kullanılabilir (büyük/küçük harf duyarlı)'], ['-iname desen', 'büyük/küçük harf duyarsız -name'],
      ['-type f|d', 'yalnızca dosyalar (f) ya da klasörler (d)'], ['-maxdepth n', 'en fazla n düzey derine in'], ['-mindepth n', 'n. düzeyden önceki sonuçları atla']],
    examples: [['find . -name "*.txt"'], ['find ~/Belgeler -type d'], ['find / -iname "*notlar*"']]
  });

  def('stat', 'files', 'Dosya ya da klasör bilgisini gösterir', 'stat yol...', (ctx) => {
    if (!ctx.args.length) return usageErr(ctx, 'eksik işlenen');
    let status = 0;
    const full = (ts) => new Date(ts).toLocaleString('tr-TR');
    for (const arg of ctx.args) {
      const st = ctx.fs.stat(ctx.resolve(arg));
      if (!st) { ctx.error(`stat: '${arg}' durumu alınamıyor: Böyle bir dosya ya da dizin yok`); status = 1; continue; }
      ctx.write([
        `  Dosya: ${st.name}`,
        `   Yol: ${st.path}`,
        `   Tür: ${st.type === 'dir' ? 'klasör' : 'düz dosya'}${st.ext ? ` (${st.ext})` : ''}`,
        `Boyut: ${fmtNum(st.size)} bayt${st.type === 'dir' ? `, ${st.childCount} öğe` : ''}`,
        `Oluşturma: ${full(st.created)}`,
        `Değişiklik: ${full(st.modified)}`
      ].join('\n') + '\n');
    }
    return status;
  });

  def('du', 'files', 'Klasörlerin boyutunu gösterir', 'du [-h] [-s] [yol...]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'hs', long: { 'human-readable': 'h', summarize: 's' } });
    if (error) return usageErr(ctx, error);
    let status = 0;
    const size = (b) => (f.h ? U.formatBytes(b) : String(Math.max(1, Math.ceil(b / 1024))));
    const rows = [];
    for (const arg of rest.length ? rest : ['.']) {
      const abs = ctx.resolve(arg);
      const st = ctx.fs.stat(abs);
      if (!st) { ctx.error(`du: '${arg}' erişilemiyor: Böyle bir dosya ya da dizin yok`); status = 1; continue; }
      if (st.type === 'dir' && !f.s) {
        const base = arg.replace(/\/+$/, '') || '/';
        const sub = [];
        ctx.fs.walk(abs, (s) => { if (s.type === 'dir') sub.push([`${base === '/' ? '' : base}/${s.path.slice(abs === '/' ? 1 : abs.length + 1)}`, s.size]); });
        sub.reverse().forEach(([p, b]) => rows.push([size(b), p]));
      }
      rows.push([size(st.size), arg]);
    }
    const w = Math.max(0, ...rows.map((r) => r[0].length));
    if (rows.length) ctx.write(rows.map((r) => `${padL(r[0], w)}  ${r[1]}`).join('\n') + '\n');
    return status;
  }, { options: [['-h', 'okunur boyutlar'], ['-s', 'yalnızca toplamı göster']], examples: [['du -sh ~']] });

  def('df', 'files', 'Depolama kullanımını gösterir', 'df [-h]', (ctx) => {
    const u = ctx.fs.usage();
    const pct = Math.round((u.used / u.quota) * 100);
    const rows = [['Dosya sistemi', 'Boyut', 'Kullanılan', 'Boş', 'Kullanım', 'Bağlama'],
      ['pandafs', U.formatBytes(u.quota), U.formatBytes(u.used), U.formatBytes(Math.max(0, u.quota - u.used)), `%${pct}`, '/']];
    const w = rows[0].map((_, i) => Math.max(...rows.map((r) => vlen(r[i]))));
    ctx.write(rows.map((r, ri) => r.map((c, i) => (i === 0 || i === 5 ? padR(c, w[i]) : padL(c, w[i]))).join('  ')).join('\n') + '\n');
    return 0;
  });

  // ---------------------------------------------------------------- komutlar: metin işleme
  /** Dosya adlarından ya da stdin'den metin kaynakları toplar. stdin yoksa null (çağıran kullanım hatası verir). */
  function gatherInputs(ctx, files) {
    const inputs = [];
    let ok = true;
    if (!files.length) {
      if (ctx.stdin == null) return null;
      return { inputs: [{ label: '(standart girdi)', text: ctx.stdin, stdin: true }], ok };
    }
    for (const f of files) {
      if (f === '-') { inputs.push({ label: '-', text: ctx.stdin == null ? '' : ctx.stdin, stdin: true }); continue; }
      const text = readText(ctx, f);
      if (text === null) { ok = false; continue; }
      inputs.push({ label: f, text });
    }
    return { inputs, ok };
  }

  const paintIf = (ctx, s, codes) => (ctx.tty ? paint(s, codes) : String(s));

  const needInput = (ctx) => {
    ctx.error(`${ctx.name}: bir dosya adı verin ya da komut çıktısını | ile aktarın`);
    return 1;
  };

  const looksBinary = (text) => text.length > 64 && /^data:[\w/+.-]+;base64,/.test(text);

  function unescapeEcho(text) {
    let stop = false;
    const out = text.replace(/\\(c|n|t|r|a|b|e|\\|0[0-7]{1,3}|x[0-9a-fA-F]{1,2})/g, (m, c) => {
      if (stop) return '';
      switch (c[0]) {
        case 'c': stop = true; return '';
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '';
        case 'a': return '';
        case 'b': return '';
        case 'e': return '\x1b';
        case '\\': return '\\';
        case '0': return String.fromCharCode(parseInt(c.slice(1) || '0', 8));
        case 'x': return String.fromCharCode(parseInt(c.slice(1), 16));
        default: return m;
      }
    });
    return out;
  }

  def('echo', 'text', 'Metni yazdırır', 'echo [-n] [-e] [metin...]', (ctx) => {
    let a = ctx.args;
    let nl = true;
    let esc = false;
    while (a.length && /^-[neE]+$/.test(a[0])) {
      if (a[0].includes('n')) nl = false;
      if (a[0].includes('e')) esc = true;
      if (a[0].includes('E')) esc = false;
      a = a.slice(1);
    }
    let text = a.join(' ');
    if (esc) text = unescapeEcho(text);
    ctx.write(text + (nl ? '\n' : ''));
    return 0;
  }, {
    rawArgs: true,
    options: [['-n', 'sonda satır sonu yazma'], ['-e', 'ters bölü kaçışlarını (\\n \\t \\e) yorumla']],
    examples: [['echo Merhaba dünya'], ['echo selam > not.txt', 'dosyaya yaz'], ['echo "kaç tane?" >> not.txt', 'dosyaya ekle'], ['echo $HOME $?']]
  });

  def('cat', 'text', 'Dosya içeriğini yazdırır', 'cat [-n] [dosya...]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'n', long: { number: 'n' } });
    if (error) return usageErr(ctx, error);
    const g = gatherInputs(ctx, rest);
    if (!g) return needInput(ctx);
    let status = g.ok ? 0 : 1;
    let n = 0;
    for (const inp of g.inputs) {
      if (!inp.stdin && looksBinary(inp.text)) {
        ctx.error(`cat: ${inp.label}: ikili dosya (${U.formatBytes(inp.text.length)}) — görüntülemek için: open ${shQuote(inp.label)}`);
        status = 1;
        continue;
      }
      if (f.n) {
        const lines = splitLines(inp.text);
        ctx.write(joinLines(lines.map((l) => `${padL(String(++n), 6)}  ${l}`)));
      } else ctx.write(inp.text);
    }
    return status;
  }, { options: [['-n', 'satırları numaralandır']], examples: [['cat Notlar.txt'], ['cat a.txt b.txt > hepsi.txt', 'birleştir'], ['cat -n Notlar.txt']] });

  function headTail(which) {
    return (ctx) => {
      const { flags: f, rest, error } = parseArgs(ctx.args, {
        bool: 'qv', value: 'n', numeric: 'n', long: { lines: 'n', quiet: 'q', verbose: 'v' }
      });
      if (error) return usageErr(ctx, error);
      const raw = f.n === undefined ? '10' : String(f.n);
      if (!/^[+-]?\d+$/.test(raw)) return usageErr(ctx, `geçersiz satır sayısı: '${raw}'`);
      const num = parseInt(raw, 10);
      const g = gatherInputs(ctx, rest);
      if (!g) return needInput(ctx);
      let status = g.ok ? 0 : 1;
      const header = (g.inputs.length > 1 && !f.q) || f.v;
      g.inputs.forEach((inp, idx) => {
        let lines = splitLines(inp.text);
        if (which === 'head') lines = raw.startsWith('-') ? lines.slice(0, Math.max(0, lines.length + num)) : lines.slice(0, Math.abs(num));
        else if (raw.startsWith('+')) lines = lines.slice(Math.max(0, num - 1));
        else lines = Math.abs(num) === 0 ? [] : lines.slice(-Math.abs(num));
        if (header) ctx.write(`${idx ? '\n' : ''}==> ${inp.label} <==\n`);
        ctx.write(joinLines(lines));
      });
      return status;
    };
  }
  def('head', 'text', 'Dosyanın ilk satırlarını yazdırır', 'head [-n sayı] [dosya...]', headTail('head'), {
    options: [['-n N', 'ilk N satır (varsayılan 10); -N de çalışır'], ['-n -N', 'son N satır hariç hepsi']],
    examples: [['head -n 5 Notlar.txt'], ['ls | head -3', 'borudan gelen metin']]
  });
  def('tail', 'text', 'Dosyanın son satırlarını yazdırır', 'tail [-n sayı] [dosya...]', headTail('tail'), {
    options: [['-n N', 'son N satır (varsayılan 10); -N de çalışır'], ['-n +N', 'N. satırdan sona kadar']],
    examples: [['tail -n 3 Notlar.txt'], ['history | tail -5']]
  });

  def('wc', 'text', 'Satır, sözcük ve bayt sayar', 'wc [-l] [-w] [-c] [-m] [dosya...]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'lwcm', long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm' } });
    if (error) return usageErr(ctx, error);
    const g = gatherInputs(ctx, rest);
    if (!g) return needInput(ctx);
    const none = !(f.l || f.w || f.c || f.m);
    const cols = [];
    if (f.l || none) cols.push('l');
    if (f.w || none) cols.push('w');
    if (f.m) cols.push('m');
    if (f.c || none) cols.push('c');
    const enc = new TextEncoder();
    const count = (text) => cols.map((c) => {
      if (c === 'l') return (text.match(/\n/g) || []).length;
      if (c === 'w') return text.trim() ? text.trim().split(/\s+/).length : 0;
      if (c === 'm') return chars(text).length;
      return enc.encode(text).length;
    });
    const rows = g.inputs.map((inp) => ({ nums: count(inp.text), label: inp.stdin ? '' : inp.label }));
    if (g.inputs.length > 1) {
      rows.push({ nums: cols.map((_, i) => rows.reduce((a, r) => a + r.nums[i], 0)), label: 'toplam' });
    }
    const w = Math.max(1, ...rows.flatMap((r) => r.nums.map((n) => String(n).length)));
    ctx.write(rows.map((r) => r.nums.map((n) => padL(String(n), w)).join(' ') + (r.label ? ` ${r.label}` : '')).join('\n') + '\n');
    return g.ok ? 0 : 1;
  }, {
    options: [['-l', 'satır sayısı'], ['-w', 'sözcük sayısı'], ['-c', 'bayt sayısı'], ['-m', 'karakter sayısı']],
    examples: [['wc -l Notlar.txt'], ['ls | wc -l', 'kaç öğe var?']]
  });

  def('sort', 'text', 'Satırları sıralar', 'sort [-r] [-n] [-u] [-f] [dosya...]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, {
      bool: 'rnuf', long: { reverse: 'r', 'numeric-sort': 'n', unique: 'u', 'ignore-case': 'f' }
    });
    if (error) return usageErr(ctx, error);
    const g = gatherInputs(ctx, rest);
    if (!g) return needInput(ctx);
    let lines = g.inputs.flatMap((i) => splitLines(i.text));
    const lead = (s) => { const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(s); return m ? parseFloat(m[1].replace(',', '.')) : 0; };
    const str = (a, b) => a.localeCompare(b, 'tr', { sensitivity: f.f ? 'base' : 'variant' });
    const cmp = f.n ? (a, b) => lead(a) - lead(b) || str(a, b) : str;
    lines.sort(cmp);
    if (f.u) lines = lines.filter((l, i) => i === 0 || cmp(lines[i - 1], l) !== 0);
    if (f.r) lines.reverse();
    ctx.write(joinLines(lines));
    return g.ok ? 0 : 1;
  }, {
    options: [['-r', 'ters sırala'], ['-n', 'sayısal sırala'], ['-u', 'yinelenen satırları at'], ['-f', 'büyük/küçük harfi yok say']],
    examples: [['sort isimler.txt'], ['ls -l | sort -n']]
  });

  def('uniq', 'text', 'Ardışık yinelenen satırları birleştirir', 'uniq [-c] [-d] [dosya]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'cd', long: { count: 'c', repeated: 'd' } });
    if (error) return usageErr(ctx, error);
    const g = gatherInputs(ctx, rest.slice(0, 1));
    if (!g) return needInput(ctx);
    const out = [];
    const runs = [];
    for (const l of g.inputs.flatMap((i) => splitLines(i.text))) {
      if (runs.length && runs[runs.length - 1][0] === l) runs[runs.length - 1][1]++;
      else runs.push([l, 1]);
    }
    for (const [l, n] of runs) {
      if (f.d && n < 2) continue;
      out.push(f.c ? `${padL(String(n), 7)} ${l}` : l);
    }
    ctx.write(joinLines(out));
    return g.ok ? 0 : 1;
  }, { options: [['-c', 'tekrar sayısını başa yaz'], ['-d', 'yalnızca yinelenenleri göster']], examples: [['sort a.txt | uniq -c']] });

  def('tac', 'text', 'Satırları tersten yazdırır', 'tac [dosya...]', (ctx) => {
    const g = gatherInputs(ctx, ctx.args);
    if (!g) return needInput(ctx);
    ctx.write(joinLines(g.inputs.flatMap((i) => splitLines(i.text)).reverse()));
    return g.ok ? 0 : 1;
  });

  def('rev', 'text', 'Her satırı tersine çevirir', 'rev [dosya...]', (ctx) => {
    const g = gatherInputs(ctx, ctx.args);
    if (!g) return needInput(ctx);
    ctx.write(joinLines(g.inputs.flatMap((i) => splitLines(i.text)).map((l) => chars(l).reverse().join(''))));
    return g.ok ? 0 : 1;
  });

  def('tee', 'text', 'Girdiyi hem ekrana hem dosyaya yazar', 'tee [-a] dosya...', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'a', long: { append: 'a' } });
    if (error) return usageErr(ctx, error);
    if (ctx.stdin == null) return needInput(ctx);
    ctx.write(ctx.stdin);
    let status = 0;
    for (const arg of rest) {
      try {
        const abs = ctx.resolve(arg);
        if (f.a && ctx.fs.exists(abs)) ctx.fs.appendFile(abs, stripAnsi(ctx.stdin));
        else ctx.fs.writeFile(abs, stripAnsi(ctx.stdin));
      } catch (e) { ctx.error(`tee: ${arg}: ${fsMsg(e)}`); status = 1; }
    }
    return status;
  }, { examples: [['ls | tee liste.txt']] });

  def('printf', 'text', 'Biçimlendirilmiş metin yazdırır', 'printf BİÇİM [ARGÜMAN...]', (ctx) => {
    if (!ctx.args.length) return usageErr(ctx, 'biçim eksik');
    const fmt = unescapeEcho(ctx.args[0]);
    const args = ctx.args.slice(1);
    const re = /%([-+ 0#]*)(\d*)(?:\.(\d+))?([sdifxXocb%])/g;
    const usesArgs = (fmt.match(re) || []).some((m) => m !== '%%');
    let ai = 0;
    let out = '';
    do {
      out += fmt.replace(re, (m, flags, width, prec, conv) => {
        if (conv === '%') return '%';
        const arg = ai < args.length ? args[ai++] : undefined;
        let s;
        let numeric = false;
        if (conv === 's' || conv === 'b') {
          s = arg === undefined ? '' : String(arg);
          if (prec !== undefined) s = chars(s).slice(0, Number(prec)).join('');
        } else if (conv === 'c') s = arg ? chars(arg)[0] : '';
        else {
          numeric = true;
          const v = conv === 'f' ? parseFloat(arg === undefined ? '0' : arg) : parseInt(arg === undefined ? '0' : arg, 10);
          const num = Number.isNaN(v) ? 0 : v;
          if (conv === 'f') s = num.toFixed(prec === undefined ? 6 : Number(prec));
          else if (conv === 'x') s = (num >>> 0).toString(16);
          else if (conv === 'X') s = (num >>> 0).toString(16).toUpperCase();
          else if (conv === 'o') s = (num >>> 0).toString(8);
          else s = String(num);
          if (flags.includes('+') && num >= 0 && (conv === 'd' || conv === 'i' || conv === 'f')) s = '+' + s;
        }
        const w = width ? Number(width) : 0;
        if (flags.includes('-')) return padR(s, w);
        if (numeric && flags.includes('0') && s.length < w) {
          const sign = /^[+-]/.test(s) ? s[0] : '';
          return sign + '0'.repeat(w - s.length) + s.slice(sign.length);
        }
        return padL(s, w);
      });
    } while (usesArgs && ai < args.length);
    ctx.write(out);
    return 0;
  }, {
    rawArgs: true,
    options: [['%s %d %f %x %c %%', 'dizge, tam sayı, ondalık, onaltılık, karakter, yüzde'], ['%5s %-5s %05d %.2f', 'genişlik, sola yaslama, sıfır dolgu, hassasiyet']],
    examples: [['printf "%s yaşında %d%%\\n" Panda 3'], ['printf "%05.1f\\n" 3.14159']],
    notes: 'Argümanlar bitene kadar biçim yinelenir. Satır sonu için \\n yazın.'
  });

  const TR_CLASSES = {
    '[:lower:]': 'abcdefghijklmnopqrstuvwxyz', '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '[:digit:]': '0123456789',
    '[:space:]': ' \t\n\r\f\v', '[:punct:]': '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
  };
  TR_CLASSES['[:alpha:]'] = TR_CLASSES['[:lower:]'] + TR_CLASSES['[:upper:]'];
  TR_CLASSES['[:alnum:]'] = TR_CLASSES['[:alpha:]'] + TR_CLASSES['[:digit:]'];

  function expandTrSet(set) {
    let s = set;
    for (const [k, v] of Object.entries(TR_CLASSES)) s = s.split(k).join(v);
    const cs = chars(unescapeEcho(s));
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      if (i + 2 < cs.length && cs[i + 1] === '-') {
        const a = cs[i].codePointAt(0);
        const b = cs[i + 2].codePointAt(0);
        if (a <= b) {
          for (let c = a; c <= b; c++) out.push(String.fromCodePoint(c));
          i += 2;
          continue;
        }
      }
      out.push(cs[i]);
    }
    return out;
  }

  def('tr', 'text', 'Karakterleri çevirir ya da siler', 'tr [-d] [-s] KÜME1 [KÜME2]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'ds', long: { delete: 'd', squeeze: 's' } });
    if (error) return usageErr(ctx, error);
    if (!rest.length || (!f.d && !f.s && rest.length < 2)) return usageErr(ctx, 'eksik işlenen');
    if (ctx.stdin == null) return needInput(ctx);
    const a = expandTrSet(rest[0]);
    const b = rest[1] === undefined ? [] : expandTrSet(rest[1]);
    const map = new Map();
    if (!f.d && b.length) a.forEach((c, i) => map.set(c, b[Math.min(i, b.length - 1)]));
    const del = new Set(f.d ? a : []);
    const squeezeSet = new Set(f.s ? (b.length ? b : a) : []);
    let out = '';
    let prev = null;
    for (const ch of chars(ctx.stdin)) {
      if (del.has(ch)) continue;
      const mapped = map.has(ch) ? map.get(ch) : ch;
      if (squeezeSet.has(mapped) && prev === mapped) continue;
      out += mapped;
      prev = mapped;
    }
    ctx.write(out);
    return 0;
  }, {
    options: [['-d', 'KÜME1\'deki karakterleri sil'], ['-s', 'tekrar eden karakterleri tek karaktere indir']],
    examples: [['echo merhaba | tr a-z A-Z'], ['echo "a  b" | tr -s " "'], ['echo hello | tr -d l']],
    notes: 'Kümelerde aralıklar (a-z) ve sınıflar ([:lower:] [:upper:] [:digit:] [:space:]) kullanılabilir.'
  });

  def('cut', 'text', 'Satırlardan alan ya da karakter keser', 'cut -d AYIRAÇ -f LİSTE [dosya...]  |  cut -c LİSTE [dosya...]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 's', value: 'dfc', long: { delimiter: 'd', fields: 'f', characters: 'c', 'only-delimited': 's' } });
    if (error) return usageErr(ctx, error);
    if (f.f === undefined && f.c === undefined) return usageErr(ctx, 'alan listesi (-f) ya da karakter listesi (-c) belirtin');
    const spec = String(f.f !== undefined ? f.f : f.c);
    const ranges = [];
    for (const part of spec.split(',')) {
      const m = /^(\d*)(-?)(\d*)$/.exec(part.trim());
      if (!m || (!m[1] && !m[3])) return usageErr(ctx, `geçersiz liste: '${spec}'`);
      const lo = m[1] ? Number(m[1]) : 1;
      const hi = m[2] ? (m[3] ? Number(m[3]) : Infinity) : lo;
      ranges.push([lo, hi]);
    }
    const want = (k) => ranges.some(([lo, hi]) => k >= lo && k <= hi);
    const delim = f.d === undefined ? '\t' : f.d;
    const g = gatherInputs(ctx, rest);
    if (!g) return needInput(ctx);
    const out = [];
    for (const line of g.inputs.flatMap((i) => splitLines(i.text))) {
      if (f.c !== undefined) { out.push(chars(line).filter((_, i) => want(i + 1)).join('')); continue; }
      if (!line.includes(delim)) { if (!f.s) out.push(line); continue; }
      out.push(line.split(delim).filter((_, i) => want(i + 1)).join(delim));
    }
    ctx.write(joinLines(out));
    return g.ok ? 0 : 1;
  }, {
    options: [['-d AYIRAÇ', 'alan ayıracı (varsayılan: sekme)'], ['-f LİSTE', 'alanlar: 1  1,3  2-4  2-'], ['-c LİSTE', 'karakter konumları'], ['-s', 'ayıracı olmayan satırları atla']],
    examples: [['echo a:b:c | cut -d: -f2'], ['cut -c 1-5 Notlar.txt'], ['ls -l | cut -c 1-10']]
  });

  def('grep', 'text', 'Metinde desen arar', 'grep [SEÇENEK]... DESEN [DOSYA]...', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, {
      bool: 'invclwFErRHhoqs',
      value: 'e',
      long: {
        'ignore-case': 'i', 'line-number': 'n', 'invert-match': 'v', count: 'c', 'files-with-matches': 'l',
        'word-regexp': 'w', 'fixed-strings': 'F', recursive: 'r', 'only-matching': 'o', quiet: 'q', regexp: 'e', 'with-filename': 'H', 'no-filename': 'h'
      }
    });
    if (error) return usageErr(ctx, error);
    const pattern = f.e !== undefined ? f.e : rest.shift();
    if (pattern === undefined) return usageErr(ctx, 'DESEN eksik\nKullanım: grep [SEÇENEK]... DESEN [DOSYA]...');
    // -i: JavaScript, ı/İ harflerini I/i ile eşleştirmez; uzunluğu koruyan bir katlama ile Türkçe harfler de duyarsız olur
    const fold = f.i ? (s) => s.replace(/[ıİ]/g, 'i') : (s) => s;
    let src = fold(f.F ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern);
    let flags = f.i ? 'i' : '';
    if (f.w) { src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`; flags += 'u'; }
    let re;
    let reG;
    try {
      re = new RegExp(src, flags);
      reG = new RegExp(src, flags + 'g');
    } catch (e) {
      ctx.error(`grep: geçersiz düzenli ifade: ${pattern}`);
      return 2;
    }
    const recursive = !!(f.r || f.R);
    const sources = [];
    let status = 0;
    let anyDir = false;
    if (!rest.length) {
      if (recursive) {
        anyDir = true;
        ctx.fs.walk(ctx.shell.cwd, (st) => {
          if (st.type === 'file') {
            const t = ctx.fs.readFile(st.path);
            if (!looksBinary(t)) sources.push({ label: st.path.slice(ctx.shell.cwd === '/' ? 1 : ctx.shell.cwd.length + 1), text: t });
          }
        });
      } else if (ctx.stdin != null) sources.push({ label: '(standart girdi)', text: ctx.stdin, stdin: true });
      else return usageErr(ctx, 'bir dosya adı verin ya da komut çıktısını | ile aktarın');
    } else {
      for (const arg of rest) {
        if (arg === '-') { sources.push({ label: '(standart girdi)', text: ctx.stdin == null ? '' : ctx.stdin, stdin: true }); continue; }
        const abs = ctx.resolve(arg);
        const st = ctx.fs.stat(abs);
        if (!st) { if (!f.s) ctx.error(`grep: ${arg}: Böyle bir dosya ya da dizin yok`); status = 2; continue; }
        if (st.type === 'dir') {
          if (!recursive) { if (!f.s) ctx.error(`grep: ${arg}: Bir dizin`); status = 2; continue; }
          anyDir = true;
          const base = arg.replace(/\/+$/, '');
          ctx.fs.walk(abs, (s) => {
            if (s.type !== 'file') return;
            const t = ctx.fs.readFile(s.path);
            if (!looksBinary(t)) sources.push({ label: `${base === '' ? '' : base}/${s.path.slice(abs === '/' ? 1 : abs.length + 1)}`, text: t });
          });
        } else {
          const t = ctx.fs.readFile(abs);
          if (!looksBinary(t)) sources.push({ label: arg, text: t });
        }
      }
    }
    const showName = f.H || (!f.h && (sources.length > 1 || anyDir));
    const out = [];
    let matchedAny = false;
    const hl = ctx.tty && !f.v;
    for (const srcItem of sources) {
      const lines = splitLines(srcItem.text);
      let count = 0;
      const namePrefix = showName ? paintIf(ctx, srcItem.label, '35') + paintIf(ctx, ':', '36') : '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hay = fold(line);
        if (re.test(hay) === !!f.v) continue;
        count++;
        matchedAny = true;
        if (f.q) { return 0; }
        if (f.l || f.c) { if (f.l) break; continue; }
        const numPrefix = f.n ? paintIf(ctx, String(i + 1), '32') + paintIf(ctx, ':', '36') : '';
        if (f.o && !f.v) {
          for (const m of hay.matchAll(reG)) {
            if (m[0]) out.push(namePrefix + numPrefix + (hl ? paint(line.slice(m.index, m.index + m[0].length), '1;31') : line.slice(m.index, m.index + m[0].length)));
          }
        } else if (hl) {
          let text = '';
          let at = 0;
          for (const m of hay.matchAll(reG)) {
            if (!m[0]) continue;
            text += line.slice(at, m.index) + paint(line.slice(m.index, m.index + m[0].length), '1;31');
            at = m.index + m[0].length;
          }
          out.push(namePrefix + numPrefix + text + line.slice(at));
        } else {
          out.push(namePrefix + numPrefix + line);
        }
      }
      if (f.c) out.push(namePrefix + count);
      else if (f.l && count) out.push(paintIf(ctx, srcItem.label, '35'));
    }
    if (out.length) ctx.write(out.join('\n') + '\n');
    if (status === 2) return 2;
    return matchedAny ? 0 : 1;
  }, {
    options: [['-i', 'büyük/küçük harfi yok say'], ['-n', 'satır numarasını göster'], ['-v', 'eşleşmeyen satırları seç'],
      ['-c', 'yalnızca eşleşen satır sayısı'], ['-l', 'yalnızca eşleşen dosya adları'], ['-w', 'tam sözcük eşleşmesi'],
      ['-F', 'deseni düz metin olarak ara'], ['-r', 'klasörlerde özyinelemeli ara'], ['-o', 'yalnızca eşleşen kısımları yazdır'],
      ['-H / -h', 'dosya adını göster / gizle']],
    examples: [['grep -in bambu Notlar.txt'], ['grep -r "[x]" ~/Belgeler'], ['ls | grep txt'], ['history | grep cd']],
    notes: 'Desen bir düzenli ifadedir (JavaScript söz dizimi). Eşleşme yoksa çıkış durumu 1 olur.'
  });

  // ---------------------------------------------------------------- komutlar: sistem ve uygulamalar
  const DAYS_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const DAYS_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const CATEGORY_TR = { system: 'Sistem', productivity: 'Üretkenlik', media: 'Medya', games: 'Oyunlar', utilities: 'Araçlar' };

  function strftime(fmt, d) {
    return fmt.replace(/%([a-zA-Z%])/g, (m, c) => {
      switch (c) {
        case 'Y': return String(d.getFullYear());
        case 'y': return pad2(d.getFullYear() % 100);
        case 'm': return pad2(d.getMonth() + 1);
        case 'd': return pad2(d.getDate());
        case 'e': return String(d.getDate()).padStart(2, ' ');
        case 'H': return pad2(d.getHours());
        case 'M': return pad2(d.getMinutes());
        case 'S': return pad2(d.getSeconds());
        case 'A': return DAYS_LONG[d.getDay()];
        case 'a': return DAYS_SHORT[d.getDay()];
        case 'B': return MONTHS_LONG[d.getMonth()];
        case 'b': return MONTHS[d.getMonth()];
        case 'F': return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        case 'T': return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
        case 'R': return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        case 's': return String(Math.floor(d.getTime() / 1000));
        case 'j': return String(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000)).padStart(3, '0');
        case 'u': return String(d.getDay() || 7);
        case 'w': return String(d.getDay());
        case '%': return '%';
        default: return m;
      }
    });
  }

  const bootAgeMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return [47, 158, 107];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Geometriden üretilen piksel panda (yarım blok karakterlerle, 24 sütun x 12 satır). */
  function pandaArt() {
    const W = 24;
    const H = 24;
    const BLACK = [58, 63, 76];
    const WHITE = [244, 245, 248];
    const SHADE = [196, 202, 214];
    const DARK = [30, 33, 41];
    const PINK = [244, 160, 178];
    const px = Array.from({ length: H }, () => Array(W).fill(null));
    const inEll = (x, y, cx, cy, rx, ry, rot) => {
      const dx = x - cx;
      const dy = y - cy;
      const c = Math.cos(rot || 0);
      const s = Math.sin(rot || 0);
      const u = dx * c + dy * s;
      const v = -dx * s + dy * c;
      return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const X = x + 0.5;
        const Y = y + 0.5;
        let c = null;
        if (inEll(X, Y, 4.6, 4.8, 3.9, 3.9) || inEll(X, Y, 19.4, 4.8, 3.9, 3.9)) c = BLACK;
        if (inEll(X, Y, 12, 13.4, 10.7, 9.6)) {
          c = WHITE;
          if (!inEll(X, Y, 12, 12.2, 10.1, 9.0)) c = SHADE;
          if (inEll(X, Y, 7.4, 12.6, 2.5, 3.5, 0.45) || inEll(X, Y, 16.6, 12.6, 2.5, 3.5, -0.45)) c = BLACK;
          if (inEll(X, Y, 7.9, 12.3, 0.85, 0.85) || inEll(X, Y, 16.1, 12.3, 0.85, 0.85)) c = WHITE;
          if (inEll(X, Y, 12, 15.9, 1.9, 1.2)) c = DARK;
          if (inEll(X, Y, 5.0, 17.0, 1.5, 1.0) || inEll(X, Y, 19.0, 17.0, 1.5, 1.0)) c = PINK;
          if ((Y > 17.3 && Y < 18.4 && ((X > 10.1 && X < 11.9) || (X > 12.1 && X < 13.9)) && !inEll(X, Y, 12, 16.9, 1.6, 0.9))) c = DARK;
        }
        px[y][x] = c;
      }
    }
    const fg = (c) => `38;2;${c[0]};${c[1]};${c[2]}`;
    const bg = (c) => `48;2;${c[0]};${c[1]};${c[2]}`;
    const lines = [];
    for (let r = 0; r < H; r += 2) {
      let line = '';
      for (let x = 0; x < W; x++) {
        const t = px[r][x];
        const b = px[r + 1][x];
        if (!t && !b) line += ' ';
        else if (t && !b) line += paint('▀', fg(t));
        else if (!t && b) line += paint('▄', fg(b));
        else if (t === b) line += paint('█', fg(t));
        else line += paint('▀', `${fg(t)};${bg(b)}`);
      }
      lines.push(line);
    }
    return lines;
  }

  def('neofetch', 'system', 'Sistem bilgisini şık bir özetle gösterir', 'neofetch', (ctx) => {
    const sh = ctx.shell;
    const accent = P.settings ? P.settings.get('accent') : '#2f9e6b';
    const [r, g, b] = hexToRgb(accent);
    const lift = (v) => Math.round(v + (255 - v) * 0.3);
    const lab = (t) => ctx.paint(t, `1;38;2;${lift(r)};${lift(g)};${lift(b)}`);
    const accName = ((P.settings && P.settings.ACCENTS) || []).find((a) => a.value.toLowerCase() === String(accent).toLowerCase());
    const themeMode = P.theme ? P.theme.mode() : 'dark';
    const themeNow = P.theme ? P.theme.get() : 'dark';
    const usage = ctx.fs.usage();
    const pct = Math.round((usage.used / usage.quota) * 100);
    const appCount = P.apps && P.apps.list ? P.apps.list().length : 0;
    const head = `${sh.user}@${sh.hostname}`;
    const info = [
      ctx.paint(sh.user, '1;32') + '@' + ctx.paint(sh.hostname, '1;32'),
      '-'.repeat(head.length),
      `${lab('OS')}: PandaOS ${P.version ? '1.0' : '1.0'} (${P.codename || 'Bambu'})`,
      `${lab('Çekirdek')}: panda-kernel ${P.version || '1.0.0'}`,
      `${lab('Çalışma süresi')}: ${fmtDuration(bootAgeMs())}`,
      `${lab('Kabuk')}: pandash 1.0`,
      `${lab('Çözünürlük')}: ${window.screen ? `${window.screen.width}x${window.screen.height}` : 'bilinmiyor'}`,
      `${lab('Tema')}: ${themeNow === 'dark' ? 'Koyu' : 'Açık'}${themeMode === 'auto' ? ' (otomatik)' : ''}`,
      `${lab('Vurgu rengi')}: ${ctx.paint('■', `38;2;${r};${g};${b}`)} ${accName ? `${accName.name} (${accent})` : accent}`,
      `${lab('Terminal')}: PandaOS Terminal`,
      `${lab('Uygulamalar')}: ${appCount}`,
      `${lab('Depolama')}: ${U.formatBytes(usage.used)} / ${U.formatBytes(usage.quota)} (%${pct})`,
      '',
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ctx.paint('   ', String(40 + i))).join(''),
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ctx.paint('   ', String(100 + i))).join('')
    ];
    const art = pandaArt();
    const artW = 24;
    const lines = [];
    if ((ctx.cols || 80) >= artW + 3 + 38) {
      const rows = Math.max(art.length, info.length);
      const top = Math.max(0, Math.floor((art.length - info.length) / 2));
      for (let i = 0; i < rows; i++) {
        const a = art[i] === undefined ? ' '.repeat(artW) : art[i];
        const inf = info[i - top] === undefined ? '' : info[i - top];
        lines.push(`${a}   ${inf}`.replace(/\s+$/, ''));
      }
    } else {
      lines.push(...art, '', ...info);
    }
    ctx.write((ctx.tty ? lines.join('\n') : lines.map(stripAnsi).join('\n')) + '\n');
    return 0;
  }, { examples: [['neofetch']] });

  def('whoami', 'system', 'Oturumdaki kullanıcıyı yazdırır', 'whoami', (ctx) => { ctx.writeln(ctx.shell.user); return 0; });
  def('hostname', 'system', 'Makine adını yazdırır', 'hostname', (ctx) => { ctx.writeln(ctx.shell.hostname); return 0; });

  def('date', 'system', 'Tarih ve saati yazdırır', 'date [+BİÇİM]', (ctx) => {
    const fmtArg = ctx.args.find((a) => a.startsWith('+'));
    const d = new Date();
    ctx.writeln(fmtArg ? strftime(fmtArg.slice(1), d) : strftime('%A, %e %B %Y %H:%M:%S', d).replace(/\s{2,}/, ' '));
    return 0;
  }, {
    options: [['+BİÇİM', '%Y yıl, %m ay, %d gün, %H saat, %M dakika, %S saniye, %A gün adı, %B ay adı, %F, %T, %s']],
    examples: [['date'], ['date +%F', '2026-10-08'], ['date "+%d.%m.%Y %H:%M"']]
  });

  def('uname', 'system', 'Sistem bilgisini yazdırır', 'uname [-a] [-s] [-n] [-r] [-v] [-m]', (ctx) => {
    const { flags: f, error } = parseArgs(ctx.args, { bool: 'asnrvmo', long: { all: 'a' } });
    if (error) return usageErr(ctx, error);
    const parts = { s: 'PandaOS', n: ctx.shell.hostname, r: P.version || '1.0.0', v: `(${P.codename || 'Bambu'})`, m: 'tarayıcı', o: 'PandaOS' };
    const keys = f.a ? ['s', 'n', 'r', 'v', 'm', 'o'] : ['s', 'n', 'r', 'v', 'm', 'o'].filter((k) => f[k]);
    ctx.writeln((keys.length ? keys : ['s']).map((k) => parts[k]).join(' '));
    return 0;
  }, { options: [['-a', 'hepsi'], ['-s', 'çekirdek adı'], ['-n', 'makine adı'], ['-r', 'sürüm'], ['-m', 'donanım türü']] });

  def('uptime', 'system', 'Sistemin ne zamandır açık olduğunu gösterir', 'uptime', (ctx) => {
    ctx.writeln(`${strftime('%H:%M:%S', new Date())}  açık: ${fmtDuration(bootAgeMs())},  1 kullanıcı`);
    return 0;
  });

  def('history', 'shell', 'Komut geçmişini listeler', 'history [-c] [N]', (ctx) => {
    const { flags: f, rest, error } = parseArgs(ctx.args, { bool: 'c' });
    if (error) return usageErr(ctx, error);
    if (f.c) { if (ctx.host.clearHistory) ctx.host.clearHistory(); return 0; }
    const all = ctx.host.history ? ctx.host.history() : [];
    const n = rest[0] !== undefined ? parseInt(rest[0], 10) : all.length;
    if (!(n >= 0)) return usageErr(ctx, `geçersiz sayı: '${rest[0]}'`);
    const start = Math.max(0, all.length - n);
    const w = Math.max(5, String(all.length).length);
    ctx.write(joinLines(all.slice(start).map((l, i) => `${padL(String(start + i + 1), w)}  ${l}`)));
    return 0;
  }, { options: [['N', 'son N komutu göster'], ['-c', 'geçmişi temizle']], notes: 'Geçmiş en fazla 200 komut saklar; ↑ ve ↓ ile gezebilirsiniz.' });

  def('clear', 'shell', 'Ekranı temizler (Ctrl+L)', 'clear', (ctx) => {
    if (ctx.host.clear) ctx.host.clear(); else ctx.write('\x1b[2J\x1b[H');
    return 0;
  });

  def('exit', 'shell', 'Terminal penceresini kapatır', 'exit', (ctx) => {
    ctx.shell.exited = true;
    if (ctx.host.exit) ctx.host.exit();
    return 0;
  });

  def('open', 'system', 'Dosya, klasör ya da uygulama açar', 'open <yol|uygulama>...', (ctx) => {
    if (!ctx.args.length) return usageErr(ctx, 'ne açılacağını belirtin (yol ya da uygulama kimliği)');
    let status = 0;
    for (const arg of ctx.args) {
      const abs = ctx.resolve(arg);
      if (ctx.fs.exists(abs)) {
        const w = ctx.host.openFile ? ctx.host.openFile(abs) : P.apps.openFile(abs);
        if (!w) status = 1;
      } else if (P.apps && P.apps.get(arg)) {
        const w = ctx.host.launch ? ctx.host.launch(arg, {}) : P.apps.launch(arg, {});
        if (!w) status = 1;
      } else {
        ctx.error(`open: '${arg}': Böyle bir dosya, dizin ya da uygulama yok`);
        status = 1;
      }
    }
    return status;
  }, {
    examples: [['open Notlar.txt', 'uygun uygulamayla aç'], ['open .', 'bu klasörü Dosyalar\'da aç'], ['open calculator', 'uygulama kimliğiyle başlat']],
    notes: 'Uygulama kimlikleri için: apps'
  });

  def('theme', 'system', 'Temayı gösterir ya da değiştirir', 'theme [light|dark|auto]', (ctx) => {
    const T = P.theme;
    if (!T) { ctx.error('theme: tema yöneticisi kullanılamıyor'); return 1; }
    const arg = ctx.args[0];
    const names = { dark: 'koyu', light: 'açık', auto: 'otomatik' };
    if (arg === undefined) {
      const mode = T.mode();
      ctx.writeln(`Tema: ${T.get() === 'dark' ? 'Koyu' : 'Açık'}${mode === 'auto' ? ' (otomatik)' : ''}`);
      return 0;
    }
    const map = Object.assign(Object.create(null), { light: 'light', dark: 'dark', auto: 'auto', açık: 'light', acik: 'light', koyu: 'dark', otomatik: 'auto' });
    const mode = map[String(arg).toLocaleLowerCase('tr')];
    if (!mode) return usageErr(ctx, `geçersiz değer '${arg}' — light, dark ya da auto kullanın`);
    T.set(mode);
    ctx.writeln(`Tema ${names[mode]} olarak ayarlandı.`);
    return 0;
  }, { examples: [['theme'], ['theme light'], ['theme dark'], ['theme auto', 'sistem temasını izle']] });

  const winPid = (w) => String(w.id).replace(/^win-/, '');

  def('ps', 'system', 'Açık pencereleri (süreçleri) listeler', 'ps', (ctx) => {
    const wins = P.wm ? P.wm.list().slice().sort((a, b) => Number(winPid(a)) - Number(winPid(b))) : [];
    if (!wins.length) { ctx.writeln('Açık pencere yok.'); return 0; }
    const rows = [['PID', 'UYGULAMA', 'BAŞLIK', 'DURUM']];
    for (const w of wins) {
      const state = w.isMinimized() ? 'küçültülmüş' : w.isFocused() ? 'odakta' : 'çalışıyor';
      rows.push([winPid(w), w.appId, w.getTitle(), state]);
    }
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => vlen(r[i]))));
    const lines = rows.map((r, ri) => {
      const text = r.map((c, i) => (i === 3 ? c : padR(c, widths[i]))).join('  ');
      return ri === 0 ? ctx.paint(text, '1') : text;
    });
    ctx.write(lines.join('\n') + '\n');
    return 0;
  }, { notes: 'PID, pencere kimliğinin sayısıdır. Sonlandırmak için: kill <PID>' });

  def('kill', 'system', 'Bir pencereyi (uygulamayı) sonlandırır', 'kill [-9] <PID>...', (ctx) => {
    const { rest, error } = parseArgs(ctx.args, { bool: '123456789' });
    if (error) return usageErr(ctx, error);
    if (!rest.length) return usageErr(ctx, 'kullanım: kill <PID> (PID için: ps)');
    let status = 0;
    for (const arg of rest) {
      const id = /^win-/.test(arg) ? arg : `win-${arg}`;
      const w = P.wm && P.wm.get(id);
      if (!w || w.isClosed()) { ctx.error(`kill: (${arg}): Böyle bir işlem yok`); status = 1; continue; }
      w.forceClose();
    }
    return status;
  }, { examples: [['ps'], ['kill 3']] });

  def('apps', 'system', 'Yüklü uygulamaları listeler', 'apps', (ctx) => {
    const list = P.apps.list();
    const rows = [['KİMLİK', 'AD', 'KATEGORİ', 'AÇIKLAMA']].concat(list.map((a) => [a.id, a.name, CATEGORY_TR[a.category] || a.category || '', a.description || '']));
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => vlen(r[i]))));
    const lines = rows.map((r, ri) => {
      const text = r.map((c, i) => (i === 3 ? c : padR(c, widths[i]))).join('  ').replace(/\s+$/, '');
      return ri === 0 ? ctx.paint(text, '1') : text;
    });
    lines.push('', `${list.length} uygulama yüklü. Başlatmak için: open <kimlik>`);
    ctx.write(lines.join('\n') + '\n');
    return 0;
  });

  def('notify', 'system', 'Bildirim gönderir', 'notify [-t başlık] <mesaj>', (ctx) => {
    let args = ctx.args.slice();
    let title = 'Terminal';
    if ((args[0] === '-t' || args[0] === '--title') && args.length >= 2) { title = args[1]; args = args.slice(2); }
    const message = args.join(' ').trim();
    if (!message) return usageErr(ctx, 'mesaj boş — kullanım: notify [-t başlık] <mesaj>');
    if (typeof P.notify !== 'function') { ctx.error('notify: bildirim sistemi kullanılamıyor'); return 1; }
    P.notify({ title, message, icon: 'terminal', timeout: 5000 });
    return 0;
  }, { rawArgs: true, examples: [['notify Kahve molası!'], ['notify -t Hatırlatma "Toplantı 15:00"']] });

  def('trash', 'system', 'Çöp kutusunu listeler, geri yükler, boşaltır', 'trash [restore <n|hepsi> | rm <n> | empty -y]', (ctx) => {
    const sub = ctx.args[0];
    const list = ctx.fs.listTrash();
    if (!sub || sub === 'list' || sub === 'ls') {
      if (!list.length) { ctx.writeln('Çöp kutusu boş.'); return 0; }
      const rows = [['#', 'AD', 'ESKİ KONUM', 'SİLİNME', 'BOYUT']].concat(list.map((e, i) => [
        String(i + 1), e.type === 'dir' ? `${e.name}/` : e.name, e.originalPath, fmtLsDate(e.deletedAt), U.formatBytes(e.size)
      ]));
      const w = rows[0].map((_, i) => Math.max(...rows.map((r) => vlen(r[i]))));
      const lines = rows.map((r, ri) => {
        const text = r.map((c, i) => (i === 0 || i === 4 ? padL(c, w[i]) : padR(c, w[i]))).join('  ').replace(/\s+$/, '');
        return ri === 0 ? ctx.paint(text, '1') : text;
      });
      lines.push('', `${list.length} öğe. Geri yüklemek için: trash restore <n>`);
      ctx.write(lines.join('\n') + '\n');
      return 0;
    }
    if (sub === 'restore' || sub === 'rm') {
      const targets = ctx.args.slice(1);
      if (!targets.length) return usageErr(ctx, `kullanım: trash ${sub} <n>${sub === 'restore' ? ' | hepsi' : ''}`);
      let picks;
      if (sub === 'restore' && (targets[0] === 'hepsi' || targets[0] === 'all')) picks = list.slice();
      else {
        picks = [];
        for (const t of targets) {
          const n = parseInt(t, 10);
          if (!/^\d+$/.test(t) || n < 1 || n > list.length) { ctx.error(`trash: '${t}': çöp kutusunda böyle bir öğe yok (1-${list.length})`); return 1; }
          picks.push(list[n - 1]);
        }
      }
      let status = 0;
      for (const e of picks) {
        try {
          if (sub === 'restore') ctx.writeln(`'${e.name}' geri yüklendi: ${ctx.fs.restore(e.id)}`);
          else { ctx.fs.deleteFromTrash(e.id); ctx.writeln(`'${e.name}' kalıcı olarak silindi`); }
        } catch (err) { ctx.error(`trash: '${e.name}': ${fsMsg(err)}`); status = 1; }
      }
      return status;
    }
    if (sub === 'empty') {
      if (!list.length) { ctx.writeln('Çöp kutusu zaten boş.'); return 0; }
      if (!ctx.args.includes('-y') && !ctx.args.includes('--yes')) {
        ctx.error(`trash: çöp kutusunda ${list.length} öğe var. Kalıcı olarak silmek için onaylayın: trash empty -y`);
        return 1;
      }
      ctx.fs.emptyTrash();
      ctx.writeln(`Çöp kutusu boşaltıldı (${list.length} öğe).`);
      return 0;
    }
    return usageErr(ctx, `bilinmeyen alt komut '${sub}' — list, restore, rm ya da empty kullanın`);
  }, {
    options: [['(argümansız) / list', 'çöp kutusundakileri numaralı listele'], ['restore <n...|hepsi>', 'öğeleri eski yerine geri yükle'],
      ['rm <n...>', 'öğeleri kalıcı olarak sil'], ['empty -y', 'çöp kutusunu boşalt (-y onay)']],
    examples: [['rm eski.txt && trash'], ['trash restore 1'], ['trash empty -y']]
  });

  // ---------------------------------------------------------------- komutlar: kabuk ve araçlar
  const SAYINGS = [
    'Bambu büyürken ses çıkarmaz.', 'Acele eden panda, en yumuşak yaprağı kaçırır.', 'Bugünün işini yarına bırakma; bambuyu bırakabilirsin.',
    'Sabırlı panda en taze filizi bulur.', 'Her büyük orman bir fidanla başlar.', 'Önce kaydet, sonra keşfet.',
    'Uykusuz panda hata ayıklayamaz.', 'Küçük adımlar, büyük bambu ormanları yapar.', 'Dosyalarını yedekle, bambunu say.',
    'İyi bir komut, bir kupa çay kadar rahatlatır.'
  ];

  def('fortune', 'fun', 'Rastgele bir panda sözü söyler', 'fortune', (ctx) => {
    ctx.writeln(SAYINGS[Math.floor(Math.random() * SAYINGS.length)]);
    return 0;
  }, { examples: [['fortune | pandasay']] });

  function wrapText(text, width) {
    const out = [];
    for (const raw of String(text).replace(/\t/g, '    ').split('\n')) {
      let line = '';
      for (const word of raw.split(/ +/)) {
        if (!word && !line) continue;
        let w = word;
        while (chars(w).length > width) {
          if (line) { out.push(line); line = ''; }
          out.push(chars(w).slice(0, width).join(''));
          w = chars(w).slice(width).join('');
        }
        if (!line) line = w;
        else if (chars(line).length + 1 + chars(w).length <= width) line += ' ' + w;
        else { out.push(line); line = w; }
      }
      out.push(line);
    }
    while (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out;
  }

  const PANDASAY_ART = String.raw`        \
         \
   .@@@.         .@@@.
  @@@@@@.-------.@@@@@@
   '@@@/         \@@@'
     /  .@@.   .@@.  \
    |   @(o)@ @(o)@   |
    |      .---.      |
     \    (  v  )    /
      '-.  '---'  .-'
         '-.___.-'`.split('\n');

  function speechBubble(text, maxWidth) {
    const lines = wrapText(text, maxWidth);
    const w = Math.max(1, ...lines.map((l) => chars(l).length));
    const top = ` ${'_'.repeat(w + 2)}`;
    const bottom = ` ${'-'.repeat(w + 2)}`;
    let body;
    if (lines.length === 1) body = [`< ${padR(lines[0], w)} >`];
    else {
      body = lines.map((l, i) => {
        const [a, b] = i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
        return `${a} ${padR(l, w)} ${b}`;
      });
    }
    return [top, ...body, bottom];
  }

  def('pandasay', 'fun', 'Panda bir şey söyler (cowsay gibi)', 'pandasay <metin>', (ctx) => {
    let text = ctx.args.join(' ');
    if (!text.trim() && ctx.stdin != null) text = ctx.stdin.replace(/\n+$/, '');
    if (!text.trim()) return usageErr(ctx, 'ne söyleyeceğimi yazın — örn: pandasay Merhaba!');
    const width = Math.max(12, Math.min(40, (ctx.cols || 80) - 8));
    const bubble = speechBubble(text, width);
    const lines = ctx.tty
      ? [...bubble.map((x) => paint(x, '33')), ...PANDASAY_ART.map((x) => paint(x, '97'))]
      : [...bubble, ...PANDASAY_ART];
    ctx.write(lines.join('\n') + '\n');
    return 0;
  }, { rawArgs: true, examples: [['pandasay Merhaba!'], ['fortune | pandasay']] });

  def('calc', 'shell', 'Aritmetik hesaplar (eval kullanmaz)', 'calc <ifade>', (ctx) => {
    let exprs = [];
    const joined = ctx.args.join(' ').trim();
    if (joined) exprs = [joined];
    else if (ctx.stdin != null) exprs = splitLines(ctx.stdin).filter((l) => l.trim());
    if (!exprs.length) return usageErr(ctx, 'ifade eksik — örn: calc 2+3*4');
    let status = 0;
    for (const e of exprs) {
      try { ctx.writeln(fmtCalc(calcEval(e))); } catch (err) {
        if (err instanceof CalcError) { ctx.error(`calc: ${err.message}`); status = 1; } else throw err;
      }
    }
    return status;
  }, {
    rawArgs: true,
    notes: 'Desteklenen: + - * / % ^ ( ) ! ; işlevler: sqrt cbrt abs sin cos tan asin acos atan ln log log2 exp floor ceil round min max pow; sabitler: pi e.\nOndalık için nokta kullanın; sonuç Türkçe biçimlenir (1.234,5). * ve ( ) karakterlerini tırnak içine almayı unutmayın.',
    examples: [['calc 2+3*4'], ['calc "(1+2)*3"'], ['calc sqrt(144)+2^10'], ['calc 100/3']]
  });

  def('sleep', 'shell', 'Belirtilen süre bekler', 'sleep <saniye>', async (ctx) => {
    const secs = parseFloat(ctx.args[0]);
    if (!(secs >= 0)) return usageErr(ctx, 'geçersiz süre');
    await new Promise((resolve) => {
      let done = false;
      let t = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (ctx.signal) ctx.signal.removeEventListener('abort', finish);
        resolve();
      };
      t = setTimeout(finish, Math.min(secs, 600) * 1000);
      if (ctx.signal) {
        if (ctx.signal.aborted) finish(); else ctx.signal.addEventListener('abort', finish);
      }
    });
    return ctx.aborted() ? 130 : 0;
  }, { examples: [['sleep 2 && echo bitti'], ['sleep 30', 'Ctrl+C ile iptal edin']] });

  def('seq', 'shell', 'Sayı dizisi yazdırır', 'seq [başlangıç [artış]] son', (ctx) => {
    const nums = ctx.args.map(Number);
    if (!nums.length || nums.length > 3 || nums.some((n) => !Number.isFinite(n))) return usageErr(ctx, 'geçersiz sayı');
    let first = 1;
    let inc = 1;
    let last;
    if (nums.length === 1) last = nums[0];
    else if (nums.length === 2) [first, last] = nums;
    else [first, inc, last] = nums;
    if (inc === 0) return usageErr(ctx, 'artış sıfır olamaz');
    const dec = Math.max(0, ...ctx.args.map((a) => (String(a).split('.')[1] || '').length));
    const out = [];
    for (let v = first, k = 0; (inc > 0 ? v <= last + 1e-9 : v >= last - 1e-9) && k < 200000; v = first + inc * ++k) {
      out.push(dec ? v.toFixed(dec) : String(v));
    }
    ctx.write(joinLines(out));
    return 0;
  }, { examples: [['seq 5'], ['seq 2 2 10'], ['seq 1000 | tail -3']] });

  def('true', 'shell', 'Hiçbir şey yapmaz, başarılı döner', 'true', () => 0);
  def('false', 'shell', 'Hiçbir şey yapmaz, başarısız döner', 'false', () => 1);

  def('which', 'shell', 'Bir komutun ne olduğunu gösterir', 'which <komut>...', (ctx) => {
    if (!ctx.args.length) return usageErr(ctx, 'komut adı eksik');
    let status = 0;
    for (const a of ctx.args) {
      if (ALIASES[a]) ctx.writeln(`${a}: '${ALIASES[a].join(' ')}' için takma ad`);
      else if (CMD[a]) ctx.writeln(`${a}: kabuk yerleşik komutu`);
      else { ctx.error(`which: '${a}' bulunamadı`); status = 1; }
    }
    return status;
  });

  def('alias', 'shell', 'Takma adları listeler', 'alias', (ctx) => {
    ctx.write(Object.keys(ALIASES).map((k) => `alias ${k}='${ALIASES[k].join(' ')}'`).join('\n') + '\n');
    return 0;
  });

  def('env', 'shell', 'Ortam değişkenlerini listeler', 'env', (ctx) => {
    const all = Object.assign({}, ctx.shell.env, { PWD: ctx.shell.cwd, OLDPWD: ctx.shell.oldpwd });
    ctx.write(Object.keys(all).sort().map((k) => `${k}=${all[k]}`).join('\n') + '\n');
    return 0;
  });
  CMD.printenv = Object.assign({}, CMD.env, { name: 'printenv' });

  def('export', 'shell', 'Ortam değişkeni tanımlar', 'export AD=değer...', (ctx) => {
    if (!ctx.args.length) return CMD.env.run(ctx);
    for (const a of ctx.args) {
      const eq = a.indexOf('=');
      if (eq <= 0) continue;
      const name = a.slice(0, eq);
      if (!NAME_RE.test(name)) { ctx.error(`export: '${a}': geçerli bir değişken adı değil`); return 1; }
      ctx.shell.env[name] = a.slice(eq + 1);
    }
    return 0;
  }, { examples: [['export ADIM=Panda && echo Merhaba $ADIM']] });

  def('unset', 'shell', 'Ortam değişkenini siler', 'unset AD...', (ctx) => {
    for (const a of ctx.args) delete ctx.shell.env[a];
    return 0;
  });

  def('basename', 'text', 'Yolun son bileşenini yazdırır', 'basename yol [sonek]', (ctx) => {
    if (!ctx.args.length) return usageErr(ctx, 'eksik işlenen');
    let b = ctx.args[0].replace(/\/+$/, '').split('/').pop() || '/';
    if (ctx.args[1] && b.endsWith(ctx.args[1]) && b !== ctx.args[1]) b = b.slice(0, -ctx.args[1].length);
    ctx.writeln(b);
    return 0;
  });

  def('dirname', 'text', 'Yolun klasör kısmını yazdırır', 'dirname yol', (ctx) => {
    if (!ctx.args.length) return usageErr(ctx, 'eksik işlenen');
    const p = ctx.args[0].replace(/\/+$/, '');
    const i = p.lastIndexOf('/');
    ctx.writeln(i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i));
    return 0;
  });

  def('sudo', 'fun', 'Yönetici olarak çalıştırmayı dener', 'sudo <komut>', (ctx) => {
    ctx.error(`${ctx.shell.user} kullanıcısı sudoers dosyasında yok. Bu olay bildirilecek. ${PANDA}`);
    return 1;
  }, { rawArgs: true });

  const TRAIN_ART = [
    '       ______________________________________',
    '   ___|  P A N D A   E K S P R E S İ          |__ ',
    '  |   |_____________________________________|   |',
    '  |  [ ]  [ ]  [ ]  [ ]  [ ]  [ ]  [ ]  [ ]  |   |>',
    "  '-(o)-(o)---------------------(o)-(o)-----'-----'"
  ];

  def('sl', 'fun', 'Bambu Ekspresi geçiyor… (Ctrl+C ile durdur)', 'sl', async (ctx) => {
    const width = Math.max(...TRAIN_ART.map((l) => chars(l).length));
    const cols = Math.max(20, ctx.cols || 80);
    if (!ctx.live) {
      ctx.write(TRAIN_ART.join('\n') + '\n');
      return 0;
    }
    for (let x = cols; x >= -width && !ctx.aborted(); x -= 2) {
      const frame = TRAIN_ART.map((l) => {
        if (x >= 0) return (' '.repeat(x) + l).slice(0, cols);
        return chars(l).slice(-x).join('').slice(0, cols);
      });
      ctx.live(frame.join('\n'));
      await sleepMs(34);
    }
    ctx.live(null);
    return ctx.aborted() ? 130 : 0;
  }, { examples: [['sl']] });

  // ---------------------------------------------------------------- help
  def('help', 'shell', 'Komutları listeler; ayrıntı için: help <komut>', 'help [komut]', (ctx) => {
    const target = ctx.args[0];
    if (target) {
      const name = ALIASES[target] ? ALIASES[target][0] : target;
      const d = CMD[name];
      if (!d) { ctx.error(`help: '${target}' adlı bir komut yok`); return 1; }
      const lines = [`${ctx.paint(d.name, '1;32')} — ${d.summary}`, '', `${ctx.paint('Kullanım:', '1')} ${d.usage}`];
      if (d.options.length) {
        const w = Math.max(...d.options.map((o) => vlen(o[0])));
        lines.push('', ctx.paint('Seçenekler:', '1'));
        for (const [flag, desc] of d.options) lines.push(`  ${ctx.paint(padR(flag, w), '36')}  ${desc}`);
      }
      if (d.notes) lines.push('', ...d.notes.split('\n'));
      if (d.examples.length) {
        lines.push('', ctx.paint('Örnekler:', '1'));
        for (const [ex, note] of d.examples) lines.push(`  ${ctx.paint(ex, '33')}${note ? `   # ${note}` : ''}`);
      }
      const als = Object.keys(ALIASES).filter((k) => ALIASES[k][0] === d.name);
      if (als.length) lines.push('', `Takma adlar: ${als.join(', ')}`);
      ctx.write(lines.join('\n') + '\n');
      return 0;
    }
    const names = Object.keys(CMD).filter((k) => k !== 'printenv');
    const nameW = Math.max(...names.map((n) => n.length)) + 2;
    const lines = [
      `${ctx.paint('pandash 1.0', '1;32')} — ${names.length} komut. Ayrıntı için: ${ctx.paint('help <komut>', '36')}`
    ];
    for (const [gid, title] of GROUPS) {
      const inGroup = names.filter((n) => CMD[n].group === gid).sort(U.compareNames);
      if (!inGroup.length) continue;
      lines.push('', ctx.paint(title, '1;33'));
      for (const n of inGroup) lines.push(`  ${ctx.paint(padR(n, nameW), '1;32')}${CMD[n].summary}`);
    }
    lines.push(
      '',
      ctx.paint('Kabuk özellikleri', '1;33'),
      `  ${padR('cmd1 | cmd2', nameW + 8)}çıktıyı sonraki komuta aktarır`,
      `  ${padR('cmd > dosya', nameW + 8)}çıktıyı dosyaya yazar  (>> ekler, < girdi, 2> hatalar)`,
      `  ${padR('a && b ; c || d', nameW + 8)}komutları zincirler`,
      `  ${padR('*.txt  ?  [a-c]', nameW + 8)}joker karakterler; "tırnak", 'tırnak', Beni\\ Oku.txt, ~, $HOME, $?`,
      `  ${padR('$(komut)  $((2+3))', nameW + 8)}komut çıktısı ve aritmetik; !!  !N  !önek geçmişten tekrarlar`,
      '',
      ctx.paint('Klavye', '1;33'),
      `  Tab tamamla (iki kez: aday listesi) · ↑ ↓ geçmiş · Ctrl+C iptal · Ctrl+L temizle · Ctrl+U satırı sil`,
      `  Ctrl+Shift+C kopyala · Ctrl+Shift+V yapıştır · Ctrl + tekerlek ya da Ctrl +/- yazı boyutu`
    );
    const als = Object.keys(ALIASES).map((k) => k).join(' ');
    lines.push('', `Takma adlar: ${als}`);
    ctx.write(lines.join('\n') + '\n');
    return 0;
  }, { examples: [['help'], ['help grep']] });

  // ---------------------------------------------------------------- satır çözümleme: Tab tamamlama + sözdizimi renkleri
  const OP_CHARS = '|&;<>';

  /** Satırı kaba bir taramayla sözcük / işleç parçalarına ayırır (tırnak ve kaçış duyarlı). */
  function scanLine(text) {
    const segs = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (OP_CHARS.includes(ch)) {
        let j = i + 1;
        while (j < n && OP_CHARS.includes(text[j])) j++;
        segs.push({ type: 'op', start: i, end: j, text: text.slice(i, j) });
        i = j;
        continue;
      }
      let j = i;
      let q = null;
      while (j < n) {
        const c = text[j];
        if (q) {
          if (c === '\\' && q === '"' && j + 1 < n) { j += 2; continue; }
          if (c === q) q = null;
          j++;
          continue;
        }
        if (c === '\\') { j += 2; continue; }
        if (c === '"' || c === "'") { q = c; j++; continue; }
        if (c === ' ' || c === '\t' || OP_CHARS.includes(c)) break;
        j++;
      }
      j = Math.min(j, n);
      segs.push({ type: 'word', start: i, end: j, text: text.slice(i, j), open: q });
      i = j;
    }
    return segs;
  }

  /** Ham sözcüğün tırnak/kaçışsız karşılığı. */
  function unquoteWord(raw) {
    let out = '';
    let q = null;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q === "'") { if (c === "'") q = null; else out += c; continue; }
      if (q === '"') {
        if (c === '"') q = null;
        else if (c === '\\' && i + 1 < raw.length && '"\\$`'.includes(raw[i + 1])) out += raw[++i];
        else out += c;
        continue;
      }
      if (c === '\\') { if (i + 1 < raw.length) out += raw[++i]; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      out += c;
    }
    return out;
  }

  const SEPARATOR_OPS = ['|', '||', '&&', ';', '&', ';;'];

  /** Her parçaya rol verir: command | arg | target (yönlendirme hedefi) | sep | redir */
  function assignRoles(segs) {
    let cmdPos = true;
    let redirect = false;
    let cmdName = null;
    let argN = 0;
    for (const s of segs) {
      if (s.type === 'op') {
        if (SEPARATOR_OPS.includes(s.text)) { s.role = 'sep'; cmdPos = true; redirect = false; cmdName = null; argN = 0; } else { s.role = 'redir'; redirect = true; }
      } else if (redirect) {
        s.role = 'target';
        redirect = false;
      } else if (cmdPos) {
        s.role = 'command';
        cmdName = unquoteWord(s.text);
        cmdPos = false;
        argN = 0;
      } else {
        s.role = 'arg';
        s.cmdName = cmdName;
        s.argN = argN++;
      }
    }
    return { cmdPos, redirect, cmdName, argN };
  }

  /** Yazılan satır için karakter başına sözdizimi sınıfı (UTF-16 indisine göre): hc komut, ho seçenek, hs dize, hp işleç. */
  function highlightClasses(text, shell) {
    const cls = new Array(text.length).fill('');
    const segs = scanLine(text);
    assignRoles(segs);
    for (const s of segs) {
      let c = '';
      if (s.role === 'sep' || s.role === 'redir') c = 'hp';
      else if (s.role === 'command') c = shell && shell.hasCommand(unquoteWord(s.text)) ? 'hc' : '';
      else if (/^['"]/.test(s.text) || s.open) c = 'hs';
      else if (s.role === 'arg' && /^-[A-Za-z0-9-]/.test(s.text)) c = 'ho';
      else if (/\$[A-Za-z_?{]/.test(s.text)) c = 'hv';
      if (c) for (let k = s.start; k < s.end; k++) cls[k] = c;
    }
    return cls;
  }

  const commonPrefix = (list, ci) => {
    let p = list[0];
    for (const s of list.slice(1)) {
      let k = 0;
      while (k < p.length && k < s.length && (ci ? p[k].toLocaleLowerCase('tr') === s[k].toLocaleLowerCase('tr') : p[k] === s[k])) k++;
      p = p.slice(0, k);
    }
    return p;
  };

  /** Tamamlanan metni, açık tırnak durumuna göre satıra yazılacak biçime çevirir. */
  function requote(text, open) {
    if (open === '"') return '"' + text.replace(/(["\\$`])/g, '\\$1');
    if (open === "'") return "'" + text.replace(/'/g, "'\\''");
    if (text === '~' || text.startsWith('~/')) {
      const rest = text.slice(2);
      return '~' + (text.length > 1 ? '/' + (rest ? shQuote(rest) : '') : '');
    }
    return shQuote(text);
  }

  /**
   * Tab tamamlama. Dönüş:
   *   { start, end, replacement|null, cands:[{ full, name, dir, label }], unique, common }
   * replacement: [start,end) aralığının yerine yazılacak metin (değişiklik yoksa null).
   */
  function complete(shell, line, caret) {
    caret = caret == null ? line.length : caret;
    const before = line.slice(0, caret);
    const after = line.slice(caret);
    const segs = scanLine(before);
    const last = segs[segs.length - 1];
    let cur;
    if (last && last.type === 'word' && last.end === before.length) { cur = last; segs.pop(); } else cur = { type: 'word', start: before.length, end: before.length, text: '', open: null };
    const info = assignRoles(segs);
    const role = info.redirect ? 'target' : info.cmdPos ? 'command' : 'arg';
    const cmdName = info.cmdName;
    const argN = info.argN;
    const typed = unquoteWord(cur.text);
    const fs = shell.fs;
    let cands = [];
    let ci = false;

    const pick = (names) => {
      let hit = names.filter((n) => n.full.startsWith(typed));
      if (!hit.length) {
        const t = typed.toLocaleLowerCase('tr');
        hit = names.filter((n) => n.full.toLocaleLowerCase('tr').startsWith(t));
        ci = hit.length > 0;
      }
      return hit;
    };

    const wordList = (words) => pick(words.map((w) => ({ full: w, name: w, dir: false, label: w })));
    const aliasHelp = cmdName && (ALIASES[cmdName] ? ALIASES[cmdName][0] : cmdName);

    if (role === 'command' && !typed.includes('/')) {
      cands = wordList(shell.commandNames());
    } else if (role === 'arg' && aliasHelp === 'help' && argN === 0) {
      cands = wordList(Object.keys(CMD).filter((k) => k !== 'printenv').sort(U.compareNames));
    } else if (role === 'arg' && aliasHelp === 'theme' && argN === 0) {
      cands = wordList(['light', 'dark', 'auto']);
    } else if (role === 'arg' && aliasHelp === 'trash' && argN === 0) {
      cands = wordList(['list', 'restore', 'rm', 'empty']);
    } else {
      // yol tamamlama
      if (typed === '~') {
        cands = [{ full: '~/', name: '~/', dir: true, label: '~/' }];
      } else if (typed === '..') {
        cands = [{ full: '../', name: '../', dir: true, label: '../' }];
      } else {
        const slash = typed.lastIndexOf('/');
        const dirPart = slash >= 0 ? typed.slice(0, slash + 1) : '';
        const prefix = slash >= 0 ? typed.slice(slash + 1) : typed;
        const dirsOnly = role === 'arg' && (aliasHelp === 'cd' || aliasHelp === 'rmdir');
        let list = [];
        try { list = fs.list(fs.normalize(dirPart === '' ? '.' : dirPart, shell.cwd), { hidden: prefix.startsWith('.') }); } catch (e) { list = []; }
        const entries = list.filter((st) => !dirsOnly || st.type === 'dir').map((st) => ({
          full: dirPart + st.name + (st.type === 'dir' ? '/' : ''), name: st.name, dir: st.type === 'dir', ext: st.ext, label: st.name + (st.type === 'dir' ? '/' : '')
        }));
        cands = pick(entries);
        // open: uygulama kimlikleri de aday
        if (role === 'arg' && aliasHelp === 'open' && !typed.includes('/') && P.apps && P.apps.list) {
          const ids = P.apps.list().map((a) => a.id).filter((id) => id.startsWith(typed) && !cands.some((c) => c.full === id));
          cands = cands.concat(ids.map((id) => ({ full: id, name: id, dir: false, label: id, app: true })));
        }
      }
    }

    if (!cands.length) return { start: cur.start, end: caret, replacement: null, cands: [], unique: false, common: typed, role };
    const unique = cands.length === 1;
    const common = unique ? cands[0].full : commonPrefix(cands.map((c) => c.full), ci);
    let replacement = null;
    if (unique || common.length > typed.length || (ci && common !== typed)) {
      const trailing = unique && !cands[0].dir ? (/^\s/.test(after) ? '' : ' ') : '';
      const closing = unique && !cands[0].dir && cur.open ? cur.open : '';
      replacement = requote(common, cur.open) + closing + trailing;
      if (replacement === cur.text) replacement = null;
    }
    return { start: cur.start, end: caret, replacement, cands, unique, common, role };
  }

  const shellApi = {
    lex, parse, wordFields, expandWord, expandText, globExpand, globToRegex, calcEval, fmtCalc,
    Shell, createShell: (o) => new Shell(o), complete, scanLine, unquoteWord, highlightClasses, expandHistory,
    ansiToHtml, ansiLineToHtml, stripAnsi, newAnsiState, layoutColumns, strftime, splitLines, joinLines,
    fmtLsDate, fmtDuration, wrapText, speechBubble, pandaArt, parseArgs, shQuote, nameCodes,
    CMD, ALIASES, ParseError, CalcError, GROUPS, MAX_LINES, HIST_MAX
  };

  /**
   * Bash tarzı geçmiş açılımı: !! (son komut), !N, !-N, !önek. Yalnızca tırnak dışında ve sözcük başında.
   * Dönüş: { line, changed } ya da { error }.
   */
  function expandHistory(line, hist) {
    if (!line.includes('!')) return { line, changed: false };
    let out = '';
    let q = null;
    let changed = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q === "'") { out += c; if (c === "'") q = null; continue; }
      if (c === '\\') { out += c + (line[i + 1] || ''); i++; continue; }
      if (c === "'") { q = "'"; out += c; continue; }
      if (c === '"') { q = q === '"' ? null : '"'; out += c; continue; }
      if (c === '!' && q === null && (out === '' || /[\s;|&(]/.test(out[out.length - 1]))) {
        const rest = line.slice(i + 1);
        let m = /^!/.exec(rest);
        let entry;
        if (m) entry = hist[hist.length - 1];
        else if ((m = /^(-?\d+)/.exec(rest))) {
          const n = parseInt(m[1], 10);
          entry = n > 0 ? hist[n - 1] : hist[hist.length + n];
        } else if ((m = /^([^\s!;|&<>()'"=]+)/.exec(rest))) {
          for (let k = hist.length - 1; k >= 0; k--) if (hist[k].startsWith(m[1])) { entry = hist[k]; break; }
        }
        if (m) {
          if (entry === undefined) return { error: `!${m[0]}: olay bulunamadı` };
          out += entry;
          i += m[0].length;
          changed = true;
          continue;
        }
      }
      out += c;
    }
    return { line: out, changed };
  }

  // ---------------------------------------------------------------- arayüz: panolar
  let lastClip = ''; // uygulama içi pano (tarayıcı panosu reddedilirse yedek)

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (e) { /* pano kullanılamıyor */ }
  }

  function copyText(text) {
    lastClip = text;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
        return;
      }
    } catch (e) { /* aşağıdaki yedeğe düş */ }
    legacyCopy(text);
  }

  async function readClipboard() {
    let text = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await Promise.race([navigator.clipboard.readText(), sleepMs(900).then(() => '')]);
      }
    } catch (e) { text = ''; }
    return text || lastClip;
  }

  const clampFont = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? U.clamp(n, FONT_MIN, FONT_MAX) : FONT_DEFAULT;
  };
  const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
  const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

  /** İmleçten önceki sözcüğün başı. */
  function prevWordStart(v, pos) {
    let i = pos;
    while (i > 0 && /\s/.test(v[i - 1])) i--;
    while (i > 0 && !/\s/.test(v[i - 1])) i--;
    return i;
  }
  /** İmleçten sonraki sözcüğün sonu. */
  function nextWordEnd(v, pos) {
    let i = pos;
    while (i < v.length && /\s/.test(v[i])) i++;
    while (i < v.length && !/\s/.test(v[i])) i++;
    return i;
  }

  /** Düz metni (renk sınıfları, seçim ve imleçle) HTML parçalarına çevirir. */
  function lineRuns(text, classes, cursorAt, selA, selB, ghost) {
    let html = '';
    let run = '';
    let runKey = '';
    const flushRun = () => {
      if (run) html += runKey ? `<span class="${runKey}">${escHtml(run)}</span>` : escHtml(run);
      run = '';
    };
    let i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i);
      const len = cp > 0xffff ? 2 : 1;
      const ch = text.slice(i, i + len);
      const c = classes[i] || '';
      const sel = i >= selA && i < selB;
      if (i === cursorAt) {
        flushRun();
        runKey = '';
        html += `<span class="tm-cursor${c ? ' ' + c : ''}${sel ? ' tm-sel' : ''}">${escHtml(ch)}</span>`;
      } else {
        const key = `${c}${sel ? ' tm-sel' : ''}`.trim();
        if (key !== runKey) { flushRun(); runKey = key; }
        run += ch;
      }
      i += len;
    }
    flushRun();
    if (cursorAt === text.length) {
      html += '<span class="tm-cursor tm-eol"></span>';
      if (ghost) html += `<span class="tm-ghost" data-ghost="${escHtml(ghost).replace(/"/g, '&quot;')}"></span>`;
    }
    return html;
  }

  /** Dosya yolunu kabuğa yapıştırmak için biçimler (~ ile kısaltır). */
  function pathForShell(p) {
    if (p === P.fs.HOME) return '~';
    if (p.startsWith(P.fs.HOME + '/')) return '~/' + shQuote(p.slice(P.fs.HOME.length + 1));
    return shQuote(p);
  }

  // ---------------------------------------------------------------- arayüz: pencere
  function launch(win, args) {
    args = args || {};
    const root = win.body;
    root.classList.add('app-terminal');
    let closed = false;
    // olay işleyicilerinden hiçbir zaman hata fırlatma: yakala, günlüğe yaz, uygulamayı ayakta tut
    const guard = (fn) => function guarded(...a) {
      try { return fn.apply(this, a); } catch (e) { console.error('[terminal] olay işleyici hatası', e); return undefined; }
    };
    const listen = (el, type, fn, opts) => el.addEventListener(type, guard(fn), opts);
    const stored = P.storage.get(STATE_KEY, {}) || {};
    let fontSize = clampFont(stored.fontSize);
    root.style.setProperty('--tm-fs', `${fontSize}px`);

    // ---- DOM
    const screen = U.el('div', { class: 'tm-screen selectable', tabindex: '-1', role: 'log', 'aria-label': 'Terminal çıktısı' });
    const linesEl = U.el('div', { class: 'tm-lines' });
    const liveEl = U.el('div', { class: 'tm-line tm-live' });
    liveEl.hidden = true;
    const activeEl = U.el('div', { class: 'tm-line tm-active' });
    const input = U.el('input', {
      class: 'tm-input', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off',
      'aria-label': 'Komut satırı'
    });
    const measureEl = U.el('span', { class: 'tm-measure', 'aria-hidden': 'true', text: '0'.repeat(40) });
    screen.append(linesEl, liveEl, activeEl, input, measureEl);
    root.append(screen);

    // ---- kabuk
    const host = {
      clear: () => clearScreen(),
      exit: () => { win.close(); },
      history: () => loadHistory(),
      clearHistory: () => { P.storage.set(HIST_KEY, []); nav = null; },
      cwdChanged: () => { updateTitle(); if (!closed) renderActive(); },
      openFile: (p) => P.apps.openFile(p),
      launch: (id, a) => P.apps.launch(id, a)
    };
    let startDir = args.cwd ? String(args.cwd) : P.fs.HOME;
    try { if (P.fs.isFile(startDir)) startDir = P.fs.dirname(startDir); } catch (e) { startDir = P.fs.HOME; }
    const shell = new Shell({ cwd: startDir, host });

    let busy = false;
    let controller = null;
    let lastStatus = 0;
    let stick = true;            // en alta yapışık: yeni çıktı geldiğinde otomatik kaydır
    let nav = null;              // geçmişte gezinme: { list, idx, draft }
    let tabState = null;         // art arda Tab için
    let search = null;           // Ctrl+R geçmiş araması: { saved, caret, from, idx, match, lastQuery }
    let pending = '';            // henüz satıra dönüşmemiş çıktı
    let flushTimer = 0;
    let ansiState = newAnsiState();
    const queue = [];            // bekleyen komut satırları: { line, resolve }

    function updateTitle() {
      if (!closed) win.setTitle(`Terminal — ${shell.promptPath()}`);
    }

    // ---- ölçüm
    function measureCols() {
      try {
        const cw = measureEl.getBoundingClientRect().width / 40;
        const cs = getComputedStyle(screen);
        const w = screen.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        const cols = Math.floor(w / cw);
        return Number.isFinite(cols) && cols >= 10 ? cols : 80;
      } catch (e) { return 80; }
    }

    const scrollBottom = () => { screen.scrollTop = screen.scrollHeight; };
    screen.addEventListener('scroll', () => {
      stick = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 12;
    });

    // ---- çıktı
    function trimLines() {
      const extra = linesEl.childElementCount - MAX_LINES;
      if (extra <= 0) return;
      if (extra < 64) {
        for (let k = 0; k < extra; k++) linesEl.firstElementChild.remove();
        return;
      }
      const r = document.createRange();
      r.setStartBefore(linesEl.firstElementChild);
      r.setEndAfter(linesEl.children[extra - 1]);
      r.deleteContents();
    }

    function appendHtml(html) {
      linesEl.insertAdjacentHTML('beforeend', html);
      trimLines();
      if (stick) scrollBottom();
    }

    function appendLines(lines) {
      if (!lines.length) return;
      if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
      appendHtml(lines.map((l) => `<div class="tm-line">${ansiLineToHtml(l, ansiState)}</div>`).join(''));
    }

    function flush() {
      flushTimer = 0;
      const idx = pending.lastIndexOf('\n');
      if (idx < 0) return;
      const chunk = pending.slice(0, idx);
      pending = pending.slice(idx + 1);
      appendLines(chunk.replace(/\r/g, '').split('\n'));
    }

    function flushAll() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
      flush();
      if (pending) {
        const rest = pending;
        pending = '';
        appendLines([rest.replace(/\r/g, '')]);
      }
    }

    function write(text, isErr) {
      if (closed || text == null || text === '') return;
      text = String(text);
      if (isErr) {
        text = text.split('\n').map((l, i, arr) => (i === arr.length - 1 && l === '' ? l : (/^\x1b\[/.test(l) ? l : paint(l, '91')))).join('\n');
      }
      pending += text;
      if (!flushTimer) flushTimer = setTimeout(flush, 8);
    }

    function setLive(frame) {
      if (closed) return;
      if (frame == null) { liveEl.hidden = true; liveEl.textContent = ''; return; }
      liveEl.hidden = false;
      liveEl.textContent = frame;
      if (stick) scrollBottom();
    }

    function clearScreen() {
      pending = '';
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
      linesEl.textContent = '';
      ansiState = newAnsiState();
      stick = true;
    }

    // ---- komut istemi + satır
    function promptHtml() {
      return `<span class="tm-pu">${escHtml(shell.user)}@${escHtml(shell.hostname)}</span><span class="tm-pc">:</span>` +
        `<span class="tm-pp">${escHtml(shell.promptPath())}</span><span class="tm-pd${lastStatus ? ' tm-fail' : ''}">$</span> `;
    }

    function echoPrompt(line, suffix) {
      flushAll();
      const html = promptHtml() + lineRuns(line, highlightClasses(line, shell), -1, 0, 0) + (suffix ? `<span class="tm-hint">${escHtml(suffix)}</span>` : '');
      appendHtml(`<div class="tm-line">${html}</div>`);
    }

    /** Fish tarzı öneri: yazılanla başlayan en yeni geçmiş satırının kalanı (imleç satır sonundaysa). */
    function ghostFor(v, a, b) {
      if (!v || a !== b || a !== v.length || search) return '';
      const h = loadHistory();
      for (let k = h.length - 1; k >= 0; k--) {
        if (h[k].length > v.length && h[k].startsWith(v)) return h[k].slice(v.length);
      }
      return '';
    }

    /** Ctrl+R: geçmişte artımlı arama (sorgu giriş kutusunda tutulur). */
    function renderSearch() {
      const q = input.value;
      if (q !== search.lastQuery) { search.lastQuery = q; search.from = Infinity; }
      const h = loadHistory();
      let idx = -1;
      if (q) for (let k = Math.min(search.from, h.length) - 1; k >= 0; k--) if (h[k].includes(q)) { idx = k; break; }
      search.idx = idx;
      search.match = idx >= 0 ? h[idx] : '';
      let matchHtml = '';
      if (idx >= 0) {
        const m = h[idx];
        const at = m.indexOf(q);
        matchHtml = `${escHtml(m.slice(0, at))}<span class="tm-hit">${escHtml(q)}</span>${escHtml(m.slice(at + q.length))}`;
      }
      const failed = q !== '' && idx < 0;
      activeEl.innerHTML = `<span class="tm-search${failed ? ' tm-fail' : ''}">(${failed ? 'başarısız ' : ''}geçmiş-ara)</span>'` +
        `${lineRuns(q, [], q.length, 0, 0)}': ${matchHtml}`;
    }

    function renderActive() {
      if (closed) return;
      if (search) {
        renderSearch();
      } else {
        const v = input.value;
        const a = U.clamp(input.selectionStart == null ? v.length : input.selectionStart, 0, v.length);
        const b = U.clamp(input.selectionEnd == null ? a : input.selectionEnd, 0, v.length);
        const caret = a !== b && input.selectionDirection === 'backward' ? a : b;
        activeEl.innerHTML = promptHtml() + lineRuns(v, highlightClasses(v, shell), caret, a, b, ghostFor(v, a, b));
      }
      input.style.top = `${activeEl.offsetTop}px`;
      if (stick) scrollBottom();
    }

    function startSearch() {
      search = { saved: input.value, caret: input.selectionStart, from: Infinity, idx: -1, match: '', lastQuery: '' };
      setValue('');
    }

    /** Aramadan çık. accept: bulunan satırı komut satırına al (run: ayrıca çalıştır); aksi halde eski satır geri gelir. */
    function endSearch(accept, run) {
      const s = search;
      search = null;
      tabState = null;
      if (accept && s.match) {
        setValue(s.match);
        if (run) { setValue(''); nav = null; enqueue(s.match); }
      } else setValue(s.saved, s.caret);
    }

    function acceptGhost() {
      const v = input.value;
      const g = ghostFor(v, input.selectionStart, input.selectionEnd);
      if (!g) return false;
      setValue(v + g);
      return true;
    }

    function setValue(v, pos, end) {
      input.value = v;
      const p = pos == null ? v.length : pos;
      try { input.setSelectionRange(p, end == null ? p : end); } catch (e) { /* ignore */ }
      renderActive();
    }

    function editRange(from, to, text) {
      const v = input.value;
      setValue(v.slice(0, from) + text + v.slice(to), from + text.length);
    }

    function insertText(text) {
      const v = input.value;
      const s = input.selectionStart == null ? v.length : input.selectionStart;
      const e = input.selectionEnd == null ? s : input.selectionEnd;
      editRange(s, e, text);
    }

    const focusInput = () => { if (!closed) { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } };

    // ---- geçmiş
    function loadHistory() {
      const h = P.storage.get(HIST_KEY, []);
      return Array.isArray(h) ? h.filter((x) => typeof x === 'string') : [];
    }
    function addHistory(line) {
      const h = loadHistory();
      if (h[h.length - 1] !== line) h.push(line);
      P.storage.set(HIST_KEY, h.slice(-HIST_MAX));
    }
    function histUp() {
      if (!nav) {
        const list = loadHistory();
        if (!list.length) return;
        nav = { list, idx: list.length, draft: input.value };
      }
      if (nav.idx > 0) { nav.idx--; setValue(nav.list[nav.idx]); }
    }
    function histDown() {
      if (!nav) return;
      if (nav.idx < nav.list.length - 1) { nav.idx++; setValue(nav.list[nav.idx]); } else {
        const d = nav.draft;
        nav = null;
        setValue(d);
      }
    }

    // ---- çalıştırma
    function enqueue(line) {
      if (closed) return Promise.resolve(1);
      return new Promise((resolve) => {
        queue.push({ line: String(line), resolve });
        pump();
      });
    }

    async function pump() {
      if (busy || closed) return;
      const item = queue.shift();
      if (!item) return;
      busy = true;
      root.classList.add('tm-busy');
      let status = 1;
      const startedAt = Date.now();
      try {
        status = await execute(item.line);
      } catch (e) {
        console.error('[terminal] komut çalıştırılamadı', e);
        write(`pandash: iç hata: ${(e && e.message) || e}\n`, true);
      }
      busy = false;
      if (!closed) {
        root.classList.remove('tm-busy');
        flushAll();
        updateTitle();
        stick = true;
        renderActive();
        scrollBottom();
        // uzun süren komut başka bir pencere öndeyken bittiyse görev çubuğu düğmesini yanıp söndür
        if (Date.now() - startedAt > 4000 && !win.isFocused() && typeof win.flash === 'function') win.flash();
      }
      item.resolve(status);
      if (!closed) pump();
    }

    async function execute(line) {
      echoPrompt(line);
      if (!line.trim()) return shell.status;
      const ex = expandHistory(line, loadHistory());
      if (ex.error) {
        write(`pandash: ${ex.error}\n`, true);
        flushAll();
        shell.status = 1;
        lastStatus = 1;
        return 1;
      }
      if (ex.changed) {
        write(`${ex.line}\n`);
        line = ex.line;
      }
      addHistory(line);
      controller = new AbortController();
      ansiState = newAnsiState();
      const io = {
        tty: true,
        out: (s) => write(s, false),
        err: (s) => write(s, true),
        cols: measureCols,
        signal: controller.signal,
        live: setLive
      };
      let status;
      try {
        status = await shell.exec(line, io);
      } finally {
        controller = null;
        setLive(null);
      }
      flushAll();
      lastStatus = status === 130 ? lastStatus : status;
      return status;
    }

    function interruptRun() {
      if (controller) controller.abort();
      write('^C\n');
    }

    function cancelLine() {
      echoPrompt(input.value, '^C');
      shell.status = 130;
      nav = null;
      tabState = null;
      setValue('');
      stick = true;
      scrollBottom();
    }

    // ---- Tab tamamlama
    function listCandidates(value, cands) {
      const cells = cands.map((c) => {
        let colored = c.label;
        if (c.dir) colored = paint(c.label, '1;34');
        else if (c.app || c.ext === '.app') colored = paint(c.label, '1;32');
        return { plain: c.label, colored };
      });
      echoPrompt(value);
      write(layoutColumns(cells, measureCols()).join('\n') + '\n');
      flushAll();
      renderActive();
    }

    function doTab() {
      const v = input.value;
      const caret = input.selectionStart == null ? v.length : input.selectionStart;
      const res = complete(shell, v, caret);
      if (!res.cands.length) { tabState = null; return; }
      if (res.replacement != null) {
        editRange(res.start, res.end, res.replacement);
        tabState = res.unique ? null : { value: input.value, caret: input.selectionStart };
        return;
      }
      if (res.unique) return;
      if (tabState && tabState.value === v && tabState.caret === caret) {
        tabState = null;
        listCandidates(v, res.cands);
      } else tabState = { value: v, caret };
    }

    // ---- pano
    function selectedText() {
      try {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && (screen.contains(sel.anchorNode) || screen.contains(sel.focusNode))) {
          const t = sel.toString();
          if (t) return t;
        }
      } catch (e) { /* ignore */ }
      const s = input.selectionStart;
      const e = input.selectionEnd;
      return s != null && e != null && s !== e ? input.value.slice(s, e) : '';
    }

    function doCopy() {
      const t = selectedText();
      if (t) copyText(t);
      focusInput();
      return !!t;
    }

    function pasteText(text) {
      text = String(text).replace(/\r\n?/g, '\n');
      if (text.length > 200000) text = text.slice(0, 200000);
      const parts = text.split('\n');
      insertText(parts[0]);
      if (parts.length === 1) return;
      let buf = input.value;
      for (let i = 1; i < parts.length; i++) {
        enqueue(buf);
        buf = parts[i];
      }
      setValue(buf);
    }

    async function pasteFromClipboard() {
      const text = await readClipboard();
      if (closed) return;
      if (text) pasteText(text);
      else if (typeof P.notify === 'function') P.notify({ title: 'Terminal', message: 'Panoda yapıştırılacak metin yok.', icon: 'terminal', timeout: 3000 });
      focusInput();
    }

    function selectAllOutput() {
      try {
        const r = document.createRange();
        r.selectNodeContents(linesEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) { /* ignore */ }
    }

    function zoom(dir) {
      fontSize = dir === 0 ? FONT_DEFAULT : U.clamp(fontSize + dir, FONT_MIN, FONT_MAX);
      root.style.setProperty('--tm-fs', `${fontSize}px`);
      const st = P.storage.get(STATE_KEY, {}) || {};
      st.fontSize = fontSize;
      P.storage.set(STATE_KEY, st);
      stick = true;
      renderActive();
    }

    // ---- klavye
    const isModifierKey = (k) => k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock' || k === 'AltGraph';

    function onKey(e) {
      if (e.isComposing || e.keyCode === 229 || closed) return;
      const key = e.key;
      if (isModifierKey(key)) return;
      const altGr = e.ctrlKey && e.altKey; // Windows'ta AltGr = Ctrl+Alt: Türkçe Q klavyede [ ] { } @ gibi karakterler bununla yazılır
      const ctrl = (e.ctrlKey || e.metaKey) && !altGr;
      const alt = e.altKey && !altGr;
      const shift = e.shiftKey;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      if (key !== 'Tab') tabState = null;

      // Ctrl+R geçmiş araması
      if (search) {
        if (ctrl && !shift && lower === 'r') { e.preventDefault(); if (search.idx >= 0) search.from = search.idx; renderActive(); return; }
        if (key === 'Enter') { e.preventDefault(); endSearch(true, true); return; }
        if (key === 'Escape' || (ctrl && !shift && (lower === 'g' || lower === 'c'))) { e.preventDefault(); endSearch(false); return; }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab'].includes(key) || (ctrl && !shift && ['a', 'e', 'b', 'f'].includes(lower))) {
          e.preventDefault();
          endSearch(true, false);
          return;
        }
      } else if (ctrl && !shift && !alt && lower === 'r') {
        e.preventDefault();
        startSearch();
        return;
      }

      // kopyala / yapıştır / yazı boyutu / ekran
      if ((ctrl && shift && lower === 'c') || (ctrl && key === 'Insert') || (e.metaKey && lower === 'c')) { e.preventDefault(); doCopy(); return; }
      if ((ctrl && lower === 'v') || (shift && key === 'Insert')) { stick = true; return; } // yapıştırma 'paste' olayında
      if (ctrl && !alt && (key === '=' || key === '+')) { e.preventDefault(); zoom(1); return; }
      if (ctrl && !alt && (key === '-' || key === '_')) { e.preventDefault(); zoom(-1); return; }
      if (ctrl && !alt && key === '0') { e.preventDefault(); zoom(0); return; }
      if (ctrl && !shift && lower === 'l') { e.preventDefault(); clearScreen(); renderActive(); return; }
      if (ctrl && !shift && lower === 'c') {
        e.preventDefault();
        if (selectedText()) { doCopy(); return; }
        if (busy) interruptRun(); else cancelLine();
        return;
      }
      if (key === 'PageUp' || key === 'PageDown') {
        e.preventDefault();
        screen.scrollTop += (key === 'PageUp' ? -1 : 1) * Math.max(40, screen.clientHeight - 40);
        stick = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 12;
        return;
      }
      if (ctrl && key === 'Home') { e.preventDefault(); screen.scrollTop = 0; stick = false; return; }
      if (ctrl && key === 'End') { e.preventDefault(); stick = true; scrollBottom(); return; }

      stick = true;
      scrollBottom();
      const v = input.value;
      const s = input.selectionStart == null ? v.length : input.selectionStart;
      const en = input.selectionEnd == null ? s : input.selectionEnd;
      const hasSel = s !== en;
      const move = (pos) => { e.preventDefault(); setValue(v, U.clamp(pos, 0, v.length)); };

      switch (key) {
        case 'Enter': {
          e.preventDefault();
          const line = v;
          nav = null;
          setValue('', 0);
          enqueue(line);
          return;
        }
        case 'Tab':
          e.preventDefault();
          if (!shift) doTab();
          return;
        case 'ArrowUp': e.preventDefault(); histUp(); return;
        case 'ArrowDown': e.preventDefault(); histDown(); return;
        case 'ArrowLeft':
          if (shift) return;
          if (hasSel && !ctrl && !alt) return move(s);
          return move(ctrl || alt ? prevWordStart(v, s) : (s > 1 && isLow(v.charCodeAt(s - 1)) && isHigh(v.charCodeAt(s - 2)) ? s - 2 : s - 1));
        case 'ArrowRight':
          if (shift) return;
          if (hasSel && !ctrl && !alt) return move(en);
          if (!ctrl && !alt && en === v.length && acceptGhost()) { e.preventDefault(); return undefined; }
          return move(ctrl || alt ? nextWordEnd(v, en) : (isHigh(v.charCodeAt(en)) && isLow(v.charCodeAt(en + 1)) ? en + 2 : en + 1));
        case 'Home':
          if (shift) return;
          return move(0);
        case 'End':
          if (shift) return;
          if (!hasSel && s === v.length && acceptGhost()) { e.preventDefault(); return undefined; }
          return move(v.length);
        case 'Backspace': {
          e.preventDefault();
          if (hasSel) return editRange(s, en, '');
          if (ctrl || alt) return editRange(prevWordStart(v, s), s, '');
          if (s > 0) {
            const from = s > 1 && isLow(v.charCodeAt(s - 1)) && isHigh(v.charCodeAt(s - 2)) ? s - 2 : s - 1;
            editRange(from, s, '');
          }
          return;
        }
        case 'Delete': {
          e.preventDefault();
          if (hasSel) return editRange(s, en, '');
          if (ctrl) return editRange(s, nextWordEnd(v, s), '');
          if (s < v.length) editRange(s, isHigh(v.charCodeAt(s)) && isLow(v.charCodeAt(s + 1)) ? s + 2 : s + 1, '');
          return;
        }
        case 'Escape':
          if (v) { e.preventDefault(); setValue(''); }
          return;
        default:
          break;
      }

      // readline kısayolları
      if (ctrl && !alt && !shift) {
        switch (lower) {
          case 'a': return move(0);
          case 'e':
            if (!hasSel && s === v.length && acceptGhost()) { e.preventDefault(); return undefined; }
            return move(v.length);
          case 'b': return move(s - 1);
          case 'f':
            if (!hasSel && s === v.length && acceptGhost()) { e.preventDefault(); return undefined; }
            return move(s + 1);
          case 'u': e.preventDefault(); return editRange(0, s, '');
          case 'k': e.preventDefault(); return editRange(s, v.length, '');
          case 'w': e.preventDefault(); return editRange(prevWordStart(v, s), s, '');
          case 'p': e.preventDefault(); return histUp();
          case 'n': e.preventDefault(); return histDown();
          case 'd':
            e.preventDefault();
            if (!v) { write('exit\n'); host.exit(); return; }
            if (s < v.length) editRange(s, s + 1, '');
            return;
          default:
            break;
        }
      }
      if (alt && !ctrl && key === 'b') return move(prevWordStart(v, s));
      if (alt && !ctrl && key === 'f') return move(nextWordEnd(v, en));
      // diğer tuşlar (yazdırılabilir karakterler) doğal davranışla input'a düşer
    }

    listen(input, 'keydown', onKey);
    listen(input, 'input', () => { tabState = null; stick = true; renderActive(); });
    listen(input, 'keyup', () => renderActive());
    listen(input, 'select', () => renderActive());
    listen(input, 'focus', () => { root.classList.add('tm-focused'); renderActive(); });
    listen(input, 'blur', () => { root.classList.remove('tm-focused'); renderActive(); });
    listen(input, 'paste', (e) => {
      e.preventDefault();
      const t = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (t) pasteText(t);
    });

    // pencere odağı input dışındayken (örn. çıktıda seçim yapıldıktan sonra)
    const offKey = win.on('keydown', guard((e) => {
      if (closed || e.target === input || e.defaultPrevented) return;
      const key = e.key;
      if (isModifierKey(key)) return;
      const ctrl = (e.ctrlKey || e.metaKey) && !(e.ctrlKey && e.altKey);
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const copyKey = (ctrl && e.shiftKey && lower === 'c') || (ctrl && key === 'Insert') || (ctrl && !e.shiftKey && lower === 'c');
      const sel = selectedText();
      if (copyKey && sel) { e.preventDefault(); copyText(sel); return; }
      if (key === 'PageUp' || key === 'PageDown') { onKey(e); return; }
      focusInput();
      const printable = key.length === 1 && !ctrl && !e.altKey;
      // yazdırılabilir tuşlar ve Ctrl+V doğal davranışla (odak artık giriş kutusunda) işlenir; diğerleri satır düzenleyicisine
      if (!printable && !(ctrl && lower === 'v')) onKey(e);
    }));

    // fare: tıklama odağı input'a verir, ama metin seçimini bozmaz
    listen(screen, 'mouseup', (e) => {
      if (e.button !== 0) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !screen.contains(sel.anchorNode)) focusInput();
    });
    listen(screen, 'wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // bağlam menüsü
    listen(screen, 'contextmenu', (e) => {
      e.preventDefault();
      const hasSel = !!selectedText();
      const items = [
        { label: 'Kopyala', icon: 'copy', shortcut: 'Ctrl+Shift+C', disabled: !hasSel, action: () => { doCopy(); } },
        { label: 'Yapıştır', icon: 'paste', shortcut: 'Ctrl+Shift+V', action: () => { pasteFromClipboard(); } },
        { label: 'Tümünü seç', shortcut: '', action: () => { selectAllOutput(); } },
        { type: 'separator' },
        { label: 'Ekranı temizle', icon: 'refresh', shortcut: 'Ctrl+L', action: () => { clearScreen(); renderActive(); focusInput(); } },
        {
          label: 'Yazı boyutu',
          icon: 'zoom-in',
          submenu: [
            { label: 'Büyüt', icon: 'zoom-in', shortcut: 'Ctrl +', disabled: fontSize >= FONT_MAX, action: () => { zoom(1); focusInput(); } },
            { label: 'Küçült', icon: 'zoom-out', shortcut: 'Ctrl -', disabled: fontSize <= FONT_MIN, action: () => { zoom(-1); focusInput(); } },
            { label: 'Varsayılan', shortcut: 'Ctrl 0', disabled: fontSize === FONT_DEFAULT, action: () => { zoom(0); focusInput(); } }
          ]
        },
        { type: 'separator' },
        { label: 'Komut geçmişini temizle', icon: 'delete', disabled: !loadHistory().length, action: () => { host.clearHistory(); focusInput(); } }
      ];
      if (P.contextMenu) P.contextMenu.show(e, items, { onClose: () => { if (!closed) focusInput(); } });
    });

    // dosya sürükle-bırak: yolu komut satırına ekler
    listen(screen, 'dragover', (e) => {
      const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
      if (types.includes('application/x-pandaos-paths')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    listen(screen, 'drop', (e) => {
      if (!e.dataTransfer) return;
      let paths = [];
      try { paths = JSON.parse(e.dataTransfer.getData('application/x-pandaos-paths') || '[]'); } catch (err) { paths = []; }
      if (!Array.isArray(paths) || !paths.length) return;
      e.preventDefault();
      insertText(paths.filter((p) => typeof p === 'string').map(pathForShell).join(' ') + ' ');
      focusInput();
    });

    const offResize = win.on('resize', guard(() => { if (stick) scrollBottom(); }));
    const offFocus = win.on('focus', guard(() => { if (!closed && !selectedOutputActive()) focusInput(); }));
    function selectedOutputActive() {
      try {
        const sel = window.getSelection();
        return !!(sel && !sel.isCollapsed && screen.contains(sel.anchorNode) && sel.anchorNode !== input);
      } catch (e) { return false; }
    }

    // dosya sistemi dışarıdan değişirse (çalışma klasörü silindi/taşındı) başlığı ve istemi güncel tut
    const offFs = P.bus.on('fs:change', () => {
      if (closed || busy) return;
      shell.fixCwd();
    });

    win.dirty = false;
    win.on('close', () => {
      closed = true;
      try { if (controller) controller.abort(); } catch (e) { /* ignore */ }
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = 0;
      queue.splice(0).forEach((item) => item.resolve(130));
      offKey(); offResize(); offFocus(); offFs();
    });

    // ---- açılış
    const motd = (() => { try { return P.fs.readFile('/etc/motd').replace(/\n+$/, ''); } catch (e) { return ''; } })();
    if (motd) {
      const parts = motd.split('\n');
      let inArt = true;
      write(parts.map((l) => {
        if (!l.trim()) inArt = false;
        return inArt ? paint(l, '92') : l;
      }).join('\n') + '\n');
      write('\n');
    }
    write("Komutların listesi için 'help' yazın.\n");
    flushAll();
    updateTitle();
    renderActive();
    focusInput();

    const api = {
      shell, input, screen, linesEl, activeEl,
      run: enqueue,
      text: () => Array.from(linesEl.children).map((c) => c.textContent).join('\n'),
      lines: () => linesEl.childElementCount,
      clear: () => { clearScreen(); renderActive(); },
      isBusy: () => busy,
      renderActive,
      measureCols,
      zoom,
      fontSize: () => fontSize,
      lastClip: () => lastClip,
      pasteText,
      complete: doTab,
      interrupt: () => { if (busy) interruptRun(); else cancelLine(); }
    };
    win.state.terminal = api;
    win.state.args = args; // kabuk testleri (entegrasyon) başlatma bağımsız değişkenlerini buradan okur

    if (args.command) enqueue(String(args.command));
  }

  P.apps.register({
    id: 'terminal',
    name: 'Terminal',
    icon: 'terminal',
    description: 'Komut satırıyla dosya sistemini ve sistemi yönet',
    category: 'system',
    singleInstance: false,
    fileTypes: [],
    window: { width: 780, height: 500, minWidth: 420, minHeight: 260 },
    launch,
    _shell: shellApi
  });
})();
