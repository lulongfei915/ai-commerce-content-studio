from typing import NoReturn

from fastapi import HTTPException
from pydantic import BaseModel


class FieldIssue(BaseModel):
    field: str
    code: str


def reject(field: str, code: str) -> NoReturn:
    raise HTTPException(422, FieldIssue(field=field, code=code).model_dump())


def check_version(actual: int, expected: int) -> None:
    if actual != expected:
        raise HTTPException(409, {"code": "version_conflict", "version": actual})
