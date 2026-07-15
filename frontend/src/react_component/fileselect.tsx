import { useEffect, useState } from "react";

import { listEventLogs, type EventLog } from "@/api/fileApi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/contexts/useWorkspace";

function FileSelect() {
  const [files, setFiles] = useState<EventLog[]>([]);
  const { selectedProject, selectedEventLog, selectEventLog } = useWorkspace();

  useEffect(() => {
    if (!selectedProject) {
      setFiles([]);
      return;
    }

    let cancelled = false;
    listEventLogs(selectedProject.id)
      .then((response) => {
        if (!cancelled) setFiles(response);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setFiles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  return (
    <Select
      value={selectedEventLog ? String(selectedEventLog.id) : ""}
      onValueChange={(value) => {
        const eventLog = files.find((file) => file.id === Number(value));
        if (eventLog) selectEventLog(eventLog);
      }}
      disabled={!selectedProject || files.length === 0}
    >
      <SelectTrigger className="w-72">
        <SelectValue placeholder="Select event log" />
      </SelectTrigger>
      <SelectContent>
        {files.map((file) => (
          <SelectItem key={file.id} value={String(file.id)}>
            {file.file.split("/").pop() || `Event log ${file.id}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default FileSelect;
