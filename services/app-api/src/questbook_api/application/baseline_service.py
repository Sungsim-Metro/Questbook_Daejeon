# Questbook baseline 추천, 퀘스트 생성, 완료 유스케이스를 조합한다.
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
from threading import Lock
from typing import Any

from questbook_api.domain.models import QuestTemplate, TourPlaceCandidate
from questbook_api.infrastructure.cache import TourPlaceRedisCache, utc_now
from questbook_api.infrastructure.repository import QuestbookRepository
from questbook_api.integrations.object_storage.client import sanitize_object_key_token
from questbook_api.integrations.tourapi.client import TourApiClient, haversine_meters


# 변수 의미: 영수증 시간 비교와 표시에서 사용할 한국 시간대다.
KOREA_TIMEZONE = timezone(timedelta(hours=9))
# 변수 의미: 영수증 OCR에서 날짜 흔적을 찾기 위한 정규식이다.
RECEIPT_DATE_PATTERN = re.compile(r"(20\d{2})[.\-/년\s]*(0?[1-9]|1[0-2])[.\-/월\s]*(0?[1-9]|[12]\d|3[01])")
# 변수 의미: 영수증 OCR에서 시각 흔적을 찾기 위한 정규식이다.
RECEIPT_TIME_PATTERN = re.compile(r"\b([01]?\d|2[0-3])[:시]\s*([0-5]\d)\b")
# 변수 의미: 퀘스트 제목에서 구매 품목을 추출하기 위한 정규식 목록이다.
RECEIPT_ITEM_PATTERNS = [
    re.compile(r"(?:가서|에서)\s*([가-힣A-Za-z0-9 +#&().\-]{1,40}?)(?:을|를)?\s*(?:사먹기|먹기|구매|구입|사기|결제)"),
    re.compile(r"([가-힣A-Za-z0-9 +#&().\-]{1,40}?)(?:을|를)\s*(?:사먹기|먹기|구매|구입|사기|결제)"),
]
# 변수 의미: 품목 추출 후 제거할 일반 안내 단어다.
GENERIC_ITEM_WORDS = {
    "방문",
    "사진",
    "영수증",
    "인증",
    "퀘스트",
    "대표",
    "메뉴",
    "상권",
    "로컬",
}

# 변수 의미: baseline 카테고리별 템플릿 기반 퀘스트 생성 정책이다.
QUEST_TEMPLATES: dict[str, QuestTemplate] = {
    "nature": QuestTemplate("nature", "방문형", "gps", 50, "{place_name} 자연 관찰 체크인", "{place_name} 주변에서 오늘의 자연 단서를 기록하고 초록 탐험가 XP를 획득합니다."),
    "science": QuestTemplate("science", "테마형", "checklist", 80, "{place_name} 과학 탐험", "{place_name}에서 전시 키워드 하나를 수첩에 남기고 과학 탐험가 XP를 획득합니다."),
    "downtown": QuestTemplate("downtown", "이동형", "gps_distance", 40, "{place_name} 원도심 걷기", "{place_name} 주변을 걸으며 원도심 산책 기록을 완성합니다."),
    "market": QuestTemplate("market", "소비형", "receipt_or_sign_photo", 60, "{place_name} 로컬 상권 방문", "{place_name} 방문 사진 또는 영수증 인증으로 지역 상권 XP를 획득합니다."),
    "mobility": QuestTemplate("mobility", "이동형", "gps_distance", 70, "{place_name} 이동 루트", "{place_name}을 출발점으로 가까운 관광지를 연결하는 이동형 퀘스트입니다."),
    "nightview": QuestTemplate("nightview", "활동형", "time_window_photo", 70, "{place_name} 야경 기록", "{place_name}에서 저녁 시간대 전망 기록을 남깁니다."),
}


def normalize_match_text(value: str) -> str:
    """
    입력: OCR 또는 퀘스트 비교 대상 문자열.
    출력: 공백과 기호를 제거한 비교용 문자열.
    역할: 영수증 OCR의 띄어쓰기 차이를 줄이고 장소·품목 포함 여부를 확인한다.
    호출 예시: normalized = normalize_match_text("튀김 소보로")
    """
    return "".join(character for character in value.lower() if character.isalnum())


