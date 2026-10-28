import { useEffect, useRef, useState } from "react";
import { useStored, useSys } from "../os/system";

const FILTERS = [
  ["Normal", "none"], ["S/B", "grayscale(1)"], ["Sepya", "sepia(1)"], ["Canlı", "saturate(2) contrast(1.1)"], ["Soğuk", "hue-rotate(180deg)"], ["Ters", "invert(1)"],
] as const;

export default function Camera() {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState(0);
  const [flash, setFlash] = useState(false);
  const [photos, setPhotos] = useStored<string[]>("photos", []);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const { showToast } = useSys();

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; } setErr(""); })
      .catch(() => setErr("Kameraya erişilemedi. Tarayıcı izinlerini kontrol et."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [facing]);

  const shoot = () => {
    setFlash(true); setTimeout(() => setFlash(false), 150);
    const c = document.createElement("canvas");
    const v = video.current;
    const w = 360, h = 480;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.filter = FILTERS[filter][1];
    if (v && v.videoWidth && !err) {
      const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
      const vw = v.videoWidth * scale, vh = v.videoHeight * scale;
      if (facing === "user") { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.drawImage(v, (w - vw) / 2, (h - vh) / 2, vw, vh);
    } else {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, `hsl(${Math.random() * 360},70%,50%)`); g.addColorStop(1, `hsl(${Math.random() * 360},70%,30%)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.font = "120px serif"; ctx.textAlign = "center"; ctx.fillText("🐼", w / 2, h / 2 + 40);
    }
    const url = c.toDataURL("image/jpeg", 0.7);
    setPhotos((p) => [url, ...p].slice(0, 20));
    showToast("📸 Fotoğraf galeriye kaydedildi");
  };

  return (
    <div className="h-full bg-black text-white flex flex-col">
      <div className="flex-1 relative overflow-hidden">
        {err ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 gap-3">
            <div className="text-6xl">📷</div><div className="opacity-70 text-sm">{err}</div><div className="opacity-50 text-xs">Yine de çekim yapabilirsin — demo fotoğraf oluşturulur.</div>
          </div>
        ) : (
          <video ref={video} autoPlay playsInline muted className="w-full h-full object-cover" style={{ filter: FILTERS[filter][1], transform: facing === "user" ? "scaleX(-1)" : undefined }} />
        )}
        {flash && <div className="absolute inset-0 bg-white" />}
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-2">
        {FILTERS.map(([n], i) => <button key={n} onClick={() => setFilter(i)} className={`px-3 py-1 rounded-full text-sm whitespace-nowrap ${i === filter ? "bg-yellow-400 text-black" : "bg-white/10"}`}>{n}</button>)}
      </div>
      <div className="flex items-center justify-around py-5">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 border border-white/30">{photos[0] && <img src={photos[0]} className="w-full h-full object-cover" />}</div>
        <button onClick={shoot} className="w-18 h-18 rounded-full border-4 border-white p-1 active:scale-90 transition"><div className="w-full h-full rounded-full bg-white" /></button>
        <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} className="w-12 h-12 rounded-full bg-white/10 text-xl">🔄</button>
      </div>
    </div>
  );
}
