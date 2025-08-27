import React, { useState, useEffect } from "react";
import { uploadFile, getUserFiles } from "../api/fileApi";

export function Dashboard() {
  const [files, setFiles] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem("access");
    getUserFiles(token).then(setFiles);
  }, []);

  // file upload handler etc.
  return (
  <div>
    <h1>Your Files</h1>
    <ul>
      {files.map(f => (
        <li key={f.id}><a href={f.file} target="_blank">{f.file}</a></li>
      ))}
    </ul>
  </div>
);

}

export default Dashboard
