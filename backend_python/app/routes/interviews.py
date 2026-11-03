import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from app.db.database import fetch_all,fetch_one,execute
from app.config import FRONTEND_BASE_URL
from app.dependencies import get_current_recruiter, get_interview_by_token, require_active_interview
from app.services.ai_service import generate_questions
from app.services.resume_summary import build_resume_context, resolve_years_and_seniority, infer_question_difficulty, build_skill_assignment
router=APIRouter()
# Columns a candidate holding an interview link must never receive.
_RECRUITER_ONLY_FIELDS={'owner_id','recruiter_email','resume_analysis_snapshot','ai_summary','ai_summary_generated_at'}
class Schedule(BaseModel):
    candidate_name:str; candidate_email:str; candidate_phone:str|None=None; resume_text:str|None=None; resume_filename:str|None=None; resume_analysis:dict|None=None; role_title:str|None=None; role_context:str|None=None; seniority_level:str|None=None; years_of_experience:float|None=None; total_questions:int=6; scheduled_at:str; window_hours:float=48; recruiter_email:str|None=None; timezone:str='UTC'
@router.post('')
def schedule(x:Schedule,recruiter:dict=Depends(get_current_recruiter)):
    oid=recruiter['recruiter_id']
    # Candidate-facing fields (name/email/phone) may have been auto-filled on
    # the recruiter's screen from a resume upload (see /resume/analyze) — the
    # resume itself, its structured analysis, and years-of-experience are
    # captured here too so the live question generator can use them without a
    # second round trip.
    c=execute(
        '''INSERT INTO candidates(owner_id,name,email,phone,resume_text,resume_filename,resume_analysis,resume_uploaded_at)
           VALUES(:oid,:name,:email,:phone,:resume_text,:resume_filename,:resume_analysis,
                  CASE WHEN :resume_analysis_present THEN now() ELSE NULL END)
           ON CONFLICT(owner_id,email) DO UPDATE SET
               name=EXCLUDED.name,
               phone=COALESCE(EXCLUDED.phone,candidates.phone),
               resume_text=COALESCE(EXCLUDED.resume_text,candidates.resume_text),
               resume_filename=COALESCE(EXCLUDED.resume_filename,candidates.resume_filename),
               resume_analysis=COALESCE(EXCLUDED.resume_analysis,candidates.resume_analysis),
               resume_uploaded_at=COALESCE(EXCLUDED.resume_uploaded_at,candidates.resume_uploaded_at)
           RETURNING *''',
        {
            'oid':oid,'name':x.candidate_name,'email':x.candidate_email,'phone':x.candidate_phone,
            'resume_text':x.resume_text,'resume_filename':x.resume_filename,
            'resume_analysis': json.dumps(x.resume_analysis) if x.resume_analysis is not None else None,
            # Passed separately (rather than re-testing :resume_analysis IS NOT
            # NULL in SQL) because psycopg3 can't infer a type for the same
            # named parameter when it's reused in a bare comparison with no
            # column context — that reuse raised "AmbiguousParameter: could
            # not determine data type of parameter $6".
            'resume_analysis_present': x.resume_analysis is not None,
        },
    )
    dt=datetime.fromisoformat(x.scheduled_at.replace('Z','+00:00')); exp=dt+timedelta(hours=x.window_hours)
    resolved_years, resolved_seniority = resolve_years_and_seniority(x.years_of_experience, x.seniority_level, x.resume_analysis)
    # Global (whole-interview) answer-retry allowance — fixed at 2 retries for
    # the whole interview, regardless of question count. This applies only to
    # answers that failed to record (empty transcript / mic failure /
    # no-speech), not to low-quality-but-recorded answers.
    retry_limit = 2
    i=execute(
        '''INSERT INTO interviews(owner_id,candidate_id,role_title,role_context,seniority_level,years_of_experience,total_questions,status,scheduled_at,expires_at,recruiter_email,timezone,resume_analysis_snapshot,retry_limit)
           VALUES(:oid,:cid,:role,:context,:seniority,:years,:total,'SCHEDULED',:scheduled,:expires,:recruiter,:tz,:resume_analysis,:retry_limit) RETURNING *''',
        {
            'oid':oid,'cid':c['candidate_id'],'role':x.role_title,'context':x.role_context,'seniority':resolved_seniority,
            'years':resolved_years,'total':x.total_questions,'scheduled':dt,'expires':exp,'recruiter':x.recruiter_email or recruiter['email'],
            'tz':x.timezone, 'resume_analysis': json.dumps(x.resume_analysis) if x.resume_analysis is not None else None,
            'retry_limit': retry_limit,
        },
    )
    return {'interview':i,'shareableLink':f"{FRONTEND_BASE_URL}/interview/{i['interview_token']}"}
@router.get('')
def list_interviews(status:str|None=None,recruiter:dict=Depends(get_current_recruiter)):
    sql='''SELECT i.*,c.name candidate_name,c.email candidate_email FROM interviews i JOIN candidates c ON c.candidate_id=i.candidate_id WHERE i.owner_id=:oid'''; params={'oid':recruiter['recruiter_id']}
    if status: sql+=' AND i.status=:status'; params['status']=status
    sql+=' ORDER BY i.scheduled_at ASC NULLS LAST'; return fetch_all(sql,params)
