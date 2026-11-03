import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONDITION_KINDS } from "./stageGate";

const MIGRATION = readFileSync("supabase/migrations/20261119040000_832_guard_stage_move_gates.sql", "utf8");

// The database repeats the browser's gate checks (#832). A Condition kind the browser knows but the
// database does not would let a direct update skip that gate, so every kind must be named in the SQL.
describe("stage gate: database and browser agree on Condition kinds (#832)", () => {
  for (const kind of Object.values(CONDITION_KINDS)) {
    it(`the database handles the "${kind}" kind`, () => {
      expect(MIGRATION).toContain(`'${kind}'`);
    });
  }
});
