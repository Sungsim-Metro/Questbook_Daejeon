# 실제 일일 생성·SQL 저장·추천·수락 보존을 전용 PostgreSQL 데이터베이스에서 검증한다.
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit
from unittest.mock import patch

import pytest

import data_services
from questbook_api import catalog_sync
from questbook_api.application.baseline_service import BaselineQuestbookService
from questbook_api.application.quest_generation import QUEST_TEMPLATES
from questbook_api.domain.models import TourPlaceCandidate
from questbook_api.infrastructure.repository import QuestbookRepository
from questbook_api.integrations.tourapi.client import TourApiClient
from test_planning_service import MemoryPlaceCache


# 변수 의미: 실제 외부 호출 없이 전체 관측을 재현할 기준 시각이다.
OBSERVED_AT = datetime(2026, 9, 1, 1, tzinfo=timezone.utc)
# 변수 의미: 공용 생성과 실제 추천 및 수락에 사용하는 라이브 관광지다.
PLACE = TourPlaceCandidate(
    "integration-100", "첫 과학관", 36.3762, 127.3745,
    "science", "과학 문화", "전시 관찰", 0, "tourapi",
)


class SelectedPlaceCache(MemoryPlaceCache):
    """
    입력: 없음.
    출력: 선택한 장소 조회도 지원하는 테스트 캐시.
    역할: 공유 Redis를 초기화하지 않고 사용자 수락의 캐시 경계를 재현한다.
    호출 예시: cache = SelectedPlaceCache()
    """

    def find_place_for_user(self, user_id: str, content_id: str) -> TourPlaceCandidate | None:
        """
        입력: 사용자 ID와 관광지 ID.
        출력: 해당 사용자의 캐시 장소 또는 None.
        역할: 실제 수락 서비스에 사용자 소유가 일치하는 장소를 제공한다.
        호출 예시: place = cache.find_place_for_user("owner", "integration-100")
        """
        return next((
            place
            for (cached_user, _, _), entry in self.entries.items()
            if cached_user == user_id
            for place in entry.places
            if place.content_id == content_id
        ), None)


@pytest.fixture
def repository(monkeypatch: pytest.MonkeyPatch) -> Iterator[QuestbookRepository]:
    """
    입력: 테스트별 설정 복구 도구.
    출력: 다른 테스트와 분리된 실제 PostgreSQL 저장소.
    역할: 전체 테스트 실행에서도 전용 *_test 데이터베이스만 초기화한다.
    호출 예시: pytest tests/test_catalog_integration.py
    """
    if not data_services.SERVICES_AVAILABLE:
        pytest.skip("local PostgreSQL/Redis not available")
    # 변수 의미: 접속 호스트 설정은 유지하고 테스트 전용 DB 이름만 교체한 주소다.
    database_url = urlunsplit(urlsplit(data_services.TEST_DATABASE_URL)._replace(
        path="/questbook_catalog_integration_test",
    ))
    monkeypatch.setattr(data_services, "TEST_DATABASE_URL", database_url)
    data_services.ensure_test_database()
    data_services.reset_database(database_url)
    # 변수 의미: 일일 실행기와 사용자 서비스에서 공동 사용하는 실제 SQL 저장소다.
    storage = QuestbookRepository(database_url)
    storage.initialize()
    try:
        yield storage
    finally:
        storage.close()


def cached_service(repository: QuestbookRepository, places: list[TourPlaceCandidate]) -> BaselineQuestbookService:
    """
    입력: 실제 저장소와 이미 조회한 라이브 관광지 목록.
    출력: 외부 API 호출 없이 캐시 경로를 사용하는 실제 추천 서비스.
    역할: 일일 생성 결과와 사용자 추천을 실제 SQL 경계로 연결한다.
    호출 예시: service = cached_service(repository, [PLACE])
    """
    # 변수 의미: 실제 사용자 요청과 동일한 권역 키로 준비한 메모리 장소 캐시다.
    cache = SelectedPlaceCache()
    cache.set("owner", "nearby:36.3762000:127.3745000:5000", "all", places, "live")
    cache.set("owner", "citywide:daejeon", "all", places, "live")
    return BaselineQuestbookService(repository, cache, TourApiClient(""))


