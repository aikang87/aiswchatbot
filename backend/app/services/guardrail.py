import re
from dataclasses import dataclass

from app.db.models import Domain
from app.prompts import load as load_prompt
from app.services import llm
from app.services.embedding import aencode_one

INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"이전\s*(지시|명령|설정)\s*(은|를)?\s*(무시|잊)",
        r"시스템\s*프롬프트",
        r"너의?\s*규칙",
        r"역할\s*을?\s*바꿔",
        r"지침\s*을?\s*(무시|따르지)",
        r"ignore\s+(all\s+)?(previous|above)\s+instructions",
        r"system\s+prompt",
        r"jailbreak",
        r"you\s+are\s+now\b",
        r"disregard\s+(all\s+)?(previous|prior)\b",
    ]
]


@dataclass
class GuardrailResult:
    blocked: bool
    stage: str | None = None  # 'pre'
    reason: str | None = None
    category: str | None = None  # 'injection' | 'out_of_scope' | 'meta'
    canned_response: str | None = None  # category='meta'일 때 LLM 호출 없이 바로 쓸 응답


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _as_vector(value) -> list[float]:
    if isinstance(value, str):
        return [float(x) for x in value.strip("[]").split(",")]
    return list(value)


async def stage1_check(domain: Domain, query: str) -> GuardrailResult:
    """LLM 호출 전 사전 차단: 인젝션 룰 -> centroid 유사도 -> (애매할 때만) LLM 분류기."""
    for pattern in INJECTION_PATTERNS:
        if pattern.search(query):
            return GuardrailResult(blocked=True, stage="pre", reason="injection_pattern", category="injection")

    if domain.centroid_embedding is None:
        return GuardrailResult(blocked=False)

    query_vec = await aencode_one(query)
    centroid = _as_vector(domain.centroid_embedding)
    similarity = _cosine_similarity(query_vec, centroid)

    if similarity >= domain.scope_threshold:
        return GuardrailResult(blocked=False)

    # centroid 유사도가 낮은 애매한 구간만 LLM 분류기로 재확인 (비용 절약)
    prompt = load_prompt("classifier.ko.md").format(domain_description=domain.description, query=query)
    label = (await llm.classify([{"role": "user", "content": prompt}], max_tokens=8)).strip().upper()

    if "OUT_OF_SCOPE" in label:
        return GuardrailResult(
            blocked=True, stage="pre", reason=f"llm_classifier:{label}", category="out_of_scope"
        )
    if "META" in label:
        canned = load_prompt("meta_intro.ko.md").format(domain_name=domain.name)
        return GuardrailResult(blocked=False, category="meta", canned_response=canned)

    # IN_SCOPE 또는 분류 실패(빈 응답 등) -> 통과시키고 Stage 3(검색근거)에 판단을 맡긴다
    return GuardrailResult(blocked=False)
