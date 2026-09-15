# 실제 PostgreSQL에서 일일 카탈로그 수명과 공용 퀘스트 버전을 검증한다.
from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from typing import Any
from threading import Event

import pytest
import psycopg

from data_services import SERVICES_AVAILABLE, ensure_test_database, reset_database
from questbook_api.domain.models import TourPlaceCandidate
from questbook_api.infrastructure.repository import QuestbookRepository


# 변수 의미: 테스트가 외부 데이터 서비스가 있을 때만 실행되게 하는 조건이다.
pytestmark = pytest.mark.skipif(not SERVICES_AVAILABLE, reason="PostgreSQL unavailable")
# 변수 의미: 한국 날짜 경계 이전의 확정된 기준 관측 시각이다.
OBSERVED_AT = datetime(2026, 9, 1, 1, tzinfo=timezone.utc)


def make_place(content_id: str = "100") -> TourPlaceCandidate:
    """입력: 장소 ID. 출력: 실제 출처 후보. 역할: 관측 예제를 만든다. 호출 예시: make_place()."""
    return TourPlaceCandidate(content_id, "한밭수목원", 36.37, 127.39, "nature", "자연", "산책", None, "tourapi")


def make_quest(content_id: str = "100", **changes: Any) -> dict[str, Any]:
    """입력: 장소 ID와 변경값. 출력: 생성 정의. 역할: 저장 입력을 만든다. 호출 예시: make_quest()."""
    return {
        "title": "한밭수목원 산책", "description": "나무를 관찰하세요.", "type": "explore",
        "categoryCode": "nature", "rewardXp": 30, "verificationType": "gps",
        "placeContentId": content_id, "placeName": "한밭수목원", "source": "template",
        **changes,
    }


@pytest.fixture
def repository() -> Iterator[QuestbookRepository]:
    """입력: 없음. 출력: 빈 저장소. 역할: 격리된 DB를 준비한다. 호출 예시: test_sync(repository)."""
    # 변수 의미: *_test 접미사로 검증되는 전용 데이터베이스다.
    database_url = ensure_test_database()
    reset_database(database_url)
    # 변수 의미: 실제 SQL 구현을 검증하는 저장소다.
    storage = QuestbookRepository(database_url)
    storage.initialize()
    try:
        yield storage
    finally:
        storage.close()


def test_identical_sync_preserves_identity_and_semantic_changes_increment_version(repository: QuestbookRepository) -> None:
    """입력: 빈 저장소. 출력: 없음. 역할: 재실행의 멱등성을 검증한다. 호출 예시: pytest -k identical_sync."""
    assert hasattr(repository, "sync_catalog"), "The repository must support daily catalog synchronization"
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT)
    # 변수 의미: 첫 동기화의 공용 퀘스트다.
    first = repository.get_catalog_quests(["100"])["100"][0]
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT + timedelta(days=1))
    # 변수 의미: 내용 변화 없는 다음날의 공용 퀘스트다.
    same = repository.get_catalog_quests(["100"])["100"][0]
    assert (same["id"], same["version"], same["created_for_user_id"]) == (first["id"], 1, None)
    repository.sync_catalog([make_place()], [make_quest(description="새 관찰 설명")], observed_at=OBSERVED_AT + timedelta(days=2))
    # 변수 의미: 실제 내용 변경 후의 공용 퀘스트다.
    changed = repository.get_catalog_quests(["100"])["100"][0]
    assert (changed["id"], changed["version"], changed["description"]) == (first["id"], 2, "새 관찰 설명")


