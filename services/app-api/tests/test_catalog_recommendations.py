# 라이브 관광지와 사전 저장 퀘스트의 교집합 및 기존 예시 대체 흐름을 검증한다.
from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from typing import Any
from unittest.mock import Mock

import pytest

from questbook_api.application.baseline_service import BaselineQuestbookService
from test_planning_service import PLACES, service


# 변수 의미: 템플릿으로 재생성하지 않고 그대로 반환해야 하는 저장 퀘스트다.
SAVED_QUEST = {
    "id": "saved-near", "title": "미리 검토한 거리 탐험", "description": "기록된 설명",
    "type": "이동형", "category_code": "downtown", "reward_xp": 45,
    "verification_type": "gps_distance", "place_content_id": "near", "place_name": "가까운 거리",
    "source": "template", "review_status": "approved", "is_reusable": True,
    "created_for_user_id": None, "reuse_count": 0, "completion_count": 0,
    "created_at": "2026-09-08T00:00:00+00:00",
}


@pytest.fixture
def catalog_service(service: BaselineQuestbookService) -> BaselineQuestbookService:
    """
    입력: 외부 DB 및 TourAPI 경계를 대체한 서비스.
    출력: 저장 퀘스트와 인스턴스 응답이 준비된 서비스.
    역할: 실제 추천 로직에서 라이브 생성 금지와 저장 퀘스트 선택을 검증한다.
    호출 예시: pytest -k live_matches_saved
    """
    service.repository.get_catalog_quests = Mock(return_value={"near": [deepcopy(SAVED_QUEST)]})
    service.repository.get_or_create_reusable_quest.return_value = deepcopy(SAVED_QUEST)
    service.repository.get_or_create_user_quest_instance.return_value = {
        "id": "instance-near", "user_id": "alice", "reusable_quest_id": "saved-near",
        "status": "recommended", "recommended_at": "2026-09-08T00:00:00+00:00",
        "accepted_at": None, "expires_at": "2026-09-08T04:00:00+00:00", "completed_at": None,
    }
    service.tour_client.fetch_nearby.return_value = (PLACES, "live")
    return service


@pytest.mark.parametrize("source_status", ["live", "live:partial"])
def test_live_matches_saved_quests_without_creating_definitions(
    catalog_service: BaselineQuestbookService, source_status: str,
) -> None:
    """
    입력: 등록 장소와 미등록 장소가 함께 있는 라이브 응답.
    출력: 등록된 퀘스트만 반환하는 추천 검증 결과.
    역할: contentId 교집합 없이 즉석 생성하거나 검토된 문구를 덮어쓰는 회귀를 방지한다.
    호출 예시: pytest -k live_matches_saved
    """
    catalog_service.tour_client.fetch_nearby.return_value = (PLACES, source_status)
    # 변수 의미: 실제 서비스가 구성한 주변 추천 응답이다.
    response = catalog_service.get_recommendations("alice", 36.327, 127.427, "all", 5000)
    assert [item["place"]["contentId"] for item in response["recommendations"]] == ["near"]
    assert response["recommendations"][0]["quest"]["title"] == "미리 검토한 거리 탐험"
    assert response["recommendations"][0]["quest"]["rewardXp"] == 45
    assert response["cache"]["sourceStatus"] == source_status
    catalog_service.repository.get_catalog_quests.assert_called_once_with(["near", "far", "science"])
    catalog_service.repository.get_or_create_reusable_quest.assert_not_called()
    assert catalog_service.repository.get_or_create_user_quest_instance.call_args.kwargs["place"] == PLACES[0]


def test_live_preserves_multiple_quests_with_matching_category(catalog_service: BaselineQuestbookService) -> None:
    """
    입력: 한 장소의 같은 카테고리 퀘스트 두 개와 다른 카테고리 퀘스트.
    출력: 카테고리가 맞는 두 저장 퀘스트만 표시하는 결과.
    역할: 장소별 첫 퀘스트만 고르거나 다른 테마 퀘스트를 섞는 회귀를 방지한다.
    호출 예시: pytest -k multiple_quests
    """
    catalog_service.repository.get_catalog_quests.return_value = {"near": [
        deepcopy(SAVED_QUEST), {**SAVED_QUEST, "id": "saved-second", "title": "두 번째 퀘스트"},
        {**SAVED_QUEST, "id": "wrong-category", "category_code": "nature"},
    ]}
    # 변수 의미: 여러 저장 퀘스트를 결합한 실제 추천 결과다.
    response = catalog_service.get_recommendations("alice", 36.327, 127.427, "all", 5000)
    assert [item["quest"]["reusableQuestId"] for item in response["recommendations"]] == ["saved-near", "saved-second"]
    catalog_service.repository.get_or_create_reusable_quest.assert_not_called()


