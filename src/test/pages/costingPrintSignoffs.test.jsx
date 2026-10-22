import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import CostingMatrixSection from "@/components/costing/CostingMatrixSection";

/**
 * The Print button and the sign buttons on the PMS tab's Costing Matrix (#274). Real components and
 * services on the fake database; the matrix functions are stubbed, and the printer is mocked (the
 * view model and the document have their own tests). Who may sign is the policy tier's
 * (88-costing-print-signoffs.test.js).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

const printer = vi.hoisted(() => ({
  open: vi.fn(),
  print: vi.fn(),
}));
vi.mock("@/lib/pdf/costingMatrixPrinter", () => ({
  openCostingMatrixPrintWindow: printer.open,
  printCostingMatrix: printer.print,
}));

describe("the Costing Matrix print and sign-offs", () => {
  let sales;
  let buyer;
  let boss;
  let deal;
  let matrix;

  const mount = (me, stub = {}) => {
    authUser = { id: me.id, name: me.name, isFinalAcquire: me === boss };
    stubCostingMatrixRpcs({ tier: "closed_book", bands: [], actorId: me.id, ...stub });
    renderWithProviders(<CostingMatrixSection opportunityId={deal.id} opportunity={deal} />);
    return setupUser();
  };

  beforeEach(() => {
    printer.open.mockReset().mockReturnValue({ close: vi.fn() });
    printer.print.mockReset().mockResolvedValue(undefined);
    sales = makeEmployee({ name: "Sales Incharge" });
    buyer = makeEmployee({ name: "Purchasing Incharge", has_purchasing_flow: true });
    boss = makeEmployee({ name: "Final Acquire Boss" });
    deal = makeOpportunity({ registered_by: sales.id, deal_owner_id: sales.id });
    matrix = db.seed("costing_matrices", { opportunity_id: deal.id, sales_incharge_id: sales.id, purchasing_incharge_id: buyer.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue tripod", quantity: 1 });
    db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Tripod", compliance: "complies" });
  });

  it("prints into a window opened in the click, naming who printed", async () => {
    const user = mount(boss, { onFinalAcquireList: true });
    await user.click(await screen.findByRole("button", { name: "Print" }));
    expect(printer.open).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(printer.print).toHaveBeenCalledTimes(1));
    expect(printer.print).toHaveBeenCalledWith(deal.id, expect.objectContaining({ printedBy: "Final Acquire Boss", opportunity: expect.objectContaining({ id: deal.id }) }));
  });

  it("prints nothing when a popup blocker refuses the window", async () => {
    printer.open.mockReturnValue(null);
    const user = mount(boss);
    await user.click(await screen.findByRole("button", { name: "Print" }));
    expect(printer.print).not.toHaveBeenCalled();
  });

  it("shows each sign button only to the people who may sign it", async () => {
    let user = mount(sales);
    expect(await screen.findByRole("button", { name: "Sign as prepared" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign as costed" })).not.toBeInTheDocument();
    // The Deal Team reads this matrix at the Closed Book, so it may approve the Final Acquire and offer.
    expect(screen.getByRole("button", { name: /Approve Final Acquire/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign as prepared" }));
    await waitFor(() => expect(db.rows("costing_signoffs")).toEqual([expect.objectContaining({ role: "prepared", signed_by: sales.id })]));
    expect(await screen.findByTestId("signoff-prepared")).toHaveTextContent("Prepared by");
    expect(screen.queryByRole("button", { name: "Sign as prepared" })).not.toBeInTheDocument();
  });

  it("keeps Final approval from a viewer below the Closed Book who is not on the list", async () => {
    mount(sales, { tier: "price" });
    expect(await screen.findByRole("button", { name: "Sign as prepared" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve Final Acquire/ })).not.toBeInTheDocument();
  });

  it("offers Costed by to the Purchasing incharge and Final Acquire and offer to the list", async () => {
    mount(buyer);
    expect(await screen.findByRole("button", { name: "Sign as costed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign as prepared" })).not.toBeInTheDocument();
  });

  it("offers Final Acquire and offer to a member of the list, and says why a cleared one went", async () => {
    db.seed("costing_signoffs", { matrix_id: matrix.id, role: "final_approved", signed_by: boss.id, cleared_at: "2026-10-16T01:00:00Z", cleared_reason: "The Final Offer changed" });
    mount(boss, { onFinalAcquireList: true });
    expect(await screen.findByRole("button", { name: "Approve Final Acquire & offer" })).toBeInTheDocument();
    expect(screen.getByTestId("signoff-final_approved-cleared")).toHaveTextContent("Cleared: the Final Offer changed.");
  });
});
