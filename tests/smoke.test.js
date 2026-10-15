/* Smoke test: the OS boots, core namespaces exist and no JS error was raised.
   Combine with open=… to smoke-test apps: bash tools/test.sh smoke "open=calculator" */
PandaTest.test('kernel yüklendi', (t) => {
  t.ok(window.PandaOS && PandaOS.bus && PandaOS.settings && PandaOS.apps, 'PandaOS çekirdeği eksik');
  t.ok(PandaOS.booted && PandaOS.ready, 'boot tamamlanmadı');
});

PandaTest.test('ayarlar ve tema', (t) => {
  const seen = [];
  const off = PandaOS.bus.on('settings:change', (e) => seen.push(e.key));
  PandaOS.theme.set('light');
  t.eq(document.documentElement.dataset.theme, 'light');
  PandaOS.theme.toggle();
  t.eq(document.documentElement.dataset.theme, 'dark');
  t.eq(seen, ['theme', 'theme']);
  off();
});

PandaTest.test('storage ad alanı', (t) => {
  PandaOS.storage.set('app.smoke', { a: 1 });
  t.eq(PandaOS.storage.get('app.smoke'), { a: 1 });
  t.eq(localStorage.getItem('pandaos.app.smoke'), '{"a":1}');
  PandaOS.storage.remove('app.smoke');
  t.eq(PandaOS.storage.get('app.smoke', 'yok'), 'yok');
});

PandaTest.test('util.el', (t) => {
  let clicked = 0;
  const n = PandaOS.util.el('button', { class: 'x y', dataset: { id: '7' }, text: 'Merhaba', on: { click: () => clicked++ }, tabIndex: 0 });
  n.click();
  t.eq([n.className, n.dataset.id, n.textContent, clicked, n.tabIndex], ['x y', '7', 'Merhaba', 1, 0]);
});

PandaTest.test('açılan uygulamalar hatasız', async (t) => {
  await t.sleep(500);
  const open = (PandaOS.params.get('open') || '').split(',').filter(Boolean);
  for (const id of open) t.ok(PandaOS.apps.running(id).length > 0, `${id} açık değil`);
});
