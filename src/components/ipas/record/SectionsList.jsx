import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SECTIONS, sectionState } from "./digest";
import { StateDot, StateWord } from "./StateMark";
import { STATE, STATE_WORD } from "./statePalette";

/** What the three states mean, in one line. */
function StateLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {[STATE.DONE, STATE.CURRENT, STATE.WAITING].map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <StateDot state={state} />
          {STATE_WORD[state]}
        </span>
      ))}
    </p>
  );
}

function Row({ section, digest, onOpen, rowRef }) {
  const state = sectionState(section.key, digest);
  return (
    <li>
      <Button
        ref={rowRef(section.key)}
        variant="ghost"
        onClick={() => onOpen(section.key)}
        className="group/row h-auto w-full min-w-0 justify-start gap-3 rounded-none px-4 py-3 text-left font-normal whitespace-normal hover:bg-muted/50"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-foreground">{section.title}</span>
            {state && <StateWord state={state.state} detail={state.detail} />}
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
 * Every section as a row: the title with its state word and detail, then a
 * summary that wraps. Money and sign-offs first, everything else under them.
 * A row opens its section in the drawer. `rowRef(key)` is the ref for that row,
 * so the page knows each row's element and can hand focus back to it.
 */
export default function SectionsList({ digest, onOpen, rowRef }) {
  const rowProps = { digest, onOpen, rowRef };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Sections</h2>
        <StateLegend />
      </div>
      <Group title="Money and sign-offs" sections={SECTIONS.filter((section) => !section.secondary)} {...rowProps} />
      <Group title="Everything else" sections={SECTIONS.filter((section) => section.secondary)} {...rowProps} />
    </div>
  );
}
