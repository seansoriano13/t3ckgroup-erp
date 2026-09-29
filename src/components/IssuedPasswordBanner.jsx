import { useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "./ui/button";

const DISMISS_KEY_PREFIX = "t3ck_dismissed_issued_password_banner:";

/**
 * Issue #162/#165 — a non-blocking warning while an employee is still signed
 * in with a password someone else generated for them. It never blocks: the
 * only action it offers is dismissing itself, for this browser and this
 * person (keyed by email, so a shared machine doesn't dismiss it for
 * whoever signs in next).
 */
export default function IssuedPasswordBanner() {
  const { user } = useAuth();
  const dismissKey = user?.email ? `${DISMISS_KEY_PREFIX}${user.email}` : null;
  const [dismissed, setDismissed] = useState(
    () => !!dismissKey && localStorage.getItem(dismissKey) === "true",
  );

  const isIssuedPassword = !!(user?.is_issued_password || user?.isIssuedPassword);
  if (!isIssuedPassword || dismissed) return null;

  const handleDismiss = () => {
    if (dismissKey) localStorage.setItem(dismissKey, "true");
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      className="flex items-center gap-3 bg-amber-2 border border-amber-6 text-amber-11 rounded-xl px-4 py-3 mb-4"
    >
      <KeyRound size={16} className="shrink-0" />
      <p className="text-xs font-bold flex-1">
        You're signed in with a password issued for you. Change it from your
        profile whenever you like.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="h-auto w-auto p-1 rounded-md hover:bg-amber-4 transition-colors shrink-0"
      >
        <X size={14} />
      </Button>
    </div>
  );
}
