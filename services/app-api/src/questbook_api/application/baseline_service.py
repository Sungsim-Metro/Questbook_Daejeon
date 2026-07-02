# Questbook baseline 추천, 퀘스트 생성, 완료 유스케이스를 조합한다.
from __future__ import annotations

from datetime import timedelta
from threading import Lock
from typing import Any

from questbook_api.domain.models import QuestTemplate, TourPlaceCandidate
from questbook_api.infrastructure.cache import TourPlaceMemoryCache, utc_now
from questbook_api.infrastructure.repository import QuestbookRepository
from questbook_api.integrations.tourapi.client import TourApiClient, haversine_meters


# 변수 의미: baseline 카테고리별 템플릿 기반 퀘스트 생성 정책이다.
QUEST_TEMPLATES: dict[str, QuestTemplate] = {
    "nature": QuestTemplate("nature", "방문형", "gps", 50, "{place_name} 자연 관찰 체크인", "{place_name} 주변에서 오늘의 자연 단서를 기록하고 초록 탐험가 XP를 획득합니다."),
    "science": QuestTemplate("science", "테마형", "checklist", 80, "{place_name} 과학 탐험", "{place_name}에서 전시 키워드 하나를 수첩에 남기고 과학 탐험가 XP를 획득합니다."),
    "downtown": QuestTemplate("downtown", "이동형", "gps_distance", 40, "{place_name} 원도심 걷기", "{place_name} 주변을 걸으며 원도심 산책 기록을 완성합니다."),
    "market": QuestTemplate("market", "소비형", "receipt_or_sign_photo", 60, "{place_name} 로컬 상권 방문", "{place_name} 방문 사진 또는 영수증 인증으로 지역 상권 XP를 획득합니다."),
    "mobility": QuestTemplate("mobility", "이동형", "gps_distance", 70, "{place_name} 이동 루트", "{place_name}을 출발점으로 가까운 관광지를 연결하는 이동형 퀘스트입니다."),
    "nightview": QuestTemplate("nightview", "활동형", "time_window_photo", 70, "{place_name} 야경 기록", "{place_name}에서 저녁 시간대 전망 기록을 남깁니다."),
}


def build_region_key(latitude: float, longitude: float) -> str:
    """
    입력: 기준 위도와 경도.
    출력: 캐시용 위치 권역 키.
    역할: 너무 세밀한 좌표 차이로 캐시가 과도하게 분리되지 않게 한다.
    호출 예시: region_key = build_region_key(36.327, 127.427)
    """
    return f"{round(latitude, 2)}:{round(longitude, 2)}"


def normalize_category(category_key: str, allowed_codes: list[str]) -> str:
    """
    입력: 요청 카테고리 키와 허용 코드 목록.
    출력: 정규화된 카테고리 키.
    역할: 알 수 없는 카테고리는 전체 추천으로 처리한다.
    호출 예시: category = normalize_category(raw_category, codes)
    """
    # 변수 의미: 앞뒤 공백을 제거한 카테고리 키다.
    normalized_key = category_key.strip() if category_key else "all"
    return normalized_key if normalized_key in allowed_codes else "all"


