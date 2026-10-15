(function () {
  'use strict';
  const P = window.PandaOS;
  const T = window.PandaTest;
  const SHOT = P.params.get('shot') || 'std';
  const keys = (c, list) => String(list).split(/\s+/).filter(Boolean).forEach((w) => {
    if (/^[0-9,]+$/.test(w)) [...w].forEach((ch) => c.press(ch === ',' ? 'dec' : ch)); else c.press(w);
  });
  T.test('qa shot ' + SHOT, async (t) => {
    P.storage.remove('app.calculator');
    const mode = /sci/.test(SHOT) ? 'sci' : 'std';
    const win = P.apps.launch('calculator', { mode });
    const api = win.state.api;
    await t.sleep(150);
    const run = (l) => { keys(win.state.calc, l); api.render(); };
    if (SHOT === 'std') run('1234567 dec 89 mul 3');
    if (SHOT === 'sci') run('lp 2 add 3 rp mul 4 sin');
    if (SHOT === 'fresh') {}
    if (SHOT === 'freshsci') {}
    if (SHOT === 'stdmax') { run('12 mul 3 eq'); win.maximize(); await t.sleep(150); }
    if (SHOT === 'scimax') { run('12 mul 3 eq'); win.maximize(); await t.sleep(150); }
    if (SHOT === 'stdsmall') { win.setSize(300, 460); await t.sleep(150); run('1234567 dec 89 add 3'); }
    if (SHOT === 'scismall') { win.setSize(380, 520); await t.sleep(150); run('lp 1 add 2 rp mul 3'); }
    if (SHOT === 'longres') { run('9999999999999999 mul 9999999999999999 eq'); }
    if (SHOT === 'longtyped') { run('1234567890123456'); }
    if (SHOT === 'mem') { run('5 ms 3 add'); }
    if (SHOT === 'error') run('5 div 0 eq');
    if (SHOT === 'hist') { run('12 mul 3 eq c 5 add 6 eq'); api.setHistory(true); await t.sleep(100); }
    if (SHOT === 'histempty') { api.setHistory(true); await t.sleep(100); }
    if (SHOT === 'histside') { run('12 mul 3 eq c 5 add 6 eq'); win.setSize(800, 560); await t.sleep(150); api.layout(); }
    if (SHOT === 'scihist') { run('12 mul 3 eq c 5 add 6 eq'); api.setHistory(true); await t.sleep(100); }
    if (SHOT === 'two') { win.setSize(340, 540); P.apps.launch('calculator', {}); await t.sleep(200); }
    if (SHOT === 'sciangle') { api.setAngle('rad'); run('3 dec 14 sin'); }
    if (SHOT === 'sci2nd') { win.body.querySelector('[data-act="second"]').click(); run('1 asin'); }
    if (SHOT === 'sciexp') { run('2 expo 3'); }
    if (SHOT === 'parens') { run('lp lp lp 1 add 2'); }
    await t.sleep(100);
  });
}());
