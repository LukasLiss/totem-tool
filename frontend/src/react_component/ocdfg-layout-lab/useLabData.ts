/**
 * Data of the layout lab: the OC-DFG of the selected event log and, on
 * demand, the inductive-miner process trees and the process areas.
 */
import { useEffect, useState } from 'react';
import axios from 'axios';
import { getEffectiveFilterConfig, useFilterVersion } from '@/store/filterStore';
import { isCancelledError } from '@/store/computationStore';
import { describeRequestError, fetchProcessAreas } from '@/react_component/variants/variantsApi';
import { fromBackendDfg, type BackendDfg } from './graph';
import type { LabGraph, ProcessTreeJson } from './types';

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

export function useEventLogDfg({ fileId, filterEnabled, localFilterParams, enabled }: FilterProps & { enabled: boolean }) {
  const filterVersion = useFilterVersion();
  const effectiveVersion = filterEnabled ? filterVersion : 0;
  const [state, setState] = useState<LoadState<LabGraph>>({ status: 'idle' });
  useEffect(() => {
    if (!enabled || !fileId) {
      setState({ status: 'idle' });
      return;
    }
    const filterConfig = getEffectiveFilterConfig(localFilterParams, filterEnabled);
    if (filterConfig._noResults) {
      setState({ status: 'ready', data: { nodes: [], arcs: [], types: [] } });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    axios
      .get<{ dfg: BackendDfg; variant_counts?: Record<string, number> }>(`/api/new-ocdfg/?file_id=${fileId}`, {
        ...filterConfig,
        signal: controller.signal,
      })
      .then(({ data }) => setState({ status: 'ready', data: fromBackendDfg(data.dfg ?? { nodes: [], links: [] }, data.variant_counts) }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: isCancelledError(err) ? 'Computation cancelled.' : describeRequestError(err, 'The OC-DFG could not be loaded.') });
      });
    return () => controller.abort();
  }, [enabled, fileId, filterEnabled, effectiveVersion, localFilterParams]);
  return state;
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