def is_text_match(expected_value: str, actual_text: str) -> bool:
    """
    입력: 기대 문자열과 OCR 전체 텍스트.
    출력: 두 문자열이 포함 관계로 일치하는지 여부.
    역할: 장소명과 품목명을 같은 규칙으로 비교한다.
    호출 예시: matched = is_text_match("성심당", receipt_text)
    """
    # 변수 의미: 비교용 기대 문자열이다.
    normalized_expected = normalize_match_text(expected_value)
    # 변수 의미: 비교용 OCR 문자열이다.
    normalized_actual = normalize_match_text(actual_text)
    if not normalized_expected or not normalized_actual:
        return False
    return normalized_expected in normalized_actual or normalized_actual in normalized_expected


def extract_required_receipt_items(quest_title: str, quest_description: str, place_name: str) -> list[str]:
    """
    입력: 퀘스트 제목, 설명, 장소명.
    출력: 영수증에서 확인할 품목 후보 목록.
    역할: "성심당에 가서 튀김 소보로 사먹기" 같은 소비형 퀘스트에서 요구 품목을 추출한다.
    호출 예시: items = extract_required_receipt_items("성심당에 가서 튀김 소보로 사먹기", "", "성심당")
    """
    # 변수 의미: 품목 추출에 사용할 퀘스트 문장 후보 목록이다.
    sources = [quest_title, quest_description]
    # 변수 의미: 중복 제거 전 품목 후보 목록이다.
    candidates: list[str] = []
    for source in sources:
        for pattern in RECEIPT_ITEM_PATTERNS:
            # 변수 의미: 현재 패턴으로 찾은 품목 후보들이다.
            matches = pattern.findall(source or "")
            candidates.extend(matches)

    # 변수 의미: 정규화된 중복 제거용 집합이다.
    seen: set[str] = set()
    # 변수 의미: 최종 품목 목록이다.
    required_items: list[str] = []
    for candidate in candidates:
        # 변수 의미: 장소명과 안내 단어를 제거한 품목 후보 문자열이다.
        cleaned = candidate.replace(place_name, " ").strip(" .,-_()")
        for word in GENERIC_ITEM_WORDS:
            cleaned = cleaned.replace(word, " ")
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        # 변수 의미: 중복 비교용 품목 토큰이다.
        normalized = normalize_match_text(cleaned)
        if not cleaned or len(normalized) < 2 or normalized in seen:
            continue
        seen.add(normalized)
        required_items.append(cleaned)
    return required_items


def has_receipt_time_text(ocr_text: str) -> bool:
    """
    입력: OCR 전체 텍스트.
    출력: 날짜 또는 시각 정보가 보이는지 여부.
    역할: 영수증에 구매 시각을 확인할 단서가 있는지 판단한다.
    호출 예시: has_time = has_receipt_time_text("2026.07.10 13:20 튀김소보로")
    """
    return bool(RECEIPT_DATE_PATTERN.search(ocr_text) or RECEIPT_TIME_PATTERN.search(ocr_text))


