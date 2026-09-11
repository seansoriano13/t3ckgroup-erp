import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The name-entry form inside an n8n-style "add a Stage" popover (issue #195).
 * Shared by the canvas-level plus (an unconnected Stage) and a Stage's own
 * outgoing plus (a Stage plus the move into it) — both just supply `onSubmit`
 * and decide what happens with the name.
 *
 * Blank and duplicate names surface inline and keep the popover open, rather
 * than closing it and toasting: `onSubmit` rejecting is read as "try again
 * here", which is what `salesFlowService.addStage` already throws for both
 * cases.
 */
export default function AddStagePopoverForm({ onSubmit, close, heading = "New Stage" }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A Stage needs a name.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      close();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
        {heading}
      </p>
      <div className="flex gap-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError("");
          }}
          placeholder="Name a Stage in your own words…"
          className="h-9"
        />
        <Button type="submit" size="lg" className="shrink-0" disabled={submitting}>
          <Plus size={14} /> Add
        </Button>
      </div>
      {error && <p className="text-xs text-red-11">{error}</p>}
    </form>
  );
}
