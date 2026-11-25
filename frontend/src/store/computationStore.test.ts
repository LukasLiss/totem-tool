import { describe, expect, it } from "vitest";
import { AxiosError, AxiosHeaders, CanceledError } from "axios";
import {
  computationFileId,
  computationLabel,
  isCancelledError,
  selectComputations,
  type Computation,
} from "./computationStore";

describe("computationLabel", () => {
  it("names the heavy endpoints and ignores the rest", () => {
    expect(computationLabel("/api/new-ocdfg/?file_id=3", "get")).toBe("Directly-follows graph");
    expect(computationLabel("/api/occn/?file_id=3&relativeOccuranceThreshold=0", "get")).toBe("Causal net");
    expect(computationLabel("/api/variants/?file_id=3", "get")).toBe("Variants");
    expect(computationLabel("/api/files/3/discover_totem/", "get")).toBe("TOTeM discovery");
    expect(computationLabel("/api/files/3/statistics/?after=1&before=2", "get")).toBe("Log statistics");
    expect(computationLabel("/api/files/3/suggested_time_window/", "get")).toBe("Choosing time window");
    expect(computationLabel("/api/files/", "post")).toBe("Importing event log");
    expect(computationLabel("/api/files/", "get")).toBeNull();
    expect(computationLabel("/api/files/3/object_types/", "get")).toBeNull();
    expect(computationLabel("/api/jobs/?ids=a", "get")).toBeNull();
    expect(computationLabel("/api/dashboard/", "get")).toBeNull();
    expect(computationLabel("/token/", "post")).toBeNull();
  });
});

describe("computationFileId", () => {
  it("reads the file id from the path, the query string or the params", () => {
    expect(computationFileId("/api/files/7/statistics/")).toBe(7);
    expect(computationFileId("/api/new-ocdfg/?file_id=12")).toBe(12);
    expect(computationFileId("/api/variants/", { file_id: "5" })).toBe(5);
    expect(computationFileId("/api/files/", {})).toBeNull();
  });
});

describe("isCancelledError", () => {
  it("recognises local aborts and backend cancellations", () => {
    expect(isCancelledError(new CanceledError("canceled"))).toBe(true);
    const cancelled = new AxiosError("cancelled", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 499,
      statusText: "",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: "Computation cancelled", code: "cancelled" },
    });
    expect(isCancelledError(cancelled)).toBe(true);
    const failed = new AxiosError("boom", "ERR_BAD_RESPONSE", undefined, undefined, {
      status: 500,
      statusText: "",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: "boom" },
    });
    expect(isCancelledError(failed)).toBe(false);
    expect(isCancelledError(new Error("other"))).toBe(false);
  });
});

describe("selectComputations", () => {
  const job = (id: string, url: string, fileId: number | null, startedAt: number): Computation => ({
    id, label: id, url, method: "get", fileId, startedAt, fraction: null, message: "", status: "running", controller: null,
  });
  const jobs = {
    a: job("a", "/api/new-ocdfg/?file_id=1", 1, 2),
    b: job("b", "/api/occn/?file_id=1", 1, 1),
    c: job("c", "/api/new-ocdfg/?file_id=2", 2, 3),
    d: job("d", "/api/jobs/", null, 4),
  };

  it("filters by file and endpoint, oldest first", () => {
    expect(selectComputations(jobs, { fileId: 1 }).map((j) => j.id)).toEqual(["b", "a", "d"]);
    expect(selectComputations(jobs, { fileId: 1, urlIncludes: "/new-ocdfg/" }).map((j) => j.id)).toEqual(["a"]);
    expect(selectComputations(jobs, { urlIncludes: ["/occn/", "/new-ocdfg/"] }).map((j) => j.id)).toEqual(["b", "a", "c"]);
    expect(selectComputations(jobs, { fileId: "2" }).map((j) => j.id)).toEqual(["c", "d"]);
  });
});
