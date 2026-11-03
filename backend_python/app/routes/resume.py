import json

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException

from app.db.database import execute, fetch_one
from app.dependencies import get_current_recruiter
from app.services.resume_service import extract_text
from app.services.ai_service import analyze_resume

router = APIRouter()


def _read_and_analyze(filename: str, content: bytes):
    if not filename.lower().endswith((".pdf", ".docx")):
        raise HTTPException(
            status_code=400,
            detail="Only PDF and DOCX resumes are accepted.",
        )

    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Resume exceeds 8MB.")

    try:
        text = extract_text(filename, content)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read the resume: {exc}",
        ) from exc

    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail="Could not extract text from this resume. Please try another PDF or DOCX file.",
        )

    try:
        analysis = analyze_resume(text)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Resume analysis failed: {exc}",
        ) from exc

    return text, analysis


@router.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """
    Extract + analyze a resume WITHOUT creating/updating a candidate record.

    Used by the "Schedule Interview" screen: the recruiter can upload a
    resume first, see the extracted name/email/experience, and have those
    fields auto-fill the form — the candidate row itself is only created
    once the interview is actually scheduled (POST /interviews), which
    carries this same resume_text/resume_analysis along with it.
    """
    filename = (file.filename or "").strip()
    content = await file.read()
    text, analysis = _read_and_analyze(filename, content)

    return {
        "resume_text": text,
        "resume_filename": filename,
        "resume_analysis": analysis,
        "message": "Resume analyzed successfully.",
    }


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    candidate_name: str | None = Form(None),
    candidate_email: str | None = Form(None),
    candidate_phone: str | None = Form(None),
    recruiter: dict = Depends(get_current_recruiter),
):
    filename = (file.filename or "").strip()
    content = await file.read()
    text, analysis = _read_and_analyze(filename, content)

    # Name/email are normally supplied by the recruiter, but if this is
    # called before they've typed anything in, fall back to whatever the
    # resume itself claims so a candidate record can still be created.
    contact = analysis.get("contact") or {}
    name = candidate_name or contact.get("full_name")
    email = candidate_email or contact.get("email")
    phone = candidate_phone or contact.get("phone")

    if not email:
        raise HTTPException(
            status_code=400,
            detail="No email was provided and none could be extracted from the resume. "
                   "Please enter the candidate's email.",
        )

    candidate = execute(
        """
        INSERT INTO candidates
            (owner_id, name, email, phone, resume_text, resume_filename,
             resume_analysis, resume_uploaded_at)
        VALUES
            (:oid, :name, :email, :phone, :text, :filename,
             :analysis, now())
        ON CONFLICT(owner_id, email) DO UPDATE SET
            name = EXCLUDED.name,
            phone = COALESCE(EXCLUDED.phone, candidates.phone),
            resume_text = EXCLUDED.resume_text,
            resume_filename = EXCLUDED.resume_filename,
            resume_analysis = EXCLUDED.resume_analysis,
            resume_uploaded_at = now()
        RETURNING *
        """,
        {
            "oid": recruiter["recruiter_id"],
            "name": name,
            "email": email,
            "phone": phone,
            "text": text,
            "filename": filename,
            "analysis": json.dumps(analysis),
        },
    )

    return {
        "candidate": candidate,
        "resume_analysis": analysis,
        "message": "Resume uploaded and analyzed successfully.",
    }


@router.get("/candidate/{id}")
def get_resume(id: int, recruiter: dict = Depends(get_current_recruiter)):
    candidate = fetch_one(
        """
        SELECT candidate_id, name, email, phone, resume_text,
               resume_filename, resume_analysis, resume_uploaded_at
        FROM candidates
        WHERE candidate_id = :id AND owner_id = :oid
        """,
        {"id": id, "oid": recruiter["recruiter_id"]},
    )

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    return candidate
