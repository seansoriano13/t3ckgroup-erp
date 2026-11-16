import { useState } from "react";
import toast from "react-hot-toast";

import { canvassService } from "../../services/canvassService";

/**
 * Everything that adds, edits or removes a supplier of the Canvass grid, and the "No other
 * supplier" note's removal (#970, spec #956): which dialog is open and the write each one makes.
 * Kept out of CanvassGrid so the grid only draws. `attempt(work, ok)` is the grid's button runner
 * (refresh, toast, report a refusal); the dialog's own submit throws so its refusal shows in it.
 */
export function useCanvassSupplierActions({ requestId, canvass, actorId, refresh, attempt }) {
  const [supplierDialog, setSupplierDialog] = useState(null); // { supplier } | {} for a new one
  const [removing, setRemoving] = useState(null);
  const [clearingNote, setClearingNote] = useState(false);

  const saveSupplier = async (values) => {
    if (supplierDialog.supplier) {
      await canvassService.updateSupplier(supplierDialog.supplier.id, values);
      toast.success(`${values.supplierName} saved.`);
    } else {
      const started = await canvassService.addSupplier(requestId, values, actorId);
      toast.success(canvass ? `${values.supplierName} added.` : `Canvass ${started.number} started.`);
    }
    refresh();
  };

  return {
    supplierDialog,
    openSupplierDialog: (supplier) => setSupplierDialog(supplier ? { supplier } : {}),
    closeSupplierDialog: () => setSupplierDialog(null),
    saveSupplier,
    removing,
    askRemoveSupplier: setRemoving,
    cancelRemoveSupplier: () => setRemoving(null),
    confirmRemoveSupplier: async () => {
      await attempt(() => canvassService.removeSupplier(removing.id), `${removing.name} removed.`);
      setRemoving(null);
    },
    clearingNote,
    setClearingNote,
    confirmClearNote: async () => {
      await attempt(() => canvassService.clearNoOtherSupplier(canvass.id), "Note removed.");
      setClearingNote(false);
    },
  };
}
