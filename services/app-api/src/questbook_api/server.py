# Questbook baseline 앱 API HTTP 서버를 제공한다.
from __future__ import annotations

from dataclasses import dataclass
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen

from questbook_api.application.baseline_service import BaselineQuestbookService
from questbook_api.domain.auth.tokens import create_access_token, verify_access_token
from questbook_api.infrastructure.cache import TourPlaceRedisCache
from questbook_api.infrastructure.oauth_state import OAuthStateError, OAuthStateStore
from questbook_api.infrastructure.repository import QuestbookRepository
from questbook_api.integrations.oauth import client as oauth_client
from questbook_api.integrations.tourapi.client import TourApiClient
from questbook_api.settings import AppSettings


# 변수 의미: NAVER Maps REST API 기본 URL이다.
NAVER_OPENAPI_BASE_URL = "https://naveropenapi.apigw.ntruss.com"
# 변수 의미: NAVER Geocoding API 경로다.
NAVER_GEOCODE_PATH = "/map-geocode/v2/geocode"
# 변수 의미: NAVER Reverse Geocoding API 경로다.
NAVER_REVERSE_GEOCODE_PATH = "/map-reversegeocode/v2/gc"
# 변수 의미: NAVER REST API 상위 요청 제한 시간 초 단위 값이다.
NAVER_UPSTREAM_TIMEOUT_SECONDS = 8
# 변수 의미: Geocoding API에 허용할 언어 코드다.
ALLOWED_GEOCODE_LANGUAGES = {"kor", "eng"}
# 변수 의미: Reverse Geocoding API에 허용할 변환 대상이다.
ALLOWED_REVERSE_ORDERS = {"legalcode", "admcode", "addr", "roadaddr"}


@dataclass(frozen=True)
class AppState:
    """
    입력: 설정, 저장소, 캐시, 서비스, OAuth state 저장소.
    출력: HTTP 핸들러가 공유하는 앱 상태.
    역할: 전역 변수 없이 요청 핸들러에 의존성을 전달한다.
    호출 예시: state = AppState(settings, repository, cache, service, oauth_state)
    """

    # 변수 의미: 앱 API 실행 설정이다.
    settings: AppSettings
    # 변수 의미: 관계형 저장소다.
    repository: QuestbookRepository
    # 변수 의미: TourAPI 임시 캐시다.
    cache: TourPlaceRedisCache
    # 변수 의미: baseline 유스케이스 서비스다.
    service: BaselineQuestbookService
    # 변수 의미: OAuth 로그인 state 저장소다.
    oauth_state: OAuthStateStore


def build_json_bytes(payload: dict[str, Any]) -> bytes:
    """
    입력: JSON 직렬화 가능한 딕셔너리.
    출력: UTF-8 JSON 바이트.
    역할: API 응답 형식을 일관되게 만든다.
    호출 예시: response_body = build_json_bytes({\"ok\": True})
    """
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def parse_float_query(query: dict[str, list[str]], name: str, default: float) -> float:
    """
    입력: 쿼리 딕셔너리, 필드 이름, 기본값.
    출력: 파싱된 실수 값.
    역할: 잘못된 좌표 입력을 기본 좌표로 대체한다.
    호출 예시: latitude = parse_float_query(query, \"lat\", 36.327)
    """
    try:
        # 변수 의미: 쿼리에서 읽은 첫 번째 값이다.
        raw_value = query.get(name, [str(default)])[0]
        return float(raw_value)
    except (TypeError, ValueError):
        return default


def parse_int_query(query: dict[str, list[str]], name: str, default: int, minimum: int, maximum: int) -> int:
    """
    입력: 쿼리 딕셔너리, 필드 이름, 기본값, 최솟값, 최댓값.
    출력: 범위 안으로 보정한 정수 값.
    역할: 검색 반경 같은 숫자 입력을 안전하게 처리한다.
    호출 예시: radius = parse_int_query(query, \"radiusMeters\", 5000, 100, 20000)
    """
    try:
        # 변수 의미: 쿼리에서 읽은 첫 번째 값이다.
        raw_value = query.get(name, [str(default)])[0]
        # 변수 의미: 파싱된 정수 값이다.
        parsed_value = int(raw_value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed_value))


def first_query_value(query: dict[str, list[str]], name: str, default: str = "") -> str:
    """
    입력: 파싱된 쿼리 딕셔너리, 필드 이름, 기본값.
    출력: 첫 번째 쿼리 파라미터 값.
    역할: NAVER 프록시 라우트에서 parse_qs의 리스트 값을 단일 값으로 정규화한다.
    호출 예시: query_text = first_query_value(query, "query")
    """
    # 변수 의미: 요청한 필드에 해당하는 모든 쿼리 값이다.
    values = query.get(name, [])
    return values[0].strip() if values else default


