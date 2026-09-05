# 데이터베이스 디렉토리

PostgreSQL 마이그레이션과 기준 데이터를 보관한다. baseline 스키마는 PostgreSQL 방언과 네이티브 타입(`TIMESTAMPTZ`, `BOOLEAN`, `JSONB`) 기준으로 관리한다.

- `migrations/`: 사용자, 선호도, 퀘스트, 뱃지, 수첩, 파트너, 리워드 PostgreSQL 스키마 변경
- `seeds/`: `Category`, `BadgeDefinition`, `GgumdoriVariant` 같은 기준 데이터

로컬 개발 DB에 직접 적용할 때는 compose 스택을 실행한 뒤 다음 명령을 사용한다. 신규 DB는 번호 순서대로 `001_baseline_schema.sql`과 `002_adventure_note_entries.sql`을 적용한다. `002`는 멱등 변경이므로 `001`에 최신 컬럼이 포함된 신규 DB에도 안전하게 다시 적용할 수 있다.

```bash
docker compose up -d postgres redis
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < database/migrations/001_baseline_schema.sql
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < database/migrations/002_adventure_note_entries.sql
```

기존 데이터가 있는 DB에는 `public` 스키마를 삭제하지 않는다. 먼저 백업한 뒤 `002`만 적용한다. 이 마이그레이션은 기존 수첩 행의 유형을 `diary`로, 제목과 본문을 빈 문자열로 보정하며, 사용자가 아직 글을 저장하지 않은 기록의 `entry_updated_at`은 `NULL`로 유지한다.

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < database/migrations/002_adventure_note_entries.sql
```

`001_baseline_schema.sql`의 `CREATE TABLE IF NOT EXISTS`만 다시 실행하면 기존 테이블에 새 컬럼이 추가되지 않는다. 앱 API 기동 시 `QuestbookRepository.initialize()`가 실행 코드에 내장된 호환 스키마를 보완하지만, 운영 배포에서는 코드 배포 전에 `002`를 명시적으로 적용하고 결과를 확인한다.

한국관광공사 OpenAPI 원본 응답 전체, API Key, access token, secret 값은 이 디렉토리에 넣지 않는다.
