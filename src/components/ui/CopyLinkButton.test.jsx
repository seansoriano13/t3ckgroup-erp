import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import toast from "react-hot-toast";
import CopyLinkButton from "@/components/ui/CopyLinkButton";

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe("CopyLinkButton", () => {
  it("copies the address of the window and says so", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyLinkButton />);

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(toast.success).toHaveBeenCalledWith("Link copied");
  });
});
