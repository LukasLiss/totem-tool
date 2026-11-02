import { useCallback, useEffect, useRef, useState } from "react";

import { extractAssetApiError, listAssets, type ProjectAsset } from "@/api/assetsApi";
import { getEventLogEventColumns, type EventColumnInfo } from "@/api/occnConformanceApi";
import {
  computeOCAlignment,
  describeOCAlignmentError,
  listOCAlignmentExecutions,
  type OCAlignmentExecutionsResponse,
  type OCAlignmentResponse,
} from "@/api/ocAlignmentApi";
import { fetchActivities, fetchObjectTypes, fetchProcessAreas } from "@/react_component/variants/variantsApi";
import { useProcessAreaStore, useProcessAreasForFile } from "@/store/processAreaStore";

import { alignmentBlocker, sourceBlocker, sourceKey, sourceRequest, type OCAlignmentSettings } from "./settings";

/** OCPN model assets of the project, newest first. */
export function useOcpnAssets(projectId: number | null | undefined) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setAssets([]);
    setError(null);
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    listAssets({ projectId, assetType: "OCPN" })
      .then((result) => {
        if (cancelled) return;
        const list = (Array.isArray(result) ? result : [])
          .filter((asset) => asset.asset_type === "OCPN" && asset.project === projectId)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.name.localeCompare(b.name));
        setAssets(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(extractAssetApiError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reload]);

  return { assets, loading, error, retry: useCallback(() => setReload((n) => n + 1), []) };
}

/** Object types, activities, stored execution columns and process areas of a log. */
export function useLogOptions(fileId: number | null | undefined, enabled = true) {
  const [objectTypes, setObjectTypes] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [columns, setColumns] = useState<EventColumnInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const processAreas = useProcessAreasForFile(fileId);
  const [areasLoading, setAreasLoading] = useState(false);
  const [areasError, setAreasError] = useState<string | null>(null);

  useEffect(() => {
    setObjectTypes([]);
    setActivities([]);
    setColumns([]);
    setError(null);
    if (!fileId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchObjectTypes(fileId),
      fetchActivities(fileId),
      getEventLogEventColumns(fileId).catch(() => [] as EventColumnInfo[]),
    ])
      .then(([types, acts, cols]) => {
        if (cancelled) return;
        setObjectTypes(types);
        setActivities(acts);
        setColumns(cols);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeOCAlignmentError(err, "The log's object types could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, enabled]);

  const computeAreas = useCallback(async () => {
    if (!fileId) return;
    setAreasLoading(true);
    setAreasError(null);
    try {
      const snapshot = await fetchProcessAreas(fileId, true);
      useProcessAreaStore.getState().publish(snapshot);
    } catch (err) {
      setAreasError(describeOCAlignmentError(err, "Process areas could not be computed."));
    } finally {
      setAreasLoading(false);
    }
  }, [fileId]);

  return {
    objectTypes,
    activities,
    columns,
    loading,
    error,
    processAreas,
    areasLoading,
    areasError,
    computeAreas,
  };
}

/**
 * The process executions of the current source, reloaded (debounced) when the
 * source, the model or the log changes.
 */
export function useExecutions(
  fileId: number | null | undefined,
  settings: OCAlignmentSettings,
  filterEnabled: boolean,
) {
  const [data, setData] = useState<OCAlignmentExecutionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const key = sourceKey(settings);
  const blocker = sourceBlocker(settings);
  const latest = useRef(settings);
  latest.current = settings;

  useEffect(() => {
    setData(null);
    setError(null);
    if (!fileId || blocker) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      listOCAlignmentExecutions(fileId, sourceRequest(latest.current), latest.current.assetId, {
        signal: controller.signal,
        filterEnabled,
      })
        .then((response) => {
          if (!controller.signal.aborted) setData(response);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) {
            setError(describeOCAlignmentError(err, "The process executions could not be loaded."));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `key` covers the source fields; the model only adds annotations.
  }, [fileId, key, blocker, settings.assetId, filterEnabled, reload]);

  return { data, loading, error, retry: useCallback(() => setReload((n) => n + 1), []) };
}

/** Running the alignment, with cancellation of a superseded request. */
export function useAlignmentRun(fileId: number | null | undefined, filterEnabled: boolean) {
  const [result, setResult] = useState<OCAlignmentResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (settings: OCAlignmentSettings) => {
      if (!fileId || alignmentBlocker(settings) || !settings.assetId) return;
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setRunning(true);
      setError(null);
      try {
        const response = await computeOCAlignment(
          fileId,
          settings.assetId,
          sourceRequest(settings),
          settings.executionId,
          {
            maxStates: settings.maxStates,
            timeoutS: settings.timeoutS,
            signal: current.signal,
            filterEnabled,
          },
        );
        if (controller.current === current) setResult(response);
      } catch (err) {
        if (controller.current === current) {
          setResult(null);
          setError(describeOCAlignmentError(err, "The alignment could not be computed."));
        }
      } finally {
        if (controller.current === current) setRunning(false);
      }
    },
    [fileId, filterEnabled],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setResult(null);
    setError(null);
  }, []);

  return { result, running, error, run, reset };
}
