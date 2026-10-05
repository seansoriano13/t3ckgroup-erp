import { describe, it, expect } from "vitest";
import { isAuthorizedCaller } from "../../supabase/functions/_shared/cronAuth.ts";

// #457 D7: the Edge Functions gateway no longer vouches for these functions
// (verify_jwt = false), so the function itself decides. The public anon key
// must not get a caller in.
const secrets = { cronSecret: "cron-s3cret", serviceRoleKey: "service.role.jwt" };

describe("isAuthorizedCaller", () => {
  it("accepts Bearer CRON_SECRET", () => {
    expect(isAuthorizedCaller("Bearer cron-s3cret", secrets)).toBe(true);
  });

  it("accepts the service-role JWT, so a manual run from an operator still works", () => {
    expect(isAuthorizedCaller("Bearer service.role.jwt", secrets)).toBe(true);
  });

  it("rejects the public anon key and any other token", () => {
    expect(isAuthorizedCaller("Bearer anon.public.jwt", secrets)).toBe(false);
    expect(isAuthorizedCaller("Bearer cron-s3cret-and-more", secrets)).toBe(false);
  });

  it("rejects a missing header, a wrong scheme and a bare token", () => {
    expect(isAuthorizedCaller(null, secrets)).toBe(false);
    expect(isAuthorizedCaller("", secrets)).toBe(false);
    expect(isAuthorizedCaller("cron-s3cret", secrets)).toBe(false);
    expect(isAuthorizedCaller("Basic cron-s3cret", secrets)).toBe(false);
  });

  it("fails closed when CRON_SECRET is unset: an empty bearer is not a match", () => {
    expect(isAuthorizedCaller("Bearer ", { ...secrets, cronSecret: undefined })).toBe(false);
    expect(isAuthorizedCaller("Bearer ", { cronSecret: "", serviceRoleKey: "" })).toBe(false);
    expect(isAuthorizedCaller("Bearer undefined", { ...secrets, cronSecret: undefined })).toBe(false);
  });

  it("still accepts the service-role JWT when CRON_SECRET is unset", () => {
    expect(isAuthorizedCaller("Bearer service.role.jwt", { ...secrets, cronSecret: undefined })).toBe(true);
  });
});
