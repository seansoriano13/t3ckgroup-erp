import { useSearchParams } from "react-router";

import { SECTIONS } from "./digest";

const PARAM = "edit";

/**
 * The section open in the edit view, kept in `?edit=<key>`. Entering it pushes
 * a history entry, so Back leaves it; leaving (its link, or Back) replaces the
 * entry. Entering it also drops `?open=`: the drawer closes as the view opens.
 */
export function useEditSection() {
  const [params, setParams] = useSearchParams();
  const raw = params.get(PARAM);
  const key = SECTIONS.some((section) => section.key === raw) ? raw : null;

  const write = (next, { replace }) =>
    setParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (next) {
          nextParams.set(PARAM, next);
          nextParams.delete("open");
        } else {
          nextParams.delete(PARAM);
        }
        return nextParams;
      },
      { replace },
    );

  return {
    key,
    edit: (next) => write(next, { replace: false }),
    leave: () => write(null, { replace: true }),
  };
}
