# backend/app/schemas.py
from datetime import datetime
from pydantic import BaseModel


class LoginIn(BaseModel):
    email: str
    password: str


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


class ExamRegistrationOut(BaseModel):
    registration_id: int
    exam_id: int
    exam_name: str
    room_no: str | None
    status: str
    start_time: datetime | None
    end_time: datetime | None
    fees: float


class RoomSummaryOut(BaseModel):
    room_no: str
    candidate_count: int
    exam_names: list[str]
    
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