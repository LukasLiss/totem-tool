import { memo, useEffect, useState, type MouseEvent } from "react";

import { colorGroupKey, type ChartPoint } from "./dottedChartUtils";

type MinimapRange = {
  startIndex: number;
  endIndex: number;
};

type DottedChartMinimapProps = {
  points: ChartPoint[];
  framePoints: ChartPoint[];
  yTicks: number[];
  colorScale: Map<string, string>;
  colorKeys: string[];
  xRange: MinimapRange;
  yRange: MinimapRange;
  onRangeChange: (xRange: MinimapRange, yRange: MinimapRange) => void;
};

type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DraftViewport = {
  rect: ViewportRect;
  pointerOffsetX: number;
  pointerOffsetY: number;
  yTickCount: number;
};

const WIDTH = 180;
const HEIGHT = 104;
const PADDING = 8;

export const DottedChartMinimap = memo(function DottedChartMinimap({
  points,
  framePoints,
  yTicks,
  colorScale,
  colorKeys,
  xRange,
  yRange,
  onRangeChange,
}: DottedChartMinimapProps) {
  const [draftViewport, setDraftViewport] = useState<DraftViewport | null>(null);

  useEffect(() => {
    setDraftViewport(null);
  }, [xRange, yRange]);

  if (!points.length || !yTicks.length) return null;

  const xDomain = getDomain(framePoints.map((point) => point.chartX));
  const yIndexByTick = new Map(yTicks.map((tick, index) => [tick, index]));
  const selectedPoints = points.filter((point) => yIndexByTick.has(point.chartY));
  const viewport = getViewportRect(framePoints, yTicks, xRange, yRange, xDomain);
  const displayedViewport = draftViewport?.rect ?? viewport;

  if (!selectedPoints.length) return null;

  return (
    <div
      className="rounded-md border bg-background/90 p-1.5 shadow-sm"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!viewport) return;
        setDraftViewport(startViewportDrag(event, viewport, yTicks.length));
      }}
      onMouseMove={(event) => {
        if (event.buttons !== 1 || !draftViewport) return;
        event.preventDefault();
        event.stopPropagation();
        setDraftViewport({
          ...draftViewport,
          rect: moveViewportRect(event, draftViewport),
        });
      }}
      onMouseUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const finalRect = draftViewport?.rect ?? viewport;
        const nextRange = finalRect
          ? rangesFromViewportRect(finalRect, framePoints, yTicks, xRange, yRange, xDomain)
          : null;
        if (nextRange) {
          onRangeChange(nextRange.xRange, nextRange.yRange);
        }
        setDraftViewport(null);
      }}
      onMouseLeave={(event) => {
        event.stopPropagation();
      }}
    >
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Dotted chart minimap"
        className="cursor-grab active:cursor-grabbing"
      >
        <rect
          x={PADDING}
          y={PADDING}
          width={plotWidth()}
          height={plotHeight()}
          fill="var(--muted)"
          opacity={0.35}
          rx={3}
        />
        {selectedPoints.map((point) => {
          const yIndex = yIndexByTick.get(point.chartY);
          if (yIndex === undefined) return null;
          return (
            <circle
              key={point.id}
              cx={scaleX(point.chartX, xDomain)}
              cy={scaleY(yIndex, yTicks.length)}
              r={1.2}
              fill={colorScale.get(colorGroupKey(point.colorKey, colorKeys)) ?? "var(--muted-foreground)"}
              opacity={0.62}
            />
          );
        })}
        {displayedViewport && (
          <rect
            x={displayedViewport.x}
            y={displayedViewport.y}
            width={displayedViewport.width}
            height={displayedViewport.height}
            fill="var(--ring)"
            fillOpacity={0.12}
            stroke="var(--ring)"
            strokeWidth={1.5}
            rx={2}
          />
        )}
      </svg>
    </div>
  );
});

function getViewportRect(
  points: ChartPoint[],
  yTicks: number[],
  xRange: MinimapRange,
  yRange: MinimapRange,
  xDomain: [number, number]
): ViewportRect | null {
  const startPoint = points[xRange.startIndex];
  const endPoint = points[xRange.endIndex];
  if (!startPoint || !endPoint) return null;

  const startYIndex = Math.max(0, Math.min(yTicks.length - 1, yRange.startIndex));
  const endYIndex = Math.max(startYIndex, Math.min(yTicks.length - 1, yRange.endIndex));
  const x1 = scaleX(Math.min(startPoint.chartX, endPoint.chartX), xDomain);
  const x2 = scaleX(Math.max(startPoint.chartX, endPoint.chartX), xDomain);
  const y1 = scaleY(endYIndex + 0.5, yTicks.length);
  const y2 = scaleY(startYIndex - 0.5, yTicks.length);

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.max(2, Math.abs(x2 - x1)),
    height: Math.max(2, Math.abs(y2 - y1)),
  };
}

