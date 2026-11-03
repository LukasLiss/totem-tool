/**
 * Dashboard widget for object-centric alignments.
 *
 * Edit mode: dashboard-level switches (settings panel in view mode, compute
 * automatically) followed by the preselection — OCPN model, process
 * execution source and the execution itself. View mode hosts the explorer
 * with that preselection; changes made there are not persisted.
 */
import { useCallback, useEffect, useState } from "react";
import type { GridStackNode } from "gridstack";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GlobalFilterToggle } from "@/components/ui/GlobalFilterToggle";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { ComponentProps } from "../componentMap";
import { useExecutions, useLogOptions, useOcpnAssets } from "./hooks";
import { OCAlignmentExplorer } from "./OCAlignmentExplorer";
import { OCAlignmentSettingsPanel } from "./OCAlignmentSettingsPanel";
import { settingsFromNode, settingsToNode, sourceBlocker, type OCAlignmentSettings } from "./settings";

function SettingSwitch({ id, label, hint, checked, onChange }: {
  id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function EditForm({
  node,
  onUpdate,
  fileId,
  projectId,
}: {
  node: ComponentProps["node"];
  onUpdate?: ComponentProps["onUpdate"];
  fileId: number | null;
  projectId: number | null;
}) {
  const persisted = JSON.stringify(settingsToNode(settingsFromNode(node)));
  const [settings, setSettings] = useState<OCAlignmentSettings>(() => settingsFromNode(node));
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [automaticLoading, setAutomaticLoading] = useState(node.automatic_loading ?? false);
  useEffect(() => setSettings(settingsFromNode(JSON.parse(persisted))), [persisted]);
  useEffect(() => setShowControls(node.show_controls ?? true), [node.show_controls]);
  useEffect(() => setAutomaticLoading(node.automatic_loading ?? false), [node.automatic_loading]);

  const assets = useOcpnAssets(projectId);
  const options = useLogOptions(fileId);
  const executions = useExecutions(fileId, settings, true);
  const update = (next: OCAlignmentSettings) => {
    setSettings(next);
    onUpdate?.(settingsToNode(next) as Partial<GridStackNode>);
  };
  const id = `oc-alignment-${node.component_id}`;

  return (
    <Card className="h-full w-full overflow-y-auto rounded-none text-left">
      <CardHeader>
        <CardTitle>Object-Centric Alignment Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Aligns one process execution with an object-centric Petri net and shows the synchronous, log and
          model moves. Object types of the execution that the model does not contain are ignored.
        </p>
        <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dashboard</p>
        <SettingSwitch
          id={`${id}-controls`}
          label="Show settings in view mode"
          hint="Lets viewers pick another model or execution (not saved)."
          checked={showControls}
          onChange={(v) => {
            setShowControls(v);
            onUpdate?.({ show_controls: v });
          }}
        />
        <SettingSwitch
          id={`${id}-auto`}
          label="Compute automatically"
          hint="Compute the preselected alignment when the dashboard opens."
          checked={automaticLoading}
          onChange={(v) => {
            setAutomaticLoading(v);
            onUpdate?.({ automatic_loading: v });
          }}
        />
        <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Preselected alignment
        </p>
        <OCAlignmentSettingsPanel
          settings={settings}
          onChange={update}
          assets={assets.assets}
          assetsLoading={assets.loading}
          assetsError={assets.error}
          objectTypes={options.objectTypes}
          activities={options.activities}
          columns={options.columns}
          optionsLoading={options.loading}
          processAreas={options.processAreas}
          areasLoading={options.areasLoading}
          areasError={options.areasError}
          onComputeAreas={() => void options.computeAreas()}
          executions={executions.data}
          executionsLoading={executions.loading}
          executionsError={executions.error}
          executionsBlocker={fileId ? sourceBlocker(settings) : "Select an event log first."}
          onRetryExecutions={executions.retry}
          compact
        />
      </CardContent>
    </Card>
  );
}

export const OCAlignmentComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const fileId = selectedFile?.id && selectedFile.id > 0 ? selectedFile.id : null;
  const projectId =
    typeof selectedFile?.project === "number" && selectedFile.project > 0 ? selectedFile.project : null;
  const persisted = JSON.stringify(settingsToNode(settingsFromNode(node)));
  const [settings, setSettings] = useState<OCAlignmentSettings>(() => settingsFromNode(node));
  const [filterEnabled, setFilterEnabled] = useState(true);
  useEffect(() => setSettings(settingsFromNode(JSON.parse(persisted))), [persisted]);
  const onSettingsChange = useCallback((next: OCAlignmentSettings) => setSettings(next), []);

  if (isEditMode) {
    return <EditForm node={node} onUpdate={onUpdate} fileId={fileId} projectId={projectId} />;
  }

  const showControls = node.show_controls ?? true;
  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-background p-3 text-left">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">Object-Centric Alignment</span>
        <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={() => setFilterEnabled((v) => !v)} stopPropagation />
      </div>
      <OCAlignmentExplorer
        key={`${persisted}|${fileId}|${filterEnabled}`}
        fileId={fileId}
        projectId={projectId}
        settings={settings}
        onSettingsChange={onSettingsChange}
        showControls={showControls}
        autoStart={node.automatic_loading ?? false}
        filterEnabled={filterEnabled}
        compact
        graphHeight={showControls ? 380 : "fill"}
      />
    </div>
  );
};

export default OCAlignmentComponent;
