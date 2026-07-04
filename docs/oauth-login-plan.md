# Naver·Google OAuth 로그인 도입 계획

작성일: 2026-07-03 · 구현: 사용자(태스크 1~3개씩) → Claude 검토
전제: 앱 서버 기동 런북(`Todo/app-server-bringup-runbook.md`) 완료 후 운영 검증 가능. 코드 구현과 콘솔 준비는 그 전에 병행 가능.

> **구현 반영 (2026-07-04)**: 실제 구현은 JWT-in-fragment 대신 **browser nonce + Redis 단회 `oauth_code` redeem**을 사용한다. 게이트웨이는 변경 없음이 아니라 upstream의 캐시·보안 헤더를 전달하도록 보완됐으며, wildcard CORS는 추가하지 않는다. 아래 계획의 오래된 JWT fragment 예시는 현재 구현 기준으로 폐기됐다.

## 목표

demo-social 로그인과 나란히 **네이버·구글 계정으로 실제 로그인**을 제공한다.
Authorization Code 방식(서버 측 코드 교환, 시크릿은 앱 서버 `.env`에만 존재)으로 구현한다.

## 완료 기준

- [ ] 로그인 화면에서 네이버/구글 버튼 → 각 로그인 → 콜백 → 앱 화면 진입까지 동작 (로컬과 운영 도메인 모두)
- [ ] 같은 계정으로 재로그인 시 동일 사용자로 인식(뱃지·진행도 유지), 다른 계정은 별도 사용자 생성
- [ ] state 검증 실패·코드 교환 실패 시 오류 안내 후 로그인 화면 복귀
- [ ] 시크릿이 저장소·문서·로그 어디에도 남지 않음
- [ ] pytest 단위 테스트 통과 (state 저장소, provider 클라이언트, 콜백 흐름)

## 현재 기반 (이미 갖춰진 것)

- `user_accounts` 테이블: `UNIQUE(provider, provider_user_id)` — OAuth 신원 연결 준비 완료
- `repository.link_user_account()` / `record_user_consent()` / `ensure_user()` 존재
- HMAC-SHA256 JWT 발급·검증 (`domain/auth/tokens.py`, payload에 provider 포함)
- `GET /api/auth/providers`가 이미 naver/google을 `configured: false`로 노출
- Redis 인프라 (state 저장소로 재사용)
- 부족한 것: provider 신원으로 사용자를 **찾는** 메서드 없음(demo는 user_id를 `demo-user`로 고정), OAuth 클라이언트/라우트 없음, 프런트 버튼 없음

## 주요 설계 결정

게이트웨이 프록시(`gateway.py`)의 제약과 현재 구현은 다음을 따른다:
`urlopen`이 3xx를 자동 추종하므로 **앱 API가 302를 응답하면 안 됨**. 따라서 시작은 JSON으로, 콜백은 HTML 브리지로 응답하고 브라우저가 이동한다.
게이트웨이는 upstream의 `Cache-Control`, `Content-Security-Policy`, `Vary` 등 선택 헤더를 전달하고 wildcard CORS를 추가하지 않는다. state와 login code는 Redis 단회용으로 관리하며, callback HTML에 앱 JWT를 직접 싣지 않는다.

1. **시작 흐름**: `POST /api/auth/{provider}/start` (body: 동의 3항목 + browser nonce) → 서버가 state 발급 후 JSON `{authorizeUrl}` 반환 → **브라우저가 `location.href`로 이동** (302 없음)
2. **state 검증(Redis 단회용)**: `secrets.token_urlsafe(32)` 값을 Redis에 단회용 저장(TTL 600초, key `oauth_state:{state}`, value에 provider·redirect_uri·동의 3항목·browser nonce 포함). 콜백에서 **GETDEL로 소비하며 존재 여부 확인** → 없으면(재사용·만료·위조) 거부. 이것이 OAuth 표준 CSRF 방어다. (쿠키 바인딩은 선택적 심화 방어로 범위 외)
3. **콜백 흐름**: `GET /api/auth/{provider}/callback?code&state` → state 검증 → urllib로 토큰 교환 → 프로필 조회 → 사용자 find-or-create → Redis 단회 `oauth_code` 발급 → **200 HTML 브리지 페이지** 응답: `location.replace("/#oauth_code=<code>")` 실행. app.js는 fragment의 code와 `sessionStorage` nonce를 `POST /api/auth/oauth-code/redeem`으로 보내 앱 JWT를 받은 뒤 localStorage에 저장하고 fragment를 지운다. 실패 시 `/#oauth_error=<사유>`로 복귀
4. **사용자 식별**: `(provider, provider_user_id)`로 기존 연결 조회 → 있으면 그 user_id 재사용, 없으면 `usr_` 접두사 신규 ID로 `ensure_user` + `link_user_account`. 닉네임은 프로필의 표시 이름(없으면 기본값)
5. **동의 처리**: 기존 데모와 동일하게 로그인 시점에 요구 — start body의 동의 3항목을 검증해 Redis state에 동봉, 콜백 성공 시 `record_user_consent` 기록 (기존 `baseline-2026-07` 버전 체계 유지)
6. **redirect_uri 구성**: `QUESTBOOK_PUBLIC_BASE_URL` + `/api/auth/{provider}/callback`. 로컬은 `http://localhost:8000`, 운영은 `https://www.travel-qbook.co.kr`
7. 신규 의존성 없음 (urllib 사용, 저장소 원칙 유지)

## 사전 준비 체크리스트 — 콘솔 (코드와 무관하게 지금 가능)

### Google Cloud Console (APIs & Services)

- [ ] OAuth 클라이언트(웹 애플리케이션)의 **승인된 리디렉션 URI**에 추가:
  - `https://www.travel-qbook.co.kr/api/auth/google/callback`
  - `http://localhost:8000/api/auth/google/callback` (로컬 개발)
- [ ] **승인된 JavaScript 원본**: `https://www.travel-qbook.co.kr`, `http://localhost:8000`
- [ ] OAuth 동의 화면: scope는 `openid`, `email`, `profile`(비민감)만 사용
  - 게시 상태가 **테스트**면 로그인 가능한 계정이 등록된 테스트 사용자(최대 100명)로 제한 → 발표 시연은 발표자·팀원 계정 등록으로 충분
  - 불특정 관객 로그인이 필요하면 **프로덕션 게시** (비민감 scope만이면 별도 검증 심사 없음)

