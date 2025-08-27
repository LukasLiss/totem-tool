import React, { useRef } from "react";

export function FileUploadButton({ onFileSelect }) {
  const fileInputRef = useRef();

  const handleButtonClick = () => {
    fileInputRef.current.click(); 
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(file);
    }
  };

  return (
    <div>
      <button type="button" onClick={handleButtonClick}>
        Upload File
      </button>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </div>
  );
}

export default FileUploadButton;
