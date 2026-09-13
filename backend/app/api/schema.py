# backend/app/api/schema.py
from datetime import datetime
from pydantic import BaseModel


class PersonIn(BaseModel):
    first_name: str
    last_name: str
    email: str
    password: str
    contact: str | None = None
    info: dict = {}


class ExamIn(BaseModel):
    name: str
    blueprint: list[dict] = []          # [{"count":10,"marks":2}, ...]
    duration_minutes: int | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    fees: float = 0


class RegisterIn(BaseModel):
    exam_id: int
    candidate_id: int
    room_no: str | None = None


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
