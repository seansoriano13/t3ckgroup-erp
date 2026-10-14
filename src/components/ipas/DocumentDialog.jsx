import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { ipasService } from "../../services/ipasService";
import { ipasErrorMessage } from "../../utils/ipas";
import { kindsToAdd } from "../../utils/ipasDocuments";

const BY_HAND = "__by_hand__";

/**
 * Add a document to an IPAS (#246): one of the document kinds the IPAS doesn't
 * have yet, or one typed by hand for paperwork the list doesn't know. Purchasing
 * only. Mounted only while open.
 */
/** `onFailed(error, retry)`, when given, shows a failed add in the page (with Retry) instead of a toast alone. */
export default function DocumentDialog({ open, onOpenChange, ipas, onAdded, onFailed }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body ipas={ipas} onAdded={onAdded} onFailed={onFailed} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Body({ ipas, onAdded, onFailed, onClose }) {
  const kinds = kindsToAdd(ipas.options ?? [], ipas.documents ?? []);
  const [choice, setChoice] = useState(kinds.length > 0 ? "" : BY_HAND);
  const [label, setLabel] = useState("");

  const byHand = choice === BY_HAND;
  const options = [
    ...kinds.map((kind) => ({ value: kind.id, label: kind.label })),
    { value: BY_HAND, label: "Something else — I'll type its name" },
  ];
  const ready = byHand ? label.trim() !== "" : choice !== "";

  const add = useMutation({
    mutationFn: () => ipasService.addDocument(ipas.id, byHand ? { label } : { kindId: choice }),
    onSuccess: () => {
      toast.success("Document added.");
      onAdded?.();
      onClose();
    },
    onError: (error) => (onFailed ? onFailed(error, () => add.mutate()) : toast.error(ipasErrorMessage(error))),
  });

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>Add a document</DialogTitle>
        <DialogDescription>
          Pick a kind from the list, or type the name of paperwork it doesn&apos;t have. Both ticks start empty.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <FieldBox label="Document" bare>
          <SelectField options={options} value={choice} onChange={setChoice} placeholder="Pick a document" />
        </FieldBox>
        {byHand && (
          <FieldBox label="Name" bare>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Warranty card"
              maxLength={200}
              autoFocus
            />
          </FieldBox>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" disabled={!ready || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Adding…" : "Add document"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
