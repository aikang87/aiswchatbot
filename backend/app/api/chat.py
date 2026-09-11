import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_domain,
    get_or_create_session_id,
    issue_new_session_id,
    read_session_id,
    set_session_cookie,
)
from app.config import get_settings
from app.db.models import Conversation, Domain, Feedback, Message
from app.db.session import async_session_factory, get_db
from app.services.chat import stream_turn

router = APIRouter(prefix="/api/chat", tags=["chat"])
settings = get_settings()


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


@router.post("/sessions/reset", response_model=CreateSessionResponse)
async def reset_session(
    response: Response,
    request: Request,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
) -> CreateSessionResponse:
    """기존 session_id 쿠키를 버리고 완전히 새로 발급한다 (하드 리셋). 새 대화도 함께 만든다."""
    session_id = issue_new_session_id(response)
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


def _check_hard_expiry(conversation: Conversation) -> None:
    """session_hard_reset_hours가 지난 대화는 안내 없이 쿠키/대화를 통째로 새로 시작해야 하므로
    410(Gone)으로 응답해 프론트가 /sessions/reset을 호출하도록 신호를 준다."""
    age = datetime.now(timezone.utc) - conversation.started_at
    if age > timedelta(hours=settings.session_hard_reset_hours):
        raise HTTPException(
            status_code=410,
            detail={
                "code": "session_hard_expired",
                "message": f"세션이 {settings.session_hard_reset_hours}시간 넘게 지나 초기화합니다.",
            },
        )


async def _check_session_limits(session: AsyncSession, conversation: Conversation) -> int:
    """세션 만료/질문 한도를 검사하고, 이번 질문 이전까지 쌓인 질문 수를 반환한다."""
    _check_hard_expiry(conversation)

    age = datetime.now(timezone.utc) - conversation.started_at
    if age > timedelta(hours=settings.session_max_age_hours):
        # 자동 초기화(하드 리셋)까지 남은 시각 — 프론트가 "몇시간 몇분 후 다시 이용 가능"을 표시하는 데 쓴다.
        available_at = conversation.started_at + timedelta(hours=settings.session_hard_reset_hours)
        raise HTTPException(
            status_code=403,
            detail={
                "code": "session_soft_expired",
                "message": f"세션 유지 시간({settings.session_max_age_hours}시간)이 지났습니다. 새 대화를 시작해주세요.",
                "available_at": available_at.isoformat(),
            },
        )

    question_count = (
        await session.scalar(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == conversation.id, Message.role == "user")
        )
        or 0
    )
    if question_count >= settings.session_max_questions:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "question_limit_exceeded",
                "message": f"세션당 질문 한도({settings.session_max_questions}개)를 초과했습니다. 새 대화를 시작해주세요.",
            },
        )
    return question_count


@router.post("/messages")
async def send_message(
    payload: SendMessageRequest,
    request: Request,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
) -> StreamingResponse:
    session_id = read_session_id(request)
    conversation = await _get_owned_conversation(session, payload.conversation_id, session_id)  # 소유권만 미리 확인 (404 조기 반환)
    prior_question_count = await _check_session_limits(session, conversation)

    async def event_stream():
        # StreamingResponse의 바디는 응답 반환 이후 소비되는데, 그 시점엔 Depends(get_db) 세션이
        # 이미 종료되어 있을 수 있다. 그래서 스트리밍 동안 쓸 세션은 별도로 새로 연다.
        async with async_session_factory() as db:
            conversation = await db.get(Conversation, payload.conversation_id)
            turn_domain = await db.get(Domain, domain.id)
            async for event in stream_turn(db, conversation, turn_domain, payload.content):
                data = event["data"]
                if event["type"] == "done":
                    data = {
                        **data,
                        "question_count": prior_question_count + 1,
                        "question_limit": settings.session_max_questions,
                    }
                yield f"event: {event['type']}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

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
    conversation = await _get_owned_conversation(session, conversation_id, session_id)
    _check_hard_expiry(conversation)
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
