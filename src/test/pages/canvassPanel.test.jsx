import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { seedCanvass, stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc";
import { stubRpc } from "@/test/msw/server";
import { canvassService } from "@/services/canvassService";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import CostingMatrixSection from "@/components/costing/CostingMatrixSection";

/**
 * The Canvass opens from a Component row on the Costing Matrix (#276): a Canvass action for
 * Purchasing, a chip with the number once one exists, the Offers with the PHP figure beside a
 * foreign quote and "Quote expired" on a lapsed one, and no prices at all for a reader without the
 * money tier. Real components and services on the fake database; the matrix functions are
 * stubbed. Who may write is the policy tier's (90-canvass-tables.test.js).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("the Canvass on a Component row", () => {
  let purchaser;
  let deal;
  let component;

  const mount = ({ tier = "cost", bands = ["purchasing"], money = true } = {}) => {
    stubCostingMatrixRpcs({ tier, bands, actorId: purchaser.id });
    stubCanvassMoneyRpc({ money });
    renderWithProviders(<CostingMatrixSection opportunityId={deal.id} opportunity={deal} />);
    return setupUser();
  };

  beforeEach(() => {
    stubCanvassMoneyRpc({ money: true });
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    authUser = { id: purchaser.id };
    deal = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id, sales_reference: "S07983" });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 });
    component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Ambulance Folding Stretcher" });
  });

  const seedOffers = async () => {
    const canvass = await seedCanvass({ componentId: component.id }, purchaser.id);
    await canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", brand: "Redleaf", unitPrice: 78000 }, purchaser.id);
    await canvassService.addOffer(
      canvass.id,
      { supplierName: "Hong Kong", currency: "USD", unitPrice: 1280, comparisonRate: 56.5625, validUntil: "2020-01-01" },
      purchaser.id,
    );
    return canvass;
  };

  it("shows a draft on opening and leaves nothing behind when closed without an Offer (ADR 0034)", async () => {
    const user = mount();
    await user.click(await screen.findByRole("button", { name: /^Canvass Component 1.1$/ }));

    expect(await screen.findByTestId("canvass-not-started")).toBeInTheDocument();
    expect(screen.getByText(/Saving the first offer starts this Canvass/)).toBeInTheDocument();
    expect(db.rows("sor_canvasses")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByTestId("canvass-not-started")).not.toBeInTheDocument());
    expect(db.rows("sor_canvasses")).toHaveLength(0);
  });

  it("starts the Canvass, with its number, when the first Offer is saved", async () => {
    const user = mount();
    await user.click(await screen.findByRole("button", { name: /^Canvass Component 1.1$/ }));
    await screen.findByTestId("canvass-not-started");

    await user.type(screen.getByLabelText("Supplier"), "Redleaf Inc.");
    await user.type(screen.getByLabelText("Unit price in PHP"), "78000");
    await user.click(screen.getByRole("button", { name: /save offer/i }));

    expect(await screen.findByRole("heading", { name: /^CNV_0001\s*·/ })).toBeInTheDocument();
    expect(db.rows("sor_canvasses")).toHaveLength(1);
    expect(db.rows("sor_canvass_offers")).toHaveLength(1);
    expect(await screen.findAllByTestId("offer")).toHaveLength(1);
  });

  it("shows the Canvass number on the row once one exists", async () => {
    await seedOffers();
    mount();
    const chip = await screen.findByRole("button", { name: /Open Canvass CNV_0001/ });
    expect(chip).toHaveTextContent("CNV_0001");
    expect(screen.getByTestId("component-canvass")).toHaveTextContent("2 offers");
  });

  it("records an Offer and shows the PHP figure beside a foreign quote and the expiry", async () => {
    await seedOffers();
    const user = mount();
    await user.click(await screen.findByRole("button", { name: /Open Canvass CNV_0001/ }));

    const offers = await screen.findAllByTestId("offer");
    expect(offers).toHaveLength(2);
    expect(within(offers[0]).getByText("Redleaf Inc.")).toBeInTheDocument();
    expect(within(offers[1]).getByText("USD 1,280.00")).toBeInTheDocument();
    expect(within(offers[1]).getByTestId("php-figure")).toHaveTextContent("72,400.00");
    expect(within(offers[1]).getByText("Quote expired")).toBeInTheDocument();
    expect(within(offers[0]).queryByText("Quote expired")).not.toBeInTheDocument();
    expect(screen.getByTestId("more-offers-warning")).toHaveTextContent("Two offers only — below the three-offer minimum");

    await user.click(screen.getByRole("button", { name: /add offer/i }));
    await user.type(screen.getByLabelText("Supplier"), "Ferno");
    await user.type(screen.getByLabelText("Unit price in PHP"), "82500");
    await user.click(screen.getByRole("button", { name: /save offer/i }));

    await waitFor(() => expect(screen.getAllByTestId("offer")).toHaveLength(3));
    expect(screen.queryByTestId("more-offers-warning")).not.toBeInTheDocument();
  });

  it("shows a reader without the money tier the Offers and no prices", async () => {
    await seedOffers();
    const user = mount({ tier: "participant", bands: [], money: false });
    await user.click(await screen.findByRole("button", { name: /Open Canvass CNV_0001/ }));

    const offers = await screen.findAllByTestId("offer");
    expect(within(offers[0]).getByText("Redleaf Inc.")).toBeInTheDocument();
    expect(screen.queryByText(/72,400/)).not.toBeInTheDocument();
    expect(screen.queryByText(/78,000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/USD 1,280/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("php-figure")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add offer/i })).not.toBeInTheDocument();
  });

  it("offers no Canvass action to a reader who is not Purchasing, and none to start", async () => {
    mount({ tier: "price", bands: ["sales"], money: true });
    await screen.findByTestId("component");
    expect(screen.queryByTestId("component-canvass")).not.toBeInTheDocument();
  });

  describe("the Reference Rate on a foreign Offer (#317)", () => {
    const usd = { currency: "USD", rate_date: "2026-09-17", php_per_unit: 58.2, source: "ECB", overridden: false, divergence_pct: 2 };
    const startForeignOffer = async (user) => {
      await seedCanvass({ componentId: component.id }, purchaser.id);
      await user.click(await screen.findByRole("button", { name: /Open Canvass CNV_0001/ }));
      await user.click(await screen.findByRole("button", { name: /add offer/i }));
      await user.type(screen.getByLabelText("Supplier"), "Hong Kong");
      await user.click(screen.getByLabelText("Currency"));
      await user.click(await screen.findByRole("option", { name: "USD" }));
    };

    it("pre-fills the comparison rate with its date, and stores the typed value", async () => {
      const asked = [];
      const user = mount();
      stubRpc("reference_rate", (args) => {
        asked.push(args.p_currency);
        return args.p_currency === "USD" ? [usd] : [];
      });
      await startForeignOffer(user);

      const rate = screen.getByLabelText("Comparison rate");
      await waitFor(() => expect(rate).toHaveValue(58.2));
      expect(screen.getByTestId("offer-reference-rate")).toHaveTextContent(/USD 1 = ₱58\.20 · 17 Sep/);
      expect(asked).toContain("USD");

      await user.clear(rate);
      await user.type(rate, "58.5");
      await user.type(screen.getByLabelText("Unit price in USD"), "100");
      await user.click(screen.getByRole("button", { name: /save offer/i }));

      await waitFor(() => expect(db.rows("sor_canvass_offer_prices")).toHaveLength(1));
      expect(Number(db.rows("sor_canvass_offer_prices")[0].comparison_rate)).toBe(58.5);
    });

    it("still takes a typed comparison rate when no Reference Rate is available", async () => {
      const user = mount();
      stubRpc("reference_rate", () => []);
      await startForeignOffer(user);

      expect(await screen.findByTestId("offer-reference-rate")).toHaveTextContent(/No Reference Rate for USD/);
      const rate = screen.getByLabelText("Comparison rate");
      expect(rate).toHaveValue(null);
      await user.type(rate, "57");
      await user.type(screen.getByLabelText("Unit price in USD"), "100");
      await user.click(screen.getByRole("button", { name: /save offer/i }));

      await waitFor(() => expect(db.rows("sor_canvass_offer_prices")).toHaveLength(1));
      expect(Number(db.rows("sor_canvass_offer_prices")[0].comparison_rate)).toBe(57);
    });
  });
});
