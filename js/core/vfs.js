/* PandaOS virtual file system — PandaOS.fs (contract: docs/API.md §5).

   Storage layout (one JSON document under PandaOS.storage key 'fs'):
     { v: 1,
       root:  { t:'d', c:created, m:modified, k:{ name: node, … } },
       trash: [ { id, name, originalPath, deletedAt, node }, … ] }
   A node is either a directory  { t:'d', c, m, k }  or a file  { t:'f', c, m, d:'content' }.
   Trash entries live in the same document, so one write is always atomic.

   Every mutation runs inside mutate(): the in-memory tree is changed through undo-logged
   primitives, the whole document is persisted synchronously, and if that fails (quota, blocked
   storage) every change is rolled back and an ENOSPC FSError is thrown. fs:change is only
   emitted after a successful write. */
(function () {
  'use strict';

  const P = (window.PandaOS = window.PandaOS || {});

  const HOME = '/home/panda';
  const DESKTOP = HOME + '/Masaüstü';
  const KEY = 'fs';
  const CORRUPT_KEY = 'fs.corrupt';
  const RAW_KEY = 'pandaos.' + KEY;
  const QUOTA = 5 * 1024 * 1024;
  const MAX_NAME = 255;
  const PROTECTED = ['/', '/home', HOME, DESKTOP];

  // ------------------------------------------------------------------ errors
  class FSError extends Error {
    constructor(code, message, path) {
      super(message || code);
      this.name = 'FSError';
      this.code = code;
      if (path !== undefined) this.path = path;
    }
  }

  const MESSAGES = {
    ENOENT: (p) => `Böyle bir dosya ya da dizin yok: ${p}`,
    EEXIST: (p) => `Bu ad zaten kullanılıyor: ${p}`,
    ENOTDIR: (p) => `Bir klasör değil: ${p}`,
    EISDIR: (p) => `Bu bir klasör, dosya değil: ${p}`,
    ENOTEMPTY: (p) => `Klasör boş değil: ${p}`,
    EPERM: (p) => `Bu öğe korumalı, değiştirilemez: ${p}`,
    EINVAL: (p, detail) => detail || `Geçersiz işlem: ${p}`,
    ENOSPC: () => 'Depolama alanı doldu; değişiklik kaydedilemedi.'
  };

  function err(code, path, detail) {
    return new FSError(code, MESSAGES[code](path, detail), path);
  }

  // ------------------------------------------------------------------ small helpers
  const S = () => P.storage;
  let lastTs = 0;

  /** Strictly increasing millisecond clock: keeps ordering (trash, modified) deterministic. */
  function tick() {
    const n = Date.now();
    lastTs = n > lastTs ? n : lastTs + 1;
    return lastTs;
  }

  function uniq(list) {
    return Array.from(new Set(list));
  }

  function utf8Length(str) {
    let n = 0;
    const len = str.length;
    for (let i = 0; i < len; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < len) {
        const d = str.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
      } else n += 3;
    }
    return n;
  }

  function nameProblem(name) {
    if (typeof name !== 'string' || name === '') return 'Ad boş olamaz.';
    if (name === '.' || name === '..') return `“${name}” geçerli bir ad değil.`;
    if (name.indexOf('/') !== -1) return 'Ad “/” karakteri içeremez.';
    if (name.length > MAX_NAME) return `Ad en fazla ${MAX_NAME} karakter olabilir.`;
    if (/[\u0000-\u001f\u007f]/.test(name)) return 'Ad geçersiz denetim karakterleri içeriyor.';
    if (name.trim() === '') return 'Ad yalnızca boşluktan oluşamaz.';
    return null;
  }

  function checkName(name) {
    const problem = nameProblem(name);
    if (problem) throw err('EINVAL', String(name), problem);
  }

  /** 'a.tar.gz' -> { stem:'a.tar', ext:'.gz' }; dotfiles and trailing dots have no extension. */
  function splitName(name) {
    const i = name.lastIndexOf('.');
    if (i <= 0 || i === name.length - 1) return { stem: name, ext: '' };
    return { stem: name.slice(0, i), ext: name.slice(i) };
  }

  /** base + suffix + ext, shortening base so the result never exceeds MAX_NAME. */
  function fit(base, suffix, ext) {
    const room = MAX_NAME - suffix.length - ext.length;
    return (base.length > room ? base.slice(0, Math.max(1, room)) : base) + suffix + ext;
  }

  // ------------------------------------------------------------------ path helpers (pure)
  function normalize(path, cwd) {
    let p = typeof path === 'string' ? path : path == null ? '' : String(path);
    p = p.normalize('NFC');
    if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
    if (p.charAt(0) !== '/') {
      const base = cwd === undefined || cwd === null || cwd === '' ? HOME : normalize(cwd, HOME);
      p = base + '/' + p;
    }
    const out = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return '/' + out.join('/');
  }

  function join(...parts) {
    const used = parts.filter((x) => x !== '' && x !== undefined && x !== null).map(String);
    return normalize(used.join('/'));
  }

  function dirname(p) {
    const n = normalize(p);
    if (n === '/') return '/';
    const i = n.lastIndexOf('/');
    return i === 0 ? '/' : n.slice(0, i);
  }

  function basename(p) {
    const n = normalize(p);
    return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1);
  }

  function extname(p) {
    const b = basename(p);
    return b === '/' ? '' : splitName(b).ext.toLowerCase();
  }

  function stem(p) {
    const b = basename(p);
    return b === '/' ? b : splitName(b).stem;
  }

  function displayName(p) {
    return extname(p) === '.app' ? stem(p) : basename(p);
  }

  function childPath(dirPath, name) {
    return dirPath === '/' ? '/' + name : dirPath + '/' + name;
  }

  function isInside(path, ancestor) {
    return ancestor === '/' ? true : path === ancestor || path.startsWith(ancestor + '/');
  }

  function isProtected(p) {
    if (typeof p !== 'string' || p === '') return false;
    return PROTECTED.includes(normalize(p));
  }

  /** Argument check for operations that must receive a real path. */
  function arg(p) {
    if (typeof p !== 'string' || p === '') throw err('EINVAL', String(p), 'Geçersiz yol: boş ya da metin olmayan değer.');
    return normalize(p);
  }

  // ------------------------------------------------------------------ state
  let doc = null; // { v, root, trash }
  let memoryOnly = false; // storage unusable at first run: keep working in memory
  let sizeCache = new WeakMap(); // dir node -> total size, valid until the next mutation
  const fileSizes = new WeakMap(); // file node -> { d, size }
  let usageCache = null;

  function invalidate() {
    sizeCache = new WeakMap();
    usageCache = null;
  }

  function newDir(ts) {
    return { t: 'd', c: ts, m: ts, k: Object.create(null) };
  }

  function newFile(content, ts) {
    return { t: 'f', c: ts, m: ts, d: content };
  }

  function fileSize(node) {
    const cached = fileSizes.get(node);
    if (cached && cached.d === node.d) return cached.size;
    const size = utf8Length(node.d);
    fileSizes.set(node, { d: node.d, size });
    return size;
  }

  function nodeSize(node) {
    if (node.t === 'f') return fileSize(node);
    let size = sizeCache.get(node);
    if (size === undefined) {
      size = 0;
      for (const name of Object.keys(node.k)) size += nodeSize(node.k[name]);
      sizeCache.set(node, size);
    }
    return size;
  }

  // ------------------------------------------------------------------ tree lookup
  /** Non-throwing lookup: node or null. */
  function peek(abs) {
    let node = doc.root;
    if (abs === '/') return node;
    for (const seg of abs.slice(1).split('/')) {
      if (node.t !== 'd') return null;
      const next = node.k[seg];
      if (next === undefined) return null;
      node = next;
    }
    return node;
  }

  /** Strict lookup: throws ENOENT, or ENOTDIR when a file is used as a directory. */
  function walkTo(abs) {
    let node = doc.root;
    if (abs === '/') return node;
    let cur = '';
    for (const seg of abs.slice(1).split('/')) {
      if (node.t !== 'd') throw err('ENOTDIR', cur || '/');
      const next = node.k[seg];
      if (next === undefined) throw err('ENOENT', abs);
      node = next;
      cur += '/' + seg;
    }
    return node;
  }

  function getDir(abs) {
    const node = walkTo(abs);
    if (node.t !== 'd') throw err('ENOTDIR', abs);
    return node;
  }

  function makeStat(abs, node) {
    const isDir = node.t === 'd';
    const name = abs === '/' ? '/' : abs.slice(abs.lastIndexOf('/') + 1);
    const st = {
      path: abs,
      name,
      type: isDir ? 'dir' : 'file',
      ext: isDir ? '' : splitName(name).ext.toLowerCase(),
      size: nodeSize(node),
      created: node.c,
      modified: node.m
    };
    if (isDir) st.childCount = Object.keys(node.k).length;
    st.hidden = name.charAt(0) === '.';
    return st;
  }

  const compare = (a, b) => (P.util && P.util.compareNames
    ? P.util.compareNames(a, b)
    : String(a).localeCompare(String(b), 'tr', { numeric: true, sensitivity: 'base' }));

  /** Child names: directories first, then Turkish numeric-aware name order. */
  function childNames(dirNode, withHidden) {
    const names = Object.keys(dirNode.k);
    const list = withHidden ? names : names.filter((n) => n.charAt(0) !== '.');
    return list.sort((a, b) => {
      const da = dirNode.k[a].t === 'd';
      const db = dirNode.k[b].t === 'd';
      if (da !== db) return da ? -1 : 1;
      return compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
    });
  }

  // ------------------------------------------------------------------ transactions
  const tx = {
    setChild(dir, name, node, undo) {
      const prev = dir.k[name];
      dir.k[name] = node;
      undo.push(() => { if (prev === undefined) delete dir.k[name]; else dir.k[name] = prev; });
    },
    delChild(dir, name, undo) {
      const prev = dir.k[name];
      delete dir.k[name];
      undo.push(() => { dir.k[name] = prev; });
    },
    setProp(obj, key, value, undo) {
      const prev = obj[key];
      obj[key] = value;
      undo.push(() => { obj[key] = prev; });
    },
    trashAdd(entry, undo) {
      doc.trash.push(entry);
      undo.push(() => {
        const i = doc.trash.indexOf(entry);
        if (i >= 0) doc.trash.splice(i, 1);
      });
    },
    trashDel(entry, undo) {
      const i = doc.trash.indexOf(entry);
      if (i < 0) return;
      doc.trash.splice(i, 1);
      undo.push(() => { doc.trash.splice(i, 0, entry); });
    }
  };

  function rollback(undo) {
    for (let i = undo.length - 1; i >= 0; i--) {
      try { undo[i](); } catch (e) { /* best effort */ }
    }
    invalidate();
  }

  function persist() {
    try {
      return S().set(KEY, doc) !== false;
    } catch (e) {
      return false;
    }
  }

  function emit(event) {
    event.parents = uniq(event.parents || []);
    if (P.bus && typeof P.bus.emit === 'function') P.bus.emit('fs:change', event);
  }

  /**
   * Runs fn(undo) -> { value, event } and commits it. Any throw, or a failed storage write,
   * rolls the in-memory tree back to exactly what it was before the call.
   */
  function mutate(fn) {
    ensure();
    const undo = [];
    let out;
    try {
      out = fn(undo) || {};
    } catch (e) {
      rollback(undo);
      throw e;
    }
    if (!undo.length && !out.event) return out.value;
    if (persist()) {
      memoryOnly = false;
    } else if (!memoryOnly) {
      rollback(undo);
      throw err('ENOSPC', '');
    }
    invalidate();
    if (out.event) emit(out.event);
    return out.value;
  }

  // ------------------------------------------------------------------ naming
  /** 'Yeni Klasör' -> 'Yeni Klasör (2)', 'a.txt' -> 'a (2).txt' (continues from an existing '(n)'). */
  function uniqueIn(dirNode, name) {
    if (dirNode.k[name] === undefined) return name;
    const { stem: base0, ext } = splitName(name);
    const m = /^(.+) \((\d+)\)$/.exec(base0);
    const base = m ? m[1] : base0;
    for (let i = m ? Number(m[2]) + 1 : 2; ; i++) {
      const candidate = fit(base, ` (${i})`, ext);
      if (dirNode.k[candidate] === undefined) return candidate;
    }
  }

  /** 'ad.txt' -> 'ad (kopya).txt' -> 'ad (kopya 2).txt' … */
  function copyNameIn(dirNode, name) {
    const { stem: base0, ext } = splitName(name);
    const stripped = base0.replace(/ \(kopya(?: \d+)?\)$/, '');
    const base = stripped || base0;
    let candidate = fit(base, ' (kopya)', ext);
    for (let i = 2; dirNode.k[candidate] !== undefined; i++) candidate = fit(base, ` (kopya ${i})`, ext);
    return candidate;
  }

  function cloneNode(node, ts) {
    if (node.t === 'f') return newFile(node.d, ts);
    const k = Object.create(null);
    for (const name of Object.keys(node.k)) k[name] = cloneNode(node.k[name], ts);
    return { t: 'd', c: ts, m: ts, k };
  }

  // ------------------------------------------------------------------ queries
  function exists(p) {
    if (typeof p !== 'string' || p === '') return false;
    ensure();
    return peek(normalize(p)) !== null;
  }

  function isDir(p) {
    if (typeof p !== 'string' || p === '') return false;
    ensure();
    const n = peek(normalize(p));
    return !!n && n.t === 'd';
  }

  function isFile(p) {
    if (typeof p !== 'string' || p === '') return false;
    ensure();
    const n = peek(normalize(p));
    return !!n && n.t === 'f';
  }

  function stat(p) {
    if (typeof p !== 'string' || p === '') return null;
    ensure();
    const abs = normalize(p);
    const node = peek(abs);
    return node ? makeStat(abs, node) : null;
  }

  function list(dir, opts) {
    ensure();
    const abs = arg(dir);
    const node = getDir(abs);
    const withHidden = !!(opts && opts.hidden);
    return childNames(node, withHidden).map((name) => makeStat(childPath(abs, name), node.k[name]));
  }

  function readFile(p) {
    ensure();
    const abs = arg(p);
    const node = walkTo(abs);
    if (node.t === 'd') throw err('EISDIR', abs);
    return node.d;
  }

  function walk(dir, fn) {
    ensure();
    const abs = arg(dir);
    const root = getDir(abs);
    if (typeof fn !== 'function') throw new TypeError('walk: ikinci argüman bir işlev olmalı');
    const visit = (dirNode, dirPath) => {
      for (const name of childNames(dirNode, true)) {
        const child = dirNode.k[name]; // may have been removed by the callback
        if (child === undefined) continue;
        const path = childPath(dirPath, name);
        const result = fn(makeStat(path, child));
        // returning false skips the contents of that directory
        if (child.t === 'd' && result !== false && dirNode.k[name] === child) visit(child, path);
      }
    };
    visit(root, abs);
  }

  function search(query, opts) {
    ensure();
    const o = opts || {};
    const q = query == null ? '' : String(query);
    if (!q) return [];
    const limit = Number.isFinite(o.limit) ? Math.max(0, o.limit) : 50;
    const withHidden = !!o.hidden;
    const rootPath = o.root === undefined ? HOME : normalize(String(o.root));
    const rootNode = peek(rootPath);
    if (!rootNode || rootNode.t !== 'd' || limit === 0) return [];

    // Turkish folding (I<->ı, İ<->i) plus plain folding, so 'index' still finds 'Index.txt'
    // while 'ışık' finds 'IŞIK'.
    const qTr = q.toLocaleLowerCase('tr');
    const qEn = q.toLowerCase();
    const hits = [];
    let order = 0;
    const visit = (dirNode, dirPath) => {
      for (const name of childNames(dirNode, withHidden)) {
        const child = dirNode.k[name];
        const nTr = name.toLocaleLowerCase('tr');
        const nEn = name.toLowerCase();
        const inTr = nTr.includes(qTr);
        const inEn = nEn.includes(qEn);
        const path = childPath(dirPath, name);
        if (inTr || inEn) {
          const sTr = splitName(nTr).stem;
          const sEn = splitName(nEn).stem;
          let score = 2;
          if (nTr === qTr || nEn === qEn || sTr === qTr || sEn === qEn) score = 0;
          else if (nTr.startsWith(qTr) || nEn.startsWith(qEn)) score = 1;
          hits.push({ score, order: order++, path, node: child });
        }
        if (child.t === 'd') visit(child, path);
      }
    };
    visit(rootNode, rootPath);
    hits.sort((a, b) => a.score - b.score || a.order - b.order);
    return hits.slice(0, limit).map((h) => makeStat(h.path, h.node));
  }

  function usage() {
    ensure();
    if (!usageCache) {
      let used = 0;
      try { used = JSON.stringify(doc).length + RAW_KEY.length; } catch (e) { used = 0; }
      usageCache = { used, quota: QUOTA };
    }
    return { used: usageCache.used, quota: usageCache.quota };
  }

  function uniqueName(dir, name) {
    ensure();
    const n = String(name).normalize('NFC'); // same form normalize() uses, so the result is reachable
    if (typeof dir !== 'string' || dir === '') return n;
    const node = peek(normalize(dir));
    if (!node || node.t !== 'd') return n;
    return uniqueIn(node, n);
  }

  // ------------------------------------------------------------------ mutations
  /** Create or overwrite (append = false) / append (append = true). Returns an event descriptor. */
  function putFile(abs, data, append, undo) {
    if (abs === '/') throw err('EISDIR', abs);
    const parentPath = dirname(abs);
    const name = basename(abs);
    const ts = tick();
    const existing = peek(abs);
    if (existing) {
      if (existing.t === 'd') throw err('EISDIR', abs);
      const parent = peek(parentPath);
      tx.setProp(existing, 'd', append ? existing.d + data : data, undo);
      tx.setProp(existing, 'm', ts, undo);
      tx.setProp(parent, 'm', ts, undo);
      return { type: 'write', path: abs, parents: [parentPath] };
    }
    checkName(name);
    const parent = getDir(parentPath);
    tx.setChild(parent, name, newFile(data, ts), undo);
    tx.setProp(parent, 'm', ts, undo);
    return { type: 'create', path: abs, parents: [parentPath] };
  }

  const toText = (content) => (typeof content === 'string' ? content : content == null ? '' : String(content));

  function writeFile(p, content) {
    const abs = arg(p);
    const data = toText(content);
    return mutate((undo) => ({ value: abs, event: putFile(abs, data, false, undo) }));
  }

  function appendFile(p, content) {
    const abs = arg(p);
    const data = toText(content);
    return mutate((undo) => ({ value: abs, event: putFile(abs, data, true, undo) }));
  }

  function mkdir(p, opts) {
    const abs = arg(p);
    const recursive = !!(opts && opts.recursive);
    return mutate((undo) => {
      const existing = peek(abs);
      if (existing) {
        if (recursive && existing.t === 'd') return { value: abs };
        throw err('EEXIST', abs);
      }
      const segs = abs.slice(1).split('/');
      const ts = tick();
      const parents = [];
      let node = doc.root;
      let cur = '';
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const parentPath = cur || '/';
        cur += '/' + seg;
        const child = node.k[seg];
        if (child !== undefined) {
          if (child.t !== 'd') throw err('ENOTDIR', cur);
          node = child;
          continue;
        }
        if (!recursive && i < segs.length - 1) throw err('ENOENT', abs);
        checkName(seg);
        const dir = newDir(ts);
        tx.setChild(node, seg, dir, undo);
        tx.setProp(node, 'm', ts, undo);
        parents.push(parentPath);
        node = dir;
      }
      return { value: abs, event: { type: 'mkdir', path: abs, parents } };
    });
  }

  function rename(p, newName) {
    const abs = arg(p);
    // every path goes through normalize() (NFC); a name stored decomposed (pasted from macOS Finder...) could never be looked up again
    if (typeof newName === 'string') newName = newName.normalize('NFC'); // non-strings still fail checkName (EINVAL)
    return mutate((undo) => {
      if (isProtected(abs)) throw err('EPERM', abs);
      const node = walkTo(abs);
      checkName(newName);
      const parentPath = dirname(abs);
      const oldName = basename(abs);
      if (newName === oldName) return { value: abs };
      const parent = peek(parentPath);
      const target = childPath(parentPath, newName);
      if (parent.k[newName] !== undefined) throw err('EEXIST', target);
      const ts = tick();
      tx.delChild(parent, oldName, undo);
      tx.setChild(parent, newName, node, undo);
      tx.setProp(parent, 'm', ts, undo);
      return { value: target, event: { type: 'rename', path: target, oldPath: abs, parents: [parentPath] } };
    });
  }

  function move(src, destDir) {
    const from = arg(src);
    const to = arg(destDir);
    return mutate((undo) => {
      if (isProtected(from)) throw err('EPERM', from);
      const node = walkTo(from);
      const dest = getDir(to);
      const name = basename(from);
      if (node.t === 'd' && isInside(to, from)) {
        throw err('EINVAL', from, `“${name}” klasörü kendi içine taşınamaz.`);
      }
      const fromParent = dirname(from);
      if (to === fromParent) return { value: from }; // already there
      const target = childPath(to, name);
      if (dest.k[name] !== undefined) throw err('EEXIST', target);
      const parent = peek(fromParent);
      const ts = tick();
      tx.delChild(parent, name, undo);
      tx.setChild(dest, name, node, undo);
      tx.setProp(parent, 'm', ts, undo);
      tx.setProp(dest, 'm', ts, undo);
      return { value: target, event: { type: 'move', path: target, oldPath: from, parents: [fromParent, to] } };
    });
  }

  function copy(src, destDir) {
    const from = arg(src);
    const to = arg(destDir);
    return mutate((undo) => {
      const node = walkTo(from);
      const dest = getDir(to);
      const name = basename(from);
      if (node.t === 'd' && isInside(to, from)) {
        throw err('EINVAL', from, `“${name}” klasörü kendi içine kopyalanamaz.`);
      }
      const newName = dest.k[name] === undefined ? name : copyNameIn(dest, name);
      const target = childPath(to, newName);
      const ts = tick();
      tx.setChild(dest, newName, cloneNode(node, ts), undo);
      tx.setProp(dest, 'm', ts, undo);
      return { value: target, event: { type: 'copy', path: target, oldPath: from, parents: [to] } };
    });
  }

  function remove(p, opts) {
    const abs = arg(p);
    const recursive = !!(opts && opts.recursive);
    return mutate((undo) => {
      if (isProtected(abs)) throw err('EPERM', abs);
      const node = walkTo(abs);
      if (node.t === 'd' && !recursive && Object.keys(node.k).length) throw err('ENOTEMPTY', abs);
      const parentPath = dirname(abs);
      const parent = peek(parentPath);
      tx.delChild(parent, basename(abs), undo);
      tx.setProp(parent, 'm', tick(), undo);
      return { event: { type: 'delete', path: abs, parents: [parentPath] } };
    });
  }

  // ------------------------------------------------------------------ trash
  function newTrashId() {
    for (;;) {
      const id = P.util && P.util.uid ? P.util.uid('t') : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (!doc.trash.some((e) => e.id === id)) return id;
    }
  }

  function trash(p) {
    const abs = arg(p);
    return mutate((undo) => {
      if (isProtected(abs)) throw err('EPERM', abs);
      const node = walkTo(abs);
      const parentPath = dirname(abs);
      const parent = peek(parentPath);
      const name = basename(abs);
      const ts = tick();
      const entry = { id: newTrashId(), name, originalPath: abs, deletedAt: ts, node };
      tx.delChild(parent, name, undo);
      tx.setProp(parent, 'm', ts, undo);
      tx.trashAdd(entry, undo);
      return { value: entry.id, event: { type: 'trash', path: abs, parents: [parentPath] } };
    });
  }

  function listTrash() {
    ensure();
    return doc.trash
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.deletedAt - a.e.deletedAt || b.i - a.i)
      .map(({ e }) => ({
        id: e.id,
        name: e.name,
        type: e.node.t === 'd' ? 'dir' : 'file',
        size: nodeSize(e.node),
        originalPath: e.originalPath,
        deletedAt: e.deletedAt
      }));
  }

  function findTrash(id) {
    const entry = doc.trash.find((e) => e.id === id);
    if (!entry) throw new FSError('ENOENT', `Çöp kutusunda böyle bir öğe yok: ${id}`, String(id));
    return entry;
  }

  function restore(id) {
    return mutate((undo) => {
      const entry = findTrash(id);
      const ts = tick();
      let parentPath = dirname(entry.originalPath);
      let dir = doc.root;
      let cur = '';
      const parents = [];
      let blocked = false;
      for (const seg of parentPath === '/' ? [] : parentPath.slice(1).split('/')) {
        const here = cur || '/';
        cur += '/' + seg;
        const child = dir.k[seg];
        if (child === undefined) {
          const made = newDir(ts);
          tx.setChild(dir, seg, made, undo);
          tx.setProp(dir, 'm', ts, undo);
          parents.push(here);
          dir = made;
        } else if (child.t !== 'd') {
          blocked = true; // a file now sits where the original folder used to be
          break;
        } else {
          dir = child;
        }
      }
      if (blocked) {
        // Fall back to the home folder (earlier creations, if any, stay undone by rollback on failure).
        parentPath = HOME;
        dir = peek(HOME);
      }
      const finalName = uniqueIn(dir, entry.name);
      const restored = childPath(parentPath, finalName);
      tx.setChild(dir, finalName, entry.node, undo);
      tx.setProp(dir, 'm', ts, undo);
      tx.trashDel(entry, undo);
      return {
        value: restored,
        event: { type: 'restore', path: restored, oldPath: entry.originalPath, parents: parents.concat(parentPath) }
      };
    });
  }

  function deleteFromTrash(id) {
    return mutate((undo) => {
      const entry = findTrash(id);
      tx.trashDel(entry, undo);
      return { event: { type: 'trashDelete', path: entry.originalPath, parents: [] } };
    });
  }

  function emptyTrash() {
    return mutate((undo) => {
      const entries = doc.trash.slice();
      for (const entry of entries) tx.trashDel(entry, undo);
      return entries.length ? { event: { type: 'emptyTrash', path: 'trash:', parents: [] } } : {};
    });
  }

  function trashCount() {
    ensure();
    return doc.trash.length;
  }

  // ------------------------------------------------------------------ persistence
  function rawGet() {
    try { return localStorage.getItem(RAW_KEY); } catch (e) { return null; }
  }

  function revive(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.v !== 1) return null;
    let root;
    try { root = reviveNode(d.root, 0); } catch (e) { return null; }
    if (!root || root.t !== 'd') return null;
    const trashList = [];
    if (Array.isArray(d.trash)) {
      for (const e of d.trash) {
        if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue;
        if (typeof e.originalPath !== 'string' || e.originalPath.charAt(0) !== '/' || nameProblem(e.name)) continue;
        let node = null;
        try { node = reviveNode(e.node, 0); } catch (x) { node = null; }
        if (!node) continue;
        trashList.push({
          id: e.id,
          name: e.name,
          originalPath: e.originalPath,
          deletedAt: Number.isFinite(e.deletedAt) ? e.deletedAt : Date.now(),
          node
        });
      }
    }
    const out = { v: 1, root, trash: trashList };
    return ensureSystemDirs(out) ? out : null;
  }

  /** Validates and copies a stored node (children become prototype-less maps). */
  function reviveNode(n, depth) {
    if (!n || typeof n !== 'object' || depth > 256) return null;
    const c = Number.isFinite(n.c) ? n.c : Date.now();
    const m = Number.isFinite(n.m) ? n.m : c;
    if (n.t === 'f') return typeof n.d === 'string' ? { t: 'f', c, m, d: n.d } : null;
    if (n.t !== 'd' || !n.k || typeof n.k !== 'object' || Array.isArray(n.k)) return null;
    const k = Object.create(null);
    for (const name of Object.keys(n.k)) {
      if (nameProblem(name)) return null;
      const child = reviveNode(n.k[name], depth + 1);
      if (!child) return null;
      // heal names that were stored decomposed (NFD): normalize() could never reach them
      const nfc = name.normalize('NFC');
      k[nfc !== name && k[nfc] === undefined && n.k[nfc] === undefined ? nfc : name] = child;
    }
    return { t: 'd', c, m, k };
  }

  /** /home, /home/panda and the desktop folder must always exist (self-heal hand-edited data). */
  function ensureSystemDirs(d) {
    let node = d.root;
    const ts = Date.now();
    for (const seg of DESKTOP.slice(1).split('/')) {
      const child = node.k[seg];
      if (child === undefined) {
        const made = newDir(ts);
        node.k[seg] = made;
        node = made;
      } else if (child.t !== 'd') {
        return false;
      } else {
        node = child;
      }
    }
    return true;
  }

  function seedAndPersist() {
    doc = buildSeed();
    invalidate();
    if (!persist()) {
      memoryOnly = true;
      console.warn('[fs] depolama kullanılamıyor; dosya sistemi yalnızca bellekte tutulacak');
      if (P.bus) P.bus.emit('fs:memory-only', {});
    } else {
      memoryOnly = false;
    }
  }

  function backupCorrupt(raw) {
    try {
      S().set(CORRUPT_KEY, { at: Date.now(), raw: typeof raw === 'string' ? raw : String(raw) });
    } catch (e) { /* best effort */ }
  }

  function announceCorruption() {
    console.warn('[fs] kayıtlı dosya sistemi okunamadı; yedeklendi ("fs.corrupt") ve varsayılanlar yüklendi');
    const show = () => {
      try {
        if (typeof P.notify === 'function') {
          P.notify({
            title: 'Dosya sistemi onarıldı',
            message: 'Kayıtlı dosya verisi okunamadığı için varsayılan dosyalar geri yüklendi. Eski veri yedeklendi.',
            icon: 'warning',
            timeout: 9000
          });
        }
      } catch (e) { /* ignore */ }
    };
    if (P.ready) show();
    else if (P.bus) P.bus.once('os:ready', show);
    if (P.bus) P.bus.emit('fs:corrupt', {});
  }

  /** (Re)reads the document from storage; seeds on first run, backs up + re-seeds when corrupt. */
  function load() {
    const stored = S().get(KEY, undefined);
    if (stored === undefined) {
      const raw = rawGet();
      if (raw === null || raw === undefined) { seedAndPersist(); return; } // first run
      backupCorrupt(raw); // key exists but is not parseable JSON
      seedAndPersist();
      announceCorruption();
      return;
    }
    const parsed = revive(stored);
    if (!parsed) {
      let raw = '';
      try { raw = JSON.stringify(stored); } catch (e) { raw = String(stored); }
      backupCorrupt(raw);
      seedAndPersist();
      announceCorruption();
      return;
    }
    doc = parsed;
    memoryOnly = false;
    invalidate();
  }

  function ensure() {
    if (!doc) load();
  }

  function init() {
    if (doc && memoryOnly) return; // memory is the only copy; do not throw it away
    load();
  }

  function reset() {
    const prev = doc;
    doc = buildSeed();
    invalidate();
    if (persist()) {
      memoryOnly = false;
    } else if (!memoryOnly) {
      doc = prev;
      invalidate();
      throw err('ENOSPC', '');
    }
    emit({ type: 'reset', path: '/', parents: ['/'] });
  }

  // another browser tab changed the stored document
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== null && e.key !== RAW_KEY) return;
      try {
        load();
        emit({ type: 'external', path: '/', parents: ['/'] });
      } catch (x) {
        console.error('[fs] harici değişiklik okunamadı', x);
      }
    });
  } catch (e) { /* no window events (non-browser host) */ }

  // ------------------------------------------------------------------ seed data
  const L = (...lines) => lines.join('\n') + '\n';

  const README = L(
    "PandaOS'a Hoş Geldin!",
    '=====================',
    '',
    'Merhaba Panda! Burası tamamen tarayıcının içinde çalışan küçük bir masaüstü',
    'işletim sistemi. Kurulum yok, sunucu yok; sadece keşfetmen yeterli.',
    '',
    '',
    'NELER YAPABİLİRSİN?',
    '-------------------',
    '  * Masaüstündeki simgelere çift tıkla: uygulamalar kendi penceresinde açılır.',
    '  * Sağ tıkla: masaüstünde, dosyalarda ve klasörlerde sağ tık menüsü seni bekliyor.',
    '  * Pencereleri başlık çubuğundan sürükle, kenarlarından boyutlandır.',
    '    Bir pencereyi ekranın sol ya da sağ kenarına sürüklersen yarım ekran olur,',
    '    üst kenarına sürüklersen ekranı kaplar. Başlık çubuğuna çift tıklamak da',
    '    büyütüp küçültür.',
    '  * Alttaki görev çubuğundan pencereler arasında geçiş yap. Sol alttaki panda',
    '    simgesi Başlat menüsünü açar; uygulama ve dosya aramak için yazmaya başla.',
    '  * Saate tıklayınca takvim açılır. Zil simgesi bildirim merkezini gösterir.',
    '  * Güneş/ay simgesiyle (ya da Ayarlar uygulamasından) açık ve koyu tema arasında',
    '    geçiş yap; vurgu rengini ve duvar kağıdını da değiştirebilirsin.',
    '  * Ctrl + Alt + L ile ekranı kilitle.',
    '',
    '',
    'UYGULAMALAR',
    '-----------',
    '  Dosyalar         Klasör oluştur, taşı, yeniden adlandır, sil. Silinenler önce',
    "                   Çöp Kutusu'na gider; oradan geri alabilirsin.",
    '  Terminal         help, ls, cd, cat, mkdir, rm ve daha fazlası. Dosya sistemi',
    '                   Dosyalar ile ortaktır: birinde yaptığın değişiklik',
    '                   diğerinde de görünür.',
    '  Not Defteri      Metin dosyalarını yaz, düzenle, kaydet.',
    '  Hesap Makinesi   Standart ve bilimsel hesaplamalar.',
    '  Müzik Çalar      Şarkılar tarayıcıda, Web Audio ile sentezlenir. Müzik klasöründeki',
    "                   Neşeye Övgü'yü dene!",
    '  Mayın Tarlası    Klasik bulmaca. Sağ tık bayrak koyar.',
    "  2048             Karoları kaydır, 2048'e ulaşmaya çalış.",
    '  Çizim            Çiz, boya, .png olarak Resimler klasörüne kaydet.',
    '  Ayarlar          Tema, ses, bildirimler ve depolama.',
    '',
    '',
    'İPUCU',
    '-----',
    'Terminali aç ve “help” yaz. Sonra “cd ~/Belgeler”, “ls” ve “cat Notlar.txt”',
    'komutlarını sırayla dene.',
    '',
    '',
    'VERİLERİN NEREDE?',
    '-----------------',
    'Dosyaların, ayarların ve oyun rekorların tarayıcının localStorage alanında',
    'saklanır; hiçbir şey internete gönderilmez. Tarayıcı verilerini temizlersen',
    "PandaOS da fabrika ayarlarına döner. Önemli bir şey yazdıysan başka bir yere",
    'de kopyalamayı unutma.',
    '',
    'Bol bambulu günler!',
    '                                                         - Panda'
  );

  const NOTES = L(
    'Notlar',
    '======',
    '',
    'Bugün yapılacaklar',
    "  [x] PandaOS'a giriş yap",
    '  [x] Masaüstünü gez',
    '  [ ] Terminalde “help” yaz',
    '  [ ] Yeni bir klasör oluştur',
    "  [ ] Müzik Çalar'da Neşeye Övgü'yü dinle",
    "  [ ] Mayın Tarlası'nda rekor kır",
    '',
    'Fikirler',
    '  - Masaüstüne yeni bir duvar kağıdı seç',
    '  - Çizim ile bir panda çiz, Resimler klasörüne kaydet',
    "  - 2048'de 2048'e ulaş (bir gün)",
    '  - Belgeler klasörünü konu konu klasörlere ayır',
    '',
    'Hatırlatma',
    '  Her şey tarayıcında saklanıyor. Önemli notlarını başka bir yere de yedekle :)'
  );

  const SHOPPING = L(
    'Alışveriş Listesi',
    '=================',
    '',
    '[ ] Bambu (çok)',
    '[ ] Biraz daha bambu',
    '[ ] Bambu filizi (taze olsun)',
    '[ ] Süt, yumurta, ekmek',
    '[ ] Elma ve muz',
    '[ ] Zeytin, beyaz peynir',
    '[ ] Çay',
    '[ ] Bal (çay için)',
    '[ ] Çikolata (az)',
    '',
    'Not: Bambu reyonuna en son uğra, yoksa sepete başka bir şey sığmıyor.'
  );

  const IDEAS = L(
    '# PandaOS Fikirleri',
    '',
    'Aklıma gelen fikirleri buraya yazıyorum. **Not Defteri** ile düzenleyebilirsin.',
    '',
    '## Tamamlananlar',
    '',
    '- [x] Masaüstü, duvar kağıdı ve kilit ekranı',
    '- [x] Taşınabilir, boyutlandırılabilir pencereler',
    '- [x] Dosya yöneticisi ve çöp kutusu',
    '- [x] Terminal (dosya sistemi ortak!)',
    '- [x] Hesap makinesi, müzik çalar, Mayın Tarlası, 2048',
    '',
    '## Sırada',
    '',
    '- [ ] Hava durumu parçacığı',
    '- [ ] Takvime not ekleme',
    '- [ ] Panda temalı yeni duvar kağıtları',
    '- [ ] Müzik çalara yeni şarkılar (Çiçek Valsi?)',
    '- [ ] Terminale `grep` ve `find`',
    '',
    '## Öncelikler',
    '',
    '| Fikir               | Zorluk | Eğlence |',
    '|---------------------|:------:|:-------:|',
    '| Yeni duvar kağıdı   |   1    |    4    |',
    '| Takvim notları      |   3    |    3    |',
    '| Terminal `grep`     |   2    |    5    |',
    '| Hava durumu         |   4    |    2    |',
    '',
    '## Küçük hatırlatma',
    '',
    '> Bambu yemeden önce kaydetmeyi unutma.',
    '',
    'Terminalden bu dosyaya şöyle ulaşabilirsin:',
    '',
    '```sh',
    'cd ~/Belgeler/Projeler',
    'cat "PandaOS Fikirleri.md"',
    '```'
  );

  const MOTD = L(
    "   .@@@.         .@@@.",
    "  @@@@@@.-------.@@@@@@",
    "   '@@@/         \\@@@'",
    "     /  .@@.   .@@.  \\",
    "    |   @(o)@ @(o)@   |",
    "    |      .---.      |",
    "     \\    (  v  )    /",
    "      '-.  '---'  .-'",
    "         '-.___.-'",
    '',
    'PandaOS 1.0 (Bambu) sistemine hoş geldin!',
    'Komutları görmek için “help” yaz. İyi eğlenceler!'
  );

  const OS_RELEASE = L(
    'NAME="PandaOS"',
    'VERSION="1.0 (Bambu)"',
    'ID=pandaos',
    'ID_LIKE=bambu',
    'VERSION_ID="1.0"',
    'VERSION_CODENAME=bambu',
    'PRETTY_NAME="PandaOS 1.0 (Bambu)"',
    'ANSI_COLOR="0;32"'
  );

  const BIN_COMMANDS = {
    cat: 'Dosya içeriğini yazdırır.',
    cd: 'Çalışma klasörünü değiştirir.',
    clear: 'Terminal ekranını temizler.',
    cp: 'Dosya ve klasör kopyalar.',
    echo: 'Metni yazdırır; “>” ile dosyaya yönlendirilebilir.',
    help: 'Kullanılabilir komutları listeler.',
    kill: 'Çalışan bir uygulamayı sonlandırır.',
    ls: 'Klasörün içeriğini listeler.',
    mkdir: 'Yeni klasör oluşturur.',
    mv: 'Dosya ve klasör taşır ya da yeniden adlandırır.',
    neofetch: 'Sistem bilgisini şık bir özetle gösterir.',
    open: 'Bir dosyayı ya da uygulamayı açar.',
    ps: 'Açık pencereleri listeler.',
    pwd: 'Geçerli klasörün yolunu yazdırır.',
    rm: 'Dosya ve klasör siler.',
    touch: 'Boş bir dosya oluşturur.',
    tree: 'Klasör ağacını gösterir.',
    whoami: 'Oturumdaki kullanıcıyı yazdırır.'
  };

  // Ode to Joy (Beethoven, Symphony No. 9, 4th movement) — 16 bars of 4/4 in C major.
  // Tokens are "note:beats"; "-" is a rest.
  const ODE_LEAD = [
    'E4:1 E4:1 F4:1 G4:1', 'G4:1 F4:1 E4:1 D4:1', 'C4:1 C4:1 D4:1 E4:1', 'E4:1.5 D4:0.5 D4:2',
    'E4:1 E4:1 F4:1 G4:1', 'G4:1 F4:1 E4:1 D4:1', 'C4:1 C4:1 D4:1 E4:1', 'D4:1.5 C4:0.5 C4:2',
    'D4:1 D4:1 E4:1 C4:1', 'D4:1 E4:0.5 F4:0.5 E4:1 C4:1', 'D4:1 E4:0.5 F4:0.5 E4:1 D4:1', 'C4:1 D4:1 G3:2',
    'E4:1 E4:1 F4:1 G4:1', 'G4:1 F4:1 E4:1 D4:1', 'C4:1 C4:1 D4:1 E4:1', 'D4:1.5 C4:0.5 C4:2'
  ];
  // harmony per half bar: C = I, G = V (root notes, half notes)
  const ODE_HARMONY = [
    'C C', 'C G', 'C C', 'C G',
    'C C', 'C G', 'C C', 'G C',
    'G C', 'G C', 'G G', 'C G',
    'C C', 'C G', 'C C', 'G C'
  ];
  const ODE_ROOT = { C: 'C3', G: 'G2' };
  const DRUM_BAR = 'kick:1 hat:1 snare:1 hat:0.5 hat:0.5';
  const DRUM_FILL = 'kick:1 hat:1 snare:0.5 snare:0.5 kick:0.5 clap:0.5';

  function parseTokens(str) {
    return str.trim().split(/\s+/).map((tok) => {
      const [name, beats] = tok.split(':');
      return [name === '-' ? null : name, Number(beats)];
    });
  }

  function buildOdeToJoy() {
    const lead = ODE_LEAD.map(parseTokens);
    const bass = ODE_HARMONY.map((bar) => bar.split(' ').map((chord) => [ODE_ROOT[chord], 2]));
    const drums = ODE_LEAD.map((_, i) => {
      if (i < 4) return [[null, 4]]; // the groove enters with the second phrase
      return parseTokens((i + 1) % 4 === 0 ? DRUM_FILL : DRUM_BAR);
    });
    const bars = (rows) => rows.map((bar) => '      ' + bar.map((n) => JSON.stringify(n)).join(',')).join(',\n');
    const track = (instrument, rows) => `    { "instrument": "${instrument}", "notes": [\n${bars(rows)}\n    ] }`;
    return [
      '{',
      '  "title": "Neşeye Övgü",',
      '  "artist": "L. v. Beethoven",',
      '  "bpm": 110,',
      '  "tracks": [',
      [track('lead', lead), track('bass', bass), track('drums', drums)].join(',\n'),
      '  ]',
      '}',
      ''
    ].join('\n');
  }

  function buildSeed() {
    const now = tick();
    const DAY = 86400000;
    const HOUR = 3600000;
    const installed = now - 21 * DAY;

    const dir = (modified, kids) => {
      const k = Object.create(null);
      if (kids) for (const name of Object.keys(kids)) k[name] = kids[name];
      return { t: 'd', c: installed, m: modified, k };
    };
    const file = (created, modified, content) => ({ t: 'f', c: created, m: modified, d: content });
    const sys = (content) => file(installed, installed, content);
    const shortcut = (appId) => sys(JSON.stringify({ appId }));

    const bin = {};
    for (const name of Object.keys(BIN_COMMANDS)) {
      bin[name] = sys(L('#!/bin/panda-sh', `# yerleşik komut: ${name}`, `# ${BIN_COMMANDS[name]}`));
    }

    const desktop = dir(now - 2 * HOUR, {
      'Dosyalar.app': shortcut('files'),
      'Terminal.app': shortcut('terminal'),
      'Not Defteri.app': shortcut('notepad'),
      'Hesap Makinesi.app': shortcut('calculator'),
      'Müzik Çalar.app': shortcut('music'),
      'Mayın Tarlası.app': shortcut('minesweeper'),
      '2048.app': shortcut('game2048'),
      'Çizim.app': shortcut('paint'),
      'Ayarlar.app': shortcut('settings'),
      'Beni Oku.txt': sys(README)
    });

    const projects = dir(now - 3 * HOUR, {
      'PandaOS Fikirleri.md': file(now - 6 * DAY, now - 3 * HOUR, IDEAS)
    });
    const documents = dir(now - 3 * HOUR, {
      'Notlar.txt': file(now - 9 * DAY, now - 2 * DAY, NOTES),
      'Alışveriş Listesi.txt': file(now - 5 * DAY, now - 1 * DAY, SHOPPING),
      Projeler: projects
    });
    const music = dir(installed, { 'Neşeye Övgü.pmus': sys(buildOdeToJoy()) });

    const panda = dir(now - 2 * HOUR, {
      'Masaüstü': desktop,
      Belgeler: documents,
      Resimler: dir(installed),
      'Müzik': music,
      'İndirilenler': dir(installed)
    });

    const root = dir(installed, {
      bin: dir(installed, bin),
      etc: dir(installed, {
        hostname: sys('pandaos'),
        motd: sys(MOTD),
        'os-release': sys(OS_RELEASE)
      }),
      tmp: dir(installed),
      home: dir(installed, { panda })
    });
    return { v: 1, root, trash: [] };
  }

  // ------------------------------------------------------------------ public API
  P.fs = {
    HOME,
    FSError,
    init,
    reset,
    normalize,
    join,
    dirname,
    basename,
    extname,
    stem,
    displayName,
    exists,
    isDir,
    isFile,
    stat,
    list,
    readFile,
    search,
    walk,
    usage,
    writeFile,
    appendFile,
    mkdir,
    rename,
    move,
    copy,
    remove,
    uniqueName,
    trash,
    listTrash,
    restore,
    deleteFromTrash,
    emptyTrash,
    trashCount,
    isProtected, // extra (not in API.md): true for /, /home, /home/panda and the desktop folder
    _reload() { load(); } // tests: re-read the document from storage
  };
})();
