import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal, ConfirmModal, RenameChatModal } from "./Modal";

describe("Modal", () => {
  it("renders when isOpen is true", () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
        <p>Modal content</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Test Modal" })).toBeInTheDocument();
    expect(screen.getByText("Modal content")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()} title="Test Modal">
        <p>Modal content</p>
      </Modal>,
    );

    expect(screen.queryByText("Modal content")).not.toBeInTheDocument();
  });
});

describe("ConfirmModal", () => {
  it("calls onConfirm when confirm button clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal isOpen={true} title="Delete?" message="Are you sure?" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmModal isOpen={true} title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders danger variant", () => {
    render(
      <ConfirmModal
        isOpen={true}
        title="Delete?"
        message="Are you sure?"
        confirmText="Delete"
        variant="danger"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByText("Delete");
    expect(confirmBtn.className).toContain("red");
  });
});

describe("RenameChatModal", () => {
  it("pre-fills input with current title", () => {
    render(<RenameChatModal isOpen={true} currentTitle="My Chat" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const input = screen.getByLabelText("New title") as HTMLInputElement;
    expect(input.value).toBe("My Chat");
  });

  it("disables rename button when input is empty", () => {
    render(<RenameChatModal isOpen={true} currentTitle="" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const renameBtn = screen.getByText("Rename");
    expect(renameBtn).toBeDisabled();
  });
});
