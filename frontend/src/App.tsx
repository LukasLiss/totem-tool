import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import { SplashAnimation } from "./components/SplashAnimation";
import { AiChatWidget } from "./components/ai-chat/chat-widget";

const LOCAL_MODE = Boolean(import.meta.env.VITE_LOCAL_MODE);

async function guestLogin() {
  const { data } = await axios.post("http://localhost:8000/token/", {
    username: "Guest",
    password: "guest",
  });
  axios.defaults.headers.common["Authorization"] = `Bearer ${data.access}`;
  localStorage.setItem("access_token", data.access);
  if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
}

// Routes without an authenticated app shell — no chat widget there
const CHAT_HIDDEN_ROUTES = ["/title", "/login", "/logout"];

function AppRoutes({ selectedFile, setSelectedFile }) {
  const location = useLocation();
  const [ready, setReady] = useState(!LOCAL_MODE);
  // Splash plays on every mount — including dev — until dismissed. Press Esc
  // or click anywhere to skip.
  const [splashDone, setSplashDone] = useState(false);

  const handleSplashComplete = () => {
    setSplashDone(true);
  };

  useEffect(() => {
    if (!LOCAL_MODE) return;
    let cancelled = false;
    (async () => {
      // Retry only while the backend is unreachable (Electron may open the
      // window before Django finishes booting). Stop immediately on any HTTP
      // response — a 401 means the Guest user/password is wrong in the DB,
      // and retrying won't fix that.
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        try {
          if (!localStorage.getItem("access_token")) {
            await guestLogin();
          } else {
            axios.defaults.headers.common["Authorization"] =
              `Bearer ${localStorage.getItem("access_token")}`;
          }
          if (!cancelled) setReady(true);
          return;
        } catch (err: any) {
          if (err?.response) {
            console.error(
              "Guest auto-login rejected by backend. Is the Guest user seeded " +
                "with password 'guest'? Run `node scripts/run-python.js " +
                "backend/manage.py migrate` and try again."
            );
            if (!cancelled) setReady(true);
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="website-background">
        <div className="flex items-center justify-center h-dvh" />
      </div>
    );
  }

  return (
    <SelectedFileContext.Provider value={{ selectedFile, setSelectedFile }}>
      <DashboardProvider>
        <div className="website-background">
          <Toaster position="top-center" richColors />
          {!splashDone && (
            <SplashAnimation onComplete={handleSplashComplete} />
          )}

          <Routes>
            <Route
              path="/title"
              element={LOCAL_MODE ? <Navigate to="/upload" replace /> : <Title />}
            />
            <Route
              path="/login"
              element={LOCAL_MODE ? <Navigate to="/upload" replace /> : <Login />}
            />
            <Route path="/logout" element={<Logout />} />
            <Route path="/upload" element={<UploadView />} />
            <Route path="/overview" element={<ProcessOverview />} />
            <Route path="/variantsview" element={<VariantsOverview />} />
            <Route path="/userdatadelete" element={<DeleteView />} />
            <Route
              path="/"
              element={
                <Navigate to={LOCAL_MODE ? "/upload" : "/title"} replace />
              }
            />
          </Routes>
          {!CHAT_HIDDEN_ROUTES.includes(location.pathname) && <AiChatWidget />}
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
