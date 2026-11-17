/**
 * SqlTableSettingsDialog — the SQL editor widget's settings in the same
 * popup as the chart widgets: Title (the table's name) and the query, beside
 * a draft of the result table; there are no style settings, so no tabs. The
 * rows per page are chosen with the page selector in the full SQL editor
 * (the query field's expand icon), as before in the widget. Changes are kept
 * as a draft and only reach the widget on Apply.
 */

import React, { useState } from "react";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { useColumnDiscovery, discoveryKey } from "@/components/sql-widgets/sqlWidgetUtils";
import {
  ChartDataTab,
  ChartSettingsDialog,
  ChartSettingsLayout,
} from "@/components/sql-widgets/chartSettings";
import { useDiscoverOnOpen } from "@/components/sql-widgets/chartSettingsUtils";
import SqlTableSketch from "./SqlTableSketch";

export interface SqlTableSettings {
  name: string;
  query: string;
  linked: LinkedQuery | null;
  /** Rows per page, set with the SQL editor's page selector. */
  rowLimit: number;
}

/** The dialog body; mounted on every open, so the draft starts from the applied settings. */
function SettingsBody({ widgetId, initial, onApply, onCancel, fileId, projectId }: {
  widgetId: number;
  initial: SqlTableSettings;
  onApply: (settings: SqlTableSettings) => void;
  onCancel: () => void;
  fileId?: number;
  projectId?: number;
}) {
  const idPrefix = `sql-table-${widgetId}`;
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof SqlTableSettings>(key: K, value: SqlTableSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // The result's column names for the draft: from opening the popup,
  // "Detect columns" or a run in the SQL editor, for the current query only.
  const discovery = useColumnDiscovery(fileId, draft.query, draft.linked?.id);
  useDiscoverOnOpen(discovery, fileId, initial.query, initial.linked);
  const columns =
    discovery.resultFor === discoveryKey(draft.query, draft.linked?.id) ? discovery.columns : undefined;

  return (
    <ChartSettingsLayout
      heading="SQL editor settings"
      idPrefix={idPrefix}
      title={draft.name}
      onTitleChange={(name) => set("name", name)}
      titlePlaceholder="SQL query"
      onApply={() => onApply(draft)}
      onCancel={onCancel}
      dataTab={
        <ChartDataTab
          widgetId={widgetId}
          idPrefix={idPrefix}
          query={draft.query}
          onQueryChange={(q) => set("query", q)}
          linked={draft.linked}
          onLinkChange={(l) => set("linked", l)}
          columnFields={[]}
          fileId={fileId}
          projectId={projectId}
          editorTitle="SQL query"
          discovery={discovery}
          // The page selector in the full SQL editor sets the rows per page.
          rowLimit={draft.rowLimit}
          onRowLimitChange={(n) => set("rowLimit", n)}
        />
      }
      sketch={
        <SqlTableSketch
          name={draft.name}
          linked={Boolean(draft.linked)}
          columns={columns}
          rowsPerPage={draft.rowLimit}
          className="w-full max-w-xs md:max-w-md"
        />
      }
      sketchHint="Layout preview of the result table: the column names once the query has run and grey bars for the values. Rows load a page at a time, the next one automatically as soon as the end of the table is in view."
    />
  );
}

const SqlTableSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: number;
  settings: SqlTableSettings;
  onApply: (settings: SqlTableSettings) => void;
  fileId?: number;
  projectId?: number;
}> = ({ open, onOpenChange, widgetId, settings, onApply, fileId, projectId }) => (
  <ChartSettingsDialog open={open} onOpenChange={onOpenChange}>
    <SettingsBody
      widgetId={widgetId}
      initial={settings}
      onApply={(next) => {
        onApply(next);
        onOpenChange(false);
      }}
      onCancel={() => onOpenChange(false)}
      fileId={fileId}
      projectId={projectId}
    />
  </ChartSettingsDialog>
);

export default SqlTableSettingsDialog;
