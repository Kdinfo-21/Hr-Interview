
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db.database import fetch_one
from app.dependencies import require_active_interview
from app.services.challenge_service import (
    get_or_generate_challenge,
    evaluate_and_store_submission,
)

router = APIRouter()


class ChallengeSubmission(BaseModel):
    challenge_id: int
    language: str | None = None
    answer: str


@router.post("/token/{token}/generate")
def generate(token: str):
    interview = require_active_interview(token)

    # The final challenge unlocks only after every live question has both
    # been generated and answered. Checking only the question count allowed
    # the challenge endpoint to be called too early in some edge cases.
    counts = fetch_one(
        """
        SELECT
            (SELECT COUNT(*) FROM questions WHERE interview_id = :id) AS question_count,
            (SELECT COUNT(DISTINCT question_id) FROM responses WHERE interview_id = :id) AS answered_count
        """,
        {"id": interview["interview_id"]},
    ) or {}

    total = int(interview.get("total_questions") or 6)
    question_count = int(counts.get("question_count") or 0)
    answered_count = int(counts.get("answered_count") or 0)

    if question_count < total or answered_count < total:
        raise HTTPException(
            status_code=409,
            detail=(
                f"The final challenge unlocks after all {total} interview questions "
                f"are answered. Questions: {question_count}/{total}; "
                f"answered: {answered_count}/{total}."
            ),
        )

    try:
        challenges = get_or_generate_challenge(
            interview_id=interview["interview_id"],
            candidate_id=interview["candidate_id"],
            role_title=interview.get("role_title"),
            role_context=interview.get("role_context"),
            years_of_experience=interview.get("years_of_experience"),
            resume_analysis=interview.get("resume_analysis_snapshot"),
        )
        # Always exactly 2 discrete parts now. "challenge" (singular, first
        # part) is kept for backward compatibility with older frontend builds;
        # "challenges" is the full ordered 2-part array new clients should use.
        return {"challenges": challenges, "challenge": challenges[0] if challenges else None}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not prepare final challenge: {exc}")


@router.post("/token/{token}/submit")
def submit(token: str, body: ChallengeSubmission):
    interview = require_active_interview(token)

    if not body.answer.strip():
        raise HTTPException(status_code=400, detail="A non-empty answer is required.")

    owner = fetch_one(
        "SELECT interview_id FROM challenges WHERE challenge_id = :id",
        {"id": body.challenge_id},
    )
    if not owner or owner["interview_id"] != interview["interview_id"]:
        raise HTTPException(status_code=404, detail="Challenge not found for this interview.")

    try:
        submission = evaluate_and_store_submission(
            challenge_id=body.challenge_id,
            interview_id=interview["interview_id"],
            language=body.language,
            answer=body.answer,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not save challenge submission: {exc}")

    return {"submitted": True, "submission_id": submission["submission_id"]}
