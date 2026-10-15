/* Hesap Makinesi tests: engine (formatting, parser, standard + scientific state machine) and the window UI.
   Screenshot scenes: bash tools/shot.sh out.png "fast=1&test=calculator&shot=<scene>&theme=dark|light"
   with <scene> in: std, sci, sci2nd, hist, histwide, histsheet, error, long, minstd, minsci, wide */
(function () {
  'use strict';

  const P = window.PandaOS;
  const T = window.PandaTest;
  const SHOT = P.params.get('shot');

  const engine = () => P.apps.get('calculator')._engine;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  // ------------------------------------------------------------------ helpers
  /** Feeds a space separated key list into a Calc: "12 add 3 eq" -> 1,2,add,3,eq ("," = decimal). */
  function keys(c, list) {
    String(list).split(/\s+/).filter(Boolean).forEach((w) => {
      if (/^[0-9,]+$/.test(w)) [...w].forEach((ch) => c.press(ch === ',' ? 'dec' : ch));
      else c.press(w);
    });
    return c;
  }
  const mk = (mode, opts) => new (engine().Calc)(Object.assign({ mode }, opts));
  const std = (list, opts) => keys(mk('std', opts), list);
  const sci = (list, opts) => keys(mk('sci', opts), list);
  const calcOf = (win) => win.state.calc;
  const result = (win) => $('.cd-result', win.body).textContent;
  const expr = (win) => $('.cd-expr', win.body).textContent;
  const key = (win, k) => $(`[data-k="${k}"]`, win.body);
  const click = (t, win, list) => String(list).split(/\s+/).filter(Boolean).forEach((w) => {
    if (/^[0-9,]+$/.test(w)) [...w].forEach((ch) => t.click(key(win, ch === ',' ? 'dec' : ch)));
    else t.click(key(win, w));
  });
  const typeKeys = (t, win, text) => [...text].forEach((ch) => t.key(win.el, ch));
  const open = (args) => {
    closeAll(); // a failed earlier test must not leave windows behind that confuse the next one
    P.storage.remove('app.calculator');
    const win = P.apps.launch('calculator', args || {});
    return win;
  };
  const hist = () => P.storage.get('app.calculator', {}).history || [];
  const closeAll = () => P.apps.running('calculator').forEach((w) => w.forceClose());

  // =====================================================================================================================
  if (SHOT) {
    T.test('shot: ' + SHOT, async (t) => {
      const E = engine();
      const win = open(SHOT === 'sci' || SHOT === 'sci2nd' || SHOT === 'minsci' ? { mode: 'sci' } : {});
      const api = win.state.api;
      const run = (list) => keys(win.state.calc, list);
      const refresh = () => { api.render(); api.layout(); api.fitResult(); };
      await t.sleep(100);
      if (SHOT === 'std') {
        run('1234 mul 5 add'); run('67 dec 5'); refresh();
        run('mul'); run('2'); refresh();
      } else if (SHOT === 'sci') {
        run('lp 2 add 3 rp mul 4 sin'); refresh();
      } else if (SHOT === 'sci2nd') {
        t.click($('[data-act="second"]', win.body));
        run('30 sin'); refresh();
      } else if (SHOT === 'hist' || SHOT === 'histsheet') {
        ['12 mul 3 eq', '1234567 add 8901 eq', '2 sqr eq', '9 sqrt eq', '100 div 8 eq'].forEach((l) => { keys(win.state.calc, 'c'); keys(win.state.calc, l); });
        run('c 42 mul 3 eq');
        refresh();
        api.setHistory(true);
      } else if (SHOT === 'histwide' || SHOT === 'wide') {
        ['12 mul 3 eq', '1234567 add 8901 eq', '2 sqr eq', '9 sqrt eq', '100 div 8 eq'].forEach((l) => { keys(win.state.calc, 'c'); keys(win.state.calc, l); });
        run('c 42 mul 3 eq');
        win.maximize();
        await t.sleep(50);
        refresh();
        if (SHOT === 'wide') api.setHistory(false);
      } else if (SHOT === 'error') {
        run('5 div 0 eq'); refresh();
      } else if (SHOT === 'long') {
        run('9999999999999999 mul 9999999999999999 eq'); refresh();
      } else if (SHOT === 'minstd') {
        win.setSize(10, 10); run('1234567 dec 89 add 3'); await t.sleep(80); refresh();
      } else if (SHOT === 'minsci') {
        win.setSize(10, 10); run('lp 1 add 2 rp mul 3'); await t.sleep(80); refresh();
      }
      void E;
      await t.sleep(50);
    });
    return;
  }

  // =====================================================================================================================
  // engine: formatting and parsing
  // =====================================================================================================================
  T.test('motor: sayı biçimlendirme (tr-TR)', (t) => {
    const f = engine().formatNumber;
    t.eq(f(0), '0');
    t.eq(f(-0), '0');
    t.eq(f(5), '5');
    t.eq(f(-5), '-5');
    t.eq(f(1234567.89), '1.234.567,89');
    t.eq(f(-1234.5), '-1.234,5');
    t.eq(f(1000), '1.000');
    t.eq(f(999), '999');
    t.eq(f(0.5), '0,5');
    t.eq(f(0.000001), '0,000001');
    t.eq(f(1 / 3), '0,333333333333333');
    t.eq(f(2 / 3), '0,666666666666667');
    t.eq(f(0.1 + 0.2), '0,3');
    t.eq(f(1.23e25), '1,23e+25');
    t.eq(f(-1.23e25), '-1,23e+25');
    t.eq(f(1e25), '1e+25');
    t.eq(f(1e-7), '1e-7');
    t.eq(f(1.5e-10), '1,5e-10');
    t.eq(f(9007199254740992), '9.007.199.254.740.992');
    t.eq(f(9999999999999998), '9.999.999.999.999.998');
    t.eq(f(1e16), '1e+16');
    t.eq(f(123456789012345678), '1,23456789012346e+17');
    t.eq(f(Math.PI), '3,14159265358979');
    t.eq(f(Math.E), '2,71828182845905');
    t.eq(f(123456789012345.67), '123.456.789.012.346');
  });

  T.test('motor: yazılan sayının biçimi', (t) => {
    const f = engine().formatEntry;
    t.eq(f('0'), '0');
    t.eq(f('0.'), '0,');
    t.eq(f('1234'), '1.234');
    t.eq(f('1234.50'), '1.234,50');
    t.eq(f('-1234567.'), '-1.234.567,');
    t.eq(f('2.5e+3'), '2,5e+3');
    t.eq(f('2e+'), '2e+');
    t.eq(f('-0.'), '-0,');
  });

  T.test('motor: sayı ayrıştırma (parseNumber)', (t) => {
    const p = engine().parseNumber;
    t.eq(p('1.234,5'), 1234.5);
    t.eq(p('1,5'), 1.5);
    t.eq(p('3.14'), 3.14);
    t.eq(p('1.234'), 1234);
    t.eq(p('0.500'), 0.5);
    t.eq(p('1,234.5'), 1234.5);
    t.eq(p('1.234.567'), 1234567);
    t.eq(p('-2,5'), -2.5);
    t.eq(p('−2,5'), -2.5);
    t.eq(p('  42  '), 42);
    t.eq(p('1e3'), 1000);
    t.eq(p('1,23e+25'), 1.23e25);
    t.eq(p('abc'), null);
    t.eq(p(''), null);
    t.eq(p('1,2,3'), null);
    t.eq(p('12 + 3'), null);
    t.eq(p(null), null);
  });

  T.test('motor: temizleme (kayan nokta gürültüsü)', (t) => {
    const c = engine().clean;
    t.eq(c(0.1 + 0.2), 0.3);
    t.eq(c(1.1 * 1.1), 1.21);
    t.eq(c(Math.sqrt(2) ** 2), 2);
    t.eq(c(1 / 3), 1 / 3);
    t.eq(c(5), 5);
    t.eq(c(0), 0);
    t.ok(Number.isNaN(c(NaN)));
  });

  // =====================================================================================================================
  // engine: expression parser
  // =====================================================================================================================
  T.test('motor: ifade çözümleyici - öncelik ve birleşme', (t) => {
    const ev = engine().evaluate;
    t.eq(ev('2+3*4'), 14);
    t.eq(ev('(2+3)*4'), 20);
    t.eq(ev('2*3+4'), 10);
    t.eq(ev('10-4-3'), 3);
    t.eq(ev('100/10/5'), 2);
    t.eq(ev('2^3^2'), 512);
    t.eq(ev('2*3^2'), 18);
    t.eq(ev('-2^2'), -4);
    t.eq(ev('(-2)^2'), 4);
    t.eq(ev('2^-1'), 0.5);
    t.eq(ev('-(3+4)'), -7);
    t.eq(ev('--5'), 5);
    t.eq(ev('+5'), 5);
    t.eq(ev('7 mod 3'), 1);
    t.eq(ev('7 % 3'), 1);
    t.eq(ev('-7 mod 3'), -1);
    t.eq(ev('2+7 mod 3*2'), 4);
    t.eq(ev('5!'), 120);
    t.eq(ev('0!'), 1);
    t.eq(ev('3!+1'), 7);
    t.eq(ev('2*3!'), 12);
    t.eq(ev('((((1+2))))'), 3);
    t.eq(ev('1,5*2'), 3);
    t.eq(ev('1.5*2'), 3);
    t.eq(ev('6 ÷ 3 × 2 − 1'), 3);
    t.eq(ev('8 yroot 3'), 2);
    t.eq(ev('27 yroot 3'), 3);
    t.eq(ev('(-8) yroot 3'), -2);
    t.eq(ev('2e3'), 2000);
    t.eq(ev('2e-3'), 0.002);
    t.eq(ev('1e2+1'), 101);
  });

  T.test('motor: ifade çözümleyici - işlevler ve sabitler', (t) => {
    const E = engine();
    const ev = E.evaluate;
    t.eq(ev('sin(30)'), 0.5);
    t.eq(ev('cos(60)'), 0.5);
    t.eq(ev('tan(45)'), 1);
    t.eq(ev('sin(90)'), 1);
    t.eq(ev('sin(180)'), 0);
    t.eq(ev('cos(90)'), 0);
    t.eq(ev('cos(180)'), -1);
    t.eq(ev('sin(360)'), 0);
    t.eq(ev('sin(-90)'), -1);
    t.eq(ev('tan(180)'), 0);
    t.eq(ev('asin(0.5)'), 30);
    t.eq(ev('acos(0.5)'), 60);
    t.eq(ev('atan(1)'), 45);
    t.eq(ev('sin(0)', { angle: 'rad' }), 0);
    t.eq(ev('sin(pi)', { angle: 'rad' }), 0);
    t.eq(ev('cos(pi)', { angle: 'rad' }), -1);
    t.eq(ev('sin(π/2)', { angle: 'rad' }), 1);
    t.ok(Math.abs(ev('asin(1)', { angle: 'rad' }) - Math.PI / 2) < 1e-14);
    t.eq(ev('ln(e)'), 1);
    t.eq(ev('log(1000)'), 3);
    t.eq(ev('log(0.001)'), -3);
    t.eq(ev('exp(0)'), 1);
    t.eq(ev('sqrt(16)'), 4);
    t.eq(ev('√9'), 3);
    t.eq(ev('√(2)*√(2)'), 2);
    t.eq(ev('cbrt(27)'), 3);
    t.eq(ev('abs(-3.5)'), 3.5);
    t.eq(ev('fact(5)'), 120);
    t.eq(ev('floor(2.7)'), 2);
    t.eq(ev('floor(-2.1)'), -3);
    t.eq(ev('2π'), 2 * Math.PI);
    t.eq(ev('3(4+1)'), 15);
    t.eq(ev('(1+2)(3+4)'), 21);
    t.eq(ev('2sin(30)'), 1);
    t.eq(ev('2 pi'), 2 * Math.PI);
    t.eq(ev('SIN(30)'), 0.5);
    t.eq(ev('0.1+0.2'), 0.3);
    t.eq(ev('0.1+0.2-0.3'), 0);
    t.eq(ev('1/3*3'), 1);
    t.eq(ev('(1+2'), 3);
    t.eq(ev('sin(30'), 0.5);
  });

  T.test('motor: ifade çözümleyici - hatalar', (t) => {
    const E = engine();
    const code = (src, opts) => {
      try { E.evaluate(src, opts); } catch (e) { return e instanceof E.CalcError ? e.code : 'other:' + e.message; }
      return 'ok';
    };
    t.eq(code('1/0'), 'div0');
    t.eq(code('0/0'), 'div0');
    t.eq(code('5 mod 0'), 'div0');
    t.eq(code('0^-1'), 'div0');
    t.eq(code('sqrt(-1)'), 'invalid');
    t.eq(code('(-8)^0.5'), 'invalid');
    t.eq(code('0^0'), 'invalid');
    t.eq(code('ln(0)'), 'invalid');
    t.eq(code('ln(-1)'), 'invalid');
    t.eq(code('log(0)'), 'invalid');
    t.eq(code('asin(2)'), 'invalid');
    t.eq(code('acos(-2)'), 'invalid');
    t.eq(code('tan(90)'), 'invalid');
    t.eq(code('tan(270)'), 'invalid');
    t.eq(code('(-8) yroot 2'), 'invalid');
    t.eq(code('4 yroot 0'), 'invalid');
    t.eq(code('171!'), 'overflow');
    t.eq(code('10^400'), 'overflow');
    t.eq(code('exp(1000)'), 'overflow');
    t.eq(code('1e308+1e308'), 'overflow');
    t.eq(code('1e200*1e200'), 'overflow');
    t.eq(code('1e300*1e-300'), 'ok');
    t.eq(code('(-1)!'), 'invalid');
    t.eq(code('2.5!'), 'invalid');
    t.eq(code(''), 'invalid');
    t.eq(code('3+'), 'invalid');
    t.eq(code('*3'), 'invalid');
    t.eq(code('()'), 'invalid');
    t.eq(code('2 3'), 'invalid');
    t.eq(code('foo(3)'), 'invalid');
    t.eq(code('3 $ 4'), 'invalid');
    t.eq(code('1)'), 'invalid');
    t.eq(code('('.repeat(300) + '1' + ')'.repeat(300)), 'invalid');
    t.eq(code('170!'), 'ok');
    t.eq(new E.CalcError('div0').message, 'Sıfıra bölünemez');
    t.eq(new E.CalcError('invalid').message, 'Geçersiz giriş');
  });

  // =====================================================================================================================
  // engine: standard mode state machine
  // =====================================================================================================================
  T.test('standart: giriş, ondalık, sıfırlar, silme', (t) => {
    t.eq(std('').display, '0');
    t.eq(std('1 2 3').display, '123');
    t.eq(std('1234567').display, '1.234.567');
    t.eq(std('007').display, '7');
    t.eq(std('000').display, '0');
    t.eq(std('dec').display, '0,');
    t.eq(std('dec 5').display, '0,5');
    t.eq(std('1 dec 5 dec 7').display, '1,57');
    t.eq(std('0 dec 0 0').display, '0,00');
    t.eq(std('1234567 dec 89').display, '1.234.567,89');
    t.eq(std('12345678901234567890').display, '1.234.567.890.123.456'); // 16 digits at most
    t.eq(std('0 dec 123456789012345678').display, '0,1234567890123456'); // 16 digits, the leading 0 does not count
    t.eq(std('9999999999999999').display, '999.999.999.999.999'); // the 16th nine would turn into 1e16: refused
    t.eq(std('9007199254740992').display, '9.007.199.254.740.992');
    t.eq(std('90071992547409923').display, '9.007.199.254.740.992');
    t.eq(std('1000000000000000').display, '1.000.000.000.000.000');
    t.eq(std('0 dec 1234567890123456').display, '0,1234567890123456');
    t.eq(std('1 2 3 back').display, '12');
    t.eq(std('1 2 3 back back back').display, '0');
    t.eq(std('1 2 3 back back back back').display, '0');
    t.eq(std('1 dec back').display, '1');
    t.eq(std('neg 5 back').display, '0');
    t.eq(std('5 neg').display, '-5');
    t.eq(std('5 neg neg').display, '5');
    t.eq(std('0 neg').display, '0');
    t.eq(std('5 neg 3').display, '-53');
    t.eq(std('5 neg back').display, '0');
    t.eq(std('1 2 c').display, '0');
    t.eq(std('1 2 ce').display, '0');
  });

  T.test('standart: dört işlem, zincir ve soldan sağa işlem', (t) => {
    let c = std('12 add 3 eq');
    t.eq(c.display, '15');
    t.eq(c.expression, '12 + 3 =');
    t.eq(std('9 sub 4 eq').display, '5');
    t.eq(std('9 sub 14 eq').display, '-5');
    t.eq(std('6 mul 7 eq').display, '42');
    t.eq(std('8 div 4 eq').display, '2');
    t.eq(std('1 div 8 eq').display, '0,125');
    t.eq(std('2 add 3 mul 4 eq').display, '20'); // standard mode is immediate execution
    c = std('12 add 3 mul');
    t.eq(c.display, '15');
    t.eq(c.expression, '12 + 3 ×');
    c = std('12 add 3 mul 2 sub');
    t.eq(c.display, '30');
    t.eq(c.expression, '12 + 3 × 2 −');
    t.eq(std('12 add 3 mul 2 sub 5 eq').display, '25');
    t.eq(std('1 dec 5 add 2 dec 2 5 eq').display, '3,75');
    t.eq(std('1234567 mul 1000 eq').display, '1.234.567.000');
    t.eq(std('5 add').display, '5');
    t.eq(std('5 add').expression, '5 +');
    t.eq(std('5 add 3').display, '3');
    t.eq(std('5 add 3').expression, '5 +');
  });

  T.test('standart: işleç değiştirme ve = tekrarı', (t) => {
    let c = std('5 add mul');
    t.eq(c.expression, '5 ×');
    t.eq(std('5 add mul 3 eq').display, '15');
    t.eq(std('5 add sub mul div 5 eq').display, '1');
    t.eq(std('5 add eq').display, '10');
    t.eq(std('5 mul eq').display, '25');
    t.eq(std('5 add eq').expression, '5 + 5 =');
    c = std('2 add 3 eq eq');
    t.eq(c.display, '8');
    t.eq(c.expression, '5 + 3 =');
    t.eq(std('2 add 3 eq eq eq').display, '11');
    t.eq(std('2 mul 3 eq eq eq').display, '54');
    t.eq(std('100 div 2 eq eq').display, '25');
    t.eq(std('10 sub 3 eq eq').display, '4');
    t.eq(std('2 add 3 eq 4 eq').display, '7'); // a new number: 4 + 3
    t.eq(std('2 add 3 eq mul 2 eq').display, '10'); // an operator continues from the result
    t.eq(std('2 add 3 eq 7').display, '7');
    t.eq(std('2 add 3 eq 7').expression, '');
    t.eq(std('2 add 3 eq c eq').display, '0');
    t.eq(std('7 eq').display, '7');
    t.eq(std('7 eq').expression, '7 =');
    t.eq(std('eq').display, '0');
  });

  T.test('standart: yüzde (Windows davranışı)', (t) => {
    let c = std('200 add 10 pct');
    t.eq(c.display, '20');
    t.eq(c.expression, '200 + 20');
    t.eq(std('200 add 10 pct eq').display, '220');
    t.eq(std('200 sub 10 pct eq').display, '180');
    t.eq(std('200 mul 10 pct eq').display, '20');
    t.eq(std('200 div 10 pct eq').display, '2.000');
    t.eq(std('50 add pct eq').display, '75');
    t.eq(std('5 pct').display, '0');
    t.eq(std('5 pct').expression, '0');
    t.eq(std('80 add 12 dec 5 pct eq').display, '90');
    c = std('9 add 1 pct');
    t.eq(c.display, '0,09');
  });

  T.test('standart: tek terimli işlevler', (t) => {
    let c = std('9 sqrt');
    t.eq(c.display, '3');
    t.eq(c.expression, '√(9)');
    c = std('4 sqr');
    t.eq(c.display, '16');
    t.eq(c.expression, 'sqr(4)');
    c = std('4 recip');
    t.eq(c.display, '0,25');
    t.eq(c.expression, '1/(4)');
    t.eq(std('3 sqr sqr').display, '81');
    t.eq(std('3 sqr sqr').expression, 'sqr(sqr(3))');
    t.eq(std('2 sqrt').display, '1,4142135623731'); // 15 significant digits: 1,41421356237310 -> trailing zero trimmed
    t.eq(std('2 sqrt sqr').display, '2'); // 1.4142135623730951² = 2.0000000000000004 -> 2
    c = std('5 add 9 sqrt');
    t.eq(c.display, '3');
    t.eq(c.expression, '5 + √(9)');
    t.eq(std('5 add 9 sqrt eq').display, '8');
    t.eq(std('5 add 9 sqrt eq').expression, '5 + √(9) =');
    t.eq(std('5 add sqr eq').display, '30'); // 5 + sqr(5)
    t.eq(std('5 add sqr').expression, '5 + sqr(5)');
    t.eq(std('9 sqrt add 1 eq').display, '4');
    t.eq(std('9 sqrt add').expression, '√(9) +');
    t.eq(std('2 add 3 eq sqr').display, '25');
    t.eq(std('9 sqrt eq').display, '3');
    t.eq(std('9 sqrt eq').expression, '√(9) =');
    t.eq(std('2 add 3 eq neg').display, '-5');
    t.eq(std('2 add 3 eq neg').expression, 'neg(5)');
    t.eq(std('2 add 3 eq neg add 1 eq').display, '-4');
    t.eq(std('3 neg sqr').display, '9');
    t.eq(std('1 dec 5 neg sqr').display, '2,25');
  });

  T.test('standart: hatalar ve sıfırlanma', (t) => {
    let c = std('5 div 0 eq');
    t.eq(c.display, 'Sıfıra bölünemez');
    t.eq(c.error, 'Sıfıra bölünemez');
    t.eq(c.expression, '5 ÷ 0 =');
    c.press('7');
    t.eq(c.display, '7');
    t.eq(c.error, null);
    t.eq(std('0 div 0 eq').display, 'Sıfıra bölünemez');
    t.eq(std('0 recip').display, 'Sıfıra bölünemez');
    t.eq(std('0 recip').expression, '1/(0)');
    t.eq(std('2 neg sqrt').display, 'Geçersiz giriş');
    t.eq(std('2 neg sqrt').expression, '√(-2)');
    t.eq(std('400 p10').display, 'Taşma');
    t.eq(std('5 div 0 add').display, 'Sıfıra bölünemez');
    // the next key resets: operators do nothing but clear, digits start fresh
    c = std('5 div 0 eq');
    c.press('add');
    t.eq(c.display, '0');
    t.eq(c.error, null);
    c = std('5 div 0 eq 9 add 1 eq');
    t.eq(c.display, '10');
    c = std('5 div 0 eq c');
    t.eq(c.display, '0');
    t.eq(c.expression, '');
    c = std('5 div 0 eq ce');
    t.eq(c.display, '0');
    c = std('5 div 0 eq dec 5');
    t.eq(c.display, '0,5');
    // chained error: 8 ÷ 0 + ...
    c = std('8 div 0 add');
    t.eq(c.display, 'Sıfıra bölünemez');
    c = std('1 add 2 mul 0 div 0 eq');
    t.eq(c.error, 'Sıfıra bölünemez');
    // overflow in arithmetic
    c = std('9999999999999999 mul 9999999999999999 mul 9999999999999999 eq');
    t.ok(c.error === null && /e\+/.test(c.display), 'üstel gösterim bekleniyordu: ' + c.display);
  });

  T.test('standart: CE, C ve belleği koruma', (t) => {
    let c = std('5 add 3 ce');
    t.eq(c.display, '0');
    t.eq(c.expression, '5 +');
    c.press('eq');
    t.eq(c.display, '5');
    c = std('5 add 3 ce 4 eq');
    t.eq(c.display, '9');
    c = std('5 add 3 c');
    t.eq(c.display, '0');
    t.eq(c.expression, '');
    c.press('eq');
    t.eq(c.display, '0');
    c = std('2 add 3 eq ce');
    t.eq(c.display, '0');
    t.eq(c.expression, '');
    c = std('9 ms 5 c mr');
    t.eq(c.display, '9');
    t.eq(c.memory, 9);
  });

  T.test('standart: kayan nokta ve büyük sayılar', (t) => {
    t.eq(std('0 dec 1 add 0 dec 2 eq').display, '0,3');
    t.eq(std('0 dec 1 add 0 dec 2 sub 0 dec 3 eq').display, '0');
    t.eq(std('1 div 3 mul 3 eq').display, '1');
    t.eq(std('1 dec 1 mul 1 dec 1 eq').display, '1,21');
    t.eq(std('0 dec 1 mul 3 eq').display, '0,3');
    // + - × and mod work on the decimal forms, so differences are exact
    t.eq(std('9 dec 9 5 sub 9 dec 9 eq').display, '0,05');
    t.eq(std('1 dec 5 sub 1 dec 4 9 eq').display, '0,01');
    t.eq(std('3 sub 2 dec 9 eq').display, '0,1');
    t.eq(std('1000000000000001 sub 1000000000000000 eq').display, '1');
    t.eq(std('3000000000000001 sub 3000000000000000 eq').display, '1');
    t.eq(std('1 dec 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 sub 1 eq').display, '1e-15');
    t.eq(std('0 dec 0 7 mul 100 eq').display, '7');
    t.eq(std('4 dec 3 5 mul 100 eq').display, '435');
    t.eq(std('0 dec 1 mul 0 dec 1 eq').display, '0,01');
    t.eq(std('123456 dec 789 mul 987 dec 654 eq').display, '121.932.591,483006');
    t.eq(sci('0 dec 3 mod 0 dec 1 eq').display, '0');
    t.eq(sci('5 dec 5 mod 2 eq').display, '1,5');
    t.eq(sci('7 dec 5 neg mod 2 eq').display, '-1,5');
    t.eq(std('9999999 mul 9999999 eq').display, '99.999.980.000.001');
    t.eq(std('9999999999 mul 9999999999 eq').display, '9,999999998e+19');
    t.eq(std('1 div 3 eq').display, '0,333333333333333');
    t.eq(std('1 div 3 eq').expression, '1 ÷ 3 =');
    t.eq(std('2 div 3 eq').display, '0,666666666666667');
    t.eq(std('1 div 3 mul 3 eq').display, '1');
    t.eq(std('0 dec 0 0 0 0 0 1 div 10 eq').display, '1e-7');
    t.ok(Math.abs(std('1 div 3 eq').value - 1 / 3) < 1e-15);
  });

  T.test('standart: bellek', (t) => {
    let c = std('5 ms');
    t.eq(c.memory, 5);
    c = std('5 ms c 3 mp');
    t.eq(c.memory, 8);
    c = std('5 ms 2 mm');
    t.eq(c.memory, 3);
    c = std('5 ms 3 mc');
    t.eq(c.memory, null);
    c = std('5 mm');
    t.eq(c.memory, -5);
    c = std('7 mp');
    t.eq(c.memory, 7);
    c = std('mr');
    t.eq(c.display, '0');
    c = std('4 ms c 3 add mr eq');
    t.eq(c.display, '7');
    c = std('4 ms 9 mr');
    t.eq(c.display, '4');
    // after a store the next digit starts a new number
    c = std('4 ms 5');
    t.eq(c.display, '5');
    c = std('0 dec 1 mp 0 dec 2 mp mr');
    t.eq(c.display, '0,3');
    c = std('9 ms', { memory: 1 });
    t.eq(c.memory, 9);
    c = new (engine().Calc)({ memory: 12.5 });
    t.eq(c.memory, 12.5);
  });

  T.test('standart: tarihçe geri çağrısı (onEval)', (t) => {
    const seen = [];
    const c = mk('std');
    c.onEval = (e, v) => seen.push([e, v]);
    keys(c, '12 add 3 eq');
    keys(c, 'eq');
    keys(c, 'c 9 sqrt eq');
    keys(c, 'c 4 sqr');
    keys(c, 'c 7 eq');
    t.eq(seen, [['12 + 3', 15], ['15 + 3', 18], ['√(9)', 3]]);
    c.onEval = () => { throw new Error('dinleyici hatası'); };
    keys(c, 'c 1 add 1 eq');
    t.eq(c.display, '2');
  });

  T.test('standart: type() ve klavye karakter eşlemesi', (t) => {
    const E = engine();
    t.eq(mk('std').type('12*3=').display, '36');
    t.eq(mk('std').type('2+3*4=').display, '20');
    t.eq(mk('std').type('1,5+2.5=').display, '4');
    t.eq(mk('std').type('9@').display, '3');
    t.eq(mk('std').type('4q').display, '16');
    t.eq(mk('std').type('4r').display, '0,25');
    t.eq(mk('std').type('200+10%=').display, '220');
    t.eq(mk('std').type('(2+3)=').display, '5'); // parentheses do nothing in standard mode
    t.eq(E.keyForChar('^', 'std'), null);
    t.eq(E.keyForChar('^', 'sci'), 'pow');
    t.eq(E.keyForChar('%', 'sci'), 'mod');
    t.eq(E.keyForChar('%', 'std'), 'pct');
    t.eq(E.keyForChar('x', 'std'), null);
    t.eq(E.keyForChar('7', 'std'), '7');
  });

  // =====================================================================================================================
  // engine: scientific mode
  // =====================================================================================================================
  T.test('bilimsel: öncelik, parantez ve otomatik kapatma', (t) => {
    t.eq(sci('2 add 3 mul 4 eq').display, '14');
    t.eq(sci('2 add 3 mul 4 eq').expression, '2 + 3 × 4 =');
    t.eq(sci('lp 2 add 3 rp mul 4 eq').display, '20');
    t.eq(sci('lp 2 add 3 rp mul 4 eq').expression, '(2 + 3) × 4 =');
    t.eq(sci('2 pow 3 pow 2 eq').display, '512');
    t.eq(sci('2 mul 3 pow 2 eq').display, '18');
    t.eq(sci('10 sub 4 sub 3 eq').display, '3');
    t.eq(sci('2 add lp 3 mul lp 4 add 1 rp rp eq').display, '17');
    t.eq(sci('lp 2 add 3 eq').display, '5');
    t.eq(sci('lp 2 add 3 eq').expression, '(2 + 3) =');
    t.eq(sci('lp lp 1').openParens, 2);
    t.eq(sci('lp lp 1 rp').openParens, 1);
    t.eq(sci('rp rp').openParens, 0);
    t.eq(sci('2 rp add 3 eq').display, '5');
    t.eq(sci('lp 1 add 2 rp').display, '3');
    t.eq(sci('lp 1 add 2 rp').expression, '(1 + 2)');
    t.eq(sci('2 mul lp 3 add 4 rp').expression, '2 × (3 + 4)');
    t.eq(sci('2 add').expression, '2 +');
    t.eq(sci('2 add mul 3 eq').display, '6');
    t.eq(sci('2 add eq').display, '4');
    t.eq(sci('7 mod 3 eq').display, '1');
    t.eq(sci('7 mod 3 eq').expression, '7 mod 3 =');
    t.eq(sci('8 yroot 3 eq').display, '2');
    t.eq(sci('27 yroot 3 eq').expression, '27 yroot 3 =');
    t.eq(sci('2 add 3 eq eq').display, '8');
    t.eq(sci('2 add 3 mul 4 eq eq').display, '56'); // repeats × 4
    t.eq(sci('2 add 3 eq mul 2 eq').display, '10');
    t.eq(sci('5 eq').display, '5');
    t.eq(sci('1 add 2 mul 3 sub 4 div 2 eq').display, '5');
  });

  T.test('bilimsel: kapalı grup, örtük çarpma ve gruba işlev', (t) => {
    t.eq(sci('2 lp 3 add 4 rp eq').display, '14');
    t.eq(sci('2 lp 3 add 4 rp eq').expression, '2 × (3 + 4) =');
    t.eq(sci('lp 1 add 2 rp lp 3 add 4 rp eq').display, '21');
    t.eq(sci('lp 1 add 2 rp 4 eq').display, '12');
    let c = sci('lp 2 add 3 rp sqr');
    t.eq(c.display, '25');
    t.eq(c.expression, 'sqr(2 + 3)');
    t.eq(c.openParens, 0);
    t.eq(sci('lp 2 add 3 rp sqr eq').display, '25');
    t.eq(sci('lp 2 add 3 rp sqr eq').expression, 'sqr(2 + 3) =');
    t.eq(sci('1 add lp 2 add 3 rp sqr eq').display, '26');
    t.eq(sci('2 mul lp 4 sqrt add 1 rp eq').display, '6'); // 2 × (√(4) + 1)
    t.eq(sci('lp 2 add 3 rp neg eq').display, '-5');
  });

  T.test('bilimsel: trigonometri, derece ve radyan', (t) => {
    let c = sci('30 sin');
    t.eq(c.display, '0,5');
    t.eq(c.expression, 'sin(30)');
    t.eq(sci('60 cos').display, '0,5');
    t.eq(sci('45 tan').display, '1');
    t.eq(sci('90 sin').display, '1');
    t.eq(sci('180 sin').display, '0');
    t.eq(sci('90 cos').display, '0');
    t.eq(sci('90 tan').display, 'Geçersiz giriş');
    t.eq(sci('0 dec 5 asin').display, '30');
    t.eq(sci('0 dec 5 acos').display, '60');
    t.eq(sci('1 atan').display, '45');
    t.eq(sci('2 asin').display, 'Geçersiz giriş');
    t.eq(sci('30 sin add 1 eq').display, '1,5');
    t.eq(sci('2 mul 30 sin eq').display, '1');
    t.eq(sci('2 mul 30 sin eq').expression, '2 × sin(30) =');
    t.eq(sci('30 sin sin').expression, 'sin(sin(30))');
    c = sci('pi sin', { angle: 'rad' });
    t.eq(c.display, '0');
    t.eq(sci('pi cos', { angle: 'rad' }).display, '-1');
    t.eq(sci('1 asin', { angle: 'rad' }).display, '1,5707963267949');
    c = sci('90 sin');
    c.setAngle('rad');
    t.eq(c.angle, 'rad');
    keys(c, 'c 0 sin');
    t.eq(c.display, '0');
    t.eq(sci('pi').display, '3,14159265358979');
    t.eq(sci('e').display, '2,71828182845905');
    t.eq(sci('2 mul pi eq').display, '6,28318530717959');
    t.eq(sci('pi sub pi eq').display, '0');
  });

  T.test('bilimsel: log, üs, faktöriyel ve diğer işlevler', (t) => {
    t.eq(sci('100 log').display, '2');
    t.eq(sci('0 log').display, 'Geçersiz giriş');
    t.eq(sci('1 ex').display, '2,71828182845905');
    t.eq(sci('e ln').display, '1');
    t.eq(sci('0 ln').display, 'Geçersiz giriş');
    t.eq(sci('2 p10').display, '100');
    t.eq(sci('3 p2').display, '8');
    t.eq(sci('3 cube').display, '27');
    t.eq(sci('27 cbrt').display, '3');
    t.eq(sci('5 fact').display, '120');
    t.eq(sci('20 fact').display, '2,43290200817664e+18');
    t.eq(sci('170 fact').display, '7,257415615308e+306'); // BigInt keeps 170! correctly rounded
    t.eq(sci('171 fact').display, 'Taşma');
    t.eq(sci('3 dec 5 fact').display, 'Geçersiz giriş');
    t.eq(sci('3 neg fact').display, 'Geçersiz giriş');
    t.eq(sci('5 neg abs').display, '5');
    t.eq(sci('2 dec 7 floor').display, '2');
    t.eq(sci('2 dec 7 neg floor').display, '-3');
    t.eq(sci('2 pow 10 eq').display, '1.024');
    t.eq(sci('2 pow 0 dec 5 eq').display, '1,4142135623731');
    t.eq(sci('0 pow 0 eq').display, 'Geçersiz giriş');
    t.eq(sci('2 neg pow 0 dec 5 eq').display, 'Geçersiz giriş');
    t.eq(sci('0 pow 1 neg eq').display, 'Sıfıra bölünemez');
    t.eq(sci('5 mod 0 eq').display, 'Sıfıra bölünemez');
    t.eq(sci('4 yroot 0 eq').display, 'Geçersiz giriş');
    t.eq(sci('4 neg yroot 2 eq').display, 'Geçersiz giriş');
    t.eq(sci('10 pow 400 eq').display, 'Taşma');
    t.eq(sci('5 div 0 eq').display, 'Sıfıra bölünemez');
  });

  T.test('bilimsel: EXP ile üstel giriş', (t) => {
    let c = sci('2 expo');
    t.eq(c.display, '2e+');
    c = sci('2 expo 3');
    t.eq(c.display, '2e+3');
    c.press('eq');
    t.eq(c.display, '2.000');
    c = sci('2 expo neg 3');
    t.eq(c.display, '2e-3');
    c.press('eq');
    t.eq(c.display, '0,002');
    t.eq(sci('2 dec 5 expo 2 eq').display, '250');
    t.eq(sci('2 expo 1 2 3 4').display, '2e+123'); // at most three exponent digits
    t.eq(sci('2 expo 3 back').display, '2e+');
    t.eq(sci('2 expo 3 back back').display, '2');
    t.eq(sci('2 expo expo 3').display, '2e+3');
    t.eq(sci('2 expo 3 add 1 eq').display, '2.001');
    t.eq(sci('5 expo 2 mul 2 eq').display, '1.000');
  });

  T.test('bilimsel: mod değişimi değeri korur', (t) => {
    const c = std('1 2 add 3');
    c.setMode('sci');
    t.eq(c.mode, 'sci');
    t.eq(c.display, '3');
    t.eq(c.expression, '');
    keys(c, 'add 4 eq');
    t.eq(c.display, '7');
    c.setMode('std');
    t.eq(c.display, '7');
    keys(c, 'mul 2 eq');
    t.eq(c.display, '14');
    const d = std('5 div 0 eq');
    d.setMode('sci');
    t.eq(d.display, '0');
    t.eq(d.error, null);
  });

  T.test('motor: geçmişten geri yükleme ve değer girişi', (t) => {
    let c = std('5 add');
    c.restore(42, '6 × 7');
    t.eq(c.display, '42');
    keys(c, 'eq');
    t.eq(c.display, '47');
    c = std('c');
    c.restore(42, '6 × 7');
    t.eq(c.display, '42');
    t.eq(c.expression, '6 × 7 =');
    keys(c, 'add 1 eq');
    t.eq(c.display, '43');
    c = std('5 div 0 eq');
    c.restore(9, '3 × 3');
    t.eq(c.display, '9');
    t.eq(c.error, null);
    c.enterNumber(12.5);
    t.eq(c.display, '12,5');
    c.enterNumber(3, '1 + 2');
    t.eq(c.display, '3');
    t.eq(c.expression, '1 + 2');
    t.eq(c.copyText, '3');
    t.eq(std('1234567 dec 5').copyText, '1234567,5');
    t.eq(std('5 div 0 eq').copyText, '');
    t.eq(std('12 dec').copyText, '12', 'sonda yarım kalmış virgül kopyalanmamalı');
    t.eq(std('1 dec 50').copyText, '1,50');
    t.eq(sci('2 expo').copyText, '2');
    t.eq(sci('2 expo 3').copyText, '2e+3');
    t.eq(std('1234 neg').copyText, '-1234');
  });

  T.test('motor: rastgele tuş dizileri hiç hata fırlatmaz ve ekran hep geçerli kalır', (t) => {
    const E = engine();
    let seed = 20240607;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const all = [...'0123456789'.split(''), 'dec', 'neg', 'add', 'sub', 'mul', 'div', 'pow', 'yroot', 'mod', 'eq', 'pct', 'ce', 'c', 'back',
      'lp', 'rp', 'expo', 'pi', 'e', 'mc', 'mr', 'mp', 'mm', 'ms', 'recip', 'sqr', 'sqrt', 'cube', 'cbrt', 'abs', 'fact', 'ln', 'log', 'ex',
      'p10', 'p2', 'floor', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'zzz'];
    const digitsHeavy = [...'0123456789'.split(''), 'dec', 'add', 'sub', 'mul', 'div', 'eq', 'neg', 'back', 'eq'];
    const messages = Object.values(E.MESSAGES);
    let evals = 0;
    for (const mode of ['std', 'sci']) {
      for (let run = 0; run < 60; run++) {
        const c = mk(mode, { angle: rnd() < 0.5 ? 'deg' : 'rad' });
        c.onEval = () => { evals++; };
        const pool = run % 3 === 0 ? digitsHeavy : all;
        for (let step = 0; step < 150; step++) {
          const k = pick(pool);
          c.press(k);
          const d = c.display;
          const ex = c.expression;
          t.ok(typeof d === 'string' && d.length > 0, 'boş ekran, anahtar ' + k);
          t.ok(!/NaN|Infinity|undefined|null|\[object/.test(d + ' ' + ex), 'geçersiz metin: ' + d + ' | ' + ex + ' (' + k + ')');
          if (c.error) t.ok(messages.indexOf(c.error) >= 0, 'bilinmeyen hata: ' + c.error);
          else {
            t.ok(/^-?\d[\d.]*(,\d*)?(e[+-]\d*)?$/.test(d), 'ekran biçimi: ' + d + ' (' + k + ')');
            t.ok(Number.isFinite(c.value), 'sonlu değer bekleniyordu: ' + d);
          }
          t.ok(c.openParens >= 0);
        }
      }
    }
    t.ok(evals > 20, 'rastgele dizilerde hiç hesap yapılmadı: ' + evals);
  });

  // =====================================================================================================================
  // UI
  // =====================================================================================================================
  T.test('arayüz: pencere ve düğmeler (standart)', async (t) => {
    const win = open();
    t.ok(win, 'pencere açılmadı');
    t.ok(win.body.classList.contains('app-calculator'));
    t.eq(win.getTitle(), 'Hesap Makinesi');
    const b = win.getBounds();
    t.eq([b.width, b.height], [340, 540]);
    t.eq([win.minWidth, win.minHeight], [300, 460]);
    t.eq($$('.ck', win.body).length, 24);
    t.eq($$('.cm', win.body).length, 5);
    t.eq(result(win), '0');
    t.eq(expr(win), '');
    t.ok(key(win, 'mc').disabled && key(win, 'mr').disabled, 'bellek boşken MC/MR kapalı olmalı');
    t.ok(!key(win, 'mp').disabled);
    t.ok($('.cd-mem', win.body).hidden);
    t.ok($('.calc-angle', win.body).hidden, 'DEG/RAD yalnız bilimselde görünür');
    // every key is labelled
    $$('button', win.body).forEach((btn) => t.ok(btn.getAttribute('aria-label') || btn.textContent.trim(), 'etiketsiz düğme: ' + btn.className));
    t.eq($('.cd-result', win.body).getAttribute('aria-live'), 'polite');
    // mode switch shows its state
    t.eq($$('.calc-modes button', win.body).map((x) => x.classList.contains('active')), [true, false]);
    // number keys differ from function keys (both themes)
    for (const theme of ['dark', 'light']) {
      P.theme.set(theme);
      const num = getComputedStyle(key(win, '5')).backgroundColor;
      const fn = getComputedStyle(key(win, 'ce')).backgroundColor;
      const eq = getComputedStyle(key(win, 'eq')).backgroundColor;
      t.ok(num !== fn, `${theme}: sayı ve işlev tuşları aynı renk`);
      t.ok(eq !== num && eq !== fn, `${theme}: = tuşu vurgu rengi olmalı`);
    }
    P.theme.set('dark');
    win.forceClose();
  });

  T.test('arayüz: fare ile hesaplama', async (t) => {
    const win = open();
    click(t, win, '12 add 3');
    t.eq(result(win), '3');
    t.eq(expr(win), '12 +');
    t.click(key(win, 'eq'));
    t.eq(result(win), '15');
    t.eq(expr(win), '12 + 3 =');
    t.click(key(win, 'eq'));
    t.eq(result(win), '18');
    click(t, win, 'c 1234567 dec 8 9');
    t.eq(result(win), '1.234.567,89');
    click(t, win, 'back back');
    t.eq(result(win), '1.234.567,');
    click(t, win, 'c 9 sqrt');
    t.eq(result(win), '3');
    t.eq(expr(win), '√(9)');
    click(t, win, 'c 8 recip');
    t.eq(result(win), '0,125');
    click(t, win, 'c 5 neg');
    t.eq(result(win), '-5');
    click(t, win, 'c 200 add 10 pct eq');
    t.eq(result(win), '220');
    click(t, win, 'c 0 div 0 eq');
    t.eq(result(win), 'Sıfıra bölünemez');
    t.eq(expr(win), '0 ÷ 0 =');
    click(t, win, '4');
    t.eq(result(win), '4');
    t.eq(expr(win), '');
    // the mouse never parks focus on a button, so Enter still means "="
    t.ok(!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.ck')), 'düğme odağı almamalı');
    win.forceClose();
  });

  T.test('arayüz: klavye', async (t) => {
    const win = open();
    typeKeys(t, win, '7*6');
    t.eq(expr(win), '7 ×');
    t.key(win.el, 'Enter');
    t.eq(result(win), '42');
    t.eq(expr(win), '7 × 6 =');
    typeKeys(t, win, '+1=');
    t.eq(result(win), '43');
    t.key(win.el, 'Escape');
    t.eq(result(win), '0');
    typeKeys(t, win, '123');
    t.key(win.el, 'Backspace');
    t.eq(result(win), '12');
    typeKeys(t, win, '.5');
    t.eq(result(win), '12,5');
    typeKeys(t, win, ',9');
    t.eq(result(win), '12,59');
    t.key(win.el, 'Delete');
    t.eq(result(win), '0');
    typeKeys(t, win, '5');
    t.key(win.el, 'F9');
    t.eq(result(win), '-5');
    t.key(win.el, 'F9');
    typeKeys(t, win, 'q');
    t.eq(result(win), '25');
    typeKeys(t, win, '@');
    t.eq(result(win), '5');
    typeKeys(t, win, 'r');
    t.eq(result(win), '0,2');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '200+10%');
    t.eq(result(win), '20');
    t.key(win.el, 'Enter');
    t.eq(result(win), '220');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '8/4-1=');
    t.eq(result(win), '1');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '5/0=');
    t.eq(result(win), 'Sıfıra bölünemez');
    t.key(win.el, 'Escape');
    t.eq(result(win), '0');
    // '=' key, ctrl combos and unrelated keys do nothing harmful
    typeKeys(t, win, '2+3');
    t.key(win.el, '=');
    t.eq(result(win), '5');
    t.key(win.el, 'a');
    t.key(win.el, 'x');
    t.key(win.el, 'Tab');
    t.eq(result(win), '5');
    // auto-repeat does not repeat "="
    t.key(win.el, 'Escape');
    typeKeys(t, win, '2+3');
    t.key(win.el, 'Enter');
    const rep = t.key(win.el, 'Enter', { repeat: true });
    t.eq(result(win), '5');
    t.ok(rep.defaultPrevented);
    // keys that do not exist in standard mode are ignored
    typeKeys(t, win, '(^!');
    t.eq(result(win), '5');
    win.forceClose();
  });

  T.test('arayüz: AltGr, odaklı düğme ve geçmiş listesinde oklar', async (t) => {
    const win = open();
    // '@' on a Turkish keyboard is AltGr+Q: Windows reports ctrl+alt together, it must not be taken for a shortcut
    typeKeys(t, win, '9');
    t.key(win.el, '@', { ctrlKey: true, altKey: true, modifierAltGraph: true });
    t.eq(result(win), '3');
    // a real Ctrl+Alt shortcut is not a calculator key
    t.key(win.el, '5', { ctrlKey: true, altKey: true });
    t.eq(result(win), '3');
    // a Tab-focused keypad button keeps its own Enter / Space activation: the window must not also press "="
    click(t, win, 'c 2 add 3');
    const five = key(win, '5');
    five.focus();
    const ev = t.key(five, 'Enter');
    t.ok(!ev.defaultPrevented, 'odaklı düğmede Enter yerel davranışı korumalı');
    t.eq(result(win), '3');
    document.activeElement.blur();
    win.el.focus();
    // arrow keys walk through the history list
    click(t, win, 'c 1 add 1 eq');
    click(t, win, 'c 2 add 2 eq');
    click(t, win, 'c 3 add 3 eq');
    win.state.api.setHistory(true);
    const items = $$('.ch-item', win.body);
    t.eq(items.length, 3);
    items[0].focus();
    t.key(items[0], 'ArrowDown');
    t.ok(document.activeElement === items[1], 'ArrowDown bir sonrakine geçmeli');
    t.key(items[1], 'ArrowDown');
    t.ok(document.activeElement === items[2]);
    t.key(items[2], 'ArrowDown');
    t.ok(document.activeElement === items[2], 'son öğede kalmalı');
    t.key(items[2], 'ArrowUp');
    t.ok(document.activeElement === items[1], 'ArrowUp bir öncekine dönmeli');
    // Enter on a focused history item belongs to the item
    const enter = t.key(items[1], 'Enter');
    t.ok(!enter.defaultPrevented);
    win.forceClose();
  });

  T.test('arayüz: tuş basışında düğme yanıp söner', async (t) => {
    const win = open();
    t.key(win.el, '5');
    t.ok(key(win, '5').classList.contains('flash'), '5 düğmesi parlamalı');
    t.key(win.el, '+');
    t.ok(key(win, 'add').classList.contains('flash'));
    t.key(win.el, 'Enter');
    t.ok(key(win, 'eq').classList.contains('flash'));
    t.key(win.el, 'Backspace');
    t.ok(key(win, 'back').classList.contains('flash'));
    t.key(win.el, 'Escape');
    t.ok(key(win, 'c').classList.contains('flash'));
    t.key(win.el, 'Delete');
    t.ok(key(win, 'ce').classList.contains('flash'));
    t.key(win.el, ',');
    t.ok(key(win, 'dec').classList.contains('flash'));
    t.key(win.el, 'F9');
    t.ok(key(win, 'neg').classList.contains('flash'));
    t.key(win.el, '%');
    t.ok(key(win, 'pct').classList.contains('flash'));
    t.key(win.el, 'q');
    t.ok(key(win, 'sqr').classList.contains('flash'));
    await t.waitFor(() => !$('.flash', win.body), 1000, 'parlama kalkmadı');
    win.forceClose();
  });

  T.test('arayüz: sonuç yazısı sığacak şekilde küçülür', async (t) => {
    const win = open();
    const r = $('.cd-result', win.body);
    const base = parseFloat(r.style.fontSize);
    t.ok(base >= 36, 'başlangıç yazı boyutu büyük olmalı: ' + base);
    click(t, win, '1234567890123456');
    t.eq(result(win), '1.234.567.890.123.456');
    const small = parseFloat(r.style.fontSize);
    t.ok(small < base, `uzun sayı için yazı küçülmeli (${small} < ${base})`);
    t.ok(r.scrollWidth <= r.clientWidth + 1, 'sonuç taşmamalı');
    click(t, win, 'mul 1234567890123456 eq');
    t.eq(result(win), '1,52415787532388e+30');
    t.ok(r.scrollWidth <= r.clientWidth + 1, 'üstel sonuç taşmamalı');
    click(t, win, 'c 5 div 0 eq');
    t.ok(r.scrollWidth <= r.clientWidth + 1, 'hata metni taşmamalı');
    t.ok($('.cd-result', win.body).classList.contains('is-error'));
    click(t, win, 'c');
    t.eq(parseFloat(r.style.fontSize), base, 'kısa sayıda yazı eski boyuna dönmeli');
    // a very long expression stays on one line and shows its tail
    click(t, win, '1 add 2 add 3 add 4 add 5 add 6 add 7 add 8 add 9 add 10 add 11 add 12 add 13 add');
    const ex = $('.cd-expr', win.body);
    t.ok(ex.scrollWidth > ex.clientWidth, 'ifade satırı taşmalı');
    t.ok(ex.classList.contains('is-clipped'));
    t.ok(ex.scrollLeft + ex.clientWidth >= ex.scrollWidth - 1, 'ifadenin sonu görünmeli');
    t.ok(expr(win).endsWith('13 +'));
    win.forceClose();
  });

  T.test('arayüz: pano - kopyala ve yapıştır', async (t) => {
    const win = open();
    click(t, win, '1234567 dec 5');
    const copyEv = t.key(win.el, 'c', { ctrlKey: true });
    t.ok(copyEv.defaultPrevented, 'Ctrl+C yakalanmalı');
    t.eq(win.state.lastCopied, '1234567,5');
    await t.waitFor(() => $('.cd-chip', win.body).textContent.length > 0, 2000);
    click(t, win, 'c 6 mul 7 eq');
    t.key(win.el, 'c', { ctrlKey: true });
    t.eq(win.state.lastCopied, '42');
    click(t, win, 'c 5 div 0 eq');
    win.state.lastCopied = null;
    t.key(win.el, 'c', { ctrlKey: true });
    t.eq(win.state.lastCopied, null, 'hata kopyalanmamalı');
    // paste through the real paste event
    const paste = (text) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      win.el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    click(t, win, 'c');
    paste('1.234,5');
    t.eq(result(win), '1.234,5');
    click(t, win, 'add 1 eq');
    t.eq(result(win), '1.235,5');
    click(t, win, 'c');
    paste('3.14');
    t.eq(result(win), '3,14');
    click(t, win, 'c');
    paste('  -42 ');
    t.eq(result(win), '-42');
    click(t, win, 'c');
    paste('2+3*4');
    t.eq(result(win), '14');
    t.eq(expr(win), '2+3*4');
    click(t, win, 'c');
    paste('abc');
    t.eq(result(win), '0');
    t.eq($('.cd-chip', win.body).textContent, 'Yapıştırılamadı');
    paste('');
    t.eq(result(win), '0');
    win.forceClose();
  });

  T.test('arayüz: bellek düğmeleri ve kalıcılık', async (t) => {
    const win = open();
    click(t, win, '5 ms');
    t.ok(!$('.cd-mem', win.body).hidden, 'M göstergesi görünmeli');
    t.ok(!key(win, 'mc').disabled && !key(win, 'mr').disabled);
    t.eq(P.storage.get('app.calculator').memory, 5);
    click(t, win, 'c 3 mp mr');
    t.eq(result(win), '8');
    click(t, win, 'c 2 mm mr');
    t.eq(result(win), '6');
    t.eq(P.storage.get('app.calculator').memory, 6);
    t.key(win.el, 'l', { ctrlKey: true });
    t.ok($('.cd-mem', win.body).hidden, 'MC sonrası M gizlenmeli');
    t.ok(key(win, 'mr').disabled);
    t.eq(P.storage.get('app.calculator').memory, null);
    t.key(win.el, '9');
    t.key(win.el, 'm', { ctrlKey: true });
    t.eq(calcOf(win).memory, 9);
    t.key(win.el, 'Escape');
    t.key(win.el, 'r', { ctrlKey: true });
    t.eq(result(win), '9');
    t.ok(key(win, 'mr').classList.contains('flash'));
    t.key(win.el, 'p', { ctrlKey: true });
    t.eq(calcOf(win).memory, 18);
    t.key(win.el, 'q', { ctrlKey: true });
    t.eq(calcOf(win).memory, 9);
    win.forceClose();
    // a new window starts with the stored memory
    const w2 = P.apps.launch('calculator');
    t.eq(calcOf(w2).memory, 9);
    t.ok(!$('.cd-mem', w2.body).hidden);
    w2.forceClose();
  });

  T.test('arayüz: bilimsel mod, pencere boyutu ve DEG/RAD', async (t) => {
    const win = open();
    t.click($('[data-mode="sci"]', win.body));
    t.eq(calcOf(win).mode, 'sci');
    t.eq($$('.ck', win.body).length, 25 + 20);
    t.ok(!$('.calc-angle', win.body).hidden);
    const b = win.getBounds();
    t.ok(b.width >= 440 && b.height >= 600, `bilimsel pencere büyümeli: ${b.width}x${b.height}`);
    t.eq([win.minWidth, win.minHeight], [380, 520]);
    t.eq(P.storage.get('app.calculator').mode, 'sci');
    t.eq($$('.calc-modes button', win.body).map((x) => x.classList.contains('active')), [false, true]);
    // DEG default; RAD switch
    t.eq($$('.calc-angle button', win.body).map((x) => x.classList.contains('active')), [true, false]);
    click(t, win, '30 sin');
    t.eq(result(win), '0,5');
    t.eq(expr(win), 'sin(30)');
    t.click($('[data-angle="rad"]', win.body));
    t.eq(calcOf(win).angle, 'rad');
    t.eq(P.storage.get('app.calculator').angle, 'rad');
    click(t, win, 'c pi sin');
    t.eq(result(win), '0');
    t.click($('[data-angle="deg"]', win.body));
    click(t, win, 'c 90 sin');
    t.eq(result(win), '1');
    t.key(win.el, 'F4');
    t.eq(calcOf(win).angle, 'rad');
    t.key(win.el, 'F3');
    t.eq(calcOf(win).angle, 'deg');
    // precedence and parentheses through the UI
    click(t, win, 'c 2 add 3 mul 4 eq');
    t.eq(result(win), '14');
    click(t, win, 'c lp lp');
    t.eq($('.ck-badge', win.body).textContent, '2');
    t.ok(!$('.ck-badge', win.body).hidden);
    click(t, win, 'c');
    t.ok($('.ck-badge', win.body).hidden);
    // 2nd: inverse trig
    t.eq(key(win, 'sin').textContent.replace(/\s/g, ''), 'sin');
    t.click($('[data-act="second"]', win.body));
    t.ok(win.state.api.isSecond());
    t.ok(key(win, 'asin') && key(win, 'acos') && key(win, 'atan'), 'ters trigonometri düğmeleri');
    t.ok(!key(win, 'sin'));
    t.eq($('[data-act="second"]', win.body).getAttribute('aria-pressed'), 'true');
    click(t, win, 'c 0 dec 5 asin');
    t.eq(result(win), '30');
    t.eq(expr(win), 'sin⁻¹(0,5)');
    t.key(win.el, 's');
    t.ok(key(win, 'asin').classList.contains('flash'), 'klavye 2nd durumunda ters işlevi tetiklemeli');
    t.click($('[data-act="second"]', win.body));
    t.ok(key(win, 'sin'));
    // switch back restores the old size
    t.key(win.el, '1', { altKey: true });
    t.eq(calcOf(win).mode, 'std');
    const b2 = win.getBounds();
    t.eq([b2.width, b2.height], [340, 540]);
    t.eq([win.minWidth, win.minHeight], [300, 460]);
    t.eq($$('.ck', win.body).length, 24);
    t.key(win.el, '2', { altKey: true });
    t.eq(calcOf(win).mode, 'sci');
    t.eq(P.storage.get('app.calculator').mode, 'sci');
    win.forceClose();
    // the mode is remembered by the next window; a window that was resized by the user keeps its size
    const w2 = P.apps.launch('calculator');
    t.eq(calcOf(w2).mode, 'sci');
    const bb = w2.getBounds();
    t.ok(bb.width >= 440 && bb.height >= 600);
    t.eq($$('.ck', w2.body).length, 45);
    w2.forceClose();
    const w3 = P.apps.launch('calculator', { mode: 'std' });
    t.eq(calcOf(w3).mode, 'std');
    w3.forceClose();
    P.storage.remove('app.calculator');
  });

  T.test('arayüz: bilimsel klavye kısayolları', async (t) => {
    const win = open({ mode: 'sci' });
    typeKeys(t, win, '2+3*4=');
    t.eq(result(win), '14');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '(2+3)*4=');
    t.eq(result(win), '20');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '2^10=');
    t.eq(result(win), '1.024');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '5!');
    t.eq(result(win), '120');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '7%3=');
    t.eq(result(win), '1');
    t.key(win.el, 'Escape');
    typeKeys(t, win, 'p');
    t.eq(result(win), '3,14159265358979');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '30s');
    t.eq(result(win), '0,5');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '100l');
    t.eq(result(win), '2');
    t.key(win.el, 'Escape');
    typeKeys(t, win, '2e3');
    t.eq(result(win), '2e+3');
    t.key(win.el, 'Escape');
    win.forceClose();
  });

  T.test('arayüz: geçmiş - kayıt, sınır, geri yükleme, temizleme', async (t) => {
    const win = open();
    t.eq(hist().length, 0);
    t.ok(!win.state.api.isHistoryVisible());
    click(t, win, '12 mul 3 eq');
    click(t, win, 'c 9 sqrt eq');
    click(t, win, 'c 2 add 3 eq eq');
    t.eq(hist().map((h) => [h.e, h.v]), [['5 + 3', 8], ['2 + 3', 5], ['√(9)', 3], ['12 × 3', 36]]);
    click(t, win, 'c 4 sqr');
    t.eq(hist().length, 4, 'tek başına işlev geçmişe yazılmaz');
    // toggle the panel (narrow window -> bottom sheet)
    const hb = $('[data-act="history"]', win.body);
    t.eq(hb.getAttribute('aria-pressed'), 'false');
    t.click(hb);
    t.ok(win.state.api.isHistoryVisible());
    const root = $('.calc-root', win.body);
    t.ok(root.classList.contains('hist-sheet'), 'dar pencerede alt sayfa olmalı');
    t.ok(!root.classList.contains('hist-side'));
    t.eq(hb.getAttribute('aria-pressed'), 'true');
    t.ok(!$('.calc-history', win.body).hidden);
    const items = $$('.ch-item', win.body);
    t.eq(items.length, 4);
    t.eq($('.ch-expr', items[0]).textContent, '5 + 3 =');
    t.eq($('.ch-res', items[0]).textContent, '8');
    t.eq($('.ch-res', items[3]).textContent, '36');
    t.ok($('.ch-empty', win.body).hidden);
    t.ok(!$('[data-act="hist-clear"]', win.body).disabled);
    // click restores the result and closes the sheet
    t.click(items[3]);
    t.eq(result(win), '36');
    t.eq(expr(win), '12 × 3 =');
    t.ok(!win.state.api.isHistoryVisible(), 'alt sayfa kapanmalı');
    click(t, win, 'add 4 eq');
    t.eq(result(win), '40');
    t.eq(hist().length, 5);
    // the sheet is a flyout: clicking the display above it dismisses it
    t.click(hb);
    t.ok(win.state.api.isHistoryVisible());
    t.click($('.cd-result', win.body));
    t.ok(!win.state.api.isHistoryVisible(), 'ekrana tıklayınca alt sayfa kapanmalı');
    t.eq(result(win), '40', 'tıklama hesabı değiştirmemeli');
    // keyboard: Ctrl+H toggles, Escape closes the sheet first
    t.key(win.el, 'h', { ctrlKey: true });
    t.ok(win.state.api.isHistoryVisible());
    t.key(win.el, 'Escape');
    t.ok(!win.state.api.isHistoryVisible());
    t.eq(result(win), '40', 'Escape önce sayfayı kapatmalı');
    t.key(win.el, 'h', { ctrlKey: true });
    t.click($('[data-act="hist-close"]', win.body));
    t.ok(!win.state.api.isHistoryVisible());
    // clear
    t.key(win.el, 'h', { ctrlKey: true });
    t.click($('[data-act="hist-clear"]', win.body));
    t.eq(hist().length, 0);
    t.eq($$('.ch-item', win.body).length, 0);
    t.ok(!$('.ch-empty', win.body).hidden, 'boş durum görünmeli');
    t.ok($('[data-act="hist-clear"]', win.body).disabled);
    t.eq($('.ch-empty strong', win.body).textContent, 'Henüz geçmiş yok');
    win.forceClose();
  });

  T.test('arayüz: geçmiş en çok 50 kayıt tutar ve saklanır', async (t) => {
    const win = open();
    for (let i = 1; i <= 55; i++) { click(t, win, `c ${i} add 1 eq`); }
    t.eq(hist().length, 50);
    t.eq([hist()[0].e, hist()[0].v], ['55 + 1', 56]);
    t.eq(hist()[49].e, '6 + 1');
    win.forceClose();
    const w2 = P.apps.launch('calculator');
    w2.state.api.setHistory(true);
    t.eq($$('.ch-item', w2.body).length, 50, 'yeni pencere kayıtları göstermeli');
    // corrupt storage never breaks the app
    P.storage.set('app.calculator', { history: [{ e: 5 }, null, { e: 'a', v: 'x' }, { e: '1 + 1', v: 2 }], memory: 'x', mode: 7, angle: 3 });
    w2.forceClose();
    const w3 = P.apps.launch('calculator');
    t.eq(calcOf(w3).mode, 'std');
    t.eq(calcOf(w3).memory, null);
    w3.state.api.setHistory(true);
    t.eq($$('.ch-item', w3.body).length, 1);
    w3.forceClose();
    P.storage.set('app.calculator', 'çöp');
    const w4 = P.apps.launch('calculator');
    t.ok(w4 && result(w4) === '0');
    w4.forceClose();
    P.storage.remove('app.calculator');
  });

  T.test('arayüz: geniş pencerede geçmiş yan panel olur', async (t) => {
    const win = open();
    win.setSize(900, 620);
    win.state.api.layout();
    const root = $('.calc-root', win.body);
    t.ok(root.classList.contains('is-wide'));
    t.ok(root.classList.contains('hist-side'), 'geniş pencerede panel kendiliğinden açılmalı');
    t.ok(win.state.api.isHistoryVisible());
    const panel = $('.calc-history', win.body);
    t.ok(!panel.hidden);
    t.eq(Math.round(panel.getBoundingClientRect().width), 280);
    const main = $('.calc-main', win.body).getBoundingClientRect();
    t.ok(main.right <= panel.getBoundingClientRect().left + 1, 'panel ana alanı kapatmamalı');
    t.ok(getComputedStyle($('.ch-close', win.body)).display === 'none', 'yan panelde kapat düğmesi gizli');
    // the user can close it, and it stays closed while wide
    t.click($('[data-act="history"]', win.body));
    t.ok(!win.state.api.isHistoryVisible());
    t.ok($('.calc-history', win.body).hidden);
    t.ok(!root.classList.contains('hist-side'));
    t.click($('[data-act="history"]', win.body));
    t.ok(win.state.api.isHistoryVisible());
    // pressing "=" shows up in the open panel at once
    click(t, win, '6 mul 7 eq');
    t.eq($('.ch-res', win.body).textContent, '42');
    // narrow again: the wide-layout choice does not force the sheet open over the keypad
    win.setSize(340, 540);
    win.state.api.layout();
    t.ok(!root.classList.contains('is-wide'));
    t.ok(!win.state.api.isHistoryVisible());
    t.ok($('.calc-history', win.body).hidden);
    // maximized: still fits
    win.maximize();
    await t.sleep(30);
    win.state.api.layout();
    t.ok(root.classList.contains('hist-side') || !win.state.api.isHistoryVisible());
    const pad = $('.calc-pad', win.body).getBoundingClientRect();
    t.ok(pad.width > 300 && pad.height > 200);
    win.forceClose();
  });

  T.test('arayüz: bağlam menüleri', async (t) => {
    const win = open();
    click(t, win, '6 mul 7 eq');
    const ev = t.contextmenu($('.calc-display', win.body));
    t.ok(ev.defaultPrevented);
    t.ok(P.contextMenu.isOpen(), 'menü açılmalı');
    const labels = () => $$('#context-menu-layer .ctx-item .ctx-label').map((x) => x.textContent);
    t.eq(labels(), ['Kopyala', 'Yapıştır']);
    t.click($$('#context-menu-layer .ctx-item')[0]);
    t.eq(win.state.lastCopied, '42');
    await t.waitFor(() => !P.contextMenu.isOpen());
    // history item menu
    click(t, win, 'c 8 div 2 eq');
    win.state.api.setHistory(true);
    const first = $('.ch-item', win.body);
    t.contextmenu(first);
    t.eq(labels(), ['Sonucu kullan', 'Sonucu kopyala', 'İfadeyi kopyala', 'Sil', 'Geçmişi temizle']);
    t.click($$('#context-menu-layer .ctx-item')[3]); // Sil
    await t.waitFor(() => !P.contextMenu.isOpen());
    t.eq(hist().map((h) => h.e), ['6 × 7']);
    t.eq($$('.ch-item', win.body).length, 1);
    t.contextmenu($('.ch-item', win.body));
    t.click($$('#context-menu-layer .ctx-item')[1]); // Sonucu kopyala
    t.eq(win.state.lastCopied, '42');
    await t.waitFor(() => !P.contextMenu.isOpen());
    t.contextmenu($('.ch-item', win.body));
    t.click($$('#context-menu-layer .ctx-item')[2]); // İfadeyi kopyala
    t.eq(win.state.lastCopied, '6 × 7 = 42');
    await t.waitFor(() => !P.contextMenu.isOpen());
    t.contextmenu($('.ch-item', win.body));
    t.click($$('#context-menu-layer .ctx-item')[0]); // Sonucu kullan
    t.eq(result(win), '42');
    await t.waitFor(() => !P.contextMenu.isOpen());
    t.contextmenu($('.ch-item', win.body));
    t.click($$('#context-menu-layer .ctx-item')[4]); // Geçmişi temizle
    t.eq(hist().length, 0);
    await t.waitFor(() => !P.contextMenu.isOpen());
    win.forceClose();
  });

  T.test('arayüz: çoklu pencere ve geçmiş eşitleme', async (t) => {
    const a = open();
    const b = P.apps.launch('calculator');
    t.ok(a && b && a !== b, 'çoklu pencere');
    t.eq(P.apps.running('calculator').length, 2);
    a.state.api.setHistory(true);
    b.state.api.setHistory(true);
    click(t, a, '3 add 4 eq');
    t.eq($$('.ch-item', b.body).length, 1, 'ikinci pencere de güncellenmeli');
    t.eq($('.ch-res', b.body).textContent, '7');
    // separate calculators
    click(t, b, '5');
    t.eq(result(a), '7');
    t.eq(result(b), '5');
    a.forceClose();
    click(t, b, 'add 1 eq');
    t.eq(result(b), '6');
    t.eq($$('.ch-item', b.body).length, 2);
    b.forceClose();
    // events after close never throw
    P.bus.emit('calculator:history', {});
    t.eq(P.apps.running('calculator').length, 0);
  });

  T.test('arayüz: en küçük boyutta her şey görünür', async (t) => {
    const win = open();
    win.setSize(10, 10);
    const b = win.getBounds();
    t.eq([b.width, b.height], [300, 460]);
    click(t, win, '1234567 dec 89');
    const pad = $('.calc-pad', win.body).getBoundingClientRect();
    const keys = $$('.ck', win.body);
    keys.forEach((k) => {
      const r = k.getBoundingClientRect();
      t.ok(r.width >= 40 && r.height >= 28, `düğme çok küçük: ${k.dataset.k} ${r.width}x${r.height}`);
      t.ok(r.left >= pad.left - 1 && r.right <= pad.right + 1 && r.top >= pad.top - 1 && r.bottom <= pad.bottom + 1, 'düğme dışarı taşıyor: ' + k.dataset.k);
    });
    const disp = $('.calc-display', win.body).getBoundingClientRect();
    t.ok(disp.height >= 100, 'ekran çok küçük: ' + disp.height);
    const r = $('.cd-result', win.body);
    t.ok(r.scrollWidth <= r.clientWidth + 1);
    // scientific minimum
    t.click($('[data-mode="sci"]', win.body));
    win.setSize(10, 10);
    const b2 = win.getBounds();
    t.eq([b2.width, b2.height], [380, 520]);
    win.state.api.layout();
    const pad2 = $('.calc-pad', win.body).getBoundingClientRect();
    $$('.ck', win.body).forEach((k) => {
      const rr = k.getBoundingClientRect();
      t.ok(rr.width >= 32 && rr.height >= 28, `bilimsel düğme çok küçük: ${k.dataset.k || k.dataset.act} ${rr.width}x${rr.height}`);
      t.ok(rr.left >= pad2.left - 1 && rr.right <= pad2.right + 1 && rr.bottom <= pad2.bottom + 1, 'bilimsel düğme taşıyor');
      // the label never spills over the key
      t.ok(k.scrollWidth <= k.clientWidth + 1, `etiket sığmıyor: ${k.dataset.k || k.dataset.act} ${k.scrollWidth}>${k.clientWidth}`);
    });
    t.ok($('.cd-result', win.body).scrollWidth <= $('.cd-result', win.body).clientWidth + 1);
    win.forceClose();
  });

  T.test('arayüz: kapanışta kaynaklar temizlenir', async (t) => {
    const win = open();
    const calc = calcOf(win);
    click(t, win, '1 add 2 eq');
    t.key(win.el, '5');
    const before = P.wm.list().length;
    const closed = await win.close();
    t.ok(closed);
    await t.sleep(30);
    t.eq(P.wm.list().length, before - 1);
    t.ok(win.isClosed());
    t.eq(calc.onEval, null, 'dinleyici bırakılmalı');
    // keys after close are not delivered; the flash timer left nothing behind
    P.bus.emit('calculator:history', {});
    // no stray clipboard helper element stays in the page
    t.eq($$('textarea[readonly]').filter((x) => x.style.left === '-9999px').length, 0);
    // tooltips detached: the shared tip does not keep pointing at a removed button
    if (P.ui && P.ui.tip && P.ui.tip.hide) P.ui.tip.hide();
    t.ok(!document.querySelector('.calc-root'));
  });

  T.test('arayüz: her abonelik ve ipucu kapanışta bırakılır (sızıntı yok)', async (t) => {
    const busOn = P.bus.on;
    const tipFn = P.ui && P.ui.tip;
    const subs = [];
    const tips = [];
    P.bus.on = function (evt, fn) {
      const off = busOn.call(P.bus, evt, fn);
      const wrapped = () => { wrapped.called = true; return off(); };
      subs.push({ evt, wrapped });
      return wrapped;
    };
    if (tipFn) {
      const wrapTip = function (node, text, delay) {
        const off = tipFn.call(P.ui, node, text, delay);
        const wrapped = () => { wrapped.called = true; return typeof off === 'function' ? off() : undefined; };
        // the window frame's own caption-button tips belong to the window manager: only count the app's
        if (node && node.classList && (node.classList.contains('ck') || node.classList.contains('cm') || node.classList.contains('calc-hist-btn'))) tips.push(wrapped);
        return wrapped;
      };
      wrapTip.hide = tipFn.hide;
      P.ui.tip = wrapTip;
    }
    let win;
    try {
      win = open({ mode: 'sci' });
      click(t, win, '2 add 3 eq');
      t.click($('[data-mode="std"]', win.body)); // rebuilds the keypad: its tips must be released at once
      t.click($('[data-mode="sci"]', win.body));
      t.ok(subs.some((s) => s.evt === 'calculator:history'), 'geçmiş olayına abone olunmalı');
      t.ok(tips.length > 40, 'ipuçları bağlanmalı: ' + tips.length);
      const releasedEarly = tips.filter((x) => x.called).length;
      t.ok(releasedEarly > 20, 'mod değişince eski tuş ipuçları bırakılmalı: ' + releasedEarly);
      await win.close();
    } finally {
      P.bus.on = busOn;
      if (tipFn) P.ui.tip = tipFn;
    }
    await t.sleep(30);
    t.ok(subs.length > 0);
    t.eq(subs.filter((s) => !s.wrapped.called).map((s) => s.evt), [], 'bırakılmayan bus aboneliği');
    t.eq(tips.filter((x) => !x.called).length, 0, 'bırakılmayan ipucu');
  });

  T.test('arayüz: masaüstü kısayolu ve başlatma bağımsız değişkenleri', async (t) => {
    closeAll();
    P.storage.remove('app.calculator');
    const path = P.fs.join(P.fs.HOME, 'Masaüstü', 'Hesap Makinesi.app');
    t.ok(P.fs.exists(path), 'tohum kısayol bulunamadı');
    const win = P.apps.openFile(path);
    t.ok(win && win.appId === 'calculator', 'kısayol hesap makinesini açmalı');
    t.eq(calcOf(win).mode, 'std');
    win.forceClose();
    // a shortcut may ask for the scientific mode; it must not overwrite the remembered mode
    const sciWin = P.apps.launch('calculator', { mode: 'sci' });
    t.eq(calcOf(sciWin).mode, 'sci');
    t.ok(!$('.calc-angle', sciWin.body).hidden);
    t.eq(P.storage.get('app.calculator', {}).mode || 'std', 'std');
    sciWin.forceClose();
    // unknown arguments are ignored
    const w = P.apps.launch('calculator', { mode: 'nope', path: 5 });
    t.eq(calcOf(w).mode, 'std');
    w.forceClose();
  });

  T.test('arayüz: kayıt bilgileri ve motor dışa aktarımı', (t) => {
    const def = P.apps.get('calculator');
    t.eq(def.id, 'calculator');
    t.eq(def.name, 'Hesap Makinesi');
    t.eq(def.icon, 'calculator');
    t.eq(def.singleInstance, false);
    t.eq(def.fileTypes, []);
    t.eq([def.window.width, def.window.height, def.window.minWidth, def.window.minHeight], [340, 540, 300, 460]);
    t.ok(def._engine && typeof def._engine.evaluate === 'function' && typeof def._engine.Calc === 'function');
    t.ok(P.icons.has('calculator'));
  });
}());
