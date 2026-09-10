from collections.abc import AsyncIterator
from functools import lru_cache

import httpx
from openai import AsyncOpenAI

from app.config import get_settings

settings = get_settings()


@lru_cache
def get_client() -> AsyncOpenAI:
    """자체 LLM 서버(vLLM/SGLang 등 OpenAI 호환 엔드포인트)용 클라이언트.

    - User-Agent를 직접 지정한다: openai SDK 기본 UA("AsyncOpenAI/Python ...")는
      이 서버 앞단 Cloudflare가 "OpenAI"가 포함된 UA를 차단해서 그대로 쓰면 403이 난다.
    - http_client로 표준 httpx.AsyncClient를 주입한다: openai SDK가 기본으로 쓰는
      벤더링된 httpx2/httpcore2 조합이 이 Python 버전 조합에서 스트리밍 종료 시
      "generator didn't stop after athrow()" 경고를 뱉는 문제가 있어 이를 피한다.
    """
    return AsyncOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        default_headers={"User-Agent": "aisw-backend/0.1"},
        http_client=httpx.AsyncClient(),
    )


def _thinking_kwargs(enable_thinking: bool) -> dict:
    """qwen3는 추론(thinking) 모델이라 켜두면 답변 전에 사고 토큰을 소모한다.
    컨텍스트 요약/분류처럼 단순한 작업에는 꺼서 지연시간과 max_tokens 낭비를 막는다."""
    return {"extra_body": {"chat_template_kwargs": {"enable_thinking": enable_thinking}}}


async def stream_chat(
    messages: list[dict], *, temperature: float = 0.2, enable_thinking: bool = False
) -> AsyncIterator[str]:
    """assistant 응답을 델타 텍스트 스트림으로 반환한다 (reasoning 토큰은 섞이지 않고 content만)."""
    client = get_client()
    stream = await client.chat.completions.create(
        model=settings.llm_model,
        messages=messages,
        temperature=temperature,
        stream=True,
        **_thinking_kwargs(enable_thinking),
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def classify(messages: list[dict], *, max_tokens: int = 8) -> str:
    """가드레일 Stage 1 분류기 등, 짧고 결정적인 비스트리밍 응답이 필요할 때 사용."""
    client = get_client()
    response = await client.chat.completions.create(
        model=settings.llm_model,
        messages=messages,
        temperature=0,
        max_tokens=max_tokens,
        stream=False,
        **_thinking_kwargs(False),
    )
    return (response.choices[0].message.content or "").strip()
