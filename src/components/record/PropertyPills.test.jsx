import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { setupUser } from "@/test/support";
import PropertyPills from "./PropertyPills";

describe("PropertyPills", () => {
  it("shows read-only pills as text, not buttons, and leaves out facts with no value", () => {
    render(
      <PropertyPills
        items={[
          { label: "Priority", value: "High" },
          { label: "Company", value: "T3CK Trading" },
          { label: "Location", value: "" },
        ]}
      />,
    );

    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens a picker on a pill the viewer may change, and reports the pick", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(
      <PropertyPills
        items={[
          {
            label: "Priority",
            value: "High",
            options: [
              { value: "high", label: "High" },
              { value: "low", label: "Low" },
            ],
            onChange,
          },
          { label: "Company", value: "T3CK Trading" },
        ]}
      />,
    );

    // Only the changeable pill is a button.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /Priority/ }));
    await user.click(await screen.findByRole("option", { name: "Low" }));

    expect(onChange).toHaveBeenCalledWith("low");
  });

  it("renders nothing when no pill has a value", () => {
    const { container } = render(<PropertyPills items={[{ label: "IPAS", value: "" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
