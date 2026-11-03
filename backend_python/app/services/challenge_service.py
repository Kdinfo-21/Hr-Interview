
import json
from app.db.database import fetch_all, fetch_one, execute
from app.services.ai_service import _chat_json
from app.services.resume_summary import build_resume_context, infer_question_difficulty, resume_skill_list


# Rough signal for whether the role is technical/engineering/data in nature.
# Used only to decide the SHAPE of the two challenge parts (see below) — not
# used for scoring or question generation elsewhere.
_TECHNICAL_ROLE_KEYWORDS = (
    "engineer", "developer", "programmer", "software", "backend", "frontend",
    "full stack", "full-stack", "devops", "sre", "data scien", "data engineer",
    "machine learning", "ml ", "ai ", "qa", "quality assurance", "sdet",
    "architect", "sysadmin", "system administrator", "security engineer",
    "cloud", "infrastructure", "database administrator", "dba", "analyst",
    "data analyst", "mobile developer", "ios developer", "android developer",
)


def _is_technical_role(role_title, resume_analysis):
    text = (role_title or "").lower()
    if any(k in text for k in _TECHNICAL_ROLE_KEYWORDS):
        return True
    skills = resume_skill_list(resume_analysis) if resume_analysis else []
    return len(skills) >= 3


GENERATE_SYSTEM_PROMPT_TECHNICAL = """
You design the FINAL practical challenge for a job interview. The role is TECHNICAL/ENGINEERING/DATA
in nature. You must produce EXACTLY 2 separate, independently-answerable challenge parts:

- PART 1 (part_role = "TECHNICAL"): a small coding problem OR a concrete applied technical
  scenario, grounded in a skill/tool actually on the candidate's resume. Prefer real code problems
  when the resume shows programming/engineering skills.
- PART 2 (part_role = "PROJECT" or "SCENARIO"): a realistic situation tied to one of the candidate's
  actual resume projects/roles, requiring them to reason through a decision, trade-off, or design
  choice. This part is NOT a coding problem -- it is answered in prose.

Scale complexity to the candidate's experience level (provided below): fresher/intermediate ->
practical, project-based, intermediate-difficulty; senior/advanced -> complex real-world scenarios,
architecture/design trade-offs, ownership/leadership situations, advanced troubleshooting.

AVOID generic prompts like "What is Python?" or "Tell me about yourself" -- each part must
reference the candidate's actual resume content (a named skill, project, or role) explicitly,
e.g. "You mentioned working with X in Y project. How would you approach...".

For PART 1, if it is a CODE problem:
- Language-agnostic problem statement (not tied to one language's syntax).
- Include 1-2 visible examples and 2-4 hidden tests.
- Include clear constraints and evaluation criteria.
- Include 4-6 language options.
If PART 1 is an applied technical scenario (not code), or for PART 2 (always non-code):
- language_options, visible_examples and hidden_tests must be empty arrays.
- correct_answer_summary contains the reasoning/expected approach, for grading only.

Return ONLY JSON with exactly this shape:
{
  "parts": [
    {
      "part_role": "TECHNICAL",
      "challenge_type": "CODE" or "RIDDLE",
      "title": "...",
      "prompt_text": "...",
      "constraints_text": "...",
      "evaluation_criteria": "...",
      "language_options": [],
      "visible_examples": [{"input": "...", "output": "..."}],
      "hidden_tests": [{"input": "...", "expected_output": "..."}],
      "correct_answer_summary": "..."
    },
    {
      "part_role": "PROJECT",
      "challenge_type": "RIDDLE",
      "title": "...",
      "prompt_text": "...",
      "constraints_text": "...",
      "evaluation_criteria": "...",
      "language_options": [],
      "visible_examples": [],
      "hidden_tests": [],
      "correct_answer_summary": "..."
    }
  ]
}
""".strip()

