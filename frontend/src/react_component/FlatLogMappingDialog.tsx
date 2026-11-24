/**
 * Column mapping for case-centric logs (XES, plain CSV), shown on import.
 *
 * A flat log does not say which column is the case, the activity or the
 * time, so — like Disco's import screen — the first rows are shown as a
 * table and every column gets a role. The backend suggests one per column
 * (`POST /api/files/preview/`); the user adjusts them, names the object type
 * of every id column and checks the timestamp format against the sample
 * (`POST /api/files/parse-timestamps/`, the parser the import itself uses).
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  parseTimestamps,
  previewFlatLog,
  type FlatColumnMapping,
  type FlatLogMapping,
  type FlatLogPreview,
  type FlatLogRole,
  type TimestampAmbiguity,
} from "@/api/fileApi";
import { carryOverMapping, defaultObjectType, formatLabel, initialMapping, mappingProblems } from "./flatLogMapping";

const ROLE_INFO: Record<FlatLogRole, { label: string; hint: string; tone: string; cell: string }> = {
  object_id: {
    label: "Object ID (case)",
    hint: "Each distinct value becomes an object of the type you name. The case id is one; several id columns make the log object-centric.",
    tone: "border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
    cell: "bg-sky-50/70 dark:bg-sky-950/40",
  },
  activity: {
    label: "Activity",
    hint: "Names the event. Several activity columns are joined with \" - \".",
    tone: "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    cell: "bg-emerald-50/70 dark:bg-emerald-950/40",
  },
  timestamp: {
    label: "Timestamp",
    hint: "When the event happened. Pick the format the values are written in.",
    tone: "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
    cell: "bg-amber-50/70 dark:bg-amber-950/40",
  },
  resource: {
    label: "Resource",
    hint: "Who did it. Stored as an object (type \"resource\" by default) so organizational mining can use it.",
    tone: "border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
    cell: "bg-violet-50/70 dark:bg-violet-950/40",
  },
  event_attribute: {
    label: "Event attribute",
    hint: "Kept as an attribute of each event.",
    tone: "border-slate-400 bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100",
    cell: "",
  },
  object_attribute: {
    label: "Object attribute",
    hint: "An attribute of the object in an id column (for example the customer of a case).",
    tone: "border-cyan-500 bg-cyan-50 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100",
    cell: "bg-cyan-50/50 dark:bg-cyan-950/30",
  },
  ignore: {
    label: "Ignore",
    hint: "Not imported.",
    tone: "border-dashed border-muted-foreground/40 text-muted-foreground",
    cell: "opacity-40",
  },
};

const ROLE_ORDER: FlatLogRole[] = [
  "object_id",
  "activity",
  "timestamp",
  "resource",
  "event_attribute",
  "object_attribute",
  "ignore",
];

const SPECIAL_FORMATS: { value: string; label: string }[] = [
  { value: "auto", label: "Detect automatically (ISO 8601, …)" },
  { value: "unix_s", label: "Unix time (seconds)" },
  { value: "unix_ms", label: "Unix time (milliseconds)" },
];
const CUSTOM_FORMAT = "__custom__";
const ENCODING_LABELS: Record<string, string> = {
  "utf-8": "UTF-8",
  "windows-1252": "Windows-1252 (Excel)",
  "iso-8859-1": "ISO-8859-1 (Latin-1)",
  "utf-16": "UTF-16 (Excel Unicode)",
};

/** Zone for timestamps that carry none, unless the user picks another. */
const DEFAULT_TIMEZONE = "UTC";

