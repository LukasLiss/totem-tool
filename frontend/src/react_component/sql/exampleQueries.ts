/**
 * Library of example SQL queries a user can add to a project's query store.
 *
 * Every example runs against the generic OCEL tables (events, objects,
 * event_object, object_relations, object_attribute_history). Examples that
 * need a log-specific column (a materialised process execution / variant
 * column, an attribute) declare `params`; the UI asks the user to pick the
 * column and substitutes the `{{key}}` placeholders with the quoted name.
 *
 * Examples may build on other examples (`dependsOn`) by referencing them by
 * name like a table — the backend resolves stored-query references into
 * CTEs at execution time — so adding an example also adds its dependencies.
 *
 * Timestamps are epoch seconds (`timestamp_unix`); durations are reported in
 * seconds and hours.
 */

import { quoteIdentifier } from "./sqlIdentifiers";

export type ExampleParamTable = "events" | "objects";

export interface ExampleParam {
  /** placeholder key: `{{key}}` in the SQL */
  key: string;
  label: string;
  description: string;
  /** table whose columns are offered */
  table: ExampleParamTable;
}

export interface ExampleQuery {
  id: string;
  name: string;
  group: string;
  description: string;
  sql: string;
  params?: ExampleParam[];
  /** ids of examples this query references by name */
  dependsOn?: string[];
  /** result shape hint, e.g. "label/value — works with bar and pie charts" */
  shape?: string;
}

export const EXAMPLE_GROUPS = [
  "Log overview",
  "Objects & interactions",
  "Time & performance",
  "Process executions & variants",
  "Attributes",
] as const;

const EXECUTION_PARAM: ExampleParam = {
  key: "execution_column",
  label: "Process execution column",
  description:
    "Events column holding the process execution id (materialise executions from the Variants view first).",
  table: "events",
};

const VARIANT_PARAM: ExampleParam = {
  key: "variant_column",
  label: "Variant column",
  description:
    "Events column holding the variant id of each event's process execution (materialised with the executions).",
  table: "events",
};

