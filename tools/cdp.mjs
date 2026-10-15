// Minimal Chrome DevTools driver (no dependencies, Node 22+): real (trusted) mouse / keyboard input against PandaOS.
// Used by tools/e2e.mjs. Finds Chrome / Edge the same way tools/chrome.sh does.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));

export async function launch(url, { width = 1440, height = 900, port = 9700 + Math.floor(Math.random() * 500) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandainteg-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map((a) => a.value || a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = {
    errors, sleep, send,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, timeout = 8000, label = expr) {
      const t0 = Date.now();
      for (;;) {
        let v = false;
        try { v = await api.eval(expr); } catch (e) { v = false; }
        if (v) return v;
        if (Date.now() - t0 > timeout) throw new Error('waitFor timeout: ' + label);
        await sleep(60);
      }
    },
    async move(x, y, buttons = 0) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: buttons ? 'left' : 'none', buttons }); },
    async down(x, y, button = 'left', clickCount = 1) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : 2, clickCount }); },
    async up(x, y, button = 'left', clickCount = 1) { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount }); },
    async click(x, y, { button = 'left', count = 1 } = {}) {
      await api.move(x, y);
      for (let c = 1; c <= count; c++) { await api.down(x, y, button, c); await api.up(x, y, button, c); }
    },
    async drag(x0, y0, x1, y1, steps = 12) {
      await api.move(x0, y0); await api.down(x0, y0);
      for (let i = 1; i <= steps; i++) await api.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, 1);
      await api.up(x1, y1);
    },
    async key(key, { code, modifiers = 0, text } = {}) {
      const base = { key, code: code || (key.length === 1 ? 'Key' + key.toUpperCase() : key), modifiers, windowsVirtualKeyCode: keyCode(key) };
      const printable = key.length === 1 && !(modifiers & 3);
      await send('Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'rawKeyDown', ...base, text: text || (printable ? key : undefined) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async type(str) { for (const ch of str) await api.key(ch); },
    async shot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async close() { try { ws.close(); } catch (e) { /* */ } proc.kill(); await sleep(400); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } }
  };
  return api;
}

function keyCode(k) {
  const map = { Enter: 13, Escape: 27, Delete: 46, Backspace: 8, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, F2: 113, F5: 116, Meta: 91, Control: 17, ' ': 32 };
  if (map[k]) return map[k];
  if (k.length === 1) return k.toUpperCase().charCodeAt(0);
  return 0;
}
