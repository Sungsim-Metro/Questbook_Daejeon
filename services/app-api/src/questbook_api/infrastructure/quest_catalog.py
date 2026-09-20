# 완전한 일일 관광지 관측으로 공용 퀘스트와 최소 카탈로그 참조만 관리한다.
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from psycopg.types.json import Jsonb

from questbook_api.domain.models import TourPlaceCandidate


# 변수 의미: 좌표와 원본 JSON 없이 일일 동기화 상태만 저장하는 확장 스키마다.
CATALOG_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tourism_catalog_places (
  content_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_code TEXT NOT NULL REFERENCES categories(code),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  missing_since TIMESTAMPTZ,
  missing_observations INTEGER NOT NULL DEFAULT 0 CHECK (missing_observations >= 0),
  last_missing_date DATE
);

CREATE TABLE IF NOT EXISTS catalog_sync_runs (
  run_date DATE PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 퀘스트 제목/설명은 카테고리별 6개 고정 템플릿 + 장소명 조합이라, 영문 모드에서 매 요청마다
-- 다시 번역할 대상은 장소명 하나뿐이다. 배치가 하루 한 번, TourAPI 영문 서비스에 없는
-- 장소만 Google Translate로 1회 번역해서 여기에 영구 캐싱한다(요청마다 재호출 없음).
CREATE TABLE IF NOT EXISTS place_name_translations (
  content_id TEXT PRIMARY KEY,
  name_kor TEXT NOT NULL,
  name_eng TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('tourapi', 'machine', 'fallback')),
  translated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE reusable_quests
  ADD COLUMN IF NOT EXISTS catalog_managed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reusable_quests
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reusable_quests ALTER COLUMN created_for_user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_managed_quests
  ON reusable_quests(place_content_id) WHERE catalog_managed;
"""
# 변수 의미: 수집 전체에 적용하는 세션 수준의 프로세스 공통 잠금 번호다.
CATALOG_PROCESS_LOCK_ID = 783426519001
# 변수 의미: 원자적 반영 트랜잭션 사이의 충돌을 막는 별도 잠금 번호다.
CATALOG_TRANSACTION_LOCK_ID = 783426519002
# 변수 의미: OS 시간대 데이터 없이 기존 앱과 같은 UTC+9 날짜 경계를 적용하는 한국 시간대다.
CATALOG_TIMEZONE = timezone(timedelta(hours=9))
# 변수 의미: 공용 퀘스트의 의미 변경 여부를 판단하는 DB 필드와 입력 키다.
QUEST_SEMANTIC_FIELDS = {
    "title": "title", "description": "description", "type": "type",
    "category_code": "categoryCode", "reward_xp": "rewardXp",
    "verification_type": "verificationType", "place_content_id": "placeContentId",
    "place_name": "placeName", "source": "source",
}


class QuestCatalogRepositoryMixin:
    """
    입력: 호스트 저장소의 연결, 재진입 잠금, 기존 사용자 기록 보존 함수.
    출력: 최소 참조와 생성된 퀘스트를 관리하는 저장소 메서드.
    역할: 실시간 관광지 조회에 필요한 퀘스트만 안전하게 사전 준비한다.
    호출 예시: class QuestbookRepository(QuestCatalogRepositoryMixin): ...
    """

    def sync_catalog(
        self, places: list[TourPlaceCandidate], quest_definitions: list[dict[str, Any]],
        *, observed_at: datetime, missing_grace_days: int = 7,
    ) -> dict[str, int]:
        """
        입력: 완전히 수집된 실 관광지와 생성 정의, 관측 시각, 삭제 유예 일수.
        출력: 반영한 장소와 퀘스트 및 누락과 삭제 수.
        역할: 부분 응답이 배제된 카탈로그를 한 트랜잭션으로 교체한다.
        호출 예시: repository.sync_catalog(places, definitions, observed_at=now)
        """
        self._validate_catalog_input(places, quest_definitions, observed_at, missing_grace_days)
        # 변수 의미: 동일 한국 날짜의 중복 누락 관측을 막는 날짜다.
        observed_date = observed_at.astimezone(CATALOG_TIMEZONE).date()
        # 변수 의미: 완전한 이번 관측에서 확인한 장소 식별자다.
        content_ids = [place.content_id for place in places]
        # 변수 의미: 이번 관측에 포함된 공용 퀘스트의 기존 유일키 집합이다.
        definition_keys = {
            (quest["placeContentId"], quest["categoryCode"], quest["type"])
            for quest in quest_definitions
        }
        # 변수 의미: 트랜잭션이 성공한 경우에만 반환할 처리 건수다.
        stats = {"places": len(places), "quests_created": 0, "quests_updated": 0,
                 "quests_deactivated": 0, "places_missing": 0, "places_purged": 0}
        with self._lock, self._connection.transaction():
            self._connection.execute("SELECT pg_advisory_xact_lock(%s)", (CATALOG_TRANSACTION_LOCK_ID,))
            self._adopt_absent_legacy_catalog_quests(content_ids)
            # 변수 의미: 중간 날짜의 재실행으로 관측 시각이 과거로 이동하는지 확인한 결과다.
            newer_observation = self._connection.execute(
                """SELECT 1 FROM tourism_catalog_places
                   WHERE last_seen_at > %s OR last_missing_date > %s LIMIT 1""",
                (observed_at, observed_date),
            ).fetchone()
            if newer_observation is not None:
                raise ValueError("catalog observation must not precede stored observations")
            # 변수 의미: 현재 등장한 장소에 속한 기존 퀘스트를 유일키로 조회한 결과다.
            existing = {
                (row["place_content_id"], row["category_code"], row["type"]): row
                for row in self._connection.execute(
                    "SELECT * FROM reusable_quests WHERE place_content_id = ANY(%s) ORDER BY id FOR UPDATE",
                    (content_ids,),
                ).fetchall()
            }
            # 변수 의미: 카탈로그 관리 전 자동 생성된 정의를 포함해 폐기할 기존 유일키다.
            superseded_keys = {
                key for key, row in existing.items()
                if key not in definition_keys
                and (row["catalog_managed"] or row["source"] in {"template", "gemini"})
                and (row["is_reusable"] or not row["catalog_managed"])
            }
            # 변수 의미: 사용자 고정 사본 생성이 필요한 기존 퀘스트의 장소 ID다.
            changed_content_ids = {key[0] for key in superseded_keys}
            # 변수 의미: 이번 관측에서 신규 생성하거나 실제로 수정해야 하는 정의다.
            changed_definitions: list[tuple[dict[str, Any], dict[str, Any] | None, bool]] = []
            for definition in quest_definitions:
                # 변수 의미: 정의의 장소, 카테고리, 유형으로 구성한 기존 유일키다.
                key = (definition["placeContentId"], definition["categoryCode"], definition["type"])
                # 변수 의미: 변경 전 공용 퀘스트이며 새 정의라면 None이다.
                previous = existing.get(key)
                # 변수 의미: 버전을 증가시켜야 할 사용자 표시 내용의 변경 여부다.
                semantic_change = previous is not None and any(
                    previous[column] != definition[field] for column, field in QUEST_SEMANTIC_FIELDS.items()
                )
                if previous is None or semantic_change or not previous["catalog_managed"] or not previous["is_reusable"] or previous["review_status"] != "approved":
                    changed_definitions.append((definition, previous, semantic_change))
                    if previous is not None:
                        changed_content_ids.add(key[0])
            if changed_content_ids:
                self._preserve_quests_before_catalog_change(sorted(changed_content_ids))
            with self._connection.cursor() as cursor:
                cursor.executemany(
                    """INSERT INTO tourism_catalog_places(
                         content_id, title, category_code, first_seen_at, last_seen_at)
                       VALUES (%s, %s, %s, %s, %s)
                       ON CONFLICT (content_id) DO UPDATE SET
                         title = EXCLUDED.title, category_code = EXCLUDED.category_code,
                         last_seen_at = EXCLUDED.last_seen_at, missing_since = NULL,
                         missing_observations = 0, last_missing_date = NULL""",
                    [(place.content_id, place.title, place.category_code, observed_at, observed_at) for place in places],
                )
            for key, previous in existing.items():
                if key in superseded_keys:
                    self._connection.execute(
                        """UPDATE reusable_quests SET is_reusable = FALSE,
                             catalog_managed = TRUE, created_for_user_id = NULL WHERE id = %s""",
                        (previous["id"],),
                    )
                    stats["quests_deactivated"] += int(previous["is_reusable"])
            for definition, previous, semantic_change in changed_definitions:
                # 변수 의미: 기존 ID를 유지하거나 새 공용 퀘스트에 부여할 식별자다.
                quest_id = previous["id"] if previous else f"rq_{uuid4().hex[:16]}"
                self._connection.execute(
                    """INSERT INTO reusable_quests(
                         id, title, description, type, category_code, reward_xp, verification_type,
                         place_content_id, place_name, source, review_status, created_for_user_id,
                         is_reusable, reuse_count, completion_count, created_at, catalog_managed, version)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'approved', NULL,
                               TRUE, 0, 0, %s, TRUE, 1)
                       ON CONFLICT (place_content_id, category_code, type) DO UPDATE SET
                         title = EXCLUDED.title, description = EXCLUDED.description,
                         reward_xp = EXCLUDED.reward_xp, verification_type = EXCLUDED.verification_type,
                         place_name = EXCLUDED.place_name, source = EXCLUDED.source,
                         review_status = 'approved', is_reusable = TRUE, catalog_managed = TRUE,
                         created_for_user_id = NULL, version = reusable_quests.version + %s""",
                    (quest_id, definition["title"], definition["description"], definition["type"],
                     definition["categoryCode"], definition["rewardXp"], definition["verificationType"],
                     definition["placeContentId"], definition["placeName"], definition["source"],
                     observed_at, int(semantic_change)),
                )
                stats["quests_created" if previous is None else "quests_updated"] += 1
            self._connection.execute(
                """UPDATE tourism_catalog_places SET
                     missing_since = COALESCE(missing_since, %s),
                     missing_observations = missing_observations + CASE
                       WHEN last_missing_date IS DISTINCT FROM %s THEN 1 ELSE 0 END,
                     last_missing_date = %s
                   WHERE NOT (content_id = ANY(%s))""",
                (observed_at, observed_date, observed_date, content_ids),
            )
            # 변수 의미: 유예 기간과 서로 다른 관측일 수를 모두 만족한 현재 누락 장소다.
            purged_content_ids = [row["content_id"] for row in self._connection.execute(
                """SELECT content_id FROM tourism_catalog_places
                   WHERE NOT (content_id = ANY(%s)) AND missing_observations >= %s
                     AND missing_since <= %s - (%s * INTERVAL '1 day')""",
                (content_ids, missing_grace_days + 1, observed_at, missing_grace_days),
            ).fetchall()]
            if purged_content_ids:
                self._connection.execute(
                    """SELECT id FROM reusable_quests
                       WHERE place_content_id = ANY(%s) ORDER BY id FOR UPDATE""",
                    (purged_content_ids,),
                ).fetchall()
                self._preserve_quests_before_catalog_change(purged_content_ids)
                self._connection.execute(
                    "DELETE FROM reusable_quests WHERE catalog_managed AND place_content_id = ANY(%s)",
                    (purged_content_ids,),
                )
                self._connection.execute("DELETE FROM tourism_catalog_places WHERE content_id = ANY(%s)", (purged_content_ids,))
            stats["places_purged"] = len(purged_content_ids)
            stats["places_missing"] = self._connection.execute(
                "SELECT count(*) AS count FROM tourism_catalog_places WHERE missing_since IS NOT NULL"
            ).fetchone()["count"]
        return stats

    def _adopt_absent_legacy_catalog_quests(self, observed_content_ids: list[str]) -> None:
        """
        입력: 정상 전체 수집에서 이번에 확인한 장소 ID.
        출력: 없음.
        역할: 최초 수집부터 없는 과거 자동 퀘스트를 기존 근거 시각 그대로 누락 관리에 편입한다.
        호출 예시: self._adopt_absent_legacy_catalog_quests(content_ids)
        """
        # 변수 의미: fallback과 수동 정의를 제외하고 행 잠금을 확보한 기존 자동 퀘스트다.
        legacy_rows = self._connection.execute(
            """SELECT id, place_content_id FROM reusable_quests
               WHERE NOT catalog_managed AND source IN ('template', 'gemini')
                 AND place_content_id NOT LIKE 'fallback-%%'
                 AND place_content_id NOT LIKE 'mock-%%'
                 AND NOT (place_content_id = ANY(%s))
               ORDER BY id FOR UPDATE""",
            (observed_content_ids,),
        ).fetchall()
        if not legacy_rows:
            return
        # 변수 의미: 동일 트랜잭션에서 최소 참조로 편입할 공용 행 ID다.
        quest_ids = [row["id"] for row in legacy_rows]
        # 변수 의미: 같은 장소의 수동 정의를 포함하는 사본 보존 함수의 잠금 범위다.
        legacy_content_ids = sorted({row["place_content_id"] for row in legacy_rows})
        self._connection.execute(
            "SELECT id FROM reusable_quests WHERE place_content_id = ANY(%s) ORDER BY id FOR UPDATE",
            (legacy_content_ids,),
        ).fetchall()
        self._preserve_quests_before_catalog_change(legacy_content_ids)
        self._connection.execute(
            """INSERT INTO tourism_catalog_places(
                 content_id, title, category_code, first_seen_at, last_seen_at)
               SELECT DISTINCT ON (place_content_id)
                 place_content_id, place_name, category_code,
                 min(created_at) OVER (PARTITION BY place_content_id),
                 max(created_at) OVER (PARTITION BY place_content_id)
               FROM reusable_quests WHERE id = ANY(%s)
               ORDER BY place_content_id, created_at DESC, id
               ON CONFLICT (content_id) DO NOTHING""",
            (quest_ids,),
        )
        self._connection.execute(
            """UPDATE reusable_quests SET catalog_managed = TRUE,
                 created_for_user_id = NULL WHERE id = ANY(%s)""",
            (quest_ids,),
        )

    def _validate_catalog_input(
        self, places: list[TourPlaceCandidate], definitions: list[dict[str, Any]],
        observed_at: datetime, missing_grace_days: int,
    ) -> None:
        """
        입력: 아직 DB에 반영하지 않은 수집 결과와 동기화 정책.
        출력: 없음. 부적합한 입력이면 ValueError.
        역할: fallback, 중복, 다른 장소의 정의와 잘못된 시각을 사전에 거부한다.
        호출 예시: self._validate_catalog_input(places, definitions, now, 7)
        """
        if not isinstance(observed_at, datetime) or observed_at.tzinfo is None or observed_at.utcoffset() is None:
            raise ValueError("observed_at must be timezone-aware")
        if isinstance(missing_grace_days, bool) or not isinstance(missing_grace_days, int) or missing_grace_days < 1:
            raise ValueError("missing_grace_days must be a positive integer")
        if not isinstance(places, list) or not isinstance(definitions, list):
            raise ValueError("catalog inputs must be complete lists")
        # 변수 의미: 중복 장소와 정의가 다른 장소를 가리키는 오류를 확인하는 참조 집합이다.
        place_by_id: dict[str, TourPlaceCandidate] = {}
        for place in places:
            if not isinstance(place, TourPlaceCandidate) or place.source != "tourapi":
                raise ValueError("catalog accepts only complete live TourAPI observations")
            if any(not isinstance(value, str) or not value.strip() for value in (place.content_id, place.title, place.category_code)):
                raise ValueError("catalog places require nonempty identifiers and labels")
            if place.content_id in place_by_id or place.content_id.startswith(("mock-", "fallback-")):
                raise ValueError("catalog places require unique real content IDs")
            place_by_id[place.content_id] = place
        # 변수 의미: 장소, 카테고리, 유형의 중복 정의를 확인하는 집합이다.
        seen_keys: set[tuple[str, str, str]] = set()
        for definition in definitions:
            if not isinstance(definition, dict):
                raise ValueError("quest definitions must be dictionaries")
            if any(not isinstance(definition.get(field), str) or not definition[field].strip()
                   for field in QUEST_SEMANTIC_FIELDS.values() if field != "rewardXp"):
                raise ValueError("quest definitions require nonempty semantic fields")
            if isinstance(definition.get("rewardXp"), bool) or not isinstance(definition.get("rewardXp"), int) or definition["rewardXp"] < 0:
                raise ValueError("quest rewards must be nonnegative integers")
            if definition.get("reviewStatus", "approved") != "approved" or definition.get("isReusable", True) is not True:
                raise ValueError("catalog definitions must be approved and reusable")
            # 변수 의미: 생성 정의가 연결되는 이번 관측의 관광지다.
            place = place_by_id.get(definition["placeContentId"])
            if place is None or place.category_code != definition["categoryCode"] or place.title != definition["placeName"]:
                raise ValueError("quest definitions must match an observed place")
            # 변수 의미: 공용 퀘스트 유일성 제약에 대응하는 정의 키다.
            key = (definition["placeContentId"], definition["categoryCode"], definition["type"])
            if key in seen_keys:
                raise ValueError("catalog quest definitions must be unique")
            seen_keys.add(key)

    def get_catalog_quests(self, content_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        """
        입력: 실시간으로 조회한 관광지 ID 목록.
        출력: 사전 생성된 승인 퀘스트가 존재하는 ID별 row 목록.
        역할: 한 번의 SQL로 누락 관광지를 제외하고 기존 퀘스트를 읽는다.
        호출 예시: quests = repository.get_catalog_quests(["100", "200"])
        """
        if not content_ids:
            return {}
        with self._lock:
            # 변수 의미: 좌표 조회나 생성 없이 공용 퀘스트만 일괄 읽은 결과다.
            rows = self._connection.execute(
                """SELECT rq.* FROM reusable_quests rq
                   LEFT JOIN tourism_catalog_places cp ON cp.content_id = rq.place_content_id
                   WHERE rq.place_content_id = ANY(%s) AND rq.review_status = 'approved'
                     AND rq.is_reusable
                     AND rq.place_content_id NOT LIKE 'mock-%%'
                     AND rq.place_content_id NOT LIKE 'fallback-%%'
                     AND cp.missing_since IS NULL
                     AND (NOT rq.catalog_managed OR cp.content_id IS NOT NULL)
                   ORDER BY rq.place_content_id, rq.category_code, rq.type, rq.id""",
                (content_ids,),
            ).fetchall()
        # 변수 의미: 관광지별 승인 공용 퀘스트 조회 결과다.
        result: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            result.setdefault(row["place_content_id"], []).append(dict(row))
        return result

    @contextmanager
    def catalog_sync_lock(self) -> Iterator[bool]:
        """
        입력: 없음.
        출력: 수집 실행권 획득 여부를 전달하는 컨텍스트 관리자.
        역할: 연결과 스레드 잠금을 유지해 여러 프로세스의 중복 수집을 막는다.
        호출 예시: with repository.catalog_sync_lock() as acquired: ...
        """
        with self._lock:
            # 변수 의미: 다른 프로세스가 사용 중이면 대기 없이 실패하는 DB 잠금 결과다.
            acquired = self._connection.execute(
                "SELECT pg_try_advisory_lock(%s) AS acquired", (CATALOG_PROCESS_LOCK_ID,)
            ).fetchone()["acquired"]
            try:
                yield acquired
            finally:
                if acquired:
                    self._connection.execute("SELECT pg_advisory_unlock(%s)", (CATALOG_PROCESS_LOCK_ID,))

    def claim_catalog_run(self, run_date: date, *, force: bool = False) -> bool:
        """
        입력: 한국 실행 날짜와 수동 강제 재시도 여부.
        출력: 해당 날짜 실행을 새로 예약했는지 여부.
        역할: 실패와 중단을 포함해 자동 실행은 하루 한 번만 시작한다.
        호출 예시: claimed = repository.claim_catalog_run(date.today())
        """
        if not isinstance(run_date, date) or isinstance(run_date, datetime):
            raise ValueError("run_date must be a date")
        with self._lock, self._connection.transaction():
            # 변수 의미: 날짜 행을 새로 만들거나 명시적 재시도로 갱신한 결과다.
            claimed = self._connection.execute(
                """INSERT INTO catalog_sync_runs(run_date, status, started_at)
                   VALUES (%s, 'running', %s)
                   ON CONFLICT (run_date) DO UPDATE SET status = 'running',
                     started_at = EXCLUDED.started_at, completed_at = NULL, stats_json = '{}'::jsonb
                   WHERE %s RETURNING run_date""",
                (run_date, datetime.now(timezone.utc), force),
            ).fetchone()
            return claimed is not None

    def finish_catalog_run(self, run_date: date, status: str, stats: dict[str, Any]) -> None:
        """
        입력: 실행 날짜, 종료 상태, 비밀과 원본 응답 없는 처리 통계.
        출력: 없음.
        역할: 예약한 일일 실행의 성공 또는 실패를 영구 기록한다.
        호출 예시: repository.finish_catalog_run(day, "completed", {"places": 10})
        """
        if status not in {"completed", "failed"}:
            raise ValueError("catalog run must finish as completed or failed")
        with self._lock, self._connection.transaction():
            # 변수 의미: 실행 예약이 존재하며 현재 진행 중인 경우에만 갱신하는 커서다.
            cursor = self._connection.execute(
                """UPDATE catalog_sync_runs SET status = %s, completed_at = %s, stats_json = %s
                   WHERE run_date = %s AND status = 'running'""",
                (status, datetime.now(timezone.utc), Jsonb(stats), run_date),
            )
            if cursor.rowcount != 1:
                raise ValueError("catalog run must be claimed before finishing")

    def get_place_name_translations(self, content_ids: list[str]) -> dict[str, dict[str, str]]:
        """
        입력: 조회할 장소 contentId 목록.
        출력: contentId별 {"nameKor": ..., "nameEng": ...} 캐시 row.
        역할: 요청마다 재번역하지 않도록 배치가 미리 채워 둔 영문 장소명을 읽는다.
        호출 예시: cached = repository.get_place_name_translations(["126508"])
        """
        if not content_ids:
            return {}
        with self._lock:
            rows = self._connection.execute(
                "SELECT content_id, name_kor, name_eng FROM place_name_translations WHERE content_id = ANY(%s)",
                (content_ids,),
            ).fetchall()
        return {
            row["content_id"]: {"nameKor": row["name_kor"], "nameEng": row["name_eng"]}
            for row in rows
        }

    def upsert_place_name_translations(self, rows: list[tuple[str, str, str, str]]) -> None:
        """
        입력: (contentId, 국문 장소명, 영문 장소명, 출처('tourapi'|'machine')) 목록.
        출력: 없음.
        역할: 배치가 새로 번역한 장소명을 영구 캐시에 반영한다. 국문명이 바뀌면 값을 덮어써서
              다음 배치가 다시 번역해 최신 상태를 유지하게 한다.
        호출 예시: repository.upsert_place_name_translations([("126508", "한밭수목원", "Hanbat Arboretum", "tourapi")])
        """
        if not rows:
            return
        with self._lock, self._connection.cursor() as cursor:
            cursor.executemany(
                """INSERT INTO place_name_translations(content_id, name_kor, name_eng, source, translated_at)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (content_id) DO UPDATE SET
                     name_kor = EXCLUDED.name_kor, name_eng = EXCLUDED.name_eng,
                     source = EXCLUDED.source, translated_at = EXCLUDED.translated_at""",
                [(content_id, name_kor, name_eng, source, datetime.now(timezone.utc))
                 for content_id, name_kor, name_eng, source in rows],
            )

    def catalog_status(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: 최소 장소 수와 생성 퀘스트 수 및 최근 실행 상태.
        역할: 관리 CLI에서 원본 API 응답과 접속 비밀 없이 상태를 확인한다.
        호출 예시: status = repository.catalog_status()
        """
        with self._lock:
            # 변수 의미: 현재 보관하는 장소와 누락 장소 수다.
            counts = self._connection.execute(
                """SELECT count(*) AS places,
                     count(*) FILTER (WHERE missing_since IS NOT NULL) AS missing_places
                   FROM tourism_catalog_places"""
            ).fetchone()
            # 변수 의미: 카탈로그가 관리하는 공용 퀘스트 수다.
            quests = self._connection.execute(
                "SELECT count(*) AS quests FROM reusable_quests WHERE catalog_managed"
            ).fetchone()
            # 변수 의미: 가장 최근 날짜의 실행 기록이다.
            last_run = self._connection.execute("SELECT * FROM catalog_sync_runs ORDER BY run_date DESC LIMIT 1").fetchone()
        return {**counts, **quests, "last_run": dict(last_run) if last_run else None}
