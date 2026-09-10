import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_domain, get_or_create_session_id, read_session_id, set_session_cookie
from app.db.models import Conversation, Domain, Feedback, Message
from app.db.session import async_session_factory, get_db
from app.services.chat import stream_turn

router = APIRouter(prefix="/api/chat", tags=["chat"])


class CreateSessionResponse(BaseModel):
    conversation_id: int
    domain_name: str


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
) -> CreateSessionResponse:
    session_id = await get_or_create_session_id(request, response)
    conversation = Conversation(
        session_id=session_id,
        domain_id=domain.id,
        client_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    session.add(conversation)
    await session.commit()
    await session.refresh(conversation)
    return CreateSessionResponse(conversation_id=conversation.id, domain_name=domain.name)


class SendMessageRequest(BaseModel):
    conversation_id: int
    content: str


async def _get_owned_conversation(
    session: AsyncSession, conversation_id: int, session_id: uuid.UUID | None
) -> Conversation:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None or session_id is None or conversation.session_id != session_id:
        raise HTTPException(status_code=404, detail="conversation not found")
    return conversation


@router.post("/messages")
async def send_message(
    payload: SendMessageRequest,
    request: Request,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
) -> StreamingResponse:
    session_id = read_session_id(request)
    await _get_owned_conversation(session, payload.conversation_id, session_id)  # 소유권만 미리 확인 (404 조기 반환)

    async def event_stream():
        # StreamingResponse의 바디는 응답 반환 이후 소비되는데, 그 시점엔 Depends(get_db) 세션이
        # 이미 종료되어 있을 수 있다. 그래서 스트리밍 동안 쓸 세션은 별도로 새로 연다.
        async with async_session_factory() as db:
            conversation = await db.get(Conversation, payload.conversation_id)
            turn_domain = await db.get(Domain, domain.id)
            async for event in stream_turn(db, conversation, turn_domain, payload.content):
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"

    resp = StreamingResponse(event_stream(), media_type="text/event-stream")
    set_session_cookie(resp, session_id)  # _get_owned_conversation이 통과했으므로 session_id는 not None
    return resp


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    blocked: bool
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def get_conversation_messages(
    conversation_id: int, request: Request, session: AsyncSession = Depends(get_db)
) -> list[Message]:
    session_id = read_session_id(request)
    await _get_owned_conversation(session, conversation_id, session_id)
    rows = (
        await session.scalars(
            select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
        )
    ).all()
    return list(rows)


class FeedbackRequest(BaseModel):
    rating: int
    comment: str | None = None


@router.post("/messages/{message_id}/feedback")
async def submit_feedback(
    message_id: int, payload: FeedbackRequest, session: AsyncSession = Depends(get_db)
) -> dict:
    if payload.rating not in (-1, 1):
        raise HTTPException(status_code=400, detail="rating must be -1 or 1")

    message = await session.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="message not found")

    existing = await session.scalar(select(Feedback).where(Feedback.message_id == message_id))
    if existing:
        existing.rating = payload.rating
        existing.comment = payload.comment
    else:
        session.add(Feedback(message_id=message_id, rating=payload.rating, comment=payload.comment))
    await session.commit()
    return {"status": "ok"}
