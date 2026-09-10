"""
프로젝트 루트의 FAQ.csv(학과 공식 FAQ)를 knowledge_items에 시드한다.

CSV 컬럼: Num, Q, A
공식 자료이므로 status='published'로 바로 게시한다 (RAG 검색 대상).

재실행하면 이 스크립트가 이전에 채운 항목(source='manual')을 모두 지우고
CSV 내용으로 다시 채운다 — CSV가 갱신되면 그대로 재실행하면 된다.
단, 로그에서 승격(source='promoted')된 항목이나 문서 업로드(source='document')
항목은 건드리지 않는다.
"""
import asyncio
import csv
from pathlib import Path

from sqlalchemy import delete, select

from app.db.models import Domain, KnowledgeItem
from app.db.session import async_session_factory
from scripts.seed_domain import DOMAIN_NAME

CSV_PATH = Path(__file__).resolve().parents[2] / "FAQ.csv"


def load_faqs() -> list[tuple[str, str]]:
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return [(row["Q"].strip(), row["A"].strip()) for row in reader if row.get("Q") and row.get("A")]


async def seed_faq() -> None:
    faqs = load_faqs()
    if not faqs:
        raise SystemExit(f"no rows loaded from {CSV_PATH}")

    async with async_session_factory() as session:
        domain = await session.scalar(select(Domain).where(Domain.name == DOMAIN_NAME))
        if not domain:
            raise SystemExit("domain not found — scripts/seed_domain.py 먼저 실행하세요.")

        await session.execute(
            delete(KnowledgeItem).where(
                KnowledgeItem.domain_id == domain.id,
                KnowledgeItem.source == "manual",
            )
        )

        for question, answer in faqs:
            session.add(
                KnowledgeItem(
                    domain_id=domain.id,
                    question=question,
                    answer=answer,
                    status="published",
                    source="manual",
                )
            )
        await session.commit()
        print(f"[loaded] {len(faqs)} published FAQ items from {CSV_PATH.name} for domain id={domain.id}")


if __name__ == "__main__":
    asyncio.run(seed_faq())
