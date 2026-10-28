import { useEffect, useRef, useState } from "react";
import { SystemProvider, fmtTime, useNow, useSys } from "./os/system";
import { APPS, getApp } from "./os/apps";
import Home from "./os/Home";
import LockScreen from "./os/LockScreen";
import QuickPanel from "./os/QuickPanel";

function useBattery() {
  const [b, setB] = useState({ level: 0.87, charging: false });
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    nav.getBattery?.().then((bat: any) => {
      const u = () => setB({ level: bat.level, charging: bat.charging });
      u(); bat.addEventListener("levelchange", u); bat.addEventListener("chargingchange", u);
    });
  }, []);
  return b;
}

function StatusBar({ dark, onPull }: { dark: boolean; onPull: () => void }) {
  const { settings: s, notifs } = useSys();
  const now = useNow();
  const bat = useBattery();
  const start = useRef<number | null>(null);
  return (
    <div className={`absolute top-0 inset-x-0 h-8 z-30 flex items-center justify-between px-6 text-[13px] font-medium cursor-pointer ${dark ? "text-white" : "text-neutral-900"}`}
      onClick={onPull}
      onPointerDown={(e) => { start.current = e.clientY; }}
      onPointerMove={(e) => { if (start.current !== null && e.clientY - start.current > 20) { start.current = null; onPull(); } }}
      onPointerUp={() => { start.current = null; }}>
      <div className="flex items-center gap-1.5">
        <span>{fmtTime(now)}</span>
        {notifs.slice(0, 3).map((n) => <span key={n.id} className="text-[10px]">{n.icon}</span>)}
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 top-2 w-5 h-5 rounded-full bg-black ring-2 ring-neutral-800" />
      <div className="flex items-center gap-1.5">
        {s.dnd && <span>🔕</span>}
        {s.bluetooth && <span className="text-[11px]">ᛒ</span>}
        {s.airplane ? <span>✈</span> : (
          <>
            {s.wifi && <svg width="15" height="12" viewBox="0 0 24 18" fill="currentColor"><path d="M12 18l4-5a6 6 0 00-8 0zM2 6a15 15 0 0120 0l-2.5 3a11 11 0 00-15 0zm4 4.5a9.5 9.5 0 0112 0L15.5 13a6 6 0 00-7 0z" /></svg>}
            <svg width="14" height="12" viewBox="0 0 20 16" fill="currentColor"><rect x="0" y="11" width="3" height="5" rx="1" /><rect x="5" y="8" width="3" height="8" rx="1" /><rect x="10" y="4" width="3" height="12" rx="1" /><rect x="15" y="0" width="3" height="16" rx="1" /></svg>
          </>
        )}
        <span className="text-[11px]">{Math.round(bat.level * 100)}%</span>
        <div className="w-6 h-3 rounded-[3px] border border-current relative p-[1px]">
          <div className="h-full rounded-[1px]" style={{ width: `${bat.level * 100}%`, background: bat.level < 0.2 ? "#ef4444" : "currentColor" }} />
          {bat.charging && <span className="absolute inset-0 flex items-center justify-center text-[8px] text-yellow-400">⚡</span>}
        </div>
      </div>
    </div>
  );
}

function NavBar({ dark, onBack, onHome, onRecents }: { dark: boolean; onBack: () => void; onHome: () => void; onRecents: () => void }) {
  const c = dark ? "text-white/80" : "text-neutral-800";
  return (
    <div className={`absolute bottom-0 inset-x-0 h-11 z-30 flex items-center justify-around ${c}`}>
      <button onClick={onBack} className="w-16 h-10 flex items-center justify-center active:bg-white/10 rounded-full">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L4 8l8 6z" strokeLinejoin="round" /></svg>
      </button>
      <button onClick={onHome} className="w-16 h-10 flex items-center justify-center active:bg-white/10 rounded-full">
        <span className="w-4 h-4 rounded-full border-2 border-current" />
      </button>
      <button onClick={onRecents} className="w-16 h-10 flex items-center justify-center active:bg-white/10 rounded-full">
        <span className="w-3.5 h-3.5 rounded-[3px] border-2 border-current" />
      </button>
    </div>
  );
}

