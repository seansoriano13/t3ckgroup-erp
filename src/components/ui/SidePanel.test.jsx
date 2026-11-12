import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import SidePanel from "./SidePanel";

function stubMedia(...matching) {
  window.matchMedia = (query) => ({
    matches: matching.some((m) => query.includes(m)),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

const Body = ({ onMount }) => {
  onMount?.();
  return <div>panel body</div>;
};

afterEach(() => vi.restoreAllMocks());

describe("SidePanel", () => {
  it("is an inline column when wide and tall, with no trigger", () => {
    stubMedia("min-width: 1440px");
    render(<SidePanel label="Chat"><Body /></SidePanel>);
    expect(screen.getByRole("complementary", { name: "Chat" })).toHaveTextContent("panel body");
    expect(screen.queryByRole("button", { name: /Chat/ })).toBeNull();
  });

  it("is a trigger plus right drawer on a laptop, focus returns on Escape", async () => {
    stubMedia("__none__");
    const user = setupUser();
    render(<SidePanel label="Chat" badge={3}><Body /></SidePanel>);
    const trigger = screen.getByRole("button", { name: /Chat/ });
    expect(trigger).toHaveTextContent("3");
    expect(screen.queryByText("panel body")).toBeNull();
    await user.click(trigger);
    expect(await screen.findByText("panel body")).toBeInTheDocument();
    expect(document.querySelector("[data-slot='drawer-content']").className).toMatch(/right-0/);
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByText("panel body")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("is a bottom sheet on a phone, opened from the sticky bar", async () => {
    stubMedia("max-width: 767.98px");
    const user = setupUser();
    render(<SidePanel label="Your move" badge="2" trigger="sticky"><Body /></SidePanel>);
    const bar = document.querySelector("[data-slot='side-panel-bar']");
    expect(bar).toHaveTextContent("Your move");
    expect(bar).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: /Your move/ }));
    expect(await screen.findByText("panel body")).toBeInTheDocument();
    expect(document.querySelector("[data-slot='drawer-content']").className).toMatch(/bottom-0/);
  });

  it("mounts its content once across modes", async () => {
    stubMedia("min-width: 1440px");
    const onMount = vi.fn();
    render(<SidePanel label="Chat"><Body onMount={onMount} /></SidePanel>);
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
