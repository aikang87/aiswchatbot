# AISW — 도메인 한정 FAQ 챗봇

특정 분야로 범위가 한정된 사내형 FAQ 챗봇. 설계 배경과 전체 계획은 [PLAN.md](./PLAN.md) 참고.

## 현재 진행 상태

- [x] 1단계: 인프라 스캐폴딩
- [x] 2단계: 데이터 모델 + 마이그레이션 + 시드
- [x] 3단계: LLM · 임베딩 · 검색 서비스
- [x] 4단계: 가드레일 + 채팅 오케스트레이션
- [x] 5단계: 관리자 API + 승격 파이프라인
- [x] 6단계: 프론트엔드

## 1단계: 로컬 실행

```bash
# 1. DB 기동 (pgvector 포함 PostgreSQL 16)
docker compose up -d db

# 2. 백엔드 의존성 설치
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e .

# 3. 환경변수 준비
cp ../.env.example .env   # 필요시 LLM_BASE_URL 등 수정

# 4. 마이그레이션 (pgvector/pg_trgm extension 활성화)
.venv/Scripts/python.exe -m alembic upgrade head

# 5. 서버 실행
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

확인:
- `GET http://localhost:8000/healthz` → `{"status":"ok"}`
- `GET http://localhost:8000/healthz/db` → `{"status":"ok","db":"reachable"}`

## 2단계: 데이터 모델 + 시드

대상 분야: **한국폴리텍대학 서울정수캠퍼스 인공지능소프트웨어과 입학상담**

```bash
cd backend
.venv/Scripts/python.exe -m scripts.seed_domain   # domains 테이블에 분야 1건 시드 (idempotent)
.venv/Scripts/python.exe -m scripts.seed_faq       # 루트의 FAQ.csv(학과 공식 FAQ)를 knowledge_items에 로드
```

`scripts/seed_faq.py`는 프로젝트 루트의 `FAQ.csv`(학과 제공 공식 FAQ, `Num,Q,A` 컬럼)를 읽어 `status='published'`로 적재한다. CSV를 갱신하면 스크립트를 재실행하면 되는데, 재실행 시 이전에 이 스크립트가 넣은 항목(`source='manual'`)만 지우고 다시 채우며, 로그에서 승격된 항목(`source='promoted'`)이나 문서 업로드 항목(`source='document'`)은 건드리지 않는다.

테이블: `domains`, `knowledge_items`, `knowledge_chunks`(HNSW+GIN 인덱스), `documents`, `conversations`, `messages`(복합 인덱스 2종), `message_citations`, `feedback`, `admin_users`, `audit_logs`.

## 3단계: LLM · 임베딩 · 검색 서비스

```bash
cd backend
.venv/Scripts/python.exe -m pip install -e ".[dev]"   # sentence-transformers, openai, pytest 등 추가
.venv/Scripts/python.exe -m scripts.reindex_all         # published FAQ 전부 임베딩+tsvector 색인, 샘플 질의 5건 결과 출력
.venv/Scripts/python.exe -m pytest tests/test_retrieval.py -v
```

- `app/services/embedding.py` — `BAAI/bge-m3`(1024차원) 로컬 실행, `sentence-transformers`. 최초 실행 시 모델을 HuggingFace Hub에서 캐시로 내려받는다(수 분 소요, 이후는 캐시 재사용).
- `app/services/indexing.py` — FAQ 1건을 `Q: ...\nA: ...` 청크 1개로 임베딩·색인.
- `app/services/retrieval.py` — **3채널 하이브리드 검색**을 RRF(Reciprocal Rank Fusion)로 결합:
  - 벡터 검색 (`pgvector` cosine distance, HNSW 인덱스)
  - tsvector 정확 단어 매칭 (`simple` config, GIN 인덱스) — URL/전화번호/숫자 등 정확 토큰에 유용
  - **pg_trgm 유사도** (GIN trigram 인덱스) — 한국어는 조사 변화(`등록금을` vs `등록금이`) 때문에 tsvector 매칭이 사실상 안 먹혀서 이 채널이 실질적인 어휘 검색 역할을 한다. `reindex_all.py`로 검증하며 발견한 문제였고, 계획에 있던 pg_trgm 보조 검색을 실제로 연결해 해결했다.
  - `top1_similarity()`는 Stage 3 가드레일(4단계)에서 임계값 판정에 쓸 원본 코사인 유사도를 반환한다.
