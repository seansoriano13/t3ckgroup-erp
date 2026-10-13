import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import { SelectField } from "@/components/ui/SelectField";
import SorPicker from "./SorPicker";
import { ipasService } from "../../services/ipasService";
import { IPAS_PURPOSE, IPAS_PURPOSES, IPAS_PURPOSE_LABELS } from "../../constants/ipas";
import { ipasErrorMessage } from "../../utils/ipas";
import { ipasKey, ipasListKey } from "./ipasKeys";

const PURPOSE_OPTIONS = IPAS_PURPOSES.map((value) => ({ value, label: IPAS_PURPOSE_LABELS[value] }));

const toPicked = (sor) => ({
  id: sor.id,
  sales_reference: sor.salesReference,
  project_title: sor.projectTitle,
  current_stage_name: sor.stageName,
});

/**
 * Changes an open IPAS's Purpose and SORs together (#242): a Project names one
 * or more SORs, any other Purpose none, and the database holds it to that.
 * Mounted only while open, so its fields start from the IPAS as it stands.
 */
export default function EditPurposeSorsDialog({ ipas, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <EditBody ipas={ipas} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function EditBody({ ipas, onClose }) {
  const queryClient = useQueryClient();
  const [purpose, setPurpose] = useState(ipas.purpose);
  const [sors, setSors] = useState(() => ipas.sors.map(toPicked));

  const { data: suggestions = [] } = useQuery({
    queryKey: ["ipas", "suggestions", ipas.id],
    queryFn: () => ipasService.suggestSors(ipas.odoo_copy),
    staleTime: 60_000,
  });

  const isProject = purpose === IPAS_PURPOSE.PROJECT;
  const save = useMutation({
    mutationFn: () =>
      ipasService.setPurposeAndSors(ipas.id, { purpose, sorIds: isProject ? sors.map((s) => s.id) : [] }),
    onSuccess: () => {
      toast.success("Purpose and SORs updated.");
      queryClient.invalidateQueries({ queryKey: ipasKey(ipas.id) });
      queryClient.invalidateQueries({ queryKey: ipasListKey });
      onClose();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const ready = purpose !== "" && (!isProject || sors.length > 0);

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>Purpose and SORs</DialogTitle>
        <DialogDescription>
          {ipas.number} can change these until it is filed. A Project names one or more SORs; Inventory, Supplies and
          Events name none.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 max-h-[60vh] space-y-4 overflow-y-auto px-1">
        <FieldBox label="Purpose" bare>
          <SelectField options={PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} placeholder="Pick" />
        </FieldBox>
        {isProject && <SorPicker selected={sors} onChange={setSors} suggestions={suggestions} />}
      </div>

      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
