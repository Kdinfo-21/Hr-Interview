import logging
import os
import secrets

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("uvicorn.error")

DATABASE_URL = os.getenv("DATABASE_URL", "")
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")
BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:8000").rstrip("/")

# --- Auth (recruiter login/registration) -----------------------------------
# JWT_SECRET signs recruiter session tokens. If it's not set, every restart
# would normally invalidate all logged-in sessions anyway (and, worse, a
# missing secret is a common way to accidentally ship a predictable one) —
# so instead of silently falling back to a hardcoded value, generate a
# random per-process secret and warn loudly. Set JWT_SECRET in your .env for
# real deployments so sessions survive a server restart.
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    JWT_SECRET = secrets.token_hex(32)
    logger.warning(
        "JWT_SECRET is not set — using a random secret for this process only. "
        "All recruiter sessions will be invalidated on restart. Set JWT_SECRET "
        "in backend_python/.env for a stable secret."
    )
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
# Minutes a login/registration session token stays valid for. Default: 7 days.
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))

# AI provider: Groq (same provider used by the original TypeScript project)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
