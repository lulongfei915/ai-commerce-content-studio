from collections.abc import Callable
from functools import lru_cache
from secrets import compare_digest
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request
from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy.orm import Session

from app.shared.config import Settings, get_settings
from app.shared.db import get_db

from .domain import Permission
from .service import Identity, digest, get_identity

COOKIE = "studio_session"
Database = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]
LoginLimiter = Callable[[str, str], None]


@lru_cache(maxsize=4)
def _redis(url: str) -> Redis:
    return Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)


def get_login_limiter(settings: AppSettings) -> LoginLimiter:
    def limit(identity: str, ip: str) -> None:
        client = _redis(settings.redis_url)
        account_key = f"studio:login:account:{digest(identity)}"
        ip_key = f"studio:login:ip:{digest(ip)}"
        try:
            with client.pipeline() as pipe:
                for key in (account_key, ip_key):
                    pipe.incr(key)
                    pipe.expire(key, 300, nx=True)
                account_count, _, ip_count, _ = pipe.execute()
        except RedisError as exc:
            raise HTTPException(503, "identity_unavailable") from exc
        if account_count > 10 or ip_count > 60:
            raise HTTPException(429, "login_rate_limited", headers={"Retry-After": "300"})

    return limit


def check_origin(request: Request, settings: Settings) -> None:
    origin = request.headers.get("origin")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "csrf_failed")
    if origin is None:
        return
    if settings.auth_public_origin:
        expected = {settings.auth_public_origin.rstrip("/")}
    elif settings.environment == "development":
        expected = {"http://localhost:5173", "http://127.0.0.1:5173"}
    else:
        observed = urlsplit(str(request.url))
        expected = {f"https://{observed.netloc}"}
    if origin not in expected:
        raise HTTPException(403, "csrf_failed")


def require_identity(request: Request, db: Database) -> Identity:
    token = request.cookies.get(COOKIE)
    identity = get_identity(db, token) if token else None
    if identity is None:
        raise HTTPException(401, "authentication_required", headers={"Cache-Control": "no-store"})
    return identity


ActiveIdentity = Annotated[Identity, Depends(require_identity)]


def require_write(request: Request, identity: ActiveIdentity, settings: AppSettings) -> Identity:
    check_origin(request, settings)
    token = request.headers.get("x-csrf-token", "")
    if not token.isascii() or not compare_digest(token, identity.session.csrf_token):
        raise HTTPException(403, "csrf_failed")
    return identity


WriteIdentity = Annotated[Identity, Depends(require_write)]


def require_permission(identity: Identity, permission: Permission) -> None:
    if permission not in identity.grants:
        raise HTTPException(403, "permission_denied")
