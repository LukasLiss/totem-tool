import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCcw } from 'lucide-react';
import TotemMinerVisualizer from './TotemMinerVisualizer';
import { WidgetTitle } from '@/components/ui/WidgetTitle';
import { PillSlider } from '@/components/canvas/PillSlider';
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

  // The title (with the filters) on the canvas, top left, and the card's own
  // controls in the canvas' control pill: τ (applied on release), relayout, save.
  const title = (
    <WidgetTitle
      label="TOTeM Model"
      fileId={fileId}
      filterEnabled={filterEnabled}
      onToggleFilter={onToggleFilter}
      localFilterParams={localFilterParams}
      onLocalFilterChange={(params) => {
        setLocalFilterParams(params);
        onLocalFilterChange?.(params);
      }}
    />
  );
  const pillExtras = (
    <>
      <PillSlider
        label="τ"
        ariaLabel="τ"
        title="τ: the share a relation needs to be shown — applied on release"
        value={tau}
        min={0}
        max={1}
        step={0.01}
        onCommit={setTau}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleRelayout}
        disabled={!fileId}
        className="rounded-full h-9 w-9"
        title="Relayout"
        aria-label="Relayout"
      >
        <RefreshCcw className="h-4 w-4" />
      </Button>
      <SaveModelAssetButton
        fileId={fileId ?? undefined}
        filterEnabled={filterEnabled}
        modelType="TOTEM"
        params={{ tau }}
        disabled={!fileId}
        iconOnly
        className="rounded-full h-9 w-9"
      />
    </>
  );

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
      title={title}
      pillExtras={pillExtras}
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
      <CardContent
        className={`p-0 ${fillContainer ? 'flex-1 min-h-0' : ''}`}
        style={fillContainer ? undefined : { height: heightStyle }}
      >
        {visualizerContent}
      </CardContent>
    </Card>
  );
}
