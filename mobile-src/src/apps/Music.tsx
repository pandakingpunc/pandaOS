import { useEffect, useRef, useState } from "react";
import { useSys } from "../os/system";

// Procedurally-generated chiptune songs via WebAudio
const SONGS = [
  { title: "Bambu Ormanı", artist: "DJ Panda", color: "#22c55e", bpm: 110, notes: [0, 4, 7, 12, 7, 4, 2, 5, 9, 12, 9, 5], bass: [0, 0, 5, 5], emoji: "🎋" },
  { title: "Gece Yarısı Atıştırmalığı", artist: "Lo-Fi Pandas", color: "#a855f7", bpm: 80, notes: [0, 3, 7, 10, 7, 3, -2, 2, 5, 9, 5, 2], bass: [0, -2, -4, -5], emoji: "🌙" },
  { title: "Kung Fu Rüyası", artist: "Shifu Beats", color: "#ef4444", bpm: 140, notes: [0, 2, 4, 7, 9, 7, 4, 2, 0, -3, 0, 2], bass: [0, 0, -3, -5], emoji: "🥋" },
  { title: "Bulutların Üstünde", artist: "Panda Orkestrası", color: "#3b82f6", bpm: 96, notes: [7, 4, 0, 4, 7, 12, 11, 7, 9, 5, 2, 5], bass: [0, 5, -3, -5], emoji: "☁️" },
];

export default function Music() {
  const { settings } = useSys();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const song = SONGS[idx];
  const vol = settings.volume / 100;

  useEffect(() => {
    if (!playing) return;
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    ctx.resume();
    let s = 0;
    const beat = 60 / song.bpm / 2;
    const tone = (semi: number, type: OscillatorType, dur: number, gain: number, base = 440) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = base * Math.pow(2, semi / 12);
      g.gain.setValueAtTime(gain * vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
    };
    const i = setInterval(() => {
      tone(song.notes[s % song.notes.length], "triangle", beat * 1.8, 0.15);
      if (s % 4 === 0) tone(song.bass[Math.floor(s / 4) % song.bass.length], "sine", beat * 3.5, 0.25, 110);
      if (s % 2 === 1) tone(36, "square", 0.03, 0.03);
      s++; setStep(s);
    }, beat * 1000);
    return () => clearInterval(i);
  }, [playing, idx, song, vol]);

  useEffect(() => () => { ctxRef.current?.close(); ctxRef.current = null; }, []);

  const progress = (step % 96) / 96;

  return (
    <div className="h-full flex flex-col text-white" style={{ background: `linear-gradient(180deg, ${song.color}, #0a0a0a 70%)` }}>
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className={`w-60 h-60 rounded-3xl shadow-2xl flex items-center justify-center text-8xl ${playing ? "pulse-logo" : ""}`} style={{ background: `linear-gradient(135deg, ${song.color}, #111)` }}>{song.emoji}</div>
        <div className="mt-8 text-center">
          <div className="text-2xl font-bold">{song.title}</div>
          <div className="opacity-70">{song.artist}</div>
        </div>
        <div className="w-full mt-6">
          <div className="h-1 rounded bg-white/20"><div className="h-1 rounded bg-white" style={{ width: `${progress * 100}%` }} /></div>
        </div>
        <div className="flex items-end gap-1 h-10 mt-4">
          {Array.from({ length: 16 }, (_, i) => <div key={i} className="w-2 rounded-t bg-white/70 transition-all" style={{ height: playing ? `${20 + Math.abs(Math.sin(step * 0.7 + i)) * 80}%` : "10%" }} />)}
        </div>
        <div className="flex items-center gap-8 mt-6">
          <button onClick={() => setIdx((idx + SONGS.length - 1) % SONGS.length)} className="text-3xl">⏮</button>
          <button onClick={() => setPlaying(!playing)} className="w-18 h-18 rounded-full bg-white text-black text-3xl flex items-center justify-center">{playing ? "⏸" : "▶"}</button>
          <button onClick={() => setIdx((idx + 1) % SONGS.length)} className="text-3xl">⏭</button>
        </div>
      </div>
      <div className="px-4 pb-4 space-y-1">
        {SONGS.map((s, i) => (
          <button key={s.title} onClick={() => { setIdx(i); setPlaying(true); }} className={`w-full flex items-center gap-3 p-2 rounded-xl ${i === idx ? "bg-white/15" : ""}`}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl" style={{ background: s.color }}>{s.emoji}</div>
            <div className="text-left"><div className="text-sm font-medium">{s.title}</div><div className="text-xs opacity-60">{s.artist}</div></div>
          </button>
        ))}
      </div>
    </div>
  );
}