def test_citywide_hides_unknown_places_without_creating_instances(catalog_service: BaselineQuestbookService) -> None:
    """
    입력: GPS 없는 대전 관광지 조회와 일부만 등록된 카탈로그.
    출력: 저장 퀘스트가 있는 장소만 표시하는 결과.
    역할: 도시 전체 탐색에서도 미등록 장소를 숨기며 사용자 퀘스트를 생성하지 않는다.
    호출 예시: pytest -k citywide_hides
    """
    # 변수 의미: 거리 없이 계산한 지역 탐색 응답이다.
    response = catalog_service.get_place_recommendations("alice")
    assert [item["place"]["contentId"] for item in response["recommendations"]] == ["near"]
    assert response["recommendations"][0]["place"]["distanceMeters"] is None
    catalog_service.repository.get_or_create_user_quest_instance.assert_not_called()
    catalog_service.repository.get_or_create_reusable_quest.assert_not_called()


@pytest.mark.parametrize("citywide", [False, True])
def test_cached_places_recheck_current_catalog(catalog_service: BaselineQuestbookService, citywide: bool) -> None:
    """
    입력: 이미 캐시된 라이브 후보와 이후 비활성화된 저장 퀘스트.
    출력: 후보 캐시 적중 상태에서 빈 추천을 반환하는 결과.
    역할: 카탈로그 변경을 오래된 장소 캐시가 무시하는 회귀를 방지한다.
    호출 예시: pytest -k cached_places_recheck
    """
    # 변수 의미: 동일 조건으로 반복 실행할 추천 함수다.
    recommend = (
        lambda: catalog_service.get_place_recommendations("alice")
    ) if citywide else (
        lambda: catalog_service.get_recommendations("alice", 36.327, 127.427, "all", 5000)
    )
    assert recommend()["recommendations"]
    catalog_service.repository.get_catalog_quests.return_value = {}
    # 변수 의미: 카탈로그 제거 후 같은 장소 캐시를 사용한 결과다.
    response = recommend()
    assert response["cache"]["hit"] is True
    assert response["recommendations"] == []


@pytest.mark.parametrize("places", [[], [PLACES[1]]])
def test_live_empty_or_unmatched_returns_empty(catalog_service: BaselineQuestbookService, places: list[Any]) -> None:
    """
    입력: 비어 있거나 미등록 장소만 들어 있는 성공 응답.
    출력: 예시 데이터로 대체하지 않은 빈 추천.
    역할: 정상 빈 라이브 응답이 즉석 생성 또는 예시 관광지로 바뀌는 회귀를 방지한다.
    호출 예시: pytest -k live_empty_or_unmatched
    """
    catalog_service.tour_client.fetch_nearby.return_value = (places, "live")
    assert catalog_service.get_recommendations("alice", 36.327, 127.427, "all", 5000)["recommendations"] == []
    catalog_service.repository.get_or_create_reusable_quest.assert_not_called()
    catalog_service.repository.get_or_create_user_quest_instance.assert_not_called()


@pytest.mark.parametrize("source_status", ["fallback:not_configured", "fallback:api_error"])
def test_legacy_fallback_still_generates_demo_quests(catalog_service: BaselineQuestbookService, source_status: str) -> None:
    """
    입력: 기존 클라이언트가 반환한 예시 대체 관광지.
    출력: 기존 템플릿 생성 방식과 원천 상태를 보존한 응답.
    역할: API 실패 처리 변경 취소에 따라 예시 대체 흐름을 유지한다.
    호출 예시: pytest -k legacy_fallback
    """
    catalog_service.tour_client.fetch_nearby.return_value = ([PLACES[0]], source_status)
    # 변수 의미: 기존 예시 대체 경로로 생성한 추천 결과다.
    response = catalog_service.get_recommendations("alice", 36.327, 127.427, "all", 5000)
    assert len(response["recommendations"]) == 1
    assert response["cache"]["sourceStatus"] == source_status
    catalog_service.repository.get_catalog_quests.assert_not_called()
    assert catalog_service.repository.get_or_create_reusable_quest.call_args.args[1]["createdForUserId"] == "alice"


