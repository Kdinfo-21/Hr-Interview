import logging
import re
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import FRONTEND_BASE_URL
from app.db.migrations import run_startup_migrations
from app.dependencies import get_current_recruiter
from app.routes import auth,candidates,interviews,responses,dashboard,resume,question_sets,proctoring,challenges

logger = logging.getLogger("uvicorn.error")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Bring an existing database up to date (per-recruiter ownership columns)
    # before serving any request. Idempotent — see app/db/migrations.py.
    run_startup_migrations()
    yield


app=FastAPI(title='AI HR Interview Agent - Python API',version='1.0.0',lifespan=lifespan)

# In addition to the configured FRONTEND_BASE_URL, also allow any localhost/
# 127.0.0.1 port during local dev. Vite auto-bumps to 5174, 5175, etc. when
# 5173 is already taken, and a silent origin mismatch here is exactly what
# causes a browser-blocked response that looks like "Failed to fetch" on the
# frontend even though the backend is running and answering fine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_BASE_URL],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
    expose_headers=['X-Total-Count'],
)

_ALLOWED_ORIGIN_RE = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")

# IMPORTANT: a handler registered for the bare `Exception` class (as opposed
# to HTTPException or a specific subclass) is run by Starlette's outermost
# ServerErrorMiddleware, which sits OUTSIDE CORSMiddleware in the stack. That
# means CORSMiddleware never gets a chance to add CORS headers to whatever
# this handler returns, no matter how the response itself is built — so any
# unhandled exception (bad DATABASE_URL, missing DB column, etc.) still gets
# blocked by the browser and shows up as a bare "Failed to fetch", exactly
# like it did before this handler existed. The fix is to add the CORS
# headers directly here instead of relying on the middleware to do it.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    response = JSONResponse(status_code=500, content={"detail": str(exc) or exc.__class__.__name__})
    origin = request.headers.get("origin")
    if origin and (origin == FRONTEND_BASE_URL or _ALLOWED_ORIGIN_RE.match(origin)):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

@app.get('/health')
def health(): return {'status':'ok'}

# Auth (recruiter registration/login) is the only fully public router below
# aside from the candidate-facing `/token/{token}` endpoints, which stay
# public inside their own routers (interviews, responses, proctoring,
# challenges) since candidates authenticate with their unique interview link
# rather than a recruiter login.
app.include_router(auth.router,prefix='/api/auth',tags=['Auth'])
app.include_router(candidates.router,prefix='/api/candidates',tags=['Candidates'],dependencies=[Depends(get_current_recruiter)])
app.include_router(interviews.router,prefix='/api/interviews',tags=['Interviews'])
app.include_router(responses.router,prefix='/api/responses',tags=['Responses'])
app.include_router(dashboard.router,prefix='/api/dashboard',tags=['Dashboard'],dependencies=[Depends(get_current_recruiter)])
app.include_router(resume.router,prefix='/api/resume',tags=['Resume'],dependencies=[Depends(get_current_recruiter)])
app.include_router(question_sets.router,prefix='/api/question-sets',tags=['Question Sets'],dependencies=[Depends(get_current_recruiter)])
app.include_router(proctoring.router,prefix='/api/proctoring',tags=['Proctoring'])
app.include_router(challenges.router,prefix='/api/challenges',tags=['Challenges'])
