import React, { useState, useRef } from "react";
import { fileTypeFromBlob } from "file-type";
import { uploadFile } from "../api/fileApi";
import Dropzone from 'react-dropzone'
import {useDropzone} from 'react-dropzone';

export function FileUploadValidator() {
    //Uploads data while checking for the right format (JSON, XML, SQLITE) using MagicNumbers and filename endings
    //Right now JSON with OR logic

    const [file, setFile] = useState(null);
    const hiddenInputRef = useRef(null);

    const {getRootProps, getInputProps, open, acceptedFiles} = useDropzone({
      onDrop: (incomingFiles) => {
        if (hiddenInputRef.current) {
          const dataTransfer = new DataTransfer();
          incomingFiles.forEach((v) => {
            dataTransfer.items.add(v);
          });
          hiddenInputRef.current.files = dataTransfer.files;
        }
        setFile(incomingFiles[0]);
      },
      multiple: false,
    });
    
    //Validation

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

  // Upload

  const handleFileUpload = async () => {
    const token = localStorage.getItem("access_token");
    try {
      const response = await uploadFile(file, token);
      console.log("Upload success:", response);
      alert("Upload successful!");
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed");
    }
  };


 const handleSubmit = async (e) => {
    e.preventDefault();
    const isValid = await validateFile();
    if (isValid) {
      await handleFileUpload();
    }
 };

  const files = acceptedFiles.map(file => (
    <li key={file.path}>
      {file.path} - {file.size} bytes
    </li>
  ));



  return (
    <form onSubmit={handleSubmit}>
      <div {...getRootProps({ className: "dropzone" })}>
        {/* hidden input so FormData works if needed */}
        <input
          type="file"
          name="my-file"
          ref={hiddenInputRef}
          style={{ opacity: 0 }}
        />
        <input {...getInputProps()} />
        <p>Drag 'n' drop a file here, or click to select one</p>
        <button type="button" onClick={open}>
          Open File Dialog
        </button>
      </div>

      <aside>
        <h4>Selected File</h4>
        <ul>{files}</ul>
      </aside>

      <button type="submit">Validate & Upload</button>
    </form>
  );
}

export default FileUploadValidator;