import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import RequestPackingListActionModal from "./RequestPackingListActionModal";
import { renderWithProviders, setupUser } from "@/test/support";

describe("RequestPackingListActionModal", () => {
  it("saves the defaults as an empty-handed config: nobody named, so the Warehouse list is told", async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    renderWithProviders(<RequestPackingListActionModal isOpen onClose={() => {}} onSubmit={onSubmit} />);

    expect(screen.getByText("Leave blank to tell the Warehouse staff list.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith({ notify: [], confirmMode: undefined, decider: undefined });
  });

  it("keeps a saved confirmation and its Decider when saved again", async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    const decider = [{ type: "role", role: "deal_owner" }];
    renderWithProviders(
      <RequestPackingListActionModal
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        initialData={{ notify: [], confirmMode: "confirm", decider }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith({ notify: [], confirmMode: "confirm", decider });
  });
});
