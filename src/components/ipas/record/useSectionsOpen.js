import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { sectionDomId } from "@/components/record/sectionDom";
import { SECTIONS } from "./digest";

const PARAM = "open";
const KEYS = SECTIONS.map((section) => section.key);

/** A `?open=` value that names a section, else null. */
export const openParamKey = (params) => {
  const raw = params.get(PARAM);
  return KEYS.includes(raw) ? raw : null;
};

/** Scrolls a section's block to the top of the view, if it is on the page. */
export function scrollToSection(key) {
  document.getElementById(sectionDomId(key))?.scrollIntoView?.({ block: "start" });
}

/** Scrolls to a sign-off row of 6 · Sign-offs and marks it for a moment. Waits a few frames for the section to draw. */
export function highlightSignoff(key, tries = 20) {
  const row = document.getElementById(`ipas-signoff-${key}`);
  if (!row) {
    if (tries > 0) requestAnimationFrame(() => highlightSignoff(key, tries - 1));
    return;
  }
  row.scrollIntoView?.({ block: "center" });
  row.dataset.highlighted = "true";
  setTimeout(() => {
    delete row.dataset.highlighted;
  }, 2000);
}

/**
 * Which section blocks are open. Several can be, so it is a set; the page keeps
 * it, so the choice survives a trip to the edit view and back. A link with
 * `?open=<section>` opens that section on arrival (see SectionsPanel, which
 * also scrolls to it). `show` opens a section and scrolls to it, for the
 * card's "Review section" and the headline figures. `autoOpen` opens the
 * section that needs the viewer, once, and never when the link named one.
 */
export function useSectionsOpen() {
  const [params] = useSearchParams();
  const param = openParamKey(params);
  const [openKeys, setOpenKeys] = useState(() => new Set(param ? [param] : []));
  const autoDone = useRef(Boolean(param));

  const toggle = useCallback((key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const reveal = useCallback((key) => {
    setOpenKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const show = useCallback(
    (key) => {
      reveal(key);
      scrollToSection(key);
    },
    [reveal],
  );
  // The rail's "Go to sign-off": open 6 · Sign-offs and bring that row into view.
  const showSignoff = useCallback(
    (key) => {
      reveal("signoffs");
      highlightSignoff(key);
    },
    [reveal],
  );
  const openAll = useCallback(() => setOpenKeys(new Set(KEYS)), []);
  const closeAll = useCallback(() => setOpenKeys(new Set()), []);
  const autoOpen = useCallback(
    (key) => {
      if (autoDone.current || !key) return;
      autoDone.current = true;
      reveal(key);
    },
    [reveal],
  );

  return { param, openKeys, toggle, reveal, show, showSignoff, openAll, closeAll, autoOpen };
}
