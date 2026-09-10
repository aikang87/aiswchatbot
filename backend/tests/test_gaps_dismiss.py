"""
지식 공백 삭제(숨기기) 기능 검증. 공유 dev DB를 오염시키지 않도록
이 테스트가 만든 conversation/message는 끝에 직접 정리한다.
"""
import pytest
from sqlalchemy import select

from app.db.models import Conversation, Domain, Message
from app.db.session import async_session_factory
from app.services.analytics import compute_gaps, dismiss_gap_messages
from scripts.seed_domain import DOMAIN_NAME

pytestmark = pytest.mark.asyncio

PROBE_QUESTION = "__test_probe__ 지식공백 삭제 테스트 질문입니다"


async def test_dismiss_removes_cluster_from_gaps():
    async with async_session_factory() as session:
        domain = await session.scalar(select(Domain).where(Domain.name == DOMAIN_NAME))
        assert domain is not None

        conversation = Conversation(session_id=__import__("uuid").uuid4(), domain_id=domain.id)
        session.add(conversation)
        await session.flush()

        user_msg = Message(conversation_id=conversation.id, role="user", content=PROBE_QUESTION)
        session.add(user_msg)
        await session.flush()

        assistant_msg = Message(
            conversation_id=conversation.id,
            role="assistant",
            content="죄송합니다, 확인이 어렵습니다.",
            blocked=True,
            block_stage="retrieval",
            block_reason="top1_similarity=0.1",
        )
        session.add(assistant_msg)
        await session.commit()
        assistant_id = assistant_msg.id

    try:
        async with async_session_factory() as session:
            clusters = await compute_gaps(session, domain.id, limit=200)
            assert any(PROBE_QUESTION in c.examples for c in clusters), "생성한 probe 메시지가 gaps에 안 잡힘"

        async with async_session_factory() as session:
            dismissed = await dismiss_gap_messages(session, domain.id, [assistant_id])
            assert dismissed == 1

        async with async_session_factory() as session:
            clusters = await compute_gaps(session, domain.id, limit=200)
            assert not any(PROBE_QUESTION in c.examples for c in clusters), "dismiss 후에도 gaps에 남아있음"
    finally:
        async with async_session_factory() as session:
            await session.delete(await session.get(Message, assistant_id))
            await session.delete(await session.get(Message, user_msg.id))
            await session.delete(await session.get(Conversation, conversation.id))
            await session.commit()
