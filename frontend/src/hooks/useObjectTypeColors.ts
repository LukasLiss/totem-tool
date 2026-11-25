/**
 * Object type colors that stay the same across all views of an event log.
 *
 * A type's color is its position in the log's full, sorted list of object
 * types (see colorsFromLogTypes). Views used to number only the types they
 * showed, so a filter or a hidden type shifted the colors of the rest. The
 * list is loaded unfiltered, once per log and session, and shared by all views.
 */

import { useEffect, useMemo, useState } from "react";
import { fetchObjectTypes } from "@/react_component/variants/variantsApi";
import { colorsFromLogTypes } from "@/utils/objectColors";

// One request per log, shared by every view that asks; a failed one is retried next time.
const logTypesCache = new Map<number, Promise<string[]>>();
const loadedTypes = new Map<number, string[]>();

function loadLogTypes(fileId: number): Promise<string[]> {
  let request = logTypesCache.get(fileId);
  if (!request) {
    request = fetchObjectTypes(fileId).then(
      (types) => {
        loadedTypes.set(fileId, types);
        return types;
      },
      (error) => {
        logTypesCache.delete(fileId);
        throw error;
      },
    );
    logTypesCache.set(fileId, request);
  }
  return request;
}

/** Forget a log's object types, e.g. after its objects were edited. */
export function invalidateLogObjectTypes(fileId: number) {
  logTypesCache.delete(fileId);
  loadedTypes.delete(fileId);
}

const validId = (fileId: number | string | null | undefined): number | null => {
  const id = Number(fileId);
  return fileId != null && fileId !== "" && Number.isFinite(id) && id > 0 ? id : null;
};

/** The log's full list of object types (unfiltered); null until loaded or without a log. */
export function useLogObjectTypes(fileId: number | string | null | undefined): string[] | null {
  const id = validId(fileId);
  const [types, setTypes] = useState<{ id: number; types: string[] } | null>(() =>
    id != null && loadedTypes.has(id) ? { id, types: loadedTypes.get(id)! } : null,
  );
  useEffect(() => {
    if (id == null) return;
    let cancelled = false;
    loadLogTypes(id)
      .then((loaded) => {
        if (!cancelled) setTypes({ id, types: loaded });
      })
      // Without the list the views keep coloring by what they show.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);
  return id != null && types?.id === id ? types.types : null;
}

/**
 * Colors for the object types a view shows, stable across the log's views:
 * taken from the log's full list once it is loaded, before that (and without
 * a log) from `types` alone, as views always did.
 */
export function useObjectTypeColors(
  fileId: number | string | null | undefined,
  types: string[],
  overrides?: Record<string, string>,
): Record<string, string> {
  const logTypes = useLogObjectTypes(fileId);
  return useMemo(() => colorsFromLogTypes(types, logTypes, overrides), [types, logTypes, overrides]);
}
