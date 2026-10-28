import { useEffect, useState } from "react";

const CITIES = [
  { name: "İstanbul", lat: 41.01, lon: 28.97 },
  { name: "Ankara", lat: 39.93, lon: 32.86 },
  { name: "İzmir", lat: 38.42, lon: 27.14 },
  { name: "Antalya", lat: 36.9, lon: 30.7 },
  { name: "Trabzon", lat: 41.0, lon: 39.72 },
];

const codeInfo = (c: number): [string, string] => {
  if (c === 0) return ["☀️", "Açık"];
  if (c <= 2) return ["⛅", "Parçalı bulutlu"];
  if (c === 3) return ["☁️", "Bulutlu"];
  if (c <= 48) return ["🌫️", "Sisli"];
  if (c <= 67) return ["🌧️", "Yağmurlu"];
  if (c <= 77) return ["❄️", "Karlı"];
  if (c <= 82) return ["🌦️", "Sağanak"];
  return ["⛈️", "Fırtına"];
};

interface W { temp: number; code: number; wind: number; hum: number; hourly: { t: string; temp: number; code: number }[]; daily: { d: string; max: number; min: number; code: number }[] }

function fake(seed: number): W {
  const r = (n: number) => Math.abs(Math.sin(seed * 9.1 + n * 3.7));
  const now = new Date();
  return {
    temp: Math.round(10 + r(1) * 18), code: [0, 2, 3, 61, 80][Math.floor(r(2) * 5)], wind: Math.round(r(3) * 25), hum: Math.round(40 + r(4) * 50),
    hourly: Array.from({ length: 24 }, (_, i) => ({ t: `${(now.getHours() + i) % 24}:00`, temp: Math.round(10 + r(i + 5) * 15), code: [0, 2, 3, 61][Math.floor(r(i) * 4)] })),
    daily: Array.from({ length: 7 }, (_, i) => ({ d: new Date(Date.now() + i * 864e5).toISOString(), max: Math.round(18 + r(i + 30) * 10), min: Math.round(6 + r(i + 40) * 8), code: [0, 2, 3, 61, 80][Math.floor(r(i + 50) * 5)] })),
  };
}

export default function Weather() {
  const [city, setCity] = useState(0);
  const [w, setW] = useState<W | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setW(null);
    const c = CITIES[city];
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`)
      .then((r) => r.json())
      .then((d) => {
        const h0 = d.hourly.time.findIndex((x: string) => new Date(x) >= new Date(Date.now() - 3600000));
        setW({
          temp: Math.round(d.current.temperature_2m), code: d.current.weather_code, wind: Math.round(d.current.wind_speed_10m), hum: d.current.relative_humidity_2m,
          hourly: d.hourly.time.slice(h0, h0 + 24).map((t: string, i: number) => ({ t: t.slice(11, 16), temp: Math.round(d.hourly.temperature_2m[h0 + i]), code: d.hourly.weather_code[h0 + i] })),
          daily: d.daily.time.map((t: string, i: number) => ({ d: t, max: Math.round(d.daily.temperature_2m_max[i]), min: Math.round(d.daily.temperature_2m_min[i]), code: d.daily.weather_code[i] })),
        });
        setOffline(false);
      })
      .catch(() => { setW(fake(city + 1)); setOffline(true); });
  }, [city]);

  const [icon, desc] = w ? codeInfo(w.code) : ["", ""];
  const night = new Date().getHours() >= 19 || new Date().getHours() < 6;
  const bg = night ? "linear-gradient(180deg,#0f172a,#312e81)" : w && w.code >= 51 ? "linear-gradient(180deg,#334155,#64748b)" : "linear-gradient(180deg,#0284c7,#7dd3fc)";

  return (
    <div className="h-full overflow-y-auto no-scrollbar text-white" style={{ background: bg }}>
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pt-3">
        {CITIES.map((c, i) => (
          <button key={c.name} onClick={() => setCity(i)} className={`px-3 py-1 rounded-full text-sm whitespace-nowrap ${i === city ? "bg-white text-sky-900" : "bg-white/20"}`}>{c.name}</button>
        ))}
      </div>
      {!w ? <div className="text-center mt-32 text-5xl animate-bounce">⛅</div> : (
        <div className="px-4 pb-6">
          <div className="text-center mt-8">
            <div className="text-2xl">{CITIES[city].name}</div>
            <div className="text-8xl font-thin">{w.temp}°</div>
            <div className="text-xl">{icon} {desc}</div>
            <div className="opacity-80">Y: {w.daily[0].max}° D: {w.daily[0].min}°</div>
            {offline && <div className="text-xs opacity-60 mt-1">(çevrimdışı tahmini veri)</div>}
          </div>
          <div className="bg-white/15 backdrop-blur rounded-3xl p-4 mt-8">
            <div className="text-xs uppercase opacity-70 mb-2">Saatlik tahmin</div>
            <div className="flex gap-5 overflow-x-auto no-scrollbar">
              {w.hourly.map((h, i) => (
                <div key={i} className="flex flex-col items-center gap-1 shrink-0"><span className="text-xs">{i === 0 ? "Şimdi" : h.t}</span><span className="text-2xl">{codeInfo(h.code)[0]}</span><span>{h.temp}°</span></div>
              ))}
            </div>
          </div>
          <div className="bg-white/15 backdrop-blur rounded-3xl p-4 mt-4">
            <div className="text-xs uppercase opacity-70 mb-2">7 günlük tahmin</div>
            {w.daily.map((d, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/10 last:border-0">
                <span className="w-20">{i === 0 ? "Bugün" : new Date(d.d).toLocaleDateString("tr-TR", { weekday: "short" })}</span>
                <span className="text-xl">{codeInfo(d.code)[0]}</span>
                <span className="w-24 text-right"><span className="opacity-60">{d.min}°</span> / {d.max}°</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-white/15 rounded-3xl p-4"><div className="text-xs opacity-70">💨 RÜZGAR</div><div className="text-3xl">{w.wind} <span className="text-base">km/s</span></div></div>
            <div className="bg-white/15 rounded-3xl p-4"><div className="text-xs opacity-70">💧 NEM</div><div className="text-3xl">%{w.hum}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
