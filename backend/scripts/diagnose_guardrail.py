import asyncio
from pathlib import Path

import yaml
from sqlalchemy import select

from app.db.models import Domain
from app.db.session import async_session_factory
from app.services.retrieval import top1_similarity
from scripts.seed_domain import DOMAIN_NAME

GOLDEN = yaml.safe_load(
    (Path(__file__).parent.parent / "tests" / "fixtures" / "golden_queries.yaml").read_text(encoding="utf-8")
)


async def main() -> None:
    async with async_session_factory() as session:
        domain = await session.scalar(select(Domain).where(Domain.name == DOMAIN_NAME))

        for label in ("in_domain", "out_of_domain"):
            scores = []
            for query in GOLDEN[label]:
                top1 = await top1_similarity(session, domain.id, query)
                scores.append((top1, query))
            scores.sort()
            print(f"=== {label} (min -> max) ===")
            for s, q in scores:
                print(f"  {s:.3f}  {q}")
            print()


if __name__ == "__main__":
    asyncio.run(main())
