# backend/app/api/auth/routes.py
"""
Login for candidates and proctors, backed by a signed JWT.

Plaintext password comparison is still a known, deliberate MVP gap (see
the original note below) - unrelated to the token work here.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Candidate, Proctor
from app.api.auth.schema import LoginIn, LoginResponse, ProfileOut
from app.api.auth.service import get_current_payload, _candidate_current_room
from app.core.security import create_access_token


router = APIRouter(prefix="/api/auth")


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
