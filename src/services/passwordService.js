import { supabase } from "../lib/supabase";
import { RESET_PASSWORD_PATH } from "../lib/recoveryLink";

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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
    });
    if (error) throw error;
  },

  /** Called once the employee has set their own password, clearing the flag. */
  async clearIssuedPasswordFlag() {
    const { error } = await supabase.rpc("clear_issued_password_flag");
    if (error) throw error;
  },
};
