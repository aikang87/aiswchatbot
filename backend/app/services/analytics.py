from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Conversation, Feedback, Message, MessageCitation
from app.services.embedding import aencode_batch

GAP_SIMILARITY_THRESHOLD = 0.8  # 이 이상이면 같은 질문 클러스터로 묶는다
GAP_CANDIDATE_LIMIT = 500
CITATION_MARKER_REGEX = r"\[[0-9]+\]"  # 답변에 이 패턴(예: [1])이 없으면 grounding 실패로 본다


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


@dataclass
class GapCluster:
    representative: str
    count: int
    representative_message_id: int
    message_ids: list[int]
    examples: list[str] = field(default_factory=list)
    last_seen: datetime | None = None
    last_block_reason: str | None = None


async def compute_gaps(session: AsyncSession, domain_id: int, limit: int = 20) -> list[GapCluster]:
    """지식 공백을 유발한 '사용자 질문'을 임베딩 기준 그리디 클러스터링해 빈도순으로 반환한다.

    지식 공백으로 잡는 두 가지 경우:
    1. Stage1/Stage3 가드레일이 명시적으로 차단한 경우 (messages.blocked=true)
    2. 가드레일은 통과해 LLM이 실제로 호출됐지만(citation이 달렸지만) 답변에 인용 번호가
       하나도 없는 경우 — LLM이 "컨텍스트로 답할 수 없다"고 스스로 판단해 시스템 프롬프트의
       고정 거절 문구로 답한 케이스로, blocked=false로 저장돼 있어 기존에는 지식 공백 목록에서
       완전히 누락됐다.

    messages 테이블은 각 턴마다 user -> assistant 순으로 저장되므로, 같은 대화 내에서
    id 기준 바로 앞 행의 content가 그 assistant 응답을 유발한 사용자 질문이다
    (LAG window function으로 계산).
    """
    # LAG는 WHERE로 걸러진 행 위에서 계산되므로, 관심 있는 assistant 행만 먼저 필터링해버리면
    # 그 직전 행이 사용자 질문이 아니라 "직전에 걸러졌던 다른 assistant 메시지"가 돼버린다.
    # 그래서 전체 메시지에 대해 LAG를 먼저 계산한 서브쿼리를 만들고, 바깥 쿼리에서 필터링한다.
    with_prev = select(
        Message.id,
        Message.conversation_id,
        Message.role,
        Message.content,
        Message.blocked,
        Message.block_reason,
        Message.gap_dismissed,
        Message.created_at,
        func.lag(Message.content)
        .over(partition_by=Message.conversation_id, order_by=Message.id)
        .label("prev_content"),
    ).subquery()

    has_citation = exists(
        select(MessageCitation.id).where(MessageCitation.message_id == with_prev.c.id)
    )
    grounding_failed = (
        with_prev.c.blocked.is_(False)
        & has_citation
        & ~with_prev.c.content.op("~")(CITATION_MARKER_REGEX)
    )

    stmt = (
        select(
            with_prev.c.prev_content.label("question"),
            with_prev.c.id.label("message_id"),
            with_prev.c.created_at,
            with_prev.c.blocked,
            with_prev.c.block_reason,
        )
        .join(Conversation, Conversation.id == with_prev.c.conversation_id)
        .where(
            Conversation.domain_id == domain_id,
            with_prev.c.role == "assistant",
            with_prev.c.gap_dismissed.is_(False),
            or_(with_prev.c.blocked.is_(True), grounding_failed),
        )
        .order_by(with_prev.c.created_at.desc())
        .limit(GAP_CANDIDATE_LIMIT)
    )
    rows = [r for r in (await session.execute(stmt)).all() if r.question]
    if not rows:
        return []

    vectors = await aencode_batch([r.question for r in rows])

    clusters: list[dict] = []
    for row, vec in zip(rows, vectors):
        reason = row.block_reason if row.blocked else "no_citation_in_answer"

        best_cluster = None
        best_sim = 0.0
        for cluster in clusters:
            sim = _cosine_similarity(vec, cluster["centroid"])
            if sim > best_sim:
                best_sim = sim
                best_cluster = cluster

        if best_cluster is not None and best_sim >= GAP_SIMILARITY_THRESHOLD:
            best_cluster["examples"].append(row.question)
            best_cluster["message_ids"].append(row.message_id)
            best_cluster["count"] += 1
            best_cluster["last_seen"] = max(best_cluster["last_seen"], row.created_at)
            best_cluster["last_block_reason"] = reason
        else:
            clusters.append(
                {
                    "centroid": vec,
                    "examples": [row.question],
                    "message_id": row.message_id,
                    "message_ids": [row.message_id],
                    "count": 1,
                    "last_seen": row.created_at,
                    "last_block_reason": reason,
                }
            )

    clusters.sort(key=lambda c: c["count"], reverse=True)
    return [
        GapCluster(
            representative=c["examples"][0],
            representative_message_id=c["message_id"],
            message_ids=c["message_ids"],
            count=c["count"],
            examples=c["examples"][:5],
            last_seen=c["last_seen"],
            last_block_reason=c["last_block_reason"],
        )
        for c in clusters[:limit]
    ]


async def dismiss_gap_messages(session: AsyncSession, domain_id: int, message_ids: list[int]) -> int:
    """지식 공백 클러스터 하나(에 속한 메시지 id들)를 목록에서 숨긴다. 원본 로그는 지우지 않고
    messages.gap_dismissed만 세운다 — 실수로 지워도 복구 가능하고 감사 추적이 남는다."""
    if not message_ids:
        return 0
    result = await session.execute(
        update(Message)
        .where(
            Message.id.in_(message_ids),
            Message.conversation_id.in_(select(Conversation.id).where(Conversation.domain_id == domain_id)),
        )
        .values(gap_dismissed=True)
    )
    await session.commit()
    return result.rowcount or 0


async def compute_stats(session: AsyncSession, domain_id: int) -> dict:
    total_conversations = await session.scalar(
        select(func.count()).select_from(Conversation).where(Conversation.domain_id == domain_id)
    )

    assistant_base = select(Message).join(Conversation, Conversation.id == Message.conversation_id).where(
        Conversation.domain_id == domain_id, Message.role == "assistant"
    )
    total_answers = await session.scalar(select(func.count()).select_from(assistant_base.subquery()))
    blocked_answers = await session.scalar(
        select(func.count()).select_from(
            assistant_base.where(Message.blocked.is_(True)).subquery()
        )
    )
    block_rate = (blocked_answers / total_answers) if total_answers else 0.0

    daily_rows = (
        await session.execute(
            select(func.date(Conversation.started_at).label("day"), func.count().label("n"))
            .where(Conversation.domain_id == domain_id)
            .group_by("day")
            .order_by("day")
        )
    ).all()

    feedback_rows = (
        await session.execute(
            select(Feedback.rating, func.count())
            .join(Message, Message.id == Feedback.message_id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.domain_id == domain_id)
            .group_by(Feedback.rating)
        )
    ).all()
    feedback_counts = {rating: n for rating, n in feedback_rows}

    top_gaps = await compute_gaps(session, domain_id, limit=5)

    return {
        "total_conversations": total_conversations or 0,
        "total_answers": total_answers or 0,
        "blocked_answers": blocked_answers or 0,
        "block_rate": block_rate,
        "daily_conversations": [{"date": str(day), "count": n} for day, n in daily_rows],
        "feedback": {"positive": feedback_counts.get(1, 0), "negative": feedback_counts.get(-1, 0)},
        "top_gaps": [
            {"representative": g.representative, "count": g.count, "examples": g.examples} for g in top_gaps
        ],
    }
