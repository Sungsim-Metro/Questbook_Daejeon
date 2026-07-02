# 로컬 데이터 서비스

Questbook 로컬 개발용 PostgreSQL과 Redis 실행 구성을 보관한다.

## 실행

```bash
docker compose -f infra/local/postgres-redis.compose.yaml up -d
uv run --project services/app-api python scripts/check_local_data_services.py
```

## 기본 접속값

- PostgreSQL: `127.0.0.1:5432`, DB `questbook`, 사용자 `questbook`
- Redis: `127.0.0.1:6379`, DB `0`

기본 비밀번호는 로컬 개발 전용이다. 공유 서버나 운영 배포에서는 `.env` 또는 비밀 관리 도구로 `QUESTBOOK_POSTGRES_PASSWORD`를 반드시 교체한다.

## 종료

```bash
docker compose -f infra/local/postgres-redis.compose.yaml down
```

볼륨까지 삭제해야 하는 초기화 상황에서는 다음 명령을 사용한다.

```bash
docker compose -f infra/local/postgres-redis.compose.yaml down -v
```
