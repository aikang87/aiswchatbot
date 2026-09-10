from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_domain, require_admin
from app.db.models import (
    AdminUser,
    AuditLog,
    Conversation,
    Domain,
    KnowledgeItem,
    Message,
    MessageCitation,
)
from app.db.session import get_db
from app.services.analytics import compute_gaps, compute_stats, dismiss_gap_messages
from app.services.auth import create_access_token, verify_password
from app.services.indexing import reindex_item, update_domain_centroid
from app.services.promotion import promote_message_to_knowledge

router = APIRouter(prefix="/api/admin", tags=["admin"])

VALID_STATUSES = ("draft", "published", "archived")


def _knowledge_out(item: KnowledgeItem) -> dict:
    return {
        "id": item.id,
        "question": item.question,
        "answer": item.answer,
        "tags": item.tags,
        "status": item.status,
        "source": item.source,
        "source_message_id": item.source_message_id,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


# --- 로그인 ---


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_db)) -> LoginResponse:
    admin = await session.scalar(select(AdminUser).where(AdminUser.email == payload.email))
    if admin is None or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")
    return LoginResponse(access_token=create_access_token(admin.id))


# --- 대화 로그 조회 ---


@router.get("/conversations")
async def list_conversations(
    blocked: bool | None = None,
    q: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> list[dict]:
    stmt = select(Conversation).where(Conversation.domain_id == domain.id)
    if since is not None:
        stmt = stmt.where(Conversation.started_at >= since)
    if until is not None:
        stmt = stmt.where(Conversation.started_at <= until)
    if blocked is not None:
        stmt = stmt.where(
            Conversation.id.in_(select(Message.conversation_id).where(Message.blocked.is_(blocked)))
        )
    if q:
        stmt = stmt.where(
            Conversation.id.in_(select(Message.conversation_id).where(Message.content.ilike(f"%{q}%")))
        )
    stmt = stmt.order_by(Conversation.started_at.desc()).limit(limit).offset(offset)

    conversations = (await session.scalars(stmt)).all()
    result = []
    for conv in conversations:
        total = await session.scalar(
            select(func.count()).select_from(Message).where(Message.conversation_id == conv.id)
        )
        blocked_count = await session.scalar(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == conv.id, Message.blocked.is_(True))
        )
        result.append(
            {
                "id": conv.id,
                "session_id": str(conv.session_id),
                "started_at": conv.started_at,
                "last_message_at": conv.last_message_at,
                "message_count": total or 0,
                "blocked_count": blocked_count or 0,
            }
        )
    return result


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: int,
    session: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="conversation not found")

    messages = (
        await session.scalars(
            select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
        )
    ).all()

    citations_by_message: dict[int, list[dict]] = {}
    if messages:
        citations = (
            await session.scalars(
                select(MessageCitation).where(MessageCitation.message_id.in_([m.id for m in messages]))
            )
        ).all()
        for c in citations:
            citations_by_message.setdefault(c.message_id, []).append(
                {"chunk_id": c.chunk_id, "score": c.score, "rank": c.rank}
            )

    return {
        "id": conversation.id,
        "session_id": str(conversation.session_id),
        "started_at": conversation.started_at,
        "last_message_at": conversation.last_message_at,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "blocked": m.blocked,
                "block_stage": m.block_stage,
                "block_reason": m.block_reason,
                "top_score": m.top_score,
                "created_at": m.created_at,
                "citations": citations_by_message.get(m.id, []),
            }
            for m in messages
        ],
    }


# --- 지식 공백 / 통계 ---


