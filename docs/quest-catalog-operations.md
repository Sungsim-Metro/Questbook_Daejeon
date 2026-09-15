# 퀘스트 카탈로그 운영

## 적용 범위

정상 추천은 `TourAPI 또는 기존 유효 캐시 → 관광지 선별 → contentId로 저장된 퀘스트 조회` 순서다. 퀘스트가 없는 관광지는 주변·계획·대전 전체 정상 목록에 표시하지 않는다. 공용 퀘스트 생성은 별도 `catalog-sync` 작업이 담당한다.

API 실패 시 기존 예시 데이터 폴백을 유지한다. 실시간 클라이언트의 타임아웃·재시도·차단 정책, 30분 캐시, 게이트웨이 대기 시간은 이 변경에 포함하지 않는다. 위치 기반 DB 폴백도 추가하지 않는다.

## 갱신과 삭제 기준

- 프로세스 시작 시 오늘 실행 이력을 확인하며 이후 한국 날짜가 바뀌면 한 번 실행한다. 날짜 확인 간격은 60초다.
- DB 실행 이력과 공통 잠금으로 재시작·여러 프로세스의 중복 실행을 막는다. 원천 조회 실패도 그날의 시도로 기록하므로 자동 재시도는 다음 날짜다.
- 화면 조회의 최대 5페이지 제한과 별개로 전체 페이지를 수집한다. 페이지 누락·중복 ID·건수 불일치·오류가 있으면 기존 카탈로그를 유지한다.
- 정상 전체 조회에서 사라진 관광지는 `missing_since`와 정상 누락 관측일을 기록하고 신규 정상 추천에서 제외한다.
- 기본 삭제 유예는 7일이다. 첫 누락 후 7일 이상 경과하고 서로 다른 한국 날짜의 정상 누락 관측이 8회 이상이어야 공용 관광지 참조와 해당 카탈로그 퀘스트를 삭제한다. 같은 날 수동 재실행은 관측 횟수를 늘리지 않는다.
- 재등장하면 누락 상태와 횟수를 초기화한다. 원천 장애·부분 조회는 누락 관측이나 삭제의 근거로 사용하지 않는다.
- 도입 전 자동 생성한 실 관광지 퀘스트도 첫 정상 전체 조회부터 관리한다. 처음부터 원천에 없는 항목은 기존 생성 시각을 과거 근거로 보존하고 그날부터 누락을 관측한다. 예시 퀘스트와 수동 정의는 자동 편입·삭제하지 않는다.

`QUESTBOOK_CATALOG_MISSING_GRACE_DAYS`로 유예일을 변경할 수 있다. 값은 1 이상의 정수이며 필요한 정상 누락 관측일 수도 `유예일 + 1`로 함께 바뀐다. 예를 들어 14일 설정은 14일 경과와 15개 정상 누락 관측일을 요구한다.

## 사용자 기록 보존

공용 카탈로그에는 관광지 식별자·이름·내부 분류와 관측 상태를 저장한다. 원본 응답 전체·주소·설명 전문·이미지·전역 위치 검색용 좌표는 저장하지 않는다.

사용자가 수락하면 기존 사용자별 인스턴스에 미션 내용·보상·인증 조건·원래 공용 ID·버전을 고정한다. 서버가 조회한 해당 관광지의 최소 좌표 정보도 사용자별로 보존한다. 이후 공용 정의가 바뀌거나 삭제되어도 사용자는 사본 기준으로 완료하고, 완료 기록·수첩·분류 통계도 유지한다. 현장 인증에는 계속 실제 사용자 GPS를 제출해야 한다.

기존 수락·완료 기록에는 스키마 갱신 시 현재 남아 있는 정의를 복사한다. 이전 버전에서 저장하지 않았던 좌표나 이미 사라진 과거 내용은 복원하지 않는다. 좌표가 없는 기록은 기존 인증 경로를 사용하며, 서버가 같은 관광지를 확인하면 빈 좌표 사본만 보충한다. 이미 저장한 내용·보상·좌표는 이후 추천으로 덮어쓰지 않는다.

## Docker Compose 적용

저장소 루트에서 실행한다. 기존 `.env`의 `TOURAPI_SERVICE_KEY` 및 PostgreSQL 연결 설정을 사용하며 값은 출력할 필요가 없다.

```sh
docker compose up -d --build app catalog-sync
docker compose logs --tail=50 catalog-sync
```

앱과 작업 프로세스의 저장소 초기화가 새 스키마를 적용한다. 같은 변경의 명시적 SQL은 `database/migrations/004_quest_catalog.sql`이며 반복 실행 가능하다. 이전 앱과 장시간 혼용하지 말고 앱과 작업 이미지를 함께 갱신한다. 운영 DB의 일반적인 배포 전 백업 절차를 적용한다.

최초 성공 수집 전에는 아직 저장된 퀘스트가 없는 정상 관광지가 표시되지 않는다. 로그에서 `"status": "live"`와 생성 건수를 확인한다. API 장애 상태에서는 최초 수집도 성공할 수 없으며, 이 작업이 연결 장애를 해결하지는 않는다.

