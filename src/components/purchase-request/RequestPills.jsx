import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Hand } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import PropertyPills from "@/components/record/PropertyPills";
import Spinner from "@/components/ui/Spinner";
import { getPermissionContext } from "@/utils/permissions";
import { employeeService } from "@/services/employeeService";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import { REQUEST_KIND, REQUEST_KIND_LABELS, requestKind, requestStageLabel } from "@/constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";
import { refusal, useRefreshRequest, useTakeRequest } from "./requestHooks";

const NO_BUYER = "__none__";
const NO_BUYER_LABEL = "No Buyer";

/**
 * Issue #308 — a Purchase Request's headline facts as pills: the Buyer first,
 * then the SOR, Stage and Items of a Project request, or the Kind of a Direct one.
 *
 * The Buyer pill is a picker for a purchasing member or Super Admin
 * (`purchase_request_set_buyer`; "No Buyer" sends it back to the queue) and
 * read-only for everyone else. **Take** (`purchase_request_take`), an outline
 * button beside the Buyer pill, is for anyone with Purchasing access while
 * nobody has the request. `request` is a queue row.
 */
export default function RequestPills({ request }) {
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
    return [{ value: NO_BUYER, label: NO_BUYER_LABEL }, ...purchasers];
  }, [employees, buyerId, buyerName]);

  if (!request) return null;
  const unassigned = !buyerId;
  const busy = take.isPending || setBuyer.isPending;
  const direct = requestKind(request) === REQUEST_KIND.DIRECT;
  const open = request.open_count ?? request.open_item_count ?? 0;

  const buyer = {
    key: "buyer",
    label: "Buyer",
    value: unassigned ? NO_BUYER_LABEL : buyerName || "Someone",
    ...(canManage && !busy
      ? {
          options: buyerOptions,
          onChange: (next) => {
            const id = next === NO_BUYER ? null : next;
            if (id !== (buyerId || null)) setBuyer.mutate(id);
          },
        }
      : {}),
  };
  const facts = direct
    ? [{ key: "kind", label: "Kind", value: REQUEST_KIND_LABELS[REQUEST_KIND.DIRECT] }]
    : [
        { key: "sor", label: "SOR", value: request.sales_reference },
        { key: "stage", label: "Stage", value: requestStageLabel(request) },
        { key: "items", label: "Items", value: request.item_count > 0 ? `${open} open of ${request.item_count}` : null },
      ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PropertyPills items={[buyer]} className="contents" />
      {busy && <Spinner size="sm" />}
      {unassigned && hasPurchasingFlow && (
        <Button variant="outline" size="sm" onClick={() => take.mutate()} disabled={busy} className="gap-1.5">
          <Hand size={14} />
          Take
        </Button>
      )}
      <PropertyPills items={facts} className="contents" />
    </div>
  );
}
