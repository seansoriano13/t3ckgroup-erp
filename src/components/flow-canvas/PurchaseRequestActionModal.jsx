import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { SelectField } from "@/components/ui/SelectField";
import { Switch } from "@/components/ui/switch";
import { DEAL_TEAM_ROLES, SELECTOR_TYPES } from "@/utils/resolvePeople";
import {
  BUYER_COSTING_INCHARGE,
  BUYER_EMPLOYEE,
  DEFAULT_REQUESTERS,
  LEAVE_OUT_ROLES,
} from "@/utils/purchaseRequestAction";

const NO_BUYER = "none";

const buyerKind = (buyer) => buyer?.type || NO_BUYER;

/**
 * Issue #304 — the Open Purchase Request action's own config: the default
 * Buyer (a person, the Costing Matrix's Purchasing Incharge, or none), extra
 * default members, the Deal Team roles left out, who may request items, and
 * whether it waits for a Decider. The purchasing members' window is the
 * action's detail panel's access window, like every other action's.
 */
export default function PurchaseRequestActionModal({ isOpen, onClose, initialData, onSubmit, isSubmitting }) {
  const [buyer, setBuyer] = useState(initialData?.buyer ?? null);
  const [extras, setExtras] = useState(initialData?.extras ?? []);
  const [leaveOutRoles, setLeaveOutRoles] = useState(initialData?.leaveOutRoles ?? []);
  const [requesters, setRequesters] = useState(initialData?.requesters ?? DEFAULT_REQUESTERS);
  const [confirmMode, setConfirmMode] = useState(initialData?.confirmMode);
  const [decider, setDecider] = useState(initialData?.decider ?? []);

  const toggleRole = (role, left) =>
    setLeaveOutRoles((prev) => (left ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)));

  const setBuyerKind = (kind) => {
    if (kind === NO_BUYER) setBuyer(null);
    else if (kind === BUYER_COSTING_INCHARGE) setBuyer({ type: BUYER_COSTING_INCHARGE });
    else setBuyer({ type: BUYER_EMPLOYEE, id: buyer?.id ?? null });
  };

  const buyerChosen = buyer?.type !== BUYER_EMPLOYEE || Boolean(buyer.id);

  const submit = () =>
    onSubmit({
      buyer,
      extras,
      leaveOutRoles,
      requesters,
      confirmMode,
      decider: confirmMode === "confirm" ? decider : undefined,
    });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>Open Purchase Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FieldBox label="Default Buyer" bare>
            <SelectField
              aria-label="Default Buyer"
              value={buyerKind(buyer)}
              onChange={setBuyerKind}
              options={[
                { value: NO_BUYER, label: "None — wait in the queue for a Take" },
                { value: BUYER_EMPLOYEE, label: "A person" },
                { value: BUYER_COSTING_INCHARGE, label: "The Costing Matrix's Purchasing Incharge" },
              ]}
              className="w-full"
            />
            {buyer?.type === BUYER_EMPLOYEE && (
              <div className="mt-2">
                <PeoplePicker
                  value={buyer.id ? [{ type: SELECTOR_TYPES.EMPLOYEE, id: buyer.id }] : []}
                  onChange={(next) => {
                    const last = next[next.length - 1];
                    setBuyer({ type: BUYER_EMPLOYEE, id: last?.id ?? null });
                  }}
                  types={[SELECTOR_TYPES.EMPLOYEE]}
                  placeholder="Choose the Buyer"
                />
              </div>
            )}
          </FieldBox>

          <FieldBox label="Extra default members" bare>
            <PeoplePicker value={extras} onChange={setExtras} placeholder="Add people or groups" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Everyone with Purchasing access and the SOR's Deal Team are members already.
            </p>
          </FieldBox>

          <FieldBox label="Deal Team roles to leave out" bare>
            <div className="grid grid-cols-2 gap-2">
              {LEAVE_OUT_ROLES.map((role) => (
                <FieldBox key={role} inline className="text-xs">
                  <Checkbox
                    checked={leaveOutRoles.includes(role)}
                    onCheckedChange={(checked) => toggleRole(role, checked)}
                  />
                  {DEAL_TEAM_ROLES[role].label}
                </FieldBox>
              ))}
            </div>
          </FieldBox>

          <FieldBox label="Who can request items" bare>
            <PeoplePicker value={requesters} onChange={setRequesters} allowRoles allowDepartments placeholder="Add people, roles or groups" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              The Deal Team and the Buyer always can. Anyone added here joins the request and may add and cancel items too.
            </p>
          </FieldBox>

          <div className="rounded-lg border border-dashed border-mauve-7 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                Require confirmation before running
              </span>
              <Switch
                checked={confirmMode === "confirm"}
                onCheckedChange={(next) => setConfirmMode(next ? "confirm" : undefined)}
              />
            </div>
            {confirmMode === "confirm" && (
              <div className="mt-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Decider (defaults to the Deal Owner)
                </span>
                <PeoplePicker value={decider} onChange={setDecider} allowRoles placeholder="Add Decider" />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button size="lg" disabled={isSubmitting || !buyerChosen} onClick={submit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
