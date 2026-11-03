import { Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import AdminDashboard from "./pages/AdminDashboard";
import ScheduleInterview from "./pages/ScheduleInterview";
import CandidateInterview from "./pages/CandidateInterview";
import ReportDashboard from "./pages/ReportDashboard";
import Auth from "./pages/Auth";
import RequireAuth from "./components/RequireAuth";
import { useAuth } from "./context/AuthContext";
import { getActiveInterviewToken } from "./lib/candidateSession";
import { IconLogo, IconGrid, IconCalendarPlus } from "./ui/icons";

function NavLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  const location = useLocation();
  const active = location.pathname === to || (to === "/admin" && location.pathname.startsWith("/admin/report"));
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
        active ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200/70" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}

function RecruiterNav() {
  const { recruiter, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <nav className="sticky top-0 z-30 border-b border-ink-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-3.5">
        <Link to="/admin" className="mr-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand">
            <IconLogo width={18} height={18} />
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
            AI HR Interview Agent
          </span>
        </Link>
        <div className="h-6 w-px bg-ink-200" />
        <NavLink to="/admin" icon={<IconGrid width={16} height={16} />}>
          Dashboard
        </NavLink>
        <NavLink to="/admin/schedule" icon={<IconCalendarPlus width={16} height={16} />}>
          Schedule Interview
        </NavLink>

        <div className="ml-auto flex items-center gap-3">
          {recruiter && (
            <span className="hidden max-w-[180px] truncate text-sm font-medium text-ink-500 sm:inline">
              {recruiter.name}
            </span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg px-3 py-2 text-sm font-medium text-ink-500 transition-colors duration-150 hover:bg-ink-100 hover:text-ink-900"
          >
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}

/**
 * While this tab is in the middle of a candidate interview, every route other
 * than that interview (login, register, recruiter pages, unknown URLs) bounces
 * back to it, so a candidate can't wander into the recruiter login page.
 */
function CandidateLockGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const lockedToken = getActiveInterviewToken();
  if (lockedToken && location.pathname !== `/interview/${lockedToken}`) {
    return <Navigate to={`/interview/${lockedToken}`} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <CandidateLockGuard>
    <Routes>
      {/* Candidate-facing: no chrome/nav, full takeover of the screen, no login required */}
      <Route path="/interview/:token" element={<CandidateInterview />} />

      {/* Recruiter login / registration */}
      <Route path="/login" element={<Auth />} />

      {/* Recruiter-facing: gated behind login, simple shared nav */}
      <Route
        path="/*"
        element={
          <RequireAuth>
            <div className="min-h-screen bg-ink-100">
              <RecruiterNav />
              <Routes>
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/schedule" element={<ScheduleInterview />} />
                <Route path="/admin/report/:id" element={<ReportDashboard />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Routes>
            </div>
          </RequireAuth>
        }
      />
    </Routes>
    </CandidateLockGuard>
  );
}
