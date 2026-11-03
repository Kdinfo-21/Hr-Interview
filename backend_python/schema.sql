-- AI HR Interview Agent — schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- Recruiter/admin accounts for the login + registration screen that gates
-- the dashboard, scheduling, and reporting pages. Candidates are NOT rows in
-- this table — they never log in, they just open their unique
-- interviews.interview_token link, so this table and that flow stay
-- completely separate.
CREATE TABLE IF NOT EXISTS recruiters (
    recruiter_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(200) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, -- bcrypt hash, never the raw password
    created_at TIMESTAMPTZ DEFAULT now(),
    last_login_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_recruiters_email ON recruiters(email);

CREATE TABLE IF NOT EXISTS candidates (
    candidate_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(200),
    email VARCHAR(200) UNIQUE,
    phone VARCHAR(50),
    resume_text TEXT,               -- extracted plain text of the uploaded resume
    resume_filename VARCHAR(300),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- A question_set groups questions generated for a specific role (optionally resume-tailored)
CREATE TABLE IF NOT EXISTS question_sets (
    question_set_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    role_title VARCHAR(200),
    role_description TEXT,
    generated_from_resume BOOLEAN DEFAULT FALSE,
    source_candidate_id INT REFERENCES candidates(candidate_id),
    created_by VARCHAR(200),        -- recruiter identifier
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interviews (
    interview_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_id INT REFERENCES candidates(candidate_id),
    question_set_id INT REFERENCES question_sets(question_set_id), -- optional/legacy; NULL in live-generation mode
    interview_token UUID DEFAULT gen_random_uuid() UNIQUE,
    question_set_name VARCHAR(200),
    role_title VARCHAR(200),        -- light context only — nudges phrasing, does not drive technical depth
    role_context TEXT,              -- optional short blurb, e.g. "fast-paced startup, cross-functional team"
    total_questions INT DEFAULT 6,  -- how many questions the AI interviewer will ask, live, during the session
    status VARCHAR(50) DEFAULT 'PENDING', -- PENDING | SCHEDULED | IN_PROGRESS | PAUSED | COMPLETED | EXPIRED | CANCELLED
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    recruiter_email VARCHAR(200),
    timezone VARCHAR(100) DEFAULT 'UTC',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
    question_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_set_id INT REFERENCES question_sets(question_set_id), -- used only by the legacy pre-built-set flow
    interview_id INT REFERENCES interviews(interview_id),          -- used by the live/adaptive flow: question generated during THIS interview
    question_set_name VARCHAR(200),  -- denormalized for quick lookup / import compatibility
    question_text TEXT NOT NULL,
    question_order INT,
    category VARCHAR(100),          -- Adaptability | Conflict Resolution | Career Goals | Leadership | Team Collaboration | Motivation | Culture Fit | Work Style
    expected_duration_sec INT DEFAULT 120,
    rationale TEXT                  -- why Groq chose this question (kept for recruiter transparency)
);

CREATE INDEX IF NOT EXISTS idx_questions_interview ON questions(interview_id);

CREATE TABLE IF NOT EXISTS responses (
    response_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    interview_id INT REFERENCES interviews(interview_id),
    question_id INT REFERENCES questions(question_id),
    transcript_text TEXT,
    answer_duration_sec INT,
    recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
    score_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    response_id INT REFERENCES responses(response_id),
    communication_score FLOAT,
    confidence_score FLOAT,
    relevance_score FLOAT,
    clarity_score FLOAT,
    blended_confidence_score FLOAT, -- Groq tone x face-api composure weighted blend
    expression_summary_json JSONB,
    groq_raw_response_json JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proctoring_events (
    event_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    interview_id INT REFERENCES interviews(interview_id),
    event_type VARCHAR(50), -- FULLSCREEN_EXIT | TAB_SWITCH | WINDOW_BLUR | RESUME_CLICKED
    event_timestamp TIMESTAMPTZ DEFAULT now(),
    notes VARCHAR(500)
);

-- Idempotent upgrade path: if these tables already existed from an earlier
-- version of this schema (pre-live-question-generation), add the new
-- columns/index rather than failing. Safe to run repeatedly.
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS role_title VARCHAR(200);
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS role_context TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS total_questions INT DEFAULT 6;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS interview_id INT REFERENCES interviews(interview_id);
ALTER TABLE questions ALTER COLUMN question_set_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interviews_token ON interviews(interview_token);
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);
CREATE INDEX IF NOT EXISTS idx_questions_set ON questions(question_set_id);
CREATE INDEX IF NOT EXISTS idx_responses_interview ON responses(interview_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_interview ON proctoring_events(interview_id);

-- ============================================================================
-- Extension pack: resume analyzer, resume/technical-aware question generation,
-- and advanced proctoring enforcement. All additive/idempotent — safe to
-- re-run, and does not remove or rename anything from the base schema.
-- ============================================================================

-- Resume Uploader & Analyzer: structured extraction result (contact info,
-- education, experience, skills, tools, years of experience, projects,
-- achievements) linked to the candidate, plus an upload timestamp.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_analysis JSONB;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_uploaded_at TIMESTAMPTZ;

-- Groq HR + Technical question generator: difficulty + rubric metadata per question.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20); -- easy | medium | hard
ALTER TABLE questions ADD COLUMN IF NOT EXISTS evaluation_rubric TEXT; -- expected answer points, recruiter-facing
ALTER TABLE questions ADD COLUMN IF NOT EXISTS follow_up_probe TEXT;  -- suggested follow-up question

-- Advanced proctoring: warning/enforcement counter + termination bookkeeping on interviews.
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS warning_count INT DEFAULT 0;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS termination_reason VARCHAR(300);
-- status also now takes the value 'TERMINATED' (interviews.status stays free-form VARCHAR,
-- so no constraint migration is required for this new value).

-- Richer proctoring event payloads: detector confidence + arbitrary metadata
-- (e.g. object label, gaze direction, face count, snapshot reference).
ALTER TABLE proctoring_events ADD COLUMN IF NOT EXISTS confidence FLOAT;
ALTER TABLE proctoring_events ADD COLUMN IF NOT EXISTS metadata JSONB;
-- event_type now also takes: MULTIPLE_FACES | PROHIBITED_OBJECT | SUSPICIOUS_GAZE | NAVIGATION_VIOLATION
--   | OUT_OF_FRAME | BACKGROUND_NOISE (soft/ambient warnings — logged but never
--   count toward the 3-warning termination cap; see routes/proctoring.py SOFT_EVENTS)
-- (event_type stays free-form VARCHAR(50), so no constraint migration is required.)

-- ============================================================================
-- Extension pack v2: final practical challenge (code/riddle), scoring
-- integration, and per-role question-repetition history. Additive/idempotent.
-- ============================================================================

-- One final challenge is generated per interview, once all live HR/technical
-- questions have been asked. type = CODE | RIDDLE. For CODE challenges,
-- visible_examples are shown to the candidate as sample input/output; hidden_tests
-- are used only for grading and are NEVER sent to the client.
-- Each interview now gets exactly 2 discrete, separately-answerable challenge
-- parts (part_number 1 and 2), instead of one combined 1-3-part prompt blob.
-- Role-aware split: technical roles get part 1 = TECHNICAL, part 2 =
-- SCENARIO/PROJECT-based; non-technical roles get part 1 = SCENARIO, part 2 =
-- HR/BEHAVIORAL (no forced coding question).
CREATE TABLE IF NOT EXISTS challenges (
    challenge_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    interview_id INT REFERENCES interviews(interview_id), -- 2 rows per interview (one per part_number)
    part_number INT NOT NULL DEFAULT 1, -- 1 or 2
    part_role VARCHAR(30),            -- TECHNICAL | SCENARIO | PROJECT | HR_BEHAVIORAL
    challenge_type VARCHAR(20) NOT NULL, -- CODE | RIDDLE
    title VARCHAR(300) NOT NULL,
    prompt_text TEXT NOT NULL,
    constraints_text TEXT,
    evaluation_criteria TEXT,
    language_options JSONB,          -- e.g. ["Python","JavaScript","Java","Go","Any"] (CODE only)
    visible_examples JSONB,          -- sample input/output shown to the candidate (CODE only)
    hidden_tests JSONB,              -- grading-only input/expected-output pairs (CODE only), never exposed to client
    correct_answer_summary TEXT,     -- grading-only reference answer/reasoning (RIDDLE only), never exposed to client
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(interview_id, part_number)
);
-- Migration for pre-existing databases created before the 2-part restructure:
-- drop the old single-row-per-interview UNIQUE(interview_id) constraint (if
-- present, under its default-generated name) and add the new columns/constraint.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'challenges_interview_id_key'
    ) THEN
        ALTER TABLE challenges DROP CONSTRAINT challenges_interview_id_key;
    END IF;
END $$;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS part_number INT NOT NULL DEFAULT 1;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS part_role VARCHAR(30);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'challenges_interview_id_part_number_key'
    ) THEN
        ALTER TABLE challenges ADD CONSTRAINT challenges_interview_id_part_number_key UNIQUE (interview_id, part_number);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS challenge_submissions (
    submission_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    challenge_id INT REFERENCES challenges(challenge_id),
    interview_id INT REFERENCES interviews(interview_id),
    submitted_language VARCHAR(50),   -- candidate's chosen language (CODE only)
    submitted_answer TEXT NOT NULL,   -- code or riddle answer, as submitted
    auto_eval_score FLOAT,            -- 0-100, LLM-graded correctness/quality composite
    auto_eval_passed BOOLEAN,         -- whether the submission is judged to solve the problem
    auto_eval_feedback TEXT,          -- short rationale, for human reviewers
    auto_eval_per_test_json JSONB,    -- per-hidden-test pass/fail breakdown (CODE only)
    needs_human_review BOOLEAN DEFAULT FALSE, -- flagged when auto-eval is low-confidence
    submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenges_interview ON challenges(interview_id);
CREATE INDEX IF NOT EXISTS idx_challenge_submissions_interview ON challenge_submissions(interview_id);
CREATE INDEX IF NOT EXISTS idx_challenge_submissions_challenge ON challenge_submissions(challenge_id);

-- scores.response_id was previously unindexed even though every dashboard/
-- report query LEFT JOINs scores onto responses on this column — each such
-- join forced a sequential scan of the whole scores table.
CREATE INDEX IF NOT EXISTS idx_scores_response ON scores(response_id);

-- Speeds up "most recent submission per interview" (DISTINCT ON / ORDER BY),
-- used by both the dashboard summary and the single-interview report.
CREATE INDEX IF NOT EXISTS idx_challenge_submissions_interview_submitted
    ON challenge_submissions(interview_id, submitted_at DESC, submission_id DESC);

-- Lightweight per-role question history, used only to reduce repetition across
-- candidates applying to the same role — never used for scoring or grading.
CREATE TABLE IF NOT EXISTS role_question_history (
    history_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_title_normalized VARCHAR(200) NOT NULL,
    question_text TEXT NOT NULL,
    category VARCHAR(100),
    source VARCHAR(20), -- LIVE | SET (which generator produced it)
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_question_history_role ON role_question_history(role_title_normalized, created_at DESC);

-- Final-challenge outcome now also feeds the hiring recommendation; no schema
-- change needed on interviews/scores — scoringService blends it in at read time.

-- ============================================================================
-- Extension pack v3: role/seniority-aware live question generation.
-- Additive/idempotent. Role was already stored (role_title); these add an
-- explicit seniority level + years of experience so difficulty/topic
-- selection can adapt per candidate rather than relying on role text alone.
-- ============================================================================
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS seniority_level VARCHAR(30); -- Intern | Junior | Mid-Level | Senior | Lead/Principal
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS years_of_experience NUMERIC(4,1);

-- ============================================================================
-- Extension pack v4: resume-analysis-linked scheduling. Additive/idempotent.
-- ============================================================================

-- Lets the "Schedule Interview" flow attach a resume's already-extracted
-- structured analysis directly to the interview record at creation time,
-- instead of relying only on a prior separate /resume/upload call.
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS resume_analysis_snapshot JSONB;

-- The candidate-gender / on-camera identity-mismatch review feature (and its
-- expected_gender column + IDENTITY_CHECK_SUMMARY proctoring event) has been
-- removed. Drop the column so re-running this schema on an existing database
-- cleans it up too.
ALTER TABLE interviews DROP COLUMN IF EXISTS expected_gender;

-- ============================================================================
-- Extension pack v5: skill-grounded question generation, global answer-retry
-- allowance, and richer resume-based final-challenge personalization.
-- Additive/idempotent — no existing column, table, or UI field is touched.
-- ============================================================================

-- Which resume skill (or the sentinel '__BEHAVIORAL__' / '__GENERAL__') a
-- given live question targeted. Purely informational/for distribution
-- bookkeeping — nothing reads this to change scoring.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS skill_tag VARCHAR(120);

-- Global (whole-interview, not per-question) allowance for "my answer wasn't
-- captured properly, let me retry" — set once at scheduling from
-- total_questions, and persisted here so it survives page refreshes.
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS retry_limit INT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS retries_used INT DEFAULT 0;

-- ============================================================================
-- Extension pack v6: live camera/object/noise proctoring signals (mobile
-- phone detection, out-of-frame / camera-unavailable / high-background-noise
-- warnings). Additive/idempotent — no existing column, table, or UI field is
-- touched. See routes/proctoring.py for the event-handling logic.
-- ============================================================================

-- Latest object flagged by client-side object detection (e.g. "cell phone"),
-- kept on the interview row so a report can show "Last Object Detected"
-- without re-scanning the whole event log. Updated on every detection tick,
-- even when the corresponding audit-log row insert is deduped (see
-- ROW_DEDUPE_EVENTS in routes/proctoring.py) so it stays reasonably live.
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS last_object_detected VARCHAR(100);
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS last_object_detected_at TIMESTAMPTZ;

-- Whether a human face is currently believed to be in frame. Flips to FALSE
-- when a CANDIDATE_OUT_OF_FRAME warning is logged, and back to TRUE via the
-- status-only CANDIDATE_IN_FRAME signal once the candidate is visible again
-- (that signal only updates this row — it is never written to
-- proctoring_events, so it doesn't clutter the audit log).
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS human_detected BOOLEAN DEFAULT TRUE;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS human_detected_at TIMESTAMPTZ;
-- event_type now also takes: MOBILE_PHONE_DETECTED | CANDIDATE_OUT_OF_FRAME |
-- CAMERA_UNAVAILABLE | HIGH_BACKGROUND_NOISE | CANDIDATE_IN_FRAME (status-only).
-- OUT_OF_FRAME and BACKGROUND_NOISE (from an earlier revision) are superseded
-- by CANDIDATE_OUT_OF_FRAME and HIGH_BACKGROUND_NOISE respectively, but any
-- already-stored rows with the old names are left untouched for history.

-- ============================================================================
-- Extension pack v7: AI-generated final interview assessment. Additive/
-- idempotent. Generated lazily (once) the first time a completed/terminated
-- interview's report is opened — see routes/dashboard.py — and cached here
-- so it's stable across repeat views and doesn't cost a fresh Groq call
-- every time a recruiter reopens the report.
-- ============================================================================
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ai_summary_generated_at TIMESTAMPTZ;
