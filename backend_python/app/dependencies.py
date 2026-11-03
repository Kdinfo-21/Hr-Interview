from fastapi import Header, HTTPException
import jwt as _pyjwt

from app.auth.security import decode_access_token
from app.db.database import fetch_one


def get_current_recruiter(authorization: str | None = Header(default=None)):
    """
    Recruiter-only route guard. Reads the `Authorization: Bearer <token>`
    header set by the frontend after login/registration, validates the JWT,
    and loads the recruiter row it belongs to.

    This is separate from the candidate `interview_token` flow below on
    purpose — candidates never have (or need) a recruiter login, so their
    routes stay unauthenticated and keyed only by their unguessable
    per-interview token.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(token)
    except _pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    except _pyjwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")

    try:
        recruiter_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid authentication token.")

    recruiter = fetch_one(
        "SELECT recruiter_id, name, email, created_at FROM recruiters WHERE recruiter_id = :id",
        {"id": recruiter_id},
    )
    if not recruiter:
        raise HTTPException(status_code=401, detail="This account no longer exists.")
    return recruiter


def get_owned_interview(interview_id: int, recruiter_id: int):
    """
    Load an interview ONLY if it belongs to this recruiter. Returns 404 (not
    403) for someone else's interview so ids can't be probed to discover
    which interviews exist. Every recruiter route that takes an interview id
    must go through this (or filter on owner_id itself).
    """
    row = fetch_one(
        "SELECT * FROM interviews WHERE interview_id = :id AND owner_id = :oid",
        {"id": interview_id, "oid": recruiter_id},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Interview not found.")
    return row


def get_interview_by_token(token: str):
    row = fetch_one("SELECT * FROM interviews WHERE interview_token = :token", {"token": token})
    if not row:
        raise HTTPException(status_code=404, detail="Interview not found.")
    # A recruiter-cancelled (or expired) interview must not stay reachable
    # through its old link.
    if row.get("status") in ("CANCELLED", "EXPIRED"):
        raise HTTPException(status_code=410, detail="This interview link is no longer active.")
    if row.get("status") in ("COMPLETED", "TERMINATED"):
        return row
    return row

def require_active_interview(token: str):
    row = get_interview_by_token(token)
    if row.get("status") == "COMPLETED":
        raise HTTPException(status_code=409, detail="Interview Completed")
    if row.get("status") == "TERMINATED":
        raise HTTPException(status_code=409, detail="Interview terminated")
    return row
