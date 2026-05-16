import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { mapTypesToColors } from "@/utils/objectColors";

/* ── Types ─────────────────────────────────────────────────── */
type RAMData = {
  resources: string[];
  activities: string[];
  values: number[][];   // [resource_idx][activity_idx]
};

type OrgaMiningExplorerProps = {
  fileId?: number;
  embedded?: boolean;
};

/* ── Main component ─────────────────────────────────────────── */
export default function OrgaMiningExplorer({
  fileId,
  embedded = false,
}: OrgaMiningExplorerProps) {
  const [objectTypes, setObjectTypes] = useState<string[]>([]);
  const [resourceTypes, setResourceTypes] = useState<Set<string>>(new Set());
  const [data, setData] = useState<RAMData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [hasStartedLoading, setHasStartedLoading] = useState(false);
  const hasStartedLoadingRef = useRef(false);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const fileIdRef = useRef<number | undefined>(fileId);
  useEffect(() => { fileIdRef.current = fileId; }, [fileId]);

  // Load object types when fileId changes
  useEffect(() => {
    if (!fileId) {
      setObjectTypes([]);
      setResourceTypes(new Set());
      setData(null);
      setStatus("idle");
      hasStartedLoadingRef.current = false;
      setHasStartedLoading(false);
      return;
    }

    setObjectTypes([]);
    setResourceTypes(new Set());
    setData(null);
    setStatus("idle");
    hasStartedLoadingRef.current = false;
    setHasStartedLoading(false);

    const currentFileId = fileId;
    let cancelled = false;

    (async () => {
      if (fileIdRef.current !== currentFileId) return;
      const token = localStorage.getItem("access_token");
      if (!token) { setStatus("error"); setErrorMsg("Not authenticated"); return; }
      try {
        const res = await fetch(`/api/files/${currentFileId}/object_types/`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (fileIdRef.current !== currentFileId || cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const types: string[] = await res.json();
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setObjectTypes(types);
      } catch (e: any) {
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message || "Failed to load object types");
      }
    })();

    return () => { cancelled = true; };
  }, [fileId]);

  // Compute matrix when triggered
  useEffect(() => {
    if (!fileId || !hasStartedLoadingRef.current) return;

    const currentFileId = fileId;
    const params: Record<string, string> = { file_id: String(currentFileId) };
    if (resourceTypes.size > 0) params.resource_types = [...resourceTypes].join(",");

    let cancelled = false;

    (async () => {
      if (fileIdRef.current !== currentFileId) return;
      setStatus("loading");
      setErrorMsg("");

      const token = localStorage.getItem("access_token");
      if (!token) { setStatus("error"); setErrorMsg("Not authenticated"); return; }

      try {
        const res = await fetch(`/api/resource-activity-matrix/?${new URLSearchParams(params)}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (fileIdRef.current !== currentFileId || cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const result: RAMData = await res.json();
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setData(result);
        setStatus("ready");
      } catch (e: any) {
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message || "Computation failed");
      }
    })();

    return () => { cancelled = true; };
  }, [fileId, hasStartedLoading]);

  // Lock height after data loads
  useEffect(() => {
    if (status !== "ready" || lockedHeight !== null) return;
    const id = setTimeout(() => {
      const h = resultsRef.current?.offsetHeight;
      if (h && h > 0) setLockedHeight(h);
    }, 50);
    return () => clearTimeout(id);
  }, [status, lockedHeight]);

  useEffect(() => { setLockedHeight(null); }, [data]);

  const handleCompute = () => {
    hasStartedLoadingRef.current = false;
    setHasStartedLoading(false);
    setTimeout(() => { hasStartedLoadingRef.current = true; setHasStartedLoading(true); }, 0);
  };

  const toggleResourceType = (t: string) =>
    setResourceTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const typeColorMap = mapTypesToColors(objectTypes);

  const Wrapper = embedded ? "div" : Card;

  return (
    <Wrapper className="w-full">
      {!embedded && (
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Resource-Activity Matrix</CardTitle>
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        {!fileId && (
          <p className="text-sm text-muted-foreground">Select a file to start.</p>
        )}

        {fileId && objectTypes.length > 0 && (
          <div className="flex gap-4 flex-wrap items-start">
            <TypeSelector
              title="Resource types"
              types={objectTypes}
              selected={resourceTypes}
              onToggle={toggleResourceType}
              colorMap={typeColorMap}
            />
          </div>
        )}

        {fileId && objectTypes.length > 0 && (
          <div className="flex flex-col gap-3 items-center py-4">
            <div className="text-sm text-muted-foreground text-center">
              Leave resource types empty to include all object types.
            </div>
            <Button
              onClick={handleCompute}
              disabled={status === "loading"}
              className="min-w-[200px]"
            >
              {status === "loading" ? "Computing…" : "Compute Matrix"}
            </Button>
            {status === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                Computing resource-activity matrix…
              </div>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="text-sm text-destructive">Error: {errorMsg}</div>
        )}

        {status === "ready" && data && (
          <div
            ref={resultsRef}
            className="overflow-auto rounded-md border"
            style={lockedHeight ? { maxHeight: lockedHeight } : undefined}
          >
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-muted">
                  <th className="px-3 py-2 text-left font-medium sticky left-0 bg-muted z-20 border-r whitespace-nowrap">
                    Resource
                  </th>
                  {data.activities.map(act => (
                    <th key={act} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                      {act}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.resources.map((resource, ri) => (
                  <tr key={ri} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono font-medium sticky left-0 bg-background border-r whitespace-nowrap z-10">
                      {resource}
                    </td>
                    {data.values[ri].map((val, ai) => (
                      <td key={ai} className="px-3 py-2 tabular-nums text-right">
                        {val === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          val.toFixed(3)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Wrapper>
  );
}

/* ── TypeSelector ───────────────────────────────────────────── */
function TypeSelector({
  title, types, selected, onToggle, colorMap,
}: {
  title: string;
  types: string[];
  selected: Set<string>;
  onToggle: (t: string) => void;
  colorMap: Record<string, string>;
}) {
  return (
    <div className="border rounded-md p-3 min-w-[180px]">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {types.map(t => (
          <div key={t} className="flex items-center gap-2">
            <Switch id={`ram-${title}-${t}`} checked={selected.has(t)} onCheckedChange={() => onToggle(t)} />
            <Label htmlFor={`ram-${title}-${t}`} className="text-sm cursor-pointer flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: colorMap[t] ?? "#94a3b8" }}
              />
              {t}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
