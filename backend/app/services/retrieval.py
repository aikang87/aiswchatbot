from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import KnowledgeChunk, KnowledgeItem
from app.services.embedding import aencode_one
from app.services.indexing import FTS_CONFIG

RRF_K = 60
TRGM_MIN_SIMILARITY = 0.05


@dataclass
class RetrievedChunk:
    chunk_id: int
    item_id: int
    question: str
    answer: str
    content: str
    score: float  # RRF fused score (관리자/디버깅용, 절대 임계값 비교에는 top-1 raw 유사도 사용 권장)
    vector_rank: int | None
    text_rank: int | None
    trgm_rank: int | None


async def _vector_candidates(session: AsyncSession, domain_id: int, query_vec: list[float], limit: int):
    distance = KnowledgeChunk.embedding.cosine_distance(query_vec)
    stmt = (
        select(KnowledgeChunk.id, (1 - distance).label("similarity"))
        .join(KnowledgeItem, KnowledgeItem.id == KnowledgeChunk.item_id)
        .where(KnowledgeItem.domain_id == domain_id, KnowledgeItem.status == "published")
        .order_by(distance)
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [(row.id, row.similarity) for row in rows]


async def _text_candidates(session: AsyncSession, domain_id: int, query_text: str, limit: int):
    """tsvector 정확 단어 매칭 — 한국어 조사 변화에는 약하지만 URL/전화번호/숫자 등 정확 토큰 매칭에 유용."""
    tsquery = func.plainto_tsquery(FTS_CONFIG, query_text)
    rank = func.ts_rank_cd(KnowledgeChunk.tsv, tsquery)
    stmt = (
        select(KnowledgeChunk.id, rank.label("rank"))
        .join(KnowledgeItem, KnowledgeItem.id == KnowledgeChunk.item_id)
        .where(
            KnowledgeItem.domain_id == domain_id,
            KnowledgeItem.status == "published",
            KnowledgeChunk.tsv.op("@@")(tsquery),
        )
        .order_by(rank.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [(row.id, row.rank) for row in rows]


async def _trgm_candidates(session: AsyncSession, domain_id: int, query_text: str, limit: int):
    """pg_trgm 유사도 — 한국어는 조사 변화 때문에 tsvector 매칭이 거의 안 먹히므로 이 채널이 주력 어휘 검색."""
    similarity = func.similarity(KnowledgeChunk.content, query_text)
    stmt = (
        select(KnowledgeChunk.id, similarity.label("sim"))
        .join(KnowledgeItem, KnowledgeItem.id == KnowledgeChunk.item_id)
        .where(
            KnowledgeItem.domain_id == domain_id,
            KnowledgeItem.status == "published",
            similarity > TRGM_MIN_SIMILARITY,
        )
        .order_by(similarity.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [(row.id, row.sim) for row in rows]


async def hybrid_search(
    session: AsyncSession,
    domain_id: int,
    query_text: str,
    top_k: int = 5,
    candidate_pool: int = 20,
) -> list[RetrievedChunk]:
    query_vec = await aencode_one(query_text)

    vector_hits = await _vector_candidates(session, domain_id, query_vec, candidate_pool)
    text_hits = await _text_candidates(session, domain_id, query_text, candidate_pool)
    trgm_hits = await _trgm_candidates(session, domain_id, query_text, candidate_pool)

    vector_rank = {chunk_id: rank for rank, (chunk_id, _) in enumerate(vector_hits, start=1)}
    text_rank = {chunk_id: rank for rank, (chunk_id, _) in enumerate(text_hits, start=1)}
    trgm_rank = {chunk_id: rank for rank, (chunk_id, _) in enumerate(trgm_hits, start=1)}

    fused_scores: dict[int, float] = {}
    for rank_map in (vector_rank, text_rank, trgm_rank):
        for chunk_id, rank in rank_map.items():
            fused_scores[chunk_id] = fused_scores.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank)

    if not fused_scores:
        return []

    top_ids = sorted(fused_scores, key=lambda cid: fused_scores[cid], reverse=True)[:top_k]

    chunks_by_id = {
        chunk.id: chunk
        for chunk in (
            await session.scalars(select(KnowledgeChunk).where(KnowledgeChunk.id.in_(top_ids)))
        ).all()
    }
    items_by_id = {
        item.id: item
        for item in (
            await session.scalars(
                select(KnowledgeItem).where(
                    KnowledgeItem.id.in_([chunks_by_id[cid].item_id for cid in top_ids])
                )
            )
        ).all()
    }

    results = []
    for chunk_id in top_ids:
        chunk = chunks_by_id[chunk_id]
        item = items_by_id[chunk.item_id]
        results.append(
            RetrievedChunk(
                chunk_id=chunk.id,
                item_id=item.id,
                question=item.question,
                answer=item.answer,
                content=chunk.content,
                score=fused_scores[chunk_id],
                vector_rank=vector_rank.get(chunk_id),
                text_rank=text_rank.get(chunk_id),
                trgm_rank=trgm_rank.get(chunk_id),
            )
        )
    return results


async def top1_similarity(session: AsyncSession, domain_id: int, query_text: str) -> float | None:
    """Stage 3 가드레일 임계값 판정에 쓸 top-1 코사인 유사도 (0~1, 클수록 유사)."""
    query_vec = await aencode_one(query_text)
    hits = await _vector_candidates(session, domain_id, query_vec, limit=1)
    return hits[0][1] if hits else None
