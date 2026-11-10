import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DesktopNotice from "./DesktopNotice";

describe("DesktopNotice", () => {
  it("says the page is best on desktop and hides from md up", () => {
    render(<DesktopNotice />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/best on desktop/i);
    expect(note.className).toContain("md:hidden");
  });

  it("accepts custom copy", () => {
    render(<DesktopNotice>Editing is easier on desktop.</DesktopNotice>);
    expect(screen.getByText("Editing is easier on desktop.")).toBeInTheDocument();
  });
});
