import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import Dropdown from "./Dropdown";

describe("Dropdown", () => {
  it("opens on trigger click and closes when clicking outside", async () => {
    const user = setupUser();
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
    const user = setupUser();
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

  // Both popovers portal to document.body, so the inner one is a sibling of
  // the outer, not a descendant: the outer used to close on mousedown and
  // unmount the inner before its click could fire. That is the Flow Canvas
  // "View as" / "Access settings" bug — a PeoplePicker inside a portalled
  // Dropdown, where no option could be picked.
  describe("nested inside a portalled Dropdown", () => {
    const NestedFixture = ({ onPick }) => (
      <div>
        <div data-testid="outside">Outside area</div>
        <Dropdown usePortal trigger={<button>View as</button>}>
          {() => (
            <div>
              <p>Outer Panel</p>
              <Dropdown usePortal trigger={<button>Add people</button>}>
                {({ close }) => (
                  <button
                    onClick={() => {
                      onPick();
                      close();
                    }}
                  >
                    Ana Reyes
                  </button>
                )}
              </Dropdown>
            </div>
          )}
        </Dropdown>
      </div>
    );

    it("picks an inner option without closing the outer popover", async () => {
      const user = setupUser();
      const onPick = vi.fn();
      render(<NestedFixture onPick={onPick} />);

      await user.click(screen.getByRole("button", { name: "View as" }));
      await user.click(screen.getByRole("button", { name: "Add people" }));
      await user.click(screen.getByRole("button", { name: "Ana Reyes" }));

      expect(onPick).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Outer Panel")).toBeInTheDocument();
    });

    it("gives Escape to the innermost popover only", async () => {
      const user = setupUser();
      render(<NestedFixture onPick={() => {}} />);

      await user.click(screen.getByRole("button", { name: "View as" }));
      await user.click(screen.getByRole("button", { name: "Add people" }));

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("button", { name: "Ana Reyes" })).not.toBeInTheDocument();
      expect(screen.getByText("Outer Panel")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(screen.queryByText("Outer Panel")).not.toBeInTheDocument();
    });

    it("still closes the outer popover on a genuine outside click", async () => {
      const user = setupUser();
      render(<NestedFixture onPick={() => {}} />);

      await user.click(screen.getByRole("button", { name: "View as" }));
      await user.click(screen.getByRole("button", { name: "Add people" }));

      await user.click(screen.getByTestId("outside"));
      expect(screen.queryByText("Outer Panel")).not.toBeInTheDocument();
    });
  });
});
