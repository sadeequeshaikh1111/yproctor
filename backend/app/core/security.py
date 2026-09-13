# backend/app/core/security.py
"""
JWT token creation and verification.

Moved here from the previous auth.py so that security primitives live in the
shared core layer and can be re-used by any module (auth, websocket, etc.).
The logic is unchanged — only the file location and import source changed.
"""
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException

from app.core.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRE_MINUTES


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
