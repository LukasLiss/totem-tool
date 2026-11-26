/** Pure helpers of the column-mapping dialog (FlatLogMappingDialog.tsx). */
import type { FlatColumnMapping, FlatLogImportReport, FlatLogPreview, FlatLogRole } from "@/api/fileApi";

export function initialMapping(preview: FlatLogPreview): FlatColumnMapping[] {
  return preview.columns.map((c) => ({ column: c.name, ...c.suggestion }));
}

/** Roles only one column can have. */
export const SINGLE_ROLES: FlatLogRole[] = ["timestamp", "end_timestamp", "lifecycle"];

/**
 * The mapping for a re-read file (another separator, encoding or sheet):
 * columns that are still there keep what the user chose, new ones get
 * suggestions. A suggested timestamp (or end timestamp, or lifecycle) gives
 * way to one the user already picked.
 */
export function carryOverMapping(previous: FlatColumnMapping[], suggested: FlatColumnMapping[]): FlatColumnMapping[] {
  const byName = new Map(previous.map((c) => [c.column, c]));
  const carried = suggested.map((c) => byName.get(c.column) ?? c);
  const kept = new Set(carried.filter((c) => byName.has(c.column)).map((c) => c.role));
  return carried.map((c) =>
    SINGLE_ROLES.includes(c.role) && kept.has(c.role) && !byName.has(c.column) ? { ...c, role: "event_attribute" } : c,
  );
}

const FORMAT_LABELS: Record<string, string> = {
  auto: "automatic detection",
  iso: "ISO 8601",
  unix_s: "Unix time (seconds)",
  unix_ms: "Unix time (milliseconds)",
};

/** How a timestamp format is named to the user. */
export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format;
}

export function defaultObjectType(column: string, role: FlatLogRole): string {
  if (role === "resource") return "resource";
  const base = column
    .replace(/^case:concept:name$/i, "case")
    .replace(/[\s_:-]*(id|identifier|key|nr|no|number)$/i, "")
    .trim();
  return base || "case";
}

export interface MappingProblem {
  level: "error" | "warning";
  text: string;
}

/** What still keeps the mapping from being imported (mirrors FlatLogMapping.validate). */
export function mappingProblems(columns: FlatColumnMapping[]): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const count = (role: FlatLogRole) => columns.filter((c) => c.role === role).length;
  if (count("object_id") === 0) problems.push({ level: "error", text: "Choose at least one Object ID (case) column." });
  if (count("activity") === 0) problems.push({ level: "error", text: "Choose at least one Activity column." });
  if (count("timestamp") === 0) problems.push({ level: "error", text: "Choose a Timestamp column." });
  if (count("timestamp") > 1) problems.push({ level: "error", text: "Choose only one Timestamp column." });
  if (count("end_timestamp") > 1) problems.push({ level: "error", text: "Choose only one End timestamp column." });
  if (count("lifecycle") > 1) problems.push({ level: "error", text: "Choose only one Lifecycle column." });
  if (count("end_timestamp") > 0 && count("lifecycle") > 0) {
    problems.push({ level: "error", text: "Use either an End timestamp column or a Lifecycle column, not both." });
  }
  for (const c of columns) {
    if ((c.role === "object_id" || c.role === "resource") && !c.object_type?.trim()) {
      problems.push({ level: "error", text: `Name the object type of “${c.column}”.` });
    }
  }
  return problems;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/**
 * What to tell the user about rows a mapped import left out, or null when
 * every row became an event.
 */
export function skippedRowsSummary(
  report: FlatLogImportReport | null | undefined,
): { title: string; lines: string[]; skipped: number } | null {
  if (!report) return null;
  const skipped = report.skipped_bad_timestamp + report.skipped_no_object + report.skipped_no_activity;
  const renamed = Object.entries(report.renamed_attributes ?? {});
  const unlisted = Object.entries(report.unlisted_attributes ?? {});
  const merged = report.lifecycle_merged ?? 0;
  const openStarts = report.lifecycle_open_starts ?? 0;
  const otherTransitions = report.lifecycle_other ?? 0;
  const endUnparsed = report.end_unparsed ?? 0;
  const endName = report.end_attribute ?? "end_timestamp";
  const notes = merged + openStarts + otherTransitions + endUnparsed;
  if (skipped === 0 && renamed.length === 0 && unlisted.length === 0 && notes === 0) return null;
  const lines: string[] = [];
  if (report.skipped_bad_timestamp > 0) {
    const example = report.bad_timestamp_example ? ` (e.g. “${report.bad_timestamp_example}”)` : "";
    const format = report.timestamp_format === "auto" ? "any recognised format" : `“${formatLabel(report.timestamp_format)}”`;
    lines.push(`${plural(report.skipped_bad_timestamp, "row")} with a timestamp that does not match ${format}${example}`);
  }
  if (report.skipped_no_object > 0) {
    lines.push(`${plural(report.skipped_no_object, "row")} without an object (case) id`);
  }
  if (report.skipped_no_activity > 0) {
    lines.push(`${plural(report.skipped_no_activity, "row")} without an activity`);
  }
  // Start/complete pairs: one event at the start, the completion as an attribute.
  if (merged > 0) {
    lines.push(`Merged ${plural(merged, "start/complete pair")} into one event each; the completion time is in “${endName}”`);
  }
  if (openStarts > 0) {
    lines.push(`${plural(openStarts, "start")} without a completion, imported without an end time`);
  }
  if (otherTransitions > 0) {
    lines.push(`${plural(otherTransitions, "row")} with another lifecycle transition (e.g. schedule), kept as “activity - transition”`);
  }
  if (endUnparsed > 0) {
    const example = report.end_unparsed_example ? ` (e.g. “${report.end_unparsed_example}”)` : "";
    lines.push(`${plural(endUnparsed, "end time")} did not match the timestamp format${example}; those events have no end time`);
  }
  // Names the database cannot hold twice (it ignores case) were renamed.
  for (const [column, stored] of renamed) {
    lines.push(`Column “${column}” is stored as “${stored}” (the name was taken)`);
  }
  // Keys that first appear after the rows the dialog showed: kept, not lost.
  if (unlisted.length > 0) {
    const names = unlisted.map(([column, stored]) => (column === stored ? `“${column}”` : `“${column}” (as “${stored}”)`));
    lines.push(`Kept ${plural(unlisted.length, "attribute")} not in the preview: ${names.join(", ")}`);
  }
  return {
    title: skipped > 0
      ? `Imported ${plural(report.events, "event")}; skipped ${plural(skipped, "row")} of ${report.rows.toLocaleString()}`
      : `Imported ${plural(report.events, "event")}`,
    lines,
    skipped,
  };
}
