/**
 * Activities the drill-down OC-DFG of an area is computed on.
 *
 * Detailed view: every activity of the area's object types (`null`, no
 * restriction). Level-based view (the default): only the area's own
 * activities, i.e. those no lower process area claims (or the ones picked
 * by hand in a composition). A global activity filter narrows both.
 *
 * The OC-DFG is fetched for the area's object types only, so its nodes never
 * carry another area's type; the restriction therefore has to happen in the
 * request, where the backend projects the log onto these activities (which
 * also keeps the directly-follows frequencies correct).
 */
export function detailActivityRestriction(
  area: { activities: string[] },
  detailedView: boolean,
  globalActivities?: string | null,
): string[] | null {
  const global = globalActivities
    ? globalActivities.split(',').map((a) => a.trim()).filter(Boolean)
    : null;
  if (detailedView) return global;
  if (!global) return [...area.activities];
  const allowed = new Set(global);
  return area.activities.filter((a) => allowed.has(a));
}
