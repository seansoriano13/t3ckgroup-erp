import { describe, it, expect, vi } from "vitest";
import toast from "react-hot-toast";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupUser } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import NextIpasNumber from "./NextIpasNumber";

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const reading = { next_value: 120, number_format: "TGIPAS_120", highest_given: 119 };

describe("Next IPAS number in Purchasing settings (#600)", () => {
  it("shows the next number to everyone, with no field unless the person is a Super Admin", async () => {
    stubRpc("ipas_next_number", reading);
    renderWithProviders(<NextIpasNumber isSuperAdmin={false} />);
    expect(await screen.findByText("TGIPAS_120")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set next number" })).not.toBeInTheDocument();
  });

  it("lets a Super Admin set the next number, from a bare number or a TGIPAS_ one", async () => {
    const calls = [];
    stubRpc("ipas_next_number", reading);
    stubRpc("ipas_set_next_number", (args) => {
      calls.push(args);
      return { next_value: args.p_number, number_format: `TGIPAS_${args.p_number}`, highest_given: 119 };
    });
    renderWithProviders(<NextIpasNumber isSuperAdmin />);
    const user = setupUser();
    await screen.findByText("TGIPAS_120");

    const button = await screen.findByRole("button", { name: "Set next number" });
    expect(button).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "TGIPAS_150");
    await user.click(button);

    await waitFor(() => expect(calls).toEqual([{ p_number: 150 }]));
  });

  it("says why when the database refuses the number", async () => {
    stubRpc("ipas_next_number", reading);
    stubRpc("ipas_set_next_number", () => {
      throw Object.assign(
        new Error("ipas_set_next_number: TGIPAS_100 is already used or below it; the next number must be above TGIPAS_119"),
        { code: "22023" },
      );
    });
    renderWithProviders(<NextIpasNumber isSuperAdmin />);
    const user = setupUser();
    await user.type(await screen.findByRole("textbox"), "100");
    await user.click(screen.getByRole("button", { name: "Set next number" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^TGIPAS_100 is already used or below it/)),
    );
  });
});
