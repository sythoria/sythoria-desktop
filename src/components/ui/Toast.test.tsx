import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastContainer, parseApiError } from "./Toast";
import type { Toast } from "./Toast";

describe("parseApiError", () => {
  it("maps 401 errors to friendly message", () => {
    const result = parseApiError(new Error("API error 401: Unauthorized"));
    expect(result).toContain("Invalid API key");
  });

  it("maps 429 errors to rate limit message", () => {
    const result = parseApiError(new Error("API error 429: Too Many Requests"));
    expect(result).toContain("Rate limited");
  });

  it("maps 500 errors to server error message", () => {
    const result = parseApiError(new Error("API error 500: Internal Server Error"));
    expect(result).toContain("Server error");
  });

  it("maps network errors to connection message", () => {
    const result = parseApiError(new Error("Failed to fetch"));
    expect(result).toContain("Network error");
  });

  it("maps timeout errors to timeout message", () => {
    const result = parseApiError(new Error("Request timeout"));
    expect(result).toContain("timed out");
  });

  it("maps invalid URL errors", () => {
    const result = parseApiError(new Error("Invalid URL"));
    expect(result).toContain("Invalid API URL");
  });

  it("returns generic message for unknown errors", () => {
    const result = parseApiError("some random error");
    expect(result).toBe("some random error");
  });

  it("handles non-Error, non-string errors", () => {
    const result = parseApiError({ unknown: true });
    expect(result).toContain("unexpected error");
  });

  it("truncates long error messages", () => {
    const longMsg = "x".repeat(300);
    const result = parseApiError(new Error(longMsg));
    expect(result.length).toBeLessThanOrEqual(203);
    expect(result).toContain("\u2026");
  });
});

describe("ToastContainer", () => {
  it("renders nothing when toasts is empty", () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={vi.fn()} />);

    expect(container.innerHTML).toBe("");
  });

  it("renders toast messages", () => {
    const toasts: Toast[] = [{ id: "t-1", message: "Test toast", variant: "info" }];
    render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />);

    expect(screen.getByText("Test toast")).toBeInTheDocument();
  });

  it("renders error toasts with alert role", () => {
    const toasts: Toast[] = [{ id: "t-1", message: "Error!", variant: "error" }];
    render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button clicked", () => {
    const onDismiss = vi.fn();
    const toasts: Toast[] = [{ id: "t-1", message: "Dismiss me", variant: "info" }];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);

    const btn = screen.getByLabelText("Dismiss notification");
    btn.click();
    expect(onDismiss).toHaveBeenCalledWith("t-1");
  });
});
