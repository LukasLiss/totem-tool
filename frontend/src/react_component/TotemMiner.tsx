import { useCallback, useState } from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { RefreshCcw } from 'lucide-react';
import TotemMinerVisualizer from './TotemMinerVisualizer';

export type TotemMinerProps = {
  fileId?: number | string | null;
  embedded?: boolean;
  backendBaseUrl?: string;
  height?: string | number;
};

import { API_BASE_URL } from '../config/api';

export default function TotemMiner({
  fileId,
  embedded = false,
  backendBaseUrl = API_BASE_URL,
  height = 600,
}: TotemMinerProps) {
  const [relayoutSignal, setRelayoutSignal] = useState(0);
  const [tau, setTau] = useState(0.8);
  const [sliderTau, setSliderTau] = useState(0.8);

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
      className={`@container/card w-full flex flex-col ${fillContainer ? 'h-full rounded-none' : ''}`}
    >
      {/* Custom inline header matching thesis layout */}
      <div className="flex flex-row items-center justify-between relative z-10 flex-shrink-0 w-full px-6 py-3 border-b bg-white">
        <h3 className="text-base font-semibold leading-none tracking-tight text-slate-900">
          TOTeM Model
        </h3>
        <div className="flex items-center gap-5">
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

          <div className="w-px h-6 bg-border" />

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
        </div>
      </div>
      <CardContent
        className={`p-0 ${fillContainer ? 'flex-1 min-h-0' : ''}`}
        style={fillContainer ? undefined : { height: heightStyle }}
      >
        {visualizerContent}
      </CardContent>
    </Card>
  );
}
