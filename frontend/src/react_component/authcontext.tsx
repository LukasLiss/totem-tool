import { createContext, useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

type AuthState = "authenticated" | "anonymous" | "expired";

type AuthContextType = {
  authState: AuthState;
  setAuthState: (state: AuthState) => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<AuthState>("authenticated");

  // 🔑 CENTRAL REDIRECT LOGIC
  useEffect(() => {
  if (authState === "expired") {
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
