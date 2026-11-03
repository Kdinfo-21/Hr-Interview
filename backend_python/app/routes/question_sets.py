from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel
from app.db.database import fetch_all,fetch_one,execute
from app.dependencies import get_current_recruiter
from app.services.ai_service import generate_questions
from app.services.resume_summary import build_resume_context, resolve_years_and_seniority, infer_question_difficulty
router=APIRouter()
@router.get('')
def list_sets(recruiter:dict=Depends(get_current_recruiter)): return fetch_all('SELECT question_set_id,name,role_title,generated_from_resume,created_at FROM question_sets WHERE owner_id=:oid ORDER BY created_at DESC LIMIT 200',{'oid':recruiter['recruiter_id']})
@router.get('/{id}')
def get_set(id:int,recruiter:dict=Depends(get_current_recruiter)):
    s=fetch_one('SELECT * FROM question_sets WHERE question_set_id=:id AND owner_id=:oid',{'id':id,'oid':recruiter['recruiter_id']})
    if not s: raise HTTPException(404,'Question set not found.')
    return {**s,'questions':fetch_all('SELECT * FROM questions WHERE question_set_id=:id ORDER BY question_order',{'id':id})}
class ImportSet(BaseModel): name:str; role_title:str|None=None; questions:list[dict]
@router.post('/import')
def import_set(x:ImportSet,recruiter:dict=Depends(get_current_recruiter)):
    if not x.questions: raise HTTPException(400,'questions[] is required.')
    s=execute('INSERT INTO question_sets(owner_id,name,role_title,generated_from_resume) VALUES(:oid,:name,:role,false) RETURNING *',{'oid':recruiter['recruiter_id'],'name':x.name,'role':x.role_title})
    for n,q in enumerate(x.questions,1): execute('INSERT INTO questions(question_set_id,question_set_name,question_text,question_order,category,expected_duration_sec) VALUES(:sid,:name,:text,:ord,:cat,:dur)',{'sid':s['question_set_id'],'name':x.name,'text':q['question_text'],'ord':n,'cat':q.get('category','BEHAVIORAL'),'dur':q.get('expected_duration_sec',120)})
    return s
@router.post('/generate')
def generate(body:dict,recruiter:dict=Depends(get_current_recruiter)):
    role=body.get('role_title'); desc=body.get('role_description')
    if not role or not desc: raise HTTPException(400,'role_title and role_description are required.')
    resume=body.get('resume_text','')
    resume_analysis=body.get('resume_analysis')
    if body.get('candidate_id'):
        c=fetch_one('SELECT resume_text,resume_analysis FROM candidates WHERE candidate_id=:id AND owner_id=:oid',{'id':body['candidate_id'],'oid':recruiter['recruiter_id']})
        if not c: raise HTTPException(404,'Candidate not found.')
        resume=resume or (c or {}).get('resume_text','')
        resume_analysis=resume_analysis or (c or {}).get('resume_analysis')
    resume_context=build_resume_context(resume, resume_analysis)
    years, seniority = resolve_years_and_seniority(body.get('years_of_experience'), body.get('seniority_level'), resume_analysis)
    qs=generate_questions(
        role, desc, resume, seniority, max(1, body.get('total_questions', 6)),
        years_of_experience=years, resume_context=resume_context, difficulty=infer_question_difficulty(years),
    )
    name=body.get('set_name') or f'{role} Question Set'
    s=execute('INSERT INTO question_sets(owner_id,name,role_title,role_description,generated_from_resume,source_candidate_id,created_by) VALUES(:oid,:name,:role,:desc,:fromr,:cid,:by) RETURNING *',{'oid':recruiter['recruiter_id'],'name':name,'role':role,'desc':desc,'fromr':bool(resume),'cid':body.get('candidate_id'),'by':body.get('created_by') or recruiter['email']})
    out=[]
    for n,q in enumerate(qs,1): out.append(execute('INSERT INTO questions(question_set_id,question_set_name,question_text,question_order,category,rationale) VALUES(:sid,:name,:text,:ord,:cat,:rat) RETURNING *',{'sid':s['question_set_id'],'name':name,'text':q['question_text'],'ord':n,'cat':q.get('category','TECHNICAL'),'rat':q.get('rationale')}))
    return {'questionSet':s,'questions':out}
