"""
seed된 실제 도메인/FAQ(FAQ.csv)를 대상으로 한 통합 테스트.
사전 조건: docker compose db 기동 + alembic upgrade head + seed_domain + seed_faq + reindex_all 완료.
"""
import pytest
from sqlalchemy import select

from app.db.models import Domain, KnowledgeItem
from app.db.session import async_session_factory
from app.services.retrieval import hybrid_search, top1_similarity
from scripts.seed_domain import DOMAIN_NAME

pytestmark = pytest.mark.asyncio


async def _get_domain_id() -> int:
    async with async_session_factory() as session:
        domain = await session.scalar(select(Domain).where(Domain.name == DOMAIN_NAME))
        assert domain is not None, "domain not seeded — scripts/seed_domain.py 먼저 실행"
        return domain.id


async def test_recall_at_3_for_verbatim_questions():
    """FAQ 원문 질문을 그대로 물으면 자기 자신의 답이 top-3 안에 들어와야 한다."""
    domain_id = await _get_domain_id()

    async with async_session_factory() as session:
        items = (
            await session.scalars(
                select(KnowledgeItem).where(
                    KnowledgeItem.domain_id == domain_id, KnowledgeItem.status == "published"
                )
            )
        ).all()

    sample = items[::4] or items  # 대략 1/4 간격으로 샘플링, 최소 몇 건은 확보
    assert sample, "seeded FAQ가 없습니다"

    hits = 0
    async with async_session_factory() as session:
        for item in sample:
            results = await hybrid_search(session, domain_id, item.question, top_k=3)
            if any(r.item_id == item.id for r in results):
                hits += 1

    recall = hits / len(sample)
    assert recall >= 0.9, f"recall@3={recall:.2f} (기대: >=0.9), sample={len(sample)}"


async def test_in_domain_query_scores_higher_than_out_of_domain():
    domain_id = await _get_domain_id()
    async with async_session_factory() as session:
        in_domain = await top1_similarity(session, domain_id, "하이테크과정 나이 제한이 어떻게 되나요?")
        out_of_domain = await top1_similarity(session, domain_id, "오늘 서울 날씨 어때요?")

    assert in_domain is not None and out_of_domain is not None
    assert in_domain > out_of_domain
