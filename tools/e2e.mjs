// Real-input end-to-end run (trusted mouse + keyboard through the DevTools protocol) of the whole
// boot -> lock -> desktop -> windows -> taskbar flow, with the real boot splash and lock screen (no fast=1).
//   node tools/e2e.mjs                (env: THEME=dark|light, OUT=<screenshot dir>)
// The integration suite's 'e2e' scene registers stand-in apps for any app id that is not registered yet.
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'pandaos-shots', 'e2e');
const THEME = process.env.THEME || 'dark';
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href + '?reset=1&test=integration&shot=e2e&theme=' + THEME;
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

const b = await launch(URL);
try {
  // ---- boot splash
  await b.waitFor("!!document.querySelector('.boot-splash')", 6000, 'splash');
  await b.sleep(900);
  await b.shot(`${OUT}/01-splash.png`);
  // ---- lock screen
  await b.waitFor("PandaOS.session && PandaOS.session.state() === 'locked'", 12000, 'locked');
  await b.sleep(1200);
  await b.shot(`${OUT}/02-lock.png`);
  await b.click(720, 450);
  await b.waitFor("document.querySelector('.lock-root').classList.contains('is-signin')", 3000, 'sign-in view');
  ok(await b.eval("document.activeElement === document.querySelector('.lock-input')"), 'sign-in: password field focused');
  await b.sleep(500);
  await b.shot(`${OUT}/03-signin.png`);
  await b.type('panda');
  ok(await b.eval("document.querySelector('.lock-input').value === 'panda'"), 'typed password lands in the field (real keystrokes)');
  await b.key('Enter', { code: 'Enter' });
  await b.waitFor("PandaOS.session.state() === 'running'", 5000, 'unlocked');
  await b.waitFor('!!window.__testReport && !!PandaOS.apps.get("files")', 8000, 'scene prepared (apps registered)');
  await b.sleep(1500);
  await b.shot(`${OUT}/04-desktop.png`);

  const rect = (sel) => b.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const icon = (key) => rect(`#desktop .desk-icon[data-key="${key}"] .desk-inner`);
  const winInfo = () => b.eval(`(() => { const w = PandaOS.wm.list(); const f = PandaOS.wm.getFocused(); return { n: w.length, focused: f && f.appId, apps: w.map(x => x.appId), min: w.map(x => x.isMinimized()), bounds: w.map(x => x.getBounds()), snapped: w.map(x => x.isSnapped()), max: w.map(x => x.isMaximized()) }; })()`);

  // ---- desktop: single click selects, double click opens
  let r = await icon('Dosyalar.app');
  await b.click(r.cx, r.cy);
  ok((await b.eval('PandaOS.desktop.selection()')).join() === 'Dosyalar.app', 'click selects the icon');
  await b.click(r.cx, r.cy, { count: 2 });
  await b.waitFor("PandaOS.wm.byApp('files').length === 1", 3000, 'files window');
  await b.sleep(500);
  let w = await winInfo();
  ok(w.n === 1 && w.focused === 'files', 'dblclick opens the Dosyalar window and focuses it');
  ok(await b.eval("!!document.querySelector('#taskbar .tb-app[data-app=\"files\"].running')"), 'taskbar shows the running app');
  await b.shot(`${OUT}/05-files.png`);

  // ---- window: drag by title bar
  let bnds = w.bounds[0];
  await b.drag(bnds.x + 300, bnds.y + 18, bnds.x + 300 + 200, bnds.y + 18 + 90);
  w = await winInfo();
  ok(Math.abs(w.bounds[0].x - (bnds.x + 200)) <= 2 && Math.abs(w.bounds[0].y - (bnds.y + 90)) <= 2, `title-bar drag moves the window (${bnds.x},${bnds.y} -> ${w.bounds[0].x},${w.bounds[0].y})`);
  // resize from the south-east corner
  bnds = w.bounds[0];
  await b.drag(bnds.x + bnds.width - 2, bnds.y + bnds.height - 2, bnds.x + bnds.width + 60, bnds.y + bnds.height + 40);
  w = await winInfo();
  ok(w.bounds[0].width >= bnds.width + 55 && w.bounds[0].height >= bnds.height + 35, `corner resize grows the window (${bnds.width}x${bnds.height} -> ${w.bounds[0].width}x${w.bounds[0].height})`);
  // double-click title bar -> maximize -> restore
  bnds = w.bounds[0];
  await b.click(bnds.x + 250, bnds.y + 18, { count: 2 });
  w = await winInfo();
  ok(w.max[0] === true, 'double-click title bar maximizes');
  await b.sleep(500);
  await b.shot(`${OUT}/06-maximized.png`);
  await b.click(700, 18, { count: 2 });
  w = await winInfo();
  ok(w.max[0] === false, 'double-click again restores');
  await b.sleep(400);

  // ---- minimize via caption button, restore via taskbar
  r = await rect('.wm-window .wm-btn.wm-min');
  await b.click(r.cx, r.cy);
  await b.sleep(100);
  w = await winInfo();
  ok(w.min[0] === true && w.focused === null, 'minimize button minimizes');
  r = await rect('#taskbar .tb-app[data-app="files"]');
  await b.click(r.cx, r.cy);
  await b.sleep(500);
  w = await winInfo();
  ok(w.min[0] === false && w.focused === 'files', 'taskbar button restores + focuses');

  // ---- snap to the left edge by dragging the title bar to the screen edge
  bnds = w.bounds[0];
  await b.drag(bnds.x + 300, bnds.y + 18, 2, 300);
  await b.sleep(400);
  w = await winInfo();
  ok(w.snapped[0] === 'left', 'dragging to the left edge snaps the window');
  await b.shot(`${OUT}/07-snapped.png`);
  // drag it back out
  await b.drag(300, 18, 700, 200);
  w = await winInfo();
  ok(!w.snapped[0] && w.bounds[0].width < 1000, 'dragging a snapped window restores it');

  // ---- clicking the empty desktop deactivates the window; the title bar dims
  await b.click(1385, 150);
  w = await winInfo();
  ok(w.focused === null, 'click on the wallpaper deactivates the window');
  ok(await b.eval("!document.querySelector('#taskbar .tb-app[data-app=\"files\"]').classList.contains('active')"), 'taskbar button no longer active');

  // ---- right click on desktop -> menu -> Escape
  await b.click(1300, 120, { button: 'right' });
  await b.waitFor("PandaOS.contextMenu.isOpen()", 2000, 'context menu');
  ok(true, 'right click opens the desktop menu');
  await b.shot(`${OUT}/08-ctxmenu.png`);
  await b.key('Escape', { code: 'Escape' });
  ok(!(await b.eval('PandaOS.contextMenu.isOpen()')), 'Escape closes the menu');

  // ---- keyboard on the desktop: select Beni Oku.txt, Delete -> trash
  r = await icon('Beni Oku.txt');
  await b.click(r.cx, r.cy);
  await b.key('Delete', { code: 'Delete' });
  await b.sleep(200);
  ok(await b.eval("!PandaOS.fs.exists('/home/panda/Masaüstü/Beni Oku.txt') && PandaOS.fs.trashCount() === 1"), 'Delete moves the selected file to the trash');
  ok(await b.eval("PandaOS.desktop.items().find(i => i.kind === 'trash').icon === 'trash-full'"), 'trash icon becomes full');
  await b.shot(`${OUT}/09-trash-full.png`);
  // restore via fs -> icon returns
  await b.eval("PandaOS.fs.restore(PandaOS.fs.listTrash()[0].id)");
  await b.sleep(200);
  ok(await b.eval("!!document.querySelector('#desktop .desk-icon[data-key=\"Beni Oku.txt\"]')"), 'restored file reappears');

  // ---- start menu: real click on the start button, type a query, Enter opens the file
  r = await rect('#taskbar .tb-start');
  await b.click(r.cx, r.cy);
  await b.waitFor('PandaOS.startMenu.isOpen()', 2000, 'start menu');
  await b.sleep(400);
  ok(await b.eval("document.activeElement === document.querySelector('.sm-input')"), 'search box has focus when the menu opens');
  await b.type('notlar');
  await b.sleep(400);
  await b.shot(`${OUT}/10-start-search.png`);
  ok(await b.eval("!!document.querySelector('.sm-result[data-path$=\"Notlar.txt\"]')"), 'search finds Notlar.txt');
  await b.key('ArrowDown', { code: 'ArrowDown' });
  await b.key('Enter', { code: 'Enter' });
  await b.waitFor("PandaOS.wm.byApp('notepad').length === 1", 3000, 'notepad window');
  ok(!(await b.eval('PandaOS.startMenu.isOpen()')), 'start menu closed after launching');
  await b.sleep(400);

  // ---- bell: notification badge + panel
  await b.eval("PandaOS.notify({ title: 'Merhaba', message: 'gerçek tıklama testi', icon: 'info', timeout: 0 })");
  await b.sleep(400);
  ok(await b.eval("document.querySelector('.tb-badge') && !document.querySelector('.tb-badge').hidden"), 'badge visible after notify');
  await b.shot(`${OUT}/11-toast.png`);
  r = await rect('#taskbar .tb-bell');
  await b.click(r.cx, r.cy);
  await b.waitFor("PandaOS.taskbar.isPanelOpen('notifications')", 2000, 'notification center');
  await b.sleep(500);
  await b.shot(`${OUT}/12-notifications.png`);
  await b.click(700, 300); // outside click closes it
  await b.sleep(300);
  ok(!(await b.eval("PandaOS.taskbar.isPanelOpen()")), 'outside click closes the flyout');

  // ---- clock -> calendar; tray -> quick settings; one at a time
  r = await rect('#taskbar .tb-clock');
  await b.click(r.cx, r.cy);
  await b.waitFor("PandaOS.taskbar.isPanelOpen('calendar')", 2000, 'calendar');
  r = await rect('#taskbar .tb-sys');
  await b.click(r.cx, r.cy);
  await b.sleep(300);
  ok(await b.eval("PandaOS.taskbar.isPanelOpen('quicksettings') && !PandaOS.taskbar.isPanelOpen('calendar')"), 'opening quick settings closes the calendar');
  await b.key('Escape', { code: 'Escape' });
  await b.sleep(300);
  ok(!(await b.eval('PandaOS.taskbar.isPanelOpen()')), 'Escape closes the flyout');

  // ---- Ctrl+Alt+L locks, windows stop receiving keys, Enter unlocks
  await b.eval("window.__keys = 0; PandaOS.wm.getFocused() && PandaOS.wm.getFocused().on('keydown', () => window.__keys++);");
  r = await rect('.wm-window.wm-focused .wm-body');
  await b.click(r.cx, r.cy);
  await b.key('l', { code: 'KeyL', modifiers: 3 });
  await b.waitFor("PandaOS.session.isLocked()", 2000, 'locked via shortcut');
  const keysBefore = await b.eval('window.__keys');
  await b.sleep(900);
  await b.shot(`${OUT}/13-locked-with-windows.png`);
  await b.type('abc');
  ok((await b.eval('window.__keys')) === keysBefore, 'real keystrokes while locked never reach the window');
  ok(await b.eval("document.querySelector('.lock-input').value === 'abc'"), 'they go into the password field instead');
  await b.key('Enter', { code: 'Enter' });
  await b.waitFor("PandaOS.session.state() === 'running'", 4000, 'unlocked again');
  await b.sleep(900);
  await b.shot(`${OUT}/14-after-unlock.png`);

  ok(b.errors.length === 0, 'no JS errors / console.error during the whole run' + (b.errors.length ? ': ' + b.errors.slice(0, 3).join(' | ') : ''));
} catch (e) {
  console.log('  FAIL script error: ' + e.message);
  failures++;
  try { await b.shot(`${OUT}/zz-failure.png`); } catch (_) { /* */ }
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} failure(s)` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