- `app/services/llm.py` — 자체 LLM 서버(OpenAI 호환, `https://code.aikopo.net/v1`, 모델 `qwen3-27b`) 스트리밍/분류 클라이언트. 실제 연동 검증 완료. 발견한 문제 2가지와 조치:
  - **Cloudflare가 User-Agent에 "OpenAI"가 포함된 요청을 403으로 차단**한다(openai SDK 기본 UA가 `AsyncOpenAI/Python ...`). `default_headers={"User-Agent": "aisw-backend/0.1"}`로 우회.
  - openai SDK 3.x가 내부적으로 쓰는 `httpx2`/`httpcore2`가 이 Python 3.14 환경에서 스트리밍 종료 시 `generator didn't stop after athrow()` 경고를 뱉는다. `http_client=httpx.AsyncClient()`(표준 httpx)를 주입해 회피.
  - `qwen3-27b`는 추론(thinking) 모델이라 `max_tokens`가 작으면 사고 토큰만 쓰고 답변(`content`)이 비어서 나온다. `extra_body={"chat_template_kwargs": {"enable_thinking": False}}`로 기본 비활성화(분류/요약처럼 단순 작업에는 불필요). reasoning은 응답의 별도 필드(`message.reasoning`)로 분리되어 나와서 어차피 `content`에는 섞이지 않는다.
- `tests/test_retrieval.py` — recall@3, 분야 내/외 유사도 분리 검증 (통과 확인됨). Windows에서 pytest-asyncio 기본값(테스트별 새 이벤트 루프) + asyncpg 조합이 테스트 간 커넥션 재사용 시 깨지는 문제가 있어 `pytest.ini`에서 `asyncio_default_fixture_loop_scope`/`asyncio_default_test_loop_scope`를 `session`으로 고정했다.

## 4단계: 가드레일 + 채팅 오케스트레이션

```bash
cd backend
.venv/Scripts/python.exe -m scripts.reindex_all     # centroid_embedding까지 함께 갱신됨 (아래 참고)
.venv/Scripts/python.exe -m pytest tests/test_guardrail.py -v

# 수동 e2e 확인
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
curl -s -c cookies.txt -X POST http://localhost:8000/api/chat/sessions
curl -s -N -b cookies.txt -X POST http://localhost:8000/api/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": 1, "content": "등록금이 얼마나 드나요?"}'
```

**3단계 가드레일** (`app/services/guardrail.py`, `app/services/chat.py`)
1. **사전 차단 (Stage 1)** — 인젝션 정규식 → `domains.centroid_embedding`(설명문+published 청크 평균 벡터, `indexing.update_domain_centroid()`가 `reindex_domain()` 안에서 자동 갱신) 유사도가 `scope_threshold` 미만인 애매한 경우만 LLM 분류기(`IN_SCOPE`/`META`/`OUT_OF_SCOPE`) 호출. `META`(예: "너는 누구니?")는 LLM 본답변 없이 고정 소개 문구로 응답.
2. **프롬프트 제약 (Stage 2)** — `domain.system_prompt` + 번호 매긴 검색 컨텍스트(`[1] Q: ... A: ...`)를 시스템 메시지로 구성, LLM이 인용 번호를 달아 답하도록 유도.
3. **검색근거 사후 차단 (Stage 3)** — `retrieval.top1_similarity()`가 `retrieval_threshold` 미만이면 **LLM을 아예 호출하지 않고** 고정 거절.

모든 차단은 `messages.blocked/block_stage/block_reason/top_score`로 기록된다 (관리자가 5단계에서 지식 공백으로 활용할 데이터).

**임계값 튜닝 (골든셋, `tests/fixtures/golden_queries.yaml`: 분야 내 20 / 분야 외 20 / 인젝션 8)**
초기값 `RETRIEVAL_THRESHOLD=0.45`로는 분야 외 차단율이 85%(17/20)에 그쳤다("삼성전자 주가", "파이썬 정렬", "비트코인" 등 top1 유사도 0.454~0.458이 새어나감). `scripts/diagnose_guardrail.py`로 전체 분포를 뽑아보니 분야 내 최저 0.492, 분야 외 최고 0.458로 깨끗하게 갈라져서, 중간값인 **0.475**로 올려 DB(`domains.retrieval_threshold`)와 `.env` 기본값을 갱신했다. 이후 골든셋 3개 테스트(인젝션 100% 차단, 분야 내 오차단 ≤5%, 분야 외 차단 ≥95%) 전부 통과.

