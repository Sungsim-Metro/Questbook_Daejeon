from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier

import pytest
import data_services

from questbook_api.domain.ggumdori_rewards import GGUMDORI_SEEDS, completion_theme
from questbook_api.domain.models import TourPlaceCandidate
from questbook_api.application.baseline_service import BaselineQuestbookService
from questbook_api.infrastructure.repository import QuestbookRepository


@pytest.fixture
def store():
    if not data_services.SERVICES_AVAILABLE:
        pytest.skip("local PostgreSQL/Redis not available")
    url = data_services.ensure_test_database()
    data_services.reset_database(url)
    repo = QuestbookRepository(url)
    repo.initialize()
    repo.ensure_user("owner")
    repo.ensure_user("other")
    yield repo
    repo.close()


def accepted(repo, key, category="science", name="과학관"):
    place = TourPlaceCandidate(key, name, 36.3762, 127.3745, category, category, "", 0, "tourapi")
    quest = repo.get_or_create_reusable_quest("owner", {
        "title": f"{name} 방문", "description": "장소 방문", "type": "visit",
        "categoryCode": category, "rewardXp": 1, "verificationType": "gps",
        "placeContentId": key, "placeName": name, "source": "template",
    })
    instance = repo.get_or_create_user_quest_instance(
        "owner", quest["id"], (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(), place=place,
    )
    repo.accept_quest("owner", instance["id"], place=place)
    return repo.get_instance_with_quest("owner", instance["id"])


def variants(repo, user="owner", category="science"):
    return [v for v in repo.list_ggumdori(user)["variants"] if v["themeCategory"] == category]


def test_each_category_unlocks_at_one_two_three_successes_without_xp_dependency(store):
    assert not any(v["unlocked"] for v in variants(store))
    for count in (1, 2, 3):
        instance = accepted(store, f"science-{count}")
        result = store.complete_quest("owner", instance, {"decision": "approved"}, 0)
        assert [v["tier"] for v in result["unlockedGgumdori"]] == [count]
        assert store.complete_quest("owner", instance, {"decision": "approved"}, 0) is None
        entries = variants(store)
        assert [v["tier"] for v in entries if v["unlocked"]] == list(range(1, count + 1))
        assert all(v["completedCount"] == count for v in entries)
    assert not any(v["unlocked"] for v in variants(store, "other"))
    assert not any(v["unlocked"] for v in variants(store, category="nature"))
    store.select_ggumdori("owner", "ggumdori_science_3")
    with pytest.raises(ValueError):
        store.select_ggumdori("other", "ggumdori_science_3")


def test_old_completion_history_backfills_from_snapshot_after_quest_deleted(store):
    instance = accepted(store, "bread", "market", "성심당 본점")
    store.complete_quest("owner", instance, {"decision": "approved"}, 0)
    # 새 정책 이전처럼 소유권만 없는 상태로 되돌린다. 실제 완료 기록은 그대로 보존한다.
    store._connection.execute("DELETE FROM user_ggumdori WHERE user_id = 'owner' AND variant_id = 'ggumdori_bread_1'")
    store._connection.execute("DELETE FROM reusable_quests WHERE id = %s", (instance["reusable_quest_id"],))
    entries = variants(store, category="bread")
    assert entries[0]["unlocked"] and entries[0]["completedCount"] == 1
    assert not any(v["unlocked"] for v in variants(store, category="market"))
    first_date = entries[0]["unlockedAt"]
    store.initialize()
    assert variants(store, category="bread")[0]["unlockedAt"] == first_date


def test_seed_upgrade_keeps_existing_ownership_and_selection(store):
    instance = accepted(store, "owned")
    store.complete_quest("owner", instance, {"decision": "approved"}, 0)
    store.select_ggumdori("owner", "ggumdori_science_1")
    before = variants(store)[0]["unlockedAt"]
    store._connection.execute("UPDATE ggumdori_variants SET image_ref = '/assets/ggumdori/science-1.svg' WHERE id = 'ggumdori_science_1'")
    store.initialize()
    payload = store.list_ggumdori("owner")
    assert payload["selectedVariantId"] == "ggumdori_science_1"
    assert variants(store)[0]["unlockedAt"] == before
    assert variants(store)[0]["imageRef"].endswith("science_lv1_128.png")
    assert len(payload["variants"]) == 34
    assert len({(v["themeCategory"], v["tier"]) for v in payload["variants"]}) == 34
    assert all("nightview" not in v["id"] for v in payload["variants"])


def test_simultaneous_different_quest_completions_do_not_miss_next_level(store):
    first, second = accepted(store, "parallel-1"), accepted(store, "parallel-2")
    barrier = Barrier(2)
    def complete(instance):
        repo = QuestbookRepository(data_services.TEST_DATABASE_URL)
        try:
            barrier.wait(timeout=5)
            return repo.complete_quest("owner", instance, {"decision": "approved"}, 0)
        finally:
            repo.close()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(complete, [first, second]))
    assert sorted(v["tier"] for r in results for v in r["unlockedGgumdori"]) == [1, 2]
    assert [v["tier"] for v in variants(store) if v["unlocked"]] == [1, 2]


def test_artwork_files_and_unique_variants():
    root = Path(__file__).resolve().parents[3] / "apps/user-web/public"
    assert len(GGUMDORI_SEEDS) == len({row[0] for row in GGUMDORI_SEEDS}) == 34
    assert all((root / row[5].lstrip("/")).is_file() for row in GGUMDORI_SEEDS)


def test_failed_transaction_does_not_count_success_or_grant_reward(store, monkeypatch):
    instance = accepted(store, "rollback")
    original = store._sync_completion_ggumdori
    def fail_after_grant(user_id):
        original(user_id)
        raise RuntimeError("simulated failure before completing transaction")
    with monkeypatch.context() as patch:
        patch.setattr(store, "_sync_completion_ggumdori", fail_after_grant)
        with pytest.raises(RuntimeError):
            store.complete_quest("owner", instance, {"decision": "approved"}, 0)
    assert store.get_instance_with_quest("owner", instance["instance_id"])["status"] == "accepted"
    assert all(v["completedCount"] == 0 and not v["unlocked"] for v in variants(store))


def test_reward_category_matches_frozen_quest_and_retired_variant_cannot_be_selected(store):
    instance = accepted(store, "bread-category", "market", "성심당")
    service = object.__new__(BaselineQuestbookService)
    payload = service._quest_payload_from_joined(instance)
    assert payload["categoryCode"] == "market"  # 기존 XP·인증 분류 유지
    assert payload["rewardCategory"] == "bread"
    with pytest.raises(ValueError):
        store.select_ggumdori("owner", "ggumdori_nightview_2")


@pytest.mark.parametrize("category,name,expected", [
    ("market", "성심당", "bread"), ("market", "칼국수 식당", "food"),
    ("market", "중앙시장", "market"), ("nature", "유성온천 족욕장", "hotspring"),
    ("downtown", "한화생명 볼파크", "sport"), ("downtown", "지역 축제", "festival"),
    ("science", "과학 축제", "science"), ("nightview", "엑스포다리", "culture"),
])
def test_legacy_quest_has_one_reward_category(category, name, expected):
    assert completion_theme(category, name) == expected
