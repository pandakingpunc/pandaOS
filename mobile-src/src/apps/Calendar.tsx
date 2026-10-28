import { useState } from "react";
import { useStored } from "../os/system";
import { AppShell, useTheme } from "../os/ui";

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export default function Calendar() {
  const t = useTheme();
  const today = new Date();
  const [view, setView] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [sel, setSel] = useState(today);
  const [events, setEvents] = useStored<Record<string, string[]>>("events", {});
  const [txt, setTxt] = useState("");

  const first = (view.getDay() + 6) % 7;
  const daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + daysIn) / 7) * 7 }, (_, i) => i - first + 1);
  const selEvents = events[key(sel)] ?? [];

  return (
    <AppShell title={view.toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}
      right={<div className="flex gap-1">
        <button onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} className={`w-9 h-9 rounded-full ${t.card2}`}>‹</button>
        <button onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} className={`w-9 h-9 rounded-full ${t.card2}`}>›</button>
      </div>}>
      <div className="grid grid-cols-7 text-center text-xs mb-1">{DAYS.map((d) => <div key={d} className={t.muted}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((n, i) => {
          if (n < 1 || n > daysIn) return <div key={i} />;
          const d = new Date(view.getFullYear(), view.getMonth(), n);
          const isToday = key(d) === key(today), isSel = key(d) === key(sel);
          return (
            <button key={i} onClick={() => setSel(d)} className="aspect-square rounded-full flex flex-col items-center justify-center relative"
              style={{ background: isSel ? t.accent : undefined, color: isSel ? "#fff" : isToday ? t.accent : undefined, fontWeight: isToday ? 700 : 400 }}>
              {n}
              {events[key(d)]?.length ? <span className="w-1 h-1 rounded-full absolute bottom-1" style={{ background: isSel ? "#fff" : t.accent }} /> : null}
            </button>
          );
        })}
      </div>
      <div className={`mt-4 rounded-3xl p-4 ${t.card}`}>
        <div className="font-semibold mb-2">{sel.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })}</div>
        {selEvents.length === 0 && <div className={`text-sm ${t.muted}`}>Etkinlik yok</div>}
        {selEvents.map((e, i) => (
          <div key={i} className="flex items-center gap-2 py-1.5">
            <span className="w-1 h-6 rounded" style={{ background: t.accent }} />
            <span className="flex-1">{e}</span>
            <button onClick={() => setEvents((ev) => ({ ...ev, [key(sel)]: selEvents.filter((_, j) => j !== i) }))} className="opacity-50">✕</button>
          </div>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); if (!txt.trim()) return; setEvents((ev) => ({ ...ev, [key(sel)]: [...selEvents, txt.trim()] })); setTxt(""); }} className="flex gap-2 mt-3">
          <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Yeni etkinlik..." className={`flex-1 rounded-xl px-3 py-2 outline-none ${t.input}`} />
          <button className="px-4 rounded-xl text-white" style={{ background: t.accent }}>+</button>
        </form>
      </div>
    </AppShell>
  );
}
