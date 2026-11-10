import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import EditBar from "@/components/ipas/record/EditBar";
import { missingRequiredFiles } from "@/components/ipas/record/missingFiles";

const editor = { changed: 0, missing: [], done: 11, total: 19, saved: false, planError: null, save: vi.fn(), clear: vi.fn() };
const digestWith = (byPart) => ({ docs: { missingByPart: byPart } });

describe("missingRequiredFiles (#924)", () => {
  it("uses the rail's missing documents and sends proofs to Payments", () => {
    const files = missingRequiredFiles({
      ipas: { charges: [] },
      digest: digestWith({ purchasing: ["Supplier invoice"], finance: ["Proof of payment, 5 Nov"] }),
    });
    expect(files).toEqual([
      { label: "Supplier invoice", section: "documents" },
      { label: "Proof of payment, 5 Nov", section: "payments" },
    ]);
  });

  it("counts a charge with an amount and no file, and nothing once it is attached", () => {
    const digest = digestWith({});
    const charge = { amount_php: 100, attachment_url: null };
    expect(missingRequiredFiles({ ipas: { charges: [charge, { amount_php: null }] }, digest })).toEqual([{ label: "Charge file", section: "costs" }]);
    expect(missingRequiredFiles({ ipas: { charges: [{ ...charge, attachment_url: "x.pdf" }] }, digest })).toEqual([]);
  });
});

describe("EditBar files (#924)", () => {
  it("says fields and files missing, and drops the files part at 0", () => {
    const files = [{ label: "A", section: "documents" }, { label: "B", section: "payments" }, { label: "C", section: "costs" }];
    const { rerender } = render(<EditBar editor={editor} reveal={vi.fn()} missingFiles={files} />);
    expect(screen.getByText("11 of 19 fields · 3 files missing")).toBeInTheDocument();
    rerender(<EditBar editor={editor} reveal={vi.fn()} missingFiles={files.slice(0, 1)} />);
    expect(screen.getByText("11 of 19 fields · 1 file missing")).toBeInTheDocument();
    rerender(<EditBar editor={editor} reveal={vi.fn()} missingFiles={[]} />);
    expect(screen.getByText("11 of 19 fields")).toBeInTheDocument();
  });

  it("Next empty jumps to the missing file's section when no field is empty", async () => {
    const show = vi.fn();
    render(<EditBar editor={editor} reveal={vi.fn()} show={show} missingFiles={[{ label: "A", section: "payments" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Next empty" }));
    expect(show).toHaveBeenCalledWith("payments");
  });
});
