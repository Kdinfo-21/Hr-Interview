const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api";

// In-memory copy of the recruiter's session token. AuthContext is the
// source of truth (it also mirrors the token to localStorage so a page
// refresh doesn't log the user out) — this module just needs a synchronous
// place to read it from when building request headers.
let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

// Fired whenever a request comes back 401 (expired/invalid/missing session
// token) so AuthContext can clear its state and redirect to /login, without
// this module needing to import React or the router.
export const AUTH_UNAUTHORIZED_EVENT = "auth:unauthorized";

// fetch() throws a bare `TypeError: Failed to fetch` when the request never
// even reaches a server — backend not running, wrong port/URL, or a CORS
// origin mismatch. That raw message tells the user nothing actionable, so
// every call in this file goes through this wrapper to turn it into a
// message that names the URL that couldn't be reached.
async function doFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  try {
    return await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    throw new Error(
      `Could not reach the backend at ${API_BASE}${path}. Is it running, and does VITE_API_BASE_URL ` +
        `in frontend/.env point at the right port?`
    );
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await doFetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Same as `request`, but also returns the X-Total-Count header (used by the
// paginated dashboard summary endpoint for a "Load more" control).
async function requestWithCount<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T; total: number | null }> {
  const res = await doFetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.detail || `Request failed: ${res.status}`);
  }
  const totalHeader = res.headers.get("X-Total-Count");
  const data = (await res.json()) as T;
  return { data, total: totalHeader ? Number(totalHeader) : null };
}

export interface Recruiter {
  recruiter_id: number;
  name: string;
  email: string;
}

export const api = {
  // Auth (recruiter login / registration)
  register: (payload: { name: string; email: string; password: string }) =>
    request<{ token: string; recruiter: Recruiter }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    request<{ token: string; recruiter: Recruiter }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  me: () => request<Recruiter>("/auth/me"),


  // Candidates
  listCandidates: () => request<any[]>("/candidates"),
  createCandidate: (payload: any) => request<any>("/candidates", { method: "POST", body: JSON.stringify(payload) }),

  // Question sets
  listQuestionSets: () => request<any[]>("/question-sets"),
  getQuestionSet: (id: number) => request<any>(`/question-sets/${id}`),
  generateQuestionSet: (payload: {
    role_title: string;
    role_description: string;
    resume_text?: string;
    candidate_id?: number;
    set_name?: string;
  }) => request<any>("/question-sets/generate", { method: "POST", body: JSON.stringify(payload) }),
  importQuestionSet: (payload: any) =>
    request<any>("/question-sets/import", { method: "POST", body: JSON.stringify(payload) }),

  // Interviews (recruiter)
  scheduleInterview: (payload: any) => request<any>("/interviews", { method: "POST", body: JSON.stringify(payload) }),
  listInterviews: (status?: string) => request<any[]>(`/interviews${status ? `?status=${status}` : ""}`),
  cancelInterview: (id: number) => request<any>(`/interviews/${id}/cancel`, { method: "POST" }),

  // Interviews (candidate, token-based)
  getInterviewByToken: (token: string) => request<any>(`/interviews/token/${token}`),
  getNextQuestion: (token: string) => request<any>(`/interviews/token/${token}/next-question`, { method: "POST" }),
  useAnswerRetry: (token: string) =>
    request<{ retries_used: number; retry_limit: number; retries_remaining: number }>(
      `/interviews/token/${token}/use-retry`,
      { method: "POST" }
    ),
  startInterview: (token: string) => request<any>(`/interviews/token/${token}/start`, { method: "POST" }),
  completeInterview: (token: string) => request<any>(`/interviews/token/${token}/complete`, { method: "POST" }),
  pauseInterview: (token: string) => request<any>(`/interviews/token/${token}/pause`, { method: "POST" }),
  resumeInterview: (token: string) => request<any>(`/interviews/token/${token}/resume`, { method: "POST" }),

  // Responses
  submitResponse: (token: string, payload: any) =>
    request<any>(`/responses/token/${token}`, { method: "POST", body: JSON.stringify(payload) }),
  getInterviewResponses: (interviewId: number) => request<any[]>(`/responses/interview/${interviewId}`),

  // Proctoring
  logProctoringEvent: (
    token: string,
    payload: { event_type: string; notes?: string; confidence?: number; metadata?: Record<string, unknown> }
  ) =>
    request<{ event: any; warning_count: number; max_warnings: number; terminated: boolean; is_soft?: boolean }>(
      `/proctoring/token/${token}`,
      { method: "POST", body: JSON.stringify(payload) }
    ),

  // Live YOLO proctoring. Sends a real JPEG frame to the Python backend.
  detectProctoringFrame: async (token: string, blob: Blob) => {
    const form = new FormData();
    form.append("frame", blob, "camera.jpg");
    const res = await doFetch(`/proctoring/detect/token/${token}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.detail || `Proctoring detection failed: ${res.status}`);
    }
    return res.json() as Promise<{
      active: boolean;
      model: string;
      phone_detected: boolean;
      phone_confidence: number;
      person_count: number;
      human_detected: boolean;
      candidate_in_frame: boolean;
      detections: Array<{ label: string; confidence: number; bbox: number[] }>;
    }>;
  },

  // Dashboard
  getInterviewReport: (id: number) => request<any>(`/dashboard/interview/${id}`),
  // limit/offset are optional — omitting them keeps the backend's own default
  // page size. Returns the total interview count (from X-Total-Count) so the
  // dashboard can show a "Load more" control.
  getDashboardSummary: (limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (limit != null) params.set("limit", String(limit));
    if (offset != null) params.set("offset", String(offset));
    const qs = params.toString();
    return requestWithCount<any[]>(`/dashboard/summary${qs ? `?${qs}` : ""}`);
  },

  // Final practical challenge (code or riddle), candidate-facing.
  // Always returns exactly 2 discrete parts (part_number 1 and 2).
  generateChallenge: (token: string) =>
    request<{
      challenges: import("../types").ChallengeForCandidate[];
      challenge: import("../types").ChallengeForCandidate | null;
    }>(`/challenges/token/${token}/generate`, {
      method: "POST",
    }),
  submitChallenge: (token: string, payload: { challenge_id: number; language?: string; answer: string }) =>
    request<{ submitted: boolean; submission_id: number }>(`/challenges/token/${token}/submit`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Resume upload & analysis
  uploadResume: async (payload: {
    file: File;
    candidate_name?: string;
    candidate_email?: string;
    candidate_phone?: string;
  }) => {
    const form = new FormData();
    form.append("file", payload.file);
    if (payload.candidate_name) form.append("candidate_name", payload.candidate_name);
    if (payload.candidate_email) form.append("candidate_email", payload.candidate_email);
    if (payload.candidate_phone) form.append("candidate_phone", payload.candidate_phone);

    const res = await doFetch("/resume/upload", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.detail || `Resume upload failed: ${res.status}`);
    }
    return res.json() as Promise<{
      candidate: any;
      resume_analysis: import("../types").ResumeAnalysis;
      message?: string;
    }>;
  },

  // Analyze a resume WITHOUT creating a candidate record — used by the
  // Schedule Interview screen to auto-fill name/email/experience before the
  // interview is actually scheduled.
  analyzeResume: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await doFetch("/resume/analyze", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.detail || `Resume analysis failed: ${res.status}`);
    }
    return res.json() as Promise<{
      resume_text: string;
      resume_filename: string;
      resume_analysis: import("../types").ResumeAnalysis;
      message?: string;
    }>;
  },
};
