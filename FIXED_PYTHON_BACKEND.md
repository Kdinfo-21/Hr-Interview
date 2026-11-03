# AI HR Interview Agent — Python/FastAPI fixed build

## What was fixed

1. Final challenge:
   - Unlocks only after all configured live questions have been answered.
   - Generates a challenge with an AI response and a deterministic fallback.
   - Candidate-facing API never returns hidden tests/reference answers.
   - Final challenge submission is stored and auto-evaluated.
   - Candidate sees the challenge instead of being sent directly to "Interview Complete".

2. Needs Review:
   - Only candidates with weak interview Q&A (`base_score < 55`) AND a successfully solved final challenge are routed to `Needs Review`.
   - Solving the final challenge gives a modest +5-point hireability boost and a 20% challenge contribution.
   - Other candidates are not added to the review queue just because their interview score is low.

3. Proctoring:
   - Fullscreen exit, tab switch, blur, navigation shortcuts, multiple faces, suspicious gaze and prohibited objects are logged.
   - 4 counted violations terminate the interview.
   - Browser signals that occur together are de-duplicated server-side for 5 seconds.
   - The final challenge remains proctored.
   - Resume clicks are audit events but are not counted as violations.
   - Recruiter report shows actual violation count, excluding resume clicks.

4. Database initialization:
   - `init_db.py` now removes SQL comments before splitting statements.
   - This fixes schema comments containing semicolons and prevents standalone fragments such as `hidden_tests`, `NULL`, or comment text from being sent to PostgreSQL.
   - The schema contains one `challenges` table and one `challenge_submissions` table.

## Run the Python backend

Open a terminal in:

`ai-hr-interview-agent/backend_python`

Create/activate a virtual environment if desired, then:

```powershell
pip install -r requirements.txt
```

Create `.env` from `.env.example` and set:

```env
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST/DATABASE
GROQ_API_KEY=YOUR_KEY
GROQ_MODEL=llama-3.3-70b-versatile
FRONTEND_BASE_URL=http://localhost:5173
BACKEND_BASE_URL=http://localhost:8000
```

Initialize the database:

```powershell
python init_db.py
```

Expected result: the command completes without a PostgreSQL syntax error.

Start FastAPI:

```powershell
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Run the frontend

Open a second terminal in:

`ai-hr-interview-agent/frontend`

Create `.env` using `.env.python.example`:

```env
VITE_API_BASE_URL=http://localhost:8000/api
```

Then:

```powershell
npm install
npm run dev
```

Open the Vite URL, normally:

`http://localhost:5173`

## Candidate flow

Consent
→ start interview
→ live questions
→ last answer
→ final challenge
→ challenge submission
→ interview completed

The recruiter dashboard then reads the Q&A scores, final challenge result, recommendation and proctoring audit.

Do not put real API keys or database passwords into the project ZIP.
