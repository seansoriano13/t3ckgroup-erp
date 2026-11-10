// The bar at the foot of the sections while the IPAS is being edited (#581): what is unsaved,
// Next empty, Done (or Discard when something was typed) and Save all. It is the only chrome
// editing adds; the sections themselves stay the page's own blocks.

import { useState } from "react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { focusField } from "./formHelpers";

export default function EditBar({ editor, canSave, saving, onDone, reveal, show, missingFiles = [], notice, failure }) {
  const { changed, missing, done, total, saved, planError, save, clear } = editor;
  const [discarding, setDiscarding] = useState(false);

  const nextEmpty = () => {
    const first = missing[0];
    if (first) {
      reveal(first.section);
      requestAnimationFrame(() => focusField(first.id));
      return;
    }
    const file = missingFiles[0];
    if (!file) return;
    if (show) show(file.section);
    else reveal(file.section);
  };

  let status = null;
  if (saving) status = "Saving…";
  else if (changed > 0) status = `${changed} unsaved ${changed === 1 ? "change" : "changes"}`;
  else if (saved) status = "All changes saved";

  return (
    <div className="sticky bottom-0 z-20 -mx-1 space-y-2 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
      {planError && (
        <div role="alert" className="text-sm text-red-11">
          {planError}
        </div>
      )}
      {notice}
      {failure}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span role="status" aria-live="polite" className={cn("text-sm tabular-nums", changed > 0 ? "text-amber-11" : "text-green-11")}>
          {status}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {done} of {total} fields{missingFiles.length > 0 && ` · ${missingFiles.length} ${missingFiles.length === 1 ? "file" : "files"} missing`}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!missing.length && !missingFiles.length} onClick={nextEmpty}>
            Next empty
          </Button>
          {changed > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setDiscarding(true)}>
              Discard
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onDone}>
              Done
            </Button>
          )}
          <Button type="button" size="sm" disabled={!canSave || saving || changed === 0} onClick={save}>
            Save all{changed ? ` (${changed})` : ""}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard your changes?"
        description={`You have ${changed} unsaved ${changed === 1 ? "change" : "changes"}. They will be lost.`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="destructive"
        onConfirm={() => {
          clear();
          onDone();
        }}
      />
    </div>
  );
}
