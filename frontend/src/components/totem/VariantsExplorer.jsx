import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  ChevronDown, ChevronRight, ZoomIn, ZoomOut, Search,
  AlignLeft, Download, Filter, MinusCircle, PlusCircle
} from "lucide-react";

/* ========== minimalist UI wrappers (no shadcn) ========== */
const Card = ({ className = "", children }) =>
  <div className={`rounded-md border`} style={{borderColor:"#E2E8F0"}}><div className={className}>{children}</div></div>;
const CardHeader = ({ className = "", children }) =>
  <div className={className} style={{padding:"12px 16px"}}>{children}</div>;
const CardContent = ({ className = "", children }) =>
  <div className={className} style={{padding:"12px 16px"}}>{children}</div>;
const CardTitle = ({ children }) =>
  <div style={{fontSize:18, fontWeight:600, color:"#0F172A"}}>{children}</div>;

const Button = ({ children, onClick, title, size="md", variant="solid", className="" }) => {
  const pad = size==="icon" ? "6px" : "6px 10px";
  const bg  = variant==="ghost" ? "transparent" : "#2563EB";
  const col = variant==="ghost" ? "#0F172A" : "#fff";
  const brd = variant==="ghost" ? "#E2E8F0" : "transparent";
  return (
    <button onClick={onClick} title={title}
      className={className}
      style={{padding:pad, background:bg, color:col, border:"1px solid "+brd, borderRadius:8, lineHeight:1}}>
      {children}
    </button>
  );
};

/* slider wrapper (expects onValueChange([number])) */
const Slider = ({ value, min, max, step, onValueChange, className="" }) => (
  <input type="range" className={className}
    min={min} max={max} step={step} value={value[0]}
    onChange={e=>onValueChange([Number(e.target.value)])} />
);

/* ========== colors/tokens ========== */
const ACTOR_COLORS = ["#2563EB","#10B981","#F59E0B","#8B5CF6","#F43F5E"];
const EXTENDED_PALETTE = ["#06B6D4","#84CC16","#F97316","#EC4899","#6366F1"];
const TYPE_PALETTE = [...ACTOR_COLORS, ...EXTENDED_PALETTE];

const UI = {
  primary: "#2563EB",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  mutedBG: "#F8FAFC",
};

/* ========== utils ========== */
function shade(hex, factor) {
  const c = hex.replace("#","");
  const r = parseInt(c.slice(0,2),16);
  const g = parseInt(c.slice(2,4),16);
  const b = parseInt(c.slice(4,6),16);
  const mix = (x) => Math.round(x + (255 - x) * factor);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
function mapTypesToColors(types, overrides) {
  const map = {}; let i=0;
  for (const t of types) { map[t] = (overrides && overrides[t]) || TYPE_PALETTE[i % TYPE_PALETTE.length]; i++; }
  return map;
}
function abbreviateFirstLetters(label) {
  if (!label) return label;
  const words = label.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0,12);
  return words.map(w=>w[0]).join("");
}

/* ========== layout (topological columns) ========== */
function computePositions(graph) {
  const preds = new Map(); const succs = new Map();
  for (const n of graph.nodes) { preds.set(n.id,new Set()); succs.set(n.id,new Set()); }
  for (const e of graph.edges) { preds.get(e.to).add(e.from); succs.get(e.from).add(e.to); }

  const memo = new Map(); const visiting = new Set();
  const getStart = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const p = preds.get(id);
    const x = (!p || p.size===0) ? 0 : Math.max(...Array.from(p).map(getStart)) + 1;
    visiting.delete(id); memo.set(id,x); return x;
  };
  for (const n of graph.nodes) getStart(n.id);

  const pos = {};
  for (const n of graph.nodes) {
    const successors = succs.get(n.id);
    const xStart = memo.get(n.id);
    const xEnd = (!successors || successors.size===0)
      ? xStart
      : Math.min(...Array.from(successors).map(s=>memo.get(s))) - 1;
    pos[n.id] = { id:n.id, activity:n.activity, objectIds:n.objectIds, xStart, xEnd };
  }
  return pos;
}

