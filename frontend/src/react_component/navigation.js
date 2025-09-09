import React, { useState, useEffect } from 'react';
import axios from 'axios';

export function Navigation() {
  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
  const verifyToken = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setIsAuth(false);
      return;
    }

    try {
      await axios.get('http://localhost:8000/api/greeting/', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIsAuth(true); // token is valid
    } catch (error) {
      console.log('Token invalid or expired:', error);
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      setIsAuth(false);
    }
  };

  verifyToken();
}, []);


  return (
    <div>
      <Navbar bg="dark" variant="dark">
        <Navbar.Brand href="/">JWT Authentification</Navbar.Brand>

        <Nav className="me-auto">
          {isAuth ? <Nav.Link href="/home">Home</Nav.Link> : null}
          {isAuth ? <Nav.Link href="/upload">Upload</Nav.Link> : null}
        </Nav>

        <Nav>
          {isAuth ? (
            <Nav.Link href="/logout">Logout</Nav.Link>
          ) : (
            <Nav.Link href="/login">Login</Nav.Link>
          )}
        </Nav>
      </Navbar>
    </div>
  );
}