const DELIMITERS: { value: string; label: string }[] = [
  { value: ",", label: "Comma ( , )" },
  { value: ";", label: "Semicolon ( ; )" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe ( | )" },
];

/** Columns shown in the preview table (the import always uses all rows). */
const PREVIEW_ROWS = 50;

interface FlatLogMappingDialogProps {
  open: boolean;
  file: File | null;
  preview: FlatLogPreview | null;
  onCancel: () => void;
  onConfirm: (mapping: FlatLogMapping) => void;
}

export function FlatLogMappingDialog({ open, file, preview: initialPreview, onCancel, onConfirm }: FlatLogMappingDialogProps) {
  const [preview, setPreview] = useState<FlatLogPreview | null>(initialPreview);
  const [columns, setColumns] = useState<FlatColumnMapping[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(initialPreview);
    if (initialPreview) {
      const mapped = initialMapping(initialPreview);
      setColumns(mapped);
      setSelected(
        mapped.find((c) => c.role === "timestamp")?.column ?? mapped[0]?.column ?? null,
      );
    }
    setReloadError(null);
  }, [initialPreview]);

  const update = (column: string, patch: Partial<FlatColumnMapping>) => {
    setColumns((prev) =>
      prev.map((c) => {
        if (c.column !== column) {
          // Only one timestamp: choosing another demotes the old one.
          if (patch.role === "timestamp" && c.role === "timestamp") return { ...c, role: "event_attribute" };
          return c;
        }
        const next = { ...c, ...patch };
        if (patch.role === "object_id" || patch.role === "resource") {
          if (!c.object_type || (c.role !== "object_id" && c.role !== "resource")) {
            next.object_type = defaultObjectType(c.column, patch.role);
          }
        }
        if (patch.role === "timestamp" && !next.format) next.format = "auto";
        return next;
      }),
    );
  };

  // Object attributes point at an id column that may have changed role since.
  const idColumns = columns.filter((c) => c.role === "object_id" || c.role === "resource");

  /** Read the file again with another separator or encoding. */
  const reload = async (options: { delimiter?: string; encoding?: string }) => {
    if (!file || !preview) return;
    setReloading(true);
    setReloadError(null);
    try {
      const next = await previewFlatLog(
        file,
        options.delimiter ?? preview.delimiter,
        options.encoding ?? preview.encoding,
      );
      setPreview(next);
      // Keep what the user already chose for columns that are still there.
      const mapped = carryOverMapping(columns, initialMapping(next));
      setColumns(mapped);
      setSelected((current) =>
        mapped.some((c) => c.column === current) ? current : mapped[0]?.column ?? null,
      );
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Could not re-read the file.";
      setReloadError(message);
    } finally {
      setReloading(false);
    }
  };

  // ---- timestamp check against the sample, debounced --------------------
  const tsColumn = columns.find((c) => c.role === "timestamp");
  const tsIndex = preview && tsColumn ? preview.columns.findIndex((c) => c.name === tsColumn.column) : -1;
  const tsSamples = useMemo(
    () =>
      preview && tsIndex >= 0
        ? preview.rows.map((r) => (r[tsIndex] ?? "").trim()).filter((v) => v !== "")
        : [],
    [preview, tsIndex],
  );
  const [tsCheck, setTsCheck] = useState<{
    ok: number;
    total: number;
    example?: [string, string];
    firstBad?: string;
    /** The format the import will use ("auto" settles on one per column). */
    format: string;
    ambiguousWith: TimestampAmbiguity[];
  } | null>(null);
  const [tsChecking, setTsChecking] = useState(false);
  const [tsError, setTsError] = useState<string | null>(null);
  const tsFormat = tsColumn?.format || "auto";
  const tsZone = tsColumn?.timezone?.trim() || DEFAULT_TIMEZONE;

  useEffect(() => {
    if (!open || tsSamples.length === 0) {
      setTsCheck(null);
      setTsError(null);
      return;
    }
    let cancelled = false;
    setTsChecking(true);
    const handle = window.setTimeout(async () => {
      try {
        const check = await parseTimestamps(tsSamples, tsFormat, tsZone);
        if (cancelled) return;
        const results = check.results;
        setTsError(null);
        const okIndex = results.findIndex((r) => r !== null);
        const badIndex = results.findIndex((r) => r === null);
        setTsCheck({
          ok: results.filter((r) => r !== null).length,
          total: results.length,
          example: okIndex >= 0 ? [tsSamples[okIndex], results[okIndex] as string] : undefined,
          firstBad: badIndex >= 0 ? tsSamples[badIndex] : undefined,
          format: check.format,
          ambiguousWith: check.ambiguous_with,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setTsCheck(null);
        // A 400 names the problem (an unknown time zone); anything else is
        // a hiccup the import itself will report.
        setTsError(
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null,
        );
      } finally {
        if (!cancelled) setTsChecking(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, tsSamples, tsFormat, tsZone]);

  const problems = mappingProblems(columns);
  if (tsError) problems.push({ level: "error", text: tsError });
  if (tsCheck && tsCheck.total > 0 && tsCheck.ok === 0) {
    problems.push({ level: "error", text: `No sample timestamp matches “${formatLabel(tsFormat)}” (e.g. “${tsCheck.firstBad}”).` });
  } else if (tsCheck && tsCheck.ok < tsCheck.total) {
    problems.push({
      level: "warning",
      text: `${tsCheck.total - tsCheck.ok} of ${tsCheck.total} sample timestamps do not match “${formatLabel(tsCheck.format)}”; those events will be skipped.`,
    });
  }
  if (tsCheck && tsCheck.ambiguousWith.length > 0) {
    const alt = tsCheck.ambiguousWith[0];
    problems.push({
      level: "warning",
      text: `The timestamps also fit “${formatLabel(alt.format)}”: check that “${alt.value}” means ${formatIso(alt.as_chosen)} and not ${formatIso(alt.as_other)}.`,
    });
  }
  const blocking = problems.some((p) => p.level === "error");

  const confirm = () => {
    if (blocking || !preview) return;
    onConfirm({
      delimiter: preview.format === "csv" ? preview.delimiter : null,
      encoding: preview.format === "csv" ? preview.encoding : null,
      columns: columns.map((c) => {
        const out: FlatColumnMapping = { column: c.column, role: c.role };
        if (c.role === "object_id" || c.role === "resource") out.object_type = c.object_type?.trim();
        if (c.role === "timestamp") {
          out.format = c.format || "auto";
          out.timezone = c.timezone?.trim() || DEFAULT_TIMEZONE;
        }
        if (c.role === "object_attribute") {
          const target = c.target && idColumns.some((i) => i.column === c.target) ? c.target : undefined;
          if (target) out.target = target;
        }
        return out;
      }),
    });
  };

  const selectedMapping = columns.find((c) => c.column === selected) ?? null;
  const selectedInfo = preview?.columns.find((c) => c.name === selected);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="sm:max-w-6xl w-[95vw] h-[min(46rem,92vh)] flex flex-col gap-3 p-5"
        data-testid="flat-log-mapping-dialog"
      >
        <DialogHeader>
          <DialogTitle>Map the columns of {file?.name ?? "the event log"}</DialogTitle>
          <DialogDescription>
            This is a case-centric log ({preview?.format === "xes" ? "XES" : "CSV"}): tell TOTeM what each
            column holds. Click a column to configure it. You need at least one object (case) id, an
            activity and a timestamp.
          </DialogDescription>
        </DialogHeader>

        {/* ---- the selected column's configuration ---- */}
        {selectedMapping && (
          <div className="rounded-md border bg-muted/30 p-3 flex flex-col gap-3" data-testid="column-config">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1 min-w-[12rem]">
              <span className="text-xs text-muted-foreground">Column</span>
              <span className="font-medium truncate max-w-[16rem]" title={selectedMapping.column}>
                {selectedMapping.column}
              </span>
              {selectedInfo && (
                <span className="text-[11px] text-muted-foreground">
                  {selectedInfo.distinct} distinct · {selectedInfo.empty} empty in the sample
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Use as</span>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Column role">
                {ROLE_ORDER.map((role) => (
                  <button
                    key={role}
                    type="button"
                    role="radio"
                    aria-checked={selectedMapping.role === role}
                    title={ROLE_INFO[role].hint}
                    onClick={() => update(selectedMapping.column, { role })}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition",
                      selectedMapping.role === role
                        ? cn(ROLE_INFO[role].tone, "border-2 font-semibold")
                        : "hover:bg-accent",
                    )}
                  >
                    {ROLE_INFO[role].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Role options; a fixed height so the table below does not jump. */}
          <div className="flex flex-wrap items-end gap-4 min-h-[3.25rem]">
            {(selectedMapping.role === "event_attribute" || selectedMapping.role === "ignore" || selectedMapping.role === "activity") && (
              <p className="text-xs text-muted-foreground self-center">{ROLE_INFO[selectedMapping.role].hint}</p>
            )}

            {(selectedMapping.role === "object_id" || selectedMapping.role === "resource") && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Object type</span>
                <Input
                  className="h-8 w-48"
                  value={selectedMapping.object_type ?? ""}
                  placeholder="e.g. order"
                  onChange={(e) => update(selectedMapping.column, { object_type: e.target.value })}
                  aria-label="Object type"
                />
              </label>
            )}

            {selectedMapping.role === "timestamp" && (
              <TimestampFormatPicker
                value={selectedMapping.format || "auto"}
                presets={preview?.timestamp_presets ?? []}
                onChange={(format) => update(selectedMapping.column, { format })}
              />
            )}

            {selectedMapping.role === "timestamp" && (
              <TimeZoneField
                value={selectedMapping.timezone ?? DEFAULT_TIMEZONE}
                disabled={(selectedMapping.format ?? "").startsWith("unix_")}
                onChange={(timezone) => update(selectedMapping.column, { timezone })}
              />
            )}

            {selectedMapping.role === "object_attribute" && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Attribute of</span>
                <Select
                  value={selectedMapping.target && idColumns.some((c) => c.column === selectedMapping.target)
                    ? selectedMapping.target
                    : idColumns.find((c) => c.role === "object_id")?.column ?? ""}
                  onValueChange={(target) => update(selectedMapping.column, { target })}
                >
                  <SelectTrigger size="sm" className="w-56">
                    <SelectValue placeholder="Choose an id column" />
                  </SelectTrigger>
                  <SelectContent>
                    {idColumns.map((c) => (
                      <SelectItem key={c.column} value={c.column}>
                        {c.object_type || c.column} ({c.column})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedMapping.role === "timestamp" && (
              <div className="text-xs flex items-center gap-1.5 min-h-8" data-testid="timestamp-check">
                {tsChecking ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the sample…</>
                ) : tsCheck ? (
                  tsCheck.ok === tsCheck.total ? (
                    <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      All {tsCheck.total} sample values parse
                      {tsFormat === "auto" && <> as {formatLabel(tsCheck.format)}</>}
                      {tsCheck.example && <> — “{tsCheck.example[0]}” → {formatIso(tsCheck.example[1])}</>}
                    </span>
                  ) : (
                    <span className={cn("flex items-center gap-1", tsCheck.ok === 0 ? "text-red-600" : "text-amber-700 dark:text-amber-400")}>
                      {tsCheck.ok === 0 ? <XCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {tsCheck.ok} of {tsCheck.total} sample values parse
                      {tsCheck.firstBad && <> — “{tsCheck.firstBad}” does not</>}
                    </span>
                  )
                ) : null}
                {!tsChecking && tsCheck && tsCheck.ambiguousWith.length > 0 && (
                  <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400" data-testid="timestamp-ambiguous">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Also fits {formatLabel(tsCheck.ambiguousWith[0].format)}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => update(selectedMapping.column, { format: tsCheck.ambiguousWith[0].format })}
                    >
                      Use that instead
                    </Button>
                  </span>
                )}
              </div>
            )}
          </div>
          </div>
        )}

        {/* ---- the sample table ---- */}
        <div className="relative flex-1 min-h-[16rem] overflow-auto rounded-md border" data-testid="mapping-table">
          {reloading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          <table className="w-max min-w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                <th className="sticky left-0 z-10 bg-background border-b border-r px-2 py-1 text-right text-muted-foreground font-normal">#</th>
                {columns.map((c) => {
                  const isSel = c.column === selected;
                  return (
                    <th
                      key={c.column}
                      className={cn("border-b border-r p-1 text-left align-top cursor-pointer", isSel && "ring-2 ring-primary ring-inset")}
                      onClick={() => setSelected(c.column)}
                      aria-selected={isSel}
                      data-column={c.column}
                    >
                      <div className="flex flex-col gap-1 min-w-[8rem] max-w-[16rem]">
                        <span className="font-semibold truncate px-1" title={c.column}>{c.column}</span>
                        <span className={cn("rounded border px-1.5 py-0.5 text-[11px] w-fit", ROLE_INFO[c.role].tone)}>
                          {ROLE_INFO[c.role].label}
                          {(c.role === "object_id" || c.role === "resource") && c.object_type ? `: ${c.object_type}` : ""}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(preview?.rows ?? []).slice(0, PREVIEW_ROWS).map((row, r) => (
                <tr key={r}>
                  <td className="sticky left-0 bg-background border-r px-2 py-0.5 text-right text-muted-foreground tabular-nums">{r + 1}</td>
                  {columns.map((c, colIndex) => {
                    // `columns` is built from `preview.columns`, in the same order.
                    return (
                      <td
                        key={c.column}
                        onClick={() => setSelected(c.column)}
                        className={cn(
                          "border-r px-2 py-0.5 whitespace-nowrap max-w-[16rem] truncate cursor-pointer",
                          ROLE_INFO[c.role].cell,
                          c.column === selected && "shadow-[inset_1px_0_0_var(--color-primary),inset_-1px_0_0_var(--color-primary)]",
                        )}
                        title={row[colIndex] ?? ""}
                      >
                        {row[colIndex] ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---- status + footer ---- */}
        <div className="flex flex-wrap items-start justify-between gap-3 text-xs">
          <ul className="space-y-0.5" data-testid="mapping-problems">
            {problems.length === 0 ? (
              <li className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Ready to import.
              </li>
            ) : (
              problems.map((p, i) => (
                <li key={i} className={cn("flex items-center gap-1", p.level === "error" ? "text-red-600" : "text-amber-700 dark:text-amber-400")}>
                  {p.level === "error" ? <XCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {p.text}
                </li>
              ))
            )}
            {reloadError && <li className="text-red-600">{reloadError}</li>}
          </ul>
          <div className="flex items-center gap-3 text-muted-foreground">
            {preview?.format === "csv" && (
              <label className="flex items-center gap-2">
                Separator
                <Select value={preview.delimiter ?? ","} onValueChange={(delimiter) => reload({ delimiter })} disabled={reloading}>
                  <SelectTrigger size="sm" className="w-36" aria-label="Separator">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DELIMITERS.map((d) => (
                      <SelectItem key={d.label} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            {preview?.format === "csv" && (
              <label className="flex items-center gap-2">
                Encoding
                <Select value={preview.encoding ?? "utf-8"} onValueChange={(encoding) => reload({ encoding })} disabled={reloading}>
                  <SelectTrigger size="sm" className="w-56" aria-label="Encoding">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(preview.encodings ?? ["utf-8"]).map((e) => (
                      <SelectItem key={e} value={e}>{ENCODING_LABELS[e] ?? e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <span>
              Showing the first {Math.min(PREVIEW_ROWS, preview?.rows.length ?? 0)} events
              {preview?.truncated ? " of the file" : ""}; all events are imported.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={confirm} disabled={blocking || reloading || !preview} data-testid="start-import">
            Start import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Every IANA zone the browser knows, the computer's own first. */
function timeZoneOptions(): string[] {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let all: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    all = supported ? supported("timeZone") : [];
  } catch {
    all = [];
  }
  return Array.from(new Set([DEFAULT_TIMEZONE, own, ...all].filter(Boolean)));
}

function TimeZoneField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (timezone: string) => void;
}) {
  const options = useMemo(timeZoneOptions, []);
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <label className="flex flex-col gap-1" title="Values with their own offset (like +01:00) keep it; Unix times are absolute.">
      <span className="text-xs text-muted-foreground">
        {disabled ? "Time zone (not used for Unix time)" : "Time zone of values without an offset"}
      </span>
      <div className="flex items-center gap-1">
        <Input
          className="h-8 w-48 font-mono"
          list="totem-time-zones"
          value={value}
          disabled={disabled}
          placeholder={DEFAULT_TIMEZONE}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Time zone"
        />
        {!disabled && own && own !== value && (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onChange(own)}>
            Use {own}
          </Button>
        )}
      </div>
      <datalist id="totem-time-zones">
        {options.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </label>
  );
}

function formatIso(iso: string): string {
  // "2024-03-01T09:00:00+01:00" → "2024-03-01 09:00:00 +01:00"
  return iso.replace("T", " ").replace(/([+-]\d{2}:\d{2})$/, " $1");
}

function TimestampFormatPicker({
  value,
  presets,
  onChange,
}: {
  value: string;
  presets: string[];
  onChange: (format: string) => void;
}) {
  const known = SPECIAL_FORMATS.some((f) => f.value === value) || presets.includes(value);
  const [custom, setCustom] = useState(!known);
  const [customText, setCustomText] = useState(known ? "" : value);
  const selectValue = custom ? CUSTOM_FORMAT : value;

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Timestamp format</span>
        <Select
          value={selectValue}
          onValueChange={(next) => {
            if (next === CUSTOM_FORMAT) {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange(next);
          }}
        >
          <SelectTrigger size="sm" className="w-80" aria-label="Timestamp format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPECIAL_FORMATS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
            <SelectSeparator />
            {presets.map((p) => (
              <SelectItem key={p} value={p}><span className="font-mono">{p}</span></SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={CUSTOM_FORMAT}>Custom pattern…</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {custom && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Pattern (yyyy MM dd HH mm ss SSS a XXX, or strftime %Y…)
          </span>
          <Input
            className="h-8 w-56 font-mono"
            value={customText}
            placeholder="dd.MM.yyyy HH:mm"
            onChange={(e) => {
              setCustomText(e.target.value);
              onChange(e.target.value.trim() || "auto");
            }}
            aria-label="Custom timestamp pattern"
          />
        </label>
      )}
    </div>
  );
}

export default FlatLogMappingDialog;
