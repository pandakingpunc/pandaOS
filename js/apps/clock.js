/* PandaOS — Saat (clock)
   Dört bölüm: Dünya saati (analog + dijital yerel saat, şehir kartları), Alarm, Zamanlayıcı, Kronometre.
   Alarmlar ve zamanlayıcılar pencere KAPALIYKEN de çalışır: dosya yüklenirken başlayan küçük bir arka plan hizmeti
   (saniyede bir kontrol) kalıcı bildirim + yumuşak bir çan sesi üretir. Durum: PandaOS.storage 'app.clock'
   (zamanlayıcılar bitiş zaman damgasıyla saklanır, böylece pencere yeniden açılınca kalan süre doğru görünür).
   Test için: PandaOS.clock.checkAlarms(now) / checkTimers(now) enjekte edilebilir "şimdi" kabul eder. */
(function () {
  'use strict';

  const P = window.PandaOS;
  if (!P) return;
  const U = P.util;
  const el = U.el;

  const APP_ID = 'clock';
  const KEY = 'app.clock';

  // ---------------------------------------------------------------- constants
  const SEC = 1000;
  const MIN = 60000;
  const HOUR = 3600000;
  const DAY = 86400000;
  const GRACE_MS = 90 * SEC;          // an alarm / timer that is detected this late still rings
  const SNOOZE_MIN = 5;
  const RING_MAX_MS = 60 * SEC;       // the chime stops after one minute at the latest
  const CHIME_GAP_MS = 3200;
  const MAX_TIMER_MS = 99 * HOUR + 59 * MIN + 59 * SEC;
  const MAX_LAPS = 999;
  const PRESETS = [1, 3, 5, 10, 15, 30];
  const DAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  const DAYS_LONG = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  const TABS = [
    { id: 'world', label: 'Dünya saati', icon: 'globe' },
    { id: 'alarm', label: 'Alarm', icon: 'alarm' },
    { id: 'timer', label: 'Zamanlayıcı', icon: 'timer' },
    { id: 'stopwatch', label: 'Kronometre', icon: 'stopwatch' }
  ];
  const TAB_IDS = TABS.map((t) => t.id);

  const CITIES = [
    { id: 'istanbul', name: 'İstanbul', country: 'Türkiye', tz: 'Europe/Istanbul' },
    { id: 'londra', name: 'Londra', country: 'Birleşik Krallık', tz: 'Europe/London' },
    { id: 'new-york', name: 'New York', country: 'ABD', tz: 'America/New_York' },
    { id: 'tokyo', name: 'Tokyo', country: 'Japonya', tz: 'Asia/Tokyo' },
    { id: 'sidney', name: 'Sidney', country: 'Avustralya', tz: 'Australia/Sydney' },
    { id: 'berlin', name: 'Berlin', country: 'Almanya', tz: 'Europe/Berlin' },
    { id: 'paris', name: 'Paris', country: 'Fransa', tz: 'Europe/Paris' },
    { id: 'roma', name: 'Roma', country: 'İtalya', tz: 'Europe/Rome' },
    { id: 'madrid', name: 'Madrid', country: 'İspanya', tz: 'Europe/Madrid' },
    { id: 'amsterdam', name: 'Amsterdam', country: 'Hollanda', tz: 'Europe/Amsterdam' },
    { id: 'atina', name: 'Atina', country: 'Yunanistan', tz: 'Europe/Athens' },
    { id: 'moskova', name: 'Moskova', country: 'Rusya', tz: 'Europe/Moscow' },
    { id: 'kahire', name: 'Kahire', country: 'Mısır', tz: 'Africa/Cairo' },
    { id: 'johannesburg', name: 'Johannesburg', country: 'Güney Afrika', tz: 'Africa/Johannesburg' },
    { id: 'baku', name: 'Bakü', country: 'Azerbaycan', tz: 'Asia/Baku' },
    { id: 'tahran', name: 'Tahran', country: 'İran', tz: 'Asia/Tehran' },
    { id: 'riyad', name: 'Riyad', country: 'Suudi Arabistan', tz: 'Asia/Riyadh' },
    { id: 'dubai', name: 'Dubai', country: 'Birleşik Arap Emirlikleri', tz: 'Asia/Dubai' },
    { id: 'delhi', name: 'Delhi', country: 'Hindistan', tz: 'Asia/Kolkata' },
    { id: 'bangkok', name: 'Bangkok', country: 'Tayland', tz: 'Asia/Bangkok' },
    { id: 'singapur', name: 'Singapur', country: 'Singapur', tz: 'Asia/Singapore' },
    { id: 'pekin', name: 'Pekin', country: 'Çin', tz: 'Asia/Shanghai' },
    { id: 'seul', name: 'Seul', country: 'Güney Kore', tz: 'Asia/Seoul' },
    { id: 'auckland', name: 'Auckland', country: 'Yeni Zelanda', tz: 'Pacific/Auckland' },
    { id: 'honolulu', name: 'Honolulu', country: 'ABD', tz: 'Pacific/Honolulu' },
    { id: 'los-angeles', name: 'Los Angeles', country: 'ABD', tz: 'America/Los_Angeles' },
    { id: 'chicago', name: 'Chicago', country: 'ABD', tz: 'America/Chicago' },
    { id: 'toronto', name: 'Toronto', country: 'Kanada', tz: 'America/Toronto' },
    { id: 'mexico-city', name: 'Mexico City', country: 'Meksika', tz: 'America/Mexico_City' },
    { id: 'rio', name: 'Rio de Janeiro', country: 'Brezilya', tz: 'America/Sao_Paulo' },
    { id: 'buenos-aires', name: 'Buenos Aires', country: 'Arjantin', tz: 'America/Argentina/Buenos_Aires' }
  ];
  const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));
  const DEFAULT_CITIES = ['istanbul', 'londra', 'new-york', 'tokyo', 'sidney'];

  // ---------------------------------------------------------------- small helpers
  const p2 = (n) => String(n).padStart(2, '0');
  const str = (v) => (v == null ? '' : String(v));
  const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  const clamp = U.clamp;
  const ico = (name, size = 16) => P.icons.el(name, { size });
  const use24 = () => P.settings.get('clock24h') !== false;
  const fold = (s) => String(s).toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

  function fmtHM(time) {
    const [h, m] = time.split(':').map(Number);
    if (use24()) return { text: `${p2(h)}:${p2(m)}`, period: '' };
    return { text: `${p2(h % 12 || 12)}:${p2(m)}`, period: h < 12 ? 'ÖÖ' : 'ÖS' };
  }

  /** "5 dk", "1 sa 30 dk", "45 sn" */
  function fmtDur(ms) {
    const total = Math.max(0, Math.round(ms / SEC));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts = [];
    if (h) parts.push(`${h} sa`);
    if (m) parts.push(`${m} dk`);
    if (s || !parts.length) parts.push(`${s} sn`);
    return parts.join(' ');
  }

  /** Countdown text, rounded UP to whole seconds: "04:59", "1:30:00" never shows 00:00 before the end. */
  function fmtCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / SEC - 1e-9));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${p2(h)}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
  }

  /** Stopwatch text split in { main: '01:02', cs: ',34' } (hours appear after 59:59). */
  function fmtSwParts(ms) {
    const t = Math.max(0, Math.floor(ms));
    const cs = Math.floor((t % 1000) / 10);
    const totalS = Math.floor(t / 1000);
    const s = totalS % 60;
    const m = Math.floor(totalS / 60) % 60;
    const h = Math.floor(totalS / 3600);
    return { main: (h > 0 ? `${h}:${p2(m)}` : p2(m)) + `:${p2(s)}`, cs: `,${p2(cs)}` };
  }
  const fmtSw = (ms) => { const f = fmtSwParts(ms); return f.main + f.cs; };

  /** "7 saat 12 dakika" (at most two units, rounded up to the minute) */
  function fmtIn(ms) {
    const mins = Math.max(0, Math.ceil(ms / MIN - 1e-9));
    if (mins < 1) return '1 dakikadan az';
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    const parts = [];
    if (d) parts.push(`${d} gün`);
    if (h) parts.push(`${h} saat`);
    if (m) parts.push(`${m} dakika`);
    return parts.slice(0, 2).join(' ');
  }

  function dayWord(ts, now) {
    const a = new Date(now);
    const b = new Date(ts);
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    const diff = Math.round((db - da) / DAY);
    if (diff === 0) return 'Bugün';
    if (diff === 1) return 'Yarın';
    return DAYS_LONG[(b.getDay() + 6) % 7];
  }

  // ---------------------------------------------------------------- time zones
  const dtfCache = new Map();
  function zoneFormatter(tz) {
    let f = dtfCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      });
      dtfCache.set(tz, f);
    }
    return f;
  }

  /** Wall-clock parts of an instant in a zone (tz falsy = the computer's own zone). */
  function zoneParts(ms, tz) {
    if (tz) {
      try {
        const out = {};
        for (const p of zoneFormatter(tz).formatToParts(ms)) {
          if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10);
        }
        return { y: out.year, mo: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
      } catch (e) { /* unknown zone: fall back to local time */ }
    }
    const d = new Date(ms);
    return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
  }

  /** UTC offset of a zone at an instant, in minutes (Istanbul = 180). */
  function zoneOffset(ms, tz) {
    if (!tz) return -new Date(ms).getTimezoneOffset();
    const p = zoneParts(ms, tz);
    return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / SEC) * SEC) / MIN);
  }

  function localZoneName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; }
  }

  /** Everything the world clock shows for one city. baseTz: zone to compare against (default: the computer's zone). */
  function zoneInfo(ms, tz, baseTz) {
    const base = zoneParts(ms, baseTz || null);
    const p = zoneParts(ms, tz);
    const offset = zoneOffset(ms, tz);
    const rel = offset - zoneOffset(ms, baseTz || null);
    const dayDiff = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(base.y, base.mo - 1, base.d)) / DAY);
    return { h: p.h, mi: p.mi, s: p.s, offset, rel, dayDiff, isDay: p.h >= 6 && p.h < 18 };
  }

  function fmtRel(rel) {
    const sign = rel < 0 ? '−' : '+';
    const a = Math.abs(rel);
    const h = Math.floor(a / 60);
    const m = a % 60;
    return m ? `${sign}${h} sa ${m} dk` : `${sign}${h} sa`;
  }

  function fmtUtc(offset) {
    const a = Math.abs(offset);
    return `UTC${offset < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + p2(a % 60) : ''}`;
  }

  const fmtDayDiff = (d) => (d === 0 ? 'Bugün' : d === 1 ? 'Yarın' : d === -1 ? 'Dün' : d > 0 ? `+${d} gün` : `−${-d} gün`);

  const clockFmtCache = new Map();
  /** Time of day in a zone honouring the 24-hour setting: { text: '14:35', period: '' | 'ÖS' } */
  function tzClock(ms, tz, withSeconds) {
    const h12 = !use24();
    const k = `${tz || ''}|${h12 ? 1 : 0}|${withSeconds ? 1 : 0}`;
    let f = clockFmtCache.get(k);
    if (!f) {
      const o = { hour: '2-digit', minute: '2-digit' };
      if (withSeconds) o.second = '2-digit';
      if (h12) o.hour12 = true; else o.hourCycle = 'h23';
      if (tz) o.timeZone = tz;
      try { f = new Intl.DateTimeFormat('tr-TR', o); } catch (e) { delete o.timeZone; f = new Intl.DateTimeFormat('tr-TR', o); }
      clockFmtCache.set(k, f);
    }
    let text = '';
    let period = '';
    for (const part of f.formatToParts(ms)) {
      if (part.type === 'dayPeriod') period = part.value; else text += part.value;
    }
    return { text: text.trim(), period };
  }

  const dateFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  function localZoneLabel(ms) {
    try {
      const part = new Intl.DateTimeFormat('tr-TR', { timeZoneName: 'long' }).formatToParts(ms).find((x) => x.type === 'timeZoneName');
      return part ? part.value : '';
    } catch (e) { return ''; }
  }

  // ---------------------------------------------------------------- state store
  const defaults = () => ({
    v: 1,
    tab: 'world',
    cities: DEFAULT_CITIES.slice(),
    alarms: [],
    timers: [],
    sel: null,
    draft: { h: 0, m: 5, s: 0 },
    sw: { running: false, startedAt: 0, base: 0, laps: [] }
  });

  function cleanAlarm(a) {
    if (!a || typeof a !== 'object' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(str(a.time))) return null;
    const days = Array.isArray(a.days)
      ? [...new Set(a.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
      : [];
    return {
      id: str(a.id) || U.uid('alm'),
      time: a.time,
      label: str(a.label).slice(0, 60),
      days,
      enabled: a.enabled !== false,
      armedAt: num(a.armedAt),
      lastFired: num(a.lastFired),
      snoozedUntil: num(a.snoozedUntil)
    };
  }

  function cleanTimer(t) {
    if (!t || typeof t !== 'object') return null;
    const duration = num(t.duration);
    if (duration < SEC || duration > MAX_TIMER_MS) return null;
    let state = ['idle', 'running', 'paused', 'done'].includes(t.state) ? t.state : 'idle';
    const out = {
      id: str(t.id) || U.uid('tmr'),
      label: str(t.label).slice(0, 40),
      duration,
      state,
      endsAt: num(t.endsAt),
      remaining: clamp(num(t.remaining, duration), 0, duration),
      createdAt: num(t.createdAt)
    };
    if (state === 'running' && !out.endsAt) state = out.state = 'paused';
    if (state === 'done') out.remaining = 0;
    return out;
  }

  function sanitize(raw) {
    const out = defaults();
    if (!raw || typeof raw !== 'object') return out;
    if (TAB_IDS.includes(raw.tab)) out.tab = raw.tab;
    if (Array.isArray(raw.cities)) {
      const seen = new Set();
      out.cities = raw.cities.filter((id) => CITY_BY_ID.has(id) && !seen.has(id) && seen.add(id));
    }
    if (Array.isArray(raw.alarms)) out.alarms = raw.alarms.map(cleanAlarm).filter(Boolean);
    if (Array.isArray(raw.timers)) out.timers = raw.timers.map(cleanTimer).filter(Boolean);
    if (typeof raw.sel === 'string' && out.timers.some((t) => t.id === raw.sel)) out.sel = raw.sel;
    if (raw.draft && typeof raw.draft === 'object') {
      out.draft = {
        h: clamp(Math.floor(num(raw.draft.h)), 0, 99),
        m: clamp(Math.floor(num(raw.draft.m, 5)), 0, 59),
        s: clamp(Math.floor(num(raw.draft.s)), 0, 59)
      };
    }
    if (raw.sw && typeof raw.sw === 'object') {
      const laps = Array.isArray(raw.sw.laps) ? raw.sw.laps.map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, MAX_LAPS) : [];
      out.sw = {
        running: raw.sw.running === true && num(raw.sw.startedAt) > 0,
        startedAt: num(raw.sw.startedAt),
        base: Math.max(0, num(raw.sw.base)),
        laps
      };
    }
    return out;
  }

  let S = sanitize(P.storage.get(KEY, null));

  function save() {
    P.storage.set(KEY, S);
  }

  function emit(what) {
    P.bus.emit('clock:change', { what });
  }

  function commit(what) {
    save();
    emit(what);
    schedule();
  }

  /** Adopt changes made behind our back (tests, another browser tab). */
  function sync() {
    const next = sanitize(P.storage.get(KEY, null));
    if (JSON.stringify(next) !== JSON.stringify(S)) {
      S = next;
      emit('all');
      schedule();
    }
  }

  // ---------------------------------------------------------------- cities
  function addCity(id) {
    if (!CITY_BY_ID.has(id) || S.cities.includes(id)) return false;
    S.cities.push(id);
    commit('cities');
    return true;
  }

  function removeCity(id) {
    if (!S.cities.includes(id)) return false;
    S.cities = S.cities.filter((c) => c !== id);
    commit('cities');
    return true;
  }

  function moveCityFirst(id) {
    if (!S.cities.includes(id)) return false;
    S.cities = [id].concat(S.cities.filter((c) => c !== id));
    commit('cities');
    return true;
  }

  // ---------------------------------------------------------------- alarm model
  /** Smallest instant strictly after `from` at which the alarm's time-of-day (and weekday) match, or null. */
  function alarmNextAt(a, from) {
    const [h, m] = a.time.split(':').map(Number);
    const base = new Date(from);
    for (let k = 0; k < 9; k++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + k, h, m, 0, 0);
      const t = d.getTime();
      if (t <= from) continue;
      if (a.days.length && !a.days.includes((d.getDay() + 6) % 7)) continue;
      return t;
    }
    return null;
  }

  function alarmAdd(spec, now = Date.now()) {
    const a = cleanAlarm({
      id: U.uid('alm'), time: spec.time, label: spec.label, days: spec.days, enabled: spec.enabled !== false,
      armedAt: now, lastFired: 0, snoozedUntil: 0
    });
    if (!a) throw new Error('Geçersiz alarm saati');
    S.alarms.push(a);
    commit('alarms');
    return a;
  }

  function alarmUpdate(id, patch, now = Date.now()) {
    const a = S.alarms.find((x) => x.id === id);
    if (!a) return null;
    const next = cleanAlarm(Object.assign({}, a, patch));
    if (!next) return null;
    const rearm = next.time !== a.time || next.enabled !== a.enabled || JSON.stringify(next.days) !== JSON.stringify(a.days);
    Object.assign(a, next);
    if (rearm) { a.armedAt = now; a.lastFired = 0; a.snoozedUntil = 0; }
    commit('alarms');
    return a;
  }

  function alarmToggle(id, on, now = Date.now()) {
    return alarmUpdate(id, { enabled: !!on }, now);
  }

  function alarmRemove(id) {
    const before = S.alarms.length;
    S.alarms = S.alarms.filter((a) => a.id !== id);
    if (S.alarms.length === before) return false;
    stopRing('alarm:' + id, { dismiss: true });
    commit('alarms');
    return true;
  }

  function alarmSnooze(id, now = Date.now(), mins = SNOOZE_MIN) {
    const a = S.alarms.find((x) => x.id === id);
    if (!a) return null;
    a.snoozedUntil = now + mins * MIN;
    commit('alarms');
    return a;
  }

  /** The alarm that rings next after `now`: { alarm, at } | null (snooze counts). */
  function nextAlarm(now = Date.now()) {
    let best = null;
    for (const a of S.alarms) {
      const cands = [];
      if (a.snoozedUntil > now) cands.push(a.snoozedUntil);
      if (a.enabled) { const t = alarmNextAt(a, now); if (t) cands.push(t); }
      for (const t of cands) if (!best || t < best.at) best = { alarm: a, at: t };
    }
    return best;
  }

  /**
   * The service's alarm check. Rings every enabled alarm whose time came within the last GRACE_MS
   * (and snoozed alarms that are due); occurrences missed while nothing was running become one quiet notification.
   * Returns { fired: [alarm ids], missed: [alarm ids] }.
   */
  function checkAlarms(now) {
    now = typeof now === 'number' ? now : Date.now();
    const fired = [];
    const missed = [];
    let dirty = false;
    for (const a of S.alarms) {
      if (a.snoozedUntil && now >= a.snoozedUntil) {
        a.snoozedUntil = 0;
        dirty = true;
        fired.push({ alarm: a, at: now });
      }
      if (!a.enabled) continue;
      const from = Math.max(a.armedAt || 0, a.lastFired || 0, now - 3 * DAY);
      let occ = alarmNextAt(a, from);
      let lastMissed = 0;
      for (let guard = 0; occ && occ + GRACE_MS <= now && guard < 8; guard++) {
        lastMissed = occ;
        a.lastFired = occ;
        dirty = true;
        if (!a.days.length) { a.enabled = false; break; }
        occ = alarmNextAt(a, occ);
      }
      if (lastMissed) missed.push({ alarm: a, at: lastMissed });
      if (a.enabled && occ && occ <= now && now < occ + GRACE_MS) {
        a.lastFired = occ;
        dirty = true;
        if (!a.days.length) a.enabled = false;
        fired.push({ alarm: a, at: occ });
      }
    }
    if (dirty) commit('alarms');
    for (const f of fired) ringAlarm(f.alarm, f.at, now);
    for (const m of missed) {
      try {
        const t = fmtHM(m.alarm.time);
        P.notify({
          title: 'Kaçırılan alarm', message: `${t.text}${t.period ? ' ' + t.period : ''}${m.alarm.label ? ' — ' + m.alarm.label : ''} (${dayWord(m.at, now)})`,
          icon: 'clock', appId: APP_ID
        });
      } catch (e) { /* notifications are optional */ }
    }
    return { fired: fired.map((f) => f.alarm.id), missed: missed.map((m) => m.alarm.id) };
  }

  // ---------------------------------------------------------------- timer model
  function timerRemaining(t, now = Date.now()) {
    if (t.state === 'running') return Math.max(0, t.endsAt - now);
    if (t.state === 'done') return 0;
    return t.remaining;
  }

  function timerAdd(spec, now = Date.now()) {
    const duration = clamp(Math.round(num(spec.duration)), SEC, MAX_TIMER_MS);
    const t = cleanTimer({
      id: U.uid('tmr'), label: spec.label, duration, state: spec.start === false ? 'idle' : 'running',
      endsAt: now + duration, remaining: duration, createdAt: now
    });
    S.timers.push(t);
    S.sel = t.id;
    commit('timers');
    return t;
  }

  const findTimer = (id) => S.timers.find((t) => t.id === id) || null;

  function timerPause(id, now = Date.now()) {
    const t = findTimer(id);
    if (!t || t.state !== 'running') return null;
    t.remaining = Math.max(0, t.endsAt - now);
    t.state = 'paused';
    t.endsAt = 0;
    commit('timers');
    return t;
  }

  function timerResume(id, now = Date.now()) {
    const t = findTimer(id);
    if (!t || (t.state !== 'paused' && t.state !== 'idle')) return null;
    if (t.remaining < SEC / 2) t.remaining = t.duration;
    t.state = 'running';
    t.endsAt = now + t.remaining;
    commit('timers');
    return t;
  }

  function timerReset(id) {
    const t = findTimer(id);
    if (!t) return null;
    stopRing('timer:' + id, { dismiss: true });
    t.state = 'idle';
    t.endsAt = 0;
    t.remaining = t.duration;
    commit('timers');
    return t;
  }

  function timerRestart(id, now = Date.now()) {
    const t = findTimer(id);
    if (!t) return null;
    stopRing('timer:' + id, { dismiss: true });
    t.state = 'running';
    t.remaining = t.duration;
    t.endsAt = now + t.duration;
    commit('timers');
    return t;
  }

  function timerRemove(id) {
    const before = S.timers.length;
    S.timers = S.timers.filter((t) => t.id !== id);
    if (S.timers.length === before) return false;
    stopRing('timer:' + id, { dismiss: true });
    if (S.sel === id) S.sel = null;
    commit('timers');
    return true;
  }

  /** Marks finished timers as done and rings them. Returns the ids that finished. */
  function checkTimers(now) {
    now = typeof now === 'number' ? now : Date.now();
    const done = S.timers.filter((t) => t.state === 'running' && t.endsAt <= now);
    if (!done.length) return [];
    const dueAt = new Map(done.map((t) => [t.id, t.endsAt]));
    for (const t of done) {
      t.state = 'done';
      t.remaining = 0;
      t.endsAt = 0;
    }
    commit('timers');
    for (const t of done) ringTimer(t, now, dueAt.get(t.id));
    return done.map((t) => t.id);
  }

  let preciseTimer = 0;
  /** One exact timeout for the earliest running timer, so it finishes on time instead of up to a second late. */
  function schedule() {
    clearTimeout(preciseTimer);
    preciseTimer = 0;
    let next = Infinity;
    for (const t of S.timers) if (t.state === 'running') next = Math.min(next, t.endsAt);
    if (next === Infinity) return;
    const wait = P.booted ? clamp(next - Date.now() + 20, 0, 2147000000) : 500;
    preciseTimer = setTimeout(() => {
      preciseTimer = 0;
      if (P.booted) { try { checkTimers(Date.now()); } catch (e) { console.error('[saat] zamanlayıcı denetimi', e); } }
      schedule();
    }, wait);
  }

  // ---------------------------------------------------------------- stopwatch model
  const swElapsed = (sw, now = Date.now()) => Math.max(0, sw.base + (sw.running ? now - sw.startedAt : 0));

  function swStart(now = Date.now()) {
    if (S.sw.running) return false;
    S.sw.running = true;
    S.sw.startedAt = now;
    commit('sw');
    return true;
  }

  function swStop(now = Date.now()) {
    if (!S.sw.running) return false;
    S.sw.base = swElapsed(S.sw, now);
    S.sw.running = false;
    S.sw.startedAt = 0;
    commit('sw');
    return true;
  }

  function swLap(now = Date.now()) {
    if (!S.sw.running || S.sw.laps.length >= MAX_LAPS) return null;
    const last = S.sw.laps.length ? S.sw.laps[S.sw.laps.length - 1] : 0;
    const total = Math.max(last, swElapsed(S.sw, now));
    S.sw.laps.push(total);
    commit('sw');
    return total;
  }

  function swReset() {
    S.sw = { running: false, startedAt: 0, base: 0, laps: [] };
    commit('sw');
  }

  /** Laps with their split times; best / worst are index sets (only with two or more laps and differing splits). */
  function lapInfo(laps) {
    const rows = laps.map((total, i) => ({ n: i + 1, total, split: total - (i ? laps[i - 1] : 0) }));
    const best = new Set();
    const worst = new Set();
    if (rows.length >= 2) {
      const min = Math.min(...rows.map((r) => r.split));
      const max = Math.max(...rows.map((r) => r.split));
      if (min !== max) rows.forEach((r, i) => { if (r.split === min) best.add(i); if (r.split === max) worst.add(i); });
    }
    return { rows, best, worst };
  }

  // ---------------------------------------------------------------- rings: notification + chime
  const rings = new Map();           // key ('alarm:<id>' | 'timer:<id>') -> ring
  const stats = { chimes: 0, rings: 0 };
  let chimeTimer = 0;
  let toastObs = null;

  const ringList = () => [...rings.values()];
  const emitRings = () => P.bus.emit('clock:ring', { count: rings.size });

  function bellTone(c, out, freq, t, dur, gain) {
    [[1, 1, dur], [2.76, 0.22, dur * 0.5], [5.4, 0.07, dur * 0.25]].forEach(([mul, g, d]) => {
      const o = c.createOscillator();
      const v = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * mul, t);
      v.gain.setValueAtTime(0.0001, t);
      v.gain.linearRampToValueAtTime(Math.max(0.0002, gain * g), t + 0.012);
      v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(v);
      v.connect(out);
      o.start(t);
      o.stop(t + d + 0.05);
    });
  }

  const CHIME_NOTES = {
    alarm: [[784, 0], [988, 0.17], [1175, 0.34], [1568, 0.51]],
    timer: [[1319, 0], [1047, 0.24], [1319, 0.48]]
  };

  function playChime(kind) {
    stats.chimes++;
    try {
      const snd = P.sound;
      if (!snd || typeof snd.context !== 'function') return;
      const c = snd.context();
      const out = snd.master();
      if (!c || !out) return;
      if (c.state === 'suspended') { try { c.resume().catch(() => {}); } catch (e) { /* ignore */ } }
      if (c.state !== 'running') return;
      const t0 = c.currentTime + 0.04;
      (CHIME_NOTES[kind] || CHIME_NOTES.alarm).forEach(([f, dt]) => bellTone(c, out, f, t0 + dt, 1.7, 0.12));
    } catch (e) { /* audio is optional */ }
  }

  function ringAlive(r, now) {
    if (now >= r.until) return false;
    if (r.nid) {
      const hist = P.notify && typeof P.notify.history === 'function' ? P.notify.history() : null;
      if (hist && !hist.some((n) => n.id === r.nid)) return false;
      const toast = document.querySelector(`#toasts .toast[data-id="${r.nid}"]`);
      if (toast && !toast.classList.contains('leaving')) r.seen = true;
      else if (r.seen) return false;
    }
    return true;
  }

  function unwatchRings() {
    clearTimeout(chimeTimer);
    chimeTimer = 0;
    if (toastObs) { toastObs.disconnect(); toastObs = null; }
  }

  /** Drops rings that were dismissed (toast closed, entry removed) or timed out; returns how many are left. */
  function pruneRings() {
    const now = Date.now();
    let changed = false;
    for (const [k, r] of [...rings]) {
      if (!ringAlive(r, now)) { rings.delete(k); changed = true; }
    }
    if (changed) {
      if (!rings.size) unwatchRings();
      emitRings();
    }
    return rings.size;
  }

  function chimeStep() {
    chimeTimer = 0;
    if (!pruneRings()) return;
    playChime(ringList().some((r) => r.kind === 'alarm') ? 'alarm' : 'timer');
    chimeTimer = setTimeout(chimeStep, CHIME_GAP_MS);
  }

  function watchToasts() {
    if (toastObs || typeof MutationObserver === 'undefined') return;
    const host = document.getElementById('toasts');
    if (!host) return;
    toastObs = new MutationObserver(() => { pruneRings(); });
    toastObs.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }

  function startRing(r) {
    stopRing(r.key, { quiet: true });
    r.startedAt = Date.now();
    r.until = r.startedAt + RING_MAX_MS;
    r.seen = false;
    rings.set(r.key, r);
    stats.rings++;
    watchToasts();
    emitRings();
    clearTimeout(chimeTimer);
    chimeTimer = 0;
    chimeStep();
    // do-not-disturb hides the toast, so open the app: its banner is then the way to dismiss the chime
    if (P.settings.get('dnd') === true) {
      try { P.apps.launch(APP_ID, { tab: r.kind === 'alarm' ? 'alarm' : 'timer' }); } catch (e) { /* ignore */ }
    }
  }

  function stopRing(key, opts) {
    const r = rings.get(key);
    if (!r) return false;
    rings.delete(key);
    if (opts && opts.dismiss && r.nid && P.notify && typeof P.notify.dismiss === 'function') {
      try { P.notify.dismiss(r.nid); } catch (e) { /* ignore */ }
    }
    if (!rings.size) unwatchRings();
    if (!(opts && opts.quiet)) emitRings();
    return true;
  }

  function stopAllRings() {
    [...rings.keys()].forEach((k) => stopRing(k, { dismiss: true }));
  }

  function openApp(tab) {
    try { P.apps.launch(APP_ID, { tab }); } catch (e) { /* ignore */ }
  }

  function ringAlarm(a, at, now) {
    const t = fmtHM(a.time);
    const key = 'alarm:' + a.id;
    let nid = null;
    try {
      nid = P.notify({
        title: `Alarm · ${t.text}${t.period ? ' ' + t.period : ''}`,
        message: a.label || 'Alarm çalıyor',
        icon: 'clock',
        appId: APP_ID,
        timeout: 0,
        sound: false,
        actions: [
          { label: `Ertele (${SNOOZE_MIN} dk)`, action: () => { alarmSnooze(a.id, Date.now()); stopRing(key); } },
          { label: 'Kapat', action: () => stopRing(key) }
        ],
        onClick: () => { stopRing(key); openApp('alarm'); }
      });
    } catch (e) { console.error('[saat] alarm bildirimi', e); }
    startRing({ key, kind: 'alarm', refId: a.id, nid, title: a.label || 'Alarm', time: t.text + (t.period ? ' ' + t.period : ''), at });
  }

  function ringTimer(t, now, dueAt) {
    const late = now - (dueAt || now) > GRACE_MS;
    const key = 'timer:' + t.id;
    const title = `Süre doldu! (${fmtDur(t.duration)})`;
    const message = t.label || 'Zamanlayıcı tamamlandı.';
    if (late) {
      try { P.notify({ title, message, icon: 'clock', appId: APP_ID }); } catch (e) { /* ignore */ }
      return;
    }
    let nid = null;
    try {
      nid = P.notify({
        title,
        message,
        icon: 'clock',
        appId: APP_ID,
        timeout: 0,
        sound: false,
        actions: [
          { label: 'Kapat', action: () => stopRing(key) },
          { label: 'Yeniden başlat', action: () => { stopRing(key); timerRestart(t.id, Date.now()); } }
        ],
        onClick: () => { stopRing(key); openApp('timer'); }
      });
    } catch (e) { console.error('[saat] zamanlayıcı bildirimi', e); }
    startRing({ key, kind: 'timer', refId: t.id, nid, title, label: t.label, duration: t.duration });
  }

  // ---------------------------------------------------------------- background service (lives as long as the page)
  function serviceTick(now) {
    now = typeof now === 'number' ? now : Date.now();
    try { sync(); } catch (e) { console.error('[saat] durum okunamadı', e); }
    try { checkTimers(now); } catch (e) { console.error('[saat] zamanlayıcı denetimi', e); }
    try { checkAlarms(now); } catch (e) { console.error('[saat] alarm denetimi', e); }
  }

  setInterval(() => { if (P.booted) serviceTick(); }, 1000);
  P.bus.on('os:ready', () => serviceTick());
  P.bus.on('notify:change', () => { if (rings.size) pruneRings(); });
  schedule();

  // ---------------------------------------------------------------- SVG helpers + analog face
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, ...kids) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v === true ? '' : String(v));
    kids.forEach((k) => { if (k) n.appendChild(k); });
    return n;
  }

  /** Analog clock face. kind: 'big' (all ticks + numerals) | 'small' (hour ticks only). face.set(h, mi, s, ms) */
  function buildFace(kind) {
    const big = kind === 'big';
    const svg = svgEl('svg', { viewBox: '0 0 200 200', class: `ck-face ${kind}`, 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgEl('circle', { class: 'ck-dial', cx: 100, cy: 100, r: 96 }));
    const ticks = svgEl('g', { class: 'ck-ticks' });
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      if (!major && !big) continue;
      const a = (i * 6 * Math.PI) / 180;
      const r1 = major ? (big ? 80 : 78) : 87;
      const r2 = 92;
      ticks.appendChild(svgEl('line', {
        class: major ? 'ck-tick major' : 'ck-tick',
        x1: (100 + r1 * Math.sin(a)).toFixed(2), y1: (100 - r1 * Math.cos(a)).toFixed(2),
        x2: (100 + r2 * Math.sin(a)).toFixed(2), y2: (100 - r2 * Math.cos(a)).toFixed(2)
      }));
    }
    svg.appendChild(ticks);
    if (big) {
      const nums = svgEl('g', { class: 'ck-numerals' });
      for (let n = 1; n <= 12; n++) {
        const a = (n * 30 * Math.PI) / 180;
        const t = svgEl('text', { x: (100 + 65 * Math.sin(a)).toFixed(2), y: (100 - 65 * Math.cos(a)).toFixed(2) });
        t.textContent = String(n);
        nums.appendChild(t);
      }
      svg.appendChild(nums);
    }
    const hour = svgEl('g', { class: 'ck-hand ck-hand-hour' }, svgEl('line', { x1: 100, y1: 108, x2: 100, y2: big ? 56 : 58 }));
    const min = svgEl('g', { class: 'ck-hand ck-hand-min' }, svgEl('line', { x1: 100, y1: 112, x2: 100, y2: big ? 32 : 34 }));
    const sec = svgEl('g', { class: 'ck-hand ck-hand-sec' }, svgEl('line', { x1: 100, y1: 120, x2: 100, y2: big ? 24 : 26 }));
    svg.appendChild(hour);
    svg.appendChild(min);
    svg.appendChild(sec);
    svg.appendChild(svgEl('circle', { class: 'ck-cap', cx: 100, cy: 100, r: big ? 6 : 7 }));
    svg.appendChild(svgEl('circle', { class: 'ck-cap-in', cx: 100, cy: 100, r: big ? 2.4 : 2.6 }));
    const rot = (g, deg) => g.setAttribute('transform', `rotate(${deg.toFixed(2)} 100 100)`);
    return {
      el: svg,
      set(h, mi, s, ms) {
        rot(hour, ((h % 12) + mi / 60 + s / 3600) * 30);
        rot(min, (mi + s / 60) * 6);
        rot(sec, (s + (ms || 0) / 1000) * 6);
      }
    };
  }

  function ringSetter(prog, circ) {
    return (frac) => {
      const f = clamp(frac, 0, 1);
      prog.setAttribute('stroke-dashoffset', (circ * (1 - f)).toFixed(2));
      prog.style.opacity = f <= 0.0005 ? '0' : '1';
    };
  }

  // ---------------------------------------------------------------- the app window
  function createApp(win) {
    const subs = [];                 // bus unsubscribers
    const cleanups = [];             // misc teardown callbacks
    const permanentTips = [];
    const sub = (evt, fn) => subs.push(P.bus.on(evt, fn));
    const flush = (bucket) => { while (bucket.length) { try { bucket.pop()(); } catch (e) { /* ignore */ } } };
    function tip(node, text, bucket) {
      node.setAttribute('aria-label', text);
      if (P.ui && typeof P.ui.tip === 'function') {
        try { (bucket || permanentTips).push(P.ui.tip(node, text)); } catch (e) { /* tooltips are optional */ }
      }
    }
    const listen = (target, evt, fn, opts) => {
      target.addEventListener(evt, fn, opts);
      cleanups.push(() => target.removeEventListener(evt, fn, opts));
    };

    const root = el('div', { class: 'ck-root' });
    const main = el('div', { class: 'ck-main' });
    root.appendChild(main);
    win.body.appendChild(root);

    // ------------------------------------------------ modal sheet (in-window dialog)
    let sheetState = null;
    const sheetTips = [];
    function closeSheet(silent) {
      const st = sheetState;
      if (!st) return false;
      sheetState = null;
      flush(sheetTips);
      st.scrim.remove();
      main.inert = false;
      if (!silent) {
        const prev = st.prevFocus;
        if (prev && prev.isConnected && prev !== document.body && typeof prev.focus === 'function') prev.focus();
        else activeTabButton().focus();
      }
      if (typeof st.onClose === 'function') { try { st.onClose(); } catch (e) { console.error(e); } }
      return true;
    }

    function openSheet(opts) {
      closeSheet(true);
      const prevFocus = document.activeElement;
      const titleId = U.uid('ck-sheet-t');
      const closeBtn = el('button', { type: 'button', class: 'p-btn icon small ck-sheet-x', on: { click: () => closeSheet() } }, ico('close', 16));
      tip(closeBtn, 'Kapat', sheetTips);
      const sheet = el('div', { class: 'ck-sheet' + (opts.className ? ' ' + opts.className : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        el('div', { class: 'ck-sheet-head' }, el('h2', { class: 'ck-sheet-title', id: titleId, text: opts.title }), closeBtn),
        el('div', { class: 'ck-sheet-body' }, opts.content),
        opts.footer ? el('div', { class: 'ck-sheet-foot' }, opts.footer) : null);
      const scrim = el('div', { class: 'ck-scrim' }, sheet);
      scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeSheet(); });
      sheet.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const f = [...sheet.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      root.appendChild(scrim);
      main.inert = true;
      sheetState = { scrim, sheet, prevFocus, onClose: opts.onClose };
      const target = (opts.focus && opts.focus()) || sheet.querySelector('input, .ck-pick:not([disabled])') || closeBtn;
      try { target.focus(); } catch (e) { /* ignore */ }
      return { close: closeSheet, el: sheet };
    }

    // ------------------------------------------------ ring banner (a ringing alarm / timer is dismissable from here)
    const ringBar = el('div', { class: 'ck-rings', role: 'region', 'aria-label': 'Çalan alarmlar', hidden: true });
    const ringTips = [];
    function renderRings() {
      flush(ringTips);
      ringBar.textContent = '';
      const list = ringList();
      ringBar.hidden = !list.length;
      for (const r of list) {
        const isAlarm = r.kind === 'alarm';
        const text = isAlarm
          ? el('div', { class: 'ck-ring-text' }, el('strong', { text: 'Alarm' }), ` · ${r.time}${r.title && r.title !== 'Alarm' ? ' — ' + r.title : ''}`)
          : el('div', { class: 'ck-ring-text' }, el('strong', { text: 'Süre doldu!' }), ` · ${fmtDur(r.duration)}${r.label ? ' — ' + r.label : ''}`);
        const item = el('div', { class: 'ck-ring-item', role: 'alert', dataset: { key: r.key } },
          el('span', { class: 'ck-ring-ico' }, ico(isAlarm ? 'alarm' : 'timer', 18)),
          text,
          el('span', { class: 'ck-ring-btns' },
            isAlarm ? el('button', {
              type: 'button', class: 'p-btn small ck-snooze',
              on: { click: () => { alarmSnooze(r.refId, Date.now()); stopRing(r.key, { dismiss: true }); } }
            }, `Ertele (${SNOOZE_MIN} dk)`) : null,
            el('button', { type: 'button', class: 'p-btn small primary ck-dismiss', on: { click: () => stopRing(r.key, { dismiss: true }) } }, 'Kapat')));
        ringBar.appendChild(item);
      }
    }
    main.appendChild(ringBar);

    // ------------------------------------------------ tabs
    const tabButtons = {};
    const tabBadges = {};
    const tabs = el('div', { class: 'p-segmented ck-tabs', role: 'tablist', 'aria-label': 'Saat bölümleri' });
    for (const t of TABS) {
      const badge = el('span', { class: 'ck-badge', hidden: true });
      const btn = el('button', {
        type: 'button', class: 'ck-tab', role: 'tab', id: `ck-t-${t.id}`, dataset: { tab: t.id },
        'aria-controls': `ck-p-${t.id}`, 'aria-selected': 'false', tabindex: '-1',
        on: {
          click: () => go(t.id),
          keydown: (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const i = TAB_IDS.indexOf(t.id);
            let to = null;
            if (e.key === 'ArrowRight') to = TAB_IDS[(i + 1) % TAB_IDS.length];
            else if (e.key === 'ArrowLeft') to = TAB_IDS[(i + TAB_IDS.length - 1) % TAB_IDS.length];
            else if (e.key === 'Home') to = TAB_IDS[0];
            else if (e.key === 'End') to = TAB_IDS[TAB_IDS.length - 1];
            if (to) { e.preventDefault(); go(to); tabButtons[to].focus(); }
          }
        }
      }, ico(t.icon, 16), el('span', { class: 'ck-tab-label', text: t.label }), badge);
      tabButtons[t.id] = btn;
      tabBadges[t.id] = badge;
      tabs.appendChild(btn);
    }
    main.insertBefore(el('div', { class: 'ck-head' }, tabs), ringBar);
    const activeTabButton = () => tabButtons[S.tab] || tabButtons.world;

    const panelsEl = el('div', { class: 'ck-panels' });
    main.appendChild(panelsEl);

    // ================================================= WORLD
    function buildWorld() {
      const sec = el('section', { class: 'ck-panel ck-world', id: 'ck-p-world', role: 'tabpanel', 'aria-labelledby': 'ck-t-world', tabindex: '-1', hidden: true });
      const face = buildFace('big');
      const heroLabel = el('div', { class: 'ck-hero-label', text: 'Yerel saat' });
      const heroTime = el('div', { class: 'ck-hero-time' });
      const timeText = el('span', { class: 'ck-hero-digits' });
      const timePeriod = el('span', { class: 'ck-hero-period' });
      heroTime.append(timeText, timePeriod);
      const heroDate = el('div', { class: 'ck-hero-date' });
      const heroZone = el('div', { class: 'ck-hero-zone' });
      const hero = el('div', { class: 'ck-hero' },
        el('div', { class: 'ck-bigclock' }, face.el),
        el('div', { class: 'ck-hero-text' }, heroLabel, heroTime, heroDate, heroZone));

      const addBtn = el('button', { type: 'button', class: 'p-btn ck-add-city', on: { click: () => openCityPicker() } }, ico('plus', 16), 'Şehir ekle');
      const head = el('div', { class: 'ck-sec-head' },
        el('div', { class: 'ck-sec-title' }, el('h2', { class: 'ck-h2', text: 'Dünya saatleri' }), el('span', { class: 'ck-count' })),
        addBtn);
      const countEl = head.querySelector('.ck-count');
      const list = el('div', { class: 'ck-cities' });
      const empty = el('div', { class: 'p-empty ck-empty', hidden: true },
        ico('globe', 48),
        el('h3', { text: 'Henüz şehir eklenmedi' }),
        el('p', { text: 'Farklı saat dilimlerindeki saatleri bir bakışta görmek için şehir ekleyin.' }),
        el('button', { type: 'button', class: 'p-btn primary', on: { click: () => openCityPicker() } }, ico('plus', 16), 'Şehir ekle'));
      sec.append(hero, head, list, empty);

      const refs = new Map();
      const tips = [];
      let lastSec = -1;
      let lastDay = '';
      let justAdded = null;

      function cityMenu(e, city) {
        e.preventDefault();
        if (!P.contextMenu) return;
        P.contextMenu.show(e, [
          { label: 'En başa taşı', icon: 'arrow-up', disabled: S.cities[0] === city.id, action: () => moveCityFirst(city.id) },
          { type: 'separator' },
          { label: 'Kaldır', icon: 'delete', danger: true, action: () => removeCity(city.id) }
        ]);
      }

      function render() {
        flush(tips);
        list.textContent = '';
        refs.clear();
        countEl.textContent = S.cities.length ? String(S.cities.length) : '';
        empty.hidden = S.cities.length > 0;
        list.hidden = S.cities.length === 0;
        addBtn.disabled = S.cities.length >= CITIES.length;
        for (const id of S.cities) {
          const city = CITY_BY_ID.get(id);
          if (!city) continue;
          const f = buildFace('small');
          const timeEl = el('span', { class: 'ck-city-time' });
          const perEl = el('span', { class: 'ck-city-per' });
          const dnEl = el('span', { class: 'ck-dn' });
          const relEl = el('span', { class: 'ck-rel' });
          const subEl = el('div', { class: 'ck-city-sub' });
          const x = el('button', { type: 'button', class: 'ck-x', on: { click: (e) => { e.stopPropagation(); removeCity(id); } } }, ico('close', 12));
          tip(x, `${city.name} şehrini kaldır`, tips);
          const card = el('div', {
            class: 'ck-city' + (justAdded === id ? ' enter' : ''), tabindex: '0', role: 'group', 'aria-label': `${city.name}, ${city.country}`,
            dataset: { id },
            on: {
              contextmenu: (e) => cityMenu(e, city),
              keydown: (e) => {
                if (e.target !== card) return;
                if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeCity(id); }
              }
            }
          },
          el('div', { class: 'ck-city-face' }, f.el),
          el('div', { class: 'ck-city-body' }, el('div', { class: 'ck-city-name', text: city.name }), subEl),
          el('div', { class: 'ck-city-right' }, el('div', { class: 'ck-city-clock' }, timeEl, perEl), el('div', { class: 'ck-city-meta' }, dnEl, relEl)),
          x);
          list.appendChild(card);
          refs.set(id, { city, card, face: f, timeEl, perEl, dnEl, relEl, subEl, day: null });
        }
        if (justAdded) {
          const r = refs.get(justAdded);
          if (r) { try { r.card.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
          justAdded = null;
        }
        lastSec = -1;
        update(Date.now());
      }

      function update(now) {
        const d = new Date(now);
        face.set(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
        const sec = Math.floor(now / SEC);
        if (sec === lastSec) return;
        lastSec = sec;
        const clock = tzClock(now, null, true);
        timeText.textContent = clock.text;
        timePeriod.textContent = clock.period;
        const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${use24()}`;
        if (dayKey !== lastDay) {
          lastDay = dayKey;
          heroDate.textContent = dateFmt.format(now);
          const zn = localZoneLabel(now);
          heroZone.textContent = `${zn ? zn + ' · ' : ''}${fmtUtc(zoneOffset(now, null))}`;
        }
        for (const r of refs.values()) {
          const info = zoneInfo(now, r.city.tz, null);
          r.face.set(info.h, info.mi, info.s, 0);
          const c = tzClock(now, r.city.tz, false);
          if (r.timeEl.textContent !== c.text) r.timeEl.textContent = c.text;
          if (r.perEl.textContent !== c.period) r.perEl.textContent = c.period;
          const rel = fmtRel(info.rel);
          if (r.relEl.textContent !== rel) r.relEl.textContent = rel;
          const dayText = fmtDayDiff(info.dayDiff);
          const subText = `${r.city.country} · ${dayText}`;
          if (r.subEl.textContent !== subText) r.subEl.textContent = subText;
          r.card.dataset.day = String(info.dayDiff);
          if (r.isDay !== info.isDay) {
            r.isDay = info.isDay;
            r.dnEl.textContent = '';
            r.dnEl.appendChild(ico(info.isDay ? 'sun' : 'moon', 14));
            r.dnEl.className = 'ck-dn ' + (info.isDay ? 'day' : 'night');
            r.card.classList.toggle('night', !info.isDay);
          }
        }
      }

      function destroy() { flush(tips); }
      return { el: sec, render, update, destroy, refs, markAdded: (id) => { justAdded = id; }, resetClock: () => { lastSec = -1; lastDay = ''; } };
    }

    // ------------------------------------------------ city picker sheet
    function openCityPicker() {
      const search = el('input', { type: 'search', class: 'p-input ck-search', placeholder: 'Şehir veya ülke ara…', 'aria-label': 'Şehir ara', autocomplete: 'off', spellcheck: 'false' });
      const list = el('div', { class: 'ck-picklist', role: 'listbox', 'aria-label': 'Şehirler' });
      const none = el('div', { class: 'ck-pick-none', text: 'Eşleşen şehir yok.', hidden: true });
      const sorted = CITIES.slice().sort((a, b) => U.compareNames(a.name, b.name));
      const now = Date.now();
      const items = sorted.map((city) => {
        const added = S.cities.includes(city.id);
        const info = zoneInfo(now, city.tz, null);
        const t = tzClock(now, city.tz, false);
        const btn = el('button', {
          type: 'button', class: 'ck-pick' + (added ? ' added' : ''), role: 'option', disabled: added, dataset: { id: city.id },
          'aria-selected': added ? 'true' : 'false',
          on: { click: () => pick(city.id) }
        },
        el('span', { class: 'ck-pick-main' }, el('span', { class: 'ck-pick-name', text: city.name }), el('span', { class: 'ck-pick-country', text: city.country })),
        el('span', { class: 'ck-pick-time' }, `${t.period ? t.period + ' ' : ''}${t.text}`, el('small', { text: ` ${fmtRel(info.rel)}` })),
        el('span', { class: 'ck-pick-state' }, added ? ico('check', 16) : ico('plus', 16)));
        return { city, btn, key: fold(city.name + ' ' + city.country + ' ' + city.tz.replace(/_/g, ' ')) };
      });
      items.forEach((i) => list.appendChild(i.btn));
      list.appendChild(none);

      function visible() { return items.filter((i) => !i.btn.hidden); }
      function filter() {
        const q = fold(search.value.trim());
        let shown = 0;
        for (const i of items) { i.btn.hidden = !!q && !i.key.includes(q); if (!i.btn.hidden) shown++; }
        none.hidden = shown > 0;
      }
      function pick(id) {
        world.markAdded(id);
        if (addCity(id)) closeSheet();
      }
      search.addEventListener('input', filter);
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const first = visible().find((i) => !i.btn.disabled);
          if (first) first.btn.click();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const first = visible().find((i) => !i.btn.disabled);
          if (first) first.btn.focus();
        }
      });
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const act = visible().filter((i) => !i.btn.disabled).map((i) => i.btn);
        const idx = act.indexOf(document.activeElement);
        if (idx < 0) return;
        e.preventDefault();
        if (e.key === 'ArrowUp' && idx === 0) search.focus();
        else act[clamp(idx + (e.key === 'ArrowDown' ? 1 : -1), 0, act.length - 1)].focus();
      });
      openSheet({
        title: 'Şehir ekle',
        className: 'ck-picker',
        content: el('div', { class: 'ck-pickwrap' }, search, list),
        focus: () => search
      });
    }

    // ================================================= ALARM
    function buildAlarm() {
      const sec = el('section', { class: 'ck-panel ck-alarm', id: 'ck-p-alarm', role: 'tabpanel', 'aria-labelledby': 'ck-t-alarm', tabindex: '-1', hidden: true });
      const sub = el('div', { class: 'ck-sec-sub' });
      const addBtn = el('button', { type: 'button', class: 'p-btn primary ck-add-alarm', on: { click: () => openAlarmSheet(null) } }, ico('plus', 16), 'Alarm ekle');
      const head = el('div', { class: 'ck-sec-head' },
        el('div', { class: 'ck-sec-title stack' }, el('h2', { class: 'ck-h2', text: 'Alarmlar' }), sub),
        addBtn);
      const list = el('div', { class: 'ck-alarms' });
      const empty = el('div', { class: 'p-empty ck-empty', hidden: true },
        ico('alarm', 48),
        el('h3', { text: 'Alarm yok' }),
        el('p', { text: 'Sabah uyanmak ya da bir işi unutmamak için bir alarm kurun. Saat kapalıyken bile çalar.' }),
        el('button', { type: 'button', class: 'p-btn primary', on: { click: () => openAlarmSheet(null) } }, ico('plus', 16), 'Alarm ekle'));
      sec.append(head, list, empty);
      const tips = [];
      let lastNext = '';

      const sorted = () => S.alarms.slice().sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : U.compareNames(a.label, b.label)));

      function alarmMenu(e, a) {
        e.preventDefault();
        if (!P.contextMenu) return;
        P.contextMenu.show(e, [
          { label: 'Düzenle', icon: 'edit', action: () => openAlarmSheet(a.id) },
          { label: a.enabled ? 'Kapat' : 'Aç', icon: a.enabled ? 'bell-off' : 'bell', action: () => alarmToggle(a.id, !a.enabled) },
          { type: 'separator' },
          { label: 'Sil', icon: 'delete', danger: true, action: () => alarmRemove(a.id) }
        ]);
      }

      function card(a, now) {
        const t = fmtHM(a.time);
        const days = el('span', { class: 'ck-adays' });
        if (a.days.length) {
          DAYS_SHORT.forEach((d, i) => days.appendChild(el('span', { class: 'ck-day' + (a.days.includes(i) ? ' on' : ''), text: d, 'aria-label': DAYS_LONG[i] + (a.days.includes(i) ? ' açık' : ' kapalı') })));
        } else {
          days.appendChild(el('span', { class: 'ck-once', text: 'Bir kez' }));
        }
        if (a.snoozedUntil > now) {
          const st = fmtHM(`${p2(new Date(a.snoozedUntil).getHours())}:${p2(new Date(a.snoozedUntil).getMinutes())}`);
          days.appendChild(el('span', { class: 'ck-snoozed', text: `Ertelendi · ${st.text}${st.period ? ' ' + st.period : ''}` }));
        }
        const mainBtn = el('button', {
          type: 'button', class: 'ck-acard-main',
          'aria-label': `Alarmı düzenle: ${t.text}${t.period ? ' ' + t.period : ''}${a.label ? ', ' + a.label : ''}`,
          on: { click: () => openAlarmSheet(a.id) }
        },
        el('span', { class: 'ck-atop' },
          el('span', { class: 'ck-atime' }, t.text, t.period ? el('small', { class: 'ck-aper', text: t.period }) : null),
          el('span', { class: 'ck-alabel', text: a.label || 'Alarm' })),
        days);
        const input = el('input', { type: 'checkbox', checked: a.enabled, 'aria-label': `${t.text} alarmı ${a.enabled ? 'açık' : 'kapalı'}`, on: { change: () => alarmToggle(a.id, input.checked) } });
        const sw = el('label', { class: 'p-switch ck-aswitch' }, input, el('span'));
        const del = el('button', { type: 'button', class: 'p-btn icon small ck-adel', on: { click: () => alarmRemove(a.id) } }, ico('delete', 16));
        tip(del, 'Alarmı sil', tips);
        return el('div', { class: 'ck-acard' + (a.enabled ? '' : ' off'), dataset: { id: a.id }, on: { contextmenu: (e) => alarmMenu(e, a) } },
          mainBtn, el('div', { class: 'ck-aside' }, sw, del));
      }

      function render() {
        flush(tips);
        list.textContent = '';
        const now = Date.now();
        const alarms = sorted();
        empty.hidden = alarms.length > 0;
        list.hidden = alarms.length === 0;
        sub.hidden = alarms.length === 0;
        alarms.forEach((a) => list.appendChild(card(a, now)));
        lastNext = '';
        update(now);
      }

      function update(now) {
        const nx = nextAlarm(now);
        let text;
        if (!S.alarms.length) text = '';
        else if (!nx) text = 'Tüm alarmlar kapalı';
        else {
          const t = fmtHM(`${p2(new Date(nx.at).getHours())}:${p2(new Date(nx.at).getMinutes())}`);
          text = `Sonraki alarm ${fmtIn(nx.at - now)} sonra · ${dayWord(nx.at, now)} ${t.text}${t.period ? ' ' + t.period : ''}`;
        }
        if (text !== lastNext) { lastNext = text; sub.textContent = text; }
        // expire "Ertelendi" tags
        const stale = [...list.querySelectorAll('.ck-snoozed')].some((tag) => {
          const a = S.alarms.find((x) => x.id === tag.closest('.ck-acard').dataset.id);
          return !a || a.snoozedUntil <= now;
        });
        if (stale) render();
      }

      function destroy() { flush(tips); }
      return { el: sec, render, update, destroy };
    }

    // ------------------------------------------------ alarm editor sheet
    function openAlarmSheet(id) {
      const editing = id ? S.alarms.find((a) => a.id === id) : null;
      const nowD = new Date();
      const defTime = `${p2((nowD.getHours() + 1) % 24)}:00`;
      const days = new Set(editing ? editing.days : []);
      const timeInput = el('input', { type: 'time', class: 'p-input ck-time-input', required: true, 'aria-label': 'Alarm saati' });
      timeInput.value = editing ? editing.time : defTime;
      const labelInput = el('input', { type: 'text', class: 'p-input ck-label-input', maxlength: '60', placeholder: 'Ad (isteğe bağlı)', 'aria-label': 'Alarm adı', autocomplete: 'off' });
      labelInput.value = editing ? editing.label : '';
      const preview = el('div', { class: 'ck-preview', 'aria-live': 'polite' });
      const chips = el('div', { class: 'ck-daychips', role: 'group', 'aria-label': 'Tekrarlanacak günler' });
      const chipEls = DAYS_SHORT.map((d, i) => {
        const b = el('button', {
          type: 'button', class: 'ck-chip day', dataset: { day: String(i) }, 'aria-pressed': days.has(i) ? 'true' : 'false', 'aria-label': DAYS_LONG[i], text: d,
          on: { click: () => { if (days.has(i)) days.delete(i); else days.add(i); refresh(); } }
        });
        chips.appendChild(b);
        return b;
      });
      const quick = (label, set) => el('button', { type: 'button', class: 'p-btn small ghost', text: label, on: { click: () => { days.clear(); set.forEach((d) => days.add(d)); refresh(); } } });
      const quickRow = el('div', { class: 'ck-quick' }, quick('Bir kez', []), quick('Hafta içi', [0, 1, 2, 3, 4]), quick('Hafta sonu', [5, 6]), quick('Her gün', [0, 1, 2, 3, 4, 5, 6]));

      function refresh() {
        chipEls.forEach((b, i) => b.setAttribute('aria-pressed', days.has(i) ? 'true' : 'false'));
        const time = timeInput.value;
        if (!/^\d{2}:\d{2}$/.test(time)) { preview.textContent = 'Geçerli bir saat girin.'; return; }
        const now = Date.now();
        const at = alarmNextAt({ time, days: [...days].sort() }, now);
        const rep = days.size === 0 ? 'Bir kez' : days.size === 7 ? 'Her gün' : [...days].sort().map((d) => DAYS_SHORT[d]).join(', ');
        preview.textContent = at ? `${rep} · ${dayWord(at, now)} ${fmtHM(time).text}${fmtHM(time).period ? ' ' + fmtHM(time).period : ''} (${fmtIn(at - now)} sonra)` : '';
        timeInput.classList.remove('invalid');
      }

      function save() {
        const time = timeInput.value;
        if (!/^\d{2}:\d{2}$/.test(time)) { timeInput.classList.add('invalid'); timeInput.focus(); return; }
        const spec = { time, label: labelInput.value.trim(), days: [...days].sort(), enabled: true };
        try {
          if (editing) alarmUpdate(editing.id, spec); else alarmAdd(spec);
          closeSheet();
        } catch (e) {
          P.dialog.alert({ title: 'Alarm kaydedilemedi', message: e.message || String(e), icon: 'error' });
        }
      }

      timeInput.addEventListener('input', refresh);
      timeInput.addEventListener('change', refresh);
      [timeInput, labelInput].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }));

      const saveBtn = el('button', { type: 'button', class: 'p-btn primary ck-save', on: { click: save } }, 'Kaydet');
      const cancelBtn = el('button', { type: 'button', class: 'p-btn ck-cancel', on: { click: () => closeSheet() } }, 'İptal');
      const footer = [];
      if (editing) {
        footer.push(el('button', { type: 'button', class: 'p-btn ghost danger-text ck-delete', on: { click: () => { alarmRemove(editing.id); closeSheet(); } } }, ico('delete', 16), 'Sil'));
      }
      footer.push(el('span', { class: 'spacer' }), cancelBtn, saveBtn);

      refresh();
      openSheet({
        title: editing ? 'Alarmı düzenle' : 'Yeni alarm',
        className: 'ck-alarm-sheet',
        content: el('div', { class: 'ck-form' },
          el('label', { class: 'ck-field' }, el('span', { class: 'ck-field-label', text: 'Saat' }), timeInput),
          el('label', { class: 'ck-field' }, el('span', { class: 'ck-field-label', text: 'Ad' }), labelInput),
          el('div', { class: 'ck-field' }, el('span', { class: 'ck-field-label', text: 'Tekrar' }), chips, quickRow),
          preview),
        footer,
        focus: () => timeInput
      });
    }

    // ================================================= TIMER
    function buildTimer() {
      const sec = el('section', { class: 'ck-panel ck-timer', id: 'ck-p-timer', role: 'tabpanel', 'aria-labelledby': 'ck-t-timer', tabindex: '-1', hidden: true });
      const RB = 104;
      const CB = 2 * Math.PI * RB;
      const prog = svgEl('circle', { class: 'ck-ring-prog', cx: 120, cy: 120, r: RB, 'stroke-dasharray': CB.toFixed(2), 'stroke-dashoffset': '0', transform: 'rotate(-90 120 120)' });
      const ringSvg = svgEl('svg', { viewBox: '0 0 240 240', class: 'ck-ring-svg', 'aria-hidden': 'true', focusable: 'false' },
        svgEl('circle', { class: 'ck-ring-track', cx: 120, cy: 120, r: RB }), prog);
      const setHeroRing = ringSetter(prog, CB);
      const bigTime = el('div', { class: 'ck-ring-time', role: 'timer', 'aria-live': 'off', text: '05:00' });
      const bigLabel = el('div', { class: 'ck-ring-label' });
      const bigState = el('div', { class: 'ck-ring-state' });
      const ringWrap = el('div', { class: 'ck-ring-wrap' }, ringSvg, el('div', { class: 'ck-ring-center' }, bigTime, bigLabel, bigState));

      const heroReset = el('button', { type: 'button', class: 'p-btn icon ck-round ck-t-reset', on: { click: () => { const t = selected(); if (t) timerReset(t.id); } } }, ico('refresh', 18));
      const heroDelete = el('button', { type: 'button', class: 'p-btn icon ck-round ck-t-delete', on: { click: () => { const t = selected(); if (t) timerRemove(t.id); } } }, ico('delete', 18));
      tip(heroReset, 'Sıfırla', permanentTips);
      tip(heroDelete, 'Zamanlayıcıyı sil', permanentTips);
      const heroPrimaryIcon = el('span', { class: 'ck-ico' });
      const heroPrimaryText = el('span', { class: 'ck-ptext' });
      const heroPrimary = el('button', { type: 'button', class: 'p-btn primary ck-big ck-t-primary', on: { click: () => primaryAction() } }, heroPrimaryIcon, heroPrimaryText);
      const heroControls = el('div', { class: 'ck-ring-controls' }, heroReset, heroPrimary, heroDelete);
      const hero = el('div', { class: 'ck-thero is-draft' }, ringWrap, heroControls);

      // composer
      const presetBtns = PRESETS.map((m) => el('button', {
        type: 'button', class: 'ck-chip preset', dataset: { min: String(m) }, 'aria-pressed': 'false', text: `${m} dk`,
        on: { click: () => setDraft({ h: 0, m, s: 0 }) }
      }));
      const fields = {};
      function field(key, unit, max) {
        const input = el('input', {
          type: 'number', class: 'p-input ck-num', min: '0', max: String(max), step: '1', inputmode: 'numeric',
          'aria-label': { h: 'Saat', m: 'Dakika', s: 'Saniye' }[key], dataset: { unit: key }
        });
        input.value = p2(S.draft[key]);
        input.addEventListener('input', () => {
          if (input.value === '') { S.draft[key] = 0; } else S.draft[key] = clamp(Math.floor(num(input.value)), 0, max);
          draftChanged(false);
        });
        const norm = () => { input.value = p2(S.draft[key]); };
        input.addEventListener('change', () => { S.draft[key] = clamp(Math.floor(num(input.value)), 0, max); norm(); draftChanged(true); });
        input.addEventListener('blur', norm);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); S.draft[key] = clamp(Math.floor(num(input.value)), 0, max); norm(); startFromDraft(); }
        });
        fields[key] = input;
        return el('label', { class: 'ck-hms-field' }, input, el('span', { class: 'ck-hms-unit', text: unit }));
      }
      const labelInput = el('input', { type: 'text', class: 'p-input ck-tlabel', maxlength: '40', placeholder: 'Ad (isteğe bağlı)', 'aria-label': 'Zamanlayıcı adı', autocomplete: 'off' });
      labelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startFromDraft(); } });
      const startBtn = el('button', { type: 'button', class: 'p-btn primary ck-t-start', on: { click: () => startFromDraft() } }, ico('play', 16), 'Başlat');
      const zeroHint = el('div', { class: 'ck-hint', text: 'Başlatmak için en az 1 saniye girin.', hidden: true });
      const compose = el('div', { class: 'ck-compose' },
        el('h3', { class: 'ck-h3', text: 'Yeni zamanlayıcı' }),
        el('div', { class: 'ck-chips', role: 'group', 'aria-label': 'Hazır süreler' }, presetBtns),
        el('div', { class: 'ck-hms' }, field('h', 'sa', 99), el('span', { class: 'ck-colon', text: ':' }), field('m', 'dk', 59), el('span', { class: 'ck-colon', text: ':' }), field('s', 'sn', 59)),
        el('div', { class: 'ck-compose-row' }, labelInput, startBtn),
        zeroHint);

      const listHead = el('div', { class: 'ck-tlist-head' }, el('h3', { class: 'ck-h3', text: 'Zamanlayıcılar' }), el('span', { class: 'ck-count' }));
      const listCount = listHead.querySelector('.ck-count');
      const list = el('ul', { class: 'ck-tlist', 'aria-label': 'Zamanlayıcılar' });
      const none = el('div', { class: 'ck-tnone', text: 'Henüz zamanlayıcı yok. Bir süre seçip Başlat\'a basın; birden çok zamanlayıcı aynı anda çalışabilir.' });
      const side = el('div', { class: 'ck-tside' }, compose, listHead, list, none);
      sec.append(el('div', { class: 'ck-tgrid' }, hero, side));

      const rows = new Map();
      const tips = [];
      let heroKey = '';

      const selected = () => (S.sel ? findTimer(S.sel) : null);
      const draftMs = () => (S.draft.h * 3600 + S.draft.m * 60 + S.draft.s) * SEC;

      function setDraft(d) {
        S.draft = { h: d.h, m: d.m, s: d.s };
        for (const k of ['h', 'm', 's']) fields[k].value = p2(S.draft[k]);
        draftChanged(true);
      }

      function draftChanged(persist) {
        const ms = draftMs();
        startBtn.disabled = ms < SEC;
        zeroHint.hidden = ms >= SEC;
        presetBtns.forEach((b) => b.setAttribute('aria-pressed', ms === Number(b.dataset.min) * MIN ? 'true' : 'false'));
        if (persist) save();
        if (!selected()) updateHero(Date.now(), true);
      }

      function startFromDraft() {
        const ms = draftMs();
        if (ms < SEC) { fields.s.classList.add('invalid'); fields.m.classList.add('invalid'); fields.h.classList.add('invalid'); setTimeout(() => Object.values(fields).forEach((f) => f.classList.remove('invalid')), 900); return null; }
        const t = timerAdd({ duration: ms, label: labelInput.value.trim() });
        labelInput.value = '';
        return t;
      }

      function primaryAction() {
        const t = selected();
        if (!t) { startFromDraft(); return; }
        if (t.state === 'running') timerPause(t.id);
        else if (t.state === 'done') timerRestart(t.id);
        else timerResume(t.id);
      }

      const STATE_TEXT = { idle: 'Hazır', running: 'Çalışıyor', paused: 'Duraklatıldı', done: 'Süre doldu' };

      function updateHero(now, force) {
        const t = selected();
        let rem; let frac; let state; let label;
        if (t) {
          rem = timerRemaining(t, now);
          frac = t.duration ? rem / t.duration : 0;
          state = t.state;
          label = t.label ? `${t.label} · ${fmtDur(t.duration)}` : fmtDur(t.duration);
        } else {
          rem = draftMs();
          frac = 1;
          state = 'draft';
          label = rem >= SEC ? fmtDur(rem) : '';
        }
        const key = `${t ? t.id : '-'}|${state}`;
        if (key !== heroKey || force) {
          heroKey = key;
          hero.className = `ck-thero is-${state}`;
          bigState.textContent = state === 'draft' ? 'Hazır' : STATE_TEXT[state];
          heroReset.hidden = !t;
          heroDelete.hidden = !t;
          const primary = !t ? { icon: 'play', text: 'Başlat' }
            : t.state === 'running' ? { icon: 'pause', text: 'Duraklat' }
              : t.state === 'done' ? { icon: 'refresh', text: 'Yeniden başlat' }
                : t.state === 'paused' ? { icon: 'play', text: 'Sürdür' } : { icon: 'play', text: 'Başlat' };
          heroPrimaryIcon.textContent = '';
          heroPrimaryIcon.appendChild(ico(primary.icon, 18));
          heroPrimaryText.textContent = primary.text;
          heroPrimary.disabled = !t && rem < SEC;
          heroReset.disabled = !!t && t.state === 'idle';
        }
        const txt = fmtCountdown(rem);
        if (bigTime.textContent !== txt) bigTime.textContent = txt;
        if (bigLabel.textContent !== label) bigLabel.textContent = label;
        setHeroRing(frac);
        bigTime.classList.toggle('long', txt.length > 5);
      }

      function selectTimer(id) {
        S.sel = id;
        save();
        render();
      }

      function timerMenu(e, t) {
        e.preventDefault();
        if (!P.contextMenu) return;
        P.contextMenu.show(e, [
          t.state === 'running' ? { label: 'Duraklat', icon: 'pause', action: () => timerPause(t.id) }
            : t.state === 'done' ? { label: 'Yeniden başlat', icon: 'refresh', action: () => timerRestart(t.id) }
              : { label: t.state === 'paused' ? 'Sürdür' : 'Başlat', icon: 'play', action: () => timerResume(t.id) },
          { label: 'Sıfırla', icon: 'refresh', disabled: t.state === 'idle', action: () => timerReset(t.id) },
          { type: 'separator' },
          { label: 'Sil', icon: 'delete', danger: true, action: () => timerRemove(t.id) }
        ]);
      }

      function row(t) {
        const R = 18;
        const C = 2 * Math.PI * R;
        const p = svgEl('circle', { class: 'ck-ring-prog', cx: 22, cy: 22, r: R, 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': '0', transform: 'rotate(-90 22 22)' });
        const svg = svgEl('svg', { viewBox: '0 0 44 44', class: 'ck-mini', 'aria-hidden': 'true', focusable: 'false' }, svgEl('circle', { class: 'ck-ring-track', cx: 22, cy: 22, r: R }), p);
        const timeEl = el('span', { class: 'ck-trow-time' });
        const subEl = el('span', { class: 'ck-trow-sub' });
        const mainBtn = el('button', { type: 'button', class: 'ck-trow-main', on: { click: () => selectTimer(t.id) } }, svg, el('span', { class: 'ck-trow-text' }, timeEl, subEl));
        const running = t.state === 'running';
        const toggle = el('button', {
          type: 'button', class: 'p-btn icon small ck-trow-toggle',
          on: { click: () => (t.state === 'running' ? timerPause(t.id) : t.state === 'done' ? timerRestart(t.id) : timerResume(t.id)) }
        }, ico(running ? 'pause' : t.state === 'done' ? 'refresh' : 'play', 16));
        tip(toggle, running ? 'Duraklat' : t.state === 'done' ? 'Yeniden başlat' : t.state === 'paused' ? 'Sürdür' : 'Başlat', tips);
        const del = el('button', { type: 'button', class: 'p-btn icon small ck-trow-del', on: { click: () => timerRemove(t.id) } }, ico('delete', 16));
        tip(del, 'Sil', tips);
        const li = el('li', {
          class: `ck-trow is-${t.state}` + (S.sel === t.id ? ' selected' : ''), dataset: { id: t.id },
          on: { contextmenu: (e) => timerMenu(e, t) }
        }, mainBtn, toggle, del);
        mainBtn.setAttribute('aria-pressed', S.sel === t.id ? 'true' : 'false');
        rows.set(t.id, { li, timeEl, subEl, set: ringSetter(p, C), t });
        return li;
      }

      function updateRows(now) {
        for (const r of rows.values()) {
          const t = findTimer(r.t.id) || r.t;
          const rem = timerRemaining(t, now);
          const txt = fmtCountdown(rem);
          if (r.timeEl.textContent !== txt) r.timeEl.textContent = txt;
          const sub = `${t.label ? t.label + ' · ' : ''}${fmtDur(t.duration)} · ${STATE_TEXT[t.state]}`;
          if (r.subEl.textContent !== sub) r.subEl.textContent = sub;
          r.set(t.duration ? rem / t.duration : 0);
        }
      }

      function render() {
        flush(tips);
        list.textContent = '';
        rows.clear();
        if (S.sel && !findTimer(S.sel)) S.sel = null;
        none.hidden = S.timers.length > 0;
        list.hidden = S.timers.length === 0;
        listCount.textContent = S.timers.length ? String(S.timers.length) : '';
        S.timers.forEach((t) => list.appendChild(row(t)));
        for (const k of ['h', 'm', 's']) if (document.activeElement !== fields[k]) fields[k].value = p2(S.draft[k]);
        draftChanged(false);
        updateHero(Date.now(), true);
        updateRows(Date.now());
      }

      function update(now) {
        updateHero(now, false);
        updateRows(now);
      }

      function destroy() { flush(tips); }
      return { el: sec, render, update, destroy, setDraft, primaryAction, startFromDraft, rows };
    }

    // ================================================= STOPWATCH
    function buildStopwatch() {
      const sec = el('section', { class: 'ck-panel ck-sw', id: 'ck-p-stopwatch', role: 'tabpanel', 'aria-labelledby': 'ck-t-stopwatch', tabindex: '-1', hidden: true });
      const dMain = el('span', { class: 'ck-sw-main', text: '00:00' });
      const dCs = el('span', { class: 'ck-sw-cs', text: ',00' });
      const display = el('div', { class: 'ck-sw-display', role: 'timer', 'aria-live': 'off', 'aria-label': 'Kronometre' }, dMain, dCs);
      const btnReset = el('button', { type: 'button', class: 'p-btn ck-sw-reset', on: { click: () => swReset() } }, ico('refresh', 16), 'Sıfırla');
      const toggleIcon = el('span', { class: 'ck-ico' });
      const toggleText = el('span', { class: 'ck-ptext' });
      const btnToggle = el('button', { type: 'button', class: 'p-btn primary ck-big ck-sw-toggle', on: { click: () => toggle() } }, toggleIcon, toggleText);
      const btnLap = el('button', { type: 'button', class: 'p-btn ck-sw-lap', on: { click: () => swLap() } }, ico('flag', 16), 'Tur');
      const controls = el('div', { class: 'ck-sw-controls' }, btnReset, btnToggle, btnLap);
      const keys = el('div', { class: 'ck-sw-keys' },
        el('span', { class: 'p-kbd', text: 'Boşluk' }), ' Başlat/Durdur', el('i', { class: 'ck-dotsep' }),
        el('span', { class: 'p-kbd', text: 'L' }), ' Tur', el('i', { class: 'ck-dotsep' }),
        el('span', { class: 'p-kbd', text: 'R' }), ' Sıfırla');
      const top = el('div', { class: 'ck-sw-top' }, display, controls, keys);

      const tbody = el('tbody');
      const table = el('table', { class: 'ck-laptable' },
        el('thead', null, el('tr', null, el('th', { class: 'n', scope: 'col', text: 'Tur' }), el('th', { class: 'r', scope: 'col', text: 'Tur süresi' }), el('th', { class: 'r', scope: 'col', text: 'Toplam' }))),
        tbody);
      const scroller = el('div', { class: 'ck-laps' }, table);
      const noLaps = el('div', { class: 'ck-tnone ck-nolaps', text: 'Tur eklemek için kronometre çalışırken Tur düğmesine ya da L tuşuna basın.' });
      sec.append(top, scroller, noLaps);

      let curRow = null;
      let lastMain = '';
      let lastCs = '';

      function toggle() { if (S.sw.running) swStop(); else swStart(); }

      function render() {
        const sw = S.sw;
        const running = sw.running;
        const e = swElapsed(sw, Date.now());
        toggleIcon.textContent = '';
        toggleIcon.appendChild(ico(running ? 'pause' : 'play', 18));
        toggleText.textContent = running ? 'Durdur' : 'Başlat';
        btnToggle.classList.toggle('is-running', running);
        btnLap.disabled = !running;
        btnReset.disabled = e === 0 && !sw.laps.length && !running;
        sec.classList.toggle('is-running', running);
        const info = lapInfo(sw.laps);
        tbody.textContent = '';
        curRow = null;
        if (sw.laps.length) {
          const cn = el('td', { class: 'n' }, `${sw.laps.length + 1}`);
          const cs = el('td', { class: 'r split' });
          const ct = el('td', { class: 'r total' });
          const tr = el('tr', { class: 'ck-lap current' }, cn, cs, ct);
          tbody.appendChild(tr);
          curRow = { cs, ct };
        }
        for (let i = info.rows.length - 1; i >= 0; i--) {
          const r = info.rows[i];
          const cls = info.best.has(i) ? ' best' : info.worst.has(i) ? ' worst' : '';
          tbody.appendChild(el('tr', { class: 'ck-lap' + cls, dataset: { n: String(r.n) } },
            el('td', { class: 'n' }, String(r.n), cls ? el('span', { class: 'ck-lap-tag', text: info.best.has(i) ? 'En hızlı' : 'En yavaş' }) : null),
            el('td', { class: 'r split', text: fmtSw(r.split) }),
            el('td', { class: 'r total', text: fmtSw(r.total) })));
        }
        scroller.hidden = !sw.laps.length;
        noLaps.hidden = sw.laps.length > 0;
        lastMain = '';
        lastCs = '';
        update(Date.now());
      }

      function update(now) {
        const sw = S.sw;
        const e = swElapsed(sw, now);
        const f = fmtSwParts(e);
        if (f.main !== lastMain) { lastMain = f.main; dMain.textContent = f.main; }
        if (f.cs !== lastCs) { lastCs = f.cs; dCs.textContent = f.cs; }
        if (curRow) {
          const last = sw.laps[sw.laps.length - 1] || 0;
          curRow.cs.textContent = fmtSw(Math.max(0, e - last));
          curRow.ct.textContent = fmtSw(e);
        }
        btnReset.disabled = e === 0 && !sw.laps.length && !sw.running;
      }

      return { el: sec, render, update, toggle, destroy() {} };
    }

    // ------------------------------------------------ assemble panels
    const world = buildWorld();
    const alarm = buildAlarm();
    const timer = buildTimer();
    const stopwatch = buildStopwatch();
    const panels = { world, alarm, timer, stopwatch };
    TAB_IDS.forEach((id) => panelsEl.appendChild(panels[id].el));

    function renderBadges() {
      const alarms = S.alarms.filter((a) => a.enabled).length;
      const timers = S.timers.filter((t) => t.state === 'running').length;
      const set = (id, n, label) => {
        const b = tabBadges[id];
        b.hidden = !n;
        b.textContent = n ? String(n) : '';
        b.setAttribute('aria-label', n ? `${n} ${label}` : '');
      };
      set('alarm', alarms, 'açık alarm');
      set('timer', timers, 'çalışan zamanlayıcı');
      const sw = tabBadges.stopwatch;
      sw.hidden = !S.sw.running;
      sw.classList.toggle('dot', S.sw.running);
      sw.textContent = '';
      sw.setAttribute('aria-label', S.sw.running ? 'çalışıyor' : '');
    }

    function go(tab, opts) {
      if (!TAB_IDS.includes(tab)) return false;
      const changed = S.tab !== tab;
      S.tab = tab;
      if (changed) save();
      for (const id of TAB_IDS) {
        const active = id === tab;
        panels[id].el.hidden = !active;
        tabButtons[id].classList.toggle('active', active);
        tabButtons[id].setAttribute('aria-selected', active ? 'true' : 'false');
        tabButtons[id].tabIndex = active ? 0 : -1;
      }
      panels[tab].render();
      if (opts && opts.focus) panels[tab].el.focus();
      return true;
    }

    function renderAll() {
      world.render();
      alarm.render();
      timer.render();
      stopwatch.render();
      renderBadges();
      renderRings();
    }

    // ------------------------------------------------ live loop (rAF for smoothness, interval as fallback)
    let raf = 0;
    let iv = 0;
    let lastRun = -1e9;
    let lastSecond = -1;
    function tick() {
      if (win.isClosed && win.isClosed()) return;
      if (win.isMinimized && win.isMinimized()) return;
      lastRun = performance.now();
      const now = Date.now();
      panels[S.tab].update(now);
      const sec = Math.floor(now / SEC);
      if (sec !== lastSecond) {
        lastSecond = sec;
        renderBadges();
        // the exact-timeout in schedule() normally finishes timers; this catches anything it missed
        if (S.timers.some((t) => t.state === 'running' && t.endsAt <= now)) checkTimers(now);
      }
    }
    function frame() {
      raf = requestAnimationFrame(frame);
      tick();
    }
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
    iv = setInterval(() => { if (performance.now() - lastRun > 120) tick(); }, 200);

    // ------------------------------------------------ model -> view
    sub('clock:change', (e) => {
      const what = e && e.what;
      if (what === 'all') { renderAll(); go(S.tab); return; }
      if (what === 'cities') world.render();
      if (what === 'alarms') alarm.render();
      if (what === 'timers') { timer.render(); if (S.tab === 'timer') timer.update(Date.now()); }
      if (what === 'sw') stopwatch.render();
      renderBadges();
    });
    sub('clock:ring', renderRings);
    sub('settings:change', (e) => {
      if (e && e.key === 'clock24h') { world.resetClock(); world.render(); alarm.render(); }
    });

    // ------------------------------------------------ keyboard
    let spaceHandled = false;
    win.on('keydown', (e) => {
      if (e.key === 'Escape' && sheetState) { e.preventDefault(); closeSheet(); return; }
      if (sheetState || S.tab !== 'stopwatch') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target;
      if (U.isEditable(tgt)) return;
      const k = e.key;
      const onButton = tgt && tgt.tagName === 'BUTTON';
      if (k === ' ' || k === 'Spacebar') {
        // let a focused control inside the stopwatch (or the banner) handle its own Space; the tab buttons pass it on
        if (onButton && !tgt.closest('.ck-tab')) return;
        e.preventDefault();
        spaceHandled = true;
        stopwatch.toggle();
      } else if (k === 'l' || k === 'L') {
        e.preventDefault();
        swLap();
      } else if (k === 'r' || k === 'R') {
        e.preventDefault();
        swReset();
      }
    });
    listen(win.el, 'keyup', (e) => {
      if ((e.key === ' ' || e.key === 'Spacebar') && spaceHandled) { spaceHandled = false; e.preventDefault(); }
    }, true);

    // ------------------------------------------------ teardown (the background service keeps running)
    win.on('close', () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      raf = 0;
      iv = 0;
      closeSheet(true);
      subs.splice(0).forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
      cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
      flush(permanentTips);
      flush(ringTips);
      flush(sheetTips);
      Object.values(panels).forEach((p) => { try { p.destroy(); } catch (e) { /* ignore */ } });
    });
    win.on('restore', () => tick());

    // ------------------------------------------------ first paint (synchronous: rAF may never run)
    renderAll();
    go(S.tab);
    tick();

    return {
      api: {
        go,
        tab: () => S.tab,
        tick,
        renderAll,
        world,
        alarm,
        timer,
        stopwatch,
        openAlarmSheet,
        openCityPicker,
        closeSheet,
        sheetOpen: () => !!sheetState,
        ping: () => ({ raf, iv })
      },
      go
    };
  }

  // ---------------------------------------------------------------- public API (tests, other modules)
  P.clock = {
    CITIES,
    DAYS_SHORT,
    stats,
    state: () => JSON.parse(JSON.stringify(S)),
    reload() { S = sanitize(P.storage.get(KEY, null)); emit('all'); schedule(); },
    reset() { S = defaults(); stopAllRings(); commit('all'); },
    tick: serviceTick,
    checkAlarms,
    checkTimers,
    alarmNextAt,
    nextAlarm,
    rings: () => ringList().map((r) => Object.assign({}, r)),
    stopRing,
    stopAll: stopAllRings,
    cities: { add: addCity, remove: removeCity, first: moveCityFirst },
    alarm: { add: alarmAdd, update: alarmUpdate, toggle: alarmToggle, remove: alarmRemove, snooze: alarmSnooze },
    timer: { add: timerAdd, pause: timerPause, resume: timerResume, reset: timerReset, restart: timerRestart, remove: timerRemove, remaining: timerRemaining },
    stopwatch: { start: swStart, stop: swStop, lap: swLap, reset: swReset, elapsed: swElapsed, laps: lapInfo },
    zone: { offset: zoneOffset, info: zoneInfo, parts: zoneParts, rel: fmtRel, utc: fmtUtc, dayDiff: fmtDayDiff },
    fmt: { countdown: fmtCountdown, stopwatch: fmtSw, duration: fmtDur, until: fmtIn }
  };

  // ---------------------------------------------------------------- register
  P.apps.register({
    id: APP_ID,
    name: 'Saat',
    icon: 'clock',
    description: 'Dünya saati, alarm, zamanlayıcı ve kronometre',
    category: 'utilities',
    singleInstance: true,
    fileTypes: [],
    window: { width: 720, height: 540, minWidth: 520, minHeight: 420 },
    launch(win, args) {
      const app = createApp(win);
      win.state.clock = app.api;
      if (args && args.tab) app.go(args.tab);
    },
    relaunch(win, args) {
      if (args && args.tab && win.state.clock) win.state.clock.go(args.tab);
    }
  });
})();
