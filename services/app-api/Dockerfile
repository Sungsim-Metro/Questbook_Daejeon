# Questbook app-api 컨테이너 이미지. uv로 의존성을 설치한다.
FROM python:3.11-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /usr/local/bin/
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

WORKDIR /app/services/app-api
# 의존성 레이어를 소스와 분리해 캐시 효율을 높인다.
COPY services/app-api/pyproject.toml services/app-api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/app-api/src ./src
RUN uv sync --frozen --no-dev

FROM python:3.11-slim

WORKDIR /app
# editable 설치이므로 venv와 src를 같은 레이아웃으로 함께 복사한다.
COPY --from=builder /app/services/app-api/.venv /app/services/app-api/.venv
COPY services/app-api/src /app/services/app-api/src

ENV PATH="/app/services/app-api/.venv/bin:${PATH}"
EXPOSE 8100
CMD ["questbook-api"]
