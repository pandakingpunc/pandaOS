/* PandaOS — Müzik Çalar (id: music)
   Tüm sesler Web Audio ile canlı olarak sentezlenir; hiçbir ses dosyası yoktur.
   Bölümler: 1) müzik teorisi + şarkı yazım yardımcıları, 2) yerleşik şarkılar (.pmus verisi),
   3) .pmus ayrıştırma, 4) sentez motoru + zamanlayıcı, 5) çalar (durum makinesi), 6) arayüz. */
(function () {
  'use strict';

  const P = window.PandaOS;
  const APP_ID = 'music';
  const STORE_KEY = 'app.music';

  // ================================================================================================
  // 1. Music theory + song authoring helpers
  // ================================================================================================
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const NOTE_RE = /^([A-Ga-g])([#b]?)(\d)$/;
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const DRUM_NAMES = ['kick', 'snare', 'hat', 'clap'];
  const INSTRUMENTS = ['lead', 'pad', 'bass', 'pluck', 'bell', 'drums'];

  /** 'C#4' -> 61. NaN for anything outside C0..B8 or not a note name. */
  function noteToMidi(name) {
    if (typeof name !== 'string') return NaN;
    const m = NOTE_RE.exec(name.trim());
    if (!m) return NaN;
    const midi = 12 * (Number(m[3]) + 1) + PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return midi >= 12 && midi <= 119 ? midi : NaN;
  }

  const midiToName = (m) => SHARP_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const CHORD_TYPES = {
    '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
    m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], 9: [0, 4, 7, 10, 14], sus4: [0, 5, 7], sus2: [0, 2, 7],
    6: [0, 4, 7, 9], add9: [0, 4, 7, 14], dim: [0, 3, 6], '7sus4': [0, 5, 7, 10]
  };

  function parseChord(sym) {
    const m = /^([A-G])([#b]?)(.*)$/.exec(sym);
    const iv = m && CHORD_TYPES[m[3]];
    if (!iv) throw new Error('Bilinmeyen akor: ' + sym);
    const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    return { sym, root, intervals: iv };
  }

  /** Root of a chord symbol at a given octave: ('Dm7', 2) -> 'D2'. */
  function rootAt(sym, oct) { return midiToName(12 * (oct + 1) + parseChord(sym).root); }
  /** Perfect fifth above the root (same octave counting as rootAt). */
  function fifthAt(sym, oct) { return midiToName(12 * (oct + 1) + parseChord(sym).root + 7); }

  /** Smooth voice-leading for pads: returns next(sym) -> ascending note names. */
  function padVoicer({ voices = 4, low = 48, high = 72 } = {}) {
    let prev = null;
    return function next(sym) {
      const ch = parseChord(sym);
      const tones = ch.intervals.map((i) => ({ pc: (ch.root + i) % 12, iv: i }));
      const all = tones.length <= voices;
      const essential = new Set(tones.filter((t) => all || t.iv !== 7).map((t) => t.pc));
      const cand = [];
      for (let m = low; m <= high; m++) if (tones.some((t) => t.pc === m % 12)) cand.push(m);
      let best = null;
      let bestCost = Infinity;
      const pick = [];
      const rec = (start) => {
        if (pick.length === voices) {
          const have = new Set(pick.map((m) => m % 12));
          for (const pc of essential) if (!have.has(pc)) return;
          const span = pick[voices - 1] - pick[0];
          if (span > 19) return;
          let cost = span * 0.15;
          for (let i = 1; i < voices; i++) {
            const gap = pick[i] - pick[i - 1];
            if (gap < 3) cost += pick[i - 1] >= 60 ? 1.2 : 3;   // no muddy clusters in the low register
            if (gap === 1) cost += 5;                          // and no clashing semitones
          }
          if (prev) for (let i = 0; i < voices; i++) cost += Math.abs(pick[i] - prev[i]);
          else cost += Math.abs(pick.reduce((a, b) => a + b, 0) / voices - (low + high) / 2) * 0.6;
          if (cost < bestCost) { bestCost = cost; best = pick.slice(); }
          return;
        }
        for (let i = start; i < cand.length; i++) { pick.push(cand[i]); rec(i + 1); pick.pop(); }
      };
      rec(0);
      if (!best) best = cand.slice(0, voices);
      prev = best;
      return best.map(midiToName);
    };
  }

  /** Arpeggio bar from chord tones (indices run through the chord, then the same tones an octave up). */
  function arp(sym, pattern, step, oct) {
    const ch = parseChord(sym);
    const offs = ch.intervals.concat(ch.intervals.map((i) => i + 12));
    const base = 12 * (oct + 1) + ch.root;
    return pattern.map((i) => [midiToName(base + offs[i % offs.length] + 12 * Math.floor(i / offs.length)), step]);
  }

  /** Transposes a note list by n semitones (rests and drum names are untouched). */
  function shift(notes, n) {
    return notes.map((x) => {
      const m = noteToMidi(x[0]);
      return Number.isNaN(m) ? x : [midiToName(m + n)].concat(x.slice(1));
    });
  }

  /**
   * Mini notation -> [[name|null, beats, vel?], ...].
   *   'E5 D#5:2 -:.5 C4@.6'   NAME[:DUR][@VEL]; '-' = rest; 'd=2' sets default duration; 'v=.5' default velocity;
   *   '|' is ignored (bar lines). `unit` multiplies every duration (0.25: durations counted in sixteenths).
   */
  function seq(str, unit = 1) {
    const out = [];
    let dur = unit;
    let vel = null;
    for (const tok of String(str).split(/\s+/)) {
      if (!tok || tok === '|') continue;
      let m = /^d=([\d.]+)$/.exec(tok);
      if (m) { dur = Number(m[1]) * unit; continue; }
      m = /^v=([\d.]+)$/.exec(tok);
      if (m) { vel = Number(m[1]); continue; }
      m = /^(kick|snare|hat|clap|-|[A-Ga-g][#b]?\d)(?::([\d.]+))?(?:@([\d.]+))?$/.exec(tok);
      if (!m) throw new Error('seq: geçersiz belirteç "' + tok + '"');
      const raw = m[1];
      const name = raw === '-' ? null : raw[0].toUpperCase() + raw.slice(1);
      const d = m[2] != null ? Number(m[2]) * unit : dur;
      const v = m[3] != null ? Number(m[3]) : vel;
      out.push(v == null || v === 0.8 ? [name, d] : [name, d, v]);
    }
    return out;
  }

  const LANE_VEL = { X: 1, x: 0.8, o: 0.5, g: 0.3 };
  /** Step-grid drum lane: 'X' accent, 'x' normal, 'o' soft, 'g' ghost, '.' rest. */
  function lane(sound, pattern, step = 0.25) {
    const notes = [];
    let rest = 0;
    for (const ch of String(pattern).replace(/[\s|]/g, '')) {
      if (ch === '.') { rest += step; continue; }
      const v = LANE_VEL[ch];
      if (v == null) throw new Error('lane: geçersiz karakter "' + ch + '"');
      if (rest) { notes.push([null, rest]); rest = 0; }
      notes.push(v === 0.8 ? [sound, step] : [sound, step, v]);
    }
    if (rest) notes.push([null, rest]);
    return notes;
  }

  const sumBeats = (notes) => notes.reduce((a, n) => a + n[1], 0);
  const rep = (str, n) => Array(n).fill(str).join(' ');

  function mergeRests(notes) {
    const out = [];
    for (const n of notes) {
      const last = out[out.length - 1];
      if (n[0] == null && last && last[0] == null) last[1] += n[1];
      else out.push(n.slice());
    }
    return out;
  }

  /**
   * Assembles a .pmus song from sections. trackDefs: [{ id, instrument, ...extras }]; sections:
   * [{ beats, t: { trackId: notes|string } }]. A missing track is silent for that section; every track of every
   * section must add up to the section length (throws otherwise), so all tracks end with the same total beats.
   */
  function buildSong(meta, trackDefs, sections) {
    const tracks = trackDefs.map((td) => {
      const { id, ...rest } = td;
      return Object.assign({ instrument: rest.instrument }, rest, { notes: [] });
    });
    sections.forEach((sec, si) => {
      trackDefs.forEach((td, ti) => {
        let notes = sec.t[td.id];
        if (notes == null) notes = [[null, sec.beats]];
        else if (typeof notes === 'string') notes = seq(notes);
        const sum = sumBeats(notes);
        if (Math.abs(sum - sec.beats) > 1e-9) {
          throw new Error(`${meta.title}: bölüm ${si + 1} / ${td.id}: ${sum} vuruş (beklenen ${sec.beats})`);
        }
        tracks[ti].notes.push(...notes);
      });
    });
    tracks.forEach((t) => { t.notes = mergeRests(t.notes); });
    return Object.assign({}, meta, { tracks });
  }

  // ================================================================================================
  // 2. Built-in library (every song is plain .pmus data, assembled at load time from the mini notation)
  // ================================================================================================

  /** "Bambu Ormanı" — original chill lo-fi (C major, 76 bpm, light swing). */
  function songBambu() {
    const pv = padVoicer({ voices: 4, low: 50, high: 74 });
    const padFor = (list) => {
      const v = [[], [], [], []];
      list.forEach(([sym, b]) => pv(sym).forEach((n, i) => v[i].push([n, b])));
      return { pad1: v[0], pad2: v[1], pad3: v[2], pad4: v[3] };
    };
    const bassFor = (list) => list.flatMap(([sym, b]) => (b === 4
      ? seq(`${rootAt(sym, 2)}:1.5 -:.5 ${rootAt(sym, 2)}:.5 ${fifthAt(sym, 2)}:.5 ${rootAt(sym, 2)}:1`)
      : seq(`${rootAt(sym, 2)}:1 -:.5 ${rootAt(sym, 2)}:.5`)));
    const full = (list, f) => list.flatMap(([sym, b]) => f(sym, b));

    const introC = [['Fmaj7', 4], ['Em7', 4], ['Dm7', 4], ['Cmaj7', 4]];
    const aC = [['Fmaj7', 4], ['Em7', 4], ['Dm7', 4], ['Cmaj7', 4], ['Fmaj7', 4], ['Em7', 4], ['Dm7', 4], ['G7', 4]];
    const bC = [['Am7', 4], ['Dm7', 4], ['G7', 4], ['Cmaj7', 4], ['Am7', 4], ['Dm7', 4], ['Em7', 2], ['A7', 2], ['Dm7', 2], ['G7', 2]];

    const melA = [
      'E5:1 -:.5 C5:.5 A4:1 C5:1', 'B4:1.5 G4:.5 B4:1 D5:1', 'C5:1 A4:.5 F4:.5 A4:1.5 -:.5', 'G4:1 E4:1 G4:.5 C5:.5 E5:1',
      'E5:1 -:.5 C5:.5 A4:1 C5:1', 'B4:1.5 G4:.5 E5:1 D5:1', 'C5:1 D5:.5 F5:.5 E5:1 D5:1', 'B4:1.5 D5:.5 G4:2'
    ].join(' ');
    const melB = [
      'A4:1 C5:1 E5:1.5 D5:.5', 'F5:1.5 E5:.5 D5:1 A4:1', 'B4:1 D5:1 G5:1.5 F5:.5', 'E5:3 -:1',
      'A4:1 C5:1 E5:1.5 G5:.5', 'F5:1 A5:1 G5:1 F5:1', 'G5:1 E5:1 E5:1 C#5:1', 'D5:1.5 C5:.5 B4:1 G4:1'
    ].join(' ');
    const melOut = 'C5:2 A4:2 B4:2 G4:2 A4:2 F4:2 G4:1 E4:1 C4:2';
    const bellA = 'E6:.5 -:3.5 D6:.5 -:3.5 C6:.5 -:3.5 B5:.5 -:3.5 E6:.5 -:3.5 D6:.5 -:3.5 C6:.5 -:3.5 F6:.5 -:3.5';
    const introBell = introC.flatMap(([sym]) => arp(sym, [0, 1, 2, 3, 2, 1], 0.5, 4).concat([[null, 1]]));

    const drumsA = {
      kick: lane('kick', rep('X.....x...x.....', 8)),
      snare: lane('snare', rep('....X.......X..g', 8)),
      clap: lane('clap', rep('....o.......o...', 8)),
      hat: lane('hat', rep('x.o.x.o.x.o.x.og', 8))
    };
    const drumsB = {
      kick: lane('kick', rep('X.....x...x...x.', 8)),
      snare: drumsA.snare, clap: drumsA.clap, hat: drumsA.hat
    };

    return buildSong(
      { title: 'Bambu Ormanı', artist: 'Panda Lo-Fi', bpm: 76, swing: 0.5, humanize: 1, reverb: 1, delay: 1 },
      [
        { id: 'pad1', instrument: 'pad', gain: 0.62, pan: -0.25, attack: 0.5, release: 1.1 },
        { id: 'pad2', instrument: 'pad', gain: 0.62, pan: 0.25, attack: 0.5, release: 1.1 },
        { id: 'pad3', instrument: 'pad', gain: 0.62, pan: -0.1, attack: 0.5, release: 1.1 },
        { id: 'pad4', instrument: 'pad', gain: 0.62, pan: 0.1, attack: 0.5, release: 1.1 },
        { id: 'bass', instrument: 'bass', gain: 0.95 },
        { id: 'melody', instrument: 'pluck', gain: 1, pan: 0.05, delay: 0.3 },
        { id: 'bell', instrument: 'bell', gain: 0.6, pan: 0.2, reverb: 0.5, delay: 0.35 },
        { id: 'kick', instrument: 'drums', gain: 0.85 },
        { id: 'snare', instrument: 'drums', gain: 0.75 },
        { id: 'clap', instrument: 'drums', gain: 1, pan: 0.1 },
        { id: 'hat', instrument: 'drums', gain: 0.9, pan: 0.18 }
      ],
      [
        { beats: 16, t: Object.assign(padFor(introC), { bass: bassFor(introC), bell: introBell, hat: lane('hat', rep('o.g.o.g.o.g.o.g.', 4)) }) },
        { beats: 32, t: Object.assign(padFor(aC), { bass: bassFor(aC), melody: melA }, drumsA) },
        { beats: 32, t: Object.assign(padFor(bC), { bass: bassFor(bC), melody: melB }, drumsB) },
        { beats: 32, t: Object.assign(padFor(aC), { bass: bassFor(aC), melody: melA, bell: bellA }, drumsA) },
        { beats: 16, t: Object.assign(padFor(introC), { bass: full(introC, (s) => seq(`${rootAt(s, 2)}:4`)), melody: melOut, hat: lane('hat', 'o.g.o.g.o.g.o.g.o.g.o.g.o.g.o.g.' + rep('................', 2)) }) }
      ]
    );
  }

  /** "Sabah Esintisi" — original upbeat synth-pop (D major, 118 bpm). */
  function songSabah() {
    const pv = padVoicer({ voices: 4, low: 52, high: 76 });
    const padFor = (list) => {
      const v = [[], [], [], []];
      list.forEach(([sym, b]) => pv(sym).forEach((n, i) => v[i].push([n, b])));
      return { pad1: v[0], pad2: v[1], pad3: v[2], pad4: v[3] };
    };
    const bass8 = (list) => list.flatMap(([s]) => seq(`${rootAt(s, 2)}:.5 ${rootAt(s, 2)}:.5 ${rootAt(s, 3)}:.5 ${rootAt(s, 2)}:.5 ${rootAt(s, 2)}:.5 ${rootAt(s, 2)}:.5 ${rootAt(s, 3)}:.5 ${rootAt(s, 2)}:.5`));
    const bassWhole = (list) => list.flatMap(([s]) => seq(`${rootAt(s, 2)}:3.5 -:.5`));
    const arpOct = (s) => (parseChord(s).root >= 7 ? 3 : 4);
    const arp8 = (list) => list.flatMap(([s]) => arp(s, [0, 1, 2, 3, 2, 1, 2, 1], 0.5, arpOct(s)));
    const arp16 = (list) => list.flatMap(([s]) => arp(s, [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 2, 1], 0.25, arpOct(s)));
    const bars = (syms) => syms.map((s) => [s, 4]);

    const introC = bars(['D', 'A', 'Bm', 'G']);
    const verseC = bars(['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A']);
    const chorusC = bars(['G', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'D']);
    const outroC = bars(['D', 'A', 'G', 'D']);

    const verse = [
      'A4:.5 D5:.5 F#5:1 E5:.5 D5:.5 A4:1', 'E5:1 C#5:.5 E5:.5 A5:1 -:1', 'D5:.5 F#5:.5 B5:1 A5:.5 F#5:.5 D5:1', 'B4:1 D5:1 G5:1 -:1',
      'A4:.5 D5:.5 F#5:1 A5:.5 F#5:.5 E5:1', 'E5:1 C#5:.5 E5:.5 A5:1.5 -:.5', 'D5:.5 G5:.5 B5:1 A5:.5 G5:.5 F#5:1', 'E5:1 A5:1 G5:.5 F#5:.5 E5:1'
    ].join(' ');
    const chorus = [
      'D5:1 G5:1 B5:1 A5:1', 'A5:1.5 E5:.5 C#5:1 E5:1', 'C#5:1 F#5:1 A5:1 F#5:1', 'B5:1.5 A5:.5 F#5:1 D5:1',
      'D5:1 G5:1 B5:1.5 A5:.5', 'A5:1.5 G5:.5 E5:1 C#5:1', 'F#5:1 A5:1 F#5:.5 E5:.5 D5:1', 'D5:3 -:1'
    ].join(' ');

    const verseDrums = {
      kick: lane('kick', rep('X.......X.x.....', 8)),
      snare: lane('snare', rep('....X.......X...', 8)),
      clap: lane('clap', rep('....x.......x...', 8)),
      hat: lane('hat', rep('o.X.o.X.o.X.o.X.', 8))
    };
    const chorusDrums = {
      kick: lane('kick', rep('X...X...X...X...', 8)),
      snare: lane('snare', rep('....x.......x...', 8)),
      clap: lane('clap', rep('....X.......X...', 8)),
      hat: lane('hat', rep('o.X.o.X.o.X.o.Xo', 8))
    };
    const roll = 'ggggooooxxxxXXXX';

    return buildSong(
      { title: 'Sabah Esintisi', artist: 'Panda Pop', bpm: 118, swing: 0, humanize: 0.5, reverb: 0.9, delay: 1 },
      [
        { id: 'pad1', instrument: 'pad', gain: 0.5, pan: -0.3, attack: 0.08, release: 0.5 },
        { id: 'pad2', instrument: 'pad', gain: 0.5, pan: 0.3, attack: 0.08, release: 0.5 },
        { id: 'pad3', instrument: 'pad', gain: 0.5, pan: -0.12, attack: 0.08, release: 0.5 },
        { id: 'pad4', instrument: 'pad', gain: 0.5, pan: 0.12, attack: 0.08, release: 0.5 },
        { id: 'bass', instrument: 'bass', gain: 0.85 },
        { id: 'lead', instrument: 'lead', gain: 0.8, pan: 0.05, delay: 0.3 },
        { id: 'arp', instrument: 'pluck', gain: 0.5, pan: -0.35, delay: 0.5 },
        { id: 'sparkle', instrument: 'bell', gain: 0.45, pan: 0.35, reverb: 0.5, delay: 0.4 },
        { id: 'kick', instrument: 'drums', gain: 0.95 },
        { id: 'snare', instrument: 'drums', gain: 0.6 },
        { id: 'clap', instrument: 'drums', gain: 0.5, pan: 0.1 },
        { id: 'hat', instrument: 'drums', gain: 0.42, pan: 0.2 }
      ],
      [
        { beats: 16, t: Object.assign(padFor(introC), { bass: bassWhole(introC), arp: arp8(introC), hat: lane('hat', rep('................', 2) + rep('o.o.o.o.o.o.o.o.', 1) + 'o.o.o.o.o.o.o.o.'), snare: lane('snare', rep('................', 3) + roll) }) },
        { beats: 32, t: Object.assign(padFor(verseC), { bass: bass8(verseC), arp: arp8(verseC), lead: verse }, verseDrums) },
        { beats: 32, t: Object.assign(padFor(chorusC), { bass: bass8(chorusC), arp: arp16(chorusC), lead: chorus, sparkle: shift(seq(chorus), 12) }, chorusDrums) },
        { beats: 32, t: Object.assign(padFor(verseC), { bass: bass8(verseC), arp: arp8(verseC), lead: verse, sparkle: shift(seq(verse), 12) }, verseDrums) },
        { beats: 32, t: Object.assign(padFor(chorusC), { bass: bass8(chorusC), arp: arp16(chorusC), lead: chorus, sparkle: shift(seq(chorus), 12) }, chorusDrums) },
        { beats: 16, t: Object.assign(padFor(outroC), { bass: bassWhole(outroC), arp: arp8(outroC), lead: 'A5:2 F#5:2 E5:2 C#5:2 B4:2 G4:2 F#4:4', hat: lane('hat', rep('o.o.o.o.o.o.o.o.', 2) + rep('................', 2)), kick: lane('kick', rep('X...X...X...X...', 2) + rep('................', 2)) }) }
      ]
    );
  }

  /** "Gece Yürüyüşü" — original ambient (A minor, 64 bpm, no hurry). */
  function songGece() {
    const pv = padVoicer({ voices: 4, low: 46, high: 71 });
    const padFor = (list) => {
      const v = [[], [], [], []];
      list.forEach(([sym, b]) => pv(sym).forEach((n, i) => v[i].push([n, b])));
      return { pad1: v[0], pad2: v[1], pad3: v[2], pad4: v[3] };
    };
    const bassFor = (list) => list.flatMap(([s, b]) => seq(`${rootAt(s, 2)}:${b - 0.5} -:.5`));
    const arpFor = (list) => list.flatMap(([s, b]) => {
      const pat = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 4, 3, 2, 1].slice(0, b * 2);
      return arp(s, pat, 0.5, 3);
    });

    const s1 = [['Am9', 8], ['Fmaj7', 8], ['Cmaj7', 8], ['G6', 8]];
    const s2 = [['Dm9', 8], ['Am9', 8], ['Fmaj7', 8], ['Esus4', 4], ['E7', 4]];
    const s3 = [['Fmaj7', 8], ['Cmaj7', 8], ['G6', 8], ['Am9', 8]];

    const bell1 = [
      'E5:1.5 -:.5 C5:1 -:1 B4:1.5 -:.5 A4:2', 'C5:2 -:1 A4:1.5 -:.5 E5:1 -:1 F5:1',
      'G4:1.5 -:.5 E5:2 -:1 D5:1.5 -:.5 B4:1', 'D5:1 -:1 B4:1.5 -:.5 E5:2 -:1 G4:1'
    ].join(' ');
    const bell2 = [
      'A4:1.5 -:.5 F5:2 -:1 E5:1.5 -:.5 D5:1', 'E5:2 -:.5 C5:1 B4:1.5 -:1 A4:2',
      'C5:1.5 -:.5 F5:1.5 -:.5 E5:2 -:1 A4:1', 'B4:1.5 -:.5 A4:2 G#4:1 -:1 B4:2'
    ].join(' ');
    const bell3 = [
      'A4:2 -:1 C5:1.5 -:.5 E5:1.5 -:1.5', 'E5:1.5 -:.5 G5:1 -:1 D5:2 -:2',
      'B4:2 -:1 D5:1.5 -:.5 E5:2 -:1', 'C5:2 -:1 A4:3 -:2'
    ].join(' ');

    return buildSong(
      { title: 'Gece Yürüyüşü', artist: 'Panda Ambient', bpm: 64, swing: 0, humanize: 1, reverb: 1.4, delay: 1.1 },
      [
        { id: 'pad1', instrument: 'pad', gain: 0.62, pan: -0.45, attack: 1.4, release: 2.4, cutoff: 1100 },
        { id: 'pad2', instrument: 'pad', gain: 0.62, pan: 0.45, attack: 1.4, release: 2.4, cutoff: 1100 },
        { id: 'pad3', instrument: 'pad', gain: 0.62, pan: -0.2, attack: 1.4, release: 2.4, cutoff: 1100 },
        { id: 'pad4', instrument: 'pad', gain: 0.62, pan: 0.2, attack: 1.4, release: 2.4, cutoff: 1100 },
        { id: 'bass', instrument: 'bass', gain: 0.7 },
        { id: 'bell', instrument: 'bell', gain: 1.2, pan: 0.15, reverb: 1.2, delay: 0.8 },
        { id: 'arp', instrument: 'pluck', gain: 0.38, pan: -0.4, reverb: 0.9, delay: 0.9 },
        { id: 'step', instrument: 'drums', gain: 0.6 },
        { id: 'tick', instrument: 'drums', gain: 1, pan: 0.3 }
      ],
      [
        { beats: 32, t: Object.assign(padFor(s1), { bass: bassFor(s1), bell: bell1 }) },
        { beats: 32, t: Object.assign(padFor(s2), { bass: bassFor(s2), bell: bell2, arp: arpFor(s2), step: lane('kick', rep('X.......x.......', 8)), tick: lane('hat', rep('....o.......o...', 8)) }) },
        { beats: 32, t: Object.assign(padFor(s3), { bass: bassFor(s3), bell: bell3, arp: arpFor(s3), step: lane('kick', rep('X.......x.......', 6) + rep('X...............', 1) + rep('................', 1)), tick: lane('hat', rep('....o.......o...', 6) + rep('................', 2)) }) }
      ]
    );
  }

  /** "Üsküdar'a Gider İken" (Kâtibim) — traditional Turkish folk song, G minor, 2/4. Melody after the public-domain tune. */
  function songUskudar() {
    const intro3 = 'D5:.25 Eb5:.25 D5:.25 C5:.25 Bb4:.25 A4:.25 Bb4:.25 C5:.25';
    const fall = 'D5:.25 Eb5:.25 D5:.25 C5:.25 Bb4:.25 A4:.25 G4:.5';
    const bA = 'D4:.25 G4:.5 A4:.25 Bb4:.5 C5:.5';
    const alt1 = 'A4:.25 C5:.25 Bb4:.25 A4:.25 A4:.25 G4:.25 F#4:.25 G4:.25 A4:.25 Bb4:.25 A4:.25 G4:.25 F4:.25 Eb4:.25 D4:.5';
    const alt2 = 'A4:.25 C5:.25 Bb4:.25 A4:.25 A4:.25 G4:.25 G4:.25 F#4:.25 G4:.75 G4:.25 G4:.5 G4:.5';
    const sA = 'G4:.75 D5:.25 D5:.5 D5:.5';
    const sB = 'Eb5:.25 D5:.25 Eb5:.25 F#5:.25 D5:.5 D5:.5';
    const cc = 'C5:.5 C5:.5 Bb4:.5 C5:.5';
    const lead = 'D5:.5 -:.5 D5:.5 D5:.5';
    const refrain = [
      'G4:.75 A4:.25 Bb4:.5 C5:.5', fall, 'A4:.25 C5:.25 Bb4:.25 A4:.25 A4:.25 G4:.25 F#4:.25 G4:.25', 'A4:2',
      'G4:.75 A4:.25 Bb4:.5 C5:.5', fall, 'A4:.25 C5:.25 Bb4:.25 A4:.25 A4:.25 G4:.25 F#4:.25 G4:.25', 'G4:2'
    ].join(' ');

    const intro = rep(intro3, 3) + ' ' + fall;                          // 4 bars
    const themeB = [bA, fall, alt1, bA, fall, alt2].join(' ');            // 8 bars (volta x2)
    const sung1 = [sA, sB, cc, fall, sA, sB, cc, lead].join(' ');         // 8 bars
    const sung2 = [sA, sB, cc, lead, sA, sB, cc, fall].join(' ');         // 8 bars
    const coda = 'Bb4:1 A4:1 G4:2';                                       // 2 bars
    const saz = [intro, themeB, sung1, refrain, sung2, refrain, coda].join(' ');
    const ney = ['-:24', sung1, refrain, sung2, refrain, coda].join(' ');

    // one chord per bar; a bar with two entries changes chord on the beat. 46 bars.
    const barChords = [
      ['Gm'], ['Gm'], ['Gm'], ['D'],
      ['Gm'], ['Gm'], ['D'], ['Cm', 'D'], ['Gm'], ['Gm'], ['D'], ['Gm'],
      ['Gm'], ['Gm', 'D'], ['Cm'], ['Gm'], ['Gm'], ['Gm', 'D'], ['Cm'], ['D'],
      ['Gm'], ['Gm'], ['D'], ['D'], ['Gm'], ['Gm'], ['D'], ['Gm'],
      ['Gm'], ['Gm', 'D'], ['Cm'], ['D'], ['Gm'], ['Gm', 'D'], ['Cm'], ['Gm'],
      ['Gm'], ['Gm'], ['D'], ['D'], ['Gm'], ['Gm'], ['D'], ['Gm'],
      ['Gm'], ['Gm']
    ];
    const total = barChords.length;
    const pv = padVoicer({ voices: 3, low: 50, high: 67 });
    const pad = [[], [], []];
    const bass = [];
    barChords.forEach((c) => {
      const each = 2 / c.length;
      c.forEach((sym) => {
        pv(sym).forEach((n, i) => pad[i].push([n, each]));
        bass.push([rootAt(sym, 2), each * 0.5], [null, each * 0.25], [rootAt(sym, 2), each * 0.25]);
      });
    });
    // frame drum only while the song is in full swing: bars 5..44
    const drums = (pat) => rep('........', 4) + rep(pat, total - 6) + rep('........', 2);

    return buildSong(
      { title: "Üsküdar'a Gider İken", artist: 'Geleneksel (Türkü)', bpm: 84, swing: 0, humanize: 0.6, reverb: 0.9, delay: 0.5 },
      [
        { id: 'pad1', instrument: 'pad', gain: 0.55, pan: -0.3, attack: 0.25, release: 0.6, cutoff: 1500 },
        { id: 'pad2', instrument: 'pad', gain: 0.55, pan: 0.3, attack: 0.25, release: 0.6, cutoff: 1500 },
        { id: 'pad3', instrument: 'pad', gain: 0.55, attack: 0.25, release: 0.6, cutoff: 1500 },
        { id: 'bass', instrument: 'bass', gain: 1 },
        { id: 'saz', instrument: 'pluck', gain: 1, pan: 0.05, reverb: 0.7, delay: 0.25 },
        { id: 'ney', instrument: 'lead', gain: 0.34, pan: -0.15, reverb: 1, delay: 0.3 },
        { id: 'kick', instrument: 'drums', gain: 0.8 },
        { id: 'snare', instrument: 'drums', gain: 0.75 },
        { id: 'hat', instrument: 'drums', gain: 0.85, pan: 0.2 }
      ],
      [{
        beats: total * 2,
        t: {
          pad1: pad[0], pad2: pad[1], pad3: pad[2], bass, saz, ney,
          kick: lane('kick', drums('X.....x.')),
          snare: lane('snare', drums('....o...')),
          hat: lane('hat', drums('o.o.o.o.'))
        }
      }]
    );
  }

  /** "Für Elise" — L. v. Beethoven, Bagatelle in A minor (WoO 59): the A theme, the F/C episode and the return. 3/8. */
  function songElise() {
    const U = 0.25; // durations below are counted in sixteenths
    const BARS = {
      pick: ['E5 D#5', '- -', 'Am'],
      m1: ['E5 D#5 E5 B4 D5 C5', '- - - - - -', 'Am'],
      m2: ['A4:2 - C4 E4 A4', 'A2 E3 A3 - - -', 'Am'],
      m3: ['B4:2 - E4 G#4 B4', 'E2 E3 G#3 - - -', 'E'],
      m4: ['C5:2 - E4 E5 D#5', 'A2 E3 A3 - - -', 'Am'],
      m7: ['B4:2 - E4 C5 B4', 'E2 E3 G#3 - - -', 'E'],
      e1: ['A4:4', 'A2 E3 A3 -', 'Am'],
      e2: ['A4:2 - B4 C5 D5', 'A2 E3 A3 - - -', 'Am'],
      b9: ['E5:3 G4 F5 E5', 'C3 E3 G3 - - -', 'C'],
      b10: ['D5:3 F4 E5 D5', 'G2 B2 D3 - - -', 'G7'],
      b11: ['C5:3 E4 D5 C5', 'C3 E3 G3 - - -', 'C'],
      b12: ['B4:2 - E4 E5 -', 'E2 E3 G#3 - - -', 'E'],
      b13: ['- E5 E6 - - D#5', 'E2 B2 E3 - - -', 'E'],
      b14: ['E5:2 - D#5 E5 D#5', 'A2 E3 A3 - - -', 'Am'],
      fin: ['A4:12', 'A2:12', 'Am']
    };
    const pv = padVoicer({ voices: 3, low: 52, high: 69 });
    const section = (keys) => {
      const rh = [];
      const lh = [];
      const pad = [[], [], []];
      keys.forEach((k) => {
        const [r, l, chord] = BARS[k];
        const rn = seq(r, U);
        const ln = seq(l, U);
        rh.push(...rn);
        lh.push(...ln);
        const beats = sumBeats(rn);
        pv(chord).forEach((n, i) => pad[i].push([n, beats]));
      });
      return { beats: sumBeats(rh), t: { rh, lh, pad1: pad[0], pad2: pad[1], pad3: pad[2] } };
    };
    const A = ['m1', 'm2', 'm3', 'm4', 'm1', 'm2', 'm7'];
    const B = ['b9', 'b10', 'b11', 'b12', 'b13', 'b14'];
    return buildSong(
      { title: 'Für Elise', artist: 'L. v. Beethoven', bpm: 72, swing: 0, humanize: 0.5, reverb: 0.8, delay: 0.3 },
      [
        { id: 'rh', instrument: 'bell', gain: 0.95, pan: 0.08, ratio: 4, decay: 1.1, reverb: 0.7, delay: 0.2 },
        { id: 'lh', instrument: 'pluck', gain: 0.95, pan: -0.12, reverb: 0.5, delay: 0.1 },
        { id: 'pad1', instrument: 'pad', gain: 0.45, pan: -0.3, attack: 0.15, release: 0.5, cutoff: 1300 },
        { id: 'pad2', instrument: 'pad', gain: 0.45, pan: 0.3, attack: 0.15, release: 0.5, cutoff: 1300 },
        { id: 'pad3', instrument: 'pad', gain: 0.45, attack: 0.15, release: 0.5, cutoff: 1300 }
      ],
      [
        section(['pick'].concat(A, ['e1'])),
        section(['pick'].concat(A, ['e2'])),
        section(B),
        section(A.concat(['e2'])),
        section(B),
        section(A.concat(['m2', 'fin']))
      ]
    );
  }

  /** "Kanon" — Pachelbel's D major ground (D A Bm F#m G D G A) with the canon voices, three variations and a melody. */
  function songKanon() {
    const ground = ['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A'];
    const groundBass = 'D3:2 A2:2 B2:2 F#2:2 G2:2 D2:2 G2:2 A2:2';
    const theme = 'F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2';
    const var1 = 'F#5:1 D5:1 E5:1 C#5:1 D5:1 B4:1 C#5:1 A4:1 B4:1 G4:1 A4:1 F#4:1 B4:1 D5:1 C#5:1 E5:1';
    const var2 = 'd=.5 ' + [
      'F#5 A5 F#5 D5', 'E5 C#5 A4 C#5', 'D5 F#5 D5 B4', 'C#5 A4 F#4 A4',
      'B4 D5 B4 G4', 'A4 D5 A4 F#4', 'B4 G4 B4 D5', 'C#5 E5 G5 E5'
    ].join(' ');
    const mel = 'A5:1 F#5:.5 D5:.5 E5:1.5 C#5:.5 D5:1 F#5:1 A5:1.5 C#6:.5 B5:1 G5:.5 B5:.5 A5:1.5 F#5:.5 B5:1 D6:1 C#6:1 A5:.5 E5:.5';
    const high = shift(seq(theme), 12);
    const pv = padVoicer({ voices: 4, low: 50, high: 72 });
    const padCycle = () => {
      const v = [[], [], [], []];
      ground.forEach((sym) => pv(sym).forEach((n, i) => v[i].push([n, 2])));
      return v;
    };
    const arpOct = (s) => (parseChord(s).root >= 7 ? 3 : 4);
    const arpCycle = ground.flatMap((s) => arp(s, [0, 1, 2, 1], 0.5, arpOct(s)));
    const cycle = (t) => {
      const pads = padCycle();
      return { beats: 16, t: Object.assign({ bass: groundBass, pad1: pads[0], pad2: pads[1], pad3: pads[2], pad4: pads[3] }, t) };
    };
    const finalPad = pv('D');
    return buildSong(
      { title: 'Kanon', artist: 'J. Pachelbel', bpm: 66, swing: 0, humanize: 0.4, reverb: 1.1, delay: 0.5 },
      [
        { id: 'bass', instrument: 'bass', gain: 0.85 },
        { id: 'pad1', instrument: 'pad', gain: 0.48, pan: -0.35, attack: 0.3, release: 0.7, cutoff: 1500 },
        { id: 'pad2', instrument: 'pad', gain: 0.48, pan: 0.35, attack: 0.3, release: 0.7, cutoff: 1500 },
        { id: 'pad3', instrument: 'pad', gain: 0.48, pan: -0.15, attack: 0.3, release: 0.7, cutoff: 1500 },
        { id: 'pad4', instrument: 'pad', gain: 0.48, pan: 0.15, attack: 0.3, release: 0.7, cutoff: 1500 },
        { id: 'v1', instrument: 'lead', gain: 0.7, pan: -0.25, attack: 0.07, release: 0.3, cutoff: 3600, reverb: 1.1, delay: 0.25 },
        { id: 'v2', instrument: 'lead', gain: 0.55, pan: 0.3, attack: 0.07, release: 0.3, cutoff: 3200, reverb: 1.1, delay: 0.25 },
        { id: 'v3', instrument: 'bell', gain: 0.5, pan: 0.05, ratio: 3, decay: 1.6, reverb: 1.1, delay: 0.4 },
        { id: 'arp', instrument: 'pluck', gain: 0.5, pan: -0.1, reverb: 0.8, delay: 0.4 }
      ],
      [
        cycle({}),
        cycle({ v1: theme }),
        cycle({ v1: var1, v2: theme }),
        cycle({ v1: var2, v2: var1, v3: high, arp: arpCycle }),
        cycle({ v1: mel, v2: var2, v3: high, arp: arpCycle }),
        cycle({ v1: mel, v2: var2, v3: high, arp: arpCycle }),
        {
          beats: 4,
          t: {
            bass: 'D2:4',
            pad1: [[finalPad[0], 4]], pad2: [[finalPad[1], 4]], pad3: [[finalPad[2], 4]], pad4: [[finalPad[3], 4]],
            v1: 'D5:4', v2: 'F#4:4', v3: 'A5:4', arp: 'D4:.5 F#4:.5 A4:.5 D5:.5 -:2'
          }
        }
      ]
    );
  }

  // ================================================================================================
  // 3. .pmus parsing / validation / compilation
  // ================================================================================================
  class PmusError extends Error {}

  const num = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

  /**
   * Validates a parsed (or raw JSON text) .pmus song and returns a normalized copy.
   * Throws PmusError with a Turkish message when the file is unusable.
   */
  function parsePmus(input, fallbackTitle) {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { throw new PmusError('Dosya geçerli bir şarkı dosyası değil: içerik JSON olarak okunamadı.'); }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PmusError('Dosya geçerli bir şarkı dosyası değil: beklenen biçim bir nesne.');
    const bpm = data.bpm == null ? 120 : data.bpm;
    if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
      throw new PmusError(`Geçersiz tempo (bpm: ${String(data.bpm).slice(0, 20)}). Tempo 20 ile 300 arasında olmalı.`);
    }
    if (!Array.isArray(data.tracks) || !data.tracks.length) throw new PmusError('Şarkıda hiç parça (tracks) yok.');
    if (data.tracks.length > 32) throw new PmusError('Bir şarkıda en fazla 32 parça olabilir.');
    let count = 0;
    let total = 0;
    const tracks = data.tracks.map((tr, ti) => {
      const where = `Parça ${ti + 1}`;
      if (!tr || typeof tr !== 'object') throw new PmusError(`${where}: geçersiz parça.`);
      if (!INSTRUMENTS.includes(tr.instrument)) {
        throw new PmusError(`${where}: bilinmeyen enstrüman "${String(tr.instrument).slice(0, 24)}". Kullanılabilir: ${INSTRUMENTS.join(', ')}.`);
      }
      if (!Array.isArray(tr.notes)) throw new PmusError(`${where}: nota listesi (notes) yok.`);
      let beats = 0;
      const drums = tr.instrument === 'drums';
      const notes = tr.notes.map((n, ni) => {
        const at = `${where}, nota ${ni + 1}`;
        if (!Array.isArray(n) || n.length < 2) throw new PmusError(`${at}: nota [ad, süre] biçiminde olmalı.`);
        const dur = n[1];
        if (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0 || dur > 256) throw new PmusError(`${at}: geçersiz süre (${String(dur).slice(0, 12)}).`);
        let name = n[0];
        if (name != null) {
          if (typeof name !== 'string') throw new PmusError(`${at}: geçersiz nota adı.`);
          if (drums) {
            if (!DRUM_NAMES.includes(name)) throw new PmusError(`${at}: "${name.slice(0, 12)}" geçerli bir davul sesi değil (kick, snare, hat, clap).`);
          } else {
            const m = NOTE_RE.exec(name.trim());
            if (!m || Number.isNaN(noteToMidi(name))) throw new PmusError(`${at}: "${name.slice(0, 12)}" geçerli bir nota adı değil (C0 – B8).`);
            name = m[1].toUpperCase() + m[2] + m[3];
          }
        }
        beats += dur;
        count++;
        if (count > 40000) throw new PmusError('Şarkı çok fazla nota içeriyor (en fazla 40.000).');
        const vel = n.length > 2 && typeof n[2] === 'number' ? Math.min(1, Math.max(0.05, n[2])) : null;
        return vel == null ? [name, dur] : [name, dur, vel];
      });
      total = Math.max(total, beats);
      const out = { instrument: tr.instrument, notes };
      const opt = { gain: [0, 2], pan: [-1, 1], reverb: [0, 2], delay: [0, 2], attack: [0.002, 4], release: [0.01, 6], cutoff: [200, 12000], ratio: [0.5, 12], decay: [0.1, 6] };
      for (const k of Object.keys(opt)) if (typeof tr[k] === 'number') out[k] = num(tr[k], opt[k][0], opt[k][1], undefined);
      return out;
    });
    if (total <= 0) throw new PmusError('Şarkı boş: hiç süre içermiyor.');
    if ((total * 60) / bpm > 3600) throw new PmusError('Şarkı çok uzun (en fazla 1 saat).');
    const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : d);
    return {
      title: str(data.title, fallbackTitle || 'Adsız şarkı'),
      artist: str(data.artist, 'Bilinmeyen sanatçı'),
      bpm,
      swing: num(data.swing, 0, 1, 0),
      humanize: num(data.humanize, 0, 2, 0),
      reverb: num(data.reverb, 0, 2, 1),
      delay: num(data.delay, 0, 2, 1),
      tracks
    };
  }

  /** Flattens a normalized song to a time-sorted event list for the scheduler. */
  function compileSong(song) {
    const events = [];
    let total = 0;
    song.tracks.forEach((tr, ti) => {
      let b = 0;
      tr.notes.forEach((n) => {
        if (n[0] != null) {
          events.push({ b, d: n[1], ti, n: n[0], midi: tr.instrument === 'drums' ? -1 : noteToMidi(n[0]), v: n.length > 2 ? n[2] : 0.8 });
        }
        b += n[1];
      });
      total = Math.max(total, b);
    });
    events.sort((x, y) => x.b - y.b || x.ti - y.ti);
    return { song, events, total, bpm: song.bpm, seconds: (total * 60) / song.bpm, spb: 60 / song.bpm };
  }

  const LIBRARY = [songBambu(), songSabah(), songGece(), songUskudar(), songElise(), songKanon()]
    .map((s) => parsePmus(s));

  // ================================================================================================
  // 4. Synth engine (Web Audio): instruments, FX bus, lookahead scheduler
  // ================================================================================================
  const LOOKAHEAD = 0.12;   // seconds of audio scheduled ahead of the clock
  const TICK_MS = 25;       // scheduler interval
  const TAIL = 1.3;         // seconds of ring-out after the last note

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash01 = (i) => (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const noiseCache = new WeakMap();
  function noiseBuffer(c) {
    let b = noiseCache.get(c);
    if (b) return b;
    const len = Math.floor(c.sampleRate * 2);
    b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    const rnd = mulberry32(0x9e3779b9);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
    noiseCache.set(c, b);
    return b;
  }

  const irCache = new WeakMap();
  /** Generated impulse response: stereo noise with an exponential decay whose highs die first. */
  function reverbIR(c, seconds = 2.4) {
    let b = irCache.get(c);
    if (b) return b;
    const len = Math.floor(c.sampleRate * seconds);
    b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      const rnd = mulberry32(4242 + ch * 97);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const x = (rnd() * 2 - 1) * Math.pow(1 - t, 2.7);
        lp += (x - lp) * (1 - (0.12 + 0.72 * t));
        d[i] = lp * 1.7 * Math.min(1, i / 96);
      }
    }
    irCache.set(c, b);
    return b;
  }

  /** Attack / decay / sustain gate on an AudioParam, then an exponential release. Returns the time the voice is silent. */
  function adsr(param, t, dur, peak, a, d, s, r) {
    const hold = t + Math.max(dur, a + 0.01);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (s < 1 && d > 0) param.exponentialRampToValueAtTime(Math.max(peak * s, 0.0002), Math.min(t + a + d, hold));
    param.setTargetAtTime(0.0001, hold, Math.max(0.005, r / 4.5));
    return hold + r;
  }

  function mkOsc(c, S, type, freq, t0, t1, detune) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    o.start(t0);
    o.stop(t1);
    S.track(o);
    return o;
  }

  function mkFilter(c, type, freq, q) {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }

  function mkNoise(c, S, t0, t1) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.start(t0, S.rand() * 1.5);
    src.stop(t1);
    S.track(src);
    return src;
  }

  /** Instrument voices. Signature: (ctx, out, when, seconds, freq|drumName, velocity 0..1, trackOptions, session). */
  const INSTR = {
    // saw + square through a lowpass with a small filter sweep, ADSR, and delayed vibrato on long notes
    lead(c, out, t, dur, f, v, o, S) {
      const a = o.attack != null ? o.attack : 0.012;
      const r = o.release != null ? o.release : 0.14;
      const cut = o.cutoff != null ? o.cutoff : clamp(f * 6, 1800, 9000);
      const lp = mkFilter(c, 'lowpass', Math.min(cut * 1.7, 14000), 1.1);
      lp.frequency.setValueAtTime(Math.min(cut * 1.7, 14000), t);
      lp.frequency.exponentialRampToValueAtTime(cut, t + 0.2);
      const g = c.createGain();
      const end = adsr(g.gain, t, dur, 0.15 * v, a, 0.16, 0.72, r);
      const o1 = mkOsc(c, S, 'sawtooth', f, t, end + 0.05, -7);
      const o2 = mkOsc(c, S, 'square', f, t, end + 0.05, 6);
      const m2 = c.createGain();
      m2.gain.value = 0.5;
      o1.connect(lp);
      o2.connect(m2);
      m2.connect(lp);
      lp.connect(g);
      g.connect(out);
      if (dur > 0.55) {
        const lfo = mkOsc(c, S, 'sine', 5.3, t, end + 0.05);
        const lg = c.createGain();
        lg.gain.setValueAtTime(0, t);
        lg.gain.linearRampToValueAtTime(9, t + Math.min(0.6, dur));
        lfo.connect(lg);
        lg.connect(o1.detune);
        lg.connect(o2.detune);
      }
    },

    // three detuned saws + a sine, slow attack, lowpass that opens while the chord blooms
    pad(c, out, t, dur, f, v, o, S) {
      const a = o.attack != null ? o.attack : 0.4;
      const r = o.release != null ? o.release : 0.9;
      const cut = o.cutoff != null ? o.cutoff : 1500;
      const lp = mkFilter(c, 'lowpass', cut, 0.45);
      lp.frequency.setValueAtTime(cut * 0.5, t);
      lp.frequency.exponentialRampToValueAtTime(cut, t + Math.max(0.5, a * 1.4));
      const g = c.createGain();
      const end = adsr(g.gain, t, dur, 0.062 * v, a, 0, 1, r);
      [-8, 8].forEach((det) => {
        const os = mkOsc(c, S, 'sawtooth', f, t, end + 0.05, det);
        os.connect(lp);
      });
      const sine = mkOsc(c, S, 'sine', f, t, end + 0.05);
      const sg = c.createGain();
      sg.gain.value = 0.7;
      sine.connect(sg);
      sg.connect(lp);
      lp.connect(g);
      g.connect(out);
    },

    // triangle + sine sub-octave, short decay to a sustain
    bass(c, out, t, dur, f, v, o, S) {
      const r = o.release != null ? o.release : 0.12;
      const lp = mkFilter(c, 'lowpass', 820, 0.8);
      const g = c.createGain();
      const end = adsr(g.gain, t, dur * 0.97, 0.28 * v, 0.008, 0.22, 0.68, r);
      const o1 = mkOsc(c, S, 'triangle', f, t, end + 0.05);
      o1.connect(lp);
      const o2 = mkOsc(c, S, 'sawtooth', f, t, end + 0.05, 3);   // upper harmonics keep the bass audible on small speakers
      const o2g = c.createGain();
      o2g.gain.value = 0.32;
      o2.connect(o2g);
      o2g.connect(lp);
      if (f / 2 > 30) {
        const sub = mkOsc(c, S, 'sine', f / 2, t, end + 0.05);
        const sg = c.createGain();
        sg.gain.value = 0.24;
        sub.connect(sg);
        sg.connect(lp);
      }
      lp.connect(g);
      g.connect(out);
    },

    // fast-decay filtered saw pair: the filter closes quickly, like a plucked string
    pluck(c, out, t, dur, f, v, o, S) {
      const len = clamp(0.5 + dur * 0.9, 0.5, 2.1);
      const lp = mkFilter(c, 'lowpass', Math.min(f * 9, 9000), 2.2);
      lp.frequency.setValueAtTime(clamp(f * 9, 900, 9000), t);
      lp.frequency.exponentialRampToValueAtTime(clamp(f * 1.7, 380, 4000), t + 0.28);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2 * v, t + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0002, t + len);
      const end = t + len + 0.05;
      const o1 = mkOsc(c, S, 'sawtooth', f, t, end, 4);
      const o2 = mkOsc(c, S, 'sawtooth', f, t, end, -4);
      const o3 = mkOsc(c, S, 'triangle', f / 2, t, end);
      const lo = c.createGain();
      lo.gain.value = 0.5;
      o1.connect(lp);
      o2.connect(lp);
      o3.connect(lo);
      lo.connect(lp);
      lp.connect(g);
      g.connect(out);
    },

    // two-operator FM: a sine carrier whose modulation index decays quickly, plus a bright partial
    bell(c, out, t, dur, f, v, o, S) {
      const ratio = o.ratio != null ? o.ratio : 3.5;
      const decay = o.decay != null ? o.decay : 1.5;
      const len = decay * clamp(700 / f, 0.55, 1.5);
      const end = t + len + 0.1;
      const car = mkOsc(c, S, 'sine', f, t, end);
      const mod = mkOsc(c, S, 'sine', f * ratio, t, end);
      const mg = c.createGain();
      mg.gain.setValueAtTime(f * 2.2, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(f * 0.04, 0.01), t + len * 0.42);
      mod.connect(mg);
      mg.connect(car.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.19 * v, t + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0002, t + len);
      car.connect(g);
      const hi = mkOsc(c, S, 'sine', f * 2, t, end);
      const hg = c.createGain();
      hg.gain.setValueAtTime(0.0001, t);
      hg.gain.linearRampToValueAtTime(0.05 * v, t + 0.002);
      hg.gain.exponentialRampToValueAtTime(0.0002, t + len * 0.45);
      hi.connect(hg);
      hg.connect(g);
      g.connect(out);
    },

    drums(c, out, t, dur, name, v, o, S) {
      if (name === 'kick') {
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.72 * v, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0002, t + 0.34);
        const os = mkOsc(c, S, 'sine', 150, t, t + 0.5);
        os.frequency.setValueAtTime(158, t);
        os.frequency.exponentialRampToValueAtTime(46, t + 0.12);
        os.connect(g);
        g.connect(out);
        const nz = mkNoise(c, S, t, t + 0.03);
        const hp = mkFilter(c, 'highpass', 1800, 0.7);
        const cg = c.createGain();
        cg.gain.setValueAtTime(0.1 * v, t);
        cg.gain.exponentialRampToValueAtTime(0.0002, t + 0.012);
        nz.connect(hp);
        hp.connect(cg);
        cg.connect(out);
      } else if (name === 'snare') {
        const nz = mkNoise(c, S, t, t + 0.3);
        const bp = mkFilter(c, 'bandpass', 1900, 0.6);
        const hp = mkFilter(c, 'highpass', 520, 0.7);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.85 * v, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0002, t + 0.17);
        nz.connect(bp);
        bp.connect(hp);
        hp.connect(g);
        g.connect(out);
        const tone = mkOsc(c, S, 'triangle', 190, t, t + 0.16);
        tone.frequency.setValueAtTime(235, t);
        tone.frequency.exponentialRampToValueAtTime(172, t + 0.05);
        const tg = c.createGain();
        tg.gain.setValueAtTime(0.0001, t);
        tg.gain.linearRampToValueAtTime(0.4 * v, t + 0.002);
        tg.gain.exponentialRampToValueAtTime(0.0002, t + 0.11);
        tone.connect(tg);
        tg.connect(out);
      } else if (name === 'hat') {
        const len = v > 0.9 ? 0.09 : 0.045;
        const nz = mkNoise(c, S, t, t + len + 0.03);
        const hp = mkFilter(c, 'highpass', 7200, 0.7);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.36 * v, t + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0002, t + len);
        nz.connect(hp);
        hp.connect(g);
        g.connect(out);
      } else if (name === 'clap') {
        const nz = mkNoise(c, S, t, t + 0.25);
        const bp = mkFilter(c, 'bandpass', 1450, 1);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        [0, 0.011, 0.023].forEach((k) => {
          g.gain.linearRampToValueAtTime(0.75 * v, t + k + 0.002);
          g.gain.linearRampToValueAtTime(0.2 * v, t + k + 0.009);
        });
        g.gain.linearRampToValueAtTime(0.75 * v, t + 0.027);
        g.gain.exponentialRampToValueAtTime(0.0002, t + 0.17);
        nz.connect(bp);
        bp.connect(g);
        g.connect(out);
      }
    }
  };

  // per-instrument defaults: level into the mix, reverb send, delay send
  const MIX = {
    lead: { level: 1, rv: 0.2, dl: 0.2 },
    pad: { level: 1, rv: 0.35, dl: 0 },
    bass: { level: 1, rv: 0, dl: 0 },
    pluck: { level: 1, rv: 0.25, dl: 0.2 },
    bell: { level: 1, rv: 0.45, dl: 0.25 },
    drums: { level: 1, rv: 0.08, dl: 0 }
  };

  /** Swing: delays the off-beat half of every beat by up to a triplet (swing 1). Monotonic, so event order is kept. */
  function warp(b, swing) {
    if (!swing) return b;
    const fl = Math.floor(b);
    const f = b - fl;
    const d = swing / 6;
    return fl + (f < 0.5 ? (f * (0.5 + d)) / 0.5 : 0.5 + d + ((f - 0.5) * (0.5 - d)) / 0.5);
  }

  function lowerBound(events, beat) {
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].b < beat) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** One playback run of one song: per-track buses + a tempo-synced delay. Killing it fades the dry signal out. */
  class Session {
    constructor(engine, cs) {
      const c = engine.ctx;
      this.c = c;
      this.engine = engine;
      this.cs = cs;
      this.voices = new Set();
      this.dead = false;
      engine.sessions.add(this);
      this.rand = mulberry32(0xc0ffee);
      this.nodes = [];
      const song = cs.song;
      this.mix = c.createGain();
      this.mix.connect(engine.trim);
      this.nodes.push(this.mix);
      // tempo-synced feedback delay (dotted eighth), darkened in the loop
      this.dlIn = c.createGain();
      const dl = c.createDelay(2);
      dl.delayTime.value = clamp(cs.spb * 0.75, 0.05, 1.9);
      const lp = mkFilter(c, 'lowpass', 2300, 0.5);
      const fb = c.createGain();
      fb.gain.value = 0.34;
      const dlOut = c.createGain();
      dlOut.gain.value = 0.6;
      this.dlIn.connect(dl);
      dl.connect(lp);
      lp.connect(fb);
      fb.connect(dl);
      lp.connect(dlOut);
      dlOut.connect(this.mix);
      this.nodes.push(this.dlIn, dl, lp, fb, dlOut);
      // one bus per track
      this.buses = song.tracks.map((tr) => {
        const mix = MIX[tr.instrument];
        const bus = c.createGain();
        bus.gain.value = (tr.gain != null ? tr.gain : 1) * mix.level;
        let dry = bus;
        if (tr.pan && c.createStereoPanner) {
          const pan = c.createStereoPanner();
          pan.pan.value = clamp(tr.pan, -1, 1);
          bus.connect(pan);
          dry = pan;
          this.nodes.push(pan);
        }
        dry.connect(this.mix);
        const rv = (tr.reverb != null ? tr.reverb : 1) * mix.rv * song.reverb;
        const dly = (tr.delay != null ? tr.delay : 1) * mix.dl * song.delay;
        if (rv > 0.005) {
          const s = c.createGain();
          s.gain.value = Math.min(1.4, rv);
          dry.connect(s);
          s.connect(engine.rvIn);
          this.nodes.push(s);
        }
        if (dly > 0.005) {
          const s = c.createGain();
          s.gain.value = Math.min(1.2, dly);
          dry.connect(s);
          s.connect(this.dlIn);
          this.nodes.push(s);
        }
        this.nodes.push(bus);
        return bus;
      });
    }

    track(node) {
      this.voices.add(node);
      node.onended = () => this.voices.delete(node);
    }

    /** Fades the dry signal out, then stops every voice and disconnects the graph. Reverb tails keep ringing. */
    kill(fade = 0.04) {
      if (this.dead) return;
      this.dead = true;
      const now = this.c.currentTime;
      this.buses.forEach((b) => {
        try {
          b.gain.cancelScheduledValues(now);
          b.gain.setTargetAtTime(0, now, Math.max(0.004, fade / 4));
        } catch (e) { /* ignore */ }
      });
      this.engine.later(() => this.destroy(), Math.round(fade * 1000) + 150);
    }

    destroy() {
      this.voices.forEach((n) => { try { n.stop(); } catch (e) { /* not started / ended */ } try { n.disconnect(); } catch (e) { /* ignore */ } });
      this.voices.clear();
      this.nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* ignore */ } });
      this.nodes = [];
      this.dead = true;
      this.engine.sessions.delete(this);
    }
  }

  /** Scheduler + signal chain. Works on any BaseAudioContext, including OfflineAudioContext (see renderSong). */
  class Engine {
    constructor(ctx, dest, opts = {}) {
      this.ctx = ctx;
      this.opts = opts;
      this.clockFn = opts.clock || null;
      this.onended = null;
      this.cs = null;
      this.session = null;
      this.running = false;
      this.startBeat = 0;
      this.t0 = 0;
      this.next = 0;
      this.endAt = 0;
      this.timer = 0;
      this.timers = new Set();
      this.sessions = new Set();
      this.disposed = false;
      this.stats = { scheduled: 0, dropped: 0, ticks: 0, errors: 0 };

      this.out = ctx.createGain();            // app volume
      this.out.gain.value = 0.64;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -20;
      this.comp.knee.value = 20;
      this.comp.ratio.value = 3;
      this.comp.attack.value = 0.008;
      this.comp.release.value = 0.25;
      this.trim = ctx.createGain();           // headroom ahead of the compressor
      this.trim.gain.value = 0.7;
      this.limiter = ctx.createDynamicsCompressor();   // safety net: catches the rare peak that gets through
      this.limiter.threshold.value = -4;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.09;
      this.trim.connect(this.comp);
      this.comp.connect(this.limiter);
      this.limiter.connect(this.out);
      this.out.connect(dest);
      // shared reverb (convolver with a generated impulse response)
      this.rvIn = ctx.createGain();
      this.conv = ctx.createConvolver();
      this.conv.buffer = reverbIR(ctx);
      this.rvOut = ctx.createGain();
      this.rvOut.gain.value = 0.8;
      this.rvIn.connect(this.conv);
      this.conv.connect(this.rvOut);
      this.rvOut.connect(this.trim);
      // visualiser tap (post-compressor, pre-volume so the bars do not shrink with the volume slider)
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.76;
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.limiter.connect(this.analyser);
      this.analyser.connect(this.sink);
      this.sink.connect(dest);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Uint8Array(this.analyser.fftSize);
    }

    now() { return this.clockFn ? this.clockFn() : this.ctx.currentTime; }

    later(fn, ms) {
      const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
      this.timers.add(id);
    }

    setVolume(v) {
      const g = clamp(v, 0, 1);
      try { this.out.gain.setTargetAtTime(g * g, this.ctx.currentTime, 0.03); } catch (e) { this.out.gain.value = g * g; }
    }

    load(cs) {
      this._halt(0.03);
      this.cs = cs;
      this.startBeat = 0;
    }

    beatNow() {
      if (!this.cs) return 0;
      if (!this.running) return this.startBeat;
      return clamp(this.startBeat + Math.max(0, this.now() - this.t0) / this.cs.spb, 0, this.cs.total);
    }

    play(beat) {
      const cs = this.cs;
      if (!cs || this.disposed) return;
      this._halt(0.03);
      const start = clamp(beat == null ? this.startBeat : beat, 0, cs.total);
      this.startBeat = start >= cs.total ? 0 : start;
      this.t0 = this.now() + 0.06;
      this.session = new Session(this, cs);
      this.next = lowerBound(cs.events, this.startBeat - 1e-9);
      this.running = true;
      this.endAt = this.t0 + (cs.total - this.startBeat) * cs.spb + TAIL;
      this._sustained();
      this._startTimer();
      this.tick();
    }

    /** Notes that began before the start position but are still held (pad chords) sound for their remainder. */
    _sustained() {
      const cs = this.cs;
      const sb = this.startBeat;
      for (let i = 0; i < this.next; i++) {
        const e = cs.events[i];
        const tr = cs.song.tracks[e.ti];
        if (tr.instrument === 'drums' || e.b + e.d <= sb + 0.05) continue;
        this._voice(e, this.t0, (e.b + e.d - sb) * cs.spb);
      }
    }

    pause() {
      const b = this.beatNow();
      this._halt(0.05);
      this.startBeat = b;
      return b;
    }

    stop() {
      this._halt(0.05);
      this.startBeat = 0;
    }

    seek(beat) {
      if (!this.cs) return;
      const b = clamp(beat, 0, this.cs.total);
      if (this.running) this.play(b);
      else this.startBeat = b;
    }

    _halt(fade) {
      this.running = false;
      if (this.timer) { clearInterval(this.timer); this.timer = 0; }
      if (this.session) { this.session.kill(fade); this.session = null; }
    }

    _startTimer() {
      if (this.timer || this.opts.offline) return;
      this.timer = setInterval(() => {
        try { this.tick(); } catch (e) { this.stats.errors++; console.error('[music] zamanlayıcı hatası', e); }
      }, TICK_MS);
    }

    _when(e) {
      const cs = this.cs;
      const sw = cs.song.swing;
      let w = this.t0 + (warp(e.b, sw) - warp(this.startBeat, sw)) * cs.spb;
      const h = cs.song.humanize;
      if (h) w += (hash01(this.next) - 0.5) * 0.011 * h;
      return w;
    }

    tick() {
      if (!this.running || !this.session) return;
      const cs = this.cs;
      const now = this.now();
      this.stats.ticks++;
      const horizon = now + LOOKAHEAD;
      const ev = cs.events;
      while (this.next < ev.length) {
        const e = ev[this.next];
        const when = this._when(e);
        if (when > horizon) break;
        this.next++;
        if (when < now - 0.4) { this.stats.dropped++; continue; }   // the page stalled: skip rather than burst
        this._voice(e, Math.max(when, now + 0.003));
        this.stats.scheduled++;
      }
      if (now >= this.endAt) this._finish();
    }

    _voice(e, when, secs) {
      try {
        const cs = this.cs;
        const S = this.session;
        if (!S || S.dead) return;
        const tr = cs.song.tracks[e.ti];
        const dur = secs != null ? secs : Math.max(0.03, e.d * cs.spb * (tr.instrument === 'pad' ? 1 : 0.97));
        const h = cs.song.humanize;
        const vel = clamp(e.v * (1 + (hash01(this.next + 7) - 0.5) * 0.14 * h), 0.05, 1);
        INSTR[tr.instrument](this.ctx, S.buses[e.ti], when, dur, e.midi < 0 ? e.n : midiToFreq(e.midi), vel, tr, S);
      } catch (err) {
        this.stats.errors++;
        console.error('[music] nota çalınamadı', err);
      }
    }

    _finish() {
      this.running = false;
      if (this.timer) { clearInterval(this.timer); this.timer = 0; }
      const S = this.session;
      this.session = null;
      if (S) this.later(() => S.destroy(), 400);
      this.startBeat = this.cs ? this.cs.total : 0;
      if (typeof this.onended === 'function') {
        try { this.onended(); } catch (e) { console.error('[music] bitiş işleyicisi', e); }
      }
    }

    /** Offline rendering helper: schedules the notes of [from, from + seconds) (held notes keep sounding from `from`). */
    scheduleAll(seconds, from = 0) {
      const cs = this.cs;
      this.session = new Session(this, cs);
      this.running = true;
      this.startBeat = 0;
      this.t0 = 0;
      for (this.next = 0; this.next < cs.events.length; this.next++) {
        const e = cs.events[this.next];
        const at = this._when(e);   // seconds since the start of the song
        if (at > from + seconds) break;
        if (at < from - 0.012) {
          const tr = cs.song.tracks[e.ti];
          const left = at + e.d * cs.spb - from;
          if (tr.instrument !== 'drums' && left > 0.05) this._voice(e, 0.05, left);
          continue;
        }
        this._voice(e, at - from + 0.05);
        this.stats.scheduled++;
      }
    }

    spectrum() { this.analyser.getByteFrequencyData(this.freq); return this.freq; }
    waveform() { this.analyser.getByteTimeDomainData(this.wave); return this.wave; }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.running = false;
      if (this.timer) { clearInterval(this.timer); this.timer = 0; }
      this.timers.forEach((id) => clearTimeout(id));
      this.timers.clear();
      this.sessions.forEach((s) => s.destroy());
      this.sessions.clear();
      this.session = null;
      [this.out, this.comp, this.limiter, this.trim, this.rvIn, this.conv, this.rvOut, this.analyser, this.sink].forEach((n) => {
        try { n.disconnect(); } catch (e) { /* ignore */ }
      });
    }
  }

  /** Renders `seconds` of a compiled song (starting at `from` seconds) with an OfflineAudioContext (tests / tooling). */
  function renderSong(cs, seconds, from = 0) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.resolve(null);
    const rate = 44100;
    const c = new OAC(2, Math.ceil(rate * seconds), rate);
    const eng = new Engine(c, c.destination, { offline: true });
    eng.out.gain.value = 1;
    eng.load(cs);
    const t0 = performance.now();
    eng.scheduleAll(seconds, from);
    const tSched = performance.now() - t0;
    return c.startRendering().then((buf) => { buf.__sched = tSched; return buf; });
  }

  // ================================================================================================
  // 5. Player: library entries, playback state machine, shuffle / repeat / next / prev
  // ================================================================================================
  class Player {
    constructor() {
      this.entries = [];          // library in queue order: { id, kind: 'builtin'|'file'|'bad', title, artist, song, cs, ... }
      this.cur = null;            // entry loaded into the engine
      this.state = 'stopped';     // 'stopped' | 'playing' | 'paused'
      this.volume = 0.8;
      this.muted = false;
      this.shuffle = false;
      this.repeat = 'off';        // 'off' | 'all' | 'one'
      this.engine = null;
      this.clockFn = null;
      this.played = new Set();    // shuffle: ids already heard in this cycle
      this.history = [];          // shuffle: ids to go back through with "previous"
      this.rand = Math.random;
      this.listeners = new Set();
      this.disposed = false;
    }

    on(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    emit(type, extra) {
      const ev = Object.assign({ type }, extra);
      this.listeners.forEach((fn) => {
        try { fn(ev); } catch (e) { console.error('[music] dinleyici hatası', e); }
      });
    }

    queue() { return this.entries.filter((e) => e.kind !== 'bad'); }

    _cs(entry) {
      if (!entry.cs) entry.cs = compileSong(entry.song);
      return entry.cs;
    }

    duration() { return this.cur ? this._cs(this.cur).seconds : 0; }

    position() {
      if (!this.cur || !this.engine) return 0;
      return this.engine.beatNow() * this._cs(this.cur).spb;
    }

    /** Override the audio clock (seconds). Tests use this because a headless AudioContext does not advance. */
    setClock(fn) {
      this.clockFn = typeof fn === 'function' ? fn : null;
      if (this.engine) this.engine.clockFn = this.clockFn;
    }

    ensureEngine() {
      if (this.engine) return this.engine;
      if (this.disposed) return null;
      let ctx = null;
      let dest = null;
      try {
        ctx = P.sound && P.sound.context && P.sound.context();
        dest = P.sound && P.sound.master && P.sound.master();
      } catch (e) { /* no audio */ }
      if (!ctx || !dest) return null;
      try {
        this.engine = new Engine(ctx, dest, { clock: this.clockFn });
      } catch (e) {
        console.error('[music] ses motoru kurulamadı', e);
        this.engine = null;
        return null;
      }
      this.engine.setVolume(this.muted ? 0 : this.volume);
      this.engine.onended = () => this._ended();
      if (this.cur) this.engine.load(this._cs(this.cur));
      return this.engine;
    }

    setEntries(list) {
      this.entries = list;
      if (this.cur && this.state === 'stopped') {
        const fresh = list.find((e) => e.id === this.cur.id && e.kind !== 'bad');
        if (fresh && fresh !== this.cur) this._load(fresh, true);
      }
    }

    _load(entry, quiet) {
      this.cur = entry;
      this.state = 'stopped';
      if (this.engine) this.engine.load(this._cs(entry));
      if (!quiet) this.emit('track', { entry });
    }

    /** Loads a song without playing it (the "now playing" panel shows it, position 0). */
    select(entry) {
      if (!entry || entry.kind === 'bad') return false;
      if (this.cur && this.cur.id === entry.id) return true;
      this._load(entry);
      this.emit('state');
      return true;
    }

    _resume() {
      try {
        const c = this.engine && this.engine.ctx;
        if (c && c.state === 'suspended' && typeof c.resume === 'function') {
          const p = c.resume();
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) { /* ignore */ }
    }

    play(entry, extra) {
      if (entry && entry.kind === 'bad') return false;
      if (!entry && this.state === 'playing') return true;
      const restart = !!entry && !!this.cur && entry.id === this.cur.id && this.state === 'playing';
      const isNew = !!entry && (!this.cur || entry.id !== this.cur.id);
      if (isNew) this._load(entry);
      if (!this.cur) {
        const q = this.queue();
        if (!q.length) return false;
        this._load(q[0]);
      }
      const eng = this.ensureEngine();
      if (!eng) {
        this.emit('error', { message: 'Bu tarayıcıda ses çalınamıyor (Web Audio desteklenmiyor).' });
        return false;
      }
      eng.play(restart ? 0 : eng.startBeat);
      this.state = 'playing';
      this._resume();
      this.emit('state');
      if (isNew || (extra && extra.announce)) this.emit('start', Object.assign({ entry: this.cur }, extra));
      return true;
    }

    pause() {
      if (this.state !== 'playing' || !this.engine) return false;
      this.engine.pause();
      this.state = 'paused';
      this.emit('state');
      return true;
    }

    toggle() {
      return this.state === 'playing' ? this.pause() : this.play();
    }

    stop() {
      if (this.engine) this.engine.stop();
      if (this.state !== 'stopped') {
        this.state = 'stopped';
        this.emit('state');
      }
      this.emit('position');
    }

    seek(seconds) {
      if (!this.cur) return false;
      const eng = this.ensureEngine();
      if (!eng) return false;
      const cs = this._cs(this.cur);
      eng.seek(clamp(seconds / cs.spb, 0, Math.max(0, cs.total - 0.05 / cs.spb)));
      this.emit('position');
      return true;
    }

    _start(entry, extra) {
      this._load(entry);
      const ok = this.play(null, Object.assign({ announce: true }, extra));
      return ok;
    }

    /** Index of the current song within the playable queue (-1 when it is no longer listed). */
    index() {
      const q = this.queue();
      return this.cur ? q.findIndex((e) => e.id === this.cur.id) : -1;
    }

    /** auto = the song ended by itself (repeat "off" then stops after the last song). Returns false when nothing started. */
    next(auto) {
      const q = this.queue();
      if (!q.length) return false;
      const i = this.index();
      let target = null;
      if (this.shuffle && q.length > 1) {
        if (this.cur) this.played.add(this.cur.id);
        let pool = q.filter((e) => !this.played.has(e.id));
        if (!pool.length) {
          if (auto && this.repeat === 'off') return false;
          this.played = new Set(this.cur ? [this.cur.id] : []);
          pool = q.filter((e) => !this.cur || e.id !== this.cur.id);
        }
        target = pool[Math.min(pool.length - 1, Math.floor(this.rand() * pool.length))];
        if (this.cur) this.history.push(this.cur.id);
      } else {
        if (auto && this.repeat === 'off' && i === q.length - 1) return false;
        target = q[(i + 1) % q.length];
      }
      return this._start(target, { auto: !!auto });
    }

    prev() {
      const q = this.queue();
      if (!q.length) return false;
      if (this.cur && this.position() > 3) {
        this.seek(0);
        return true;
      }
      let target = null;
      if (this.shuffle && this.history.length) {
        const id = this.history.pop();
        target = q.find((e) => e.id === id) || null;
        if (this.cur) this.played.delete(this.cur.id);
      }
      if (!target) {
        const i = this.index();
        target = q[(i <= 0 ? q.length : i) - 1];
      }
      return this._start(target, {});
    }

    _ended() {
      if (this.state !== 'playing' || this.disposed) return;
      if (this.repeat === 'one' && this.engine) {
        this.engine.play(0);
        this.emit('position');
        return;
      }
      if (!this.next(true)) {
        if (this.engine) this.engine.stop();
        this.state = 'stopped';
        this.emit('state');
        this.emit('position');
      }
    }

    setVolume(v) {
      this.volume = clamp(Number(v) || 0, 0, 1);
      if (this.engine) this.engine.setVolume(this.muted ? 0 : this.volume);
      this.emit('volume');
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.engine) this.engine.setVolume(this.muted ? 0 : this.volume);
      this.emit('volume');
    }

    setShuffle(on) {
      this.shuffle = !!on;
      this.played = new Set(this.cur ? [this.cur.id] : []);
      this.history = [];
      this.emit('mode');
    }

    setRepeat(mode) {
      this.repeat = mode === 'all' || mode === 'one' ? mode : 'off';
      this.emit('mode');
    }

    cycleRepeat() {
      this.setRepeat(this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off');
    }

    dispose() {
      this.disposed = true;
      this.state = 'stopped';
      if (this.engine) { this.engine.dispose(); this.engine = null; }
      this.listeners.clear();
    }
  }

  // ================================================================================================
  // 6. Window UI
  // ================================================================================================
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec + 1e-6));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
  }

  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  const artCache = new Map();
  /** Deterministic album art from a title: gradient background (CSS) + a few translucent shapes (SVG). */
  function makeArt(seed) {
    const key = String(seed);
    const hit = artCache.get(key);
    if (hit) return hit;
    const r = mulberry32(hash32(key));
    const hue = Math.floor(r() * 360);
    const hue2 = (hue + 50 + Math.floor(r() * 110)) % 360;
    const hue3 = (hue + 170 + Math.floor(r() * 80)) % 360;
    const c1 = `hsl(${hue} 68% 50%)`;
    const c2 = `hsl(${hue2} 64% 36%)`;
    const c3 = `hsl(${hue3} 82% 66%)`;
    const angle = 20 + Math.floor(r() * 150);
    const bg = `radial-gradient(circle at ${Math.round(18 + r() * 64)}% ${Math.round(12 + r() * 40)}%, ${c3} 0%, transparent 55%), linear-gradient(${angle}deg, ${c1}, ${c2})`;
    const f = (n) => Number(n).toFixed(1);
    const parts = [];
    const count = 5 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
      const kind = Math.floor(r() * 5);
      const cx = r() * 100;
      const cy = r() * 100;
      const s = 9 + r() * 28;
      const op = (0.12 + r() * 0.26).toFixed(2);
      const fill = r() < 0.55 ? '#fff' : `hsl(${hue3} 85% 78%)`;
      if (kind === 0) parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(s)}" fill="${fill}" fill-opacity="${op}"/>`);
      else if (kind === 1) parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(s)}" fill="none" stroke="${fill}" stroke-opacity="${op}" stroke-width="${f(1.5 + r() * 3)}"/>`);
      else if (kind === 2) parts.push(`<rect x="${f(cx - s / 2)}" y="${f(cy - s / 2)}" width="${f(s)}" height="${f(s * (0.5 + r() * 0.7))}" rx="${f(r() * 6)}" fill="${fill}" fill-opacity="${op}" transform="rotate(${Math.floor(r() * 90)} ${f(cx)} ${f(cy)})"/>`);
      else if (kind === 3) parts.push(`<polygon points="${f(cx)},${f(cy - s)} ${f(cx + s)},${f(cy + s * 0.8)} ${f(cx - s)},${f(cy + s * 0.8)}" fill="${fill}" fill-opacity="${op}"/>`);
      else parts.push(`<path d="M-5 ${f(cy)} Q ${f(25)} ${f(cy - s)} 50 ${f(cy)} T 105 ${f(cy)}" fill="none" stroke="${fill}" stroke-opacity="${op}" stroke-width="${f(2 + r() * 3)}" stroke-linecap="round"/>`);
    }
    const bars = 7 + Math.floor(r() * 4);
    const bw = 100 / bars;
    for (let i = 0; i < bars; i++) {
      const h = 6 + r() * 26;
      parts.push(`<rect x="${f(i * bw + bw * 0.2)}" y="${f(100 - h)}" width="${f(bw * 0.6)}" height="${f(h)}" rx="${f(bw * 0.3)}" fill="#fff" fill-opacity="0.13"/>`);
    }
    const art = { bg, c1, c2, c3, svg: `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${parts.join('')}</svg>` };
    artCache.set(key, art);
    return art;
  }

  let builtinEntries = null;
  function getBuiltins() {
    if (!builtinEntries) {
      builtinEntries = LIBRARY.map((song, i) => {
        const cs = compileSong(song);
        return { id: 'b:' + i, kind: 'builtin', title: song.title, artist: song.artist, song, cs, seconds: cs.seconds };
      });
    }
    return builtinEntries;
  }

  /** Pretty .pmus text: header fields on their own lines, one line per track. */
  function serializePmus(song) {
    const head = ['title', 'artist', 'bpm', 'swing', 'humanize', 'reverb', 'delay']
      .filter((k) => song[k] !== undefined && song[k] !== 0 && !(k === 'reverb' && song[k] === 1) && !(k === 'delay' && song[k] === 1))
      .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(song[k])}`);
    const tracks = song.tracks.map((t) => '    ' + JSON.stringify(t));
    return `{\n${head.join(',\n')},\n  "tracks": [\n${tracks.join(',\n')}\n  ]\n}\n`;
  }

  const SVG = {
    bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 18v-5M9.5 18V8M14 18v-8M18.5 18V5"/></svg>',
    wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12h3l2-6 4 12 3-9 2 3h5"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17.5v-11l10-2v11"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/></svg>'
  };

  function launch(win, args) {
    const E = P.util.el;
    const fs = P.fs;
    const ic = (name) => (P.icons && P.icons.get ? P.icons.get(name) : '');
    const saved = P.storage.get(STORE_KEY, {}) || {};
    const timers = new Set();
    const offs = [];
    let closed = false;

    const later = (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); if (!closed) fn(); }, ms);
      timers.add(id);
      return id;
    };
    const tip = (el, text) => {
      try { if (P.ui && typeof P.ui.tip === 'function') offs.push(P.ui.tip(el, text)); } catch (e) { /* tooltips are optional */ }
    };

    // ------------------------------------------------------------------ state
    const player = new Player();
    player.volume = typeof saved.volume === 'number' ? clamp(saved.volume, 0, 1) : 0.8;
    player.muted = !!saved.muted;
    player.shuffle = !!saved.shuffle;
    player.repeat = saved.repeat === 'all' || saved.repeat === 'one' ? saved.repeat : 'off';
    let vizMode = saved.viz === 'wave' ? 'wave' : 'bars';
    let query = '';
    let selectedId = null;
    let files = [];
    let drag = null;                       // progress-bar drag: { frac }
    const extras = new Set();              // .pmus files opened from outside the home folder
    const fileCache = new Map();
    const rowMap = new Map();

    const app = { player, win, extras, rowMap, notifications: 0 };
    win.state.music = app;

    // ------------------------------------------------------------------ DOM
    const dom = {};
    dom.root = E('div', { class: 'mu-root', lang: 'tr', dataset: { state: 'stopped' } });

    // library
    dom.search = E('input', { class: 'p-input mu-search-input', type: 'search', placeholder: 'Şarkı veya sanatçı ara', 'aria-label': 'Şarkı ara', autocomplete: 'off', spellcheck: 'false' });
    dom.open = E('button', { class: 'p-btn icon mu-open', type: 'button', 'aria-label': 'Dosya aç' });
    dom.open.innerHTML = ic('open');
    dom.clear = E('button', { class: 'p-btn icon small mu-clear', type: 'button', 'aria-label': 'Aramayı temizle', tabindex: '-1' });
    dom.clear.innerHTML = ic('x');
    dom.list = E('div', { class: 'mu-list', role: 'listbox', tabindex: '0', 'aria-label': 'Şarkı listesi' });
    dom.lib = E('aside', { class: 'mu-lib', 'aria-label': 'Kütüphane' },
      E('div', { class: 'mu-lib-head' },
        E('label', { class: 'mu-search' }, E('span', { class: 'mu-search-ic', html: ic('search') }), dom.search, dom.clear), dom.open),
      dom.list);
    dom.scrim = E('div', { class: 'mu-scrim' });

    // stage (now playing)
    dom.libToggle = E('button', { class: 'p-btn icon mu-lib-toggle', type: 'button', 'aria-label': 'Kütüphaneyi göster', 'aria-expanded': 'false' });
    dom.libToggle.innerHTML = ic('list');
    dom.artImg = E('div', { class: 'mu-art-img' });
    dom.art = E('div', { class: 'mu-art' }, dom.artImg);
    dom.artWrap = E('div', { class: 'mu-art-wrap' }, dom.art);
    dom.title = E('h2', { class: 'mu-title' });
    dom.artist = E('p', { class: 'mu-artist' });
    dom.chips = E('div', { class: 'mu-chips' });
    dom.meta = E('div', { class: 'mu-meta' }, dom.title, dom.artist, dom.chips);
    dom.hero = E('div', { class: 'mu-hero' }, dom.artWrap, dom.meta);

    dom.canvas = E('canvas', { class: 'mu-viz', 'aria-hidden': 'true' });
    dom.vizToggle = E('button', { class: 'p-btn icon small mu-viz-toggle', type: 'button', 'aria-label': 'Görselleştirme türünü değiştir' });
    dom.vizWrap = E('div', { class: 'mu-viz-wrap' }, dom.canvas, dom.vizToggle);

    dom.fill = E('div', { class: 'mu-prog-fill' });
    dom.thumb = E('div', { class: 'mu-prog-thumb' });
    dom.progress = E('div', { class: 'mu-progress', role: 'slider', tabindex: '0', 'aria-label': 'Çalma konumu', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' },
      E('div', { class: 'mu-prog-track' }, dom.fill), dom.thumb);
    dom.time = E('span', { class: 'mu-time', text: '0:00 / 0:00' });
    dom.progressRow = E('div', { class: 'mu-progress-row' }, dom.progress, dom.time);

    const mkBtn = (cls, label, iconName, fn) => {
      const b = E('button', { class: 'p-btn icon mu-btn ' + cls, type: 'button', 'aria-label': label });
      if (iconName) b.innerHTML = ic(iconName);
      b.addEventListener('click', fn);
      return b;
    };
    dom.stop = mkBtn('mu-stop', 'Durdur', 'stop', () => player.stop());
    dom.shuffle = mkBtn('mu-shuffle', 'Karıştır', 'shuffle', () => player.setShuffle(!player.shuffle));
    dom.prev = mkBtn('mu-prev', 'Önceki', 'prev', () => player.prev());
    dom.play = mkBtn('mu-play', 'Oynat', 'play', () => player.toggle());
    dom.next = mkBtn('mu-next', 'Sonraki', 'next', () => player.next(false));
    dom.repeat = mkBtn('mu-repeat', 'Tekrarla', 'repeat', () => player.cycleRepeat());
    dom.repeat.appendChild(E('span', { class: 'mu-one', 'aria-hidden': 'true', text: '1' }));
    dom.mute = mkBtn('mu-mute', 'Sessize al', 'volume', () => player.setMuted(!player.muted));
    dom.vol = E('input', { class: 'p-range mu-vol-range', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Ses düzeyi' });
    dom.vol.value = String(Math.round(player.volume * 100));
    dom.controls = E('div', { class: 'mu-controls' },
      E('div', { class: 'mu-modes' }, dom.stop, dom.shuffle, dom.repeat),
      E('div', { class: 'mu-transport' }, dom.prev, dom.play, dom.next),
      E('div', { class: 'mu-vol' }, dom.mute, dom.vol));

    dom.stage = E('main', { class: 'mu-stage' },
      E('div', { class: 'mu-stage-top' }, dom.libToggle),
      dom.hero, dom.vizWrap, dom.progressRow, dom.controls);
    dom.drop = E('div', { class: 'mu-drop', 'aria-hidden': 'true' }, E('span', { text: 'Şarkıyı çalmak için bırakın' }));

    dom.root.append(dom.lib, dom.scrim, dom.stage, dom.drop);
    win.body.appendChild(dom.root);

    tip(dom.open, 'Şarkı aç… (Ctrl+O)');
    tip(dom.libToggle, 'Kütüphane');
    tip(dom.vizToggle, () => (vizMode === 'bars' ? 'Dalga görünümüne geç (V)' : 'Çubuk görünümüne geç (V)'));
    tip(dom.stop, 'Durdur (X)');
    tip(dom.shuffle, () => `Karıştır: ${player.shuffle ? 'açık' : 'kapalı'} (S)`);
    tip(dom.prev, 'Önceki (P)');
    tip(dom.play, () => (player.state === 'playing' ? 'Duraklat (Boşluk)' : 'Oynat (Boşluk)'));
    tip(dom.next, 'Sonraki (N)');
    tip(dom.repeat, () => `Tekrarla: ${player.repeat === 'off' ? 'kapalı' : player.repeat === 'all' ? 'tümü' : 'tek şarkı'} (R)`);
    tip(dom.mute, () => (player.muted ? 'Sesi aç (M)' : 'Sessize al (M)'));
    tip(dom.vol, () => `Ses: %${Math.round(player.volume * 100)}`);

    // ------------------------------------------------------------------ persistence
    let persistTimer = 0;
    function persist() {
      clearTimeout(persistTimer);
      persistTimer = later(() => {
        P.storage.set(STORE_KEY, {
          volume: player.volume, muted: player.muted, shuffle: player.shuffle, repeat: player.repeat, viz: vizMode,
          last: player.cur ? player.cur.id : null
        });
      }, 250);
    }

    // ------------------------------------------------------------------ library
    function parseFileEntry(path) {
      const stem = fs.stem(path);
      try {
        const song = parsePmus(fs.readFile(path), stem);
        const cs = compileSong(song);
        return { id: 'f:' + path, kind: 'file', path, title: song.title, artist: song.artist, song, cs, seconds: cs.seconds };
      } catch (e) {
        return { id: 'f:' + path, kind: 'bad', path, title: stem, artist: 'Geçersiz şarkı dosyası', error: e && e.message ? e.message : String(e), seconds: 0 };
      }
    }

    function scanFiles() {
      if (!fs) return [];
      const paths = new Set();
      try {
        fs.walk(fs.HOME, (st) => {
          if (st.type === 'dir') return st.hidden ? false : undefined;
          if (st.ext === '.pmus') paths.add(st.path);
          return undefined;
        });
      } catch (e) { console.warn('[music] dosyalar taranamadı', e); }
      extras.forEach((p) => { try { if (fs.isFile(p)) paths.add(p); else extras.delete(p); } catch (e) { extras.delete(p); } });
      const out = [];
      for (const path of paths) {
        const st = fs.stat(path);
        const sig = st ? `${st.modified}:${st.size}` : '';
        let c = fileCache.get(path);
        if (!c || c.sig !== sig) {
          c = { sig, entry: parseFileEntry(path) };
          fileCache.set(path, c);
        }
        out.push(c.entry);
      }
      for (const k of [...fileCache.keys()]) if (!paths.has(k)) fileCache.delete(k);
      out.sort((a, b) => P.util.compareNames(a.title, b.title));
      return out;
    }

    function allEntries() { return getBuiltins().concat(files); }

    function refreshLibrary() {
      files = scanFiles();
      player.setEntries(allEntries());
      renderList();
      syncAll();
    }

    let rowSeq = 0;
    function rowEl(entry) {
      const art = makeArt(entry.title);
      const bad = entry.kind === 'bad';
      const row = E('div', { class: 'p-list-item mu-row' + (bad ? ' bad' : ''), role: 'option', id: 'mu-row-' + (++rowSeq), dataset: { id: entry.id }, 'aria-selected': 'false' });
      const cover = E('span', { class: 'mu-cover' + (bad ? ' bad' : '') });
      if (bad) cover.innerHTML = ic('warning');
      else {
        cover.style.background = art.bg;
        cover.innerHTML = art.svg;
      }
      const playBtn = E('span', { class: 'mu-row-play', html: ic('play') });
      const eq = E('span', { class: 'mu-eq', 'aria-hidden': 'true' }, E('i'), E('i'), E('i'));
      const lead = E('span', { class: 'mu-row-lead' }, cover, playBtn, eq);
      const info = E('span', { class: 'mu-row-info' },
        E('span', { class: 'mu-row-title', text: entry.title }),
        E('span', { class: 'mu-row-artist', text: bad ? entry.artist : entry.artist }));
      const dur = E('span', { class: 'mu-row-dur', text: bad ? '—' : fmtTime(Math.round(entry.seconds)) });
      row.append(lead, info, dur);
      if (entry.kind === 'file' || bad) row.title = '';
      row.addEventListener('mousedown', (e) => { if (e.button === 0) e.preventDefault(); });
      row.addEventListener('click', (e) => {
        selectedId = entry.id;
        updateRows();
        if (e.target.closest && e.target.closest('.mu-row-lead')) activate(entry, true);
      });
      row.addEventListener('dblclick', () => activate(entry, false));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selectedId = entry.id;
        updateRows();
        rowMenu(e, entry);
      });
      rowMap.set(entry.id, row);
      return row;
    }

    function sectionEl(title, entries, extra) {
      const sec = E('section', { class: 'mu-sec', role: 'group', 'aria-label': title });
      sec.appendChild(E('div', { class: 'mu-sec-head' }, E('span', { class: 'mu-sec-title', text: title }), E('span', { class: 'mu-count', text: String(entries.length) })));
      entries.forEach((e) => sec.appendChild(rowEl(e)));
      if (extra) sec.appendChild(extra);
      return sec;
    }

    function renderList() {
      rowMap.clear();
      dom.list.textContent = '';
      const q = query.trim().toLocaleLowerCase('tr');
      const match = (e) => !q || `${e.title} ${e.artist}`.toLocaleLowerCase('tr').includes(q);
      const b = getBuiltins().filter(match);
      const f = files.filter(match);
      if (b.length) dom.list.appendChild(sectionEl('Kütüphane', b));
      if (f.length) dom.list.appendChild(sectionEl('Dosyalarım', f));
      else if (!q) {
        const empty = E('div', { class: 'mu-empty' },
          E('span', { class: 'mu-empty-ic', html: ic('file-audio') }),
          E('strong', { text: 'Henüz şarkı dosyanız yok' }),
          E('span', { class: 'mu-empty-sub', text: 'Müzik klasörüne bir .pmus dosyası ekleyin ya da bir dosya açın.' }));
        const btn = E('button', { class: 'p-btn small', type: 'button', text: 'Dosya aç…' });
        btn.addEventListener('click', openDialog);
        empty.appendChild(btn);
        dom.list.appendChild(sectionEl('Dosyalarım', [], empty));
      }
      if (!b.length && !f.length) {
        dom.list.appendChild(E('div', { class: 'mu-empty mu-noresult' },
          E('strong', { text: 'Sonuç bulunamadı' }),
          E('span', { class: 'mu-empty-sub', text: `“${query.trim()}” ile eşleşen şarkı yok.` })));
      }
      updateRows();
    }

    function updateRows() {
      const cur = player.cur ? player.cur.id : null;
      let active = null;
      rowMap.forEach((row, id) => {
        const isCur = id === cur;
        const sel = id === selectedId;
        row.classList.toggle('current', isCur);
        row.classList.toggle('playing', isCur && player.state === 'playing');
        row.classList.toggle('selected', sel);
        row.setAttribute('aria-selected', sel ? 'true' : 'false');
        if (sel) active = row;
      });
      if (active) dom.list.setAttribute('aria-activedescendant', active.id);
      else dom.list.removeAttribute('aria-activedescendant');
    }

    function visibleIds() { return [...dom.list.querySelectorAll('.mu-row')].map((r) => r.dataset.id); }

    function entryById(id) { return allEntries().find((e) => e.id === id) || null; }

    function activate(entry, toggle) {
      if (!entry) return;
      if (entry.kind === 'bad') {
        P.dialog.alert({ title: 'Şarkı açılamadı', message: `“${entry.title}” dosyası çalınamıyor.\n${entry.error}`, icon: 'error' });
        return;
      }
      if (toggle && player.cur && player.cur.id === entry.id) { player.toggle(); return; }
      player.play(entry);
      if (dom.root.classList.contains('is-narrow')) setLibOpen(false);
    }

    function rowMenu(ev, entry) {
      const isCur = player.cur && player.cur.id === entry.id;
      const items = [
        entry.kind !== 'bad' && { label: isCur && player.state === 'playing' ? 'Duraklat' : 'Çal', icon: isCur && player.state === 'playing' ? 'pause' : 'play', action: () => activate(entry, true) },
        entry.kind === 'builtin' && { type: 'separator' },
        entry.kind === 'builtin' && { label: 'Müzik klasörüne kaydet', icon: 'save', action: () => saveBuiltin(entry) },
        entry.path && { type: 'separator' },
        entry.path && { label: 'Dosya konumunu aç', icon: 'folder-open', action: () => P.apps.launch('files', { path: fs.dirname(entry.path) }) },
        entry.path && { label: 'Özellikler', icon: 'info-glyph', action: () => P.dialog.properties(entry.path) },
        entry.path && { type: 'separator' },
        entry.path && { label: 'Çöp Kutusuna taşı', icon: 'delete', danger: true, action: () => trashEntry(entry) }
      ];
      P.contextMenu.show(ev, items);
    }

    async function saveBuiltin(entry) {
      try {
        const dir = fs.join(fs.HOME, 'Müzik');
        if (!fs.exists(dir)) fs.mkdir(dir, { recursive: true });
        const name = fs.uniqueName(dir, entry.title.replace(/[\\/]/g, '-') + '.pmus');
        const path = fs.join(dir, name);
        fs.writeFile(path, serializePmus(entry.song));
        P.notify && P.notify({ title: 'Şarkı kaydedildi', message: `${name} dosyası Müzik klasörüne eklendi.`, icon: 'music', appId: APP_ID, timeout: 3500 });
      } catch (e) {
        await P.dialog.alert({ title: 'Şarkı kaydedilemedi', message: e && e.message ? e.message : String(e), icon: 'error' });
      }
    }

    async function trashEntry(entry) {
      const ok = await P.dialog.confirm({ title: 'Çöp Kutusuna taşı', message: `“${fs.basename(entry.path)}” dosyası Çöp Kutusuna taşınsın mı?`, okText: 'Taşı', danger: true });
      if (!ok) return;
      try { fs.trash(entry.path); } catch (e) { await P.dialog.alert({ title: 'Taşınamadı', message: e && e.message ? e.message : String(e), icon: 'error' }); }
    }

    // ------------------------------------------------------------------ opening files
    async function openPath(path, opts) {
      const play = !opts || opts.play !== false;
      try {
        if (!fs.exists(path)) throw new Error('Dosya bulunamadı: ' + path);
        if (fs.isDir(path)) throw new Error('Bu bir klasör, şarkı dosyası değil.');
        const home = fs.HOME + '/';
        if (!path.startsWith(home) || path.split('/').some((s) => s.startsWith('.'))) extras.add(path);
        const entry = parseFileEntry(path);
        if (entry.kind === 'bad') throw new Error(entry.error);
        fileCache.set(path, { sig: (() => { const st = fs.stat(path); return st ? `${st.modified}:${st.size}` : ''; })(), entry });
        files = scanFiles();
        player.setEntries(allEntries());
        const found = allEntries().find((e) => e.id === entry.id) || entry;
        selectedId = found.id;
        renderList();
        if (play) player.play(found);
        else player.select(found);
        scrollToRow(found.id);
        return true;
      } catch (e) {
        await P.dialog.alert({ title: 'Şarkı açılamadı', message: `“${fs.basename(path)}” dosyası çalınamıyor.\n${e && e.message ? e.message : e}`, icon: 'error' });
        return false;
      }
    }

    async function openDialog() {
      try {
        const dir = fs.exists(fs.HOME + '/Müzik') ? fs.HOME + '/Müzik' : fs.HOME;
        const path = await P.dialog.pickFile({ mode: 'open', title: 'Şarkı aç', dir, extensions: ['.pmus'] });
        if (path && !closed) openPath(path);
      } catch (e) { console.error('[music] dosya seçici', e); }
    }

    function scrollToRow(id) {
      const row = rowMap.get(id);
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    // ------------------------------------------------------------------ now playing
    function syncTrack() {
      const e = player.cur;
      const art = e ? makeArt(e.title) : null;
      dom.title.textContent = e ? e.title : 'Müzik Çalar';
      dom.artist.textContent = e ? e.artist : 'Çalmak için bir şarkı seçin';
      dom.artImg.style.background = art ? art.bg : '';
      dom.artImg.innerHTML = art ? art.svg : SVG.note;
      dom.stage.style.setProperty('--art-c1', art ? art.c1 : 'var(--accent)');
      dom.stage.style.setProperty('--art-c3', art ? art.c3 : 'var(--accent)');
      dom.chips.textContent = '';
      if (e) {
        dom.chips.append(
          E('span', { class: 'p-badge subtle', text: `${Math.round(e.song.bpm)} BPM` }),
          E('span', { class: 'p-badge subtle', text: `${e.song.tracks.length} kanal` }),
          E('span', { class: 'p-badge subtle', text: e.kind === 'builtin' ? 'Yerleşik' : '.pmus dosyası' }));
      }
      dom.progress.setAttribute('aria-valuemax', String(Math.round(player.duration())));
      updateRows();
      tickUI(true);
      mediaUpdate();
    }

    function syncState() {
      const st = player.state;
      dom.root.dataset.state = st;
      dom.play.innerHTML = ic(st === 'playing' ? 'pause' : 'play');
      dom.play.setAttribute('aria-label', st === 'playing' ? 'Duraklat' : 'Oynat');
      updateRows();
      tickUI(true);
      mediaUpdate();
    }

    function syncModes() {
      dom.shuffle.classList.toggle('on', player.shuffle);
      dom.shuffle.setAttribute('aria-pressed', player.shuffle ? 'true' : 'false');
      dom.repeat.classList.toggle('on', player.repeat !== 'off');
      dom.repeat.dataset.mode = player.repeat;
      dom.repeat.setAttribute('aria-pressed', player.repeat !== 'off' ? 'true' : 'false');
      dom.repeat.setAttribute('aria-label', `Tekrarla: ${player.repeat === 'off' ? 'kapalı' : player.repeat === 'all' ? 'tümü' : 'tek şarkı'}`);
      dom.shuffle.setAttribute('aria-label', `Karıştır: ${player.shuffle ? 'açık' : 'kapalı'}`);
    }

    function syncVolume() {
      const pct = Math.round(player.volume * 100);
      if (dom.vol.value !== String(pct)) dom.vol.value = String(pct);
      const level = player.muted || pct === 0 ? 'volume-mute' : pct < 45 ? 'volume-low' : 'volume';
      if (dom.mute.dataset.icon !== level) {
        dom.mute.dataset.icon = level;
        dom.mute.innerHTML = ic(level);
      }
      dom.mute.classList.toggle('on', player.muted);
      dom.mute.setAttribute('aria-pressed', player.muted ? 'true' : 'false');
      dom.mute.setAttribute('aria-label', player.muted ? 'Sesi aç' : 'Sessize al');
      dom.vol.setAttribute('aria-valuetext', `%${pct}`);
    }

    function syncAll() {
      syncTrack();
      syncState();
      syncModes();
      syncVolume();
    }

    let lastTimeText = '';
    function tickUI(force) {
      if (closed) return;
      const total = player.duration();
      const pos = drag ? drag.frac * total : Math.min(player.position(), total);
      const frac = total > 0 ? clamp(pos / total, 0, 1) : 0;
      const text = `${fmtTime(pos)} / ${fmtTime(Math.round(total))}`;
      if (text !== lastTimeText || force) {
        lastTimeText = text;
        dom.time.textContent = text;
        dom.progress.setAttribute('aria-valuenow', String(Math.floor(pos)));
        dom.progress.setAttribute('aria-valuetext', text);
      }
      const atStart = player.state === 'stopped' && pos < 0.05;
      if (dom.stop.disabled !== atStart) dom.stop.disabled = atStart;
      const pct = (frac * 100).toFixed(2) + '%';
      if (dom.fill.style.width !== pct) {
        dom.fill.style.width = pct;
        dom.thumb.style.left = pct;
      }
    }

    // ------------------------------------------------------------------ progress bar
    function fracAt(clientX) {
      const r = dom.progress.getBoundingClientRect();
      return r.width > 0 ? clamp((clientX - r.left) / r.width, 0, 1) : 0;
    }
    function onProgDown(e) {
      if (e.button != null && e.button !== 0) return;
      if (!player.cur) return;
      e.preventDefault();
      dom.progress.focus({ preventScroll: true });
      drag = { frac: fracAt(e.clientX) };
      dom.progress.classList.add('dragging');
      tickUI(true);
      const move = (ev) => { if (drag) { drag.frac = fracAt(ev.clientX); tickUI(true); } };
      const up = (ev) => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        document.removeEventListener('pointercancel', up, true);
        const d = drag;
        drag = null;
        dom.progress.classList.remove('dragging');
        if (d && ev && ev.type !== 'pointercancel') {
          d.frac = fracAt(ev.clientX);
          player.seek(d.frac * player.duration());
        }
        tickUI(true);
      };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
      document.addEventListener('pointercancel', up, true);
      offs.push(() => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        document.removeEventListener('pointercancel', up, true);
      });
    }
    dom.progress.addEventListener('pointerdown', onProgDown);
    dom.progress.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const step = e.shiftKey ? 15 : 5;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); player.seek(player.position() - step); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); player.seek(player.position() + step); }
      else if (e.key === 'Home') { e.preventDefault(); player.seek(0); }
      else if (e.key === 'End') { e.preventDefault(); player.seek(player.duration()); }
    });

    // ------------------------------------------------------------------ volume
    dom.vol.addEventListener('input', () => {
      player.setVolume(Number(dom.vol.value) / 100);
      if (player.muted) player.setMuted(false);
    });
    function changeVolume(delta) {
      player.setVolume(Math.round((player.volume + delta) * 100) / 100);
      if (player.muted && delta > 0) player.setMuted(false);
    }

    // ------------------------------------------------------------------ visualizer
    const viz = { w: 0, h: 0, dpr: 1, bars: new Float32Array(96), wave: new Float32Array(120), t0: performance.now(), rgb: [47, 158, 107] };

    function refreshAccent() {
      const hex = String(P.settings.get('accent') || '#2f9e6b');
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (m) {
        const n = parseInt(m[1], 16);
        viz.rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
    }
    refreshAccent();

    function sizeViz() {
      const r = dom.vizWrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (dom.canvas.width !== Math.round(w * dpr) || dom.canvas.height !== Math.round(h * dpr)) {
        dom.canvas.width = Math.round(w * dpr);
        dom.canvas.height = Math.round(h * dpr);
      }
      viz.w = w;
      viz.h = h;
      viz.dpr = dpr;
    }

    function vizGradient(g, w) {
      const [r, gg, b] = viz.rgb;
      const lift = (k) => `rgb(${Math.round(r + (255 - r) * k)}, ${Math.round(gg + (255 - gg) * k)}, ${Math.round(b + (255 - b) * k)})`;
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, lift(0.45));
      grad.addColorStop(0.5, `rgb(${r}, ${gg}, ${b})`);
      grad.addColorStop(1, lift(0.3));
      return grad;
    }

    function drawBars(g, spec, t, eng) {
      const W = viz.w;
      const H = viz.h;
      const bw = W < 340 ? 5 : 7;
      const gap = 3;
      const n = clamp(Math.floor((W + gap) / (bw + gap)), 12, 64);
      const x0 = (W - (n * bw + (n - 1) * gap)) / 2;
      const nyq = (eng && eng.ctx ? eng.ctx.sampleRate : 48000) / 2;
      const bins = spec ? spec.length : 512;
      const lo = 55;
      const hi = 11000;
      g.fillStyle = vizGradient(g, W);
      for (let i = 0; i < n; i++) {
        let target;
        if (spec) {
          const k0 = Math.floor(((lo * Math.pow(hi / lo, i / n)) / nyq) * bins);
          const k1 = Math.max(k0 + 1, Math.ceil(((lo * Math.pow(hi / lo, (i + 1) / n)) / nyq) * bins));
          let m = 0;
          for (let k = k0; k < k1 && k < bins; k++) if (spec[k] > m) m = spec[k];
          target = clamp(Math.pow(m / 255, 1.45) * (0.8 + 0.55 * (i / n)), 0, 1);
        } else {
          target = 0.04 + 0.03 * (0.5 + 0.5 * Math.sin(t * 1.5 + i * 0.5));
        }
        const cur = viz.bars[i];
        viz.bars[i] = cur + (target - cur) * (target > cur ? 0.55 : 0.13);
        const hh = Math.max(3, viz.bars[i] * (H - 6));
        const x = x0 + i * (bw + gap);
        const y = (H - hh) / 2;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y, bw, hh, bw / 2);
        else g.rect(x, y, bw, hh);
        g.fill();
      }
    }

    function drawWave(g, wave, t) {
      const W = viz.w;
      const H = viz.h;
      const n = clamp(Math.floor(W / 7), 24, viz.wave.length);
      const mid = H / 2;
      for (let i = 0; i < n; i++) {
        let target;
        if (wave) {
          const k0 = Math.floor((i / n) * wave.length);
          const k1 = Math.max(k0 + 1, Math.floor(((i + 1) / n) * wave.length));
          let m = 0;
          for (let k = k0; k < k1; k++) { const a = Math.abs(wave[k] - 128) / 128; if (a > m) m = a; }
          target = clamp(m * 1.7, 0, 1);
        } else {
          target = 0.035 + 0.025 * Math.sin(t * 1.3 + i * 0.35);
        }
        const cur = viz.wave[i];
        viz.wave[i] = cur + (target - cur) * (target > cur ? 0.5 : 0.16);
      }
      const x = (i) => (i / (n - 1)) * W;
      const yUp = (i) => mid - Math.max(1.5, viz.wave[i] * (H - 8) * 0.5);
      g.beginPath();
      g.moveTo(0, yUp(0));
      for (let i = 1; i < n; i++) {
        const cx = (x(i - 1) + x(i)) / 2;
        const cy = (yUp(i - 1) + yUp(i)) / 2;
        g.quadraticCurveTo(x(i - 1), yUp(i - 1), cx, cy);
      }
      g.lineTo(W, yUp(n - 1));
      for (let i = n - 1; i >= 0; i--) {
        const yd = 2 * mid - yUp(i);
        if (i === n - 1) g.lineTo(W, yd);
        else {
          const cx = (x(i + 1) + x(i)) / 2;
          const cy = (2 * mid - yUp(i + 1) + yd) / 2;
          g.quadraticCurveTo(x(i + 1), 2 * mid - yUp(i + 1), cx, cy);
        }
      }
      g.closePath();
      g.fillStyle = vizGradient(g, W);
      g.globalAlpha = 0.9;
      g.fill();
      g.globalAlpha = 1;
    }

    function drawViz(nowMs) {
      if (closed || !viz.w) return;
      const g = dom.canvas.getContext('2d');
      if (!g) return;
      g.setTransform(viz.dpr, 0, 0, viz.dpr, 0, 0);
      g.clearRect(0, 0, viz.w, viz.h);
      const eng = player.engine;
      let spec = null;
      let wave = null;
      if (player.state === 'playing' && eng && !eng.disposed) {
        try {
          if (vizMode === 'bars') spec = eng.spectrum();
          else wave = eng.waveform();
          // a silent analyser (suspended audio context) shows the calm idle state
          const probe = spec || wave;
          let live = false;
          for (let i = 0; i < probe.length; i += 7) if (probe[i] !== (spec ? 0 : 128)) { live = true; break; }
          if (!live) { spec = null; wave = null; }
        } catch (e) { spec = null; wave = null; }
      }
      const t = (nowMs - viz.t0) / 1000;
      if (vizMode === 'bars') drawBars(g, spec, t, eng);
      else drawWave(g, wave, t);
    }

    function updatePulse() {
      let p = 0;
      if (player.state === 'playing' && player.engine && player.cur && P.settings.get('animations') !== false) {
        const beat = player.engine.beatNow();
        p = Math.exp(-(beat - Math.floor(beat)) * 5);
      }
      const s = p.toFixed(3);
      if (dom.art.dataset.pulse !== s) {
        dom.art.dataset.pulse = s;
        dom.art.style.setProperty('--pulse', s);
      }
    }

    let raf = 0;
    let lastFrame = 0;
    function paint() {
      if (closed) return;
      lastFrame = performance.now();
      if (win.isMinimized && win.isMinimized()) return;
      drawViz(lastFrame);
      updatePulse();
    }
    function frame() {
      raf = requestAnimationFrame(frame);
      paint();
    }
    raf = requestAnimationFrame(frame);
    // headless / hidden pages never deliver animation frames: a slow timer keeps the canvas alive
    const watchdog = setInterval(() => { if (performance.now() - lastFrame > 280) paint(); }, 250);
    const uiTimer = setInterval(() => tickUI(false), 120);

    dom.vizToggle.innerHTML = vizMode === 'bars' ? SVG.wave : SVG.bars;
    function toggleViz() {
      vizMode = vizMode === 'bars' ? 'wave' : 'bars';
      dom.vizToggle.innerHTML = vizMode === 'bars' ? SVG.wave : SVG.bars;
      dom.root.dataset.viz = vizMode;
      persist();
      paint();
    }
    dom.vizToggle.addEventListener('click', toggleViz);
    dom.root.dataset.viz = vizMode;

    // ------------------------------------------------------------------ layout
    function setLibOpen(open) {
      dom.root.classList.toggle('lib-open', !!open);
      dom.libToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function layout() {
      if (closed) return;
      const w = dom.root.clientWidth || win.body.clientWidth;
      const h = dom.root.clientHeight || win.body.clientHeight;
      dom.root.classList.toggle('is-narrow', w > 0 && w < 700);
      dom.root.classList.toggle('is-compact', h > 0 && h < 470);
      dom.root.classList.toggle('is-tiny', h > 0 && h < 410);
      if (w >= 700) setLibOpen(false);
      sizeViz();
      drawViz(performance.now());
    }
    dom.libToggle.addEventListener('click', () => setLibOpen(!dom.root.classList.contains('lib-open')));
    dom.scrim.addEventListener('click', () => setLibOpen(false));
    offs.push(win.on('resize', () => layout()));
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => layout());
      ro.observe(dom.root);
      offs.push(() => ro.disconnect());
    }

    // ------------------------------------------------------------------ keyboard
    dom.open.addEventListener('click', openDialog);
    dom.search.addEventListener('input', () => {
      query = dom.search.value;
      renderList();
    });
    dom.clear.addEventListener('click', () => {
      dom.search.value = '';
      query = '';
      renderList();
      dom.search.focus();
    });
    dom.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dom.search.value) { dom.search.value = ''; query = ''; renderList(); e.stopPropagation(); }
        else dom.list.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        dom.list.focus();
      } else if (e.key === 'Enter') {
        const first = visibleIds()[0];
        if (first) { e.preventDefault(); activate(entryById(first), false); }
      }
    });

    dom.list.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ids = visibleIds();
      if (!ids.length) return;
      let i = ids.indexOf(selectedId);
      if (e.key === 'ArrowDown') i = Math.min(ids.length - 1, i + 1);
      else if (e.key === 'ArrowUp') i = Math.max(0, i < 0 ? 0 : i - 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = ids.length - 1;
      else if (e.key === 'Enter') {
        e.preventDefault();
        activate(entryById(selectedId || ids[0]), false);
        return;
      } else return;
      e.preventDefault();
      selectedId = ids[i < 0 ? 0 : i];
      updateRows();
      scrollToRow(selectedId);
    });

    function seekBy(d) { player.seek(player.position() + d); }

    function onKey(e) {
      if (e.defaultPrevented || closed) return;
      const t = e.target;
      const tag = t && t.tagName;
      const key = e.key;
      if (e.ctrlKey || e.metaKey) {
        const k = String(key).toLowerCase();
        if (k === 'o') { e.preventDefault(); openDialog(); }
        else if (k === 'f') { e.preventDefault(); setLibOpen(true); dom.search.focus(); dom.search.select(); }
        return;
      }
      if (e.altKey) return;
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && t.type !== 'range') || (t && t.isContentEditable)) return;
      const onRange = tag === 'INPUT' && t.type === 'range';
      const onList = t === dom.list;
      switch (key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          player.toggle();
          break;
        case 'ArrowLeft':
          if (onRange) return;
          e.preventDefault();
          seekBy(e.shiftKey ? -15 : -5);
          break;
        case 'ArrowRight':
          if (onRange) return;
          e.preventDefault();
          seekBy(e.shiftKey ? 15 : 5);
          break;
        case 'ArrowUp':
          if (onRange || onList) return;
          e.preventDefault();
          changeVolume(0.05);
          break;
        case 'ArrowDown':
          if (onRange || onList) return;
          e.preventDefault();
          changeVolume(-0.05);
          break;
        default: {
          const k = String(key).toLowerCase();
          if (k === 'n') { e.preventDefault(); player.next(false); }
          else if (k === 'p') { e.preventDefault(); player.prev(); }
          else if (k === 's') { e.preventDefault(); player.setShuffle(!player.shuffle); }
          else if (k === 'r') { e.preventDefault(); player.cycleRepeat(); }
          else if (k === 'm') { e.preventDefault(); player.setMuted(!player.muted); }
          else if (k === 'v') { e.preventDefault(); toggleViz(); }
          else if (k === 'x') { e.preventDefault(); player.stop(); }
        }
      }
    }
    offs.push(win.on('keydown', onKey));
    // Space on a focused button would click it on key-up as well: swallow that
    const onKeyUp = (e) => { if ((e.key === ' ' || e.key === 'Spacebar') && dom.root.contains(e.target) && e.target.tagName === 'BUTTON') e.preventDefault(); };
    dom.root.addEventListener('keyup', onKeyUp);

    // ------------------------------------------------------------------ drag & drop of .pmus files from the file manager / desktop
    const hasPaths = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('application/x-pandaos-paths');
    dom.root.addEventListener('dragover', (e) => {
      if (!hasPaths(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      dom.root.classList.add('dropping');
    });
    dom.root.addEventListener('dragleave', (e) => { if (!dom.root.contains(e.relatedTarget)) dom.root.classList.remove('dropping'); });
    dom.root.addEventListener('drop', (e) => {
      dom.root.classList.remove('dropping');
      if (!hasPaths(e)) return;
      e.preventDefault();
      let paths = [];
      try { paths = JSON.parse(e.dataTransfer.getData('application/x-pandaos-paths')) || []; } catch (err) { /* ignore */ }
      const songs = paths.filter((p) => String(fs.extname(p)) === '.pmus');
      if (!songs.length) {
        P.notify && P.notify({ title: 'Müzik Çalar', message: 'Yalnızca .pmus şarkı dosyaları çalınabilir.', icon: 'music', timeout: 3000 });
        return;
      }
      songs.slice(1).forEach((p) => { if (!String(p).startsWith(fs.HOME + '/')) extras.add(p); });
      openPath(songs[0]);
    });

    // ------------------------------------------------------------------ system integration
    function mediaUpdate() {
      const ms = navigator.mediaSession;
      if (!ms || closed) return;
      try {
        const e = player.cur;
        if (e && typeof MediaMetadata === 'function') ms.metadata = new MediaMetadata({ title: e.title, artist: e.artist, album: 'PandaOS Müzik Çalar' });
        ms.playbackState = player.state === 'playing' ? 'playing' : player.state === 'paused' ? 'paused' : 'none';
        if (e && ms.setPositionState && player.duration() > 0) {
          ms.setPositionState({ duration: player.duration(), playbackRate: 1, position: clamp(player.position(), 0, player.duration()) });
        }
      } catch (err) { /* optional */ }
    }
    (function setupMediaSession() {
      const ms = navigator.mediaSession;
      if (!ms || typeof ms.setActionHandler !== 'function') return;
      const handlers = {
        play: () => player.play(),
        pause: () => player.pause(),
        stop: () => player.stop(),
        previoustrack: () => player.prev(),
        nexttrack: () => player.next(false),
        seekbackward: () => seekBy(-10),
        seekforward: () => seekBy(10),
        seekto: (d) => { if (d && typeof d.seekTime === 'number') player.seek(d.seekTime); }
      };
      Object.keys(handlers).forEach((a) => { try { ms.setActionHandler(a, handlers[a]); } catch (e) { /* unsupported action */ } });
      offs.push(() => {
        Object.keys(handlers).forEach((a) => { try { ms.setActionHandler(a, null); } catch (e) { /* ignore */ } });
        try { ms.metadata = null; ms.playbackState = 'none'; } catch (e) { /* ignore */ }
      });
    })();

    const unPlayer = player.on((ev) => {
      if (closed) return;
      switch (ev.type) {
        case 'track': syncTrack(); persist(); break;
        case 'state': syncState(); break;
        case 'position': tickUI(true); break;
        case 'volume': syncVolume(); persist(); break;
        case 'mode': syncModes(); persist(); break;
        case 'start':
          if (ev.entry && !win.isFocused() && typeof P.notify === 'function') {
            app.notifications++;
            P.notify({ title: 'Şimdi çalıyor', message: `${ev.entry.title} — ${ev.entry.artist}`, icon: 'music', appId: APP_ID, timeout: 4500 });
          }
          break;
        case 'error':
          P.dialog.alert({ title: 'Ses çalınamıyor', message: ev.message, icon: 'error' });
          break;
        default:
      }
    });
    offs.push(unPlayer);

    let fsTimer = 0;
    offs.push(P.bus.on('fs:change', () => {
      clearTimeout(fsTimer);
      fsTimer = later(refreshLibrary, 120);
    }));
    offs.push(P.bus.on('settings:change', (ev) => {
      if (ev && ev.key === 'accent') { refreshAccent(); paint(); }
      if (ev && ev.key === 'animations') updatePulse();
    }));
    offs.push(P.bus.on('theme:change', () => { refreshAccent(); paint(); }));

    // ------------------------------------------------------------------ close: stop everything
    win.on('close', () => {
      if (closed) return;
      closed = true;
      try {
        P.storage.set(STORE_KEY, {
          volume: player.volume, muted: player.muted, shuffle: player.shuffle, repeat: player.repeat, viz: vizMode,
          last: player.cur ? player.cur.id : null
        });
      } catch (e) { /* ignore */ }
      cancelAnimationFrame(raf);
      clearInterval(watchdog);
      clearInterval(uiTimer);
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      offs.splice(0).forEach((fn) => { try { if (typeof fn === 'function') fn(); } catch (e) { /* ignore */ } });
      dom.root.removeEventListener('keyup', onKeyUp);
      player.dispose();
      app.closed = true;
    });

    app.openPath = openPath;
    app.refresh = refreshLibrary;
    app.activate = activate;
    app.layout = layout;
    app.toggleViz = toggleViz;
    app.draw = () => drawViz(performance.now());
    app.vizState = () => ({ mode: vizMode, w: viz.w, h: viz.h, bars: Array.from(viz.bars.slice(0, 8)) });

    // ------------------------------------------------------------------ start
    files = scanFiles();
    const entries = allEntries();
    player.setEntries(entries);
    const first = args && args.path ? null : entries.find((e) => e.id === saved.last && e.kind !== 'bad') || entries[0];
    if (first) player._load(first, true);
    selectedId = first ? first.id : null;
    renderList();
    syncAll();
    layout();
    later(layout, 60);
    if (args && args.path) openPath(args.path);
  }

  function relaunch(win, args) {
    const app = win && win.state && win.state.music;
    if (app && args && args.path) app.openPath(args.path);
  }

  const def = {
    id: APP_ID,
    name: 'Müzik Çalar',
    icon: 'music',
    description: 'Sentezlenmiş şarkıları dinle, .pmus dosyalarını çal',
    category: 'media',
    fileTypes: ['.pmus'],
    singleInstance: true,
    window: { width: 820, height: 560, minWidth: 520, minHeight: 420 },
    launch,
    relaunch,
    // exposed for tests and tooling
    library: LIBRARY,
    parsePmus,
    compileSong,
    renderSong,
    noteToMidi,
    serializePmus,
    Engine,
    Player
  };
  P.apps.register(def);
})();
