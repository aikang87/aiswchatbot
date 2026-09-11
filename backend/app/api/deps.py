import uuid

from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import AdminUser, Domain
from app.db.session import get_db
from app.services.auth import decode_access_token

settings = get_settings()
_bearer_scheme = HTTPBearer(auto_error=False)


def read_session_id(request: Request) -> uuid.UUID | None:
    raw = request.cookies.get(settings.session_cookie_name)
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


def set_session_cookie(response: Response, session_id: uuid.UUID) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        str(session_id),
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=60 * 60 * 24 * 365,
    )


async def get_or_create_session_id(request: Request, response: Response) -> uuid.UUID:
    session_id = read_session_id(request)
    if session_id is None:
        session_id = uuid.uuid4()
        set_session_cookie(response, session_id)
    return session_id


def issue_new_session_id(response: Response) -> uuid.UUID:
    """기존 쿠키 값과 무관하게 새 session_id를 발급하고 쿠키를 덮어쓴다 (하드 리셋용)."""
    session_id = uuid.uuid4()
    set_session_cookie(response, session_id)
    return session_id


async def get_current_domain(session: AsyncSession = Depends(get_db)) -> Domain:
    """MVP: 도메인이 1개뿐이라고 가정하고 첫 번째 도메인을 반환한다."""
    domain = await session.scalar(select(Domain).order_by(Domain.id).limit(1))
    if domain is None:
        raise HTTPException(status_code=500, detail="no domain configured — scripts/seed_domain.py 먼저 실행하세요")
    return domain


async def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    session: AsyncSession = Depends(get_db),
) -> AdminUser:
    if credentials is None:
        raise HTTPException(status_code=401, detail="missing bearer token")
    admin_id = decode_access_token(credentials.credentials)
    if admin_id is None:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    admin = await session.get(AdminUser, admin_id)
    if admin is None:
        raise HTTPException(status_code=401, detail="admin not found")
    return admin
