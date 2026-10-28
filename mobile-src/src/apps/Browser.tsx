import { useState } from "react";
import { useTheme } from "../os/ui";

const BOOKMARKS = [
  { name: "Vikipedi", url: "https://tr.m.wikipedia.org/wiki/Dev_panda", icon: "📚" },
  { name: "OpenStreetMap", url: "https://www.openstreetmap.org/export/embed.html?bbox=28.9,40.98,29.05,41.06", icon: "🗺️" },
  { name: "Wikimedia", url: "https://commons.m.wikimedia.org/wiki/Main_Page", icon: "🖼️" },
  { name: "Example", url: "https://example.com", icon: "🌐" },
];

export default function Browser() {
  const t = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [key, setKey] = useState(0);

  const go = (raw: string) => {
    let u = raw.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) u = u.includes(".") && !u.includes(" ") ? "https://" + u : `https://tr.m.wikipedia.org/w/index.php?search=${encodeURIComponent(u)}`;
    setUrl(u); setInput(u);
  };

  return (
    <div className={`h-full flex flex-col ${t.bg}`}>
      <form onSubmit={(e) => { e.preventDefault(); go(input); }} className="flex items-center gap-2 p-2">
        <button type="button" onClick={() => { setUrl(null); setInput(""); }} className="text-xl px-1">🏠</button>
        <input value={input} onChange={(e) => setInput(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Ara veya adres yaz" className={`flex-1 rounded-full px-4 py-2 text-sm outline-none ${t.input}`} />
        <button type="button" onClick={() => setKey((k) => k + 1)} className="text-xl px-1">↻</button>
      </form>
      {url ? (
        <iframe key={key} src={url} className="flex-1 w-full bg-white border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
      ) : (
        <div className="flex-1 flex flex-col items-center pt-16 px-6">
          <div className="text-6xl">🐼</div>
          <div className="text-3xl font-bold mt-2">Panda<span style={{ color: t.accent }}>Web</span></div>
          <form onSubmit={(e) => { e.preventDefault(); go(input); }} className="w-full mt-6">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="🔍 Vikipedi'de ara..." className={`w-full rounded-full px-5 py-3 outline-none ${t.input}`} />
          </form>
          <div className="grid grid-cols-4 gap-4 mt-8 w-full">
            {BOOKMARKS.map((b) => (
              <button key={b.name} onClick={() => go(b.url)} className="flex flex-col items-center gap-1">
                <span className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${t.card}`}>{b.icon}</span>
                <span className="text-xs">{b.name}</span>
              </button>
            ))}
          </div>
          <p className={`text-xs ${t.muted} mt-10 text-center`}>Not: Bazı siteler gömülü görüntülenmeye izin vermeyebilir.</p>
        </div>
      )}
    </div>
  );
}
