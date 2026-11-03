import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { IconAlertTriangle, IconArrowRight, IconLogo, IconShield } from "../ui/icons";

const inputClass =
  "w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-800 shadow-sm transition-shadow duration-150 placeholder:text-ink-400 focus:border-brand-500 focus:shadow-glow focus:outline-none";
const labelClass = "mb-1.5 block text-sm font-semibold text-ink-700";

type Mode = "login" | "register";

export default function Auth() {
  const { recruiter, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in — no reason to show the auth page again.
  if (recruiter) {
    const redirectTo = (location.state as { from?: string } | null)?.from || "/admin";
    return <Navigate to={redirectTo} replace />;
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      if (name.trim().length < 2) return setError("Please enter your full name.");
      if (password.length < 8) return setError("Password must be at least 8 characters.");
      if (password !== confirmPassword) return setError("Passwords don't match.");
    }
    if (!email.trim()) return setError("Please enter your email.");
    if (!password) return setError("Please enter your password.");

    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(name.trim(), email.trim(), password);
      }
      const redirectTo = (location.state as { from?: string } | null)?.from || "/admin";
      navigate(redirectTo, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 50% at 15% 10%, rgba(255,255,255,0.18), transparent), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(255,255,255,0.10), transparent)",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25">
            <IconLogo width={19} height={19} />
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight">AI HR Interview Agent</span>
        </div>

        <div className="relative max-w-md">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand-100/80">
            For recruiters &amp; hiring teams
          </p>
          <h1 className="font-display text-[2.1rem] font-semibold leading-tight tracking-tight">
            Schedule, run, and review AI-led interviews from one dashboard.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-brand-50/85">
            Sign in to manage candidates, generate role-specific question sets, and review proctored
            interview reports.
          </p>
        </div>

        <div className="relative flex items-center gap-2 text-xs font-medium text-brand-50/70">
          <IconShield width={15} height={15} />
          Your account is only used to access the recruiter dashboard.
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-ink-100 px-6 py-12">
        <div className="w-full max-w-sm animate-fadeIn">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand">
              <IconLogo width={18} height={18} />
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              AI HR Interview Agent
            </span>
          </div>

          <div className="mb-6 inline-flex rounded-lg bg-ink-150 p-1">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                mode === "login" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                mode === "register" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              Create account
            </button>
          </div>

          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {mode === "login"
              ? "Log in to access your recruiter dashboard."
              : "Set up recruiter access in under a minute."}
          </p>

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              <IconAlertTriangle width={16} height={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            {mode === "register" && (
              <div>
                <label className={labelClass} htmlFor="auth-name">
                  Full name
                </label>
                <input
                  id="auth-name"
                  className={inputClass}
                  type="text"
                  autoComplete="name"
                  placeholder="Jordan Lee"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className={labelClass} htmlFor="auth-email">
                Work email
              </label>
              <input
                id="auth-email"
                className={inputClass}
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="auth-password">
                Password
              </label>
              <input
                id="auth-password"
                className={inputClass}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {mode === "register" && (
              <div>
                <label className={labelClass} htmlFor="auth-confirm-password">
                  Confirm password
                </label>
                <input
                  id="auth-confirm-password"
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-brand-600 to-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-brand transition-opacity duration-150 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  {mode === "login" ? "Logging in…" : "Creating account…"}
                </>
              ) : (
                <>
                  {mode === "login" ? "Log in" : "Create account"}
                  <IconArrowRight width={15} height={15} />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-500">
            {mode === "login" ? (
              <>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className="font-semibold text-brand-700 hover:text-brand-800"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="font-semibold text-brand-700 hover:text-brand-800"
                >
                  Log in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
