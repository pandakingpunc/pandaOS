import { useRef, useState } from "react";
import { WALLPAPERS, fmtDate, useNow, useSys } from "./system";

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { settings, notifs } = useSys();
  const now = useNow();
  const [dy, setDy] = useState(0);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const start = useRef<number | null>(null);

  const tryUnlock = () => { if (settings.pin) setPinMode(true); else onUnlock(); };
  const press = (k: string) => {
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    const np = pin + k;
    setPin(np);
    if (np.length === settings.pin.length) {
      if (np === settings.pin) setTimeout(onUnlock, 120);
      else { setShake(true); navigator.vibrate?.(100); setTimeout(() => { setShake(false); setPin(""); }, 400); }
    }
  };

  return (
    <div className="absolute inset-0 z-40 text-white overflow-hidden select-none" style={{ background: WALLPAPERS[settings.wallpaper] }}
      onPointerDown={(e) => { if (!pinMode) start.current = e.clientY; }}
      onPointerMove={(e) => { if (start.current !== null) setDy(Math.min(0, e.clientY - start.current)); }}
      onPointerUp={() => { if (start.current !== null) { if (dy < -120) tryUnlock(); setDy(0); start.current = null; } }}
      onPointerLeave={() => { setDy(0); start.current = null; }}>
      <div className="absolute inset-0 bg-black/20" />
      <a href="../index.html" onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-10 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-md text-xs active:bg-white/30">
        💻 Masaüstü
      </a>
      {!pinMode ? (
        <div className="relative h-full flex flex-col items-center pt-20 transition-transform" style={{ transform: `translateY(${dy}px)`, opacity: 1 + dy / 300, transition: start.current === null ? "all .3s" : "none" }}>
          <div className="text-sm opacity-90">🔒</div>
          <div className="text-8xl font-thin tracking-tight mt-2">{now.getHours().toString().padStart(2, "0")}<span className="opacity-80">:</span>{now.getMinutes().toString().padStart(2, "0")}</div>
          <div className="text-lg capitalize mt-1">{fmtDate(now)}</div>
          <div className="w-full px-4 mt-10 space-y-2">
            {notifs.slice(0, 3).map((n) => (
              <div key={n.id} className="bg-white/15 backdrop-blur-md rounded-2xl p-3 flex gap-3 fade-up">
                <span className="text-2xl">{n.icon}</span>
                <div className="min-w-0"><div className="text-sm font-semibold">{n.title}</div><div className="text-xs opacity-80 truncate">{n.body}</div></div>
              </div>
            ))}
          </div>
          <div className="mt-auto mb-10 flex flex-col items-center gap-2 cursor-pointer" onClick={tryUnlock}>
            <div className="text-2xl animate-bounce">⌃</div>
            <div className="text-sm opacity-80">Kilidi açmak için yukarı kaydır</div>
          </div>
        </div>
      ) : (
        <div className="relative h-full flex flex-col items-center justify-center fade-up">
          <div className="text-4xl mb-2">🐼</div>
          <div className="mb-6">PIN'i gir</div>
          <div className={`flex gap-4 mb-10 ${shake ? "animate-pulse" : ""}`} style={shake ? { transform: "translateX(6px)" } : undefined}>
            {Array.from({ length: settings.pin.length }, (_, i) => <span key={i} className={`w-3.5 h-3.5 rounded-full border-2 border-white ${i < pin.length ? "bg-white" : ""}`} />)}
          </div>
          <div className="grid grid-cols-3 gap-5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) => k ? (
              <button key={i} onClick={() => press(k)} className="w-18 h-18 rounded-full bg-white/15 backdrop-blur text-3xl active:bg-white/40">{k}</button>
            ) : <div key={i} />)}
          </div>
          <button onClick={() => { setPinMode(false); setPin(""); }} className="mt-8 text-sm opacity-80">İptal</button>
        </div>
      )}
    </div>
  );
}
