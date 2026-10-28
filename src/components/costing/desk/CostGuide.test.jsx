import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { CostGuideView } from "./CostGuide";
import { shapeCostGuide } from "../../../services/costingMatrixService";

/**
 * The cost guide % view (#723): each category's share of the Final Offer beside its range, a warning when
 * outside, never a block. The figures come from the database (costing_cost_guide); the view only draws them.
 */

const database = (overrides = {}) => ({
  final_offer_total: 1000000,
  missing_offer: 0,
  missing_cost: 0,
  categories: [
    { key: "products", label: "Products", low_pct: 70, high_pct: 80, total: 750000, share_pct: 75, status: "within" },
    { key: "labor", label: "Labor", low_pct: 8, high_pct: 15, total: 100000, share_pct: 10, status: "within" },
    { key: "logistics", label: "Logistics & Transportation", low_pct: 3, high_pct: 7, total: 20000, share_pct: 2, status: "below" },
    { key: "overhead", label: "Overhead", low_pct: 2, high_pct: 5, total: 60000, share_pct: 6, status: "above" },
  ],
  uncategorised: { total: 0, share_pct: 0 },
  ...overrides,
});

const view = (overrides) => render(<CostGuideView guide={shapeCostGuide(database(overrides))} />);
const row = (key) => document.querySelector(`[data-category="${key}"]`);

describe("CostGuideView", () => {
  it("shows each category's share beside its range", () => {
    view();

    expect(within(row("products")).getByTestId("cost-guide-range")).toHaveTextContent("70% to 80%");
    expect(within(row("products")).getByTestId("cost-guide-share")).toHaveTextContent("75%");
    expect(within(row("labor")).getByTestId("cost-guide-share")).toHaveTextContent("10%");
    expect(row("products")).toHaveAttribute("data-status", "within");
  });

  it("flags a share outside its range with a warning, and says nothing is blocked", () => {
    view();

    expect(within(row("logistics")).getByText("Below range")).toBeInTheDocument();
    expect(within(row("overhead")).getByText("Above range")).toBeInTheDocument();
    expect(within(row("labor")).queryByText(/(Below|Above) range/)).not.toBeInTheDocument();
    const warning = screen.getByTestId("cost-guide-warning");
    expect(warning).toHaveTextContent("Logistics & Transportation, Overhead are outside the guide");
    expect(warning).toHaveTextContent("not blocked");
  });

  it("shows no warning when every share is in range", () => {
    view({ categories: database().categories.slice(0, 2) });

    expect(screen.queryByTestId("cost-guide-warning")).not.toBeInTheDocument();
  });

  it("asks for a Final Offer instead of showing shares it cannot work", () => {
    view({
      final_offer_total: null,
      missing_offer: 2,
      categories: database().categories.map((c) => ({ ...c, share_pct: null, status: null })),
    });

    expect(screen.getByTestId("cost-guide-no-offer")).toHaveTextContent("Type a Final Offer on every line");
    expect(within(row("labor")).getByTestId("cost-guide-share")).toHaveTextContent("—");
    expect(screen.queryByTestId("cost-guide-warning")).not.toBeInTheDocument();
  });

  it("shows Uncategorised only when old rows without a category carry cost, and notes costs with no Final Acquire", () => {
    const { unmount } = view();
    expect(screen.queryByTestId("cost-guide-uncategorised")).not.toBeInTheDocument();
    unmount();

    view({ uncategorised: { total: 50000, share_pct: 5 }, missing_cost: 2 });
    expect(screen.getByTestId("cost-guide-uncategorised")).toHaveTextContent("Uncategorised");
    expect(screen.getByTestId("cost-guide-uncategorised")).toHaveTextContent("5%");
    expect(screen.getByTestId("cost-guide-missing-cost")).toHaveTextContent("2 costs have no Final Acquire yet");
  });
});
