// Claude Code PreToolUse hook. Before a shell command posts text to GitHub (an
// issue, PR, comment, release or gist), scan that text for money amounts and
// for the names listed in .claude/private-terms.txt. The repo is public at
// times, so anything posted can be read by anyone, and GitHub keeps every
// edit in the issue's history even after a fix.
//
// The text is the command itself, any shell script it runs that posts, and the
// files those feed in (--body-file, field=@file, any .md/.txt/.out named).
// Exit 2 blocks the command and hands stderr to the agent; any error of the
// hook's own lets the command through.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ALLOW_MARKER,
  cdTargets,
  fileRefs,
  findPrivate,
  parseTerms,
  postsToGithub,
  scriptPaths,
} from "./lib/publicText.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const MAX_BYTES = 1024 * 1024

let input = ""
for await (const chunk of process.stdin) input += chunk

try {
  const { tool_input: toolInput, cwd } = JSON.parse(input)
  check(toolInput?.command, cwd || process.cwd())
} catch {
  process.exit(0)
}

function check(command, cwd) {
  if (typeof command !== "string" || !/\bgh\b/.test(command + scriptsText(command, cwd))) process.exit(0)

  const sources = [{ label: "the command", text: command, base: cwd }]
  for (const path of scriptPaths(command)) {
    const file = findFile(path, [cwd])
    if (!file) continue
    const text = readFileSync(file, "utf8")
    if (postsToGithub(text)) sources.push({ label: shortName(file, cwd), text, base: dirname(file) })
  }
  if (!sources.some((s) => postsToGithub(s.text))) process.exit(0)

  const cdDirs = cdTargets(command).map((dir) => resolve(cwd, localPath(dir)))
  const seen = new Set()
  for (const source of [...sources]) {
    for (const ref of fileRefs(source.text)) {
      for (const file of expand(ref, [source.base, ...cdDirs, cwd])) {
        if (seen.has(file)) continue
        seen.add(file)
        sources.push({ label: shortName(file, cwd), text: readFileSync(file, "utf8") })
      }
    }
  }
  if (sources.some((s) => s.text.includes(ALLOW_MARKER))) process.exit(0)

  const termsFile = join(repoRoot, ".claude", "private-terms.txt")
  const terms = existsSync(termsFile) ? parseTerms(readFileSync(termsFile, "utf8")) : []
  const findings = sources.flatMap((s) => findPrivate(s.text, terms).map((f) => ({ ...f, where: s.label })))
  if (findings.length === 0) process.exit(0)

  console.error("Blocked: this text would go on GitHub, where anyone may read it, and it holds private details:")
  for (const f of findings) console.error(`  - ${f.kind} "${f.value}" (in ${f.where})`)
  console.error('Rewrite it without them, for example "the order total" or "the Purchasing head", and run it again.')
  console.error(`Only if every flagged item is a made-up test value, or Sean said it may be public, add ${ALLOW_MARKER} to the text.`)
  console.error("Blocked names are listed in .claude/private-terms.txt (one per line, kept out of git).")
  process.exit(2)
}

/** Text of the scripts the command runs, so `bash publish.sh` counts when the script calls gh. */
function scriptsText(command, cwd) {
  return scriptPaths(command)
    .map((path) => findFile(path, [cwd]))
    .filter(Boolean)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
}

/** Git Bash writes /d/Sean/...; Node on Windows wants D:/Sean/... */
function localPath(path) {
  if (path.startsWith("~")) return join(homedir(), path.slice(1))
  const drive = process.platform === "win32" && path.match(/^\/([a-zA-Z])\/(.*)$/)
  return drive ? `${drive[1]}:/${drive[2]}` : path
}

function isSmallFile(file) {
  try {
    const stat = statSync(file)
    return stat.isFile() && stat.size <= MAX_BYTES
  } catch {
    return false
  }
}

function findFile(path, bases) {
  const local = localPath(path)
  const candidates = isAbsolute(local) ? [local] : bases.map((base) => resolve(base, local))
  return candidates.find(isSmallFile) ?? null
}

/** Existing files a reference names; a * in the file name matches like a shell glob. */
function expand(ref, bases) {
  if (!ref.includes("*")) {
    const file = findFile(ref, bases)
    return file ? [file] : []
  }
  const local = localPath(ref)
  const pattern = new RegExp(`^${basename(local).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
  const dirs = isAbsolute(local) ? [dirname(local)] : bases.map((base) => resolve(base, dirname(local)))
  for (const dir of dirs) {
    try {
      const hits = readdirSync(dir)
        .filter((name) => pattern.test(name))
        .map((name) => join(dir, name))
        .filter(isSmallFile)
      if (hits.length) return hits
    } catch {
      // not a folder here; try the next base
    }
  }
  return []
}

function shortName(file, cwd) {
  const rel = relative(cwd, file)
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : basename(file)
}
