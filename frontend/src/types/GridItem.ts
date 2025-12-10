export interface GridItem {
  x?: number;
  y?: number;
  w?: number;
  h?: number;

  id: string;      // required for rendering
  locked?: boolean;
  noResize?: boolean;
  minW?: number;

  component: React.ReactNode;   // React component
}
