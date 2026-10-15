/* PandaOS — Hesap Makinesi (calculator).

   Two layers live in this file:
   1. A pure engine (no DOM): number formatting/parsing, a tokenizer + recursive-descent expression parser (no eval),
      and the `Calc` state machine that implements the Windows-style key behaviour of the Standard (immediate
      execution, left to right) and Scientific (operator precedence, parentheses) modes.
      It is exposed for tests as PandaOS.apps.get('calculator')._engine.
   2. The window UI: display, memory strip, keypad, history panel, keyboard handling.

   Precision: every arithmetic result is "cleaned" (float noise such as 0.1+0.2 collapses to 0.3) and shown with at
   most 15 significant digits; huge / tiny numbers use the exponential form "1,23e+25". */
(function () {
  'use strict';

  const P = window.PandaOS;
  if (!P || !P.apps || typeof P.apps.register !== 'function') return;

  // ===================================================================================================================
  // ENGINE
  // ===================================================================================================================

  const MSG = { div0: 'Sıfıra bölünemez', invalid: 'Geçersiz giriş', overflow: 'Taşma' };

  class CalcError extends Error {
    constructor(code) {
      super(MSG[code] || MSG.invalid);
      this.name = 'CalcError';
      this.code = MSG[code] ? code : 'invalid';
    }
  }

  // ---------------------------------------------------------------- number hygiene
  /** Number of significant digits of a toPrecision() string once trailing zeros are dropped. */
  function sigDigits(s) {
    const mant = s.replace(/^-/, '').split('e')[0].replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
    return mant.length;
  }

  /** Collapses float noise: a value whose 15-digit form is "short" (<= 13 significant digits) snaps to that form. */
  function clean(x) {
    if (!Number.isFinite(x) || x === 0) return x;
    const s = x.toPrecision(15);
    return sigDigits(s) <= 13 ? Number(s) : x;
  }

  /** Validates (NaN -> invalid, Infinity -> overflow) and cleans a computed value. -0 becomes 0. */
  function fix(x) {
    if (Number.isNaN(x)) throw new CalcError('invalid');
    if (!Number.isFinite(x)) throw new CalcError('overflow');
    return x === 0 ? 0 : clean(x);
  }

  // ---------------------------------------------------------------- formatting / parsing (tr-TR)
  const groupInt = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  /** 1234567.891 -> "1.234.567,891"; >= 1e16 or < 1e-6 -> "1,23e+25"; at most 15 significant digits. */
  function formatNumber(x) {
    if (!Number.isFinite(x)) return String(x);
    if (x === 0) return '0';
    const neg = x < 0;
    const a = Math.abs(x);
    let body;
    if (a >= 1e16 || a < 1e-6) {
      const parts = a.toExponential(14).split('e');
      const mant = parts[0].replace(/\.?0+$/, '');
      body = mant.replace('.', ',') + 'e' + parts[1];
    } else {
      const s = Number.isInteger(a) ? String(a) : String(Number(a.toPrecision(15)));
      const bits = s.split('.');
      body = groupInt(bits[0]) + (bits[1] ? ',' + bits[1] : '');
    }
    return (neg ? '-' : '') + body;
  }

  /** Formats the string that is being typed ("-1234.5", "0.", "2.5e+3") for the display. */
  function formatEntry(str) {
    const m = /^(-?)(\d*)(\.?)(\d*)(e[+-]?\d*)?$/.exec(str);
    if (!m) return str;
    return m[1] + groupInt(m[2] || '0') + (m[3] ? ',' + m[4] : '') + (m[5] || '');
  }

  /** Same as formatNumber / formatEntry but without the dot grouping (what Ctrl+C puts on the clipboard). */
  const plain = (text) => text.replace(/\./g, '');

  /** Reads a number written the Turkish way ("1.234,5"), the English way ("1,234.5") or plainly ("3.14"). */
  function parseNumber(text) {
    const s = String(text == null ? '' : text).trim().replace(/[\s ]/g, '').replace(/[−–]/g, '-');
    if (!/^[+-]?[\d.,]+(?:e[+-]?\d+)?$/i.test(s) || !/\d/.test(s)) return null;
    const expMatch = /e[+-]?\d+$/i.exec(s);
    const exp = expMatch ? expMatch[0] : '';
    let body = exp ? s.slice(0, -exp.length) : s;
    let sign = '';
    if (/^[+-]/.test(body)) { sign = body[0] === '-' ? '-' : ''; body = body.slice(1); }
    const commas = (body.match(/,/g) || []).length;
    const dots = (body.match(/\./g) || []).length;
    let norm;
    if (commas && dots) {
      const lastComma = body.lastIndexOf(',');
      const lastDot = body.lastIndexOf('.');
      if (lastComma > lastDot) {
        if (commas !== 1) return null;
        norm = body.replace(/\./g, '').replace(',', '.');
      } else {
        if (dots !== 1) return null;
        norm = body.replace(/,/g, '');
      }
    } else if (commas) {
      if (commas === 1) norm = body.replace(',', '.');
      else if (/^\d{1,3}(,\d{3})+$/.test(body)) norm = body.replace(/,/g, '');
      else return null;
    } else if (dots > 1) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(body)) return null;
      norm = body.replace(/\./g, '');
    } else if (dots === 1) {
      norm = /^[1-9]\d{0,2}\.\d{3}$/.test(body) ? body.replace('.', '') : body;
    } else norm = body;
    const v = Number(sign + norm + exp);
    return Number.isFinite(v) ? v : null;
  }

  // ---------------------------------------------------------------- arithmetic
  function power(a, b) {
    if (a === 0 && b === 0) throw new CalcError('invalid');
    if (a === 0 && b < 0) throw new CalcError('div0');
    if (a < 0 && !Number.isInteger(b)) throw new CalcError('invalid');
    return Math.pow(a, b);
  }

  /** y-th root of x (the "ʸ√x" key: x first, then y). Odd integer roots of negatives are fine. */
  function yroot(x, y) {
    if (y === 0) throw new CalcError('invalid');
    if (x < 0) {
      if (Number.isInteger(y) && Math.abs(y) % 2 === 1) return -Math.pow(-x, 1 / y);
      throw new CalcError('invalid');
    }
    if (x === 0 && y < 0) throw new CalcError('div0');
    return Math.pow(x, 1 / y);
  }

  // Decimal-exact + - × mod: the operands' shortest decimal forms ("9.95", "0.1") are combined as scaled BigInts, so
  // 9,95 − 9,9 is 0,05 and 0,3 mod 0,1 is 0 instead of 0,0499999999999989 / 0,1. Falls back to plain doubles for
  // numbers written with huge exponents.
  const POW10 = (n) => 10n ** BigInt(n);

  function toDecimal(x) {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(x));
    if (!m) return null;
    const frac = m[3] || '';
    let scale = frac.length - (m[4] ? parseInt(m[4], 10) : 0);
    let mant = BigInt(m[2] + frac);
    if (m[1]) mant = -mant;
    if (scale < 0) {
      if (-scale > 40) return null;
      mant *= POW10(-scale);
      scale = 0;
    }
    return scale > 80 ? null : { m: mant, s: scale };
  }

  function fromDecimal(mant, scale) {
    const neg = mant < 0n;
    let digits = (neg ? -mant : mant).toString();
    if (scale > 0) {
      if (digits.length <= scale) digits = '0'.repeat(scale - digits.length + 1) + digits;
      digits = digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale);
    }
    return Number((neg ? '-' : '') + digits);
  }

  /** op(mantissa a, mantissa b) on a common scale, or undefined when a double has to do the job. */
  function decimalOp(a, b, op) {
    const x = toDecimal(a);
    const y = toDecimal(b);
    if (!x || !y) return undefined;
    if (op === 'mul') return fromDecimal(x.m * y.m, x.s + y.s);
    const s = Math.max(x.s, y.s);
    const xm = x.m * POW10(s - x.s);
    const ym = y.m * POW10(s - y.s);
    return fromDecimal(op === 'add' ? xm + ym : op === 'sub' ? xm - ym : xm % ym, s);
  }

  const withDecimal = (op, fallback) => (a, b) => {
    const r = decimalOp(a, b, op);
    return r === undefined ? fallback(a, b) : r;
  };

  const BINARY = {
    '+': withDecimal('add', (a, b) => a + b),
    '-': withDecimal('sub', (a, b) => a - b),
    '*': withDecimal('mul', (a, b) => a * b),
    '/': (a, b) => { if (b === 0) throw new CalcError('div0'); return a / b; },
    '^': power,
    yroot,
    mod: (a, b) => {
      if (b === 0) throw new CalcError('div0');
      const r = decimalOp(a, b, 'mod');
      return r === undefined ? a % b : r;
    }
  };

  function binary(op, a, b) {
    const f = BINARY[op];
    if (!f) throw new CalcError('invalid');
    return fix(f(a, b));
  }

  const OPSYM = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', yroot: 'yroot', mod: 'mod' };

  // ---------------------------------------------------------------- unary functions
  function toRad(x, unit) {
    return unit === 'rad' ? x : unit === 'grad' ? (x * Math.PI) / 200 : (x * Math.PI) / 180;
  }
  function fromRad(r, unit) {
    return unit === 'rad' ? r : unit === 'grad' ? (r * 200) / Math.PI : (r * 180) / Math.PI;
  }
  const snap = (v) => (Math.abs(v) < 1e-15 ? 0 : v);

  function sinCos(kind, x, unit) {
    if (unit === 'deg') {
      const m = ((x % 360) + 360) % 360;
      if (m % 90 === 0) { // exact on the quarter turns: sin(180°) is 0, not 1.2e-16
        const q = m / 90;
        return (kind === 'sin' ? [0, 1, 0, -1] : [1, 0, -1, 0])[q];
      }
    }
    const r = toRad(x, unit);
    return snap(kind === 'sin' ? Math.sin(r) : Math.cos(r));
  }

  function tan(x, unit) {
    if (unit === 'deg') {
      const m = ((x % 360) + 360) % 360;
      if (m % 180 === 90) throw new CalcError('invalid');
      if (m % 180 === 0) return 0;
    }
    const v = Math.tan(toRad(x, unit));
    if (Math.abs(v) > 1e15) throw new CalcError('invalid');
    return snap(v);
  }

  function fact(x) {
    if (!Number.isInteger(x) || x < 0) throw new CalcError('invalid');
    if (x > 170) throw new CalcError('overflow');
    let r = 1n;
    for (let i = 2n, n = BigInt(x); i <= n; i++) r *= i;
    return Number(r);
  }

  const inv = (fn, x, unit) => {
    if (Math.abs(x) > 1) throw new CalcError('invalid');
    return fromRad(fn(x), unit);
  };

  const UNARY = {
    recip: (x) => { if (x === 0) throw new CalcError('div0'); return 1 / x; },
    sqr: (x) => x * x,
    cube: (x) => x * x * x,
    sqrt: (x) => { if (x < 0) throw new CalcError('invalid'); return Math.sqrt(x); },
    cbrt: (x) => Math.cbrt(x),
    abs: (x) => Math.abs(x),
    neg: (x) => -x,
    fact,
    ln: (x) => { if (x <= 0) throw new CalcError('invalid'); return Math.log(x); },
    log: (x) => { if (x <= 0) throw new CalcError('invalid'); return Math.log10(x); },
    ex: (x) => Math.exp(x),
    p10: (x) => Math.pow(10, x),
    p2: (x) => Math.pow(2, x),
    floor: (x) => Math.floor(x),
    ceil: (x) => Math.ceil(x),
    sin: (x, o) => sinCos('sin', x, o.angle),
    cos: (x, o) => sinCos('cos', x, o.angle),
    tan: (x, o) => tan(x, o.angle),
    asin: (x, o) => inv(Math.asin, x, o.angle),
    acos: (x, o) => inv(Math.acos, x, o.angle),
    atan: (x, o) => fromRad(Math.atan(x), o.angle),
    sinh: (x) => Math.sinh(x),
    cosh: (x) => Math.cosh(x),
    tanh: (x) => Math.tanh(x)
  };

  /** Applies a named function; opts.angle is 'deg' (default) | 'rad' | 'grad'. */
  function unary(name, x, opts) {
    const f = UNARY[name];
    if (!f) throw new CalcError('invalid');
    const o = Object.assign({}, opts);
    if (o.angle !== 'rad' && o.angle !== 'grad') o.angle = 'deg';
    return fix(f(x, o));
  }

  /** Text used for a function result in the expression line: sin(30), √(9), 1/(4) ... */
  const LABEL = {
    recip: '1/', sqr: 'sqr', cube: 'küp', sqrt: '√', cbrt: '∛', abs: 'abs', neg: 'neg', fact: 'fakt',
    ln: 'ln', log: 'log', ex: 'e^', p10: '10^', p2: '2^', floor: 'taban', ceil: 'tavan',
    sin: 'sin', cos: 'cos', tan: 'tan', asin: 'sin⁻¹', acos: 'cos⁻¹', atan: 'tan⁻¹',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh'
  };

  // ---------------------------------------------------------------- tokenizer + recursive-descent parser
  // Token shapes: {t:'n', v, c?} number (c: it came from a constant), {t:'o', v} binary operator, {t:'f', v} function,
  // {t:'('} {t:')'} {t:'!'}. The UI keeps the same shapes (plus an `s` display text on numbers).
  const FUNC_NAMES = {
    sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', sinh: 'sinh', cosh: 'cosh',
    tanh: 'tanh', ln: 'ln', log: 'log', exp: 'ex', sqrt: 'sqrt', cbrt: 'cbrt', abs: 'abs', fact: 'fact',
    floor: 'floor', ceil: 'ceil'
  };

  function tokenize(src) {
    const s = String(src == null ? '' : src);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      const rest = s.slice(i);
      let m = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?/.exec(rest);
      if (m) {
        const v = Number(m[0].replace(',', '.'));
        if (!Number.isFinite(v)) throw new CalcError('invalid');
        out.push({ t: 'n', v });
        i += m[0].length;
        continue;
      }
      m = /^[a-zA-ZçğıöşüÇĞİÖŞÜ]+/.exec(rest);
      if (m) {
        const w = m[0].toLowerCase();
        if (w === 'pi') out.push({ t: 'n', v: Math.PI, c: true });
        else if (w === 'e') out.push({ t: 'n', v: Math.E, c: true });
        else if (w === 'mod') out.push({ t: 'o', v: 'mod' });
        else if (w === 'yroot') out.push({ t: 'o', v: 'yroot' });
        else if (Object.prototype.hasOwnProperty.call(FUNC_NAMES, w)) out.push({ t: 'f', v: FUNC_NAMES[w] });
        else throw new CalcError('invalid');
        i += m[0].length;
        continue;
      }
      i++;
      switch (ch) {
        case '+': out.push({ t: 'o', v: '+' }); break;
        case '-': case '−': case '–': out.push({ t: 'o', v: '-' }); break;
        case '*': case '×': case '·': out.push({ t: 'o', v: '*' }); break;
        case '/': case '÷': out.push({ t: 'o', v: '/' }); break;
        case '^': out.push({ t: 'o', v: '^' }); break;
        case '%': out.push({ t: 'o', v: 'mod' }); break;
        case '(': out.push({ t: '(' }); break;
        case ')': out.push({ t: ')' }); break;
        case '!': out.push({ t: '!' }); break;
        case 'π': out.push({ t: 'n', v: Math.PI, c: true }); break;
        case '√': out.push({ t: 'f', v: 'sqrt' }); break;
        case '∛': out.push({ t: 'f', v: 'cbrt' }); break;
        default: throw new CalcError('invalid');
      }
    }
    return out;
  }

  /** Evaluates a token list. Precedence (low -> high): + -  |  * / mod  |  unary minus  |  ^ yroot (right assoc.)  |  ! */
  function evalTokens(tokens, opts) {
    let p = 0;
    let depth = 0;
    const peek = () => tokens[p];
    const isOp = (t, list) => !!t && t.t === 'o' && list.indexOf(t.v) >= 0;
    const enter = () => { if (++depth > 200) throw new CalcError('invalid'); };

    function expr() {
      let v = term();
      for (;;) {
        const t = peek();
        if (!isOp(t, ['+', '-'])) return v;
        p++;
        v = binary(t.v, v, term());
      }
    }
    function startsFactor(t) {
      return !!t && (t.t === '(' || t.t === 'f' || (t.t === 'n' && t.c));
    }
    function term() {
      let v = unaryExpr();
      for (;;) {
        const t = peek();
        if (isOp(t, ['*', '/', 'mod'])) {
          p++;
          v = binary(t.v, v, unaryExpr());
        } else if (startsFactor(t)) { // 2π, 3(4+1), 2sin(30)
          v = binary('*', v, unaryExpr());
        } else return v;
      }
    }
    function unaryExpr() {
      const t = peek();
      if (isOp(t, ['+', '-'])) {
        p++;
        enter();
        const v = unaryExpr();
        depth--;
        return t.v === '-' ? -v : v;
      }
      return powerExpr();
    }
    function powerExpr() {
      const base = postfix();
      const t = peek();
      if (isOp(t, ['^', 'yroot'])) {
        p++;
        enter();
        const e = unaryExpr();
        depth--;
        return binary(t.v, base, e);
      }
      return base;
    }
    function postfix() {
      let v = primary();
      while (peek() && peek().t === '!') { p++; v = unary('fact', v); }
      return v;
    }
    function closeParen() {
      if (peek() && peek().t === ')') p++;
      else if (p < tokens.length) throw new CalcError('invalid'); // a missing ")" at the very end is tolerated
    }
    function primary() {
      const t = tokens[p++];
      if (!t) throw new CalcError('invalid');
      if (t.t === 'n') return t.v;
      if (t.t === '(') {
        enter();
        const v = expr();
        depth--;
        closeParen();
        return v;
      }
      if (t.t === 'f') {
        let arg;
        if (peek() && peek().t === '(') {
          p++;
          enter();
          arg = expr();
          depth--;
          closeParen();
        } else arg = postfix(); // √9
        return unary(t.v, arg, opts);
      }
      throw new CalcError('invalid');
    }

    if (!tokens || !tokens.length) throw new CalcError('invalid');
    let v;
    try {
      v = expr();
    } catch (e) {
      if (e instanceof RangeError) throw new CalcError('invalid');
      throw e;
    }
    if (p < tokens.length) throw new CalcError('invalid');
    return fix(v);
  }

  /** evaluate("2+3*4") -> 14. Throws CalcError. Accepts × ÷ − π √ , as decimal comma, % as mod, implicit 2π. */
  function evaluate(src, opts) {
    return evalTokens(tokenize(src), opts);
  }

  // ---------------------------------------------------------------- the calculator state machine
  const DIGITS = '0123456789'.split('');
  const OPKEY = { add: '+', sub: '-', mul: '*', div: '/', pow: '^', yroot: 'yroot', mod: 'mod' };
  const MAX_DIGITS = 16;
  const digitsOf = (x) => x.replace(/^-/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  /** True when the typed text survives a trip through a double (9999999999999999 does not: it becomes 1e16). */
  const holdsExactly = (str) => {
    const back = String(Number(str));
    return back.indexOf('e') >= 0 || digitsOf(back) === digitsOf(str);
  };

  const typing = (str) => {
    const v = parseFloat(str);
    return { kind: 'typing', str, val: Number.isFinite(v) && v !== 0 ? v : 0, label: null, pristine: false };
  };
  const valueEntry = (val, label, pristine) => ({
    kind: 'value', str: null, val, label: label == null ? null : label, pristine: !!pristine
  });

  function tokensText(tokens) {
    let s = '';
    for (const t of tokens) {
      if (t.t === 'n') s += t.s != null ? t.s : formatNumber(t.v);
      else if (t.t === 'o') s += ' ' + OPSYM[t.v] + ' ';
      else s += t.t;
    }
    return s;
  }
  const openDepth = (tokens) => tokens.reduce((n, t) => n + (t.t === '(' ? 1 : t.t === ')' ? -1 : 0), 0);

  /**
   * One calculator. Drive it with press(key); read display / expression / error.
   * Keys: '0'..'9' dec neg add sub mul div pow yroot mod eq pct ce c back lp rp expo pi e mc mr mp mm ms
   *       and every function name of UNARY (recip sqr sqrt cube cbrt abs fact ln log ex p10 p2 floor sin cos tan ...).
   */
  class Calc {
    constructor(opts) {
      const o = opts || {};
      this.mode = o.mode === 'sci' ? 'sci' : 'std';
      this.angle = o.angle === 'rad' || o.angle === 'grad' ? o.angle : 'deg';
      this.memory = typeof o.memory === 'number' && Number.isFinite(o.memory) ? o.memory : null;
      this.onEval = null; // (expressionText, value) after every "="
      this.reset();
    }

    /** C: everything but the memory. */
    reset() {
      this.error = null;
      this.entry = typing('0');
      this.acc = null;        // standard mode: running value
      this.pending = null;    // standard mode: operator waiting for its second operand
      this.chain = '';        // standard mode: text of the finished part, "12 + 3 ×"
      this.tokens = [];       // scientific mode: expression built so far
      this.doneExpr = null;   // "12 × 3 =" after an evaluation
      this.lastRepeat = null; // {op, operand} repeated by "="
    }

    setMode(mode) {
      mode = mode === 'sci' ? 'sci' : 'std';
      if (mode === this.mode) return;
      const keep = this.error ? null : this.entry.val;
      this.mode = mode;
      this.reset();
      if (keep) this.entry = valueEntry(keep, null, true);
    }

    setAngle(angle) {
      this.angle = angle === 'rad' || angle === 'grad' ? angle : 'deg';
    }

    // ---- read side
    get display() {
      if (this.error) return this.error;
      const e = this.entry;
      return e.kind === 'typing' ? formatEntry(e.str) : formatNumber(e.val);
    }
    get copyText() {
      // "12," and "2e+" are unfinished input: copy the part that is a number
      return this.error ? '' : plain(this.display).replace(/e[+-]?$/, '').replace(/,$/, '');
    }
    get value() {
      return this.error ? NaN : this.entry.val;
    }
    get expression() {
      if (this.doneExpr) return this.doneExpr;
      const label = this.entry.label;
      if (this.mode === 'std') return (this.chain + (label != null ? ' ' + label : '')).trim();
      return (tokensText(this.tokens) + (label != null ? label : '')).trim();
    }
    get openParens() {
      return this.mode === 'sci' ? Math.max(0, openDepth(this.tokens)) : 0;
    }

    // ---- input
    press(key) {
      try {
        if (this.error) {
          const cleared = key === 'c' || key === 'ce';
          this.reset();
          if (cleared) return;
          if (!(DIGITS.indexOf(key) >= 0 || key === 'dec' || key === 'pi' || key === 'e' || key === 'lp' || key === 'mr')) return;
        }
        this._dispatch(key);
      } catch (err) {
        this._fail(err);
      }
    }

    /** Types a string the way the keyboard would: Calc.type('12*3='). */
    type(text) {
      for (const ch of String(text)) {
        const k = keyForChar(ch, this.mode);
        if (k) this.press(k);
      }
      return this;
    }

    /** Puts a number on the display as if it had been entered (paste, history restore, memory recall). */
    enterNumber(value, label) {
      if (this.error) this.reset();
      this.doneExpr = null;
      this.entry = valueEntry(value, label, false);
    }

    /** Clicking a history entry: show its result; the next operator continues from it. */
    restore(value, exprText) {
      if (this.error) this.reset();
      const busy = this.mode === 'std' ? !!this.pending : this.tokens.length > 0;
      this.entry = valueEntry(value, null, !busy);
      this.doneExpr = busy ? null : exprText ? exprText + ' =' : null;
    }

    // ---- internals
    _fail(err) {
      const code = err instanceof CalcError ? err.code : 'invalid';
      const text = this.expression;
      this.error = MSG[code];
      this.doneExpr = text || null;
    }

    _operandText() {
      const e = this.entry;
      return e.label != null ? e.label : formatNumber(e.val);
    }

    _dispatch(key) {
      switch (key) {
        case 'dec': return this._dec();
        case 'neg': return this._neg();
        case 'add': case 'sub': case 'mul': case 'div': case 'pow': case 'yroot': case 'mod':
          return this._op(OPKEY[key]);
        case 'eq': return this._eq();
        case 'pct': return this._pct();
        case 'ce':
          if (this.doneExpr) this.reset();
          else this.entry = typing('0');
          return undefined;
        case 'c': return this.reset();
        case 'back': return this._back();
        case 'lp': return this._lp();
        case 'rp': return this._rp();
        case 'expo': return this._expo();
        case 'pi': return this._constant(Math.PI);
        case 'e': return this._constant(Math.E);
        case 'mc': this.memory = null; return undefined;
        case 'mr':
          if (this.memory !== null) { this.doneExpr = null; this.entry = valueEntry(this.memory, null, false); }
          return undefined;
        case 'mp': return this._memAdd(1);
        case 'mm': return this._memAdd(-1);
        case 'ms':
          this.memory = fix(this.entry.val);
          return this._settle();
        default:
          if (DIGITS.indexOf(key) >= 0) return this._digit(key);
          if (Object.prototype.hasOwnProperty.call(UNARY, key)) return this._unary(key);
          return undefined;
      }
    }

    _settle() { // after a memory store the typed number is final: the next digit starts a new one
      const e = this.entry;
      if (e.kind === 'typing') this.entry = valueEntry(e.val, null, false);
    }

    _memAdd(sign) {
      this.memory = fix(BINARY['+'](this.memory === null ? 0 : this.memory, sign * this.entry.val));
      this._settle();
    }

    _constant(v) {
      this.doneExpr = null;
      this.entry = valueEntry(v, null, false);
    }

    _digit(d) {
      this.doneExpr = null;
      const e = this.entry;
      if (e.kind !== 'typing') { this.entry = typing(d); return; }
      let s = e.str;
      const ei = s.indexOf('e');
      if (ei >= 0) {
        if (s.length - ei - 2 >= 3) return;
        s += d;
      } else if (s === '0') s = d;
      else if (s === '-0') s = '-' + d;
      else if (s.replace('-', '').replace(/^0(?=\.)/, '').replace(/[^0-9]/g, '').length < MAX_DIGITS && holdsExactly(s + d)) s += d;
      else return;
      this.entry = typing(s);
    }

    _dec() {
      this.doneExpr = null;
      const e = this.entry;
      if (e.kind !== 'typing') { this.entry = typing('0.'); return; }
      if (/[.e]/.test(e.str)) return;
      this.entry = typing(e.str + '.');
    }

    _back() {
      const e = this.entry;
      if (e.kind !== 'typing') return;
      let s = e.str;
      s = /e[+-]$/.test(s) ? s.slice(0, -2) : s.slice(0, -1);
      if (s === '' || s === '-' || s === '-0') s = '0';
      this.entry = typing(s);
    }

    _expo() { // scientific notation entry: 2 EXP 3 -> 2e+3
      this.doneExpr = null;
      const e = this.entry;
      if (e.kind === 'typing') {
        if (e.str.indexOf('e') < 0) this.entry = typing(e.str.replace(/\.$/, '') + 'e+');
        return;
      }
      const s = String(e.val);
      if (s.indexOf('e') < 0) this.entry = typing(s + 'e+');
    }

    _neg() {
      const e = this.entry;
      if (e.kind !== 'typing') { this._unary('neg'); return; }
      let s = e.str;
      if (s.indexOf('e') >= 0) s = s.replace(/e([+-])/, (m, g) => 'e' + (g === '+' ? '-' : '+'));
      else if (s === '0') return;
      else s = s[0] === '-' ? s.slice(1) : '-' + s;
      this.entry = typing(s);
    }

    _unary(name) {
      const e = this.entry;
      let arg = e.label != null ? e.label : formatNumber(e.val);
      let cut = null;
      if (this.mode === 'sci' && e.pristine && e.group !== undefined) { // the key applies to the closed group "(2+3)"
        arg = tokensText(this.tokens.slice(e.group)).slice(1, -1); // sqr((2 + 3)) reads better as sqr(2 + 3)
        cut = e.group;
      }
      const text = LABEL[name] + '(' + arg + ')';
      this.doneExpr = null;
      let y;
      try {
        y = unary(name, e.val, { angle: this.angle });
      } catch (err) {
        if (cut !== null) this.tokens.length = cut;
        this.entry = valueEntry(e.val, text, false);
        throw err;
      }
      if (cut !== null) this.tokens.length = cut;
      this.entry = valueEntry(y, text, false);
    }

    _pct() { // Windows: a + b% -> a + (a*b/100); a × b% -> a × (b/100)
      this.doneExpr = null;
      const e = this.entry;
      if (this.mode === 'std' && this.pending) {
        const r = this.pending === '+' || this.pending === '-' ? fix((this.acc * e.val) / 100) : fix(e.val / 100);
        this.entry = valueEntry(r, formatNumber(r), false);
      } else {
        this.entry = valueEntry(0, '0', false);
      }
    }

    _op(op) {
      this.doneExpr = null;
      if (this.mode === 'sci') return this._opSci(op);
      const e = this.entry;
      const sym = OPSYM[op];
      if (this.pending && e.pristine) { // operator changed before a second operand was entered
        this.pending = op;
        this.chain = this.chain.replace(/\S+$/, sym);
        return undefined;
      }
      const text = this._operandText();
      if (this.pending) {
        let acc;
        try {
          acc = binary(this.pending, this.acc, e.val);
        } catch (err) {
          this.doneExpr = this.chain + ' ' + text + ' ' + sym;
          throw err;
        }
        this.acc = acc;
        this.chain += ' ' + text + ' ' + sym;
      } else {
        this.acc = e.val;
        this.chain = text + ' ' + sym;
      }
      this.pending = op;
      this.entry = valueEntry(this.acc, null, true);
      return undefined;
    }

    // ---- scientific mode: build a token list, evaluate it with precedence on "="
    _pushOperand() {
      const last = this.tokens[this.tokens.length - 1];
      const e = this.entry;
      if (last && last.t === ')') {
        if (e.pristine) return; // the closed group already is the operand
        this.tokens.push({ t: 'o', v: '*' }); // "(2+3)4" means (2+3)×4
      }
      this.tokens.push({ t: 'n', v: e.val, s: this._operandText() });
    }

    _opSci(op) {
      const last = this.tokens[this.tokens.length - 1];
      const e = this.entry;
      if (last && last.t === 'o' && e.pristine) { last.v = op; return; }
      this._pushOperand();
      this.tokens.push({ t: 'o', v: op });
      this.entry = valueEntry(e.val, null, true);
    }

    _lp() {
      if (this.mode !== 'sci') return;
      this.doneExpr = null;
      const last = this.tokens[this.tokens.length - 1];
      const e = this.entry;
      const atOperand = !last || last.t === 'o' || last.t === '(';
      const blank = e.kind === 'typing' && e.str === '0';
      if (!atOperand) {
        if (!e.pristine) this._pushOperand();
        this.tokens.push({ t: 'o', v: '*' });
      } else if (!e.pristine && !blank) {
        this._pushOperand();
        this.tokens.push({ t: 'o', v: '*' });
      }
      this.tokens.push({ t: '(' });
      this.entry = typing('0');
    }

    _rp() {
      if (this.mode !== 'sci' || openDepth(this.tokens) <= 0) return;
      this.doneExpr = null;
      this._pushOperand();
      this.tokens.push({ t: ')' });
      let depth = 0;
      let start = -1;
      for (let i = this.tokens.length - 1; i >= 0; i--) {
        const t = this.tokens[i];
        if (t.t === ')') depth++;
        else if (t.t === '(' && --depth === 0) { start = i; break; }
      }
      const v = evalTokens(this.tokens.slice(start + 1, -1), { angle: this.angle });
      this.entry = valueEntry(v, null, true);
      this.entry.group = start;
    }

    _finish(exprText, value) {
      this.doneExpr = exprText + ' =';
      this.entry = valueEntry(value, null, true);
      if (typeof this.onEval === 'function') {
        try { this.onEval(exprText, value); } catch (_) { /* a listener must never break the calculator */ }
      }
    }

    _eq() {
      const e = this.entry;
      if (this.mode === 'std' && this.pending) {
        const text = this.chain + ' ' + this._operandText();
        let r;
        try {
          r = binary(this.pending, this.acc, e.val);
        } catch (err) {
          this.doneExpr = text + ' =';
          throw err;
        }
        this.lastRepeat = { op: this.pending, operand: e.val };
        this.acc = null;
        this.pending = null;
        this.chain = '';
        this._finish(text, r);
      } else if (this.mode === 'sci' && this.tokens.length) {
        this._pushOperand();
        for (let d = openDepth(this.tokens); d > 0; d--) this.tokens.push({ t: ')' });
        const text = tokensText(this.tokens);
        const n = this.tokens.length;
        const repeat = n >= 2 && this.tokens[n - 1].t === 'n' && this.tokens[n - 2].t === 'o'
          ? { op: this.tokens[n - 2].v, operand: this.tokens[n - 1].v } : null;
        let r;
        try {
          r = evalTokens(this.tokens, { angle: this.angle });
        } catch (err) {
          this.doneExpr = text + ' =';
          this.tokens = [];
          throw err;
        }
        this.tokens = [];
        this.lastRepeat = repeat;
        this._finish(text, r);
      } else if (this.lastRepeat) {
        const lr = this.lastRepeat;
        const text = this._operandText() + ' ' + OPSYM[lr.op] + ' ' + formatNumber(lr.operand);
        let r;
        try {
          r = binary(lr.op, e.val, lr.operand);
        } catch (err) {
          this.doneExpr = text + ' =';
          throw err;
        }
        this._finish(text, r);
      } else {
        const text = this._operandText();
        const hadLabel = e.label != null;
        this.doneExpr = text + ' =';
        this.entry = valueEntry(e.val, null, true);
        if (hadLabel && typeof this.onEval === 'function') {
          try { this.onEval(text, e.val); } catch (_) { /* ignore */ }
        }
      }
    }
  }

  /** The key a typed character stands for (null = none). Shared by Calc.type() and the keyboard handler. */
  function keyForChar(ch, mode) {
    if (ch.length === 1 && ch >= '0' && ch <= '9') return ch;
    const sci = mode === 'sci';
    switch (ch) {
      case '+': return 'add';
      case '-': case '−': return 'sub';
      case '*': case '×': return 'mul';
      case '/': case '÷': return 'div';
      case '=': return 'eq';
      case ',': case '.': return 'dec';
      case '%': return sci ? 'mod' : 'pct';
      case '^': return sci ? 'pow' : null;
      case '(': return sci ? 'lp' : null;
      case ')': return sci ? 'rp' : null;
      case '!': return sci ? 'fact' : null;
      case '@': case '√': return 'sqrt';
      case 'r': case 'R': return 'recip';
      case 'q': case 'Q': return 'sqr';
      case 'p': case 'P': return sci ? 'pi' : null;
      case 's': case 'S': return sci ? 'sin' : null;
      case 'o': case 'O': return sci ? 'cos' : null;
      case 't': case 'T': return sci ? 'tan' : null;
      case 'n': case 'N': return sci ? 'ln' : null;
      case 'l': case 'L': return sci ? 'log' : null;
      case 'm': case 'M': return sci ? 'mod' : null;
      case 'e': case 'E': return sci ? 'expo' : null;
      default: return null;
    }
  }

  const ENGINE = {
    CalcError, Calc, clean, fix, formatNumber, formatEntry, parseNumber, tokenize, evalTokens, evaluate, unary, binary,
    keyForChar, MESSAGES: MSG
  };

  // ===================================================================================================================
  // UI
  // ===================================================================================================================

  const STORE_KEY = 'app.calculator';
  const HISTORY_MAX = 50;
  const SIDE_MIN_WIDTH = 620;
  const SIZES = {
    std: { width: 340, height: 540, minWidth: 300, minHeight: 460 },
    sci: { width: 440, height: 600, minWidth: 380, minHeight: 520 }
  };

  const BACK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5.5H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.5L3 12z"/>'
    + '<path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>';

  // label (static markup), class, aria label, shortcut for the tooltip
  const KEYS = {
    0: { l: '0', c: 'num', a: '0' }, 1: { l: '1', c: 'num', a: '1' }, 2: { l: '2', c: 'num', a: '2' },
    3: { l: '3', c: 'num', a: '3' }, 4: { l: '4', c: 'num', a: '4' }, 5: { l: '5', c: 'num', a: '5' },
    6: { l: '6', c: 'num', a: '6' }, 7: { l: '7', c: 'num', a: '7' }, 8: { l: '8', c: 'num', a: '8' },
    9: { l: '9', c: 'num', a: '9' },
    dec: { l: ',', c: 'num', a: 'Virgül', s: ',' },
    neg: { l: '+/−', c: 'num', a: 'Artı eksi', s: 'F9' },
    add: { l: '+', c: 'op', a: 'Artı', s: '+' },
    sub: { l: '−', c: 'op', a: 'Eksi', s: '-' },
    mul: { l: '×', c: 'op', a: 'Çarpı', s: '*' },
    div: { l: '÷', c: 'op', a: 'Bölü', s: '/' },
    eq: { l: '=', c: 'eq', a: 'Eşittir', s: 'Enter' },
    pct: { l: '%', c: 'fn', a: 'Yüzde', s: '%' },
    ce: { l: 'CE', c: 'fn', a: 'Girişi temizle', s: 'Del' },
    c: { l: 'C', c: 'fn', a: 'Tümünü temizle', s: 'Esc' },
    back: { l: BACK_ICON, c: 'fn', a: 'Geri sil', s: 'Backspace' },
    recip: { l: '1/<i>x</i>', c: 'fn', a: 'Çarpmaya göre ters', s: 'R' },
    sqr: { l: '<i>x</i><sup>2</sup>', c: 'fn', a: 'Kare', s: 'Q' },
    sqrt: { l: '<sup>2</sup>√<i>x</i>', c: 'fn', a: 'Karekök', s: '@' },
    cube: { l: '<i>x</i><sup>3</sup>', c: 'fn', a: 'Küp' },
    cbrt: { l: '<sup>3</sup>√<i>x</i>', c: 'fn', a: 'Küp kök' },
    pow: { l: '<i>x</i><sup><i>y</i></sup>', c: 'fn', a: 'x üzeri y', s: '^' },
    yroot: { l: '<sup><i>y</i></sup>√<i>x</i>', c: 'fn', a: 'y. dereceden kök' },
    ex: { l: '<i>e</i><sup><i>x</i></sup>', c: 'fn', a: 'e üzeri x' },
    p10: { l: '10<sup><i>x</i></sup>', c: 'fn', a: '10 üzeri x' },
    p2: { l: '2<sup><i>x</i></sup>', c: 'fn', a: '2 üzeri x' },
    ln: { l: 'ln', c: 'fn', a: 'Doğal logaritma', s: 'N' },
    log: { l: 'log', c: 'fn', a: '10 tabanında logaritma', s: 'L' },
    fact: { l: '<i>n</i>!', c: 'fn', a: 'Faktöriyel', s: '!' },
    abs: { l: '|<i>x</i>|', c: 'fn', a: 'Mutlak değer' },
    floor: { l: '⌊<i>x</i>⌋', c: 'fn', a: 'Tabana yuvarla' },
    mod: { l: 'mod', c: 'fn', a: 'Mod (kalan)', s: 'M' },
    expo: { l: 'EXP', c: 'fn', a: 'Üstel gösterim (×10ⁿ)', s: 'E' },
    pi: { l: 'π', c: 'fn', a: 'Pi', s: 'P' },
    e: { l: '<i>e</i>', c: 'fn', a: 'Euler sayısı' },
    lp: { l: '(', c: 'fn', a: 'Parantez aç', s: '(' },
    rp: { l: ')', c: 'fn', a: 'Parantez kapat', s: ')' },
    sin: { l: 'sin', c: 'fn', a: 'Sinüs', s: 'S' },
    cos: { l: 'cos', c: 'fn', a: 'Kosinüs', s: 'O' },
    tan: { l: 'tan', c: 'fn', a: 'Tanjant', s: 'T' },
    asin: { l: 'sin<sup>−1</sup>', c: 'fn', a: 'Ters sinüs' },
    acos: { l: 'cos<sup>−1</sup>', c: 'fn', a: 'Ters kosinüs' },
    atan: { l: 'tan<sup>−1</sup>', c: 'fn', a: 'Ters tanjant' },
    second: { l: '2<sup>nd</sup>', c: 'fn', a: 'İkinci işlevler (ters trigonometri)' }
  };
  const TRIG = { sin: 'asin', cos: 'acos', tan: 'atan' };

  const MEM_KEYS = [
    { k: 'mc', l: 'MC', a: 'Belleği temizle', s: 'Ctrl+L' },
    { k: 'mr', l: 'MR', a: 'Bellekten çağır', s: 'Ctrl+R' },
    { k: 'mp', l: 'M+', a: 'Belleğe ekle', s: 'Ctrl+P' },
    { k: 'mm', l: 'M−', a: 'Bellekten çıkar', s: 'Ctrl+Q' },
    { k: 'ms', l: 'MS', a: 'Belleğe kaydet', s: 'Ctrl+M' }
  ];

  const LAYOUT = {
    std: {
      fn: null,
      main: [
        ['pct', 'ce', 'c', 'back'],
        ['recip', 'sqr', 'sqrt', 'div'],
        ['7', '8', '9', 'mul'],
        ['4', '5', '6', 'sub'],
        ['1', '2', '3', 'add'],
        ['neg', '0', 'dec', 'eq']
      ]
    },
    sci: {
      fn: [
        ['second', 'pi', 'e', 'expo', 'mod'],
        ['sin', 'cos', 'tan', 'lp', 'rp'],
        ['ln', 'log', 'ex', 'p10', 'fact'],
        ['sqr', 'cube', 'pow', 'yroot', 'abs'],
        ['recip', 'sqrt', 'cbrt', 'p2', 'floor']
      ],
      main: [
        ['ce', 'c', 'back', 'div'],
        ['7', '8', '9', 'mul'],
        ['4', '5', '6', 'sub'],
        ['1', '2', '3', 'add'],
        ['neg', '0', 'dec', 'eq']
      ]
    }
  };

  // ---------------------------------------------------------------- persistence
  function loadStore() {
    let s = null;
    try { s = P.storage.get(STORE_KEY, null); } catch (_) { /* ignore */ }
    if (!s || typeof s !== 'object') s = {};
    const history = Array.isArray(s.history)
      ? s.history.filter((h) => h && typeof h.e === 'string' && typeof h.v === 'number' && Number.isFinite(h.v)).slice(0, HISTORY_MAX)
      : [];
    return {
      history,
      memory: typeof s.memory === 'number' && Number.isFinite(s.memory) ? s.memory : null,
      mode: s.mode === 'sci' ? 'sci' : 'std',
      angle: s.angle === 'rad' ? 'rad' : 'deg'
    };
  }

  function saveStore(patch) {
    try { P.storage.set(STORE_KEY, Object.assign(loadStore(), patch)); } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------- the window
  function launch(win, args) {
    const el = P.util.el;
    const store = loadStore();
    const startMode = args && (args.mode === 'sci' || args.mode === 'std') ? args.mode : store.mode;
    const calc = new Calc({ mode: startMode, angle: store.angle, memory: store.memory });
    const timers = new Set();
    const offs = [];
    const padOffs = [];
    const flashTimers = new Map();
    let second = false;
    // the user's history choice, remembered per layout: null = automatic (open in a wide window, closed in a narrow one)
    const histPref = { wide: null, narrow: null };
    let histShown = [];        // history entries currently rendered
    let lastLayout = '';
    let chipTimer = 0;
    let closed = false;

    const later = (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
      return id;
    };
    const tip = (node, text, list) => {
      try {
        if (P.ui && typeof P.ui.tip === 'function') {
          const off = P.ui.tip(node, text);
          if (typeof off === 'function') (list || offs).push(off);
        }
      } catch (_) { /* tooltips are optional */ }
    };

    // ---- DOM
    const instant = !!(P.params && P.params.get('fast') === '1');
    const root = el('div', { class: 'calc-root' + (instant ? ' instant' : '') });
    const main = el('div', { class: 'calc-main' });
    const ui = {};

    const modeSeg = el('div', { class: 'p-segmented calc-modes', role: 'group' },
      el('button', { type: 'button', text: 'Standart', dataset: { act: 'mode', mode: 'std' } }),
      el('button', { type: 'button', text: 'Bilimsel', dataset: { act: 'mode', mode: 'sci' } }));
    modeSeg.setAttribute('aria-label', 'Hesap makinesi türü');
    const angleSeg = el('div', { class: 'p-segmented calc-angle', role: 'group' },
      el('button', { type: 'button', text: 'DEG', dataset: { act: 'angle', angle: 'deg' } }),
      el('button', { type: 'button', text: 'RAD', dataset: { act: 'angle', angle: 'rad' } }));
    angleSeg.setAttribute('aria-label', 'Açı birimi');
    const histBtn = el('button', { type: 'button', class: 'p-btn icon calc-hist-btn', dataset: { act: 'history' }, html: P.icons ? P.icons.get('time') : '' });
    histBtn.setAttribute('aria-label', 'Geçmiş');
    histBtn.setAttribute('aria-pressed', 'false');
    const bar = el('div', { class: 'p-toolbar calc-bar' }, modeSeg, el('span', { class: 'spacer' }), angleSeg, histBtn);

    ui.memChip = el('span', { class: 'cd-mem', text: 'M', hidden: true });
    ui.expr = el('div', { class: 'cd-expr selectable' });
    ui.result = el('div', { class: 'cd-result selectable', role: 'status' });
    ui.result.setAttribute('aria-live', 'polite');
    ui.chip = el('div', { class: 'cd-chip', role: 'status' });
    ui.display = el('div', { class: 'calc-display' }, el('div', { class: 'cd-top' }, ui.memChip, ui.expr), ui.result, ui.chip);

    const memBar = el('div', { class: 'calc-mem', role: 'group' });
    memBar.setAttribute('aria-label', 'Bellek');
    ui.memBtns = {};
    MEM_KEYS.forEach((m) => {
      const b = el('button', { type: 'button', class: 'cm', text: m.l, dataset: { k: m.k } });
      b.setAttribute('aria-label', m.a);
      tip(b, m.a + ' (' + m.s + ')');
      ui.memBtns[m.k] = b;
      memBar.appendChild(b);
    });

    ui.pad = el('div', { class: 'calc-pad', role: 'group' });
    ui.pad.setAttribute('aria-label', 'Tuş takımı');
    main.append(bar, ui.display, memBar, ui.pad);

    // history panel (side panel when wide, sheet when narrow)
    ui.histList = el('ul', { class: 'ch-list' });
    ui.histEmpty = el('div', { class: 'p-empty ch-empty' },
      el('span', { class: 'p-icon', html: P.icons ? P.icons.get('time') : '' }),
      el('strong', { text: 'Henüz geçmiş yok' }),
      el('p', { text: 'Hesaplamalarınız burada görünür.' }));
    ui.histClear = el('button', { type: 'button', class: 'p-btn small', dataset: { act: 'hist-clear' } },
      el('span', { class: 'p-icon', html: P.icons ? P.icons.get('delete') : '' }), 'Geçmişi temizle');
    const histClose = el('button', { type: 'button', class: 'p-btn icon small ch-close', dataset: { act: 'hist-close' }, html: P.icons ? P.icons.get('x') : '' });
    histClose.setAttribute('aria-label', 'Geçmişi kapat');
    ui.hist = el('aside', { class: 'calc-history', hidden: true },
      el('div', { class: 'ch-head' }, el('h2', { text: 'Geçmiş' }), el('span', { class: 'spacer' }), histClose),
      el('div', { class: 'ch-body' }, ui.histList, ui.histEmpty),
      el('div', { class: 'ch-foot' }, ui.histClear));
    ui.hist.setAttribute('aria-label', 'Geçmiş');
    root.append(main, ui.hist);
    win.body.appendChild(root);

    tip(histBtn, 'Geçmiş (Ctrl+H)');
    tip(ui.memChip, () => 'Bellekte: ' + (calc.memory === null ? '-' : formatNumber(calc.memory)));

    // ---- keypad
    function makeKey(id) {
      const d = KEYS[id];
      const b = el('button', { type: 'button', class: 'ck ck-' + d.c + ' ck-' + id });
      b.innerHTML = d.l;
      b.setAttribute('aria-label', d.a);
      if (id === 'second') {
        b.dataset.act = 'second';
        b.setAttribute('aria-pressed', 'false');
      } else b.dataset.k = id;
      if (TRIG[id]) b.dataset.base = id;
      if (id === 'lp') b.appendChild(el('span', { class: 'ck-badge', hidden: true }));
      if (!/^[0-9]$/.test(id)) {
        tip(b, () => {
          const k = KEYS[b.dataset.k] || d;
          return k.a + (k.s ? ' (' + k.s + ')' : '');
        }, padOffs);
      }
      return b;
    }

    function makeGrid(rows, cols, cls) {
      const g = el('div', {
        class: 'pad-grid ' + cls,
        style: 'grid-template-columns: repeat(' + cols + ', minmax(0, 1fr)); grid-template-rows: repeat(' + rows.length + ', minmax(0, 1fr));'
      });
      rows.forEach((r) => r.forEach((k) => g.appendChild(makeKey(k))));
      return g;
    }

    function buildPad() {
      padOffs.splice(0).forEach((off) => { try { off(); } catch (_) { /* ignore */ } });
      ui.pad.textContent = '';
      const lay = LAYOUT[calc.mode];
      ui.pad.dataset.mode = calc.mode;
      ui.pad.style.setProperty('--cols', lay.fn ? '9' : '4');
      ui.pad.style.setProperty('--rows', String(lay.main.length));
      if (lay.fn) ui.pad.appendChild(makeGrid(lay.fn, 5, 'pad-fn'));
      ui.pad.appendChild(makeGrid(lay.main, 4, 'pad-main'));
      refreshSecond();
    }

    function refreshSecond() {
      ui.pad.querySelectorAll('[data-base]').forEach((b) => {
        const k = second ? TRIG[b.dataset.base] : b.dataset.base;
        b.dataset.k = k;
        b.innerHTML = KEYS[k].l;
        b.setAttribute('aria-label', KEYS[k].a);
      });
      const sb = ui.pad.querySelector('[data-act="second"]');
      if (sb) {
        sb.classList.toggle('on', second);
        sb.setAttribute('aria-pressed', second ? 'true' : 'false');
      }
    }

    // ---- rendering
    function baseFont() {
      const w = main.clientWidth;
      const h = ui.display.clientHeight;
      return Math.round(Math.max(28, Math.min(76, Math.min(w / 7, (h - 36) / 1.18))));
    }

    function fitResult() {
      const r = ui.result;
      const avail = r.clientWidth;
      if (!avail) return;
      const base = baseFont();
      r.style.fontSize = base + 'px';
      let guard = 0;
      while (r.scrollWidth > avail && guard++ < 40) {
        const cur = parseFloat(r.style.fontSize);
        if (cur <= 18) break;
        r.style.fontSize = Math.max(18, Math.min(cur - 1, Math.floor((cur * avail) / r.scrollWidth))) + 'px';
      }
    }

    function render() {
      if (closed) return;
      ui.result.textContent = calc.display;
      ui.result.classList.toggle('is-error', !!calc.error);
      ui.expr.textContent = calc.expression;
      ui.expr.scrollLeft = ui.expr.scrollWidth;
      ui.expr.classList.toggle('is-clipped', ui.expr.scrollWidth > ui.expr.clientWidth + 1);
      ui.memChip.hidden = calc.memory === null;
      ui.memBtns.mc.disabled = calc.memory === null;
      ui.memBtns.mr.disabled = calc.memory === null;
      const badge = ui.pad.querySelector('.ck-badge');
      if (badge) {
        const n = calc.openParens;
        badge.hidden = n === 0;
        badge.textContent = String(n);
      }
      modeSeg.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.mode === calc.mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      angleSeg.hidden = calc.mode !== 'sci';
      angleSeg.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.angle === calc.angle;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      fitResult();
    }

    function renderHistory() {
      if (closed) return;
      histShown = loadStore().history;
      ui.histList.textContent = '';
      histShown.forEach((it, i) => {
        const b = el('button', { type: 'button', class: 'ch-item', dataset: { i: String(i) } },
          el('span', { class: 'ch-expr', text: it.e + ' =' }),
          el('span', { class: 'ch-res', text: formatNumber(it.v) }));
        ui.histList.appendChild(el('li', null, b));
      });
      ui.histList.hidden = !histShown.length;
      ui.histEmpty.hidden = histShown.length > 0;
      ui.histClear.disabled = !histShown.length;
    }

    function showChip(text) {
      ui.chip.textContent = text;
      ui.chip.classList.add('show');
      clearTimeout(chipTimer);
      timers.delete(chipTimer);
      chipTimer = later(() => ui.chip.classList.remove('show'), 1500);
    }

    // ---- layout (side panel / sheet, font scale)
    const isWide = () => root.clientWidth >= SIDE_MIN_WIDTH;

    function histVisible(wide) {
      const pref = wide ? histPref.wide : histPref.narrow;
      return pref === null ? wide : pref;
    }

    function layout() {
      if (closed) return;
      const w = root.clientWidth;
      const h = root.clientHeight;
      if (!w || !h) return;
      const wide = w >= SIDE_MIN_WIDTH;
      const vis = histVisible(wide);
      const sig = [w, h, wide, vis, calc.mode].join('x');
      root.classList.toggle('is-wide', wide);
      root.classList.toggle('hist-open', vis);
      root.classList.toggle('hist-side', vis && wide);
      root.classList.toggle('hist-sheet', vis && !wide);
      ui.hist.hidden = !vis;
      histBtn.setAttribute('aria-pressed', vis ? 'true' : 'false');
      histBtn.classList.toggle('active', vis);
      if (vis && !wide) ui.hist.style.top = ui.display.offsetTop + ui.display.offsetHeight + 'px';
      else ui.hist.style.top = '';
      if (sig !== lastLayout) {
        lastLayout = sig;
        fitResult();
      }
    }

    function setHistory(open) {
      if (isWide()) histPref.wide = !!open;
      else histPref.narrow = !!open;
      layout();
      if (open) renderHistory();
    }

    function toggleHistory() {
      setHistory(!histVisible(isWide()));
    }

    // ---- window size per mode
    function applyWindowSize(prevMode) {
      const sz = SIZES[calc.mode];
      win.minWidth = sz.minWidth;
      win.minHeight = sz.minHeight;
      if (win.isMaximized() || (win.isSnapped && win.isSnapped())) return;
      const b = win.getBounds();
      if (calc.mode === 'sci') {
        if (prevMode === 'std') win.state.stdSize = { width: b.width, height: b.height };
        const w = Math.max(b.width, sz.width);
        const h = Math.max(b.height, sz.height);
        win.state.sciSet = { width: w, height: h };
        if (w !== b.width || h !== b.height) win.setSize(w, h);
      } else {
        const set = win.state.sciSet;
        const back = win.state.stdSize;
        if (prevMode === 'sci' && set && back && Math.abs(b.width - set.width) <= 2 && Math.abs(b.height - set.height) <= 2) {
          win.setSize(back.width, back.height);
        } else if (prevMode !== 'sci' && b.width === SIZES.sci.width && b.height === SIZES.sci.height) {
          win.setSize(sz.width, sz.height);
        }
      }
    }

    function setMode(mode) {
      if (mode !== 'std' && mode !== 'sci') return;
      if (mode === calc.mode) return;
      const prev = calc.mode;
      calc.setMode(mode);
      saveStore({ mode });
      buildPad();
      applyWindowSize(prev);
      lastLayout = '';
      render();
      layout();
      // the new keypad fades in (the class is re-applied so the animation restarts)
      ui.pad.classList.remove('swap');
      void ui.pad.offsetWidth;
      ui.pad.classList.add('swap');
      later(() => ui.pad.classList.remove('swap'), 300);
    }

    function setAngle(angle) {
      calc.setAngle(angle);
      saveStore({ angle: calc.angle });
      render();
    }

    // ---- key presses
    function press(key) {
      if (closed) return;
      const before = calc.memory;
      calc.press(key);
      if (calc.memory !== before) saveStore({ memory: calc.memory });
      render();
    }

    function flash(key) {
      const b = root.querySelector('[data-k="' + key + '"]');
      if (!b) return;
      b.classList.add('flash');
      clearTimeout(flashTimers.get(b));
      const id = setTimeout(() => { b.classList.remove('flash'); flashTimers.delete(b); }, 140);
      flashTimers.set(b, id);
    }

    function pressFromKeyboard(key) {
      if (second && TRIG[key]) key = TRIG[key];
      flash(key);
      press(key);
    }

    function toggleSecond() {
      second = !second;
      refreshSecond();
    }

    // ---- history actions
    function addHistory(expr, value) {
      const cur = loadStore();
      cur.history.unshift({ e: expr, v: value, t: Date.now() });
      saveStore({ history: cur.history.slice(0, HISTORY_MAX) });
      P.bus.emit('calculator:history', { source: win.id });
    }

    function clearHistory() {
      saveStore({ history: [] });
      P.bus.emit('calculator:history', { source: win.id });
    }

    function removeHistory(item) {
      const cur = loadStore();
      const i = cur.history.findIndex((h) => h.e === item.e && h.v === item.v && h.t === item.t);
      if (i >= 0) cur.history.splice(i, 1);
      saveStore({ history: cur.history });
      P.bus.emit('calculator:history', { source: win.id });
    }

    function useHistory(item) {
      calc.restore(item.v, item.e);
      render();
      if (root.classList.contains('hist-sheet')) setHistory(false);
    }

    calc.onEval = addHistory;
    offs.push(P.bus.on('calculator:history', renderHistory));

    // ---- clipboard
    async function writeClipboard(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (_) { /* fall back below */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (P.wm && P.wm.refocus) P.wm.refocus();
        return ok;
      } catch (_) {
        return false;
      }
    }

    async function copyText(text, label) {
      win.state.lastCopied = text;
      const ok = await writeClipboard(text);
      if (!closed) showChip(ok ? (label || 'Kopyalandı') : 'Kopyalanamadı');
      return ok;
    }

    function copyResult() {
      const text = calc.copyText;
      if (!text) return Promise.resolve(false);
      return copyText(text);
    }

    function pasteText(text) {
      const raw = String(text == null ? '' : text).trim();
      if (!raw) return false;
      let v = parseNumber(raw);
      let label = null;
      if (v === null) {
        try {
          v = evaluate(raw, { angle: calc.angle });
          label = raw.length > 40 ? raw.slice(0, 40) + '…' : raw;
        } catch (_) {
          v = null;
        }
      }
      if (v === null || !Number.isFinite(v)) {
        showChip('Yapıştırılamadı');
        return false;
      }
      calc.enterNumber(fix(v), label);
      render();
      return true;
    }

    async function pasteFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        pasteText(text);
      } catch (_) {
        showChip('Pano okunamadı - Ctrl+V deneyin');
      }
    }

    // ---- events
    const onClick = (e) => {
      // the bottom sheet is a flyout: a click on the part of the calculator it does not cover dismisses it
      if (root.classList.contains('hist-sheet') && ui.display.contains(e.target)) { setHistory(false); return; }
      const t = e.target.closest ? e.target.closest('[data-k],[data-act]') : null;
      if (t && root.contains(t)) {
        if (t.dataset.k) { press(t.dataset.k); return; }
        switch (t.dataset.act) {
          case 'mode': setMode(t.dataset.mode); break;
          case 'angle': setAngle(t.dataset.angle); break;
          case 'second': toggleSecond(); break;
          case 'history': toggleHistory(); break;
          case 'hist-close': setHistory(false); break;
          case 'hist-clear': clearHistory(); break;
          default: break;
        }
        return;
      }
      const item = e.target.closest ? e.target.closest('.ch-item') : null;
      if (item && histShown[+item.dataset.i]) useHistory(histShown[+item.dataset.i]);
    };
    root.addEventListener('click', onClick);
    // buttons never take the keyboard focus from a mouse press: Enter / Space keep meaning "=" afterwards
    root.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('button')) e.preventDefault(); });

    ui.display.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!P.contextMenu) return;
      P.contextMenu.show(e, [
        { label: 'Kopyala', icon: 'copy', shortcut: 'Ctrl+C', disabled: !!calc.error, action: () => copyResult() },
        { label: 'Yapıştır', icon: 'paste', shortcut: 'Ctrl+V', action: () => pasteFromClipboard() }
      ]);
    });

    ui.hist.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!P.contextMenu) return;
      const row = e.target.closest ? e.target.closest('.ch-item') : null;
      const item = row ? histShown[+row.dataset.i] : null;
      P.contextMenu.show(e, [
        item && { label: 'Sonucu kullan', icon: 'check', action: () => useHistory(item) },
        item && { label: 'Sonucu kopyala', icon: 'copy', action: () => copyText(plain(formatNumber(item.v))) },
        item && { label: 'İfadeyi kopyala', action: () => copyText(item.e + ' = ' + formatNumber(item.v), 'İfade kopyalandı') },
        item && { label: 'Sil', icon: 'delete', danger: true, action: () => removeHistory(item) },
        item && { type: 'separator' },
        { label: 'Geçmişi temizle', icon: 'delete', danger: true, disabled: !histShown.length, action: clearHistory }
      ]);
    });

    win.el.addEventListener('paste', (e) => {
      const data = e.clipboardData;
      if (!data) return;
      e.preventDefault();
      pasteText(data.getData('text/plain') || data.getData('text'));
    });

    // ---- keyboard
    const MEM_SHORTCUT = { l: 'mc', r: 'mr', p: 'mp', q: 'mm', m: 'ms' };

    function onKeydown(e) {
      const k = e.key;
      if (!k) return;
      const target = e.target;
      const onButton = !!(target && target.closest && target.closest('button'));
      // a Tab-focused button keeps its own Enter / Space activation
      if (onButton && (k === 'Enter' || k === ' ')) return;

      const altGr = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
      if (!altGr && (e.ctrlKey || e.metaKey)) {
        const lower = k.toLowerCase();
        if (lower === 'c') {
          const sel = window.getSelection ? window.getSelection() : null;
          if (sel && !sel.isCollapsed && ui.display.contains(sel.anchorNode)) return; // let the browser copy the selection
          e.preventDefault();
          copyResult();
        } else if (lower === 'h') {
          e.preventDefault();
          toggleHistory();
        } else if (MEM_SHORTCUT[lower] && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          if (!e.repeat) pressFromKeyboard(MEM_SHORTCUT[lower]);
        }
        return;
      }
      if (!altGr && e.altKey) {
        if (k === '1' || k === '2') {
          e.preventDefault();
          setMode(k === '1' ? 'std' : 'sci');
        }
        return;
      }

      if ((k === 'ArrowDown' || k === 'ArrowUp') && target && target.closest && target.closest('.ch-item')) {
        e.preventDefault();
        const items = [...ui.histList.querySelectorAll('.ch-item')];
        const next = items[items.indexOf(target.closest('.ch-item')) + (k === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus();
        return;
      }

      if (k === 'Escape' && root.classList.contains('hist-sheet')) {
        e.preventDefault();
        setHistory(false);
        return;
      }

      let key = null;
      let repeatable = false;
      switch (k) {
        case 'Enter': key = 'eq'; break;
        case 'Backspace': key = 'back'; repeatable = true; break;
        case 'Escape': key = 'c'; break;
        case 'Delete': key = 'ce'; break;
        case 'F9': key = 'neg'; break;
        case 'F3': e.preventDefault(); setAngle('deg'); return;
        case 'F4': e.preventDefault(); setAngle('rad'); return;
        default:
          if (k.length === 1) {
            key = ENGINE.keyForChar(k, calc.mode);
            repeatable = /^[0-9]$/.test(k);
          }
      }
      if (!key) return;
      e.preventDefault();
      if (e.repeat && !repeatable) return;
      pressFromKeyboard(key);
    }

    offs.push(win.on('keydown', onKeydown));
    offs.push(win.on('resize', layout));
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      try { ro = new ResizeObserver(() => layout()); ro.observe(root); } catch (_) { ro = null; }
    }

    win.on('close', () => {
      closed = true;
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      flashTimers.forEach((id) => clearTimeout(id));
      flashTimers.clear();
      if (ro) { try { ro.disconnect(); } catch (_) { /* ignore */ } }
      offs.splice(0).forEach((off) => { try { off(); } catch (_) { /* ignore */ } });
      padOffs.splice(0).forEach((off) => { try { off(); } catch (_) { /* ignore */ } });
      calc.onEval = null;
    });

    // handles for tests and other modules
    win.state.calc = calc;
    win.state.api = {
      press, setMode, setAngle, setHistory, toggleHistory, copyResult, pasteText, render, renderHistory, layout, fitResult,
      isHistoryVisible: () => root.classList.contains('hist-open'),
      isSecond: () => second
    };

    // ---- first paint
    buildPad();
    applyWindowSize(null);
    render();
    renderHistory();
    layout();
    // the window may still be settling into its final size: measure again once it did
    later(() => { lastLayout = ''; layout(); render(); }, 60);
  }

  P.apps.register({
    id: 'calculator',
    name: 'Hesap Makinesi',
    icon: 'calculator',
    description: 'Standart ve bilimsel hesap makinesi',
    category: 'utilities',
    fileTypes: [],
    singleInstance: false,
    showInStartMenu: true,
    window: { width: SIZES.std.width, height: SIZES.std.height, minWidth: SIZES.std.minWidth, minHeight: SIZES.std.minHeight },
    launch,
    _engine: ENGINE
  });
}());