def test_citywide_filters_catalog_before_limit(catalog_service: BaselineQuestbookService) -> None:
    """
    입력: 이름 정렬상 앞서는 미등록 장소 35개와 뒤의 등록 장소.
    출력: 등록 장소를 누락하지 않는 지역 탐색 결과.
    역할: 카탈로그 필터보다 결과 수 제한을 먼저 적용하는 회귀를 방지한다.
    호출 예시: pytest -k filters_catalog_before_limit
    """
    catalog_service.tour_client.fetch_daejeon.return_value = (
        [replace(PLACES[0], content_id=f"unknown-{index}", title=f"가 {index:02}") for index in range(35)]
        + [replace(PLACES[0], title="힣 등록 장소")], "live",
    )
    assert [item["place"]["contentId"] for item in catalog_service.get_place_recommendations("alice")["recommendations"]] == ["near"]


@pytest.mark.parametrize("category_code,quest_type,verification_type,reward_xp", [
    ("nature", "방문형", "gps", 50), ("science", "테마형", "checklist", 80),
    ("downtown", "이동형", "gps_distance", 40), ("market", "소비형", "receipt_or_sign_photo", 60),
    ("mobility", "이동형", "gps_distance", 70), ("nightview", "활동형", "time_window_photo", 70),
])
def test_catalog_generator_keeps_template_rules_without_user(
    category_code: str, quest_type: str, verification_type: str, reward_xp: int,
) -> None:
    """
    입력: 사전 생성할 장소의 지원 카테고리.
    출력: 사용자 귀속 없이 기존 인증 유형과 보상을 보존한 저장 데이터.
    역할: 일일 생성기가 기존 카테고리 정책과 다르게 퀘스트를 만들지 않게 한다.
    호출 예시: pytest -k catalog_generator_keeps
    """
    from questbook_api.application.quest_generation import build_catalog_quest

    # 변수 의미: 새 사용자 없는 일일 생성용 장소다.
    place = replace(PLACES[0], category_code=category_code)
    # 변수 의미: 저장 전 순수 생성 함수가 반환한 퀘스트 데이터다.
    quest = build_catalog_quest(place)
    assert quest["createdForUserId"] is None
    assert quest["type"] == quest_type
    assert quest["verificationType"] == verification_type
    assert quest["rewardXp"] == reward_xp
    assert quest["placeContentId"] == "near"
    assert quest["placeName"] == "가까운 거리"
    assert "가까운 거리" in quest["title"]
    assert quest["source"] == "template"


def test_catalog_generator_skips_unsupported_category() -> None:
    """
    입력: 템플릿을 지원하지 않는 관광지 카테고리.
    출력: 생성하지 않음을 나타내는 None.
    역할: 일일 수집 장소의 알 수 없는 테마를 원도심 퀘스트로 오분류하지 않는다.
    호출 예시: pytest -k skips_unsupported
    """
    from questbook_api.application.quest_generation import build_catalog_quest

    assert build_catalog_quest(replace(PLACES[0], category_code="hotspring")) is None


def test_recommendation_preserves_accepted_terms_after_catalog_update(catalog_service: BaselineQuestbookService) -> None:
    """
    입력: 사용자가 수락한 뒤 공용 제목과 보상이 바뀐 저장 퀘스트.
    출력: 재추천에 표시되는 수락 당시 제목과 XP.
    역할: 일일 동기화가 진행 중인 퀘스트의 약속된 내용을 바꾸지 않게 한다.
    호출 예시: pytest -k preserves_accepted_terms
    """
    catalog_service.repository.get_catalog_quests.return_value = {
        "near": [{**SAVED_QUEST, "title": "바뀐 공용 제목", "reward_xp": 500}],
    }
    catalog_service.repository.get_or_create_user_quest_instance.return_value.update(
        status="accepted", quest_snapshot_json={**SAVED_QUEST, "reusable_quest_id": "saved-near"},
    )
    # 변수 의미: 공용 정의 변경 뒤 다시 받은 진행 중 퀘스트다.
    quest = catalog_service.get_recommendations("alice", 36.327, 127.427, "all", 5000)["recommendations"][0]["quest"]
    assert quest["title"] == "미리 검토한 거리 탐험"
    assert quest["rewardXp"] == 45


