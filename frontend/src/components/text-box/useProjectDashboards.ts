/**
 * The dashboards of a project, fetched once however many Text Boxes ask.
 *
 * Every Text Box that can hold a dashboard link needs the same list: the
 * picker shows it by name, and the renderer uses it to tell a live link from
 * one whose target has since been deleted. A dashboard with six text boxes
 * would otherwise fire six identical requests on every render pass, so the
 * in-flight promise is cached per project and shared.
 *
 * The cache is module-level and deliberately small: the list changes only
 * when a dashboard is created, renamed or deleted, and `invalidate` is
 * exported for those callers. A stale name in a picker is harmless; a stale
 * *id* only ever means a link renders as plain text until the next load,
 * which is the same way a genuinely deleted dashboard behaves.
 */
import { useEffect, useState } from 'react';

import { getDashboards } from '@/api/dashboardApi';

export type ProjectDashboard = { id: number; name: string };

const cache = new Map<number, Promise<ProjectDashboard[]>>();

function load(projectId: number): Promise<ProjectDashboard[]> {
  const cached = cache.get(projectId);
  if (cached) return cached;

  const pending = getDashboards(projectId)
    .then((rows: unknown) =>
      Array.isArray(rows)
        ? rows
            .filter(
              (row): row is ProjectDashboard =>
                typeof row === 'object' &&
                row !== null &&
                typeof (row as ProjectDashboard).id === 'number' &&
                typeof (row as ProjectDashboard).name === 'string',
            )
            .map(({ id, name }) => ({ id, name }))
        : [],
    )
    .catch(() => {
      // A failed fetch must not poison the cache — the next box to ask
      // should get a fresh attempt rather than a permanently empty list.
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
