import NewOCDFGVisualizer, { type OcdfgGraph } from './NewOCDFGVisualizer';

type OCDFGDetailVisualizerProps = {
  height?: string | number;
  data: OcdfgGraph;
  layoutDirection?: 'TB' | 'LR';
  instanceId?: string;
  typeColorOverrides?: Record<string, string>;
  onSizeChange?: (size: { width: number; height: number }) => void;
};

/**
 * The OC-DFG of one process area inside the process-area view: the graph
 * only, laid out left to right with the default OC-DFG layout, reporting its
 * size so the area's box can follow it.
 */
function OCDFGDetailVisualizer({
  height,
  data,
  layoutDirection,
  instanceId,
  typeColorOverrides,
  onSizeChange,
}: OCDFGDetailVisualizerProps) {
  return (
    <NewOCDFGVisualizer
      height={height}
      data={data}
      variant="detail"
      instanceId={instanceId}
      layoutDirection={layoutDirection ?? 'LR'}
      typeColorOverrides={typeColorOverrides}
      onSizeChange={onSizeChange}
    />
  );
}

export default OCDFGDetailVisualizer;
