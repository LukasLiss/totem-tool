/**
 * Loads the OC-DFG's individual steps for the token animation while it is
 * switched on. Same file and filters as the graph, so the tokens belong to
 * the graph that is shown; it reloads when they change.
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { getEffectiveFilterConfig, useFilterVersion } from '@/store/filterStore';
import { isCancelledError } from '@/store/computationStore';
import { decodeFlows, type FlowsPayload, type Tokens } from './tokenAnimation';

export type FlowsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; tokens: Tokens; totalObjects: number }
  | { status: 'error'; message: string };

export function useOcdfgFlows({
  enabled,
  fileId,
  filterEnabled,
  localFilterParams,
  variantRanks,
}: {
  enabled: boolean;
  fileId?: number;
  filterEnabled: boolean;
  localFilterParams?: Record<string, string>;
  /** Also load each object's variant rank (variants view). */
  variantRanks: boolean;
}): FlowsState {
  const filterVersion = useFilterVersion();
  const effectiveFilterVersion = filterEnabled ? filterVersion : 0;
  const localKey = JSON.stringify(localFilterParams ?? {});
  const local = useMemo(
    () => (localKey === '{}' ? undefined : (JSON.parse(localKey) as Record<string, string>)),
    [localKey],
  );
  const [state, setState] = useState<FlowsState>({ status: 'idle' });

  useEffect(() => {
    if (!enabled || fileId == null) {
      setState({ status: 'idle' });
      return;
    }
    const filterConfig = getEffectiveFilterConfig(local, filterEnabled);
    if (filterConfig._noResults) {
      setState({
        status: 'ready',
        tokens: decodeFlows({
          activities: [],
          object_types: [],
          objects: { type: [], variant_rank: null },
          flows: { object: [], source: [], target: [], start: [], duration: [] },
          total_objects: 0,
        }),
        totalObjects: 0,
      });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: 'loading' });
    const url = `/api/new-ocdfg/flows/?file_id=${fileId}${variantRanks ? '&variant_ranks=1' : ''}`;
    axios
      .get<FlowsPayload>(url, { ...filterConfig, signal: controller.signal })
      .then(({ data }) => {
        if (cancelled) return;
        setState({ status: 'ready', tokens: decodeFlows(data), totalObjects: data.total_objects });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isCancelledError(err)) {
          toast.info('OC-DFG animation cancelled');
          setState({ status: 'error', message: 'Cancelled' });
          return;
        }
        setState({ status: 'error', message: 'The objects could not be loaded' });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, fileId, filterEnabled, effectiveFilterVersion, local, variantRanks]);

  return state;
}