def evaluate_quest_receipt_requirements(
    expected_place_name: str,
    quest_title: str,
    quest_description: str,
    ocr_text: str,
    submitted_at: datetime | None = None,
    required_items: list[str] | None = None,
) -> dict[str, Any]:
    """
    입력: 기대 장소명, 퀘스트 제목과 설명, OCR 텍스트, 선택적 제출 시각과 요구 품목.
    출력: 장소명, 품목, 시간 확인 결과.
    역할: OCR 결과 문자가 소비형 퀘스트 요구사항과 맞는지 보조 검증한다.
    호출 예시: result = evaluate_quest_receipt_requirements("성심당", "성심당에 가서 튀김 소보로 사먹기", "", text)
    """
    # 변수 의미: 검증 기준 시각이다.
    verification_time = submitted_at or datetime.now(KOREA_TIMEZONE)
    # 변수 의미: 명시 품목이 없을 때 퀘스트 문구에서 추출한 품목 목록이다.
    item_requirements = required_items or extract_required_receipt_items(quest_title, quest_description, expected_place_name)
    # 변수 의미: OCR에서 확인된 품목 목록이다.
    matched_items = [item for item in item_requirements if is_text_match(item, ocr_text)]
    # 변수 의미: OCR에서 확인되지 않은 품목 목록이다.
    missing_items = [item for item in item_requirements if item not in matched_items]
    # 변수 의미: 상호명 일치 여부다.
    store_name_matched = is_text_match(expected_place_name, ocr_text)
    # 변수 의미: 시간 정보 존재 여부다.
    receipt_time_present = has_receipt_time_text(ocr_text)
    # 변수 의미: 품목 조건 통과 여부다.
    item_matched = not item_requirements or not missing_items
    # 변수 의미: 세부 검증 결과 목록이다.
    checks = [
        {
            "name": "store_name_match",
            "passed": store_name_matched,
            "reason": "" if store_name_matched else "store_name_not_matched",
            "expectedPlaceName": expected_place_name,
        },
        {
            "name": "required_item_match",
            "passed": item_matched,
            "reason": "" if item_matched else "required_item_not_matched",
            "requiredItems": item_requirements,
            "matchedItems": matched_items,
            "missingItems": missing_items,
        },
        {
            "name": "receipt_time_present",
            "passed": receipt_time_present,
            "reason": "" if receipt_time_present else "receipt_time_missing",
            "checkedAt": verification_time.isoformat(),
        },
    ]
    # 변수 의미: 통과한 세부 검증 수다.
    passed_count = sum(1 for check in checks if check["passed"])
    return {
        "passed": all(check["passed"] for check in checks),
        "matchScore": round(passed_count / len(checks), 3),
        "expectedPlaceName": expected_place_name,
        "requiredItems": item_requirements,
        "matchedItems": matched_items,
        "missingItems": missing_items,
        "checks": checks,
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
        cache: TourPlaceRedisCache,
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

        # 변수 의미: Object Storage에 저장된 사진 증빙 객체 키다.
        photo_ref = self._normalize_photo_ref(user_id, payload)
        # 변수 의미: 완료 트랜잭션 결과다.
        completion = self.repository.complete_quest(user_id, instance, verification_result, distance_km, photo_ref)
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

        try:
            # 변수 의미: 브라우저 위치 정확도 미터 값이다.
            accuracy_meters = float(payload.get("accuracyMeters", payload.get("accuracy", 999)))
        except (TypeError, ValueError):
            accuracy_meters = 999.0
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
        # 변수 의미: 임시 GPS-only 판정에서 완료를 막지 않는 보조 인증 결과 목록이다.
        optional_checks: list[dict[str, Any]] = []
        if verification_type == "receipt_or_sign_photo":
            # 변수 의미: 소비형 인증 사진 첨부 여부다.
            photo_attached = bool(payload.get("photoAttached") or payload.get("photoRef") or payload.get("objectKey"))
            # 변수 의미: OCR 또는 사용자가 확인한 상호명 텍스트다.
            ocr_text = str(payload.get("ocrText") or payload.get("storeName") or "")
            # 변수 의미: OCR 텍스트와 소비형 퀘스트 요구사항의 보조 검증 결과다.
            receipt_requirement_check = evaluate_quest_receipt_requirements(
                instance["place_name"],
                instance["title"],
                instance["description"],
                ocr_text,
            )
            # 변수 의미: OCR 또는 상호명이 기대 장소명과 일치하는지 여부다.
            ocr_matched_store = self._is_store_name_match(instance["place_name"], ocr_text)
            optional_checks.append(
                {
                    "name": "photo_attached",
                    "passed": photo_attached,
                    "reason": "" if photo_attached else "photo_required",
                    "ignoredForDecision": True,
                }
            )
            optional_checks.append(
                {
                    "name": "store_name_match",
                    "passed": ocr_matched_store,
                    "reason": "" if ocr_matched_store else "store_name_not_matched",
                    "ocrMatchedStore": ocr_matched_store,
                    "matchScore": 1.0 if ocr_matched_store else 0.0,
                    "ignoredForDecision": True,
                }
            )
            optional_checks.append(
                {
                    "name": "receipt_requirement_match",
                    "passed": receipt_requirement_check["passed"],
                    "reason": "" if receipt_requirement_check["passed"] else "receipt_requirement_not_matched",
                    "matchScore": receipt_requirement_check["matchScore"],
                    "requiredItems": receipt_requirement_check["requiredItems"],
                    "matchedItems": receipt_requirement_check["matchedItems"],
                    "missingItems": receipt_requirement_check["missingItems"],
                    "checks": receipt_requirement_check["checks"],
                    "ignoredForDecision": True,
                }
            )

        if verification_type == "time_window_photo":
            # 변수 의미: 활동형 시간대 사진 첨부 여부다.
            photo_attached = bool(payload.get("photoAttached"))
            optional_checks.append(
                {
                    "name": "photo_attached",
                    "passed": photo_attached,
                    "reason": "" if photo_attached else "photo_required",
                    "ignoredForDecision": True,
                }
            )

        if verification_type == "checklist":
            # 변수 의미: 사용자가 제출한 체크리스트 완료 여부다.
            checklist_complete = bool(payload.get("checklistComplete", True))
            optional_checks.append(
                {
                    "name": "checklist_complete",
                    "passed": checklist_complete,
                    "reason": "" if checklist_complete else "checklist_incomplete",
                    "ignoredForDecision": True,
                }
            )

        # 변수 의미: 임시 GPS-only 완료 승인 결과다.
        verification_result: dict[str, Any] = {
            "method": instance["verification_type"],
            "decision": "approved",
            "decisionBasis": "gps_only_temporary",
            "distanceMeters": round(distance_meters, 1),
            "allowedRadiusMeters": allowed_radius_meters,
            "accuracyMeters": accuracy_meters,
        }
        if optional_checks:
            verification_result["optionalChecks"] = optional_checks
        return verification_result, round(distance_meters / 1000, 3)

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
        return is_text_match(expected_name, ocr_text)

    def evaluate_receipt_ocr(
        self,
        user_id: str,
        instance_id: str,
        ocr_text: str,
    ) -> dict[str, Any]:
        """
        입력: 사용자 ID, 사용자별 퀘스트 인스턴스 ID, OCR 텍스트.
        출력: OCR 텍스트와 퀘스트 요구사항의 보조 검증 결과.
        역할: 사진 업로드 후 완료 판정과 분리해 영수증 상호명·품목·시간을 확인한다.
        호출 예시: result = service.evaluate_receipt_ocr("demo-user", "uqi_x", text)
        """
        # 변수 의미: 인스턴스와 공용 퀘스트 조인 정보다.
        instance = self.repository.get_instance_with_quest(user_id, instance_id)
        if instance is None:
            return {"ok": False, "reason": "quest_not_found", "retryable": False}
        # 변수 의미: OCR 요구사항 보조 검증 결과다.
        requirement_check = evaluate_quest_receipt_requirements(
            instance["place_name"],
            instance["title"],
            instance["description"],
            ocr_text,
        )
        return {
            "ok": True,
            "quest": self._quest_payload_from_joined(instance),
            "requirementCheck": requirement_check,
        }

    def _normalize_photo_ref(self, user_id: str, payload: dict[str, Any]) -> str | None:
        """
        입력: 사용자 ID와 완료 인증 요청 페이로드.
        출력: 현재 사용자 prefix에 속한 Object Storage 객체 키 또는 None.
        역할: 완료 기록에 저장할 사진 참조가 다른 사용자 경로를 가리키지 않게 한다.
        호출 예시: photo_ref = self._normalize_photo_ref("usr_x", {"photoRef": "users/usr_x/..."})
        """
        # 변수 의미: 클라이언트가 제출한 사진 객체 키 후보 값이다.
        raw_photo_ref = str(payload.get("photoRef") or payload.get("objectKey") or "").strip()
        if not raw_photo_ref:
            return None

        # 변수 의미: 현재 사용자에게 허용된 Object Storage 객체 키 prefix다.
        allowed_prefix = f"users/{sanitize_object_key_token(user_id, 'user')}/"
        if raw_photo_ref.startswith("/") or "/../" in f"/{raw_photo_ref}/":
            raise ValueError("Invalid photoRef.")
        if not raw_photo_ref.startswith(allowed_prefix):
            raise ValueError("photoRef is outside the current user prefix.")
        return raw_photo_ref

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
