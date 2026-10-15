/* PandaOS kernel — global namespace, event bus, storage, settings, theme, app registry,
   file clipboard and small DOM/format helpers. Loaded first; every other module builds on it. */
(function () {
  'use strict';

  const PandaOS = (window.PandaOS = window.PandaOS || {});
  PandaOS.version = '1.0.0';
  PandaOS.codename = 'Bambu';
  PandaOS.user = { name: 'panda', displayName: 'Panda', home: '/home/panda', hostname: 'pandaos' };
  PandaOS.params = new URLSearchParams(location.search);

  // ---------------------------------------------------------------- util
  const util = {
    el(tag, attrs, ...children) {
      const node = document.createElement(tag);
      if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
          if (value == null || value === false) continue;
          if (key === 'class' || key === 'className') node.className = value;
          else if (key === 'style') {
            if (typeof value === 'string') node.style.cssText = value;
            else Object.assign(node.style, value);
          } else if (key === 'dataset') Object.assign(node.dataset, value);
          else if (key === 'text') node.textContent = value;
          else if (key === 'html') node.innerHTML = value;
          else if (key === 'on') {
            for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
          } else if (key in node && typeof value !== 'string') node[key] = value;
          else node.setAttribute(key, value === true ? '' : value);
        }
      }
      const append = (child) => {
        if (child == null || child === false) return;
        if (Array.isArray(child)) child.forEach(append);
        else node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
      };
      children.forEach(append);
      return node;
    },

    escapeHtml(str) {
      return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[c]);
    },

    uid(prefix = 'id') {
      return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    },

    clamp(v, min, max) {
      return Math.min(max, Math.max(min, v));
    },

    debounce(fn, ms) {
      let t;
      return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
      };
    },

    throttle(fn, ms) {
      let last = 0;
      let t;
      return function (...args) {
        const now = Date.now();
        const wait = ms - (now - last);
        clearTimeout(t);
        if (wait <= 0) {
          last = now;
          fn.apply(this, args);
        } else {
          t = setTimeout(() => { last = Date.now(); fn.apply(this, args); }, wait);
        }
      };
    },

    formatBytes(n) {
      n = Number(n) || 0;
      if (n < 1024) return `${n} B`;
      const units = ['KB', 'MB', 'GB'];
      let i = -1;
      do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
      let digits = n < 10 ? 1 : 0;
      // 1048575 B must read "1 MB", not "1.024 KB": promote when rounding reaches the next unit
      if (Number(n.toFixed(digits)) >= 1024 && i < units.length - 1) { n /= 1024; i++; digits = 1; }
      return `${n.toLocaleString('tr-TR', { maximumFractionDigits: digits })} ${units[i]}`;
    },

    formatDate(ts, opts) {
      return new Date(ts).toLocaleDateString('tr-TR', opts || { day: 'numeric', month: 'long', year: 'numeric' });
    },

    formatTime(ts, withSeconds = false) {
      return new Date(ts).toLocaleTimeString('tr-TR', {
        hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined
      });
    },

    formatDateTime(ts) {
      return `${util.formatDate(ts, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${util.formatTime(ts)}`;
    },

    compareNames(a, b) {
      return String(a).localeCompare(String(b), 'tr', { numeric: true, sensitivity: 'base' });
    },

    isEditable(el) {
      if (!el || el.nodeType !== 1) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    },

    loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Betik yüklenemedi: ${src}`));
        document.head.appendChild(s);
      });
    }
  };
  PandaOS.util = util;

  // ---------------------------------------------------------------- event bus
  const listeners = new Map();
  const bus = {
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => bus.off(evt, fn);
    },
    once(evt, fn) {
      const off = bus.on(evt, (data) => { off(); fn(data); });
      return off;
    },
    off(evt, fn) {
      listeners.get(evt)?.delete(fn);
    },
    emit(evt, data) {
      const set = listeners.get(evt);
      if (!set) return;
      [...set].forEach((fn) => {
        try { fn(data); } catch (e) { console.error(`[bus] "${evt}" dinleyicisi hata verdi`, e); }
      });
    }
  };
  PandaOS.bus = bus;

  // ---------------------------------------------------------------- storage
  const PREFIX = 'pandaos.';
  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn(`[storage] "${key}" kaydedilemedi`, e);
        bus.emit('storage:error', { key, error: e });
        return false;
      }
    },
    remove(key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
    },
    keys() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
        }
      } catch (e) { /* ignore */ }
      return out;
    },
    clearAll() {
      storage.keys().forEach((k) => storage.remove(k));
    }
  };
  PandaOS.storage = storage;

  // ---------------------------------------------------------------- settings
  const SETTINGS_DEFAULTS = {
    theme: 'dark',
    accent: '#2f9e6b',
    wallpaper: 'bamboo',
    volume: 70,
    muted: false,
    sounds: true,
    dnd: false,
    animations: true,
    clock24h: true,
    showSeconds: false,
    'taskbar.pinned': ['files', 'terminal', 'notepad', 'music'],
    'desktop.iconSize': 'medium'
  };
  let settingsCache = Object.assign({}, storage.get('settings', {}));

  const settings = {
    DEFAULTS: SETTINGS_DEFAULTS,
    ACCENTS: [
      { name: 'Bambu', value: '#2f9e6b' },
      { name: 'Okyanus', value: '#3b82f6' },
      { name: 'Turkuaz', value: '#0ea5a4' },
      { name: 'Lavanta', value: '#8b5cf6' },
      { name: 'Pembe', value: '#e0498f' },
      { name: 'Mercan', value: '#ef5a4c' },
      { name: 'Turuncu', value: '#f08c1a' },
      { name: 'Grafit', value: '#64748b' }
    ],
    get(key) {
      if (Object.prototype.hasOwnProperty.call(settingsCache, key)) return settingsCache[key];
      const def = SETTINGS_DEFAULTS[key];
      return Array.isArray(def) ? def.slice() : def;
    },
    set(key, value) {
      const old = settings.get(key);
      settingsCache[key] = value;
      storage.set('settings', settingsCache);
      if (JSON.stringify(old) !== JSON.stringify(value)) bus.emit('settings:change', { key, value, old });
    },
    all() {
      return Object.assign({}, SETTINGS_DEFAULTS, settingsCache);
    },
    reset() {
      const before = settings.all();
      settingsCache = {};
      storage.set('settings', settingsCache);
      for (const key of Object.keys(before)) {
        const value = settings.get(key);
        if (JSON.stringify(before[key]) !== JSON.stringify(value)) {
          bus.emit('settings:change', { key, value, old: before[key] });
        }
      }
    }
  };
  PandaOS.settings = settings;

  // Another PandaOS tab changed the settings: adopt them (without writing back) and notify listeners.
  window.addEventListener('storage', (e) => {
    if (e.key !== PREFIX + 'settings') return;
    let incoming = {};
    try { incoming = e.newValue ? JSON.parse(e.newValue) : {}; } catch (err) { return; }
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return;
    const before = settings.all();
    settingsCache = Object.assign({}, incoming);
    const after = settings.all();
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        bus.emit('settings:change', { key, value: after[key], old: before[key], external: true });
      }
    }
  });

  // ---------------------------------------------------------------- theme
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  // Solid accent fills carry small text (primary buttons, badges, toggled tiles…), so derive a fill/text pair
  // that reads at >= 4.5:1: light accents keep their colour with dark text, darker ones are deepened for white text.
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lumOf = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

  function accentPair(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    if (lumOf(base) > 0.30) {
      return { solid: toHex(base), hover: toHex(mixRgb(base, [255, 255, 255], 0.12)), active: toHex(mixRgb(base, [0, 0, 0], 0.1)), on: '#111111' };
    }
    let solid = base;
    for (let t = 0; 1.05 / (lumOf(solid) + 0.05) < 4.6 && t < 0.6;) { t += 0.02; solid = mixRgb(base, [0, 0, 0], t); }
    return { solid: toHex(solid), hover: toHex(mixRgb(solid, [0, 0, 0], 0.1)), active: toHex(mixRgb(solid, [0, 0, 0], 0.2)), on: '#ffffff' };
  }

  let lastTheme = null;
  const theme = {
    mode() {
      return settings.get('theme');
    },
    get() {
      const mode = settings.get('theme');
      if (mode === 'auto') return media && media.matches ? 'light' : 'dark';
      return mode === 'light' ? 'light' : 'dark';
    },
    set(mode) {
      settings.set('theme', mode);
    },
    toggle() {
      settings.set('theme', theme.get() === 'dark' ? 'light' : 'dark');
    },
    apply() {
      const root = document.documentElement;
      const current = theme.get();
      const accent = settings.get('accent');
      root.dataset.theme = current;
      root.style.setProperty('--accent', accent);
      const pair = accentPair(accent);
      const tokens = { '--accent-solid': 'solid', '--accent-solid-hover': 'hover', '--accent-solid-active': 'active', '--on-accent': 'on', '--accent-contrast': 'on' };
      for (const [prop, k] of Object.entries(tokens)) {
        if (pair) root.style.setProperty(prop, pair[k]);
        else root.style.removeProperty(prop);
      }
      root.classList.toggle('no-anim', settings.get('animations') === false);
      if (current !== lastTheme) {
        lastTheme = current;
        bus.emit('theme:change', { theme: current });
      }
    }
  };
  theme.accentPair = accentPair;
  PandaOS.theme = theme;

  bus.on('settings:change', ({ key }) => {
    if (key === 'theme' || key === 'accent' || key === 'animations') theme.apply();
  });
  if (media) {
    const onMedia = () => { if (settings.get('theme') === 'auto') theme.apply(); };
    if (media.addEventListener) media.addEventListener('change', onMedia);
    else if (media.addListener) media.addListener(onMedia);
  }

  // ---------------------------------------------------------------- app registry
  const registry = new Map();

  function notifyError(title, message) {
    if (typeof PandaOS.notify === 'function') {
      PandaOS.notify({ title, message, icon: 'error', timeout: 6000 });
    } else {
      console.error(`${title}: ${message}`);
    }
  }

  const apps = {
    register(def) {
      if (!def || !def.id || typeof def.launch !== 'function') {
        console.error('[apps] geçersiz uygulama tanımı', def);
        return;
      }
      if (registry.has(def.id)) console.warn(`[apps] "${def.id}" yeniden kaydedildi`);
      registry.set(def.id, Object.assign({
        name: def.id,
        icon: def.id,
        description: '',
        category: 'utilities',
        fileTypes: [],
        singleInstance: false,
        showInStartMenu: true,
        window: {}
      }, def));
      bus.emit('apps:change', { id: def.id });
    },

    get(id) {
      return registry.get(id);
    },

    list() {
      return [...registry.values()].sort((a, b) => util.compareNames(a.name, b.name));
    },

    running(id) {
      return PandaOS.wm && PandaOS.wm.byApp ? PandaOS.wm.byApp(id) : [];
    },

    launch(id, args = {}) {
      const def = registry.get(id);
      if (!def) {
        notifyError('Uygulama bulunamadı', `"${id}" adlı bir uygulama yüklü değil.`);
        return null;
      }
      if (!PandaOS.wm || typeof PandaOS.wm.open !== 'function') {
        console.error('[apps] pencere yöneticisi hazır değil');
        return null;
      }
      if (def.singleInstance) {
        const existing = apps.running(id)[0];
        if (existing) {
          if (existing.isMinimized && existing.isMinimized()) existing.restore();
          existing.focus();
          if (typeof def.relaunch === 'function' && args && Object.keys(args).length) {
            try { def.relaunch(existing, args); } catch (e) { console.error(`[apps] ${id}.relaunch`, e); }
          }
          return existing;
        }
      }
      const win = PandaOS.wm.open(Object.assign({}, def.window, {
        appId: def.id,
        title: def.name,
        icon: def.icon
      }));
      const fail = (e) => {
        console.error(`[apps] ${id} başlatılamadı`, e);
        notifyError(def.name, `Uygulama başlatılamadı: ${e && e.message ? e.message : e}`);
        try { (win.forceClose || win.close).call(win); } catch (_) { /* ignore */ }
      };
      try {
        const result = def.launch(win, args || {});
        if (result && typeof result.then === 'function') result.then(null, fail);
      } catch (e) {
        fail(e);
        return null;
      }
      bus.emit('apps:launch', { id, win, args });
      return win;
    },

    forExtension(ext) {
      ext = String(ext || '').toLowerCase();
      if (!ext) return [];
      return [...registry.values()].filter((d) => (d.fileTypes || []).includes(ext));
    },

    openFile(path) {
      const fs = PandaOS.fs;
      if (!fs) return null;
      if (!fs.exists(path)) {
        notifyError('Dosya bulunamadı', `${path} artık mevcut değil.`);
        return null;
      }
      if (fs.isDir(path)) return apps.launch('files', { path });
      const ext = fs.extname(path);
      if (ext === '.app') {
        try {
          const target = JSON.parse(fs.readFile(path));
          return apps.launch(target.appId, target.args || {});
        } catch (e) {
          notifyError('Kısayol açılamadı', `${fs.basename(path)} bozuk görünüyor.`);
          return null;
        }
      }
      const def = apps.forExtension(ext)[0] || registry.get('notepad');
      if (!def) {
        notifyError('Açılamadı', `${fs.basename(path)} dosyasını açabilecek bir uygulama yok.`);
        return null;
      }
      return apps.launch(def.id, { path });
    }
  };
  PandaOS.apps = apps;

  // ---------------------------------------------------------------- file clipboard
  let clip = null;
  PandaOS.clipboard = {
    set(data) {
      clip = data && Array.isArray(data.paths) && data.paths.length
        ? { op: data.op === 'cut' ? 'cut' : 'copy', paths: data.paths.slice() }
        : null;
      bus.emit('clipboard:change', clip);
    },
    get() {
      return clip ? { op: clip.op, paths: clip.paths.slice() } : null;
    },
    clear() {
      clip = null;
      bus.emit('clipboard:change', null);
    }
  };
})();
