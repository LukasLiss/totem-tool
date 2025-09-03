import React, { useState, useEffect } from 'react';
import {BrowserRouter, Routes, Route} from 'react-router-dom'
import {Login} from "./component/login";
import {Home} from "./component/home";
import {Navigation} from './component/navigation';
import {Logout} from './component/logout';
import {UploadView} from './UploadView';



function App() {
  

  return (
    <BrowserRouter>
      <div style={{ 
        //display: 'flex', 
        //flexDirection: 'column',
        //justifyContent: 'center', 
        //alignItems: 'center', 
        //height: '100vh',
        fontFamily: 'Arial, sans-serif',
        padding: '20px',
        backgroundColor: '#f5f5f5'
      }}>
        
        <Navigation />
          <Routes>
            <Route path="/home" element={<Home/>}/>
            <Route path="/login" element={<Login/>}/>
            <Route path="/logout" element={<Logout/>}/>
            <Route path="/upload" element={<UploadView/>}/>
          </Routes>
          
        
        
      </div>
  </BrowserRouter>
  );
}

export default App;