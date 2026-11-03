# AI HR Interview Agent

Production-ready scaffold for an AI-powered HR interview platform.

## Capabilities
- **Recruiter/Admin panel** — manage roles, upload a candidate resume, auto-generate a tailored question set (Groq), schedule interviews, and issue time-bound shareable UUID links.
- **Candidate flow** — consent screen → forced fullscreen → live Web Speech API transcription → face-api.js expression sampling → strict proctoring (fullscreen exit / tab switch / window blur / multiple faces / prohibited objects / suspicious gaze / navigation violations).
- **Scoring pipeline** — Groq structured JSON scoring (communication, confidence, relevance, clarity) blended with facial composure metrics, persisted to Neon Postgres.
- **Reporting dashboard** — Recharts visualizations + proctoring audit log + hiring recommendation per interview.

## Extension pack (this revision)
1. **Resume Uploader & Analyzer** — `POST /api/resume/upload` (multipart) accepts a PDF/DOCX resume, extracts plain text server-side (`pdf-parse` / `mammoth`), then runs it through Groq to produce a structured profile: contact info, education, work experience, technical + soft skills, tools/frameworks, domains, total years of experience, notable projects, and achievements. Stored on `candidates.resume_analysis` (JSONB), linked to the candidate by email. A minimal, clearly-separated "Resume" upload block was added to the existing Schedule Interview form (no other screens changed).
2. **Groq HR + Technical Question Generator** — `POST /api/question-sets/generate` (pre-existing endpoint, extended) now accepts a `candidate_id` and automatically pulls that candidate's structured resume analysis to generate a balanced HR/behavioral + technical question set tailored to the role *and* the candidate's actual claimed skills, with difficulty levels (easy/medium/hard), a suggested follow-up probe, and an evaluation rubric per question. Nothing about the existing live/adaptive HR-only interview flow (`liveInterviewService.ts`) was changed — this plugs into the separate, pre-existing question-set generation path.
3. **Advanced Proctoring** —
   - *Multiple face detection*: `useFaceApi` now runs `detectAllFaces`; more than one face fires `MULTIPLE_FACES`.
   - *Object detection*: a new `useObjectDetection` hook loads TensorFlow.js + `coco-ssd` client-side and scans for a configurable prohibited-object list (phone, book, laptop, tv, remote, tablet by default), firing `PROHIBITED_OBJECT`.
   - *Eye gaze tracking*: a landmark-based heuristic (eye-line midpoint vs. nose-bridge offset) in `useFaceApi` estimates gaze direction; sustained (4s+) off-center gaze fires `SUSPICIOUS_GAZE`.
   - *Tab switch / fullscreen exit / new-tab attempts*: existing `FULLSCREEN_EXIT` / `TAB_SWITCH` / `WINDOW_BLUR` checks, plus a new `NAVIGATION_VIOLATION` check for common new-tab/new-window keyboard shortcuts.
4. **Warning & Enforcement Logic** — every violation is logged with type, timestamp, confidence, and metadata (`proctoring_events`). The warning counter and the "4th violation terminates the interview" rule are enforced **server-side**, inside a locked transaction (`routes/proctoring.ts`), so a compromised client can under-report violations but can never push the count past the real cap. Up to 3 warnings: the interview pauses with a non-blocking overlay and resumes on request. On the 4th: the interview is auto-marked `TERMINATED`, `completed_at`/`termination_reason` are stamped, and `tokenGuard` rejects all further candidate-facing requests (start/next-question/submit/resume) for that interview — question progression is blocked at the API layer, not just in the UI.

None of the pre-existing UI screens, layouts, or visual design were redesigned. The only new UI surface is the small "Resume" upload block on the Schedule Interview page, plus in-place extensions of the proctoring overlay/audit log that already existed for this purpose.

## Extension pack v2 (this revision)
The v1 extension pack above covered resume analysis, a *pre-built* resume-aware question set generator (`questionGenService.ts` / `question_sets`), and advanced proctoring. On review, the actual **live/adaptive interview flow** candidates go through (`liveInterviewService.ts`) was still HR-only and resume-blind, and there was no final practical challenge, hireability boost, or cross-candidate question-repetition control. This revision closes those gaps:

