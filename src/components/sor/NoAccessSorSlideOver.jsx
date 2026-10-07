import { Lock } from "lucide-react";
import SlideOver, { SlideOverBody } from "../ui/SlideOver";

const identity = (contact) => ({
  ref: "SOR",
  title: contact.found === false ? "SOR not found" : "You don't have access",
});

/**
 * #474: someone who reaches an SOR they cannot open — a link, a notification,
 * a typed URL — is told so, and told who to ask. Before this the modal simply
 * did not render, and every silent refusal became a question to the admin.
 *
 * Names the Deal Owner and nothing else about the SOR (`sor_access_contact`).
 * `contact` is null while loading; `{ found: false }` when the SOR is gone.
 */
export default function NoAccessSorSlideOver({ isOpen, onClose, contact }) {
  const record = isOpen ? (contact ?? {}) : null;
  return (
    <SlideOver record={record} icon={Lock} crumb="SORs" identity={identity} onClose={onClose}>
      {() => (
        <SlideOverBody>
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Lock className="h-5 w-5" aria-hidden />
            </div>
            {contact?.found === false ? (
              <p className="text-sm text-muted-foreground">This SOR doesn't exist or has been deleted.</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground">You're not on this SOR.</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {contact?.dealOwnerName ? (
                    <>
                      Ask <span className="font-semibold text-foreground">{contact.dealOwnerName}</span>, its Deal Owner,
                      to mention you in its notes. A mention lets you see the Stage it's on until it moves.
                    </>
                  ) : (
                    "Ask its Deal Owner to mention you in its notes. A mention lets you see the Stage it's on until it moves."
                  )}
                </p>
              </>
            )}
          </div>
        </SlideOverBody>
      )}
    </SlideOver>
  );
}
