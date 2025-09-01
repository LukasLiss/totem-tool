import React, { useState } from "react";
import { getUserFiles, processFile } from "../api/fileApi";


export function FileLoader() {
  const [files, setFiles] = useState([]); // initialize as empty array
  const [showDropdown, setShowDropdown] = useState(false); // control dropdown visibility
  const [selectedFiles, setSelectedFiles] = useState(null);
  const [processedResult, setProcessedResult] = useState(null);

  const handleFileLoad = async () => {
    const token = localStorage.getItem("access_token")
    try {
      const response = await getUserFiles(token); // fetch user files
      setFiles(response);
      setShowDropdown(true); // show dropdown after loading
    } catch (err) {
      console.error("Loading user files failed:", err);
    }
  };

  const handleSelectChange = (e) => {
      const fileId = e.target.value; // value will be the file id
      const fileObj = files.find((f) => String(f.id) === fileId);
      setSelectedFile(fileObj);
    };
  
   const handleProcessFile = async () => {
    if (!selectedFileId) {
      alert("Please select a file first");
      return;
    }

    try {
      const result = await processFile(token, selectedFileId);
      setProcessedResult(result);
    } catch (err) {
      console.error("Failed to process file:", err);
    }
  };

  return (
    
       <div style={{ padding: "1rem" }}>
      <button onClick={handleFileLoad}>Load My Files</button>

      {files.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <select
            value={selectedFileId}
            onChange={(e) => setSelectedFileId(e.target.value)}
          >
            <option value="">-- Select a file --</option>
            {files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.file_name || file.file} {/* depending on your backend */}
              </option>
            ))}
          </select>

          <button onClick={handleProcessFile} style={{ marginLeft: "0.5rem" }}>
            Process File
          </button>
        </div>
      )}

      {processedResult && (
        <div style={{ marginTop: "1rem", padding: "0.5rem", border: "1px solid #ccc" }}>
          <h4>Processed Result:</h4>
          <pre>{JSON.stringify(processedResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}