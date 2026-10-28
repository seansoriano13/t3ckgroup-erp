import { describe, it, expect } from "vitest";
import { groupChatNotifications } from "./groupChatNotifications";

const n = (id, over = {}) => ({
  id,
  type: "GROUP_TASK_COMMENT",
  reference_id: "t1",
  is_read: false,
  created_at: `2026-10-28T10:0${id}:00Z`,
  ...over,
});

describe("groupChatNotifications", () => {
  it("groups messages from one chat into one row with a count and newest", () => {
    const out = groupChatNotifications([n(3), n(2), n(1)]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(3);
    expect(out[0].groupCount).toBe(3);
    expect(out[0].groupIds).toEqual([3, 2, 1]);
    expect(out[0].is_read).toBe(false);
  });

  it("keeps different chats and non-chat rows separate", () => {
    const out = groupChatNotifications([
      n(4, { reference_id: "t2" }),
      n(3, { type: "TASK_ASSIGNED" }),
      n(2),
      n(1),
    ]);
    expect(out.map((x) => x.id)).toEqual([4, 3, 2]);
    expect(out[2].groupCount).toBe(2);
  });

  it("is read only when every message is read", () => {
    expect(
      groupChatNotifications([n(2, { is_read: true }), n(1)])[0].is_read,
    ).toBe(false);
    expect(
      groupChatNotifications([
        n(2, { is_read: true }),
        n(1, { is_read: true }),
      ])[0].is_read,
    ).toBe(true);
  });
});
