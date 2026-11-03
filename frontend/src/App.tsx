import React, { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import { Login } from "./react_component/login";
import { Logout } from "./react_component/logout";
import { OAuthCallback } from "./react_component/oauthCallback";
import UploadView from "./UploadView";
import { SelectedFileContext, type SelectedFile } from "./contexts/SelectedFileContext";
import "./styles/app.css";
import { ProcessOverview } from "./ProcessOverview";
import { DashboardProvider } from "./contexts/DashboardContext";
import { DeleteView } from "./DeleteView";
import { SettingsView } from "./SettingsView";
import { Toaster, toast } from "sonner";
import { SplashAnimation } from "./components/SplashAnimation";
import { setBypassCache } from "./interceptors/axios";
import { getUserSettings } from "./api/settingsApi";
import { LOCAL_MODE } from "./lib/env";

async function guestLogin() {
  const { data } = await axios.post(
    "/token/",
    { username: "Guest", password: "guest" },
    // Never let a 401 from the login itself trigger the refresh interceptor.
    { _skipAuthRefresh: true }
  );
  axios.defaults.headers.common["Authorization"] = `Bearer ${data.access}`;
  localStorage.setItem("access_token", data.access);
  if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
}

const SPLASH_SEEN_KEY = "totem_splash_seen";

function hasSeenSplash(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSplashSeen() {
  try {
    sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
  } catch {
    /* storage unavailable — the splash just plays again next load */
  }
}

function AppRoutes({ selectedFile, setSelectedFile }) {
  const [ready, setReady] = useState(!LOCAL_MODE);
  // Splash plays once per browser tab. Login hops (the OAuth round trip, the
  // interceptor's redirect to /login) are full page loads, so without the
  // sessionStorage flag it would replay on each of them. Press Esc or click
  // anywhere to skip.
  const [splashDone, setSplashDone] = useState(hasSeenSplash);

  const handleSplashComplete = () => {
    markSplashSeen();
    setSplashDone(true);
  };

  const [guestLoginError, setGuestLoginError] = useState<string | null>(null);

  // Reported once the Toaster is on screen — it only renders after `ready`.
  useEffect(() => {
    if (ready && guestLoginError) {
      toast.error(guestLoginError, { duration: 10000 });
    }
  }, [ready, guestLoginError]);

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
        } catch (err) {
          if (axios.isAxiosError(err) && err.response) {
            // A response means the backend is up and said no, so retrying
            // cannot help: the Guest user is missing or has another password.
            if (!cancelled) {
              setGuestLoginError(
                "Automatic sign-in was rejected. Seed the Guest user with " +
                  "`npm run db:migrate` and reload."
              );
              setReady(true);
            }
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

  // Seed the global cache-bypass flag from the user's saved setting once we're
  // authenticated. Guarded on an access token so we don't fire (and trigger a
  // login redirect) on the pre-auth title/login screens.
  useEffect(() => {
    if (!ready) return;
    if (!localStorage.getItem("access_token")) return;
    getUserSettings()
      .then((s) => setBypassCache(s.bypass_cache))
      .catch(() => {
        /* not logged in yet or settings unavailable — leave bypass off */
      });
  }, [ready]);

  // The splash sits outside the `ready` switch so it keeps playing (rather
  // than restarting) while the local-mode Guest login finishes underneath.
  return (
    <div className="website-background">
      {!splashDone && <SplashAnimation onComplete={handleSplashComplete} />}
      {!ready ? (
        <div className="flex items-center justify-center h-dvh" />
      ) : (
        <SelectedFileContext.Provider value={{ selectedFile, setSelectedFile }}>
          <DashboardProvider>
            <Toaster position="top-center" richColors />
            <Routes>
              {/* Old landing page; kept as a redirect for existing links. */}
              <Route
                path="/title"
                element={<Navigate to={LOCAL_MODE ? "/upload" : "/login"} replace />}
              />
              <Route
                path="/login"
                element={LOCAL_MODE ? <Navigate to="/upload" replace /> : <Login />}
              />
              <Route
                path="/oauth/callback"
                element={LOCAL_MODE ? <Navigate to="/upload" replace /> : <OAuthCallback />}
              />
              <Route path="/logout" element={<Logout />} />
              <Route path="/upload" element={<UploadView />} />
              <Route path="/overview" element={<ProcessOverview />} />
              <Route path="/userdatadelete" element={<DeleteView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route
                path="/"
                element={
                  <Navigate to={LOCAL_MODE ? "/upload" : "/login"} replace />
                }
              />
            </Routes>
          </DashboardProvider>
        </SelectedFileContext.Provider>
      )}
    </div>
  );
}

function App() {
  const [selectedFile, setSelectedFileState] = useState<SelectedFile | null>(() => {
    try {
      const saved = localStorage.getItem("totem_selected_file");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const setSelectedFile = useCallback((file: SelectedFile | null) => {
    setSelectedFileState(file);
    try {
      if (file) {
        localStorage.setItem("totem_selected_file", JSON.stringify(file));
      } else {
        localStorage.removeItem("totem_selected_file");
      }
    } catch {
      /* ignore storage quota errors */
    }
  }, []);

  return (
    <AppRoutes selectedFile={selectedFile} setSelectedFile={setSelectedFile} />
  );
}

export default App;
