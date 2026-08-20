import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NoteText } from "./MentionTextarea";

describe("NoteText", () => {
  it("renders plain text when there are no mentions", () => {
    render(<NoteText content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders non-interactive highlighted mention tag when onMentionClick is not provided", () => {
    render(
      <NoteText
        content="Hello @Alice how are you?"
        mentions={[{ id: "1", name: "Alice" }]}
      />
    );
    const mentionSpan = screen.getByText("@Alice");
    expect(mentionSpan.tagName).toBe("SPAN");
  });

  it("renders interactive button and calls onMentionClick when clicked", () => {
    const handleMentionClick = vi.fn();
    render(
      <NoteText
        content="Hello @Alice and @Bob"
        mentions={[
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ]}
        onMentionClick={handleMentionClick}
      />
    );

    const aliceButton = screen.getByRole("button", { name: "@Alice" });
    expect(aliceButton).toBeInTheDocument();

    fireEvent.click(aliceButton);
    expect(handleMentionClick).toHaveBeenCalledWith({ id: "1", name: "Alice" });
  });
});
