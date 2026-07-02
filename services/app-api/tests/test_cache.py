# Questbook Redis 캐시의 장애 허용 동작을 검증한다.
from __future__ import annotations

import fnmatch
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import redis

# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.domain.models import TourPlaceCandidate
from questbook_api.infrastructure.cache import REDIS_TIMEOUT_SECONDS, TourPlaceRedisCache


class FakeRedisClient:
    """
    입력: 없음.
    출력: Redis 메서드 일부를 흉내 내는 테스트 클라이언트.
    역할: 실제 Redis 없이 캐시 키와 값 처리를 검증한다.
    호출 예시: cache._client = FakeRedisClient()
    """

    def __init__(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트용 메모리 저장소를 초기화한다.
        호출 예시: client = FakeRedisClient()
        """
        # 변수 의미: Redis 키에서 문자열 값으로 이어지는 테스트 저장소다.
        self.values: dict[str, str] = {}
        # 변수 의미: Redis 키에서 TTL 초 값으로 이어지는 테스트 저장소다.
        self.expirations: dict[str, int] = {}

    def get(self, key: str) -> str | None:
        """
        입력: Redis 키.
        출력: 저장된 문자열 값 또는 None.
        역할: Redis GET을 흉내 낸다.
        호출 예시: raw = client.get(key)
        """
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int) -> bool:
        """
        입력: Redis 키, 값, TTL.
        출력: 저장 성공 여부.
        역할: Redis SET EX를 흉내 낸다.
        호출 예시: client.set(key, value, ex=1800)
        """
        self.values[key] = value
        self.expirations[key] = ex
        return True

    def scan_iter(self, match: str, count: int) -> list[str]:
        """
        입력: glob 패턴과 count 힌트.
        출력: 매칭된 키 목록.
        역할: Redis SCAN iterator를 흉내 낸다.
        호출 예시: keys = list(client.scan_iter(match="prefix:*", count=500))
        """
        return [key for key in list(self.values) if fnmatch.fnmatch(key, match)]

    def delete(self, *keys: str) -> int:
        """
        입력: 삭제할 Redis 키 목록.
        출력: 삭제한 키 수.
        역할: Redis DELETE를 흉내 낸다.
        호출 예시: removed = client.delete(*keys)
        """
        # 변수 의미: 실제로 삭제한 키 수다.
        removed_count = 0
        for key in keys:
            if key in self.values:
                removed_count += 1
                self.values.pop(key, None)
                self.expirations.pop(key, None)
        return removed_count

    def mget(self, keys: list[str]) -> list[str | None]:
        """
        입력: Redis 키 목록.
        출력: 키 순서에 맞는 값 목록.
        역할: Redis MGET을 흉내 낸다.
        호출 예시: values = client.mget(keys)
        """
        return [self.values.get(key) for key in keys]

    def ping(self) -> bool:
        """
        입력: 없음.
        출력: Redis 응답 가능 여부.
        역할: Redis PING을 흉내 낸다.
        호출 예시: ok = client.ping()
        """
        return True


class FailingRedisClient:
    """
    입력: 없음.
    출력: 모든 Redis 호출에서 예외를 던지는 테스트 클라이언트.
    역할: Redis 장애 시 cache miss로 저하되는지 검증한다.
    호출 예시: cache._client = FailingRedisClient()
    """

    def _fail(self, *_args: object, **_kwargs: object) -> None:
        """
        입력: 임의 인자.
        출력: 없음.
        역할: Redis 장애 예외를 발생시킨다.
        호출 예시: self._fail()
        """
        raise redis.RedisError("redis unavailable")

    get = set = scan_iter = delete = mget = ping = _fail


def make_place(content_id: str) -> TourPlaceCandidate:
    """
    입력: contentId.
    출력: 테스트 장소 후보.
    역할: Redis 캐시 테스트에 필요한 최소 장소 데이터를 만든다.
    호출 예시: place = make_place("place-1")
    """
    return TourPlaceCandidate(
        content_id=content_id,
        title="한밭수목원",
        latitude=36.366,
        longitude=127.389,
        category_code="nature",
        category_name="자연 관찰",
        summary="테스트 장소",
        distance_meters=120.0,
        source="fallback",
    )


class TourPlaceRedisCacheTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: Redis 캐시 단위 검증 결과.
    역할: 장애 허용, 키 인코딩, 타임아웃 설정을 확인한다.
    호출 예시: uv run pytest tests/test_cache.py
    """

    def test_constructor_sets_short_redis_timeouts(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Redis 클라이언트가 짧은 연결과 응답 타임아웃으로 생성되는지 확인한다.
        호출 예시: self.test_constructor_sets_short_redis_timeouts()
        """
        with patch("questbook_api.infrastructure.cache.redis.Redis.from_url") as from_url:
            from_url.return_value = FakeRedisClient()
            TourPlaceRedisCache("redis://127.0.0.1:6379/0", default_ttl_seconds=1800)

        from_url.assert_called_once_with(
            "redis://127.0.0.1:6379/0",
            decode_responses=True,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
            socket_timeout=REDIS_TIMEOUT_SECONDS,
        )

    def test_redis_errors_degrade_to_cache_miss(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Redis 장애가 추천과 완료 흐름으로 예외 전파되지 않게 한다.
        호출 예시: self.test_redis_errors_degrade_to_cache_miss()
        """
        # 변수 의미: 장애 Redis 클라이언트를 주입한 캐시다.
        cache = TourPlaceRedisCache("redis://127.0.0.1:6379/0", default_ttl_seconds=1800)
        cache._client = FailingRedisClient()
        # 변수 의미: Redis 저장 실패 시에도 호출자에게 돌려줄 장소 후보다.
        place = make_place("place-1")

        self.assertIsNone(cache.get("demo-user", "36.33:127.43", "nature"))
        self.assertEqual(cache.set("demo-user", "36.33:127.43", "nature", [place], "fallback").places, [place])
        self.assertEqual(cache.invalidate_for_user("demo-user"), 0)
        self.assertIsNone(cache.find_place_for_user("demo-user", "place-1"))
        self.assertEqual(cache.size(), 0)
        self.assertFalse(cache.is_healthy())

    def test_corrupt_cache_values_degrade_to_cache_miss(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 깨진 Redis 값이 JSON 역직렬화 예외로 전파되지 않게 한다.
        호출 예시: self.test_corrupt_cache_values_degrade_to_cache_miss()
        """
        # 변수 의미: 테스트용 Redis 클라이언트를 주입한 캐시다.
        cache = TourPlaceRedisCache("redis://127.0.0.1:6379/0", default_ttl_seconds=1800)
        fake_client = FakeRedisClient()
        cache._client = fake_client
        # 변수 의미: 깨진 JSON 값이 들어 있는 Redis 키다.
        key = cache._key("demo-user", "36.33:127.43", "nature")
        fake_client.values[key] = "not-json"

        self.assertIsNone(cache.get("demo-user", "36.33:127.43", "nature"))
        self.assertIsNone(cache.find_place_for_user("demo-user", "place-1"))

    def test_user_id_glob_characters_do_not_cross_user_boundaries(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: user_id의 glob 문자와 콜론이 다른 사용자 캐시를 건드리지 않는지 확인한다.
        호출 예시: self.test_user_id_glob_characters_do_not_cross_user_boundaries()
        """
        # 변수 의미: 테스트용 Redis 클라이언트를 주입한 캐시다.
        cache = TourPlaceRedisCache("redis://127.0.0.1:6379/0", default_ttl_seconds=1800)
        fake_client = FakeRedisClient()
        cache._client = fake_client

        cache.set("demo:*", "36.33:127.43", "nature", [make_place("place-1")], "fallback")
        cache.set("demo:any", "36.33:127.43", "nature", [make_place("place-2")], "fallback")

        self.assertEqual(cache.invalidate_for_user("demo:*"), 1)
        self.assertIsNone(cache.get("demo:*", "36.33:127.43", "nature"))
        self.assertIsNotNone(cache.get("demo:any", "36.33:127.43", "nature"))
        self.assertTrue(all("demo" not in key for key in fake_client.values))


if __name__ == "__main__":
    unittest.main()