export const EXAMPLE_QUERIES: ExampleQuery[] = [
  /* ------------------------------------------------------------ overview */
  {
    id: "log_summary",
    name: "Log summary",
    group: "Log overview",
    description:
      "One row with the number of events, activities, objects and object types plus the time span of the log.",
    shape: "single row — each column works as a KPI",
    sql: `SELECT
  (SELECT count(*) FROM events)                AS events,
  (SELECT count(DISTINCT activity) FROM events) AS activities,
  (SELECT count(*) FROM objects)               AS objects,
  (SELECT count(DISTINCT obj_type) FROM objects) AS object_types,
  (SELECT count(*) FROM event_object)          AS event_object_links,
  to_timestamp(min(timestamp_unix))            AS first_event,
  to_timestamp(max(timestamp_unix))            AS last_event,
  round((max(timestamp_unix) - min(timestamp_unix)) / 86400.0, 1) AS span_days
FROM events`,
  },
  {
    id: "events_per_activity",
    name: "Events per activity",
    group: "Log overview",
    description: "How often each activity occurs.",
    shape: "label/value — bar or pie chart",
    sql: `SELECT activity AS label, count(*) AS value
FROM events
GROUP BY activity
ORDER BY value DESC`,
  },
  {
    id: "objects_per_type",
    name: "Objects per type",
    group: "Log overview",
    description: "Number of objects of each object type.",
    shape: "label/value — bar or pie chart",
    sql: `SELECT obj_type AS label, count(*) AS value
FROM objects
GROUP BY obj_type
ORDER BY value DESC`,
  },
  {
    id: "activity_object_type_matrix",
    name: "Activity × object type matrix",
    group: "Log overview",
    description:
      "For every activity and object type: in how many events of the activity objects of that type take part, and how many object links that is in total.",
    sql: `SELECT e.activity,
       o.obj_type,
       count(DISTINCT e.event_id) AS events,
       count(*)                   AS object_links,
       round(count(*) * 1.0 / count(DISTINCT e.event_id), 2) AS objects_per_event
FROM events e
JOIN event_object eo USING (event_id)
JOIN objects o USING (obj_id)
GROUP BY e.activity, o.obj_type
ORDER BY e.activity, o.obj_type`,
  },
  {
    id: "events_per_day",
    name: "Events per day",
    group: "Log overview",
    description: "Daily event volume over the whole log.",
    shape: "label/value — bar chart (label is the day)",
    sql: `SELECT strftime(date_trunc('day', to_timestamp(timestamp_unix)), '%Y-%m-%d') AS label,
       count(*) AS value
FROM events
GROUP BY 1
ORDER BY 1`,
  },
  {
    id: "activity_time_span",
    name: "Activity time span",
    group: "Log overview",
    description: "First and last occurrence of each activity and how many events it has.",
    sql: `SELECT activity,
       count(*)                          AS events,
       to_timestamp(min(timestamp_unix)) AS first_occurrence,
       to_timestamp(max(timestamp_unix)) AS last_occurrence
FROM events
GROUP BY activity
ORDER BY first_occurrence`,
  },

  /* ---------------------------------------------------- objects & interactions */
  {
    id: "objects_per_event",
    name: "Objects per event by activity",
    group: "Objects & interactions",
    description:
      "How many objects an event of each activity involves (minimum, average, maximum) — a quick view on convergence.",
    sql: `SELECT activity,
       count(*)              AS events,
       min(n_objects)        AS min_objects,
       round(avg(n_objects), 2) AS avg_objects,
       max(n_objects)        AS max_objects
FROM (
  SELECT e.event_id, e.activity, count(eo.obj_id) AS n_objects
  FROM events e
  LEFT JOIN event_object eo USING (event_id)
  GROUP BY e.event_id, e.activity
)
GROUP BY activity
ORDER BY avg_objects DESC`,
  },
  {
    id: "events_per_object",
    name: "Events per object by type",
    group: "Objects & interactions",
    description:
      "Length of object lifecycles: how many events an object of each type takes part in (minimum, average, maximum).",
    sql: `SELECT o.obj_type,
       count(*)                 AS objects,
       min(c.n_events)          AS min_events,
       round(avg(c.n_events), 2) AS avg_events,
       max(c.n_events)          AS max_events
FROM (
  SELECT obj_id, count(*) AS n_events
  FROM event_object
  GROUP BY obj_id
) c
JOIN objects o USING (obj_id)
GROUP BY o.obj_type
ORDER BY avg_events DESC`,
  },
  {
    id: "object_type_cooccurrence",
    name: "Object type co-occurrence",
    group: "Objects & interactions",
    description:
      "Pairs of object types that take part in the same events, with the number of shared events — which types interact.",
    sql: `SELECT a.obj_type AS type_a,
       b.obj_type AS type_b,
       count(DISTINCT ea.event_id) AS shared_events
FROM event_object ea
JOIN objects a ON a.obj_id = ea.obj_id
JOIN event_object eb ON eb.event_id = ea.event_id
JOIN objects b ON b.obj_id = eb.obj_id
WHERE a.obj_type < b.obj_type
GROUP BY a.obj_type, b.obj_type
ORDER BY shared_events DESC`,
  },
  {
    id: "object_relations_by_qualifier",
    name: "Object-to-object relations",
    group: "Objects & interactions",
    description:
      "Object-to-object relations grouped by source type, target type and qualifier.",
    sql: `SELECT s.obj_type AS source_type,
       t.obj_type AS target_type,
       r.qualifier,
       count(*)   AS relations
FROM object_relations r
JOIN objects s ON s.obj_id = r.source_obj_id
JOIN objects t ON t.obj_id = r.target_obj_id
GROUP BY 1, 2, 3
ORDER BY relations DESC`,
  },
  {
    id: "event_object_qualifiers",
    name: "Event-to-object qualifiers",
    group: "Objects & interactions",
    description: "Which qualifiers link activities to object types, and how often.",
    sql: `SELECT e.activity,
       o.obj_type,
       eo.qualifier,
       count(*) AS links
FROM event_object eo
JOIN events e USING (event_id)
JOIN objects o USING (obj_id)
GROUP BY 1, 2, 3
ORDER BY links DESC`,
  },
  {
    id: "object_start_end_activities",
    name: "Start and end activities per object type",
    group: "Objects & interactions",
    description:
      "For each object type: with which activity object lifecycles start and end, and how many objects follow that pattern.",
    sql: `WITH ordered AS (
  SELECT eo.obj_id,
         e.activity,
         row_number() OVER (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id) AS rn,
         count(*)     OVER (PARTITION BY eo.obj_id) AS n
  FROM event_object eo
  JOIN events e USING (event_id)
)
SELECT o.obj_type,
       f.activity AS first_activity,
       l.activity AS last_activity,
       count(*)   AS objects
FROM ordered f
JOIN ordered l ON l.obj_id = f.obj_id AND l.rn = l.n
JOIN objects o ON o.obj_id = f.obj_id
WHERE f.rn = 1
GROUP BY 1, 2, 3
ORDER BY o.obj_type, objects DESC`,
  },

  /* ------------------------------------------------------ time & performance */
  {
    id: "object_event_sequence",
    name: "Object event sequence",
    group: "Time & performance",
    description:
      "Base query for object-centric timing: every (object, event) pair with the object's previous activity and timestamp. Other examples build on it.",
    shape: "one row per object participation — used by the waiting and synchronization queries",
    sql: `SELECT eo.obj_id,
       o.obj_type,
       e.event_id,
       e.activity,
       e.timestamp_unix,
       lag(e.activity)       OVER w AS previous_activity,
       lag(e.timestamp_unix) OVER w AS previous_timestamp_unix
FROM event_object eo
JOIN events e USING (event_id)
JOIN objects o USING (obj_id)
WINDOW w AS (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id)`,
  },
  {
    id: "waiting_time_between_activities",
    name: "Waiting time between activities",
    group: "Time & performance",
    description:
      "For each pair of consecutive activities in an object's lifecycle (per object type): how long objects wait between them.",
    dependsOn: ["object_event_sequence"],
    sql: `SELECT previous_activity AS from_activity,
       activity          AS to_activity,
       obj_type,
       count(*)          AS transitions,
       round(avg(timestamp_unix - previous_timestamp_unix) / 3600.0, 2)    AS avg_hours,
       round(median(timestamp_unix - previous_timestamp_unix) / 3600.0, 2) AS median_hours,
       round(max(timestamp_unix - previous_timestamp_unix) / 3600.0, 2)    AS max_hours
FROM "Object event sequence"
WHERE previous_activity IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY transitions DESC`,
  },
  {
    id: "synchronization_time",
    name: "Synchronization time per activity and object type",
    group: "Time & performance",
    description:
      "How long an object that was already done with its previous event had to wait for the other objects of the next event to become ready. Per activity and object type, in hours.",
    dependsOn: ["object_event_sequence"],
    sql: `WITH ready AS (
  SELECT event_id,
         activity,
         obj_id,
         obj_type,
         coalesce(previous_timestamp_unix, timestamp_unix) AS ready_unix,
         max(coalesce(previous_timestamp_unix, timestamp_unix)) OVER (PARTITION BY event_id) AS last_ready_unix
  FROM "Object event sequence"
)
SELECT activity,
       obj_type,
       count(*) AS object_participations,
       round(avg(last_ready_unix - ready_unix) / 3600.0, 2)    AS avg_sync_hours,
       round(median(last_ready_unix - ready_unix) / 3600.0, 2) AS median_sync_hours,
       round(max(last_ready_unix - ready_unix) / 3600.0, 2)    AS max_sync_hours
FROM ready
GROUP BY activity, obj_type
ORDER BY avg_sync_hours DESC`,
  },
  {
    id: "object_lifecycle_duration",
    name: "Object lifecycle duration per type",
    group: "Time & performance",
    description:
      "Time from an object's first to its last event, summarised per object type (hours).",
    sql: `SELECT o.obj_type,
       count(*) AS objects,
       round(avg(l.seconds) / 3600.0, 2)    AS avg_hours,
       round(median(l.seconds) / 3600.0, 2) AS median_hours,
       round(max(l.seconds) / 3600.0, 2)    AS max_hours
FROM (
  SELECT eo.obj_id, max(e.timestamp_unix) - min(e.timestamp_unix) AS seconds
  FROM event_object eo
  JOIN events e USING (event_id)
  GROUP BY eo.obj_id
) l
JOIN objects o USING (obj_id)
GROUP BY o.obj_type
ORDER BY avg_hours DESC`,
  },
  {
    id: "events_by_weekday_hour",
    name: "Events by weekday and hour",
    group: "Time & performance",
    description: "When events happen: count per weekday (0 = Sunday) and hour of day.",
    sql: `SELECT dayofweek(to_timestamp(timestamp_unix)) AS weekday,
       hour(to_timestamp(timestamp_unix))      AS hour,
       count(*)                                AS events
FROM events
GROUP BY 1, 2
ORDER BY 1, 2`,
  },
  {
    id: "execution_duration",
    name: "Process execution duration",
    group: "Time & performance",
    description:
      "Every process execution with its number of events, start, end and duration (first to last event).",
    params: [EXECUTION_PARAM],
    sql: `SELECT {{execution_column}} AS execution,
       count(*)                          AS events,
       count(DISTINCT activity)          AS distinct_activities,
       to_timestamp(min(timestamp_unix)) AS started,
       to_timestamp(max(timestamp_unix)) AS ended,
       max(timestamp_unix) - min(timestamp_unix)                 AS duration_s,
       round((max(timestamp_unix) - min(timestamp_unix)) / 3600.0, 2) AS duration_h
FROM events
WHERE {{execution_column}} IS NOT NULL
GROUP BY 1
ORDER BY duration_s DESC`,
  },
  {
    id: "average_execution_time",
    name: "Average process execution time",
    group: "Time & performance",
    description: "Number of process executions and their average, median, minimum and maximum duration in hours.",
    shape: "single row — each column works as a KPI",
    dependsOn: ["execution_duration"],
    params: [EXECUTION_PARAM],
    sql: `SELECT count(*)                    AS executions,
       round(avg(duration_h), 2)    AS avg_hours,
       round(median(duration_h), 2) AS median_hours,
       round(min(duration_h), 2)    AS min_hours,
       round(max(duration_h), 2)    AS max_hours
FROM "Process execution duration"`,
  },
  {
    id: "execution_duration_histogram",
    name: "Process execution duration histogram",
    group: "Time & performance",
    description: "Number of process executions per duration bucket (whole days).",
    shape: "label/value — bar chart",
    dependsOn: ["execution_duration"],
    params: [EXECUTION_PARAM],
    sql: `SELECT cast(floor(duration_h / 24) AS INTEGER) || ' d' AS label,
       count(*) AS value
FROM "Process execution duration"
GROUP BY floor(duration_h / 24)
ORDER BY floor(duration_h / 24)`,
  },

  /* --------------------------------------------- process executions & variants */
  {
    id: "variant_frequency",
    name: "Variant frequency",
    group: "Process executions & variants",
    description: "How many process executions (and events) each variant has.",
    params: [VARIANT_PARAM, EXECUTION_PARAM],
    sql: `SELECT {{variant_column}} AS variant,
       count(DISTINCT {{execution_column}}) AS executions,
       count(*)                             AS events
FROM events
WHERE {{variant_column}} IS NOT NULL
GROUP BY 1
ORDER BY executions DESC`,
  },
  {
    id: "variant_objects_per_type",
    name: "Objects per type in the first execution of each variant",
    group: "Process executions & variants",
    description:
      "For every variant: its earliest process execution and, per object type, how many objects that execution involves.",
    shape: "one row per variant and object type",
    params: [VARIANT_PARAM, EXECUTION_PARAM],
    sql: `WITH first_execution AS (
  SELECT {{variant_column}} AS variant,
         arg_min({{execution_column}}, timestamp_unix) AS execution
  FROM events
  WHERE {{variant_column}} IS NOT NULL AND {{execution_column}} IS NOT NULL
  GROUP BY 1
)
SELECT f.variant,
       f.execution,
       o.obj_type,
       count(DISTINCT o.obj_id) AS objects
FROM first_execution f
JOIN events e ON e.{{execution_column}} = f.execution
JOIN event_object eo USING (event_id)
JOIN objects o USING (obj_id)
GROUP BY 1, 2, 3
ORDER BY f.variant, o.obj_type`,
  },
  {
    id: "variant_object_profile",
    name: "Variant object profile",
    group: "Process executions & variants",
    description:
      "One row per variant with a readable summary of the objects per type in its first execution (e.g. \"items: 3, orders: 1\").",
    dependsOn: ["variant_objects_per_type"],
    params: [VARIANT_PARAM, EXECUTION_PARAM],
    sql: `SELECT variant,
       execution,
       sum(objects) AS total_objects,
       string_agg(obj_type || ': ' || objects, ', ' ORDER BY obj_type) AS objects_per_type
FROM "Objects per type in the first execution of each variant"
GROUP BY variant, execution
ORDER BY variant`,
  },
  {
    id: "execution_duration_per_variant",
    name: "Process execution duration per variant",
    group: "Process executions & variants",
    description: "Average and median duration of the process executions of each variant.",
    dependsOn: ["execution_duration"],
    params: [VARIANT_PARAM, EXECUTION_PARAM],
    sql: `SELECT v.variant,
       count(*)                       AS executions,
       round(avg(d.duration_h), 2)    AS avg_hours,
       round(median(d.duration_h), 2) AS median_hours,
       round(max(d.duration_h), 2)    AS max_hours
FROM "Process execution duration" d
JOIN (
  SELECT DISTINCT {{execution_column}} AS execution, {{variant_column}} AS variant
  FROM events
  WHERE {{execution_column}} IS NOT NULL AND {{variant_column}} IS NOT NULL
) v USING (execution)
GROUP BY v.variant
ORDER BY executions DESC`,
  },
  {
    id: "objects_per_type_per_execution",
    name: "Objects per type per execution",
    group: "Process executions & variants",
    description:
      "How many objects of each type a process execution involves on average (and at most).",
    params: [EXECUTION_PARAM],
    sql: `SELECT obj_type,
       count(*)                 AS executions_with_type,
       round(avg(objects), 2)   AS avg_objects,
       max(objects)             AS max_objects
FROM (
  SELECT e.{{execution_column}} AS execution, o.obj_type, count(DISTINCT o.obj_id) AS objects
  FROM events e
  JOIN event_object eo USING (event_id)
  JOIN objects o USING (obj_id)
  WHERE e.{{execution_column}} IS NOT NULL
  GROUP BY 1, 2
)
GROUP BY obj_type
ORDER BY avg_objects DESC`,
  },
  {
    id: "activity_frequency_per_execution",
    name: "Activity frequency per execution",
    group: "Process executions & variants",
    description:
      "How often each activity occurs within a process execution (average and maximum), and in what share of executions it occurs at all.",
    params: [EXECUTION_PARAM],
    sql: `WITH per_execution AS (
  SELECT {{execution_column}} AS execution, activity, count(*) AS n
  FROM events
  WHERE {{execution_column}} IS NOT NULL
  GROUP BY 1, 2
),
executions AS (
  SELECT count(DISTINCT {{execution_column}}) AS total FROM events WHERE {{execution_column}} IS NOT NULL
)
SELECT activity,
       count(*)                                        AS executions_with_activity,
       round(count(*) * 100.0 / (SELECT total FROM executions), 1) AS share_percent,
       round(avg(n), 2)                                AS avg_per_execution,
       max(n)                                          AS max_per_execution
FROM per_execution
GROUP BY activity
ORDER BY executions_with_activity DESC`,
  },

  /* ------------------------------------------------------------- attributes */
  {
    id: "object_attribute_summary",
    name: "Object attribute summary per type",
    group: "Attributes",
    description:
      "For one object attribute: how many objects of each type carry a value, and (if numeric) its average, minimum and maximum.",
    params: [
      {
        key: "attribute",
        label: "Object attribute",
        description: "Column of the objects table to summarise.",
        table: "objects",
      },
    ],
    sql: `SELECT obj_type,
       count(*)                                          AS objects,
       count({{attribute}})                              AS with_value,
       round(avg(try_cast({{attribute}} AS DOUBLE)), 2) AS avg_value,
       min(try_cast({{attribute}} AS DOUBLE))           AS min_value,
       max(try_cast({{attribute}} AS DOUBLE))           AS max_value
FROM objects
GROUP BY obj_type
ORDER BY obj_type`,
  },
  {
    id: "event_attribute_distribution",
    name: "Event attribute value distribution",
    group: "Attributes",
    description: "The most frequent values of one event attribute.",
    shape: "label/value — bar or pie chart",
    params: [
      {
        key: "attribute",
        label: "Event attribute",
        description: "Column of the events table to count values of.",
        table: "events",
      },
    ],
    sql: `SELECT coalesce(cast({{attribute}} AS VARCHAR), 'NULL') AS label,
       count(*) AS value
FROM events
GROUP BY 1
ORDER BY value DESC
LIMIT 100`,
  },
  {
    id: "object_attribute_changes",
    name: "Object attribute changes",
    group: "Attributes",
    description:
      "How many attribute-history rows objects of each type have — which types change their attributes over time.",
    sql: `SELECT o.obj_type,
       count(DISTINCT h.obj_id) AS objects_with_history,
       count(*)                 AS history_rows,
       round(count(*) * 1.0 / count(DISTINCT h.obj_id), 2) AS rows_per_object
FROM object_attribute_history h
JOIN objects o USING (obj_id)
GROUP BY o.obj_type
ORDER BY history_rows DESC`,
  },
];

