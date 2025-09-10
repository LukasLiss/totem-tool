import React, { useState, useEffect } from 'react';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import {Login} from "./component/login";
import {Home} from "./component/home";
import {Navigation} from './component/navigation';
import {Logout} from './component/logout';
import {UploadView} from './UploadView';
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import './styles/app.css';
import { ProcessOverview } from './ProcessOverview';



function App() {
    const [selectedFile, setSelectedFile] = useState(null);
    
  return (
    <SelectedFileContext.Provider value={{ selectedFile, setSelectedFile }}>
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
    </SelectedFileContext.Provider>  
  );
}

export default App;