import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { NewStandaloneDialog } from "./StandaloneDialogs";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { costingMatrixService, StandaloneStartError } from "@/services/costingMatrixService";

/**
 * "New evaluation from an S0" (#966): the three ways it can fail are said apart, an S0 that
 * already has an evaluation opens that one, and nothing starts until the S0 and both in-charges are named.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser, isAuthLoading: false }) }));

describe("NewStandaloneDialog", () => {
  let me;
  let pms;

  const pickPms = async (user) => {
    await user.click(screen.getByRole("combobox", { name: "Purchasing in-charge" }));
    await user.click(await screen.findByRole("option", { name: pms.name }));
  };
  const open = (props = {}) => {
    const onOpen = vi.fn();
    renderWithProviders(<NewStandaloneDialog open onOpenChange={() => {}} onOpen={onOpen} {...props} />);
    return onOpen;
  };

  beforeEach(() => {
    me = makeEmployee({ name: "Sales Starter", department: "SALES" });
    pms = makeEmployee({ name: "Purchasing Pat", department: "OPERATIONS" });
    authUser = { id: me.id };
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps Start off until the S0 number and both in-charges are given", async () => {
    const user = setupUser();
    open();
    const start = await screen.findByTestId("standalone-start");
    expect(start).toBeDisabled();

    await user.type(screen.getByLabelText("S0 number"), "S01237");
    expect(start).toBeDisabled();
    await pickPms(user);
    await waitFor(() => expect(start).toBeEnabled());
  });

  it.each([
    ["not_s0", "That is not an S0 number."],
    ["not_found", "No sale order S01237 in Odoo."],
    ["odoo_down", "Odoo could not be reached. Try again in a moment."],
  ])("says %s in its own words", async (kind, message) => {
    const user = setupUser();
    vi.spyOn(costingMatrixService, "startStandalone").mockRejectedValue(new StandaloneStartError(kind, message));
    open();
    await user.type(await screen.findByLabelText("S0 number"), "S01237");
    await pickPms(user);

    await user.click(screen.getByTestId("standalone-start"));

    expect(await screen.findByTestId(`standalone-problem-${kind}`)).toHaveTextContent(message);
  });

  it("opens what the S0 starts, or already has", async () => {
    const user = setupUser();
    const spy = vi.spyOn(costingMatrixService, "startStandalone").mockResolvedValue({ subjectId: "subject-1", existed: true, standalone: true });
    const onOpen = open();
    await user.type(await screen.findByLabelText("S0 number"), "s01237");
    await pickPms(user);

    await user.click(screen.getByTestId("standalone-start"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("subject-1"));
    expect(spy).toHaveBeenCalledWith({ s0Number: "s01237", salesIncharge: me.id, pmsIncharge: pms.id });
  });
});
