import { useCallback, useEffect, useRef, useState } from "react";
import { useStored } from "../os/system";

const N = 18;
type P = [number, number];

export default function Snake() {
  const [snake, setSnake] = useState<P[]>([[8, 9], [7, 9], [6, 9]]);
  const [food, setFood] = useState<P>([13, 9]);
  const [state, setState] = useState<"ready" | "play" | "over">("ready");
  const [best, setBest] = useStored("snake-best", 0);
  const dir = useRef<P>([1, 0]);
  const nextDir = useRef<P>([1, 0]);
  const touch = useRef<P | null>(null);

  const reset = () => { setSnake([[8, 9], [7, 9], [6, 9]]); setFood([13, 9]); dir.current = [1, 0]; nextDir.current = [1, 0]; setState("play"); };

  const turn = useCallback((d: P) => {
    if (d[0] === -dir.current[0] && d[1] === -dir.current[1]) return;
    nextDir.current = d;
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const m: Record<string, P> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
      if (m[e.key]) { e.preventDefault(); turn(m[e.key]); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [turn]);

  useEffect(() => {
    if (state !== "play") return;
    const speed = Math.max(70, 160 - snake.length * 3);
    const i = setTimeout(() => {
      dir.current = nextDir.current;
      const h: P = [snake[0][0] + dir.current[0], snake[0][1] + dir.current[1]];
      if (h[0] < 0 || h[1] < 0 || h[0] >= N || h[1] >= N || snake.some((s) => s[0] === h[0] && s[1] === h[1])) {
        setState("over"); setBest((b) => Math.max(b, snake.length - 3)); navigator.vibrate?.(200); return;
      }
      const ate = h[0] === food[0] && h[1] === food[1];
      const ns = [h, ...snake]; if (!ate) ns.pop();
      setSnake(ns);
      if (ate) {
        let f: P;
        do { f = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; } while (ns.some((s) => s[0] === f[0] && s[1] === f[1]));
        setFood(f);
      }
    }, speed);
    return () => clearTimeout(i);
  }, [snake, state, food, setBest]);

  const score = snake.length - 3;
  return (
    <div className="h-full flex flex-col items-center bg-gradient-to-b from-emerald-950 to-neutral-950 text-white p-4"
      onTouchStart={(e) => { touch.current = [e.touches[0].clientX, e.touches[0].clientY]; }}
      onTouchEnd={(e) => {
        if (!touch.current) return;
        const dx = e.changedTouches[0].clientX - touch.current[0], dy = e.changedTouches[0].clientY - touch.current[1];
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) turn(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]);
      }}>
      <div className="flex justify-between w-full mb-3"><span className="text-xl font-bold">🐍 Yılan</span><span>Skor: <b>{score}</b> · En iyi: <b>{best}</b></span></div>
      <div className="relative w-full aspect-square rounded-2xl bg-emerald-900/40 border border-emerald-700/50 overflow-hidden">
        {snake.map((s, i) => (
          <div key={i} className="absolute rounded-sm" style={{ left: `${(s[0] / N) * 100}%`, top: `${(s[1] / N) * 100}%`, width: `${100 / N}%`, height: `${100 / N}%`, background: i === 0 ? "#bef264" : `hsl(${90 + i * 2},70%,${50 - Math.min(i, 20)}%)`, transform: "scale(.92)" }} />
        ))}
        <div className="absolute flex items-center justify-center text-sm" style={{ left: `${(food[0] / N) * 100}%`, top: `${(food[1] / N) * 100}%`, width: `${100 / N}%`, height: `${100 / N}%` }}>🎋</div>
        {state !== "play" && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
            <div className="text-3xl font-bold">{state === "over" ? "Oyun bitti!" : "🐍 Yılan"}</div>
            {state === "over" && <div>Skor: {score}</div>}
            <button onClick={reset} className="px-6 py-2 rounded-full bg-lime-400 text-black font-semibold">{state === "over" ? "Tekrar oyna" : "Başla"}</button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-5 w-44">
        <div /><button onClick={() => turn([0, -1])} className="h-14 rounded-xl bg-white/10 text-2xl active:bg-white/30">▲</button><div />
        <button onClick={() => turn([-1, 0])} className="h-14 rounded-xl bg-white/10 text-2xl active:bg-white/30">◀</button>
        <button onClick={() => turn([0, 1])} className="h-14 rounded-xl bg-white/10 text-2xl active:bg-white/30">▼</button>
        <button onClick={() => turn([1, 0])} className="h-14 rounded-xl bg-white/10 text-2xl active:bg-white/30">▶</button>
      </div>
      <p className="text-xs opacity-50 mt-3">Ok tuşları, kaydırma veya butonlarla oyna</p>
    </div>
  );
}