개발용 소스 마운트를 사용하는 경우:

```sh
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d --build app catalog-sync
```

이후 Python 소스만 변경했다면 같은 Compose 파일 조합으로 `restart app catalog-sync`하면 된다. 일반 이미지 방식은 소스 변경 시 재빌드가 필요하다. `.env`의 유예일 등 환경 변수를 바꿨다면 `up -d --force-recreate catalog-sync`로 작업 컨테이너를 재생성한다. 단순 `restart`는 변경된 환경 변수를 다시 읽지 않는다.

## 수동 최초 수집·재실행

같은 날 시도 이력이 없을 때 한 번 실행한다. 이 명령은 실제 카탈로그를 변경하고 삭제 조건을 충족한 공용 항목을 정리한다.

```sh
docker compose run --rm --no-deps catalog-sync python -m questbook_api.catalog_sync --once
```

오늘 실패한 수집을 운영자가 다시 시도하려면 다음과 같이 실행한다. 자동 작업이 이미 실행 중이면 `skipped:locked`로 종료하므로 로그 확인 후 다시 실행한다.

```sh
docker compose run --rm --no-deps catalog-sync python -m questbook_api.catalog_sync --once --force
```

`--force`는 날짜별 시도 제한만 해제한다. 전체 수집 검증·상호 배제·같은 날 관측 중복 방지·삭제 유예는 그대로 적용한다. 개발 소스 마운트를 쓰면 위 명령에도 동일한 `-f docker-compose.yaml -f docker-compose.dev.yaml` 옵션을 붙인다.

## 로컬 Python과 다른 서버

Python 3.11과 `uv`를 사용한다. 저장소 루트에서 로컬 PostgreSQL 주소를 가리키는 `QUESTBOOK_DATABASE_URL`, `TOURAPI_SERVICE_KEY`, 선택적인 유예일을 실행 환경에 주입한다. 컨테이너 전용 호스트명 `postgres`는 호스트에서 직접 실행할 때 사용할 수 없으므로 로컬 접속 주소로 설정한다.

```sh
uv sync --project services/app-api
uv run --project services/app-api python -m questbook_api.catalog_sync --once
uv run --project services/app-api python -m questbook_api.catalog_sync --daily
```

실행기는 `.env`를 자동 로드하지 않는다. 로컬 파일을 명시적으로 사용할 때만 `uv run --env-file .env --project services/app-api python -m questbook_api.catalog_sync --once` 형태를 사용한다. 단발 실행 뒤 일일 실행을 시작해도 당일 이력이 있으면 중복 수집하지 않는다.

다른 테스트·운영 서버에서도 앱과 같은 이미지 및 DB를 사용하고 명령을 `python -m questbook_api.catalog_sync --daily`로 지정한다. 별도 Redis·작업 큐 의존성은 없다. 프로세스의 실패 재시작 정책을 활성화한다. DB 연결이 끊어지면 작업은 인증 정보 없는 오류를 남기고 종료하며, 재시작한 프로세스가 새 연결을 연다. TourAPI 실패는 기존 카탈로그를 유지하고 다음 날짜까지 기다린다.

## 검증과 상태 확인

외부 API를 호출하지 않는 자동 검증:

```sh
uv run --project services/app-api pytest services/app-api/tests tests/smoke -q
node --test apps/user-web/tests/test_planning.mjs
docker compose --env-file /dev/null -f docker-compose.yaml -f docker-compose.dev.yaml config --no-env-resolution --no-interpolate --quiet
```

저장소 테스트에는 로컬 PostgreSQL과 Redis가 필요하다. 기본 대상은 `questbook_test` DB와 Redis 15번이며 매 테스트에서 초기화한다. 다른 환경에서는 `QUESTBOOK_TEST_ADMIN_DATABASE_URL`, `QUESTBOOK_TEST_DATABASE_URL`, `QUESTBOOK_TEST_REDIS_URL`을 테스트 전용 대상으로 주입한다. 테스트 DB 이름은 `*_test`, Redis는 15번만 허용한다. 같은 테스트 DB를 여러 테스트 프로세스가 동시에 초기화하지 않도록 순차 실행한다.

DB 관리 도구에서는 다음 읽기 전용 SQL로 최근 실행과 누락 건수를 확인한다.

```sql
SELECT run_date, status, started_at, completed_at, stats_json
FROM catalog_sync_runs ORDER BY run_date DESC LIMIT 7;

SELECT COUNT(*) AS total_places,
       COUNT(*) FILTER (WHERE missing_since IS NOT NULL) AS missing_places
FROM tourism_catalog_places;
```

`completed`는 전체 원천이 반영된 실행, `failed`는 카탈로그를 반영하지 못한 실행이다. `stats_json.source_status`로 오류 종류를 확인한다. 프로세스 강제 종료나 DB 연결 단절 때는 `running` 기록이 남을 수 있다. 재시작도 당일 실행 이력을 존중하므로 필요하면 잠금이 해제된 뒤 `--once --force`로 재실행한다. 장애 원문·서비스 키를 로그나 공유 문서에 출력하지 않는다.