### Naver Developers (내 애플리케이션)

- [ ] 사용 API에 **네이버 로그인** 추가, 제공 정보는 최소로(별명, 이메일 권장)
- [ ] 로그인 오픈 API 서비스 환경(PC 웹):
  - 서비스 URL: `https://www.travel-qbook.co.kr`
  - Callback URL: `https://www.travel-qbook.co.kr/api/auth/naver/callback` 와 `http://localhost:8000/api/auth/naver/callback` (여러 개 등록 가능)
- [ ] **검수 상태 확인**: "개발 중" 상태에서는 [멤버 관리]에 등록된 네이버 아이디만 로그인 가능 → 팀원 아이디 등록
  - 불특정 다수 로그인이 필요하면 검수 신청 필요(소요 기간 있음 — 발표 일정상 멤버 등록 방식 권장)

### 참고: provider 엔드포인트 (구현 시 사용)

| | 인가 | 토큰 교환 | 프로필 |
| :-- | :-- | :-- | :-- |
| Google | `https://accounts.google.com/o/oauth2/v2/auth` | `https://oauth2.googleapis.com/token` | `https://openidconnect.googleapis.com/v1/userinfo` (`sub`, `email`, `name`) |
| Naver | `https://nid.naver.com/oauth2.0/authorize` | `https://nid.naver.com/oauth2.0/token` | `https://openapi.naver.com/v1/nid/me` (`response.id`, `email`, `nickname`) |

## .env에 추가할 키

로컬 개발 `.env`와 앱 서버 `/opt/Questbook_Daejeon/.env` 양쪽에 추가 (`.env.example`에는 빈 값으로 키만 추가):

```ini
# OAuth 공통: 콜백 redirect_uri의 기준 origin
QUESTBOOK_PUBLIC_BASE_URL=http://localhost:8000        # 운영은 https://www.travel-qbook.co.kr

# Google OAuth (Google Cloud Console > 사용자 인증 정보)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

# Naver OAuth (Naver Developers > 내 애플리케이션)
NAVER_OAUTH_CLIENT_ID=
NAVER_OAUTH_CLIENT_SECRET=
```

시크릿 취급 원칙은 기존과 동일: 서버 `.env`(chmod 600)에만 존재, 저장소·문서·채팅에 값 노출 금지.

## 구현 태스크

작업 루프(기존 워크플로): **한 태스크 구현 → 해당 pytest 실행 → Claude에게 알림 → 검토**. 각 태스크는 독립적으로 테스트 가능하도록 나눴다. 모든 명령은 `services/app-api/`에서 실행한다(프런트만 예외).

코드 규칙(기존 코드와 동일하게): 파일 첫 줄 한국어 요약 주석, `from __future__ import annotations`, 함수/클래스에 `입력/출력/역할/호출 예시` docstring, 지역 변수 위에 `# 변수 의미:` 주석, 식별자·문자열은 영어.

---

### Task 1 — 설정과 state 저장소

**목적**: OAuth 설정값을 읽고, 로그인 CSRF 방어용 state를 Redis에 단회 저장한다.

**파일 1** — `src/questbook_api/settings.py` 수정

`AppSettings` dataclass의 `jwt_secret` 필드 아래에 5개 필드를 추가한다:

```python
    # 변수 의미: OAuth 콜백 redirect_uri의 기준 origin이다.
    public_base_url: str
    # 변수 의미: 네이버 로그인 OAuth client ID다.
    naver_oauth_client_id: str
    # 변수 의미: 네이버 로그인 OAuth client secret이다.
    naver_oauth_client_secret: str
    # 변수 의미: 구글 로그인 OAuth client ID다.
    google_oauth_client_id: str
    # 변수 의미: 구글 로그인 OAuth client secret이다.
    google_oauth_client_secret: str
```

`from_env()`의 `jwt_secret=...` 줄 아래에 추가한다:

```python
            public_base_url=get_env("QUESTBOOK_PUBLIC_BASE_URL", "http://localhost:8000"),
            naver_oauth_client_id=get_env("NAVER_OAUTH_CLIENT_ID"),
            naver_oauth_client_secret=get_env("NAVER_OAUTH_CLIENT_SECRET"),
            google_oauth_client_id=get_env("GOOGLE_OAUTH_CLIENT_ID"),
            google_oauth_client_secret=get_env("GOOGLE_OAUTH_CLIENT_SECRET"),
```

**파일 2** — `.env.example` 수정 (기존 `GEMINI_API_KEY=` 아래에 추가)

```ini
# OAuth 콜백 redirect_uri의 기준 origin이다. 운영은 https://www.travel-qbook.co.kr
QUESTBOOK_PUBLIC_BASE_URL=http://localhost:8000
# 네이버 로그인 자격증명이다(지도 키 NAVER_MAPS_*와 별개).
NAVER_OAUTH_CLIENT_ID=
NAVER_OAUTH_CLIENT_SECRET=
# 구글 로그인 자격증명이다.
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
```

**파일 3** — `src/questbook_api/infrastructure/oauth_state.py` (신규). `cache.py`의 Redis 클라이언트 생성 방식을 그대로 따른다.

