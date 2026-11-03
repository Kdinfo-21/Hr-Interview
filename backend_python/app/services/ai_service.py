import json
import re
from app.config import GROQ_API_KEY, GROQ_MODEL


def _client():
    if not GROQ_API_KEY:
        return None
    from groq import Groq
    return Groq(api_key=GROQ_API_KEY)


def _extract_json(raw: str):
    """Handle valid JSON plus common markdown/prose wrappers from an LLM."""
    text = (raw or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


def _chat_json(system_prompt: str, user_prompt: str, max_tokens: int):
    client = _client()
    if not client:
        return None

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content or "{}"
    return _extract_json(raw)


def generate_questions(
    role,
    description,
    resume,
    seniority,
    total,
    previous_questions=None,
    answers=None,
    years_of_experience=None,
    resume_context=None,
    focus_skill=None,
    difficulty=None,
    question_type=None,
):
    previous_questions = previous_questions or []
    answers = answers or []

    experience_line = (
        f"{years_of_experience} years of claimed experience" if years_of_experience is not None else "experience level not specified"
    )

    # Plain-language experience band for the prompt (kept separate from the
    # internal `difficulty` label below, which some other call sites rely on
    # verbatim) — this is just what the user-facing spec calls it.
    if years_of_experience is None or (isinstance(years_of_experience, (int, float)) and years_of_experience <= 1):
        level_word = "Beginner"
    elif isinstance(years_of_experience, (int, float)) and years_of_experience <= 4:
        level_word = "Intermediate"
    elif isinstance(years_of_experience, (int, float)) and years_of_experience <= 8:
        level_word = "Experienced"
    else:
        # 8+ years: leadership-scale questions (architecture, org-level
        # trade-offs, mentoring/ownership) rather than plain "Experienced".
        level_word = "Senior/Lead"

    type_guidance = {
        "TECHNICAL": (
            "Ask a short, direct technical question about how they used this skill or how it works — "
            "never a bare definition ('What is X?'). E.g. style: \"How does X handle Y?\" or \"Why did you pick X for Z?\""
        ),
        "PROJECT": (
            "Ask about something concrete they built or did with this skill on their resume — a decision, "
            "a challenge, or a specific part of a named project. E.g. style: \"What was hard about building X?\""
        ),
        "SCENARIO": (
            "Give a one-line realistic problem involving this skill and ask what they'd do. Keep the setup to "
            "one short clause. E.g. style: \"X is running slow in production. What's your first step?\""
        ),
        "LOGICAL": (
            "Ask a short reasoning/problem-solving question in this skill's domain — a trade-off, a "
            "'why this over that', or a quick logic check. E.g. style: \"When would you pick X over Y?\""
        ),
        "HR": (
            "Ask a short HR/culture/motivation question — not tied to a specific skill. E.g. style: "
            "\"What drew you to this role?\" or \"Where do you want to be in a few years?\""
        ),
        "BEHAVIORAL": (
            "Ask a short STAR-style behavioral question about a past experience — not tied to a specific "
            "skill. E.g. style: \"Tell me about a time a project didn't go as planned.\""
        ),
        "SITUATIONAL": (
            "Ask a short interpersonal/workplace situational question — not tied to a specific skill. "
            "E.g. style: \"A teammate disagrees with your approach. What do you do?\""
        ),
    }

    focus_instruction = ""
    if question_type and question_type in ("HR", "BEHAVIORAL", "SITUATIONAL"):
        focus_instruction = f"\n{type_guidance[question_type]}"
    elif focus_skill == "__BEHAVIORAL__":
        # No specific type chosen upstream — fall back to a generic non-skill prompt.
        focus_instruction = f"\n{type_guidance['BEHAVIORAL']}"
    elif focus_skill and focus_skill != "__GENERAL__":
        angle = type_guidance.get(question_type or "TECHNICAL", type_guidance["TECHNICAL"])
        focus_instruction = f"\nThis question is about the candidate's experience with '{focus_skill}'. {angle}"

    difficulty_instruction = f"\nCandidate level: {level_word} ({difficulty or 'not specified'} difficulty band)."

    system = (
        "You are a real interviewer speaking out loud in a live interview, not a document writer. "
        "You ask ONE short, natural, direct question at a time — the way a person actually talks, "
        "never a written paragraph. Return only one valid JSON object."
    )
    user = f"""Generate {total} interview question(s) for this candidate.
Role: {role}
Seniority: {seniority or 'Not specified'} ({experience_line})
Job description: {description or 'Not provided'}

Candidate resume context (use this to ground questions in what THIS candidate actually claims
to have built/done — reference a specific project or technology briefly, by name, where it makes
the question sharper — but do NOT restate the resume back to them):
{resume_context or resume or 'Not provided'}

Previous questions already asked in this interview: {json.dumps(previous_questions)}
Candidate's previous answers: {json.dumps(answers)}
{focus_instruction}{difficulty_instruction}

Return exactly this JSON shape:
{{"questions":[{{"question_text":"...","category":"TECHNICAL, PROJECT, SCENARIO, LOGICAL, HR, BEHAVIORAL, or SITUATIONAL","rationale":"..."}}]}}

STRICT STYLE RULES — every question must follow ALL of these:
1. LENGTH: 8-25 words. If your draft is longer, cut it down — do not explain, just ask.
2. ONE ask per question, ONE question mark. Never chain two questions with "and" or a semicolon.
3. Sound spoken, not written: no "Can you explain in detail...", no "various approaches and
   methodologies", no multi-clause setups. Say it the way a person would actually ask it out loud.
4. Reference the resume specifically but briefly — a project or tech name, not a restated summary
   of it. Do not quote long phrases back from the resume.
5. Do not ask bare definitional questions ("What is X?") at any level, including for a fresher.
6. Do not copy the wording, structure, or phrasing of any example question shown above — those are
   style references only, write fresh questions.

Some correct-STYLE examples (for length/tone only — write your own wording, do not reuse these):
- "How did you use Java in that project?"
- "What was the trickiest part of building that pipeline?"
- "Your API is timing out under load. What's your first move?"
- "Why would you pick a NoSQL store over SQL here?"
- "What made you want to work in this field?"
- "Tell me about a time you disagreed with a teammate."
- "A stakeholder keeps changing requirements mid-sprint. What do you do?"

Other requirements:
- Scale depth to the candidate's level: Beginner gets small, concrete, practical questions (never
  textbook trivia); Intermediate gets applied reasoning/trade-off questions; Experienced gets
  system-design or architecture questions; Senior/Lead gets org-level trade-offs, mentoring/
  ownership, and leadership-scale questions — but ALL still stay short (8-25 words).
- When asked to generate more than one question in this call and no single skill/type focus was
  given above, distribute them across the candidate's key resume skills and across TECHNICAL,
  PROJECT, SCENARIO, LOGICAL, HR, BEHAVIORAL and SITUATIONAL categories — do not make them all
  technical, and do not make them all about the same skill.
- Avoid repeated questions and semantic duplicates (e.g. two different phrasings of "what is
  React's virtual DOM" count as duplicates).
- Avoid concepts already covered by previous questions unless a follow-up is genuinely necessary.
- Return only the requested JSON object."""

    try:
        data = _chat_json(system, user, 700 * max(1, total))
    except Exception:
        data = None
    if data is None:
        return [{
            "question_text": f"Tell me about your experience relevant to {role}.",
            "category": "BEHAVIORAL",
            "rationale": "Fallback question because the AI question generator was unavailable.",
        }]
    questions = data.get("questions", [])
    # Light server-side guard: if the model still returns something clearly
    # too long (a full sentence-and-a-half rather than a spoken question),
    # trim it back to its first sentence so an occasional verbose response
    # doesn't slip through — the prompt constraints above should make this
    # rare, this is just a safety net, not the primary mechanism.
    for q in questions:
        text = (q.get("question_text") or "").strip()
        if len(text.split()) > 40:
            first_sentence = re.split(r"(?<=[.?!])\s+", text)[0]
            q["question_text"] = first_sentence
    return questions


def analyze_resume(text):
    """
    Extract a stable resume-analysis shape that matches the frontend.

    Keeping one consistent response shape is important because the React
    scheduling page reads technical_skills, tools_and_frameworks, and
    total_years_experience directly.
    """
    empty = {
        "contact": {},
        "education": [],
        "experience": [],
        "technical_skills": [],
        "soft_skills": [],
        "tools_and_frameworks": [],
        "domains": [],
        "total_years_experience": None,
        "notable_projects": [],
        "achievements": [],
        "summary": "",
    }

    system = (
        "You are a resume parser. Return ONLY one valid JSON object. "
        "Do not add markdown or explanatory text."
    )
    user = f"""Analyze this candidate resume and return exactly this JSON structure:

{{
  "contact": {{
    "full_name": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedin": ""
  }},
  "education": [
    {{
      "institution": "",
      "degree": "",
      "field_of_study": "",
      "start_year": "",
      "end_year": ""
    }}
  ],
  "experience": [
    {{
      "company": "",
      "title": "",
      "start_date": "",
      "end_date": "",
      "duration_months": 0,
      "summary": "",
      "achievements": []
    }}
  ],
  "technical_skills": [],
  "soft_skills": [],
  "tools_and_frameworks": [],
  "domains": [],
  "total_years_experience": null,
  "notable_projects": [
    {{
      "name": "",
      "description": "",
      "technologies": []
    }}
  ],
  "achievements": [],
  "summary": ""
}}

Rules:
- Use only information supported by the resume.
- Do not invent skills, companies, projects, education or experience.
- Put programming languages, technical concepts and technical skills in technical_skills.
- Put libraries, frameworks and tools such as React, FastAPI, Git, Docker, Alteryx, etc. in tools_and_frameworks.
- Put projects in notable_projects and include their technologies when stated.
- total_years_experience should be a number or null.
- Keep arrays as [] when the resume does not contain that information.

Resume:
{text[:30000]}
"""

    try:
        data = _chat_json(system, user, 3000)
    except Exception:
        data = None
    if not isinstance(data, dict):
        empty["summary"] = text[:1000]
        return empty

    # Normalize the model response so a slightly imperfect LLM response
    # cannot crash the React page.
    result = {
        **empty,
        **data,
    }
    for key in (
        "education",
        "experience",
        "technical_skills",
        "soft_skills",
        "tools_and_frameworks",
        "domains",
        "notable_projects",
        "achievements",
    ):
        if not isinstance(result.get(key), list):
            result[key] = []

    if not isinstance(result.get("contact"), dict):
        result["contact"] = {}

    if result.get("total_years_experience") is not None:
        try:
            result["total_years_experience"] = float(result["total_years_experience"])
        except (TypeError, ValueError):
            result["total_years_experience"] = None

    if not isinstance(result.get("summary"), str):
        result["summary"] = ""

    # Validate extracted contact details before anything downstream (e.g. the
    # scheduling form's autofill) trusts them — an LLM can occasionally grab
    # an unrelated number (a phone extension, a zip code, a test score) as
    # "phone", or return a malformed email.
    contact = result["contact"]
    email = contact.get("email")
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(email).strip()):
        contact["email"] = ""
    phone = contact.get("phone")
    if phone:
        digits = re.sub(r"\D", "", str(phone))
        if not (7 <= len(digits) <= 15):
            contact["phone"] = ""

    return result


