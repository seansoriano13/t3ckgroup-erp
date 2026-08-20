import React from "react";
import { Card } from "@/components/ui/card";

export default function StatCard({ title, value, subtitle, icon, color, onClick }) {
  const colorMap = {
    mauve: "from-mauve-a4 to-transparent",
    amber: "from-amber-a4 to-transparent",
    destructive: "from-red-a4 to-transparent",
    emerald: "from-green-a4 to-transparent",
    slate: "from-slate-a4 to-transparent",
    orange: "from-orange-a4 to-transparent",
    violet: "from-violet-a4 to-transparent",
    blue: "from-blue-a4 to-transparent",
  };

  const valStr = String(value ?? "");
  const valueFontSize =
    valStr.length > 13
      ? "text-2xl"
      : valStr.length > 9
      ? "text-3xl"
      : "text-3xl sm:text-4xl";

  return (
    <Card
      onClick={onClick}
      className={`p-5 md:p-6 relative overflow-hidden transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] group border-border shadow-sm ${
        onClick
          ? "cursor-pointer hover:-translate-y-0.5 active:scale-[0.98]"
          : ""
      }`}
    >
      <div
        className={`absolute top-0 right-0 w-32 h-32 bg-linear-to-br ${colorMap[color] || "from-slate-500/10 to-transparent"} -mr-8 -mt-8 rounded-full blur-2xl group-hover:scale-125 transition-transform duration-500`}
      />

      <div className="flex justify-between items-start gap-2 mb-4 relative z-10">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-1 truncate">
            {title}
          </p>
          <h3
            className={`${valueFontSize} font-extrabold tracking-tight text-foreground tabular-nums truncate`}
            title={valStr}
          >
            {value}
          </h3>
        </div>
        {icon && (
          <div className="shrink-0 p-2.5 rounded-xl bg-muted/50 border border-border group-hover:bg-muted transition-colors">
            {icon}
          </div>
        )}
      </div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest relative z-10 truncate">
        {subtitle}
      </p>
      {onClick && (
        <span className="absolute bottom-3 right-4 text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest group-hover:text-muted-foreground/70 transition-colors">
          View →
        </span>
      )}
    </Card>
  );
}