def test_missing_observations_require_distinct_days_and_elapsed_grace(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 하루 재실행이 삭제를 앞당기지 못하게 한다. 호출 예시: pytest -k missing_observations."""
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT, missing_grace_days=2)
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=1), missing_grace_days=2)
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=1, hours=2), missing_grace_days=2)
    # 변수 의미: 첫 누락일을 두 번 확인한 결과다.
    missing = repository._connection.execute("SELECT * FROM tourism_catalog_places WHERE content_id = '100'").fetchone()
    assert missing["missing_observations"] == 1
    assert repository.get_catalog_quests(["100"]) == {}
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=4), missing_grace_days=2)
    assert repository._connection.execute("SELECT count(*) AS count FROM tourism_catalog_places").fetchone()["count"] == 1
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=5), missing_grace_days=2)
    assert repository._connection.execute("SELECT count(*) AS count FROM tourism_catalog_places").fetchone()["count"] == 0
    assert repository._connection.execute("SELECT count(*) AS count FROM reusable_quests").fetchone()["count"] == 0


def test_reappearance_resets_missing_history_and_restores_lookup(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 재등장 장소의 누락 기록을 지운다. 호출 예시: pytest -k reappearance."""
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT)
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=1))
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT + timedelta(days=2))
    # 변수 의미: 재등장한 장소의 카탈로그 상태다.
    present = repository._connection.execute("SELECT * FROM tourism_catalog_places WHERE content_id = '100'").fetchone()
    assert present["missing_since"] is None
    assert present["last_missing_date"] is None
    assert present["missing_observations"] == 0
    assert len(repository.get_catalog_quests(["100"])["100"]) == 1


