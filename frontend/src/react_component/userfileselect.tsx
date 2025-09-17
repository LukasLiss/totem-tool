import React, { useState, useRef, useEffect, useContext, createContext } from "react";
import { useNavigate } from "react-router-dom";
import { getUserFiles } from "../api/fileApi";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import './component_styles/userfileselect.css';
import { Button } from "@/components/ui/button";



function UserFileSelect() {
    const [files, setFiles] = useState([])
    const [selectedFileId, setSelectedFileId] = useState(""); 
    const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);
    const navigate = useNavigate()

    useEffect(() => {
        const fetchFiles = async () => {
            const token = localStorage.getItem("access_token");
            try {
            const response = await getUserFiles(token);
            setFiles(response);
            console.log(files)
            } catch (err) {
            console.error(err);
            }
        };

        fetchFiles(); 
        }, [selectedFile]);
    


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
        <div className="flex flex-row justify-between mx-6 mt-6">
            <select className="rounded-md border bg-background px-2 py-2 ml-[6vw]" onChange={handleSelectChange} value={selectedFileId}>
                <option value="">Select OCEL File</option>
                {files.map((file) => (
                    <option key={file.id} value={file.id} placeholder="Select File" >

                        {file.file ? file.file.split("/").pop() : "Unknown file"  //cuts whole file path to just file name
                        }
                        
                    </option>
                ))}
            </select>

            <Button className="flex flex-wrap items-center gap-2 md:flex-row mr-[6vw] cursor-pointer transition hover:shadow-lg" onClick={handleSubmit}>
                Open File
            </Button>

        </div>
        
    )
}

export default UserFileSelect