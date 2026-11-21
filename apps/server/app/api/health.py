from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/health", response_model=dict[str, str])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "studio-api"}