**API** (`app/api/chat.py`, `app/api/meta.py`)
- `POST /api/chat/sessions` — 익명 세션 쿠키 발급 + conversation 생성
- `POST /api/chat/messages` — SSE 스트리밍(`event: citations|delta|blocked|done`)
- `GET /api/chat/conversations/{id}/messages`, `POST /api/chat/messages/{id}/feedback`
- `GET /api/meta/domain`

curl로 분야 내/분야 외/인젝션/META 4가지 케이스 전부 수동 검증 완료 — 인용 번호(`[1][2]`)가 실제로 붙어 나오는 것, 차단 시 LLM이 호출되지 않는 것, DB에 `blocked`/`top_score`/`message_citations`가 정확히 기록되는 것까지 확인.

## 5단계: 관리자 API + 승격 파이프라인

```bash
cd backend
.venv/Scripts/python.exe -m scripts.create_admin admin@example.com <비밀번호>   # 관리자 계정 생성/비번 변경 (upsert)
.venv/Scripts/python.exe -m pytest tests/test_analytics.py -v

.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
TOKEN=$(curl -s -X POST http://localhost:8000/api/admin/login -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<비밀번호>"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/admin/gaps
```

**인증** (`app/services/auth.py`) — bcrypt 해시 + JWT(HS256, `python-jose`). 원래 계획대로 `passlib[bcrypt]`를 쓰려 했으나 **passlib 1.7.4가 bcrypt 5.x와 호환이 깨져 있어**(`module 'bcrypt' has no attribute '__about__'`) 기본 해시조차 실패했다. passlib는 사실상 유지보수가 끊긴 상태라, `bcrypt` 패키지를 직접 사용하는 것으로 바꿨다(의존성도 하나 줄어듦).

**API** (`app/api/admin.py`, 전부 `Authorization: Bearer <JWT>` 필요, `require_admin` 의존성으로 보호)
- `POST /api/admin/login`
- `GET /api/admin/conversations` — 필터: `blocked`, `q`(키워드), `since`/`until`, `limit`/`offset`
- `GET /api/admin/conversations/{id}` — 메시지 전체 + 인용 포함
- `GET /api/admin/gaps` — 차단된 질문을 임베딩 그리디 클러스터링해 빈도순으로 반환 (**기능2 핵심**: "지식이 없어서 못 답한 질문" 발굴)
- `GET /api/admin/stats` — 대화수/차단율/일별 추이/피드백 비율/상위 지식공백
- `POST /api/admin/knowledge`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/reindex` — FAQ CRUD (published로 저장/수정 시 자동 재색인 + centroid 갱신)
- `POST /api/admin/knowledge/promote` — `{message_id, question, answer, tags?, status?}`로 로그를 FAQ로 승격 (`app/services/promotion.py`, `source='promoted'`, `source_message_id`로 출처 추적)
- `PUT /api/admin/domain` — 시스템 프롬프트/임계값 조정
- 쓰기 작업은 전부 `audit_logs`에 기록

**발견한 버그 하나 (회귀 테스트로 고정)**: `compute_gaps()`가 "직전 사용자 질문"을 얻으려고 `LAG() OVER (PARTITION BY conversation_id ORDER BY id)`를 썼는데, `WHERE role='assistant' AND blocked=true`를 **같은 SELECT**에 걸어버려서 SQL 실행순서상 LAG가 필터링된 행(차단된 assistant 메시지들끼리) 위에서 계산돼버렸다. 그 결과 "직전 사용자 질문"이 아니라 "그 전에 차단됐던 다른 assistant의 거절 문구"가 대표 질문으로 나오는 버그였다. LAG 계산을 서브쿼리로 분리해 전체 메시지 위에서 먼저 계산하도록 고쳤고, `tests/test_analytics.py`로 재발 방지 테스트를 추가했다.

curl로 로그인/미인증 401/conversations/conversation 상세/gaps/stats/knowledge CRUD/promote/reindex/domain 설정까지 전부 수동 검증 완료. **1차 범위에서 제외한 것**: `POST /api/admin/documents`(파일 업로드→파싱→청킹) — 계획에서도 "2단계 확장"으로 명시된 기능이라, FAQ 중심의 1차 범위(CSV/수동/승격)에서는 제외했다.

## 6단계: 프론트엔드

```bash
cd frontend
npm install
npm run dev             # http://localhost:5173
```

`.env`의 `VITE_API_BASE`(기본 `http://localhost:8000`)로 백엔드를 가리킨다. 백엔드 `.env`의 `CORS_ORIGINS`도 `http://localhost:5173`을 포함해야 한다(기본값이 이미 그렇게 되어 있음).

