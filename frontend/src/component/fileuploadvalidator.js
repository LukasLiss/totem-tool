import React, { useState } from "react";
import { fileTypeFromBlob } from "file-type";
import { uploadFile } from "../api/fileApi";


export function FileUploadValidator() {
    //Uploads data while checking for the right format (JSON, XML, SQLITE) using MagicNumbers and filename endings
    //Right now JSON with OR logic

    const [file, setFile] = useState(null);

    
    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        setFile(selectedFile);
    };


    const handleFileUpload = async (file) => {
        const token = localStorage.getItem("access_token");
        try {
        const response = await uploadFile(file, token);
        setFile(response);
        } catch (err) {
        console.error("Upload failed:", err);}
    };


    const validateFile = async () => {
    if (!file) {
      alert("Please select a file first");
      return false;
    }

    const type = await fileTypeFromBlob(file);
    console.log("Detected type:", type); // { ext, mime }
    
    const isJson =
      type?.ext === "json" || file.name.toLowerCase().endsWith(".json");
    const isXml =
      type?.ext === "xml" && file.name.toLowerCase().endsWith(".xml");
    const isSqlite =
      (type?.ext === "sqlite" || type?.ext === "db") &&
      (file.name.toLowerCase().endsWith(".sqlite") ||
        file.name.toLowerCase().endsWith(".db"));

    if (!(isJson || isXml || isSqlite)){
        alert("Invalid file type. Please enter 'json','xml' or 'sqlite'.")
        return false;
    }
    
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const isValid = await validateFile();
    if (isValid) {
      console.log("Proceed with upload...");
      await handleFileUpload(file);
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input
        type="file"
        accept=".json,.xml,.sqlite"
        onChange={handleFileChange}
      />
      <button type="submit">Validate & Upload</button>
    </form>
  );
}

export default FileUploadValidator;