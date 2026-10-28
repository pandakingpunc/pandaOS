import type { ReactNode } from "react";
import { useSys } from "./system";

export function useTheme() {
  const { settings } = useSys();
  const d = settings.dark;
  return {
    dark: d,
    accent: settings.accent,
    bg: d ? "bg-neutral-950 text-white" : "bg-neutral-50 text-neutral-900",
    card: d ? "bg-neutral-900" : "bg-white shadow-sm",
    card2: d ? "bg-neutral-800" : "bg-neutral-100",
    muted: d ? "text-neutral-400" : "text-neutral-500",
    border: d ? "border-neutral-800" : "border-neutral-200",
    input: d ? "bg-neutral-900 text-white placeholder-neutral-500" : "bg-white text-neutral-900 placeholder-neutral-400 border border-neutral-200",
  };
}

export function AppShell({ title, children, right, className = "", noPad }: { title?: string; children: ReactNode; right?: ReactNode; className?: string; noPad?: boolean }) {
  const t = useTheme();
  return (
    <div className={`h-full flex flex-col ${t.bg} ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <div>{right}</div>
        </div>
      )}
      <div className={`flex-1 overflow-y-auto no-scrollbar ${noPad ? "" : "px-4 pb-4"}`}>{children}</div>
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const { settings } = useSys();
  return (
    <button onClick={() => onChange(!on)} className="w-11 h-6 rounded-full relative transition-colors shrink-0" style={{ background: on ? settings.accent : "#6b7280" }}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? "left-5.5" : "left-0.5"}`} />
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: string }[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <div className={`flex border-t ${t.border} shrink-0`}>
      {tabs.map((x) => (
        <button key={x.id} onClick={() => onChange(x.id)} className="flex-1 py-2 flex flex-col items-center text-xs gap-0.5" style={{ color: value === x.id ? t.accent : undefined, opacity: value === x.id ? 1 : 0.6 }}>
          {x.icon && <span className="text-lg">{x.icon}</span>}
          {x.label}
        </button>
      ))}
    </div>
  );
}
