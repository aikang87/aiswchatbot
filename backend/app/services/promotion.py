from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Conversation, Domain, KnowledgeItem, Message
from app.services.indexing import reindex_item, update_domain_centroid


async def promote_message_to_knowledge(
    session: AsyncSession,
    message_id: int,
    question: str,
    answer: str,
    tags: list[str] | None = None,
    status: str = "published",
) -> KnowledgeItem:
    """차단/저점수 로그(질문)를 FAQ로 승격한다. status='published'면 즉시 재색인+centroid 갱신까지 한다."""
    message = await session.get(Message, message_id)
    if message is None:
        raise ValueError(f"message {message_id} not found")

    conversation = await session.get(Conversation, message.conversation_id)
    if conversation is None:
        raise ValueError(f"conversation {message.conversation_id} not found")

    item = KnowledgeItem(
        domain_id=conversation.domain_id,
        question=question,
        answer=answer,
        tags=tags,
        status=status,
        source="promoted",
        source_message_id=message_id,
    )
    session.add(item)
    await session.flush()

    if status == "published":
        await reindex_item(session, item)
        domain = await session.get(Domain, conversation.domain_id)
        await update_domain_centroid(session, domain)

    await session.commit()
    await session.refresh(item)
    return item
