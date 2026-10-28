import { Fragment, useState } from "react";
import { useStored } from "../os/system";
import { AppShell, useTheme } from "../os/ui";

const ART = Array.from({ length: 12 }, (_, i) => {
  const h1 = (i * 47) % 360, h2 = (i * 47 + 90) % 360;
  const emo = ["🐼", "🎋", "🌸", "🏔️", "🌊", "🌅", "🍜", "🦋", "🌙", "🍃", "🏯", "⭐"][i];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h1},70%,55%)'/><stop offset='1' stop-color='hsl(${h2},70%,30%)'/></linearGradient></defs><rect width='300' height='400' fill='url(#g)'/><circle cx='${60 + i * 17 % 180}' cy='${80 + i * 23 % 200}' r='${40 + i * 7 % 60}' fill='white' opacity='.15'/><text x='150' y='230' font-size='110' text-anchor='middle'>${emo}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
});

export default function Gallery() {
  const t = useTheme();
  const [photos, setPhotos] = useStored<string[]>("photos", []);
  const [open, setOpen] = useState<string | null>(null);
  const all = [...photos, ...ART];

  if (open) {
    const isMine = photos.includes(open);
    return (
      <div className="h-full bg-black flex flex-col">
        <div className="flex justify-between p-3 text-white">
          <button onClick={() => setOpen(null)} className="text-2xl px-2">←</button>
          {isMine && <button onClick={() => { setPhotos((p) => p.filter((x) => x !== open)); setOpen(null); }}>🗑️ Sil</button>}
        </div>
        <div className="flex-1 flex items-center justify-center p-2"><img src={open} className="max-w-full max-h-full rounded-lg" /></div>
      </div>
    );
  }
  return (
    <AppShell title="Galeri">
      {photos.length > 0 && <div className={`text-sm ${t.muted} mb-2`}>Kamera ({photos.length})</div>}
      <div className="grid grid-cols-3 gap-1">
        {all.map((src, i) => (
          <Fragment key={i}>
            {i === photos.length && <div className={`col-span-3 text-sm ${t.muted} mt-3 mb-1`}>Panda Koleksiyonu</div>}
            <button onClick={() => setOpen(src)} className="aspect-square overflow-hidden rounded-md"><img src={src} className="w-full h-full object-cover" /></button>
          </Fragment>
        ))}
      </div>
    </AppShell>
  );
}
