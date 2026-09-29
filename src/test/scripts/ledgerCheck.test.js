import { describe, it, expect } from "vitest"
import { analyzeLedger } from "../../../scripts/lib/ledger.mjs"

// #332: `pnpm db:ledger:check prod` is the hard pre-flight gate in
// migrate-prod. It must fail on an orphan AND on an out-of-order pending
// migration, because either one turns `db push` into a refusal or, worse, a
// partial apply.

const row = (version, name = "m") => ({ version, name, stmt_count: 1 })

describe("analyzeLedger", () => {
    it("passes when every file is applied and the ledger claims nothing extra", () => {
        const result = analyzeLedger({
            ledger: [row("20260904000000"), row("20260905000000")],
            files: ["20260904000000_baseline.sql", "20260905000000_a.sql"],
        })
        expect(result.ok).toBe(true)
    })

    it("passes with pending migrations that all sort after the tip", () => {
        const result = analyzeLedger({
            ledger: [row("20260904000000")],
            files: ["20260904000000_baseline.sql", "20260905000000_a.sql"],
        })
        expect(result.ok).toBe(true)
        expect(result.pending).toEqual(["20260905000000_a.sql"])
    })

    it("fails on production's known-bad state: the orphan tip, with earlier migrations pending behind it", () => {
        // 20260914013100 offset_leave_approved_hours is in prod's ledger and
        // on no branch; it is also prod's tip, so earlier pending files would
        // be skipped.
        const result = analyzeLedger({
            ledger: [row("20260904000000"), row("20260914013100", "offset_leave_approved_hours")],
            files: [
                "20260904000000_baseline.sql",
                "20260909110000_drop_deprecated_quota_tables.sql",
                "20260928000000_sor_participant_modal_fields.sql",
            ],
        })

        expect(result.ok).toBe(false)
        expect(result.orphans.map((o) => o.version)).toEqual(["20260914013100"])
        expect(result.outOfOrder).toEqual(["20260909110000_drop_deprecated_quota_tables.sql"])
    })

    it("fails on an out-of-order pending migration even with no orphan", () => {
        const result = analyzeLedger({
            ledger: [row("20260904000000"), row("20260910000000")],
            files: ["20260904000000_baseline.sql", "20260909000000_late.sql", "20260910000000_b.sql"],
        })
        expect(result.orphans).toEqual([])
        expect(result.outOfOrder).toEqual(["20260909000000_late.sql"])
        expect(result.ok).toBe(false)
    })

    it("ignores anything that isn't a timestamped migration file", () => {
        const result = analyzeLedger({
            ledger: [row("20260904000000")],
            files: ["20260904000000_baseline.sql", "_archive", "README.md"],
        })
        expect(result.ok).toBe(true)
        expect(result.pending).toEqual([])
    })

    it("includeAll tolerates out-of-order pending files", () => {
        const result = analyzeLedger({
            ledger: [row("20260904000000"), row("20260910000000")],
            files: ["20260904000000_baseline.sql", "20260909000000_late.sql", "20260910000000_b.sql"],
            includeAll: true,
        })
        expect(result.outOfOrder).toEqual(["20260909000000_late.sql"])
        expect(result.ok).toBe(true)
    })

    it("includeAll still fails on orphans", () => {
        const result = analyzeLedger({
            ledger: [row("20260904000000"), row("20260914013100")],
            files: ["20260904000000_baseline.sql"],
            includeAll: true,
        })
        expect(result.ok).toBe(false)
    })
})
