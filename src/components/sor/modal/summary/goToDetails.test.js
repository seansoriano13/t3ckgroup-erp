import { describe, expect, it, vi } from "vitest";

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));
import toast from "react-hot-toast";
import { goToDetails } from "./goToDetails";

describe("goToDetails", () => {
  it("opens the edit form, then scrolls to the team block", async () => {
    const order = [];
    const p = { canEdit: true, ctx: { isEditing: false }, handleEditToggle: vi.fn(async () => order.push("edit")) };
    await goToDetails(p, () => order.push("scroll"));
    expect(order).toEqual(["edit", "scroll"]);
  });
  it("does not close an edit form that is already open", async () => {
    const p = { canEdit: true, ctx: { isEditing: true }, handleEditToggle: vi.fn() };
    const scroll = vi.fn();
    await goToDetails(p, scroll);
    expect(p.handleEditToggle).not.toHaveBeenCalled();
    expect(scroll).toHaveBeenCalled();
  });
  it("tells a non-editor why nothing opens", async () => {
    const p = { canEdit: false, ctx: {}, handleEditToggle: vi.fn() };
    await goToDetails(p, vi.fn());
    expect(p.handleEditToggle).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