```python
# Questbook OAuth 로그인 state를 Redis에 단회용으로 저장한다.
from __future__ import annotations

import json
import secrets

import redis


# 변수 의미: OAuth state Redis 키 공통 접두사다.
KEY_PREFIX = "questbook:oauth_state"
# 변수 의미: Redis 연결과 응답 대기 제한 시간 초 단위 값이다.
REDIS_TIMEOUT_SECONDS = 2
# 변수 의미: 발급한 state의 기본 유효 시간 초 단위 값이다.
DEFAULT_TTL_SECONDS = 600


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

    def issue(self, provider: str, redirect_uri: str, consent: dict[str, bool]) -> str:
        """
        입력: provider 이름, 콜백 redirect_uri, 동의 3항목.
        출력: 새로 발급한 임의 state 문자열.
        역할: 로그인 시작 시 state와 부수 정보를 TTL과 함께 저장한다.
        호출 예시: state = store.issue("naver", redirect_uri, {"age": True})
        """
        # 변수 의미: 추측 불가능한 임의 state 값이다.
        state = secrets.token_urlsafe(32)
        # 변수 의미: state에 함께 보관할 JSON 문자열이다.
        payload = json.dumps({"provider": provider, "redirect_uri": redirect_uri, "consent": consent})
        self._client.setex(self._key(state), self.ttl_seconds, payload)
        return state

    def consume(self, state: str) -> dict | None:
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
            raw_value = self._client.getdel(self._key(state))
        except redis.RedisError:
            return None
        if raw_value is None:
            return None
        try:
            return json.loads(raw_value)
        except ValueError:
            return None
```

> 참고: `getdel`은 Redis 6.2+ 명령이다. NCP Cloud DB for Redis(7.x)는 지원한다. 만약 미지원 에러가 나면 `getdel` 부분을 파이프라인(GET+DELETE)으로 교체한다 — 검토 때 알려주면 대체 코드를 제공한다.

**파일 4** — `tests/test_oauth_state.py` (신규). `test_cache.py`의 Fake 클라이언트 + `patch` 방식을 따른다.

```python
# Questbook OAuth state 저장소의 단회 소비 동작을 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.infrastructure.oauth_state import OAuthStateStore


class FakeStateRedisClient:
    """
    입력: 없음.
    출력: setex/getdel만 흉내 내는 테스트 Redis 클라이언트.
    역할: 실제 Redis 없이 state 단회 소비를 검증한다.
    호출 예시: store._client = FakeStateRedisClient()
    """

    def __init__(self) -> None:
        # 변수 의미: Redis 키에서 값으로 이어지는 테스트 저장소다.
        self.values: dict[str, str] = {}

    def setex(self, key: str, ttl: int, value: str) -> bool:
        self.values[key] = value
        return True

    def getdel(self, key: str) -> str | None:
        return self.values.pop(key, None)


class OAuthStateStoreTest(unittest.TestCase):
    def _store(self) -> OAuthStateStore:
        with patch("questbook_api.infrastructure.oauth_state.redis.Redis.from_url") as from_url:
            from_url.return_value = FakeStateRedisClient()
            return OAuthStateStore("redis://127.0.0.1:6379/0", ttl_seconds=600)

    def test_issue_then_consume_returns_payload_once(self) -> None:
        store = self._store()
        state = store.issue("naver", "http://localhost:8000/api/auth/naver/callback", {"age": True})
        first = store.consume(state)
        self.assertIsNotNone(first)
        self.assertEqual(first["provider"], "naver")
        self.assertIsNone(store.consume(state))  # 두 번째 소비는 실패해야 한다

    def test_unknown_state_returns_none(self) -> None:
        store = self._store()
        self.assertIsNone(store.consume("does-not-exist"))
        self.assertIsNone(store.consume(""))


if __name__ == "__main__":
    unittest.main()
```

**검증**: `uv run pytest tests/test_oauth_state.py -v`
**완료 기준**: 2개 테스트 통과, `uv run questbook-api`가 정상 기동(설정 필드 추가로 인한 오류 없음).

---

### Task 2 — provider 클라이언트

**목적**: 네이버·구글의 인가 URL 구성, 코드→토큰 교환, 프로필 조회를 urllib로 구현하고 응답을 공통 형태로 정규화한다.

**파일 1** — `src/questbook_api/integrations/oauth/__init__.py` (신규, 빈 파일)

**파일 2** — `src/questbook_api/integrations/oauth/client.py` (신규). `tourapi/client.py`의 urllib 사용 방식을 따른다.

