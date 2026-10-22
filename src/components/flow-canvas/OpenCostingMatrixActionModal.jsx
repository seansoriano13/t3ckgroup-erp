import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { SelectField } from "@/components/ui/SelectField";
import { Switch } from "@/components/ui/switch";
import { costingKeys } from "@/components/costing/costingKeys";
import { costingMatrixService } from "@/services/costingMatrixService";
import { DEAL_TEAM_ROLES, SELECTOR_TYPES } from "@/utils/resolvePeople";
import { DEFAULT_SALES_INCHARGE, salesInchargeOf } from "@/utils/costingMatrixAction";
import { CAPTION_BASE } from "@/lib/captionStyle";

const PERSON = "employee";
const NOT_NAMED = "none";
const NO_PRESET = "none";

const salesChoice = (incharge) => (incharge.type === SELECTOR_TYPES.EMPLOYEE ? PERSON : incharge.role);

/**
 * Issue #462 — the Open Costing Matrix action's own config: who the Sales and Purchasing Incharge are, who is
 * told when it opens with no Purchasing Incharge, which markup preset becomes the matrix default, the extra
 * members called in, and whether it waits for a Decider. The extra members' window is the action's detail
 * panel's access window, like every other action's.
 *
 * Incharge is a name on the matrix: it grants no access and sends no notification.
 */
export default function OpenCostingMatrixActionModal({ isOpen, onClose, initialData, onSubmit, isSubmitting }) {
  const [salesIncharge, setSalesIncharge] = useState(salesInchargeOf(initialData ?? {}));
  const [purchasingIncharge, setPurchasingIncharge] = useState(initialData?.purchasingIncharge ?? null);
  const [assigners, setAssigners] = useState(initialData?.assigners ?? []);
  const [markupPresetId, setMarkupPresetId] = useState(initialData?.markupPresetId ?? null);
  const [extras, setExtras] = useState(initialData?.extras ?? []);
  const [confirmMode, setConfirmMode] = useState(initialData?.confirmMode);
  const [decider, setDecider] = useState(initialData?.decider ?? []);

  // The database serves presets to Super Admins and the Final Acquire list only; anyone else gets none.
  const { data: presets = [] } = useQuery({
    queryKey: costingKeys.presets(),
    queryFn: () => costingMatrixService.listPresets({ includeInactive: false }),
  });

  const setSalesChoice = (choice) => {
    if (choice === PERSON) setSalesIncharge({ type: SELECTOR_TYPES.EMPLOYEE, id: null });
    else setSalesIncharge({ type: SELECTOR_TYPES.ROLE, role: choice });
  };

  const salesChosen = salesIncharge.type !== SELECTOR_TYPES.EMPLOYEE || Boolean(salesIncharge.id);
  const buyerChosen = !purchasingIncharge || Boolean(purchasingIncharge.id);

  const presetOptions = [
    { value: NO_PRESET, label: "None — Management sets it on the matrix" },
    ...presets.map((p) => ({ value: p.id, label: `${p.label} · ×${Number(p.factor)}` })),
  ];
  // A saved preset this reader cannot list (or that was switched off) still shows, by its place.
  if (markupPresetId && !presets.some((p) => p.id === markupPresetId)) {
    presetOptions.push({ value: markupPresetId, label: "The saved markup preset" });
  }

  const submit = () => {
    const isDefaultSales =
      salesIncharge.type === SELECTOR_TYPES.ROLE && salesIncharge.role === DEFAULT_SALES_INCHARGE.role;
    onSubmit({
      // The Deal Owner role is the default, so it is not written down.
      salesIncharge: isDefaultSales ? undefined : salesIncharge,
      purchasingIncharge: purchasingIncharge ?? undefined,
      assigners: purchasingIncharge ? undefined : assigners,
      markupPresetId: markupPresetId ?? undefined,
      extras,
      confirmMode,
      decider: confirmMode === "confirm" ? decider : undefined,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>Open Costing Matrix</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FieldBox label="Sales Incharge" bare>
            <SelectField
              aria-label="Sales Incharge"
              value={salesChoice(salesIncharge)}
              onChange={setSalesChoice}
              options={[
                ...Object.entries(DEAL_TEAM_ROLES).map(([value, role]) => ({
                  value,
                  label: value === "deal_owner" ? `${role.label} (default)` : role.label,
                })),
                { value: PERSON, label: "A person" },
              ]}
              className="w-full"
            />
            {salesIncharge.type === SELECTOR_TYPES.EMPLOYEE && (
              <div className="mt-2">
                <PeoplePicker
                  value={salesIncharge.id ? [{ type: SELECTOR_TYPES.EMPLOYEE, id: salesIncharge.id }] : []}
                  onChange={(next) => {
                    const last = next[next.length - 1];
                    setSalesIncharge({ type: SELECTOR_TYPES.EMPLOYEE, id: last?.id ?? null });
                  }}
                  types={[SELECTOR_TYPES.EMPLOYEE]}
                  placeholder="Choose the Sales Incharge"
                />
              </div>
            )}
          </FieldBox>

          <FieldBox label="Purchasing Incharge" bare>
            <SelectField
              aria-label="Purchasing Incharge"
              value={purchasingIncharge ? PERSON : NOT_NAMED}
              onChange={(choice) =>
                setPurchasingIncharge(choice === PERSON ? { type: SELECTOR_TYPES.EMPLOYEE, id: null } : null)
              }
              options={[
                { value: NOT_NAMED, label: "Not named — someone assigns it later" },
                { value: PERSON, label: "A person" },
              ]}
              className="w-full"
            />
            {purchasingIncharge && (
              <div className="mt-2">
                <PeoplePicker
                  value={purchasingIncharge.id ? [{ type: SELECTOR_TYPES.EMPLOYEE, id: purchasingIncharge.id }] : []}
                  onChange={(next) => {
                    const last = next[next.length - 1];
                    setPurchasingIncharge({ type: SELECTOR_TYPES.EMPLOYEE, id: last?.id ?? null });
                  }}
                  types={[SELECTOR_TYPES.EMPLOYEE]}
                  placeholder="Choose the Purchasing Incharge"
                />
              </div>
            )}
          </FieldBox>

          {!purchasingIncharge && (
            <FieldBox label="Who assigns it" bare>
              <PeoplePicker value={assigners} onChange={setAssigners} placeholder="Add people or groups" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                They are notified when the matrix opens with no Purchasing Incharge.
              </p>
            </FieldBox>
          )}

          <FieldBox label="Markup preset" bare>
            <SelectField
              aria-label="Markup preset"
              value={markupPresetId ?? NO_PRESET}
              onChange={(next) => setMarkupPresetId(next === NO_PRESET ? null : next)}
              options={presetOptions}
              className="w-full"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Becomes the matrix's default factor. Only Super Admins, Purchasing, the Deal Team and the Final Acquire list can list the presets.
            </p>
          </FieldBox>

          <FieldBox label="Extra members" bare>
            <PeoplePicker value={extras} onChange={setExtras} placeholder="Add people or groups" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              They join the SOR for the window below and read the matrix without any money. Incharges are names only
              and are not called in.
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
                <span className={`${CAPTION_BASE} tracking-widest text-muted-foreground`}>
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
          <Button size="lg" disabled={isSubmitting || !salesChosen || !buyerChosen} onClick={submit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
