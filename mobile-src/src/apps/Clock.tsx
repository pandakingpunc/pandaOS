import { useEffect, useRef, useState } from "react";
import { useNow, useStored, useSys } from "../os/system";
import { AppShell, Tabs, Toggle, useTheme } from "../os/ui";

type Tab = "clock" | "alarm" | "stopwatch" | "timer";
const pad = (n: number) => String(n).padStart(2, "0");

function Analog({ now, accent }: { now: Date; accent: string }) {
  const s = now.getSeconds(), m = now.getMinutes(), h = now.getHours() % 12;
  const hand = (deg: number, len: number, w: number, color: string) => (
    <line x1="100" y1="100" x2={100 + len * Math.sin((deg * Math.PI) / 180)} y2={100 - len * Math.cos((deg * Math.PI) / 180)} stroke={color} strokeWidth={w} strokeLinecap="round" />
  );
  return (
    <svg viewBox="0 0 200 200" className="w-56 h-56 mx-auto">
      <circle cx="100" cy="100" r="95" fill="currentColor" opacity="0.08" />
      {Array.from({ length: 12 }, (_, i) => (
        <circle key={i} cx={100 + 82 * Math.sin((i * 30 * Math.PI) / 180)} cy={100 - 82 * Math.cos((i * 30 * Math.PI) / 180)} r={i % 3 === 0 ? 3 : 1.5} fill="currentColor" />
      ))}
      {hand(h * 30 + m * 0.5, 45, 6, "currentColor")}
      {hand(m * 6 + s * 0.1, 65, 4, "currentColor")}
      {hand(s * 6, 75, 2, accent)}
      <circle cx="100" cy="100" r="5" fill={accent} />
    </svg>
  );
}

