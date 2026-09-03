import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveDiscoveredModel } from "./assetsApi";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
}));

const post = vi.mocked(axios.post);

describe("saveDiscoveredModel", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: { id: 1 } });
  });

  it("skips the global filter when the component does not show it", async () => {
    await saveDiscoveredModel({
      fileId: 12,
      name: "Model",
      modelType: "OCCN",
      params: { relative_occurrence_threshold: 0 },
    });

    expect(post).toHaveBeenCalledWith(
      "/api/files/12/save_discovered_model/",
      { name: "Model", model_type: "OCCN", params: { relative_occurrence_threshold: 0 } },
      { _skipGlobalFilter: true }
    );
  });

  it("sends the applied global filter when the component shows the filtered log", async () => {
    await saveDiscoveredModel({
      fileId: 12,
      name: "Model",
      modelType: "TOTEM",
      filterEnabled: true,
    });

    expect(post).toHaveBeenCalledWith(
      "/api/files/12/save_discovered_model/",
      { name: "Model", model_type: "TOTEM", params: {} },
      { _skipGlobalFilter: false }
    );
  });
});
