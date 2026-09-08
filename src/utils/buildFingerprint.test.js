import { describe, it, expect } from "vitest"
import { formatBuildFingerprint } from "./buildFingerprint"

// __APP_VERSION__ is a full 40-char git SHA on Vercel (VERCEL_GIT_COMMIT_SHA)
// but falls back to Date.now().toString() anywhere else, including
// `pnpm dev` — so the fallback path is the one that runs locally every day,
// not the edge case. Digits are valid hex too, so a plain "is it hex"
// check would misclassify the 13-digit timestamp as a short SHA; only the
// full 40-char length reliably tells the two apart.

const FULL_SHA = "071e005a1b2c3d4e5f60718293a4b5c6d7e8f901"

describe("formatBuildFingerprint", () => {
  it("uses a 40-char fixture, matching a real git SHA — the whole test relies on this", () => {
    expect(FULL_SHA).toHaveLength(40)
  })

  it("shortens a full git SHA and appends the build date", () => {
    expect(formatBuildFingerprint(FULL_SHA, "2026-09-08T03:10:55.000Z")).toBe("071e005 · Sep 8, 2026")
  })

  it("falls back to 'dev' for a Date.now() timestamp, which is not a SHA", () => {
    expect(formatBuildFingerprint("1757300000000", "2026-09-08T03:10:55.000Z")).toBe("dev")
  })

  it("falls back to 'dev' for a shorter partial hex string, since real SHAs here are always full-length", () => {
    expect(formatBuildFingerprint("071e005abcdef1234567890", "2026-09-08T03:10:55.000Z")).toBe("dev")
  })

  it("falls back to 'dev' when there is no version at all", () => {
    expect(formatBuildFingerprint(undefined, "2026-09-08T03:10:55.000Z")).toBe("dev")
    expect(formatBuildFingerprint("", "2026-09-08T03:10:55.000Z")).toBe("dev")
  })

  it("accepts an uppercase-hex SHA", () => {
    expect(formatBuildFingerprint(FULL_SHA.toUpperCase(), "2026-09-08T03:10:55.000Z")).toBe(
      "071E005 · Sep 8, 2026",
    )
  })

  it("still returns the short SHA if the build time is missing or unparsable", () => {
    expect(formatBuildFingerprint(FULL_SHA, undefined)).toBe("071e005")
    expect(formatBuildFingerprint(FULL_SHA, "not-a-date")).toBe("071e005")
  })
})
