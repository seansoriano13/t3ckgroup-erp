# Testing

```bash
pnpm test
```

`pnpm test:watch` while working, `pnpm test:coverage` for a report in `coverage/`.

---

## The tiers

The suite is read as a pyramid, and each tier runs on its own:

| Tier | Command | What it covers | Where it lives |
| --- | --- | --- | --- |
| **Unit** | `pnpm test:unit` | One function, one hook, no I/O | `src/{utils,constants,lib,hooks}`, `src/test/db`, `src/test/factories` |
| **Integration** | `pnpm test:integration` | A service or component against the fake database | `src/{services,context,components}`, `src/test/pages/*.test.jsx` |
| **E2E** | `pnpm test:e2e` | A whole page, mounted and driven as a user | `src/test/pages/*.e2e.test.jsx` |
| **Policy** | `pnpm test:db` | RLS policies and plpgsql functions, executed against a real Postgres | `src/test/policy/**` |

The target shape is **70 / 20 / 10**. Where it actually stands:

| Tier | Tests | Share | Target |
| --- | ---: | ---: | ---: |
| Unit | 980 | 63% | 70% |
| Integration | 574 | 37% | 20% |
| E2E | 10 | 0.6% | 10% |

### The policy tier is separate on purpose

The first three tiers run against the fake database and are one command,
`pnpm test`. The fourth is not part of it, because it needs the local Supabase
stack running — a colleague without Docker up would otherwise see failures that
say nothing about their change.

It exists because the fake database is blind to the two things most likely to
hurt somebody:

- **Policies.** `src/test/db/schema.js` truncates every SQL source at its first
  `-- Functions` marker, so the parser has never read a policy. The fake
  enforces tables and constraints, and nothing about who may see a row.
- **Stored procedures.** `src/test/msw/postgrest.js` answers `rpc()` from a stub
  map. The functions that move an employee's leave balance have never run in a
  test; the service tests assert only that they were *called* correctly.

So a change to either can pass ~1,560 tests while being completely wrong. The
policy tier is the only place it can fail.

```bash
pnpm test:db        # resets the local database, then runs the tier
pnpm test:db:only   # runs it against the stack as it stands (for iterating)
```

`pnpm test:db` resets first because the tier is meant to prove the *migrations*,
not whatever state a machine has accumulated. Use `test:db:only` while writing a
test and `test:db` before trusting the result. CI runs it on any change under
`supabase/migrations/` (`.github/workflows/policy-tests.yml`).

> **`pnpm test:db` wipes your local database.** That includes the magic dev
> login and whatever `pnpm db:seed:restore` last pulled down. Restore it
> afterwards with `pnpm db:seed:fresh`. `test:db:only` touches nothing but the
> tier's own fixture rows.

Because it resets, the tier cannot assume any reference data exists. It seeds
what its fixtures need — currently one `crm_pipeline_stages` row, because
`sales_opportunities.status` has a foreign key to that table and no active
migration fills it. If a fixture starts failing on a foreign key after a reset,
that is the same gap, not a broken test.

Three things about how it is built are load-bearing:

- **Assertions go through an ordinary client holding a real signed-in user's
  token**, never the service role, because the service role bypasses RLS and
  would prove nothing. The service role appears only in seeding and teardown.
- **Identity resolves by the email claim.** `get_employee_id()` matches
  `auth.jwt() ->> 'email'` against `employees.email`, so every fixture creates an
  auth user *and* an employee row with the same address. Get that wrong and the
  helper returns null, every policy denies, and a matrix of refusals passes
  while proving nothing — which is why `01-fixture.test.js` asserts the link for
  all ten identities before anything else runs.
- **Every rule is asserted in both directions.** A permission proven without its
  matching refusal is half a test, and the refusals are the half that matters.

Some tests in `02-policies.test.js` deliberately assert behaviour that is
*wrong* — that every employee can read every deal, that `tasks` has no policies
at all. They are named for the issue that will change them. When that work
lands they fail, and rewriting them is how the change gets recorded.

Two notes on the gap, so nobody closes it the wrong way.

**Integration is over-weight because of what it covers, not because it is
padded.** 427 of those tests are service tests, and they are the ones that
catch a query shape real PostgREST would reject. They read as integration
because they cross a boundary, but they cost what a unit test costs — the fake
is in-memory. Deleting them to reach 20% would trade the suite's best tests for
a ratio. Close the gap by growing the unit tier instead, which is where new
extraction work should land anyway.

**E2E is capped by design.** A literal 10% would be roughly 190 journeys, which
contradicts what the tier is for — a small handful of whole-user paths. Each
one costs about a second of wall clock and breaks on any layout change, so the
rule here is: add a journey only for a path a user actually walks end to end,
and push everything narrower down a tier.

### Where a new test goes

- Can it be answered by calling a function with arguments? **Unit.** If the
  logic is currently tangled into a component, extract it first —
  `src/utils/approvalQueue.js` is the worked example.
- Does it need a row in the database, or a component wired to a service?
  **Integration.**
- Is it a path a real person walks, start to finish? **E2E** — and check the
  path is not already covered before adding one.
- Does it depend on an RLS policy or a plpgsql function actually running?
  **Policy** — the other three tiers cannot see either, so a test placed
  anywhere else will pass whether the rule is right or wrong.

### Why page tests live in `src/test/pages`

Everything else in this repo keeps its test beside the module. Page-level tests
cannot: Generouted routes every file under `src/pages` with a glob compiled into
the library, so a test file left there becomes a route — and drags msw, the fake
database and the SQL schema parser into the production bundle. The build fails
outright when that happens. `src/test/pages` is the workaround, and this
paragraph is why it is not an inconsistency to tidy up.

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

