import React, { useState, useContext, useEffect } from 'react';
import FileSelect from './react_component/fileselect';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import { NumberofEvents } from './react_component/numberofevents';
import './styles/processoverview.css';
import VariantsExplorer, { type Variant } from './react_component/VariantsExplorer';



export function VariantsOverview(){
  const { selectedFile } = useContext(SelectedFileContext);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [status, setStatus] =
    useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
  let cancelled = false;

  (async () => {
    const filePath = (selectedFile as any)?.file as string | undefined;
    const fileId   = (selectedFile as any)?.id as number | undefined;

    // build qs only if we have something selected
    const qs =
      fileId != null
        ? `?file_id=${fileId}`
        : filePath
          ? `?file_path=${encodeURIComponent(filePath)}`
          : "";

    setStatus("loading");
    setErrorMsg("");

    try {
      const url = `/api/variants/${qs}`; // trailing slash to match DRF
      console.debug("GET", url);

      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await res.text();
        throw new Error(`Expected JSON, got: ${text.slice(0, 120)}…`);
      }

      const data = await res.json();
      const arr: Variant[] = Array.isArray(data) ? data : data.variants;

      if (!cancelled) {
        setVariants(arr ?? []);
        setStatus(arr && arr.length ? "ready" : "empty");
      }
    } catch (e: any) {
      if (!cancelled) {
        setStatus("error");
        setErrorMsg(e?.message ? String(e.message) : "Unknown error while loading variants.");
      }
    }
  })();

  return () => { cancelled = true; };
  }, [selectedFile]);

  useEffect(() => {
    if (status === "ready") {
        const v0 = variants?.[0];
        console.debug("[VariantsOverview] count =", variants.length);
        console.debug("[VariantsOverview] first variant =", v0);
        if (v0?.graph) {
        console.debug("[VariantsOverview] nodes =", v0.graph.nodes?.length,
                        "edges =", v0.graph.edges?.length,
                        "objects =", v0.graph.objects?.length);
        // quick sanity on node ids & objectIds
        const badNode = v0.graph.nodes?.find(n => !n?.id || !Array.isArray(n?.objectIds));
        if (badNode) {
            console.warn("[VariantsOverview] BAD NODE SHAPE:", badNode);
        }
        } else {
        console.warn("[VariantsOverview] Missing graph in first variant");
        }
    }
    }, [status, variants]);

  return (
    <div className="overview_main_div">
      <div className="header_bar">
        <div className="ov_fs"><FileSelect /></div>
        <div className="tabs">TabsTabsTabs</div>
      </div>

      <div className="filter_bar">
        <div className="ov_filter">Filterfilter</div>
        <div className="ov_exp_log"><button className="exp_log_button">Export Log</button></div>
      </div>

      <div className="oceldisplay">
        <div className="ov_ocelwindow">
          {selectedFile ? (
            <p>Currently selected: {String((selectedFile as any).file || (selectedFile as any).name || "").split("/").pop()}</p>
          ) : (
            <p>No file selected</p>
          )}

          <NumberofEvents />

          {status === "loading" && <div>Loading variants…</div>}
          {status === "error" && <div style={{ color: "crimson", fontWeight: 600 }}>
            Something went wrong! {errorMsg && <span>({errorMsg})</span>}
          </div>}
          {status === "empty" && <div>No variants.</div>}
          {status === "ready" && <VariantsExplorer variants={variants} />}
        </div>

        <div className="ov_ocelparams">Mmhh parameter</div>
      </div>
    </div>
  );
}

export default VariantsOverview;
