import React from "react";
import { cn } from "@/lib/utils";

/**
 * A section heading inside a Page (DESIGN.md "Pages → Section headings"): a
 * Sentence-case title, an optional one-line description, the section's actions
 * on the right. `rangeLabel` trails the title when the section follows the
 * Page's time range.
 */
const SectionHeader = ({ title, description, rangeLabel, children, className }) => {
  return (
    <div className={cn("flex flex-col justify-between gap-3 border-b border-border pb-3 md:flex-row md:items-end", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          {title}
          {rangeLabel && <span className="font-normal text-muted-foreground">— {rangeLabel}</span>}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>

      {children && <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
};

export default SectionHeader;
