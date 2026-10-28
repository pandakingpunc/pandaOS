import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const WALLPAPERS = [
  "linear-gradient(160deg,#1e3a8a 0%,#7c3aed 50%,#db2777 100%)",
  "linear-gradient(160deg,#064e3b 0%,#059669 50%,#a3e635 100%)",
  "linear-gradient(160deg,#0f172a 0%,#334155 60%,#94a3b8 100%)",
  "linear-gradient(160deg,#7c2d12 0%,#ea580c 50%,#facc15 100%)",
  "radial-gradient(circle at 30% 20%,#f472b6,transparent 50%),radial-gradient(circle at 80% 80%,#22d3ee,transparent 50%),#111827",
  "linear-gradient(160deg,#000 0%,#1f2937 100%)",
];

export const ACCENTS = ["#22c55e", "#3b82f6", "#a855f7", "#f43f5e", "#f59e0b", "#14b8a6"];

export interface Notif { id: number; app: string; icon: string; title: string; body: string; time: Date }

export interface Settings {
  wallpaper: number;
  accent: string;
  dark: boolean;
  brightness: number;
  volume: number;
  wifi: boolean;
  bluetooth: boolean;
  airplane: boolean;
  flashlight: boolean;
  dnd: boolean;
  userName: string;
  pin: string;
}

const defaults: Settings = {
  wallpaper: 0, accent: ACCENTS[0], dark: true, brightness: 100, volume: 60,
  wifi: true, bluetooth: false, airplane: false, flashlight: false, dnd: false,
  userName: "Panda", pin: "",
};

interface Sys {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  notifs: Notif[];
  notify: (n: Omit<Notif, "id" | "time">) => void;
  dismiss: (id: number) => void;
  clearNotifs: () => void;
  toast: string | null;
  showToast: (t: string) => void;
}

const Ctx = createContext<Sys>(null!);
export const useSys = () => useContext(Ctx);

export function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem("pandamos:" + key); return v ? { ...fallback as object, ...JSON.parse(v) } as T : fallback; } catch { return fallback; }
}
export function loadRaw<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem("pandamos:" + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function save(key: string, v: unknown) { localStorage.setItem("pandamos:" + key, JSON.stringify(v)); }

export function useStored<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => loadRaw(key, init));
  const k = "pandamos:" + key;
  useEffect(() => {
    const s = JSON.stringify(v);
    if (localStorage.getItem(k) !== s) {
      localStorage.setItem(k, s);
      window.dispatchEvent(new CustomEvent("pandamos-store", { detail: key }));
    }
  }, [k, key, v]);
  useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent).detail !== key) return;
      const raw = localStorage.getItem(k);
      if (raw) setV((cur) => (JSON.stringify(cur) === raw ? cur : JSON.parse(raw)));
    };
    window.addEventListener("pandamos-store", h);
    return () => window.removeEventListener("pandamos-store", h);
  }, [k, key]);
  return [v, setV] as const;
}

export function SystemProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => load("settings", defaults));
  const [notifs, setNotifs] = useState<Notif[]>([
    { id: 1, app: "PandamOS", icon: "🐼", title: "PandamOS'a hoş geldin!", body: "Yukarıdan aşağı kaydırarak hızlı ayarları açabilirsin.", time: new Date() },
  ]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => save("settings", settings), [settings]);

  const value: Sys = {
    settings,
    update: (p) => setSettings((s) => ({ ...s, ...p })),
    notifs,
    notify: (n) => {
      setNotifs((l) => [{ ...n, id: Date.now() + Math.random(), time: new Date() }, ...l]);
      if (!settings.dnd) { setToast(`${n.icon} ${n.title}`); setTimeout(() => setToast(null), 2500); }
    },
    dismiss: (id) => setNotifs((l) => l.filter((x) => x.id !== id)),
    clearNotifs: () => setNotifs([]),
    toast,
    showToast: (t) => { setToast(t); setTimeout(() => setToast(null), 2000); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), interval); return () => clearInterval(t); }, [interval]);
  return now;
}

export const fmtTime = (d: Date) => d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
export const fmtDate = (d: Date) => d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
