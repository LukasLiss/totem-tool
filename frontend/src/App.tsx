import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import axios from "axios";
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

function AppRoutes({ selectedFile, setSelectedFile }) {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get("/api/local-mode/");
        if (!data.local_mode) return;

        localStorage.setItem("local_mode", "true");

        if (!localStorage.getItem("access_token")) {
          const tokenResp = await axios.post("http://localhost:8000/token/", {
            username: "Guest",
            password: "guest",
          });
          const { access, refresh } = tokenResp.data;
          axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
          localStorage.setItem("access_token", access);
          if (refresh) localStorage.setItem("refresh_token", refresh);
        }

        const path = window.location.pathname;
        if (path === "/" || path === "/title" || path === "/login") {
          navigate("/upload", { replace: true });
        }
      } catch {
        // Backend not reachable yet or not local mode — proceed normally
      }
    })();
  }, [navigate]);

  return (
    <SelectedFileContext.Provider value={{ selectedFile, setSelectedFile }}>
      <DashboardProvider>
        <div className="website-background">
          <Toaster position="top-center" richColors />

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

function App() {
  const [selectedFile, setSelectedFile] = useState(null);

  return (
    <AppRoutes selectedFile={selectedFile} setSelectedFile={setSelectedFile} />
  );
}

export default App;