def test_incomplete_or_fallback_input_cannot_mutate_catalog(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 잘못된 입력의 전체 롤백을 검증한다. 호출 예시: pytest -k incomplete_or_fallback."""
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT)
    with pytest.raises(ValueError):
        repository.sync_catalog([replace(make_place(), source="fallback")], [make_quest()], observed_at=OBSERVED_AT + timedelta(days=1))
    with pytest.raises(ValueError):
        repository.sync_catalog([make_place()], [make_quest("unknown")], observed_at=OBSERVED_AT + timedelta(days=1))
    with pytest.raises(ValueError):
        repository.sync_catalog([make_place()], [make_quest(), make_quest()], observed_at=OBSERVED_AT + timedelta(days=1))
    with pytest.raises(ValueError):
        repository.sync_catalog([make_place()], [make_quest(rewardXp=-1)], observed_at=OBSERVED_AT + timedelta(days=1))
    assert repository.get_catalog_quests(["100"])["100"][0]["version"] == 1


def test_bulk_lookup_does_not_create_quests_and_accepts_legacy_real_quests(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 조회의 비생성과 기존 데이터 호환을 검증한다. 호출 예시: pytest -k bulk_lookup."""
    repository.ensure_user("catalog-reader")
    # 변수 의미: 기존 생성 경로의 실 관광지 퀘스트다.
    legacy = repository.get_or_create_reusable_quest("catalog-reader", make_quest("200"))
    assert repository.get_catalog_quests(["200", "not-generated"])["200"][0]["id"] == legacy["id"]
    assert repository.get_catalog_quests(["not-generated"]) == {}
    assert repository.get_catalog_quests([]) == {}
    assert repository._connection.execute("SELECT count(*) AS count FROM reusable_quests").fetchone()["count"] == 1


def test_superseded_definition_is_deactivated_without_duplicate_rows(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 유형 변경 뒤 예전 정의를 숨긴다. 호출 예시: pytest -k superseded."""
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT)
    repository.sync_catalog([make_place()], [make_quest(type="observe")], observed_at=OBSERVED_AT + timedelta(days=1))
    assert [quest["type"] for quest in repository.get_catalog_quests(["100"])["100"]] == ["observe"]
    assert repository._connection.execute("SELECT is_reusable FROM reusable_quests WHERE type = 'explore'").fetchone()["is_reusable"] is False


def test_daily_claim_survives_failure_and_allows_explicit_force(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 실패일도 자동 중복 실행을 막는다. 호출 예시: pytest -k daily_claim."""
    with repository.catalog_sync_lock() as acquired:
        assert acquired is True
        assert repository.claim_catalog_run(date(2026, 9, 1)) is True
        repository.finish_catalog_run(date(2026, 9, 1), "failed", {"reason": "partial"})
        assert repository.claim_catalog_run(date(2026, 9, 1)) is False
        assert repository.claim_catalog_run(date(2026, 9, 1), force=True) is True
        repository.finish_catalog_run(date(2026, 9, 1), "completed", {"places": 0})
    assert repository.catalog_status()["last_run"]["status"] == "completed"


def test_catalog_process_lock_excludes_another_connection(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 여러 프로세스의 중복 수집을 막는다. 호출 예시: pytest -k process_lock."""
    # 변수 의미: 같은 DB에 연결한 다른 프로세스 대역이다.
    other = QuestbookRepository(repository.database_url)
    try:
        with repository.catalog_sync_lock() as first:
            with other.catalog_sync_lock() as second:
                assert first is True
                assert second is False
        with other.catalog_sync_lock() as released:
            assert released is True
    finally:
        other.close()


def test_korean_date_boundary_counts_two_observations_on_same_utc_day(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 한국 날짜가 누락 기준임을 검증한다. 호출 예시: pytest -k korean_date."""
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT)
    repository.sync_catalog([], [], observed_at=datetime(2026, 9, 2, 14, 59, tzinfo=timezone.utc))
    repository.sync_catalog([], [], observed_at=datetime(2026, 9, 2, 15, 1, tzinfo=timezone.utc))
    assert repository._connection.execute("SELECT missing_observations FROM tourism_catalog_places").fetchone()["missing_observations"] == 2


def test_failed_transaction_preserves_existing_catalog_and_quest(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 중간 SQL 실패 시 전체 반영을 취소한다. 호출 예시: pytest -k failed_transaction."""
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        repository.sync_catalog(
            [make_place(), replace(make_place("200"), category_code="unknown")],
            [make_quest(description="반영되면 안 되는 변경")],
            observed_at=OBSERVED_AT + timedelta(days=1),
        )
    assert repository.get_catalog_quests(["100"])["100"][0]["description"] == "나무를 관찰하세요."
    assert repository._connection.execute("SELECT count(*) AS count FROM tourism_catalog_places").fetchone()["count"] == 1


def test_unmanaged_quest_is_hidden_when_its_catalog_place_is_missing(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 누락 장소의 예전 공용 정의도 숨긴다. 호출 예시: pytest -k unmanaged_quest."""
    repository.ensure_user("legacy-reader")
    repository.get_or_create_reusable_quest("legacy-reader", make_quest())
    repository.sync_catalog([make_place()], [], observed_at=OBSERVED_AT)
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=1))
    assert repository.get_catalog_quests(["100"]) == {}


def test_catalog_update_and_purge_preserve_accepted_and_completed_user_records(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 실제 동기화 변경과 삭제 후 개인 기록을 보존한다. 호출 예시: pytest -k preserve_accepted."""
    repository.ensure_user("accepted-owner")
    repository.ensure_user("completed-owner")
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT, missing_grace_days=1)
    # 변수 의미: 두 사용자가 처음 만난 사전 생성 퀘스트다.
    original = repository.get_catalog_quests(["100"])["100"][0]
    # 변수 의미: 개인 인스턴스에 부여할 테스트 만료 시각이다.
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
    # 변수 의미: 사본 기능 도입 이전의 수락 상태를 재현할 사용자 인스턴스다.
    accepted = repository.get_or_create_user_quest_instance("accepted-owner", original["id"], expires_at, place=make_place())
    repository._connection.execute("UPDATE user_quest_instances SET status = 'accepted' WHERE id = %s", (accepted["id"],))
    # 변수 의미: 카탈로그 갱신 전에 이미 완료할 별도 사용자 인스턴스다.
    completed = repository.get_or_create_user_quest_instance("completed-owner", original["id"], expires_at, place=make_place())
    repository.accept_quest("completed-owner", completed["id"], place=make_place())
    repository.complete_quest("completed-owner", repository.get_instance_with_quest("completed-owner", completed["id"]), {"decision": "approved"}, 0.1)
    repository.sync_catalog([make_place()], [make_quest(title="변경된 미션", rewardXp=90)], observed_at=OBSERVED_AT + timedelta(days=1), missing_grace_days=1)
    assert repository.get_instance_with_quest("accepted-owner", accepted["id"])["reward_xp"] == 30
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=2), missing_grace_days=1)
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=3), missing_grace_days=1)
    assert repository._connection.execute("SELECT count(*) AS count FROM reusable_quests").fetchone()["count"] == 0
    # 변수 의미: 공용 행이 실제 삭제된 뒤에도 완료할 수 있는 수락 당시의 사용자 사본이다.
    retained = repository.get_instance_with_quest("accepted-owner", accepted["id"])
    assert retained["title"] == "한밭수목원 산책"
    assert retained["linked_reusable_quest_id"] is None
    assert repository.complete_quest("accepted-owner", retained, {"decision": "approved"}, 0.1)["earnedXp"] == 30
    assert repository.list_notes("completed-owner")[0]["questTitle"] == "한밭수목원 산책"
    assert repository.get_recommendation_profile("completed-owner")["completionCounts"] == {"nature": 1}


def test_legacy_superseded_definition_cannot_reappear_after_catalog_purge(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 이전 자동 정의도 카탈로그 수명에 포함한다. 호출 예시: pytest -k legacy_superseded."""
    repository.ensure_user("legacy-owner")
    repository.get_or_create_reusable_quest("legacy-owner", make_quest())
    repository.sync_catalog([make_place()], [make_quest(type="observe")], observed_at=OBSERVED_AT, missing_grace_days=1)
    assert [quest["type"] for quest in repository.get_catalog_quests(["100"])["100"]] == ["observe"]
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=1), missing_grace_days=1)
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=2), missing_grace_days=1)
    assert repository.get_catalog_quests(["100"]) == {}
    assert repository._connection.execute("SELECT count(*) AS count FROM reusable_quests").fetchone()["count"] == 0


