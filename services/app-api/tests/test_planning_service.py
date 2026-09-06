# 관심사 저장과 계획 위치 및 대전 전체 관광지 추천을 검증한다.
from __future__ import annotations

from collections.abc import Iterator
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
import sys
from typing import Any
from unittest.mock import Mock

import pytest


# 변수 의미: 테스트에서 앱 API 패키지를 불러올 소스 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.application.baseline_service import BaselineQuestbookService
from questbook_api.domain.models import CacheEntry, TourPlaceCandidate
from questbook_api.infrastructure.cache import utc_now
from questbook_api.infrastructure.repository import QuestbookRepository
from questbook_api.server import parse_required_float


# 변수 의미: 거리 영향 없이 관심사 일치 여부를 비교할 장소 후보들이다.
PLACES = [
    TourPlaceCandidate("near", "가까운 거리", 36.327, 127.427, "downtown", "원도심 걷기", "거리", 1, "tourapi"),
    TourPlaceCandidate("far", "먼 자연", 36.45, 127.45, "nature", "자연 관찰", "자연", 19000, "tourapi"),
    TourPlaceCandidate("science", "과학관", 36.37, 127.37, "science", "과학 문화", "전시", 300, "tourapi"),
]


class MemoryPlaceCache:
    """
    입력: 없음.
    출력: 테스트용 장소 캐시 객체.
    역할: Redis 없이 실제 서비스의 검색 조건 분리와 재사용을 확인한다.
    호출 예시: cache = MemoryPlaceCache()
    """

    def __init__(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 사용자별 캐시 엔트리를 보관할 공간을 만든다.
        호출 예시: cache = MemoryPlaceCache()
        """
        # 변수 의미: 사용자, 권역, 카테고리별 캐시 엔트리다.
        self.entries: dict[tuple[str, str, str], CacheEntry] = {}
        # 변수 의미: 실제 기본 정책과 같은 캐시 유효 시간이다.
        self.default_ttl_seconds = 1800

    def get(self, user_id: str, region_key: str, category_key: str) -> CacheEntry | None:
        """
        입력: 사용자 ID와 검색 키.
        출력: 저장된 엔트리 또는 None.
        역할: 서비스가 같은 조건의 결과를 재사용하는지 확인한다.
        호출 예시: entry = cache.get("alice", "daejeon", "all")
        """
        return self.entries.get((user_id, region_key, category_key))

    def set(
        self, user_id: str, region_key: str, category_key: str,
        places: list[TourPlaceCandidate], source_status: str,
    ) -> CacheEntry:
        """
        입력: 사용자 ID, 검색 키, 장소 후보와 원천 상태.
        출력: 저장한 캐시 엔트리.
        역할: 실제 서비스와 같은 만료 메타데이터를 만든다.
        호출 예시: entry = cache.set("alice", "daejeon", "all", [], "live")
        """
        # 변수 의미: 캐시 생성 시각이다.
        fetched_at = utc_now()
        # 변수 의미: 장소 목록과 만료 정책을 묶은 엔트리다.
        entry = CacheEntry(places, fetched_at, fetched_at + timedelta(minutes=30), source_status)
        self.entries[(user_id, region_key, category_key)] = entry
        return entry

    def invalidate_for_user(self, user_id: str, preserve_region_keys: tuple[str, ...] = ()) -> None:
        """
        입력: 사용자 ID와 삭제에서 제외할 권역 키.
        출력: 없음.
        역할: 다른 사용자 데이터를 보존하며 해당 사용자 캐시를 제거한다.
        호출 예시: cache.invalidate_for_user("alice")
        """
        self.entries = {
            key: entry for key, entry in self.entries.items()
            if key[0] != user_id or key[1] in preserve_region_keys
        }


@pytest.fixture
def service() -> BaselineQuestbookService:
    """
    입력: pytest fixture 실행 컨텍스트.
    출력: 외부 저장소 없는 실제 추천 서비스.
    역할: 관심사, 관광지 순위, 검색 조건 변경 동작을 독립 검증한다.
    호출 예시: test_citywide_preferences(service)
    """
    # 변수 의미: 사용자별 선택 상태를 보관하는 테스트 데이터다.
    users: dict[str, dict[str, Any]] = {}

    def get_user(user_id: str) -> dict[str, Any]:
        """
        입력: 사용자 ID.
        출력: 사용자별 선호도를 포함한 독립 복사본.
        역할: 신규 사용자의 빈 관심사와 계정 격리를 흉내 낸다.
        호출 예시: user = get_user("alice")
        """
        users.setdefault(user_id, {"id": user_id, "preference": {
            "categories": [], "distanceRangeMeters": 5000, "pace": "보통", "isConfigured": False,
        }})
        return deepcopy(users[user_id])

    def save_categories(user_id: str, categories: list[str]) -> dict[str, Any]:
        """
        입력: 사용자 ID와 검증된 관심사 코드.
        출력: 저장된 선호도.
        역할: 서비스의 실제 검증 뒤 저장 요청만 반영한다.
        호출 예시: preference = save_categories("alice", ["nature"])
        """
        get_user(user_id)
        users[user_id]["preference"].update(categories=list(categories), isConfigured=True)
        return deepcopy(users[user_id]["preference"])

    # 변수 의미: DB 경계만 대체하는 저장소 대역이다.
    repository = Mock(spec=QuestbookRepository)
    repository.ensure_user.side_effect = get_user
    repository.get_user.side_effect = get_user
    repository.update_preferences = Mock(side_effect=save_categories)
    repository.get_category_codes.return_value = ["default", "nature", "science", "downtown", "market", "mobility", "nightview", "hotspring"]
    repository.get_recommendation_profile.return_value = {}
    # 변수 의미: 외부 API 경계만 대체하는 관광지 클라이언트다.
    tour_client = Mock()
    tour_client.fetch_daejeon.return_value = (PLACES, "live")
    tour_client.fetch_nearby.return_value = ([], "live")
    return BaselineQuestbookService(repository, MemoryPlaceCache(), tour_client)


def test_preferences_save_empty_and_separate_users(service: BaselineQuestbookService) -> None:
    """
    입력: 외부 저장소 없는 서비스.
    출력: 관심사 저장과 초기화 검증 결과.
    역할: 활동 이력 없이 관심사를 선택하고 명시적으로 비울 수 있는지 확인한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k preferences_save
    """
    assert service.update_preferences("alice", {"categories": ["nature", "market"]})["categories"] == ["nature", "market"]
    assert service.repository.get_user("bob")["preference"]["categories"] == []
    assert service.update_preferences("alice", {"categories": []}) == {
        "categories": [], "distanceRangeMeters": 5000, "pace": "보통", "isConfigured": True,
    }


@pytest.mark.parametrize("payload", [
    {}, {"categories": None}, {"categories": "nature"}, {"categories": ["all"]},
    {"categories": ["default"]}, {"categories": ["hotspring"]}, {"categories": [42]},
    {"categories": ["nature", "nature"]}, {"categories": ["nature"] * 7},
    {"categories": [["nature"]]},
])
def test_preferences_reject_invalid_selection(service: BaselineQuestbookService, payload: dict[str, Any]) -> None:
    """
    입력: 서비스와 잘못된 관심사 본문.
    출력: 저장 전 입력 검증 결과.
    역할: 구현되지 않은 카테고리, 중복, 잘못된 타입을 거절한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k reject_invalid_selection
    """
    with pytest.raises(ValueError):
        service.update_preferences("alice", payload)
    service.repository.update_preferences.assert_not_called()


def test_citywide_preferences_rank_without_distance_or_quests(service: BaselineQuestbookService) -> None:
    """
    입력: 서비스.
    출력: 거리 없는 대전 전체 개인화 검증 결과.
    역할: 멀리 있는 관심 장소가 우선되며 탐색만으로 퀘스트를 만들지 않는지 확인한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k rank_without_distance
    """
    service.update_preferences("alice", {"categories": ["nature"]})
    # 변수 의미: 좌표 없이 조회한 대전 관광지 응답이다.
    response = service.get_place_recommendations("alice")
    assert response["scope"] == "daejeon"
    assert response["recommendations"][0]["place"]["contentId"] == "far"
    assert response["recommendations"][0]["matchesPreference"] is True
    assert response["recommendations"][0]["reason"]
    assert all(item["place"]["distanceMeters"] is None for item in response["recommendations"])
    assert all("quest" not in item for item in response["recommendations"])
    service.repository.get_or_create_reusable_quest.assert_not_called()
    service.repository.get_or_create_user_quest_instance.assert_not_called()
    service.repository.get_recommendation_profile.assert_not_called()


def test_citywide_updates_rank_from_cached_candidates(service: BaselineQuestbookService) -> None:
    """
    입력: 서비스.
    출력: 선호도 저장 직후 재정렬 검증 결과.
    역할: 관광지 캐시가 유효해도 사용자의 최신 선택을 점수에 반영한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k updates_rank
    """
    service.get_place_recommendations("alice")
    service.update_preferences("alice", {"categories": ["science"]})
    # 변수 의미: 저장 이후 같은 장소 캐시로 재정렬한 결과다.
    response = service.get_place_recommendations("alice")
    assert response["cache"]["hit"] is True
    assert response["recommendations"][0]["place"]["contentId"] == "science"
    service.tour_client.fetch_daejeon.assert_called_once_with(category_key="all")


def test_citywide_filters_strictly_and_limits_results(service: BaselineQuestbookService) -> None:
    """
    입력: 서비스.
    출력: 명시적 필터와 응답 제한 검증 결과.
    역할: 결과 없는 카테고리에 다른 장소를 끼워 넣지 않으며 최대 30개를 반환한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k limits_results
    """
    assert service.get_place_recommendations("alice", "nightview")["recommendations"] == []
    service.tour_client.fetch_daejeon.return_value = (
        [replace(PLACES[1], content_id=str(index), title=f"자연 {index:02}") for index in range(40)], "live",
    )
    assert len(service.get_place_recommendations("alice", force_refresh=True)["recommendations"]) == 30


@pytest.mark.parametrize("changed", [
    {"latitude": 36.3271}, {"longitude": 127.4271}, {"radius_meters": 10000}, {"mode": "planning"},
])
def test_search_conditions_use_distinct_cache(service: BaselineQuestbookService, changed: dict[str, Any]) -> None:
    """
    입력: 서비스와 변경할 검색 조건.
    출력: 검색 기준별 캐시 분리 검증 결과.
    역할: 같은 반올림 권역 내 좌표와 반경 및 모드 변경을 모두 반영한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k distinct_cache
    """
    # 변수 의미: 기준 주변 퀘스트 검색 조건이다.
    arguments = {"user_id": "alice", "latitude": 36.327, "longitude": 127.427, "category_key": "all", "radius_meters": 5000}
    service.get_recommendations(**arguments)
    assert service.get_recommendations(**arguments)["cache"]["hit"] is True
    arguments.update(changed)
    assert service.get_recommendations(**arguments)["cache"]["hit"] is False
    assert service.tour_client.fetch_nearby.call_count == 2


@pytest.mark.parametrize("changed", [
    {"latitude": 36.3271}, {"radius_meters": 10000}, {"mode": "planning"}, {"category_key": "science"},
])
def test_search_changes_keep_citywide_cache_and_remove_previous_nearby(
    service: BaselineQuestbookService, changed: dict[str, Any],
) -> None:
    """
    입력: 서비스와 변경할 위치 기반 검색 조건.
    출력: 지역 후보 보존과 이전 주변 캐시 제거 검증 결과.
    역할: 계획 위치 전환마다 대전 전체를 다시 조회하지 않고 기존 조건의 주변 결과만 폐기한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k keep_citywide_cache
    """
    service.get_place_recommendations("alice")
    # 변수 의미: 저장 시각과 만료 시각까지 그대로 보존해야 하는 대전 전체 엔트리다.
    city_entry = service.cache.get("alice", "citywide:daejeon", "all")
    # 변수 의미: 첫 번째 주변 조회에 사용하는 검색 조건이다.
    arguments = {"user_id": "alice", "latitude": 36.327, "longitude": 127.427, "category_key": "all", "radius_meters": 5000}
    service.get_recommendations(**arguments)
    # 변수 의미: 변경 후 제거되어야 하는 첫 번째 주변 엔트리 키다.
    previous_key = next(key for key in service.cache.entries if key[1].startswith("nearby:"))
    arguments.update(changed)
    service.get_recommendations(**arguments)
    assert previous_key not in service.cache.entries
    assert service.cache.get("alice", "citywide:daejeon", "all") is city_entry
    assert service.get_place_recommendations("alice")["cache"]["hit"] is True
    service.tour_client.fetch_daejeon.assert_called_once_with(category_key="all")


def test_nearby_refresh_preserves_citywide_cache(service: BaselineQuestbookService) -> None:
    """
    입력: 서비스.
    출력: 주변 퀘스트 강제 새로고침의 캐시 범위 검증 결과.
    역할: 주변 데이터만 다시 조회하며 대전 관광지 새로고침은 별도 사용자 동작으로 남긴다.
    호출 예시: uv run pytest tests/test_planning_service.py -k nearby_refresh_preserves
    """
    service.get_place_recommendations("alice")
    # 변수 의미: 주변 새로고침 이전의 대전 전체 후보 엔트리다.
    city_entry = service.cache.get("alice", "citywide:daejeon", "all")
    service.get_recommendations("alice", 36.327, 127.427, "all", 5000)
    service.get_recommendations("alice", 36.327, 127.427, "all", 5000, force_refresh=True)
    assert service.cache.get("alice", "citywide:daejeon", "all") is city_entry
    assert service.tour_client.fetch_nearby.call_count == 2
    assert service.get_place_recommendations("alice")["cache"]["hit"] is True
    service.tour_client.fetch_daejeon.assert_called_once_with(category_key="all")


def test_planning_reference_and_strict_category(service: BaselineQuestbookService) -> None:
    """
    입력: 서비스.
    출력: 계획 기준 위치와 빈 필터 결과 검증.
    역할: 다른 카테고리 fallback을 계획 퀘스트로 생성하지 않는다.
    호출 예시: uv run pytest tests/test_planning_service.py -k planning_reference
    """
    service.tour_client.fetch_nearby.return_value = (PLACES, "live")
    # 변수 의미: 야경 장소가 없는 계획 지점의 결과다.
    response = service.get_recommendations("alice", 36.37, 127.38, "nightview", 3000, mode="planning")
    assert response["recommendations"] == []
    assert response["mode"] == "planning"
    assert response["referenceLocation"] == {"latitude": 36.37, "longitude": 127.38, "radiusMeters": 3000}
    service.repository.get_or_create_reusable_quest.assert_not_called()


def test_planning_filters_outside_radius_even_for_fallback(service: BaselineQuestbookService) -> None:
    """
    입력: 서비스.
    출력: 계획 중심에서 실제 거리를 다시 계산한 반경 검증 결과.
    역할: 다른 지역의 예시 장소와 잘못된 캐시 거리값을 계획 퀘스트에 포함하지 않는다.
    호출 예시: uv run pytest tests/test_planning_service.py -k outside_radius
    """
    service.tour_client.fetch_nearby.return_value = ([replace(PLACES[1], distance_meters=0)], "fallback:not_configured")
    service.repository.get_or_create_reusable_quest.side_effect = AssertionError("반경 밖 장소는 퀘스트로 생성하면 안 됩니다.")
    assert service.get_recommendations(
        "alice", 37.5665, 126.9780, "nature", 5000, mode="planning",
    )["recommendations"] == []
    service.repository.get_or_create_reusable_quest.assert_not_called()


@pytest.mark.parametrize("raw_value", ["nan", "NaN", "inf", "-inf", "91", "-91", "abc", ""])
def test_reference_coordinate_parser_rejects_invalid_values(raw_value: str) -> None:
    """
    입력: 유한한 위도가 아닌 쿼리 문자열.
    출력: API 경계의 좌표 검증 결과.
    역할: 잘못된 위치를 기본 위치로 대체하거나 인증 및 추천 계산에 넘기지 않는다.
    호출 예시: uv run pytest tests/test_planning_service.py -k coordinate_parser
    """
    with pytest.raises(ValueError):
        parse_required_float(raw_value, "lat", -90.0, 90.0)


@pytest.fixture
def postgres_repository() -> Iterator[QuestbookRepository]:
    """
    입력: pytest fixture 실행 컨텍스트.
    출력: 독립 검증용 실제 PostgreSQL 저장소.
    역할: 전체 테스트의 순차 실행에서 선호도 영구 저장과 기존 데이터 보존을 검증한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k Repository
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import data_services

    if not data_services.SERVICES_AVAILABLE:
        pytest.skip("local PostgreSQL/Redis not available")
    # 변수 의미: 기존 테스트와 공유하므로 순차 실행해야 하는 전용 테스트 DB URL이다.
    database_url = data_services.ensure_test_database()
    data_services.reset_database(database_url)
    # 변수 의미: 검증 대상 실제 저장소다.
    repository = QuestbookRepository(database_url)
    repository.initialize()
    try:
        yield repository
    finally:
        repository.close()


class TestPreferencesRepository:
    """
    입력: 순차 실행하는 실제 DB fixture.
    출력: 선호도 영속성과 마이그레이션 검증 결과.
    역할: 서비스 대역으로 확인할 수 없는 SQL 저장 동작을 검증한다.
    호출 예시: uv run pytest tests/test_planning_service.py -k Repository
    """

    def test_save_persists_and_isolates_users(self, postgres_repository: QuestbookRepository) -> None:
        """
        입력: 실제 저장소.
        출력: 저장 유지와 사용자 분리 검증.
        역할: 재초기화가 저장한 관심사를 초기값으로 덮어쓰지 않는지 확인한다.
        호출 예시: pytest -k save_persists
        """
        assert postgres_repository.ensure_user("alice")["preference"]["categories"] == []
        assert postgres_repository.get_user("alice")["preference"]["isConfigured"] is False
        postgres_repository.update_preferences("alice", ["market"])
        postgres_repository.initialize()
        assert postgres_repository.ensure_user("alice")["preference"]["categories"] == ["market"]
        assert postgres_repository.get_user("alice")["preference"]["isConfigured"] is True
        assert postgres_repository.ensure_user("bob")["preference"]["categories"] == []
        assert postgres_repository.update_preferences("alice", [])["isConfigured"] is True

    def test_migration_preserves_existing_categories(self, postgres_repository: QuestbookRepository) -> None:
        """
        입력: 실제 저장소.
        출력: 기존 선호도와 미설정 상태 보존 검증.
        역할: 003 마이그레이션을 반복 실행해도 관심사 값이 바뀌지 않는지 확인한다.
        호출 예시: pytest -k migration_preserves
        """
        postgres_repository.ensure_user("legacy")
        postgres_repository._connection.execute(
            "UPDATE preferences SET categories_json = '[\"nature\", \"science\"]'::jsonb WHERE user_id = %s",
            ("legacy",),
        )
        # 변수 의미: 운영 배포용 멱등 관심사 마이그레이션 SQL이다.
        migration = (Path(__file__).resolve().parents[3] / "database/migrations/003_user_preferences.sql").read_text()
        postgres_repository._connection.execute(migration)
        postgres_repository._connection.execute(migration)
        assert postgres_repository.get_user("legacy")["preference"]["categories"] == ["nature", "science"]
        assert postgres_repository.get_user("legacy")["preference"]["isConfigured"] is False
