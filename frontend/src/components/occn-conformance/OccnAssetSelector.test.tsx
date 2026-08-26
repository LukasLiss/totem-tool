// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectAsset } from "@/api/assetsApi";

import {
  OccnAssetSelector,
  type OccnAssetSelectorProps,
} from "./OccnAssetSelector";

const asset: ProjectAsset = {
  id: 42,
  project: 7,
  name: "Reference OCCN",
  asset_type: "OCCN",
  content_json: {},
  metadata: {},
  created_by: 1,
  created_at: "2026-07-22T10:00:00Z",
  updated_at: "2026-07-22T10:00:00Z",
};

const defaultProps: OccnAssetSelectorProps = {
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

describe("OccnAssetSelector", () => {
  it("shows disabled and loading states for unavailable input", () => {
    const { rerender } = render(
      <OccnAssetSelector {...defaultProps} projectId={null} />
    );

    expect(screen.getByText("Select an event log first")).toBeTruthy();

    rerender(<OccnAssetSelector {...defaultProps} loading />);
    expect(screen.getByLabelText("Loading OCCN models")).toBeTruthy();
  });

  it("shows a request error and invokes retry", () => {
    const onRetry = vi.fn();
    render(
      <OccnAssetSelector
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
      <OccnAssetSelector
        {...defaultProps}
        onOpenModelAssets={onOpenModelAssets}
      />
    );

    expect(screen.getByText("No OCCN models in this project.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Model Assets" }));
    expect(onOpenModelAssets).toHaveBeenCalledOnce();
  });

  it("shows the selected model and disables changes while running", () => {
    render(
      <OccnAssetSelector
        {...defaultProps}
        assets={[asset]}
        selectedAssetId={asset.id}
        disabled
      />
    );

    expect(screen.getByText("Reference OCCN")).toBeTruthy();
    expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
  });
});
