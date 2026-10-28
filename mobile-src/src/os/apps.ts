import type { ComponentType } from "react";
import Calculator from "../apps/Calculator";
import Notes from "../apps/Notes";
import Clock from "../apps/Clock";
import Settings from "../apps/Settings";
import Weather from "../apps/Weather";
import Calendar from "../apps/Calendar";
import Camera from "../apps/Camera";
import Gallery from "../apps/Gallery";
import Paint from "../apps/Paint";
import Music from "../apps/Music";
import Phone from "../apps/Phone";
import Messages from "../apps/Messages";
import Browser from "../apps/Browser";
import Snake from "../apps/Snake";

export interface AppDef { id: string; name: string; icon: string; bg: string; component: ComponentType; light?: boolean; keepAlive?: boolean }

export const APPS: AppDef[] = [
  { id: "phone", name: "Telefon", icon: "📞", bg: "linear-gradient(135deg,#22c55e,#15803d)", component: Phone },
  { id: "messages", name: "Mesajlar", icon: "💬", bg: "linear-gradient(135deg,#3b82f6,#1d4ed8)", component: Messages },
  { id: "browser", name: "PandaWeb", icon: "🌐", bg: "linear-gradient(135deg,#f97316,#c2410c)", component: Browser },
  { id: "camera", name: "Kamera", icon: "📷", bg: "linear-gradient(135deg,#475569,#0f172a)", component: Camera, keepAlive: false, light: true },
  { id: "gallery", name: "Galeri", icon: "🖼️", bg: "linear-gradient(135deg,#ec4899,#be185d)", component: Gallery },
  { id: "music", name: "Müzik", icon: "🎵", bg: "linear-gradient(135deg,#a855f7,#6b21a8)", component: Music, light: true },
  { id: "weather", name: "Hava", icon: "⛅", bg: "linear-gradient(135deg,#38bdf8,#0369a1)", component: Weather, light: true },
  { id: "clock", name: "Saat", icon: "⏰", bg: "linear-gradient(135deg,#1e293b,#020617)", component: Clock },
  { id: "calendar", name: "Takvim", icon: "📅", bg: "linear-gradient(135deg,#f43f5e,#be123c)", component: Calendar },
  { id: "notes", name: "Notlar", icon: "📝", bg: "linear-gradient(135deg,#facc15,#ca8a04)", component: Notes },
  { id: "calculator", name: "Hesap Mak.", icon: "🧮", bg: "linear-gradient(135deg,#64748b,#334155)", component: Calculator },
  { id: "paint", name: "Çizim", icon: "🎨", bg: "linear-gradient(135deg,#14b8a6,#0f766e)", component: Paint },
  { id: "snake", name: "Yılan", icon: "🐍", bg: "linear-gradient(135deg,#84cc16,#3f6212)", component: Snake, light: true },
  { id: "settings", name: "Ayarlar", icon: "⚙️", bg: "linear-gradient(135deg,#6b7280,#374151)", component: Settings },
];

export const DOCK = ["phone", "messages", "browser", "camera"];
export const getApp = (id: string) => APPS.find((a) => a.id === id)!;
