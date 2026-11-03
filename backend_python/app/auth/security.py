"""
Password hashing + JWT session tokens for recruiter login/registration.

Kept deliberately small and dependency-light: bcrypt for hashing (the
industry-standard choice for password storage — salted, slow-by-design, no
config to get wrong) and PyJWT for stateless session tokens (no server-side
session store to run/scale, works cleanly with the existing Bearer-token
frontend fetch wrapper).
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import JWT_ALGORITHM, JWT_EXPIRE_MINUTES, JWT_SECRET

# bcrypt has a hard 72-byte input limit; anything longer is silently
# truncated by the library. Truncate explicitly ourselves so hashing and
# verifying always agree on the same effective password, regardless of
# bcrypt-version behavior.
_MAX_PASSWORD_BYTES = 72


def _truncate(password: str) -> bytes:
    return password.encode("utf-8")[:_MAX_PASSWORD_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_truncate(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(_truncate(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed/legacy hash — never let a verification error look like a
        # crash; it should just mean "credentials don't match".
        return False


def create_access_token(recruiter_id: int, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(recruiter_id),
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError (or a subclass) on any invalid/expired token."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
