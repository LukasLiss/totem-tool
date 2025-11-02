import { useContext } from 'react';
import FileSelect from './react_component/fileselect';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import { NumberofEvents } from './react_component/numberofevents';
import { Button } from "@/components/ui/button";
import './styles/processoverview.css';

export function ProcessOverview(){
    
  const { selectedFile } = useContext(SelectedFileContext);


    return (
        <div className="flex flex-col">
            <div className="flex flex-row items-center justify-between">
                <div className="flex flex-1.5 items-center justify-between">
                    <FileSelect/>
                </div>
                <div className="flex-3">
                    TabsTabsTabs
                </div>
            </div>
            <div className="flex flex-row justify-between">
                <div className="">
                    Filterfilter
                </div>
                <div className="">
                    <Button className="flex flex-wrap items-center gap-2 md:flex-row cursor-pointer transition hover:shadow-lg">
                        Export Log
                    </Button>
                </div>
            </div>
            <div className="flex flex-row  min-h-[60vh] h-[70vh] max-h-[60vw] ">
                <div className="flex-5">
                    Das ist der Overview
                    {selectedFile ? (
                        <p>Currently selected: {selectedFile.file.split("/").pop()}</p>
                            ) : (
                                <p>No file selected</p>
                            )}
                        <NumberofEvents/>
                </div>
                <div className="flex-1">
                            Mmhh parameter
                </div>
            </div>
            
        </div>
)
}

export default ProcessOverview;