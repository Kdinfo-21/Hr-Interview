# Python/FastAPI backend for AI HR Interview Agent

This is the beginner-friendly Python migration of the existing Node/TypeScript backend. The existing React frontend is kept as much as possible.

## AI provider: Groq

This Python backend uses **Groq**, matching the original TypeScript project. You can reuse your existing `GROQ_API_KEY` and, unless you have a reason to change it, the same model:

```env
GROQ_MODEL=llama-3.3-70b-versatile
```

Do not put your real API key into source code. Put it in `backend_python/.env`.

## 1. Create the virtual environment (Windows)

```powershell
cd backend_python
python -m venv venv
venv\Scripts\activate
```

## 2. Install packages

```powershell
pip install -r requirements.txt
```

The requirements use `psycopg[binary]==3.2.13` rather than the old 3.2.9 pin so it installs with current Python/pip environments.

## 3. Configure `.env`

Copy `.env.example` to `.env` and set:

```env
DATABASE_URL=your_neon_database_url
GROQ_API_KEY=your_existing_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
FRONTEND_BASE_URL=http://localhost:5173
BACKEND_BASE_URL=http://localhost:8000
```

For production, `FRONTEND_BASE_URL` should be your real public HTTPS frontend URL, not localhost or a LAN IP.

## 4. Initialize the database

```powershell
python init_db.py
```

## 5. Start the Python API

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000/docs` to check the API.

## 6. Start the React frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

For local testing, set `frontend/.env` to:

```env
VITE_API_BASE_URL=http://localhost:8000/api
```

## Groq features

Groq is used for:

- Resume analysis
- Resume-aware interview questions
- Technical questions based on skills/projects
- HR/behavioral questions
- Role and seniority-aware questions
- Semantic duplicate avoidance instructions
- Interview answer scoring

The original TypeScript backend remains in `backend/` so you can compare the old implementation with the Python version.


## Final challenge

The Python migration now includes the final practical challenge endpoints. The challenge is generated (with a deterministic fallback if Groq is unavailable), stored in PostgreSQL, returned to the React candidate page, and submissions are saved/evaluated without executing candidate code.
