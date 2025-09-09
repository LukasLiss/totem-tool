import React, { useState, useContext, useEffect } from 'react';
import FileSelect from './react_component/fileselect';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import { NumberofEvents } from './react_component/numberofevents';
import './styles/processoverview.css';
import { Button } from "./components/ui/button"

export function ProcessOverview(){
    
  const { selectedFile } = useContext(SelectedFileContext);


    return (
        <div className="overview_main_div">
            <div className="header_bar">
                <div className="ov_fs">
                    <FileSelect/>
                </div>
                <div className="tabs">
                    <div className="tab">
                        TOTeM
                    </div>
                    <div className="tab">
                        Dashboard 1
                    </div>   
                    <div className="tab">
                        +
                    </div>
                </div>
            </div>
            <div className="filter_bar">
                <div className="ov_filter">
                    Filter
                </div>
                <div className="ov_exp_log">
                    <Button variant="outline">
                        Export Log
                    </Button>
                </div>
            </div>
            <div className="oceldisplay">
                <div className="ov_ocelwindow">
                    
                    {selectedFile ? (
                        <p>Currently selected: {selectedFile.file.split("/").pop()}</p>
                            ) : (
                                <p>No file selected</p>
                            )}
                        <NumberofEvents/>
                </div>
                <div className="ov_ocelparams">
                            Mmhh parameter
                </div>
            </div>
            
        </div>
)
}

export default ProcessOverview;
            