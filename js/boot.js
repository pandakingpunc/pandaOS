/* PandaOS boot sequence. Loaded last, after every module and app has registered itself. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const MODULES = ['contextMenu', 'notify', 'dialog', 'sound', 'wm', 'desktop', 'taskbar', 'startMenu', 'session'];

  function safe(name, fn) {
    try {
      return fn();
    } catch (e) {
      console.error(`[boot] ${name} başlatılamadı`, e);
      return undefined;
    }
  }

  async function safeAsync(name, fn) {
    try {
      return await fn();
    } catch (e) {
      console.error(`[boot] ${name} başarısız`, e);
      return undefined;
    }
  }

  async function runTests(suites) {
    await P.util.loadScript('tests/harness.js');
    for (const suite of suites) {
      try {
        await P.util.loadScript(`tests/${suite}.test.js`);
      } catch (e) {
        console.error(`[boot] test paketi yüklenemedi: ${suite}`, e);
      }
    }
    await window.PandaTest.run();
  }

  async function boot() {
    const params = P.params;
    const fast = params.get('fast') === '1';

    if (params.get('reset') === '1') P.storage.clearAll();
    const forcedTheme = params.get('theme');
    if (forcedTheme === 'light' || forcedTheme === 'dark') P.settings.set('theme', forcedTheme);
    P.theme.apply();

    safe('fs', () => P.fs && P.fs.init());
    for (const name of MODULES) {
      safe(name, () => P[name] && typeof P[name].init === 'function' && P[name].init());
    }
    P.booted = true;
    P.bus.emit('os:init');

    if (!fast) {
      await safeAsync('bootSplash', () => P.session && P.session.bootSplash && P.session.bootSplash());
      await safeAsync('lock', () => P.session && P.session.lock && P.session.lock({ initial: true }));
    }

    P.ready = true;
    P.bus.emit('os:ready');

    const open = params.get('open');
    if (open) {
      open.split(',').map((s) => s.trim()).filter(Boolean)
        .forEach((id) => safe(`open ${id}`, () => P.apps.launch(id)));
    }
    const file = params.get('file');
    if (file) safe(`file ${file}`, () => P.apps.openFile(file));

    const test = params.get('test');
    if (test) {
      await runTests(test.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (!fast) {
      setTimeout(() => {
        if (typeof P.notify === 'function') {
          P.notify({
            title: 'PandaOS\'a hoş geldin!',
            message: 'Başlat menüsünü açmak için sol alttaki panda simgesine tıkla.',
            icon: 'panda'
          });
        }
      }, 900);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
