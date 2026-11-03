from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.db.database import fetch_all, fetch_one, execute
from app.dependencies import get_current_recruiter
router=APIRouter()
class Candidate(BaseModel):
    name:str; email:str; phone:str|None=None; resume_text:str|None=None; resume_filename:str|None=None
@router.get('')
def list_candidates(recruiter:dict=Depends(get_current_recruiter)): return fetch_all('SELECT candidate_id,name,email,phone,resume_filename,created_at FROM candidates WHERE owner_id=:oid ORDER BY created_at DESC LIMIT 200',{'oid':recruiter['recruiter_id']})
@router.post('')
def create_candidate(c:Candidate,recruiter:dict=Depends(get_current_recruiter)):
    # owner_id always comes from the authenticated session, never the request body.
    return execute('''INSERT INTO candidates(owner_id,name,email,phone,resume_text,resume_filename) VALUES(:oid,:name,:email,:phone,:resume_text,:resume_filename) ON CONFLICT(owner_id,email) DO UPDATE SET name=EXCLUDED.name,phone=COALESCE(EXCLUDED.phone,candidates.phone),resume_text=COALESCE(EXCLUDED.resume_text,candidates.resume_text),resume_filename=COALESCE(EXCLUDED.resume_filename,candidates.resume_filename) RETURNING *''', {**c.model_dump(),'oid':recruiter['recruiter_id']})
@router.get('/{id}')
def get_candidate(id:int,recruiter:dict=Depends(get_current_recruiter)):
    row=fetch_one('SELECT * FROM candidates WHERE candidate_id=:id AND owner_id=:oid',{'id':id,'oid':recruiter['recruiter_id']})
    if not row: raise HTTPException(404,'Candidate not found.')
    return row
