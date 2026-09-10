from fastapi import APIRouter, Depends

from app.api.deps import get_current_domain
from app.db.models import Domain

router = APIRouter(prefix="/api/meta", tags=["meta"])


@router.get("/domain")
async def get_domain_meta(domain: Domain = Depends(get_current_domain)) -> dict:
    return {"name": domain.name, "description": domain.description}
