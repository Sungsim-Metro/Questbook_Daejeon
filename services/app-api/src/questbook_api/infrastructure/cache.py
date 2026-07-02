# Questbook TourAPI 유저 단위 Redis 30분 임시 캐시를 제공한다.
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import hashlib
import json

import redis

from questbook_api.domain.models import CacheEntry, TourPlaceCandidate

# 변수 의미: Redis 캐시 키 공통 접두사다.
KEY_PREFIX = "questbook:tour"
# 변수 의미: Redis SCAN에서 한 번에 탐색하도록 요청할 키 수 힌트다.
SCAN_COUNT = 500
# 변수 의미: Redis 연결과 응답 대기 제한 시간 초 단위 값이다.
REDIS_TIMEOUT_SECONDS = 2


def utc_now() -> datetime:
    """
    입력: 없음.
    출력: UTC 기준 현재 시각.
    역할: 캐시 만료와 저장 시각 계산을 일관되게 만든다.
    호출 예시: current_time = utc_now()
    """
    return datetime.now(timezone.utc)


def key_part(raw_value: str) -> str:
    """
    입력: Redis 키 구성 요소 원문.
    출력: 고정 길이 SHA-256 hex 문자열.
    역할: glob 메타문자와 콜론이 Redis 키 패턴에 영향을 주지 않게 한다.
    호출 예시: encoded = key_part("demo-user")
    """
    return hashlib.sha256(raw_value.encode("utf-8")).hexdigest()


