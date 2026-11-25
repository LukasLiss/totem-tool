/**
 * TitledTick — an axis tick drawn like Recharts' own, passed as
 * `tick={(props) => <TitledTick {...props} />}`. When the axis'
 * `tickFormatter` shortens the value, the full value shows on hover.
 */

import React from "react";
import { Text, type TextProps } from "recharts";

type TitledTickProps = TextProps & {
  payload?: { value?: unknown };
  index?: number;
  tickFormatter?: (value: unknown, index: number) => string;
};

// Recharts' Text keeps only SVG attributes, so the extra tick props
// (payload, index, ...) passed along with textProps are dropped there.
const TitledTick: React.FC<TitledTickProps> = ({ payload, index = 0, tickFormatter, ...textProps }) => {
  const full = String(payload?.value ?? "");
  const shown = tickFormatter ? tickFormatter(payload?.value, index) : full;
  return (
    <g>
      {shown !== full && <title>{full}</title>}
      <Text {...textProps}>{shown}</Text>
    </g>
  );
};

export default TitledTick;
