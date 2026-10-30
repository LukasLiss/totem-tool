/**
 * LogStatisticsSettingsDialog — the log statistics widget's settings in the
 * same popup as the chart widgets: which statistics to show (counts and
 * time), beside a draft of the cards. The widget has no title and no query,
 * so there are no Title field and no Data tab. Changes are kept as a draft
 * and only reach the widget on Apply.
 */

import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ChartSettingsDialog, ChartSettingsLayout, SettingRow } from "@/components/sql-widgets/chartSettings";
import LogStatisticsSketch from "./LogStatisticsSketch";
import { LOG_STATISTICS, type LogStatisticsSelection } from "./logStatisticsUtils";

const GROUPS = [
  { group: "counts", heading: "Counts" },
  { group: "time", heading: "Time" },
] as const;

/** The dialog body; mounted on every open, so the draft starts from the applied settings. */
function SettingsBody({ widgetId, initial, onApply, onCancel }: {
  widgetId: number;
  initial: LogStatisticsSelection;
  onApply: (selection: LogStatisticsSelection) => void;
  onCancel: () => void;
}) {
  const idPrefix = `log-statistics-${widgetId}`;
  const [draft, setDraft] = useState(initial);

  return (
    <ChartSettingsLayout
      heading="Log statistics settings"
      idPrefix={idPrefix}
      onApply={() => onApply(draft)}
      onCancel={onCancel}
      styleTab={GROUPS.map(({ group, heading }) => (
        <div key={group} className="space-y-1 pb-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{heading}</p>
          {LOG_STATISTICS.filter((stat) => stat.group === group).map((stat) => (
            <SettingRow key={stat.key} label={stat.settingLabel} htmlFor={`${idPrefix}-${stat.key}`}>
              <Switch
                id={`${idPrefix}-${stat.key}`}
                checked={draft[stat.key]}
                onCheckedChange={(checked) => setDraft((d) => ({ ...d, [stat.key]: checked }))}
              />
            </SettingRow>
          ))}
        </div>
      ))}
      sketch={<LogStatisticsSketch selection={draft} className="aspect-[4/3] w-full max-w-xs md:max-w-md" />}
      sketchHint="Layout preview: one card per selected statistic. Grey bars stand in for the values; the real statistics are shown when you leave edit mode."
    />
  );
}

const LogStatisticsSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: number;
  selection: LogStatisticsSelection;
  onApply: (selection: LogStatisticsSelection) => void;
}> = ({ open, onOpenChange, widgetId, selection, onApply }) => (
  <ChartSettingsDialog open={open} onOpenChange={onOpenChange}>
    <SettingsBody
      widgetId={widgetId}
      initial={selection}
      onApply={(next) => {
        onApply(next);
        onOpenChange(false);
      }}
      onCancel={() => onOpenChange(false)}
    />
  </ChartSettingsDialog>
);

export default LogStatisticsSettingsDialog;
