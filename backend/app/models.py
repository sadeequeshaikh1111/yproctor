# backend/app/models.py
"""
ORM models for the registry/exam-engine DB.

candidates/proctors/admins, question_bank, exams, exam_register are
permanent. exam_attempts is disposable per-session state, deleted once
exam_results (permanent, denormalized) is written at publish time.

exam_attempts snapshots qp_json AND the exam's time window at creation -
so an in-progress attempt is unaffected if the exam definition changes
later, same reasoning as freezing the question set.
"""
from __future__ import annotations
import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.db import Base


# backend/app/models.py — add to Candidate and Proctor

class Candidate(Base):
    __tablename__ = "candidates"
    id = Column(Integer, primary_key=True)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)  # plaintext for now - see note below
    contact = Column(String)
    info = Column(JSONB, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    registrations = relationship("ExamRegister", back_populates="candidate")


class Proctor(Base):
    __tablename__ = "proctors"
    id = Column(Integer, primary_key=True)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)  # plaintext for now - see note below
    contact = Column(String)
    info = Column(JSONB, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)


class Admin(Base):
    __tablename__ = "admins"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    email = Column(String, unique=True)
    info = Column(JSONB, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)


class QuestionBank(Base):
    __tablename__ = "question_bank"
    id = Column(Integer, primary_key=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    question_text = Column(String, nullable=False)
    options = Column(JSONB, nullable=False)          # ["a","b","c","d"]
    correct_option = Column(String, nullable=False)
    marks = Column(Float, default=1)
    language = Column(String, default="en")
    question_type = Column(String, default="single_choice")  # single_choice | multi_choice | true_false
    subject = Column(String, nullable=True)
    tag = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    exam = relationship("Exam", back_populates="question_bank")


class Exam(Base):
    __tablename__ = "exams"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    blueprint = Column(JSONB, default=list)           # [{"count":10,"marks":2}, {"count":30,"marks":1}]
    duration_minutes = Column(Integer)
    start_time = Column(DateTime, nullable=True)      # exam window opens
    end_time = Column(DateTime, nullable=True)         # exam window closes
    fees = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    question_bank = relationship("QuestionBank", back_populates="exam")
    registrations = relationship("ExamRegister", back_populates="exam")


class RegistrationStatus(str, enum.Enum):
    registered = "registered"
    in_progress = "in_progress"
    completed = "completed"
    no_show = "no_show"


class ExamRegister(Base):
    __tablename__ = "exam_register"
    id = Column(Integer, primary_key=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False)
    room_no = Column(String)
    status = Column(Enum(RegistrationStatus), default=RegistrationStatus.registered)
    created_at = Column(DateTime, default=datetime.utcnow)
    exam = relationship("Exam", back_populates="registrations")
    candidate = relationship("Candidate", back_populates="registrations")
    attempt = relationship("ExamAttempt", back_populates="exam_register", uselist=False)


class AttemptStatus(str, enum.Enum):
    in_progress = "in_progress"
    submitted = "submitted"


class ExamAttempt(Base):
    __tablename__ = "exam_attempts"
    id = Column(Integer, primary_key=True)
    exam_register_id = Column(Integer, ForeignKey("exam_register.id"), unique=True, nullable=False)
    qp_json = Column(JSONB, nullable=False)           # [{id,text,options,correct_option,marks,question_type}, ...]
    answers = Column(JSONB, default=dict)             # {question_id: selected_option}
    start_time = Column(DateTime, nullable=True)       # snapshotted from exam.start_time at creation
    end_time = Column(DateTime, nullable=True)         # snapshotted from exam.end_time at creation
    started_at = Column(DateTime, default=datetime.utcnow)   # when candidate actually opened the paper
    submitted_at = Column(DateTime, nullable=True)
    score = Column(Float, nullable=True)
    status = Column(Enum(AttemptStatus), default=AttemptStatus.in_progress)
    created_at = Column(DateTime, default=datetime.utcnow)
    exam_register = relationship("ExamRegister", back_populates="attempt")


class ExamResult(Base):
    __tablename__ = "exam_results"
    id = Column(Integer, primary_key=True)
    exam_id = Column(Integer, nullable=False)
    candidate_id = Column(Integer, nullable=False)
    score = Column(Float)
    total_marks = Column(Float)
    percentage = Column(Float)
    published_at = Column(DateTime, default=datetime.utcnow)