# backend/app/auth.py
"""
Login for candidates and proctors.

Plaintext password comparison for now - this is a known, deliberate
gap for the MVP stage, not an oversight. Swapping in bcrypt later is
a one-line change at the comparison point (`==` -> `verify()`); the
request/response shape here doesn't need to change when that happens.
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import Candidate, Proctor
from app.schemas import LoginIn, CandidateOut, ProctorOut

router = APIRouter(prefix="/api/auth")


@router.post("/candidate/login", response_model=CandidateOut)
def candidate_login(body: LoginIn, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.email == body.email).first()
    if not candidate or candidate.password != body.password:
        raise HTTPException(401, "Invalid email or password")
    return candidate


@router.post("/proctor/login", response_model=ProctorOut)
def proctor_login(body: LoginIn, db: Session = Depends(get_db)):
    proctor = db.query(Proctor).filter(Proctor.email == body.email).first()
    if not proctor or proctor.password != body.password:
        raise HTTPException(401, "Invalid email or password")
    return proctor