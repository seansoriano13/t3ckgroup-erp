import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Drawer, DrawerContent, DrawerTitle } from "./drawer";

describe("Drawer", () => {
  it("renders nothing when closed and content when open", () => {
    const { rerender } = render(
      <Drawer open={false}>
        <DrawerContent><DrawerTitle>Panel</DrawerTitle></DrawerContent>
      </Drawer>,
    );
    expect(screen.queryByText("Panel")).not.toBeInTheDocument();
    rerender(
      <Drawer open>
        <DrawerContent><DrawerTitle>Panel</DrawerTitle></DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText("Panel")).toBeInTheDocument();
  });

  it("requests close on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange}>
        <DrawerContent><DrawerTitle>Panel</DrawerTitle></DrawerContent>
      </Drawer>,
    );
    fireEvent.keyDown(screen.getByText("Panel"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
