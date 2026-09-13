# backend/app/api/auth/service.py
"""
Authentication / authorization helpers: JWT payload extraction and the
current-user dependency functions.

The token creation/verification primitives (create_access_token,
decode_access_token, and the JWT config constants) now live in the shared
core layer (app.core.security / app.core.config).  Everything here is the
same logic as before — only the file location and import source changed.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Candidate, Proctor, ExamRegister, Exam, RegistrationStatus
from app.core.security import decode_access_token


def get_current_payload(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    return decode_access_token(authorization.split(" ", 1)[1])


def get_current_candidate(
    payload: dict = Depends(get_current_payload), db: Session = Depends(get_db)
) -> Candidate:
    if payload.get("role") != "candidate":
        raise HTTPException(403, "Candidate access required")
    candidate = db.get(Candidate, int(payload["sub"]))
    if not candidate:
        raise HTTPException(401, "Candidate not found")
    return candidate


def get_current_proctor(
    payload: dict = Depends(get_current_payload), db: Session = Depends(get_db)
) -> Proctor:
    if payload.get("role") != "proctor":
        raise HTTPException(403, "Proctor access required")
    proctor = db.get(Proctor, int(payload["sub"]))
    if not proctor:
        raise HTTPException(401, "Proctor not found")
    return proctor


def _candidate_current_room(db: Session, candidate_id: int) -> str | None:
    """Pick the room for the candidate's currently-relevant exam: prefer
    one whose time window is open right now, otherwise fall back to the
    most recently created active registration."""
    now = datetime.utcnow()
    rows = (
        db.query(ExamRegister, Exam)
        .join(Exam, Exam.id == ExamRegister.exam_id)
        .filter(
            ExamRegister.candidate_id == candidate_id,
            ExamRegister.status.in_([RegistrationStatus.registered, RegistrationStatus.in_progress]),
            ExamRegister.room_no.isnot(None),
        )
        .order_by(ExamRegister.id.desc())
        .all()
    )
    if not rows:
        return None
    for reg, exam in rows:
        if exam.start_time and exam.end_time and exam.start_time <= now <= exam.end_time:
            return reg.room_no
    return rows[0][0].room_no
