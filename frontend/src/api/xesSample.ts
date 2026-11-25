/**
 * The part of an XES file the column-mapping preview needs.
 *
 * The preview sends only the start of a file, so a large log is not
 * uploaded twice. For XES the "start" must be the first traces, not the
 * first bytes: some exports put megabytes of log-level metadata before the
 * first trace (the BPI Challenge 2015 logs carry ~6 MB of statistics in the
 * header), and a byte prefix then holds no event at all.
 *
 * So the file is streamed, gzip included: the XML up to and including the
 * `<log ...>` start tag is kept, everything between it and the first
 * `<trace` (globals, classifiers, log attributes, none of which is data) is
 * skipped, and `budget` bytes from the first trace on are kept. The result
 * is plain XML, cut off at the end, which the backend's preview tolerates.
 */

const encoder = new TextEncoder();
const LOG_OPEN = encoder.encode("<log");
const TRACE_OPEN = encoder.encode("<trace");
const GT = ">".charCodeAt(0);

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const last = haystack.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** `<trace` followed by whitespace, `>` or `/`, not e.g. `<traceInfo`. */
function findTraceStart(buf: Uint8Array, from = 0): { index: number; needMore: boolean } {
  let at = indexOf(buf, TRACE_OPEN, from);
  while (at >= 0) {
    const next = buf[at + TRACE_OPEN.length];
    if (next === undefined) return { index: -1, needMore: true };
    if (next === GT || next === 0x2f || next === 0x20 || next === 0x09 || next === 0x0a || next === 0x0d) {
      return { index: at, needMore: false };
    }
    at = indexOf(buf, TRACE_OPEN, at + 1);
  }
  return { index: -1, needMore: false };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export interface XesSample {
  blob: Blob;
  /** The name to preview it under (".gz" dropped once inflated here). */
  name: string;
  /** Whether more of the file follows the sample. */
  truncated: boolean;
}

export async function xesPreviewSample(
  file: File,
  budget = 2 * 1024 * 1024,
  /** Give up looking for the first trace after this many (inflated) bytes. */
  scanLimit = 512 * 1024 * 1024,
): Promise<XesSample> {
  const gzipped = /\.gz$/i.test(file.name);
  if (gzipped && typeof DecompressionStream === "undefined") {
    // No way to inflate here: send the raw start, as before.
    return { blob: file.slice(0, budget), name: file.name, truncated: file.size > budget };
  }
  let stream: ReadableStream<Uint8Array> = file.stream();
  if (gzipped) stream = stream.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const name = gzipped ? file.name.replace(/\.gz$/i, "") : file.name;
  const reader = stream.getReader();

  let phase: "head" | "skip" | "body" = "head";
  let buf: Uint8Array = new Uint8Array(0);
  let head: Uint8Array = new Uint8Array(0);
  const body: Uint8Array[] = [];
  let bodyLength = 0;
  let scanned = 0;
  let ended = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      scanned += value.length;
      buf = buf.length ? concat(buf, value) : value;

      if (phase === "head") {
        const logAt = indexOf(buf, LOG_OPEN);
        const gtAt = logAt >= 0 ? buf.indexOf(GT, logAt) : -1;
        if (gtAt >= 0) {
          head = buf.slice(0, gtAt + 1);
          buf = buf.slice(gtAt + 1);
          phase = "skip";
        } else if (scanned > budget) {
          break; // no <log> element where one should be: let the backend say so
        }
      }
      if (phase === "skip") {
        const { index, needMore } = findTraceStart(buf);
        if (index >= 0) {
          buf = buf.slice(index);
          phase = "body";
        } else {
          // Keep a tail in case "<trace" straddles two chunks.
          const keep = needMore ? TRACE_OPEN.length + 1 : TRACE_OPEN.length;
          buf = buf.slice(Math.max(0, buf.length - keep));
          if (scanned > scanLimit) break;
        }
      }
      if (phase === "body") {
        body.push(buf);
        bodyLength += buf.length;
        buf = new Uint8Array(0);
        if (bodyLength >= budget) break;
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => undefined);
  }

  if (phase === "head") {
    // Not recognisable XES: hand over what was read and let the backend say so.
    return { blob: file.slice(0, budget), name: file.name, truncated: file.size > budget };
  }
  const parts: BlobPart[] = [head as BlobPart, ...(body as BlobPart[])];
  return { blob: new Blob(parts), name, truncated: !ended };
}
