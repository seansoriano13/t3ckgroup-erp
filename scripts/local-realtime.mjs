#!/usr/bin/env node
/**
 * Runs Supabase Realtime beside the local stack, so live updates (the SORS
 * Board, the Tasks page) can be seen working on `supabase start`'s database.
 *
 * Why this exists instead of `[realtime] enabled = true`: the image the CLI
 * pins (public.ecr.aws/supabase/realtime:v2.129.3) ships a 0-byte
 * libapparmor.so.1 and takes the whole stack down, which is why config.toml
 * disables Realtime (issue #87). v2.124.2 has a good library, so this starts
 * that one by hand, on the stack's own network, under the alias the CLI's Kong
 * already routes `/realtime/v1/*` to (`realtime-dev`) — nothing in the stack
 * itself changes. The container carries the CLI's project label, so
 * `supabase stop` removes it with everything else.
 *
 * Realtime's own migrations create `realtime.messages`; once they have, this
 * adds the one policy a signed-in client needs to receive a private broadcast
 * (the same one staging and prod already have — see
 * 20260930020000_sales_opportunities_realtime_broadcast.sql). It is
 * idempotent and touches nothing else in the database.
 *
 * Usage:
 *   node scripts/local-realtime.mjs            # start (default)
 *   node scripts/local-realtime.mjs stop
 *   node scripts/local-realtime.mjs status
 *
 * Needs `supabase start` to be running first. Local only: it reads the
 * stack's own deterministic dev secrets, never anything from staging or prod.
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const IMAGE = "public.ecr.aws/supabase/realtime:v2.124.2"

const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(
  readFileSync(join(repoRoot, "supabase", "config.toml"), "utf8"),
)?.[1]
if (!projectId) fail("Could not read project_id from supabase/config.toml.")

const container = `supabase_realtime_${projectId}`
const dbContainer = `supabase_db_${projectId}`
const network = `supabase_network_${projectId}`

function run(cmd, args, { allowFail = false, input } = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", input })
  if (result.status !== 0 && !allowFail) {
    fail(`${cmd} ${args[0]} failed:\n${(result.stderr || result.stdout || "").trim()}`)
  }
  return result
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const isRunning = () => run("docker", ["inspect", "-f", "{{.State.Running}}", container], { allowFail: true }).stdout.trim() === "true"

// Read off the auth container rather than `supabase status`, which would need
// the CLI (and a shell, on Windows) just to print a value the stack already has.
function localJwtSecret() {
  const out = run("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", `supabase_auth_${projectId}`], { allowFail: true }).stdout
  const secret = /^GOTRUE_JWT_SECRET=(.+)$/m.exec(out)?.[1]?.trim()
  if (!secret) fail("Could not read the JWT secret from the auth container — is `supabase start` running?")
  return secret
}

/**
 * Real user tokens are ES256 (GoTrue's `GOTRUE_JWT_KEYS`), which Realtime can
 * only verify against a public JWKS — with just the HS256 secret every signed-in
 * browser fails with `JwtSignerError`. The keys GoTrue holds include the private
 * half, so it is stripped here: Realtime is only ever given what verifies.
 */
function localJwks() {
  const out = run("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", `supabase_auth_${projectId}`], { allowFail: true }).stdout
  const raw = /^GOTRUE_JWT_KEYS=(.+)$/m.exec(out)?.[1]?.trim()
  if (!raw) return null
  const keys = JSON.parse(raw)
  const publicKeys = (Array.isArray(keys) ? keys : keys.keys).map(({ d, p, q, dp, dq, qi, ...publicPart }) => ({
    ...publicPart,
    key_ops: ["verify"],
  }))
  return JSON.stringify({ keys: publicKeys })
}

function psql(sql) {
  return run("docker", ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], { input: sql })
}

// The service, not just its table: on a second start `realtime.messages` is
// already there from the first run, so the table alone says "ready" while
// Realtime is still booting and the first client to connect is turned away.
const answersPing = () =>
  run(
    "docker",
    ["exec", container, "curl", "-sSf", "-o", "/dev/null", "-H", "Host: realtime-dev", "http://127.0.0.1:4000/api/ping"],
    { allowFail: true },
  ).status === 0

async function ready() {
  for (let i = 0; i < 90; i += 1) {
    if (!isRunning()) return false
    const hasMessages = psql("select to_regclass('realtime.messages') is not null").stdout.trim() === "t"
    if (hasMessages && answersPing()) return true
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return false
}

const POLICY_SQL = `
do $$
begin
  if to_regclass('realtime.messages') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'realtime' and tablename = 'messages'
         and policyname = 'authenticated can receive broadcasts'
     ) then
    create policy "authenticated can receive broadcasts"
      on "realtime"."messages" for select to authenticated using (true);
  end if;
end $$;
`

async function start() {
  if (run("docker", ["inspect", dbContainer], { allowFail: true }).status !== 0) {
    fail(`${dbContainer} is not running. Start the local stack first: supabase start`)
  }
  if (isRunning()) {
    console.log(`${container} is already running.`)
    return
  }
  run("docker", ["rm", "-f", container], { allowFail: true })

  const secret = localJwtSecret()
  const jwks = localJwks()
  const env = {
    PORT: "4000",
    DB_HOST: dbContainer,
    DB_PORT: "5432",
    DB_USER: "supabase_admin",
    DB_PASSWORD: "postgres",
    DB_NAME: "postgres",
    DB_AFTER_CONNECT_QUERY: "SET search_path TO _realtime",
    DB_ENC_KEY: "supabaserealtime",
    API_JWT_SECRET: secret,
    ...(jwks ? { API_JWT_JWKS: jwks } : {}),
    METRICS_JWT_SECRET: secret,
    FLY_ALLOC_ID: "abc123",
    FLY_APP_NAME: "realtime",
    SECRET_KEY_BASE: "EAx3IQhlcHXsY3lcm1r2vPbLEZ3IhI7KfUqCvBgTHaBDuHuHZ2xFqEeMR8mLHKn8",
    ERL_AFLAGS: "-proto_dist inet_tcp",
    ECTO_IPV6: "false",
    ENABLE_TAILSCALE: "false",
    DNS_NODES: "''",
    RLIMIT_NOFILE: "10000",
    APP_NAME: "realtime",
    SEED_SELF_HOST: "true",
    RUN_JANITOR: "true",
  }
  const args = [
    "run", "-d", "--name", container,
    "--network", network, "--network-alias", "realtime-dev",
    "--label", `com.supabase.cli.project=${projectId}`,
    "--restart", "unless-stopped",
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    IMAGE,
  ]
  run("docker", args)
  console.log(`Started ${container} (${IMAGE}); waiting for Realtime to create realtime.messages…`)

  if (!(await ready())) {
    const logs = run("docker", ["logs", "--tail", "25", container], { allowFail: true })
    console.error(logs.stdout + logs.stderr)
    // Not left behind: its restart policy would otherwise loop on a config error.
    run("docker", ["rm", "-f", container], { allowFail: true })
    fail("Realtime did not come up. Logs above.")
  }
  psql(POLICY_SQL)
  console.log("Ready. The broadcast policy is in place; ws://127.0.0.1:54321/realtime/v1 now reaches Realtime.")
}

function stop() {
  run("docker", ["rm", "-f", container], { allowFail: true })
  console.log(`Removed ${container}.`)
}

function status() {
  console.log(isRunning() ? `${container} is running.` : `${container} is not running.`)
}

const command = process.argv[2] || "start"
if (command === "start") await start()
else if (command === "stop") stop()
else if (command === "status") status()
else fail(`Unknown command "${command}". Use start, stop or status.`)