function Recents({ open, onOpen, onClose, onKill, onClear }: { open: string[]; onOpen: (id: string) => void; onClose: () => void; onKill: (id: string) => void; onClear: () => void }) {
  return (
    <div className="absolute inset-0 z-20 bg-black/70 backdrop-blur-xl flex flex-col pt-12 pb-14 fade-up" onClick={onClose}>
      {open.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-white/60"><div className="text-5xl mb-2">🎋</div>Açık uygulama yok</div>
      ) : (
        <>
          <div className="flex-1 flex items-center gap-4 overflow-x-auto no-scrollbar px-12 snap-x snap-mandatory">
            {[...open].reverse().map((id) => {
              const a = getApp(id);
              return (
                <div key={id} className="snap-center shrink-0 flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2 text-white text-sm"><span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs" style={{ background: a.bg }}>{a.icon}</span>{a.name}</div>
                  <button onClick={() => onOpen(id)} className="w-52 h-96 rounded-3xl flex items-center justify-center text-7xl shadow-2xl border border-white/10" style={{ background: a.bg }}>{a.icon}</button>
                  <button onClick={() => onKill(id)} className="w-9 h-9 rounded-full bg-white/15 text-white">✕</button>
                </div>
              );
            })}
          </div>
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} className="mx-auto px-5 py-2 rounded-full bg-white/15 text-white text-sm">Tümünü temizle</button>
        </>
      )}
    </div>
  );
}

function Boot({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const i = setInterval(() => setP((x) => Math.min(100, x + 4)), 60);
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    if (p < 100) return;
    const t = setTimeout(() => done.current(), 300);
    return () => clearTimeout(t);
  }, [p]);
  return (
    <div className="absolute inset-0 z-[60] bg-black flex flex-col items-center justify-center text-white">
      <div className="text-8xl pulse-logo">🐼</div>
      <div className="text-3xl font-bold mt-4 tracking-wide">Pandam<span className="text-green-400">OS</span></div>
      <div className="w-32 h-1 bg-white/15 rounded-full mt-8 overflow-hidden"><div className="h-full bg-green-400 transition-all" style={{ width: `${p}%` }} /></div>
      <div className="absolute bottom-10 text-xs opacity-40">powered by bambu kernel</div>
    </div>
  );
}

