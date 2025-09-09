import React, { useState, useRef, useEffect, useContext, createContext } from "react";
import { useNavigate } from "react-router-dom";
import { getUserFiles } from "../api/fileApi";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
//import './component_styles/userfileselect.css';
import { Button } from "../components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

function UserFileSelect() {
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
        setSelectedFileId(e.target.value);
        console.log('handleSelectChange')
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
        <div className="bg-background">
            test
            <Select>
                <SelectTrigger className="w-[400px]">
                    <SelectValue placeholder="Select OCEL File lol" className="" />
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

            <Button className="" onClick={handleSubmit}>
                Open File
            </Button>

        </div>
        
    )
}

export default UserFileSelect