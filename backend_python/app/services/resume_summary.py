"""
Shared helpers for turning a candidate's structured resume analysis (plus
whatever years-of-experience / seniority the recruiter set at scheduling
time) into (a) a rich text block to feed the question-generation prompt and
(b) a normalized seniority label — so the live interview flow and the
pre-built question-set generator stay consistent.
"""


def infer_seniority(years_of_experience):
    """Best-effort seniority label from a numeric years-of-experience value."""
    if years_of_experience is None:
        return None
    try:
        years = float(years_of_experience)
    except (TypeError, ValueError):
        return None

    if years < 1:
        return "Intern"
    if years < 2:
        return "Junior"
    if years < 5:
        return "Mid-Level"
    if years < 8:
        return "Senior"
    return "Lead/Principal"


def infer_question_difficulty(years_of_experience):
    """
    A separate, purely prompt-facing difficulty label (distinct from the
    Seniority Level shown/selected in the scheduling UI, which is left
    untouched). Mapping per product spec:
      0 / intern / fresher -> Intermediate (never "beginner" trivia)
      1-2                  -> Intermediate
      3-5                  -> Mid-level
      6-8                  -> Senior
      9-12                 -> Advanced
      13+                  -> Expert/Leadership (added band: architecture,
                              org-level trade-offs, and leadership-scale depth
                              beyond plain "Advanced")
    """
    try:
        years = float(years_of_experience) if years_of_experience is not None else 0.0
    except (TypeError, ValueError):
        years = 0.0

    if years <= 2:
        return "Intermediate"
    if years <= 5:
        return "Mid-level"
    if years <= 8:
        return "Senior"
    if years <= 12:
        return "Advanced"
    return "Expert/Leadership"


def resolve_years_and_seniority(interview_years, interview_seniority, resume_analysis):
    """
    Precedence: explicit values set on the interview (recruiter typed them in
    at scheduling) win; otherwise fall back to what the resume itself claims.
    """
    resume_analysis = resume_analysis or {}
    years = interview_years
    if years is None:
        years = resume_analysis.get("total_years_experience")

    seniority = interview_seniority
    if not seniority:
        seniority = infer_seniority(years)

    return years, seniority


def build_resume_context(resume_text, resume_analysis):
    """
    Render a compact, model-friendly text block from structured resume
    analysis (falls back to raw resume text if no structured analysis is
    available). This is what actually grounds "practical, logical" questions
    in the candidate's real claimed experience, rather than generic trivia.
    """
    resume_analysis = resume_analysis or {}
    lines = []

    total_years = resume_analysis.get("total_years_experience")
    if total_years is not None:
        lines.append(f"Total years of experience (per resume): {total_years}")

    experience = resume_analysis.get("experience") or []
    if experience:
        lines.append("Work experience (most relevant for practical/scenario questions):")
        for job in experience[:6]:
            title = job.get("title") or "Role"
            company = job.get("company") or "Company not stated"
            duration = job.get("duration_months")
            duration_str = f", ~{duration} months" if duration else ""
            summary = job.get("summary") or ""
            achievements = job.get("achievements") or []
            line = f"- {title} at {company}{duration_str}"
            if summary:
                line += f": {summary}"
            lines.append(line)
            for ach in achievements[:3]:
                lines.append(f"    • {ach}")

    tech_skills = resume_analysis.get("technical_skills") or []
    tools = resume_analysis.get("tools_and_frameworks") or []
    if tech_skills or tools:
        lines.append(
            "Claimed technical skills: " + ", ".join(tech_skills[:20])
            + (" | Tools/frameworks: " + ", ".join(tools[:20]) if tools else "")
        )

    projects = resume_analysis.get("notable_projects") or []
    if projects:
        lines.append("Notable projects:")
        for project in projects[:5]:
            name = project.get("name") or "Project"
            desc = project.get("description") or ""
            techs = project.get("technologies") or []
            tail = f" ({', '.join(techs)})" if techs else ""
            lines.append(f"- {name}{tail}: {desc}")

    domains = resume_analysis.get("domains") or []
    if domains:
        lines.append("Domains: " + ", ".join(domains[:10]))

    if lines:
        return "\n".join(lines)

    # No structured analysis available — fall back to raw resume text.
    return (resume_text or "")[:6000]


