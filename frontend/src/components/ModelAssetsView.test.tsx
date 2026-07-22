// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAssets, type ProjectAsset } from "@/api/assetsApi";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import { ModelAssetsView } from "./ModelAssetsView";

vi.mock("@/api/assetsApi", async () => {
  const actual = await vi.importActual<typeof import("@/api/assetsApi")>(
    "@/api/assetsApi"
  );
  return {
    ...actual,
    listAssets: vi.fn(),
  };
});

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));

const listAssetsMock = vi.mocked(listAssets);

const totemAsset: ProjectAsset = {
  id: 42,
  project: 7,
  name: "Reference TOTeM",
  asset_type: "TOTEM",
  content_json: {},
  metadata: {},
  created_by: 1,
  created_at: "2026-07-22T10:00:00Z",
  updated_at: "2026-07-22T10:00:00Z",
};

describe("ModelAssetsView conformance action", () => {
  beforeEach(() => {
    listAssetsMock.mockReset();
    listAssetsMock.mockResolvedValue([totemAsset]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens TOTeM conformance with the row model preselected", async () => {
    const setViewMode = vi.fn();
    render(
      <SelectedFileContext.Provider
        value={{
          selectedFile: { id: 12, project: 7, file: "event-log.xml" },
          setSelectedFile: vi.fn(),
        }}
      >
        <DashboardContext.Provider
          value={{ viewMode: { type: "modelAssets" }, setViewMode }}
        >
          <ModelAssetsView />
        </DashboardContext.Provider>
      </SelectedFileContext.Provider>
    );

    await waitFor(() => expect(screen.getByText("Reference TOTeM")).toBeTruthy());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Use Reference TOTeM for conformance",
      })
    );

    expect(setViewMode).toHaveBeenCalledWith({
      type: "conformance",
      component: "totem",
      assetId: 42,
    });
  });
});
