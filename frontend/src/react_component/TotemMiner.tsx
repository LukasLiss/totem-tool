import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { RefreshCcw } from 'lucide-react';
import TotemMinerVisualizer from './TotemMinerVisualizer';
import { WidgetHeader } from '@/components/ui/WidgetTitle';
import SaveModelAssetButton from '@/components/SaveModelAssetDialog';

export type TotemMinerProps = {
  fileId?: number | string | null;
  embedded?: boolean;
  backendBaseUrl?: string;
  height?: string | number;
  filterEnabled?: boolean;
  onToggleFilter?: () => void;
  initialLocalFilterParams?: Record<string, string>;
  onLocalFilterChange?: (params: Record<string, string>) => void;
};

import { API_BASE_URL } from '../config/api';

export default function TotemMiner({
  fileId,
  embedded = false,
  backendBaseUrl = API_BASE_URL,
  height = 600,
  filterEnabled = true,
  onToggleFilter,
  initialLocalFilterParams,
  onLocalFilterChange,
}: TotemMinerProps) {
  const [relayoutSignal, setRelayoutSignal] = useState(0);
  const [tau, setTau] = useState(0.8);
  const [sliderTau, setSliderTau] = useState(0.8);
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>(initialLocalFilterParams ?? {});

  // Follow the host's filter when it changes from outside (loaded
  // asynchronously, or reset on a project switch).
  const initialLocalFilterJson = JSON.stringify(initialLocalFilterParams ?? {});
  useEffect(() => {
    setLocalFilterParams((prev) =>
      JSON.stringify(prev) === initialLocalFilterJson ? prev : JSON.parse(initialLocalFilterJson),
    );
  }, [initialLocalFilterJson]);

  const handleRelayout = useCallback(() => {
    setRelayoutSignal((prev) => prev + 1);
  }, []);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;
  const fillContainer = height === '100%';

  const visualizerContent = (
    <TotemMinerVisualizer
      eventLogId={fileId}
      height="100%"
      backendBaseUrl={backendBaseUrl}
      relayoutSignal={relayoutSignal}
      embedded={true}
      tau={tau}
      filterEnabled={filterEnabled}
      localFilterParams={localFilterParams}
    />
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
      className={`@container/card w-full flex flex-col gap-0 py-0 overflow-hidden ${fillContainer ? 'h-full rounded-none' : ''}`}
    >
      <WidgetHeader
        label="TOTeM Model"
        fileId={fileId}
        filterEnabled={filterEnabled}
        onToggleFilter={onToggleFilter}
        localFilterParams={localFilterParams}
        onLocalFilterChange={(params) => {
          setLocalFilterParams(params);
          onLocalFilterChange?.(params);
        }}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* τ slider */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[50px] text-right">
              τ: {sliderTau.toFixed(2)}
            </span>
            <Slider
              min={0.0}
              max={1.0}
              step={0.01}
              value={[sliderTau]}
              onValueChange={(values) => setSliderTau(values?.[0] ?? 0.5)}
              onValueCommit={(values) => setTau(values?.[0] ?? 0.5)}
              className="w-[120px]"
            />
          </div>

          <div className="hidden sm:block w-px h-6 bg-border" />

          <Button
            variant="outline"
            size="sm"
            onClick={handleRelayout}
            disabled={!fileId}
            className="flex items-center gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            Relayout
          </Button>

          <SaveModelAssetButton
            fileId={fileId ?? undefined}
            filterEnabled={filterEnabled}
            modelType="TOTEM"
            params={{ tau }}
            disabled={!fileId}
          />
        </div>
      </WidgetHeader>
      <CardContent
        className={`p-0 ${fillContainer ? 'flex-1 min-h-0' : ''}`}
        style={fillContainer ? undefined : { height: heightStyle }}
      >
        {visualizerContent}
      </CardContent>
    </Card>
  );
}