def is_safe_oauth_nonce(value: str) -> bool:
    """
    입력: 브라우저가 생성한 OAuth nonce 후보.
    출력: 허용 가능한 nonce 여부.
    역할: callback 브리지에서 브라우저 세션과 state를 바인딩할 값을 검증한다.
    호출 예시: if not is_safe_oauth_nonce(browser_nonce): ...
    """
    if len(value) < 32 or len(value) > 128:
        return False
    # 변수 의미: nonce에 허용할 URL 안전 문자 집합이다.
    allowed_characters = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    return all(character in allowed_characters for character in value)


def parse_required_float(raw_value: str, name: str, minimum: float, maximum: float) -> float:
    """
    입력: 원본 숫자 문자열, 파라미터 이름, 최솟값, 최댓값.
    출력: 검증된 실수 값.
    역할: 필수 위도와 경도 값을 NAVER API 요청 전에 검증한다.
    호출 예시: latitude = parse_required_float("36.327", "lat", -90.0, 90.0)
    """
    if not raw_value:
        raise ValueError(f"{name} is required.")
    try:
        # 변수 의미: 파싱된 부동소수점 값이다.
        parsed_value = float(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} must be a number.") from error
    if parsed_value < minimum or parsed_value > maximum:
        raise ValueError(f"{name} is outside the supported range.")
    return parsed_value


def normalize_coordinate_pair(raw_value: str) -> str:
    """
    입력: 원본 경도,위도 좌표 문자열.
    출력: 정규화된 좌표 문자열 또는 빈 문자열.
    역할: Geocoding 전달 전에 선택적 근접 좌표를 안전하게 정리한다.
    호출 예시: coordinate = normalize_coordinate_pair("127.427,36.327")
    """
    if not raw_value or "," not in raw_value:
        return ""

    # 변수 의미: 분리된 좌표 토큰이다.
    parts = raw_value.split(",", 1)
    try:
        # 변수 의미: 경도 토큰이다.
        longitude = parse_required_float(parts[0].strip(), "coordinate longitude", -180.0, 180.0)
        # 변수 의미: 위도 토큰이다.
        latitude = parse_required_float(parts[1].strip(), "coordinate latitude", -90.0, 90.0)
    except ValueError:
        return ""
    return f"{longitude:.7f},{latitude:.7f}"


def build_naver_headers(settings: AppSettings, accept: str | None = None) -> dict[str, str]:
    """
    입력: 앱 설정과 선택적 Accept 헤더 값.
    출력: NAVER Maps REST API에 필요한 헤더.
    역할: 비밀 키를 브라우저에 노출하지 않고 서버 요청에만 사용한다.
    호출 예시: headers = build_naver_headers(settings, "application/json")
    """
    if not settings.naver_maps_key_id or not settings.naver_maps_key:
        raise RuntimeError("NAVER Maps REST API credentials are missing.")

    # 변수 의미: 상위 API 요청 헤더다.
    headers = {
        "x-ncp-apigw-api-key-id": settings.naver_maps_key_id,
        "x-ncp-apigw-api-key": settings.naver_maps_key,
    }
    if accept:
        headers["Accept"] = accept
    return headers


def request_naver_upstream(settings: AppSettings, path: str, params: dict[str, Any]) -> tuple[bytes, str, int]:
    """
    입력: 앱 설정, NAVER API 경로, 쿼리 파라미터.
    출력: 응답 바이트, 콘텐츠 타입, 상위 HTTP 상태 코드.
    역할: NAVER Open API에 제한 시간 안에서 서버 측 요청을 보낸다.
    호출 예시: body, content_type, status = request_naver_upstream(settings, NAVER_GEOCODE_PATH, params)
    """
    # 변수 의미: 인코딩된 쿼리 문자열이다.
    query_string = urlencode(params, doseq=True)
    # 변수 의미: 완성된 NAVER 상위 API URL이다.
    upstream_url = f"{NAVER_OPENAPI_BASE_URL}{path}?{query_string}"
    # 변수 의미: 준비된 상위 API 요청 객체다.
    request = Request(upstream_url, headers=build_naver_headers(settings, "application/json"))

    try:
        with urlopen(request, timeout=NAVER_UPSTREAM_TIMEOUT_SECONDS) as response:
            # 변수 의미: 상위 API 응답 콘텐츠 타입이다.
            content_type = response.headers.get("Content-Type", "application/json; charset=utf-8")
            # 변수 의미: 상위 API 응답 상태 코드다.
            status_code = response.status
            # 변수 의미: 상위 API 응답 본문이다.
            response_body = response.read()
            return response_body, content_type, status_code
    except HTTPError as error:
        # 변수 의미: 상위 API 오류 응답 본문이다.
        error_body = error.read()
        # 변수 의미: 상위 API 오류 응답 콘텐츠 타입이다.
        error_content_type = error.headers.get("Content-Type", "application/json; charset=utf-8")
        return error_body, error_content_type, error.code
    except URLError as error:
        raise RuntimeError(f"NAVER Maps upstream request failed: {error.reason}") from error