def _dedupe_ordered(items):
    seen = set()
    out = []
    for item in items:
        if not item:
            continue
        key = str(item).strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(str(item).strip())
    return out


def resume_skill_list(resume_analysis):
    """Ordered, deduped list of the resume's technical skills + tools/frameworks."""
    resume_analysis = resume_analysis or {}
    return _dedupe_ordered(
        list(resume_analysis.get("technical_skills") or []) + list(resume_analysis.get("tools_and_frameworks") or [])
    )


BEHAVIORAL_TAG = "__BEHAVIORAL__"
GENERAL_TAG = "__GENERAL__"

# Question "angle" for a skill-tied slot — rotated so the same skill isn't
# always asked about the same way (e.g. every SQL question being a bare
# definitional one). Deliberately excludes plain definitional framing.
SKILL_QUESTION_TYPES = ["TECHNICAL", "PROJECT", "SCENARIO", "LOGICAL"]

# Angle for a non-skill-tied ("reserved") slot — HR/culture, STAR-style
# behavioral, and interpersonal/process situational questions.
NON_SKILL_QUESTION_TYPES = ["HR", "BEHAVIORAL", "SITUATIONAL"]


def build_skill_assignment(resume_analysis, total_questions):
    """
    Plan which skill (or a behavioral/general slot) each of the
    `total_questions` live questions should focus on, so that — per spec —
    each covered skill gets roughly 2-3 questions without ever generating an
    unreasonable number of questions just because the resume lists many
    skills. Also plans a question "type" per slot (technical / project /
    scenario / logical for skill slots; HR / behavioral / situational for
    reserved slots) so consecutive questions about the same skill don't all
    take the same shape, and so HR/behavioral/situational questions are
    guaranteed rather than left entirely to the model's discretion.

    Returns a list of length `total_questions` of (skill_or_tag, question_type)
    tuples, in the order questions should be asked. skill_or_tag is a skill
    name, BEHAVIORAL_TAG, or GENERAL_TAG — unchanged in meaning from before,
    so it's still safe to use directly as a DB skill_tag.
    """
    total_questions = max(1, int(total_questions or 1))
    skills = resume_skill_list(resume_analysis)

    if not skills:
        return [(GENERAL_TAG, NON_SKILL_QUESTION_TYPES[i % len(NON_SKILL_QUESTION_TYPES)]) for i in range(total_questions)]

    # Reserve a small share of slots for non-skill-specific HR/behavioral/
    # situational questions — more than the old flat "1 slot" once there's
    # room, so a 6+ question interview isn't 5 technical questions and a
    # single token behavioral one.
    if total_questions >= 6:
        reserve_behavioral = 2
    elif total_questions >= 4:
        reserve_behavioral = 1
    else:
        reserve_behavioral = 0
    skill_slots = total_questions - reserve_behavioral

    # Breadth-first: cover as many distinct skills as slots allow (so a
    # 3-skill resume with only 4 skill-slots still touches all 3, instead of
    # silently dropping the least-recent skill to hit a fixed "2-3 per
    # skill" depth target). Depth only kicks in once slots exceed the
    # number of skills, via the round-robin cycling below.
    num_skills = max(1, min(len(skills), skill_slots)) if skill_slots > 0 else 0
    selected_skills = skills[:num_skills]

    assignment = [
        (selected_skills[i % num_skills], SKILL_QUESTION_TYPES[i % len(SKILL_QUESTION_TYPES)])
        for i in range(skill_slots)
    ] if num_skills else []
    assignment += [
        (BEHAVIORAL_TAG, NON_SKILL_QUESTION_TYPES[i % len(NON_SKILL_QUESTION_TYPES)])
        for i in range(reserve_behavioral)
    ]
    return assignment