function Phone() {
  const { settings, toast } = useSys();
  const [booted, setBooted] = useState(false);
  const [locked, setLocked] = useState(true);
  const [screenOff, setScreenOff] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const [panel, setPanel] = useState(false);
  const [recents, setRecents] = useState(false);
  const [volShow, setVolShow] = useState(false);
  const { update } = useSys();
  const volTimer = useRef<number>(0);

  const open = (id: string) => {
    setCurrent(id); setRecents(false); setPanel(false);
    setOpened((o) => [...o.filter((x) => x !== id), id]);
  };
  const home = () => { setCurrent(null); setRecents(false); setPanel(false); };
  const back = () => { if (panel) setPanel(false); else if (recents) setRecents(false); else setCurrent(null); };
  const power = () => {
    if (!booted) return;
    if (screenOff) { setScreenOff(false); setLocked(true); } else { setScreenOff(true); setPanel(false); setRecents(false); }
  };
  const vol = (d: number) => {
    update({ volume: Math.max(0, Math.min(100, settings.volume + d)) });
    setVolShow(true); clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(() => setVolShow(false), 1500);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") back(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const app = current ? getApp(current) : null;
  const barsDark = !app || app.light || settings.dark;
  const appBg = app ? (app.light ? "#000" : settings.dark ? "#0a0a0a" : "#fafafa") : "transparent";

  // fullscreen on small devices
  const [mobile, setMobile] = useState(window.innerWidth < 500);
  useEffect(() => { const r = () => setMobile(window.innerWidth < 500); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);

  const screen = (
    <div className="relative w-full h-full overflow-hidden bg-black" style={{ ["--accent" as string]: settings.accent }}>
      {booted && !screenOff && (
        <>
          <Home onOpen={open} />
          {/* app layer */}
          <div className="absolute inset-0 z-10 pointer-events-none" style={{ background: app ? appBg : "transparent" }} />
          {opened.map((id) => {
            const a = getApp(id);
            const active = id === current && !recents;
            if (a.keepAlive === false && id !== current) return null;
            const C = a.component;
            return (
              <div key={id} className={`absolute top-8 bottom-11 inset-x-0 z-10 overflow-hidden ${active ? "app-open" : "hidden"}`}>
                <div className="relative h-full">{<C />}</div>
              </div>
            );
          })}
          <StatusBar dark={barsDark || recents} onPull={() => setPanel(true)} />
          <NavBar dark={barsDark || recents} onBack={back} onHome={home} onRecents={() => setRecents((r) => !r)} />
          {recents && <Recents open={opened} onOpen={open} onClose={() => setRecents(false)} onKill={(id) => { setOpened((o) => o.filter((x) => x !== id)); if (current === id) setCurrent(null); }} onClear={() => { setOpened([]); setCurrent(null); setRecents(false); }} />}
          {panel && <QuickPanel onClose={() => setPanel(false)} onOpenSettings={() => open("settings")} />}
          {locked && <LockScreen onUnlock={() => setLocked(false)} />}
          {toast && <div className="toast-in absolute top-10 left-1/2 -translate-x-1/2 z-[55] bg-neutral-800/95 text-white text-sm px-4 py-2.5 rounded-full shadow-xl whitespace-nowrap max-w-[90%] truncate">{toast}</div>}
          {volShow && (
            <div className="absolute right-3 top-1/3 z-[55] w-10 h-40 bg-neutral-800/90 rounded-full p-1.5 flex flex-col justify-end fade-up">
              <div className="rounded-full transition-all" style={{ height: `${settings.volume}%`, background: settings.accent }} />
              <div className="text-center text-xs mt-1">🔊</div>
            </div>
          )}
          {settings.flashlight && <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-40 h-20 bg-yellow-100/40 blur-2xl z-[56] pointer-events-none rounded-full" />}
        </>
      )}
      {!booted && <Boot onDone={() => setBooted(true)} />}
      {screenOff && <div className="absolute inset-0 z-[70] bg-black flex items-end justify-center pb-10 cursor-pointer" onClick={power}><span className="text-white/20 text-xs">Uyandırmak için dokun</span></div>}
      <div className="absolute inset-0 z-[80] pointer-events-none bg-black" style={{ opacity: (1 - settings.brightness / 100) * 0.75 }} />
    </div>
  );

  if (mobile) return <div className="fixed inset-0">{screen}</div>;

  return (
    <div className="min-h-full flex items-center justify-center gap-16 p-6" style={{ background: "radial-gradient(circle at 30% 30%, #1e293b, #020617)" }}>
      <div className="hidden lg:block text-white max-w-xs">
        <div className="text-6xl mb-4">🐼</div>
        <h1 className="text-5xl font-bold">Pandam<span className="text-green-400">OS</span></h1>
        <p className="mt-3 text-white/60">Tarayıcında çalışan, Android esintili mobil işletim sistemi.</p>
        <ul className="mt-6 space-y-2 text-sm text-white/70">
          <li>⬆️ Kilidi açmak için yukarı kaydır</li>
          <li>⬇️ Hızlı ayarlar için durum çubuğuna dokun</li>
          <li>⬆️ Ana ekranda yukarı kaydır: tüm uygulamalar</li>
          <li>◁ ○ ▢ Geri / Ana ekran / Son uygulamalar</li>
          <li>🔘 Yan tuşlar: güç ve ses</li>
          <li>📱 {APPS.length} uygulama dahil</li>
        </ul>
        <a href="../index.html" className="inline-flex items-center gap-2 mt-8 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm">💻 PandaOS masaüstüne geç</a>
      </div>
      <div className="relative" style={{ height: "min(860px, calc(100vh - 48px))", aspectRatio: "9 / 19.5" }}>
        <button onClick={power} title="Güç" className="absolute -right-[7px] top-[22%] w-[5px] h-16 rounded-r bg-neutral-600 hover:bg-neutral-500" />
        <button onClick={() => vol(10)} title="Ses +" className="absolute -left-[7px] top-[18%] w-[5px] h-12 rounded-l bg-neutral-600 hover:bg-neutral-500" />
        <button onClick={() => vol(-10)} title="Ses -" className="absolute -left-[7px] top-[27%] w-[5px] h-12 rounded-l bg-neutral-600 hover:bg-neutral-500" />
        <div className="w-full h-full rounded-[48px] bg-neutral-800 p-[10px] shadow-[0_30px_80px_rgba(0,0,0,.6)] ring-1 ring-neutral-700">
          <div className="w-full h-full rounded-[40px] overflow-hidden">{screen}</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SystemProvider>
      <Phone />
    </SystemProvider>
  );
}
