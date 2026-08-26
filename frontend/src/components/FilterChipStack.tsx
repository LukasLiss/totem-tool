import React, { useContext, useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Filter, Calendar, Layers, Zap, X, ChevronDown, ChevronRight, CheckCheck, GripVertical,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type FilterRule,
  type FilterType,
  type TimeRangeParams,
  type ObjectTypesParams,
  type ActivityParams,
  useFilterStack,
} from "@/contexts/FilterStackContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { FilterConfigDialog } from "./FilterConfigDialog";


const PIPE_BG = "var(--secondary)";
const PIPE_FG = "var(--secondary-foreground)";
const TIP    = 20;   
const HEIGHT = 50;  
const R      = 8;    
const APPLY_W = 120;
const SLOT_CLIP = `polygon(0 0, calc(100% - ${TIP}px) 0, 100% 50%, calc(100% - ${TIP}px) 100%, 0 100%, ${TIP}px 50%)`;
const applyClipPath = `path('M ${TIP} ${HEIGHT / 2} L 0 0 L ${APPLY_W - R} 0 A ${R} ${R} 0 0 1 ${APPLY_W} ${R} L ${APPLY_W} ${HEIGHT - R} A ${R} ${R} 0 0 1 ${APPLY_W - R} ${HEIGHT} L 0 ${HEIGHT} Z')`;


const arrowBase: React.CSSProperties = {
  height:     HEIGHT,
  display:    "flex",
  alignItems: "center",
  userSelect: "none",
  flexShrink: 0,
  position:   "relative",
  transition: "background 0.15s, opacity 0.15s",
};

const FILTER_TYPE_ORDER: FilterType[] = ["time_range", "object_types", "activity"];

const TYPE_CONFIG: Record<FilterType, { bg: string; fg: string; icon: React.ReactElement; label: string }> = {
  time_range:   { bg: "var(--primary)", fg: "var(--primary-foreground)", icon: <Calendar size={14} />, label: "Time Range"   },
  object_types: { bg: "var(--primary)", fg: "var(--primary-foreground)", icon: <Layers   size={14} />, label: "Object Types" },
  activity:     { bg: "var(--primary)", fg: "var(--primary-foreground)", icon: <Zap      size={14} />, label: "Activities"   },
};

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
}

function getSlotLabel(rule: FilterRule): string {
  switch (rule.type) {
    case "time_range": {
      const p = rule.params as TimeRangeParams;
      if (p.after != null && p.before != null) return `${fmtDate(p.after)} – ${fmtDate(p.before)}`;
      if (p.after  != null) return `After ${fmtDate(p.after)}`;
      if (p.before != null) return `Before ${fmtDate(p.before)}`;
      return "Any time";
    }
    case "object_types": {
      const { include } = rule.params as ObjectTypesParams;
      return include.length === 0 ? "No object types" : `Object Types (${include.length})`;
    }
    case "activity": {
      const { include } = rule.params as ActivityParams;
      return include.length === 0 ? "No activities" : `Activities (${include.length})`;
    }
  }
}


// ── arc stat indicator around the filter icon ─────────────────────────────────
const ARC_SIZE = 38;
const ARC_OR   = 16;   // outer radius — activities
const ARC_IR   = 10;   // inner radius — objects
const ARC_SW   = 2.5;  // stroke width
const ARC_C    = ARC_SIZE / 2;

function FilterIconWithArcs({
  objectPct,
  eventPct,
}: {
  objectPct: number;
  eventPct:  number;
}) {
  const outerCirc = 2 * Math.PI * ARC_OR;
  const innerCirc = 2 * Math.PI * ARC_IR;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div style={{ position: "relative", width: ARC_SIZE, height: ARC_SIZE, flexShrink: 0, cursor: "default" }}>
          <svg
            width={ARC_SIZE}
            height={ARC_SIZE}
            viewBox={`0 0 ${ARC_SIZE} ${ARC_SIZE}`}
            style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}
          >
            <circle cx={ARC_C} cy={ARC_C} r={ARC_OR} fill="none"
              style={{ stroke: "currentColor", opacity: 0.2 }} strokeWidth={ARC_SW} />
            <circle cx={ARC_C} cy={ARC_C} r={ARC_IR} fill="none"
              style={{ stroke: "currentColor", opacity: 0.2 }} strokeWidth={ARC_SW} />
            <circle
              cx={ARC_C} cy={ARC_C} r={ARC_OR}
              fill="none"
              strokeWidth={ARC_SW}
              strokeLinecap="round"
              transform={`rotate(-90 ${ARC_C} ${ARC_C})`}
              style={{
                stroke: "var(--foreground)",
                strokeDasharray: `${outerCirc * eventPct} ${outerCirc}`,
                transition: "stroke-dasharray 0.5s ease",
              }}
            />
            <circle
              cx={ARC_C} cy={ARC_C} r={ARC_IR}
              fill="none"
              strokeWidth={ARC_SW}
              strokeLinecap="round"
              transform={`rotate(-90 ${ARC_C} ${ARC_C})`}
              style={{
                stroke: "var(--foreground)",
                opacity: 0.45,
                strokeDasharray: `${innerCirc * objectPct} ${innerCirc}`,
                transition: "stroke-dasharray 0.5s ease",
              }}
            />
          </svg>
          <div style={{
            position:        "absolute",
            top:             "50%",
            left:            "50%",
            transform:       "translate(-50%, -50%)",
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "center",
            pointerEvents:   "none",
          }}>
            <Filter size={14} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Objects: {Math.round(objectPct * 100)}% · Events: {Math.round(eventPct * 100)}%
      </TooltipContent>
    </Tooltip>
  );
}

