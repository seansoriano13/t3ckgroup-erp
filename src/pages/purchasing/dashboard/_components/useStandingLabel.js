import { useMemo } from "react";

import { useAuth } from "../../../../context/AuthContext";
import { getPermissionContext, transmittalListsOf } from "../../../../utils/permissions";
import { standingLabel } from "../../../../utils/orderStanding";

/**
 * Words an order's standing for the signed-in person: a Transmittal row they
 * are not on the list for ends "waiting on <list>". The function only changes
 * with the user, so it can sit in a memo's dependencies.
 */
export function useStandingLabel() {
  const { user } = useAuth();
  return useMemo(() => {
    const lists = transmittalListsOf(getPermissionContext(user));
    return (next) => standingLabel(next, lists);
  }, [user]);
}
