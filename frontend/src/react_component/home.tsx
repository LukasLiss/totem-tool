// Import the react JS packages
import { useEffect, useState } from "react";
import axios from "axios";

// Define the Home function.
export const Home = () => {
  const [message, setMessage] = useState('Hello from Frontend! (Loading backend...)');
  const [backendStatus, setBackendStatus] = useState('Connecting...');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchBackendMessage = async () => {        
        try {
          const { data } = await axios.get('http://localhost:8000/api/greeting/');
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

  return (
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
        
      </div>
  
  );
}
