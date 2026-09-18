import { describe, it, expect } from "vitest"
import { join } from "path"
import { execFileSync } from "child_process"

// Exercises the actual CLI entry point (scripts/add-changelog.mjs), not just
// scripts/lib/changelog.mjs — argument parsing is the part a unit test on
// the lib alone wouldn't catch (e.g. a swapped flag order, or a typo'd flag
// silently doing nothing instead of failing loudly).

const cliPath = join(process.cwd(), "scripts", "add-changelog.mjs")

describe("add-changelog CLI", () => {
  it("prints usage and exits non-zero when a required flag is missing", () => {
    expect(() => execFileSync("node", [cliPath, "--version", "1.8.0"], { encoding: "utf8" })).toThrowError()
  })

  it("rejects an unrecognized flag instead of silently ignoring it", () => {
    expect(() =>
      execFileSync(
        "node",
        [cliPath, "--version", "1.8.0", "--title", "X", "--change", "Y", "--oops", "z"],
        { encoding: "utf8" },
      ),
    ).toThrowError()
  })
})