const BY_ID = new Map(EXAMPLE_QUERIES.map((q) => [q.id, q]));

export function exampleById(id: string): ExampleQuery | undefined {
  return BY_ID.get(id);
}

/**
 * The example plus everything it depends on (transitively), dependencies
 * first, each listed once.
 */
export function withDependencies(example: ExampleQuery): ExampleQuery[] {
  const out: ExampleQuery[] = [];
  const seen = new Set<string>();
  const visit = (q: ExampleQuery) => {
    if (seen.has(q.id)) return;
    seen.add(q.id);
    for (const depId of q.dependsOn ?? []) {
      const dep = BY_ID.get(depId);
      if (dep) visit(dep);
    }
    out.push(q);
  };
  visit(example);
  return out;
}

/** distinct params (by key) required by the example and its dependencies */
export function collectParams(example: ExampleQuery): ExampleParam[] {
  const params = new Map<string, ExampleParam>();
  for (const q of withDependencies(example)) {
    for (const p of q.params ?? []) {
      if (!params.has(p.key)) params.set(p.key, p);
    }
  }
  return Array.from(params.values());
}

/** substitute `{{key}}` placeholders with quoted column identifiers */
export function renderExampleSql(sql: string, values: Record<string, string>): string {
  return sql.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const value = values[key];
    return value ? quoteIdentifier(value) : match;
  });
}

/** placeholder keys still unresolved in `sql` */
export function missingPlaceholders(sql: string): string[] {
  return Array.from(sql.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g), (m) => m[1]);
}
