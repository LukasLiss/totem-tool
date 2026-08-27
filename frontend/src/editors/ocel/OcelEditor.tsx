import { useContext, useEffect, useRef, useState } from "react";
import {
  Copy,
  Database,
  Download,
  FilePlus2,
  FileText,
  Loader2,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import {
  createEmptySession,
  createSessionFromProject,
  createSessionFromUpload,
  discardSession,
  downloadExport,
  EditorSession,
  editorErrorMessage,
  getLatex,
  getSession,
  renameSession,
  saveAsProject,
} from "@/api/ocelEditorApi";
import { EventsTab } from "./EventsTab";
import { ObjectsTab } from "./ObjectsTab";
import { RelationsTab } from "./RelationsTab";

// Remember the open session across view switches (the editor unmounts when
// the user navigates to another view). Cleared on discard.
const SESSION_STORAGE_KEY = "ocelEditorSessionId";

type TabId = "events" | "objects" | "relations";

const TABS: { id: TabId; label: string }[] = [
  { id: "events", label: "Events (E2O)" },
  { id: "objects", label: "Objects" },
  { id: "relations", label: "Relations (O2O)" },
];

function StartCard({
  icon,
  title,
  description,
  action,
  disabled,
  disabledHint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}) {
  return (
    <div className="flex w-72 flex-col items-start gap-3 rounded-xl border bg-card p-5 shadow-sm">
      <div className="rounded-lg border bg-muted/50 p-2.5">{icon}</div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
      <Button className="mt-auto" disabled={disabled} onClick={onClick}>
        {action}
      </Button>
      {disabled && disabledHint && (
        <span className="text-xs text-muted-foreground">{disabledHint}</span>
      )}
    </div>
  );
}

/**
 * OCEL editor: create, upload or copy an object-centric event log and edit
 * its events, objects and relations. The log lives as a working copy in the
 * backend (totem_lib does all the work); this component only shows paginated
 * slices and sends edits. Working copies that are never saved are discarded.
 */
export function OcelEditor() {
  const { selectedFile } = useContext(SelectedFileContext);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [resuming, setResuming] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("events");
  const [name, setName] = useState("");
  const [latexDialog, setLatexDialog] = useState<{
    table: "e2o" | "o2o";
    latex: string;
    truncated: boolean;
    rows: number;
    total: number;
  } | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resume a session left open earlier in this browser session.
  useEffect(() => {
    const storedId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedId) {
      setResuming(false);
      return;
    }
    getSession(storedId)
      .then((resumed) => {
        setSession(resumed);
        setName(resumed.name);
      })
      .catch(() => sessionStorage.removeItem(SESSION_STORAGE_KEY))
      .finally(() => setResuming(false));
  }, []);

  const openSession = (created: EditorSession) => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, created.id);
    setSession(created);
    setName(created.name);
    setTab(created.summary.num_events > 0 ? "events" : "objects");
  };

  const start = async (label: string, create: () => Promise<EditorSession>) => {
    setBusy(label);
    try {
      openSession(await create());
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const handleUploadChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    start("upload", () => createSessionFromUpload(file));
  };

  /** Re-fetch the summary so object type columns / filters stay current. */
  const refreshSummary = async () => {
    if (!session) return;
    try {
      const updated = await getSession(session.id);
      setSession(updated);
    } catch {
      // Non-fatal: the tables refresh themselves; the summary catches up on
      // the next successful call.
    }
  };

  const handleRename = async (newName: string) => {
    setName(newName);
    if (!session || !newName.trim()) return;
    try {
      await renameSession(session.id, newName.trim());
    } catch (error) {
      toast.error(editorErrorMessage(error));
    }
  };

  const handleDownload = async (fmt: "duckdb" | "sqlite" | "json" | "xml") => {
    if (!session) return;
    setBusy(`download-${fmt}`);
    try {
      await downloadExport(session.id, fmt, name);
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const handleLatex = async (table: "e2o" | "o2o") => {
    if (!session) return;
    setBusy(`latex-${table}`);
    try {
      const result = await getLatex(session.id, table);
      setLatexDialog({ table, ...result });
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const handleSaveAsProject = async () => {
    if (!session || !saveName.trim()) {
      toast.error("Please enter a project name.");
      return;
    }
    setBusy("save");
    try {
      const result = await saveAsProject(session.id, saveName.trim());
      setSaveDialogOpen(false);
      toast.success(
        `Saved as project "${result.project_name}". It is now available in your file list.`
      );
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const handleDiscard = async () => {
    if (!session) return;
    setBusy("discard");
    try {
      await discardSession(session.id);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      setSession(null);
      setDiscardOpen(false);
      toast.success("Working copy discarded.");
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  if (resuming) {
    return (
      <div className="flex w-full items-center justify-center rounded-xl border bg-card shadow-sm">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="text-center">
          <h2 className="text-lg font-semibold">OCEL Editor</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Edit an object-centric event log in a working copy: events with their
            objects (E2O), object attributes and object-to-object relations. Download
            the result or save it as a new project — unsaved working copies are
            deleted.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          <StartCard
            icon={<FilePlus2 className="size-5" />}
            title="New event log"
            description="Start from scratch with an empty log and build it up event by event."
            action={busy === "empty" ? "Creating…" : "Create empty log"}
            disabled={busy !== null}
            onClick={() => start("empty", () => createEmptySession())}
          />
          <StartCard
            icon={<Upload className="size-5" />}
            title="Upload an OCEL file"
            description="Import a .sqlite, .json, .xml, .csv or .duckdb OCEL 2.0 file and edit a copy of it."
            action={busy === "upload" ? "Importing…" : "Choose file"}
            disabled={busy !== null}
            onClick={() => fileInputRef.current?.click()}
          />
          <StartCard
            icon={<Copy className="size-5" />}
            title="Edit current project log"
            description="Work on a copy of the event log of the currently opened project. The original stays untouched."
            action={busy === "project" ? "Copying…" : "Copy & edit"}
            disabled={busy !== null || !selectedFile?.id}
            disabledHint={!selectedFile?.id ? "Select a project in the sidebar first." : undefined}
            onClick={() => start("project", () => createSessionFromProject(selectedFile.id))}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".sqlite,.db,.json,.xml,.csv,.duckdb"
          className="hidden"
          onChange={handleUploadChange}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="shrink-0 border-b px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 max-w-full">
            <div className="truncate font-semibold leading-tight">OCEL Editor</div>
            <div className="hidden truncate text-muted-foreground text-xs sm:block">
              {session.summary.num_events} events · {session.summary.num_objects} objects ·{" "}
              {session.summary.num_o2o} O2O relations
            </div>
          </div>
          <Separator orientation="vertical" className="hidden sm:block h-8" />
          <Input
            value={name}
            onChange={(event) => handleRename(event.target.value)}
            placeholder="Log name"
            aria-label="Log name"
            className="h-8 w-32 min-w-24 max-w-full flex-1 lg:w-56 lg:flex-none"
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <FileText className="size-4" />
                  <span className="max-md:sr-only">LaTeX</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export as LaTeX table</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleLatex("e2o")}>
                  E2O table (events × object types)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleLatex("o2o")}>
                  O2O table (object relations)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <Download className="size-4" />
                  <span className="max-md:sr-only">Download</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Download event log</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleDownload("duckdb")}>
                  <Database className="size-4" /> DuckDB (.duckdb)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("sqlite")}>
                  OCEL 2.0 SQLite (.sqlite)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("json")}>
                  OCEL 2.0 JSON (.json)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("xml")}>
                  OCEL 2.0 XML (.xml)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              className="h-8"
              onClick={() => {
                setSaveName(name);
                setSaveDialogOpen(true);
              }}
            >
              <Save className="size-4" />
              <span className="max-md:sr-only">Save as project</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-destructive"
              onClick={() => setDiscardOpen(true)}
            >
              <Trash2 className="size-4" />
              <span className="max-md:sr-only">Discard</span>
            </Button>
          </div>
        </div>
        <div className="mt-2 flex gap-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === entry.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "events" && (
          <EventsTab sessionId={session.id} summary={session.summary} onLogChanged={refreshSummary} />
        )}
        {tab === "objects" && (
          <ObjectsTab sessionId={session.id} summary={session.summary} onLogChanged={refreshSummary} />
        )}
        {tab === "relations" && (
          <RelationsTab sessionId={session.id} onLogChanged={refreshSummary} />
        )}
      </div>

      <Dialog open={latexDialog !== null} onOpenChange={(open) => !open && setLatexDialog(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              LaTeX {latexDialog?.table === "e2o" ? "E2O" : "O2O"} table
            </DialogTitle>
            <DialogDescription>
              {latexDialog?.truncated
                ? `Showing the first ${latexDialog.rows} of ${latexDialog.total} rows.`
                : `${latexDialog?.rows ?? 0} rows.`}{" "}
              Requires \usepackage{"{multirow}"} and \usepackage[table,xcdraw]{"{xcolor}"}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            value={latexDialog?.latex ?? ""}
            className="h-72 font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLatexDialog(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(latexDialog?.latex ?? "");
                toast.success("LaTeX copied to clipboard");
              }}
            >
              Copy to clipboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as new project</DialogTitle>
            <DialogDescription>
              Stores the current state of this log as a new project in your account
              (DuckDB format). You can keep editing afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ocel-save-name">Project name</Label>
            <Input
              id="ocel-save-name"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              placeholder="My event log"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAsProject} disabled={busy === "save"}>
              {busy === "save" ? "Saving…" : "Save project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard this working copy?</DialogTitle>
            <DialogDescription>
              The working copy and all unsaved edits are deleted permanently. Projects
              you already saved are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDiscard} disabled={busy === "discard"}>
              {busy === "discard" ? "Discarding…" : "Discard working copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default OcelEditor;
