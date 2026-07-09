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

export default function TotemMiner({
  fileId,
  embedded = false,
  backendBaseUrl = 'http://localhost:8000',
  height = 600,
}: TotemMinerProps) {
  const [reloadSignal, setReloadSignal] = useState(0);
  const [tau, setTau] = useState(0.5);
  const [sliderTau, setSliderTau] = useState(0.5);

  const handleReload = useCallback(() => {
    setReloadSignal((prev) => prev + 1);
  }, []);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;
  const fillContainer = height === '100%';

  const visualizerContent = (
    <TotemMinerVisualizer
      eventLogId={fileId}
      height="100%"
      backendBaseUrl={backendBaseUrl}
      reloadSignal={reloadSignal}
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
      <CardHeader className="items-center relative z-10 justify-between flex-shrink-0">
        <CardTitle>TOTeM Model</CardTitle>
        <CardAction className="flex items-center gap-4">
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
            onClick={() => {}}
            disabled={!fileId}
          >
            Check Conformance
          </Button>

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
