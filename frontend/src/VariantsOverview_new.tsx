import { AppSidebar } from "@/components/app-sidebar";
import React, { useState, useContext, useEffect } from "react";
import axios from "axios";
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import VariantsExplorer, { type Variant } from "./react_component/VariantsExplorer";

import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

export function VariantsOverview() {
  const { selectedFile } = useContext(SelectedFileContext);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [status, setStatus] =
    useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const fileId = (selectedFile as any)?.id as number | undefined;

    // No file selected: reset and bail
    if (!fileId) {
      setVariants([]);
      setStatus("idle");
      setErrorMsg("");
      return;
    }

    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      setStatus("loading");
      setErrorMsg("");

      try {
        const { data: rawData } = await axios.get(`/api/variants/?file_id=${fileId}`, {
          signal: ac.signal,
        });
        const arr: Variant[] = Array.isArray(rawData) ? rawData : rawData?.variants;

        if (!cancelled) {
          const safe = Array.isArray(arr) ? arr : [];
          setVariants(safe);
          setStatus(safe.length ? "ready" : "empty");
        }
      } catch (e: any) {
        if (!cancelled && e?.name !== "AbortError") {
          setStatus("error");
          setErrorMsg(e?.message ? String(e.message) : "Unknown error.");
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [selectedFile?.id]); // only react to the chosen file's id

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <div className="p-4">
          {status === "idle" && <div>Select a file to see its variants.</div>}
          {status === "loading" && <div>Loading variants…</div>}
          {status === "error" && (
            <div style={{ color: "crimson", fontWeight: 600 }}>
              Something went wrong! {errorMsg && <span>({errorMsg})</span>}
            </div>
          )}
          {status === "empty" && <div>No variants for this file.</div>}
          {status === "ready" && <VariantsExplorer variants={variants} />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default VariantsOverview;
