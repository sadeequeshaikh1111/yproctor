# backend/app/db/__init__.py
"""
Re-exports from database.py and session.py so that existing imports like
``from app.db import get_db, init_db`` continue to work without modification.
"""
from app.db.database import DATABASE_URL, engine, Base, init_db
from app.db.session import SessionLocal, get_db

__all__ = [
    "DATABASE_URL",
    "engine",
    "Base",
    "init_db",
    "SessionLocal",
    "get_db",
]
