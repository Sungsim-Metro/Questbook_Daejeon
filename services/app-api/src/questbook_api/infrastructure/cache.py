# Questbook TourAPI 유저 단위 인메모리 임시 캐시를 제공한다.
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import Lock

from questbook_api.domain.models import CacheEntry, TourPlaceCandidate


def utc_now() -> datetime:
    """
    입력: 없음.
    출력: UTC 기준 현재 시각.
    역할: 캐시 만료와 저장 시각 계산을 일관되게 만든다.
    호출 예시: current_time = utc_now()
    """
    return datetime.now(timezone.utc)


class TourPlaceMemoryCache:
    """
    입력: 기본 TTL 초 단위 값.
    출력: 사용자, 권역, 카테고리 기준의 임시 캐시 저장소.
    역할: OpenAPI 최소 필드를 DB가 아니라 앱 서버 메모리에만 30분 보관한다.
    호출 예시: cache = TourPlaceMemoryCache(default_ttl_seconds=1800)
    """

    def __init__(self, default_ttl_seconds: int) -> None:
        """
        입력: 기본 캐시 TTL 초 단위 값.
        출력: 없음.
        역할: 내부 캐시 딕셔너리와 잠금을 초기화한다.
        호출 예시: cache = TourPlaceMemoryCache(1800)
        """
        # 변수 의미: 기본 캐시 TTL 초 단위 값이다.
        self.default_ttl_seconds = default_ttl_seconds
        # 변수 의미: 캐시 키에서 CacheEntry로 이어지는 인메모리 저장소다.
        self._entries: dict[tuple[str, str, str], CacheEntry] = {}
        # 변수 의미: 여러 요청이 동시에 캐시에 접근할 때 사용하는 잠금이다.
        self._lock = Lock()

    def get(self, user_id: str, region_key: str, category_key: str) -> CacheEntry | None:
        """
        입력: 사용자 ID, 위치 권역 키, 카테고리 키.
        출력: 유효한 캐시 엔트리 또는 None.
        역할: 만료된 캐시는 즉시 제거하고 유효한 캐시만 반환한다.
        호출 예시: entry = cache.get(user_id, region_key, category_key)
        """
        # 변수 의미: 캐시 조회 키다.
        cache_key = (user_id, region_key, category_key)
        with self._lock:
            # 변수 의미: 현재 키에 연결된 캐시 엔트리다.
            entry = self._entries.get(cache_key)
            if entry is None:
                return None
            if entry.expires_at <= utc_now():
                self._entries.pop(cache_key, None)
                return None
            return entry

    def set(
        self,
        user_id: str,
        region_key: str,
        category_key: str,
        places: list[TourPlaceCandidate],
        source_status: str,
    ) -> CacheEntry:
        """
        입력: 사용자 ID, 권역 키, 카테고리 키, 장소 후보, 원천 상태.
        출력: 저장된 캐시 엔트리.
        역할: TourAPI 최소 필드를 기본 TTL 동안 인메모리에 저장한다.
        호출 예시: entry = cache.set(user_id, region_key, category_key, places, "fallback")
        """
        # 변수 의미: 캐시 저장 시각이다.
        fetched_at = utc_now()
        # 변수 의미: 캐시 만료 시각이다.
        expires_at = fetched_at + timedelta(seconds=self.default_ttl_seconds)
        # 변수 의미: 새 캐시 엔트리다.
        entry = CacheEntry(places=places, fetched_at=fetched_at, expires_at=expires_at, source_status=source_status)
        # 변수 의미: 캐시 저장 키다.
        cache_key = (user_id, region_key, category_key)
        with self._lock:
            self._entries[cache_key] = entry
        return entry

    def invalidate_for_user(self, user_id: str) -> int:
        """
        입력: 사용자 ID.
        출력: 제거한 캐시 엔트리 수.
        역할: 지역 또는 카테고리 변경 시 사용자의 기존 캐시를 폐기할 수 있게 한다.
        호출 예시: removed_count = cache.invalidate_for_user("demo-user")
        """
        with self._lock:
            # 변수 의미: 제거할 캐시 키 목록이다.
            keys_to_remove = [cache_key for cache_key in self._entries if cache_key[0] == user_id]
            for cache_key in keys_to_remove:
                self._entries.pop(cache_key, None)
            return len(keys_to_remove)

    def find_place_for_user(self, user_id: str, content_id: str) -> TourPlaceCandidate | None:
        """
        입력: 사용자 ID와 TourAPI contentId.
        출력: 캐시에 있는 장소 후보 또는 None.
        역할: GPS 완료 인증에서 라이브 또는 30분 캐시 좌표를 찾는다.
        호출 예시: place = cache.find_place_for_user(user_id, content_id)
        """
        with self._lock:
            # 변수 의미: 현재 시각이다.
            current_time = utc_now()
            for cache_key, entry in list(self._entries.items()):
                if entry.expires_at <= current_time:
                    self._entries.pop(cache_key, None)
                    continue
                if cache_key[0] != user_id:
                    continue
                for place in entry.places:
                    if place.content_id == content_id:
                        return place
        return None

    def size(self) -> int:
        """
        입력: 없음.
        출력: 현재 유효성 검사를 거치지 않은 캐시 엔트리 수.
        역할: 헬스체크와 진단 응답에 캐시 규모를 제공한다.
        호출 예시: cache_count = cache.size()
        """
        with self._lock:
            return len(self._entries)