```python
# 네이버와 구글 OAuth 인가 URL 구성, 코드 교환, 프로필 조회를 담당한다.
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


# 변수 의미: 외부 OAuth 엔드포인트 응답 제한 시간 초 단위 값이다.
OAUTH_TIMEOUT_SECONDS = 8

# 변수 의미: provider별 OAuth 엔드포인트와 scope 설정이다.
PROVIDERS: dict[str, dict[str, str | None]] = {
    "naver": {
        "authorize_url": "https://nid.naver.com/oauth2.0/authorize",
        "token_url": "https://nid.naver.com/oauth2.0/token",
        "profile_url": "https://openapi.naver.com/v1/nid/me",
        "scope": None,
    },
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "profile_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
    },
}


def is_supported_provider(provider: str) -> bool:
    """
    입력: provider 이름.
    출력: 지원 여부.
    역할: 알 수 없는 provider 요청을 조기에 거른다.
    호출 예시: if not is_supported_provider("naver"): ...
    """
    return provider in PROVIDERS


def build_authorize_url(provider: str, client_id: str, state: str, redirect_uri: str) -> str:
    """
    입력: provider 이름, client ID, state, redirect_uri.
    출력: 사용자 브라우저가 이동할 인가 URL.
    역할: provider별 인가 요청 쿼리를 구성한다.
    호출 예시: url = build_authorize_url("naver", client_id, state, redirect_uri)
    """
    if not is_supported_provider(provider):
        raise ValueError(f"unsupported provider: {provider}")
    # 변수 의미: 인가 요청 공통 쿼리 파라미터다.
    params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "state": state}
    # 변수 의미: provider 설정에 정의된 scope다.
    scope = PROVIDERS[provider]["scope"]
    if scope:
        params["scope"] = scope
    return f"{PROVIDERS[provider]['authorize_url']}?{urlencode(params)}"


def _post_form(url: str, params: dict[str, str]) -> dict[str, Any]:
    """
    입력: 요청 URL과 폼 파라미터.
    출력: JSON으로 파싱한 응답 딕셔너리.
    역할: OAuth 토큰 교환용 x-www-form-urlencoded POST를 보낸다.
    호출 예시: data = _post_form(token_url, params)
    """
    # 변수 의미: 폼 인코딩한 요청 본문 바이트다.
    body = urlencode(params).encode("utf-8")
    # 변수 의미: 준비된 토큰 교환 요청 객체다.
    request = Request(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urlopen(request, timeout=OAUTH_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _get_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    """
    입력: 요청 URL과 헤더.
    출력: JSON으로 파싱한 응답 딕셔너리.
    역할: OAuth 프로필 조회용 GET을 보낸다.
    호출 예시: data = _get_json(profile_url, {"Authorization": "Bearer x"})
    """
    # 변수 의미: 준비된 프로필 조회 요청 객체다.
    request = Request(url, headers=headers, method="GET")
    with urlopen(request, timeout=OAUTH_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def exchange_code(
    provider: str, client_id: str, client_secret: str, code: str, state: str, redirect_uri: str
) -> str:
    """
    입력: provider, client ID/secret, 인가 코드, state, redirect_uri.
    출력: provider access token 문자열.
    역할: 인가 코드를 access token으로 교환한다.
    호출 예시: token = exchange_code("naver", cid, secret, code, state, redirect_uri)
    """
    if not is_supported_provider(provider):
        raise ValueError(f"unsupported provider: {provider}")
    # 변수 의미: 토큰 교환 요청 파라미터다.
    params = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "state": state,
        "redirect_uri": redirect_uri,
    }
    # 변수 의미: provider 토큰 응답이다.
    data = _post_form(str(PROVIDERS[provider]["token_url"]), params)
    # 변수 의미: 응답에서 꺼낸 access token이다.
    access_token = str(data.get("access_token", "")).strip()
    if not access_token:
        raise ValueError("oauth token exchange did not return access_token")
    return access_token


def fetch_profile(provider: str, access_token: str) -> dict[str, str]:
    """
    입력: provider와 access token.
    출력: provider_user_id, email, display_name을 담은 딕셔너리.
    역할: provider 프로필 응답을 공통 형태로 정규화한다.
    호출 예시: profile = fetch_profile("naver", access_token)
    """
    if not is_supported_provider(provider):
        raise ValueError(f"unsupported provider: {provider}")
    # 변수 의미: provider 프로필 원본 응답이다.
    data = _get_json(str(PROVIDERS[provider]["profile_url"]), {"Authorization": f"Bearer {access_token}"})
    if provider == "naver":
        # 변수 의미: 네이버 프로필 본문이다(response 안에 사용자 정보가 들어 있다).
        profile = data.get("response", {}) if isinstance(data.get("response"), dict) else {}
        return {
            "provider_user_id": str(profile.get("id", "")).strip(),
            "email": str(profile.get("email", "")).strip(),
            "display_name": str(profile.get("nickname") or profile.get("name") or "").strip(),
        }
    # google은 OpenID Connect userinfo 형식이다.
    return {
        "provider_user_id": str(data.get("sub", "")).strip(),
        "email": str(data.get("email", "")).strip(),
        "display_name": str(data.get("name") or "").strip(),
    }
```

**파일 3** — `tests/test_oauth_client.py` (신규). `urlopen`을 모킹한다.

```python
# Questbook OAuth provider 클라이언트의 URL 구성과 응답 정규화를 검증한다.
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.integrations.oauth import client


class FakeHttpResponse:
    """
    입력: 응답으로 돌려줄 딕셔너리.
    출력: urlopen 컨텍스트 매니저를 흉내 내는 객체.
    역할: 실제 HTTP 없이 토큰·프로필 응답을 주입한다.
    호출 예시: FakeHttpResponse({"access_token": "x"})
    """

    def __init__(self, payload: dict) -> None:
        self._data = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._data

    def __enter__(self) -> "FakeHttpResponse":
        return self

    def __exit__(self, *_args: object) -> bool:
        return False


class OAuthClientTest(unittest.TestCase):
    def test_build_authorize_url_includes_required_params(self) -> None:
        url = client.build_authorize_url("google", "cid", "state-123", "http://localhost:8000/api/auth/google/callback")
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["response_type"], ["code"])
        self.assertEqual(query["client_id"], ["cid"])
        self.assertEqual(query["state"], ["state-123"])
        self.assertIn("scope", query)  # google은 scope 필수

    def test_naver_profile_is_normalized(self) -> None:
        with patch.object(client, "urlopen", return_value=FakeHttpResponse(
            {"response": {"id": "naver-1", "email": "a@b.com", "nickname": "탐험가"}}
        )):
            profile = client.fetch_profile("naver", "token")
        self.assertEqual(profile["provider_user_id"], "naver-1")
        self.assertEqual(profile["display_name"], "탐험가")

    def test_exchange_code_requires_access_token(self) -> None:
        with patch.object(client, "urlopen", return_value=FakeHttpResponse({"error": "invalid_grant"})):
            with self.assertRaises(ValueError):
                client.exchange_code("google", "cid", "secret", "code", "state", "http://localhost:8000/cb")


if __name__ == "__main__":
    unittest.main()
```

**검증**: `uv run pytest tests/test_oauth_client.py -v`
**완료 기준**: 3개 테스트 통과.

---

### Task 3 — 라우트와 저장소 확장

**목적**: 앱 API에 `start`/`callback` 라우트를 붙이고, provider 신원으로 사용자를 찾거나 만든다.

**파일 1** — `src/questbook_api/infrastructure/repository.py` 수정

`find_user_id_by_identity`와 `find_or_create_identity`를 추가한다(`link_user_account` 메서드 아래 권장). `make_id`는 이 파일 상단에 이미 정의돼 있다.

