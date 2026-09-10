"""
관리자 계정을 생성하거나 비밀번호를 갱신한다 (upsert).
사용법: python -m scripts.create_admin <email> <password>
"""
import asyncio
import sys

from sqlalchemy import select

from app.db.models import AdminUser
from app.db.session import async_session_factory
from app.services.auth import hash_password


async def create_admin(email: str, password: str) -> None:
    async with async_session_factory() as session:
        admin = await session.scalar(select(AdminUser).where(AdminUser.email == email))
        password_hash = hash_password(password)
        if admin:
            admin.password_hash = password_hash
            print(f"[updated] admin id={admin.id} email={admin.email!r}")
        else:
            admin = AdminUser(email=email, password_hash=password_hash)
            session.add(admin)
            await session.flush()
            print(f"[created] admin id={admin.id} email={admin.email!r}")
        await session.commit()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m scripts.create_admin <email> <password>")
    asyncio.run(create_admin(sys.argv[1], sys.argv[2]))
