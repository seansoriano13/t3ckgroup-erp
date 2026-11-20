import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/settings/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { orderAgeingRulesService } from "@/services/orderAgeingRulesService";
import { deliveryDeadlineService } from "@/services/deliveryDeadlineService";

/**
 * The Ageing rules section of Settings > Purchasing (#262, spec #261): one row
 * per step, days blank for no rule, Customs / Port Hold 3 shown
 * as a hint only. Purchasing access edits it; the database is what refuses
 * anyone else (75-order-ageing-rules).
 */

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser.current,
    logout: vi.fn(),
  }),
}));

const renderPurchasing = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
      <SettingsPage />
    </MemoryRouter>,
  );

const openAgeingRules = async () => {
  renderPurchasing();
  const user = setupUser();
  await user.click(await screen.findByRole("tab", { name: "Ageing rules" }));
  return user;
};

const rulesOf = async () => {
  const rules = await orderAgeingRulesService.getRules();
  return Object.fromEntries(rules.map((rule) => [rule.step, rule.days]));
};

describe("Settings > Purchasing: Ageing rules", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
  });

  it("shows every step with a blank days field, and the hint", async () => {
    await openAgeingRules();

    expect(await screen.findByRole("heading", { name: "Ageing rules", level: 2 })).toBeInTheDocument();
    expect(await screen.findByLabelText("Days for Ordered")).toHaveValue(null);
    for (const label of [
      "Order-Draft",
      "Payment Approval",
      "Ordered",
      "Processing / Preparing Shipment",
      "Shipped / Picked Up",
      "In Transit",
      "Customs / Port Hold",
      "Arrived at Local Hub",
      "Out for Delivery",
      "Delivered",
      "Delivered, no Transmittal raised",
      "Transmittal check open",
      "Costs complete, ready to file",
    ]) {
      expect(screen.getByLabelText(`Days for ${label}`)).toHaveValue(null);
    }
    expect(screen.getByText("Example: 3 days")).toBeInTheDocument();
  });

  it("saves a typed number as the rule", async () => {
    const user = await openAgeingRules();

    await user.type(await screen.findByLabelText("Days for Delivered"), "5");
    await user.click(screen.getByRole("button", { name: "Save ageing rules" }));

    await waitFor(async () => expect((await rulesOf()).delivered).toBe(5));
  });

  it("clears a rule when its field is emptied and saved", async () => {
    await orderAgeingRulesService.setRule("in_transit", 7);
    const user = await openAgeingRules();

    const field = await screen.findByLabelText("Days for In Transit");
    await waitFor(() => expect(field).toHaveValue(7));
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Save ageing rules" }));

    await waitFor(async () => expect((await rulesOf()).in_transit).toBeNull());
  });

  it("refuses zero days and saves nothing", async () => {
    const user = await openAgeingRules();

    await user.type(await screen.findByLabelText("Days for Shipped / Picked Up"), "0");
    await user.click(screen.getByRole("button", { name: "Save ageing rules" }));

    expect(await screen.findByText("Days must be a whole number above zero, or blank for no rule.")).toBeInTheDocument();
    expect((await rulesOf()).shipped).toBeNull();
  });

  it("shows the delivery deadline setting beside the rules, defaulting to 5 (#467)", async () => {
    await openAgeingRules();

    const field = await screen.findByLabelText("Days before the delivery deadline");
    expect(field).toHaveValue(5);
    expect(await deliveryDeadlineService.getNearDays()).toBe(5);
  });

  it("saves a new N for the delivery deadline, and refuses zero (#467)", async () => {
    const user = await openAgeingRules();

    const field = await screen.findByLabelText("Days before the delivery deadline");
    await user.clear(field);
    await user.type(field, "0");
    await user.click(screen.getByRole("button", { name: "Save deadline setting" }));
    expect(await screen.findByText("Days must be a whole number above zero.")).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "8");
    await user.click(screen.getByRole("button", { name: "Save deadline setting" }));
    await waitFor(async () => expect(await deliveryDeadlineService.getNearDays()).toBe(8));
  });
});
