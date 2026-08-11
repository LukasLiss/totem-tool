// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listAssets,
  uploadAsset,
  type ProjectAsset,
} from "@/api/assetsApi";
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
    uploadAsset: vi.fn(),
  };
});

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));

const listAssetsMock = vi.mocked(listAssets);
const uploadAssetMock = vi.mocked(uploadAsset);

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

const occnAsset: ProjectAsset = {
  ...totemAsset,
  id: 43,
  name: "Reference OCCN",
  asset_type: "OCCN",
};

describe("ModelAssetsView row actions", () => {
  beforeEach(() => {
    listAssetsMock.mockReset();
    listAssetsMock.mockResolvedValue([totemAsset, occnAsset]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ["Reference TOTeM", "totem", 42],
    ["Reference OCCN", "occn", 43],
  ] as const)(
    "opens %s conformance with the row model preselected",
    async (name, component, assetId) => {
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

      await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
      fireEvent.click(
        screen.getByRole("button", { name: `Use ${name} for conformance` })
      );

      expect(setViewMode).toHaveBeenCalledWith({
        type: "conformance",
        component,
        assetId,
      });
    }
  );

  it.each([
    ["Reference TOTeM", "totem", 42],
    ["Reference OCCN", "occn", 43],
  ] as const)(
    "opens %s in its editor with the row model selected",
    async (name, component, assetId) => {
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

      await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: `Edit ${name}` }));

      expect(setViewMode).toHaveBeenCalledWith({
        type: "editor",
        component,
        openAssetId: assetId,
      });
    }
  );
});

describe("ModelAssetsView upload dialog", () => {
  beforeEach(() => {
    listAssetsMock.mockReset();
    uploadAssetMock.mockReset();
    listAssetsMock.mockResolvedValue([]);
    uploadAssetMock.mockResolvedValue(totemAsset);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uploads a dropped JSON file only after explicit confirmation", async () => {
    renderModelAssetsView();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const dialog = screen.getByRole("dialog");
    const file = jsonFile("reference.json", "totem");

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Reference model" },
    });
    dropFiles(
      within(dialog).getByLabelText("Select a JSON model file"),
      [file]
    );
    await waitFor(() =>
      expect(within(dialog).getByText("reference.json")).toBeTruthy()
    );
    expect(uploadAssetMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(uploadAssetMock).toHaveBeenCalledWith({
        projectId: 7,
        name: "Reference model",
        assetType: "TOTEM",
        file,
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const reopenedDialog = screen.getByRole("dialog");
    expect(
      within(reopenedDialog).getByLabelText("Name").getAttribute("value")
    ).toBe("");
    expect(within(reopenedDialog).queryByText("reference.json")).toBeNull();
  });

  it("submits a file-picker selection through the same upload request", async () => {
    renderModelAssetsView();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const dialog = screen.getByRole("dialog");
    const input = dialog.querySelector('input[type="file"]');
    if (!input) throw new Error("Dropzone file input not rendered");
    const file = jsonFile("picker-model.json", "totem");

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Picker model" },
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(within(dialog).getByText("picker-model.json")).toBeTruthy()
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(uploadAssetMock).toHaveBeenCalledWith({
        projectId: 7,
        name: "Picker model",
        assetType: "TOTEM",
        file,
      })
    );
  });

  it("keeps malformed JSON in the existing validation path", async () => {
    renderModelAssetsView();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Broken model" },
    });
    dropFiles(
      within(dialog).getByLabelText("Select a JSON model file"),
      [new File(["{"], "broken.json", { type: "application/json" })]
    );
    await waitFor(() =>
      expect(within(dialog).getByText("broken.json")).toBeTruthy()
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(
        within(dialog).getByText("Model file content must be valid JSON.")
      ).toBeTruthy()
    );
    expect(uploadAssetMock).not.toHaveBeenCalled();
  });

  it("rejects a dropped model whose schema does not match the selected type", async () => {
    renderModelAssetsView();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Wrong schema" },
    });
    dropFiles(
      within(dialog).getByLabelText("Select a JSON model file"),
      [jsonFile("occn.json", "occn")]
    );
    await waitFor(() =>
      expect(within(dialog).getByText("occn.json")).toBeTruthy()
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(
        within(dialog).getByText(
          'Expected schema "totem" for TOTeM assets.'
        )
      ).toBeTruthy()
    );
    expect(uploadAssetMock).not.toHaveBeenCalled();
  });

  it("resets the selected file and name after cancellation", async () => {
    renderModelAssetsView();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    let dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Temporary model" },
    });
    dropFiles(
      within(dialog).getByLabelText("Select a JSON model file"),
      [jsonFile("temporary.json", "totem")]
    );
    await waitFor(() =>
      expect(within(dialog).getByText("temporary.json")).toBeTruthy()
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name").getAttribute("value")).toBe("");
    expect(within(dialog).queryByText("temporary.json")).toBeNull();
    expect(
      within(dialog).getByText("Drop a JSON model here or click to select")
    ).toBeTruthy();
  });
});

function renderModelAssetsView() {
  return render(
    <SelectedFileContext.Provider
      value={{
        selectedFile: { id: 12, project: 7, file: "event-log.xml" },
        setSelectedFile: vi.fn(),
      }}
    >
      <DashboardContext.Provider
        value={{ viewMode: { type: "modelAssets" }, setViewMode: vi.fn() }}
      >
        <ModelAssetsView />
      </DashboardContext.Provider>
    </SelectedFileContext.Provider>
  );
}

function jsonFile(name: string, schema: string) {
  return new File([JSON.stringify({ schema, version: 1 })], name, {
    type: "application/json",
  });
}

function dropFiles(target: Element, files: File[]) {
  fireEvent.drop(target, {
    dataTransfer: {
      files,
      items: files.map((file) => ({
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      })),
      types: ["Files"],
    },
  });
}
