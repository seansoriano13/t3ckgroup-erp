import { supabase } from "../lib/supabase";
import { RESET_PASSWORD_PATH } from "../lib/recoveryLink";

const EMAIL_SHAPE = /^[^s@]+@[^s@]+.[^s@]+$/;

/**
 * Issues or reissues a password-login credential for an employee, via the
 * manage-employee-password edge function — the only place allowed to touch
 * auth.users, since that needs the service role key.
 *
 * Returns the generated password once. The caller is responsible for
 * showing it to the person who triggered the action and never persisting it.
 */
async function invoke(employeeId, action) {
  const { data, error } = await supabase.functions.invoke("manage-employee-password", {
    body: { employeeId, action },
  });

  if (error) throw error;
  if (!data?.success) {
    throw new Error(data?.message || "Failed to issue password.");
  }
  return data.password;
}

export const passwordService = {
  /** First password for an employee who has no sign-in account yet. */
  issuePassword(employeeId) {
    return invoke(employeeId, "issue");
  },

  /** A Super Admin action: a new password for someone still on their issued one. */
  reissuePassword(employeeId) {
    return invoke(employeeId, "reissue");
  },

  /** Sends the provider's password-reset email for self-service changes. */
  async requestPasswordReset(email) {
    const address = (email || "").trim();
    if (!EMAIL_SHAPE.test(address)) {
      throw new Error("Enter a full email address, like name@t3ckgroup.com.");
    }
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
    });
    if (error) {
      const limited =
        error.status === 429 || /rate.?limit/i.test(`${error.code} ${error.message}`);
      throw new Error(
        limited
          ? "Too many reset emails were requested. Wait a few minutes and try again."
          : "We could not send the email just now. Try again in a few minutes, or ask IT.",
      );
    }
  },

  /** Called once the employee has set their own password, clearing the flag. */
  async clearIssuedPasswordFlag() {
    const { error } = await supabase.rpc("clear_issued_password_flag");
    if (error) throw error;
  },
};
