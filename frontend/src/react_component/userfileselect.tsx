import { useEffect, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, FileText } from "lucide-react";

import { listEventLogs, type EventLog } from "@/api/fileApi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useWorkspace } from "@/contexts/useWorkspace";
import { cn } from "@/lib/utils";

function eventLogName(eventLog: EventLog) {
  return eventLog.file.split("/").pop() || `Event log ${eventLog.id}`;
}

function UserFileSelect() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<EventLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { selectedProject, selectedEventLog, selectEventLog } = useWorkspace();

  useEffect(() => {
    if (!selectedProject) {
      setFiles([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    listEventLogs(selectedProject.id)
      .then((response) => {
        if (!cancelled) setFiles(response);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProject, selectedEventLog?.id]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="size-5" />
          Active event log
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
              disabled={!selectedProject || isLoading}
            >
              <span className="truncate">
                {selectedEventLog
                  ? eventLogName(selectedEventLog)
                  : isLoading
                    ? "Loading event logs..."
                    : "Select event log"}
              </span>
              <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
            <Command>
              <CommandInput placeholder="Search event logs..." />
              <CommandList>
                <CommandEmpty>No event logs found.</CommandEmpty>
                <CommandGroup>
                  {files.map((file) => (
                    <CommandItem
                      key={file.id}
                      value={eventLogName(file)}
                      onSelect={() => {
                        selectEventLog(file);
                        setOpen(false);
                      }}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          selectedEventLog?.id === file.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      {eventLogName(file)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </CardContent>
    </Card>
  );
}

export default UserFileSelect;
