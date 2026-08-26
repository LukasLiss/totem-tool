import { ViewportPortal } from '@xyflow/react';

import { nodeFallbackSize, type OccnNode } from '@/editors/occn/types';

/**
 * "+N in / +N out" chips under activities whose marker groups exceed the
 * per-side render cap (real logs reach 1000+ groups on one activity side).
 * Non-interactive; the tooltip points at the threshold slider as the way to
 * prune the net. Positioned in flow coordinates so the chips follow the node.
 */
function OccnOverflowBadges({
  nodes,
  overflow,
  cap,
}: {
  nodes: OccnNode[];
  overflow: Record<string, { img: number; omg: number }>;
  cap: number;
}) {
  const affected = nodes.filter((node) => overflow[node.id]);
  if (affected.length === 0) return null;

  const chipStyle: React.CSSProperties = {
    background: '#F1F5F9',
    border: '1px dashed #94A3B8',
    borderRadius: 9999,
    color: '#475569',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: '14px',
    padding: '1px 7px',
    whiteSpace: 'nowrap',
    pointerEvents: 'all',
  };

  const tooltip = (count: number, side: 'input' | 'output') =>
    `${count} more ${side} marker groups hidden (showing the ${cap} with the highest support). ` +
    'Raise the occurrence threshold to prune the net.';

  return (
    <ViewportPortal>
      {affected.map((node) => {
        const size = {
          width: node.measured?.width ?? nodeFallbackSize(node.data.kind).width,
          height: node.measured?.height ?? nodeFallbackSize(node.data.kind).height,
        };
        const { img, omg } = overflow[node.id];
        return (
          <div
            key={node.id}
            style={{
              position: 'absolute',
              transform: `translate(${node.position.x}px, ${node.position.y + size.height + 6}px)`,
              width: size.width,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 6,
              zIndex: 800,
            }}
          >
            {img > 0 ? (
              <span style={chipStyle} title={tooltip(img, 'input')}>{`+${img} in`}</span>
            ) : (
              <span />
            )}
            {omg > 0 && (
              <span style={chipStyle} title={tooltip(omg, 'output')}>{`+${omg} out`}</span>
            )}
          </div>
        );
      })}
    </ViewportPortal>
  );
}

export default OccnOverflowBadges;
