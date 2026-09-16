import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { lightenHex } from "@/editors/shared/colors";

import {
  TOTEM_NODE_HEIGHT,
  TOTEM_NODE_WIDTH,
} from "./visualizationLayout";
import type { TotemConformanceNodeType } from "./visualizationFlow";

const TotemConformanceNode = memo(function TotemConformanceNode({
  data,
  selected,
}: NodeProps<TotemConformanceNodeType>) {
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-md border px-3 py-2 text-center shadow-sm"
      style={{
        width: TOTEM_NODE_WIDTH,
        minHeight: TOTEM_NODE_HEIGHT,
        background: lightenHex(data.color, 0.91),
        borderColor: selected ? "#2563EB" : "rgba(15, 23, 42, 0.16)",
        boxShadow: selected
          ? "0 0 0 2px rgba(37, 99, 235, 0.22)"
          : "0 2px 5px rgba(15, 23, 42, 0.08)",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="pointer-events-none !h-0 !w-0 !border-0 !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="pointer-events-none !h-0 !w-0 !border-0 !opacity-0"
      />
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: data.color }}
      />
      <span className="break-words text-sm font-semibold leading-tight text-slate-950">
        {data.name}
      </span>
    </div>
  );
});

export default TotemConformanceNode;
