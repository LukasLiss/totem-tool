import { memo, useContext, useLayoutEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowDown } from "lucide-react";

import { lightenHex } from "@/editors/shared/colors";

import {
  ACTIVITY_HEIGHT,
  ACTIVITY_WIDTH,
  OccnRenderContext,
  PSEUDO_WIDTH,
  type OccnNode,
} from "./types";

const HANDLE_CLASS =
  "!size-2.5 !rounded-full !border-2 !border-white !bg-slate-400 hover:!bg-blue-600 transition-colors";

const selectedShadow =
  "0 0 0 3px rgba(37, 99, 235, 0.35), 0 12px 28px rgba(15, 23, 42, 0.18)";
const restShadow = "0 6px 18px rgba(15, 23, 42, 0.12)";

function conformanceAppearance(
  status: OccnNode["data"]["conformanceStatus"],
) {
  if (status === "non_fitting") {
    return {
      border: "3px solid #DC2626",
      shadow: "0 0 0 4px rgba(220, 38, 38, 0.2), 0 8px 22px rgba(127, 29, 29, 0.22)",
      color: "#DC2626",
      label: "Replay fails here",
    };
  }
  if (status === "inconclusive") {
    return {
      border: "3px solid #D97706",
      shadow: "0 0 0 4px rgba(217, 119, 6, 0.2), 0 8px 22px rgba(120, 53, 15, 0.2)",
      color: "#D97706",
      label: "State limit reached here",
    };
  }
  return null;
}

function ConformanceCallout({
  appearance,
  details,
}: {
  appearance: NonNullable<ReturnType<typeof conformanceAppearance>> | null;
  details?: string[];
}) {
  if (!appearance) return null;
  return (
    <div
      aria-label={appearance.label}
      style={{
        position: "absolute",
        left: "50%",
        bottom: "calc(100% + 2px)",
        zIndex: 10,
        display: "flex",
        transform: "translateX(-50%)",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          borderRadius: 4,
          background: appearance.color,
          boxShadow: "0 4px 12px rgba(15, 23, 42, 0.2)",
          color: "#FFFFFF",
          fontSize: 11,
          fontWeight: 700,
          lineHeight: "18px",
          maxWidth: 280,
          minWidth: 150,
          padding: "4px 8px",
          textAlign: "left",
          whiteSpace: "nowrap",
        }}
      >
        <div>{appearance.label}</div>
        {details?.map((detail) => (
          <div
            key={detail}
            style={{
              borderTop: "1px solid rgba(255, 255, 255, 0.3)",
              fontSize: 10,
              fontWeight: 500,
              lineHeight: "15px",
              marginTop: 3,
              overflow: "hidden",
              paddingTop: 2,
              textOverflow: "ellipsis",
            }}
            title={detail}
          >
            {detail}
          </div>
        ))}
      </div>
      <ArrowDown
        aria-hidden="true"
        color={appearance.color}
        size={24}
        strokeWidth={3}
        style={{ marginTop: -1 }}
      />
    </div>
  );
}

