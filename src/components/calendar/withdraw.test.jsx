/**
 * #623 (spec #609): Withdraw on the Calendar's detail panel. It appears only
 * on the viewer's own approved Offset / SIL / LWOP whose first Manila date has
 * not passed (ADR 0015, #613), and calls back so the page can run the same
 * service functions as before.
 */
import { screen } from "@testing-library/react";
import { renderWithProviders as render } from "@/test/support";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EntryDetail from "./EntryDetail";
import { canWithdrawEntry } from "./withdraw.js";

const TODAY = "2026-10-28";
const entry = (over = {}) => ({
  kind: "OFFSET",
  id: "o1",
  group_id: "g1",
  starts_at: "2026-10-30T01:00:00Z",
  ends_at: "2026-10-30T09:00:00Z",
  all_day: false,
  manila_date: "2026-10-30",
  employee: { id: "me", name: "Dana Reyes", department: "SALES", avatar: null },
  status: "APPROVED",
  hours: 8,
  venue: null,
  title: "Offset",
  details: {},
  ...over,
});

describe("canWithdrawEntry", () => {
  it("allows the viewer's own approved, upcoming Offset, SIL and LWOP", () => {
    for (const kind of ["OFFSET", "SIL", "LWOP"]) {
      expect(canWithdrawEntry(entry({ kind }), [], "me", TODAY)).toBe(true);
    }
  });

  it("allows the start day itself, refuses once the first Manila date has passed", () => {
    expect(canWithdrawEntry(entry({ manila_date: TODAY }), [], "me", TODAY)).toBe(true);
    expect(canWithdrawEntry(entry({ manila_date: "2026-10-27" }), [], "me", TODAY)).toBe(false);
  });

  it("judges a multi-day application by its first day, not the day clicked", () => {
    const first = entry({ id: "a", manila_date: "2026-10-27" });
    const later = entry({ id: "b", manila_date: "2026-10-29" });
    expect(canWithdrawEntry(later, [first, later], "me", TODAY)).toBe(false);
  });

  it("refuses colleagues' entries, pending entries, and overtime", () => {
    expect(canWithdrawEntry(entry(), [], "someone-else", TODAY)).toBe(false);
    expect(canWithdrawEntry(entry({ status: "PENDING" }), [], "me", TODAY)).toBe(false);
    expect(canWithdrawEntry(entry({ kind: "OVERTIME" }), [], "me", TODAY)).toBe(false);
  });
});

describe("EntryDetail Withdraw button", () => {
  const renderDetail = (e, props = {}) =>
    render(<EntryDetail entry={e} onClose={() => {}} entries={[e]} viewerId="me" onWithdraw={() => {}} {...props} />);

  it("calls onWithdraw with the entry", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-28T02:00:00Z") });
    const onWithdraw = vi.fn();
    const e = entry();
    renderDetail(e, { onWithdraw });
    vi.useRealTimers();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Withdraw" }));
    expect(onWithdraw).toHaveBeenCalledWith(e);
  });

  it("is absent on a colleague's entry and when no handler is given", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-28T02:00:00Z") });
    const { unmount } = renderDetail(entry({ employee: { id: "other", name: "Ben Lim" } }));
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    unmount();
    renderDetail(entry(), { onWithdraw: null });
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    vi.useRealTimers();
  });

  it("is absent once the first Manila date has passed", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-28T02:00:00Z") });
    renderDetail(entry({ manila_date: "2026-10-27" }));
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    vi.useRealTimers();
  });
});
