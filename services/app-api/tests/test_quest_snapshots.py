# 공용 퀘스트 수정·삭제 후에도 사용자별 수락·완료 기록이 보존되는지 검증한다.
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event
from time import monotonic, sleep

import pytest

import data_services
from questbook_api.domain.models import TourPlaceCandidate
from questbook_api.infrastructure.repository import QuestbookRepository


@pytest.fixture
def repository():
    """입력: 없음. 출력: 테스트 저장소. 역할: 격리 DB를 준비한다. 예시: test(repository)."""
    if not data_services.SERVICES_AVAILABLE:
        pytest.skip("local PostgreSQL/Redis not available")
    # 변수 의미: 운영 DB와 분리된 테스트 데이터베이스 주소다.
    database_url = data_services.ensure_test_database()
    data_services.reset_database(database_url)
    # 변수 의미: 사본 보존을 검증하는 실제 저장소다.
    store = QuestbookRepository(database_url)
    store.initialize()
    store.ensure_user("snapshot-owner")
    store.ensure_user("different-user")
    try:
        yield store
    finally:
        store.close()


def prepare_quest(repository):
    """입력: 저장소. 출력: 퀘스트·인스턴스·장소. 역할: 수락 전 후보를 만든다. 예시: prepare_quest(repo)."""
    # 변수 의미: API에서 확인한 테스트 관광지다.
    place = TourPlaceCandidate(
        "snapshot-place", "처음 과학관", 36.3762, 127.3745, "science",
        "과학 문화", "", 0, "tourapi",
    )
    # 변수 의미: 독립적인 기대값을 갖는 테스트 퀘스트 정의다.
    quest = repository.get_or_create_reusable_quest("snapshot-owner", {
        "title": "처음 과학관 관찰", "description": "전시물 하나 관찰하기",
        "type": "visit", "categoryCode": "science", "rewardXp": 80,
        "verificationType": "gps", "placeContentId": "snapshot-place",
        "placeName": "처음 과학관", "source": "template",
    })
    # 변수 의미: 미래 만료 시각이다.
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
    # 변수 의미: 실제 선택한 관광지 정보가 연결된 사용자 후보 인스턴스다.
    instance = repository.get_or_create_user_quest_instance(
        "snapshot-owner", quest["id"], expires_at, place=place,
    )
    return quest, instance, place


def test_acceptance_freezes_quest_and_place_before_shared_update(repository):
    """입력: 저장소. 출력: 없음. 역할: 수락 후 공용 수정이 보상·내용을 바꾸지 않게 한다. 예시: pytest -k freezes."""
    # 변수 의미: 수락할 공용 퀘스트와 사용자 인스턴스 및 장소다.
    quest, instance, place = prepare_quest(repository)
    repository.accept_quest("snapshot-owner", instance["id"], place=place)
    repository._connection.execute(
        "UPDATE reusable_quests SET title = '변경된 미션', reward_xp = 999, place_name = '새 이름' WHERE id = %s",
        (quest["id"],),
    )
    # 변수 의미: 공용 수정 후에도 원래 값을 반환해야 하는 사용자 사본이다.
    saved = repository.get_instance_with_quest("snapshot-owner", instance["id"])
    assert saved["title"] == "처음 과학관 관찰"
    assert saved["reward_xp"] == 80
    assert saved["place_name"] == "처음 과학관"
    assert saved["place_snapshot"]["latitude"] == 36.3762
    assert repository.get_instance_with_quest("different-user", instance["id"]) is None


