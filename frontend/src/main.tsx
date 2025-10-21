import { StrictMode } from 'react'
import React from 'react';
import ReactDOM from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import App from './App';
import './interceptors/axios';
import './styles/custom.css';
import 'gridstack/dist/gridstack.min.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(

    <BrowserRouter>
        <App />
    </BrowserRouter>


);

