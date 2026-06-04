import { useEffect, useMemo, useState } from "react";
import axios from "axios";

import {
  axisOptionToParam,
  sortOptionToParam,
  type AxisOption,
  type DottedChartResponse,
  type DottedChartViewport,
  type SortOption,
} from "./dottedChartUtils";

interface UseDottedChartDataArgs {
  fileId?: number;
  xAxis: AxisOption;
  yAxis: AxisOption;
  colorBy: AxisOption;
  shapeBy: AxisOption;
  sortBy: SortOption | AxisOption;
  maxPoints?: number;
  viewport?: DottedChartViewport;
  debounceMs?: number;
}

export function useDottedChartData({
  fileId,
  xAxis,
  yAxis,
  colorBy,
  shapeBy,
  sortBy,
  maxPoints = 20_000,
  viewport,
  debounceMs = 300,
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
        sortBy,
        maxPoints,
        viewport,
      }),
    [fileId, xAxis, yAxis, colorBy, shapeBy, sortBy, maxPoints, viewport]
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
        addParam(params, "sort_by", sortOptionToParam(sortBy));
        addParam(params, "max_points", String(maxPoints));
        addParam(params, "t_min", viewport?.t_min);
        addParam(params, "t_max", viewport?.t_max);
        addParam(params, "row_min", viewport?.row_min);
        addParam(params, "row_max", viewport?.row_max);

        const response = await axios.get<DottedChartResponse>(
          `/api/files/${fileId}/oc_dotted_chart/?${params.toString()}`,
          { signal: controller.signal }
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