**스택**: React + TypeScript + Vite, Tailwind v4, `@tanstack/react-query`, `react-router-dom`.

**클라이언트 채팅** (`/`) — 관리자 인증 없이 익명 세션 쿠키로 동작.
- `hooks/useChatStream.ts`가 `POST /api/chat/messages`의 SSE 응답을 `fetch` + `ReadableStream`으로 직접 파싱한다(네이티브 `EventSource`는 GET만 지원해서 못 씀). `citations` → `delta`(스트리밍 타이핑) → `blocked`/`done` 순서로 처리.
- `conversation_id`는 `localStorage`에 저장해 새로고침해도 대화가 이어지도록 함.
- 인용 출처 펼쳐보기, 차단 시 안내 배지, 답변별 👍/👎 피드백 지원.

**관리자 화면** (`/admin/*`, JWT는 `localStorage`) — 로그인, 대화 로그(필터+상세), 지식 공백(클러스터→FAQ 승격 다이얼로그), FAQ 관리(CRUD+재색인), 통계(일별 대화수 막대그래프 + 차단율/피드백 스탯), 설정(시스템 프롬프트/임계값).

**백엔드에서 같이 고친 것**: 프론트를 실제로 붙여보면서 빠진 엔드포인트 2개를 발견해 추가했다 — `GET /api/admin/knowledge`(목록 조회가 아예 없었음), `GET /api/admin/domain`(설정 화면이 현재값을 읽어올 방법이 없었음). 그리고 방금 스트리밍한 답변에 피드백을 달려면 그 메시지의 DB id가 필요한데 `done` SSE 이벤트에 안 담겨 있어서, `chat.py`의 세 `done` 지점 모두에 `message_id`를 넣도록 고쳤다. `/api/admin/gaps` 응답에도 승격에 필요한 `representative_message_id`를 추가했다(`analytics.py`의 `GapCluster`가 대표 메시지 id를 함께 추적하도록).

**브라우저 자동화 도구가 이 환경에 없어서** Playwright를 새로 설치해 실제 Chromium으로 골든 패스를 검증했다(`frontend/smoke-test.mjs`, `npx playwright install chromium --with-deps` 필요): 채팅 로드 → 분야 내 질문(인용 확인) → 출처 펼치기 → 피드백 클릭 → 분야 외 질문 차단 → 관리자 로그인 → 대화 목록/상세 → 지식 공백 → FAQ 목록 → 통계 → 설정, 12단계 전부 통과, 콘솔 에러 없음. 이 과정에서 실제 버그 하나를 발견: **통계 페이지의 일별 막대그래프가 안 그려지는 문제** — 바깥 flex 컨테이너에 `items-end`를 줘서 막대의 부모가 `h-40`(고정 높이)로 stretch되지 않았고, 그 결과 자식 막대에 준 퍼센트 높이(`height: 50%` 등)가 계산될 기준 높이가 없어 사실상 무시되는 CSS 문제였다. `items-end`를 빼고(기본값 `stretch`) 각 열에 `h-full`을 명시해 고쳤고, 스크린샷으로 실제 막대가 채워지는 것까지 확인했다.

## 6단계 이후 UX/기능 보완

