import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatArea from "./ChatArea";
import type { Message } from "../types";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    role: "user",
    content: "Hello",
    timestamp: new Date(),
    ...overrides,
  };
}

describe("ChatArea", () => {
  it("shows empty state with suggestions when no messages", () => {
    const onSuggestionClick = vi.fn();
    render(<ChatArea messages={[]} onSuggestionClick={onSuggestionClick} />);

    expect(screen.getByRole("region", { name: /empty chat/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /suggested prompts/i })).toBeInTheDocument();
  });

  it("renders user messages", () => {
    const messages = [makeMessage({ role: "user", content: "Hello world" })];
    render(<ChatArea messages={messages} onSuggestionClick={vi.fn()} />);

    expect(screen.getByRole("log", { name: /chat messages/i })).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders assistant messages with markdown", () => {
    const messages = [makeMessage({ role: "assistant", content: "Hi there **bold**" })];
    render(<ChatArea messages={messages} onSuggestionClick={vi.fn()} />);

    expect(screen.getByRole("log")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("shows skeleton when assistant is streaming with empty content", () => {
    const messages = [makeMessage({ role: "assistant", content: "", isStreaming: true })];
    const { container } = render(<ChatArea messages={messages} onSuggestionClick={vi.fn()} />);

    const skeletons = container.querySelectorAll("[aria-hidden='true'].animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows cursor when assistant is streaming with content", () => {
    const messages = [makeMessage({ role: "assistant", content: "Loading...", isStreaming: true })];
    render(<ChatArea messages={messages} onSuggestionClick={vi.fn()} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    const cursor = document.querySelector(".cursor-blink");
    expect(cursor).toBeInTheDocument();
  });

  it("calls onSuggestionClick when suggestion is clicked", async () => {
    const user = userEvent.setup();
    const onSuggestionClick = vi.fn();
    render(<ChatArea messages={[]} onSuggestionClick={onSuggestionClick} />);

    const suggestion = screen.getByLabelText("Code Help");
    await user.click(suggestion);

    expect(onSuggestionClick).toHaveBeenCalledWith("code-help");
  });
});