5. **Resume-aware live interview** — `liveInterviewService.ts` now fetches the candidate's `resume_analysis` and mixes **Resume Deep-Dive**, **Technical**, and **Situational** questions in alongside the original 8 HR/behavioral categories, gated so technical questions only appear when the role/resume actually indicate technical skills. Shared resume-summarization logic was extracted to `services/resumeSummary.ts` so the live flow, the pre-built set generator, and the new challenge generator stay consistent.
6. **Final practical challenge** — once all live questions are answered, `POST /api/challenges/token/:token/generate` (idempotent per interview) has Groq design a CODE or RIDDLE challenge tailored to the role and resume. Coding challenges are language-agnostic (input/output contract, not tied to one language's syntax), with 1-2 visible examples shown to the candidate and 2-4 hidden test cases used only for grading. `POST /api/challenges/token/:token/submit` accepts the candidate's language + answer/code. **Candidate code is never executed server-side** (a deliberate security choice — running arbitrary submitted code in arbitrary languages is a real code-execution risk); instead Groq grades the submission by reasoning through the logic against the hidden tests, producing a score, pass/fail verdict, and reviewer-facing feedback. If auto-evaluation fails outright, the raw submission is still saved and flagged `needs_human_review` rather than lost.
7. **Hireability scoring integration** — `computeRecommendation()` in `scoringService.ts` now optionally takes the challenge outcome: solving it applies a flat hireability boost plus a higher blend weight; a partial/failed attempt still contributes at a lower weight, with the rest of the interview responses carrying the recommendation as before; no challenge on record leaves scoring behavior unchanged (backward compatible).
8. **Cross-candidate question-repetition control** — a new `role_question_history` table (see `services/questionHistoryService.ts`) records every question generated per role, live or pre-built. Both generators now receive a "previously asked for this role" list in their Groq prompt and are instructed to avoid repeating or closely paraphrasing it.

New minimal, isolated UI: a `ChallengeCard` component (styled identically to the existing `QuestionCard`) and a new `challenge` stage inserted between the last interview question and the completion screen in `CandidateInterview.tsx`; a "Final Challenge" section was added to `ReportDashboard.tsx` using the existing card/badge primitives. No existing component was redesigned.

### New environment/setup notes for v2
- Run `npm run migrate` again after pulling this revision — the v2 tables (`challenges`, `challenge_submissions`, `role_question_history`) are additive and idempotent, same as v1.
- No new environment variables are required; v2 reuses the existing `GROQ_API_KEY` / `GROQ_MODEL`.
- `backend_python` and `frontend` both type-check/compile clean as of this revision.

## Stack
Frontend: React + TypeScript + Vite + Tailwind + Recharts + face-api.js + Web Speech API
Backend: Python + FastAPI + SQLAlchemy (Neon Postgres)
AI: Groq API (server-side only, never exposed to the client)

## Structure
```
backend_python/
  app/
    db/            SQLAlchemy engine + database helpers
    services/      ai_service, resume_service, resume_summary, challenge_service
    routes/        candidates, question_sets, interviews, responses, proctoring, dashboard, resume, challenges
    dependencies.py  interview-token lookup/guard helpers
    config.py / main.py
  schema.sql        idempotent schema (safe to re-run any time)
  init_db.py        applies schema.sql against DATABASE_URL
frontend/
  src/
    pages/         AdminDashboard, ScheduleInterview, CandidateInterview, ReportDashboard
    components/    ProctoringOverlay, FaceAnalyzer, QuestionCard, ScoreCharts
    hooks/         useSpeechRecognition, useFaceApi, useFullscreen, useProctoring
    api/           typed fetch client
    types/
```

## Environment variables (backend_python/.env)
```
DATABASE_URL=postgresql+psycopg://<user>:<pass>@<neon-host>/<db>?sslmode=require
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
FRONTEND_BASE_URL=http://localhost:5173
BACKEND_BASE_URL=http://localhost:8000
```

## Environment variables (frontend/.env)
```
VITE_API_BASE_URL=http://localhost:8000/api
```

## Setup
```bash
# backend
cd backend_python
python3 -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # then fill in DATABASE_URL and GROQ_API_KEY
python init_db.py      # applies schema.sql against DATABASE_URL (safe to re-run)
uvicorn app.main:app --reload --port 8000

# frontend (in a separate terminal)
cd frontend
npm install
echo "VITE_API_BASE_URL=http://localhost:8000/api" > .env
npm run dev
```
Place face-api.js tiny model weights (`tiny_face_detector`, `face_expression`, `face_landmark_68_tiny`) in `frontend/public/models/` — see `frontend/public/models/README.txt`. The `face_landmark_68_tiny` weights are optional (only needed for gaze tracking); everything else degrades gracefully without them. The object-detection model (`@tensorflow-models/coco-ssd`, used for `PROHIBITED_OBJECT` / `MOBILE_PHONE_DETECTED` / the person-count contribution to `MULTIPLE_FACES`) downloads its own weights automatically from a CDN the first time an interview starts — no manual model file or extra `npm install` step needed.

## Three capabilities beyond the base spec
1. **Scheduling** — `POST /api/interviews` creates/reuses a candidate, attaches a question set, sets `scheduled_at` / `expires_at`, and returns a shareable `interview_token` link. `GET /api/interviews` lists upcoming/expired interviews for the admin calendar view.
2. **Role + resume based question generation** — `POST /api/question-sets/generate` accepts a role title/description plus resume text (pasted or extracted server-side from an uploaded PDF/DOCX), and prompts Groq to produce a structured, resume-aware question set (behavioral, technical, and resume-gap-probing questions), persisted for reuse across many candidates.
3. **Evaluation** — Groq scoring blended with face-api confidence metrics plus `GET /api/dashboard/interview/:id`, which aggregates per-question scores into an overall weighted recommendation (Strong Hire / Hire / Borderline / No Hire).

## Security notes
- Groq API key is used **only** server-side (`app/services/ai_service.py`); never sent to the frontend.
- Candidate-facing routes are guarded by `interview_token` (UUID) + expiry check, not a login — treat the token as a bearer credential and only send it over HTTPS links.
- All SQL uses parameterized queries via SQLAlchemy — no string-interpolated SQL anywhere in this scaffold.

## Note on the object-detection engine
`frontend/src/hooks/useObjectDetection.ts` runs on TensorFlow.js + `coco-ssd` (the original, proven implementation). An earlier revision briefly replaced this with a nano YOLO model via ONNX Runtime Web, but that approach required (a) manually exporting and placing a custom `yolov8n.onnx` model file — a step easy to miss, which silently disabled all object detection — and (b) a WASM/ESM loader file that Vite's dev server refuses to serve via a JS `import()` when it lives under `/public` ("This file is in /public and will be copied as-is... and therefore should not be imported from source code"), crashing the app on load. `coco-ssd` avoids both problems: its weights are fetched automatically over the network the first time an interview starts, with zero manual setup and no bundler-specific configuration. Detection still runs entirely client-side (no camera frames ever leave the browser) on the same ~2.5s polling interval, and the hook's public interface — and everything downstream of it (`useProctoring.ts`'s event names/cooldowns/dedupe, `CandidateInterview.tsx`, `ProctoringOverlay.tsx`/`ProctoringBanner.tsx`, the backend proctoring routes, and the DB schema) — is unchanged.
