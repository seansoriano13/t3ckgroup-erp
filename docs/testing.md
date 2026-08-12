# Testing

```bash
pnpm test
```

`pnpm test:watch` while working, `pnpm test:coverage` for a report in `coverage/`.

---

## What this suite is built on

Tests run against a **fake Supabase**, not mocks of our own code. MSW intercepts
HTTP, and an in-memory store answers as PostgREST would. The real
`@supabase/supabase-js` client runs untouched — its query builder, its
`.single()` semantics, and the retry wrapper in `src/lib/supabase.js` are all
exercised. A test therefore checks the URL the application actually produces,
not a hand-written stand-in for the client's chaining API.

The consequence worth knowing: **a query shape that real PostgREST would reject
fails here too**. A typo'd foreign-key constraint name, a column that isn't in
the schema, a `.neq()` that silently drops NULL rows — all of it surfaces in the
test rather than in production.

### The schema comes from your SQL

`src/test/db/schema.js` parses `t3ckgroup.sql` and every file in
`supabase/migrations/`, in order. Tables, columns, types, NOT NULL, defaults,
primary keys, UNIQUE, CHECK constraints and foreign keys are all derived from
there.

**Add a table or column in a migration and the fake picks it up on the next test
run.** Nothing in `src/test/` needs editing.

The one exception is `src/test/db/triggers.js`, which mirrors the four row
triggers by hand — plpgsql bodies cannot be parsed. Each is annotated with the
migration it came from. If you change one of those triggers, change it there
too.

---

## Adding a test for a new module

### A pure function (`src/utils`, `src/constants`)

Import it and assert. Nothing else needed.

```js
import { describe, expect, it } from "vitest"
import { formatPHP } from "./sor"

it("renders a peso amount with two decimals", () => {
  expect(formatPHP(1234.5)).toBe("₱1,234.50")
})
```

### A service (`src/services`)

Seed with a factory, call the service, assert through the service.

```js
import { makeEmployee, makeOpportunity } from "@/test/factories"

it("refuses to leave Lead without a sales reference", async () => {
  const registrar = makeEmployee()
  const lead = makeOpportunity({ registered_by: registrar.id })

  await expect(
    opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id),
  ).rejects.toThrow(/Sales Reference is required/i)
})
```

The database resets between tests. No cleanup, no ordering assumptions.

### A hook (`src/hooks`)

`renderHook` from Testing Library. If the hook fetches, wrap it in a query
client:

```js
import { renderHookWithQuery } from "@/test/support"

const { result } = renderHookWithQuery(() => useProjectTitles())
await waitFor(() => expect(result.current).toContain("Network refresh"))
```

### A component (`src/components`, `src/pages`)

`renderWithProviders` from `@/test/support`. Components that read `useAuth`
need it stubbed so you can render as any role — see
`src/components/TaskCard.test.jsx` for the pattern. `AuthProvider` itself is
covered in `src/context/AuthContext.test.jsx`.

---

## The tools

### Factories — `@/test/factories`

`makeEmployee`, `makeHrEmployee`, `makeHead`, `makeSuperAdmin`, `makeCategory`,
`makeTask`, `makeOpportunity`, `makeOpportunityItem`, `makeSilLeave`,
`makeOvertimeRequest`, `makeOffsetLeave`, `makeCommitteeTask`,
`makeLeadSource`, `makeNotification`.

Each seeds the minimum its table's constraints require and creates its owning
rows on demand — `makeTask()` with no arguments produces a valid task, its
category and its author. Override only the field the test is about.

Factories go through the same validation as a real write, so a fixture that
could not exist in production fails at seed time.

### The store — `@/test/db/store`

- `db.rows("tasks")` — read stored rows, for asserting on state a service does
  not expose through its own interface (a balance, a soft-delete flag).
- `db.seed(table, rows)` — raw seeding when a factory does not fit.
- `db.setClock(iso)` — pin the clock when a test asserts a literal timestamp.

Prefer asserting through the service. Reach for `db.rows()` when the thing under
test genuinely has no read path.

