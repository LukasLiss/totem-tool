import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { xesPreviewSample } from "./xesSample";

const header =
  '<?xml version="1.0" encoding="UTF-8"?>\n<!-- generated -->\n<log xes.version="1.0" xmlns="http://www.xes-standard.org/">\n';
// Log-level metadata ahead of the first trace, like the BPI Challenge 2015 logs.
const metadata = '\t<int key="01_HOOFD_101" value="843"/>\n'.repeat(50_000);
const trace = (i: number) =>
  `\t<trace><string key="concept:name" value="c${i}"/><event><string key="concept:name" value="A"/></event></trace>\n`;
const traces = Array.from({ length: 200 }, (_, i) => trace(i)).join("");
const xes = header + "\t<global scope=\"trace\"><string key=\"x\" value=\"y\"/></global>\n" + metadata + traces + "</log>\n";

async function text(blob: Blob) {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

describe("xesPreviewSample", () => {
  it("skips a large log header and starts the sample at the first trace", async () => {
    const file = new File([xes], "big-header.xes");
    expect(file.size).toBeGreaterThan(1_000_000);
    const sample = await xesPreviewSample(file, 4096);
    const out = await text(sample.blob);
    // The <log> start tag, then straight to the first trace.
    const logTag = header.trimEnd();
    expect(out.startsWith(logTag + "<trace>")).toBe(true);
    expect(out).not.toContain("01_HOOFD_101");
    expect(out).not.toContain("<global");
    expect(sample.truncated).toBe(true);
    expect(sample.name).toBe("big-header.xes");
  });

  it("inflates .xes.gz and previews it as plain XES", async () => {
    const file = new File([gzipSync(Buffer.from(xes))], "log.xes.gz");
    const sample = await xesPreviewSample(file, 4096);
    const out = await text(sample.blob);
    expect(sample.name).toBe("log.xes");
    expect(out).toContain('value="c0"');
  });

  it("keeps a whole small file, end tag included", async () => {
    const small = header + trace(1) + "</log>\n";
    const sample = await xesPreviewSample(new File([small], "s.xes"));
    expect(sample.truncated).toBe(false);
    expect(await text(sample.blob)).toBe(header.trimEnd() + trace(1).trimStart() + "</log>\n");
  });

  it("does not take <traceInfo> for a trace", async () => {
    const odd = header + '<traceInfo key="x"/>\n' + trace(7) + "</log>\n";
    const out = await text((await xesPreviewSample(new File([odd], "o.xes"))).blob);
    expect(out).not.toContain("traceInfo");
    expect(out).toContain('value="c7"');
  });
});
