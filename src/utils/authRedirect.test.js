import { describe, it, expect } from "vitest";
import { resolvePostLoginPath } from "./authRedirect.js";

describe("resolvePostLoginPath", () => {
  it("keeps an in-app path", () => {
    expect(resolvePostLoginPath("/tasks")).toBe("/tasks");
    expect(resolvePostLoginPath("/approvals/hr-verification")).toBe(
      "/approvals/hr-verification"
    );
  });

  it("keeps the query string and hash of the original route", () => {
    expect(resolvePostLoginPath("/tasks?status=pending#row-3")).toBe(
      "/tasks?status=pending#row-3"
    );
  });

  it("falls back to the dashboard when there is no origin", () => {
    expect(resolvePostLoginPath(undefined)).toBe("/");
    expect(resolvePostLoginPath(null)).toBe("/");
    expect(resolvePostLoginPath("")).toBe("/");
  });

  it("refuses anything that could leave the site", () => {
    expect(resolvePostLoginPath("//evil.example.com/steal")).toBe("/");
    expect(resolvePostLoginPath("/\\evil.example.com")).toBe("/");
    expect(resolvePostLoginPath("https://evil.example.com")).toBe("/");
    expect(resolvePostLoginPath("javascript:alert(1)")).toBe("/");
    expect(resolvePostLoginPath("tasks")).toBe("/");
  });

  it("refuses a non-string origin", () => {
    expect(resolvePostLoginPath({ pathname: "/tasks" })).toBe("/");
    expect(resolvePostLoginPath(42)).toBe("/");
  });

  it("does not bounce back to the login screen itself", () => {
    expect(resolvePostLoginPath("/login")).toBe("/");
    expect(resolvePostLoginPath("/login?next=/tasks")).toBe("/");
  });
});
