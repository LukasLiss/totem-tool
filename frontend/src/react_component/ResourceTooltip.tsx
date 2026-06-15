import { useState } from "react";
import type { TypeNMap } from "@/contexts/ClusterContext";

/* ── Shared helper (duplicated from OrgaMiningExplorer to keep this self-contained) */
export function pieSlicePath(r: number, startAngle: number, endAngle: number): string {
  const x1 = r * Math.cos(startAngle), y1 = r * Math.sin(startAngle);
  const x2 = r * Math.cos(endAngle),   y2 = r * Math.sin(endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M 0 0 L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/* ── TooltipBox ─────────────────────────────────────────────── */
export default function TooltipBox({
  tooltip,
  activities,
  cooccurringResources,
  collaboratingResources,
  timeBins,
  weekdayBins,
  portfolioObjectTypes,
  resourceObjectTypes,
  typeTotals,
  coocTypeN,
  collabTypeN,
  activityColorMap,
  resourceColorMap,
  typeColorMap,
  clusterColors,
  allProfiles,
  tooltipProfiles,
  showDropdown = true,
  positionMode = "center",
  highlightedActivity,
  onActivityClick,
  onPin,
  onTooltipMouseEnter,
  onTooltipMouseLeave,
  onClose,
}: {
  tooltip: { x: number; y: number; resources: string[]; profile: number[]; clusterLabel: number; isCluster: boolean; pinned: boolean; cw: number; ch: number };
  activities: string[];
  cooccurringResources: string[];
  collaboratingResources: string[];
  timeBins: number[];
  weekdayBins: number[];
  portfolioObjectTypes: string[];
  resourceObjectTypes: Record<string, string>;
  typeTotals: Record<string, number>;
  coocTypeN: TypeNMap;
  collabTypeN: TypeNMap;
  activityColorMap: Record<string, string>;
  resourceColorMap: Record<string, string>;
  typeColorMap: Record<string, string>;
  clusterColors: string[];
  allProfiles: Record<string, number[]>;
  // When provided, bar values and activity slices are read from here instead of
  // allProfiles + profile offsets. Keys are resourceId or "Cluster N".
  tooltipProfiles?: Record<string, { activities?: number[]; time?: number[]; weekday?: number[]; portfolio?: number[] }>;
  // When false, the expandable per-resource dropdown is suppressed in type rows.
  showDropdown?: boolean;
  // "center": vertically center on cursor (OrgaMining default).
  // "top-anchor": anchor top near cursor and grow downward — stable when content height changes.
  positionMode?: "center" | "top-anchor";
  highlightedActivity: string | null;
  onActivityClick?: (act: string) => void;
  onPin?: () => void;
  onTooltipMouseEnter?: () => void;
  onTooltipMouseLeave?: () => void;
  onClose?: () => void;
}) {
  const [showResources, setShowResources] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const toggleType = (key: string) =>
    setExpandedTypes(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const PIE_R = 32;

  const lookupKey = tooltip.isCluster
    ? `Cluster ${tooltip.clusterLabel + 1}`
    : tooltip.resources[0];

  // Activity slices — use tooltipProfiles when available, else read from flat profile
  const slices: { act: string; frac: number; path: string }[] = [];
  let angle = -Math.PI / 2;
  const actVals = tooltipProfiles
    ? (tooltipProfiles[lookupKey]?.activities ?? [])
    : activities.map((_, i) => tooltip.profile[i] ?? 0);
  activities.forEach((act, i) => {
    const frac = actVals[i] ?? 0;
    if (frac <= 0) return;
    const sweep = frac * 2 * Math.PI;
    slices.push({ act, frac, path: pieSlicePath(PIE_R, angle, angle + sweep) });
    angle += sweep;
  });

  const selfSet = new Set(tooltip.resources);
  function typeGroupedRows(resourceList: string[], offset: number, typeNMap: TypeNMap) {
    const precomputedN = typeNMap[lookupKey] ?? {};

    const baseRows = Object.entries(typeTotals)
      .map(([type, total]) => ({
        type, total,
        nonZero: precomputedN[type] ?? 0,
        items: [] as { resource: string; val: number }[],
      }))
      .filter(({ nonZero }) => nonZero > 0)
      .sort((a, b) => b.nonZero - a.nonZero);

    // Clusters and no-dropdown mode both skip items
    if (tooltip.isCluster || !showDropdown) return baseRows;

    const itemsByType: Record<string, { resource: string; val: number }[]> = {};
    resourceList.forEach((r, i) => {
      const val = tooltip.profile[offset + i] ?? 0;
      if (val <= 0) return;
      const type = resourceObjectTypes[r] ?? r;
      (itemsByType[type] ??= []).push({ resource: r, val });
    });
    return baseRows.map(row => ({
      ...row,
      items: (itemsByType[row.type] ?? []).sort((a, b) => b.val - a.val),
    }));
  }

  const coocRows  = cooccurringResources.length  > 0
    ? typeGroupedRows(cooccurringResources,  activities.length, coocTypeN)
    : [];
  const collabRows = collaboratingResources.length > 0
    ? typeGroupedRows(collaboratingResources, activities.length + cooccurringResources.length, collabTypeN)
    : [];

  // Bar values — use tooltipProfiles when available, else compute from allProfiles + offsets
  const timeOffset      = activities.length + cooccurringResources.length + collaboratingResources.length;
  const weekdayOffset   = timeOffset + timeBins.length;
  const portfolioOffset = weekdayOffset + weekdayBins.length;
  function binValues(bins: (number | string)[], offset: number, section?: "time" | "weekday" | "portfolio"): number[] {
    if (bins.length === 0) return [];
    if (tooltipProfiles && section) {
      return tooltipProfiles[lookupKey]?.[section] ?? bins.map(() => 0);
    }
    if (tooltip.isCluster) {
      const members = tooltip.resources.map(r => allProfiles[r]).filter(Boolean);
      if (members.length === 0) return bins.map(() => 0);
      return bins.map((_, i) => {
        const sum = members.reduce((acc, p) => acc + (p[offset + i] ?? 0), 0);
        return sum / members.length;
      });
    }
    return bins.map((_, i) => tooltip.profile[offset + i] ?? 0);
  }

  const timeBinValues   = binValues(timeBins,             timeOffset,      "time");
  const weekdayValues   = binValues(weekdayBins,          weekdayOffset,   "weekday");
  const portfolioValues = binValues(portfolioObjectTypes,  portfolioOffset, "portfolio");

  const hasMultiple = tooltip.resources.length > 1;
  const estW = 220;
  const resourceListH = showResources ? tooltip.resources.length * 18 + 8 : 0;
  const rowSectionH = (rows: typeof coocRows) => rows.length > 0 ? 24 + rows.length * 20 : 0;
  const timeBinSectionH    = timeBins.length             > 0 ? 83 : 0;
  const weekdaySectionH    = weekdayBins.length           > 0 ? 83 : 0;
  const portfolioSectionH  = portfolioObjectTypes.length  > 0 ? 20 + portfolioObjectTypes.length * 18 : 0;
  const activitySectionH   = slices.length > 0 ? 15 + PIE_R * 2 + 8 + slices.length * 20 : 0;
  const clusterHeaderH     = tooltip.isCluster ? 20 : 0;
  const tooltipPadding     = 20;
  const clusterTypeBarH = tooltip.isCluster && hasMultiple ? 14 : 0;
  const estH = tooltipPadding + clusterHeaderH + activitySectionH
    + rowSectionH(coocRows) + rowSectionH(collabRows)
    + timeBinSectionH + weekdaySectionH + portfolioSectionH
    + clusterTypeBarH + 34 + resourceListH;

  const sectionOrder = [
    cooccurringResources.length > 0  && "cooc",
    collaboratingResources.length > 0 && "collab",
    timeBins.length   > 0            && "time",
    weekdayBins.length > 0           && "weekday",
    portfolioObjectTypes.length > 0  && "portfolio",
  ].filter(Boolean) as string[];
  const firstSection = slices.length === 0 ? (sectionOrder[0] ?? null) : null;
  const sectionStyle = (id: string) =>
    id === firstSection
      ? { marginTop: 0, paddingTop: 2, borderTop: "none" as const }
      : { marginTop: 8, paddingTop: 6, borderTop: "1px solid #f1f5f9" as const };

  const fittedH = Math.min(estH, tooltip.ch - 8);
  const left = Math.min(tooltip.x + 14, tooltip.cw - estW - 4);
  const top = positionMode === "top-anchor"
    ? Math.max(4, Math.min(tooltip.y - 40, tooltip.ch - 4))
    : Math.max(4, Math.min(tooltip.y - fittedH / 2, tooltip.ch - fittedH - 4));
  const maxH = tooltip.ch - top - 4;

  return (
    <div
      className="orga-tooltip"
      style={{
        position: "absolute", left, top,
        background: "white", borderRadius: 8, zIndex: 10,
        border: tooltip.pinned ? "1.5px solid #6366f1" : "1px solid #e2e8f0",
        boxShadow: tooltip.pinned ? "0 4px 16px rgba(99,102,241,0.18)" : "0 4px 12px rgba(0,0,0,0.12)",
        padding: "10px 12px", minWidth: estW, maxWidth: estW,
        maxHeight: maxH, overflowY: "auto",
      }}
      onMouseEnter={onTooltipMouseEnter}
      onMouseLeave={onTooltipMouseLeave}
      onClick={e => { e.stopPropagation(); if (!tooltip.pinned && onPin) onPin(); }}
    >
      {tooltip.isCluster && (() => {
        const color = clusterColors[tooltip.clusterLabel % clusterColors.length];
        return (
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color, marginBottom: 6 }}>
            Cluster {tooltip.clusterLabel + 1} — avg. profile
          </div>
        );
      })()}

      {tooltip.pinned && onClose && (
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#94a3b8", lineHeight: 1, padding: 2 }}
          title="Close (Esc)"
        >✕</button>
      )}

      {slices.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 4 }}>Activities</div>
          <svg width={PIE_R * 2 + 2} height={PIE_R * 2 + 2} style={{ display: "block", margin: "0 auto 8px" }}>
            <g transform={`translate(${PIE_R + 1},${PIE_R + 1})`}>
              {slices.length === 1
                ? <circle r={PIE_R} fill={activityColorMap[slices[0].act] ?? "#94a3b8"} />
                : slices.map(({ act, path }) => (
                    <path key={act} d={path} fill={activityColorMap[act] ?? "#94a3b8"} stroke="white" strokeWidth={1} />
                  ))
              }
            </g>
          </svg>
          <div style={{ fontSize: 11, lineHeight: "20px" }}>
            {slices.map(({ act, frac }) => {
              const color = activityColorMap[act] ?? "#94a3b8";
              const isHighlighted = highlightedActivity === act;
              const isDimmed = highlightedActivity !== null && !isHighlighted;
              return (
                <div key={act} onClick={() => onActivityClick?.(act)}
                  style={{ display: "flex", alignItems: "center", gap: 5, cursor: onActivityClick ? "pointer" : "default",
                    borderRadius: 4, padding: "0 2px", opacity: isDimmed ? 0.35 : 1,
                    background: isHighlighted ? `${color}22` : "transparent" }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: color,
                    outline: isHighlighted ? `2px solid ${color}` : "none", outlineOffset: 1 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{act}</span>
                  <span style={{ marginLeft: 6, color: "#64748b", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {(frac * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {[
        { rows: coocRows,   label: "Co-occurrence",       hasFeature: cooccurringResources.length > 0,  id: "cooc" },
        { rows: collabRows, label: "Object collaboration", hasFeature: collaboratingResources.length > 0, id: "collab" },
      ].map(({ rows, label, hasFeature, id }) => !hasFeature ? null : (
        <div key={label} style={sectionStyle(id)}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 4 }}>{label}</div>
          {rows.length === 0
            ? <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>none</div>
            : rows.map(({ type, items, nonZero, total }) => {
              const color   = typeColorMap[type] ?? "#94a3b8";
              const typeKey = `${label}:${type}`;
              const open    = expandedTypes.has(typeKey);
              const expandable = items.length > 0;
              const nLabel  = Number.isInteger(nonZero) ? String(nonZero) : nonZero.toFixed(1);
              return (
                <div key={type} style={{ marginBottom: 2 }}>
                  <div onClick={expandable ? (e => { e.stopPropagation(); toggleType(typeKey); }) : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: expandable ? "pointer" : "default",
                      borderRadius: 4, padding: "1px 2px", userSelect: "none" }}
                  >
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 10, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{type}</span>
                    <span style={{ fontSize: 9, color: "#94a3b8", flexShrink: 0 }}>{nLabel}/{total}</span>
                    {!tooltip.isCluster && showDropdown && (
                      <span style={{ fontSize: 9, color: "#94a3b8", flexShrink: 0, width: 8, textAlign: "right" }}>
                        {expandable ? (open ? "▾" : "▸") : ""}
                      </span>
                    )}
                  </div>
                  {expandable && open && (
                    <div style={{ maxHeight: 90, overflowY: "auto", marginTop: 2, marginLeft: 13, borderLeft: `2px solid ${color}20`, paddingLeft: 6 }}>
                      {items.map(({ resource, val }) => (
                        <div key={resource} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 10, lineHeight: "18px", gap: 6 }}>
                          <span style={{ fontFamily: "monospace", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{resource}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums", color: "#64748b", flexShrink: 0 }}>{(val * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          }
        </div>
      ))}

      {timeBins.length > 0 && (() => {
        const BAR_AREA_W = 196, BAR_H = 40, AXIS_H = 12;
        const barW = BAR_AREA_W / 24, gap = barW * 0.25, bw = barW - gap;
        const NICE = [0.05, 0.10, 0.15, 0.20, 0.25, 0.33, 0.50, 0.75, 1.0];
        const ceiling = NICE.find(c => c >= Math.max(...timeBinValues, 0)) ?? 1.0;
        return (
          <div style={sectionStyle("time")}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 4 }}>Time binning (hourly)</div>
            <svg width={BAR_AREA_W} height={BAR_H + AXIS_H} style={{ display: "block", overflow: "visible" }}>
              {timeBinValues.map((val, i) => {
                const bh = Math.max((val / ceiling) * BAR_H, val > 0 ? 1 : 0);
                return <rect key={i} x={i * barW + gap / 2} y={BAR_H - bh} width={bw} height={bh} fill="#6366f1" opacity={0.75} rx={1} />;
              })}
              <line x1={0} y1={0} x2={BAR_AREA_W} y2={0} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3,2" />
              <text x={BAR_AREA_W} y={-2} textAnchor="end" fontSize={7} fill="#94a3b8" fontFamily="sans-serif">{Math.round(ceiling * 100)}%</text>
              <line x1={0} y1={BAR_H} x2={BAR_AREA_W} y2={BAR_H} stroke="#e2e8f0" strokeWidth={1} />
              {[0, 6, 12, 18, 23].map(h => (
                <text key={h} x={h * barW + barW / 2} y={BAR_H + AXIS_H - 1} textAnchor="middle" fontSize={8} fill="#94a3b8" fontFamily="sans-serif">{String(h).padStart(2, "0")}</text>
              ))}
            </svg>
          </div>
        );
      })()}

      {weekdayBins.length > 0 && (() => {
        const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const BAR_AREA_W = 196, BAR_H = 40, AXIS_H = 12;
        const barW = BAR_AREA_W / 7, gap = barW * 0.2, bw = barW - gap;
        const NICE = [0.05, 0.10, 0.15, 0.20, 0.25, 0.33, 0.50, 0.75, 1.0];
        const ceiling = NICE.find(c => c >= Math.max(...weekdayValues, 0)) ?? 1.0;
        return (
          <div style={sectionStyle("weekday")}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 4 }}>Time binning (weekly)</div>
            <svg width={BAR_AREA_W} height={BAR_H + AXIS_H} style={{ display: "block", overflow: "visible" }}>
              {weekdayValues.map((val, i) => {
                const bh = Math.max((val / ceiling) * BAR_H, val > 0 ? 1 : 0);
                return <rect key={i} x={i * barW + gap / 2} y={BAR_H - bh} width={bw} height={bh} fill="#10b981" opacity={0.75} rx={1} />;
              })}
              <line x1={0} y1={0} x2={BAR_AREA_W} y2={0} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3,2" />
              <text x={BAR_AREA_W} y={-2} textAnchor="end" fontSize={7} fill="#94a3b8" fontFamily="sans-serif">{Math.round(ceiling * 100)}%</text>
              <line x1={0} y1={BAR_H} x2={BAR_AREA_W} y2={BAR_H} stroke="#e2e8f0" strokeWidth={1} />
              {DAY_LABELS.map((lbl, i) => (
                <text key={i} x={i * barW + barW / 2} y={BAR_H + AXIS_H - 1} textAnchor="middle" fontSize={8} fill="#94a3b8" fontFamily="sans-serif">{lbl}</text>
              ))}
            </svg>
          </div>
        );
      })()}

      {portfolioObjectTypes.length > 0 && (
        <div style={sectionStyle("portfolio")}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 4 }}>BO type fractions</div>
          {portfolioObjectTypes.map((type, i) => {
            const val = portfolioValues[i] ?? 0;
            return (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 5, lineHeight: "18px" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: typeColorMap[type] ?? "#94a3b8", flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 10, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{type}</span>
                <span style={{ fontSize: 9, color: "#94a3b8", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{(val * 100).toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #f1f5f9" }}>
        {hasMultiple && tooltip.isCluster && (() => {
          const typeCounts: Record<string, number> = {};
          tooltip.resources.forEach(r => {
            const t = resourceObjectTypes[r] ?? "unknown";
            typeCounts[t] = (typeCounts[t] ?? 0) + 1;
          });
          const total = tooltip.resources.length;
          const segments = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
          return (
            <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
              {segments.map(([type, count]) => (
                <div
                  key={type}
                  title={`${type}: ${((count / total) * 100).toFixed(0)}%`}
                  style={{ width: `${(count / total) * 100}%`, background: typeColorMap[type] ?? "#94a3b8" }}
                />
              ))}
            </div>
          );
        })()}
        {hasMultiple ? (
          <>
            <button onClick={() => setShowResources(r => !r)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}
            >
              <span style={{ fontSize: 9 }}>{showResources ? "▾" : "▸"}</span>
              {tooltip.resources.length} {tooltip.isCluster ? "resources in this cluster" : "resources share this profile"}
            </button>
            {showResources && (
              <div style={{ marginTop: 4, maxHeight: 120, overflowY: "auto", fontSize: 10, color: "#475569", lineHeight: "18px" }}>
                {tooltip.resources.map(r => (
                  <div key={r} style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: resourceColorMap[r] ?? "#94a3b8" }} />
                    <span style={{ fontFamily: "monospace" }}>{r}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 10, color: "#475569", display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: resourceColorMap[tooltip.resources[0]] ?? "#94a3b8" }} />
            <span style={{ fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tooltip.resources[0]}</span>
          </div>
        )}
      </div>
    </div>
  );
}
