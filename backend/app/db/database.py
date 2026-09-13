# backend/app/db/database.py
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base

from app.core.config import DATABASE_URL

#
engine = create_engine(DATABASE_URL)
Base = declarative_base()


def init_db():
    """
    Creates any tables that don't already exist. Safe to call every
    startup - CREATE TABLE IF NOT EXISTS under the hood, so it won't
    touch tables already created by schema.sql.
    """
    from app import models  # noqa: F401 - must import before create_all so models register on Base
    Base.metadata.create_all(bind=engine)