@router.get("/gaps")
async def get_gaps(
    limit: int = 20,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> list[dict]:
    clusters = await compute_gaps(session, domain.id, limit=limit)
    return [
        {
            "representative": c.representative,
            "representative_message_id": c.representative_message_id,
            "message_ids": c.message_ids,
            "count": c.count,
            "examples": c.examples,
            "last_seen": c.last_seen,
            "last_block_reason": c.last_block_reason,
        }
        for c in clusters
    ]


class DismissGapsRequest(BaseModel):
    message_ids: list[int]


@router.post("/gaps/dismiss")
async def dismiss_gaps(
    payload: DismissGapsRequest,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    if not payload.message_ids:
        raise HTTPException(status_code=400, detail="message_ids must not be empty")

    count = await dismiss_gap_messages(session, domain.id, payload.message_ids)
    session.add(
        AuditLog(
            admin_id=admin.id,
            action="gaps.dismiss",
            target=",".join(str(i) for i in payload.message_ids),
        )
    )
    await session.commit()
    return {"status": "ok", "dismissed": count}


@router.get("/stats")
async def get_stats(
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    return await compute_stats(session, domain.id)


# --- FAQ/지식 관리 ---


@router.get("/knowledge")
async def list_knowledge(
    status: str | None = None,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> list[dict]:
    if status is not None and status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {VALID_STATUSES}")

    stmt = select(KnowledgeItem).where(KnowledgeItem.domain_id == domain.id)
    if status:
        stmt = stmt.where(KnowledgeItem.status == status)
    stmt = stmt.order_by(KnowledgeItem.updated_at.desc())
    items = (await session.scalars(stmt)).all()
    return [_knowledge_out(i) for i in items]


class KnowledgeCreateRequest(BaseModel):
    question: str
    answer: str
    tags: list[str] | None = None
    status: str = "draft"


class KnowledgeUpdateRequest(BaseModel):
    question: str | None = None
    answer: str | None = None
    tags: list[str] | None = None
    status: str | None = None


class PromoteRequest(BaseModel):
    message_id: int
    question: str
    answer: str
    tags: list[str] | None = None
    status: str = "published"


@router.post("/knowledge")
async def create_knowledge(
    payload: KnowledgeCreateRequest,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {VALID_STATUSES}")

    item = KnowledgeItem(
        domain_id=domain.id,
        question=payload.question,
        answer=payload.answer,
        tags=payload.tags,
        status=payload.status,
        source="manual",
    )
    session.add(item)
    await session.flush()

    if payload.status == "published":
        await reindex_item(session, item)
        await update_domain_centroid(session, domain)

    session.add(AuditLog(admin_id=admin.id, action="knowledge.create", target=str(item.id)))
    await session.commit()
    await session.refresh(item)
    return _knowledge_out(item)


@router.post("/knowledge/promote")
async def promote_knowledge(
    payload: PromoteRequest,
    session: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {VALID_STATUSES}")
    try:
        item = await promote_message_to_knowledge(
            session, payload.message_id, payload.question, payload.answer, payload.tags, payload.status
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    session.add(
        AuditLog(
            admin_id=admin.id,
            action="knowledge.promote",
            target=str(item.id),
            payload={"message_id": payload.message_id},
        )
    )
    await session.commit()
    return _knowledge_out(item)


@router.put("/knowledge/{item_id}")
async def update_knowledge(
    item_id: int,
    payload: KnowledgeUpdateRequest,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    item = await session.get(KnowledgeItem, item_id)
    if item is None or item.domain_id != domain.id:
        raise HTTPException(status_code=404, detail="knowledge item not found")

    content_changed = False
    if payload.question is not None:
        item.question = payload.question
        content_changed = True
    if payload.answer is not None:
        item.answer = payload.answer
        content_changed = True
    if payload.tags is not None:
        item.tags = payload.tags
    if payload.status is not None:
        if payload.status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {VALID_STATUSES}")
        item.status = payload.status

    await session.flush()
    if item.status == "published" and content_changed:
        await reindex_item(session, item)
        await update_domain_centroid(session, domain)

    session.add(AuditLog(admin_id=admin.id, action="knowledge.update", target=str(item.id)))
    await session.commit()
    await session.refresh(item)
    return _knowledge_out(item)


@router.delete("/knowledge/{item_id}")
async def delete_knowledge(
    item_id: int,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    item = await session.get(KnowledgeItem, item_id)
    if item is None or item.domain_id != domain.id:
        raise HTTPException(status_code=404, detail="knowledge item not found")

    was_published = item.status == "published"
    await session.delete(item)
    session.add(AuditLog(admin_id=admin.id, action="knowledge.delete", target=str(item_id)))
    await session.commit()

    if was_published:
        await update_domain_centroid(session, domain)
        await session.commit()

    return {"status": "ok"}


@router.post("/knowledge/{item_id}/reindex")
async def reindex_knowledge(
    item_id: int,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    item = await session.get(KnowledgeItem, item_id)
    if item is None or item.domain_id != domain.id:
        raise HTTPException(status_code=404, detail="knowledge item not found")

    await reindex_item(session, item)
    await update_domain_centroid(session, domain)
    session.add(AuditLog(admin_id=admin.id, action="knowledge.reindex", target=str(item.id)))
    await session.commit()
    return {"status": "ok"}


# --- 도메인 설정 ---


def _domain_out(domain: Domain) -> dict:
    return {
        "name": domain.name,
        "system_prompt": domain.system_prompt,
        "scope_threshold": domain.scope_threshold,
        "retrieval_threshold": domain.retrieval_threshold,
    }


class DomainUpdateRequest(BaseModel):
    system_prompt: str | None = None
    scope_threshold: float | None = None
    retrieval_threshold: float | None = None


@router.get("/domain")
async def get_domain(
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    return _domain_out(domain)


@router.put("/domain")
async def update_domain(
    payload: DomainUpdateRequest,
    session: AsyncSession = Depends(get_db),
    domain: Domain = Depends(get_current_domain),
    admin: AdminUser = Depends(require_admin),
) -> dict:
    if payload.system_prompt is not None:
        domain.system_prompt = payload.system_prompt
    if payload.scope_threshold is not None:
        domain.scope_threshold = payload.scope_threshold
    if payload.retrieval_threshold is not None:
        domain.retrieval_threshold = payload.retrieval_threshold

    session.add(AuditLog(admin_id=admin.id, action="domain.update", target=str(domain.id)))
    await session.commit()
    await session.refresh(domain)
    return _domain_out(domain)
