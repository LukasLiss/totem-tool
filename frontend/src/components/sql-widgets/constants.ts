/**
 * Default queries and the "expected result" shown in the SQL editor popup
 * for each SQL-driven dashboard widget.
 */

import type { ExpectedResult } from "@/react_component/SqlQueryEditor";

export const KPI_DEFAULT_QUERY = "SELECT count(*) AS value FROM events";

export const KPI_EXPECTED_RESULT: ExpectedResult = {
  description:
    "A single row with one numeric column. Only the first row is read; the column is chosen by name below (or the first column when left empty).",
  columns: ["value"],
  rows: [[12345]],
};

export const BAR_CHART_DEFAULT_QUERY =
  "SELECT activity AS label, count(*) AS value FROM events GROUP BY activity ORDER BY value DESC";

export const BAR_CHART_EXPECTED_RESULT: ExpectedResult = {
  description:
    "One row per bar: a label column (text) and a numeric value column. Rows are drawn in result order, so add an ORDER BY to control the bar order.",
  columns: ["label", "value"],
  rows: [
    ["create order", 1240],
    ["pick item", 980],
    ["ship order", 310],
  ],
};

export const SCATTER_DEFAULT_QUERY =
  "SELECT count(*) AS x, count(DISTINCT activity) AS y, obj_id AS series\nFROM event_object JOIN events USING (event_id)\nGROUP BY obj_id LIMIT 500";

export const SCATTER_EXPECTED_RESULT: ExpectedResult = {
  description:
    "One row per point: numeric x and y columns, plus an optional series column whose distinct values get their own color.",
  columns: ["x", "y", "series"],
  rows: [
    [3, 1.5, "Order"],
    [7, 4.2, "Item"],
    [12, 9.8, "Order"],
  ],
};

export const PIE_CHART_EXPECTED_RESULT: ExpectedResult = {
  description: "One row per slice: a label column (text) and a numeric value column.",
  columns: ["label", "value"],
  rows: [
    ["create order", 1240],
    ["pick item", 980],
    ["ship order", 310],
  ],
};
