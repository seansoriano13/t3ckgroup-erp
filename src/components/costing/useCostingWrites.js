import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { employeeService } from "../../services/employeeService";
import { DEAL_TEAM_ROLES } from "../../utils/resolvePeople";
import { costingKeys } from "./costingKeys";
import { refusalMessage } from "./gridFormat";

/**
 * Writes from a control of the Costing Matrix grid (a button, not a cell): run it, refresh the
 * matrix, and keep a refusal in words in `notice` for the grid to show above itself. A cell
 * that saves on blur uses `refresh` alone and shows its own refusal beside the cell.
 */
export function useCostingWrites(opportunityId) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // Resolves once the active queries have refetched, so a caller can drop a value it showed early after it.
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: costingKeys.all(opportunityId) }), [queryClient, opportunityId]);

  const run = useCallback(
    async (work) => {
      setBusy(true);
      setNotice(null);
      try {
        await work();
        await refresh();
      } catch (error) {
        setNotice(refusalMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { busy, notice, setNotice, run, refresh };
}

/** The ids of an SOR's Deal Team, from the opportunity row. */
export function dealTeamIds(opportunity) {
  const ids = new Set();
  for (const role of Object.values(DEAL_TEAM_ROLES)) {
    for (const column of role.columns) if (opportunity?.[column]) ids.add(opportunity[column]);
  }
  return ids;
}

/**
 * Who can be named incharge, and what to call them (#268): the Sales incharge is picked from the
 * SOR's Deal Team and the Purchasing incharge from people with Purchasing access, which is what
 * the database checks. Names only; naming someone grants and notifies nothing.
 */
export function useInchargeOptions(opportunity) {
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  return useMemo(() => {
    const team = dealTeamIds(opportunity);
    const option = (e) => ({ value: e.id, label: e.name });
    return {
      salesOptions: employees.filter((e) => team.has(e.id)).map(option),
      purchasingOptions: employees.filter((e) => e.has_purchasing_flow).map(option),
      nameOf: (id) => employees.find((e) => e.id === id)?.name ?? null,
    };
  }, [employees, opportunity]);
}
