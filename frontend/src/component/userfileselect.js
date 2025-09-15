import React, { useState, useRef, useEffect, useContext, createContext } from "react";
import { useNavigate } from "react-router-dom";
import { getUserFiles } from "../api/fileApi";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import './component_styles/userfileselect.css';


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
        <div className="main_div">
            <select className="file_select" onChange={handleSelectChange} value={selectedFileId}>
                <option value="">Select OCEL File</option>
                {files.map((file) => (
                    <option key={file.id} value={file.id} placeholder="Select File" >

                        {file.file ? file.file.split("/").pop() : "Unknown file"  //cuts whole file path to just file name
                        }
                        
                    </option>
                ))}
            </select>

            <button className="open_file_button" onClick={handleSubmit}>
                Open File
            </button>

        </div>
        
    )
}

export default UserFileSelect