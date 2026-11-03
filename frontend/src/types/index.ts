export type InterviewStatus =
  | "PENDING"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "PAUSED"
  | "COMPLETED"
  | "EXPIRED"
  | "CANCELLED"
  | "TERMINATED";

export type QuestionCategory =
  | "Adaptability"
  | "Conflict Resolution"
  | "Career Goals"
  | "Leadership"
  | "Team Collaboration"
  | "Motivation"
  | "Culture Fit"
  | "Work Style";

export interface Candidate {
  candidate_id: number;
  name: string;
  email: string;
  phone?: string;
  resume_filename?: string;
  created_at: string;
}

export interface QuestionSet {
  question_set_id: number;
  name: string;
  role_title?: string;
  generated_from_resume: boolean;
  created_at: string;
}

export interface Question {
  question_id: number;
  question_text: string;
  question_order: number;
  category: QuestionCategory;
  expected_duration_sec: number;
  rationale?: string;
}

export interface Interview {
  interview_id: number;
  candidate_id: number;
  interview_token: string;
  role_title?: string;
  role_context?: string;
  seniority_level?: string;
  years_of_experience?: number;
  total_questions: number;
  status: InterviewStatus;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  expires_at?: string;
  candidate_name?: string;
  candidate_email?: string;
  warning_count?: number;
  termination_reason?: string;
  /** Live proctoring status snapshot — see backend routes/proctoring.py. */
  last_object_detected?: string | null;
  last_object_detected_at?: string | null;
  human_detected?: boolean | null;
  human_detected_at?: string | null;
  /** AI-generated final assessment paragraph, lazily generated + cached on
   * first report view once the interview is COMPLETED/TERMINATED and has at
   * least one scored answer — see backend routes/dashboard.py. */
  ai_summary?: string | null;
  ai_summary_generated_at?: string | null;
}

/** A single live-generated question, returned by /interviews/token/:token/next-question */
export interface LiveQuestion {
  question_id: number;
  question_text: string;
  category: QuestionCategory | string;
  expected_duration_sec: number;
  question_order: number;
}

export interface ExpressionSample {
  timestamp_ms: number;
  expressions: Record<string, number>;
}

export interface ScoreResult {
  communication_score: number;
  confidence_score: number;
  relevance_score: number;
  clarity_score: number;
  blended_confidence_score: number;
}

/** Structured resume analysis returned by POST /api/resume/upload */
export interface ResumeAnalysis {
  contact: { full_name?: string; email?: string; phone?: string; location?: string; linkedin?: string };
  education: Array<{ institution?: string; degree?: string; field_of_study?: string; start_year?: string; end_year?: string }>;
  experience: Array<{ company?: string; title?: string; start_date?: string; end_date?: string; duration_months?: number; summary?: string; achievements?: string[] }>;
  technical_skills: string[];
  soft_skills: string[];
  tools_and_frameworks: string[];
  domains: string[];
  total_years_experience: number | null;
  notable_projects: Array<{ name?: string; description?: string; technologies?: string[] }>;
  achievements: string[];
  summary: string;
}

/** Client-safe shape of one final-challenge part, as sent to the candidate (no grading-only fields).
 * There are always exactly 2 parts per interview (part_number 1 and 2). */
export interface ChallengeForCandidate {
  challenge_id: number;
  part_number: 1 | 2;
  part_role: "TECHNICAL" | "PROJECT" | "SCENARIO" | "HR_BEHAVIORAL" | string;
  challenge_type: "CODE" | "RIDDLE";
  title: string;
  prompt_text: string;
  constraints_text?: string;
  evaluation_criteria?: string;
  language_options: string[];
  visible_examples: { input: string; output: string }[];
}

/** Full challenge row as returned on the recruiter-facing report (includes grading-only fields). */
export interface ChallengeReportRow extends ChallengeForCandidate {
  interview_id: number;
  hidden_tests?: { input: string; expected_output: string }[];
  correct_answer_summary?: string;
  created_at: string;
}

export interface ChallengeSubmissionReportRow {
  submission_id: number;
  challenge_id: number;
  submitted_language?: string;
  submitted_answer: string;
  auto_eval_score: number | null;
  auto_eval_passed: boolean | null;
  auto_eval_feedback: string | null;
  auto_eval_per_test_json?: { input: string; expected_output: string; verdict: string; note: string }[];
  needs_human_review: boolean;
  submitted_at: string;
}

export interface DashboardReport {
  interview: Interview;
  challenge_effect?: string;
  recommendation_overridden?: boolean;
  recommendation_note?: string | null;
  challenge?: ChallengeReportRow | null;
  challenge_submission?: ChallengeSubmissionReportRow | null;
  /** Both challenge parts (part_number 1 and 2) with each one's latest submission. */
  challenges?: Array<{ challenge: ChallengeReportRow | null; submission: ChallengeSubmissionReportRow | null }>;
  questions: Array<{
    response_id: number;
    question_id: number;
    question_text: string;
    category: QuestionCategory;
    transcript_text: string;
    communication_score: number | null;
    confidence_score: number | null;
    relevance_score: number | null;
    clarity_score: number | null;
    blended_confidence_score: number | null;
  }>;
  averages: {
    communication_score: number;
    confidence_score: number;
    blended_confidence_score: number;
    relevance_score: number;
    clarity_score: number;
  };
  overall_score: number;
  recommendation: string;
  proctoring_events: Array<{ event_id: number; event_type: string; event_timestamp: string; notes?: string }>;
  proctoring_violation_count: number;
}
