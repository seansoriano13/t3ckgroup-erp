import { useState } from "react";

export const ALL = "ALL";
/** The Canvass filter's one narrowing choice: items ordered with no canvass. */
export const NO_CANVASS = "no-canvass";

/**
 * The Projects tab's search and filters, kept by the page so the filter bar
 * (`ProjectsToolbar`) can sit in PageShell's toolbar slot while the groups sit
 * in the body.
 */
export function useProjectsFilters() {
  const [sor, setSor] = useState("");
  const [buyerId, setBuyerId] = useState(ALL);
  const [canvasserId, setCanvasserId] = useState(ALL);
  const [age, setAge] = useState(ALL);
  const [canvass, setCanvass] = useState(ALL);
  const clearAll = () => {
    setSor("");
    setBuyerId(ALL);
    setCanvasserId(ALL);
    setAge(ALL);
    setCanvass(ALL);
  };
  const active = Boolean(sor) || buyerId !== ALL || canvasserId !== ALL || age !== ALL || canvass !== ALL;
  return {
    sor, setSor, buyerId, setBuyerId, canvasserId, setCanvasserId, age, setAge, canvass, setCanvass, active, clearAll,
  };
}