@router.post('/{id}/cancel')
def cancel(id:int,recruiter:dict=Depends(get_current_recruiter)):
    row=execute("UPDATE interviews SET status='CANCELLED' WHERE interview_id=:id AND owner_id=:oid RETURNING *",{'id':id,'oid':recruiter['recruiter_id']})
    if not row: raise HTTPException(404,'Interview not found.')
    return row
@router.get('/token/{token}')
def token_info(token:str):
    i=get_interview_by_token(token); c=fetch_one('SELECT name,email FROM candidates WHERE candidate_id=:id',{'id':i['candidate_id']})
    # The candidate's page only needs interview state, not recruiter-side data.
    i={k:v for k,v in i.items() if k not in _RECRUITER_ONLY_FIELDS}
    return {'interview':i,'candidate':c}
@router.post('/token/{token}/next-question')
def next_question(token:str):
    i=require_active_interview(token); count=fetch_one('SELECT COUNT(*) count FROM questions WHERE interview_id=:id',{'id':i['interview_id']})['count']
    if count>=i.get('total_questions',6): return {'done':True}
    prev=fetch_all('SELECT question_text,skill_tag FROM questions WHERE interview_id=:id ORDER BY question_order',{'id':i['interview_id']})
    ans=fetch_all('SELECT transcript_text FROM responses WHERE interview_id=:id ORDER BY recorded_at',{'id':i['interview_id']})
    c=fetch_one('SELECT name,resume_text,resume_analysis FROM candidates WHERE candidate_id=:id',{'id':i['candidate_id']})
    # Prefer the resume analysis snapshot captured at scheduling time; fall
    # back to whatever is on the candidate record (e.g. a later resume upload).
    resume_analysis = i.get('resume_analysis_snapshot') or (c or {}).get('resume_analysis')
    resume_context = build_resume_context((c or {}).get('resume_text'), resume_analysis)
    years, seniority = resolve_years_and_seniority(i.get('years_of_experience'), i.get('seniority_level'), resume_analysis)
    difficulty = infer_question_difficulty(years)
    # Distribute questions across the resume's key skills (~2-3 each, capped
    # by total_questions) rather than asking broad/generic questions —
    # deterministic given the resume + total_questions, so it's safe to
    # recompute on every call instead of persisting a separate plan.
    total_questions = i.get('total_questions', 6)
    assignment = build_skill_assignment(resume_analysis, total_questions)
    focus_skill, question_type = assignment[count] if count < len(assignment) else assignment[-1]
    qs=generate_questions(
        i.get('role_title') or 'General', i.get('role_context') or '', (c or {}).get('resume_text') or '',
        seniority, 1, [q['question_text'] for q in prev], [a['transcript_text'] for a in ans],
        years_of_experience=years, resume_context=resume_context, focus_skill=focus_skill, difficulty=difficulty,
        question_type=question_type,
    )
    if not qs: raise HTTPException(503,'Could not generate a question.')
    q=execute('''INSERT INTO questions(interview_id,question_text,question_order,category,rationale,skill_tag) VALUES(:iid,:text,:order,:category,:rationale,:skill_tag) RETURNING *''',{'iid':i['interview_id'],'text':qs[0]['question_text'],'order':count+1,'category':qs[0].get('category','TECHNICAL'),'rationale':qs[0].get('rationale'),'skill_tag':focus_skill})
    return {'done':False,'question':q,'question_number':count+1,'total_questions':i['total_questions']}
@router.post('/token/{token}/start')
def start(token:str):
    i=require_active_interview(token); return execute("UPDATE interviews SET status='IN_PROGRESS',started_at=COALESCE(started_at,now()) WHERE interview_id=:id RETURNING *",{'id':i['interview_id']})
@router.post('/token/{token}/complete')
def complete(token:str):
    i=require_active_interview(token); return execute("UPDATE interviews SET status='COMPLETED',completed_at=now() WHERE interview_id=:id RETURNING *",{'id':i['interview_id']})
@router.post('/token/{token}/pause')
def pause(token:str):
    i=require_active_interview(token); return execute("UPDATE interviews SET status='PAUSED' WHERE interview_id=:id RETURNING *",{'id':i['interview_id']})
@router.post('/token/{token}/resume')
def resume(token:str):
    i=require_active_interview(token); return execute("UPDATE interviews SET status='IN_PROGRESS' WHERE interview_id=:id RETURNING *",{'id':i['interview_id']})
@router.post('/token/{token}/use-retry')
def use_retry(token:str):
    """
    Consumes one of the candidate's global (whole-interview) answer-retry
    allowance, used when their voice answer wasn't captured properly (no
    speech detected, mic/audio failure, empty transcript). Persisted
    server-side on the interview row so it survives page refreshes and can't
    be reset by re-fetching the page.
    """
    i=require_active_interview(token)
    limit = i.get('retry_limit')
    if limit is None:
        # Stale interview record without retry_limit set — fall back to the
        # fixed default of 2, not a question-count-based number.
        limit = 2
    used = i.get('retries_used') or 0
    if used >= limit:
        raise HTTPException(409, 'No answer retries remaining for this interview.')
    row = execute(
        "UPDATE interviews SET retries_used = COALESCE(retries_used,0)+1 WHERE interview_id=:id RETURNING retries_used",
        {'id': i['interview_id']},
    )
    used_now = row['retries_used']
    return {'retries_used': used_now, 'retry_limit': limit, 'retries_remaining': max(0, limit - used_now)}
