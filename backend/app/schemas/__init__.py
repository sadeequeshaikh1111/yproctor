# backend/app/schemas/__init__.py
from datetime import datetime
from pydantic import BaseModel


class CandidateOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str


class ProctorOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str
