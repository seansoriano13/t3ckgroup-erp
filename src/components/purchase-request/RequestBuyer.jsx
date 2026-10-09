import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Hand } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/SelectField";
import { PersonChip } from "@/components/ui/DetailParts";
import Spinner from "@/components/ui/Spinner";
import { getPermissionContext } from "@/utils/permissions";
import { employeeService } from "@/services/employeeService";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import { purchaseRequestKeys } from "./queryKeys";
import { refusal, useRefreshRequest, useTakeRequest } from "./requestHooks";

const NO_BUYER = "__none__";

/**
 * Issue #308 — a Purchase Request's Buyer, and the ways to change it:
 * **Take** for anyone with Purchasing access while there is no Buyer
 * (`pr_take`), and a picker for a purchasing member or Super Admin
 * (`pr_set_buyer`; "No Buyer" sends it back to the queue). `request` is a
 * queue row (`id`, `buyer_id`, `buyer_name`, `buyer_avatar_path`).
 */
export default function RequestBuyer({ request }) {
  const requestId = request?.id;
  const { user } = useAuth();
  const { hasPurchasingFlow } = getPermissionContext(user);

  const { data: canManage = false } = useQuery({
    queryKey: purchaseRequestKeys.canManage(requestId),
    queryFn: () => purchaseRequestService.canManageMembers(requestId),
    enabled: !!requestId,
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: canManage,
  });

  const refresh = useRefreshRequest(requestId);
  const take = useTakeRequest(requestId);
  const setBuyer = useMutation({
    mutationFn: (employeeId) => purchaseRequestService.setBuyer(requestId, employeeId),
    onError: (err) => toast.error(refusal(err)),
    onSettled: refresh,
  });

  const buyerId = request?.buyer_id;
  const buyerName = request?.buyer_name;
  const buyerOptions = useMemo(() => {
    const purchasers = employees
      .filter((e) => e.has_purchasing_flow || e.id === buyerId)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((e) => ({ value: e.id, label: e.name }));
    if (buyerId && !purchasers.some((o) => o.value === buyerId)) {
      purchasers.unshift({ value: buyerId, label: buyerName || "Current Buyer" });
    }
    return [{ value: NO_BUYER, label: "No Buyer (back to the queue)" }, ...purchasers];
  }, [employees, buyerId, buyerName]);

  if (!request) return null;
  const unassigned = !request.buyer_id;
  const busy = take.isPending || setBuyer.isPending;

  return (
    <section aria-label="Buyer" className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Buyer</p>
        {unassigned ? (
          <p className="text-[13px] text-muted-foreground">No Buyer yet</p>
        ) : (
          <PersonChip
            person={{ id: request.buyer_id, name: request.buyer_name || "Someone", avatarPath: request.buyer_avatar_path }}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        {busy && <Spinner size="sm" />}
        {canManage && (
          <SelectField
            aria-label="Change Buyer"
            options={buyerOptions}
            value={request.buyer_id || NO_BUYER}
            onChange={(next) => {
              const id = next === NO_BUYER ? null : next;
              if (id !== (request.buyer_id || null)) setBuyer.mutate(id);
            }}
            disabled={busy}
            size="sm"
            className="h-8 w-44"
          />
        )}
        {unassigned && hasPurchasingFlow && (
          <Button size="sm" onClick={() => take.mutate()} disabled={busy} className="gap-1.5">
            <Hand size={14} />
            Take
          </Button>
        )}
      </div>
    </section>
  );
}
