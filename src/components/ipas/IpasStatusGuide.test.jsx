import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { setupUser } from "@/test/support";
import IpasStatusGuideButton from "./IpasStatusGuide";

describe("the IPAS Status guide", () => {
  it("opens from the ? and names every step, with the team's meaning where there is one", async () => {
    const user = setupUser();
    render(<IpasStatusGuideButton />);

    await user.click(screen.getByRole("button", { name: "What do the IPAS Status steps mean?" }));

    const guide = await screen.findByTestId("ipas-status-guide");
    expect(within(guide).getByText("What the IPAS Status steps mean")).toBeInTheDocument();
    expect(within(guide).getByText("Order-Draft")).toBeInTheDocument();
    expect(within(guide).getByText("The normal customs step, not trouble.")).toBeInTheDocument();
    expect(within(guide).getAllByText("Import only")).toHaveLength(3);
    expect(within(guide).getByText(/each change is posted in the Chat/)).toBeInTheDocument();
  });
});
