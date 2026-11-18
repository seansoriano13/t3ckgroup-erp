import { useQuery } from "@tanstack/react-query";
import { requestUnitService } from "../services/requestUnitService";
import { REQUEST_UNITS } from "../constants/procurement";

export const REQUEST_UNITS_KEY = ["request-units"];

/**
 * The Unit dropdown's choices for a Purchasing Request item, read once and shared. Only units that are on are
 * offered; `current` (a unit an item already holds that has since been switched off or renamed) is kept in the
 * list so that item still shows what it holds. Until the first read, or when it fails, the dropdown falls back
 * to the units that were fixed in code, so a request can always be raised.
 */
export function useRequestUnits(current) {
  const { data } = useQuery({
    queryKey: REQUEST_UNITS_KEY,
    queryFn: () => requestUnitService.list(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const labels = data?.length ? data.filter((u) => u.active).map((u) => u.label) : [...REQUEST_UNITS];
  const shown = current && !labels.some((l) => l.toLowerCase() === String(current).toLowerCase()) ? [...labels, current] : labels;
  return {
    units: shown,
    options: shown.map((u) => ({ value: u, label: u })),
    // What a new item starts on: the first unit offered.
    defaultUnit: labels[0] ?? REQUEST_UNITS[0],
  };
}
