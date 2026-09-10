import asyncio
from functools import lru_cache

from sentence_transformers import SentenceTransformer

from app.config import get_settings

settings = get_settings()


@lru_cache
def _get_model() -> SentenceTransformer:
    return SentenceTransformer(settings.embedding_model)


def encode_batch(texts: list[str]) -> list[list[float]]:
    """CPU/GPU 연산이므로 이벤트 루프에서 직접 호출하지 말고 aencode_batch를 사용할 것."""
    model = _get_model()
    vectors = model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
    return vectors.tolist()


async def aencode_batch(texts: list[str]) -> list[list[float]]:
    return await asyncio.to_thread(encode_batch, texts)


async def aencode_one(text: str) -> list[float]:
    vectors = await aencode_batch([text])
    return vectors[0]
