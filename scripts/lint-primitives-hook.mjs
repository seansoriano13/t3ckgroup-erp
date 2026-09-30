// Claude Code PostToolUse hook (ADR 0025, ADR 0029). After an agent edits a
// .jsx file, lint it and hand any Primitive or PageShell violation back in the
// same turn.
//
// Runs the real CLI. The unrelated lint backlog stays silent; only
// local/no-raw-html and local/require-page-shell findings are reported. Exit 2
// feeds stderr back to the agent.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

let input = ''
for await (const chunk of process.stdin) input += chunk

let file
try {
  file = JSON.parse(input).tool_input?.file_path
} catch {
  process.exit(0)
}
if (!file || !file.endsWith('.jsx')) process.exit(0)

const run = spawnSync('pnpm', ['exec', 'eslint', JSON.stringify(file), '--format', 'json'], {
  encoding: 'utf8',
  shell: true,
  maxBuffer: 64 * 1024 * 1024,
})
let results
try {
  results = JSON.parse(run.stdout)
} catch {
  process.exit(0) // never block an edit on a tooling hiccup
}

const RULES = ['local/no-raw-html', 'local/require-page-shell']
const found = results.flatMap(({ messages }) =>
  messages.filter((m) => RULES.some((rule) => m.ruleId === rule || m.message.startsWith(`eslint-disable of ${rule}`))),
)
if (found.length === 0) process.exit(0)

const rel = path.relative(process.cwd(), file)
console.error(`Primitive / PageShell lint (ADR 0025, ADR 0029) failed in ${rel}. Fix before continuing:`)
for (const m of found) console.error(`  ${rel}:${m.line}:${m.column}  ${m.message}`)
process.exit(2)
