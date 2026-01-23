import React, { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Login } from "./react_component/login";
import { Home } from "./react_component/home";
import { Logout } from "./react_component/logout";
import UploadView from "./UploadView";
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import "./styles/app.css";
import { ProcessOverview } from "./ProcessOverview_new";
import { DashboardProvider } from "./contexts/DashboardContext";
import { VariantsOverview } from "./VariantsOverview";
function App() {
  const [selectedFile, setSelectedFile] = useState(null);

  return (
    <SelectedFileContext.Provider value={{ selectedFile, setSelectedFile }}>
      <DashboardProvider>
        <div className="website-background">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/home" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/logout" element={<Logout />} />
            <Route path="/upload" element={<UploadView />} />
            <Route path="/overview" element={<ProcessOverview />} />
            <Route path="/variantsview" element={<VariantsOverview />} />
          </Routes>
        </div>
      </DashboardProvider>
    </SelectedFileContext.Provider>
  );
}

export default App;
