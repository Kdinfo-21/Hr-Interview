from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from app.db.database import fetch_all, fetch_one, execute
from app.dependencies import get_current_recruiter
from app.services.ai_service import generate_interview_assessment

router = APIRouter()

# Hard ceiling so a bad/huge ?limit= query can't force the dashboard back into
# loading everything at once.
MAX_SUMMARY_LIMIT = 100
DEFAULT_SUMMARY_LIMIT = 30

# Recruiter policy: Q&A is the main signal. A solved final challenge gives
# a modest boost, but ONLY weak Q&A + solved challenge enters Needs Review.
LENIENCY_ADJUSTMENT = 1.02
SOLVED_HIREABILITY_BOOST = 5
CHALLENGE_WEIGHT_WHEN_SOLVED = 0.20
CHALLENGE_WEIGHT_WHEN_UNSOLVED = 0.12
WEAK_QA_THRESHOLD = 55


def _number(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _base_score(avg):
    return (
        0.25 * (_number(avg.get("communication_score")) or 0)
        + 0.25 * (_number(avg.get("blended_confidence_score")) or 0)
        + 0.30 * (_number(avg.get("relevance_score")) or 0)
        + 0.20 * (_number(avg.get("clarity_score")) or 0)
    )


def _recommendation(base_score, challenge=None):
    challenge = challenge or {}
    attempted = bool(challenge.get("attempted"))
    passed = bool(challenge.get("passed"))
    challenge_score = _number(challenge.get("score"))

    composite = base_score
    challenge_effect = "No final challenge on record — score reflects interview Q&A only."

    if attempted and challenge_score is not None:
        if passed:
            composite = (
                (1 - CHALLENGE_WEIGHT_WHEN_SOLVED) * base_score
                + CHALLENGE_WEIGHT_WHEN_SOLVED * challenge_score
                + SOLVED_HIREABILITY_BOOST
            )
            challenge_effect = f"Final challenge solved — hireability boosted by +{SOLVED_HIREABILITY_BOOST} points."
        else:
            composite = (
                (1 - CHALLENGE_WEIGHT_WHEN_UNSOLVED) * base_score
                + CHALLENGE_WEIGHT_WHEN_UNSOLVED * challenge_score
            )
            challenge_effect = (
                "Final challenge not fully solved — candidate is judged primarily on interview Q&A, "
                "with a smaller challenge contribution."
            )
    elif attempted:
        challenge_effect = "Final challenge submitted but could not be auto-scored — no challenge boost applied."

    overall = min(100, max(0, round(composite * LENIENCY_ADJUSTMENT)))

    if overall >= 85:
        recommendation = "Strong Hire"
    elif overall >= 70:
        recommendation = "Hire"
    elif overall >= 55:
        recommendation = "Borderline"
    else:
        recommendation = "No Hire"

    # The ONLY condition that creates the recruiter review queue.
    weak_and_solved = base_score < WEAK_QA_THRESHOLD and passed and challenge_score is not None
    recommendation_note = None
    if weak_and_solved:
        recommendation = "Needs Review"
        recommendation_note = (
            "The candidate's interview Q&A performance was weak, but they successfully solved the final challenge. "
            "The challenge provides a positive problem-solving signal, so the interview has been routed to a recruiter "
            "for human review instead of being automatically rejected."
        )

    return {
        "overall_score": overall,
        "recommendation": recommendation,
        "challenge_effect": challenge_effect,
        "recommendation_overridden": weak_and_solved,
        "recommendation_note": recommendation_note,
        "needs_review": weak_and_solved,
        "base_score": round(base_score),
    }


def _challenges_for_interview(interview_id):
    """Returns a list of (challenge, latest_submission) pairs, one per part
    (part_number 1 and 2), ordered by part_number. Each interview now has
    exactly 2 discrete challenge parts instead of one combined challenge."""
    challenges = fetch_all(
        "SELECT * FROM challenges WHERE interview_id = :id ORDER BY part_number",
        {"id": interview_id},
    )
    pairs = []
    for challenge in challenges:
        # If the candidate retried, use the latest submission as the final outcome.
        submission = fetch_one(
            """
            SELECT *
            FROM challenge_submissions
            WHERE interview_id = :id AND challenge_id = :challenge_id
            ORDER BY submitted_at DESC, submission_id DESC
            LIMIT 1
            """,
            {"id": interview_id, "challenge_id": challenge["challenge_id"]},
        )
        pairs.append((challenge, submission))
    return pairs


def _client_challenge(challenge):
    if not challenge:
        return None

    def safe_list(value):
        return value if isinstance(value, list) else []

    return {
        "challenge_id": challenge["challenge_id"],
        "interview_id": challenge["interview_id"],
        "part_number": challenge.get("part_number", 1),
        "part_role": challenge.get("part_role"),
        "challenge_type": challenge["challenge_type"],
        "title": challenge["title"],
        "prompt_text": challenge["prompt_text"],
        "constraints_text": challenge.get("constraints_text"),
        "evaluation_criteria": challenge.get("evaluation_criteria"),
        "language_options": safe_list(challenge.get("language_options")),
        "visible_examples": safe_list(challenge.get("visible_examples")),
        "hidden_tests": safe_list(challenge.get("hidden_tests")),
        "correct_answer_summary": challenge.get("correct_answer_summary"),
        "created_at": challenge.get("created_at"),
    }


def _client_submission(submission):
    if not submission:
        return None

    per_test = submission.get("auto_eval_per_test_json")
    if not isinstance(per_test, list):
        per_test = []

    return {
        "submission_id": submission["submission_id"],
        "challenge_id": submission["challenge_id"],
        "submitted_language": submission.get("submitted_language"),
        "submitted_answer": submission["submitted_answer"],
        "auto_eval_score": _number(submission.get("auto_eval_score")),
        "auto_eval_passed": submission.get("auto_eval_passed"),
        "auto_eval_feedback": submission.get("auto_eval_feedback"),
        "auto_eval_per_test_json": per_test,
        "needs_human_review": bool(submission.get("needs_human_review")),
        "submitted_at": submission.get("submitted_at"),
    }


def _score_averages(interview_id):
    rows = fetch_all(
        """
        SELECT r.response_id,
               s.communication_score,
               s.confidence_score,
               s.blended_confidence_score,
               s.relevance_score,
               s.clarity_score
        FROM responses r
        LEFT JOIN scores s ON s.response_id = r.response_id
        WHERE r.interview_id = :id
        """,
        {"id": interview_id},
    )
    scored = [r for r in rows if r.get("communication_score") is not None]

    def avg(key):
        values = [_number(r.get(key)) for r in scored]
        values = [v for v in values if v is not None]
        return round(sum(values) / len(values)) if values else 0

    averages = {
        key: avg(key)
        for key in [
            "communication_score",
            "confidence_score",
            "blended_confidence_score",
            "relevance_score",
            "clarity_score",
        ]
    }
    return averages, len(rows), len(scored)


def _build_report(interview):
    interview_id = interview["interview_id"]
    qs = fetch_all(
        """
        SELECT r.response_id, r.question_id, q.question_text, q.category, r.transcript_text,
               s.communication_score, s.confidence_score, s.relevance_score, s.clarity_score,
               s.blended_confidence_score, s.expression_summary_json
        FROM responses r
        JOIN questions q ON q.question_id = r.question_id
        LEFT JOIN scores s ON s.response_id = r.response_id
        WHERE r.interview_id = :id
        ORDER BY q.question_order
        """,
        {"id": interview_id},
    )

    averages, response_count, scored_count = _score_averages(interview_id)
    base = _base_score(averages)
    challenge_pairs = _challenges_for_interview(interview_id)
    submissions = [s for (_c, s) in challenge_pairs if s is not None]
    scores = [_number(s.get("auto_eval_score")) for s in submissions]
    scores = [s for s in scores if s is not None]
    challenge_info = {
        # Attempted if at least one of the 2 parts was submitted.
        "attempted": len(submissions) > 0,
        # Passed only if every submitted part was judged to pass.
        "passed": bool(submissions) and all(s.get("auto_eval_passed") for s in submissions),
        # Overall challenge score is the average across whichever parts were submitted/scored.
        "score": (sum(scores) / len(scores)) if scores else None,
    }
    result = _recommendation(base, challenge_info)

    if interview.get("status") not in ("COMPLETED", "TERMINATED"):
        recommendation = None
        needs_review = False
    else:
        recommendation = result["recommendation"] if scored_count else None
        needs_review = bool(result["needs_review"] and scored_count)

    events = fetch_all(
        "SELECT * FROM proctoring_events WHERE interview_id=:id ORDER BY event_timestamp",
        {"id": interview_id},
    )
    violation_count = sum(1 for event in events if event.get("event_type") != "RESUME_CLICKED")

    # Lazily generate (once) and cache the AI final assessment/summary for
    # completed or terminated interviews with at least one scored answer.
    # Cached on the interview row so repeat report views don't re-call Groq
    # and always show the same wording — this is the single generation path
    # (rather than one per completion route) so there's one source of truth
    # for how/when it's produced.
    if interview.get("status") in ("COMPLETED", "TERMINATED") and scored_count and not interview.get("ai_summary"):
        try:
            assessment = generate_interview_assessment(
                candidate_name=interview.get("candidate_name"),
                role_title=interview.get("role_title"),
                overall_score=result["overall_score"],
                recommendation=result["recommendation"],
                averages=averages,
                qa_pairs=qs,
                challenge_info=challenge_info,
                proctoring_violation_count=violation_count,
            )
            updated = execute(
                "UPDATE interviews SET ai_summary=:summary, ai_summary_generated_at=now() WHERE interview_id=:id RETURNING ai_summary",
                {"summary": assessment, "id": interview_id},
            )
            interview["ai_summary"] = updated["ai_summary"] if updated else assessment
        except Exception:
            # Never let a summary-generation hiccup break the rest of the
            # report — the recruiter still gets every other section.
            pass

    return {
        "interview": interview,
        "questions": qs,
        "averages": averages,
        "overall_score": result["overall_score"] if scored_count else 0,
        "recommendation": recommendation,
        "recommendation_overridden": bool(needs_review),
        "recommendation_note": result["recommendation_note"] if needs_review else None,
        "challenge_effect": result["challenge_effect"],
        # New: full ordered list of both challenge parts + each one's latest
        # submission, so the report can show "Challenge 1 of 2" / "2 of 2".
        "challenges": [
            {"challenge": _client_challenge(c), "submission": _client_submission(s)}
            for (c, s) in challenge_pairs
        ],
        # Backward-compatible single-challenge fields: part 1 and its submission.
        "challenge": _client_challenge(challenge_pairs[0][0]) if challenge_pairs else None,
        "challenge_submission": _client_submission(challenge_pairs[0][1]) if challenge_pairs else None,
        "proctoring_events": events,
        "proctoring_violation_count": violation_count,
    }


@router.get('/summary')
def summary(limit: int = DEFAULT_SUMMARY_LIMIT, offset: int = 0, recruiter: dict = Depends(get_current_recruiter)):
    """
    Dashboard list endpoint.

    Previously this ran 1 query for the interview list, then — for EVERY
    interview in that list — 3 more queries (score averages, challenge
    lookup, latest challenge submission). For 200 interviews that's ~601
    sequential round-trips to Postgres, which is why the dashboard could
    hang for a long time.

    This version does it in one query: per-interview score aggregates and
    the latest challenge submission are computed with CTEs and LEFT JOINed
    onto the interview list, so there is exactly one query for the page of
    interviews plus one lightweight COUNT(*) for pagination.
    """
    limit = max(1, min(limit, MAX_SUMMARY_LIMIT))
    offset = max(0, offset)
    oid = recruiter["recruiter_id"]  # dashboard data is scoped to the signed-in recruiter only

    interviews = fetch_all(
        """
        WITH resp_scores AS (
            SELECT r.interview_id,
                   COUNT(*) AS answered_count,
                   COUNT(s.communication_score) AS scored_count,
                   AVG(s.communication_score) FILTER (WHERE s.communication_score IS NOT NULL) AS communication_score,
                   AVG(s.confidence_score) FILTER (WHERE s.communication_score IS NOT NULL) AS confidence_score,
                   AVG(s.blended_confidence_score) FILTER (WHERE s.communication_score IS NOT NULL) AS blended_confidence_score,
                   AVG(s.relevance_score) FILTER (WHERE s.communication_score IS NOT NULL) AS relevance_score,
                   AVG(s.clarity_score) FILTER (WHERE s.communication_score IS NOT NULL) AS clarity_score
            FROM responses r
            JOIN interviews ri ON ri.interview_id = r.interview_id AND ri.owner_id = :oid
            LEFT JOIN scores s ON s.response_id = r.response_id
            GROUP BY r.interview_id
        ),
        latest_submission_per_part AS (
            -- One row per (interview, challenge/part): the most recent
            -- submission for that part, mirroring the old per-part
            -- ORDER BY submitted_at DESC, submission_id DESC LIMIT 1.
            SELECT DISTINCT ON (cs.interview_id, cs.challenge_id)
                   cs.interview_id, cs.challenge_id, cs.auto_eval_score, cs.auto_eval_passed
            FROM challenge_submissions cs
            JOIN interviews si ON si.interview_id = cs.interview_id AND si.owner_id = :oid
            ORDER BY cs.interview_id, cs.challenge_id, cs.submitted_at DESC, cs.submission_id DESC
        ),
        latest_submission AS (
            -- Aggregated to one row per interview across both challenge
            -- parts: attempted if any part submitted, passed only if every
            -- submitted part passed, score is the average across submitted parts.
            SELECT interview_id,
                   AVG(auto_eval_score) FILTER (WHERE auto_eval_score IS NOT NULL) AS auto_eval_score,
                   BOOL_AND(COALESCE(auto_eval_passed, FALSE)) AS auto_eval_passed
            FROM latest_submission_per_part
            GROUP BY interview_id
        )
        SELECT i.interview_id, i.status, i.scheduled_at, i.completed_at, i.interview_token,
               i.role_title, c.name AS candidate_name, c.email AS candidate_email,
               COALESCE(rs.answered_count, 0) AS answered_count,
               COALESCE(rs.scored_count, 0) AS scored_count,
               rs.communication_score, rs.confidence_score, rs.blended_confidence_score,
               rs.relevance_score, rs.clarity_score,
               ls.auto_eval_score AS challenge_score,
               ls.auto_eval_passed AS challenge_passed,
               (ls.interview_id IS NOT NULL) AS challenge_submitted
        FROM interviews i
        JOIN candidates c ON c.candidate_id = i.candidate_id
        LEFT JOIN resp_scores rs ON rs.interview_id = i.interview_id
        LEFT JOIN latest_submission ls ON ls.interview_id = i.interview_id
        WHERE i.owner_id = :oid
        ORDER BY i.scheduled_at DESC NULLS LAST
        LIMIT :limit OFFSET :offset
        """,
        {"limit": limit, "offset": offset, "oid": oid},
    )

    total_row = fetch_one("SELECT COUNT(*) AS count FROM interviews WHERE owner_id = :oid", {"oid": oid})
    total = total_row["count"] if total_row else len(interviews)

    out = []
    for interview in interviews:
        averages = {
            "communication_score": round(_number(interview.get("communication_score")) or 0),
            "confidence_score": round(_number(interview.get("confidence_score")) or 0),
            "blended_confidence_score": round(_number(interview.get("blended_confidence_score")) or 0),
            "relevance_score": round(_number(interview.get("relevance_score")) or 0),
            "clarity_score": round(_number(interview.get("clarity_score")) or 0),
        }
        response_count = interview["answered_count"]
        scored_count = interview["scored_count"]
        base = _base_score(averages)
        challenge_info = {
            "attempted": interview.get("challenge_submitted") is True,
            "passed": bool(interview.get("challenge_passed")),
            "score": _number(interview.get("challenge_score")),
        }
        result = _recommendation(base, challenge_info)

        if interview["status"] not in ("COMPLETED", "TERMINATED"):
            recommendation = None
            needs_review = False
        else:
            recommendation = result["recommendation"] if scored_count else None
            needs_review = bool(result["needs_review"] and scored_count)

        out.append({
            **interview,
            **averages,
            "answered_count": response_count,
            "scored_count": scored_count,
            "unscored_count": max(0, response_count - scored_count),
            "overall_score": result["overall_score"] if scored_count else None,
            "base_score": result["base_score"] if scored_count else None,
            "recommendation": recommendation,
            "needs_review": needs_review,
            "recommendation_overridden": needs_review,
            "recommendation_note": result["recommendation_note"] if needs_review else None,
            "challenge_passed": bool(interview.get("challenge_passed")),
            "challenge_score": _number(interview.get("challenge_score")),
            "challenge_submitted": interview.get("challenge_submitted") is True,
            "challenge_effect": result["challenge_effect"],
        })

    # Response body is still a plain JSON array — the existing frontend
    # contract is unchanged. Total count for pagination rides on a response
    # header instead, so old callers that ignore it keep working exactly
    # as before.
    return JSONResponse(
        content=jsonable_encoder(out),
        headers={"X-Total-Count": str(total)},
    )


@router.get('/interview/{id}')
def report(id: int, recruiter: dict = Depends(get_current_recruiter)):
    interview = fetch_one(
        """
        SELECT i.*, c.name AS candidate_name, c.email AS candidate_email
        FROM interviews i
        JOIN candidates c ON c.candidate_id = i.candidate_id
        WHERE i.interview_id = :id AND i.owner_id = :oid
        """,
        {"id": id, "oid": recruiter["recruiter_id"]},
    )
    if not interview:
        raise HTTPException(404, 'Interview not found.')
    return _build_report(interview)
