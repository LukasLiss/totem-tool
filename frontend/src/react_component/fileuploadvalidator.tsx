import React, { useState, useRef, useContext } from "react";
import { fileTypeFromBlob } from "file-type";
import { uploadFile } from "../api/fileApi";
import Dropzone from 'react-dropzone';
import {useDropzone} from 'react-dropzone';
import "./component_styles/fileuploadvalidator.css";
import { Button } from "@/components/ui/button";
import { SelectedFileContext } from "../contexts/SelectedFileContext";


export function FileUploadValidator() {
    //Uploads data while checking for the right format (JSON, XML, SQLITE) using MagicNumbers and filename endings
    //Right now JSON with OR logic
    const { setSelectedFile } = useContext(SelectedFileContext);
    
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
      setSelectedFile(file)
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
    <form className=" m-6 flex flex-col" onSubmit={handleSubmit}>
      <div {...getRootProps({ className: 
        "dropzone font-sans border flex flex-col items-center justify-center max-h-[40vh] min-h-[32vw] min-w-[65vw] max-w-[70vw] rounded-xl p-6 text-center cursor-pointer transition hover:shadow-lg mx-14" })}>
        {/* hidden input so FormData works if needed */}
        <input 
          type="file"
          name="my-file"
          ref={hiddenInputRef}
          style={{ opacity: 0 }}
        />
        <input  {...getInputProps()} />
        <p className="text-lg text-primary">Click or drag and drop an OCEL file here to start a new project</p>
        {/*  <button type="button" onClick={open}>
          Open File Dialog
        </button> */}
      </div>

      <div className="flex flex-row items-center mt-5 mx-[6vw] ">    
        <div className="flex-1 px-2">
            <span>{file?.name}</span>
        </div>
        <div >
          <Button className="flex flex-wrap items-center gap-2 md:flex-row cursor-pointer transition hover:shadow-lg" type="submit">Validate & Upload</Button>
        </div>
        
      </div>

    </form>
  );
}

export default FileUploadValidator;