def test_first_catalog_absence_adopts_legacy_quests_and_preserves_history_after_eight_days(repository: QuestbookRepository) -> None:
    """입력: 저장소. 출력: 없음. 역할: 최초 전체 수집부터 없는 기존 자동 퀘스트도 유예 삭제한다. 호출 예시: pytest -k first_catalog_absence."""
    repository.ensure_user("old-owner")
    # 변수 의미: 과거 서로 다른 시점에 생성되어 이미 사라진 장소의 기존 자동 퀘스트다.
    old = repository.get_or_create_reusable_quest("old-owner", make_quest())
    # 변수 의미: 같은 장소에 대해 더 최근에 생성된 다른 자동 정의다.
    recent = repository.get_or_create_reusable_quest("old-owner", make_quest(type="observe", source="gemini"))
    repository._connection.execute("UPDATE reusable_quests SET created_at = %s WHERE id = %s", (OBSERVED_AT - timedelta(days=30), old["id"]))
    repository._connection.execute("UPDATE reusable_quests SET created_at = %s WHERE id = %s", (OBSERVED_AT - timedelta(days=10), recent["id"]))
    # 변수 의미: 사용자 수락 후 사본 기능 도입 전 상태를 재현할 개인 인스턴스다.
    accepted = repository.get_or_create_user_quest_instance("old-owner", old["id"], (OBSERVED_AT + timedelta(days=90)).isoformat(), place=make_place())
    repository._connection.execute("UPDATE user_quest_instances SET status = 'accepted' WHERE id = %s", (accepted["id"],))
    repository.get_or_create_reusable_quest("old-owner", make_quest("fallback-100"))
    repository.get_or_create_reusable_quest("old-owner", make_quest("mock-100"))
    repository.get_or_create_reusable_quest("old-owner", make_quest("manual-100", source="manual"))
    repository.sync_catalog([], [], observed_at=OBSERVED_AT)
    # 변수 의미: 최초 완전 수집의 누락 관측과 과거 근거 시각이 함께 저장된 최소 참조다.
    missing = repository._connection.execute("SELECT * FROM tourism_catalog_places WHERE content_id = '100'").fetchone()
    assert missing is not None
    assert datetime.fromisoformat(missing["first_seen_at"]) == OBSERVED_AT - timedelta(days=30)
    assert datetime.fromisoformat(missing["last_seen_at"]) == OBSERVED_AT - timedelta(days=10)
    assert datetime.fromisoformat(missing["missing_since"]) == OBSERVED_AT
    assert missing["missing_observations"] == 1
    assert repository.get_catalog_quests(["100"]) == {}
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(hours=2))
    for day in range(1, 7):
        repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=day))
    assert repository._connection.execute("SELECT missing_observations FROM tourism_catalog_places WHERE content_id = '100'").fetchone()["missing_observations"] == 7
    repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=7))
    assert repository._connection.execute("SELECT count(*) AS count FROM tourism_catalog_places").fetchone()["count"] == 0
    assert repository._connection.execute("SELECT count(*) AS count FROM reusable_quests WHERE place_content_id = '100'").fetchone()["count"] == 0
    assert repository._connection.execute("SELECT count(*) AS count FROM reusable_quests WHERE catalog_managed = FALSE").fetchone()["count"] == 3
    # 변수 의미: 8회 관측 뒤 공용 삭제와 분리되어 남은 기존 사용자의 수락 사본이다.
    retained = repository.get_instance_with_quest("old-owner", accepted["id"])
    assert retained["title"] == "한밭수목원 산책"
    assert retained["linked_reusable_quest_id"] is None
    assert repository.complete_quest("old-owner", retained, {"decision": "approved"}, 0.1)["earnedXp"] == 30


