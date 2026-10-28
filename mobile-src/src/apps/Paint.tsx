import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { useStored, useSys } from "../os/system";

const COLORS = ["#111827", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#ffffff"];

export default function Paint() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(6);
  const drawing = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const [, setPhotos] = useStored<string[]>("photos", []);
  const { showToast } = useSys();

  const clear = () => { const c = canvas.current!; const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); };
  useEffect(() => {
    const c = canvas.current!; const r = c.getBoundingClientRect();
    c.width = r.width * 2; c.height = r.height * 2; clear();
  }, []);

  const pos = (e: RPE): [number, number] => { const r = canvas.current!.getBoundingClientRect(); return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2]; };
  const draw = (e: RPE) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = pos(e);
    ctx.strokeStyle = color; ctx.lineWidth = size * 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(...(last.current ?? p)); ctx.lineTo(...p); ctx.stroke();
    last.current = p;
  };

  return (
    <div className="h-full flex flex-col bg-neutral-200">
      <div className="flex items-center justify-between px-3 py-2 bg-white">
        <span className="font-semibold">🎨 Çizim</span>
        <div className="flex gap-2">
          <button onClick={clear} className="px-3 py-1 rounded-full bg-neutral-100 text-sm">Temizle</button>
          <button onClick={() => { setPhotos((p) => [canvas.current!.toDataURL("image/jpeg", 0.7), ...p].slice(0, 20)); showToast("🎨 Çizim galeriye kaydedildi"); }} className="px-3 py-1 rounded-full bg-neutral-900 text-white text-sm">Kaydet</button>
        </div>
      </div>
      <canvas ref={canvas} className="flex-1 w-full touch-none bg-white m-0"
        onPointerDown={(e) => { drawing.current = true; last.current = null; (e.target as HTMLElement).setPointerCapture(e.pointerId); draw(e); }}
        onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} />
      <div className="bg-white px-3 py-3 space-y-2">
        <div className="flex justify-between">
          {COLORS.map((c) => <button key={c} onClick={() => setColor(c)} className="w-8 h-8 rounded-full border-2" style={{ background: c, borderColor: c === color ? "#000" : "#ddd", transform: c === color ? "scale(1.2)" : undefined }} />)}
        </div>
        <input type="range" min={1} max={30} value={size} onChange={(e) => setSize(+e.target.value)} className="w-full" />
      </div>
    </div>
  );
}