function startViewportDrag(
  event: MouseEvent<HTMLDivElement>,
  viewport: ViewportRect,
  yTickCount: number
): DraftViewport {
  const svg = event.currentTarget.querySelector("svg");
  const rect = svg?.getBoundingClientRect();
  const localX = rect ? event.clientX - rect.left : viewport.x + viewport.width / 2;
  const localY = rect ? event.clientY - rect.top : viewport.y + viewport.height / 2;

  return {
    rect: viewport,
    pointerOffsetX: clampNumber(localX - viewport.x, 0, viewport.width),
    pointerOffsetY: clampNumber(localY - viewport.y, 0, viewport.height),
    yTickCount,
  };
}

function moveViewportRect(event: MouseEvent<HTMLDivElement>, draft: DraftViewport): ViewportRect {
  const svg = event.currentTarget.querySelector("svg");
  const rect = svg?.getBoundingClientRect();
  if (!rect) return draft.rect;

  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const width = draft.rect.width;
  const height = draft.rect.height;
  const yOverflow = minimapRowOverflow(draft.yTickCount);
  const x = clampNumber(localX - draft.pointerOffsetX, PADDING, WIDTH - PADDING - width);
  const y = clampNumber(
    localY - draft.pointerOffsetY,
    PADDING - yOverflow,
    HEIGHT - PADDING + yOverflow - height
  );

  return { x, y, width, height };
}

function rangesFromViewportRect(
  rect: ViewportRect,
  points: ChartPoint[],
  yTicks: number[],
  xRange: MinimapRange,
  yRange: MinimapRange,
  xDomain: [number, number]
): { xRange: MinimapRange; yRange: MinimapRange } | null {
  if (!points.length || !yTicks.length) return null;

  const xStartValue = unscaleX(rect.x, xDomain);
  const xEndValue = unscaleX(rect.x + rect.width, xDomain);
  const xStartIndex = nearestPointIndex(points, Math.min(xStartValue, xEndValue));
  const xEndIndex = nearestPointIndex(points, Math.max(xStartValue, xEndValue));
  const yCenterIndex = Math.round(rawIndexFromMinimapY(rect.y + rect.height / 2, yTicks.length));
  const nextYRange = edgeSnappedYRange(rect, yRange, yTicks.length) ?? moveRangeToCenter(yRange, yCenterIndex, yTicks.length);

  return {
    xRange: {
      startIndex: Math.min(xStartIndex, xEndIndex),
      endIndex: Math.max(xStartIndex, xEndIndex),
    },
    yRange: nextYRange,
  };
}

function edgeSnappedYRange(rect: ViewportRect, range: MinimapRange, yTickCount: number): MinimapRange | null {
  if (yTickCount <= 0) return { startIndex: 0, endIndex: 0 };

  const width = Math.max(0, range.endIndex - range.startIndex);
  const overflow = minimapRowOverflow(yTickCount);
  const tolerance = 0.5;

  if (rect.y + rect.height >= HEIGHT - PADDING + overflow - tolerance) {
    return {
      startIndex: 0,
      endIndex: Math.min(yTickCount - 1, width),
    };
  }

  if (rect.y <= PADDING - overflow + tolerance) {
    return {
      startIndex: Math.max(0, yTickCount - 1 - width),
      endIndex: yTickCount - 1,
    };
  }

  return null;
}

function getDomain(values: number[]): [number, number] {
  const finiteValues = values.filter(Number.isFinite);
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

function scaleX(value: number, domain: [number, number]): number {
  const [min, max] = domain;
  if (max <= min) return PADDING;
  return PADDING + ((value - min) / (max - min)) * plotWidth();
}

function unscaleX(value: number, domain: [number, number]): number {
  const [min, max] = domain;
  if (max <= min) return min;
  return min + ((value - PADDING) / plotWidth()) * (max - min);
}

function scaleY(index: number, count: number): number {
  if (count <= 1) return PADDING + plotHeight() / 2;
  return PADDING + plotHeight() - (index / (count - 1)) * plotHeight();
}

function minimapRowOverflow(count: number): number {
  if (count <= 1) return 0;
  return plotHeight() / (count - 1) / 2;
}

function rawIndexFromMinimapY(value: number, count: number): number {
  const clampedY = clampNumber(value, PADDING, HEIGHT - PADDING);
  return (1 - (clampedY - PADDING) / plotHeight()) * (count - 1);
}

function plotWidth(): number {
  return WIDTH - PADDING * 2;
}

function plotHeight(): number {
  return HEIGHT - PADDING * 2;
}

function nearestPointIndex(points: ChartPoint[], xValue: number): number {
  if (!points.length) return 0;

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.abs(point.chartX - xValue);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function moveRangeToCenter(range: MinimapRange, centerIndex: number, itemCount: number): MinimapRange {
  if (itemCount <= 0) return { startIndex: 0, endIndex: 0 };

  const width = Math.max(0, range.endIndex - range.startIndex);
  const maxStart = Math.max(0, itemCount - width - 1);
  const startIndex = clampNumber(Math.round(centerIndex - width / 2), 0, maxStart);
  return {
    startIndex,
    endIndex: Math.min(itemCount - 1, startIndex + width),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