- **탭 타이틀을 "AISW"로 변경** (`frontend/index.html`).
- **채팅 입력창이 화면 하단에 너무 멀리 있다는 피드백 반영**: 기존엔 채팅 패널이 `h-svh`(뷰포트 전체 높이)로 고정돼 있어서, 메시지가 1~2개뿐이어도 입력창이 항상 화면 맨 아래에 있었다. `Chat.tsx`를 CSS Grid(`grid-rows-[auto_1fr_auto]`) + `max-height`(고정 `height` 아님) 조합으로 바꿔서, 메시지가 적으면 카드 자체가 내용 크기만큼 작아져 입력창이 바로 붙고, 메시지가 많아지면 카드가 최대 높이(700px 또는 화면의 85%)에서 멈추고 가운데 메시지 영역만 내부 스크롤되도록 했다. Playwright 스크린샷으로 빈 화면/메시지 1건/메시지 여러 건 세 가지 상태를 전부 확인.
- **지식 공백(gaps) 탐지 범위 확장**: 그동안은 Stage1/Stage3 가드레일이 명시적으로 차단한 질문(`messages.blocked=true`)만 지식 공백으로 잡았는데, "LLM이 검색 컨텍스트를 받고도 인용 없이 '확인이 어렵습니다'로 답한 경우"(`blocked=false`로 저장됨)는 완전히 누락되고 있었다. `analytics.py`의 `compute_gaps()`에 `message_citations`가 있으면서 답변에 인용 번호(`[숫자]`) 패턴이 없는 경우를 `no_citation_in_answer`로 추가 탐지하도록 확장 — 실제로 "등록금이 얼마나 드나요?"(5회) 같은, FAQ.csv에 정확한 금액이 없어 LLM이 스스로 답을 거부한 질문이 최상위 지식 공백으로 잡히는 것을 확인했다.
- **지식 공백 삭제(숨기기) 기능 추가**: `messages.gap_dismissed` 컬럼(마이그레이션 `4ced1fc7b5d3`)을 추가해, 클러스터를 삭제해도 원본 대화 로그는 지우지 않고 목록에서만 숨긴다(감사 추적 보존, 실수해도 DB에서 복구 가능). `POST /api/admin/gaps/dismiss`(`message_ids` 배열)와 Gaps 페이지의 "삭제" 버튼으로 연결. 클러스터 안에 묶인 예시들 전체의 message_id를 `GapCluster.message_ids`로 함께 추적하도록 해서, 삭제 시 클러스터 전체(대표 질문 + 유사 예시들)가 한 번에 사라진다.

## Docker Compose로 다른 서버에 배포하기

`docker-compose.yml` 하나로 `db`(pgvector) + `backend`(FastAPI) + `frontend`(정적 빌드 + nginx) 세 컨테이너가 뜬다. 프론트는 nginx가 `/api/*`를 backend 컨테이너로 리버스 프록시하는 **동일 출처(same-origin)** 구조라 CORS 설정이 사실상 필요 없고, 외부에는 80 포트 하나만 열면 된다.

```bash
docker compose build
docker compose up -d db          # DB 먼저 기동
# 기존 데이터를 옮기는 경우 이 시점에 아래 "기존 데이터 옮기기"로 복원
docker compose up -d backend frontend
```

백엔드 컨테이너는 시작할 때마다 `alembic upgrade head`를 자동 실행한다(멱등적이라 안전). **FAQ 시드(`scripts.seed_faq`)는 자동 실행하지 않는다** — 매번 실행하면 관리자가 UI로 수정한 FAQ까지 CSV로 덮어써 버리기 때문에, 최초 1회만 수동으로 돌리는 걸 의도했다.

### 새 서버에 복사해야 할 것

**1) 프로젝트 소스** — 저장소 전체(`git clone` 또는 디렉터리 복사). 최소한 다음은 있어야 한다:
- `docker-compose.yml`
- `backend/`(`Dockerfile`, `docker-entrypoint.sh`, `pyproject.toml`, `app/`, `alembic/`, `alembic.ini`, `scripts/`)
- `frontend/`(`Dockerfile`, `nginx.conf`, `package.json`, `package-lock.json`, `index.html`, `src/`, `postcss.config.js`, `tsconfig*.json`, `vite.config.ts`)
- `FAQ.csv` (최초 시드용 원본 데이터)

**2) `.env` 파일 (git에 안 올라가 있음 — 반드시 별도로 옮겨야 함)**
- `backend/.env` — 여기에 실제 `LLM_BASE_URL`, `LLM_MODEL`, `ADMIN_JWT_SECRET`, `RETRIEVAL_THRESHOLD` 등 튜닝된 값이 들어있다. **이 파일이 없으면 배포한 서비스가 로컬 개발용 기본값으로 뜬다.**
- HTTPS 뒤에 배포한다면 `backend/.env`의 `SESSION_COOKIE_SECURE=false`를 `true`로 바꿀 것 (아니면 관리자/사용자 세션 쿠키가 브라우저에 저장 안 될 수 있다).

