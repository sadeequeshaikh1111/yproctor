# backend/app/api/auth/schema.py
from pydantic import BaseModel


class LoginIn(BaseModel):
    email: str
    password: str


class ProfileOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str
    role: str
    room: str | None = None  # candidate's currently-assigned room; null for proctors


class LoginResponse(ProfileOut):
    access_token: str
    token_type: str = "bearer"
