import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, renderCostingDesk } from "@/test/support/costingDesk";
import { renderWithProviders, setupUser } from "@/test/support";
import PrintButton from "@/components/costing/desk/PrintButton";

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

describe("the S0 Evaluation print and sign-offs", () => {
  let sales;
  let buyer;
  let boss;
  let deal;
  let matrix;

  const mount = (me, stub = {}) => {
    authUser = { id: me.id, name: me.name, isFinalAcquire: me === boss };
    stubCostingMatrixRpcs({ tier: "closed_book", bands: [], actorId: me.id, ...stub });
    return renderCostingDesk(deal);
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

  // The Print button the PMS tab's card and the Costing Desk's window both carry.
  const mountPrint = (me) => {
    authUser = { id: me.id, name: me.name };
    stubCostingMatrixRpcs({ tier: "closed_book", bands: [], actorId: me.id });
    renderWithProviders(<PrintButton opportunityId={deal.id} opportunity={deal} />);
    return setupUser();
  };

  it("prints into a window opened in the click, naming who printed", async () => {
    const user = mountPrint(boss);
    await user.click(await screen.findByRole("button", { name: "Print" }));
    expect(printer.open).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(printer.print).toHaveBeenCalledTimes(1));
    expect(printer.print).toHaveBeenCalledWith(deal.id, expect.objectContaining({ printedBy: "Final Acquire Boss", opportunity: expect.objectContaining({ id: deal.id }) }));
  });

  it("prints nothing when a popup blocker refuses the window", async () => {
    printer.open.mockReturnValue(null);
    const user = mountPrint(boss);
    await user.click(await screen.findByRole("button", { name: "Print" }));
    expect(printer.print).not.toHaveBeenCalled();
  });

  it("offers no Prepared, Costed or Final approval button to anyone", async () => {
    for (const me of [sales, buyer, boss]) {
      mount(me);
      await openLines();
      expect(screen.queryByRole("button", { name: /Sign as (prepared|costed)/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Approve Final Acquire/ })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("shows Costed by itself when every row has a Final Acquire", async () => {
    const component = db.rows("costing_components")[0];
    db.seed("costing_component_costs", { component_id: component.id, acquire_unit: 100, final_acquire_unit: 100 });
    mount(sales);
    await openLines();
    expect(await screen.findByTestId("costed-derived")).toHaveTextContent("Costed");
  });

  it("does not show Costed while a row has no Final Acquire", async () => {
    mount(sales);
    await openLines();
    await screen.findByTestId("evaluation-bar");
    expect(screen.queryByTestId("costed-derived")).not.toBeInTheDocument();
  });

  it("keeps an old Prepared, Costed or Final signature visible as history, with no button", async () => {
    for (const role of ["prepared", "costed", "final_approved"]) db.seed("costing_signoffs", { matrix_id: matrix.id, role, signed_by: boss.id, signed_at: "2026-10-16T01:00:00Z" });
    mount(sales);
    await openLines();
    expect(await screen.findByTestId("signoff-prepared")).toHaveTextContent("Prepared by");
    expect(screen.getByTestId("signoff-costed")).toHaveTextContent("Costed by");
    expect(screen.getByTestId("signoff-final_approved")).toHaveTextContent("Final approval");
    expect(screen.queryByRole("button", { name: /Sign as|Approve Final/ })).not.toBeInTheDocument();
  });
});
