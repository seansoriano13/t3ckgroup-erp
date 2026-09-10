import { describe, it, expect } from "vitest";
import {
  RESET_PASSWORD_PATH,
  isResetPasswordPath,
  readRecoveryParams,
  isRecoveryLanding,
} from "./recoveryLink";

/**
 * These two helpers replaced a regex in lib/supabase.js and a separate set of
 * lookups in pages/reset-password. The cases below are the ones that told the
 * two implementations apart.
 */
describe("readRecoveryParams", () => {
  it("reads a current-style token_hash link from the query string", () => {
    const p = readRecoveryParams({ search: "?token_hash=pkce_abc123&type=recovery" });
    expect(p.tokenHash).toBe("pkce_abc123");
    expect(p.otpType).toBe("recovery");
    expect(p.hasRecoveryToken).toBe(true);
    expect(p.hasError).toBe(false);
  });

  it("reads a legacy implicit link from the fragment", () => {
    const p = readRecoveryParams({ hash: "#access_token=x&refresh_token=y&type=recovery" });
    expect(p.tokenHash).toBe("");
    expect(p.hasRecoveryToken).toBe(true);
  });

  it("reads a PKCE ?code link", () => {
    expect(readRecoveryParams({ search: "?code=abc" }).hasRecoveryToken).toBe(true);
  });

  it("surfaces GoTrue's refusal, with the +-encoded description decoded", () => {
    const p = readRecoveryParams({
      hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    });
    expect(p.hasError).toBe(true);
    expect(p.errorDescription).toBe("Email link is invalid or has expired");
  });

  it("reports no token for a bare URL", () => {
    const p = readRecoveryParams({});
    expect(p.hasRecoveryToken).toBe(false);
    expect(p.hasError).toBe(false);
    expect(p.otpType).toBe("recovery");
  });
});

describe("isResetPasswordPath", () => {
  it("accepts the route with or without a trailing slash", () => {
    expect(isResetPasswordPath("/reset-password")).toBe(true);
    expect(isResetPasswordPath("/reset-password/")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isResetPasswordPath("/login")).toBe(false);
    expect(isResetPasswordPath("/reset-password-extra")).toBe(false);
    expect(isResetPasswordPath("")).toBe(false);
    expect(isResetPasswordPath("/")).toBe(false);
  });
});

describe("isRecoveryLanding", () => {
  it("is true on the reset route carrying a token", () => {
    expect(
      isRecoveryLanding({
        pathname: RESET_PASSWORD_PATH,
        search: "?token_hash=abc&type=recovery",
      }),
    ).toBe(true);
  });

  it("is true on the reset route carrying GoTrue's refusal", () => {
    expect(
      isRecoveryLanding({
        pathname: RESET_PASSWORD_PATH,
        hash: "#error=access_denied&error_code=otp_expired",
      }),
    ).toBe(true);
  });

  // The bug this pair exists to prevent: a Google sign-in fragment is not a
  // recovery landing, and must never raise the cross-tab hold.
  it("is false for an OAuth access_token fragment on another route", () => {
    expect(
      isRecoveryLanding({
        pathname: "/login",
        hash: "#access_token=google-token&expires_in=3600",
      }),
    ).toBe(false);
  });

  it("is false on the reset route with no token at all", () => {
    expect(isRecoveryLanding({ pathname: RESET_PASSWORD_PATH })).toBe(false);
  });
});
