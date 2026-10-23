import { useState } from "react";

/**
 * Opens a panel in place with the page's `.reveal` grid-rows pattern. The body
 * stays mounted (the row needs real content to animate to); `inert` and
 * `aria-hidden` keep it out of the tab order and the accessibility tree while
 * shut, and `data-settled` lifts the clip once the panel has finished moving so
 * focus rings inside it are not cut off.
 */
export default function Reveal({ open, id, className = "", children }) {
  // The state the panel last finished moving to; "settled" only when that is the current state.
  const [settledFor, setSettledFor] = useState(open);
  return (
    <div
      className="reveal"
      data-open={open}
      data-settled={settledFor === open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setSettledFor(open);
      }}
    >
      <div id={id} inert={!open} aria-hidden={!open}>
        <div className={`reveal-body ${className}`}>{children}</div>
      </div>
    </div>
  );
}
