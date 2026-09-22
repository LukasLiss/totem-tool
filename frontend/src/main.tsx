import ReactDOM from 'react-dom/client';
import {BrowserRouter } from 'react-router-dom';
import App from './App';
import './interceptors/axios';
import './styles/custom.css';
import 'gridstack/dist/gridstack.min.css';

// The only thing this app prints. Everything else the console shows is a
// genuine browser or dependency message worth reading.
console.info(
    'If you are a dev and want to contribute, this is our GitHub repo: https://github.com/LukasLiss/totem-tool',
);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(

    <BrowserRouter>
        <App />
    </BrowserRouter>


);

