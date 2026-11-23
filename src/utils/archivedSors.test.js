import { describe, it, expect } from "vitest";
import { isArchivedSor, withoutArchived } from "./archivedSors";

describe("archived SORs", () => {
  const live = { id: "a", archived_at: null };
  const archived = { id: "b", archived_at: "2026-11-24T01:00:00Z" };
  const old = { id: "c" };

  it("tells an archived SOR from a live one", () => {
    expect(isArchivedSor(archived)).toBe(true);
    expect(isArchivedSor(live)).toBe(false);
    expect(isArchivedSor(old)).toBe(false);
  });

  it("drops archived SORs from the daily lists and keeps the rest in order", () => {
    expect(withoutArchived([live, archived, old]).map((o) => o.id)).toEqual(["a", "c"]);
  });
});
