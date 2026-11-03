import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, AUTH_UNAUTHORIZED_EVENT, Recruiter, setAuthToken } from "../api/client";
import { getActiveInterviewToken } from "../lib/candidateSession";

const TOKEN_STORAGE_KEY = "hr_recruiter_token";

interface AuthContextValue {
  recruiter: Recruiter | null;
  /** True only while the initial "is there a saved session?" check is running. */
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [recruiter, setRecruiter] = useState<Recruiter | null>(null);
  const [initializing, setInitializing] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setAuthToken(null);
    setRecruiter(null);
  }, []);

  // On first load, restore a saved session token (if any) and validate it
  // against the backend before trusting it — an expired or tampered token
  // should bounce straight to /login rather than showing a broken dashboard.
  useEffect(() => {
    // A browser that is showing a candidate interview must never carry a
    // recruiter session: whoever is sitting at it is the interviewee, and a
    // saved recruiter login would let them type /admin and open the
    // dashboard. So an interview page (or an interview-locked tab) signs the
    // saved recruiter session out instead of restoring it.
    if (window.location.pathname.startsWith("/interview/") || getActiveInterviewToken()) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setAuthToken(null);
      setInitializing(false);
      return;
    }
    const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!saved) {
      setInitializing(false);
      return;
    }
    setAuthToken(saved);
    api
      .me()
      .then((me) => setRecruiter(me))
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setAuthToken(null);
      })
      .finally(() => setInitializing(false));
  }, []);

  // Any request anywhere in the app that comes back 401 should end the
  // session the same way an explicit logout does.
  useEffect(() => {
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  async function login(email: string, password: string) {
    const { token, recruiter: r } = await api.login({ email, password });
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    setAuthToken(token);
    setRecruiter(r);
  }

  async function register(name: string, email: string, password: string) {
    const { token, recruiter: r } = await api.register({ name, email, password });
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    setAuthToken(token);
    setRecruiter(r);
  }

  return (
    <AuthContext.Provider value={{ recruiter, initializing, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>.");
  return ctx;
}