def test_daily_generation_connects_to_live_recommendations_without_new_quest_rows(repository: QuestbookRepository) -> None:
    """
    입력: 템플릿 지원·미지원 관광지의 완전한 관측과 미등록 라이브 장소.
    출력: 실제 저장한 퀘스트만 보여 주는 추천 및 장소 탐색 결과.
    역할: 실행기·생성기·DB·추천 간 계약과 추천 시 정의 비생성을 함께 확인한다.
    호출 예시: pytest -k generation_connects
    """
    # 변수 의미: 전체 수집에는 포함되지만 생성 정책이 없는 장소다.
    unsupported = replace(PLACE, content_id="integration-unsupported", category_code="hotspring")
    with patch.object(catalog_sync, "fetch_catalog", return_value=([PLACE, unsupported], "live")):
        # 변수 의미: 실제 실행기와 생성기 및 저장소를 통과한 첫 동기화 결과다.
        result = catalog_sync.run_catalog_sync(repository, TourApiClient(""), now=OBSERVED_AT)
    assert result["status"] == "live"
    assert result["stats"]["places"] == 2
    assert result["stats"]["quests_created"] == 1
    assert repository.catalog_status()["last_run"]["status"] == "completed"
    # 변수 의미: 사용자 요청과 무관하게 사전 생성된 공용 퀘스트다.
    saved = repository.get_catalog_quests([PLACE.content_id])[PLACE.content_id][0]
    assert saved["created_for_user_id"] is None
    assert saved["title"] == "첫 과학관 과학 탐험"
    assert saved["reward_xp"] == 80
    # 변수 의미: 일일 생성 이후 새로 등장해 아직 저장 퀘스트가 없는 장소다.
    unknown = replace(PLACE, content_id="integration-new")
    # 변수 의미: 실제 DB를 사용하는 사용자 추천 서비스다.
    service = cached_service(repository, [PLACE, unsupported, unknown])
    # 변수 의미: 저장 퀘스트와 라이브 후보의 교집합을 반환한 응답이다.
    response = service.get_recommendations("owner", 36.3762, 127.3745, "all", 5000)
    assert response["cache"]["hit"] is True
    assert [item["place"]["contentId"] for item in response["recommendations"]] == ["integration-100"]
    assert response["recommendations"][0]["quest"]["reusableQuestId"] == saved["id"]
    assert [item["place"]["contentId"] for item in service.get_place_recommendations("owner")["recommendations"]] == ["integration-100"]
    assert repository._connection.execute("SELECT count(*) AS count FROM reusable_quests").fetchone()["count"] == 1
    assert repository._connection.execute("SELECT count(*) AS count FROM user_quest_instances").fetchone()["count"] == 1


def test_next_day_sync_preserves_accepted_payload_and_completion_reward(
    repository: QuestbookRepository, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    입력: 수락 이후 관광지명과 템플릿 보상 정책이 바뀐 다음날 전체 관측.
    출력: 공용 정의의 새 버전과 사용자에게 약속한 이전 제목·완료 XP.
    역할: 실제 일일 동기화가 수락한 퀘스트 사본과 지급 보상을 변경하지 않게 한다.
    호출 예시: pytest -k next_day_sync
    """
    with patch.object(catalog_sync, "fetch_catalog", return_value=([PLACE], "live")):
        assert catalog_sync.run_catalog_sync(repository, TourApiClient(""), now=OBSERVED_AT)["status"] == "live"
    # 변수 의미: 첫날 라이브 장소를 추천하고 수락하는 사용자 서비스다.
    service = cached_service(repository, [PLACE])
    # 변수 의미: 수락 시점에 표시된 퀘스트 조건이다.
    original = service.get_recommendations("owner", 36.3762, 127.3745, "all", 5000)["recommendations"][0]["quest"]
    service.accept_quest("owner", original["instanceId"])
    # 변수 의미: 다음날 실제 생성기에 적용하는 변경된 보상 정책이다.
    updated_template = replace(QUEST_TEMPLATES["science"], reward_xp=120)
    monkeypatch.setitem(QUEST_TEMPLATES, "science", updated_template)
    # 변수 의미: 다음날 전체 수집에서 확인한 변경된 관광지명이다.
    updated_place = replace(PLACE, title="새 과학관")
    with patch.object(catalog_sync, "fetch_catalog", return_value=([updated_place], "live")):
        assert catalog_sync.run_catalog_sync(
            repository, TourApiClient(""), now=OBSERVED_AT + timedelta(days=1),
        )["status"] == "live"
    # 변수 의미: 실제 일일 생성으로 갱신된 공용 퀘스트다.
    shared = repository.get_catalog_quests([PLACE.content_id])[PLACE.content_id][0]
    assert (shared["version"], shared["title"], shared["reward_xp"]) == (2, "새 과학관 과학 탐험", 120)
    # 변수 의미: 같은 사용자 인스턴스의 고정 사본을 사용한 재추천 퀘스트다.
    accepted = service.get_recommendations("owner", 36.3762, 127.3745, "all", 5000)["recommendations"][0]["quest"]
    assert accepted["instanceId"] == original["instanceId"]
    assert (accepted["title"], accepted["rewardXp"]) == ("첫 과학관 과학 탐험", 80)
    service.cache.entries.clear()
    # 변수 의미: 관광지 캐시가 없는 상태에서 수락 사본으로 인증한 완료 결과다.
    completion = service.complete_quest("owner", accepted["instanceId"], {
        "latitude": 36.3762, "longitude": 127.3745, "accuracyMeters": 10,
    })
    assert completion["ok"] is True
    assert completion["completion"]["earnedXp"] == 80
    assert repository.list_notes("owner")[0]["questTitle"] == "첫 과학관 과학 탐험"
