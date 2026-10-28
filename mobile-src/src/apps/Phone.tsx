import { useEffect, useState } from "react";
import { AppShell, Tabs, useTheme } from "../os/ui";

type Tab = "keypad" | "recent" | "contacts";
const CONTACTS = [
  { name: "Annem ❤️", num: "0532 111 22 33", emoji: "👩" },
  { name: "Babam", num: "0533 222 33 44", emoji: "👨" },
  { name: "Po (Kung Fu)", num: "0555 888 88 88", emoji: "🐼" },
  { name: "Usta Shifu", num: "0544 777 66 55", emoji: "🦊" },
  { name: "Pizza Bambu", num: "0212 444 0 444", emoji: "🍕" },
  { name: "Ayşe", num: "0505 123 45 67", emoji: "👧" },
];

export default function Phone() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>("keypad");
  const [num, setNum] = useState("");
  const [call, setCall] = useState<{ name: string; num: string } | null>(null);
  const [secs, setSecs] = useState(0);
  const [recent, setRecent] = useState<{ name: string; num: string; time: string }[]>([
    { name: "Annem ❤️", num: "0532 111 22 33", time: "Dün 18:20" },
    { name: "Pizza Bambu", num: "0212 444 0 444", time: "Pzt 21:05" },
  ]);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);

  useEffect(() => {
    if (!call) return;
    setSecs(0);
    const i = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [call]);

  const dial = (n: string, name?: string) => {
    if (!n) return;
    const c = { name: name ?? CONTACTS.find((x) => x.num === n)?.name ?? n, num: n };
    setCall(c);
    setRecent((r) => [{ ...c, time: "Şimdi" }, ...r]);
  };

  if (call) {
    return (
      <div className="h-full flex flex-col items-center justify-between py-16 text-white bg-gradient-to-b from-emerald-800 to-neutral-950">
        <div className="text-center">
          <div className="w-28 h-28 rounded-full bg-white/20 flex items-center justify-center text-6xl mx-auto mb-4">{CONTACTS.find((x) => x.num === call.num)?.emoji ?? "👤"}</div>
          <div className="text-3xl">{call.name}</div>
          <div className="opacity-70 mt-1">{secs < 3 ? "Aranıyor..." : `${String(Math.floor((secs - 3) / 60)).padStart(2, "0")}:${String((secs - 3) % 60).padStart(2, "0")}`}</div>
        </div>
        <div className="grid grid-cols-3 gap-6">
          {[["🔇", "Sessiz", muted, () => setMuted(!muted)], ["⌨️", "Tuş takımı", false, () => {}], ["🔊", "Hoparlör", speaker, () => setSpeaker(!speaker)]].map(([i, l, on, f]) => (
            <button key={l as string} onClick={f as () => void} className="flex flex-col items-center gap-1">
              <span className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl ${on ? "bg-white text-black" : "bg-white/15"}`}>{i as string}</span>
              <span className="text-xs">{l as string}</span>
            </button>
          ))}
        </div>
        <button onClick={() => setCall(null)} className="w-18 h-18 rounded-full bg-red-500 text-3xl rotate-[135deg]">📞</button>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${t.bg}`}>
      <div className="flex-1 overflow-hidden">
        {tab === "keypad" && (
          <div className="h-full flex flex-col justify-end pb-6">
            <div className="text-4xl text-center h-14 mb-6 tracking-wider px-4 truncate">{num}</div>
            <div className="grid grid-cols-3 gap-4 px-10">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                <button key={k} onClick={() => setNum(num + k)} className={`aspect-square rounded-full text-3xl ${t.card} active:scale-90 transition`}>{k}</button>
              ))}
              <div />
              <button onClick={() => dial(num)} className="aspect-square rounded-full bg-green-500 text-3xl">📞</button>
              <button onClick={() => setNum(num.slice(0, -1))} className="text-2xl">⌫</button>
            </div>
          </div>
        )}
        {tab === "recent" && (
          <AppShell title="Son aramalar">
            {recent.map((r, i) => (
              <div key={i} className={`flex items-center justify-between py-3 border-b ${t.border}`}>
                <div><div>{r.name}</div><div className={`text-sm ${t.muted}`}>↗ {r.time}</div></div>
                <button onClick={() => dial(r.num, r.name)} className="text-xl">📞</button>
              </div>
            ))}
          </AppShell>
        )}
        {tab === "contacts" && (
          <AppShell title="Kişiler">
            {CONTACTS.map((c) => (
              <div key={c.num} className={`flex items-center gap-3 py-3 border-b ${t.border}`}>
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-2xl ${t.card2}`}>{c.emoji}</div>
                <div className="flex-1"><div>{c.name}</div><div className={`text-sm ${t.muted}`}>{c.num}</div></div>
                <button onClick={() => dial(c.num, c.name)} className="text-xl">📞</button>
              </div>
            ))}
          </AppShell>
        )}
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "keypad", label: "Tuş takımı", icon: "🔢" }, { id: "recent", label: "Son", icon: "🕘" }, { id: "contacts", label: "Kişiler", icon: "👥" }]} />
    </div>
  );
}
