from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.shared.config import Settings

from .domain import Permission, Role, permissions
from .models import LoginSession, Membership, Tenant, User
from .schemas import Credentials, CurrentSession, TenantInfo

_hasher = PasswordHasher()
_dummy_hash = _hasher.hash(token_urlsafe(32))


class IdentityUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Identity:
    session: LoginSession
    member: Membership
    tenant: Tenant
    user: User

    @property
    def grants(self) -> frozenset[Permission]:
        return permissions(Role(self.member.role), self.member.download_allowed)

    def as_response(self) -> CurrentSession:
        return CurrentSession(
            user_id=self.user.id,
            email=self.user.email,
            tenant=TenantInfo(id=self.tenant.id, slug=self.tenant.slug, name=self.tenant.name),
            role=Role(self.member.role),
            permissions=sorted(self.grants),
            csrf_token=self.session.csrf_token,
        )


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def _matches(password: str, encoded: str) -> bool:
    try:
        return _hasher.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def digest(token: str) -> str:
    return sha256(token.encode()).hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def totp_cipher(settings: Settings) -> Fernet:
    try:
        if settings.auth_totp_key is None:
            raise ValueError
        return Fernet(settings.auth_totp_key.get_secret_value().encode())
    except ValueError as exc:
        raise IdentityUnavailable from exc


def _accept_otp(member: Membership, credentials: Credentials, settings: Settings) -> bool:
    if member.totp_secret_encrypted is None:
        return True
    if credentials.otp is None:
        return False
    code = credentials.otp.get_secret_value()
    if len(code) != 6 or not code.isascii() or not code.isdigit():
        return False
    try:
        secret = totp_cipher(settings).decrypt(member.totp_secret_encrypted.encode()).decode()
    except InvalidToken as exc:
        raise IdentityUnavailable from exc
    totp = pyotp.TOTP(secret)
    now = datetime.now(timezone.utc)
    step = totp.timecode(now)
    for offset in (0, -1, 1):
        candidate = step + offset
        if member.totp_last_step is not None and candidate <= member.totp_last_step:
            continue
        if totp.verify(code, for_time=now + timedelta(seconds=offset * totp.interval)):
            member.totp_last_step = candidate
            return True
    return False


def open_session(
    db: Session,
    credentials: Credentials,
    settings: Settings,
    previous: str | None,
) -> tuple[str, Identity] | None:
    row = db.execute(
        select(Tenant, User, Membership)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .join(User, User.id == Membership.user_id)
        .where(Tenant.slug == credentials.tenant_slug, User.email == credentials.email)
    ).one_or_none()
    if not _matches(
        credentials.password.get_secret_value(), row[1].password_hash if row else _dummy_hash
    ):
        return None
    if row is None:
        return None
    tenant, user, member = row
    if not user.active or not member.active:
        return None
    # Serialize use of a one-time code and recheck authorization against current state.
    if member.totp_secret_encrypted is not None:
        db.refresh(member, with_for_update=True)
        if not member.active or not _accept_otp(member, credentials, settings):
            return None
    token = token_urlsafe(32)
    if previous:
        prior_session = db.get(LoginSession, digest(previous))
        if prior_session is not None:
            db.delete(prior_session)
    session = LoginSession(
        token_digest=digest(token),
        tenant_id=tenant.id,
        user_id=user.id,
        csrf_token=token_urlsafe(32),
        expires_at=utc_now() + timedelta(seconds=settings.session_ttl_seconds),
    )
    db.add(session)
    db.commit()
    return token, Identity(session, member, tenant, user)


def get_identity(db: Session, token: str) -> Identity | None:
    if len(token) != 43 or not token.isascii():
        return None
    row = db.execute(
        select(LoginSession, Membership, Tenant, User)
        .join(
            Membership,
            (Membership.user_id == LoginSession.user_id)
            & (Membership.tenant_id == LoginSession.tenant_id),
        )
        .join(Tenant, Tenant.id == Membership.tenant_id)
        .join(User, User.id == Membership.user_id)
        .where(
            LoginSession.token_digest == digest(token),
            LoginSession.expires_at > utc_now(),
            Membership.active.is_(True),
            User.active.is_(True),
        )
        .execution_options(populate_existing=True)
    ).one_or_none()
    return Identity(*row) if row else None
