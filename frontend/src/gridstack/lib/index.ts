// Runtime imports (real JS values)
import { GridStackProvider } from "./grid-stack-provider_old";
import { GridStackRenderProvider } from "./grid-stack-render-provider";
import { GridStackRender } from "./grid-stack-render";
import { useGridStackContext } from "./grid-stack-context";
import { useGridStackWidgetContext } from "./grid-stack-widget-context";

// Type-only imports (compile-time only)
import type { ComponentDataType, ComponentMap } from "./grid-stack-render";

// ✅ Export runtime items normally
export {
  GridStackProvider,
  GridStackRenderProvider,
  GridStackRender,
  useGridStackContext,
  useGridStackWidgetContext,
};

// ✅ Export types separately (type-only)
export type { ComponentDataType, ComponentMap };
