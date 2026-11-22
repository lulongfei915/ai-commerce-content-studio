from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .schemas import Credentials, CurrentSession
from .security import (
    COOKIE,
    ActiveIdentity,
    AppSettings,
    Database,
    LoginLimiter,
    WriteIdentity,
    check_origin,
    get_login_limiter,
)
from .service import IdentityUnavailable, open_session

router = APIRouter(tags=["会话"])


@router.post("/sessions", status_code=201, operation_id="createSession")
def create_session(
    credentials: Credentials,
    request: Request,
    response: Response,
    db: Database,
    settings: AppSettings,
    limit_login: Annotated[LoginLimiter, Depends(get_login_limiter)],
) -> CurrentSession:
    check_origin(request, settings)
    if request.headers.get("x-studio-login") != "1":
        raise HTTPException(403, "csrf_failed")
    limit_login(
        f"{credentials.tenant_slug}:{credentials.email}",
        request.client.host if request.client else "",
    )
    try:
        result = open_session(db, credentials, settings, request.cookies.get(COOKIE))
    except IdentityUnavailable as exc:
        raise HTTPException(503, "identity_unavailable") from exc
    if result is None:
        raise HTTPException(401, "invalid_credentials", headers={"Cache-Control": "no-store"})
    token, identity = result
    response.set_cookie(
        COOKIE,
        token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.environment != "development",
        samesite="lax",
        path=settings.api_prefix,
    )
    response.headers["Cache-Control"] = "no-store"
    return identity.as_response()


@router.get("/me", operation_id="getCurrentSession")
def me(response: Response, identity: ActiveIdentity) -> CurrentSession:
    response.headers["Cache-Control"] = "no-store"
    return identity.as_response()


@router.delete("/sessions/current", status_code=204, operation_id="deleteCurrentSession")
def delete_session(identity: WriteIdentity, db: Database, settings: AppSettings) -> Response:
    db.delete(identity.session)
    db.commit()
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.delete_cookie(
        COOKIE,
        path=settings.api_prefix,
        httponly=True,
        secure=settings.environment != "development",
        samesite="lax",
    )
    return response
