import { toast } from "sonner";
import { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { getUserFiles } from "../api/fileApi";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronsUpDownIcon, CheckIcon } from "lucide-react";
import { prepareLargeLogFilter } from "@/store/applyGlobalFilter";

/** What the user named the project, falling back to the event log's file name.
 * Mirrors projectLabel in components/team-switcher.tsx so a project reads the
 * same here as it does in the sidebar switcher. */
const projectLabel = (file: { display_name?: string; file?: string } | null) =>
  file?.display_name || file?.file?.split("/").pop() || "Untitled project";


function UserFileSelect() {
    const [open, setOpen] = useState(false)
    const [files, setFiles] = useState([])
    const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);
    const navigate = useNavigate()

    useEffect(() => {
        const fetchFiles = async () => {
            try {
                const response = await getUserFiles();
                setFiles(response);
            } catch {
                toast.error("Projects could not be loaded");
            }
        };

        fetchFiles();
        }, [selectedFile]);

    const handleSubmit = async () => {
        if (!selectedFile) {
            toast.warning("Please select an event log first.");
            return;
        }
        const file = files.find((f) => f.id === Number(selectedFile.id));
        if (file) {
            setSelectedFile(file);
            // Large logs get their time-range filter before the overview
            // mounts, so no view starts computing over the whole log.
            await prepareLargeLogFilter(Number(file.id));
            navigate("/overview");
        } else {
            toast.error("The selected event log is no longer available.");
        }
    };

    return(
    <Card className="flex-col w-full max-w-sm m-6">
      <CardHeader>
        <CardTitle>
          Select File to work on
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col justify-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-[300px] justify-between"
            >
              {selectedFile ? projectLabel(selectedFile) : "Select OCEL File"}
              <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0">
            <Command>
              <CommandInput placeholder="Search files..." />
              <CommandList>
                <CommandEmpty>No file found.</CommandEmpty>
                <CommandGroup>
                  {files.map((file) => (
                    <CommandItem
                      key={file.id}
                      value={`${projectLabel(file)} ${file.file}`}
                      onSelect={() => {
                        setSelectedFile(file)
                        setOpen(false);
                      }}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedFile?.id === file.id
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      {projectLabel(file)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <CardFooter className="flex-col gap-6 text-sm w-full mt-6 p-0">
          <Button className="w-full flex md:flex-row cursor-pointer transition hover:shadow-lg" onClick={handleSubmit}>
              Open File
          </Button>
        </CardFooter>
      </CardContent>
    </Card>
    )
}

export default UserFileSelect
