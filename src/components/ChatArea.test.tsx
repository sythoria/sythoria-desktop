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

const defaultProps = {
  onSuggestionClick: vi.fn(),
  isAtBottom: true,
  setIsAtBottom: vi.fn(),
  virtuosoRef: { current: null } as React.RefObject<null>,
};

describe("ChatArea", () => {
  it("shows empty state with search button when no messages", () => {
    const onSuggestionClick = vi.fn();
    render(<ChatArea messages={[]} {...defaultProps} onSuggestionClick={onSuggestionClick} />);

    expect(screen.getByRole("region", { name: /empty chat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enable web search/i })).toBeInTheDocument();
  });

  it("renders user messages", () => {
    const messages = [makeMessage({ role: "user", content: "Hello world" })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByRole("log", { name: /chat messages/i })).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders assistant messages with markdown", () => {
    const messages = [makeMessage({ role: "assistant", content: "Hi there **bold**" })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByRole("log")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("shows generating indicator when assistant is streaming with empty content", () => {
    const messages = [makeMessage({ role: "assistant", content: "", isStreaming: true })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("shows cursor when assistant is streaming with content", () => {
    const messages = [makeMessage({ role: "assistant", content: "Loading...", isStreaming: true })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    const cursor = document.querySelector(".cursor-blink");
    expect(cursor).toBeInTheDocument();
  });

  it("calls onSuggestionClick when search button is clicked", async () => {
    const user = userEvent.setup();
    const onSuggestionClick = vi.fn();
    render(<ChatArea messages={[]} {...defaultProps} onSuggestionClick={onSuggestionClick} />);

    const button = screen.getByRole("button", { name: /enable web search/i });
    await user.click(button);

    expect(onSuggestionClick).toHaveBeenCalled();
  });
});
