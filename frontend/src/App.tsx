import React, { useState, useEffect } from 'react';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import {Login} from "./react_component/login";
import {Home} from "./react_component/home";
import {Logout} from './react_component/logout';
import UploadView from './UploadView';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import './styles/app.css';
import { ProcessOverview } from './ProcessOverview';



function App() {
    const [selectedFile, setSelectedFile] = useState(null);
    
  return (
    <SelectedFileContext.Provider value={{ selectedFile, setSelectedFile }}>
      <body className="debug-grid">
      <div className="website-background" style={{ 
         }}>
        
        {/* <Navigation /> */}
          <Routes>
            <Route path="/home" element={<Home/>}/>
            <Route path="/login" element={<Login/>}/>
            <Route path="/logout" element={<Logout/>}/>
            <Route path="/upload" element={<UploadView/>}/>
            <Route path="/overview" element={<ProcessOverview/>}/>
          </Routes>
            
        
        
      </div>
      </body>
    </SelectedFileContext.Provider>  
  );
}

export default App;