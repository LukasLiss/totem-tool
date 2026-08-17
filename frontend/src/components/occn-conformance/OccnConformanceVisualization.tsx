import { useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { CircleX, TriangleAlert } from "lucide-react";

import type { ProjectAsset } from "@/api/assetsApi";
import type {
  OCCNConformanceResponse,
  OCCNReplayUnitResult,
} from "@/api/occnConformanceApi";
import OCCNVisualizer from "@/react_component/OCCNVisualizer";

import {
  buildConformanceHighlights,
  canonicalOccnAssetToNet,
} from "./conformanceVisualization";

interface OccnConformanceVisualizationProps {
  asset: ProjectAsset;
  result: OCCNConformanceResponse;
  selectedUnit: OCCNReplayUnitResult | null;
}

export function OccnConformanceVisualization({
  asset,
  result,
  selectedUnit,
}: OccnConformanceVisualizationProps) {
  const model = useMemo(() => {
    try {
      return {
        net: canonicalOccnAssetToNet(asset.content_json, asset.name),
        error: null,
      };
    } catch (error) {
      return {
        net: null,
        error:
          error instanceof Error
            ? error.message
            : "The selected OCCN model could not be visualized.",
      };
    }
  }, [asset]);
  const highlights = useMemo(
    () =>
      buildConformanceHighlights(
        selectedUnit ? [selectedUnit] : result.unit_results
      ),
    [result.unit_results, selectedUnit]
  );
  const knownActivities = new Set(
    model.net?.activities.map(({ id }) => id) ?? []
  );
  const unresolvedCount = Object.keys(highlights).filter(
    (activity) => !knownActivities.has(activity)
  ).length;

  return (
    <section
      aria-label="OCCN conformance visualization"
      className="overflow-hidden rounded-md border bg-background"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Model conformance</h2>
          <p className="text-xs text-muted-foreground">
            {selectedUnit ? selectedUnit.unit_id : asset.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
            <CircleX className="size-4" /> Non-fitting stop
          </span>
          <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-4" /> State limit
          </span>
        </div>
      </header>

      {model.error ? (
        <div className="p-4 text-sm text-destructive">{model.error}</div>
      ) : (
        <div className="h-[620px]">
          <ReactFlowProvider>
            <OCCNVisualizer
              height="100%"
              data={model.net ?? undefined}
              showTitle={false}
              conformanceHighlights={highlights}
            />
          </ReactFlowProvider>
        </div>
      )}

      {unresolvedCount > 0 ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {unresolvedCount} stopping point{unresolvedCount === 1 ? " is" : "s are"}{" "}
          absent from the selected model and cannot be marked on the graph.
        </p>
      ) : null}
    </section>
  );
}
