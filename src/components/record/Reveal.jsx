import { useState } from "react";

/**
 * Opens a panel in place with the page's `.reveal` grid-rows pattern. The body
 * stays mounted (the row needs real content to animate to); `inert` and
 * `aria-hidden` keep it out of the tab order and the accessibility tree while
 * shut, and `data-settled` lifts the clip once the panel has finished moving so
 * focus rings inside it are not cut off.
 */
export default function Reveal({ open, id, className = "", children }) {
  // Whether the panel has finished opening. A shut panel is never settled, so its clip stays on.
  const [finishedOpening, setFinishedOpening] = useState(open);
  return (
    <div
      className="reveal"
      data-open={open}
      data-settled={open && finishedOpening}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setFinishedOpening(open);
      }}
    >
      <div id={id} inert={!open} aria-hidden={!open}>
        <div className={`reveal-body ${className}`}>{children}</div>
      </div>
    </div>
  );
}