const fmtStat = (n: number) => n.toLocaleString();

function FilterHeaderArrow({
  expanded,
  objectPct,
  eventPct,
  objectBefore,
  objectAfter,
  eventBefore,
  eventAfter,
  hasFile,
  onClick,
}: {
  expanded:     boolean;
  objectPct:    number;
  eventPct:     number;
  objectBefore: number;
  objectAfter:  number;
  eventBefore:  number;
  eventAfter:   number;
  hasFile:      boolean;
  onClick:      () => void;
}) {
  const bg = PIPE_BG;
  const fg = PIPE_FG;

  
  const hasFiltered = objectBefore > 0 && (objectAfter < objectBefore || eventAfter < eventBefore);

  return (
    <div
      onClick={onClick}
      title={expanded ? "Collapse filters" : "Expand filters"}
      style={{
        ...arrowBase,
        borderRadius: `${R}px 0 0 ${R}px`,
        background:   bg,
        color:        fg,
        paddingLeft:  10,
        paddingRight: TIP + 10,
        gap:          expanded && hasFiltered ? 10 : 4,
        cursor:       "pointer",
        minWidth:     expanded && hasFiltered ? 210 : 80,
        zIndex:       100,
        overflow:     "visible",
      }}
    >
      {hasFile
        ? <FilterIconWithArcs objectPct={objectPct} eventPct={eventPct} />
        : <Filter size={14} style={{ flexShrink: 0 }} />
      }

      {expanded && hasFiltered && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 3,
          fontSize: 10.5, lineHeight: 1.2, overflow: "hidden",
        }}>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ opacity: 0.65, width: 24, flexShrink: 0 }}>Obj</span>
            <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
              {fmtStat(objectAfter)}
              <span style={{ opacity: 0.55, fontWeight: 400 }}> / {fmtStat(objectBefore)}</span>
            </span>
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ opacity: 0.65, width: 24, flexShrink: 0 }}>Evt</span>
            <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
              {fmtStat(eventAfter)}
              <span style={{ opacity: 0.55, fontWeight: 400 }}> / {fmtStat(eventBefore)}</span>
            </span>
          </div>
        </div>
      )}

      {expanded
        ? <ChevronDown  size={13} style={{ flexShrink: 0, marginLeft: "auto" }} />
        : <ChevronRight size={13} style={{ flexShrink: 0 }} />}
      <div style={{
        position:     "absolute",
        right:        -TIP,
        top:          0,
        width:        0,
        height:       0,
        borderTop:    `${HEIGHT / 2}px solid transparent`,
        borderBottom: `${HEIGHT / 2}px solid transparent`,
        borderLeft:   `${TIP}px solid ${bg}`,
        pointerEvents: "none",
      }} />
    </div>
  );
}

type SlotArrowProps = {
  type:        FilterType;
  activeRule:  FilterRule | undefined;
  zIndex:      number;
  isDragging:  boolean;
  onClick:     () => void;
  onRemove:    () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragEnd:   () => void;
};

