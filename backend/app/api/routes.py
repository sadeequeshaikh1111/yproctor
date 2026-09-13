# backend/app/api/routes.py
"""
Minimal REST API: candidates, proctors, exams, registration, plus the
two read endpoints candidates/proctors actually hit after login
(their exam list / the proctor's active rooms).

No qpset file generation here anymore - that logic moved to exam
attempts (start/questions/answers/submit), which is the next module.
Registering for an exam just creates the exam_register row.
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Candidate, Proctor, Exam, ExamRegister, RegistrationStatus
from app.api.schema import ExamRegistrationOut, RoomSummaryOut, PersonIn, ExamIn, RegisterIn
from app.api.auth.service import get_current_proctor  # add to imports


router = APIRouter(prefix="/api")


# ── Request bodies ────────────────────────────────────────────────
# PersonIn, ExamIn, RegisterIn moved to app.api.schema


def _person(p) -> dict:
    # Deliberately excludes password from every response.
    return {"id": p.id, "first_name": p.first_name, "last_name": p.last_name,
            "email": p.email, "contact": p.contact, "info": p.info}


# ── Candidates ────────────────────────────────────────────────────
@router.post("/candidates")
def create_candidate(body: PersonIn, db: Session = Depends(get_db)):
    c = Candidate(**body.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return _person(c)


@router.get("/candidates")
def list_candidates(db: Session = Depends(get_db)):
    return [_person(c) for c in db.query(Candidate).all()]


@router.get("/candidates/{candidate_id}/exams", response_model=list[ExamRegistrationOut])
def candidate_exams(candidate_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ExamRegister, Exam)
        .join(Exam, Exam.id == ExamRegister.exam_id)
        .filter(ExamRegister.candidate_id == candidate_id)
        .all()
    )
    return [
        ExamRegistrationOut(
            registration_id=reg.id, exam_id=exam.id, exam_name=exam.name,
            room_no=reg.room_no, status=reg.status.value,
            start_time=exam.start_time, end_time=exam.end_time, fees=exam.fees,
        )
        for reg, exam in rows
    ]


# ── Proctors ──────────────────────────────────────────────────────
@router.post("/proctors")
def create_proctor(body: PersonIn, db: Session = Depends(get_db)):
    p = Proctor(**body.model_dump())
    db.add(p); db.commit(); db.refresh(p)
    return _person(p)


@router.get("/proctors")
def list_proctors(db: Session = Depends(get_db)):
    return [_person(p) for p in db.query(Proctor).all()]


@router.get("/proctor/rooms", response_model=list[RoomSummaryOut])
def active_rooms(db: Session = Depends(get_db), _proctor=Depends(get_current_proctor)):
    rows = (
        db.query(ExamRegister, Exam)
        .join(Exam, Exam.id == ExamRegister.exam_id)
        .filter(ExamRegister.status.in_([RegistrationStatus.registered, RegistrationStatus.in_progress]))
        .all()
    )
    rooms: dict[str, dict] = {}
    for reg, exam in rows:
        if not reg.room_no:
            continue
        entry = rooms.setdefault(reg.room_no, {"count": 0, "exams": set()})
        entry["count"] += 1
        entry["exams"].add(exam.name)
    return [
        RoomSummaryOut(room_no=r, candidate_count=v["count"], exam_names=sorted(v["exams"]))
        for r, v in rooms.items()
    ]


# ── Exams ─────────────────────────────────────────────────────────
@router.post("/exams")
def create_exam(body: ExamIn, db: Session = Depends(get_db)):
    e = Exam(**body.model_dump())
    db.add(e); db.commit(); db.refresh(e)
    return {"id": e.id, "name": e.name, "fees": e.fees, "blueprint": e.blueprint}


@router.get("/exams")
def list_exams(db: Session = Depends(get_db)):
    return [{"id": e.id, "name": e.name, "fees": e.fees, "blueprint": e.blueprint}
            for e in db.query(Exam).all()]


@router.post("/exam-register")
def register_for_exam(body: RegisterIn, db: Session = Depends(get_db)):
    exam = db.get(Exam, body.exam_id)
    candidate = db.get(Candidate, body.candidate_id)
    if not exam or not candidate:
        raise HTTPException(404, "Exam or candidate not found")

    reg = ExamRegister(exam_id=exam.id, candidate_id=candidate.id, room_no=body.room_no,
                        status=RegistrationStatus.registered)
    db.add(reg); db.commit(); db.refresh(reg)
    return {"registration_id": reg.id, "exam_id": exam.id, "candidate_id": candidate.id,
            "room_no": reg.room_no, "status": reg.status}
    
    