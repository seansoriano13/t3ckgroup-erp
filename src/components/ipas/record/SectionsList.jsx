import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SECTIONS, sectionState } from "./digest";
import { StateWord } from "./StateMark";

/**
 * The open and close of a short section, in place: the same `.reveal` the
 * page's collapsibles use (grid rows 0fr to 1fr, eased; reduced motion is
 * handled globally). The body stays mounted so the row has real content to
 * animate to; `inert` keeps it out of the tab order while shut, and
 * `data-settled` lifts the clip once the panel has finished opening, so focus
 * rings inside it are not cut off.
 */
function Reveal({ open, id, children }) {
  // The state the panel last finished moving to. It is "settled" only when that is the current state.
  const [settledFor, setSettledFor] = useState(open);
  const settled = settledFor === open;
  return (
    <div
      className="reveal"
      data-open={open}
      data-settled={settled}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setSettledFor(open);
      }}
    >
      <div id={id} inert={!open}>
        <div className="reveal-body border-t border-border px-4 pt-4 pb-5">{children}</div>
      </div>
    </div>
  );
}

function Row({ section, digest, onOpen, rowRef, expanded, body }) {
  const state = sectionState(section.key, digest);
  const panelId = useId();
  const summary = digest.lines[section.key];
  // A waiting Filing row already says "Opens once …" as its detail: say it once.
  const repeatsDetail = Boolean(state?.detail) && state.detail === summary;
  return (
    <li>
      <Button
        ref={rowRef(section.key)}
        variant="ghost"
        onClick={() => onOpen(section.key)}
        aria-expanded={section.inPlace ? expanded : undefined}
        aria-controls={section.inPlace ? panelId : undefined}
        className="group/row h-auto w-full min-w-0 justify-start gap-3 rounded-none px-4 py-3 text-left font-normal whitespace-normal hover:bg-muted/50"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-foreground">{section.title}</span>
            {state && <StateWord state={state.state} detail={state.detail} />}
          </span>
          {!repeatsDetail && <span className="text-sm text-muted-foreground">{summary}</span>}
        </span>
        <ChevronRight
          size={16}
          aria-hidden="true"
          className={cn(
            "mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200",
            section.inPlace ? (expanded ? "rotate-90" : "") : "group-hover/row:translate-x-0.5",
          )}
        />
      </Button>
      {section.inPlace && (
        <Reveal open={expanded} id={panelId}>
          {body}
        </Reveal>
      )}
    </li>
  );
}

function Group({ title, sections, inPlace, bodies, ...rowProps }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {/* No overflow-hidden here: it would clip the focus ring of the rows. */}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {sections.map((section) => (
          <Row
            key={section.key}
            section={section}
            expanded={inPlace === section.key}
            body={bodies[section.key]}
            {...rowProps}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Every section as a row: the title with its state word and detail, then a
 * summary that wraps. Money and sign-offs first, everything else under them.
 * A row opens its section in the drawer, or, for a short section, expands it
 * under the row (`inPlace` names the open one; `bodies[key]` is its body).
 * `rowRef(key)` is the ref for that row, so the page can hand focus back to it.
 */
export default function SectionsList({ digest, onOpen, rowRef, inPlace = null, bodies = {} }) {
  const rowProps = { digest, onOpen, rowRef, inPlace, bodies };
  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-foreground">Sections</h2>
      <Group title="Money and sign-offs" sections={SECTIONS.filter((section) => !section.secondary)} {...rowProps} />
      <Group title="Everything else" sections={SECTIONS.filter((section) => section.secondary)} {...rowProps} />
    </div>
  );
}
