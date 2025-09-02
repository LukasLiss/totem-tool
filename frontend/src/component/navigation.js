import React, { useState, useEffect } from 'react';
import { Navbar, Nav } from 'react-bootstrap';


export function Navigation() {
  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('access_token') !== null) {
      setIsAuth(true);
    }
  }, [isAuth]);

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
