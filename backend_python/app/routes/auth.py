from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, field_validator

from app.auth.security import create_access_token, hash_password, verify_password
from app.db.database import execute, fetch_one
from app.dependencies import get_current_recruiter

router = APIRouter()


class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Name must be at least 2 characters.")
        return v

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters.")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str


def _public_recruiter(row: dict) -> dict:
    return {"recruiter_id": row["recruiter_id"], "name": row["name"], "email": row["email"]}


@router.post("/register")
def register(x: RegisterIn):
    email = x.email.lower().strip()
    existing = fetch_one("SELECT recruiter_id FROM recruiters WHERE email = :email", {"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    row = execute(
        """INSERT INTO recruiters(name, email, password_hash)
           VALUES(:name, :email, :password_hash)
           RETURNING recruiter_id, name, email, created_at""",
        {"name": x.name, "email": email, "password_hash": hash_password(x.password)},
    )
    token = create_access_token(row["recruiter_id"], row["email"])
    return {"token": token, "recruiter": _public_recruiter(row)}


@router.post("/login")
def login(x: LoginIn):
    email = x.email.lower().strip()
    row = fetch_one("SELECT * FROM recruiters WHERE email = :email", {"email": email})
    # Deliberately identical error for "no such account" and "wrong password"
    # so the endpoint doesn't leak which emails have registered accounts.
    if not row or not verify_password(x.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    execute("UPDATE recruiters SET last_login_at = now() WHERE recruiter_id = :id", {"id": row["recruiter_id"]})
    token = create_access_token(row["recruiter_id"], row["email"])
    return {"token": token, "recruiter": _public_recruiter(row)}


@router.get("/me")
def me(recruiter: dict = Depends(get_current_recruiter)):
    return _public_recruiter(recruiter)
