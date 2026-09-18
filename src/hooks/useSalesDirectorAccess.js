import { useQuery } from "@tanstack/react-query";
import { commissionService } from "../services/commissionService";
import { useAuth } from "../context/AuthContext";

/**
 * "Super Admin, or a Sales Director" — the eligibility two screens share.
 *
 * A Sales Director isn't a flag on the employee record: it's whoever is
 * actually set as `sales_director_id` on at least one live opportunity, which
 * only the server can answer (see `commissionService.isSalesDirector`, and the
 * RLS policies that ask the same question). That makes it a query, not a
 * synchronous check off the user object — which is why the navigation
 * registry's `isPermitted` can't use it and settles for a coarser gate.
 *
 * `isResolving` is false for a Super Admin, whose answer needs no round trip.
 * Callers should hold their refusal state until it clears, or a director sees
 * "no access" for the length of one request.
 */
export function useSalesDirectorAccess() {
  const { user } = useAuth();
  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);

  const { data: isSalesDirector = false, isLoading } = useQuery({
    queryKey: ["isSalesDirector", user?.id],
    queryFn: () => commissionService.isSalesDirector(user.id),
    enabled: !isSuperAdmin && !!user?.id,
  });

  return {
    user,
    isSuperAdmin,
    isSalesDirector,
    hasAccess: isSuperAdmin || isSalesDirector,
    isResolving: !isSuperAdmin && isLoading,
  };
}