```python
    def find_user_id_by_identity(self, provider: str, provider_user_id: str) -> str | None:
        """
        입력: provider 이름과 provider 사용자 ID.
        출력: 연결된 baseline 사용자 ID 또는 None.
        역할: OAuth 재로그인 시 기존 사용자를 식별한다.
        호출 예시: user_id = repository.find_user_id_by_identity("naver", "naver-1")
        """
        with self._lock:
            # 변수 의미: provider 신원에 연결된 계정 row다.
            row = self._connection.execute(
                "SELECT user_id FROM user_accounts WHERE provider = %s AND provider_user_id = %s",
                (provider, provider_user_id),
            ).fetchone()
            return row["user_id"] if row else None

    def find_or_create_identity(
        self,
        provider: str,
        provider_user_id: str,
        display_name: str | None,
        email: str | None,
    ) -> str:
        """
        입력: provider, provider 사용자 ID, 표시 이름, 이메일.
        출력: 기존 또는 새로 만든 baseline 사용자 ID.
        역할: OAuth 신원으로 사용자를 찾거나 없으면 생성한다.
        호출 예시: user_id = repository.find_or_create_identity("naver", "naver-1", "탐험가", "a@b.com")
        """
        # 변수 의미: 기존에 연결된 사용자 ID다.
        existing_user_id = self.find_user_id_by_identity(provider, provider_user_id)
        # 변수 의미: 사용할 baseline 사용자 ID다.
        user_id = existing_user_id or make_id("usr")
        self.ensure_user(user_id)
        self.link_user_account(
            user_id=user_id,
            provider=provider,
            provider_user_id=provider_user_id,
            display_name=display_name,
            email=email,
        )
        return user_id
```

**파일 2** — `src/questbook_api/server.py` 수정 (5곳)

(a) import 블록에 추가:

```python
from questbook_api.infrastructure.oauth_state import OAuthStateStore
from questbook_api.integrations.oauth import client as oauth_client
```

그리고 기존 `from urllib.parse import parse_qs, urlencode, urlparse`를 다음으로 바꾼다:

```python
from urllib.parse import parse_qs, quote, urlencode, urlparse
```

(b) `AppState` dataclass에 필드 추가(`service:` 아래):

```python
    # 변수 의미: OAuth 로그인 state 저장소다.
    oauth_state: OAuthStateStore
```

(c) `build_state()`에서 생성·주입:

```python
    # 변수 의미: OAuth 로그인 state 저장소다.
    oauth_state = OAuthStateStore(settings.redis_url)
```

그리고 마지막 `return AppState(...)`에 `oauth_state=oauth_state`를 추가한다.

(d) `do_GET`의 `/api/auth/providers` 블록을 설정 반영 버전으로 교체하고, 그 근처(try 블록 안, 마지막 `not_found` 전)에 콜백 라우트를 추가한다:

```python
                if path == "/api/auth/providers":
                    self._send_json(HTTPStatus.OK, {"providers": [
                        {"id": "demo-social", "label": "데모 소셜 로그인", "configured": True,
                         "description": "로컬 baseline 검증용 provider입니다."},
                        {"id": "naver", "label": "네이버",
                         "configured": bool(state.settings.naver_oauth_client_id and state.settings.naver_oauth_client_secret)},
                        {"id": "google", "label": "구글",
                         "configured": bool(state.settings.google_oauth_client_id and state.settings.google_oauth_client_secret)},
                    ]})
                    return
                # 변수 의미: OAuth 콜백 경로 토큰이다. (/api/auth/{provider}/callback)
                auth_parts = [part for part in path.split("/") if part]
                if len(auth_parts) == 4 and auth_parts[:2] == ["api", "auth"] and auth_parts[3] == "callback":
                    self._handle_oauth_callback(auth_parts[2], query)
                    return
```

(e) `do_POST`의 try 블록, `not_found` 전에 start 라우트를 추가한다:

```python
                if len(path_parts) == 4 and path_parts[:2] == ["api", "auth"] and path_parts[3] == "start":
                    # 변수 의미: OAuth 로그인 시작 요청 본문이다.
                    payload = self._read_json_body()
                    self._send_json(HTTPStatus.OK, self._handle_oauth_start(path_parts[2], payload))
                    return
```

(f) 핸들러 메서드 5개를 `QuestbookApiHandler` 클래스 안(`_handle_demo_login` 근처)에 추가한다:

