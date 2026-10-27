/**
 * The dashboards of a project, fetched once however many Text Boxes ask.
 *
 * The picker shows them by name and the renderer uses the ids to tell a live
 * link from a deleted one, so six text boxes would otherwise fire six
 * identical requests. `invalidateProjectDashboards` is called from the
 * sidebar whenever a dashboard is created, renamed or deleted.
 */
import { useEffect, useState } from 'react';

import { getDashboards } from '@/api/dashboardApi';

export type ProjectDashboard = { id: number; name: string };

const cache = new Map<number, Promise<ProjectDashboard[]>>();

function load(projectId: number): Promise<ProjectDashboard[]> {
  const cached = cache.get(projectId);
  if (cached) return cached;

  const pending = getDashboards(projectId)
    .then((response: unknown) => {
      // Either a bare array or a paginated `{results: [...]}` envelope, as
      // app-sidebar.tsx also handles.
      const rows =
        Array.isArray(response)
          ? response
          : (response as { results?: unknown } | null)?.results;
      if (!Array.isArray(rows)) return [];
      return rows
        .filter(
          (row): row is ProjectDashboard =>
            typeof row === 'object' &&
            row !== null &&
            typeof (row as ProjectDashboard).id === 'number' &&
            typeof (row as ProjectDashboard).name === 'string',
        )
        .map(({ id, name }) => ({ id, name }));
    })
    .catch(() => {
      // Don't poison the cache: the next box to ask gets a fresh attempt.
      cache.delete(projectId);
      return [] as ProjectDashboard[];
    });

  cache.set(projectId, pending);
  return pending;
}

/** Drop the cached list, e.g. after a dashboard is added or deleted. */
export function invalidateProjectDashboards(projectId?: number) {
  if (projectId === undefined) cache.clear();
  else cache.delete(projectId);
}

export function useProjectDashboards(projectId: number | undefined): ProjectDashboard[] {
  const [dashboards, setDashboards] = useState<ProjectDashboard[]>([]);

  useEffect(() => {
    if (projectId === undefined) {
      setDashboards([]);
      return;
    }
    let cancelled = false;
    load(projectId).then((rows) => {
      if (!cancelled) setDashboards(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return dashboards;
}
