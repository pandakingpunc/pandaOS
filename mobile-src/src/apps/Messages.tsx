import { useEffect, useRef, useState } from "react";
import { useStored, useSys } from "../os/system";
import { AppShell, useTheme } from "../os/ui";

interface Msg { from: "me" | "them"; text: string; time: number }
const CHATS = [
  { id: "panda", name: "PandaBot 🤖", emoji: "🐼" },
  { id: "anne", name: "Annem ❤️", emoji: "👩" },
  { id: "po", name: "Po", emoji: "🥟" },
];

function reply(id: string, text: string, name: string): string {
  const t = text.toLowerCase();
  if (id === "anne") return ["Yemek yedin mi oğlum? 🍲", "Eve ne zaman geliyorsun?", "Montunu giy, hava soğuk!", "Tamam canım ❤️", "Babana da söyle"][Math.floor(Math.random() * 5)];
  if (id === "po") return ["Dumpling yiyelim mi? 🥟", "Skadoosh! 💥", "Ustam bugün çok sinirliydi 😅", "Ejderha Savaşçısı burada!"][Math.floor(Math.random() * 4)];
  if (/merhaba|selam|hey|sa\b/.test(t)) return `Merhaba ${name}! 🐼 Sana nasıl yardım edebilirim?`;
  if (/saat/.test(t)) return `Şu an saat ${new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} ⏰`;
  if (/tarih|bugün/.test(t)) return `Bugün ${new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} 📅`;
  if (/nasılsın/.test(t)) return "Bambu yiyorum, çok iyiyim! Sen nasılsın? 🎋";
  if (/şaka|fıkra/.test(t)) return "Panda neden fotoğraf çektirmez? Çünkü zaten siyah-beyaz! 📸😂";
  if (/pandamos|sen kimsin|adın/.test(t)) return "Ben PandaBot! PandamOS'un dahili asistanıyım. Bana saat, tarih, şaka sorabilir ya da hesap yaptırabilirsin (ör: 12*7).";
  if (/^[\d+\-*/(). ]+$/.test(t)) { try { return `Sonuç: ${Function(`"use strict";return (${t})`)()} 🧮`; } catch { return "Bu hesabı yapamadım 🤔"; } }
  if (/teşekkür|sağol/.test(t)) return "Rica ederim! 🐼💚";
  return ["Hmm, ilginç! Biraz daha anlatır mısın? 🤔", "Bunu not aldım 📝", "Bambu kadar güzel bir fikir! 🎋", "Anlayamadım ama seni seviyorum 🐼"][Math.floor(Math.random() * 4)];
}

export default function Messages() {
  const t = useTheme();
  const { settings, notify } = useSys();
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useStored<Record<string, Msg[]>>("messages", {
    panda: [{ from: "them", text: "Merhaba! Ben PandaBot 🐼 Bana bir şey yaz!", time: Date.now() }],
    anne: [{ from: "them", text: "Akşam yemeğe gel ❤️", time: Date.now() - 3600000 }],
    po: [{ from: "them", text: "Skadoosh! 💥", time: Date.now() - 86400000 }],
  });
  const [txt, setTxt] = useState("");
  const [typing, setTyping] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, open, typing]);

  const send = () => {
    if (!txt.trim() || !open) return;
    const id = open, text = txt.trim();
    setMsgs((m) => ({ ...m, [id]: [...(m[id] ?? []), { from: "me", text, time: Date.now() }] }));
    setTxt(""); setTyping(true);
    setTimeout(() => {
      const r = reply(id, text, settings.userName);
      setMsgs((m) => ({ ...m, [id]: [...(m[id] ?? []), { from: "them", text: r, time: Date.now() }] }));
      setTyping(false);
      if (id !== "panda" && Math.random() < 0.3) notify({ app: "Mesajlar", icon: "💬", title: CHATS.find((c) => c.id === id)!.name, body: r });
    }, 700 + Math.random() * 900);
  };

  if (open) {
    const chat = CHATS.find((c) => c.id === open)!;
    return (
      <div className={`h-full flex flex-col ${t.bg}`}>
        <div className={`flex items-center gap-3 px-3 py-2 border-b ${t.border}`}>
          <button onClick={() => setOpen(null)} className="text-2xl px-1">←</button>
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xl ${t.card2}`}>{chat.emoji}</div>
          <div><div className="font-medium">{chat.name}</div><div className={`text-xs ${t.muted}`}>{typing ? "yazıyor..." : "çevrimiçi"}</div></div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2">
          {(msgs[open] ?? []).map((m, i) => (
            <div key={i} className={`flex ${m.from === "me" ? "justify-end" : ""}`}>
              <div className={`max-w-[78%] px-3.5 py-2 rounded-2xl ${m.from === "me" ? "text-white rounded-br-sm" : `${t.card2} rounded-bl-sm`}`} style={m.from === "me" ? { background: t.accent } : undefined}>{m.text}</div>
            </div>
          ))}
          {typing && <div className={`inline-block px-4 py-2 rounded-2xl ${t.card2}`}>• • •</div>}
          <div ref={end} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 p-2">
          <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Mesaj yaz..." className={`flex-1 rounded-full px-4 py-2 outline-none ${t.input}`} autoFocus />
          <button className="w-10 h-10 rounded-full text-white" style={{ background: t.accent }}>➤</button>
        </form>
      </div>
    );
  }

  return (
    <AppShell title="Mesajlar">
      {CHATS.map((c) => {
        const last = msgs[c.id]?.[msgs[c.id].length - 1];
        return (
          <button key={c.id} onClick={() => setOpen(c.id)} className="w-full flex items-center gap-3 py-3 text-left">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${t.card2}`}>{c.emoji}</div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between"><span className="font-medium">{c.name}</span><span className={`text-xs ${t.muted}`}>{last && new Date(last.time).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span></div>
              <div className={`text-sm truncate ${t.muted}`}>{last?.from === "me" ? "Sen: " : ""}{last?.text}</div>
            </div>
          </button>
        );
      })}
    </AppShell>
  );
}
