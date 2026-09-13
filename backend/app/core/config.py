# backend/app/core/config.py
"""
Centralised configuration values read from the environment.

Consolidated here from the previous db.py (DATABASE_URL) and auth.py
(JWT settings) so that shared configuration has a single source of truth.
No values have been changed — only their location.
"""
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg2://postgres:1234@localhost:5432/yproctor"
)

JWT_SECRET = os.getenv("JWT_SECRET_KEY", "dev-insecure-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))  # 12h default
