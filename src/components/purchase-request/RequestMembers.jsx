import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { X } from "lucide-react";

import Avatar from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { SelectField } from "@/components/ui/SelectField";
import { employeeService } from "@/services/employeeService";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import { MEMBER_SIDE } from "@/constants/purchaseRequest";
import { procurementQueueKey, purchaseRequestKeys } from "./queryKeys";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

const SIDE_LABEL = {
  [MEMBER_SIDE.PURCHASING]: "Purchasing",
  [MEMBER_SIDE.SALES]: "Sales",
  [MEMBER_SIDE.REQUESTER]: "Requester",
  [MEMBER_SIDE.OTHER]: "Other",
};

/**
 * Issue #308 — who is on a Purchase Request. A purchasing member or a Super
 * Admin adds and removes members (#304's RPCs; the database sets the side and
 * any window into the SOR). The Buyer can't be removed: name another Buyer
 * first. `request` is a queue row (`id`, `buyer_id`).
 */
export default function RequestMembers({ request }) {
  const requestId = request?.id;
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(null);

  const { data: members = [] } = useQuery({
    queryKey: purchaseRequestKeys.members(requestId),
    queryFn: () => purchaseRequestService.listMembers(requestId),
    enabled: !!requestId,
  });
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

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: purchaseRequestKeys.all(requestId) });
    queryClient.invalidateQueries({ queryKey: procurementQueueKey });
  };
  const add = useMutation({
    mutationFn: (employeeId) => purchaseRequestService.addMember(requestId, employeeId),
    onError: (err) => toast.error(refusal(err)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (employeeId) => purchaseRequestService.removeMember(requestId, employeeId),
    onError: (err) => toast.error(refusal(err)),
    onSettled: refresh,
  });

  const addOptions = useMemo(() => {
    const inside = new Set(members.map((m) => m.id));
    return employees
      .filter((e) => !inside.has(e.id))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((e) => ({ value: e.id, label: e.name }));
  }, [employees, members]);

  return (
    <section aria-label="Members" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Members
          <span className="ml-2 text-xs font-medium text-muted-foreground">{members.length}</span>
        </h3>
        {canManage && (
          <SelectField
            aria-label="Add a member"
            placeholder="Add a member"
            options={addOptions}
            value=""
            onChange={(id) => id && add.mutate(id)}
            disabled={add.isPending}
            size="sm"
            className="h-8 w-44"
          />
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5 pt-0.5">
        {members.map((m) => {
          const isBuyer = m.id === request?.buyer_id;
          const showRemove = canManage && !isBuyer;
          return (
            <li
              key={m.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card py-0.5 pl-1 text-xs transition-colors",
                showRemove ? "pr-1.5" : "pr-2.5",
              )}
              data-testid="request-member"
            >
              <Avatar name={m.name} src={m.avatar_path} size="xs" />
              <span className="font-medium text-foreground">{m.name}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/75">
                {isBuyer ? "Buyer" : SIDE_LABEL[m.side] || m.side}
              </span>
              {showRemove && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => setRemoving(m)}
                  disabled={remove.isPending}
                  className="-mr-0.5 size-4 rounded-full p-0 text-muted-foreground/70 hover:bg-muted hover:text-foreground active:scale-95"
                >
                  <X size={11} />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name || "this member"}?`}
        description="They stop seeing this request and its chat. Purchasing members also lose their window into the SOR."
        confirmLabel="Remove"
        tone="destructive"
        className={OVER_REQUEST_MODAL}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </section>
  );
}
