import { useState, useContext, useEffect } from "react";
import { processFile } from "../api/fileApi";
import { SelectedFileContext } from "../contexts/SelectedFileContext";

export function NumberofEvents() {
    const [processedResult, setProcessedResult] = useState(null);

    const { selectedFile } = useContext(SelectedFileContext);

    useEffect(() => {
        const handleProcessFile = async () => {
            console.log("handleProcessFile");

            if (!selectedFile?.id) {
                alert("Please select a file first");
                return;
            }

            try {
                const result = await processFile(selectedFile.id);
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
