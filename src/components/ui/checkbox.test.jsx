import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("toggles by click", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="agree" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "agree" });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
    expect(box).toHaveAttribute("aria-checked", "true");
  });

  it("toggles by keyboard", async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="agree" />);
    const box = screen.getByRole("checkbox", { name: "agree" });
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(" ");
    expect(box).toHaveAttribute("aria-checked", "true");
    await user.keyboard(" ");
    expect(box).toHaveAttribute("aria-checked", "false");
  });

  it("follows controlled checked state", () => {
    function Harness() {
      const [on, setOn] = useState(true);
      return (
        <>
          <Checkbox aria-label="c" checked={on} onCheckedChange={setOn} />
          <button onClick={() => setOn(false)}>off</button>
        </>
      );
    }
    render(<Harness />);
    const box = screen.getByRole("checkbox", { name: "c" });
    expect(box).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByText("off"));
    expect(box).toHaveAttribute("aria-checked", "false");
  });

  it("ignores interaction when disabled", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="d" disabled onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "d" });
    fireEvent.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(box).toHaveAttribute("aria-checked", "false");
  });

  it("associates with a wrapping label", () => {
    render(
      <label>
        <Checkbox />
        <span>Remember me</span>
      </label>,
    );
    const box = screen.getByRole("checkbox", { name: "Remember me" });
    fireEvent.click(screen.getByText("Remember me"));
    expect(box).toHaveAttribute("aria-checked", "true");
  });
});