@pytest.mark.parametrize("cached_place", [PLACES[0], None])
def test_accept_passes_selected_place_for_snapshot(
    catalog_service: BaselineQuestbookService, cached_place: Any,
) -> None:
    """
    입력: 수락 요청과 선택 장소가 있거나 만료된 캐시.
    출력: 저장소의 수락 시점 장소 스냅샷에 전달되는 후보.
    역할: 수락 시 캐시 좌표를 보존하며 만료 때는 저장소의 추천 메타데이터를 사용하게 한다.
    호출 예시: pytest -k accept_passes_selected
    """
    # 변수 의미: 수락 전 사용자 소유가 확인된 조인 인스턴스다.
    joined = {
        **SAVED_QUEST, **catalog_service.repository.get_or_create_user_quest_instance.return_value,
        "instance_id": "instance-near", "reusable_quest_id": "saved-near",
    }
    catalog_service.repository.get_instance_with_quest.return_value = joined
    catalog_service.repository.accept_quest.return_value = {**joined, "status": "accepted"}
    catalog_service.cache.find_place_for_user = Mock(return_value=cached_place)
    assert catalog_service.accept_quest("alice", "instance-near")["status"] == "accepted"
    catalog_service.repository.accept_quest.assert_called_once_with("alice", "instance-near", place=cached_place)


def test_accepted_live_snapshot_completes_after_catalog_removal(catalog_service: BaselineQuestbookService) -> None:
    """
    입력: 카탈로그에서 제거되고 관광지 캐시도 만료된 수락 퀘스트.
    출력: 수락 당시 좌표에서 API 재조회 없이 완료한 결과.
    역할: 일일 목록 변경이 이미 수락한 라이브 퀘스트의 완료를 막지 않게 한다.
    호출 예시: pytest -k snapshot_completes_after
    """
    catalog_service.repository.get_instance_with_quest.return_value = {
        **SAVED_QUEST, "instance_id": "instance-near", "reusable_quest_id": "saved-near",
        "status": "accepted", "place_snapshot": PLACES[0].to_public_dict(), "allowed_radius_meters": 50,
    }
    catalog_service.repository.get_catalog_quests.return_value = {}
    catalog_service.repository.complete_quest.return_value = {"earnedXp": 45}
    catalog_service.cache.find_place_for_user = Mock(return_value=None)
    catalog_service.tour_client.fetch_nearby.return_value = ([], "live")
    # 변수 의미: 수락 시점 장소에서 제출한 실제 완료 응답이다.
    response = catalog_service.complete_quest("alice", "instance-near", {
        "latitude": 36.327, "longitude": 127.427, "accuracyMeters": 10,
    })
    assert response["ok"] is True
    assert response["completion"]["earnedXp"] == 45
    assert response["verification"]["distanceMeters"] == 0
    catalog_service.cache.find_place_for_user.assert_not_called()
    catalog_service.tour_client.fetch_nearby.assert_not_called()


def test_accepted_fallback_snapshot_keeps_existing_refetch(catalog_service: BaselineQuestbookService) -> None:
    """
    입력: 예시 출처의 수락 장소 스냅샷과 만료된 장소 캐시.
    출력: 기존 캐시 만료 재조회로 완료한 결과.
    역할: 라이브 스냅샷 지원이 API 실패 대체 경로를 바꾸지 않게 한다.
    호출 예시: pytest -k fallback_snapshot_keeps
    """
    catalog_service.repository.get_instance_with_quest.return_value = {
        **SAVED_QUEST, "instance_id": "instance-near", "reusable_quest_id": "saved-near",
        "status": "accepted", "place_snapshot": {**PLACES[0].to_public_dict(), "source": "fallback"},
    }
    catalog_service.repository.complete_quest.return_value = {"earnedXp": 45}
    catalog_service.cache.find_place_for_user = Mock(return_value=None)
    catalog_service.tour_client.fetch_nearby.return_value = ([PLACES[0]], "fallback:api_error")
    assert catalog_service.complete_quest("alice", "instance-near", {
        "latitude": 36.327, "longitude": 127.427, "accuracyMeters": 10,
    })["ok"] is True
    catalog_service.tour_client.fetch_nearby.assert_called_once_with(36.327, 127.427, "all", 20000)
