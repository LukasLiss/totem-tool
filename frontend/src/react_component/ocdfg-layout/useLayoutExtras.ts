/**
 * Data some layout options need beyond the DFG, loaded only while such an
 * option is selected: the inductive-miner process trees (block structure
 * "Inductive miner (log)") and the process areas (lane order "By process
 * areas").
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { getEffectiveFilterConfig, useFilterVersion } from '@/store/filterStore';
import { describeRequestError, fetchProcessAreas } from '@/react_component/variants/variantsApi';
import type { LayoutExtras, ProcessTreeJson } from './types';

export type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

interface FilterProps {
  fileId?: number;
  filterEnabled: boolean;
  localFilterParams?: Record<string, string>;
}

export function useInductiveMinerTrees({ fileId, filterEnabled, localFilterParams, enabled }: FilterProps & { enabled: boolean }) {
  const filterVersion = useFilterVersion();
  const effectiveVersion = filterEnabled ? filterVersion : 0;
  const [state, setState] = useState<LoadState<Record<string, ProcessTreeJson>>>({ status: 'idle' });
  useEffect(() => {
    if (!enabled || !fileId) {
      setState({ status: 'idle' });
      return;
    }
    const filterConfig = getEffectiveFilterConfig(localFilterParams, filterEnabled);
    if (filterConfig._noResults) {
      setState({ status: 'ready', data: {} });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    axios
      .get<{ trees: Record<string, ProcessTreeJson> }>(`/api/ocdfg-block-structure/?file_id=${fileId}`, {
        ...filterConfig,
        signal: controller.signal,
      })
      .then(({ data }) => setState({ status: 'ready', data: data.trees ?? {} }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: describeRequestError(err, 'The inductive miner failed.') });
      });
    return () => controller.abort();
  }, [enabled, fileId, filterEnabled, effectiveVersion, localFilterParams]);
  return state;
}

export function useProcessAreas({ fileId, filterEnabled, localFilterParams, enabled }: FilterProps & { enabled: boolean }) {
  const filterVersion = useFilterVersion();
  const effectiveVersion = filterEnabled ? filterVersion : 0;
  const [state, setState] = useState<LoadState<string[][]>>({ status: 'idle' });
  useEffect(() => {
    if (!enabled || !fileId) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetchProcessAreas(fileId, filterEnabled, localFilterParams)
      .then((snapshot) => {
        if (!cancelled) setState({ status: 'ready', data: snapshot.areas.map((a) => a.objectTypes) });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: describeRequestError(err, 'Process areas could not be computed.') });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, fileId, filterEnabled, effectiveVersion, localFilterParams]);
  return state;
}

/** Both of the above, as the `extras` of `computeLayout`, with their states. */
export function useLayoutExtras(
  props: FilterProps & { enabled: boolean; blockDetection: string; laneOrder: string },
) {
  const { enabled, blockDetection, laneOrder, ...filter } = props;
  const trees = useInductiveMinerTrees({ ...filter, enabled: enabled && blockDetection === 'im' });
  const areas = useProcessAreas({ ...filter, enabled: enabled && laneOrder === 'processAreas' });
  const extras: LayoutExtras = useMemo(
    () => ({
      imTrees: trees.status === 'ready' ? trees.data : undefined,
      processAreas: areas.status === 'ready' ? areas.data : undefined,
    }),
    [trees, areas],
  );
  return { extras, trees, areas };
}
