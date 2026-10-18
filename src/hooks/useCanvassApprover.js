import { useQuery } from "@tanstack/react-query";
import { transmittalService } from "../services/transmittalService";
import { TRANSMITTAL_STAFF_LIST } from "../constants/transmittals";

/**
 * Whether the person is on the purchasing approver list (#279): the Transmittal "Check by" list,
 * the one that approves Transmittals, which also signs Canvasses. A Super Admin signs only when on
 * it. Shares its query with the Approval Center's role check, so it is read once.
 */
export function useCanvassApprover(userId) {
  const { data } = useQuery({
    queryKey: ["transmittalStaffLists", userId],
    queryFn: () => transmittalService.myStaffLists(userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
  return (data ?? []).includes(TRANSMITTAL_STAFF_LIST.CHECK_BY);
}