```python
        def _provider_credentials(self, provider: str) -> tuple[str, str]:
            """
            입력: provider 이름.
            출력: (client_id, client_secret) 튜플.
            역할: 설정에서 provider 자격증명을 읽고 없으면 예외를 던진다.
            호출 예시: client_id, client_secret = self._provider_credentials("naver")
            """
            if provider == "naver":
                # 변수 의미: 네이버 자격증명이다.
                credentials = (state.settings.naver_oauth_client_id, state.settings.naver_oauth_client_secret)
            elif provider == "google":
                # 변수 의미: 구글 자격증명이다.
                credentials = (state.settings.google_oauth_client_id, state.settings.google_oauth_client_secret)
            else:
                raise ValueError("unsupported_provider")
            if not credentials[0] or not credentials[1]:
                raise ValueError(f"{provider} login is not configured")
            return credentials

        def _handle_oauth_start(self, provider: str, payload: dict[str, Any]) -> dict[str, Any]:
            """
            입력: provider 이름과 동의 3항목 본문.
            출력: authorizeUrl을 담은 딕셔너리.
            역할: 동의를 검증하고 state 발급 후 인가 URL을 만든다.
            호출 예시: response = self._handle_oauth_start("naver", payload)
            """
            if not oauth_client.is_supported_provider(provider):
                raise ValueError("unsupported provider")
            # 변수 의미: provider client ID다(secret은 콜백에서 사용).
            client_id, _client_secret = self._provider_credentials(provider)
            # 변수 의미: 동의 3항목 값이다.
            consent = {
                "age": bool(payload.get("ageConfirmed")),
                "privacy": bool(payload.get("privacyConsent")),
                "location": bool(payload.get("locationConsent")),
            }
            if not consent["age"]:
                raise ValueError("만 14세 이상 확인이 필요합니다.")
            if not consent["privacy"] or not consent["location"]:
                raise ValueError("개인정보와 위치정보 수집·이용 동의가 필요합니다.")
            # 변수 의미: provider 콜백 redirect_uri다.
            redirect_uri = f"{state.settings.public_base_url}/api/auth/{provider}/callback"
            # 변수 의미: 발급한 단회 state 값이다.
            issued_state = state.oauth_state.issue(provider, redirect_uri, consent)
            return {"authorizeUrl": oauth_client.build_authorize_url(provider, client_id, issued_state, redirect_uri)}

        def _handle_oauth_callback(self, provider: str, query: dict[str, list[str]]) -> None:
            """
            입력: provider 이름과 콜백 쿼리.
            출력: 브라우저용 HTML 브리지 응답.
            역할: state 검증, 코드 교환, 사용자 식별, 토큰 발급을 수행한다.
            호출 예시: self._handle_oauth_callback("naver", query)
            """
            try:
                if not oauth_client.is_supported_provider(provider):
                    raise ValueError("unsupported_provider")
                # 변수 의미: provider 자격증명이다.
                client_id, client_secret = self._provider_credentials(provider)
                # 변수 의미: 콜백 인가 코드다.
                code = first_query_value(query, "code")
                # 변수 의미: 콜백 state 값이다.
                returned_state = first_query_value(query, "state")
                if not code or not returned_state:
                    raise ValueError("missing_code_or_state")
                # 변수 의미: 소비한 state 부수 정보다.
                state_payload = state.oauth_state.consume(returned_state)
                if state_payload is None or state_payload.get("provider") != provider:
                    raise ValueError("invalid_state")
                # 변수 의미: 로그인 시작 때 사용한 redirect_uri다.
                redirect_uri = str(state_payload.get("redirect_uri", ""))
                # 변수 의미: provider access token이다.
                access_token = oauth_client.exchange_code(
                    provider, client_id, client_secret, code, returned_state, redirect_uri
                )
                # 변수 의미: 정규화된 provider 프로필이다.
                profile = oauth_client.fetch_profile(provider, access_token)
                if not profile["provider_user_id"]:
                    raise ValueError("empty_profile")
                # 변수 의미: baseline 사용자 ID다.
                user_id = state.repository.find_or_create_identity(
                    provider, profile["provider_user_id"], profile["display_name"] or None, profile["email"] or None
                )
                # 변수 의미: 저장했던 동의 정보다.
                consent = state_payload.get("consent", {})
                state.repository.record_user_consent(
                    user_id=user_id,
                    age_confirmed=bool(consent.get("age")),
                    privacy_consent=bool(consent.get("privacy")),
                    location_consent=bool(consent.get("location")),
                    consent_version="baseline-2026-07",
                )
                # 변수 의미: 프런트가 앱 토큰으로 교환할 단회 코드다.
                login_code = state.oauth_state.issue_login_code(user_id, provider, browser_nonce)
                self._send_oauth_bridge(f"/#oauth_code={quote(login_code)}")
            except Exception as error:
                self._send_oauth_bridge(f"/#oauth_error={quote(self._safe_error_code(error))}")

        def _safe_error_code(self, error: Exception) -> str:
            """
            입력: 콜백 처리 중 발생한 예외.
            출력: 프런트에 노출할 짧은 오류 코드.
            역할: 상세 예외 메시지 대신 안전한 코드만 전달한다.
            호출 예시: code = self._safe_error_code(error)
            """
            # 변수 의미: 프런트에 노출을 허용하는 오류 코드 집합이다.
            known = {"unsupported_provider", "missing_code_or_state", "invalid_state", "empty_profile"}
            # 변수 의미: 예외 메시지다.
            message = str(error).strip()
            return message if message in known else "login_failed"

        def _send_oauth_bridge(self, target: str) -> None:
            """
            입력: 브라우저가 이동할 fragment 포함 경로.
            출력: 자동 이동 HTML 응답.
            역할: 단회 코드 또는 오류를 URL fragment로 프런트에 전달한다.
            호출 예시: self._send_oauth_bridge("/#oauth_code=...")
            """
            # 변수 의미: 자동 이동 스크립트를 담은 HTML 본문이다.
            html = (
                "<!doctype html><meta charset=\"utf-8\">"
                "<title>로그인 처리 중</title>"
                f"<script>location.replace({json.dumps(target)})</script>"
                "<noscript>로그인을 완료하려면 자바스크립트를 켜세요.</noscript>"
            )
            # 변수 의미: HTML 응답 본문 바이트다.
            body = html.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self._send_common_headers("text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
```

**파일 3** — `tests/test_oauth_identity.py` (신규). 저장소 계층을 실제 테스트 DB로 검증한다(`test_baseline_service.py`의 setUp 방식).

```python
# Questbook OAuth 사용자 식별(find-or-create)을 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
import unittest

APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))

import data_services

from questbook_api.infrastructure.repository import QuestbookRepository


@unittest.skipUnless(data_services.SERVICES_AVAILABLE, "local PostgreSQL/Redis not available")
class OAuthIdentityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.database_url = data_services.ensure_test_database()
        data_services.reset_database(self.database_url)
        self.repository = QuestbookRepository(self.database_url)
        self.repository.initialize()

    def tearDown(self) -> None:
        self.repository.close()

    def test_same_identity_returns_same_user(self) -> None:
        first = self.repository.find_or_create_identity("naver", "naver-1", "탐험가", "a@b.com")
        second = self.repository.find_or_create_identity("naver", "naver-1", "탐험가2", "a2@b.com")
        self.assertEqual(first, second)
        self.assertEqual(self.repository.find_user_id_by_identity("naver", "naver-1"), first)

    def test_different_identity_creates_new_user(self) -> None:
        a = self.repository.find_or_create_identity("naver", "naver-1", None, None)
        b = self.repository.find_or_create_identity("google", "google-1", None, None)
        self.assertNotEqual(a, b)
        self.assertIsNone(self.repository.find_user_id_by_identity("naver", "missing"))


if __name__ == "__main__":
    unittest.main()
```

**검증**: `uv run pytest -v` (전체). 로컬 PostgreSQL/Redis가 없으면 identity 테스트는 skip된다 — 그럴 땐 `infra/local/postgres-redis.compose.yaml`로 먼저 띄운다.
**완료 기준**: 전체 테스트 통과(또는 서비스 없을 때 skip), `uv run questbook-api`로 기동 후 `curl -s localhost:8100/api/auth/providers`가 naver/google의 configured를 키 설정에 따라 반영.

---

### Task 4 — 프런트엔드와 게이트웨이 헤더 전달

**목적**: 동의 패널에 네이버·구글 버튼을 넣고, 콜백이 심은 `#oauth_code` fragment를 `sessionStorage` nonce와 함께 redeem한다. 게이트웨이는 upstream 보안·캐시 헤더를 보존한다.

**파일 1** — `apps/user-web/public/index.html` 수정

