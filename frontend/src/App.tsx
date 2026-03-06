import React, { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Login } from "./react_component/login";
import { Logout } from "./react_component/logout";
import { Title } from "./Title";
import UploadView from "./UploadView";
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import "./styles/app.css";
import { ProcessOverview } from "./ProcessOverview";
import { DashboardProvider } from "./contexts/DashboardContext";
import { VariantsOverview } from "./VariantsOverview";
import { DeleteView } from "./DeleteView";
import { Toaster } from "sonner";

function App() {
  const [selectedFile, setSelectedFile] = useState(null);

  return (
    <SelectedFileContext.Provider value={{ selectedFile, setSelectedFile }}>
      <DashboardProvider>
        <div className="website-background">
          <Toaster position="top-center" richColors/>

          <Routes>
            <Route path="/title" element={<Title />} />
            <Route path="/login" element={<Login />} />
            <Route path="/logout" element={<Logout />} />
            <Route path="/upload" element={<UploadView />} />
            <Route path="/overview" element={<ProcessOverview />} />
            <Route path="/variantsview" element={<VariantsOverview />} />
            <Route path="/userdatadelete" element={<DeleteView />} />
            <Route path="/" element={<Navigate to="/title" replace />} />
          </Routes>
        </div>
      </DashboardProvider>
    </SelectedFileContext.Provider>
  );
}

export default App;
