import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** Wrap any recruiter-only route with this so it redirects to /login when signed out. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { recruiter, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-100">
        <div className="flex items-center gap-2.5 text-sm font-medium text-ink-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" />
          Checking your session…
        </div>
      </div>
    );
  }

  if (!recruiter) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
