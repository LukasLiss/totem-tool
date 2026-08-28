import { useEffect, useState } from "react";
import axios from "axios";

export type DottedChartOptionKind = "time" | "categorical" | "none";

export type DottedChartOption = {
  label: string;
  value: string;
  kind: DottedChartOptionKind;
};

export type DottedChartOptions = {
  x_axis: DottedChartOption[];
  y_axis: DottedChartOption[];
  color_by: DottedChartOption[];
  shape_by: DottedChartOption[];
};

export const DEFAULT_DOTTED_CHART_OPTIONS: DottedChartOptions = {
  x_axis: [
    { label: "Time", value: "time", kind: "time" },
    { label: "Timestamp", value: "timestamp", kind: "time" },
    { label: "Timestamp (Unix)", value: "timestamp_unix", kind: "time" },
    { label: "Since Start", value: "since_start", kind: "time" },
  ],
  y_axis: [{ label: "Activity", value: "activity", kind: "categorical" }],
  color_by: [
    { label: "None", value: "none", kind: "none" },
    { label: "Activity", value: "activity", kind: "categorical" },
  ],
  shape_by: [
    { label: "None", value: "none", kind: "none" },
    { label: "Activity", value: "activity", kind: "categorical" },
  ],
};

export function useDottedChartOptions(fileId?: number) {
  const [options, setOptions] = useState<DottedChartOptions>(DEFAULT_DOTTED_CHART_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) {
      setOptions(DEFAULT_DOTTED_CHART_OPTIONS);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    axios
      .get<DottedChartOptions>(`/api/files/${fileId}/oc_dotted_chart_columns/`, {
        signal: controller.signal,
        _skipGlobalFilter: true,
      })
      .then((response) => setOptions(response.data))
      .catch((err) => {
        if (axios.isCancel(err) || controller.signal.aborted) return;
        console.error("Failed to fetch OC dotted chart options:", err);
        setOptions(DEFAULT_DOTTED_CHART_OPTIONS);
        setError("Failed to load chart options");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [fileId]);

  return { options, loading, error };
}
