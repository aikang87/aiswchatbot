from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent


@lru_cache
def load(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")