def _coerce_score(value):
    """Coerce a raw LLM-returned score value into a clean 0-100 float, or
    None when it can't be trusted. Handles the common ways an LLM response
    can be "almost" a number (a numeric string, "85/100", trailing units,
    out-of-range values) without ever silently turning a bad/missing value
    into a fake 0 — a 0 is supposed to mean "scored very poorly", not
    "we couldn't get a score", so those two cases must never be conflated.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
    elif isinstance(value, str):
        match = re.search(r"-?\d+(\.\d+)?", value)
        if not match:
            return None
        try:
            num = float(match.group())
        except ValueError:
            return None
    else:
        return None
    if num != num:  # NaN check without importing math
        return None
    return max(0.0, min(100.0, num))


def score_answer(question, answer):
    """
    Scores one interview answer on the 4 evaluation dimensions.

    IMPORTANT: on any failure (Groq not configured, API/network error,
    malformed JSON, non-numeric fields) this returns None for the score
    fields rather than 0. A hard 0 is a real, damning score that gets
    averaged into the candidate's dashboard/report numbers and dashboard
    charts; a missing score should instead leave the response marked as
    "not yet scored" (NULL in the DB) so it's excluded from averages
    instead of silently dragging every chart/average down to 0 — the same
    "insert NULL + flag for review, never fabricate a score" convention
    challenge_service.evaluate_and_store_submission already follows for the
    final-challenge grading path.
    """
    empty_result = {
        "communication_score": None,
        "confidence_score": None,
        "relevance_score": None,
        "clarity_score": None,
        "blended_confidence_score": None,
        "expression_summary_json": {"note": "AI scoring unavailable for this answer."},
        "scoring_failed": True,
    }

    if not (answer or "").strip():
        # No transcript captured at all — there is nothing to score, and
        # asking the LLM to grade an empty string tends to produce a
        # meaningless (often 0) response. Leave it unscored instead.
        return empty_result

    system = "Return only one valid JSON object. You are an interview answer evaluator."
    user = f"""Score this interview answer from 0-100 for communication, confidence, relevance and clarity.