### External boundaries — `@/test/msw/server`

Every non-database boundary has a sane default and a stub:

| Helper | Boundary |
| --- | --- |
| `stubRpc(name, result)` | `supabase.rpc(...)` |
| `stubEdgeFunction(name, result)` | `supabase.functions.invoke(...)` |
| `stubCloudinaryUpload(response)` | file uploads |
| `stubGithubCommits(commits)` | the changelog feed |
| `stubGeminiResponse(text)` | AI summaries |
| `stubAuthUser({ email, password })` | password sign-in |

Anything not covered by a handler **fails the test** rather than reaching the
internet.

### `waitForNetworkIdle()` — `@/test/network`

Several services fire and forget: a notification broadcast or an audit-log write
must never block the mutation that produced it. That means the request is still
in flight when the service call resolves. Before asserting on one:

```js
await silService.applySilLeave({ ... })
await waitForNetworkIdle()

expect(db.rows("notifications")).toHaveLength(2)
```

Teardown calls it too, so a stray write cannot land in the next test's database.

---

## Conventions

- **Test the behaviour, not the implementation.** Assert what the next person
  reads out of the system. Tests should survive a refactor.
- **Name the capability**, not the mechanism: "refuses to approve a leave the
  balance can no longer cover", not "handleSilLeaveDecision throws".
- **Expected values are literals.** Never recompute the answer the way the code
  does — the test must be able to disagree with the code.
- **One file per module**, named `<module>.test.js(x)`, beside the module.
- **Timezone is pinned to Asia/Manila** (`vitest.config.js`). Date handling here
  is local-time based; tests that ran in UTC would assert different behaviour
  than production sees.

---

## Environment notes

`src/test/env/jsdom-node-fetch.js` is a thin wrapper over Vitest's jsdom
environment. It exists for three interop problems, each documented in the file:

1. jsdom's `AbortController` is rejected by Node's `fetch`, which would fail
   every request the Supabase client makes.
2. Neither jsdom nor Node 26 supplies a usable `localStorage` here.
3. Realtime is a WebSocket, which MSW cannot intercept — subscriptions are
   stubbed to a socket that never opens, so components that subscribe mount
   cleanly.

`browser-image-compression` needs a real canvas and a Web Worker; in jsdom it
never resolves. Tests that upload images mock it:

```js
vi.mock("browser-image-compression", () => ({ default: async (file) => file }))
```

---

## Where coverage stands

| Layer | Lines | Notes |
| --- | --- | --- |
| `src/hooks` | 97% | All nine hooks |
| `src/constants` | 96% | Complete |
| `src/services` | 89% | All 19 top-level services |
| `src/context` | 86% | AuthContext |
| `src/utils` | 83% | Complete except `notificationPopup.jsx` |
| `src/services/tasks` | 77% | The four task services |
| `src/components` | 4% | **`TaskCard` and `ApplyLeaveModal` only** |
| `src/pages` | 0% | Not started |

The logic layers are covered; the UI layer is deliberately only started. Two
components were done first to establish the pattern — one read-heavy card with
permission rules (`TaskCard`), one write-heavy form against real balances
(`ApplyLeaveModal`). Extending to the rest is mechanical from there; the
highest-value targets are the approvals queue, the opportunity form, and the
employee admin form.

Run `pnpm test:coverage` for the current numbers.

## Known limitations of the fake

Worth knowing before you trust a green test too far:

- **Row Level Security is not enforced.** The fake answers as though every query
  is permitted. Policy changes need checking against a real database.
- **Only the four SOR triggers are mirrored.** Any trigger added later has to be
  transcribed into `src/test/db/triggers.js` or its effect will be missing.
- **Realtime is inert.** Subscription callbacks never fire; anything driven
  purely by a realtime event is untested.
- **Transactions are not modelled.** A multi-statement service call that fails
  halfway leaves its earlier writes in place, as it would with PostgREST's
  per-statement behaviour, but a real `BEGIN/ROLLBACK` would differ.
