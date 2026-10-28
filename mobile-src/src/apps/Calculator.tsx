import { useState } from "react";
import { useTheme } from "../os/ui";

function evaluate(expr: string): string {
  const safe = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/%/g, "/100");
  if (!/^[\d+\-*/.() ]*$/.test(safe)) return "Hata";
  try {
    // eslint-disable-next-line no-new-func
    const r = Function(`"use strict";return (${safe})`)();
    if (!isFinite(r)) return "Hata";
    return String(Math.round(r * 1e10) / 1e10);
  } catch { return ""; }
}

export default function Calculator() {
  const t = useTheme();
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const press = (k: string) => {
    if (k === "AC") { setExpr(""); setResult(""); return; }
    if (k === "⌫") { const e = expr.slice(0, -1); setExpr(e); setResult(evaluate(e)); return; }
    if (k === "=") {
      const r = evaluate(expr);
      if (r && r !== "Hata") { setHistory((h) => [`${expr} = ${r}`, ...h].slice(0, 5)); setExpr(r); setResult(""); }
      else setResult("Hata");
      return;
    }
    const e = expr + k;
    setExpr(e);
    const r = evaluate(e);
    setResult(r && r !== e ? r : "");
  };

  const keys = ["AC", "( )", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ".", "⌫", "="];
  return (
    <div className={`h-full flex flex-col ${t.bg}`}>
      <div className="flex-1 flex flex-col justify-end px-6 pb-4 overflow-hidden">
        <div className={`text-xs ${t.muted} text-right space-y-0.5 mb-2`}>{history.map((h, i) => <div key={i}>{h}</div>)}</div>
        <div className="text-right text-5xl font-light break-all leading-tight">{expr || "0"}</div>
        <div className={`text-right text-2xl ${t.muted} h-8`}>{result}</div>
      </div>
      <div className="grid grid-cols-4 gap-3 p-4">
        {keys.map((k) => {
          const op = ["÷", "×", "−", "+", "="].includes(k);
          const fn = ["AC", "( )", "%"].includes(k);
          return (
            <button key={k}
              onClick={() => k === "( )" ? press((expr.split("(").length > expr.split(")").length) ? ")" : "(") : press(k)}
              className={`aspect-square rounded-full text-2xl font-medium active:scale-90 transition ${op ? "text-white" : fn ? t.card2 : t.card}`}
              style={op ? { background: t.accent } : undefined}>
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}
