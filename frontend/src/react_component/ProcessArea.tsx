import { useCallback, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCcw, SlidersHorizontal } from 'lucide-react';
import TotemVisualizer, {
  PROCESS_AREA_ALGORITHM_LABELS,
  PROCESS_AREA_PARAM_RANGES,
  type ProcessAreaAlgorithm,
  type ProcessAreaParams,
  type TotemVisualizerControls,
} from './TotemVisualizer';

export type { TotemVisualizerControls } from './TotemVisualizer';

/**
 * The five tunables of the advanced algorithm.
 *
 * `alpha` and `beta` are labelled by what they do rather than by their symbol:
 * alpha decides how hard resources are pushed above the types they serve,
 * beta how hard related types are pulled onto the same layer. Both are shown
 * with their symbol so the panel maps onto the thesis.
 */
const PARAM_CONTROLS: Array<{
  key: keyof ProcessAreaParams;
  label: string;
  hint: string;
}> = [
  { key: 'wTemporal', label: 'Temporal', hint: 'Resources outlive what they serve' },
  { key: 'wCardinality', label: 'Cardinality', hint: 'Resources serve varying numbers of objects' },
  { key: 'wDivergence', label: 'Divergence', hint: 'Resources are swapped out between executions' },
  { key: 'alpha', label: 'Separation (α)', hint: 'How strongly resources are pushed upwards' },
  { key: 'beta', label: 'Cohesion (β)', hint: 'How strongly related types are pulled together' },
];

export type ProcessAreaProps = {
  fileId?: number | string | null;
  embedded?: boolean;
  backendBaseUrl?: string;
  height?: string | number;
  /** Persisted dashboard settings, if this instance lives in a dashboard. */
  initialAlgorithm?: ProcessAreaAlgorithm;
  initialParams?: Partial<ProcessAreaParams>;
  onSettingsChange?: (settings: {
    algorithm: ProcessAreaAlgorithm;
    params: ProcessAreaParams;
  }) => void;
};

import { API_BASE_URL } from '../config/api';

export default function ProcessArea({
  fileId,
  embedded = false,
  backendBaseUrl = API_BASE_URL,
  height = 600,
  initialAlgorithm,
  initialParams,
  onSettingsChange,
}: ProcessAreaProps) {
  const [totemControls, setTotemControls] = useState<TotemVisualizerControls | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);

  const handleControlsReady = useCallback((controls: TotemVisualizerControls) => {
    setTotemControls(controls);
  }, []);

  const handleReload = useCallback(() => {
    setReloadSignal((prev) => prev + 1);
  }, []);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;
  const fillContainer = height === "100%";

  const visualizerContent = (
    <ReactFlowProvider>
      <TotemVisualizer
        eventLogId={fileId}
        height="100%"
        backendBaseUrl={backendBaseUrl}
        reloadSignal={reloadSignal}
        title="Totem Visualizer"
        embedded={true}
        onControlsReady={handleControlsReady}
        initialAlgorithm={initialAlgorithm}
        initialParams={initialParams}
        onSettingsChange={onSettingsChange}
      />
    </ReactFlowProvider>
  );

  if (embedded) {
    return (
      <div style={{ height: heightStyle }}>
        {visualizerContent}
      </div>
    );
  }

  return (
    <Card
      className={`@container/card w-full flex flex-col ${fillContainer ? 'h-full rounded-none' : ''}`}
    >
      <CardHeader className="items-center relative z-10 justify-between flex-shrink-0">
        <CardTitle>Process Area Visualizer</CardTitle>
        <CardAction className="flex items-center gap-2">
          {totemControls && (
            <>
              <Select
                value={totemControls.algorithm}
                onValueChange={(value) =>
                  totemControls.onAlgorithmChange(value as ProcessAreaAlgorithm)
                }
              >
                <SelectTrigger className="h-8 w-[230px]" aria-label="Discovery algorithm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROCESS_AREA_ALGORITHM_LABELS) as ProcessAreaAlgorithm[]).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {PROCESS_AREA_ALGORITHM_LABELS[value]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              {/* The parameters only exist for the advanced algorithm; showing
                  them next to MLPA would suggest they do something. */}
              {totemControls.algorithm === 'advanced' && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="rounded-full h-8 w-8"
                      title="Indicator weights and layering parameters"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[320px] space-y-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Resource indicators</p>
                      <p className="text-xs text-muted-foreground">
                        Which signals decide what counts as a resource, and how strongly
                        the hierarchy is pulled apart.
                      </p>
                    </div>
                    {PARAM_CONTROLS.map(({ key, label, hint }) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">{label}</Label>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {totemControls.params[key].toFixed(2)}
                          </span>
                        </div>
                        <Slider
                          {...PROCESS_AREA_PARAM_RANGES[key]}
                          value={[totemControls.params[key]]}
                          onValueChange={(values) =>
                            totemControls.onParamChange(key, values?.[0] ?? 0)
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">{hint}</p>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={totemControls.onParamsReset}
                    >
                      Reset to defaults
                    </Button>
                  </PopoverContent>
                </Popover>
              )}
              <div className="w-px h-6 bg-border" />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleReload}
            disabled={!fileId}
            className="flex items-center gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            Reload
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent
        className={`p-0 ${fillContainer ? 'flex-1 min-h-0' : ''}`}
        style={fillContainer ? undefined : { height: heightStyle }}
      >
        {visualizerContent}
      </CardContent>
    </Card>
  );
}
