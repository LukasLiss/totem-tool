import React, { useState, useContext, useEffect } from 'react';
import FileSelect from './component/fileselect';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import { NumberofEvents } from './component/numberofevents';
import './styles/processoverview.css';

import VariantsExplorer from "./component/VariantsExplorer.jsx";
const API_BASE = process.env.REACT_APP_API_BASE || "";


export function ProcessOverview() {
  const { selectedFile } = useContext(SelectedFileContext);

  // local API base (leave empty if Django serves the SPA)
  const API_BASE = process.env.REACT_APP_API_BASE || "";

  const [variants, setVariants] = useState([]);
  const [status, setStatus] = useState("idle"); // 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // If no file is selected yet, show message and skip fetching
      if (!selectedFile?.file) {
        setVariants([]);
        setStatus("empty");
        return;
      }

      setStatus("loading");
      setError(null);

      try {
        const fullPath = selectedFile.file;
        const fileName = fullPath.split("/").pop();
        const q = `?file_name=${encodeURIComponent(fileName)}&file_path=${encodeURIComponent(fullPath)}`;

        const res = await fetch(`${API_BASE}/api/variants${q}`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const arr = Array.isArray(data) ? data : data.variants;

        if (!cancelled) {
          setVariants(arr || []);
          setStatus(arr && arr.length ? "ready" : "empty");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setStatus("error");
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [selectedFile]);

  return (
    <div className="overview_main_div">
      <div className="header_bar">
        <div className="ov_fs">
          <FileSelect />
        </div>
        <div className="tabs">TabsTabsTabs</div>
      </div>

      <div className="filter_bar">
        <div className="ov_filter">Filterfilter</div>
        <div className="ov_exp_log">
          <button className="exp_log_button">Export Log</button>
        </div>
      </div>

      <div className="oceldisplay">
        <div className="ov_ocelwindow">
          {selectedFile ? (
            <p>Currently selected: {selectedFile.file.split("/").pop()}</p>
          ) : (
            <p>No file selected</p>
          )}
          <NumberofEvents />

          {status === "loading" && <div>Loading variants…</div>}
          {status === "error" && (
            <div style={{ color: "crimson" }}>
              Failed to load variants: {String(error?.message || error)}
            </div>
          )}
          {status === "empty" && <div>No variants.</div>}
          {status === "ready" && <VariantsExplorer variants={variants} />}
        </div>

        <div className="ov_ocelparams">Mmhh parameter</div>
      </div>
    </div>
  );
}

export default ProcessOverview;
           