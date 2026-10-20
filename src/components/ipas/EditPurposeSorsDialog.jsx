import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { ipasService } from "../../services/ipasService";
import { IPAS_PURPOSE, IPAS_PURPOSES, IPAS_PURPOSE_LABELS } from "../../constants/ipas";
import { ipasErrorMessage } from "../../utils/ipas";
import { ipasKey, ipasListKey } from "./ipasKeys";

// An IPAS with no SORs can be any Purpose but Project; the SOR list is fixed when it is raised (#551).
const PURPOSE_OPTIONS = IPAS_PURPOSES.filter((value) => value !== IPAS_PURPOSE.PROJECT).map((value) => ({
  value,
  label: IPAS_PURPOSE_LABELS[value],
}));

/**
 * Changes an open IPAS's Purpose (#242). The SORs are fixed when the IPAS is
 * raised (#551), so only an IPAS with no SORs gets here, and it can't become a
 * Project; the database holds it to that.
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

  const save = useMutation({
    mutationFn: () => ipasService.setPurpose(ipas.id, purpose),
    onSuccess: () => {
      toast.success("Purpose updated.");
      queryClient.invalidateQueries({ queryKey: ipasKey(ipas.id) });
      queryClient.invalidateQueries({ queryKey: ipasListKey });
      onClose();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const ready = purpose !== "" && purpose !== ipas.purpose;

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>Purpose</DialogTitle>
        <DialogDescription>
          {ipas.number} can change its Purpose until it is filed. Its SORs are fixed when it is raised.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 max-h-[60vh] space-y-4 overflow-y-auto px-1">
        <FieldBox label="Purpose" bare>
          <SelectField options={PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} placeholder="Pick" />
        </FieldBox>
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
