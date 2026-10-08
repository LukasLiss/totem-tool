import React, { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, Search } from "lucide-react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type FilterRule,
  type FilterType,
  type TimeRangeParams,
  type ObjectTypesParams,
  type ActivityParams,
} from "@/contexts/FilterStackContext";

type OptionItem = { name: string; count: number };
type Distribution = { period: string; count: number }[];
type Granularity = "hour" | "day" | "month" | "year";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function unixToDate(unix: number): string {
  // Returns YYYY-MM-DDTHH:MM in UTC 
  return new Date(unix * 1000).toISOString().slice(0, 16);
}

function fmtSpan(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function fmtPill(after: string, before: string): string {
  // after/before are YYYY-MM-DDTHH:MM UTC strings.
  const a = new Date(after + ":00Z");
  const b = new Date(before + ":00Z");
  return `${MONTHS[a.getUTCMonth()]} '${String(a.getUTCFullYear()).slice(2)} – ${MONTHS[b.getUTCMonth()]} '${String(b.getUTCFullYear()).slice(2)}`;
}

const CHART_H = 150;
const SVG_H = 168;
const SVG_W = 400;

function DateInput({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
      <Label htmlFor={id} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        {label}
        <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 400 }}>UTC</span>
      </Label>
      <div style={{ position: "relative" }}>
        <Input
          id={id}
          type="datetime-local"
          className="filter-date-input"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          style={{ paddingRight: 32 }}
        />
        <Calendar
          size={14}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--muted-foreground)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

function periodToAfterDate(period: string, granularity: Granularity): string {
  switch (granularity) {
    case "hour":  return `${period}:00`;               
    case "day":   return `${period}T00:00`;             
    case "month": return `${period}-01T00:00`;          
    case "year":  return `${period}-01-01T00:00`;       
  }
}
function periodToBeforeDate(period: string, granularity: Granularity): string {
  switch (granularity) {
    case "hour":  return `${period}:59`;               
    case "day":   return `${period}T23:59`;            
    case "month": {
      const [y, m] = period.split("-").map(Number);
      const d = new Date(y, m, 0).getDate();
      return `${period}-${String(d).padStart(2, "0")}T23:59`;
    }
    case "year":  return `${period}-12-31T23:59`;       
  }
}


