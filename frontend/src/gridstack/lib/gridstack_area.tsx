import { useContext } from "react";
import { GridContext } from "./gridstackprovider";

export function GridStackArea() {
  const { containerRef } = useContext(GridContext)!;

  return (
    <div
      className="grid-stack"
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
