import React, { useEffect, useRef, useState } from "react";
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
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function fmtSpan(unix: number): string {
  const d = new Date(unix * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtPill(after: string, before: string): string {
  const a = new Date(after + "T00:00:00");
  const b = new Date(before + "T00:00:00");
  return `${MONTHS[a.getMonth()]} '${String(a.getFullYear()).slice(2)} – ${MONTHS[b.getMonth()]} '${String(b.getFullYear()).slice(2)}`;
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
      <Label htmlFor={id}>{label}</Label>
      <div style={{ position: "relative" }}>
        <Input
          id={id}
          type="date"
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

function EventChart({
  distribution,
  afterDate,
  beforeDate,
}: {
  distribution: Distribution;
  afterDate: string;
  beforeDate: string;
}) {
  if (distribution.length === 0) return null;

  const maxCount = Math.max(...distribution.map((d) => d.count), 1);
  const afterMonth = afterDate.slice(0, 7);
  const beforeMonth = beforeDate.slice(0, 7);
  const barW = SVG_W / distribution.length;
  const first = distribution[0];
  const last = distribution[distribution.length - 1];

  function periodLabel(period: string) {
    return `${MONTHS[parseInt(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
  }

  return (
    <div>
      <p
        style={{
          fontSize: 12,
          color: "var(--muted-foreground)",
          marginBottom: 6,
        }}
      >
        Event distribution
      </p>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        style={{ width: "100%", display: "block" }}
        preserveAspectRatio="none"
      >
        {distribution.map((d, i) => {
          const inRange =
            (!afterDate || d.period >= afterMonth) &&
            (!beforeDate || d.period <= beforeMonth);
          const h = Math.max((d.count / maxCount) * CHART_H, 2);
          return (
            <rect
              key={d.period}
              x={i * barW + 1}
              y={CHART_H - h}
              width={Math.max(barW - 2, 1)}
              height={h}
              rx={1}
              style={{ fill: inRange ? "var(--primary)" : "var(--border)" }}
            />
          );
        })}
        <text
          x={0}
          y={SVG_H}
          fontSize={9}
          style={{ fill: "var(--muted-foreground)" }}
        >
          {periodLabel(first.period)}
        </text>
        <text
          x={SVG_W}
          y={SVG_H}
          fontSize={9}
          textAnchor="end"
          style={{ fill: "var(--muted-foreground)" }}
        >
          {periodLabel(last.period)}
        </text>
      </svg>
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
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    if (!existingRule) {
      setAfterDate("");
      setBeforeDate("");
      setSelected(new Set());
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
  }, [open, existingRule]);

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
      .get<Distribution>(`/api/files/${fileId}/event_distribution/`, { _skipGlobalFilter: true })
      .then(({ data }) => setDistribution(data))
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
      next.has(name) ? next.delete(name) : next.add(name);
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
              ? Math.floor(new Date(afterDate + "T00:00:00").getTime() / 1000)
              : undefined,
            before: beforeDate
              ? Math.floor(new Date(beforeDate + "T23:59:59").getTime() / 1000)
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
                  <EventChart
                    distribution={distribution}
                    afterDate={afterDate}
                    beforeDate={beforeDate}
                  />
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
              disabled={!hasFile}
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