class BaselineQuestbookService:
    """
    입력: 저장소, 캐시, TourAPI 클라이언트.
    출력: baseline API 유스케이스 서비스.
    역할: 설계서의 추천, 퀘스트 생성, 퀘스트 완료 흐름을 하나로 묶는다.
    호출 예시: service = BaselineQuestbookService(repository, cache, tour_client)
    """

    def __init__(
        self,
        repository: QuestbookRepository,
        cache: TourPlaceMemoryCache,
        tour_client: TourApiClient,
    ) -> None:
        """
        입력: 저장소, 캐시, TourAPI 클라이언트.
        출력: 없음.
        역할: baseline 서비스 의존성을 보관한다.
        호출 예시: service = BaselineQuestbookService(repository, cache, tour_client)
        """
        # 변수 의미: 관계형 저장소다.
        self.repository = repository
        # 변수 의미: 유저 단위 TourAPI 임시 캐시다.
        self.cache = cache
        # 변수 의미: TourAPI 조회 클라이언트다.
        self.tour_client = tour_client
        # 변수 의미: 사용자별 직전 추천 캐시 키다.
        self._last_query_keys: dict[str, tuple[str, str]] = {}
        # 변수 의미: 직전 추천 키 접근을 보호하는 잠금이다.
        self._last_query_lock = Lock()

    def bootstrap_user(self, user_id: str) -> dict[str, Any]:
        """
        입력: 사용자 ID.
        출력: 사용자 요약 딕셔너리.
        역할: baseline에서 인증된 기본 사용자를 준비한다.
        호출 예시: user = service.bootstrap_user(\"demo-user\")
        """
        return self.repository.ensure_user(user_id)

    def get_recommendations(
        self,
        user_id: str,
        latitude: float,
        longitude: float,
        category_key: str,
        radius_meters: int,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        """
        입력: 사용자 ID, 현재 좌표, 카테고리, 반경, 강제 새로고침 여부.
        출력: 추천 관광지와 사용자별 퀘스트 후보 응답.
        역할: TourAPI 캐시 확인, 후보 조회, 점수 계산, ReusableQuest와 UserQuestInstance 생성을 수행한다.
        호출 예시: payload = service.get_recommendations(\"demo-user\", 36.327, 127.427, \"nature\", 5000, False)
        """
        self.repository.ensure_user(user_id)
        # 변수 의미: 허용되는 내부 카테고리 코드 목록이다.
        allowed_codes = self.repository.get_category_codes()
        # 변수 의미: 정규화된 카테고리 키다.
        normalized_category = normalize_category(category_key, allowed_codes)
        # 변수 의미: 캐시 권역 키다.
        region_key = build_region_key(latitude, longitude)
        if force_refresh:
            self.cache.invalidate_for_user(user_id)
        self._invalidate_if_query_changed(user_id, region_key, normalized_category)
        # 변수 의미: 캐시 조회 결과다.
        cached_entry = self.cache.get(user_id, region_key, normalized_category)
        if cached_entry is None:
            # 변수 의미: TourAPI 또는 fallback에서 조회한 장소 후보 목록과 원천 상태다.
            places, source_status = self.tour_client.fetch_nearby(latitude, longitude, normalized_category, radius_meters)
            # 변수 의미: 새로 저장한 캐시 엔트리다.
            cache_entry = self.cache.set(user_id, region_key, normalized_category, places, source_status)
            # 변수 의미: 캐시 적중 여부다.
            cache_hit = False
        else:
            cache_entry = cached_entry
            cache_hit = True

        # 변수 의미: 현재 사용자 요약과 선호도다.
        user = self.repository.get_user(user_id)
        # 변수 의미: 사용자의 선호 카테고리 목록이다.
        preferred_categories = set(user["preference"]["categories"])
        # 변수 의미: 추천 점수에 사용할 완료 이력과 뱃지 진행도다.
        recommendation_profile = self.repository.get_recommendation_profile(user_id)
        # 변수 의미: 추천 결과 목록이다.
        recommendations: list[dict[str, Any]] = []
        for place in cache_entry.places:
            # 변수 의미: 해당 장소에 적용할 퀘스트 템플릿이다.
            template = QUEST_TEMPLATES.get(place.category_code, QUEST_TEMPLATES["downtown"])
            # 변수 의미: 공용 퀘스트 생성 또는 재사용에 필요한 데이터다.
            quest_data = self._build_quest_data(user_id, place, template)
            # 변수 의미: 공용 재사용 퀘스트다.
            reusable_quest = self.repository.get_or_create_reusable_quest(user_id, quest_data)
            # 변수 의미: 추천 만료 시각이다.
            expires_at = (utc_now() + timedelta(hours=4)).isoformat()
            # 변수 의미: 사용자별 퀘스트 인스턴스다.
            instance = self.repository.get_or_create_user_quest_instance(user_id, reusable_quest["id"], expires_at)
            # 변수 의미: 추천 점수다.
            score = self._score_place(place, preferred_categories, recommendation_profile)
            recommendations.append(
                {
                    "score": score,
                    "place": place.to_public_dict(),
                    "quest": self._quest_payload(reusable_quest, instance),
                }
            )

        recommendations.sort(key=lambda item: item["score"], reverse=True)
        return {
            "userId": user_id,
            "regionKey": region_key,
            "categoryKey": normalized_category,
            "cache": {
                "hit": cache_hit,
                "sourceStatus": cache_entry.source_status,
                "fetchedAt": cache_entry.fetched_at.isoformat(),
                "expiresAt": cache_entry.expires_at.isoformat(),
                "ttlSeconds": self.cache.default_ttl_seconds,
            },
            "recommendations": recommendations,
            "attribution": "관광정보 제공: 한국관광공사(TourAPI)",
        }

    def _invalidate_if_query_changed(self, user_id: str, region_key: str, category_key: str) -> None:
        """
        입력: 사용자 ID, 새 권역 키, 새 카테고리 키.
        출력: 없음.
        역할: 사용자가 지역 또는 카테고리를 바꾸면 기존 TourAPI 임시 캐시를 폐기한다.
        호출 예시: self._invalidate_if_query_changed(user_id, region_key, category_key)
        """
        # 변수 의미: 현재 요청의 캐시 기준 키다.
        current_key = (region_key, category_key)
        with self._last_query_lock:
            # 변수 의미: 같은 사용자의 직전 요청 키다.
            previous_key = self._last_query_keys.get(user_id)
            if previous_key is not None and previous_key != current_key:
                self.cache.invalidate_for_user(user_id)
            self._last_query_keys[user_id] = current_key

    def accept_quest(self, user_id: str, instance_id: str) -> dict[str, Any]:
        """
        입력: 사용자 ID와 사용자별 퀘스트 인스턴스 ID.
        출력: 수락된 퀘스트 응답.
        역할: 추천 퀘스트를 사용자가 수행하기로 선택한 상태로 바꾼다.
        호출 예시: result = service.accept_quest(\"demo-user\", instance_id)
        """
        self.repository.ensure_user(user_id)
        # 변수 의미: 갱신된 인스턴스와 퀘스트 정보다.
        instance = self.repository.accept_quest(user_id, instance_id)
        return {"quest": self._quest_payload_from_joined(instance), "status": "accepted"}

    def complete_quest(self, user_id: str, instance_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """
        입력: 사용자 ID, 사용자별 퀘스트 인스턴스 ID, 인증 요청 페이로드.
        출력: 완료 성공 또는 실패 응답.
        역할: GPS와 시간 조건을 검증한 뒤 완료 트랜잭션을 수행한다.
        호출 예시: result = service.complete_quest(\"demo-user\", instance_id, {\"latitude\": 36.3671, \"longitude\": 127.3882})
        """
        self.repository.ensure_user(user_id)
        # 변수 의미: 인스턴스와 공용 퀘스트 조인 정보다.
        instance = self.repository.get_instance_with_quest(user_id, instance_id)
        if instance is None:
            return {"ok": False, "reason": "quest_not_found", "retryable": False}
        if instance["status"] == "completed":
            return {"ok": False, "reason": "already_completed", "retryable": False}

        # 변수 의미: 인증 결과와 측정 거리 km다.
        verification_result, distance_km = self._verify_completion(user_id, instance, payload)
        if verification_result["decision"] != "approved":
            return {"ok": False, "verification": verification_result, "retryable": True}

        # 변수 의미: 완료 트랜잭션 결과다.
        completion = self.repository.complete_quest(user_id, instance, verification_result, distance_km)
        if completion is None:
            return {"ok": False, "reason": "already_completed", "retryable": False}
        return {"ok": True, "verification": verification_result, "completion": completion}

    def _build_quest_data(
        self,
        user_id: str,
        place: TourPlaceCandidate,
        template: QuestTemplate,
    ) -> dict[str, Any]:
        """
        입력: 사용자 ID, 장소 후보, 퀘스트 템플릿.
        출력: 공용 퀘스트 저장용 데이터.
        역할: 장소명과 카테고리를 템플릿에 삽입해 baseline 퀘스트를 만든다.
        호출 예시: data = self._build_quest_data(user_id, place, template)
        """
        return {
            "title": template.title_template.format(place_name=place.title),
            "description": template.description_template.format(place_name=place.title),
            "type": template.quest_type,
            "categoryCode": template.category_code,
            "rewardXp": template.reward_xp,
            "verificationType": template.verification_type,
            "placeContentId": place.content_id,
            "placeName": place.title,
            "source": "template",
            "createdForUserId": user_id,
        }

    def _score_place(
        self,
        place: TourPlaceCandidate,
        preferred_categories: set[str],
        recommendation_profile: dict[str, Any],
    ) -> int:
        """
        입력: 장소 후보, 사용자 선호 카테고리 집합, 완료 및 뱃지 진행 프로필.
        출력: 추천 점수 정수.
        역할: 거리, 선호도, 완료 이력, 미획득 뱃지, 시간대 조건을 반영한 규칙 기반 점수를 계산한다.
        호출 예시: score = self._score_place(place, {\"nature\"}, profile)
        """
        # 변수 의미: 거리 기반 점수다.
        distance_score = 40 if place.distance_meters is None else max(0, 60 - int(place.distance_meters // 100))
        # 변수 의미: 선호 카테고리 보너스다.
        preference_bonus = 25 if place.category_code in preferred_categories else 5
        # 변수 의미: 카테고리별 완료 횟수다.
        completion_counts = recommendation_profile.get("completionCounts", {})
        # 변수 의미: 같은 카테고리 반복을 줄이기 위한 패널티다.
        completion_penalty = min(20, int(completion_counts.get(place.category_code, 0)) * 5)
        # 변수 의미: 다음 미획득 뱃지까지 남은 XP 정보다.
        next_badge_remaining_xp = recommendation_profile.get("nextBadgeRemainingXp", {})
        # 변수 의미: 곧 획득 가능한 뱃지에 주는 보너스다.
        badge_bonus = 20 if next_badge_remaining_xp.get(place.category_code, 9999) <= 80 else 8
        # 변수 의미: 한국 시간 기준 현재 시각이다.
        korea_hour = (utc_now().hour + 9) % 24
        # 변수 의미: 시간대 조건 보너스다.
        time_bonus = 12 if place.category_code == "nightview" and korea_hour >= 18 else 0
        # 변수 의미: fallback이나 live 모두 같은 구조로 사용하기 위한 기본 보너스다.
        availability_bonus = 10
        return max(0, distance_score + preference_bonus + badge_bonus + time_bonus + availability_bonus - completion_penalty)

    def _verify_completion(
        self,
        user_id: str,
        instance: dict[str, Any],
        payload: dict[str, Any],
    ) -> tuple[dict[str, Any], float]:
        """
        입력: 사용자 ID, 퀘스트 인스턴스, 인증 요청 페이로드.
        출력: 인증 결과와 이동 거리 km.
        역할: baseline GPS 정확도와 반경 조건을 확인한다.
        호출 예시: verification, distance_km = self._verify_completion(user_id, instance, payload)
        """
        try:
            # 변수 의미: 클라이언트가 제출한 위도다.
            latitude = float(payload.get("latitude"))
            # 변수 의미: 클라이언트가 제출한 경도다.
            longitude = float(payload.get("longitude"))
        except (TypeError, ValueError):
            return {"method": instance["verification_type"], "decision": "rejected", "reason": "invalid_location"}, 0.0

        # 변수 의미: 브라우저 위치 정확도 미터 값이다.
        accuracy_meters = float(payload.get("accuracyMeters", payload.get("accuracy", 999)))
        if accuracy_meters > 80:
            return {
                "method": instance["verification_type"],
                "decision": "needs_review",
                "reason": "low_gps_accuracy",
                "accuracyMeters": accuracy_meters,
            }, 0.0

        # 변수 의미: 캐시에서 찾은 장소 후보 좌표다.
        place = self.cache.find_place_for_user(user_id, instance["place_content_id"])
        if place is None:
            # 변수 의미: 캐시 만료 후 라이브 재조회로 복구한 장소 후보다.
            place = self._refetch_place_for_completion(user_id, instance, latitude, longitude)
        if place is None:
            return {"method": instance["verification_type"], "decision": "needs_review", "reason": "place_cache_missing"}, 0.0

        # 변수 의미: 제출 좌표와 장소 좌표 사이 거리다.
        distance_meters = haversine_meters(latitude, longitude, place.latitude, place.longitude)
        # 변수 의미: 방문형 baseline 인증 반경이다.
        allowed_radius_meters = 50
        if distance_meters > allowed_radius_meters:
            return {
                "method": instance["verification_type"],
                "decision": "rejected",
                "reason": "outside_radius",
                "distanceMeters": round(distance_meters, 1),
                "allowedRadiusMeters": allowed_radius_meters,
                "accuracyMeters": accuracy_meters,
            }, round(distance_meters / 1000, 3)

        # 변수 의미: 퀘스트 인증 방식이다.
        verification_type = str(instance["verification_type"])
        if verification_type == "receipt_or_sign_photo":
            # 변수 의미: 소비형 인증 사진 첨부 여부다.
            photo_attached = bool(payload.get("photoAttached"))
            # 변수 의미: OCR 또는 사용자가 확인한 상호명 텍스트다.
            ocr_text = str(payload.get("ocrText") or payload.get("storeName") or "")
            if not photo_attached:
                return {
                    "method": verification_type,
                    "decision": "needs_review",
                    "reason": "photo_required",
                    "distanceMeters": round(distance_meters, 1),
                }, round(distance_meters / 1000, 3)
            if not self._is_store_name_match(instance["place_name"], ocr_text):
                return {
                    "method": verification_type,
                    "decision": "needs_review",
                    "reason": "store_name_not_matched",
                    "ocrMatchedStore": False,
                    "distanceMeters": round(distance_meters, 1),
                }, round(distance_meters / 1000, 3)
            return {
                "method": verification_type,
                "decision": "approved",
                "ocrMatchedStore": True,
                "matchScore": 1.0,
                "distanceMeters": round(distance_meters, 1),
                "allowedRadiusMeters": allowed_radius_meters,
                "accuracyMeters": accuracy_meters,
            }, round(distance_meters / 1000, 3)

        if verification_type == "time_window_photo" and not bool(payload.get("photoAttached")):
            return {
                "method": verification_type,
                "decision": "needs_review",
                "reason": "photo_required",
                "distanceMeters": round(distance_meters, 1),
            }, round(distance_meters / 1000, 3)

        if verification_type == "checklist" and not bool(payload.get("checklistComplete", True)):
            return {
                "method": verification_type,
                "decision": "rejected",
                "reason": "checklist_incomplete",
                "distanceMeters": round(distance_meters, 1),
            }, round(distance_meters / 1000, 3)

        return {
            "method": instance["verification_type"],
            "decision": "approved",
            "distanceMeters": round(distance_meters, 1),
            "allowedRadiusMeters": allowed_radius_meters,
            "accuracyMeters": accuracy_meters,
        }, round(distance_meters / 1000, 3)

    def _refetch_place_for_completion(
        self,
        user_id: str,
        instance: dict[str, Any],
        latitude: float,
        longitude: float,
    ) -> TourPlaceCandidate | None:
        """
        입력: 사용자 ID, 퀘스트 인스턴스, 제출 좌표.
        출력: 라이브 재조회로 찾은 장소 후보 또는 None.
        역할: 30분 캐시가 만료돼도 설계서 §6.1의 라이브 재조회로 완료 인증 좌표를 복구한다.
        호출 예시: place = self._refetch_place_for_completion(user_id, instance, 36.3671, 127.3882)
        """
        # 변수 의미: 제출 좌표 주변에서 라이브 재조회한 장소 후보 목록과 원천 상태다.
        places, source_status = self.tour_client.fetch_nearby(latitude, longitude, "all", 20000)
        # 변수 의미: 퀘스트가 참조하는 contentId와 일치하는 장소 후보다.
        matched_place = next((place for place in places if place.content_id == instance["place_content_id"]), None)
        if matched_place is None:
            return None
        self.cache.set(user_id, build_region_key(latitude, longitude), "all", places, source_status)
        return matched_place

    def _is_store_name_match(self, expected_name: str, ocr_text: str) -> bool:
        """
        입력: 기대 장소명과 OCR 또는 상호명 텍스트.
        출력: 상호명이 충분히 일치하는지 여부.
        역할: 소비형 baseline에서 금액·카드번호 없이 상호명만 대조한다.
        호출 예시: matched = self._is_store_name_match(\"성심당 본점\", \"성심당\")
        """
        # 변수 의미: 공백과 기호를 제거한 기대 장소명이다.
        normalized_expected = "".join(ch for ch in expected_name.lower() if ch.isalnum())
        # 변수 의미: 공백과 기호를 제거한 OCR 텍스트다.
        normalized_ocr = "".join(ch for ch in ocr_text.lower() if ch.isalnum())
        if not normalized_expected or not normalized_ocr:
            return False
        return normalized_expected in normalized_ocr or normalized_ocr in normalized_expected

    def _quest_payload(self, reusable_quest: dict[str, Any], instance: dict[str, Any]) -> dict[str, Any]:
        """
        입력: 공용 퀘스트 row와 사용자별 인스턴스 row.
        출력: 공개 API용 퀘스트 딕셔너리.
        역할: DB 컬럼명을 프론트엔드 계약에 맞게 변환한다.
        호출 예시: payload = self._quest_payload(quest, instance)
        """
        return {
            "instanceId": instance["id"],
            "reusableQuestId": reusable_quest["id"],
            "title": reusable_quest["title"],
            "description": reusable_quest["description"],
            "type": reusable_quest["type"],
            "categoryCode": reusable_quest["category_code"],
            "rewardXp": reusable_quest["reward_xp"],
            "verificationType": reusable_quest["verification_type"],
            "placeReference": {
                "contentId": reusable_quest["place_content_id"],
                "placeName": reusable_quest["place_name"],
            },
            "status": instance["status"],
            "recommendedAt": instance["recommended_at"],
            "acceptedAt": instance["accepted_at"],
            "expiresAt": instance["expires_at"],
            "completedAt": instance["completed_at"],
            "source": reusable_quest["source"],
            "reviewStatus": reusable_quest["review_status"],
        }

    def _quest_payload_from_joined(self, instance: dict[str, Any]) -> dict[str, Any]:
        """
        입력: 인스턴스와 공용 퀘스트가 조인된 row 딕셔너리.
        출력: 공개 API용 퀘스트 딕셔너리.
        역할: 수락과 완료 조회 결과를 추천 API와 같은 형태로 맞춘다.
        호출 예시: payload = self._quest_payload_from_joined(instance)
        """
        return {
            "instanceId": instance["instance_id"],
            "reusableQuestId": instance["reusable_quest_id"],
            "title": instance["title"],
            "description": instance["description"],
            "type": instance["type"],
            "categoryCode": instance["category_code"],
            "rewardXp": instance["reward_xp"],
            "verificationType": instance["verification_type"],
            "placeReference": {
                "contentId": instance["place_content_id"],
                "placeName": instance["place_name"],
            },
            "status": instance["status"],
            "recommendedAt": instance["recommended_at"],
            "acceptedAt": instance["accepted_at"],
            "expiresAt": instance["expires_at"],
            "completedAt": instance["completed_at"],
            "source": instance["source"],
        }
