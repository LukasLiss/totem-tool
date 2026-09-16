import { useEffect, useMemo, useState } from "react";
import axios from "axios";

import {
  axisOptionToParam,
  type AxisOption,
  type DottedChartResponse,
  type DottedChartViewport,
  type RowOrderOption,
} from "./dottedChartUtils";

interface UseDottedChartDataArgs {
  fileId?: number;
  xAxis: AxisOption;
  yAxis: AxisOption;
  colorBy: AxisOption;
  shapeBy: AxisOption;
  rowOrder: RowOrderOption;
  maxPoints?: number;
  viewport?: DottedChartViewport;
  sampleSeed?: number;
  debounceMs?: number;
  filterEnabled?: boolean;
  effectiveFilterVersion?: number;
}

export function useDottedChartData({
  fileId,
  xAxis,
  yAxis,
  colorBy,
  shapeBy,
  rowOrder,
  maxPoints = 20_000,
  viewport,
  sampleSeed = 0,
  debounceMs = 300,
  filterEnabled = true,
  effectiveFilterVersion = 0,
}: UseDottedChartDataArgs) {
  const [data, setData] = useState<DottedChartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () =>
      JSON.stringify({
        fileId,
        xAxis,
        yAxis,
        colorBy,
        shapeBy,
        rowOrder,
        maxPoints,
        viewport,
        sampleSeed,
        effectiveFilterVersion,
      }),
    [fileId, xAxis, yAxis, colorBy, shapeBy, rowOrder, maxPoints, viewport, sampleSeed, effectiveFilterVersion]
  );

  useEffect(() => {
    if (!fileId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        addParam(params, "x_axis", axisOptionToParam(xAxis));
        addParam(params, "y_axis", axisOptionToParam(yAxis));
        addParam(params, "color_by", axisOptionToParam(colorBy));
        addParam(params, "shape_by", axisOptionToParam(shapeBy));
        addParam(params, "row_order", rowOrder);
        addParam(params, "max_points", String(maxPoints));
        addParam(params, "t_min", viewport?.t_min);
        addParam(params, "t_max", viewport?.t_max);
        addParam(params, "row_min", viewport?.row_min);
        addParam(params, "row_max", viewport?.row_max);
        addParam(params, "sample_seed", sampleSeed);

        const response = await axios.get<DottedChartResponse>(
          `/api/files/${fileId}/oc_dotted_chart/?${params.toString()}`,
          { signal: controller.signal, _skipGlobalFilter: !filterEnabled }
        );
        setData(response.data);
      } catch (err) {
        if (axios.isCancel(err) || controller.signal.aborted) return;
        console.error("Failed to fetch OC dotted chart data:", err);
        setError("Failed to load dotted chart");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [queryKey, debounceMs]);

  return { data, loading, error };
}

function addParam(params: URLSearchParams, key: string, value?: string | number | null) {
  if (value === undefined || value === null || value === "") return;
  params.set(key, String(value));
}