`src/test/db/schema.js` parses every file in `supabase/migrations/`, in
order — including the baseline (`20260904000000_baseline_schema.sql`, issue
#87), so the fake starts from the same 57 tables a fresh `supabase db reset`
does. Tables, columns, types, NOT NULL, defaults, primary keys, UNIQUE, CHECK
constraints and foreign keys are all derived from there.

**Add a table or column in a migration and the fake picks it up on the next test
run.** Nothing in `src/test/` needs editing.

The one exception is `src/test/db/triggers.js`, which mirrors the row
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

### A component (`src/components`)

`renderWithProviders` from `@/test/support`. Components that read `useAuth`
need it stubbed so you can render as any role — see
`src/components/TaskCard.test.jsx` for the pattern. `AuthProvider` itself is
covered in `src/context/AuthContext.test.jsx`.

### A page or a journey (`src/test/pages`)

Same helpers, but the file goes under `src/test/pages` rather than beside the
page — see [Why page tests live in `src/test/pages`](#why-page-tests-live-in-srctestpages).
Mount the page inside a `MemoryRouter`, stub `useAuth` to the role under test,
and let the real query hooks fetch from the fake database:

```js
renderWithProviders(
  <MemoryRouter>
    <TaskApprovalsPage />
  </MemoryRouter>,
)

await user.keyboard("4")
await user.keyboard("{Enter}")
await waitFor(() => expect(rowOf(task.id).grade).toBe(4))
```

Name it `*.e2e.test.jsx` when it is a whole journey, plain `*.test.jsx` when it
is one component wired to a service.

---

## The tools

### Factories — `@/test/factories`

`makeEmployee`, `makeHrEmployee`, `makeHead`, `makeSuperAdmin`, `makeCategory`,
`makeTask`, `makeOpportunity`, `makeOpportunityItem`, `makeStageRequirement`,
`makeRequirementStatus`, `makeOpportunityMember`, `makeSilLeave`,
`makeOvertimeRequest`, `makeOffsetLeave`, `makeGroupTask`, `makeLeadSource`,
`makePipelineStage`, `makeCommissionRate`, `makeCommissionDepartment`,
`makeCommissionPosition`, `makeCommissionSplit`, `makeNotification`,
`makeSaleType`, `makeSalesFlow`, `makeFlowStage`, `makeFlowEdge` (issue #36 —
`makeSaleType` creates the Sale Type only, not its flow: the two stay separate
factories so "a Sale Type with no flow" is representable for the one test that
needs it, the same way the service is what guarantees it never really happens).

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

Supabase Storage is the one exception to "stub a canned response": it's a small
in-memory fake (upload, signed URL, plain download) against the real bucket
constraints (size cap, allowed MIME types), the same way the database is faked
rather than stubbed. `seedStorageObject(bucket, path, { bytes, contentType })`
— `@/test/msw/storage` — plants an object a test didn't upload itself, for
reading back a signature/file another actor produced.

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
| `src/constants` | 96%+ | Complete |
| `src/hooks` | 96% | All nine hooks |
| `src/utils` | 95% | Complete except `notificationPopup.jsx` |
| `src/services` | 89% | All 19 top-level services |
| `src/lib` | 90% | Complete |
| `src/context` | 86% | AuthContext |
| `src/services/tasks` | 77% | The four task services |
| `src/components` | 4% | **`TaskCard` and `ApplyLeaveModal` only** |
| `src/pages` | — | The approvals queue only, via `src/test/pages` |

The logic layers are covered; the UI layer is deliberately only started. Three
areas were done first to establish the patterns — one read-heavy card with
permission rules (`TaskCard`), one write-heavy form against real balances
(`ApplyLeaveModal`), and the approvals queue, which is the worked example of all
three tiers over one feature: pure rules in `src/utils/approvalQueue.test.js`,
component-to-service wiring in `src/test/pages/approvalSplitView.test.jsx`, and
whole journeys in `src/test/pages/approvals.e2e.test.jsx`. Extending to the rest
is mechanical from there; the highest-value remaining targets are the
opportunity form and the employee admin form.

Run `pnpm test:coverage` for the current numbers.

## Known limitations of the fake

Worth knowing before you trust a green test too far:

- **Row Level Security is not enforced.** The fake answers as though every query
  is permitted. Policy changes need checking against a real database.
- **Only the data-shaping SOR triggers are mirrored.** Any trigger added later
  has to be transcribed into `src/test/db/triggers.js` or its effect will be
  missing. Permission triggers are the exception and are listed there as
  deliberately unmirrored: they branch on who the caller is, and the fake has
  no authenticated actor to answer with.
- **Realtime is inert.** Subscription callbacks never fire; anything driven
  purely by a realtime event is untested.
- **Transactions are not modelled.** A multi-statement service call that fails
  halfway leaves its earlier writes in place, as it would with PostgREST's
  per-statement behaviour, but a real `BEGIN/ROLLBACK` would differ.
- **A unique index over an expression is unenforced.** `create unique index …
  on t (lower(btrim(name)))` is understood as a partial-index predicate when it
  is a bare column list, but a real expression like `lower(btrim(name))` is
  left unenforced rather than evaluated — the same direction an unrecognised
  CHECK is handled. `sale_types_live_name_key` and `flow_stages_name_per_flow_key`
  (issue #36) are two examples: the case-insensitive name clash they guarantee
  in production is enforced only in `salesFlowService`'s own name checks, not
  by the fake. A service that needs the guarantee tested has to assert it
  where it enforces it, not lean on the fake to catch a collision.
