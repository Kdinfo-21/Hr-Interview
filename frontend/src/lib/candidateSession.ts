/**
 * "Candidate lock": once a browser tab opens an interview link, that tab is
 * pinned to the interview until the tab is closed (including after the
 * interview is complete). Typing /login, /admin or any other app URL into that
 * tab sends the candidate straight back to their interview.
 *
 * Opening an interview link also signs out any recruiter session saved in
 * this browser (see AuthContext / CandidateInterview), so a candidate can't
 * reach the dashboard from a fresh tab either.
 *
 * The lock is per-tab (sessionStorage). It is a UX/deterrent layer — the real
 * protection is on the server: every recruiter API requires a valid login and
 * only returns that recruiter's own rows.
 */
const KEY = "hr_active_interview_token";

export function getActiveInterviewToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function lockToInterview(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable (private mode etc.) — lock is best-effort */
  }
}
