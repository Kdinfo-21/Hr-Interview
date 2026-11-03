from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.db.database import fetch_all, fetch_one, execute
from app.dependencies import get_current_recruiter, get_interview_by_token, get_owned_interview
import json
import cv2
import numpy as np
from app.services.phone_detector import detect_frame

router = APIRouter()

VALID = {
    "FULLSCREEN_EXIT",
    "TAB_SWITCH",
    "WINDOW_BLUR",
    "RESUME_CLICKED",
    "MULTIPLE_FACES",
    "PROHIBITED_OBJECT",
    "SUSPICIOUS_GAZE",
    "NAVIGATION_VIOLATION",
    "MOBILE_PHONE_DETECTED",
    "CANDIDATE_OUT_OF_FRAME",
    "NO_HUMAN_DETECTED",
    "CAMERA_UNAVAILABLE",
    "HIGH_BACKGROUND_NOISE",
    # Status-only signal: candidate is visible again after a
    # CANDIDATE_OUT_OF_FRAME warning. Never written to proctoring_events (see
    # STATUS_ONLY_EVENTS below) — it only clears the "human_detected" flag on
    # the interview row so the report reflects the latest known state.
    "CANDIDATE_IN_FRAME",
}

# Soft/ambient warnings (out-of-frame, background noise, camera unavailable)
# are logged for the audit trail but never count toward the 3-warning
# termination cap — a candidate briefly leaning off-camera, a barking dog, or
# a flaky webcam driver shouldn't end their interview. MOBILE_PHONE_DETECTED
# and PROHIBITED_OBJECT stay hard violations (like SUSPICIOUS_GAZE), since a
# phone/prohibited item in frame is a much stronger cheating signal.
SOFT_EVENTS = {"CANDIDATE_OUT_OF_FRAME", "NO_HUMAN_DETECTED", "HIGH_BACKGROUND_NOISE", "CAMERA_UNAVAILABLE"}
COUNTABLE = VALID - {"RESUME_CLICKED", "CANDIDATE_IN_FRAME"} - SOFT_EVENTS

# These events fire repeatedly for as long as the underlying condition
# persists (a phone held up for several seconds, sustained noise, a camera
# that's still blocked, etc). Without deduping, every detection tick would
# insert its own audit-log row. Instead, once one of these fires we suppress
# further INSERTs of the same type for ROW_DEDUPE_SECONDS — the audit log
# keeps one entry per genuine incident rather than one per second — while the
# "last detected" state on the interview row (see below) still updates on
# every tick so it stays live.
ROW_DEDUPE_EVENTS = {
    "MOBILE_PHONE_DETECTED",
    "PROHIBITED_OBJECT",
    "CANDIDATE_OUT_OF_FRAME",
    "NO_HUMAN_DETECTED",
    "HIGH_BACKGROUND_NOISE",
    "CAMERA_UNAVAILABLE",
}
ROW_DEDUPE_SECONDS = 8

# Status-only signals: update interview-row state (human_detected, etc.) but
# are never inserted into proctoring_events, so they can't spam the audit log.
STATUS_ONLY_EVENTS = {"CANDIDATE_IN_FRAME"}

# Several browser signals can fire for one physical action (for example,
# leaving the tab can produce both visibilitychange and blur). Keep the event
# in the audit log, but count one violation for the incident.
BROWSER_GROUP = {
    "FULLSCREEN_EXIT",
    "TAB_SWITCH",
    "WINDOW_BLUR",
    "NAVIGATION_VIOLATION",
}
COOLDOWN_SECONDS = 5


