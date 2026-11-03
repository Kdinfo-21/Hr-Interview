import logging
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel
from app.db.database import fetch_one,fetch_all,execute
from app.dependencies import get_current_recruiter, get_owned_interview, require_active_interview
from app.services.ai_service import score_answer
router=APIRouter()
logger = logging.getLogger("uvicorn.error")
class ResponseIn(BaseModel): question_id:int; transcript_text:str=''; answer_duration_sec:int|None=None; expression_samples:list[dict]=[]
@router.post('/token/{token}')
def submit(token:str,x:ResponseIn):
    i=require_active_interview(token); q=fetch_one('SELECT question_text FROM questions WHERE question_id=:qid AND interview_id=:iid',{'qid':x.question_id,'iid':i['interview_id']})
    if not q: raise HTTPException(404,'Question not found.')
    # The candidate's answer must always be saved, even if AI scoring itself
    # fails outright (Groq outage, bad API key, etc) — losing a recorded
    # answer because scoring blew up would be a worse data-consistency bug
    # than leaving that one response unscored. Saving the response and
    # scoring it are therefore two separate steps, and a scoring failure
    # here can never take the response insert down with it.
    r=execute('INSERT INTO responses(interview_id,question_id,transcript_text,answer_duration_sec) VALUES(:iid,:qid,:text,:duration) RETURNING *',{'iid':i['interview_id'],'qid':x.question_id,'text':x.transcript_text,'duration':x.answer_duration_sec})
    try:
        s=score_answer(q['question_text'],x.transcript_text)
    except Exception:
        logger.exception("score_answer failed for response_id=%s", r['response_id'])
        s={'communication_score':None,'confidence_score':None,'relevance_score':None,'clarity_score':None,'blended_confidence_score':None,'expression_summary_json':{'note':'AI scoring raised an unexpected error.'},'scoring_failed':True}
    score=execute('''INSERT INTO scores(response_id,communication_score,confidence_score,relevance_score,clarity_score,blended_confidence_score,expression_summary_json,groq_raw_response_json) VALUES(:rid,:com,:conf,:rel,:clar,:blend,:expr,:raw) RETURNING *''',{'rid':r['response_id'],'com':s.get('communication_score'), 'conf':s.get('confidence_score'),'rel':s.get('relevance_score'),'clar':s.get('clarity_score'),'blend':s.get('blended_confidence_score'),'expr':__import__('json').dumps(s.get('expression_summary_json',{})),'raw':__import__('json').dumps(s)})
    return {'response':r,'score':score}
@router.get('/interview/{interview_id}')
def list_responses(interview_id:int,recruiter:dict=Depends(get_current_recruiter)):
    get_owned_interview(interview_id,recruiter['recruiter_id'])  # 404 unless this recruiter owns it
    return fetch_all('''SELECT r.*,q.question_text,q.category,s.* FROM responses r JOIN questions q ON q.question_id=r.question_id LEFT JOIN scores s ON s.response_id=r.response_id WHERE r.interview_id=:id ORDER BY r.recorded_at ASC''',{'id':interview_id})
