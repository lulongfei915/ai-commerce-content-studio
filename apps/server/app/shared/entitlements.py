import base64
from datetime import datetime, timezone
from typing import Literal

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel

from .config import Settings


class LicenseEnvelope(BaseModel):
    payload: str
    signature: str


class LicenseClaims(BaseModel):
    product: Literal["studio"]
    installation_id: str
    expires_at: AwareDatetime


class PaidCallBlocked(Exception):
    def as_http_error(self) -> HTTPException:
        reason = str(self)
        return HTTPException(503 if reason == "paid_calls_paused" else 402, reason)


def paid_call_block(settings: Settings, *, now: datetime | None = None) -> str | None:
    if settings.paid_calls_paused:
        return "paid_calls_paused"
    if settings.deployment_mode == "saas":
        return None
    if not settings.installation_id:
        return "license_invalid"
    try:
        envelope = LicenseEnvelope.model_validate_json(settings.license_file.read_bytes())
        payload = base64.b64decode(envelope.payload, validate=True)
        signature = base64.b64decode(envelope.signature, validate=True)
        key_bytes = settings.license_public_key_file.read_bytes()
        public_key = Ed25519PublicKey.from_public_bytes(key_bytes)
        public_key.verify(signature, payload)
        claims = LicenseClaims.model_validate_json(payload)
    except (InvalidSignature, OSError, ValueError):
        return "license_invalid"
    if claims.installation_id != settings.installation_id:
        return "license_invalid"
    if claims.expires_at <= (now or datetime.now(timezone.utc)):
        return "license_expired"
    return None


def require_paid_calls(settings: Settings) -> None:
    if reason := paid_call_block(settings):
        raise PaidCallBlocked(reason).as_http_error()


def check_provider_send(settings: Settings) -> None:
    if reason := paid_call_block(settings):
        raise PaidCallBlocked(reason)
