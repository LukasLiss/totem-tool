import { useState, useRef, useContext } from "react";
import { fileTypeFromBlob } from "file-type";
import { uploadFile } from "../api/fileApi";
import {useDropzone} from 'react-dropzone';
import { Button } from "@/components/ui/button";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"
import { toast } from "sonner"


export function FileUploadValidator() {
    //Uploads data while checking for the right format (JSON, XML, SQLITE) using MagicNumbers and filename endings
    //Right now JSON with OR logic
    const { setSelectedFile } = useContext(SelectedFileContext);
    
    const [file, setFile] = useState<File | null>(null);
    const hiddenInputRef = useRef<HTMLInputElement | null>(null);


    const {getRootProps, getInputProps} = useDropzone({
      onDrop: (incomingFiles) => {
        if (hiddenInputRef.current) {
          const dataTransfer = new DataTransfer();
          incomingFiles.forEach((v) => {
            dataTransfer.items.add(v);
          });
          hiddenInputRef.current.files = dataTransfer.files;
        }
        setFile(incomingFiles[0]);
      },
      multiple: false,
    });
    
    //Validation

    const validateFile = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return false;
    }

     

    const type = await fileTypeFromBlob(file);
    console.log("Detected type:", type); // { ext, mime }
    
    const isJson =
      type?.ext === "json" || file.name.toLowerCase().endsWith(".json");
    const isXml =
      type?.ext === "xml" && file.name.toLowerCase().endsWith(".xml");
    const isSqlite =
      (type?.ext === "sqlite" || type?.ext === "db") &&
      (file.name.toLowerCase().endsWith(".sqlite") ||
        file.name.toLowerCase().endsWith(".db"));
    const isCsv =
      type?.ext === "csv" || file.name.toLowerCase().endsWith(".csv");

    if (!(isJson || isXml || isSqlite || isCsv)){
        toast.error("Invalid file type", {description:"Please enter 'json', 'xml', 'sqlite', or 'csv'."});
        return false;
    }
    
    return true;
  };

  // Upload

  const handleFileUpload = async () => {
    const token = localStorage.getItem("access_token");
    try {
      if (!token) {
      console.error("No token found!");
      return;
      }
      if (!file) {
        toast.warning("No file selected!");
        return;
      }
      const response = await uploadFile(file, token);
      setSelectedFile(response);
      toast.success("Upload successful", {
      description: file.name,
    });
      setFile(null);
        } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Upload failed");
    }
  };


 const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const isValid = await validateFile();
    if (isValid) {
      await handleFileUpload();
    }
 };





  return (
  <div>
    <Card className="w-full max-w-sm m-6">
      <CardHeader>
        <CardTitle>
          Upload new file
        </CardTitle>
      </CardHeader>
        <CardContent>
          <form className="flex flex-col" onSubmit={handleSubmit}>
            <div {...getRootProps({ className: 
              "dropzone font-sans border flex flex-col items-center justify-center rounded-md pt-15 pb-20 pr-10 pl-10 text-center cursor-pointer transition hover:shadow-lg" })}>
              {/* hidden input so FormData works if needed */}
              <input 
                type="file"
                name="my-file"
                ref={hiddenInputRef}
                style={{ opacity: 0 }}
              />
              <input  {...getInputProps()} />
              <p className="text-lg text-primary">Click or drag and drop an OCEL file here to start a new project</p>
            </div>  
       
        <CardFooter className="flex-col gap-6 text-sm w-full mt-6 p-0">
          <div className="flex flex-col justify-center w-full">    
            <div className="flex border rounded-md justify-center pr-2 pl-2 text-primary gap-2 w-full h-9 px-4 py-2 has-[>svg]:px-3">
                <span>{file?.name ?? "No file chosen"}</span>
            </div>
              <Button className="w-full flex mt-2 md:flex-row cursor-pointer transition hover:shadow-lg" type="submit">Validate & Upload</Button>
          </div>
        </CardFooter>
      </form>
    </CardContent>
  </Card>
  </div>
  );
}

export default FileUploadValidator;