`<button ... id="demo-login-button">동의하고 시작</button>` 바로 아래에 추가:

```html
          <div class="oauth-login-list">
            <button class="social-login-button" type="button" id="naver-login-button">네이버로 시작</button>
            <button class="social-login-button" type="button" id="google-login-button">구글로 시작</button>
          </div>
```

**파일 2** — `apps/user-web/src/app.js` 수정 (3곳)

(a) `handleDemoLogin` 함수 아래에 추가:

```javascript
/**
 * 입력: provider 이름("naver" 또는 "google").
 * 출력: OAuth 로그인 시작 Promise.
 * 역할: 동의 3항목 검증 후 인가 URL을 받아 provider 로그인 페이지로 이동한다.
 * 호출 예시: await handleOAuthLogin("naver")
 */
async function handleOAuthLogin(provider) {
  // 만 14세 이상 확인 체크박스입니다.
  const ageInput = select("#age-confirmed");

  // 개인정보 동의 체크박스입니다.
  const privacyInput = select("#privacy-consent");

  // 위치정보 동의 체크박스입니다.
  const locationInput = select("#location-consent");

  if (!ageInput?.checked || !privacyInput?.checked || !locationInput?.checked) {
    setConsentMessage("세 항목을 모두 확인해야 로그인할 수 있습니다.");
    return;
  }

  // OAuth callback 검증에 사용할 브라우저 세션 nonce입니다.
  const oauthNonce = createOAuthNonce();
  if (!oauthNonce || !writeSessionValue(OAUTH_NONCE_KEY, oauthNonce)) {
    setConsentMessage("현재 브라우저에서는 보안 로그인 상태를 저장할 수 없습니다.");
    return;
  }

  setOAuthLoginPending(provider, true);
  setConsentMessage("로그인 페이지로 이동합니다.");

  try {
    // provider 로그인 시작 API 응답입니다.
    const payload = await fetchJson(`/api/auth/${provider}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ageConfirmed: true,
        privacyConsent: true,
        locationConsent: true,
        oauthNonce,
      }),
    });

    if (payload.authorizeUrl) {
      window.location.href = payload.authorizeUrl;
      return;
    }

    removeSessionValue(OAUTH_NONCE_KEY);
    setOAuthLoginPending(provider, false);
    setConsentMessage("로그인 시작에 필요한 이동 주소를 받지 못했습니다.");
  } catch (error) {
    removeSessionValue(OAUTH_NONCE_KEY);
    setOAuthLoginPending(provider, false);
    setConsentMessage("로그인 시작에 실패했습니다. 잠시 뒤 다시 시도하세요.");
  }
}

/**
 * 입력: callback fragment에서 받은 단회 OAuth code.
 * 출력: token 교환 Promise.
 * 역할: sessionStorage nonce와 단회 code를 서버에 보내 access token을 받는다.
 * 호출 예시: await redeemOAuthCode("code")
 */
async function redeemOAuthCode(oauthCode) {
  // 브라우저 세션에 저장된 OAuth nonce입니다.
  const oauthNonce = readSessionValue(OAUTH_NONCE_KEY) || "";
  if (!oauthCode || !oauthNonce) {
    removeSessionValue(OAUTH_NONCE_KEY);
    setConsentPanelVisible(true);
    setConsentMessage("로그인 검증 정보가 만료되었습니다. 다시 시도하세요.");
    return;
  }

  try {
    // OAuth code 교환 API 응답입니다.
    const payload = await fetchJson("/api/auth/oauth-code/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oauthCode, oauthNonce }),
    });
    state.accessToken = payload.accessToken || "";
    if (!state.accessToken) {
      throw new Error("missing access token");
    }
    writeStorageValue(ACCESS_TOKEN_KEY, state.accessToken);
    removeSessionValue(OAUTH_NONCE_KEY);
    setConsentPanelVisible(false);
    setConsentMessage("");
    await loadInitialData();
  } catch (error) {
    state.accessToken = "";
    removeStorageValue(ACCESS_TOKEN_KEY);
    removeSessionValue(OAUTH_NONCE_KEY);
    setConsentPanelVisible(true);
    setConsentMessage("로그인 검증에 실패했습니다. 다시 시도하세요.");
  }
}

/**
 * 입력: 없음.
 * 출력: 비동기 token 교환을 시작했는지 여부.
 * 역할: 콜백이 심은 URL fragment에서 단회 code 또는 오류를 읽어 처리하고 주소창을 정리한다.
 * 호출 예시: const pending = consumeOAuthRedirect()
 */
function consumeOAuthRedirect() {
  // 현재 주소의 fragment 문자열입니다.
  const hash = window.location.hash || "";

  if (hash.startsWith("#oauth_code=")) {
    // fragment에서 꺼낸 단회 OAuth code입니다.
    const oauthCode = decodeFragmentValue(hash.slice("#oauth_code=".length));
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setConsentPanelVisible(true);
    setConsentMessage("로그인을 검증하는 중입니다.");
    redeemOAuthCode(oauthCode);
    return true;
  }

  if (hash.startsWith("#oauth_error=")) {
    // fragment에서 꺼낸 오류 코드입니다.
    const reason = decodeFragmentValue(hash.slice("#oauth_error=".length)) || "login_failed";
    state.accessToken = "";
    removeStorageValue(ACCESS_TOKEN_KEY);
    removeSessionValue(OAUTH_NONCE_KEY);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setConsentPanelVisible(true);
    setConsentMessage(`로그인에 실패했습니다 (${reason}). 다시 시도하세요.`);
  }
  return false;
}
```

(b) `bindEvents()`의 `demoLoginButton` 등록 블록 아래에 추가:

```javascript
  // 네이버 로그인 버튼입니다.
  const naverLoginButton = select("#naver-login-button");
  if (naverLoginButton) {
    naverLoginButton.addEventListener("click", () => handleOAuthLogin("naver"));
  }

  // 구글 로그인 버튼입니다.
  const googleLoginButton = select("#google-login-button");
  if (googleLoginButton) {
    googleLoginButton.addEventListener("click", () => handleOAuthLogin("google"));
  }

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      setOAuthLoginPending("", false);
      setConsentMessage("");
    }
  });
