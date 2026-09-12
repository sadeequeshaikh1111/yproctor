# backend/app/auth.py
"""
Login for candidates and proctors, backed by a signed JWT.

Plaintext password comparison is still a known, deliberate MVP gap (see
the original note below) - unrelated to the token work here.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Candidate, Proctor, ExamRegister, Exam, RegistrationStatus
from app.schemas import LoginIn, LoginResponse, ProfileOut

router = APIRouter(prefix="/api/auth")

JWT_SECRET = os.getenv("JWT_SECRET_KEY", "dev-insecure-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))  # 12h default


def create_access_token(user_id: int, role: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "role": role, "email": email, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid authentication token")


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


@router.post("/candidate/login", response_model=LoginResponse)
def candidate_login(body: LoginIn, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.email == body.email).first()
    if not candidate or candidate.password != body.password:
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(candidate.id, "candidate", candidate.email)
    return LoginResponse(
        access_token=token, id=candidate.id, first_name=candidate.first_name,
        last_name=candidate.last_name, email=candidate.email, role="candidate",
        room=_candidate_current_room(db, candidate.id),
    )


@router.post("/proctor/login", response_model=LoginResponse)
def proctor_login(body: LoginIn, db: Session = Depends(get_db)):
    proctor = db.query(Proctor).filter(Proctor.email == body.email).first()
    if not proctor or proctor.password != body.password:
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(proctor.id, "proctor", proctor.email)
    return LoginResponse(
        access_token=token, id=proctor.id, first_name=proctor.first_name,
        last_name=proctor.last_name, email=proctor.email, role="proctor", room=None,
    )


@router.get("/me", response_model=ProfileOut)
def me(payload: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    """Used by the frontend to restore a session after a refresh or a
    reopened tab, and to re-check a candidate's current room assignment."""
    role = payload.get("role")
    user_id = int(payload["sub"])

    if role == "candidate":
        candidate = db.get(Candidate, user_id)
        if not candidate:
            raise HTTPException(401, "Candidate not found")
        return ProfileOut(
            id=candidate.id, first_name=candidate.first_name, last_name=candidate.last_name,
            email=candidate.email, role="candidate", room=_candidate_current_room(db, candidate.id),
        )

    if role == "proctor":
        proctor = db.get(Proctor, user_id)
        if not proctor:
            raise HTTPException(401, "Proctor not found")
        return ProfileOut(
            id=proctor.id, first_name=proctor.first_name, last_name=proctor.last_name,
            email=proctor.email, role="proctor", room=None,
        )

    raise HTTPException(401, "Invalid token")