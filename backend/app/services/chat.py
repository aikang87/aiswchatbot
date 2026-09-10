import time
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Conversation, Domain, Message, MessageCitation
from app.prompts import load as load_prompt
from app.services import llm
from app.services.guardrail import stage1_check
from app.services.retrieval import RetrievedChunk, hybrid_search, top1_similarity

HISTORY_TURNS = 6  # 최근 N턴(사용자+어시스턴트 합쳐 최대 2*N개 메시지)을 컨텍스트에 포함
TOP_K = 5


def _build_context_block(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "(관련 자료 없음)"
    return "\n\n".join(f"[{i}] Q: {c.question}\nA: {c.answer}" for i, c in enumerate(chunks, start=1))


async def _recent_history(session: AsyncSession, conversation_id: int) -> list[dict]:
    rows = (
        await session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id, Message.blocked.is_(False))
            .order_by(Message.created_at.desc())
            .limit(HISTORY_TURNS * 2)
        )
    ).all()
    return [{"role": m.role, "content": m.content} for m in reversed(rows)]


async def _save_message(session: AsyncSession, conversation_id: int, role: str, content: str, **kwargs) -> Message:
    message = Message(conversation_id=conversation_id, role=role, content=content, **kwargs)
    session.add(message)
    await session.flush()
    return message


async def stream_turn(session: AsyncSession, conversation: Conversation, domain: Domain, user_text: str) -> AsyncIterator[dict[str, Any]]:
    """사용자 발화 1건을 처리한다. SSE 엔드포인트가 그대로 소비할 수 있는 이벤트 dict를 yield한다.

    이벤트 종류: {"type": "citations"|"delta"|"blocked"|"done", "data": ...}
    """
    t0 = time.monotonic()
    await _save_message(session, conversation.id, "user", user_text)
    await session.commit()

    guard = await stage1_check(domain, user_text)

    if guard.blocked:
        refusal = load_prompt("refusal.ko.md").format(domain_name=domain.name)
        assistant_message = await _save_message(
            session,
            conversation.id,
            "assistant",
            refusal,
            blocked=True,
            block_stage=guard.stage,
            block_reason=guard.reason,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
        await session.commit()
        yield {"type": "blocked", "data": {"reason": guard.reason}}
        yield {"type": "delta", "data": refusal}
        yield {"type": "done", "data": {"message_id": assistant_message.id}}
        return

    if guard.category == "meta":
        assistant_message = await _save_message(
            session,
            conversation.id,
            "assistant",
            guard.canned_response,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
        await session.commit()
        yield {"type": "delta", "data": guard.canned_response}
        yield {"type": "done", "data": {"message_id": assistant_message.id}}
        return

    chunks = await hybrid_search(session, domain.id, user_text, top_k=TOP_K)
    top_score = await top1_similarity(session, domain.id, user_text)

    if top_score is None or top_score < domain.retrieval_threshold:
        refusal = load_prompt("refusal.ko.md").format(domain_name=domain.name)
        assistant_message = await _save_message(
            session,
            conversation.id,
            "assistant",
            refusal,
            blocked=True,
            block_stage="retrieval",
            block_reason=f"top1_similarity={top_score}",
            top_score=top_score,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
        await session.commit()
        yield {"type": "blocked", "data": {"reason": "retrieval_below_threshold", "top_score": top_score}}
        yield {"type": "delta", "data": refusal}
        yield {"type": "done", "data": {"message_id": assistant_message.id}}
        return

    yield {
        "type": "citations",
        "data": [
            {"rank": i, "question": c.question, "answer": c.answer, "score": c.score}
            for i, c in enumerate(chunks, start=1)
        ],
    }

    context_block = _build_context_block(chunks)
    system_prompt = load_prompt("system.ko.md").format(
        domain_system_prompt=domain.system_prompt, context=context_block
    )
    history = await _recent_history(session, conversation.id)
    messages = [{"role": "system", "content": system_prompt}, *history]

    full_text = ""
    async for delta in llm.stream_chat(messages):
        full_text += delta
        yield {"type": "delta", "data": delta}

    full_text = full_text.strip() or "죄송합니다, 답변을 생성하지 못했습니다."

    assistant_message = await _save_message(
        session,
        conversation.id,
        "assistant",
        full_text,
        top_score=top_score,
        latency_ms=int((time.monotonic() - t0) * 1000),
        model=llm.settings.llm_model,
    )
    for rank, c in enumerate(chunks, start=1):
        session.add(MessageCitation(message_id=assistant_message.id, chunk_id=c.chunk_id, score=c.score, rank=rank))
    await session.commit()

    yield {"type": "done", "data": {"message_id": assistant_message.id}}
