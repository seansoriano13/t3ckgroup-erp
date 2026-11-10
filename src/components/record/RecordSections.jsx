import { useEffect, useId, useState } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sectionDomId } from "./sectionDom";
import { StateWord } from "./StateMark";

/**
 * The open and close of a section, in place: the same `.reveal` the page's
 * collapsibles use (grid rows 0fr to 1fr, eased; reduced motion is handled
 * globally). The body stays mounted once it has been shown, so closing has
 * real content to animate from; `inert` keeps it out of the tab order while
 * shut, and `data-settled` lifts the clip once the panel has finished moving,
 * so focus rings inside it are not cut off.
 *
 * A section that has never been open mounts nothing. Its first opening mounts
 * the body, then opens the panel on the next frame: mounting and opening in
 * one commit makes the browser measure an empty row and animate 0px to 0px.
 */
function Reveal({ open, id, children }) {
  // The body is mounted from the first time it opens on.
  const [rendered, setRendered] = useState(open);
  if (open && !rendered) setRendered(true);
  // The panel follows `open` one frame later, so a body that has just mounted has a height to animate to.
  const [shown, setShown] = useState(open);
  // The state the panel last finished moving to. It is "settled" only when that is the state it is now in.
  const [settledFor, setSettledFor] = useState(open);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(open));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div
      className="reveal grid-cols-[minmax(0,1fr)]"
      data-open={shown}
      data-settled={settledFor === shown}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setSettledFor(shown);
      }}
    >
      <div id={id} inert={!open} className="min-w-0">
        <div className="reveal-body min-w-0 border-t border-border px-4 pt-4 pb-5">{rendered ? children : null}</div>
      </div>
    </div>
  );
}

function Block({ section, state, summary, open, onToggle, headRef, body, footer }) {
  const panelId = useId();
  // A waiting Filing row already says "Opens once …" as its detail: say it once.
  const repeatsDetail = Boolean(state?.detail) && state.detail === summary;
  return (
    <li id={sectionDomId(section.key)} className="min-w-0 scroll-mt-4">
      <section aria-label={section.title}>
        <h4>
          <Button
            ref={headRef}
            variant="ghost"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="h-auto w-full min-w-0 justify-start gap-3 rounded-none px-4 py-3 text-left font-normal whitespace-normal hover:bg-muted/50"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-foreground">{section.title}</span>
                {state && <StateWord state={state.state} detail={state.detail} />}
              </span>
              {!repeatsDetail && <span className="text-sm break-words text-muted-foreground">{summary}</span>}
            </span>
            <ChevronRight
              size={16}
              aria-hidden="true"
              className={cn(
                "mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out-expo",
                open && "rotate-90",
              )}
            />
          </Button>
        </h4>
        <Reveal open={open} id={panelId}>
          {body}
          {footer}
        </Reveal>
      </section>
    </li>
  );
}

/**
 * A record's sections as collapsible blocks that open in place, several at
 * once. Each block's header is its title with its state word and detail, then
 * a summary that wraps. `groups` is `[{ title?, sections }]` in list order; a
 * section is `{ key, title }`. `openKeys` is the Set of open keys and
 * `onToggle(key)` flips one; Open all and Close all sit beside the heading.
 * `stateOf(key)` is `{ state, detail }` or null; `summaryOf(key)` the line
 * under the title; `bodyOf(key)` the body; `footerOf(key)` an optional foot
 * (a section's moves and its Edit). `headRef(key)` is the ref for that
 * block's header button, so a page can hand focus back to it.
 */
export default function RecordSections({
  groups,
  openKeys,
  onToggle,
  onOpenAll,
  onCloseAll,
  stateOf,
  summaryOf,
  bodyOf,
  footerOf = () => null,
  headRef = () => undefined,
}) {
  const total = groups.reduce((count, group) => count + group.sections.length, 0);
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold text-foreground">Sections</h2>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onOpenAll} disabled={openKeys.size >= total}>
            Open all
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onCloseAll} disabled={openKeys.size === 0}>
            Close all
          </Button>
        </div>
      </div>
      {groups.map((group, index) => (
        <div key={group.title ?? index} className="space-y-2">
          {group.title && <h3 className="text-sm font-semibold text-muted-foreground">{group.title}</h3>}
          {/* No overflow-hidden here: it would clip the focus ring of the headers. */}
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {group.sections.map((section) => (
              <Block
                key={section.key}
                section={section}
                state={stateOf(section.key)}
                summary={summaryOf(section.key)}
                open={openKeys.has(section.key)}
                onToggle={() => onToggle(section.key)}
                headRef={headRef(section.key)}
                body={bodyOf(section.key)}
                footer={footerOf(section.key)}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