@router.post("/token/{token}")
def event(token: str, body: dict):
    interview = get_interview_by_token(token)
    typ = body.get("event_type")

    if typ not in VALID:
        raise HTTPException(400, "Invalid event_type.")

    event_metadata = body.get("metadata") or {}

    # Status-only: just refresh interview-row state and return — no audit row.
    if typ in STATUS_ONLY_EVENTS:
        if typ == "CANDIDATE_IN_FRAME":
            execute(
                "UPDATE interviews SET human_detected = TRUE, human_detected_at = now() WHERE interview_id = :id",
                {"id": interview["interview_id"]},
            )
        count = int(interview.get("warning_count") or 0)
        return {
            "event": None,
            "warning_count": count,
            "max_warnings": 3,
            "terminated": False,
            "counted": False,
            "is_soft": True,
        }

    # Row-level dedupe: if the same type fired recently for this interview,
    # reuse that row instead of inserting a new one for this tick.
    deduped = False
    event_row = None
    if typ in ROW_DEDUPE_EVENTS:
        event_row = fetch_one(
            """
            SELECT * FROM proctoring_events
            WHERE interview_id = :iid
              AND event_type = :type
              AND event_timestamp >= now() - (:cooldown * INTERVAL '1 second')
            ORDER BY event_timestamp DESC
            LIMIT 1
            """,
            {"iid": interview["interview_id"], "type": typ, "cooldown": ROW_DEDUPE_SECONDS},
        )
        deduped = event_row is not None

    if event_row is None:
        event_row = execute(
            """
            INSERT INTO proctoring_events
                (interview_id, event_type, notes, confidence, metadata)
            VALUES
                (:iid, :type, :notes, :confidence, :metadata)
            RETURNING *
            """,
            {
                "iid": interview["interview_id"],
                "type": typ,
                "notes": body.get("notes"),
                "confidence": body.get("confidence"),
                "metadata": json.dumps(event_metadata),
            },
        )

    # Keep the interview row's "live" detection state fresh on every call,
    # regardless of whether this tick's audit row was deduped — so "Last
    # Object Detected" / "Human Detected" reflect the latest signal even
    # while the audit log itself only records one row per incident.
    if typ in ("MOBILE_PHONE_DETECTED", "PROHIBITED_OBJECT"):
        object_label = event_metadata.get("object") or body.get("notes") or typ
        execute(
            """
            UPDATE interviews
            SET last_object_detected = :label, last_object_detected_at = now()
            WHERE interview_id = :id
            """,
            {"label": str(object_label)[:100], "id": interview["interview_id"]},
        )
    elif typ in ("CANDIDATE_OUT_OF_FRAME", "NO_HUMAN_DETECTED"):
        execute(
            "UPDATE interviews SET human_detected = FALSE, human_detected_at = now() WHERE interview_id = :id",
            {"id": interview["interview_id"]},
        )

    count = int(interview.get("warning_count") or 0)
    counted = False

    # Only a genuinely new (non-deduped) row can ever count toward the
    # warning cap — a suppressed repeat of the same ongoing incident should
    # never increment the count on its own.
    if not deduped and typ in COUNTABLE and interview.get("status") not in ("COMPLETED", "TERMINATED"):
        # Count only once within the short incident cooldown window.
        # Browser-level signals share a group because blur + visibility change
        # can represent the same tab switch.
        group_types = BROWSER_GROUP if typ in BROWSER_GROUP else {typ}

        placeholders = ", ".join(f":t{i}" for i in range(len(group_types)))
        params = {
            "iid": interview["interview_id"],
            "cooldown": COOLDOWN_SECONDS,
            **{f"t{i}": value for i, value in enumerate(group_types)},
        }

        recent = fetch_one(
            f"""
            SELECT event_id
            FROM proctoring_events
            WHERE interview_id = :iid
              AND event_type IN ({placeholders})
              AND event_id <> :current_event
              AND event_timestamp >= now() - (:cooldown * INTERVAL '1 second')
            ORDER BY event_timestamp DESC
            LIMIT 1
            """,
            {**params, "current_event": event_row["event_id"]},
        )

        if not recent:
            count += 1
            counted = True

            if count > 3:
                execute(
                    """
                    UPDATE interviews
                    SET warning_count = :count,
                        status = 'TERMINATED',
                        completed_at = COALESCE(completed_at, now()),
                        termination_reason = :reason
                    WHERE interview_id = :id
                    """,
                    {
                        "count": count,
                        "id": interview["interview_id"],
                        "reason": f"Auto-terminated after {count} proctoring violations.",
                    },
                )
            else:
                execute(
                    "UPDATE interviews SET warning_count=:count WHERE interview_id=:id",
                    {"count": count, "id": interview["interview_id"]},
                )

    return {
        "event": event_row,
        "warning_count": count,
        "max_warnings": 3,
        "terminated": count > 3,
        "counted": counted,
        # Lets the frontend decide banner (soft) vs. blocking-modal (hard)
        # presentation without re-deriving the soft/hard split client-side.
        "is_soft": typ in SOFT_EVENTS,
        "deduped": deduped,
    }


@router.get("/interview/{id}")
def events(id: int, recruiter: dict = Depends(get_current_recruiter)):
    get_owned_interview(id, recruiter["recruiter_id"])  # 404 unless this recruiter owns it
    return fetch_all(
        "SELECT * FROM proctoring_events WHERE interview_id=:id ORDER BY event_timestamp",
        {"id": id},
    )


@router.post("/detect/token/{token}")
async def detect_live_frame(token: str, frame: UploadFile = File(...)):
    """Run YOLO on one real JPEG camera frame.

    This endpoint only performs inference. The existing /token/{token}
    endpoint remains the single source of truth for audit events, warning
    counts and termination.
    """
    interview = get_interview_by_token(token)
    if interview.get("status") in ("COMPLETED", "TERMINATED"):
        return {
            "active": False,
            "phone_detected": False,
            "person_count": 0,
            "human_detected": False,
            "candidate_in_frame": False,
            "detections": [],
        }

    raw = await frame.read()
    if not raw:
        raise HTTPException(400, "Empty camera frame.")

    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "Invalid image frame.")

    result = detect_frame(image)
    return {"active": True, **result}
