from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Domain, KnowledgeChunk, KnowledgeItem
from app.services.embedding import aencode_batch, aencode_one

FTS_CONFIG = "simple"  # 한국어는 형태소 분석 없이 simple config + pg_trgm 보조 검색으로 커버


def build_chunk_content(item: KnowledgeItem) -> str:
    return f"Q: {item.question}\nA: {item.answer}"


async def reindex_item(session: AsyncSession, item: KnowledgeItem) -> None:
    """FAQ 1건을 청크 1개로 재색인한다 (기존 청크는 지우고 새로 생성)."""
    await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.item_id == item.id))

    content = build_chunk_content(item)
    embedding = (await aencode_batch([content]))[0]

    chunk = KnowledgeChunk(
        item_id=item.id,
        content=content,
        embedding=embedding,
        tsv=func.to_tsvector(FTS_CONFIG, content),
        token_count=len(content) // 2,  # 대략치 (형태소 토크나이저 붙이기 전까지의 근사값)
    )
    session.add(chunk)


async def update_domain_centroid(session: AsyncSession, domain: Domain) -> None:
    """Stage 1 가드레일 유사도 판정에 쓸 도메인 centroid = (published 청크 평균 벡터 + 설명문 벡터)의 평균."""
    chunk_avg = await session.scalar(
        select(func.avg(KnowledgeChunk.embedding))
        .select_from(KnowledgeChunk)
        .join(KnowledgeItem, KnowledgeItem.id == KnowledgeChunk.item_id)
        .where(KnowledgeItem.domain_id == domain.id, KnowledgeItem.status == "published")
    )
    description_vec = await aencode_one(domain.description)

    if chunk_avg is None:
        centroid = description_vec
    else:
        if isinstance(chunk_avg, str):  # func.avg() 결과는 Vector 타입 정보가 없어 pgvector 원문 문자열로 온다
            chunk_avg = [float(x) for x in chunk_avg.strip("[]").split(",")]
        centroid = [(a + b) / 2 for a, b in zip(chunk_avg, description_vec)]

    domain.centroid_embedding = centroid
    session.add(domain)


async def reindex_domain(session: AsyncSession, domain_id: int) -> int:
    """도메인 내 published 상태 knowledge_items를 전부 재색인하고, centroid도 갱신한 뒤 처리 건수를 반환한다."""
    domain = await session.get(Domain, domain_id)
    if domain is None:
        raise ValueError(f"domain {domain_id} not found")

    items = (
        await session.scalars(
            select(KnowledgeItem).where(
                KnowledgeItem.domain_id == domain_id,
                KnowledgeItem.status == "published",
            )
        )
    ).all()

    for item in items:
        await reindex_item(session, item)

    await session.flush()
    await update_domain_centroid(session, domain)

    await session.commit()
    return len(items)
