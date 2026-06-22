import { useEffect, useState, type MouseEvent } from "react";

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

const WIDTH = 180;
const HEIGHT = 104;
const PADDING = 8;

export function DottedChartMinimap({
  points,
  framePoints,
  yTicks,
  colorScale,
  colorKeys,
  xRange,
  yRange,
  onRangeChange,
}: DottedChartMinimapProps) {
  const [draftRange, setDraftRange] = useState<{ xRange: MinimapRange; yRange: MinimapRange } | null>(null);

  useEffect(() => {
    setDraftRange(null);
  }, [xRange, yRange]);

  if (!points.length || !yTicks.length) return null;

  const xDomain = getDomain(points.map((point) => point.chartX));
  const yIndexByTick = new Map(yTicks.map((tick, index) => [tick, index]));
  const selectedPoints = points.filter((point) => yIndexByTick.has(point.chartY));
  const activeXRange = draftRange?.xRange ?? xRange;
  const activeYRange = draftRange?.yRange ?? yRange;
  const viewport = getViewportRect(framePoints, yTicks, activeXRange, activeYRange, xDomain);

  if (!selectedPoints.length) return null;

  return (
    <div
      className="rounded-md border bg-background/90 p-1.5 shadow-sm"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDraftRange(rangeFromMinimapPointer(event, framePoints, yTicks, xRange, yRange, xDomain));
      }}
      onMouseMove={(event) => {
        if (event.buttons !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        setDraftRange(rangeFromMinimapPointer(event, framePoints, yTicks, xRange, yRange, xDomain));
      }}
      onMouseUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextRange = draftRange ?? rangeFromMinimapPointer(event, framePoints, yTicks, xRange, yRange, xDomain);
        if (nextRange) {
          onRangeChange(nextRange.xRange, nextRange.yRange);
        }
        setDraftRange(null);
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
        {viewport && (
          <rect
            x={viewport.x}
            y={viewport.y}
            width={viewport.width}
            height={viewport.height}
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
}

function rangeFromMinimapPointer(
  event: MouseEvent<HTMLDivElement>,
  points: ChartPoint[],
  yTicks: number[],
  xRange: MinimapRange,
  yRange: MinimapRange,
  xDomain: [number, number]
): { xRange: MinimapRange; yRange: MinimapRange } | null {
  if (!points.length || !yTicks.length) return null;
  const svg = event.currentTarget.querySelector("svg");
  if (!svg) return null;

  const rect = svg.getBoundingClientRect();
  const localX = clampNumber(event.clientX - rect.left, PADDING, WIDTH - PADDING);
  const localY = clampNumber(event.clientY - rect.top, PADDING, HEIGHT - PADDING);
  const xValue = unscaleX(localX, xDomain);
  const xCenterIndex = nearestPointIndex(points, xValue);
  const yPercentFromTop = (localY - PADDING) / plotHeight();
  const yCenterIndex = Math.round((1 - yPercentFromTop) * (yTicks.length - 1));

  return {
    xRange: moveRangeToCenter(xRange, xCenterIndex, points.length),
    yRange: moveRangeToCenter(yRange, yCenterIndex, yTicks.length),
  };
}

function getViewportRect(
  points: ChartPoint[],
  yTicks: number[],
  xRange: MinimapRange,
  yRange: MinimapRange,
  xDomain: [number, number]
): { x: number; y: number; width: number; height: number } | null {
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
