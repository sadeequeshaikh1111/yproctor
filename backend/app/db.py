# backend/app/db.py
from __future__ import annotations
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg2://postgres:postgres@localhost:5432/yproctor"
)
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    Creates any tables that don't already exist. Safe to call every
    startup - CREATE TABLE IF NOT EXISTS under the hood, so it won't
    touch tables already created by schema.sql.
    """
    from app import models  # noqa: F401 - must import before create_all so models register on Base
    Base.metadata.create_all(bind=engine)