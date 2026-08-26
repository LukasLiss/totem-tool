import { useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { CircleX, ScanSearch, TriangleAlert } from "lucide-react";

import type { ProjectAsset } from "@/api/assetsApi";
import type {
  OCCNConformanceResponse,
  OCCNReplayUnitResult,
} from "@/api/occnConformanceApi";
import { Button } from "@/components/ui/button";
import OCCNVisualizer from "@/react_component/OCCNVisualizer";

import {
  buildConformanceAnnotations,
  buildUnvisitedActivities,
  canonicalOccnAssetToNet,
} from "./conformanceVisualization";

interface OccnConformanceVisualizationProps {
  asset: ProjectAsset;
  result: OCCNConformanceResponse;
  selectedUnit: OCCNReplayUnitResult | null;
  running: boolean;
  onRunLeadingObjectType: (objectType: string) => void;
}

export function OccnConformanceVisualization({
  asset,
  result,
  selectedUnit,
  running,
  onRunLeadingObjectType,
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
  const annotations = useMemo(
    () =>
      buildConformanceAnnotations(
        selectedUnit ? [selectedUnit] : result.unit_results
      ),
    [result.unit_results, selectedUnit]
  );
  const displayedUnits = useMemo(
    () => (selectedUnit ? [selectedUnit] : result.unit_results),
    [result.unit_results, selectedUnit]
  );
  const unvisitedActivities = useMemo(
    () =>
      buildUnvisitedActivities(
        displayedUnits,
        model.net?.activities.map(({ id }) => id) ?? []
      ),
    [displayedUnits, model.net]
  );
  const highlights = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(annotations).map(([activity, annotation]) => [
          activity,
          annotation.status,
        ])
      ),
    [annotations]
  );
  const missingActivities = useMemo(
    () => {
      const knownActivities = new Set(
        model.net?.activities.map(({ id }) => id) ?? []
      );
      return Object.keys(highlights).filter(
        (activity) => !knownActivities.has(activity)
      );
    },
    [highlights, model.net]
  );
  const displayedNet = useMemo(() => {
    if (!model.net || missingActivities.length === 0) return model.net;
    return {
      ...model.net,
      activities: [
        ...model.net.activities,
        ...missingActivities.map((id) => ({ id, count: 0 })),
      ],
      input_marker_groups: {
        ...model.net.input_marker_groups,
        ...Object.fromEntries(missingActivities.map((id) => [id, []])),
      },
      output_marker_groups: {
        ...model.net.output_marker_groups,
        ...Object.fromEntries(missingActivities.map((id) => [id, []])),
      },
    };
  }, [missingActivities, model.net]);

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

      {Object.keys(annotations).length > 0 ? (
        <div
          aria-label="Replay stopping-point details"
          className="divide-y border-b bg-muted/20"
        >
          {Object.entries(annotations).map(([activity, annotation]) => {
            const nonFitting = annotation.status === "non_fitting";
            const StatusIcon = nonFitting ? CircleX : TriangleAlert;
            return (
              <div
                key={activity}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(180px,0.35fr)_1fr]"
              >
                <div
                  className={`flex min-w-0 items-center gap-2 font-medium ${
                    nonFitting
                      ? "text-red-700 dark:text-red-400"
                      : "text-amber-700 dark:text-amber-400"
                  }`}
                >
                  <StatusIcon className="size-4 shrink-0" />
                  <span className="truncate" title={activity}>
                    {activity}
                  </span>
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
                    {annotation.details.map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </div>
                  {nonFitting && annotation.objectTypes.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Inspect by leading object type:
                      </span>
                      {annotation.objectTypes.map((objectType) => (
                        <Button
                          key={objectType}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7"
                          disabled={running}
                          onClick={() => onRunLeadingObjectType(objectType)}
                        >
                          <ScanSearch className="size-3.5" />
                          {objectType}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {model.error ? (
        <div className="p-4 text-sm text-destructive">{model.error}</div>
      ) : (
        <div className="h-[620px]">
          <ReactFlowProvider>
            <OCCNVisualizer
              height="100%"
              data={displayedNet ?? undefined}
              showTitle={false}
              conformanceHighlights={highlights}
              missingConformanceActivities={missingActivities}
              unvisitedActivities={unvisitedActivities}
            />
          </ReactFlowProvider>
        </div>
      )}

      {missingActivities.length > 0 ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {missingActivities.length} stopping point
          {missingActivities.length === 1 ? " is" : "s are"} absent from the
          selected model and shown as a separate deviation node.
        </p>
      ) : null}
    </section>
  );
}
