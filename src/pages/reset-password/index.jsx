import { useState } from "react";
import { useNavigate } from "react-router";
import toast from "react-hot-toast";
import { supabase } from "../../lib/supabase";
import { passwordService } from "../../services/passwordService";
import PrimaryButton from "../../components/PrimaryButton";
import { AUTH_INPUT_STYLE as INPUT_STYLE } from "../../constants/authForm.js";

/**
 * Where the provider's password-reset email link lands. Supabase turns the
 * recovery token in the URL into a real (short-lived) session automatically
 * (detectSessionInUrl), so setting a password here is an ordinary
 * `auth.updateUser` call — the same page serves a first-time change (which
 * clears the issued-password flag) and every change after it.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!password) {
      toast.error("Enter a password.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Cleared unconditionally: harmless if it was already false, and this
      // is the only place a self-chosen password ever gets set.
      try {
        await passwordService.clearIssuedPasswordFlag();
      } catch (flagError) {
        console.error("Failed to clear issued-password flag:", flagError);
      }

      toast.success("Password updated. You're all set.");
      navigate("/");
    } catch (error) {
      console.error("Password update failed:", error);
      toast.error(error.message || "Could not update your password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-mauve-2 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white max-w-md w-full rounded-2xl border border-mauve-6 shadow-sm p-8 space-y-5"
      >
        <div>
          <h1 className="text-2xl font-bold text-mauve-12">Set a new password</h1>
          <p className="text-mauve-10 text-sm mt-1">
            Choose a password for your T3ckgroup account.
          </p>
        </div>

        <div className="grid gap-2">
          <label htmlFor="new-password" className="text-xs font-bold text-mauve-11 uppercase tracking-wider">
            New Password
          </label>
          <input
            id="new-password"
            className={`${INPUT_STYLE} cursor-text`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="confirm-password" className="text-xs font-bold text-mauve-11 uppercase tracking-wider">
            Confirm Password
          </label>
          <input
            id="confirm-password"
            className={`${INPUT_STYLE} cursor-text`}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <PrimaryButton
          label={isSubmitting ? "Saving..." : "Save Password"}
          className={`w-full ${isSubmitting ? "opacity-70 cursor-not-allowed" : ""}`}
        />
      </form>
    </div>
  );
}
