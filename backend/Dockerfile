FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.cache/huggingface

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# 1) 의존성만 먼저 설치(레이어 캐시). pyproject.toml의 packages.find가 app 패키지를
#    찾으므로, 실제 소스가 들어오기 전까지 쓸 빈 스텁을 만들어둔다.
COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py \
    && pip install --upgrade pip \
    && pip install torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install . \
    && rm -rf app

# 2) 임베딩 모델을 이미지에 미리 구워 넣는다 — 배포 서버가 인터넷이 안 되거나
#    느려도 컨테이너 기동 시 HuggingFace Hub 접근이 필요 없게 하기 위함.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')"

# 3) 실제 소스 복사 (app, alembic, scripts, tests, pytest.ini, alembic.ini 등)
COPY . .

RUN chmod +x docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
