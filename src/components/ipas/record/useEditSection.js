import { useSearchParams } from "react-router";

import { SECTIONS } from "./digest";

const PARAM = "edit";

/**
 * The section open in the edit view, kept in `?edit=<key>`. Entering it from
 * the drawer replaces the `?open=` entry, so the history reads [overview,
 * overview with ?edit=] and Back lands on the overview; entering it any other
 * way pushes an entry. Leaving (its link, or Back) replaces the entry. Entering
 * it drops `?open=`: the drawer closes as the view opens. Leaving (its link, or
 * Back) replaces the entry and lands on that section's `?open=` (its drawer, or
 * expanded under its row), where the person was before editing.
 */
export function useEditSection() {
  const [params, setParams] = useSearchParams();
  const raw = params.get(PARAM);
  const key = SECTIONS.some((section) => section.key === raw) ? raw : null;

  const write = (next, { replace, openKey = null }) =>
    setParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (next) {
          nextParams.set(PARAM, next);
          nextParams.delete("open");
        } else {
          nextParams.delete(PARAM);
          if (openKey) nextParams.set("open", openKey);
        }
        return nextParams;
      },
      { replace },
    );

  return {
    key,
    edit: (next) => write(next, { replace: params.has("open") }),
    // `openKey` is the section whose drawer comes back; without it the overview shows.
    leave: (openKey = null) => write(null, { replace: true, openKey }),
  };
}
