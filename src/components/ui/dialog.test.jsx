import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { RecordModalContent } from "./record-modal";
import { SelectField } from "./SelectField";

// The layer a Tailwind class list puts an element on: the number in its `z-[n]`, or 50 for `z-50`.
const layerOf = (element) => {
  const className = element.closest("[class*='z-']")?.className ?? "";
  const match = className.match(/(?:^|\s)!?z-\[(\d+)\]/) ?? className.match(/(?:^|\s)z-(\d+)/);
  return match ? Number(match[1]) : 0;
};
const popup = () => document.querySelector("[data-slot='dialog-content']");
const backdrop = () => document.querySelector("[data-slot='dialog-overlay']");

// #929: "Pick existing file" and "Revert to last stage" opened under the SOR window.
describe("Dialog layers", () => {
  it("puts a dialog with no layer of its own above the record windows", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Pick existing file</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(layerOf(popup())).toBe(80);
    expect(layerOf(backdrop())).toBe(80);
  });

  it("keeps a record window on its own layer, under the dialogs opened from it", () => {
    render(
      <Dialog open>
        <RecordModalContent className="z-[70]">
          <DialogTitle>SOR</DialogTitle>
        </RecordModalContent>
      </Dialog>,
    );
    expect(layerOf(popup())).toBe(70);
    expect(layerOf(backdrop())).toBe(70);
  });

  it("keeps a dialog that names z-[80] itself on that layer, with one backdrop", () => {
    render(
      <Dialog open>
        <DialogContent className="z-[80] sm:max-w-md">
          <DialogTitle>Confirm</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(layerOf(popup())).toBe(80);
    expect(document.querySelectorAll("[data-slot='dialog-overlay']")).toHaveLength(1);
  });

  it("opens a select's list above the dialog it sits in", async () => {
    const user = setupUser();
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Revert to last stage</DialogTitle>
          <SelectField options={[{ value: "a", label: "Alpha" }]} placeholder="Pick" />
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: "Alpha" });
    expect(layerOf(option)).toBeGreaterThan(layerOf(popup()));
  });
});
