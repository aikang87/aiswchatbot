"""
seed된 domain의 published knowledge_items를 전부 재색인(임베딩+tsvector 생성)하고,
검색 품질을 눈으로 확인할 수 있도록 샘플 질의 몇 개를 실행해 top-3 결과를 출력한다.
"""
import asyncio

from sqlalchemy import select

from app.db.models import Domain
from app.db.session import async_session_factory
from app.services.indexing import reindex_domain
from app.services.retrieval import hybrid_search
from scripts.seed_domain import DOMAIN_NAME

SAMPLE_QUERIES = [
    "등록금이 얼마나 드나요?",
    "하이테크과정 나이 제한이 어떻게 되나요?",
    "취업은 어디로 하나요?",
    "기숙사 들어갈 수 있어요?",
    "오늘 서울 날씨 어때요?",  # 분야 외 질문 — top-1 유사도가 낮게 나오는지 확인용
]


async def main() -> None:
    async with async_session_factory() as session:
        domain = await session.scalar(select(Domain).where(Domain.name == DOMAIN_NAME))
        if not domain:
            raise SystemExit("domain not found — scripts/seed_domain.py 먼저 실행하세요.")

        count = await reindex_domain(session, domain.id)
        print(f"[reindexed] {count} chunks for domain id={domain.id}\n")

        for query in SAMPLE_QUERIES:
            results = await hybrid_search(session, domain.id, query, top_k=3)
            print(f"Q: {query}")
            if not results:
                print("  (검색 결과 없음)")
            for rank, r in enumerate(results, start=1):
                print(
                    f"  [{rank}] score={r.score:.4f} vrank={r.vector_rank} "
                    f"trank={r.text_rank} grank={r.trgm_rank}"
                )
                print(f"      Q: {r.question}")
                print(f"      A: {r.answer[:60]}...")
            print()


if __name__ == "__main__":
    asyncio.run(main())
