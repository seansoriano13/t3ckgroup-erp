import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { systemUpdateService } from "../services/systemUpdateService";
import {
  Megaphone,
  Rocket,
  Wrench,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const TYPE_OPTIONS = [
  {
    value: "announcement",
    label: "Announcement",
    icon: Megaphone,
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
  },
  {
    value: "feature",
    label: "New Feature",
    icon: Rocket,
    color: "text-violet-10",
    bg: "bg-violet-2 border-mauve-3",
  },
  {
    value: "fix",
    label: "System Fix",
    icon: Wrench,
    color: "text-green-10",
    bg: "bg-green-2 border-green-4",
  },
];

export default function SystemUpdateBanner() {
  const { data: updates = [], isLoading } = useQuery({
    queryKey: ["activeSystemUpdates"],
    queryFn: () => systemUpdateService.getActiveUpdates(),
  });

  if (isLoading || updates.length === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      {updates.map((update) => (
        <BannerItem key={update.id} update={update} />
      ))}
    </div>
  );
}

function BannerItem({ update }) {
  const [isMinimized, setIsMinimized] = useState(() => {
    return localStorage.getItem(`banner_collapsed_${update.id}`) === "true";
  });

  const handleToggle = () => {
    const next = !isMinimized;
    setIsMinimized(next);
    localStorage.setItem(`banner_collapsed_${update.id}`, String(next));
  };

  const typeOpt = TYPE_OPTIONS.find((t) => t.value === update.type) ?? TYPE_OPTIONS[0];
  const Icon = typeOpt.icon;

  return (
    <div className="flex gap-3 bg-muted/20 border border-border/60 rounded-xl p-3 animate-in fade-in slide-in-from-top-2">
      {/* Type icon */}
      <div className={`mt-0.5 w-8 h-8 rounded-lg shrink-0 flex items-center justify-center border ${typeOpt.bg}`}>
        <Icon size={14} className={typeOpt.color} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div
          className="flex items-center justify-between gap-2 mb-1 cursor-pointer select-none group"
          onClick={handleToggle}
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
              {typeOpt.label}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {new Date(update.created_at).toLocaleDateString()}
            </span>
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border bg-green-9/10 text-green-9 border-green-9/20">
              Live
            </span>
          </div>
          <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors">
            {isMinimized ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>

        {/* Collapsible content */}
        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out text-xs text-foreground/80 leading-relaxed ${
            isMinimized ? "max-h-0 opacity-0" : "max-h-[500px] opacity-100"
          }`}
        >
          <ReactMarkdown
            components={{
              p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
              ul: ({ ...props }) => (
                <ul className="list-disc pl-4 mb-2" {...props} />
              ),
              li: ({ ...props }) => <li {...props} />,
              strong: ({ ...props }) => (
                <strong className="font-semibold" {...props} />
              ),
            }}
          >
            {update.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
