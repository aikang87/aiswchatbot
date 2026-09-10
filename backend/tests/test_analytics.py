"""
compute_gaps()가 '차단된 assistant 응답 자신'이 아니라 그 응답을 유발한
'직전 사용자 질문'을 대표 질문으로 뽑는지 검증한다 (LAG 윈도우 함수를
WHERE 적용 전 전체 메시지에 대해 계산해야 하는 회귀 버그가 있었음).
"""
import pytest
from sqlalchemy import select

from app.db.models import Domain
from app.db.session import async_session_factory
from app.services.analytics import compute_gaps
from scripts.seed_domain import DOMAIN_NAME

pytestmark = pytest.mark.asyncio

REFUSAL_MARKER = "확인이 어렵습니다"


async def test_gap_representative_is_user_question_not_refusal_text():
    async with async_session_factory() as session:
        domain = await session.scalar(select(Domain).where(Domain.name == DOMAIN_NAME))
        assert domain is not None

        clusters = await compute_gaps(session, domain.id, limit=50)

    assert clusters, "블록된 메시지가 없어 검증 불가 — 4단계 curl 테스트가 남긴 데이터가 필요합니다"
    for cluster in clusters:
        assert REFUSAL_MARKER not in cluster.representative, (
            f"gaps 대표 질문에 거절 문구가 섞여 있음(집계 버그 재발 의심): {cluster.representative!r}"
        )