function RangeSlider({
  logMin,
  logMax,
  afterDate,
  beforeDate,
  onChange,
}: {
  logMin: number;
  logMax: number;
  afterDate: string;
  beforeDate: string;
  onChange: (after: string, before: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"left" | "right" | null>(null);
  const span = Math.max(logMax - logMin, 1);

  function dateStrToUnix(date: string): number {
    if (!date) return logMin;
    try { return Math.floor(new Date(date + ":00Z").getTime() / 1000); }
    catch { return logMin; }
  }

  const afterUnix  = Math.max(logMin, Math.min(logMax, dateStrToUnix(afterDate)));
  const beforeUnix = Math.max(logMin, Math.min(logMax, dateStrToUnix(beforeDate)));

  const loFrac = (afterUnix  - logMin) / span;
  const hiFrac = (beforeUnix - logMin) / span;

  function unixFromPointer(e: React.PointerEvent): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(logMin + frac * span);
  }

  function onThumbDown(e: React.PointerEvent, thumb: "left" | "right") {
    e.preventDefault();
    dragging.current = thumb;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const unix = unixFromPointer(e);
    if (dragging.current === "left") {
      onChange(unixToDate(Math.max(logMin, Math.min(unix, beforeUnix - 60))), beforeDate);
    } else {
      onChange(afterDate, unixToDate(Math.min(logMax, Math.max(unix, afterUnix + 60))));
    }
  }

  function onUp() { dragging.current = null; }

  const thumbStyle = (frac: number, zIdx: number): React.CSSProperties => ({
    position: "absolute",
    top: "50%",
    left: `${frac * 100}%`,
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "var(--primary)",
    border: "2px solid var(--background)",
    transform: "translate(-50%, -50%)",
    cursor: "grab",
    boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
    zIndex: zIdx,
    touchAction: "none",
  });

  return (
    <div style={{ padding: "4px 8px 0" }}>
      <div
        ref={trackRef}
        style={{ position: "relative", height: 20, cursor: "pointer" }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div style={{
          position: "absolute", top: "50%", left: 0, right: 0,
          height: 4, borderRadius: 2, background: "var(--border)",
          transform: "translateY(-50%)",
        }} />
        <div style={{
          position: "absolute", top: "50%",
          left: `${loFrac * 100}%`,
          right: `${(1 - hiFrac) * 100}%`,
          height: 4, borderRadius: 2, background: "var(--primary)",
          transform: "translateY(-50%)",
        }} />
        <div
          title={afterDate}
          style={thumbStyle(loFrac, loFrac >= hiFrac - 0.01 ? 3 : 2)}
          onPointerDown={(e) => onThumbDown(e, "left")}
        />
        <div
          title={beforeDate}
          style={thumbStyle(hiFrac, 2)}
          onPointerDown={(e) => onThumbDown(e, "right")}
        />
      </div>
    </div>
  );
}

// How many chars of a YYYY-MM-DDTHH:MM datetime string identify a bar's period.
const GRANULARITY_PREFIX_LEN: Record<Granularity, number> = {
  hour: 13,   // "YYYY-MM-DDTHH"
  day:  10,   // "YYYY-MM-DD"
  month: 7,   // "YYYY-MM"
  year:  4,   // "YYYY"
};

const GRANULARITY_LABELS: Record<Granularity, string> = {
  hour: "by hour",
  day: "by day",
  month: "by month",
  year: "by year",
};

function EventChart({
  distribution,
  granularity,
  afterDate,
  beforeDate,
  onRangeChange,
}: {
  distribution: Distribution;
  granularity: Granularity;
  afterDate: string;
  beforeDate: string;
  onRangeChange: (after: string, before: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);

  const n = distribution.length;
  const maxCount = Math.max(...distribution.map((d) => d.count), 1);
  const barW = SVG_W / n;
  const first = distribution[0];
  const last = distribution[n - 1];

  function periodLabel(p: string): string {
    switch (granularity) {
      case "hour": {
        const [datePart, hr] = p.split("T");
        const [, mo, dy] = datePart.split("-");
        return `${MONTHS[parseInt(mo) - 1]} ${parseInt(dy)} ${hr}:00`;
      }
      case "day": {
        const [y, mo, dy] = p.split("-");
        return `${MONTHS[parseInt(mo) - 1]} ${parseInt(dy)}, ${y}`;
      }
      case "month":
        return `${MONTHS[parseInt(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
      case "year":
        return p;
    }
  }

  const prefixLen = GRANULARITY_PREFIX_LEN[granularity];

  const dateToIdx = useCallback(
    (date: string, edge: "lo" | "hi"): number => {
      if (!date) return edge === "lo" ? 0 : n - 1;
      const prefix = date.slice(0, prefixLen);
      if (edge === "lo") {
        for (let i = 0; i < n; i++) if (distribution[i].period >= prefix) return i;
        return n - 1;
      } else {
        for (let i = n - 1; i >= 0; i--) if (distribution[i].period <= prefix) return i;
        return 0;
      }
    },
    [distribution, n, prefixLen],
  );

  // Bail out only after every hook has run — hooks must be called in the same
  // order on every render.
  if (n === 0) return null;

  const afterIdx  = dateToIdx(afterDate,  "lo");
  const beforeIdx = dateToIdx(beforeDate, "hi");

  const dispLo = dragStart !== null ? Math.min(dragStart, dragCurrent ?? dragStart) : afterIdx;
  const dispHi = dragStart !== null ? Math.max(dragStart, dragCurrent ?? dragStart) : beforeIdx;

  function getBarIdx(e: React.PointerEvent<SVGSVGElement>): number {
    const rect = svgRef.current!.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * SVG_W;
    return Math.max(0, Math.min(n - 1, Math.floor(svgX / barW)));
  }

  function commit(lo: number, hi: number) {
    onRangeChange(
      periodToAfterDate(distribution[lo].period,  granularity),
      periodToBeforeDate(distribution[hi].period, granularity),
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 6 }}>
        Event distribution {GRANULARITY_LABELS[granularity]} — drag to set range, fine-tune above
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        style={{
          width: "100%",
          display: "block",
          cursor: dragStart !== null ? "col-resize" : "default",
          userSelect: "none",
        }}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          svgRef.current?.setPointerCapture(e.pointerId);
          const idx = getBarIdx(e);
          setDragStart(idx);
          setDragCurrent(idx);
        }}
        onPointerMove={(e) => {
          if (dragStart === null) return;
          setDragCurrent(getBarIdx(e));
        }}
        onPointerUp={() => {
          if (dragStart !== null) {
            const lo = Math.min(dragStart, dragCurrent ?? dragStart);
            const hi = Math.max(dragStart, dragCurrent ?? dragStart);
            commit(lo, hi);
          }
          setDragStart(null);
          setDragCurrent(null);
        }}
        onPointerCancel={() => { setDragStart(null); setDragCurrent(null); }}
      >
        {distribution.map((d, i) => {
          const inRange = i >= dispLo && i <= dispHi;
          const h = Math.max((d.count / maxCount) * CHART_H, 2);
          // Gap between bars: 1px when bars are wide enough, 0px when very narrow.
          const gap = barW > 3 ? 1 : 0;
          return (
            <rect
              key={d.period}
              x={i * barW + gap}
              y={CHART_H - h}
              width={Math.max(barW - gap * 2, 1)}
              height={h}
              rx={barW > 6 ? 1 : 0}
              style={{
                fill: inRange ? "var(--primary)" : "var(--border)",
                transition: dragStart === null ? "fill 0.08s" : "none",
              }}
            />
          );
        })}
        <text x={0} y={SVG_H} fontSize={9} style={{ fill: "var(--muted-foreground)" }}>
          {periodLabel(first.period)}
        </text>
        <text x={SVG_W} y={SVG_H} fontSize={9} textAnchor="end" style={{ fill: "var(--muted-foreground)" }}>
          {periodLabel(last.period)}
        </text>
      </svg>
      {n === 1 && (
        <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4, textAlign: "center" }}>
          All events fall within one {granularity} - use the inputs above to narrow the range.
        </p>
      )}
    </div>
  );
}

function OptionList({
  options,
  selected,
  search,
  onToggle,
}: {
  options: OptionItem[];
  selected: Set<string>;
  search: string;
  onToggle: (name: string) => void;
}) {
  if (options.length === 0) {
    return (
      <p
        style={{
          fontSize: 13,
          color: "var(--muted-foreground)",
          padding: "8px 0",
        }}
      >
        No options available — load an event log file first.
      </p>
    );
  }

  const filtered = search
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;

  if (filtered.length === 0) {
    return (
      <p
        style={{
          fontSize: 13,
          color: "var(--muted-foreground)",
          padding: "8px 0",
        }}
      >
        No matches for "{search}".
      </p>
    );
  }

  const maxCount = Math.max(...options.map((o) => o.count), 1);

  return (
    <div>
      {filtered.map((opt, i) => {
        const active = selected.has(opt.name);
        return (
          <div
            key={opt.name}
            onClick={() => onToggle(opt.name)}
            style={{
              cursor: "pointer",
              padding: "8px 0 6px",
              borderBottom:
                i < filtered.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  flexShrink: 0,
                  border: `1.5px solid ${active ? "var(--primary)" : "var(--border)"}`,
                  background: active ? "var(--primary)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.1s, border-color 0.1s",
                }}
              >
                {active && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="var(--primary-foreground)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <span
                style={{
                  fontSize: 13,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {opt.name}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--muted-foreground)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {opt.count.toLocaleString()}
              </span>
            </div>
            <div
              style={{
                marginLeft: 28,
                marginTop: 5,
                height: 2,
                background: "var(--border)",
                borderRadius: 1,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(opt.count / maxCount) * 100}%`,
                  background: active
                    ? "var(--primary)"
                    : "var(--muted-foreground)",
                  borderRadius: 1,
                  transition: "background 0.1s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FilterConfigDialog({
  open,
  onClose,
  filterType,
  existingRule,
  availableObjectTypes,
  availableActivities,
  onSubmit,
  icon,
  titleLabel,
  hasFile,
  fileId,
}: {
  open: boolean;
  onClose: () => void;
  filterType: FilterType;
  existingRule: FilterRule | undefined;
  availableObjectTypes: OptionItem[];
  availableActivities: OptionItem[];
  onSubmit: (params: FilterRule["params"]) => void;
  icon: React.ReactElement;
  titleLabel: string;
  hasFile: boolean;
  fileId: number | undefined;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [afterDate, setAfterDate] = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [logMin, setLogMin] = useState<number | null>(null);
  const [logMax, setLogMax] = useState<number | null>(null);
  const [distribution, setDistribution] = useState<Distribution>([]);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    if (!existingRule) {
      setAfterDate("");
      setBeforeDate("");
      if (filterType === "object_types") {
        setSelected(new Set(availableObjectTypes.map((o) => o.name)));
      } else if (filterType === "activity") {
        setSelected(new Set(availableActivities.map((a) => a.name)));
      } else {
        setSelected(new Set());
      }
      return;
    }
    if (existingRule.type === "time_range") {
      const p = existingRule.params as TimeRangeParams;
      setAfterDate(p.after != null ? unixToDate(p.after) : "");
      setBeforeDate(p.before != null ? unixToDate(p.before) : "");
      setSelected(new Set());
    } else if (existingRule.type === "object_types") {
      setSelected(new Set((existingRule.params as ObjectTypesParams).include));
      setAfterDate("");
      setBeforeDate("");
    } else {
      setSelected(new Set((existingRule.params as ActivityParams).include));
      setAfterDate("");
      setBeforeDate("");
    }
  }, [open, existingRule, filterType, availableObjectTypes, availableActivities]);

  useEffect(() => {
    if (!open || filterType !== "time_range" || !fileId) return;
    axios
      .get<{ earliest_timestamp: number; newest_timestamp: number }>(
        `/api/files/${fileId}/statistics/`,
        { _skipGlobalFilter: true },
      )
      .then(({ data }) => {
        setLogMin(data.earliest_timestamp);
        setLogMax(data.newest_timestamp);
        if (!existingRule) {
          setAfterDate(unixToDate(data.earliest_timestamp));
          setBeforeDate(unixToDate(data.newest_timestamp));
        }
      })
      .catch(() => {});
    axios
      .get<{ distribution: Distribution; granularity: Granularity }>(
        `/api/files/${fileId}/event_distribution/`,
        { _skipGlobalFilter: true },
      )
      .then(({ data }) => {
        setDistribution(data.distribution);
        setGranularity(data.granularity);
      })
      .catch(() => {});
  }, [open, filterType, fileId, existingRule]);

  useEffect(() => {
    if (open && filterType !== "time_range") {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, filterType]);

  const isList = filterType !== "time_range";
  const options =
    filterType === "object_types" ? availableObjectTypes : availableActivities;
  const searchLabel =
    filterType === "object_types"
      ? "Search object types…"
      : "Search activities…";
  const countLabel =
    filterType === "object_types" ? "object types" : "activities";
  const filteredOptions = search
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;
  const allSelected =
    filteredOptions.length > 0 && filteredOptions.every((o) => selected.has(o.name));
  const someSelected =
    !allSelected && filteredOptions.some((o) => selected.has(o.name));

  const logMinDate = logMin != null ? unixToDate(logMin) : "";
  const logMaxDate = logMax != null ? unixToDate(logMax) : "";

  const isUnchanged = (() => {
    if (filterType === "time_range") {
      if (!existingRule) {
        return (!afterDate && !beforeDate) ||
               (afterDate === logMinDate && beforeDate === logMaxDate);
      }
      const p = existingRule.params as TimeRangeParams;
      return afterDate === (p.after != null ? unixToDate(p.after) : "") &&
             beforeDate === (p.before != null ? unixToDate(p.before) : "");
    }
    if (!existingRule) {
      if (options.length === 0) return true;
      return selected.size === options.length && options.every((o) => selected.has(o.name));
    }
    const existInclude = (existingRule.params as ObjectTypesParams | ActivityParams).include;
    if (selected.size !== existInclude.length) return false;
    return existInclude.every(item => selected.has(item));
  })();
  const last90Date = logMax != null ? unixToDate(logMax - 90 * 86400) : "";
  const showCustomPill =
    !!afterDate &&
    !!beforeDate &&
    !(afterDate === last90Date && beforeDate === logMaxDate) &&
    !(afterDate === logMinDate && beforeDate === logMaxDate);

  const pills =
    logMin != null && logMax != null
      ? [
          { label: "Last 90 days", after: last90Date, before: logMaxDate },
          ...(showCustomPill
            ? [
                {
                  label: fmtPill(afterDate, beforeDate),
                  after: afterDate,
                  before: beforeDate,
                },
              ]
            : []),
          { label: "Full range", after: logMinDate, before: logMaxDate },
        ]
      : [];

  function toggleOption(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      const toRemove = new Set(filteredOptions.map((o) => o.name));
      setSelected((prev) => new Set([...prev].filter((n) => !toRemove.has(n))));
    } else {
      setSelected((prev) => new Set([...prev, ...filteredOptions.map((o) => o.name)]));
    }
  }

  function handleSubmit() {
    const params: FilterRule["params"] =
      filterType === "time_range"
        ? {
            after: afterDate
              ? Math.floor(new Date(afterDate + ":00Z").getTime() / 1000)
              : undefined,
            before: beforeDate
              ? Math.floor(new Date(beforeDate + ":59Z").getTime() / 1000)
              : undefined,
          }
        : { include: [...selected] };
    onSubmit(params);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[460px]"
        style={{ padding: 0, gap: 0, overflow: "hidden" }}
      >
        <DialogHeader
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <DialogTitle
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 16,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                color: "var(--primary)",
              }}
            >
              {React.cloneElement(icon, {
                size: 18,
              } as React.HTMLAttributes<SVGElement>)}
            </span>
            {existingRule ? `Edit ${titleLabel}` : titleLabel}
          </DialogTitle>
          {filterType === "time_range" && logMin != null && logMax != null && (
            <p
              style={{
                fontSize: 12,
                color: "var(--muted-foreground)",
                margin: 0,
              }}
            >
              Log spans {fmtSpan(logMin)} → {fmtSpan(logMax)}
            </p>
          )}
          {isList && hasFile && (
            <p
              style={{
                fontSize: 12,
                color: "var(--muted-foreground)",
                margin: 0,
              }}
            >
              {options.length} {countLabel} in this log
              {selected.size > 0 && ` · ${selected.size} selected`}
            </p>
          )}
        </DialogHeader>

        <div
          style={{
            padding: "16px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {filterType === "time_range" &&
            (!hasFile ? (
              <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Select an event log first to configure a time range filter.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", gap: 12 }}>
                  <DateInput
                    id="f-after"
                    label="From"
                    value={afterDate}
                    min={logMinDate}
                    max={beforeDate || logMaxDate}
                    onChange={setAfterDate}
                  />
                  <DateInput
                    id="f-before"
                    label="To"
                    value={beforeDate}
                    min={afterDate || logMinDate}
                    max={logMaxDate}
                    onChange={setBeforeDate}
                  />
                </div>

                {distribution.length > 0 && (
                  <>
                    <EventChart
                      distribution={distribution}
                      granularity={granularity}
                      afterDate={afterDate}
                      beforeDate={beforeDate}
                      onRangeChange={(after, before) => {
                        setAfterDate(after);
                        setBeforeDate(before);
                      }}
                    />
                    {logMin != null && logMax != null && (
                      <RangeSlider
                        logMin={logMin}
                        logMax={logMax}
                        afterDate={afterDate}
                        beforeDate={beforeDate}
                        onChange={(after, before) => {
                          setAfterDate(after);
                          setBeforeDate(before);
                        }}
                      />
                    )}
                  </>
                )}

                {pills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {pills.map((pill) => {
                      const active =
                        afterDate === pill.after && beforeDate === pill.before;
                      return (
                        <button
                          key={pill.label}
                          type="button"
                          onClick={() => {
                            setAfterDate(pill.after);
                            setBeforeDate(pill.before);
                          }}
                          style={{
                            padding: "4px 14px",
                            borderRadius: 20,
                            border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                            background: active
                              ? "var(--primary)"
                              : "transparent",
                            color: active
                              ? "var(--primary-foreground)"
                              : "var(--foreground)",
                            fontSize: 12,
                            cursor: "pointer",
                            transition: "all 0.12s",
                          }}
                        >
                          {pill.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ))}

          {isList && (
            <>
              <div style={{ position: "relative" }}>
                <Search
                  size={14}
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--muted-foreground)",
                    pointerEvents: "none",
                  }}
                />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder={searchLabel}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: "100%",
                    paddingLeft: 32,
                    paddingRight: 12,
                    paddingTop: 8,
                    paddingBottom: 8,
                    fontSize: 13,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "transparent",
                    color: "var(--foreground)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {options.length > 0 && (
                <div
                  onClick={toggleAll}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      flexShrink: 0,
                      border: `1.5px solid ${allSelected || someSelected ? "var(--primary)" : "var(--border)"}`,
                      background:
                        allSelected || someSelected
                          ? "var(--primary)"
                          : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "background 0.1s, border-color 0.1s",
                    }}
                  >
                    {allSelected && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path
                          d="M1 4L3.5 6.5L9 1"
                          stroke="var(--primary-foreground)"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                    {someSelected && (
                      <svg width="10" height="2" viewBox="0 0 10 2" fill="none">
                        <path
                          d="M1 1H9"
                          stroke="var(--primary-foreground)"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    Select all
                  </span>
                </div>
              )}

              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                <OptionList
                  options={options}
                  selected={selected}
                  search={search}
                  onToggle={toggleOption}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter
          style={{
            padding: "12px 24px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {isList ? (
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
              style={{ padding: "0 4px", fontSize: 13 }}
            >
              Reset
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setAfterDate(logMinDate);
                setBeforeDate(logMaxDate);
              }}
              disabled={!logMinDate}
              style={{ padding: "0 4px", fontSize: 13 }}
            >
              Reset
            </Button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!hasFile || isUnchanged}
              style={{
                background: "var(--primary)",
                borderColor: "var(--primary)",
                color: "var(--primary-foreground)",
              }}
            >
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
