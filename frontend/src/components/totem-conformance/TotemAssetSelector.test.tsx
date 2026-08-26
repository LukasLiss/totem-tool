// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TotemAssetSelector, type TotemAssetSelectorProps } from "./TotemAssetSelector";

const defaultProps: TotemAssetSelectorProps = {
  projectId: 7,
  assets: [],
  selectedAssetId: null,
  loading: false,
  error: null,
  onSelectAsset: vi.fn(),
  onRetry: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TotemAssetSelector", () => {
  it("shows disabled and loading states for unavailable input", () => {
    const { rerender } = render(
      <TotemAssetSelector {...defaultProps} projectId={null} />
    );

    expect(screen.getByText("Select an event log first")).toBeTruthy();

    rerender(<TotemAssetSelector {...defaultProps} loading />);
    expect(screen.getByLabelText("Loading TOTeM models")).toBeTruthy();
  });

  it("shows a request error and invokes retry", () => {
    const onRetry = vi.fn();
    render(
      <TotemAssetSelector
        {...defaultProps}
        error="Model store unavailable"
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Model store unavailable"
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("links the empty state to model asset management", () => {
    const onOpenModelAssets = vi.fn();
    render(
      <TotemAssetSelector
        {...defaultProps}
        onOpenModelAssets={onOpenModelAssets}
      />
    );

    expect(screen.getByText("No TOTeM models in this project.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Model Assets" }));
    expect(onOpenModelAssets).toHaveBeenCalledOnce();
  });
});
