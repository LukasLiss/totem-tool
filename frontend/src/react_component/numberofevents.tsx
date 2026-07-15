import { useEffect, useState } from "react";
import { processFile } from "../api/fileApi";
import { useWorkspace } from "../contexts/useWorkspace";

export function NumberofEvents() {
    const [processedResult, setProcessedResult] = useState<number | null>(null);

    const { selectedEventLog } = useWorkspace();

    useEffect(() => {
        const handleProcessFile = async () => {
            console.log("handleProcessFile");

            if (!selectedEventLog?.id) {
                setProcessedResult(null);
                return;
            }

            try {
                const result = await processFile(selectedEventLog.id);
                setProcessedResult(result);
                console.log(result);
            } catch (err) {
                console.error("Failed to process file:", err);
            }
        };

        handleProcessFile();
    }, [selectedEventLog?.id]);

        return (
            <p>Number of Events: {processedResult} </p>
        )

}