def test_deleted_shared_quest_can_complete_and_retain_notes_and_profile(repository):
    """입력: 저장소. 출력: 없음. 역할: 공용 삭제 뒤 완료·수첩·통계와 중복 보상 방지를 확인한다. 예시: pytest -k deleted_shared."""
    # 변수 의미: 사용자에게 수락시킬 초기 퀘스트 구성이다.
    quest, instance, place = prepare_quest(repository)
    repository.accept_quest("snapshot-owner", instance["id"], place=place)
    repository._connection.execute("DELETE FROM reusable_quests WHERE id = %s", (quest["id"],))
    # 변수 의미: 공용 행 없이도 완료할 수 있는 사용자 사본이다.
    saved = repository.get_instance_with_quest("snapshot-owner", instance["id"])
    assert saved["reusable_quest_id"] == quest["id"]
    assert saved["title"] == "처음 과학관 관찰"
    # 변수 의미: 사본에 고정된 보상으로 수행한 완료 결과다.
    result = repository.complete_quest("snapshot-owner", saved, {"decision": "approved"}, 0.1)
    assert result["earnedXp"] == 80
    assert repository.complete_quest("snapshot-owner", saved, {"decision": "approved"}, 0.1) is None
    # 변수 의미: 공용 삭제 뒤에도 유지되는 사용자 수첩이다.
    notes = repository.list_notes("snapshot-owner")
    assert notes[0]["questTitle"] == "처음 과학관 관찰"
    assert notes[0]["reusableQuestId"] == quest["id"]
    assert repository.get_recommendation_profile("snapshot-owner")["completionCounts"] == {"science": 1}
    # 변수 의미: 공용 삭제 이후 수정한 사용자 일기다.
    edited = repository.update_note_entry("snapshot-owner", notes[0]["id"], "diary", "기록", "내용", None)
    assert edited["questTitle"] == "처음 과학관 관찰"
    assert edited["entry"]["body"] == "내용"


def test_completed_record_survives_shared_deletion_and_reinitialization(repository):
    """입력: 저장소. 출력: 없음. 역할: 기존 완료 기록과 사본이 삭제·재시작 뒤에도 유지된다. 예시: pytest -k reinitialization."""
    # 변수 의미: 수락·완료할 사용자 퀘스트다.
    quest, instance, place = prepare_quest(repository)
    repository.accept_quest("snapshot-owner", instance["id"], place=place)
    # 변수 의미: 저장소 완료 트랜잭션에 전달할 고정 사본이다.
    saved = repository.get_instance_with_quest("snapshot-owner", instance["id"])
    repository.complete_quest("snapshot-owner", saved, {"decision": "approved"}, 0.1)
    repository._connection.execute("DELETE FROM reusable_quests WHERE id = %s", (quest["id"],))
    repository.initialize()
    repository.initialize()
    assert repository.list_notes("snapshot-owner")[0]["questTitle"] == "처음 과학관 관찰"
    assert repository.get_instance_with_quest("snapshot-owner", instance["id"])["status"] == "completed"


def test_existing_accepted_record_is_backfilled_before_catalog_change(repository):
    """입력: 저장소. 출력: 없음. 역할: 사본 도입 이전 수락 기록을 공용 변경 전에 보존한다. 예시: pytest -k backfilled."""
    # 변수 의미: 이전 앱에서 수락한 상태를 재현할 퀘스트다.
    quest, instance, _ = prepare_quest(repository)
    repository._connection.execute(
        "UPDATE user_quest_instances SET status = 'accepted', accepted_at = NOW() WHERE id = %s",
        (instance["id"],),
    )
    repository._preserve_quests_before_catalog_change(["snapshot-place"])
    repository._connection.execute("UPDATE reusable_quests SET title = '나중 제목' WHERE id = %s", (quest["id"],))
    assert repository.get_instance_with_quest("snapshot-owner", instance["id"])["title"] == "처음 과학관 관찰"


