import React, { useState, useContext, useEffect } from 'react';
import FileSelect from './component/fileselect';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import { NumberofEvents } from './component/numberofevents';
import './styles/processoverview.css';

export function ProcessOverview(){
    
  const { selectedFile } = useContext(SelectedFileContext);


    return (
        <div className="overview_main_div">
            <div className="header_bar">
                <div className="ov_fs">
                    <FileSelect/>
                </div>
                <div className="tabs">
                    TabsTabsTabs
                </div>
            </div>
            <div className="filter_bar">
                <div className="ov_filter">
                    Filterfilter
                </div>
                <div className="ov_exp_log">
                    <button className="exp_log_button">
                        Export Log
                    </button>
                </div>
            </div>
            <div className="oceldisplay">
                <div className="ov_ocelwindow">
                    Das ist der Overview
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
            