def create_handler(state: AppState) -> type[BaseHTTPRequestHandler]:
    """
    입력: 앱 상태 객체.
    출력: AppState를 캡처한 HTTP 요청 핸들러 클래스.
    역할: 표준 라이브러리 HTTP 서버에서 의존성 주입을 가능하게 한다.
    호출 예시: handler_class = create_handler(state)
    """

    class QuestbookApiHandler(BaseHTTPRequestHandler):
        """
        입력: HTTP 요청.
        출력: JSON API 응답.
        역할: baseline 앱 API 라우트를 처리한다.
        호출 예시: ThreadingHTTPServer((host, port), QuestbookApiHandler)
        """

        server_version = "QuestbookBaselineApi/0.1"

        def do_OPTIONS(self) -> None:
            """
            입력: CORS preflight 요청.
            출력: 허용 헤더 응답.
            역할: 로컬 개발에서 브라우저 API 요청을 허용한다.
            호출 예시: OPTIONS /api/recommendations
            """
            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_common_headers("application/json")
            self.end_headers()

        def do_GET(self) -> None:
            """
            입력: GET 요청.
            출력: JSON API 응답.
            역할: 헬스체크, 사용자, 추천, 뱃지, 수첩, 꿈돌이 조회를 라우팅한다.
            호출 예시: GET /api/recommendations?lat=36.327&lng=127.427
            """
            # 변수 의미: 파싱된 요청 URL이다.
            parsed_url = urlparse(self.path)
            # 변수 의미: 요청 경로다.
            path = parsed_url.path
            # 변수 의미: 파싱된 쿼리 파라미터다.
            query = parse_qs(parsed_url.query)
            try:
                if path in {"/health", "/api/health"}:
                    self._send_json(HTTPStatus.OK, self._health_payload())
                    return
                if path == "/api/auth/providers":
                    self._send_json(HTTPStatus.OK, self._auth_providers_payload())
                    return
                # 변수 의미: OAuth 콜백 경로 토큰이다. (/api/auth/{provider}/callback)
                auth_parts = [part for part in path.split("/") if part]
                if len(auth_parts) == 4 and auth_parts[:2] == ["api", "auth"] and auth_parts[3] == "callback":
                    self._handle_oauth_callback(auth_parts[2], query)
                    return
                if path == "/api/me":
                    # 변수 의미: 토큰에서 검증한 사용자 ID다.
                    user_id = self._required_user_id()
                    self._send_json(HTTPStatus.OK, {"user": state.service.bootstrap_user(user_id)})
                    return
                if path == "/api/recommendations":
                    user_id = self._required_user_id()
                    # 변수 의미: 기준 위도다.
                    latitude = parse_float_query(query, "lat", 36.327)
                    # 변수 의미: 기준 경도다.
                    longitude = parse_float_query(query, "lng", 127.427)
                    # 변수 의미: 요청 카테고리 키다.
                    category_key = query.get("category", ["all"])[0]
                    # 변수 의미: 추천 검색 반경이다.
                    radius_meters = parse_int_query(query, "radiusMeters", 5000, 100, 20000)
                    # 변수 의미: 명시적 새로고침 여부다.
                    force_refresh = query.get("refresh", ["0"])[0] in {"1", "true", "yes"}
                    self._send_json(
                        HTTPStatus.OK,
                        state.service.get_recommendations(
                            user_id,
                            latitude,
                            longitude,
                            category_key,
                            radius_meters,
                            force_refresh,
                        ),
                    )
                    return
                if path == "/api/badges":
                    user_id = self._required_user_id()
                    state.service.bootstrap_user(user_id)
                    self._send_json(HTTPStatus.OK, {"badges": state.repository.list_badges(user_id)})
                    return
                if path == "/api/notes":
                    user_id = self._required_user_id()
                    state.service.bootstrap_user(user_id)
                    self._send_json(HTTPStatus.OK, {"notes": state.repository.list_notes(user_id)})
                    return
                if path == "/api/ggumdori":
                    user_id = self._required_user_id()
                    state.service.bootstrap_user(user_id)
                    self._send_json(HTTPStatus.OK, state.repository.list_ggumdori(user_id))
                    return
                if path == "/api/naver-map/config":
                    # 변수 의미: 브라우저에서 Dynamic Map을 로드할 수 있는지 여부다.
                    dynamic_map_configured = bool(state.settings.naver_maps_key_id)
                    # 변수 의미: 서버 프록시가 NAVER REST API를 호출할 수 있는지 여부다.
                    rest_api_configured = bool(state.settings.naver_maps_key_id and state.settings.naver_maps_key)
                    self._send_json(
                        HTTPStatus.OK,
                        {
                            "configured": dynamic_map_configured,
                            "dynamicMapConfigured": dynamic_map_configured,
                            "restApiConfigured": rest_api_configured,
                            "keyId": state.settings.naver_maps_key_id,
                            "restProxyEnabled": rest_api_configured,
                            "requiredEnv": ["NAVER_MAPS_API_KEY_ID", "NAVER_MAPS_API_KEY"],
                        },
                    )
                    return
                if path == "/api/naver-map/geocode":
                    self._handle_naver_geocode(query)
                    return
                if path == "/api/naver-map/reverse-geocode":
                    self._handle_naver_reverse_geocode(query)
                    return
            except PermissionError as error:
                self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized", "message": str(error)})
                return
            except Exception as error:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error", "message": str(error)})
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def do_POST(self) -> None:
            """
            입력: POST 요청.
            출력: JSON API 응답.
            역할: 퀘스트 수락과 완료 요청을 라우팅한다.
            호출 예시: POST /api/quests/uqi_x/complete
            """
            # 변수 의미: 파싱된 요청 URL이다.
            parsed_url = urlparse(self.path)
            # 변수 의미: 요청 경로 토큰이다.
            path_parts = [part for part in parsed_url.path.split("/") if part]
            try:
                if path_parts == ["api", "auth", "demo-login"]:
                    # 변수 의미: demo-social 로그인 요청 본문이다.
                    payload = self._read_json_body()
                    self._send_json(HTTPStatus.OK, self._handle_demo_login(payload))
                    return
                if len(path_parts) == 4 and path_parts[:2] == ["api", "auth"] and path_parts[3] == "start":
                    # 변수 의미: OAuth 로그인 시작 요청 본문이다.
                    payload = self._read_json_body()
                    self._send_json(HTTPStatus.OK, self._handle_oauth_start(path_parts[2], payload))
                    return
                if path_parts == ["api", "auth", "oauth-code", "redeem"]:
                    # 변수 의미: OAuth callback 이후 앱 토큰 교환 요청 본문이다.
                    payload = self._read_json_body()
                    self._send_json(HTTPStatus.OK, self._handle_oauth_code_redeem(payload))
                    return
                if len(path_parts) == 4 and path_parts[:2] == ["api", "quests"]:
                    # 변수 의미: 토큰에서 검증한 사용자 ID다.
                    user_id = self._required_user_id()
                    # 변수 의미: 사용자별 퀘스트 인스턴스 ID다.
                    instance_id = path_parts[2]
                    # 변수 의미: 퀘스트 액션 이름이다.
                    action = path_parts[3]
                    if action == "accept":
                        self._send_json(HTTPStatus.OK, state.service.accept_quest(user_id, instance_id))
                        return
                    if action == "complete":
                        # 변수 의미: JSON 요청 본문이다.
                        payload = self._read_json_body()
                        self._send_json(HTTPStatus.OK, state.service.complete_quest(user_id, instance_id, payload))
                        return
            except PermissionError as error:
                self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized", "message": str(error)})
                return
            except OAuthStateError:
                self._send_json(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    {"error": "oauth_state_unavailable", "message": "로그인 상태 저장소에 연결할 수 없습니다."},
                )
                return
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "bad_request", "message": str(error)})
                return
            except Exception as error:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error", "message": str(error)})
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def log_message(self, format: str, *args: Any) -> None:
            """
            입력: 표준 HTTP 로그 포맷과 인자.
            출력: 없음.
            역할: 기본 요청 로그를 간결하게 유지한다.
            호출 예시: self.log_message(\"%s\", \"ok\")
            """
            return

        def _health_payload(self) -> dict[str, Any]:
            """
            입력: 없음.
            출력: 헬스체크 응답 딕셔너리.
            역할: 앱 서버, DB, 캐시 상태를 확인한다.
            호출 예시: payload = self._health_payload()
            """
            return {
                "status": "ok",
                "service": "questbook-app-api",
                "database": {"ok": state.repository.is_healthy(), "engine": "postgresql"},
                "cache": {
                    "ok": state.cache.is_healthy(),
                    "engine": "redis",
                    "entries": state.cache.size(),
                    "ttlSeconds": state.cache.default_ttl_seconds,
                },
                "externalApis": {"tourapi": state.service.tour_client.status()},
            }

        def _auth_providers_payload(self) -> dict[str, Any]:
            """
            입력: 없음.
            출력: 로그인 provider 설정 상태 응답.
            역할: 프런트가 사용할 수 있는 로그인 방식을 표시하게 한다.
            호출 예시: payload = self._auth_providers_payload()
            """
            # 변수 의미: 네이버 OAuth 자격증명 설정 여부다.
            naver_configured = bool(state.settings.naver_oauth_client_id and state.settings.naver_oauth_client_secret)
            # 변수 의미: 구글 OAuth 자격증명 설정 여부다.
            google_configured = bool(state.settings.google_oauth_client_id and state.settings.google_oauth_client_secret)
            return {
                "providers": [
                    {
                        "id": "demo-social",
                        "label": "데모 소셜 로그인",
                        "configured": True,
                        "description": "로컬 baseline 검증용 provider입니다.",
                    },
                    {"id": "naver", "label": "네이버", "configured": naver_configured},
                    {"id": "google", "label": "구글", "configured": google_configured},
                ]
            }

        def _required_user_id(self) -> str:
            """
            입력: HTTP 요청 헤더.
            출력: 서버가 사용할 사용자 ID.
            역할: Authorization Bearer 토큰을 검증하고 사용자 신원을 추출한다.
            호출 예시: user_id = self._required_user_id()
            """
            # 변수 의미: Authorization 헤더 값이다.
            authorization = self.headers.get("Authorization", "")
            if not authorization.startswith("Bearer "):
                raise PermissionError("Authorization Bearer token is required.")
            # 변수 의미: Bearer 접두사를 제거한 토큰 값이다.
            token = authorization.removeprefix("Bearer ").strip()
            try:
                # 변수 의미: 검증된 토큰 payload다.
                payload = verify_access_token(token, state.settings.jwt_secret)
            except ValueError as error:
                raise PermissionError(str(error)) from error
            return str(payload["sub"])

        def _handle_demo_login(self, payload: dict[str, Any]) -> dict[str, Any]:
            """
            입력: demo-social 로그인 요청 본문.
            출력: access token과 사용자 상태.
            역할: 실제 OAuth/OIDC 키 없이 baseline 인증·동의·연령 확인 경계를 구현한다.
            호출 예시: response = self._handle_demo_login({\"ageConfirmed\": True, ...})
            """
            # 변수 의미: 만 14세 이상 확인 여부다.
            age_confirmed = bool(payload.get("ageConfirmed"))
            # 변수 의미: 개인정보 수집·이용 동의 여부다.
            privacy_consent = bool(payload.get("privacyConsent"))
            # 변수 의미: 위치정보 수집·이용 동의 여부다.
            location_consent = bool(payload.get("locationConsent"))
            if not age_confirmed:
                raise ValueError("만 14세 이상 확인이 필요합니다.")
            if not privacy_consent or not location_consent:
                raise ValueError("개인정보와 위치정보 수집·이용 동의가 필요합니다.")

            # 변수 의미: demo-social provider 사용자 ID다.
            provider_user_id = str(payload.get("providerUserId") or "demo-user")
            # 변수 의미: baseline 사용자 ID다.
            user_id = "demo-user"
            # 변수 의미: demo 사용자 표시 이름이다.
            display_name = str(payload.get("displayName") or "꼬마 탐험가")
            state.repository.ensure_user(user_id)
            state.repository.link_user_account(
                user_id=user_id,
                provider="demo-social",
                provider_user_id=provider_user_id,
                display_name=display_name,
                email=None,
            )
            # 변수 의미: 저장된 사용자 동의 상태다.
            consent = state.repository.record_user_consent(
                user_id=user_id,
                age_confirmed=age_confirmed,
                privacy_consent=privacy_consent,
                location_consent=location_consent,
                consent_version="baseline-2026-07",
            )
            # 변수 의미: 서명된 access token이다.
            access_token = create_access_token(user_id, "demo-social", state.settings.jwt_secret)
            return {
                "accessToken": access_token,
                "tokenType": "Bearer",
                "provider": "demo-social",
                "user": state.repository.get_user(user_id),
                "consent": consent,
            }

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
            # 변수 의미: 브라우저 세션에 저장해 callback에서 확인할 nonce다.
            browser_nonce = str(payload.get("oauthNonce") or "").strip()
            if not is_safe_oauth_nonce(browser_nonce):
                raise ValueError("invalid oauth nonce")
            # 변수 의미: provider 콜백 redirect_uri다.
            redirect_uri = f"{state.settings.public_base_url}/api/auth/{provider}/callback"
            # 변수 의미: 발급한 단회 state 값이다.
            issued_state = state.oauth_state.issue(provider, redirect_uri, consent, browser_nonce)
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
                # 변수 의미: 콜백 state 값이다.
                returned_state = first_query_value(query, "state")
                if not returned_state:
                    raise ValueError("missing_code_or_state")
                # 변수 의미: 소비한 state 부수 정보다.
                state_payload = state.oauth_state.consume(returned_state)
                if state_payload is None or state_payload.get("provider") != provider:
                    raise ValueError("invalid_state")
                # 변수 의미: provider가 콜백으로 돌려준 OAuth 오류 코드다.
                provider_error = first_query_value(query, "error")
                if provider_error:
                    raise ValueError("provider_denied")
                # 변수 의미: 콜백 인가 코드다.
                code = first_query_value(query, "code")
                if not code:
                    raise ValueError("missing_code_or_state")
                # 변수 의미: 로그인 시작 때 사용한 redirect_uri다.
                redirect_uri = str(state_payload.get("redirect_uri", ""))
                # 변수 의미: 로그인 시작 브라우저와 callback 브라우저를 묶는 nonce다.
                browser_nonce = str(state_payload.get("browser_nonce") or "")
                if not is_safe_oauth_nonce(browser_nonce):
                    raise ValueError("invalid_state")
                # 변수 의미: provider access token이다.
                access_token = oauth_client.exchange_code(
                    provider,
                    client_id,
                    client_secret,
                    code,
                    returned_state,
                    redirect_uri,
                )
                # 변수 의미: 정규화된 provider 프로필이다.
                profile = oauth_client.fetch_profile(provider, access_token)
                if not profile["provider_user_id"]:
                    raise ValueError("empty_profile")
                # 변수 의미: baseline 사용자 ID다.
                user_id = state.repository.find_or_create_identity(
                    provider,
                    profile["provider_user_id"],
                    profile["display_name"] or None,
                    profile["email"] or None,
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
                # 변수 의미: 프런트에 전달할 안전한 오류 코드다.
                safe_error_code = self._safe_error_code(error)
                # 변수 의미: 운영 감시에서 서버성 실패를 구분하기 위한 HTTP 상태다.
                status = HTTPStatus.OK if safe_error_code != "login_failed" else HTTPStatus.INTERNAL_SERVER_ERROR
                print(f"OAuth callback failed: {safe_error_code}")
                self._send_oauth_bridge(f"/#oauth_error={quote(safe_error_code)}", status)

        def _handle_oauth_code_redeem(self, payload: dict[str, Any]) -> dict[str, Any]:
            """
            입력: OAuth callback에서 받은 단회 코드와 브라우저 nonce.
            출력: 앱 access token 응답.
            역할: callback HTML에 JWT를 담지 않고 같은 브라우저 세션에서만 토큰을 교환한다.
            호출 예시: response = self._handle_oauth_code_redeem(payload)
            """
            # 변수 의미: callback fragment에서 받은 단회 코드다.
            login_code = str(payload.get("oauthCode") or "").strip()
            # 변수 의미: 브라우저 sessionStorage에서 읽은 nonce다.
            browser_nonce = str(payload.get("oauthNonce") or "").strip()
            if not login_code or not is_safe_oauth_nonce(browser_nonce):
                raise ValueError("invalid oauth code")
            # 변수 의미: 소비한 단회 코드 payload다.
            code_payload = state.oauth_state.consume_login_code(login_code)
            if code_payload is None or code_payload.get("browser_nonce") != browser_nonce:
                raise ValueError("invalid oauth code")
            # 변수 의미: baseline 사용자 ID다.
            user_id = str(code_payload.get("user_id") or "")
            # 변수 의미: 로그인 provider 이름이다.
            provider = str(code_payload.get("provider") or "")
            if not user_id or not oauth_client.is_supported_provider(provider):
                raise ValueError("invalid oauth code")
            # 변수 의미: 서명된 baseline access token이다.
            app_token = create_access_token(user_id, provider, state.settings.jwt_secret)
            return {"accessToken": app_token, "tokenType": "Bearer", "provider": provider}

        def _safe_error_code(self, error: Exception) -> str:
            """
            입력: 콜백 처리 중 발생한 예외.
            출력: 프런트에 노출할 짧은 오류 코드.
            역할: 상세 예외 메시지 대신 안전한 코드만 전달한다.
            호출 예시: code = self._safe_error_code(error)
            """
            # 변수 의미: 프런트에 노출을 허용하는 오류 코드 집합이다.
            known = {
                "unsupported_provider",
                "missing_code_or_state",
                "invalid_state",
                "empty_profile",
                "provider_denied",
            }
            # 변수 의미: 예외 메시지다.
            message = str(error).strip()
            return message if message in known else "login_failed"

        def _send_oauth_bridge(self, target: str, status: HTTPStatus = HTTPStatus.OK) -> None:
            """
            입력: 브라우저가 이동할 fragment 포함 경로.
            출력: 자동 이동 HTML 응답.
            역할: 단회 코드 또는 오류를 URL fragment로 프런트에 전달한다.
            호출 예시: self._send_oauth_bridge("/#oauth_code=...")
            """
            # 변수 의미: 자동 이동 스크립트다.
            script = f"location.replace({json.dumps(target)})"
            self._send_oauth_html(script, status)

        def _send_oauth_html(self, script: str, status: HTTPStatus) -> None:
            """
            입력: 브라우저에서 실행할 스크립트와 HTTP 상태.
            출력: 자동 이동 HTML 응답.
            역할: OAuth callback 응답에 wildcard CORS 없이 no-store 보안 헤더를 붙인다.
            호출 예시: self._send_oauth_html(script, HTTPStatus.OK)
            """
            # 변수 의미: 자동 이동 스크립트를 담은 HTML 본문이다.
            html = (
                '<!doctype html><meta charset="utf-8">'
                "<title>로그인 처리 중</title>"
                f"<script>{script}</script>"
                "<noscript>로그인을 완료하려면 자바스크립트를 켜세요.</noscript>"
            )
            # 변수 의미: HTML 응답 본문 바이트다.
            body = html.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _handle_naver_geocode(self, query: dict[str, list[str]]) -> None:
            """
            입력: 주소 검색어가 포함된 쿼리 딕셔너리.
            출력: NAVER에서 받은 JSON Geocoding 응답.
            역할: 브라우저 주소 검색을 서버 프록시로 처리해 REST API Key를 숨긴다.
            호출 예시: GET /api/naver-map/geocode?query=대전역
            """
            # 변수 의미: Geocoding에 사용할 주소 텍스트다.
            query_text = first_query_value(query, "query")
            if not query_text:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "query is required."})
                return

            # 변수 의미: 요청된 응답 언어다.
            language = first_query_value(query, "language", "kor").lower()
            if language not in ALLOWED_GEOCODE_LANGUAGES:
                language = "kor"

            # 변수 의미: Geocoding 요청 파라미터다.
            upstream_params: dict[str, Any] = {
                "query": query_text,
                "language": language,
                "page": parse_int_query(query, "page", 1, 1, 1000),
                "count": parse_int_query(query, "count", 5, 1, 100),
            }
            # 변수 의미: 선택적으로 전달할 근접 좌표다.
            coordinate = normalize_coordinate_pair(first_query_value(query, "coordinate"))
            if coordinate:
                upstream_params["coordinate"] = coordinate

            self._forward_naver_json_response(NAVER_GEOCODE_PATH, upstream_params)

        def _handle_naver_reverse_geocode(self, query: dict[str, list[str]]) -> None:
            """
            입력: 위도와 경도가 포함된 쿼리 딕셔너리.
            출력: NAVER에서 받은 JSON Reverse Geocoding 응답.
            역할: 좌표를 법정동, 행정동, 도로명 주소 데이터로 변환한다.
            호출 예시: GET /api/naver-map/reverse-geocode?lat=36.327&lng=127.427
            """
            try:
                # 변수 의미: Reverse Geocoding에 사용할 위도 값이다.
                latitude = parse_required_float(first_query_value(query, "lat"), "lat", -90.0, 90.0)
                # 변수 의미: Reverse Geocoding에 사용할 경도 값이다.
                longitude = parse_required_float(first_query_value(query, "lng"), "lng", -180.0, 180.0)
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return

            # 변수 의미: 요청된 Reverse Geocoding orders 값이다.
            orders = first_query_value(query, "orders", "roadaddr,addr,admcode,legalcode")
            # 변수 의미: 검증된 Reverse Geocoding order 값 목록이다.
            validated_orders = [order for order in orders.split(",") if order in ALLOWED_REVERSE_ORDERS]
            if not validated_orders:
                validated_orders = ["roadaddr", "addr", "admcode", "legalcode"]

            # 변수 의미: Reverse Geocoding 요청 파라미터다.
            upstream_params = {
                "request": "coordsToaddr",
                "coords": f"{longitude:.7f},{latitude:.7f}",
                "sourcecrs": "epsg:4326",
                "orders": ",".join(validated_orders),
                "output": "json",
            }
            self._forward_naver_json_response(NAVER_REVERSE_GEOCODE_PATH, upstream_params)

        def _forward_naver_json_response(self, path: str, params: dict[str, Any]) -> None:
            """
            입력: NAVER JSON API 경로와 쿼리 파라미터.
            출력: NAVER JSON 응답 또는 오류 페이로드.
            역할: Geocoding과 Reverse Geocoding 응답 전달 로직을 공유한다.
            호출 예시: self._forward_naver_json_response(NAVER_GEOCODE_PATH, {"query": "대전역"})
            """
            try:
                # 변수 의미: 상위 API에서 받은 JSON 응답 정보다.
                response_body, content_type, status_code = request_naver_upstream(state.settings, path, params)
            except RuntimeError as error:
                self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
                return

            self.send_response(status_code)
            self._send_common_headers(content_type or "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)

        def _read_json_body(self) -> dict[str, Any]:
            """
            입력: HTTP 요청 본문.
            출력: 파싱된 JSON 딕셔너리.
            역할: POST API 요청 본문을 안전하게 읽는다.
            호출 예시: payload = self._read_json_body()
            """
            # 변수 의미: Content-Length 헤더 값이다.
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                return {}
            # 변수 의미: 요청 본문 바이트다.
            body_bytes = self.rfile.read(content_length)
            try:
                # 변수 의미: JSON으로 파싱한 요청 본문이다.
                payload = json.loads(body_bytes.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return {}
            return payload if isinstance(payload, dict) else {}

        def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            """
            입력: HTTP 상태와 JSON 페이로드.
            출력: JSON HTTP 응답.
            역할: 모든 API 응답의 헤더와 본문 작성을 통일한다.
            호출 예시: self._send_json(HTTPStatus.OK, {\"ok\": True})
            """
            # 변수 의미: JSON 응답 본문이다.
            response_body = build_json_bytes(payload)
            self.send_response(status)
            self._send_common_headers("application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Vary", "Authorization")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)

        def _send_cors_headers(self) -> None:
            """
            입력: 요청 Origin 헤더.
            출력: 없음.
            역할: 명시적으로 허용한 프런트 origin에만 CORS 응답 헤더를 추가한다.
            호출 예시: self._send_cors_headers()
            """
            # 변수 의미: 브라우저가 보낸 Origin 헤더다.
            origin = self.headers.get("Origin", "")
            if origin != state.settings.public_base_url:
                return
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Vary", "Origin")

        def _send_common_headers(self, content_type: str) -> None:
            """
            입력: 응답 Content-Type 값.
            출력: 없음.
            역할: 보안 헤더와 로컬 개발 CORS 헤더를 공통 적용한다.
            호출 예시: self._send_common_headers(\"application/json\")
            """
            self.send_header("Content-Type", content_type)
            self._send_cors_headers()
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")

    return QuestbookApiHandler


def build_state(settings: AppSettings) -> AppState:
    """
    입력: 앱 설정.
    출력: 초기화된 앱 상태.
    역할: 저장소, 캐시, 외부 API 클라이언트, 유스케이스 서비스를 구성한다.
    호출 예시: state = build_state(AppSettings.from_env())
    """
    # 변수 의미: PostgreSQL 저장소다.
    repository = QuestbookRepository(settings.database_url)
    repository.initialize()
    repository.ensure_user("demo-user")
    # 변수 의미: 유저 단위 TourAPI Redis 캐시다.
    cache = TourPlaceRedisCache(settings.redis_url, settings.cache_ttl_seconds)
    # 변수 의미: TourAPI 조회 클라이언트다.
    tour_client = TourApiClient(settings.tourapi_service_key)
    # 변수 의미: baseline 유스케이스 서비스다.
    service = BaselineQuestbookService(repository, cache, tour_client)
    # 변수 의미: OAuth 로그인 state 저장소다.
    oauth_state = OAuthStateStore(settings.redis_url)
    return AppState(settings=settings, repository=repository, cache=cache, service=service, oauth_state=oauth_state)


def run_server(settings: AppSettings) -> None:
    """
    입력: 앱 설정.
    출력: 없음.
    역할: ThreadingHTTPServer로 앱 API를 실행한다.
    호출 예시: run_server(AppSettings.from_env())
    """
    # 변수 의미: 초기화된 앱 상태다.
    state = build_state(settings)
    # 변수 의미: 요청 핸들러 클래스다.
    handler_class = create_handler(state)
    # 변수 의미: 앱 API HTTP 서버 객체다.
    server = ThreadingHTTPServer((settings.host, settings.port), handler_class)
    print(f"Questbook app API listening on http://{settings.host}:{settings.port}")
    server.serve_forever()


def main() -> None:
    """
    입력: 없음.
    출력: 없음.
    역할: 환경 변수 설정을 읽고 앱 API 서버를 시작한다.
    호출 예시: python -m questbook_api.server
    """
    run_server(AppSettings.from_env())


if __name__ == "__main__":
    main()