def test_explicit_migration_preserves_legacy_acceptance_and_is_repeatable(repository):
    """입력: 저장소. 출력: 없음. 역할: 이전 스키마에 명시적 SQL을 두 번 적용해 사본을 복구한다. 예시: pytest -k explicit_migration."""
    # 변수 의미: 이전 스키마에서 수락했다고 가정할 사용자 인스턴스다.
    quest, instance, _ = prepare_quest(repository)
    repository._connection.execute(
        "UPDATE user_quest_instances SET status = 'accepted', accepted_at = NOW() WHERE id = %s",
        (instance["id"],),
    )
    # 별도 테스트 DB에서만 사본 컬럼 도입 이전 상태를 재현한다.
    repository._connection.execute("ALTER TABLE user_quest_instances DROP COLUMN quest_snapshot_json")
    repository._connection.execute("ALTER TABLE user_quest_instances DROP COLUMN place_snapshot_json")
    # 변수 의미: 실제 운영자가 실행할 재실행 가능한 마이그레이션이다.
    migration = Path(__file__).resolve().parents[3] / "database/migrations/004_quest_catalog.sql"
    repository._connection.execute(migration.read_text(encoding="utf-8"))
    repository._connection.execute(migration.read_text(encoding="utf-8"))
    repository._connection.execute("DELETE FROM reusable_quests WHERE id = %s", (quest["id"],))
    # 변수 의미: 존재하지 않는 과거 좌표를 만들어내지 않은 보존 결과다.
    saved = repository.get_instance_with_quest("snapshot-owner", instance["id"])
    assert saved["title"] == "처음 과학관 관찰"
    assert saved["reward_xp"] == 80
    assert saved["place_snapshot"] is None


def test_legacy_snapshot_can_fill_missing_place_without_changing_frozen_quest(repository):
    """입력: 저장소. 출력: 없음. 역할: 이전 사본의 빈 좌표만 보충하고 고정된 보상은 유지한다. 예시: pytest -k fill_missing_place."""
    # 변수 의미: 정의만 보존된 이전 수락 기록을 재현할 구성이다.
    quest, instance, place = prepare_quest(repository)
    repository.accept_quest("snapshot-owner", instance["id"])
    repository._connection.execute(
        "UPDATE user_quest_instances SET place_snapshot_json = NULL WHERE id = %s", (instance["id"],),
    )
    repository._connection.execute("UPDATE reusable_quests SET reward_xp = 999 WHERE id = %s", (quest["id"],))
    repository.accept_quest("snapshot-owner", instance["id"], place=place)
    # 변수 의미: 나중에 서버가 확인한 장소만 보충된 사본이다.
    saved = repository.get_instance_with_quest("snapshot-owner", instance["id"])
    assert saved["place_snapshot"]["longitude"] == 127.3745
    assert saved["reward_xp"] == 80


