import React, { useState, useContext, useEffect } from 'react';
import FileSelect from './react_component/fileselect';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import { NumberofEvents } from './react_component/numberofevents';
import './styles/processoverview.css';
import VariantsComponent from './react_component/VariantsExplorer.jsx'


export function VariantsOverview(){
    
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
                    Hier kommt die Varianten-Komponente hin:
                    {selectedFile ? (
                        <p>Currently selected: {selectedFile.file.split("/").pop()}</p>
                            ) : (
                                <p>No file selected</p>
                            )}
                        <NumberofEvents/>

                        {status === 'loading' && <div>Loading variants…</div>}
                        {status === 'error' && (
                            <div style={{ color: 'crimson' }}>Failed to load variants: {String((error as any)?.message || error)}</div>
                        )}
                        {status === 'empty' && <div>No variants.</div>}

                        {/* 🔥 Render your component with data */}
                        {status === 'ready' && <VariantsExplorer variants={variants} />}
                </div>
                <div className="ov_ocelparams">
                            Andere Parameter
                </div>
            </div>
            
        </div>
)
}

export default VariantsOverview;
            