GENERATE_SYSTEM_PROMPT_NON_TECHNICAL = """
You design the FINAL practical challenge for a job interview. The role is NON-TECHNICAL in nature.
You must produce EXACTLY 2 separate, independently-answerable challenge parts. Neither part is a
coding problem -- zero coding questions for non-technical roles.

- PART 1 (part_role = "SCENARIO"): a realistic case-style situation tied to the candidate's actual
  resume/experience, requiring them to reason through a decision or trade-off relevant to the role.
- PART 2 (part_role = "HR_BEHAVIORAL"): a behavioral/judgment question relevant to the role --
  teamwork, ownership, prioritization, conflict, leadership (weight this more for senior/lead
  candidates).

Scale complexity to the candidate's experience level (provided below): fresher/intermediate ->
practical, grounded scenarios; senior/advanced -> complex real-world trade-offs, ownership/
leadership situations.

AVOID generic prompts like "Tell me about yourself" -- each part must reference the candidate's
actual resume content (a named skill, project, or role) explicitly where possible.

Both parts are answered in prose (never code):
- language_options, visible_examples and hidden_tests must be empty arrays for both parts.
- correct_answer_summary contains the reasoning/expected approach for grading only.

Return ONLY JSON with exactly this shape:
{
  "parts": [
    {
      "part_role": "SCENARIO",
      "challenge_type": "RIDDLE",
      "title": "...",
      "prompt_text": "...",
      "constraints_text": "...",
      "evaluation_criteria": "...",
      "language_options": [],
      "visible_examples": [],
      "hidden_tests": [],
      "correct_answer_summary": "..."
    },
    {
      "part_role": "HR_BEHAVIORAL",
      "challenge_type": "RIDDLE",
      "title": "...",
      "prompt_text": "...",
      "constraints_text": "...",
      "evaluation_criteria": "...",
      "language_options": [],
      "visible_examples": [],
      "hidden_tests": [],
      "correct_answer_summary": "..."
    }
  ]
}
""".strip()

EVAL_SYSTEM_PROMPT = """
You are grading a candidate's final interview challenge submission (one part of a 2-part challenge).
Do not execute code. Reason through it manually.

Return ONLY JSON:
{
  "score": 0-100,
  "passed": true/false,
  "feedback": "2-4 concise evidence-based sentences",
  "per_test_results": [
    {"input":"...","expected_output":"...","verdict":"PASS|FAIL|N/A","note":"..."}
  ],
  "low_confidence": true/false
}
""".strip()


def _safe_list(value):
    return value if isinstance(value, list) else []


def _client_challenge(row):
    return {
        "challenge_id": row["challenge_id"],
        "part_number": row.get("part_number", 1),
        "part_role": row.get("part_role"),
        "challenge_type": row["challenge_type"],
        "title": row["title"],
        "prompt_text": row["prompt_text"],
        "constraints_text": row.get("constraints_text"),
        "evaluation_criteria": row.get("evaluation_criteria"),
        "language_options": _safe_list(row.get("language_options")),
        "visible_examples": _safe_list(row.get("visible_examples")),
    }


def _fallback_parts(role_title, technical):
    """Deterministic fallback so the candidate is never left on a blank final step."""
    role = role_title or "the role"
    if technical:
        return [
            {
                "part_role": "TECHNICAL",
                "challenge_type": "CODE",
                "title": f"First Non-Repeating Character — {role}",
                "prompt_text": (
                    "Given a string, return the first character that appears exactly once. "
                    "If every character appears more than once, return '-'. "
                    "Treat uppercase and lowercase letters as different characters."
                ),
                "constraints_text": (
                    "Input length is 1 to 100,000 characters. "
                    "Target O(n) time complexity and O(n) additional space. "
                    "Handle spaces and punctuation as normal characters."
                ),
                "evaluation_criteria": "Correctness, O(n) efficiency, readability, and edge-case handling.",
                "language_options": ["Python", "JavaScript", "Java", "C++", "C", "Any other language"],
                "visible_examples": [
                    {"input": "swiss", "output": "w"},
                    {"input": "aabbcc", "output": "-"},
                ],
                "hidden_tests": [
                    {"input": "leetcode", "expected_output": "l"},
                    {"input": "aabbcddee", "expected_output": "c"},
                    {"input": "x", "expected_output": "x"},
                    {"input": "aabb", "expected_output": "-"},
                ],
                "correct_answer_summary": "Count characters, then scan from left to right and return the first count of one.",
            },
            {
                "part_role": "PROJECT",
                "challenge_type": "RIDDLE",
                "title": f"Trade-off Review — {role}",
                "prompt_text": (
                    "Pick a project from your resume you're proud of. Describe one significant "
                    "technical trade-off you made on it (e.g. speed vs. accuracy, cost vs. "
                    "reliability, simplicity vs. flexibility), why you chose the way you did, and "
                    "what you would reconsider today with what you now know."
                ),
                "constraints_text": "Answer in prose; no code required.",
                "evaluation_criteria": "Depth of reasoning, ownership, awareness of trade-offs, and clarity of communication.",
                "language_options": [],
                "visible_examples": [],
                "hidden_tests": [],
                "correct_answer_summary": (
                    "A strong answer names a concrete, specific trade-off (not generic), explains "
                    "the reasoning behind the choice made at the time, and shows honest reflection "
                    "on what might be done differently now."
                ),
            },
        ]
    return [
        {
            "part_role": "SCENARIO",
            "challenge_type": "RIDDLE",
            "title": f"Judgment Call — {role}",
            "prompt_text": (
                "You're midway through an important deliverable when a higher-priority request "
                "lands from another stakeholder with a tight deadline. Walk through how you would "
                "assess and handle this, and what you would communicate to each side."
            ),
            "constraints_text": "Answer in prose.",
            "evaluation_criteria": "Prioritization, stakeholder communication, and practical judgment.",
            "language_options": [],
            "visible_examples": [],
            "hidden_tests": [],
            "correct_answer_summary": (
                "A strong answer triages by impact/urgency, communicates proactively with both "
                "stakeholders, and proposes a concrete resolution rather than avoiding the conflict."
            ),
        },
        {
            "part_role": "HR_BEHAVIORAL",
            "challenge_type": "RIDDLE",
            "title": f"Working With Others — {role}",
            "prompt_text": (
                "Tell me about a time you disagreed with a teammate or manager on how to approach "
                "something. What did you do, and how did it turn out?"
            ),
            "constraints_text": "Answer in prose.",
            "evaluation_criteria": "Self-awareness, communication, and constructive conflict-handling.",
            "language_options": [],
            "visible_examples": [],
            "hidden_tests": [],
            "correct_answer_summary": (
                "A strong answer describes a specific real disagreement, how it was raised "
                "constructively, and a concrete resolution or lesson learned."
            ),
        },
    ]