/** Horizontal-stripe fill, one stripe per incident object type (paper style). */
function stripeBackground(
  types: string[],
  colors: Record<string, string>,
): string {
  if (types.length === 0) return "#FFFFFF";
  const tones = types.map((type) =>
    lightenHex(colors[type] ?? "#94A3B8", 0.45),
  );
  if (tones.length === 1) return tones[0];
  const stops: string[] = [];
  const step = 100 / tones.length;
  tones.forEach((tone, index) => {
    stops.push(`${tone} ${(index * step).toFixed(2)}%`);
    stops.push(`${tone} ${((index + 1) * step).toFixed(2)}%`);
  });
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

const OccnNodeComponent = memo(function OccnNodeComponent({
  id,
  data,
  selected,
}: NodeProps<OccnNode>) {
  const { typeColors, incidentTypes } = useContext(OccnRenderContext);
  const conformance = conformanceAppearance(data.conformanceStatus);

  // Long single-token activity names (e.g. "DelegatePurchaseRequisitionApproval")
  // can't wrap and would spill past the fixed-width box. Detect the overflow so
  // we can left-align + fade only the labels that actually need it, keeping short
  // labels centered and untouched.
  const labelRef = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (el) setTruncated(el.scrollWidth > el.clientWidth + 1);
  }, [data.label]);

  if (data.kind !== "activity") {
    const color = typeColors[data.objectType ?? ""] ?? "#64748B";
    const squareSize = 48;
    return (
      <div
        className="flex flex-col items-center gap-1"
        style={{ width: PSEUDO_WIDTH }}
      >
        <Handle
          type="target"
          position={Position.Left}
          className={HANDLE_CLASS}
          style={{
            top: squareSize / 2,
            opacity: data.kind === "start" ? 0 : 1,
          }}
          isConnectable={data.kind === "end"}
        />
        <div
          data-conformance-status={data.conformanceStatus}
          style={{
            width: squareSize,
            height: squareSize,
            borderRadius: 12,
            background: color,
            border:
              conformance?.border ??
              (selected
                ? "1.5px solid rgba(37, 99, 235, 0.8)"
                : "1.5px solid rgba(15, 23, 42, 0.55)"),
            boxShadow:
              conformance?.shadow ?? (selected ? selectedShadow : restShadow),
            display: "grid",
            placeItems: "center",
            position: "relative",
          }}
        >
          <ConformanceCallout
            appearance={conformance}
            details={data.conformanceDetails}
          />
          {data.kind === "start" ? (
            <svg width={16} height={16} viewBox="0 0 16 16">
              <polygon points="3,1.5 14,8 3,14.5" fill="#FFFFFF" />
            </svg>
          ) : (
            <svg width={16} height={16} viewBox="0 0 16 16">
              <rect x={2.5} y={2.5} width={11} height={11} fill="#FFFFFF" />
            </svg>
          )}
        </div>
        <div
          className="max-w-24 truncate text-center font-semibold"
          style={{ fontSize: 10, color, lineHeight: "12px" }}
          title={data.objectType}
        >
          {data.objectType}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className={HANDLE_CLASS}
          style={{ top: squareSize / 2, opacity: data.kind === "end" ? 0 : 1 }}
          isConnectable={data.kind === "start"}
        />
      </div>
    );
  }

  const types = incidentTypes[id] ?? [];
  return (
    <div
      data-conformance-status={data.conformanceStatus}
      style={{
        width: ACTIVITY_WIDTH,
        maxWidth: ACTIVITY_WIDTH,
        minHeight: ACTIVITY_HEIGHT,
        borderRadius: 12,
        background: stripeBackground(types, typeColors),
        border:
          conformance?.border ??
          (selected
            ? "1.5px solid rgba(37, 99, 235, 0.8)"
            : types.length === 0
              ? "1.5px solid #94A3B8"
              : "1.5px solid rgba(15, 23, 42, 0.45)"),
        boxShadow:
          conformance?.shadow ?? (selected ? selectedShadow : restShadow),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 14px",
        overflow: "visible",
        position: "relative",
      }}
    >
      <ConformanceCallout
        appearance={conformance}
        details={data.conformanceDetails}
      />
      <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
      <div className="text-center" style={{ width: "100%", minWidth: 0 }}>
        <div
          ref={labelRef}
          className="font-semibold"
          title={data.label}
          style={{
            color: "#0F172A",
            fontSize: 14,
            lineHeight: 1.2,
            width: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textAlign: truncated ? "left" : "center",
            ...(truncated
              ? {
                  maskImage:
                    "linear-gradient(to right, #000 82%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to right, #000 82%, transparent 100%)",
                }
              : {}),
          }}
        >
          {data.label}
        </div>
        {data.conformanceMissingFromModel ? (
          <div
            style={{
              color: conformance?.color ?? "#DC2626",
              fontSize: 10,
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            Not in model
          </div>
        ) : data.count != null ? (
          <div style={{ color: "#0F172A", fontSize: 10, opacity: 0.75 }}>
            ×{data.count}
          </div>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={HANDLE_CLASS}
      />
    </div>
  );
});

export default OccnNodeComponent;
