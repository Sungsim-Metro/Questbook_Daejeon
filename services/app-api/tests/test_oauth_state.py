# Questbook OAuth state 저장소의 단회 소비 동작을 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import redis


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.infrastructure.oauth_state import REDIS_TIMEOUT_SECONDS, OAuthStateError, OAuthStateStore


class FakeStateRedisClient:
    """
    입력: 없음.
    출력: setex/getdel만 흉내 내는 테스트 Redis 클라이언트.
    역할: 실제 Redis 없이 state 단회 소비를 검증한다.
    호출 예시: store._client = FakeStateRedisClient()
    """

    def __init__(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트용 메모리 저장소를 초기화한다.
        호출 예시: client = FakeStateRedisClient()
        """
        # 변수 의미: Redis 키에서 값으로 이어지는 테스트 저장소다.
        self.values: dict[str, str] = {}
        # 변수 의미: Redis 키에서 TTL로 이어지는 테스트 저장소다.
        self.expirations: dict[str, int] = {}

    def setex(self, key: str, ttl: int, value: str) -> bool:
        """
        입력: Redis 키, TTL, 문자열 값.
        출력: 저장 성공 여부.
        역할: Redis SETEX를 흉내 낸다.
        호출 예시: client.setex("key", 600, "value")
        """
        self.values[key] = value
        self.expirations[key] = ttl
        return True

    def getdel(self, key: str) -> str | None:
        """
        입력: Redis 키.
        출력: 삭제하며 읽은 문자열 값 또는 None.
        역할: Redis GETDEL을 흉내 낸다.
        호출 예시: raw = client.getdel("key")
        """
        self.expirations.pop(key, None)
        return self.values.pop(key, None)

    def eval(self, _script: str, _key_count: int, key: str) -> str | None:
        """
        입력: Lua 스크립트, 키 개수, Redis 키.
        출력: 삭제하며 읽은 문자열 값 또는 None.
        역할: GETDEL fallback의 Lua 호출을 흉내 낸다.
        호출 예시: client.eval("...", 1, "key")
        """
        self.expirations.pop(key, None)
        return self.values.pop(key, None)


class UnsupportedGetdelRedisClient(FakeStateRedisClient):
    """
    입력: 없음.
    출력: GETDEL 미지원 Redis를 흉내 내는 테스트 클라이언트.
    역할: Lua fallback이 단회 소비를 유지하는지 검증한다.
    호출 예시: store._client = UnsupportedGetdelRedisClient()
    """

    def getdel(self, _key: str) -> str | None:
        """
        입력: Redis 키.
        출력: 없음.
        역할: Redis unknown command 응답을 흉내 낸다.
        호출 예시: client.getdel("key")
        """
        raise redis.ResponseError("unknown command 'GETDEL'")


class FailingSetRedisClient(FakeStateRedisClient):
    """
    입력: 없음.
    출력: SETEX에서 실패하는 테스트 Redis 클라이언트.
    역할: state 발급 실패가 명시적 예외로 표현되는지 검증한다.
    호출 예시: store._client = FailingSetRedisClient()
    """

    def setex(self, _key: str, _ttl: int, _value: str) -> bool:
        """
        입력: Redis 키, TTL, 문자열 값.
        출력: 없음.
        역할: Redis 저장 장애를 흉내 낸다.
        호출 예시: client.setex("key", 600, "value")
        """
        raise redis.RedisError("redis unavailable")


class FailingGetRedisClient(FakeStateRedisClient):
    """
    입력: 없음.
    출력: GETDEL에서 실패하는 테스트 Redis 클라이언트.
    역할: state 소비 장애가 None으로 저하되는지 검증한다.
    호출 예시: store._client = FailingGetRedisClient()
    """

    def getdel(self, _key: str) -> str | None:
        """
        입력: Redis 키.
        출력: 없음.
        역할: Redis 읽기 장애를 흉내 낸다.
        호출 예시: client.getdel("key")
        """
        raise redis.RedisError("redis unavailable")


class OAuthStateStoreTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: OAuth state 저장소 검증 결과.
    역할: state 발급, TTL 저장, 단회 소비를 확인한다.
    호출 예시: uv run pytest tests/test_oauth_state.py
    """

    def _store(self) -> OAuthStateStore:
        """
        입력: 없음.
        출력: fake Redis 클라이언트를 사용하는 OAuthStateStore.
        역할: 테스트마다 독립적인 저장소를 만든다.
        호출 예시: store = self._store()
        """
        with patch("questbook_api.infrastructure.oauth_state.redis.Redis.from_url") as from_url:
            from_url.return_value = FakeStateRedisClient()
            return OAuthStateStore("redis://127.0.0.1:6379/0", ttl_seconds=600)

    def _store_with_client(self, client: object) -> OAuthStateStore:
        """
        입력: 테스트 Redis 클라이언트.
        출력: 주입한 클라이언트를 사용하는 OAuthStateStore.
        역할: 장애와 호환성 분기를 검증할 저장소를 만든다.
        호출 예시: store = self._store_with_client(FailingSetRedisClient())
        """
        with patch("questbook_api.infrastructure.oauth_state.redis.Redis.from_url") as from_url:
            from_url.return_value = client
            return OAuthStateStore("redis://127.0.0.1:6379/0", ttl_seconds=600)

    def test_constructor_sets_short_redis_timeouts(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Redis 클라이언트가 짧은 연결과 응답 타임아웃으로 생성되는지 확인한다.
        호출 예시: self.test_constructor_sets_short_redis_timeouts()
        """
        with patch("questbook_api.infrastructure.oauth_state.redis.Redis.from_url") as from_url:
            from_url.return_value = FakeStateRedisClient()
            OAuthStateStore("redis://127.0.0.1:6379/0", ttl_seconds=600)

        from_url.assert_called_once_with(
            "redis://127.0.0.1:6379/0",
            decode_responses=True,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
            socket_timeout=REDIS_TIMEOUT_SECONDS,
        )

    def test_issue_then_consume_returns_payload_once(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 발급한 state가 한 번만 payload를 반환하는지 확인한다.
        호출 예시: self.test_issue_then_consume_returns_payload_once()
        """
        # 변수 의미: 테스트 대상 state 저장소다.
        store = self._store()
        # 변수 의미: 발급된 OAuth state 값이다.
        state = store.issue("naver", "http://localhost:8000/api/auth/naver/callback", {"age": True})
        # 변수 의미: Redis에 저장된 TTL 값 목록이다.
        ttl_values = list(store._client.expirations.values())
        self.assertEqual(ttl_values, [600])
        # 변수 의미: 첫 번째 state 소비 결과다.
        first = store.consume(state)

        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first["provider"], "naver")
        self.assertEqual(first["consent"], {"age": True})
        self.assertIsNone(store.consume(state))

    def test_unknown_state_returns_none(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 없거나 빈 state가 None으로 처리되는지 확인한다.
        호출 예시: self.test_unknown_state_returns_none()
        """
        # 변수 의미: 테스트 대상 state 저장소다.
        store = self._store()

        self.assertIsNone(store.consume("does-not-exist"))
        self.assertIsNone(store.consume(""))

    def test_login_code_is_consumed_once(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: OAuth callback 후 발급한 앱 토큰 교환 코드가 한 번만 소비되는지 확인한다.
        호출 예시: self.test_login_code_is_consumed_once()
        """
        # 변수 의미: 테스트 대상 state 저장소다.
        store = self._store()
        # 변수 의미: 발급된 단회 token 교환 코드다.
        code = store.issue_login_code("usr_1", "google", "nonce-abcdefghijklmnopqrstuvwxyz123456")
        # 변수 의미: 첫 번째 코드 소비 결과다.
        first = store.consume_login_code(code)

        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first["user_id"], "usr_1")
        self.assertEqual(first["provider"], "google")
        self.assertEqual(first["browser_nonce"], "nonce-abcdefghijklmnopqrstuvwxyz123456")
        self.assertIsNone(store.consume_login_code(code))

    def test_login_code_redis_failure_raises_state_error(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 토큰 교환 코드 소비 중 Redis 장애가 명시적 state 예외로 표현되는지 확인한다.
        호출 예시: self.test_login_code_redis_failure_raises_state_error()
        """
        # 변수 의미: 읽기 실패 클라이언트를 주입한 state 저장소다.
        store = self._store_with_client(FailingGetRedisClient())

        with self.assertRaises(OAuthStateError):
            store.consume_login_code("login-code")

    def test_getdel_unsupported_uses_lua_fallback_once(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: GETDEL 미지원 Redis에서도 state가 한 번만 소비되는지 확인한다.
        호출 예시: self.test_getdel_unsupported_uses_lua_fallback_once()
        """
        # 변수 의미: GETDEL 미지원 테스트 Redis 클라이언트다.
        fake_client = UnsupportedGetdelRedisClient()
        # 변수 의미: 테스트 대상 state 저장소다.
        store = self._store_with_client(fake_client)
        # 변수 의미: 발급된 OAuth state 값이다.
        state = store.issue("google", "http://localhost:8000/api/auth/google/callback", {"age": True})

        self.assertIsNotNone(store.consume(state))
        self.assertIsNone(store.consume(state))

    def test_issue_failure_raises_state_error(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Redis 저장 실패가 명시적 state 예외로 표현되는지 확인한다.
        호출 예시: self.test_issue_failure_raises_state_error()
        """
        # 변수 의미: 저장 실패 클라이언트를 주입한 state 저장소다.
        store = self._store_with_client(FailingSetRedisClient())

        with self.assertRaises(OAuthStateError):
            store.issue("naver", "http://localhost:8000/api/auth/naver/callback", {"age": True})

    def test_consume_failure_and_bad_payload_return_none(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Redis 읽기 실패와 깨진 payload가 None으로 저하되는지 확인한다.
        호출 예시: self.test_consume_failure_and_bad_payload_return_none()
        """
        # 변수 의미: 읽기 실패 클라이언트를 주입한 state 저장소다.
        failing_store = self._store_with_client(FailingGetRedisClient())
        self.assertIsNone(failing_store.consume("state"))

        # 변수 의미: 깨진 JSON payload를 가진 테스트 클라이언트다.
        corrupt_client = FakeStateRedisClient()
        # 변수 의미: 깨진 값 테스트용 state 저장소다.
        corrupt_store = self._store_with_client(corrupt_client)
        corrupt_client.values[corrupt_store._key("bad-json")] = "not-json"
        corrupt_client.values[corrupt_store._key("not-dict")] = '"plain"'

        self.assertIsNone(corrupt_store.consume("bad-json"))
        self.assertIsNone(corrupt_store.consume("not-dict"))


if __name__ == "__main__":
    unittest.main()
