/**
 * After you reset a database password in the Supabase dashboard, puts the new one everywhere this
 * PC and GitHub keep it: every postgres URL for that project in the .env.local / .env.mirror files of
 * the t3ckgroup-erp* folders beside this repo, and the GitHub secrets <TARGET>_DB_PASSWORD and
 * <TARGET>_DB_URL.
 *
 * Usage: node scripts/rotate-db-password.mjs <prod|staging>
 *
 * It asks for the new password with typing hidden, checks that it signs in, and only then writes.
 * It never prints a password or a URL, only which files and secrets it changed.
 */
import pg from "pg"
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const target = process.argv[2]
if (!["prod", "staging"].includes(target)) {
  console.error("Usage: node scripts/rotate-db-password.mjs <prod|staging>")
  process.exit(1)
}
const ref = target === "prod" ? "epqmberwewztzbrkhhss" : "fpjxdyowngpnovotbzqi"
const PREFIX = target === "prod" ? "PROD" : "STAGING"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const parent = join(repoRoot, "..")
const files = readdirSync(parent, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith("t3ckgroup-erp"))
  .flatMap((d) => [".env.local", ".env.mirror"].map((f) => join(parent, d.name, f)))
  .filter((f) => existsSync(f))

// Every postgres URL in a settings file; ours when its user or host names this project.
const URL_RE = /postgres(?:ql)?:\/\/[^\s"']+/g
const isOurs = (u) => u.username.includes(ref) || u.hostname.includes(ref)
const swap = (text, password) =>
  text.replace(URL_RE, (found) => {
    const u = new URL(found)
    if (!isOurs(u)) return found
    u.password = password
    return u.toString()
  })

const currentUrl = files
  .flatMap((f) => readFileSync(f, "utf8").match(URL_RE) ?? [])
  .find((found) => isOurs(new URL(found)))
if (!currentUrl) {
  console.error(`No ${target} database URL found in ${files.length} settings file(s). Nothing changed.`)
  process.exit(1)
}

function askHidden(question) {
  if (!process.stdin.isTTY) return Promise.resolve(readFileSync(0, "utf8"))
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")
    let value = ""
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off("data", onData)
          process.stdout.write("\n")
          resolve(value)
          return
        }
        if (c === "\u0003") {
          process.stdout.write("\nStopped. Nothing changed.\n")
          process.exit(130)
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1)
        else value += c
      }
    }
    stdin.on("data", onData)
  })
}

const password = (await askHidden(`New ${target} database password (typing is hidden): `)).trim()
if (!password) {
  console.error("No password typed. Nothing changed.")
  process.exit(1)
}

// Sign in with the new password before writing anything.
const testUrl = swap(currentUrl, password)
const client = new pg.Client({ connectionString: testUrl, ssl: { rejectUnauthorized: false } })
try {
  await client.connect()
  await client.query("select 1")
  await client.end()
} catch {
  console.error(`The new password does not sign in to the ${target} database. Nothing changed.`)
  process.exit(1)
}
console.log(`Signed in to ${target} with the new password.`)

for (const f of files) {
  const before = readFileSync(f, "utf8")
  const after = swap(before, password)
  if (after !== before) {
    writeFileSync(f, after)
    console.log(`  updated ${f}`)
  }
}

const secrets = [
  [`${PREFIX}_DB_PASSWORD`, password],
  [`${PREFIX}_DB_URL`, testUrl],
]
for (const [name, value] of secrets) {
  const r = spawnSync("gh", ["secret", "set", name], { input: value, cwd: repoRoot, encoding: "utf8" })
  console.log(r.status === 0 ? `  updated GitHub secret ${name}` : `  FAILED to update GitHub secret ${name}: ${r.stderr.trim()}`)
}
console.log("Done. The old password no longer works anywhere.")
