import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubRpc } from "@/test/msw/server";
import ReferenceRates from "./ReferenceRates";

describe("Reference Rates in Purchasing settings (#317)", () => {
  beforeEach(() => {
    db.seed("currency_rate_currencies", { currency: "USD", divergence_pct: 2 });
    db.seed("currency_rates", { currency: "USD", rate_date: "2026-09-12", php_per_unit: 58.2, source: "ECB via frankfurter.dev" });
  });

  it("lists each day's rate with the day it is for, and no override for a non-Super Admin", async () => {
    renderWithProviders(<ReferenceRates isSuperAdmin={false} />);
    const row = await screen.findByTestId("reference-rate-row");
    expect(row).toHaveTextContent(/USD 1 = ₱58\.20 · 12 Sep/);
    expect(row).toHaveTextContent("ECB via frankfurter.dev");
    expect(screen.queryByRole("form", { name: "Override a Reference Rate" })).not.toBeInTheDocument();
  });

  it("lets a Super Admin override a day's rate", async () => {
    const calls = [];
    stubRpc("override_currency_rate", (args) => {
      calls.push(args);
      return null;
    });
    renderWithProviders(<ReferenceRates isSuperAdmin />);
    const user = setupUser();
    const form = await screen.findByRole("form", { name: "Override a Reference Rate" });
    await user.type(within(form).getByLabelText("Currency"), "usd");
    const day = within(form).getByLabelText("Day");
    await user.clear(day);
    await user.type(day, "2026-09-12");
    await user.type(within(form).getByLabelText("PHP per unit"), "58.44");
    await user.click(within(form).getByRole("button", { name: "Override" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ p_currency: "USD", p_rate_date: "2026-09-12", p_php_per_unit: 58.44 });
  });

  it("marks an overridden day and says what it replaced", async () => {
    db.seed("currency_rates", {
      currency: "USD",
      rate_date: "2026-09-13",
      php_per_unit: 59,
      source: "override",
      overridden_at: "2026-09-13T02:00:00Z",
      replaced_php_per_unit: 58.3,
    });
    renderWithProviders(<ReferenceRates isSuperAdmin={false} />);
    const rows = await screen.findAllByTestId("reference-rate-row");
    expect(rows[0]).toHaveTextContent(/Overridden.*was ₱58\.30/);
  });
});
