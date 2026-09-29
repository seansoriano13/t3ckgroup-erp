import { createContext, useCallback, useContext, useRef } from "react";

export const DropdownNestingContext = createContext(null);

/**
 * Ref callback for any popover portalled out of a Dropdown's children (a
 * Select's list, say). Registers the node with the enclosing Dropdowns so a
 * click inside it does not count as an outside click. No-op outside a Dropdown.
 */
export function useDropdownNestedPopoverRef() {
  const nesting = useContext(DropdownNestingContext);
  const last = useRef(null);
  return useCallback(
    (node) => {
      if (last.current) nesting?.unregister(last.current);
      last.current = node;
      if (node) nesting?.register(node);
    },
    [nesting],
  );
}