def get_or_generate_challenge(
    interview_id: int,
    candidate_id: int,
    role_title=None,
    role_context=None,
    years_of_experience=None,
    resume_analysis=None,
):
    """Returns exactly 2 challenge parts for this interview, generating + persisting
    them (2 rows, part_number 1 and 2) on first call, or returning the existing
    2 rows on subsequent calls (idempotent per interview)."""
    existing = fetch_all(
        "SELECT * FROM challenges WHERE interview_id = :interview_id ORDER BY part_number",
        {"interview_id": interview_id},
    )
    if existing and len(existing) >= 2:
        return [_client_challenge(r) for r in existing[:2]]

    candidate = fetch_one(
        "SELECT name, resume_text, resume_analysis FROM candidates WHERE candidate_id = :candidate_id",
        {"candidate_id": candidate_id},
    ) or {}

    analysis = resume_analysis or candidate.get("resume_analysis")
    resume_context = build_resume_context(candidate.get("resume_text"), analysis)
    difficulty = infer_question_difficulty(years_of_experience)
    experience_line = (
        f"{years_of_experience} years of claimed experience ({difficulty} difficulty band)"
        if years_of_experience is not None
        else f"experience level not specified ({difficulty} difficulty band by default)"
    )

    technical = _is_technical_role(role_title, analysis)
    system_prompt = GENERATE_SYSTEM_PROMPT_TECHNICAL if technical else GENERATE_SYSTEM_PROMPT_NON_TECHNICAL

    user_prompt = f"""
ROLE: {role_title or "Unspecified"}
ROLE CONTEXT: {role_context or "Not provided"}
CANDIDATE: {candidate.get("name") or "Candidate"}
CANDIDATE EXPERIENCE: {experience_line}
RESUME CONTEXT (use this to name specific skills/projects in the challenge):
{resume_context[:20000] or "No resume available."}
""".strip()

    generated = None
    try:
        generated = _chat_json(system_prompt, user_prompt, 3500)
    except Exception:
        generated = None

    parts = None
    if isinstance(generated, dict):
        candidate_parts = generated.get("parts")
        if isinstance(candidate_parts, list) and len(candidate_parts) >= 2:
            parts = candidate_parts[:2]

    if not parts:
        parts = _fallback_parts(role_title, technical)

    rows = []
    # If a stale single row already exists from before the 2-part migration,
    # clear it so we cleanly insert both parts.
    if existing:
        execute("DELETE FROM challenges WHERE interview_id = :interview_id", {"interview_id": interview_id})

    for idx, part in enumerate(parts[:2], start=1):
        challenge_type = str(part.get("challenge_type", "RIDDLE")).upper()
        if challenge_type not in ("CODE", "RIDDLE"):
            challenge_type = "RIDDLE"
        part_role = str(part.get("part_role") or ("TECHNICAL" if idx == 1 and technical else "SCENARIO")).upper()
        row = execute(
            """
            INSERT INTO challenges
            (interview_id, part_number, part_role, challenge_type, title, prompt_text,
             constraints_text, evaluation_criteria, language_options, visible_examples,
             hidden_tests, correct_answer_summary)
            VALUES
            (:interview_id, :part_number, :part_role, :challenge_type, :title, :prompt_text,
             :constraints_text, :evaluation_criteria, :language_options, :visible_examples,
             :hidden_tests, :correct_answer_summary)
            ON CONFLICT (interview_id, part_number) DO UPDATE SET
                part_role = EXCLUDED.part_role,
                challenge_type = EXCLUDED.challenge_type,
                title = EXCLUDED.title,
                prompt_text = EXCLUDED.prompt_text,
                constraints_text = EXCLUDED.constraints_text,
                evaluation_criteria = EXCLUDED.evaluation_criteria,
                language_options = EXCLUDED.language_options,
                visible_examples = EXCLUDED.visible_examples,
                hidden_tests = EXCLUDED.hidden_tests,
                correct_answer_summary = EXCLUDED.correct_answer_summary
            RETURNING *
            """,
            {
                "interview_id": interview_id,
                "part_number": idx,
                "part_role": part_role,
                "challenge_type": challenge_type,
                "title": str(part.get("title"))[:300],
                "prompt_text": str(part.get("prompt_text")),
                "constraints_text": part.get("constraints_text") or None,
                "evaluation_criteria": part.get("evaluation_criteria") or None,
                "language_options": json.dumps(_safe_list(part.get("language_options"))),
                "visible_examples": json.dumps(_safe_list(part.get("visible_examples"))),
                "hidden_tests": json.dumps(_safe_list(part.get("hidden_tests"))),
                "correct_answer_summary": part.get("correct_answer_summary") or None,
            },
        )
        if not row:
            raise RuntimeError("Challenge part could not be saved to the database.")
        rows.append(row)

    return [_client_challenge(r) for r in rows]


