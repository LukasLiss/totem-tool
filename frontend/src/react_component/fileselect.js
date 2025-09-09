import React, { useState, useRef, useEffect, useContext, createContext } from "react";
import { useNavigate } from "react-router-dom";
import { getUserFiles } from "../api/fileApi";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import './component_styles/fileselect.css';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

function FileSelect() {
    const [files, setFiles] = useState([])
    const [selectedFileId, setSelectedFileId] = useState(""); 
    const { setSelectedFile } = useContext(SelectedFileContext);
    const navigate = useNavigate()

    useEffect(() => {
        const fetchFiles = async () => {
            const token = localStorage.getItem("access_token");
            try {
            const response = await getUserFiles(token);
            setFiles(response);
            } catch (err) {
            console.error(err);
            }
        };

        fetchFiles(); 
        }, []);
    


    // Handle file upload
    const handleFileChange = (e) => {
        setFiles(Array.from(e.target.files)); // convert FileList to array
    };

    // Handle button click
    const handleSelectChange = (e) => {
        const fileId = Number(e.target.value);
        setSelectedFileId(fileId);

        const file = files.find((f) => f.id === fileId);
        if (file) {
            setSelectedFile(file); // save into context
            console.log("Saved to context:", file);
            navigate("/overview");
        }
    };

    const handleSubmit = () => {
        const file = files.find((f) => f.id === Number(selectedFileId));
        if (file) {
        setSelectedFile(file); // save into context
        console.log("Saved to context:", file);
        navigate("/overview");
        }
    };
    
    return(
        <div className="bg-destructive text-foreground">
            <Select>
                <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Select OCEL File" />
                </SelectTrigger>
                <SelectContent>
                    {files.map((file) => (
                    <SelectItem key={file.id} value={file.id}>

                        {file.file ? file.file.split("/").pop() : "Unknown file"  //cuts whole file path to just file name
                        }
                        
                    </SelectItem>
                ))}
                </SelectContent>
            </Select>
        </div>
        
    )
}

export default FileSelect