```

(c) `initializeApp()`의 `registerServiceWorker();` 바로 다음 줄에 추가(뷰 라우팅보다 먼저 fragment를 처리해야 함):

```javascript
  consumeOAuthRedirect();
```

> CSS는 선택. `social-login-button`에 스타일이 없어도 동작한다. 통일감을 원하면 `assets`가 아니라 `apps/user-web/src/styles.css`에 최소 규칙을 추가한다(별도 검토).

**검증**: 정적 파일이라 pytest 없음. Task 5의 로컬 e2e로 확인한다. 문법 오류만 빠르게 보려면 `node --check apps/user-web/src/app.js`.
**완료 기준**: 로컬에서 동의 패널에 두 버튼이 보이고, 클릭 시 provider 로그인 페이지로 이동.

---

### Task 5 — 통합 검증과 배포

**목적**: 로컬에서 두 provider 왕복을 확인하고, 운영에 안전하게 반영한다.

**5-1. 로컬 데이터 서비스 기동** (프로젝트 루트에서)

```bash
docker compose -f infra/local/postgres-redis.compose.yaml up -d
```

**5-2. 로컬 `.env` 채우기** (프로젝트 루트 `.env`) — Task 1의 키에 실제 값 입력:

```ini
QUESTBOOK_PUBLIC_BASE_URL=http://localhost:8000
NAVER_OAUTH_CLIENT_ID=<네이버 로그인 Client ID>
NAVER_OAUTH_CLIENT_SECRET=<네이버 로그인 Client Secret>
GOOGLE_OAUTH_CLIENT_ID=<구글 OAuth 클라이언트 ID>
GOOGLE_OAUTH_CLIENT_SECRET=<구글 OAuth 보안 비밀번호>
```

**5-3. 앱 서버와 게이트웨이를 각각 실행** (터미널 2개)

```bash
# 터미널 A — 앱 API (포트 8100)
cd services/app-api && uv run questbook-api
```
```bash
# 터미널 B — 웹 게이트웨이 (포트 8000)
cd /home/ilhyeonchu/Documents/GitHub/Questbook_Dajeon && python3 services/web-gateway/gateway.py
```

**5-4. 브라우저 왕복 확인** — `http://localhost:8000`:

1. 동의 3항목 체크 → "네이버로 시작" → 네이버 로그인 → 앱으로 복귀, 홈 화면 로드
2. "구글로 시작"도 동일하게 확인(로그아웃 대신 localStorage 지우거나 시크릿 창)
3. 같은 계정으로 재로그인 → 뱃지·진행도가 유지되는 동일 사용자인지 확인
4. 전체 테스트: `cd services/app-api && uv run pytest -v` (모두 통과)

**5-5. 운영 배포** — 순서 주의(프런트는 웹 서버, 백엔드는 앱 서버):

1. 커밋·푸시(사용자가 직접). `.env`는 절대 커밋하지 않는다.
2. **qbook-app**(백엔드 라우트):
   ```bash
   cd /opt/Questbook_Daejeon && git pull
   # .env에 OAuth 5개 키 추가 + QUESTBOOK_PUBLIC_BASE_URL=https://www.travel-qbook.co.kr
   nano .env
   sudo systemctl restart questbook-api
   curl -s http://127.0.0.1:8100/api/auth/providers | python3 -m json.tool   # naver/google configured=true 확인
   ```
   (신규 파일은 editable 설치에 자동 반영되므로 `uv sync` 불필요. 의존성은 그대로다.)
3. **qbook-web**(프런트 정적 파일과 게이트웨이 헤더 전달 변경):
   ```bash
   cd /opt/Questbook_Daejeon && git pull
   ```
   서비스 워커 캐시 때문에 브라우저가 옛 `app.js`를 쓸 수 있으니, 시연 기기는 **강력 새로고침** 또는 PWA 재설치로 최신 파일을 받는다.
4. **콘솔 재확인**: 네이버·구글에 운영 Callback URL(`https://www.travel-qbook.co.kr/api/auth/{provider}/callback`)이 등록돼 있고, 시연 계정이 멤버/테스트 사용자로 등록돼 있는지.
5. 운영 도메인에서 두 provider 로그인 왕복 확인.

**완료 기준**: 로컬·운영 모두에서 네이버·구글 로그인이 홈 진입까지 동작, 재로그인 시 사용자 유지, 전체 pytest 통과.

**배포 시 흔한 오류**:
- `redirect_uri_mismatch` / 콜백 인증 오류 → 콘솔 등록값과 `QUESTBOOK_PUBLIC_BASE_URL` 기반 값이 문자 단위로 일치하는지(`http`/`https`, 포트, 경로).
- 로그인 후 흰 화면 → 프런트가 옛 캐시. 강력 새로고침.
- `#oauth_error=login_failed` → 앱 서버 `journalctl -u questbook-api -n 50`로 예외 확인(키 오타, 시간대, provider 검수 상태).

## 리스크와 주의점

- **Naver 검수**: 개발 중 상태는 등록 멤버만 로그인 가능. 발표에서 관객이 직접 네이버 로그인하는 시나리오면 미리 검수 신청하거나 시연은 발표자 계정으로 한정
- **Google 테스트 모드**: 동일하게 테스트 사용자만 허용. 시연 계정을 반드시 사전 등록·리허설
- **게이트웨이 헤더 전달 누락 시** callback HTML의 `no-store`·CSP 또는 API 응답의 `Vary`가 빠질 수 있음 → Task 4를 Task 3 검증 전에 로컬에서 함께 확인
- **redirect_uri 불일치 오류**: 콘솔 등록값과 서버 구성값이 문자 하나까지 같아야 함 (`http`/`https`, 포트, 경로)
- 토큰 만료 120분: 시연 직전 재로그인으로 충분, 리프레시 토큰은 범위 외

## 진행 상태

- [ ] 콘솔 사전 준비 (Google / Naver)
- [ ] Task 1 설정·state 저장소
- [ ] Task 2 provider 클라이언트
- [ ] Task 3 라우트·저장소
- [ ] Task 4 게이트웨이·프런트
- [ ] Task 5 통합 검증·배포