class TourPlaceRedisCache:
    """
    입력: Redis 접속 URL과 기본 TTL 초 단위 값.
    출력: 사용자, 권역, 카테고리 기준의 Redis 임시 캐시 저장소.
    역할: OpenAPI 최소 필드를 영구 DB가 아니라 Redis에만 30분 보관한다.
    호출 예시: cache = TourPlaceRedisCache("redis://127.0.0.1:6379/0", default_ttl_seconds=1800)
    """

    def __init__(self, redis_url: str, default_ttl_seconds: int) -> None:
        """
        입력: Redis 접속 URL과 기본 캐시 TTL 초 단위 값.
        출력: 없음.
        역할: Redis 클라이언트를 초기화한다.
        호출 예시: cache = TourPlaceRedisCache(settings.redis_url, 1800)
        """
        # 변수 의미: 기본 캐시 TTL 초 단위 값이다.
        self.default_ttl_seconds = default_ttl_seconds
        # 변수 의미: 문자열 응답 모드의 Redis 클라이언트다.
        self._client = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
            socket_timeout=REDIS_TIMEOUT_SECONDS,
        )

    def _key(self, user_id: str, region_key: str, category_key: str) -> str:
        """
        입력: 사용자 ID, 위치 권역 키, 카테고리 키.
        출력: Redis 캐시 키 문자열.
        역할: 유저 단위 패턴 삭제가 가능한 키 규칙을 만든다.
        호출 예시: key = self._key("demo-user", "36.33:127.43", "market")
        """
        return f"{KEY_PREFIX}:{key_part(user_id)}:{key_part(region_key)}:{key_part(category_key)}"

    def _user_pattern(self, user_id: str) -> str:
        """
        입력: 사용자 ID.
        출력: 사용자의 캐시 키만 찾는 Redis SCAN 패턴.
        역할: 사용자 ID 원문에 들어간 glob 문자가 패턴으로 해석되지 않게 한다.
        호출 예시: pattern = self._user_pattern("demo-user")
        """
        return f"{KEY_PREFIX}:{key_part(user_id)}:*"

    def get(self, user_id: str, region_key: str, category_key: str) -> CacheEntry | None:
        """
        입력: 사용자 ID, 위치 권역 키, 카테고리 키.
        출력: 유효한 캐시 엔트리 또는 None.
        역할: Redis 장애나 깨진 캐시 값은 cache miss로 처리한다.
        호출 예시: entry = cache.get(user_id, region_key, category_key)
        """
        try:
            # 변수 의미: Redis에서 읽은 직렬화 문자열이다.
            raw_value = self._client.get(self._key(user_id, region_key, category_key))
        except redis.RedisError:
            return None
        if raw_value is None:
            return None
        return self._deserialize_or_none(raw_value)

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
        역할: Redis 저장 실패 시에도 호출자에게 현재 조회 결과를 반환한다.
        호출 예시: entry = cache.set(user_id, region_key, category_key, places, "fallback")
        """
        # 변수 의미: 캐시 저장 시각이다.
        fetched_at = utc_now()
        # 변수 의미: 캐시 만료 시각이다.
        expires_at = fetched_at + timedelta(seconds=self.default_ttl_seconds)
        # 변수 의미: 새 캐시 엔트리다.
        entry = CacheEntry(places=places, fetched_at=fetched_at, expires_at=expires_at, source_status=source_status)
        try:
            self._client.set(
                self._key(user_id, region_key, category_key),
                self._serialize(entry),
                ex=self.default_ttl_seconds,
            )
        except redis.RedisError:
            pass
        return entry

    def invalidate_for_user(self, user_id: str) -> int:
        """
        입력: 사용자 ID.
        출력: 제거한 캐시 엔트리 수.
        역할: 지역 또는 카테고리 변경 시 사용자의 기존 캐시를 폐기한다.
        호출 예시: removed_count = cache.invalidate_for_user("demo-user")
        """
        try:
            # 변수 의미: 사용자 키 패턴에 매칭된 키 목록이다.
            keys = list(self._client.scan_iter(match=self._user_pattern(user_id), count=SCAN_COUNT))
            if not keys:
                return 0
            return int(self._client.delete(*keys))
        except redis.RedisError:
            return 0

    def find_place_for_user(self, user_id: str, content_id: str) -> TourPlaceCandidate | None:
        """
        입력: 사용자 ID와 TourAPI contentId.
        출력: 캐시에 있는 장소 후보 또는 None.
        역할: GPS 완료 인증에서 30분 캐시 좌표를 찾는다.
        호출 예시: place = cache.find_place_for_user(user_id, content_id)
        """
        try:
            # 변수 의미: 사용자 캐시 키 목록이다.
            keys = list(self._client.scan_iter(match=self._user_pattern(user_id), count=SCAN_COUNT))
            if not keys:
                return None
            # 변수 의미: 사용자 캐시 값을 한 번에 읽은 결과 목록이다.
            raw_values = self._client.mget(keys)
        except redis.RedisError:
            return None

        for raw_value in raw_values:
            if raw_value is None:
                continue
            # 변수 의미: 역직렬화한 캐시 엔트리다.
            entry = self._deserialize_or_none(raw_value)
            if entry is None:
                continue
            for place in entry.places:
                if place.content_id == content_id:
                    return place
        return None

    def size(self) -> int:
        """
        입력: 없음.
        출력: 현재 보관 중인 캐시 엔트리 수.
        역할: 헬스체크와 진단 응답에 캐시 규모를 제공한다.
        호출 예시: cache_count = cache.size()
        """
        try:
            return sum(1 for _ in self._client.scan_iter(match=f"{KEY_PREFIX}:*", count=SCAN_COUNT))
        except redis.RedisError:
            return 0

    def is_healthy(self) -> bool:
        """
        입력: 없음.
        출력: Redis 응답 가능 여부.
        역할: 헬스체크에서 캐시 저장소 상태를 확인한다.
        호출 예시: ok = cache.is_healthy()
        """
        try:
            return bool(self._client.ping())
        except redis.RedisError:
            return False

    def _serialize(self, entry: CacheEntry) -> str:
        """
        입력: 캐시 엔트리.
        출력: JSON 직렬화 문자열.
        역할: dataclass 필드를 Redis 문자열 값으로 변환한다.
        호출 예시: raw = self._serialize(entry)
        """
        return json.dumps(
            {
                "places": [asdict(place) for place in entry.places],
                "fetched_at": entry.fetched_at.isoformat(),
                "expires_at": entry.expires_at.isoformat(),
                "source_status": entry.source_status,
            },
            ensure_ascii=False,
        )

    def _deserialize_or_none(self, raw_value: str) -> CacheEntry | None:
        """
        입력: JSON 직렬화 문자열.
        출력: 복원된 캐시 엔트리 또는 None.
        역할: 깨진 Redis 값을 cache miss로 처리한다.
        호출 예시: entry = self._deserialize_or_none(raw)
        """
        try:
            return self._deserialize(raw_value)
        except (KeyError, TypeError, ValueError):
            return None

    def _deserialize(self, raw_value: str) -> CacheEntry:
        """
        입력: JSON 직렬화 문자열.
        출력: 복원된 캐시 엔트리.
        역할: Redis 값에서 CacheEntry와 장소 후보를 되살린다.
        호출 예시: entry = self._deserialize(raw)
        """
        # 변수 의미: JSON에서 파싱한 캐시 데이터다.
        data = json.loads(raw_value)
        return CacheEntry(
            places=[TourPlaceCandidate(**place) for place in data["places"]],
            fetched_at=datetime.fromisoformat(data["fetched_at"]),
            expires_at=datetime.fromisoformat(data["expires_at"]),
            source_status=data["source_status"],
        )
