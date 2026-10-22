import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { LockOpen } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { CAPTION_BASE } from "@/lib/captionStyle";
import ModalShell from "./ui/ModalShell";
import { Button } from "./ui/button";
import { canvassService } from "../services/canvassService";

/**
 * Unlocking a Canvass: a Super Admin lets its Offers, winner and reason change again. The reason is
 * required and goes into the Canvass history, so the next reader can see who unlocked it and why.
 */
export default function CanvassUnlockDialog({ open, onOpenChange, canvass, onUnlocked }) {
  const [reason, setReason] = useState("");

  const unlock = useMutation({
    mutationFn: () => canvassService.unlock(canvass.id, reason),
    onSuccess: () => {
      toast.success(`${canvass.number} unlocked.`);
      onUnlocked?.();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Canvass", canvass?.number, "Unlock"].filter(Boolean)}
      title={`Unlock Canvass ${canvass?.number ?? ""}`.trim()}
      actions={
        <Button type="button" size="lg" disabled={!reason.trim() || unlock.isPending} onClick={() => unlock.mutate()}>
          {unlock.isPending ? "Unlocking…" : "Unlock"}
        </Button>
      }
    >
      <p className="flex items-center gap-2 text-base font-medium">
        <LockOpen size={16} aria-hidden="true" />
        Unlock Canvass {canvass?.number}
      </p>
      <p className="text-sm text-muted-foreground">
        Its offers, winner and reason can be changed again. If the winner changes, the Purchase Request already made
        from it keeps the old price, so fix the item too.
      </p>
      <div className="space-y-1.5">
        <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Why it is being unlocked</span>
        <Textarea
          aria-label="Why it is being unlocked"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="This is kept in the Canvass history."
          className="min-h-0 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] md:text-[12.5px]"
        />
      </div>
    </ModalShell>
  );
}
