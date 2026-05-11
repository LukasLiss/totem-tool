import { createContext, useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import axios from "axios";

type AuthState = "authenticated" | "anonymous" | "expired";

type AuthContextType = {
  authState: AuthState;
  setAuthState: (state: AuthState) => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

async function guestReAuth() {
  const resp = await axios.post(
    "http://localhost:8000/token/",
    { username: "Guest", password: "guest" },
    { headers: { "Content-Type": "application/json" } }
  );
  const { access, refresh } = resp.data;
  axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
  localStorage.setItem("access_token", access);
  if (refresh) localStorage.setItem("refresh_token", refresh);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<AuthState>("authenticated");

  useEffect(() => {
    if (authState !== "expired") return;

    if (localStorage.getItem("local_mode") === "true") {
      guestReAuth()
        .then(() => setAuthState("authenticated"))
        .catch(() => setAuthState("anonymous"));
    } else {
      navigate("/login", { replace: true });
    }
  }, [authState, navigate]);

  return (
    <AuthContext.Provider value={{ authState, setAuthState }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
