import { describe, expect, it } from "vitest";
import { sorsHref, tasksHref } from "./listLinks";

describe("listLinks", () => {
  it("puts the filter in the address and leaves empty values out", () => {
    expect(tasksHref({ status: "AWAITING APPROVAL", employee: "e1" })).toBe("/tasks?status=AWAITING+APPROVAL&employee=e1");
    expect(tasksHref({ employee: "e1" })).toBe("/tasks?employee=e1");
    expect(sorsHref({ employee: "e1", status: undefined })).toBe("/sors?employee=e1");
    expect(sorsHref()).toBe("/sors");
  });
});
