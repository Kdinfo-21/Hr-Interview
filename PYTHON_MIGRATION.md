# Python backend migration

This project keeps the original React frontend and original Node/TypeScript backend, and adds a new `backend_python` folder containing the FastAPI migration.

## Beginner setup

### Terminal 1 - Python backend
```powershell
cd backend_python
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env` and set your PostgreSQL/Neon connection string and Groq API key.

Then:
```powershell
python init_db.py
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Terminal 2 - React frontend
```powershell
cd frontend
copy .env.python.example .env
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## What was changed

- Existing React UI is preserved.
- Existing Node/TypeScript backend is preserved as a fallback/reference.
- A new Python/FastAPI backend is included.
- SQLAlchemy + psycopg are used for PostgreSQL access.
- Groq is used for resume analysis, question generation and answer scoring when `GROQ_API_KEY` is configured. The Python backend uses the same Groq provider/model configuration as the original TypeScript project.
- Interview links are generated from `FRONTEND_BASE_URL`, so a production deployment can use a public HTTPS domain rather than a LAN IP.
- Completed and terminated interviews cannot be started again.
- The challenge endpoints are intentionally marked as a migration scaffold; the original TypeScript challenge evaluator remains intact in `backend/` so it is not lost.

## Important

A local computer cannot create a public internet URL by itself. For a link to work from any computer, deploy the frontend and Python backend to public hosting and set:

```env
FRONTEND_BASE_URL=https://your-frontend-domain.example
BACKEND_BASE_URL=https://your-api-domain.example
```

Then set the frontend:

```env
VITE_API_BASE_URL=https://your-api-domain.example/api
```
