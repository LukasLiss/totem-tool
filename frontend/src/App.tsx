import React, { useState, useEffect } from 'react';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import {Login} from "./react_component/login";
import {Home} from "./react_component/home";
import {Logout} from './react_component/logout';
import UploadView from './UploadView';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import './styles/app.css';
import { ProcessOverview } from './ProcessOverview_new';
import { DashboardProvider } from "./contexts/DashboardContext";import { VariantsOverview } from './VariantsOverview';

import OCDFGVisualizer from './react_component/OCDFGVisualizer'; 
import { ReactFlowProvider } from '@xyflow/react';


function App() {
  // const [selectedFile, setSelectedFile] = useState(null); // Keep for later

  return (
    <div style={{ textAlign: 'center' }}> 
      <h1>Object-Centric DFG Viewer</h1>
      <ReactFlowProvider>
        <OCDFGVisualizer />
      </ReactFlowProvider>  
    </div>

    /*
      ORIGINAL ROUTER CODE
      ===========================================================
      <SelectedFileContext.Provider value={{ selectedFile, setSelectedFile }}>
        <div className="white-background" style={{}}>
          <Navigation />
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/logout" element={<Logout />} />
            <Route path="/upload" element={<UploadView />} />
            <Route path="/overview" element={<ProcessOverview />} />
            <Route path="/variantsview" element={<VariantsOverview />} />
          </Routes>
        </div>
      </SelectedFileContext.Provider>
    */
  );
}

export default App;