import { useState } from "react";

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
import { kindsToAdd } from "../../utils/ipasDocuments";

const BY_HAND = "__by_hand__";

/**
 * Add a document to an IPAS (#246): one of the document kinds the IPAS doesn't
 * have yet, or one typed by hand for paperwork the list doesn't know. Purchasing
 * only. Mounted only while open.
 */
/** `onSave({ kindId } | { label })` is the page's: the dialog closes at once and the page adds behind it. */
export default function DocumentDialog({ open, onOpenChange, ipas, onSave }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body ipas={ipas} onSave={onSave} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Body({ ipas, onSave, onClose }) {
  const kinds = kindsToAdd(ipas.options ?? [], ipas.documents ?? []);
  const [choice, setChoice] = useState(kinds.length > 0 ? "" : BY_HAND);
  const [label, setLabel] = useState("");

  const byHand = choice === BY_HAND;
  const options = [
    ...kinds.map((kind) => ({ value: kind.id, label: kind.label })),
    { value: BY_HAND, label: "Something else — I'll type its name" },
  ];
  const ready = byHand ? label.trim() !== "" : choice !== "";

  const add = () => {
    onSave(byHand ? { label } : { kindId: choice });
    onClose();
  };

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
        <Button size="lg" disabled={!ready} onClick={add}>
          Add document
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
