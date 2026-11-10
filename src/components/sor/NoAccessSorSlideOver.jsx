import { Lock } from "lucide-react";
import SlideOver, { SlideOverBody } from "../ui/SlideOver";
import EmptyState from "../ui/EmptyState";

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
          {contact?.found === false ? (
            <EmptyState icon={Lock} title="SOR not found" description="This SOR doesn't exist or has been deleted." />
          ) : (
            <EmptyState
              icon={Lock}
              title="You're not on this SOR."
              description={`Ask ${contact?.dealOwnerName ?? "its Deal Owner"}${
                contact?.dealOwnerName ? ", its Deal Owner," : ""
              } to mention you in its notes. A mention lets you see the Stage it's on until it moves.`}
            />
          )}
        </SlideOverBody>
      )}
    </SlideOver>
  );
}
