import { describe, it, expect } from "vitest"
import {
  ALLOW_MARKER,
  cdTargets,
  fileRefs,
  findPrivate,
  parseTerms,
  postsToGithub,
  scriptPaths,
} from "../../../scripts/lib/publicText.mjs"

// The public-text hook stops order totals and staff names reaching GitHub
// issues, which anyone can read while the repo is public and which keep every
// edit in their history. Spec #1187's tickets leaked two order totals this way.

describe("postsToGithub", () => {
  it.each([
    'gh issue create --title "x" --body-file t1.md',
    "gh issue edit 1192 -R owner/repo --body-file t5.out",
    'gh pr comment 12 --body "done"',
    'gh issue close 5 --comment "fixed"',
    "gh api -X POST repos/o/r/issues/1187/sub_issues -F sub_issue_id=1",
    'gh release create v1 --notes-file notes.md',
  ])("sees a GitHub write in: %s", (cmd) => {
    expect(postsToGithub(cmd)).toBe(true)
  })

  it.each(["gh issue view 1054 --json body", "gh pr checks", "git push origin staging", "ls docs"])(
    "lets through: %s",
    (cmd) => {
      expect(postsToGithub(cmd)).toBe(false)
    },
  )
})

describe("findPrivate", () => {
  it("finds money in the forms the issues used", () => {
    const text = "Typed against the old €72,723.10. Shipping €1,600. Gap ₱10.39M. Also PHP 25,000 and 71,123.10."
    expect(findPrivate(text).map((f) => f.value)).toEqual(
      expect.arrayContaining(["€72,723.10", "€1,600", "₱10.39M", "PHP 25,000", "71,123.10"]),
    )
  })

  it("reports each amount once, without trailing punctuation", () => {
    expect(findPrivate("Freight €1,600, so €72,723.10 total.").map((f) => f.value)).toEqual(["€1,600", "€72,723.10"])
  })

  it("leaves shell variables, plain counts and dates alone", () => {
    expect(findPrivate("awk '{print $1,$2}'; echo $10; 143 SORs; 2026-11-23; 60% and 40%")).toEqual([])
  })

  it("finds listed names whole-word and in any case", () => {
    const terms = parseTerms("# staff\nGalacgac\nDe Leon  # surname\n\n")
    expect(terms).toEqual(["Galacgac", "De Leon"])
    expect(findPrivate("Prepared by raquel GALACGAC, approved by Lito De  Leon Jr.", terms).map((f) => f.value)).toEqual([
      "GALACGAC",
      "De  Leon",
    ])
    expect(findPrivate("galacgacs and Deleon", terms)).toEqual([])
  })
})

describe("fileRefs", () => {
  it("finds the files that hold the posted text", () => {
    const cmd = `cd "C:/tmp/gh" && sed 's/{{SPEC}}/1187/g' t5.md > t5.out && gh issue edit 1192 --body-file t5.out`
    expect(fileRefs(cmd)).toEqual(["t5.md", "t5.out"])
    expect(cdTargets(cmd)).toEqual(["C:/tmp/gh"])
  })

  it("reads -F as a file for gh issue but as a field for gh api", () => {
    expect(fileRefs("gh issue create -F body.txt")).toEqual(["body.txt"])
    expect(fileRefs("gh api repos/o/r/issues/1/comments -F sub_issue_id=4 -F body=@reply.md")).toEqual(["reply.md"])
    expect(fileRefs('gh issue create --body-file="spec out.md"')).toEqual(["spec out.md"])
  })

  it("finds scripts run with bash", () => {
    expect(scriptPaths('bash "C:/tmp/gh/publish.sh"')).toEqual(["C:/tmp/gh/publish.sh"])
  })

  it("exposes the marker that lets made-up values through", () => {
    expect(ALLOW_MARKER).toBe("<!-- public-ok -->")
  })
})
