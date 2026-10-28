import { fmtDate, fmtTime, useNow, useSys, type Settings } from "./system";

export default function QuickPanel({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const { settings: s, update, notifs, dismiss, clearNotifs } = useSys();
  const now = useNow();
  const tiles: { key: keyof Settings; icon: string; label: string }[] = [
    { key: "wifi", icon: "📶", label: "Wi-Fi" },
    { key: "bluetooth", icon: "🔵", label: "Bluetooth" },
    { key: "airplane", icon: "✈️", label: "Uçak modu" },
    { key: "flashlight", icon: "🔦", label: "El feneri" },
    { key: "dnd", icon: "🔕", label: "Rahatsız etme" },
    { key: "dark", icon: "🌙", label: "Koyu tema" },
  ];
  const toggle = (k: keyof Settings) => {
    if (k === "airplane") update({ airplane: !s.airplane, wifi: s.airplane ? s.wifi : false, bluetooth: s.airplane ? s.bluetooth : false });
    else update({ [k]: !s[k] } as Partial<Settings>);
  };

  return (
    <div className="absolute inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative slide-down bg-neutral-900/95 text-white rounded-b-[32px] p-5 pt-10 shadow-2xl max-h-full overflow-y-auto no-scrollbar" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-end mb-4">
          <div><div className="text-4xl font-light">{fmtTime(now)}</div><div className="text-sm opacity-70 capitalize">{fmtDate(now)}</div></div>
          <button onClick={onOpenSettings} className="w-10 h-10 rounded-full bg-white/10">⚙️</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {tiles.map((t) => {
            const on = !!s[t.key];
            return (
              <button key={t.key} onClick={() => toggle(t.key)} className="rounded-2xl p-3 text-left transition-colors" style={{ background: on ? s.accent : "rgba(255,255,255,.08)", color: on ? "#000" : "#fff" }}>
                <div className="text-xl">{t.icon}</div>
                <div className="text-xs mt-1 font-medium">{t.label}</div>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-4 bg-white/8 rounded-full px-4 py-2">
          <span>☀️</span><input type="range" min={20} max={100} value={s.brightness} onChange={(e) => update({ brightness: +e.target.value })} className="flex-1" />
        </div>
        <div className="flex items-center gap-3 mt-2 bg-white/8 rounded-full px-4 py-2">
          <span>🔊</span><input type="range" min={0} max={100} value={s.volume} onChange={(e) => update({ volume: +e.target.value })} className="flex-1" />
        </div>
        <div className="mt-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm opacity-70">Bildirimler</span>
            {notifs.length > 0 && <button onClick={clearNotifs} className="text-xs px-3 py-1 rounded-full bg-white/10">Tümünü temizle</button>}
          </div>
          {notifs.length === 0 && <div className="text-center text-sm opacity-50 py-4">Bildirim yok 🎋</div>}
          <div className="space-y-2">
            {notifs.map((n) => (
              <div key={n.id} className="bg-white/10 rounded-2xl p-3 flex gap-3 items-start">
                <span className="text-2xl">{n.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs opacity-60">{n.app} · {fmtTime(n.time)}</div>
                  <div className="text-sm font-semibold">{n.title}</div>
                  <div className="text-xs opacity-80">{n.body}</div>
                </div>
                <button onClick={() => dismiss(n.id)} className="opacity-50 text-sm">✕</button>
              </div>
            ))}
          </div>
        </div>
        <div className="w-10 h-1 rounded-full bg-white/30 mx-auto mt-4" onClick={onClose} />
      </div>
    </div>
  );
}