function FilterSlotArrow({
  type, activeRule, zIndex, isDragging,
  onClick, onRemove, onDragStart, onDragEnter, onDragEnd,
}: SlotArrowProps) {
  const isActive = !!activeRule;
  const text     = isActive ? getSlotLabel(activeRule!) : TYPE_CONFIG[type].label;

  const bg      = isActive ? TYPE_CONFIG[type].bg : PIPE_BG;
  const fgColor = isActive ? TYPE_CONFIG[type].fg : PIPE_FG;

  return (
    <div
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      title={isActive ? `Edit: ${text} (click to change)` : `Add ${TYPE_CONFIG[type].label} filter`}
      style={{
        ...arrowBase,
        clipPath:       SLOT_CLIP,
        WebkitClipPath: SLOT_CLIP,
        marginLeft:     -TIP,
        zIndex:         isDragging ? 200 : zIndex,
        background:     bg,
        color:          fgColor,
        paddingLeft:    TIP + 6,
        paddingRight:   TIP + 14,
        gap:            5,
        cursor:         "grab",
        opacity:        isDragging ? 0.4 : isActive && !activeRule?.enabled ? 0.55 : 1,
        minWidth:       120,
      }}
    >
      <GripVertical size={13} style={{ flexShrink: 0, opacity: 0.5, cursor: "grab" }} />
      {TYPE_CONFIG[type].icon}
      <span style={{
        fontSize:     13,
        fontWeight:   600,
        maxWidth:     120,
        overflow:     "hidden",
        textOverflow: "ellipsis",
        whiteSpace:   "nowrap",
      }}>
        {text}
      </span>
      {isActive && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            background: "none", border: "none", padding: 0,
            color: "inherit", opacity: 0.8, cursor: "pointer",
            display: "flex", alignItems: "center", marginLeft: 2,
          }}
          aria-label={`Remove ${TYPE_CONFIG[type].label} filter`}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}



