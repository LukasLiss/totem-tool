import React, { useState, useContext, useEffect } from "react";
import { processFile } from "../api/fileApi";
import { SelectedFileContext } from "../contexts/SelectedFileContext";

export function NumberofEvents() {
    const [files, setFiles] = useState([]);
    const [processedResult, setProcessedResult] = useState(null);

    const { selectedFile } = useContext(SelectedFileContext);
    
    useEffect(() => {
        const handleProcessFile = async () => {
            console.log("handleProcessFile");

            if (!selectedFile?.id) {
            alert("Please select a file first");
            return;
            }
        
            const token = localStorage.getItem("access_token");

            try {
            const result = await processFile(token, selectedFile.id);
            setProcessedResult(result);
            console.log(result);
            } catch (err) {
            console.error("Failed to process file:", err);
            }
        };

        handleProcessFile();
    }, [selectedFile]);

        return (
            <p>Number of Events: {processedResult} </p>
        )

}