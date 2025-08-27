import React, { useState, useEffect } from 'react';
import {BrowserRouter, Routes, Route} from 'react-router-dom'
import {Login} from "./component/login";
import {Home} from "./component/home";
import {Navigation} from './component/navigation';
import {Logout} from './component/logout';
import {FileUploadButton} from './component/fileuploadbutton'
import { uploadFile } from "./api/fileApi";

function App() {
  const [message, setMessage] = useState('Hello from Frontend! (Loading backend...)');
  const [backendStatus, setBackendStatus] = useState('Connecting...');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchBackendMessage = async () => {
      try {
        console.log('Attempting to fetch from backend...');
        setBackendStatus('Fetching...');
        
        const response = await fetch('http://localhost:8000/api/greeting/');
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Backend response:', data);
        
        setMessage(data.message || 'Hello from Frontend + Backend!');
        setBackendStatus('✅ Connected');
        setIsLoading(false);
        
      } catch (error) {
        console.error('Backend connection error:', error);
        setMessage('Hello from Frontend! (Backend not available)');
        setBackendStatus(`❌ Error: ${error.message}`);
        setIsLoading(false);
      }
    };

    // Try to connect immediately
    fetchBackendMessage();
    
    // Also try again after 3 seconds in case backend is still starting
    const retryTimeout = setTimeout(fetchBackendMessage, 3000);
    
    return () => clearTimeout(retryTimeout);



  }, []);
  //handleFileSelect function for fileuploadbutton; placed here to improve reuseability
  const [files, setFiles] = useState([]);

  const handleFileSelect = async (file) => {
      const token = localStorage.getItem("access_token");
      try {
        const response = await uploadFile(file, token);
        setFiles((prev) => [...prev, response]); // add uploaded file to state
      } catch (err) {
        console.error("Upload failed:", err);
      }
  };


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
            <Route path="/" element={<Home/>}/>
            <Route path="/login" element={<Login/>}/>
            <Route path="/logout" element={<Logout/>}/>
          </Routes>
          
        <h1 style={{ 
          fontSize: '32px', 
          marginBottom: '20px',
          color: '#333',
          textAlign: 'center'
        }}>
          {message}
        </h1>
        
        
        <div style={{
          fontSize: '18px',
          color: '#666',
          textAlign: 'center',
          marginBottom: '10px'
        }}>
          Backend Status: {backendStatus}
        </div>
        
        {isLoading && (
          <div style={{
            fontSize: '16px',
            color: '#999',
            fontStyle: 'italic'
          }}>
            Waiting for backend to start...
          </div>
        )}
        
        <div style={{
          marginTop: '30px',
          fontSize: '14px',
          color: '#888',
          textAlign: 'center'
        }}>
          TOTeM-Tool v1.0 - React + Django + Electron
        </div>
        <FileUploadButton onFileSelect={handleFileSelect}/>
      </div>
  </BrowserRouter>
  );
}

export default App;