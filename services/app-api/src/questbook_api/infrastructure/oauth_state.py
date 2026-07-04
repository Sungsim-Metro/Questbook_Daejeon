# Questbook OAuth 로그인 state를 Redis에 단회용으로 저장한다.
from __future__ import annotations

import json
import secrets
from typing import Any

import redis


# 변수 의미: OAuth state Redis 키 공통 접두사다.
KEY_PREFIX = "questbook:oauth_state"
# 변수 의미: OAuth callback 후 앱 토큰 교환 코드 Redis 키 공통 접두사다.
LOGIN_CODE_KEY_PREFIX = "questbook:oauth_login_code"
# 변수 의미: Redis 연결과 응답 대기 제한 시간 초 단위 값이다.
REDIS_TIMEOUT_SECONDS = 2
# 변수 의미: 발급한 state의 기본 유효 시간 초 단위 값이다.
DEFAULT_TTL_SECONDS = 600
# 변수 의미: 앱 토큰 교환 코드의 기본 유효 시간 초 단위 값이다.
DEFAULT_LOGIN_CODE_TTL_SECONDS = 120
# 변수 의미: GETDEL 미지원 Redis에서 원자적으로 get/delete를 수행하는 Lua 스크립트다.
GET_DELETE_SCRIPT = """
local value = redis.call("GET", KEYS[1])
if value then
  redis.call("DEL", KEYS[1])
end
return value
"""


class OAuthStateError(RuntimeError):
    """
    입력: OAuth state 저장소 오류 메시지.
    출력: state 저장소 전용 런타임 오류.
    역할: Redis 장애를 호출자가 명확히 구분하게 한다.
    호출 예시: raise OAuthStateError("oauth_state_unavailable")
    """


