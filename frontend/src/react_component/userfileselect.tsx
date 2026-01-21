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


function UserFileSelect() {
    const [open, setOpen] = useState(false)
    const [files, setFiles] = useState([])
    const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);
    const navigate = useNavigate()

    useEffect(() => {
        const fetchFiles = async () => {
            const token = localStorage.getItem("access_token");
            try {
            if (!token) {
                    console.error("No token found!");
                  }
            const response = await getUserFiles(token);
            console.log("Fetched files:", response);
            setFiles(response);
            console.log("files",files)
            } catch (error: any) {
              if (error.message === "UNAUTHORIZED") {
                navigate("/login", {
                  replace: true,
                  state: { from: location.pathname },
                });
              } else {
                console.error(error);
              }
            }
          
        };

        fetchFiles(); 
        }, [selectedFile]);
    


    

    const handleSubmit = () => {
        const file = files.find((f) => f.id === Number(selectedFile.id));
        if (file) {
        setSelectedFile(file);
        console.log("Saved to context:", file);
        navigate("/overview");
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
              {selectedFile?.file
                ? selectedFile.file.split("/").pop()
                : "Select OCEL File"}
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
                      value={file.file}
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
                      {file.file.split("/").pop()}
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