/* ========== main component ========== */
export default function VariantsExplorer({
  variants,
  typeColors,
  laneHeight = 40,
  colWidth = 120,
}) {
  const [zoom, setZoom] = useState(1);
  const [labelMode, setLabelMode] = useState("compact"); // "compact" | "full"
  const [query, setQuery] = useState("");
  const [minSupport, setMinSupport] = useState(0);

  const totalSupport = useMemo(() => variants.reduce((s,v)=>s+v.support,0), [variants]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variants
      .filter(v => v.support >= minSupport)
      .filter(v => q ? (String(v.id).toLowerCase().includes(q) || v.signature.toLowerCase().includes(q)) : true)
      .sort((a,b)=> b.support - a.support);
  }, [variants, minSupport, query]);

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:16}}>
          <CardTitle>Object-Centric Variants</CardTitle>

          <div style={{display:"flex", alignItems:"center", gap:16}}>
            {/* Zoom */}
            <div style={{display:"flex", alignItems:"center", gap:8}}>
              <ZoomOut size={16} color={UI.textSecondary} />
              <Slider value={[zoom]} min={0.5} max={2} step={0.1}
                      onValueChange={v=>setZoom(v[0])}
                      className="w-40" />
              <ZoomIn size={16} color={UI.textSecondary} />
            </div>

            {/* Label mode toggle */}
            <div style={{display:"flex", gap:6, background:UI.mutedBG, border:`1px solid ${UI.border}`, borderRadius:8, padding:2}}>
              <Button variant="ghost" onClick={()=>setLabelMode("compact")}
                className="" title="Compact labels">
                <AlignLeft size={14}/> <span style={{marginLeft:4}}>Compact</span>
              </Button>
              <Button variant="ghost" onClick={()=>setLabelMode("full")} title="Full labels">Full</Button>
            </div>

            {/* Search */}
            <div style={{position:"relative"}}>
              <Search size={14} color={UI.textSecondary}
                      style={{position:"absolute", left:8, top:10}} />
              <input
                placeholder="Filter by id or signature…"
                style={{padding:"8px 8px 8px 28px", width:260, border:`1px solid ${UI.border}`, borderRadius:8}}
                value={query} onChange={e=>setQuery(e.target.value)}
                aria-label="Filter variants"
              />
            </div>

            {/* Min support */}
            <div style={{display:"flex", alignItems:"center", gap:8}}>
              <Filter size={16} color={UI.textSecondary}/>
              <input type="number" min={0}
                style={{width:100, padding:"6px 8px", border:`1px solid ${UI.border}`, borderRadius:8}}
                value={String(minSupport)}
                onChange={e=>setMinSupport(Math.max(0, Number(e.target.value||0)))}
                placeholder="Min support"
                aria-label="Minimum support"
              />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        <div style={{display:"flex", flexDirection:"column", gap:12}}>
          {filtered.map(v => (
            <VariantRow
              key={v.signature_hash}
              v={v}
              totalSupport={totalSupport}
              zoom={zoom}
              labelMode={labelMode}
              laneHeight={laneHeight}
              colWidth={colWidth}
              typeColorsOverride={typeColors}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{fontSize:12, color:UI.textSecondary}}>No variants match your filters.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

VariantsExplorer.propTypes = {
  variants: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      support: PropTypes.number.isRequired,
      signature: PropTypes.string.isRequired,
      signature_hash: PropTypes.string.isRequired,
      graph: PropTypes.shape({
        nodes: PropTypes.arrayOf(
          PropTypes.shape({
            id: PropTypes.string.isRequired,
            activity: PropTypes.string.isRequired,
            objectIds: PropTypes.arrayOf(PropTypes.string).isRequired,
          })
        ).isRequired,
        edges: PropTypes.arrayOf(
          PropTypes.shape({
            from: PropTypes.string.isRequired,
            to: PropTypes.string.isRequired,
          })
        ).isRequired,
        objects: PropTypes.arrayOf(
          PropTypes.shape({
            id: PropTypes.string.isRequired,
            type: PropTypes.string.isRequired,
            label: PropTypes.string,
          })
        ).isRequired,
      }).isRequired,
    })
  ).isRequired,
  typeColors: PropTypes.objectOf(PropTypes.string),
  laneHeight: PropTypes.number,
  colWidth: PropTypes.number,
};

