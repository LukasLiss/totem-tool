// Dashboard widget registry: component_name -> renderer.
//
// Split out of componentMap.tsx so that file can export components only —
// mixing this plain object in with the component exports there trips
// react-refresh/only-export-components (Fast Refresh can't preserve state
// across a hot reload of a module whose exports aren't all components).
import type React from "react";
import type { ComponentProps } from "./componentMap";
import {
  TextBoxComponent,
  NumberOfEventsComponent,
  ImageComponent,
  VariantsComponent,
  ProcessAreaComponent,
  TotemMinerComponent,
  LogStatisticsComponent,
  OCDottedChartComponent,
  NewOCDFGComponent,
  NewOCDFGVariantsComponent,
  OCPNComponent,
  OCCNComponent,
  SqlQueryComponent,
} from "./componentMap";
import PieChartComponent from "./PieChartComponent";
import KpiComponent from "./sql-widgets/KpiComponent";
import BarChartComponent from "./sql-widgets/BarChartComponent";
import ScatterPlotComponent from "./sql-widgets/ScatterPlotComponent";

export const componentMap: Record<string, React.FC<ComponentProps>> = {
  TextBoxComponent,
  NumberOfEventsComponent,
  ImageComponent,
  VariantsComponent,
  ProcessAreaComponent,
  TotemMinerComponent,
  LogStatisticsComponent,
  OCDottedChartComponent,
  NewOCDFGComponent,
  NewOCDFGVariantsComponent,
  OCPNComponent,
  PieChartComponent,
  OCCNComponent,
  SqlQueryComponent,
  KpiComponent: KpiComponent as unknown as React.FC<ComponentProps>,
  BarChartComponent: BarChartComponent as unknown as React.FC<ComponentProps>,
  ScatterPlotComponent: ScatterPlotComponent as unknown as React.FC<ComponentProps>,
};