function ApplyButton({
  applying,
  dirty,
  disabled,
  onClick,
}: {
  applying: boolean;
  dirty:    boolean;
  disabled: boolean;
  onClick:  () => void;
}) {
  const bg = dirty ? "var(--primary)" : PIPE_BG;
  const fg = dirty ? "var(--primary-foreground)" : PIPE_FG;

  return (
    <div
      onClick={disabled ? undefined : onClick}
      title={dirty ? "Apply filters" : "No changes to apply"}
      style={{
        ...arrowBase,
        clipPath:       applyClipPath,
        WebkitClipPath: applyClipPath,
        marginLeft:     -TIP,
        zIndex:         10,
        width:          APPLY_W,
        background:     bg,
        color:          fg,
        paddingLeft:    TIP + 14,
        paddingRight:   20,
        gap:            6,
        cursor:         disabled ? "not-allowed" : "pointer",
        opacity:        applying ? 0.75 : 1,
        transition:     "background 0.15s, color 0.15s, opacity 0.15s",
      }}
    >
      {applying ? (
        <div style={{
          width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
          border: "2px solid currentColor", borderTopColor: "transparent",
          animation: "spin 0.6s linear infinite", opacity: 0.8,
        }} />
      ) : (
        <CheckCheck size={15} style={{ flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
        {applying ? "Applying…" : "Apply"}
      </span>
    </div>
  );
}

type FilterStats = {
  objectPct:    number;
  eventPct:     number;
  objectBefore: number;
  objectAfter:  number;
  eventBefore:  number;
  eventAfter:   number;
};

const DEFAULT_STATS: FilterStats = {
  objectPct: 1, eventPct: 1,
  objectBefore: 0, objectAfter: 0,
  eventBefore: 0, eventAfter: 0,
};

export default function FilterChipStack() {
  const { filters, addFilter, removeFilter } = useFilterStack();
  const { selectedFile } = useContext(SelectedFileContext);
  const fileId: number | undefined = selectedFile?.id;

  const [expanded,      setExpanded]      = useState(false);
  const [dialogOpen,    setDialogOpen]    = useState(false);
  const [activeType,    setActiveType]    = useState<FilterType>("object_types");
  const [editingRule,   setEditingRule]   = useState<FilterRule | undefined>();
  const [objectTypes,   setObjectTypes]   = useState<{ name: string; count: number }[]>([]);
  const [activities,    setActivities]    = useState<{ name: string; count: number }[]>([]);
  const [stats,         setStats]         = useState<FilterStats>(DEFAULT_STATS);
  const [applying,      setApplying]      = useState(false);
  const [appliedKey,    setAppliedKey]    = useState(JSON.stringify([]));


  const [typeOrder,     setTypeOrder]     = useState<FilterType[]>(FILTER_TYPE_ORDER);
  const [draggingType,  setDraggingType]  = useState<FilterType | null>(null);

  const dragSrcIdx = useRef<number | null>(null);


  useEffect(() => {
    setStats(DEFAULT_STATS);
    setAppliedKey(JSON.stringify([]));
    if (!fileId) { setObjectTypes([]); setActivities([]); return; }
    axios.get<{ name: string; count: number }[]>(`/api/files/${fileId}/object_types/`)
      .then(({ data }) => setObjectTypes(Array.isArray(data) ? data : []))
      .catch((err) => { console.error("FilterChipStack: failed to load object_types", err); setObjectTypes([]); });
    axios.get<{ name: string; count: number }[]>(`/api/files/${fileId}/activities/`)
      .then(({ data }) => setActivities(Array.isArray(data) ? data : []))
      .catch((err) => { console.error("FilterChipStack: failed to load activities", err); setActivities([]); });

    axios.get<{ num_objects: number; num_events: number }>(
      `/api/files/${fileId}/statistics/`
    ).then(({ data }) => {
      setStats({
        objectPct:    1,
        eventPct:     1,
        objectBefore: data.num_objects,
        objectAfter:  data.num_objects,
        eventBefore:  data.num_events,
        eventAfter:   data.num_events,
      });
    }).catch(() => {});
  }, [fileId]);

  const currentKey = JSON.stringify(filters);
  const dirty = currentKey !== appliedKey;

  const ruleForType = (type: FilterType) => filters.find(f => f.type === type);

  function handleDragStart(e: React.DragEvent, idx: number) {
    dragSrcIdx.current = idx;
    setDraggingType(typeOrder[idx]);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnter(e: React.DragEvent, idx: number) {
    e.preventDefault();
    const src = dragSrcIdx.current;
    if (src === null || src === idx) return;
    setTypeOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(src, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    dragSrcIdx.current = idx;
  }

  function handleDragEnd() {
    dragSrcIdx.current = null;
    setDraggingType(null);
  }

  function openSlot(type: FilterType) {
    const existing = ruleForType(type);
    setActiveType(type);
    setEditingRule(existing);
    setDialogOpen(true);
  }

  function handleSubmit(params: FilterRule["params"]) {
    if (editingRule) removeFilter(editingRule.id);
    addFilter({ type: activeType, enabled: true, params });
  }

  async function handleApply() {
    if (!fileId || applying || !dirty) return;

    const activeFilters = filters.filter(f => f.enabled);

    if (activeFilters.length === 0) {
      setStats(prev => ({
        ...prev,
        objectPct: 1, eventPct: 1,
        objectAfter: prev.objectBefore,
        eventAfter: prev.eventBefore,
      }));
      setAppliedKey(currentKey);
      return;
    }

    setApplying(true);
    try {
      const { data } = await axios.post<{
        object_percentage:  number;
        object_count_before: number;
        object_count_after:  number;
        event_percentage:   number;
        event_count_before: number;
        event_count_after:  number;
      }>(`/api/files/${fileId}/apply_filters/`, { filters: activeFilters });
      setStats({
        objectPct:    data.object_percentage,
        eventPct:     data.event_percentage,
        objectBefore: data.object_count_before,
        objectAfter:  data.object_count_after,
        eventBefore:  data.event_count_before,
        eventAfter:   data.event_count_after,
      });
      setAppliedKey(currentKey);
    } catch (err) {
      console.error("FilterChipStack: failed to apply filters", err);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", overflowX: "auto", paddingBottom: 2,
      filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.13))",
    }}>
      <FilterHeaderArrow
        expanded={expanded}
        objectPct={stats.objectPct}
        eventPct={stats.eventPct}
        objectBefore={stats.objectBefore}
        objectAfter={stats.objectAfter}
        eventBefore={stats.eventBefore}
        eventAfter={stats.eventAfter}
        hasFile={!!fileId}
        onClick={() => setExpanded(e => !e)}
      />

      {expanded && typeOrder.map((type, i) => (
        <FilterSlotArrow
          key={type}
          type={type}
          activeRule={ruleForType(type)}
          zIndex={i + 1}
          isDragging={draggingType === type}
          onClick={() => openSlot(type)}
          onRemove={() => {
            const r = ruleForType(type);
            if (r) removeFilter(r.id);
          }}
          onDragStart={(e) => handleDragStart(e, i)}
          onDragEnter={(e) => handleDragEnter(e, i)}
          onDragEnd={handleDragEnd}
        />
      ))}

      {expanded && (
        <ApplyButton
          applying={applying}
          dirty={dirty}
          disabled={!dirty || !fileId}
          onClick={handleApply}
        />
      )}

      <FilterConfigDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        filterType={activeType}
        existingRule={editingRule}
        availableObjectTypes={objectTypes}
        availableActivities={activities}
        onSubmit={handleSubmit}
        icon={TYPE_CONFIG[activeType].icon}
        titleLabel={TYPE_CONFIG[activeType].label}
        hasFile={!!fileId}
        fileId={fileId}
      />
    </div>
  );
}
