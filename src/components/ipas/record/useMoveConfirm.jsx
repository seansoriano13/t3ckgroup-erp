// The ask-first flow shared by the Decision card and the section drawer's
// footer: a move that `confirm`s opens a dialog restating what is signed (the
// same digest line as the section row), anything else runs straight away.

import { useState } from "react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";

/**
 * @param {{ digest: object, viewer?: string, origin: string }} options
 * @returns {{ run: (item: object) => void, dialog: import("react").ReactNode }}
 */
export function useMoveConfirm({ digest, viewer, origin }) {
  // `asked` keeps the move while the dialog animates shut, so its title does not blank.
  const [asked, setAsked] = useState(null);
  const [open, setOpen] = useState(false);

  const run = (item) => {
    if (item.confirm) {
      setAsked(item);
      setOpen(true);
    } else {
      item.run({ key: item.key, origin });
    }
  };

  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={`${asked?.label ?? ""}?`}
      confirmLabel={asked?.verb ?? "Confirm"}
      tone={asked?.kind === "return" ? "default" : "approve"}
      onConfirm={() => asked?.run({ key: asked.key, origin })}
    >
      <div className="space-y-1.5 text-sm">
        <p className="text-muted-foreground">{asked ? digest.lines[asked.section] : ""}</p>
        <p className="font-medium text-foreground">
          {viewer ? `You sign as ${viewer}.` : "You sign with this account."}
        </p>
      </div>
    </ConfirmDialog>
  );

  return { run, dialog };
}
