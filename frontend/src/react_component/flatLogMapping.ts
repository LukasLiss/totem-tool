/** Pure helpers of the column-mapping dialog (FlatLogMappingDialog.tsx). */
import type { FlatColumnMapping, FlatLogImportReport, FlatLogPreview, FlatLogRole } from "@/api/fileApi";

export function initialMapping(preview: FlatLogPreview): FlatColumnMapping[] {
  return preview.columns.map((c) => ({ column: c.name, ...c.suggestion }));
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
export function skippedRowsSummary(report: FlatLogImportReport | null | undefined): { title: string; lines: string[] } | null {
  if (!report) return null;
  const skipped = report.skipped_bad_timestamp + report.skipped_no_object + report.skipped_no_activity;
  if (skipped === 0) return null;
  const lines: string[] = [];
  if (report.skipped_bad_timestamp > 0) {
    const example = report.bad_timestamp_example ? ` (e.g. “${report.bad_timestamp_example}”)` : "";
    const format = report.timestamp_format === "auto" ? "any recognised format" : `“${report.timestamp_format}”`;
    lines.push(`${plural(report.skipped_bad_timestamp, "row")} with a timestamp that does not match ${format}${example}`);
  }
  if (report.skipped_no_object > 0) {
    lines.push(`${plural(report.skipped_no_object, "row")} without an object (case) id`);
  }
  if (report.skipped_no_activity > 0) {
    lines.push(`${plural(report.skipped_no_activity, "row")} without an activity`);
  }
  return {
    title: `Imported ${plural(report.events, "event")}; skipped ${plural(skipped, "row")} of ${report.rows.toLocaleString()}`,
    lines,
  };
}
