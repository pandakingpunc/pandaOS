/* scratch suite (deleted before finishing): puts the clock into states for screenshots.
   ?shot=world|picker|alarm|alarm-empty|alarm-form|timer|timer-draft|timer-multi|stopwatch|stopwatch-empty|ring  &size=min|max */
PandaTest.test('shot', async (t) => {
  const P = PandaOS;
  const C = P.clock;
  const shot = P.params.get('shot') || 'world';
  const size = P.params.get('size');
  C.reset();
  const now = Date.now();
  const win = P.apps.launch('clock');
  win.setPosition(40, 20);
  if (size === 'min') win.setSize(520, 420);
  else if (size === 'max') win.maximize();
  else win.setSize(720, 540);
  const app = win.state.clock;
  const q = (s) => t.$(s, win.el);
  if (shot === 'world') { app.go('world'); }
  if (shot === 'world-many') { ['berlin','paris','dubai','delhi','pekin','rio','los-angeles'].forEach((c) => C.cities.add(c)); app.go('world'); }
  if (shot === 'picker') { app.go('world'); t.click(q('.ck-add-city')); }
  if (shot === 'picker-search') { app.go('world'); t.click(q('.ck-add-city')); const s = q('.ck-search'); s.value = 'ist'; s.dispatchEvent(new Event('input', { bubbles: true })); }
  if (shot.startsWith('alarm')) {
    app.go('alarm');
    if (shot !== 'alarm-empty') {
      C.alarm.add({ time: '07:30', label: 'Uyanma', days: [0, 1, 2, 3, 4] }, now);
      C.alarm.add({ time: '09:00', label: 'Toplantı', days: [] }, now);
      const a3 = C.alarm.add({ time: '13:15', label: 'Öğle yemeği', days: [5, 6] }, now);
      C.alarm.add({ time: '22:45', label: '', days: [0,1,2,3,4,5,6] }, now);
      C.alarm.toggle(a3.id, false, now);
      app.alarm.render();
    }
    if (shot === 'alarm-form') { t.click(q('.ck-add-alarm')); const d = t.$$('.ck-chip.day', win.el); t.click(d[0]); t.click(d[2]); }
    if (shot === 'alarm-edit') { t.click(q('.ck-acard-main')); }
  }
  if (shot.startsWith('timer')) {
    app.go('timer');
    if (shot === 'timer-multi') {
      const a = C.timer.add({ duration: 5 * 60000, label: 'Çay' }, now);
      const b = C.timer.add({ duration: 25 * 60000, label: 'Pomodoro' }, now - 4 * 60000);
      C.timer.pause(b.id, now);
      const c = C.timer.add({ duration: 90 * 60000, label: '' }, now);
      C.timer.reset(c.id);
      const d = C.timer.add({ duration: 10 * 1000, label: 'Yumurta' }, now - 20000);
      C.checkTimers(now);
      C.stopAll();
      C.timer.pause(a.id, now + 1000);
      C.timer.resume(a.id, now);
      app.timer.render();
    }
    if (shot === 'timer-run') { C.timer.add({ duration: 5 * 60000, label: 'Çay' }, now - 1000); app.timer.render(); }
  }
  if (shot.startsWith('stopwatch')) {
    app.go('stopwatch');
    if (shot !== 'stopwatch-empty') {
      const base = now - 83456;
      C.stopwatch.start(base);
      [9120, 21480, 30020, 41890, 49210, 63800].forEach((ms) => C.stopwatch.lap(base + ms));
      app.stopwatch.render();
    }
  }
  if (shot === 'ring') {
    app.go('alarm');
    const a = C.alarm.add({ time: '07:30', label: 'Uyanma', days: [0, 1, 2, 3, 4] }, now);
    const d = new Date(); d.setHours(7, 30, 5, 0);
    // fire it through the real service path with an injectable now
    a.armedAt = 0; 
    C.checkAlarms(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 7, 30, 5).getTime());
    app.alarm.render();
  }
  await t.sleep(400);
  app.tick();
});