**3) 지금까지 쌓인 데이터 (git에 안 올라가 있음)**
- `aisw_dump.sql` (프로젝트 루트) — FAQ, 대화 로그, 관리자 계정(`admin@example.com`)이 전부 들어있는 `pg_dump` 결과. 배포 직전에 `docker exec aisw-db pg_dump -U aisw --no-owner --no-privileges aisw > aisw_dump.sql`로 최신 상태를 다시 떠서 옮길 것.

### 기존 데이터 옮기기 (지금 상태를 그대로 유지)

```bash
# 새 서버에서
docker compose up -d db
# db가 healthy 상태가 될 때까지 대기 (docker compose ps로 확인)
docker exec -i aisw-db psql -U aisw -d aisw < aisw_dump.sql

docker compose up -d backend frontend
```

덤프에는 스키마+데이터가 전부 들어있어 위 순서(빈 db에 덤프 복원 → 그다음 backend 기동)로 하면 `alembic upgrade head`는 이미 최신 버전임을 확인하고 아무 것도 안 한다. **주의**: `docker exec -i aisw-db psql ...`는 db 컨테이너가 완전히 비어있을 때만 실행할 것 — 이미 데이터가 있는 DB에 다시 restore하면 중복 키 에러가 난다.

### 반대로 완전히 새로 시작하는 경우 (기존 데이터 없이)

```bash
docker compose up -d db backend
docker compose exec backend python -m scripts.seed_domain
docker compose exec backend python -m scripts.seed_faq
docker compose exec backend python -m scripts.reindex_all
docker compose exec backend python -m scripts.create_admin admin@example.com <원하는 비밀번호>
docker compose up -d frontend
```

### 확인

- `curl http://<서버>:8000/healthz` — nginx는 `/api/*`만 프록시하므로 `/healthz`는 백엔드 포트(8000)로 직접 확인
- 브라우저로 `http://<서버>/` (채팅), `http://<서버>/admin/login` (관리자)

실제로 `docker compose build && docker compose up -d`로 로컬에서 세 컨테이너를 전부 새로 빌드·기동해 기존 `aisw_pgdata` 볼륨(=지금까지의 FAQ/대화/관리자 계정)이 그대로 유지되는 것과, Playwright로 채팅 스트리밍·인용·피드백·차단·관리자 전 화면이 nginx 프록시를 거쳐도 문제없이 동작하는 것까지 확인했다. 이 과정에서 실제 버그 두 개를 발견해 고쳤다:

1. **프론트가 계속 `http://localhost:8000`으로 절대경로 요청을 보내 브라우저에서 CORS 에러가 났다.** 원인은 두 가지가 겹쳐 있었다.
   - `frontend/.dockerignore`에 `.env`가 빠져 있어서, 로컬 개발용 `frontend/.env`(`VITE_API_BASE=http://localhost:8000`)가 그대로 이미지 빌드 컨텍스트에 들어갔다. `.dockerignore`에 `.env`를 추가해서 제외했다.
   - 더 근본적인 문제: `client.ts`가 `import.meta.env.VITE_API_BASE || "http://localhost:8000"`처럼 `||`를 썼는데, 같은 출처 배포를 위해 의도적으로 넘긴 빈 문자열(`""`)이 JS에서 falsy라 `||`가 항상 오른쪽 fallback 값으로 대체해버렸다. `??`(nullish coalescing)로 바꿔서, `undefined`일 때만 fallback하도록 고쳤다. 로컬 dev에서는 `.env`에 항상 값이 들어있어서 이 버그가 지금까지 드러나지 않았다.
2. 위 두 가지를 고치기 전까지는 `docker compose build frontend --no-cache`를 다시 돌려도 빌드 산출물 해시가 그대로였는데(`.env`가 여전히 읽히고 있었다는 신호), Dockerfile에 임시 디버그 `RUN` 라인을 넣어 실제 빌드 컨텍스트 안의 `.env` 존재 여부와 `VITE_API_BASE` 값을 직접 찍어보고서야 원인을 확정했다.
