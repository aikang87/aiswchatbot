import pytest_asyncio

from app.db.session import engine


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _dispose_engine_at_session_end():
    yield
    # 세션 이벤트 루프가 닫히기 전에 풀의 커넥션을 정리해야
    # Windows(ProactorEventLoop) + asyncpg 조합에서 teardown 시점에
    # "Event loop is closed" 오류가 나지 않는다.
    await engine.dispose()
