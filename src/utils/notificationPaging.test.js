import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_PAGE,
  addLiveNotification,
  appendOlderNotifications,
  mayHaveMore,
} from "./notificationPaging";

const rows = (n, start = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `n${start + i}` }));

describe("notification paging", () => {
  it("keeps a full list at 50 when a live notification arrives", () => {
    const out = addLiveNotification(rows(NOTIFICATION_PAGE), { id: "new" });
    expect(out).toHaveLength(NOTIFICATION_PAGE);
    expect(out[0].id).toBe("new");
  });

  it("lets a short list grow", () => {
    expect(addLiveNotification(rows(3), { id: "new" })).toHaveLength(4);
  });

  it("does not shrink a list the person loaded more of", () => {
    const out = addLiveNotification(rows(100), { id: "new" });
    expect(out).toHaveLength(100);
  });

  it("does not show the same notification twice", () => {
    const out = addLiveNotification(rows(3), { id: "n1" });
    expect(out.map((n) => n.id)).toEqual(["n1", "n0", "n2"]);
  });

  it("appends older rows and skips ones already shown", () => {
    const out = appendOlderNotifications(rows(3), [{ id: "n2" }, { id: "x" }]);
    expect(out.map((n) => n.id)).toEqual(["n0", "n1", "n2", "x"]);
  });

  it("flags a full list as maybe having more", () => {
    expect(mayHaveMore(rows(NOTIFICATION_PAGE))).toBe(true);
    expect(mayHaveMore(rows(10))).toBe(false);
  });
});
