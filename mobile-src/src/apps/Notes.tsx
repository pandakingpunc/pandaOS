import { useState } from "react";
import { useStored } from "../os/system";
import { AppShell, useTheme } from "../os/ui";

interface Note { id: number; title: string; body: string; color: string; updated: number }
const COLORS = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe", "#fed7aa"];

export default function Notes() {
  const t = useTheme();
  const [notes, setNotes] = useStored<Note[]>("notes", [
    { id: 1, title: "PandamOS'a hoş geldin 🐼", body: "Bu bir not uygulaması. Notların tarayıcında saklanır.", color: COLORS[0], updated: Date.now() },
  ]);
  const [editing, setEditing] = useState<number | null>(null);
  const [q, setQ] = useState("");

  const note = notes.find((n) => n.id === editing);
  const upd = (p: Partial<Note>) => setNotes((l) => l.map((n) => (n.id === editing ? { ...n, ...p, updated: Date.now() } : n)));

  if (note) {
    return (
      <div className="h-full flex flex-col text-neutral-900" style={{ background: note.color }}>
        <div className="flex items-center justify-between px-3 py-2">
          <button onClick={() => setEditing(null)} className="px-3 py-1 text-lg">←</button>
          <div className="flex gap-1.5">
            {COLORS.map((c) => <button key={c} onClick={() => upd({ color: c })} className="w-6 h-6 rounded-full border-2" style={{ background: c, borderColor: c === note.color ? "#111" : "transparent" }} />)}
          </div>
          <button onClick={() => { setNotes((l) => l.filter((n) => n.id !== note.id)); setEditing(null); }} className="px-3 py-1">🗑️</button>
        </div>
        <input value={note.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Başlık" className="bg-transparent px-5 text-2xl font-semibold outline-none placeholder-neutral-500" />
        <textarea value={note.body} onChange={(e) => upd({ body: e.target.value })} placeholder="Not yaz..." className="flex-1 bg-transparent px-5 py-3 outline-none resize-none placeholder-neutral-500" autoFocus />
      </div>
    );
  }

  const list = notes.filter((n) => (n.title + n.body).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.updated - a.updated);
  return (
    <AppShell title="Notlar">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Notlarda ara" className={`w-full rounded-full px-4 py-2 mb-3 outline-none ${t.input}`} />
      <div className="columns-2 gap-3">
        {list.map((n) => (
          <button key={n.id} onClick={() => setEditing(n.id)} className="w-full mb-3 break-inside-avoid rounded-2xl p-3 text-left text-neutral-900" style={{ background: n.color }}>
            <div className="font-semibold">{n.title || "Başlıksız"}</div>
            <div className="text-sm opacity-75 line-clamp-6 whitespace-pre-wrap">{n.body}</div>
          </button>
        ))}
      </div>
      {list.length === 0 && <p className={`text-center mt-10 ${t.muted}`}>Not yok</p>}
      <button onClick={() => { const id = Date.now(); setNotes((l) => [{ id, title: "", body: "", color: COLORS[Math.floor(Math.random() * COLORS.length)], updated: id }, ...l]); setEditing(id); }}
        className="absolute bottom-6 right-6 w-14 h-14 rounded-2xl text-white text-3xl shadow-lg" style={{ background: t.accent }}>+</button>
    </AppShell>
  );
}