Question: {question}
Answer: {answer}
Return JSON only with communication_score, confidence_score, relevance_score, clarity_score and expression_summary_json."""

    try:
        data = _chat_json(system, user, 1200)
    except Exception:
        data = None

    if not isinstance(data, dict):
        return empty_result

    result = {
        "communication_score": _coerce_score(data.get("communication_score")),
        "confidence_score": _coerce_score(data.get("confidence_score")),
        "relevance_score": _coerce_score(data.get("relevance_score")),
        "clarity_score": _coerce_score(data.get("clarity_score")),
    }

    # If every dimension came back unusable, treat the whole call as failed
    # rather than saving a row of four NULLs mixed in with a stray blended
    # score of 0.
    if all(v is None for v in result.values()):
        return empty_result

    result["blended_confidence_score"] = result["confidence_score"]
    expr = data.get("expression_summary_json")
    result["expression_summary_json"] = expr if isinstance(expr, dict) else {}
    return result


def _fallback_interview_assessment(candidate_name, role_title, overall_score, recommendation,
                                    averages, qa_pairs, challenge_info, proctoring_violation_count):
    """Deterministic, template-based summary built entirely from the
    interview's own saved data (never fabricated numbers) — used when Groq
    isn't configured or the live call fails, so the report always has a
    final assessment instead of an empty/broken section."""
    name = candidate_name or "The candidate"
    role = f" for the {role_title} role" if role_title else ""
    answered = len(qa_pairs)
    scored = len([qa for qa in qa_pairs if qa.get("communication_score") is not None])

    lines = [
        f"{name} completed {answered} interview question(s){role}, "
        f"with {scored} answer(s) evaluated by the AI scoring pipeline.",
        f"Overall interview score: {overall_score}/100 "
        f"(Communication {averages.get('communication_score', 0)}, "
        f"Confidence {averages.get('blended_confidence_score', 0)}, "
        f"Relevance {averages.get('relevance_score', 0)}, "
        f"Clarity {averages.get('clarity_score', 0)}).",
    ]

    if challenge_info.get("attempted"):
        status = "solved" if challenge_info.get("passed") else "attempted but not fully solved"
        lines.append(f"The final practical challenge was {status}.")
    else:
        lines.append("The candidate did not submit a final practical challenge.")

    if proctoring_violation_count:
        lines.append(
            f"{proctoring_violation_count} proctoring event(s) were logged during the session — "
            "see the proctoring audit log below for details."
        )
    else:
        lines.append("No proctoring violations were recorded during the session.")

    lines.append(f"Based on these results, the recommended outcome is: {recommendation}.")
    return " ".join(lines)


def generate_interview_assessment(
    candidate_name,
    role_title,
    overall_score,
    recommendation,
    averages,
    qa_pairs,
    challenge_info,
    proctoring_violation_count,
):
    """
    Produces the recruiter-facing narrative "Interview Summary & AI
    Assessment" shown on the final report. Always grounded ONLY in the
    already-saved questions/answers/scores/challenge outcome passed in here
    — never invents data. Falls back to a deterministic, data-only summary
    (see _fallback_interview_assessment) when Groq is unavailable or the
    call fails, so the report section is never blank or fabricated.
    """
    fallback = _fallback_interview_assessment(
        candidate_name, role_title, overall_score, recommendation, averages, qa_pairs,
        challenge_info, proctoring_violation_count,
    )

    qa_lines = []
    for idx, qa in enumerate(qa_pairs, start=1):
        qa_lines.append(
            f"{idx}. Q: {qa.get('question_text')}\n   A: {(qa.get('transcript_text') or '(no answer recorded)')[:600]}\n"
            f"   Scores — communication:{qa.get('communication_score')}, confidence:{qa.get('blended_confidence_score')}, "
            f"relevance:{qa.get('relevance_score')}, clarity:{qa.get('clarity_score')}"
        )

    system = (
        "You are an HR analyst writing a short, factual final-assessment paragraph for a recruiter. "
        "Base your summary STRICTLY on the data given — never invent scores, quotes, or facts not present. "
        "Return only one valid JSON object."
    )
    user = f"""Candidate: {candidate_name or "Unknown"}
Role: {role_title or "Not specified"}
Overall score: {overall_score}/100
Recommendation: {recommendation}
Average dimension scores: {json.dumps(averages)}
Final challenge: {"attempted, " + ("solved" if challenge_info.get("passed") else "not solved") if challenge_info.get("attempted") else "not attempted"}
Proctoring violations recorded: {proctoring_violation_count}

Question-by-question record:
{chr(10).join(qa_lines) if qa_lines else "(no answers recorded)"}

Write a concise (100-180 word) final assessment paragraph for the recruiter covering: overall
performance, notable strengths, notable weaknesses, and how the final challenge/proctoring record
(if any) factored in. Return JSON exactly as {{"assessment": "..."}}."""

    try:
        data = _chat_json(system, user, 900)
    except Exception:
        data = None

    if isinstance(data, dict) and isinstance(data.get("assessment"), str) and data["assessment"].strip():
        return data["assessment"].strip()
    return fallback
