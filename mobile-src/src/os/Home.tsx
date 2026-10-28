import { useRef, useState } from "react";
import { APPS, DOCK, type AppDef } from "./apps";
import { WALLPAPERS, fmtDate, useNow, useSys } from "./system";

export function AppIcon({ app, onOpen, size = 56, label = true }: { app: AppDef; onOpen: (id: string) => void; size?: number; label?: boolean }) {
  return (
    <button onClick={() => onOpen(app.id)} className="flex flex-col items-center gap-1 active:scale-90 transition-transform">
      <span className="rounded-[30%] flex items-center justify-center shadow-lg" style={{ width: size, height: size, background: app.bg, fontSize: size * 0.5 }}>{app.icon}</span>
      {label && <span className="text-[11px] text-white drop-shadow truncate max-w-[70px]">{app.name}</span>}
    </button>
  );
}

export default function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const { settings } = useSys();
  const now = useNow();
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState("");
  const start = useRef<number | null>(null);

  const homeApps = APPS.filter((a) => !DOCK.includes(a.id)).slice(0, 12);
  const greet = now.getHours() < 6 ? "İyi geceler" : now.getHours() < 12 ? "Günaydın" : now.getHours() < 18 ? "İyi günler" : "İyi akşamlar";

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: WALLPAPERS[settings.wallpaper] }}
      onPointerDown={(e) => { start.current = e.clientY; }}
      onPointerUp={(e) => {
        if (start.current === null) return;
        const d = e.clientY - start.current;
        if (d < -80 && !drawer) setDrawer(true);
        if (d > 80 && drawer) setDrawer(false);
        start.current = null;
      }}>
      <div className="h-full flex flex-col pt-8 pb-3 px-4">
        <div className="text-white px-2 fade-up">
          <div className="text-6xl font-extralight">{now.getHours().toString().padStart(2, "0")}:{now.getMinutes().toString().padStart(2, "0")}</div>
          <div className="capitalize opacity-90">{fmtDate(now)}</div>
          <div className="text-sm opacity-75 mt-1">{greet}, {settings.userName} 🐼</div>
        </div>
        <button onClick={() => setDrawer(true)} className="mt-5 bg-white/20 backdrop-blur-md rounded-full px-4 py-2.5 text-left text-white/80 text-sm flex items-center gap-2">
          <span>🔍</span> Uygulama ara...
        </button>
        <div className="grid grid-cols-4 gap-y-5 mt-8">
          {homeApps.map((a, i) => <div key={a.id} className="flex justify-center fade-up" style={{ animationDelay: `${i * 25}ms` }}><AppIcon app={a} onOpen={onOpen} /></div>)}
        </div>
        <div className="mt-auto">
          <button onClick={() => setDrawer(true)} className="w-full text-white/70 text-xs mb-2">⌃ Tüm uygulamalar</button>
          <div className="bg-white/15 backdrop-blur-xl rounded-[28px] p-3 flex justify-around">
            {DOCK.map((id) => <AppIcon key={id} app={APPS.find((a) => a.id === id)!} onOpen={onOpen} label={false} />)}
          </div>
        </div>
      </div>

      <div className={`absolute inset-0 bg-neutral-950/85 backdrop-blur-xl transition-all duration-300 flex flex-col pt-8 px-4 ${drawer ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"}`}>
        <button onClick={() => setDrawer(false)} className="text-white/60 text-xl">⌄</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Uygulama ara" className="bg-white/10 text-white rounded-full px-4 py-2.5 outline-none mt-2 placeholder-white/50" onPointerDown={(e) => e.stopPropagation()} />
        <div className="grid grid-cols-4 gap-y-5 mt-6 overflow-y-auto no-scrollbar pb-6">
          {APPS.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).map((a) => (
            <div key={a.id} className="flex justify-center"><AppIcon app={a} onOpen={(id) => { setDrawer(false); setQ(""); onOpen(id); }} /></div>
          ))}
        </div>
      </div>
    </div>
  );
}
