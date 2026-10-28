import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import CostGuideSection from "./CostGuideSection";
import CostingMatrixSettings from "./CostingMatrixSettings";

/**
 * The cost guide settings (#723): the categories with their low and high %. Super Admins change a range;
 * the database refuses anyone else (proven in 723-cost-guide.test.js).
 */
describe("the cost guide settings", () => {
  beforeEach(() => {
    db.seed("costing_cost_categories", { key: "products", label: "Products", low_pct: 70, high_pct: 80, sort: 1 });
    db.seed("costing_cost_categories", { key: "labor", label: "Labor", low_pct: 8, high_pct: 15, sort: 2 });
  });

  it("lists each category with its range", async () => {
    renderWithProviders(<CostGuideSection />);

    const rows = await screen.findAllByTestId("cost-guide-category");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByLabelText("Products: low %")).toHaveValue(70);
    expect(within(rows[1]).getByLabelText("Labor: high %")).toHaveValue(15);
  });

  it("saves a range that is typed", async () => {
    const user = setupUser();
    renderWithProviders(<CostGuideSection />);

    const low = await screen.findByLabelText("Labor: low %");
    await user.clear(low);
    await user.type(low, "9");
    await user.tab();

    await waitFor(() => expect(Number(db.rows("costing_cost_categories").find((c) => c.key === "labor").low_pct)).toBe(9));
  });

  it("refuses a low above the high and says why", async () => {
    const user = setupUser();
    renderWithProviders(<CostGuideSection />);

    const low = await screen.findByLabelText("Labor: low %");
    await user.clear(low);
    await user.type(low, "20");
    await user.tab();

    expect(await screen.findByText(/no higher than the high %/)).toBeInTheDocument();
    expect(Number(db.rows("costing_cost_categories").find((c) => c.key === "labor").low_pct)).toBe(8);
  });

  it("sits in the settings for a Super Admin and not for anyone else", async () => {
    const { unmount } = renderWithProviders(<CostingMatrixSettings isSuperAdmin />);
    expect(await screen.findByTestId("cost-guide-settings")).toBeInTheDocument();
    unmount();

    renderWithProviders(<CostingMatrixSettings hasFinanceAccess />);
    await screen.findByTestId("costing-matrix-settings");
    expect(screen.queryByTestId("cost-guide-settings")).not.toBeInTheDocument();
  });
});