class OAuthStateStore:
    """
    입력: Redis 접속 URL과 state 유효 시간.
    출력: OAuth 로그인 CSRF 방어용 단회 state 저장소.
    역할: 로그인 시작 시 state를 저장하고 콜백에서 한 번만 소비한다.
    호출 예시: store = OAuthStateStore("redis://127.0.0.1:6379/0", 600)
    """

    def __init__(self, redis_url: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        """
        입력: Redis 접속 URL과 state 유효 시간.
        출력: 없음.
        역할: Redis 클라이언트를 짧은 타임아웃으로 초기화한다.
        호출 예시: store = OAuthStateStore(settings.redis_url)
        """
        # 변수 의미: state 유효 시간 초 단위 값이다.
        self.ttl_seconds = ttl_seconds
        # 변수 의미: 문자열 응답 모드의 Redis 클라이언트다.
        self._client = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
            socket_timeout=REDIS_TIMEOUT_SECONDS,
        )

    def _key(self, state: str) -> str:
        """
        입력: state 문자열.
        출력: Redis 키 문자열.
        역할: state 값에 접두사를 붙여 키 충돌을 막는다.
        호출 예시: key = self._key(state)
        """
        return f"{KEY_PREFIX}:{state}"

    def _login_code_key(self, code: str) -> str:
        """
        입력: 앱 토큰 교환 코드.
        출력: Redis 키 문자열.
        역할: OAuth state와 토큰 교환 코드 키 공간을 분리한다.
        호출 예시: key = self._login_code_key(code)
        """
        return f"{LOGIN_CODE_KEY_PREFIX}:{code}"

    def issue(
        self,
        provider: str,
        redirect_uri: str,
        consent: dict[str, bool],
        browser_nonce: str = "",
    ) -> str:
        """
        입력: provider 이름, 콜백 redirect_uri, 동의 3항목, 브라우저 nonce.
        출력: 새로 발급한 임의 state 문자열.
        역할: 로그인 시작 시 state와 부수 정보를 TTL과 함께 저장한다.
        호출 예시: state = store.issue("naver", redirect_uri, {"age": True}, browser_nonce)
        """
        # 변수 의미: 추측 불가능한 임의 state 값이다.
        state = secrets.token_urlsafe(32)
        # 변수 의미: state에 함께 보관할 JSON 문자열이다.
        payload = json.dumps(
            {"provider": provider, "redirect_uri": redirect_uri, "consent": consent, "browser_nonce": browser_nonce},
            ensure_ascii=False,
        )
        try:
            self._client.setex(self._key(state), self.ttl_seconds, payload)
        except redis.RedisError as error:
            raise OAuthStateError("oauth_state_unavailable") from error
        return state

    def issue_login_code(self, user_id: str, provider: str, browser_nonce: str) -> str:
        """
        입력: baseline 사용자 ID, provider 이름, 브라우저 nonce.
        출력: 프런트가 앱 토큰으로 교환할 단회 코드.
        역할: callback HTML에 JWT를 직접 담지 않고 짧은 수명 코드만 전달한다.
        호출 예시: code = store.issue_login_code(user_id, "naver", browser_nonce)
        """
        # 변수 의미: 추측 불가능한 단회 토큰 교환 코드다.
        code = secrets.token_urlsafe(32)
        # 변수 의미: 토큰 교환 코드에 함께 저장할 JSON 문자열이다.
        payload = json.dumps(
            {"user_id": user_id, "provider": provider, "browser_nonce": browser_nonce},
            ensure_ascii=False,
        )
        try:
            self._client.setex(self._login_code_key(code), DEFAULT_LOGIN_CODE_TTL_SECONDS, payload)
        except redis.RedisError as error:
            raise OAuthStateError("oauth_state_unavailable") from error
        return code

    def _getdel(self, key: str) -> str | None:
        """
        입력: Redis 키.
        출력: 삭제하며 읽은 문자열 값 또는 None.
        역할: Redis GETDEL을 우선 사용하고 미지원이면 Lua 원자 연산으로 대체한다.
        호출 예시: raw_value = self._getdel(self._key(state))
        """
        try:
            # 변수 의미: Redis 6.2 이상에서 지원하는 단회 소비 원자 명령 결과다.
            return self._client.getdel(key)
        except redis.ResponseError as error:
            # 변수 의미: Redis 호환 서버가 GETDEL을 지원하지 않는지 여부다.
            is_unknown_getdel = "unknown" in str(error).lower() and "getdel" in str(error).lower()
            if not is_unknown_getdel:
                raise
        # 변수 의미: GETDEL 미지원 환경에서 사용하는 Lua 원자 연산 결과다.
        fallback_value = self._client.eval(GET_DELETE_SCRIPT, 1, key)
        return str(fallback_value) if fallback_value is not None else None

    def consume(self, state: str) -> dict[str, Any] | None:
        """
        입력: 콜백으로 돌아온 state 문자열.
        출력: 저장했던 부수 정보 딕셔너리 또는 None.
        역할: state를 한 번만 사용하도록 읽는 즉시 삭제한다.
        호출 예시: payload = store.consume(state)
        """
        if not state:
            return None
        try:
            # 변수 의미: 읽으면서 삭제한 state 저장 값이다.
            raw_value = self._getdel(self._key(state))
        except redis.RedisError:
            return None
        if raw_value is None:
            return None
        try:
            # 변수 의미: JSON에서 복원한 state 부수 정보다.
            payload = json.loads(raw_value)
        except ValueError:
            return None
        return payload if isinstance(payload, dict) else None

    def consume_login_code(self, code: str) -> dict[str, Any] | None:
        """
        입력: 프런트에서 돌려준 단회 토큰 교환 코드.
        출력: 저장했던 사용자 정보 딕셔너리 또는 None.
        역할: 앱 access token 발급 전에 코드를 한 번만 소비한다.
        호출 예시: payload = store.consume_login_code(code)
        """
        if not code:
            return None
        try:
            # 변수 의미: 읽으면서 삭제한 토큰 교환 코드 저장 값이다.
            raw_value = self._getdel(self._login_code_key(code))
        except redis.RedisError as error:
            raise OAuthStateError("oauth_state_unavailable") from error
        if raw_value is None:
            return None
        try:
            # 변수 의미: JSON에서 복원한 토큰 교환 코드 payload다.
            payload = json.loads(raw_value)
        except ValueError:
            return None
        return payload if isinstance(payload, dict) else None
