import { Info } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * Bottom-left legend of the Process Area Visualizer: which arc glyph stands
 * for which temporal relation, plus an info popover explaining what the
 * relations say about the lifespans of the connected objects.
 *
 * The glyphs mirror how TotemVisualizer draws the arcs: a box cap at the
 * target for "during", an arrow head for "precedes", and a pair of bars at
 * both ends for "parallel".
 */

const STROKE = '#0F172A';
const GLYPH_WIDTH = 44;
const GLYPH_HEIGHT = 14;
const MID_Y = GLYPH_HEIGHT / 2;

function DuringGlyph() {
  return (
    <svg width={GLYPH_WIDTH} height={GLYPH_HEIGHT} aria-hidden>
      <line x1={2} y1={MID_Y} x2={32} y2={MID_Y} stroke={STROKE} strokeWidth={2.4} strokeLinecap="round" />
      <rect x={32} y={MID_Y - 5} width={10} height={10} fill={STROKE} />
    </svg>
  );
}

function PrecedesGlyph() {
  return (
    <svg width={GLYPH_WIDTH} height={GLYPH_HEIGHT} aria-hidden>
      <line x1={2} y1={MID_Y} x2={31} y2={MID_Y} stroke={STROKE} strokeWidth={2.2} strokeLinecap="round" />
      <path d={`M 30 ${MID_Y - 6} L 42 ${MID_Y} L 30 ${MID_Y + 6} Z`} fill={STROKE} />
    </svg>
  );
}

function ParallelGlyph() {
  const bars = [3, 8, GLYPH_WIDTH - 8, GLYPH_WIDTH - 3];
  return (
    <svg width={GLYPH_WIDTH} height={GLYPH_HEIGHT} aria-hidden>
      <line x1={2} y1={MID_Y} x2={GLYPH_WIDTH - 2} y2={MID_Y} stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" />
      {bars.map((x) => (
        <line key={x} x1={x} y1={MID_Y - 5} x2={x} y2={MID_Y + 5} stroke={STROKE} strokeWidth={2.6} />
      ))}
    </svg>
  );
}

/** Two lifespan bars on a shared time axis, used inside the info popover. */
function LifespanSketch({
  a,
  b,
  altB,
  label,
}: {
  a: [number, number];
  b: [number, number];
  /** Another possible B lifespan, drawn outlined (used for "parallel"). */
  altB?: [number, number];
  label: string;
}) {
  const width = 120;
  const height = altB ? 44 : 30;
  const toX = (t: number) => 18 + t * (width - 22);
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="shrink-0">
      <text x={0} y={11} fontSize={9} fill="#475569">A</text>
      <rect x={toX(a[0])} y={4} width={toX(a[1]) - toX(a[0])} height={8} rx={2} fill="#3b82f6" />
      <text x={0} y={25} fontSize={9} fill="#475569">B</text>
      <rect x={toX(b[0])} y={18} width={toX(b[1]) - toX(b[0])} height={8} rx={2} fill="#94a3b8" />
      {altB && (
        <>
          <text x={0} y={39} fontSize={9} fill="#475569">B</text>
          <rect
            x={toX(altB[0])}
            y={32}
            width={toX(altB[1]) - toX(altB[0])}
            height={8}
            rx={2}
            fill="none"
            stroke="#94a3b8"
            strokeDasharray="3 2"
          />
        </>
      )}
    </svg>
  );
}

const ENTRIES = [
  { key: 'D', label: 'During', Glyph: DuringGlyph },
  { key: 'I', label: 'Preceding', Glyph: PrecedesGlyph },
  { key: 'P', label: 'Parallel', Glyph: ParallelGlyph },
] as const;

export function RelationLegend() {
  return (
    <div
      data-totem-control
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 50,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '8px 10px',
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Relations
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="What do the relations mean?"
              title="What do the relations mean?"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-[360px] space-y-3 text-xs">
            <div className="space-y-1">
              <p className="text-sm font-medium">Object lifespans</p>
              <p className="text-muted-foreground">
                The lifespan of an object runs from its first to its last event. An arc
                from type A to type B describes how the lifespans of related A and B
                objects usually lie relative to each other (the relation that holds
                for most related pairs).
              </p>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <DuringGlyph /> During
                </div>
                <p className="text-muted-foreground">
                  Every A object lives within the lifespan of its related B object: B
                  starts no later than A and ends no earlier than A. B is typically a
                  longer-lived resource, so it is drawn on a higher layer.
                </p>
              </div>
              <LifespanSketch a={[0.3, 0.7]} b={[0, 1]} label="A during B" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <PrecedesGlyph /> Preceding
                </div>
                <p className="text-muted-foreground">
                  A objects start before their related B objects and also end before
                  them. The lifespans may overlap, but A always comes first (A
                  initiates B).
                </p>
              </div>
              <LifespanSketch a={[0, 0.55]} b={[0.4, 1]} label="A precedes B" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <ParallelGlyph /> Parallel
                </div>
                <p className="text-muted-foreground">
                  Related A and B objects show no consistent order: their lifespans
                  are ordered differently from case to case (sometimes A comes first,
                  sometimes B), so neither during nor preceding holds. The relation is
                  symmetric and has no direction.
                </p>
              </div>
              <LifespanSketch
                a={[0.3, 0.75]}
                b={[0.45, 1]}
                altB={[0, 0.5]}
                label="A parallel to B: B may start before or after A"
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <ul className="space-y-0.5">
        {ENTRIES.map(({ key, label, Glyph }) => (
          <li key={key} className="flex items-center gap-2 text-xs text-slate-700">
            <Glyph />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default RelationLegend;