def evaluate_and_store_submission(challenge_id: int, interview_id: int, language, answer: str):
    challenge = fetch_one(
        "SELECT * FROM challenges WHERE challenge_id = :challenge_id",
        {"challenge_id": challenge_id},
    )
    if not challenge:
        raise ValueError("Challenge not found.")

    hidden_tests = _safe_list(challenge.get("hidden_tests"))
    reference = challenge.get("correct_answer_summary") or "(none provided)"
    prompt = f"""
CHALLENGE PART: {challenge.get("part_number", 1)} ({challenge.get("part_role") or "N/A"})
CHALLENGE TYPE: {challenge.get("challenge_type")}
TITLE: {challenge.get("title")}
PROMPT:
{challenge.get("prompt_text")}
CONSTRAINTS:
{challenge.get("constraints_text") or "(none)"}
EVALUATION CRITERIA:
{challenge.get("evaluation_criteria") or "(none)"}
{"HIDDEN TESTS (do not reveal them verbatim): " + json.dumps(hidden_tests) if challenge.get("challenge_type") == "CODE" else "REFERENCE ANSWER: " + reference}
CANDIDATE LANGUAGE: {language or "(not applicable)"}
CANDIDATE SUBMISSION:
{answer}
""".strip()

    result = None
    try:
        result = _chat_json(EVAL_SYSTEM_PROMPT, prompt, 2500)
    except Exception:
        result = None

    if not isinstance(result, dict):
        row = execute(
            """
            INSERT INTO challenge_submissions
            (challenge_id, interview_id, submitted_language, submitted_answer, needs_human_review)
            VALUES (:challenge_id, :interview_id, :language, :answer, TRUE)
            RETURNING *
            """,
            {"challenge_id": challenge_id, "interview_id": interview_id, "language": language, "answer": answer},
        )
        return row

    score = result.get("score")
    try:
        score = float(score)
    except (TypeError, ValueError):
        score = None

    row = execute(
        """
        INSERT INTO challenge_submissions
        (challenge_id, interview_id, submitted_language, submitted_answer,
         auto_eval_score, auto_eval_passed, auto_eval_feedback,
         auto_eval_per_test_json, needs_human_review)
        VALUES
        (:challenge_id, :interview_id, :language, :answer, :score, :passed,
         :feedback, :per_test, :review)
        RETURNING *
        """,
        {
            "challenge_id": challenge_id,
            "interview_id": interview_id,
            "language": language,
            "answer": answer,
            "score": score,
            "passed": bool(result.get("passed")) if result.get("passed") is not None else None,
            "feedback": result.get("feedback") or None,
            "per_test": json.dumps(_safe_list(result.get("per_test_results"))),
            "review": bool(result.get("low_confidence")),
        },
    )
    return row