def test_two_connections_can_complete_same_shared_quest_without_deadlock(repository):
    """입력: 저장소. 출력: 없음. 역할: 별도 연결의 동시 완료가 교착 없이 각각 한 번 보상한다. 예시: pytest -k two_connections."""
    # 변수 의미: 두 사용자가 함께 수행할 공용 퀘스트와 첫 사용자 인스턴스다.
    quest, first_instance, place = prepare_quest(repository)
    # 변수 의미: 같은 공용 퀘스트를 수락한 두 번째 사용자 인스턴스다.
    second_instance = repository.get_or_create_user_quest_instance(
        "different-user", quest["id"], first_instance["expires_at"], place=place,
    )
    repository.accept_quest("snapshot-owner", first_instance["id"], place=place)
    repository.accept_quest("different-user", second_instance["id"], place=place)
    # 변수 의미: 실제 별도 트랜잭션으로 완료할 두 저장소 연결이다.
    stores = [QuestbookRepository(data_services.ensure_test_database()) for _ in range(2)]
    # 변수 의미: 공용 잠금 획득 시점을 관측해 잠금 승격 경쟁을 재현하는 이벤트다.
    frozen = [Event(), Event()]

    def finish(index, user_id, instance_id):
        """입력: 연결 번호·사용자·인스턴스. 출력: 완료 결과. 역할: 공용 잠금이 겹친 상태로 완료한다. 예시: executor.submit(finish, 0, user, id)."""
        # 변수 의미: 이 작업만 사용하는 저장소와 원래 사본 고정 함수다.
        store = stores[index]
        original_freeze = store._freeze_quest_instance

        def coordinated_freeze(*args, **kwargs):
            """입력: 원래 고정 인자. 출력: 없음. 역할: 공유 잠금이면 양쪽 획득을 겹치고 배타 잠금이면 대기를 끝낸다. 예시: complete_quest 내부 호출."""
            original_freeze(*args, **kwargs)
            frozen[index].set()
            frozen[1 - index].wait(timeout=0.3)

        store._freeze_quest_instance = coordinated_freeze
        store._connection.execute("SET statement_timeout = '5s'")
        return store.complete_quest(
            user_id, store.get_instance_with_quest(user_id, instance_id), {"decision": "approved"}, 0.1,
        )

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            # 변수 의미: 같은 공용 행을 동시에 완료하는 독립 사용자 요청이다.
            futures = [
                executor.submit(finish, 0, "snapshot-owner", first_instance["id"]),
                executor.submit(finish, 1, "different-user", second_instance["id"]),
            ]
            assert [future.result(timeout=10)["earnedXp"] for future in futures] == [80, 80]
        assert repository._connection.execute(
            "SELECT completion_count FROM reusable_quests WHERE id = %s", (quest["id"],),
        ).fetchone()["completion_count"] == 2
        assert len(repository.list_notes("snapshot-owner")) == 1
        assert len(repository.list_notes("different-user")) == 1
    finally:
        for store in stores:
            store.close()


def test_recommendation_waiting_for_acceptance_cannot_overwrite_frozen_coordinates(repository):
    """입력: 저장소. 출력: 없음. 역할: 이전 상태를 읽은 추천 요청이 수락 직후 좌표를 덮지 못하게 한다. 예시: pytest -k waiting_for_acceptance."""
    # 변수 의미: 수락 순간과 추천 갱신이 겹칠 사용자 후보와 다른 좌표의 새 API 장소다.
    quest, instance, place = prepare_quest(repository)
    moved_place = replace(place, latitude=36.4, longitude=127.4)
    # 변수 의미: 진행 중인 추천을 별도 DB 연결로 처리할 저장소다.
    recommender = QuestbookRepository(data_services.ensure_test_database())
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            with repository._connection.transaction():
                # 추천은 기존 recommended 상태를 읽지만 좌표 UPDATE는 수락 트랜잭션 뒤에 실행된다.
                repository._connection.execute(
                    "SELECT id FROM user_quest_instances WHERE id = %s FOR UPDATE", (instance["id"],),
                )
                # 변수 의미: 이전 추천 상태로 시작한 경쟁 요청이다.
                future = executor.submit(
                    recommender.get_or_create_user_quest_instance,
                    "snapshot-owner", quest["id"], instance["expires_at"], place=moved_place,
                )
                # 변수 의미: 해당 연결이 실제 행 잠금에서 기다리는지 확인할 제한 시각이다.
                deadline = monotonic() + 3
                while not repository._connection.execute(
                    "SELECT cardinality(pg_blocking_pids(%s)) AS count", (recommender._connection.info.backend_pid,),
                ).fetchone()["count"]:
                    assert monotonic() < deadline, "recommendation did not reach the locked instance"
                    sleep(0.01)
                repository.accept_quest("snapshot-owner", instance["id"], place=place)
            # 변수 의미: 수락이 끝난 최신 상태와 사본을 반환한 추천 결과다.
            result = future.result(timeout=5)
        assert result["status"] == "accepted"
        assert result["quest_snapshot_json"]["reward_xp"] == 80
        assert result["place_snapshot_json"]["latitude"] == 36.3762
        assert result["place_snapshot_json"]["longitude"] == 127.3745
    finally:
        recommender.close()
