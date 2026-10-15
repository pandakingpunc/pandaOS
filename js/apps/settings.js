/* PandaOS — Ayarlar (Settings), app id "settings".
   Windows 11 inspired settings app: left navigation (user card, search, pages) + a content area made of
   grouped setting cards. Every control is bound both ways: changing a control writes through
   PandaOS.settings / PandaOS.theme immediately and every control follows 'settings:change' (the taskbar
   theme toggle, another tab, a script …).
   Pages: appearance · wallpaper · sound · notifications · datetime · storage · about.
   Launch args / relaunch: { page, focus } — `focus` is a setting id (see ITEMS) that gets revealed. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const U = P.util;
  const el = U.el;

  const STORE_KEY = 'app.settings';
  const DEFAULT_PAGE = 'appearance';
  const PICTURES_DIR = '/home/panda/Resimler';
  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  const MAX_CUSTOM_WALLPAPERS = 8;

  // ------------------------------------------------------------------ static description of the app
  const PAGES = [
    { id: 'appearance', title: 'Kişiselleştirme', icon: 'palette' },
    { id: 'wallpaper', title: 'Duvar kağıdı', icon: 'image' },
    { id: 'sound', title: 'Ses', icon: 'volume' },
    { id: 'notifications', title: 'Bildirimler', icon: 'bell' },
    { id: 'datetime', title: 'Tarih ve saat', icon: 'time' },
    { id: 'storage', title: 'Depolama', icon: 'save' },
    { id: 'about', title: 'Hakkında', icon: 'info-glyph' }
  ];
  const PAGE_META = {};
  PAGES.forEach((p) => { PAGE_META[p.id] = p; });

  // Single source of truth for the title / description / icon of every setting; also the search index.
  const ITEMS = {
    theme: { page: 'appearance', icon: 'moon', title: 'Tema', desc: 'Uygulamaların ve sistemin görünümünü seç', kw: 'açık koyu karanlık aydınlık sistem otomatik mod görünüm dark light' },
    accent: { page: 'appearance', icon: 'palette', title: 'Vurgu rengi', desc: 'Düğmelerde, seçimlerde ve vurgularda kullanılan renk', kw: 'renk accent bambu okyanus özel hex' },
    animations: { page: 'appearance', icon: 'play', title: 'Animasyonlar', desc: 'Pencere ve menü geçişlerinde hareket efektleri kullan', kw: 'hareket geçiş efekt animasyon' },
    iconSize: { page: 'appearance', icon: 'desktop', title: 'Masaüstü simge boyutu', desc: 'Masaüstündeki simgelerin ve etiketlerin boyutu', kw: 'simge ikon küçük orta büyük masaüstü' },
    wallpaper: { page: 'wallpaper', icon: 'image', title: 'Duvar kağıdı', desc: 'Masaüstü arka planını değiştir', kw: 'arka plan resim görsel wallpaper masaüstü manzara' },
    pickImage: { page: 'wallpaper', icon: 'open', title: 'Kendi resmini seç', desc: 'Resimler klasöründen ya da başka bir yerden bir görsel kullan', kw: 'resim dosya özel fotoğraf göz at seç' },
    volume: { page: 'sound', icon: 'volume', title: 'Ana ses düzeyi', desc: 'Müzik çalar ve sistem seslerinin düzeyi', kw: 'ses seviyesi volume yüksek kıs yüzde' },
    muted: { page: 'sound', icon: 'volume-mute', title: 'Sessiz', desc: 'Tüm sesleri kapat', kw: 'sustur mute sessize al kapat' },
    sounds: { page: 'sound', icon: 'bell', title: 'Sistem sesleri', desc: 'Tıklama, bildirim, açılış ve kapanış seslerini çal', kw: 'ses efekt tık bildirim sesi açılış' },
    soundTest: { page: 'sound', icon: 'play', title: 'Sesi test et', desc: 'Örnek bir ses çalarak çıkışı dene', kw: 'dene hoparlör kulaklık çal' },
    dnd: { page: 'notifications', icon: 'bell-off', title: 'Rahatsız Etmeyin', desc: 'Bildirimler ekranda belirmez, yalnızca bildirim merkezine eklenir', kw: 'sessiz bildirim engelle dnd odak' },
    notifTest: { page: 'notifications', icon: 'bell', title: 'Test bildirimi', desc: 'Bildirimlerin nasıl göründüğünü görmek için bir örnek gönder', kw: 'dene örnek toast' },
    notifHistory: { page: 'notifications', icon: 'list', title: 'Bildirim geçmişi', desc: 'Bildirim merkezinde saklanan bildirimler', kw: 'temizle sil geçmiş liste sayı' },
    clock24h: { page: 'datetime', icon: 'time', title: '24 saat biçimi', desc: 'Saati 24 saatlik düzende göster (ör. 14:30)', kw: 'saat biçim format öö ös 12 saat' },
    showSeconds: { page: 'datetime', icon: 'stopwatch', title: 'Saniyeleri göster', desc: 'Görev çubuğundaki saatte saniyeleri de göster', kw: 'saat saniye görev çubuğu' },
    timezone: { page: 'datetime', icon: 'globe', title: 'Saat dilimi', desc: 'Bu cihazın kullandığı saat dilimi', kw: 'bölge utc gmt zaman dilimi' },
    date: { page: 'datetime', icon: 'document', title: 'Geçerli tarih', desc: 'Bugünün tarihi', kw: 'gün ay yıl takvim bugün' },
    usage: { page: 'storage', icon: 'save', title: 'Depolama kullanımı', desc: 'Dosyaların kapladığı alan', kw: 'disk alan kota dosya belgeler resimler müzik kullanım boyut' },
    trash: { page: 'storage', icon: 'delete', title: 'Çöp kutusu', desc: 'Silinen öğeleri kalıcı olarak kaldır', kw: 'boşalt sil temizle kalıcı' },
    device: { page: 'about', icon: 'cpu', title: 'Cihaz bilgileri', desc: 'Tarayıcı, platform, ekran, işlemci ve bellek', kw: 'tarayıcı platform ekran çözünürlük işlemci çekirdek bellek sürüm çalışma süresi dil' },
    reset: { page: 'about', icon: 'restart', title: 'Fabrika ayarlarına sıfırla', desc: 'Tüm ayarları, dosyaları ve uygulama verilerini siler', kw: 'sıfırla fabrika sil temizle reset tüm veriler' }
  };

  const THEME_CHOICES = [['light', 'Açık', 'light'], ['dark', 'Koyu', 'dark'], ['auto', 'Sistem ile aynı', 'split']];
  const ICON_SIZES = [['small', 'Küçük'], ['medium', 'Orta'], ['large', 'Büyük']];

  // decorative category colours of the storage chart (not theme tokens on purpose: they identify a folder)
  const STORAGE_CATS = [
    { id: 'docs', name: 'Belgeler', dir: 'Belgeler', color: '#3b82f6' },
    { id: 'pics', name: 'Resimler', dir: 'Resimler', color: '#e0498f' },
    { id: 'music', name: 'Müzik', dir: 'Müzik', color: '#8b5cf6' },
    { id: 'desk', name: 'Masaüstü', dir: 'Masaüstü', color: '#f08c1a' },
    { id: 'down', name: 'İndirilenler', dir: 'İndirilenler', color: '#0ea5a4' },
    { id: 'system', name: 'Sistem', dir: null, color: '#64748b' },
    { id: 'trash', name: 'Çöp kutusu', dir: null, color: '#ef5a4c' }
  ];

  // ------------------------------------------------------------------ pure helpers
  const pad = (n) => String(n).padStart(2, '0');
  const num = (n, digits = 0) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: digits });
  const pct = (n, digits = 0) => '%' + num(n, digits);
  const pctSmart = (n) => pct(n, n < 10 || (n >= 99 && n < 100) ? 1 : 0);

  /** Turkish-insensitive folding used by the search: "Duvar kağıdı" matches "duvar kagidi". */
  function fold(s) {
    return String(s == null ? '' : s).toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  }

  function parseHex(s) {
    let v = String(s == null ? '' : s).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = v.replace(/./g, (c) => c + c);
    return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null;
  }

  function parseBrowser(ua) {
    ua = String(ua || '');
    const rules = [
      ['Microsoft Edge', /\bEdg(?:e|A|iOS)?\/(\d+)/],
      ['Opera', /\b(?:OPR|Opera)\/(\d+)/],
      ['Vivaldi', /\bVivaldi\/(\d+)/],
      ['Samsung Internet', /\bSamsungBrowser\/(\d+)/],
      ['Firefox', /\b(?:Firefox|FxiOS)\/(\d+)/],
      ['Chrome', /(?:Headless)?(?:Chrome|CriOS|Chromium)\/(\d+)/],
      ['Safari', /\bVersion\/(\d+)[^]*\bSafari\//]
    ];
    for (const [name, re] of rules) {
      const m = re.exec(ua);
      if (m) return { name, version: m[1], label: `${name} ${m[1]}` };
    }
    return { name: 'Bilinmeyen tarayıcı', version: '', label: 'Bilinmeyen tarayıcı' };
  }

  function parsePlatform(ua, uaData) {
    ua = String(ua || '');
    let name = '';
    if (/Windows NT 10/.test(ua)) name = 'Windows 10/11';
    else if (/Windows NT 6\.3/.test(ua)) name = 'Windows 8.1';
    else if (/Windows NT 6\.[12]/.test(ua)) name = 'Windows 7/8';
    else if (/Windows/.test(ua)) name = 'Windows';
    else if (/Android/.test(ua)) name = 'Android' + ((/Android (\d+)/.exec(ua) || [])[1] ? ' ' + /Android (\d+)/.exec(ua)[1] : '');
    else if (/iPhone|iPod/.test(ua)) name = 'iOS';
    else if (/iPad/.test(ua)) name = 'iPadOS';
    else if (/Mac OS X|Macintosh/.test(ua)) name = 'macOS';
    else if (/CrOS/.test(ua)) name = 'ChromeOS';
    else if (/Linux|X11/.test(ua)) name = 'Linux';
    else name = (uaData && uaData.platform) || (typeof navigator !== 'undefined' && navigator.platform) || 'Bilinmiyor';
    const bits = /Win64|x64|WOW64|x86_64|amd64|arm64|aarch64/i.test(ua) && !/Mac OS X|Macintosh|iPhone|iPad/.test(ua) ? '64 bit' : '';
    return bits ? `${name} · ${bits}` : name;
  }

  function formatUptime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d) return `${d} gün ${h} sa ${m} dk`;
    if (h) return `${h} sa ${m} dk ${sec} sn`;
    if (m) return `${m} dk ${sec} sn`;
    return `${sec} sn`;
  }

  /** Same clock format as the taskbar tray (24 h, or 12 h with ÖÖ / ÖS). */
  function fmtClock(d, withSeconds, h24) {
    const sec = withSeconds ? ':' + pad(d.getSeconds()) : '';
    if (h24) return pad(d.getHours()) + ':' + pad(d.getMinutes()) + sec;
    return (d.getHours() % 12 || 12) + ':' + pad(d.getMinutes()) + sec + ' ' + (d.getHours() < 12 ? 'ÖÖ' : 'ÖS');
  }

  const fmtShortDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const fmtLongDate = (d) => d.toLocaleDateString('tr-TR', { weekday: 'long' }) + ', ' + d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

  function utcOffsetLabel(d) {
    const off = -d.getTimezoneOffset();
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return `UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }

  function relTime(ts) {
    const s = Math.max(0, (Date.now() - Number(ts)) / 1000);
    if (s < 45) return 'az önce';
    const m = Math.max(1, Math.round(s / 60));
    if (m < 60) return `${m} dk önce`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} sa önce`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'dün';
    if (d < 7) return `${d} gün önce`;
    return U.formatDate(ts, { day: 'numeric', month: 'long' });
  }

  function isImageData(path) {
    try {
      const fs = P.fs;
      if (!fs || !fs.isFile(path)) return false;
      return /^\s*data:image\/[a-z0-9.+-]+[;,]/i.test(String(fs.readFile(path) || ''));
    } catch (e) {
      return false;
    }
  }

  const ico = (name, size = 18) => P.icons.el(name, { size });

  function errText(e) {
    return (e && e.message) || String(e);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall back below */ }
    const prev = document.activeElement;
    try {
      const ta = el('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0;opacity:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    } finally {
      try { if (prev && prev.focus) prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  // ------------------------------------------------------------------ persisted app state (custom wallpapers)
  function loadStore() {
    const raw = P.storage.get(STORE_KEY, {});
    const store = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    store.custom = Array.isArray(store.custom) ? store.custom.filter((p) => typeof p === 'string') : [];
    return store;
  }

  // ==================================================================================================
  // the app
  // ==================================================================================================
  function createApp(win, args) {
    const root = win.body;
    root.textContent = '';

    const state = { closed: false, visible: null, current: null, last: DEFAULT_PAGE, mode: 'page', query: '' };
    const disposers = [];
    const timeouts = new Set();
    const intervals = new Set();
    const named = new Map();
    const pages = new Map();
    const hooks = { reload: () => location.reload() };
    const store = loadStore();
    let building = null;

    // ---------------------------------------------------------------- plumbing
    function report(e) {
      console.error('[ayarlar]', e);
    }

    /** Wrap an event handler: never throws, also reports rejected promises. */
    function h(fn) {
      return function (...a) {
        try {
          const r = fn.apply(this, a);
          if (r && typeof r.then === 'function') r.then(null, report);
        } catch (e) { report(e); }
      };
    }

    function later(fn, ms) {
      const id = setTimeout(() => {
        timeouts.delete(id);
        if (!state.closed) h(fn)();
      }, ms);
      timeouts.add(id);
      return id;
    }

    function cancel(id) {
      clearTimeout(id);
      timeouts.delete(id);
    }

    /** Debounce by key: the latest call wins. */
    function schedule(key, fn, ms) {
      if (named.has(key)) cancel(named.get(key));
      named.set(key, later(() => { named.delete(key); fn(); }, ms));
    }

    function every(fn, ms) {
      const id = setInterval(h(fn), ms);
      intervals.add(id);
      return () => { clearInterval(id); intervals.delete(id); };
    }

    function subscribe(evt, fn) {
      disposers.push(P.bus.on(evt, h(fn)));
    }

    function tip(node, text) {
      if (P.ui && typeof P.ui.tip === 'function') {
        const off = P.ui.tip(node, text);
        if (typeof off === 'function') disposers.push(off);
      }
    }

    // Miniature wallpapers. Some wallpapers use pixel-sized gradients ("midnight"), so a thumbnail must not simply
    // shrink the CSS: the wallpaper is laid out at a reference desktop width and the whole layer is scaled down.
    const MINI_W = 1440;
    function mini(css, owner) {
      const inner = el('span', { class: 'st-mini-in' });
      const box = el('span', { class: 'st-mini', 'aria-hidden': 'true' }, inner);
      const m = {
        el: box,
        set(v) { inner.style.background = v || ''; },
        fit() {
          const w = box.clientWidth;
          const hh = box.clientHeight;
          if (!w || !hh) return;
          const k = w / MINI_W;
          inner.style.width = MINI_W + 'px';
          inner.style.height = (hh / k) + 'px';
          inner.style.transform = `scale(${k})`;
        }
      };
      m.set(css);
      if (owner) owner.minis.push(m);
      return m;
    }

    function fitPage(rec) {
      if (rec && rec.minis) rec.minis.forEach((m) => m.fit());
    }

    function syncer(keys, fn) {
      if (!building) throw new Error('syncer yalnızca sayfa oluşturulurken kullanılabilir');
      building.syncers.push({ keys, fn });
      fn();
    }

    function syncAll(key) {
      pages.forEach((rec) => {
        rec.syncers.forEach((s) => {
          if (!s.keys || !key || s.keys.includes(key)) h(s.fn)(key);
        });
      });
    }

    function saveStore() {
      P.storage.set(STORE_KEY, { custom: store.custom });
    }

    async function alertDialog(opts) {
      try { if (P.dialog) await P.dialog.alert(opts); } catch (e) { report(e); }
    }

    // ---------------------------------------------------------------- tiny component factories
    function button(label, o = {}) {
      const b = el('button', { class: 'p-btn' + (o.cls ? ' ' + o.cls : ''), type: 'button' });
      if (o.icon) b.appendChild(ico(o.icon, 16));
      b.$label = el('span', { text: label });
      b.appendChild(b.$label);
      if (o.aria) b.setAttribute('aria-label', o.aria);
      if (o.onClick) b.addEventListener('click', h(o.onClick));
      return b;
    }

    /** A setting card row: icon, title, description and a control on the right (or a body below). */
    function row(sid, o = {}) {
      const it = ITEMS[sid] || {};
      const title = o.title || it.title || '';
      const desc = o.desc !== undefined ? o.desc : it.desc;
      const icon = o.icon || it.icon;
      const $title = el('div', { class: 'st-row-title', text: title });
      const $desc = el('div', { class: 'st-row-desc', text: desc || '' });
      $desc.hidden = !desc;
      const $icon = icon ? el('div', { class: 'st-row-icon', 'aria-hidden': 'true' }, ico(icon, 18)) : null;
      const $ctl = o.control ? el('div', { class: 'st-row-ctl' }, o.control) : null;
      const head = el('div', { class: 'st-row-head' }, $icon, el('div', { class: 'st-row-text' }, $title, $desc), $ctl);
      const r = el('div', {
        class: 'st-row p-card' + (o.body ? ' st-stack' : '') + (o.cls ? ' ' + o.cls : ''),
        dataset: { sid }
      }, head, o.body ? el('div', { class: 'st-row-body' }, o.body) : null);
      Object.assign(r, { $title, $desc, $icon, $ctl });
      return r;
    }

    function setDesc(r, text) {
      r.$desc.textContent = text || '';
      r.$desc.hidden = !text;
    }

    function setRowIcon(r, name) {
      if (r.$icon) r.$icon.replaceChildren(ico(name, 18));
    }

    const group = (...rows) => el('div', { class: 'st-group' }, rows);

    function section(title, ...children) {
      return el('div', { class: 'st-section' }, title ? el('h2', { class: 'st-section-title', text: title }) : null, children);
    }

    function pageShell(id, ...children) {
      return el('section', { class: 'st-page', dataset: { page: id }, 'aria-label': PAGE_META[id].title },
        el('h1', { class: 'st-title', text: PAGE_META[id].title }), children);
    }

    function switchCtl(key, label) {
      const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': label, dataset: { key } });
      input.addEventListener('change', h(() => P.settings.set(key, input.checked)));
      syncer([key], () => {
        const v = !!P.settings.get(key);
        if (input.checked !== v) input.checked = v;
      });
      return el('label', { class: 'p-switch' }, input, el('span'));
    }

    function sliderCtl(key, o) {
      const input = el('input', { class: 'p-range', type: 'range', min: o.min, max: o.max, step: o.step || 1, 'aria-label': o.label, dataset: { key } });
      const fill = () => input.style.setProperty('--p', String((Number(input.value) - o.min) / (o.max - o.min)));
      input.addEventListener('input', h(() => {
        fill();
        P.settings.set(key, Number(input.value));
      }));
      input.addEventListener('change', h(() => { if (P.sound && P.sound.play) P.sound.play('click'); }));
      syncer([key], () => {
        const v = Number(P.settings.get(key));
        if (Number(input.value) !== v) input.value = String(v);
        fill();
      });
      return input;
    }

    /** Roving-tabindex radio group over `items` ([{el, value}], mutable). Used by cards, swatches, thumbs, segments. */
    function radioGroup(container, items, o) {
      const cls = o.activeClass || 'selected';
      const eq = o.eq || ((a, b) => a === b);

      function apply() {
        const cur = o.get();
        const idx = items.findIndex((it) => eq(it.value, cur));
        items.forEach((it, i) => {
          const on = i === idx;
          it.el.setAttribute('aria-checked', on ? 'true' : 'false');
          it.el.classList.toggle(cls, on);
          it.el.tabIndex = (idx === -1 ? i === 0 : on) ? 0 : -1;
        });
      }

      function columns() {
        if (!o.grid || !items.length) return 1;
        const top = items[0].el.offsetTop;
        let n = 0;
        for (const it of items) { if (Math.abs(it.el.offsetTop - top) < 4) n++; else break; }
        return Math.max(1, n);
      }

      container.addEventListener('click', h((e) => {
        const b = e.target.closest('[role="radio"]');
        if (!b || !container.contains(b)) return;
        const it = items.find((x) => x.el === b);
        if (it) o.set(it.value);
      }));

      container.addEventListener('keydown', h((e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const i = items.findIndex((it) => it.el === document.activeElement);
        if (i < 0) return;
        const cols = columns();
        let n;
        switch (e.key) {
          case 'ArrowRight': n = i + 1; break;
          case 'ArrowLeft': n = i - 1; break;
          case 'ArrowDown': n = i + (o.grid ? cols : 1); break;
          case 'ArrowUp': n = i - (o.grid ? cols : 1); break;
          case 'Home': n = 0; break;
          case 'End': n = items.length - 1; break;
          default: return;
        }
        e.preventDefault();
        if (o.grid) n = Math.min(items.length - 1, Math.max(0, n));
        else n = (n + items.length) % items.length;
        const target = items[n];
        if (!target) return;
        items.forEach((it) => { it.el.tabIndex = it === target ? 0 : -1; });
        target.el.focus();
        if (o.selectOnMove) o.set(target.value);
      }));

      syncer(o.keys, apply);
      return { apply };
    }

    function segmentedCtl(key, options, label) {
      const box = el('div', { class: 'p-segmented', role: 'radiogroup', 'aria-label': label, dataset: { key } });
      const items = options.map(([value, text]) => {
        const b = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', dataset: { value }, text });
        box.appendChild(b);
        return { el: b, value };
      });
      radioGroup(box, items, {
        keys: [key], activeClass: 'active', selectOnMove: true,
        get: () => P.settings.get(key),
        set: (v) => P.settings.set(key, v)
      });
      return box;
    }

    // ---------------------------------------------------------------- navigation shell
    const searchInput = el('input', {
      class: 'p-input st-search-input', type: 'text', role: 'searchbox', placeholder: 'Ayar ara',
      'aria-label': 'Ayarlarda ara', autocomplete: 'off', spellcheck: 'false'
    });
    const searchClear = el('button', { class: 'st-search-clear', type: 'button', 'aria-label': 'Aramayı temizle', hidden: true }, ico('x', 14));
    const navList = el('nav', { class: 'p-list st-navlist', 'aria-label': 'Ayarlar sayfaları' });
    const navButtons = {};
    PAGES.forEach((pg) => {
      const b = el('button', { class: 'p-list-item st-nav-item', type: 'button', dataset: { page: pg.id } }, ico(pg.icon, 18), el('span', { class: 'st-nav-label', text: pg.title }));
      b.addEventListener('click', h(() => goto(pg.id)));
      navButtons[pg.id] = b;
      navList.appendChild(b);
    });
    navList.addEventListener('keydown', h((e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const btns = PAGES.map((p) => navButtons[p.id]);
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      let n;
      if (e.key === 'ArrowDown') n = (i + 1) % btns.length;
      else if (e.key === 'ArrowUp') n = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = btns.length - 1;
      else return;
      e.preventDefault();
      btns[n].focus();
    }));

    const nav = el('aside', { class: 'p-sidebar st-nav' },
      el('div', { class: 'st-user' },
        el('div', { class: 'st-avatar' }, P.icons.el('avatar', { size: 44 })),
        el('div', { class: 'st-user-text' },
          el('div', { class: 'st-user-name', text: (P.user && P.user.displayName) || 'Panda' }),
          el('div', { class: 'st-user-sub', text: 'Yerel hesap' }))),
      el('div', { class: 'st-search' }, el('span', { class: 'st-search-icon', 'aria-hidden': 'true' }, ico('search', 15)), searchInput, searchClear),
      navList);

    const content = el('div', { class: 'st-content' });
    const scroll = el('main', { class: 'st-scroll' }, content);
    const shell = el('div', { class: 'st-shell' }, nav, scroll);
    root.appendChild(shell);

    function setNavSelected(id) {
      PAGES.forEach((pg) => {
        const on = pg.id === id;
        navButtons[pg.id].classList.toggle('selected', on);
        if (on) navButtons[pg.id].setAttribute('aria-current', 'page');
        else navButtons[pg.id].removeAttribute('aria-current');
      });
    }

    function show(rec, animate) {
      if (state.visible && state.visible !== rec && state.visible.hide) h(state.visible.hide)();
      state.visible = rec;
      content.replaceChildren(rec.root);
      scroll.scrollTop = 0;
      fitPage(rec);
      // ?fast=1 (tests, screenshots) and animations=false skip the page transition, like the window manager does
      if (animate && P.params.get('fast') !== '1' && P.settings.get('animations') !== false) {
        rec.root.classList.remove('st-enter');
        void rec.root.offsetWidth; // restart the CSS animation
        rec.root.classList.add('st-enter');
        later(() => rec.root.classList.remove('st-enter'), 600);
      }
      if (rec.show) h(rec.show)();
    }

    function ensurePage(id) {
      let rec = pages.get(id);
      if (!rec) {
        rec = { id, root: null, syncers: [], minis: [], show: null, hide: null };
        building = rec;
        try { BUILDERS[id](rec); } finally { building = null; }
        pages.set(id, rec);
      }
      return rec;
    }

    function revealSetting(sid) {
      const rec = state.visible;
      if (!rec || !rec.root) return false;
      const target = rec.root.querySelector(`[data-sid="${sid}"]`);
      if (!target) return false;
      target.scrollIntoView({ block: 'start', behavior: P.settings.get('animations') === false ? 'auto' : 'smooth' });
      target.classList.remove('st-flash');
      void target.offsetWidth;
      target.classList.add('st-flash');
      later(() => target.classList.remove('st-flash'), 1800);
      const f = target.querySelector('input:not([disabled]), button:not([disabled]), [tabindex="0"]');
      if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      return true;
    }

    function goto(id, opts = {}) {
      if (!PAGE_META[id]) return false;
      if (state.mode === 'search') {
        state.mode = 'page';
        state.query = '';
        searchInput.value = '';
        searchClear.hidden = true;
      }
      const rec = ensurePage(id);
      setNavSelected(id);
      if (state.visible !== rec) show(rec, opts.animate !== false);
      state.current = id;
      state.last = id;
      if (opts.focus) revealSetting(opts.focus);
      return true;
    }

    // ---------------------------------------------------------------- search
    function searchItems(query) {
      const tokens = fold(query).split(/\s+/).filter(Boolean);
      if (!tokens.length) return [];
      const out = [];
      Object.keys(ITEMS).forEach((sid, order) => {
        const it = ITEMS[sid];
        const pg = fold(PAGE_META[it.page].title);
        const title = fold(it.title);
        const kw = fold(it.kw || '');
        const desc = fold(it.desc || '');
        const hay = `${title} ${kw} ${desc} ${pg}`;
        if (!tokens.every((t) => hay.includes(t))) return;
        let score = 0;
        tokens.forEach((t) => {
          if (title.startsWith(t)) score += 6;
          else if (title.split(' ').some((w) => w.startsWith(t))) score += 5;
          else if (title.includes(t)) score += 4;
          else if (kw.split(' ').some((w) => w.startsWith(t))) score += 3;
          else if (kw.includes(t)) score += 2;
          else if (pg.includes(t)) score += 1.5;
          else score += 1;
        });
        out.push({ sid, it, score, order });
      });
      out.sort((a, b) => b.score - a.score || a.order - b.order);
      return out;
    }

    function highlight(text, tokens) {
      const folded = fold(text);
      if (folded.length !== text.length) return document.createTextNode(text);
      const spans = [];
      tokens.forEach((t) => {
        let from = 0;
        for (;;) {
          const i = folded.indexOf(t, from);
          if (i < 0) break;
          spans.push([i, i + t.length]);
          from = i + t.length;
        }
      });
      if (!spans.length) return document.createTextNode(text);
      spans.sort((a, b) => a[0] - b[0]);
      const merged = [spans[0].slice()];
      for (const s of spans.slice(1)) {
        const last = merged[merged.length - 1];
        if (s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
        else merged.push(s.slice());
      }
      const frag = document.createDocumentFragment();
      let pos = 0;
      merged.forEach(([a, b]) => {
        if (a > pos) frag.appendChild(document.createTextNode(text.slice(pos, a)));
        frag.appendChild(el('mark', { text: text.slice(a, b) }));
        pos = b;
      });
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      return frag;
    }

    function openResult(sid) {
      const it = ITEMS[sid];
      if (!it) return;
      goto(it.page, { focus: sid });
    }

    function buildResults(query, results) {
      const tokens = fold(query).split(/\s+/).filter(Boolean);
      const rec = { id: 'results', root: null, syncers: [] };
      let body;
      if (results.length) {
        body = group(results.map(({ sid, it }) => {
          const title = el('div', { class: 'st-row-title' });
          title.appendChild(highlight(it.title, tokens));
          const b = el('button', { class: 'st-row st-result p-card', type: 'button', dataset: { sid } },
            el('div', { class: 'st-row-head' },
              el('div', { class: 'st-row-icon', 'aria-hidden': 'true' }, ico(it.icon, 18)),
              el('div', { class: 'st-row-text' }, title, el('div', { class: 'st-row-desc', text: it.desc })),
              el('div', { class: 'st-row-ctl' }, el('span', { class: 'st-chip', text: PAGE_META[it.page].title }), ico('chevron-right', 16))));
          b.addEventListener('click', h(() => openResult(sid)));
          return b;
        }));
      } else {
        body = el('div', { class: 'p-empty st-empty', role: 'status' },
          ico('search', 40),
          el('h3', { text: 'Sonuç bulunamadı' }),
          el('p', { text: `“${query.trim()}” ile eşleşen bir ayar yok. Başka bir sözcük dene.` }));
      }
      rec.root = el('section', { class: 'st-page st-results-page', dataset: { page: 'results' }, 'aria-label': 'Arama sonuçları' },
        el('h1', { class: 'st-title', text: 'Arama sonuçları' }),
        el('div', { class: 'st-result-count', role: 'status', text: results.length ? `“${query.trim()}” için ${results.length} sonuç` : '' }),
        body);
      rec.root.addEventListener('keydown', h((e) => {
        const btns = [...rec.root.querySelectorAll('.st-result')];
        const i = btns.indexOf(document.activeElement);
        if (i < 0) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[i]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (i === 0) searchInput.focus(); else btns[i - 1].focus(); }
      }));
      return rec;
    }

    function runSearch(query) {
      const q = String(query == null ? '' : query);
      if (!fold(q).trim()) { clearSearch(); return; }
      const animate = state.mode !== 'search';
      state.mode = 'search';
      state.query = q;
      searchClear.hidden = false;
      const results = searchItems(q);
      setNavSelected(null);
      state.current = null;
      show(buildResults(q, results), animate);
    }

    function clearSearch(opts = {}) {
      const was = state.mode === 'search';
      state.mode = 'page';
      state.query = '';
      searchInput.value = '';
      searchClear.hidden = true;
      if (was) goto(state.last, { animate: false });
      if (opts.focus) searchInput.focus();
    }

    searchInput.addEventListener('input', h(() => runSearch(searchInput.value)));
    searchInput.addEventListener('keydown', h((e) => {
      if (e.key === 'Escape' && (searchInput.value || state.mode === 'search')) {
        e.preventDefault();
        e.stopPropagation();
        clearSearch();
      } else if (e.key === 'Enter') {
        const first = content.querySelector('.st-result');
        if (first) { e.preventDefault(); first.click(); }
      } else if (e.key === 'ArrowDown') {
        const first = content.querySelector('.st-result');
        if (first) { e.preventDefault(); first.focus(); }
      }
    }));
    searchClear.addEventListener('click', h(() => clearSearch({ focus: true })));

    // the miniatures are scaled to their box: refit whenever the content width changes
    disposers.push(win.on('resize', h(() => fitPage(state.visible))));
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(h(() => fitPage(state.visible)));
      ro.observe(content);
      disposers.push(() => ro.disconnect());
    }

    function focusSearch() {
      searchInput.focus();
      searchInput.select();
    }

    disposers.push(win.on('keydown', h((e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'f') {
        e.preventDefault();
        focusSearch();
      } else if (e.key === 'Escape' && state.mode === 'search' && !(P.dialog && P.dialog.isOpen && P.dialog.isOpen())) {
        e.preventDefault();
        clearSearch({ focus: true });
      }
    })));

    // ==================================================================================================
    // pages
    // ==================================================================================================

    // ---------------------------------------------------------------- Kişiselleştirme
    function mockDesktop(kind, rec) {
      const layer = (variant, side) => el('div', { class: `st-mock-layer is-${variant}${side ? ' clip-' + side : ''}` },
        el('div', { class: 'st-mock-win' },
          el('div', { class: 'st-mock-tb' }, el('span'), el('span'), el('span')),
          el('div', { class: 'st-mock-body' },
            el('span', { class: 'st-mock-h' }), el('span', { class: 'st-mock-l' }), el('span', { class: 'st-mock-l short' }), el('span', { class: 'st-mock-acc' }))),
        el('div', { class: 'st-mock-task' }, el('span', { class: 'start' }), el('span'), el('span'), el('span')));
      const wall = mini('', rec);
      const mock = el('div', { class: 'st-mock', 'aria-hidden': 'true' }, wall.el, kind === 'split' ? [layer('light', 'l'), layer('dark', 'r')] : layer(kind),
        el('span', { class: 'st-check' }, ico('check', 14)));
      return { el: mock, wall };
    }

    function buildAppearance(rec) {
      // --- theme
      const themeGrid = el('div', { class: 'st-theme-grid', role: 'radiogroup', 'aria-label': 'Tema' });
      const walls = [];
      const themeItems = THEME_CHOICES.map(([value, label, kind]) => {
        const mock = mockDesktop(kind, rec);
        walls.push(mock.wall);
        const b = el('button', { class: 'st-theme', type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': label, dataset: { value } },
          mock.el, el('span', { class: 'st-theme-name', text: label }));
        themeGrid.appendChild(b);
        return { el: b, value };
      });
      radioGroup(themeGrid, themeItems, {
        keys: ['theme'], selectOnMove: true,
        get: () => P.settings.get('theme'),
        set: (v) => P.theme.set(v)
      });
      syncer(['wallpaper'], () => {
        const bg = P.wallpapers ? P.wallpapers.css(P.settings.get('wallpaper')) : '';
        walls.forEach((w) => w.set(bg));
      });

      // --- accent
      const swatchBox = el('div', { class: 'st-swatches', role: 'radiogroup', 'aria-label': 'Vurgu rengi' });
      const accents = (P.settings.ACCENTS || []);
      const swatchItems = accents.map((a) => {
        const pair = P.theme.accentPair ? P.theme.accentPair(a.value) : null;
        const b = el('button', {
          class: 'st-swatch', type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': a.name,
          dataset: { value: a.value }, style: `--sw:${a.value};--on:${pair ? pair.on : '#ffffff'}`
        }, ico('check', 16));
        tip(b, a.name);
        swatchBox.appendChild(b);
        return { el: b, value: a.value };
      });
      const eqColor = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
      radioGroup(swatchBox, swatchItems, {
        keys: ['accent'], selectOnMove: true, eq: eqColor,
        get: () => P.settings.get('accent'),
        set: (v) => P.settings.set('accent', v)
      });

      const picker = el('input', { class: 'st-color-input', type: 'color', 'aria-label': 'Özel vurgu rengi', dataset: { key: 'accent' } });
      const customSw = el('label', { class: 'st-swatch st-swatch-custom' }, picker, el('span', { class: 'st-custom-glyph' }, ico('palette', 16)), el('span', { class: 'st-custom-check' }, ico('check', 16)));
      tip(customSw, 'Özel renk');
      const hex = el('input', {
        class: 'p-input small st-hex', type: 'text', maxlength: 7, spellcheck: 'false', autocomplete: 'off',
        placeholder: '#2f9e6b', 'aria-label': 'Vurgu rengi (onaltılık kod)'
      });
      const accentName = el('span', { class: 'st-accent-name' });

      picker.addEventListener('input', h(() => { const v = parseHex(picker.value); if (v) P.settings.set('accent', v); }));
      hex.addEventListener('input', h(() => {
        const v = /^#?[0-9a-f]{6}$/i.test(hex.value.trim()) ? parseHex(hex.value) : null;
        hex.classList.remove('invalid');
        if (v) P.settings.set('accent', v);
      }));
      const commitHex = h(() => {
        const v = parseHex(hex.value);
        if (v) {
          hex.classList.remove('invalid');
          P.settings.set('accent', v);
          hex.value = v;
        } else if (hex.value.trim()) {
          hex.classList.add('invalid');
          later(() => { hex.classList.remove('invalid'); hex.value = String(P.settings.get('accent')); }, 900);
        } else {
          hex.value = String(P.settings.get('accent'));
        }
      });
      hex.addEventListener('change', commitHex);
      hex.addEventListener('keydown', h((e) => { if (e.key === 'Enter') commitHex(); }));

      syncer(['accent'], () => {
        const cur = String(P.settings.get('accent'));
        const known = accents.find((a) => eqColor(a.value, cur));
        const v = parseHex(cur) || '#2f9e6b';
        if (picker.value !== v) picker.value = v;
        if (document.activeElement !== hex) hex.value = cur;
        accentName.textContent = known ? known.name : 'Özel renk';
        customSw.classList.toggle('selected', !known);
        const pair = P.theme.accentPair ? P.theme.accentPair(v) : null;
        customSw.style.cssText = `--sw:${v};--on:${pair ? pair.on : '#ffffff'}`;
      });

      const accentBody = el('div', { class: 'st-accent' }, swatchBox, customSw, hex);

      const themeRow = row('theme', { body: themeGrid });
      const accentRow = row('accent', { body: accentBody, control: accentName });
      const animRow = row('animations', { control: switchCtl('animations', 'Animasyonlar') });
      const sizeRow = row('iconSize', { control: segmentedCtl('desktop.iconSize', ICON_SIZES, 'Masaüstü simge boyutu') });

      rec.root = pageShell('appearance',
        group(themeRow),
        section('Renk', group(accentRow)),
        section('Masaüstü ve hareket', group(sizeRow, animRow)));
    }

    // ---------------------------------------------------------------- Duvar kağıdı
    function wallpaperList() {
      return Array.isArray(P.wallpapers) ? P.wallpapers : [];
    }

    function customWallpapers() {
      const cur = String(P.settings.get('wallpaper'));
      const list = store.custom.filter((p) => isImageData(p));
      if (cur.startsWith('vfs:')) {
        const p = cur.slice(4);
        if (!list.includes(p)) list.unshift(p);
      }
      return list.slice(0, MAX_CUSTOM_WALLPAPERS + 1);
    }

    function rememberCustom(path) {
      store.custom = [path, ...store.custom.filter((p) => p !== path)].slice(0, MAX_CUSTOM_WALLPAPERS);
      saveStore();
    }

    function buildWallpaper(rec) {
      // --- live preview of the desktop
      const screen = mini('', rec);
      const miniIcon = (name, label) => el('div', { class: 'st-wp-icon' }, P.icons.el(name, { size: '5.2cqw' }), el('span', { text: label }));
      const clockEl = el('span', { class: 'st-wp-clock' });
      const preview = el('div', { class: 'st-wp-preview', role: 'img', 'aria-label': 'Masaüstü önizlemesi' },
        screen.el,
        el('div', { class: 'st-wp-icons' }, miniIcon('files', 'Dosyalar'), miniIcon('terminal', 'Terminal'), miniIcon('trash', 'Çöp')),
        el('div', { class: 'st-wp-win' },
          el('div', { class: 'st-wp-tb' }, el('span'), el('span'), el('span')),
          el('div', { class: 'st-wp-body' }, el('span', { class: 'h' }), el('span', { class: 'l' }), el('span', { class: 'l short' }), el('span', { class: 'acc' }))),
        el('div', { class: 'st-wp-task' },
          el('div', { class: 'st-wp-apps' }, P.icons.el('panda', { size: '4.6cqw' }), P.icons.el('files', { size: '4.2cqw' }), P.icons.el('terminal', { size: '4.2cqw' }), P.icons.el('notepad', { size: '4.2cqw' })),
          clockEl));

      const nameEl = el('div', { class: 'st-wp-name' });
      const kindEl = el('div', { class: 'st-wp-kind' });
      const pickBtn = button('Resim seç…', { icon: 'open', cls: 'primary', onClick: () => pickImage() });
      const randomBtn = button('Rastgele', { icon: 'shuffle', cls: 'ghost', onClick: () => randomWallpaper() });
      const info = el('div', { class: 'st-wp-info', dataset: { sid: 'pickImage' } },
        el('div', { class: 'st-wp-label', text: 'Geçerli duvar kağıdı' }), nameEl, kindEl,
        el('div', { class: 'st-wp-actions' }, pickBtn, randomBtn));
      const hero = el('div', { class: 'st-wp-hero p-card', dataset: { sid: 'wallpaper' } }, preview, info);

      syncer(['clock24h'], () => {
        clockEl.textContent = fmtClock(new Date(), false, P.settings.get('clock24h') !== false);
      });
      let heroCss = null;
      syncer(['wallpaper'], () => {
        const v = String(P.settings.get('wallpaper'));
        const css = P.wallpapers ? P.wallpapers.css(v) : '';
        if (css !== heroCss) { heroCss = css; screen.set(css); }
        if (v.startsWith('vfs:')) {
          const path = v.slice(4);
          nameEl.textContent = P.fs.basename(path);
          kindEl.textContent = isImageData(path) ? `Özel resim · ${path}` : 'Dosya bulunamadı ya da geçerli bir resim değil';
        } else {
          const w = wallpaperList().find((x) => x.id === v) || wallpaperList().find((x) => x.id === P.wallpapers.DEFAULT) || { name: v };
          nameEl.textContent = w.name;
          kindEl.textContent = 'Yerleşik duvar kağıdı';
        }
      });

      // --- thumbnail grid
      const grid = el('div', { class: 'st-wp-grid', role: 'radiogroup', 'aria-label': 'Duvar kağıdı' });
      const items = [];
      function thumb(value, label, css, o = {}) {
        const m = mini(css, rec);
        m.grid = true;
        const b = el('button', {
          class: 'st-wp' + (o.custom ? ' custom' : ''), type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': label,
          dataset: { value }
        },
          el('span', { class: 'st-wp-img' }, m.el, el('span', { class: 'st-check' }, ico('check', 14))),
          el('span', { class: 'st-wp-cap', text: label }));
        if (o.tip) tip(b, o.tip);
        grid.appendChild(b);
        items.push({ el: b, value });
      }
      function renderGrid() {
        grid.textContent = '';
        items.length = 0;
        rec.minis = rec.minis.filter((m) => !m.grid);
        wallpaperList().forEach((w) => thumb(w.id, w.name, w.css));
        customWallpapers().forEach((p) => {
          thumb('vfs:' + p, P.fs.stem(p), P.wallpapers.css('vfs:' + p), { custom: true, tip: p });
        });
        radio.apply();
        if (state.visible === rec) fitPage(rec);
      }
      const radio = radioGroup(grid, items, {
        keys: ['wallpaper'], grid: true,
        get: () => String(P.settings.get('wallpaper')),
        set: (v) => P.settings.set('wallpaper', v)
      });
      // the custom pictures (and whether their files still exist / changed) decide when the grid is rebuilt
      let customSig = '';
      const sigOf = () => customWallpapers().map((p) => { const st = P.fs.stat(p); return p + '@' + (st ? st.modified : 0); }).join('|');
      const renderCustomGrid = () => { customSig = sigOf(); renderGrid(); };
      renderCustomGrid();
      rec.refreshCustom = () => {
        if (sigOf() === customSig) return;
        renderCustomGrid();
        syncAll('wallpaper');
      };
      // a picture set from somewhere else (file manager, Paint …) joins the list and is remembered
      syncer(['wallpaper'], () => {
        const v = String(P.settings.get('wallpaper'));
        if (!v.startsWith('vfs:')) return;
        const path = v.slice(4);
        if (isImageData(path) && !store.custom.includes(path)) rememberCustom(path);
        if (!items.some((it) => it.value === v)) renderCustomGrid();
      });

      grid.addEventListener('contextmenu', h((e) => {
        const b = e.target.closest('.st-wp');
        if (!b || !P.contextMenu) return;
        e.preventDefault();
        const value = b.dataset.value;
        const isCustom = value.startsWith('vfs:');
        const isCurrent = String(P.settings.get('wallpaper')) === value;
        P.contextMenu.show(e, [
          { label: 'Duvar kağıdı yap', icon: 'image', disabled: isCurrent, action: () => P.settings.set('wallpaper', value) },
          isCustom && { type: 'separator' },
          isCustom && {
            label: 'Listeden kaldır', icon: 'x', disabled: isCurrent,
            action: () => {
              store.custom = store.custom.filter((p) => p !== value.slice(4));
              saveStore();
              rec.refreshCustom();
            }
          }
        ]);
      }));

      async function pickImage() {
        if (!P.dialog || !P.dialog.pickFile) return;
        pickBtn.disabled = true;
        let path = null;
        try {
          path = await P.dialog.pickFile({
            mode: 'open', title: 'Duvar kağıdı olarak bir resim seç',
            dir: P.fs.isDir(PICTURES_DIR) ? PICTURES_DIR : P.fs.HOME, extensions: IMAGE_EXTS
          });
        } catch (e) {
          report(e);
        } finally {
          pickBtn.disabled = false;
        }
        if (!path || state.closed) return;
        if (!isImageData(path)) {
          await alertDialog({
            title: 'Duvar kağıdı ayarlanamadı',
            message: `“${P.fs.basename(path)}” geçerli bir resim verisi içermiyor. PNG, JPEG, GIF, WebP ya da SVG olarak kaydedilmiş bir resim seç.`,
            icon: 'warning'
          });
          return;
        }
        rememberCustom(path);
        P.settings.set('wallpaper', 'vfs:' + path);
        rec.refreshCustom();
      }

      function randomWallpaper() {
        const all = wallpaperList().map((w) => w.id);
        const cur = String(P.settings.get('wallpaper'));
        const pool = all.filter((id) => id !== cur);
        if (!pool.length) return;
        P.settings.set('wallpaper', pool[Math.floor(Math.random() * pool.length)]);
      }
      rec.pickImage = pickImage;

      rec.root = pageShell('wallpaper', hero, section('Duvar kağıtları', el('div', { class: 'st-wp-gridwrap' }, grid)));
    }

    // ---------------------------------------------------------------- Ses
    function buildSound(rec) {
      const slider = sliderCtl('volume', { min: 0, max: 100, label: 'Ana ses düzeyi' });
      const val = el('span', { class: 'st-vol-val', 'aria-hidden': 'true' });
      const volRow = row('volume', { control: el('div', { class: 'st-vol' }, slider, val) });
      syncer(['volume', 'muted'], () => {
        const v = Number(P.settings.get('volume')) || 0;
        const muted = !!P.settings.get('muted');
        val.textContent = pct(v);
        slider.setAttribute('aria-valuetext', pct(v));
        setRowIcon(volRow, muted || v === 0 ? 'volume-mute' : v < 50 ? 'volume-low' : 'volume');
        volRow.classList.toggle('st-off', muted);
      });

      const mutedRow = row('muted', { control: switchCtl('muted', 'Sessiz') });
      const soundsRow = row('sounds', { control: switchCtl('sounds', 'Sistem sesleri') });

      const eq = el('span', { class: 'st-eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i'));
      const testBtn = button('Sesi test et', { icon: 'play', onClick: () => testSound() });
      const testRow = row('soundTest', { control: [eq, testBtn] });
      function testSound() {
        if (P.sound && typeof P.sound.play === 'function') P.sound.play('notify');
        testRow.classList.add('playing');
        later(() => testRow.classList.remove('playing'), 1200);
      }
      syncer(['muted', 'sounds', 'volume'], () => {
        const quiet = !!P.settings.get('muted') || !P.settings.get('sounds') || !Number(P.settings.get('volume'));
        setDesc(testRow, quiet
          ? 'Ses şu an kapalı olduğundan duyamayabilirsin: Sessiz, Sistem sesleri ve ses düzeyini denetle.'
          : ITEMS.soundTest.desc);
        testRow.classList.toggle('st-warn', quiet);
      });

      rec.root = pageShell('sound', group(volRow, mutedRow), section('Sistem sesleri', group(soundsRow, testRow)));
    }

    // ---------------------------------------------------------------- Bildirimler
    function buildNotifications(rec) {
      const dndRow = row('dnd', { control: switchCtl('dnd', 'Rahatsız Etmeyin') });

      const testBtn = button('Test bildirimi gönder', { icon: 'bell', onClick: () => sendTest() });
      const testRow = row('notifTest', { control: testBtn });
      function sendTest() {
        if (typeof P.notify !== 'function') return;
        P.notify({ title: 'Test bildirimi', message: 'Ayarlar uygulamasından gönderildi. Bildirimler düzgün çalışıyor.', icon: 'settings', timeout: 5000 });
      }
      syncer(['dnd'], () => {
        setDesc(testRow, P.settings.get('dnd')
          ? 'Rahatsız Etmeyin açık: bildirim ekranda belirmeyecek, yalnızca geçmişe eklenecek.'
          : ITEMS.notifTest.desc);
      });

      const clearBtn = button('Bildirim geçmişini temizle', { icon: 'delete', onClick: () => clearHistory() });
      const histRow = row('notifHistory', { control: clearBtn });
      const list = el('div', { class: 'st-notif-list p-card' });
      const listSection = section('Son bildirimler', list);

      function clearHistory() {
        if (typeof P.notify === 'function' && P.notify.clear) P.notify.clear();
        refresh();
      }

      function refresh() {
        const hist = typeof P.notify === 'function' && P.notify.history ? P.notify.history() : [];
        const unread = typeof P.notify === 'function' && P.notify.unreadCount ? P.notify.unreadCount() : 0;
        setDesc(histRow, hist.length
          ? `${num(hist.length)} bildirim saklanıyor${unread ? ` · ${num(unread)} okunmamış` : ''}`
          : 'Saklanan bildirim yok');
        histRow.dataset.count = String(hist.length);
        clearBtn.disabled = !hist.length;
        list.textContent = '';
        if (!hist.length) {
          list.appendChild(el('div', { class: 'p-empty st-empty' }, ico('bell-off', 40), el('h3', { text: 'Bildirim yok' }), el('p', { text: 'Yeni bildirimler burada listelenir.' })));
          return;
        }
        hist.slice(0, 5).forEach((n) => {
          const iconName = n.icon && P.icons.has(n.icon) ? n.icon : 'bell';
          list.appendChild(el('div', { class: 'st-notif' + (n.read ? '' : ' unread'), dataset: { id: n.id } },
            el('div', { class: 'st-notif-icon' }, P.icons.el(iconName, { size: 28 })),
            el('div', { class: 'st-notif-text' },
              el('div', { class: 'st-notif-title', text: n.title || 'Bildirim' }),
              n.message ? el('div', { class: 'st-notif-msg', text: n.message }) : null),
            el('div', { class: 'st-notif-time', text: relTime(n.time) })));
        });
        if (hist.length > 5) list.appendChild(el('div', { class: 'st-notif-more', text: `ve ${num(hist.length - 5)} bildirim daha` }));
      }
      rec.refresh = () => { if (state.visible === rec) refresh(); };
      rec.show = refresh;
      refresh();

      rec.root = pageShell('notifications', group(dndRow, testRow, histRow), listSection);
    }

    // ---------------------------------------------------------------- Tarih ve saat
    function buildDatetime(rec) {
      const bigTime = el('div', { class: 'st-bigclock' });
      const bigDate = el('div', { class: 'st-bigdate' });
      const trayTime = el('span', { class: 'st-tray-time' });
      const trayDate = el('span', { class: 'st-tray-date' });
      const hero = el('div', { class: 'st-clock-card p-card' },
        el('div', { class: 'st-clock-main' }, bigTime, bigDate),
        el('div', { class: 'st-clock-side' },
          el('div', { class: 'st-clock-side-label', text: 'Görev çubuğunda' }),
          el('div', { class: 'st-tray', 'aria-label': 'Görev çubuğu saati önizlemesi' }, trayTime, trayDate)));

      const h24Row = row('clock24h', { control: switchCtl('clock24h', '24 saat biçimi') });
      const secRow = row('showSeconds', { control: switchCtl('showSeconds', 'Saniyeleri göster') });

      const tzValue = el('span', { class: 'st-val selectable', dataset: { key: 'timezone' } });
      const tzRow = row('timezone', { control: tzValue });
      const dateValue = el('span', { class: 'st-val selectable', dataset: { key: 'date' } });
      const dateRow = row('date', { control: dateValue });
      const langValue = el('span', { class: 'st-val selectable', dataset: { key: 'region' } });
      const langRow = row('date', { title: 'Bölge ve dil', desc: 'Tarih ve sayılar bu bölgeye göre biçimlenir', icon: 'flag', control: langValue });
      langRow.dataset.sid = 'region';

      function tzName() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Bilinmiyor'; } catch (e) { return 'Bilinmiyor'; }
      }
      function tzLong(now) {
        try {
          const part = new Intl.DateTimeFormat('tr-TR', { timeZoneName: 'long' }).formatToParts(now).find((p) => p.type === 'timeZoneName');
          return part ? part.value : '';
        } catch (e) { return ''; }
      }
      function langLabel() {
        const lang = navigator.language || 'tr-TR';
        let name = lang;
        try { name = new Intl.DisplayNames(['tr'], { type: 'language' }).of(lang) || lang; } catch (e) { /* keep code */ }
        return name === lang ? lang : `${name} · ${lang}`;
      }

      function tick() {
        const now = new Date();
        const h24 = P.settings.get('clock24h') !== false;
        bigTime.textContent = fmtClock(now, true, h24);
        bigDate.textContent = fmtLongDate(now);
        trayTime.textContent = fmtClock(now, !!P.settings.get('showSeconds'), h24);
        trayDate.textContent = fmtShortDate(now);
        dateValue.textContent = fmtLongDate(now);
        const long = tzLong(now);
        tzValue.textContent = tzName();
        setDesc(tzRow, `${utcOffsetLabel(now)}${long ? ' · ' + long : ''}`);
        langValue.textContent = langLabel();
      }
      syncer(['clock24h', 'showSeconds'], tick);
      let stop = null;
      rec.show = () => { tick(); if (!stop) stop = every(tick, 1000); };
      rec.hide = () => { if (stop) { stop(); stop = null; } };

      rec.root = pageShell('datetime', hero, section('Biçim', group(h24Row, secRow)), section('Bölge', group(tzRow, dateRow, langRow)));
    }

    // ---------------------------------------------------------------- Depolama
    function computeStorage() {
      const fs = P.fs;
      const home = fs.HOME;
      const usage = fs.usage();
      const cats = [];
      let known = 0;
      STORAGE_CATS.forEach((c) => {
        let bytes = 0;
        let files = 0;
        let path = null;
        if (c.dir) {
          path = fs.join(home, c.dir);
          const st = fs.stat(path);
          bytes = st ? st.size : 0;
          if (st) fs.walk(path, (s) => { if (s.type === 'file') files++; });
        } else if (c.id === 'trash') {
          const t = fs.listTrash();
          bytes = t.reduce((a, e) => a + e.size, 0);
          files = t.length;
          path = 'trash:';
        }
        if (c.id !== 'system') known += bytes;
        cats.push({ id: c.id, name: c.name, color: c.color, bytes, files, path });
      });
      const total = Math.max(usage.used, known);
      const sys = cats.find((c) => c.id === 'system');
      sys.bytes = Math.max(0, total - known);
      sys.path = '/';
      let sysFiles = 0;
      ['bin', 'etc', 'tmp'].forEach((d) => {
        const p = '/' + d;
        if (fs.isDir(p)) fs.walk(p, (s) => { if (s.type === 'file') sysFiles++; });
      });
      sys.files = sysFiles;
      return { used: total, quota: usage.quota, cats };
    }

    function buildStorage(rec) {
      const bar = el('div', { class: 'st-bar', role: 'img' });
      const legend = el('div', { class: 'st-legend' });
      const pctBadge = el('span', { class: 'p-badge subtle st-usage-pct' });
      const refreshBtn = el('button', { class: 'p-btn icon small', type: 'button', 'aria-label': 'Yenile' }, ico('refresh', 16));
      tip(refreshBtn, 'Yenile');
      refreshBtn.addEventListener('click', h(() => render()));
      const warn = el('div', { class: 'st-warn-note', role: 'alert', hidden: true }, ico('info-glyph', 16), el('span', { text: 'Depolama alanı dolmak üzere. Gereksiz dosyaları silip çöp kutusunu boşaltarak yer aç.' }));
      const usageRow = row('usage', { body: [bar, legend, warn], control: [pctBadge, refreshBtn] });

      const emptyBtn = button('Çöp kutusunu boşalt', { icon: 'delete', cls: 'danger', onClick: () => emptyTrash() });
      const trashRow = row('trash', { control: emptyBtn });

      const note = el('p', { class: 'st-note', text: 'Dosyalar tarayıcının yerel depolamasında saklanır; sınır yaklaşık 5 MB’tır. Ayarlar ve uygulama verileri bu hesaba dahil değildir.' });

      function render() {
        let info;
        try { info = computeStorage(); } catch (e) { report(e); return; }
        const { used, quota, cats } = info;
        const ratio = quota ? used / quota : 0;
        setDesc(usageRow, `${U.formatBytes(used)} kullanıldı / ${U.formatBytes(quota)}`);
        pctBadge.textContent = pctSmart(ratio * 100);
        usageRow.dataset.used = String(used);
        usageRow.dataset.quota = String(quota);
        bar.setAttribute('aria-label', `Depolama: ${U.formatBytes(used)} / ${U.formatBytes(quota)} kullanıldı`);
        bar.textContent = '';
        legend.textContent = '';
        cats.forEach((c) => {
          if (c.bytes > 0) {
            const seg = el('span', { class: 'st-seg', dataset: { id: c.id }, style: `flex:0 0 max(3px, ${(Math.min(c.bytes, quota) / quota) * 100}%);background:${c.color}` });
            tip(seg, `${c.name}\n${U.formatBytes(c.bytes)}`);
            bar.appendChild(seg);
          }
          const share = quota ? (c.bytes / quota) * 100 : 0;
          const li = el('button', { class: 'st-leg', type: 'button', dataset: { id: c.id, bytes: String(c.bytes) }, 'aria-label': `${c.name}: ${U.formatBytes(c.bytes)}. Aç` },
            el('span', { class: 'st-dot', style: `background:${c.color}` }),
            el('span', { class: 'st-leg-name', text: c.name }),
            el('span', { class: 'st-leg-count', text: c.files ? `${num(c.files)} ${c.id === 'trash' ? 'öğe' : 'dosya'}` : 'boş' }),
            el('span', { class: 'st-leg-size', text: U.formatBytes(c.bytes) }),
            el('span', { class: 'st-leg-pct', text: c.bytes ? (share < 0.1 ? '<%0,1' : pctSmart(share)) : '—' }));
          li.addEventListener('click', h(() => openFolder(c)));
          legend.appendChild(li);
        });
        const free = Math.max(0, quota - used);
        legend.appendChild(el('div', { class: 'st-leg free', dataset: { id: 'free', bytes: String(free) } },
          el('span', { class: 'st-dot' }),
          el('span', { class: 'st-leg-name', text: 'Boş alan' }),
          el('span', { class: 'st-leg-count' }),
          el('span', { class: 'st-leg-size', text: U.formatBytes(free) }),
          el('span', { class: 'st-leg-pct', text: pctSmart(quota ? (free / quota) * 100 : 0) })));
        warn.hidden = ratio < 0.85;

        const trashCats = cats.find((c) => c.id === 'trash');
        const n = trashCats ? trashCats.files : 0;
        setDesc(trashRow, n ? `${num(n)} öğe · ${U.formatBytes(trashCats.bytes)} yer kaplıyor` : 'Çöp kutusu boş');
        emptyBtn.disabled = !n;
        setRowIcon(trashRow, 'delete');
      }

      function openFolder(c) {
        if (!c.path) return;
        P.apps.launch('files', { path: c.path });
      }

      async function emptyTrash() {
        const n = P.fs.trashCount();
        if (!n) { render(); return; }
        const ok = await P.dialog.confirm({
          title: 'Çöp kutusunu boşalt',
          message: `Çöp kutusundaki ${num(n)} öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
          okText: 'Boşalt', danger: true
        });
        if (!ok || state.closed) return;
        try {
          P.fs.emptyTrash();
          if (P.sound && P.sound.play) P.sound.play('trash');
        } catch (e) {
          await alertDialog({ title: 'Çöp kutusu boşaltılamadı', message: errText(e), icon: 'error' });
        }
        render();
      }

      rec.refresh = () => { if (state.visible === rec) render(); };
      rec.show = render;
      render();

      rec.root = pageShell('storage', group(usageRow), section('Çöp kutusu', group(trashRow)), note);
    }

    // ---------------------------------------------------------------- Hakkında
    function deviceInfo() {
      const nav = navigator;
      const ua = nav.userAgent || '';
      const scr = window.screen || {};
      const dpr = window.devicePixelRatio || 1;
      let lang = nav.language || 'tr-TR';
      try {
        const dn = new Intl.DisplayNames(['tr'], { type: 'language' }).of(lang);
        if (dn && dn !== lang) lang = `${dn} · ${lang}`;
      } catch (e) { /* keep code */ }
      return [
        { key: 'device', icon: 'desktop', label: 'Cihaz adı', value: (P.user && P.user.hostname) || 'pandaos' },
        { key: 'user', icon: 'user', label: 'Kullanıcı', value: (P.user && P.user.displayName) || 'Panda' },
        { key: 'browser', icon: 'globe', label: 'Tarayıcı', value: parseBrowser(ua).label },
        { key: 'platform', icon: 'grid', label: 'Platform', value: parsePlatform(ua, nav.userAgentData) },
        { key: 'screen', icon: 'monitor', label: 'Ekran çözünürlüğü', value: `${num(scr.width || 0)} × ${num(scr.height || 0)} piksel${dpr !== 1 ? ` · ölçek ${pct(dpr * 100)}` : ''}` },
        { key: 'language', icon: 'flag', label: 'Dil', value: lang },
        { key: 'cores', icon: 'cpu', label: 'İşlemci çekirdekleri', value: nav.hardwareConcurrency ? `${num(nav.hardwareConcurrency)} mantıksal çekirdek` : 'Bilinmiyor' },
        { key: 'memory', icon: 'memory', label: 'Bellek', value: nav.deviceMemory ? `${num(nav.deviceMemory)} GB` : 'Bilinmiyor (tarayıcı bildirmiyor)' },
        { key: 'uptime', icon: 'time', label: 'Çalışma süresi', value: formatUptime(performance.now()) }
      ];
    }

    function versionLabel() {
      const v = String(P.version || '1.0.0').split('.');
      return `PandaOS ${v[0]}.${v[1] || '0'} (${P.codename || 'Bambu'})`;
    }

    function buildAbout(rec) {
      const copyBtn = button('Bilgileri kopyala', { icon: 'copy', onClick: () => copyInfo() });
      const hero = el('div', { class: 'st-about-hero p-card' },
        el('div', { class: 'st-about-logo' }, P.icons.el('panda', { size: 88 })),
        el('div', { class: 'st-about-text' },
          el('div', { class: 'st-about-name', text: versionLabel() }),
          el('div', { class: 'st-about-sub', text: `Sürüm ${P.version || '1.0.0'} · Tarayıcıda çalışan masaüstü deneyimi` }),
          el('div', { class: 'st-about-actions' }, copyBtn)));

      const infoRows = [];
      const kv = deviceInfo();
      kv.forEach((d) => {
        const val = el('span', { class: 'st-val selectable', text: d.value, dataset: { key: d.key } });
        const r = row('device', { title: d.label, desc: '', icon: d.icon, control: val, cls: 'st-kv' });
        r.dataset.key = d.key;
        delete r.dataset.sid;
        infoRows.push({ key: d.key, val, row: r });
      });
      const deviceGroup = group(infoRows.map((i) => i.row));
      deviceGroup.dataset.sid = 'device';

      const uptimeVal = infoRows.find((i) => i.key === 'uptime').val;
      function tick() { uptimeVal.textContent = formatUptime(performance.now()); }
      let stop = null;
      rec.show = () => { tick(); if (!stop) stop = every(tick, 1000); };
      rec.hide = () => { if (stop) { stop(); stop = null; } };

      async function copyInfo() {
        tick();
        const lines = [`${versionLabel()} (${P.version || '1.0.0'})`].concat(infoRows.map((i) => `${i.row.$title.textContent}: ${i.val.textContent}`));
        const ok = await copyText(lines.join('\n'));
        if (typeof P.notify === 'function') {
          P.notify({ title: ok ? 'Bilgiler kopyalandı' : 'Kopyalanamadı', message: ok ? 'Cihaz bilgileri panoya kopyalandı.' : 'Tarayıcı panoya erişime izin vermedi.', icon: ok ? 'settings' : 'warning', timeout: 3000 });
        }
      }

      const resetBtn = button('Fabrika ayarlarına sıfırla', { icon: 'restart', cls: 'danger', onClick: () => factoryReset() });
      const resetRow = row('reset', { control: resetBtn, cls: 'st-danger-row' });

      async function factoryReset() {
        const ok = await P.dialog.confirm({
          title: 'Fabrika ayarlarına sıfırla',
          message: 'Tüm ayarlar, dosyalar, notlar ve uygulama verileri silinecek ve PandaOS ilk kurulum haline dönecek. Bu işlem geri alınamaz.',
          okText: 'Sıfırla', danger: true
        });
        if (!ok || state.closed) return;
        // give every other window the chance to veto (unsaved work), topmost first
        const others = (P.wm ? P.wm.list() : []).filter((w) => w !== win && !w.isClosed()).reverse();
        for (const w of others) {
          const closed = await w.close();
          if (!closed) {
            if (typeof P.notify === 'function') P.notify({ title: 'Sıfırlama iptal edildi', message: 'Kaydedilmemiş çalışma olan bir pencere kapatılmadı.', icon: 'warning' });
            return;
          }
        }
        P.storage.clearAll();
        hooks.reload();
      }

      rec.root = pageShell('about', hero, section('Cihaz bilgileri', deviceGroup), section('Sıfırlama', group(resetRow)));
    }

    const BUILDERS = {
      appearance: buildAppearance,
      wallpaper: buildWallpaper,
      sound: buildSound,
      notifications: buildNotifications,
      datetime: buildDatetime,
      storage: buildStorage,
      about: buildAbout
    };

    // ---------------------------------------------------------------- live bindings
    subscribe('settings:change', (e) => syncAll(e && e.key));
    subscribe('fs:change', () => {
      schedule('storage', () => { const r = pages.get('storage'); if (r && r.refresh) r.refresh(); }, 120);
      schedule('wallpapers', () => { const r = pages.get('wallpaper'); if (r && r.refreshCustom) r.refreshCustom(); }, 160);
    });
    subscribe('notify:change', () => {
      schedule('notifications', () => { const r = pages.get('notifications'); if (r && r.refresh) r.refresh(); }, 60);
    });

    // ---------------------------------------------------------------- teardown
    function dispose() {
      if (state.closed) return;
      state.closed = true;
      pages.forEach((rec) => { try { if (rec.hide) rec.hide(); } catch (e) { report(e); } });
      timeouts.forEach((id) => clearTimeout(id));
      timeouts.clear();
      intervals.forEach((id) => clearInterval(id));
      intervals.clear();
      disposers.splice(0).forEach((off) => { try { off(); } catch (e) { report(e); } });
    }
    disposers.push(win.on('close', dispose));

    // ---------------------------------------------------------------- start
    const api = {
      goto,
      focusSearch,
      search: (q) => { searchInput.value = q; runSearch(q); },
      clearSearch: () => clearSearch(),
      page: () => (state.mode === 'search' ? 'results' : state.current),
      hooks,
      store,
      parseBrowser,
      parsePlatform,
      formatUptime,
      fold
    };

    goto(PAGE_META[args && args.page] ? args.page : DEFAULT_PAGE, { animate: false, focus: args && args.focus });
    return api;
  }

  // ------------------------------------------------------------------ registration
  P.apps.register({
    id: 'settings',
    name: 'Ayarlar',
    icon: 'settings',
    description: 'Görünümü, sesi, bildirimleri ve sistemi yapılandır',
    category: 'system',
    singleInstance: true,
    fileTypes: [],
    window: { width: 900, height: 600, minWidth: 640, minHeight: 440 },
    launch(win, args) {
      win.state.settings = createApp(win, args || {});
    },
    relaunch(win, args) {
      const api = win.state && win.state.settings;
      if (api && args && args.page) api.goto(args.page, { focus: args.focus });
    }
  });
})();