/* ========== Variant row ========== */
function VariantRow({
  v, totalSupport, zoom, labelMode, laneHeight, colWidth, typeColorsOverride
}) {
  const [expanded, setExpanded] = useState(false);
  const [collapsedTypes, setCollapsedTypes] = useState(new Set());

  const pos = useMemo(() => computePositions(v.graph), [v]);
  const objects = v.graph.objects;

  const objectTypes = useMemo(() =>
    Array.from(new Set(objects.map(o=>o.type))), [objects]);
  const typeColor = useMemo(() => mapTypesToColors(objectTypes, typeColorsOverride),
    [objectTypes, typeColorsOverride]);

  const lanesByType = useMemo(() => {
    const map = new Map();
    for (const o of objects) {
      if (!map.has(o.type)) map.set(o.type, []);
      map.get(o.type).push(o);
    }
    for (const [t, arr] of map) arr.sort((a,b)=>a.id.localeCompare(b.id));
    return Array.from(map.entries());
  }, [objects]);

  const maxCol = useMemo(() =>
    Math.max(0, ...Object.values(pos).map(p=>Math.max(p.xStart, p.xEnd))),
    [pos]
  );
  const cols = maxCol + 1;
  const gridTemplateCols = `repeat(${cols}, ${Math.round(colWidth*zoom)}px)`;

  const laneEvents = useMemo(() => {
    const map = new Map();
    for (const p of Object.values(pos)) for (const oid of p.objectIds) {
      if (!map.has(oid)) map.set(oid, []);
      map.get(oid).push({...p});
    }
    for (const [, arr] of map) {
      arr.sort((a,b)=>a.xStart-b.xStart);
      for (let i=0;i<arr.length;i++) {
        const cur = arr[i], prev = arr[i-1], next = arr[i+1];
        const prevShared = prev ? prev.objectIds.length>1 : false;
        const nextShared = next ? next.objectIds.length>1 : false;
        if (cur.objectIds.length===1 && prevShared && nextShared && next) {
          const naturalEnd = next.xStart - 1;
          if (naturalEnd >= cur.xStart) cur.xEnd = Math.min(cur.xEnd, naturalEnd);
        }
      }
    }
    return map;
  }, [pos]);

  const supportPct = totalSupport ? (v.support/totalSupport) : 0;
  const toggleType = (t) => setCollapsedTypes(prev => {
    const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n;
  });

  const colsCount = cols;
  const visibleRowCount = lanesByType.reduce((acc,[t,objs]) =>
    acc + (collapsedTypes.has(t) ? 1 : objs.length) + 1, 0);

  return (
    <div style={{border:`1px solid ${UI.border}`, borderRadius:8}}>
      <CardHeader className="py-2">
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <Button variant="ghost" size="icon"
                  onClick={()=>setExpanded(e=>!e)}
                  title={expanded? "Collapse variant":"Expand variant"}>
            {expanded ? <ChevronDown size={20}/> : <ChevronRight size={20}/>}
          </Button>

          {/* support bar */}
          <div style={{
            position:"relative", height:12, width:160, border:`1px solid ${UI.border}`,
            background:UI.mutedBG, borderRadius:6, overflow:"hidden"
          }} aria-label={`Support: ${v.support} (${(supportPct*100).toFixed(1)}%)`}>
            <div style={{position:"absolute", inset:"0 0 0 0", width:`${Math.round(supportPct*100)}%`, background:UI.primary}}/>
          </div>
          <div style={{fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace", fontSize:12, color:UI.textPrimary}}>
            {v.support}
          </div>

          <div style={{color:UI.textPrimary}}>
            Variant <span style={{fontFamily:"ui-monospace, monospace"}}>{String(v.id)}</span>
          </div>

          <div style={{marginLeft:"auto", display:"flex", alignItems:"center", gap:8}}>
            <div style={{fontSize:12, color:UI.textSecondary, maxWidth:350, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}
                 title={v.signature}>
              signature: {v.signature}
            </div>
            <Button variant="ghost" size="icon" title="Export (stub)">
              <Download size={16}/>
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <div style={{display:"flex", alignItems:"flex-start", gap:24}}>
            {/* legend */}
            <div style={{width:256, flexShrink:0}}>
              <div style={{fontSize:12, fontWeight:600, marginBottom:8, color:UI.textSecondary}}>Object types</div>
              <div style={{display:"flex", flexDirection:"column", gap:12}}>
                {lanesByType.map(([type, objs]) => {
                  const collapsed = collapsedTypes.has(type);
                  const tColor = typeColor[type];
                  return (
                    <div key={type} style={{border:`1px solid ${UI.border}`, borderRadius:8, padding:8}}>
                      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6}}>
                        <div style={{display:"flex", alignItems:"center", gap:8}}>
                          <div style={{height:12, width:12, borderRadius:3, background:tColor}}/>
                          <div style={{fontSize:14, fontWeight:600, color:UI.textPrimary}}>{type}</div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={()=>toggleType(type)}
                                title={collapsed? `Expand ${type} lanes` : `Collapse ${type} lanes`}>
                          {collapsed ? <PlusCircle size={16}/> : <MinusCircle size={16}/>}
                        </Button>
                      </div>
                      {!collapsed && (
                        <div style={{display:"flex", flexWrap:"wrap", gap:8, paddingLeft:20}}>
                          {objs.map((o, i) => (
                            <div key={o.id} style={{fontSize:12, display:"flex", alignItems:"center", gap:6}}>
                              <div style={{height:8, width:16, borderRadius:3, background:shade(tColor, 0.15*(i%5))}}/>
                              <span title={o.label || o.id} style={{color:UI.textSecondary, maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                                {o.label || o.id}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* canvas */}
            <div style={{position:"relative", border:`1px solid ${UI.border}`, borderRadius:8, overflow:"auto", width:"100%"}}
                 aria-label={`Variant ${v.id} visualization`}>
              <div style={{minWidth:"100%", height: visibleRowCount * laneHeight}}>
                <div style={{
                  position:"absolute", inset:0, display:"grid",
                  gridTemplateColumns: gridTemplateCols,
                  gridAutoRows: `${laneHeight}px`, columnGap:"12px"
                }}>
                  {/* lane lines */}
                  {(() => {
                    const acc = {row:0, els:[]};
                    for (const [type, objs] of lanesByType) {
                      const collapsed = collapsedTypes.has(type);
                      if (!collapsed) {
                        for (const o of objs) {
                          acc.row += 1;
                          acc.els.push(
                            <div key={`lane-${o.id}`}
                                 style={{gridColumn:`1 / span ${colsCount}`, gridRow:`${acc.row}`,
                                         borderBottom:`1px dashed ${UI.border}`}}/>
                          );
                        }
                        acc.row += 1;
                        acc.els.push(<div key={`gap-${type}`} style={{gridColumn:`1 / span ${colsCount}`, gridRow:`${acc.row}`}}/>);
                      } else {
                        acc.row += 1;
                        acc.els.push(<div key={`sep-${type}`} style={{gridColumn:`1 / span ${colsCount}`, gridRow:`${acc.row}`, borderBottom:`1px solid ${UI.border}`}}/>);
                      }
                    }
                    return acc.els;
                  })()}

                  {/* events */}
                  {(() => {
                    const acc = {row:0, els:[]};
                    for (const [type, objs] of lanesByType) {
                      if (collapsedTypes.has(type)) { acc.row += 1; continue; }
                      for (const o of objs) {
                        acc.row += 1;
                        const events = (laneEvents.get(o.id) || []).slice().sort((a,b)=>a.xStart-b.xStart);
                        for (let i=0;i<events.length;i++) {
                          const ev = events[i];
                          const colStart = ev.xStart + 1;
                          const span = Math.max(1, ev.xEnd - ev.xStart + 1);
                          const isShared = ev.objectIds.length > 1;
                          const label = labelMode === "compact" ? abbreviateFirstLetters(ev.activity) : ev.activity;
                          const background = gradientFor(objects, typeColor, ev.objectIds);

                          const title = `${ev.activity}\nEvent: ${ev.id}\nObjects: ${ev.objectIds.join(", ")}\nPos: [${ev.xStart}..${ev.xEnd}]`;

                          acc.els.push(
                            <div key={`${o.id}-${ev.id}-${i}`}
                              title={title}
                              style={{
                                gridColumn:`${colStart} / span ${span}`, gridRow:`${acc.row}`, background,
                                color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                                borderRadius:8, position:"relative", userSelect:"none", fontSize:12
                              }}
                              aria-label={`${label} on ${o.id}${isShared?" (shared)":""}`}
                              >
                              {/* hatch for shared */}
                              {isShared && (
                                <div aria-hidden
                                  style={{
                                    position:"absolute", inset:0, opacity:0.25,
                                    backgroundImage:"repeating-linear-gradient(45deg, #000 0 2px, transparent 2px 6px)"
                                  }}/>
                              )}
                              <span style={{padding:"2px 8px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{label}</span>
                              {isShared && <div style={{position:"absolute", right:4, top:2, fontSize:10, opacity:0.8}} aria-hidden>⇄</div>}
                            </div>
                          );
                        }
                      }
                      acc.row += 1;
                    }
                    return acc.els;
                  })()}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </div>
  );
}

/* visual helper */
function ChevronMask() {
  return (
    <svg style={{position:"absolute", inset:0, width:"100%", height:"100%"}} preserveAspectRatio="none" aria-hidden>
      <defs>
        <clipPath id="chev">
          <polygon points="0,0 90,0 100,50 90,100 0,100 10,50" />
        </clipPath>
      </defs>
      <rect width="100%" height="100%" clipPath="url(#chev)"/>
    </svg>
  );
}

function gradientFor(objects, typeColor, objectIds) {
  const colors = objectIds.map((oid) => {
    const obj = objects.find(o => o.id === oid);
    const base = obj ? typeColor[obj.type] : UI.textSecondary;
    const siblings = objects.filter(o => o.type === (obj ? obj.type : ""));
    const idx = siblings.findIndex(o => o.id === oid);
    return shade(base, 0.15 * (idx % 5));
  });
  if (colors.length <= 1) return colors[0] || UI.textSecondary;
  const step = 100 / (colors.length - 1);
  return `linear-gradient(90deg, ${colors.map((c,i)=>`${c} ${i*step}%`).join(", ")})`;
}
