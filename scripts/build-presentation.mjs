#!/usr/bin/env node
/**
 * Generates src/data/presentation.json — the one file the Release Notes deck
 * reads (ADR 0022). Re-run it before presenting; nothing is fetched at runtime.
 *
 * Usage:
 *   node scripts/build-presentation.mjs
 *   node scripts/build-presentation.mjs --issues issues.json   # offline snapshot
 *   node scripts/build-presentation.mjs --check                # fails if stale
 *
 * The issue snapshot comes from `gh issue list --state open`. Without `gh` on
 * PATH the build refuses rather than writing a roadmap that silently claims
 * everything is done.
 */
import { readFileSync, writeFileSync, existsSync } from "fs"
import { execFileSync } from "child_process"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { buildPresentation } from "./lib/presentation.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const changelogPath = join(root, "src", "data", "changelog.json")
const supplementPath = join(root, "src", "data", "presentation-supplement.json")
const outputPath = join(root, "src", "data", "presentation.json")

function parseArgs(argv) {
  const result = { issuesFile: null, check: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--issues") result.issuesFile = argv[++i]
    else if (argv[i] === "--check") result.check = true
    else throw new Error(`Unrecognized argument: ${argv[i]}`)
  }
  return result
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function fetchOpenIssues() {
  try {
    const raw = execFileSync(
      "gh",
      ["issue", "list", "--state", "open", "--limit", "300", "--json", "number,title"],
      { encoding: "utf8", cwd: root },
    )
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `Could not read open issues through gh (${error.message}). ` +
        "Install and authenticate the GitHub CLI, or pass --issues <file> with a saved snapshot.",
    )
  }
}

function main() {
  const { issuesFile, check } = parseArgs(process.argv.slice(2))

  const changelog = readJson(changelogPath)
  const supplement = readJson(supplementPath)
  const issues = issuesFile ? readJson(issuesFile) : fetchOpenIssues()

  const built = buildPresentation({
    changelog,
    supplement,
    issues,
    generatedAt: new Date().toISOString(),
  })
  built.title = supplement.title

  if (built.roadmap.unassigned.length > 0) {
    console.warn(
      `! ${built.roadmap.unassigned.length} open issue(s) belong to no epic and are absent from the roadmap: ` +
        built.roadmap.unassigned.join(", "),
    )
  }

  if (check) {
    if (!existsSync(outputPath)) {
      console.error("x presentation.json has never been generated")
      process.exit(1)
    }
    const current = readJson(outputPath)
    const same =
      JSON.stringify({ ...current, generatedAt: null }) ===
      JSON.stringify({ ...built, generatedAt: null })
    if (!same) {
      console.error("x presentation.json is stale — re-run `pnpm presentation`")
      process.exit(1)
    }
    console.log("* presentation.json is current")
    return
  }

  writeFileSync(outputPath, `${JSON.stringify(built, null, 2)}\n`, "utf8")

  const { headline, underTheHood, roadmap, prototypes } = built
  console.log(`* wrote ${outputPath}`)
  console.log(
    `  ${headline.length} headline rows (${headline.filter((h) => h.demo).length} with a demo), ` +
      `${underTheHood.items.length} under the hood`,
  )
  console.log(
    `  roadmap: ${roadmap.openCount} open across ${roadmap.epicCount} epics ` +
      `(${roadmap.ticketCount} tickets), ${prototypes.length} prototypes`,
  )
}

main()
