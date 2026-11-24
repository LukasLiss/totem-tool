/** Pure helpers of the column-mapping dialog (FlatLogMappingDialog.tsx). */
import type { FlatColumnMapping, FlatLogPreview, FlatLogRole } from "@/api/fileApi";

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
