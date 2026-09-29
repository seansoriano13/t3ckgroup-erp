import * as React from "react";

// Anchor for URLs outside the app. Always opens in a new tab without leaking
// window.opener or the referrer. Internal links use the router Link.
function ExternalLink({ rel, ...props }) {
  const safeRel = ["noopener", "noreferrer", ...(rel ? rel.split(/\s+/) : [])];
  return (
    <a
      data-slot="external-link"
      target="_blank"
      {...props}
      rel={[...new Set(safeRel)].join(" ")}
    />
  );
}

export { ExternalLink };
