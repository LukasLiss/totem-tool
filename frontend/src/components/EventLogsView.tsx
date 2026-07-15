import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Check, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteEventLog,
  listEventLogs,
  uploadEventLog,
  type EventLog,
} from "@/api/fileApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/contexts/useWorkspace";
import {
  EVENT_LOG_FILE_ACCEPT,
  eventLogFileType,
  validateEventLogFile,
} from "@/lib/eventLogFiles";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function eventLogName(eventLog: EventLog) {
  const filename = eventLog.file.split("/").pop();
  if (!filename) return `Event log ${eventLog.id}`;
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

export function EventLogsView() {
  const { selectedProject, selectedEventLog, selectEventLog } = useWorkspace();
  const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [eventLogToDelete, setEventLogToDelete] = useState<EventLog | null>(null);

  const loadEventLogs = useCallback(async () => {
    if (!selectedProject) {
      setEventLogs([]);
      setErrorMessage(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      setEventLogs(await listEventLogs(selectedProject.id));
    } catch (error) {
      setEventLogs([]);
      setErrorMessage(
        error instanceof Error ? error.message : "Event logs could not be loaded.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    void loadEventLogs();
  }, [loadEventLogs]);

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
            <h1 className="text-2xl font-semibold tracking-normal">Event Logs</h1>
            <UploadEventLogDialog
              projectId={selectedProject?.id}
              open={isUploadOpen}
              onOpenChange={setIsUploadOpen}
              onUploaded={loadEventLogs}
            />
          </div>

          {!selectedProject ? (
            <EmptyState
              title="No project selected"
              description="Select or create a project to manage its event logs."
            />
          ) : isLoading ? (
            <EventLogsLoadingState />
          ) : errorMessage ? (
            <ErrorState message={errorMessage} onRetry={loadEventLogs} />
          ) : eventLogs.length === 0 ? (
            <EmptyState
              title="No event logs"
              description="This project does not contain an event log yet."
            />
          ) : (
            <EventLogList
              eventLogs={eventLogs}
              selectedEventLogId={selectedEventLog?.id}
              onSelect={selectEventLog}
              onDeleteClick={setEventLogToDelete}
            />
          )}
          <DeleteEventLogDialog
            eventLog={eventLogToDelete}
            onOpenChange={(open) => {
              if (!open) setEventLogToDelete(null);
            }}
            onDeleted={async () => {
              if (eventLogToDelete?.id === selectedEventLog?.id) {
                selectEventLog(null);
              }
              setEventLogToDelete(null);
              await loadEventLogs();
            }}
          />
        </div>
      </main>
    </div>
  );
}

function EventLogList({
  eventLogs,
  selectedEventLogId,
  onSelect,
  onDeleteClick,
}: {
  eventLogs: EventLog[];
  selectedEventLogId?: number;
  onSelect: (eventLog: EventLog) => void;
  onDeleteClick: (eventLog: EventLog) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border bg-background">
      <div className="min-w-[650px]">
        <div className="grid grid-cols-[minmax(220px,1.7fr)_110px_170px_160px] border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
          <span>Name</span>
          <span>File type</span>
          <span>Last changed</span>
          <span>Actions</span>
        </div>
        <div className="divide-y">
          {eventLogs.map((eventLog) => {
            const isSelected = eventLog.id === selectedEventLogId;
            const name = eventLogName(eventLog);
            return (
              <div
                key={eventLog.id}
                className="grid grid-cols-[minmax(220px,1.7fr)_110px_170px_160px] items-center px-4 py-3 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium" title={name}>
                    {name}
                  </span>
                  {isSelected ? (
                    <Badge variant="secondary" title="Active event log for analysis">
                      In use
                    </Badge>
                  ) : null}
                </div>
                <Badge variant="secondary">{eventLogFileType(eventLog.file)}</Badge>
                <span className="text-muted-foreground">
                  {formatDate(eventLog.updated_at)}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={isSelected ? "secondary" : "outline"}
                    disabled={isSelected}
                    title="Use this event log for analysis"
                    className="w-20"
                    onClick={() => onSelect(eventLog)}
                  >
                    {isSelected ? <Check /> : null}
                    {isSelected ? "In use" : "Use"}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title={`Delete ${name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteClick(eventLog)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DeleteEventLogDialog({
  eventLog,
  onOpenChange,
  onDeleted,
}: {
  eventLog: EventLog | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const name = eventLog ? eventLogName(eventLog) : "this event log";

  const handleDelete = async () => {
    if (!eventLog) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteEventLog(eventLog.id);
      toast.success("Event log deleted");
      await onDeleted();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Event log could not be deleted.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(eventLog)}
      onOpenChange={(open) => {
        if (!open) setDeleteError(null);
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete event log</DialogTitle>
          <DialogDescription>
            Delete {eventLog ? `"${name}"` : name} from the current project.
          </DialogDescription>
        </DialogHeader>

        {deleteError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            <span>{deleteError}</span>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isDeleting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting || !eventLog}
            onClick={handleDelete}
          >
            {isDeleting ? "Deleting" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadEventLogDialog({
  projectId,
  open,
  onOpenChange,
  onUploaded,
}: {
  projectId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => Promise<void>;
}) {
  const { selectEventLog } = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setFile(null);
    setFormError(null);
    setIsSubmitting(false);
    setFileInputKey((value) => value + 1);
  };

  const closeDialog = () => {
    onOpenChange(false);
    resetForm();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) {
      setFormError("Select a project before uploading an event log.");
      return;
    }
    if (!file) {
      setFormError("Choose an event log file.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      await validateEventLogFile(file);
      const eventLog = await uploadEventLog({ projectId, file });
      selectEventLog(eventLog);
      toast.success("Event log uploaded", { description: eventLogName(eventLog) });
      closeDialog();
      await onUploaded();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Event log could not be uploaded.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" disabled={!projectId}>
          <Plus />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Upload event log</DialogTitle>
            <DialogDescription>
              Add an event log to the current project.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="event-log-file">Event log file</Label>
              <Input
                key={fileInputKey}
                id="event-log-file"
                type="file"
                accept={EVENT_LOG_FILE_ACCEPT}
                disabled={isSubmitting}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            {formError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!projectId || isSubmitting}>
              {isSubmitting ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventLogsLoadingState() {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="grid grid-cols-[minmax(220px,1.7fr)_110px_170px_160px] gap-4 border-b bg-muted/40 px-4 py-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-20" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(220px,1.7fr)_110px_170px_160px] gap-4 border-b px-4 py-3 last:border-b-0"
        >
          {Array.from({ length: 4 }).map((__, cellIndex) => (
            <Skeleton key={cellIndex} className="h-8 w-full max-w-40" />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed px-6 text-center">
      <FileText className="mb-3 size-8 text-muted-foreground" />
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-destructive/40 px-6 text-center">
      <AlertCircle className="mb-3 size-8 text-destructive" />
      <h2 className="text-base font-medium">Event logs could not be loaded</h2>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" className="mt-4" onClick={() => void onRetry()}>
        Retry
      </Button>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : DATE_FORMATTER.format(date);
}

export default EventLogsView;
