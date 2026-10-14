import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import Dot from "@/components/ui/Dot";
import { SECTIONS, sectionBadge, sectionDot } from "./digest";
import { DOT_LEGEND, Pill, StateDot } from "./parts";

/** What the three dot colours mean, in one line. */
function DotLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {DOT_LEGEND.map(({ tone, word, color }) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <Dot size="size-2" color={color} aria-hidden="true" />
          {word}
        </span>
      ))}
    </p>
  );
}

function Row({ section, digest, ipas, onOpen, rowRef }) {
  return (
    <li>
      <Button
        ref={rowRef(section.key)}
        variant="ghost"
        onClick={() => onOpen(section.key)}
        className="group/row h-auto w-full min-w-0 justify-start gap-3 rounded-none px-4 py-3 text-left font-normal whitespace-normal hover:bg-muted/50"
      >
        <span className="mt-1.5 flex shrink-0 self-start">
          <StateDot tone={sectionDot(section.key, digest)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-foreground">{section.title}</span>
            <Pill badge={sectionBadge(section.key, digest, ipas)} />
          </span>
          <span className="text-sm text-muted-foreground">{digest.lines[section.key]}</span>
        </span>
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/row:translate-x-0.5"
        />
      </Button>
    </li>
  );
}

function Group({ title, sections, ...rowProps }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {/* No overflow-hidden here: it would clip the focus ring of the rows. */}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {sections.map((section) => (
          <Row key={section.key} section={section} {...rowProps} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Every section as a row of two lines: the title with its state word, then a
 * summary that wraps. Money and sign-offs first, everything else under them.
 * A row opens its section in the drawer. `rowRef(key)` is the ref for that row,
 * so the page knows each row's element and can hand focus back to it.
 */
export default function SectionsList({ ipas, digest, onOpen, rowRef }) {
  const rowProps = { ipas, digest, onOpen, rowRef };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Sections</h2>
        <DotLegend />
      </div>
      <Group title="Money and sign-offs" sections={SECTIONS.filter((section) => !section.secondary)} {...rowProps} />
      <Group title="Everything else" sections={SECTIONS.filter((section) => section.secondary)} {...rowProps} />
    </div>
  );
}
