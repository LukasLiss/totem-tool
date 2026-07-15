import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listAssets, uploadAsset, validateAssetUpload } from "./assetsApi";
import { addDashboard, getDashboards } from "./dashboardApi";
import {
  deleteEventLog,
  listEventLogs,
  uploadEventLog,
  type EventLog,
} from "./fileApi";
import { createProject, type Project } from "./projectApi";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

const project: Project = {
  id: 42,
  name: "Research",
  display_name: "Research",
  created_at: "2026-07-15T08:00:00Z",
};

const eventLog: EventLog = {
  id: 7,
  project: project.id,
  file: "/files/orders.json",
  uploaded_at: "2026-07-15T08:30:00Z",
  updated_at: "2026-07-15T08:30:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("project API contracts", () => {
  it("creates a named project without deriving identity from a file", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: project });

    await expect(createProject("Research")).resolves.toEqual(project);

    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:8000/api/projects/",
      { name: "Research" },
    );
  });

  it("creates an unnamed project with an empty request body", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { ...project, name: "", display_name: "Project 42" },
    });

    await createProject();

    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:8000/api/projects/",
      {},
    );
  });
});

describe("event-log project scoping", () => {
  it("lists event logs through an explicit project filter", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: [eventLog] });

    await expect(listEventLogs(project.id)).resolves.toEqual([eventLog]);

    expect(axios.get).toHaveBeenCalledWith(
      "http://localhost:8000/api/files/?project=42",
    );
  });

  it("includes the project id in an event-log upload", async () => {
    const file = new File(["{}"], "orders.json", { type: "application/json" });
    vi.mocked(axios.post).mockResolvedValue({ data: eventLog });

    await uploadEventLog({ projectId: project.id, file });

    const [url, body] = vi.mocked(axios.post).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/files/");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("project")).toBe("42");
    expect((body as FormData).get("file")).toBe(file);
  });

  it("deletes an event log through its scoped resource endpoint", async () => {
    vi.mocked(axios.delete).mockResolvedValue({});

    await deleteEventLog(eventLog.id);

    expect(axios.delete).toHaveBeenCalledWith(
      "http://localhost:8000/api/files/7/",
    );
  });
});

describe("model-asset project scoping", () => {
  it("validates a model file without requiring a project", async () => {
    const file = new File(["{}"], "model.json", { type: "application/json" });
    vi.mocked(axios.post).mockResolvedValue({ data: { valid: true } });

    await validateAssetUpload({ assetType: "TOTEM", file });

    const [url, body] = vi.mocked(axios.post).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/assets/validate/");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("asset_type")).toBe("TOTEM");
    expect((body as FormData).get("file")).toBe(file);
  });

  it("lists model assets through an explicit project filter", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: [] });

    await listAssets({ projectId: project.id, assetType: "TOTEM" });

    expect(axios.get).toHaveBeenCalledWith(
      "http://localhost:8000/api/assets/?project=42&asset_type=TOTEM",
    );
  });

  it("includes the project id in a model-asset upload", async () => {
    const file = new File(["{}"], "model.json", { type: "application/json" });
    vi.mocked(axios.post).mockResolvedValue({ data: {} });

    await uploadAsset({
      projectId: project.id,
      name: "Baseline",
      assetType: "TOTEM",
      file,
    });

    const [url, body] = vi.mocked(axios.post).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/assets/");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("project")).toBe("42");
    expect((body as FormData).get("name")).toBe("Baseline");
    expect((body as FormData).get("asset_type")).toBe("TOTEM");
    expect((body as FormData).get("file")).toBe(file);
  });
});

describe("dashboard project scoping", () => {
  it("lists dashboards through an explicit project filter", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: [] });

    await getDashboards(project.id);

    expect(axios.get).toHaveBeenCalledWith(
      "http://localhost:8000/api/dashboard/?project=42",
    );
  });

  it("includes the project id when creating a dashboard", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: 3 } });

    await addDashboard("Operations", project.id);

    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:8000/api/dashboard/",
      { name: "Operations", project: 42 },
    );
  });
});
