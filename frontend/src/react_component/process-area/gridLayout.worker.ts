import { prepareGridLayout, type GridEdge, type GridLayer } from './gridLayout';

// Computes one process-area grid layout off the main thread (`useGridLayout`).
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ layers: GridLayer[]; edges: GridEdge[] }>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  scope.postMessage(prepareGridLayout(event.data.layers, event.data.edges));
};