@pytest.mark.parametrize("operation", ["update", "purge"])
def test_catalog_locks_shared_definition_before_preserving_user_copies(
    repository: QuestbookRepository, monkeypatch: pytest.MonkeyPatch, operation: str,
) -> None:
    """입력: 저장소와 갱신 종류. 출력: 없음. 역할: 수락과 카탈로그의 잠금 순서를 맞춘다. 호출 예시: pytest -k locks_shared."""
    repository.sync_catalog([make_place()], [make_quest()], observed_at=OBSERVED_AT, missing_grace_days=1)
    if operation == "purge":
        repository.sync_catalog([], [], observed_at=OBSERVED_AT + timedelta(days=1), missing_grace_days=1)
    # 변수 의미: 카탈로그가 개인 사본 보존 단계에 도달했음을 전달하는 신호다.
    preserving = Event()
    # 변수 의미: 동시 수락 잠금 시도를 관측한 뒤 동기화를 계속하게 하는 신호다.
    release = Event()
    # 변수 의미: 사본 저장 부작용을 그대로 실행할 실제 보존 함수다.
    preserve = repository._preserve_quests_before_catalog_change

    def pause_after_preserving(content_ids: list[str]) -> None:
        """입력: 장소 ID. 출력: 없음. 역할: 실제 사본 보존 후 경쟁 상황을 만든다. 호출 예시: pause_after_preserving(ids)."""
        preserve(content_ids)
        preserving.set()
        assert release.wait(5), "concurrency probe did not release catalog"

    monkeypatch.setattr(repository, "_preserve_quests_before_catalog_change", pause_after_preserving)
    with ThreadPoolExecutor(max_workers=1) as executor:
        # 변수 의미: 사용자 수락과 경쟁하는 실제 카탈로그 갱신 트랜잭션이다.
        running = executor.submit(
            repository.sync_catalog,
            [] if operation == "purge" else [make_place()],
            [] if operation == "purge" else [make_quest(rewardXp=90)],
            observed_at=OBSERVED_AT + timedelta(days=2), missing_grace_days=1,
        )
        try:
            assert preserving.wait(5), "catalog did not reach preservation"
            with psycopg.connect(repository.database_url, autocommit=True) as connection:
                connection.execute("SET lock_timeout = '100ms'")
                with pytest.raises(psycopg.errors.LockNotAvailable):
                    connection.execute("SELECT id FROM reusable_quests WHERE place_content_id = '100' FOR SHARE")
        finally:
            release.set()
            running.result(timeout=5)
