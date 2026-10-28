import { useState, type ReactNode } from "react";
import { ACCENTS, WALLPAPERS, useSys } from "../os/system";
import { AppShell, Toggle, useTheme } from "../os/ui";

type Page = null | "display" | "wallpaper" | "sound" | "network" | "security" | "about" | "account";

function Row({ icon, color, title, sub, onClick, right }: { icon: string; color: string; title: string; sub?: string; onClick?: () => void; right?: ReactNode }) {
  const t = useTheme();
  return (
    <div onClick={onClick} className={`flex items-center gap-4 px-4 py-3 ${onClick ? "cursor-pointer active:opacity-60" : ""}`}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: color }}>{icon}</div>
      <div className="flex-1 min-w-0"><div>{title}</div>{sub && <div className={`text-sm ${t.muted} truncate`}>{sub}</div>}</div>
      {right}
    </div>
  );
}
function Group({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <div className={`rounded-3xl overflow-hidden mb-4 ${t.card}`}>{children}</div>;
}

export default function Settings() {
  const t = useTheme();
  const { settings: s, update, showToast } = useSys();
  const [page, setPage] = useState<Page>(null);
  const [pinInput, setPinInput] = useState("");

  const Back = ({ title }: { title: string }) => (
    <div className="flex items-center gap-2 mb-4"><button onClick={() => setPage(null)} className="text-2xl px-1">←</button><h2 className="text-2xl font-semibold">{title}</h2></div>
  );

  if (page) {
    return (
      <AppShell>
        <div className="pt-3">
          {page === "display" && (<>
            <Back title="Ekran" />
            <Group>
              <Row icon="🌙" color="#4338ca" title="Koyu tema" right={<Toggle on={s.dark} onChange={(v) => update({ dark: v })} />} />
              <div className="px-4 pb-4"><div className="mb-2">Parlaklık: {s.brightness}%</div><input type="range" min={20} max={100} value={s.brightness} onChange={(e) => update({ brightness: +e.target.value })} className="w-full" /></div>
            </Group>
            <div className="mb-2 px-2">Vurgu rengi</div>
            <div className="flex gap-3 px-2">
              {ACCENTS.map((c) => <button key={c} onClick={() => update({ accent: c })} className="w-10 h-10 rounded-full border-4" style={{ background: c, borderColor: c === s.accent ? (s.dark ? "#fff" : "#000") : "transparent" }} />)}
            </div>
          </>)}
          {page === "wallpaper" && (<>
            <Back title="Duvar kağıdı" />
            <div className="grid grid-cols-3 gap-3">
              {WALLPAPERS.map((w, i) => (
                <button key={i} onClick={() => { update({ wallpaper: i }); showToast("Duvar kağıdı değiştirildi"); }} className="aspect-[9/16] rounded-2xl border-4" style={{ background: w, borderColor: s.wallpaper === i ? s.accent : "transparent" }} />
              ))}
            </div>
          </>)}
          {page === "sound" && (<>
            <Back title="Ses" />
            <Group>
              <div className="p-4"><div className="mb-2">Medya sesi: {s.volume}%</div><input type="range" min={0} max={100} value={s.volume} onChange={(e) => update({ volume: +e.target.value })} className="w-full" /></div>
              <Row icon="🔕" color="#9333ea" title="Rahatsız etmeyin" right={<Toggle on={s.dnd} onChange={(v) => update({ dnd: v })} />} />
            </Group>
          </>)}
          {page === "network" && (<>
            <Back title="Ağ ve bağlantılar" />
            <Group>
              <Row icon="📶" color="#2563eb" title="Wi-Fi" sub={s.wifi ? "PandaNet_5G" : "Kapalı"} right={<Toggle on={s.wifi} onChange={(v) => update({ wifi: v, airplane: false })} />} />
              <Row icon="🔵" color="#0891b2" title="Bluetooth" right={<Toggle on={s.bluetooth} onChange={(v) => update({ bluetooth: v })} />} />
              <Row icon="✈️" color="#ea580c" title="Uçak modu" right={<Toggle on={s.airplane} onChange={(v) => update({ airplane: v, wifi: v ? false : s.wifi, bluetooth: v ? false : s.bluetooth })} />} />
            </Group>
            {s.wifi && <Group>{["PandaNet_5G ✓", "Bambu_Ev", "Komşu_WiFi 🔒", "Kafe_Misafir"].map((n) => <Row key={n} icon="📶" color="#334155" title={n} />)}</Group>}
          </>)}
          {page === "security" && (<>
            <Back title="Güvenlik" />
            <Group>
              <div className="p-4">
                <div className="mb-2">Ekran kilidi PIN'i {s.pin ? "(ayarlı ✓)" : "(yok)"}</div>
                <input value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4-6 haneli PIN" inputMode="numeric" className={`w-full rounded-xl px-3 py-2 outline-none mb-2 ${t.input}`} />
                <div className="flex gap-2">
                  <button disabled={pinInput.length < 4} onClick={() => { update({ pin: pinInput }); setPinInput(""); showToast("PIN ayarlandı 🔒"); }} className="flex-1 py-2 rounded-xl text-white disabled:opacity-40" style={{ background: s.accent }}>Kaydet</button>
                  {s.pin && <button onClick={() => { update({ pin: "" }); showToast("PIN kaldırıldı"); }} className={`flex-1 py-2 rounded-xl ${t.card2}`}>Kaldır</button>}
                </div>
              </div>
            </Group>
          </>)}
          {page === "account" && (<>
            <Back title="Hesap" />
            <div className="text-center mb-4"><div className="text-7xl">🐼</div></div>
            <Group><div className="p-4"><div className="mb-2">Adın</div><input value={s.userName} onChange={(e) => update({ userName: e.target.value })} className={`w-full rounded-xl px-3 py-2 outline-none ${t.input}`} /></div></Group>
          </>)}
          {page === "about" && (<>
            <Back title="Telefon hakkında" />
            <div className="text-center my-6"><div className="text-7xl">🐼</div><div className="text-2xl font-bold mt-2">PandamOS</div><div className={t.muted}>Sürüm 1.0 "Bambu"</div></div>
            <Group>
              {[["Model", "Panda Phone X"], ["İşlemci", "Bambu Octa-Core 3.2GHz"], ["RAM", "12 GB"], ["Depolama", "256 GB"], ["Çekirdek", "panda-kernel 6.9"], ["Tarayıcı", navigator.userAgent.split(" ").pop() ?? ""]].map(([k, v]) => (
                <div key={k} className={`flex justify-between px-4 py-3 border-b ${t.border}`}><span>{k}</span><span className={t.muted}>{v}</span></div>
              ))}
            </Group>
            <button onClick={() => { if (confirm("Tüm veriler silinsin mi?")) { Object.keys(localStorage).filter((k) => k.startsWith("pandamos:")).forEach((k) => localStorage.removeItem(k)); location.reload(); } }} className="w-full py-3 rounded-2xl bg-red-500 text-white">Fabrika ayarlarına sıfırla</button>
          </>)}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Ayarlar">
      <Group>
        <Row icon="🐼" color="#111" title={s.userName} sub="Panda Hesabı, yedekleme" onClick={() => setPage("account")} right={<span className={t.muted}>›</span>} />
      </Group>
      <Group>
        <Row icon="📶" color="#2563eb" title="Ağ ve bağlantılar" sub={s.airplane ? "Uçak modu" : s.wifi ? "Wi-Fi: PandaNet_5G" : "Kapalı"} onClick={() => setPage("network")} />
        <Row icon="🔊" color="#9333ea" title="Ses ve titreşim" sub={`Ses ${s.volume}%`} onClick={() => setPage("sound")} />
        <Row icon="☀️" color="#ca8a04" title="Ekran" sub={s.dark ? "Koyu tema" : "Açık tema"} onClick={() => setPage("display")} />
        <Row icon="🖼️" color="#db2777" title="Duvar kağıdı ve stil" onClick={() => setPage("wallpaper")} />
      </Group>
      <Group>
        <Row icon="🔒" color="#16a34a" title="Güvenlik" sub={s.pin ? "PIN ayarlı" : "Kilit yok"} onClick={() => setPage("security")} />
        <Row icon="🔋" color="#65a30d" title="Pil" sub="%87 · Yaklaşık 14 saat" />
        <Row icon="💾" color="#0891b2" title="Depolama" sub="84 GB / 256 GB kullanılıyor" />
      </Group>
      <Group>
        <Row icon="ℹ️" color="#475569" title="Telefon hakkında" sub="PandamOS 1.0" onClick={() => setPage("about")} />
      </Group>
    </AppShell>
  );
}
