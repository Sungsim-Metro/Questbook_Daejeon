# 데이터베이스 디렉토리

PostgreSQL 마이그레이션과 기준 데이터를 보관한다. baseline 스키마는 PostgreSQL 방언과 네이티브 타입(`TIMESTAMPTZ`, `BOOLEAN`, `JSONB`) 기준으로 관리한다.

- `migrations/`: 사용자, 선호도, 퀘스트, 뱃지, 수첩, 파트너, 리워드 PostgreSQL 스키마 변경
- `seeds/`: `Category`, `BadgeDefinition`, `GgumdoriVariant` 같은 기준 데이터

로컬 개발 DB에 직접 적용할 때는 compose 스택을 실행한 뒤 다음 명령을 사용한다. `001_baseline_schema.sql`은 `CREATE TABLE IF NOT EXISTS` 기준이므로 기존 스키마의 컬럼 타입을 바꾸지 않는다. 타입 변경을 반영하려면 로컬 개발 DB의 `public` 스키마를 재생성한 뒤 적용한다. 앱 API 기동 시 `QuestbookRepository.initialize()`도 같은 스키마를 자동 생성한다.

```bash
docker compose up -d postgres redis
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < database/migrations/001_baseline_schema.sql
```

한국관광공사 OpenAPI 원본 응답 전체, API Key, access token, secret 값은 이 디렉토리에 넣지 않는다.
