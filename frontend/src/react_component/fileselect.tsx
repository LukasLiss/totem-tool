import { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { getUserFiles } from "../api/fileApi";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import './component_styles/fileselect.css';


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
    


    

    // Handle button click
    const handleSelectChange = (e) => {
        const fileId = Number(e.target.value);
        setSelectedFileId(fileId);

        const file = files.find((f) => f.id === fileId);
        if (file) {
            setSelectedFile(file); // save into context
            console.log("Saved to context:", file);
            navigate("/variantsview");
        }
    };

    
    return(
        <div className="flex flex-row justify-between">
            <select className="rounded-md border bg-background px-2 py-2" onChange={handleSelectChange} value={selectedFileId}>
                <option value="">Select OCEL File</option>
                {files.map((file) => (
                    <option key={file.id} value={file.id} placeholder="Select File" >

                        {file.file ? file.file.split("/").pop() : "Unknown file"  //cuts whole file path to just file name
                        }
                        
                    </option>
                ))}
            </select>

        </div>
        
    )
}

export default FileSelect