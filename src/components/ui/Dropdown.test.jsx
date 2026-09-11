import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dropdown from "./Dropdown";

describe("Dropdown", () => {
  it("opens on trigger click and closes when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">Outside area</div>
        <Dropdown trigger={<button>Open Menu</button>}>
          {({ close }) => (
            <div>
              <p>Menu Content</p>
              <button onClick={close}>Done</button>
            </div>
          )}
        </Dropdown>
      </div>
    );

    expect(screen.queryByText("Menu Content")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Menu" }));
    expect(screen.getByText("Menu Content")).toBeInTheDocument();

    // Clicking outside closes the dropdown
    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByText("Menu Content")).not.toBeInTheDocument();
  });

  it("closes when pressing Escape", async () => {
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button>Open Menu</button>}>
        <div>Menu Content</div>
      </Dropdown>
    );

    await user.click(screen.getByRole("button", { name: "Open Menu" }));
    expect(screen.getByText("Menu Content")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Menu Content")).not.toBeInTheDocument();
  });
});
