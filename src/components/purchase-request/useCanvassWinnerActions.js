import { useState } from "react";
import toast from "react-hot-toast";

import { canvassService } from "../../services/canvassService";

/**
 * Everything that picks, rewrites or clears a winner on the Canvass grid (#970, spec #956): the
 * reason dialog's state, the words each kind of pick puts on it, and the write each one makes.
 * Kept out of CanvassGrid so the grid only draws. The database owns the rules (three suppliers or
 * a "No other supplier" note, a reason per winner, the lock on a Purchased line, no winner on a
 * cancelled line); a refusal comes back as a thrown error and reaches the dialog.
 *
 * `attempt(work, ok)` is the grid's button runner: it refreshes, toasts, and reports a refusal.
 */

const unitCount = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The dialog's words for each kind of reason being asked for. `note` is the saved "No other supplier" note or null. */
export function reasonDialogCopy(ask, note) {
  switch (ask.kind) {
    case "pick":
      return {
        crumbs: ["Canvass", "Pick a winner"],
        title: `${ask.supplier.name} wins ${ask.line.item.name}?`,
        intro: "Say why. The reason is kept with the winner and printed on the Canvass.",
        label: "Why this supplier",
        initial: ask.line.winner?.reason ?? "",
        confirmLabel: "Pick winner",
      };
    case "all":
      return {
        crumbs: ["Canvass", "Wins every line"],
        title: `${ask.supplier.name} wins every line it quoted?`,
        intro: "It is picked on every line it quoted, with this one reason. Lines it did not quote, and Purchased lines, are skipped.",
        label: "Why this supplier",
        confirmLabel: "Pick on every line",
      };
    case "same":
      return {
        crumbs: ["Canvass", "Same reason for all"],
        title: "Use the same reason for all?",
        intro: "This reason replaces the one on every picked line that is not locked.",
        label: "Reason",
        confirmLabel: "Use for all",
      };
    case "note":
      return {
        crumbs: ["Canvass", "No other supplier"],
        title: "No other supplier?",
        intro: "It stands in for the suppliers this Canvass is short of. It counts toward the three until a supplier fills that place.",
        label: "Why there is no other supplier",
        initial: note?.reason ?? "",
        confirmLabel: "Save note",
      };
    case "unlock":
      return {
        crumbs: ["Canvass", "Unlock"],
        title: `Unlock ${ask.line.item.name}?`,
        intro: "Its prices, winner and reason can change again. The reason is kept in the history.",
        label: "Why it is being unlocked",
        confirmLabel: "Unlock",
      };
    default:
      return null;
  }
}

export function useCanvassWinnerActions({ canvass, actorId, refresh, attempt, note }) {
  // { kind: "pick" | "all" | "same" | "note" | "unlock", line?, supplier? } while the dialog is open.
  const [reasonFor, setReasonFor] = useState(null);

  const submitReason = async (reason) => {
    const { kind, line, supplier } = reasonFor;
    if (kind === "pick") {
      await canvassService.setWinner(line.id, supplier.id, reason, actorId);
      toast.success(`${supplier.name} wins ${line.item.name}.`);
    } else if (kind === "all") {
      const { picked, skipped } = await canvassService.pickSupplierForAll(canvass.id, supplier.id, reason);
      toast.success(`${supplier.name} wins ${unitCount(picked, "line")}${skipped ? `; ${skipped} skipped` : ""}.`);
    } else if (kind === "same") {
      const { changed } = await canvassService.useSameReason(canvass.id, reason);
      toast.success(`The same reason is on ${unitCount(changed, "line")}.`);
    } else if (kind === "note") {
      await canvassService.markNoOtherSupplier(canvass.id, reason, actorId);
      toast.success("Noted: no other supplier.");
    } else if (kind === "unlock") {
      await canvassService.unlockLine(line.id, reason);
      toast.success(`${line.item.name} is unlocked.`);
    }
    refresh();
  };

  return {
    reasonFor,
    ask: setReasonFor,
    closeReason: () => setReasonFor(null),
    reasonCopy: reasonFor ? reasonDialogCopy(reasonFor, note) : null,
    submitReason,
    unpick: (line) => attempt(() => canvassService.clearWinner(line.id), "Winner cleared."),
    saveWinnerReason: async (line, value) => {
      if (!String(value ?? "").trim()) throw new Error("A winner needs a reason.");
      await canvassService.setWinnerReason(line.id, value);
      refresh();
    },
  };
}
