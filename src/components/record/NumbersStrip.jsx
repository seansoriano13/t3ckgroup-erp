import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The record's headline numbers, the only place they show on the page. A stat
 * is `{ key, label, value, sub?, tone?, onOpen? }`; one with `onOpen` is a
 * button that opens the section it comes from. `tone` "warning" paints the
 * value in the warning colour. Values may wrap at narrow widths but never
 * overflow their column.
 */
export default function NumbersStrip({ stats }) {
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-border pb-5 sm:grid-cols-4">
      {stats.map((stat) => {
        const value = (
          <span
            className={cn(
              "mt-0.5 block max-w-full min-w-0 font-mono text-lg font-semibold tracking-tight tabular-nums break-words",
              stat.tone === "warning" ? "text-amber-11" : "text-foreground",
            )}
          >
            {stat.value}
          </span>
        );
        return (
          <li key={stat.key ?? stat.label} className="min-w-0">
            {stat.onOpen ? (
              <Button
                variant="ghost"
                onClick={stat.onOpen}
                className="group/stat h-auto w-full min-w-0 flex-col items-start justify-start gap-0 rounded-sm p-0 text-left font-normal whitespace-normal hover:bg-transparent"
              >
                <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover/stat:text-foreground">
                  {stat.label}
                  <ArrowUpRight aria-hidden="true" className="size-3 opacity-40 group-hover/stat:opacity-100" />
                </span>
                {value}
                {stat.sub && <span className="block text-xs text-muted-foreground">{stat.sub}</span>}
              </Button>
            ) : (
              <div className="flex flex-col items-start">
                <span className="text-xs text-muted-foreground">{stat.label}</span>
                {value}
                {stat.sub && <span className="block text-xs text-muted-foreground">{stat.sub}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
