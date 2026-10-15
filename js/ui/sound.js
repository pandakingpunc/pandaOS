/* PandaOS sound — one shared AudioContext + master gain, and synthesized UI sounds.
   Nothing is loaded from files: every sound is built from oscillators / noise + envelopes. */
(function () {
  'use strict';

  const P = window.PandaOS;

  let ctx = null;
  let masterGain = null;
  let noiseBuffer = null;
  let gestureSeen = false;
  let inited = false;

  // ---------------------------------------------------------------- helpers
  function userActive() {
    try {
      return gestureSeen || !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
    } catch (e) {
      return gestureSeen;
    }
  }

  function level() {
    const s = P.settings;
    if (!s) return 0.7;
    if (s.get('muted')) return 0;
    const v = Number(s.get('volume'));
    return Math.min(1, Math.max(0, (Number.isFinite(v) ? v : 70) / 100));
  }

  function applyVolume() {
    if (!masterGain) return;
    try {
      masterGain.gain.value = level();
    } catch (e) { /* ignore */ }
  }

  function resume() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function onGesture() {
    gestureSeen = true;
    if (ctx && ctx.state !== 'running') resume();
  }

  // ---------------------------------------------------------------- public: context / master
  function context() {
    if (ctx) {
      if (ctx.state === 'suspended' && userActive()) resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try {
        ctx = new AC();
      } catch (e2) {
        ctx = null;
        return null;
      }
    }
    try {
      masterGain = ctx.createGain();
      applyVolume();
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('[sound] ana ses düğümü oluşturulamadı', e);
    }
    if (userActive()) resume();
    return ctx;
  }

  function master() {
    context();
    return masterGain;
  }

  // ---------------------------------------------------------------- synthesis building blocks
  function noise(c) {
    if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
    const len = Math.floor(c.sampleRate * 1.2);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  /** One enveloped oscillator. o: {type,freq,t,dur,gain,attack,release,glideTo,detune,hold} */
  function voice(c, out, o) {
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, o.t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = c.createGain();
    const peak = o.gain == null ? 0.2 : o.gain;
    const attack = o.attack == null ? 0.006 : o.attack;
    const end = o.t + o.dur;
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.linearRampToValueAtTime(peak, o.t + attack);
    if (o.hold) {
      // sustain at the peak, then release (pads)
      const relStart = Math.max(o.t + attack, end - (o.release || 0.4));
      g.gain.setValueAtTime(peak, relStart);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g);
    g.connect(out);
    osc.start(o.t);
    osc.stop(end + 0.05);
  }

  /** Bell = sine fundamental + a couple of inharmonic partials with shorter tails. */
  function bell(c, out, freq, t, dur, gain) {
    voice(c, out, { freq, t, dur, gain, attack: 0.004 });
    voice(c, out, { freq: freq * 2.76, t, dur: dur * 0.55, gain: gain * 0.28, attack: 0.003 });
    voice(c, out, { freq: freq * 5.4, t, dur: dur * 0.3, gain: gain * 0.1, attack: 0.002 });
  }

  function filterNode(c, type, freq, q) {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }

  const NOTE = {
    C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, B5: 987.77, C6: 1046.5, E6: 1318.51
  };

  // ---------------------------------------------------------------- sounds
  const SOUNDS = {
    // soft two-note bell, ~0.45 s
    notify(c, out, t) {
      bell(c, out, NOTE.G5, t, 0.34, 0.2);
      bell(c, out, NOTE.C6, t + 0.13, 0.4, 0.2);
    },

    // short low double buzz
    error(c, out, t) {
      const lp = filterNode(c, 'lowpass', 720, 0.7);
      lp.connect(out);
      voice(c, lp, { type: 'sawtooth', freq: 150, t, dur: 0.11, gain: 0.22, attack: 0.004 });
      voice(c, lp, { type: 'sawtooth', freq: 112, t: t + 0.15, dur: 0.15, gain: 0.22, attack: 0.004 });
      voice(c, lp, { type: 'square', freq: 75, t, dur: 0.11, gain: 0.08, attack: 0.004 });
      voice(c, lp, { type: 'square', freq: 56, t: t + 0.15, dur: 0.15, gain: 0.08, attack: 0.004 });
    },

    // tiny tick
    click(c, out, t) {
      voice(c, out, { freq: 1700, glideTo: 620, t, dur: 0.035, gain: 0.11, attack: 0.001 });
      const src = c.createBufferSource();
      src.buffer = noise(c);
      const hp = filterNode(c, 'highpass', 3200, 0.7);
      const g = c.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
      src.connect(hp);
      hp.connect(g);
      g.connect(out);
      src.start(t);
      src.stop(t + 0.03);
    },

    // PandaOS jingle: warm arpeggiated pad chord (Cmaj7/9), ~1.6 s
    startup(c, out, t) {
      const lp = filterNode(c, 'lowpass', 2600, 0.5);
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + 0.7);
      lp.frequency.exponentialRampToValueAtTime(1400, t + 1.7);
      const mix = c.createGain();
      mix.gain.value = 0.72;
      lp.connect(mix);
      mix.connect(out);
      const chord = [NOTE.C4, NOTE.G4, NOTE.B4, NOTE.E5];
      const end = t + 1.7;
      chord.forEach((f, i) => {
        const start = t + i * 0.15;
        const dur = end - start;
        voice(c, lp, { type: 'triangle', freq: f, t: start, dur, gain: 0.085, attack: 0.07, hold: true, release: 0.9, detune: -5 });
        voice(c, lp, { type: 'sine', freq: f * 2, t: start, dur, gain: 0.045, attack: 0.09, hold: true, release: 0.9, detune: 5 });
        voice(c, lp, { type: 'sawtooth', freq: f / 2, t: start, dur, gain: 0.02, attack: 0.1, hold: true, release: 0.9 });
      });
      bell(c, out, NOTE.E6, t + 0.6, 0.9, 0.07);
    },

    // filtered noise crumple
    trash(c, out, t) {
      const src = c.createBufferSource();
      src.buffer = noise(c);
      const bp = filterNode(c, 'bandpass', 2400, 0.9);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      for (let i = 0; i < 11; i++) {
        const at = t + i * 0.031 + Math.random() * 0.016;
        const amp = 0.1 + Math.random() * 0.2;
        bp.frequency.setValueAtTime(1100 + Math.random() * 3200, at);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(amp, at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      }
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(t, Math.random() * 0.5);
      src.stop(t + 0.5);
      voice(c, out, { freq: 150, glideTo: 62, t: t + 0.02, dur: 0.14, gain: 0.07, attack: 0.004 });
    },

    // descending soft chord, ~1.5 s
    shutdown(c, out, t) {
      const lp = filterNode(c, 'lowpass', 2200, 0.5);
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(380, t + 1.6);
      const mix = c.createGain();
      mix.gain.value = 0.78;
      lp.connect(mix);
      mix.connect(out);
      const chord = [NOTE.E5, NOTE.B4, NOTE.G4, NOTE.C4];
      const end = t + 1.55;
      chord.forEach((f, i) => {
        const start = t + i * 0.17;
        const dur = end - start;
        voice(c, lp, { type: 'triangle', freq: f, t: start, dur, gain: 0.09, attack: 0.05, hold: true, release: 0.75 });
        voice(c, lp, { type: 'sine', freq: f / 2, t: start, dur, gain: 0.05, attack: 0.07, hold: true, release: 0.75 });
      });
    }
  };

  const warned = new Set();
  function warnOnce(name, err) {
    if (warned.has(name)) return;
    warned.add(name);
    console.warn(`[sound] "${name}" sesi üretilemedi`, err);
  }

  /** Renders a named sound offline (no speakers): Promise<AudioBuffer|null>. Used by the tests. */
  function render(name, seconds) {
    const make = SOUNDS[name];
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!make || !OAC) return Promise.resolve(null);
    try {
      const rate = 44100;
      const c = new OAC(1, Math.ceil(rate * (seconds || 2.4)), rate);
      const out = c.createGain();
      out.gain.value = 1;
      out.connect(c.destination);
      make(c, out, 0.02);
      return c.startRendering();
    } catch (e) {
      warnOnce(name, e);
      return Promise.resolve(null);
    }
  }

  /** Plays a named UI sound. Never throws. */
  function play(name) {
    try {
      const s = P.settings;
      if (s && s.get('sounds') === false) return;
      if (level() <= 0) return;
      const make = SOUNDS[name];
      if (!make) return;
      const c = context();
      if (!c || !masterGain) return;
      const run = () => {
        try {
          make(c, masterGain, c.currentTime + 0.02);
        } catch (e) {
          warnOnce(name, e);   // audio is optional, but a broken sound should not stay invisible
        }
      };
      if (c.state === 'running') {
        run();
      } else if (userActive()) {
        const p = c.resume();
        if (p && p.then) p.then(() => { if (c.state === 'running') run(); }).catch(() => {});
      }
    } catch (e) {
      warnOnce(name, e);
    }
  }

  function init() {
    if (inited) return;
    inited = true;
    ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
      document.addEventListener(evt, onGesture, { capture: true, passive: true });
    });
    P.bus.on('settings:change', ({ key }) => {
      if (key === 'volume' || key === 'muted') applyVolume();
    });
  }

  P.sound = { init, context, master, play, render, resume, names: Object.keys(SOUNDS) };
})();