export default function Clock() {
  const t = useTheme();
  const { notify } = useSys();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const now = useNow(250);
  const [tab, setTab] = useState<Tab>("clock");
  const [alarms, setAlarms] = useStored<{ id: number; time: string; on: boolean }[]>("alarms", [{ id: 1, time: "07:30", on: true }]);
  const [newAlarm, setNewAlarm] = useState("08:00");

  // stopwatch
  const [swRun, setSwRun] = useState(false);
  const [swTime, setSwTime] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const swStart = useRef(0);
  useEffect(() => {
    if (!swRun) return;
    swStart.current = Date.now() - swTime;
    const i = setInterval(() => setSwTime(Date.now() - swStart.current), 31);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swRun]);

  // timer
  const [tSet, setTSet] = useState({ m: 1, s: 0 });
  const [tLeft, setTLeft] = useState<number | null>(null);
  const [tRun, setTRun] = useState(false);
  useEffect(() => {
    if (!tRun) return;
    const i = setInterval(() => setTLeft((l) => (l === null ? l : Math.max(0, l - 1))), 1000);
    return () => clearInterval(i);
  }, [tRun]);
  useEffect(() => {
    if (tRun && tLeft === 0) { setTRun(false); notifyRef.current({ app: "Saat", icon: "⏰", title: "Zamanlayıcı bitti!", body: "Süre doldu." }); }
  }, [tRun, tLeft]);

  const fmtSw = (ms: number) => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(Math.floor(ms / 10) % 100)}`;

  const cities = [["İstanbul", 3], ["Londra", 0], ["New York", -5], ["Tokyo", 9]] as const;

  return (
    <div className={`h-full flex flex-col ${t.bg}`}>
      <div className="flex-1 overflow-hidden">
        {tab === "clock" && (
          <AppShell title="Saat">
            <div className="text-center mt-4">
              <Analog now={now} accent={t.accent} />
              <div className="text-5xl font-light mt-4">{pad(now.getHours())}:{pad(now.getMinutes())}<span className="text-2xl opacity-60">:{pad(now.getSeconds())}</span></div>
              <div className={t.muted}>{now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
            </div>
            <div className="mt-6 space-y-2">
              {cities.map(([c, off]) => {
                const d = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + off * 3600000);
                return <div key={c} className={`flex justify-between rounded-2xl p-4 ${t.card}`}><span>{c}</span><span className="text-xl">{pad(d.getHours())}:{pad(d.getMinutes())}</span></div>;
              })}
            </div>
          </AppShell>
        )}
        {tab === "alarm" && (
          <AppShell title="Alarm">
            <div className={`flex gap-2 rounded-2xl p-3 mb-3 ${t.card}`}>
              <input type="time" value={newAlarm} onChange={(e) => setNewAlarm(e.target.value)} className={`flex-1 rounded-lg px-3 outline-none ${t.input}`} />
              <button onClick={() => setAlarms((a) => [...a, { id: Date.now(), time: newAlarm, on: true }].sort((x, y) => x.time.localeCompare(y.time)))} className="px-4 py-2 rounded-lg text-white" style={{ background: t.accent }}>Ekle</button>
            </div>
            {alarms.map((a) => (
              <div key={a.id} className={`flex items-center justify-between rounded-2xl p-4 mb-2 ${t.card}`}>
                <div className={`text-4xl font-light ${a.on ? "" : "opacity-40"}`}>{a.time}</div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setAlarms((l) => l.filter((x) => x.id !== a.id))} className="opacity-60">✕</button>
                  <Toggle on={a.on} onChange={(v) => setAlarms((l) => l.map((x) => (x.id === a.id ? { ...x, on: v } : x)))} />
                </div>
              </div>
            ))}
          </AppShell>
        )}
        {tab === "stopwatch" && (
          <AppShell title="Kronometre">
            <div className="text-6xl font-light text-center my-12 tabular-nums">{fmtSw(swTime)}</div>
            <div className="flex justify-center gap-4">
              <button onClick={() => swRun ? setLaps((l) => [swTime, ...l]) : (setSwTime(0), setLaps([]))} className={`w-20 h-20 rounded-full ${t.card2}`}>{swRun ? "Tur" : "Sıfırla"}</button>
              <button onClick={() => setSwRun(!swRun)} className="w-20 h-20 rounded-full text-white" style={{ background: swRun ? "#ef4444" : t.accent }}>{swRun ? "Durdur" : "Başlat"}</button>
            </div>
            <div className="mt-6">
              {laps.map((l, i) => <div key={i} className={`flex justify-between py-2 border-b ${t.border} tabular-nums`}><span>Tur {laps.length - i}</span><span>{fmtSw(l)}</span></div>)}
            </div>
          </AppShell>
        )}
        {tab === "timer" && (
          <AppShell title="Zamanlayıcı">
            {tLeft === null ? (
              <div className="flex justify-center items-center gap-4 my-12">
                {(["m", "s"] as const).map((k) => (
                  <div key={k} className="flex flex-col items-center">
                    <button onClick={() => setTSet((s) => ({ ...s, [k]: (s[k] + 1) % 60 }))} className="text-2xl px-4">▲</button>
                    <div className="text-6xl font-light tabular-nums">{pad(tSet[k])}</div>
                    <button onClick={() => setTSet((s) => ({ ...s, [k]: (s[k] + 59) % 60 }))} className="text-2xl px-4">▼</button>
                    <span className={t.muted}>{k === "m" ? "dakika" : "saniye"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-7xl font-light text-center my-16 tabular-nums">{pad(Math.floor(tLeft / 60))}:{pad(tLeft % 60)}</div>
            )}
            <div className="flex justify-center gap-4">
              {tLeft !== null && <button onClick={() => { setTLeft(null); setTRun(false); }} className={`w-20 h-20 rounded-full ${t.card2}`}>İptal</button>}
              <button onClick={() => {
                if (tLeft === null) { const total = tSet.m * 60 + tSet.s; if (total > 0) { setTLeft(total); setTRun(true); } }
                else if (tLeft === 0) { setTLeft(null); }
                else setTRun(!tRun);
              }} className="w-20 h-20 rounded-full text-white" style={{ background: t.accent }}>{tLeft === null ? "Başlat" : tLeft === 0 ? "Tamam" : tRun ? "Duraklat" : "Devam"}</button>
            </div>
          </AppShell>
        )}
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "clock", label: "Saat", icon: "🕐" }, { id: "alarm", label: "Alarm", icon: "⏰" }, { id: "stopwatch", label: "Kronometre", icon: "⏱️" }, { id: "timer", label: "Zamanlayıcı", icon: "⏳" }]} />
    </div>
  );
}
