import { useState, useRef, useContext } from "react";
import { fileTypeFromBlob } from "file-type";
import { uploadFile } from "../api/fileApi";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
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
    const { setSelectedFile } = useContext(SelectedFileContext);

    const [file, setFile] = useState<File | null>(null);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
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

    const validateFile = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return false;
    }

    const type = await fileTypeFromBlob(file);
    console.log("Detected type:", type);

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
    // The `file-type` library has no DuckDB signature, so `type?.ext` is
    // undefined for valid DuckDB files. Fall back to filename matching, in
    // line with how isJson / isCsv are handled.
    const isDuckDB =
      file.name.toLowerCase().endsWith(".duckdb");

    if (!(isJson || isXml || isSqlite || isCsv || isDuckDB)){
        toast.error("Invalid file type", {description:"Please enter 'json', 'xml', 'sqlite', 'csv', or 'duckdb'."});
        return false;
    }

    return true;
  };

  const handleFileUpload = async () => {
    try {
      if (!file) {
        toast.warning("No file selected!");
        return;
      }
      setValidationStatus('loading');
      const response = await uploadFile(file);
      setSelectedFile(response);
      setValidationStatus('success');
      toast.success("Upload successful", {
        description: file.name,
      });
      setFile(null);
      // Reset status after a delay so user can upload again if needed
      setTimeout(() => setValidationStatus('idle'), 3000);
    } catch (err: any) {
      console.error("Upload failed:", err);
      if (err.response?.data?.errors) {
        const errorList = err.response.data.errors;
        toast.error("Validation Failed", {
          description: (
            <div className="max-h-40 overflow-y-auto mt-2">
              <ul className="list-disc pl-4 text-left space-y-1">
                {errorList.map((e: string, i: number) => (
                  <li key={i} className="text-xs text-red-600 dark:text-red-400">{e}</li>
                ))}
              </ul>
            </div>
          ),
          duration: 10000,
        });
      } else {
        toast.error("Upload failed");
      }
      setValidationStatus('error');
      setTimeout(() => setValidationStatus('idle'), 3000);
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
              <Button 
                className="w-full flex mt-2 md:flex-row cursor-pointer transition hover:shadow-lg gap-2" 
                type="submit"
                disabled={validationStatus === 'loading'}
              >
                {validationStatus === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
                {validationStatus === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {validationStatus === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                {validationStatus === 'loading' ? 'Validating...' : 'Validate & Upload'}
              </Button>
          </div>
        </CardFooter>
      </form>
    </CardContent>
  </Card>
  </div>
  );
}

export default FileUploadValidator;
