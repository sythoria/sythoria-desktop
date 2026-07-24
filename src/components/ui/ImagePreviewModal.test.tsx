import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImagePreviewModal } from "./ImagePreviewModal";

const image = {
  url: "data:image/png;base64,iVBORw0KGgo=",
  name: "appshot.png",
  size: 1024,
};

describe("ImagePreviewModal", () => {
  it("applies zoom button changes to the rendered image", async () => {
    const user = userEvent.setup();

    render(
      <ImagePreviewModal isOpen onClose={vi.fn()} images={[image]} activeIndex={0} onChangeActiveIndex={vi.fn()} />,
    );

    const preview = screen.getByAltText("appshot.png");

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(preview).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });

    await user.click(screen.getByTitle("Zoom In"));

    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(preview).toHaveStyle({ transform: "translate(0px, 0px) scale(1.25)" });

    await user.click(screen.getByTitle("Zoom Out"));

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(preview).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
  });
});
