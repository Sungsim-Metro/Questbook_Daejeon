# Questbook baseline 앱 API HTTP 서버를 제공한다.
from __future__ import annotations

from dataclasses import dataclass
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from questbook_api.application.baseline_service import BaselineQuestbookService
from questbook_api.domain.auth.tokens import create_access_token, verify_access_token
from questbook_api.infrastructure.cache import TourPlaceMemoryCache
from questbook_api.infrastructure.repository import QuestbookRepository
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
    입력: 설정, 저장소, 캐시, 서비스.
    출력: HTTP 핸들러가 공유하는 앱 상태.
    역할: 전역 변수 없이 요청 핸들러에 의존성을 전달한다.
    호출 예시: state = AppState(settings, repository, cache, service)
    """

    # 변수 의미: 앱 API 실행 설정이다.
    settings: AppSettings
    # 변수 의미: 관계형 저장소다.
    repository: QuestbookRepository
    # 변수 의미: TourAPI 임시 캐시다.
    cache: TourPlaceMemoryCache
    # 변수 의미: baseline 유스케이스 서비스다.
    service: BaselineQuestbookService


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
                    self._send_json(
                        HTTPStatus.OK,
                        {
                            "providers": [
                                {
                                    "id": "demo-social",
                                    "label": "데모 소셜 로그인",
                                    "configured": True,
                                    "description": "로컬 baseline 검증용 provider입니다.",
                                },
                                {"id": "naver", "label": "네이버", "configured": False},
                                {"id": "google", "label": "구글", "configured": False},
                            ]
                        },
                    )
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
                "database": {"ok": state.repository.is_healthy(), "path": str(state.settings.database_path)},
                "cache": {"entries": state.cache.size(), "ttlSeconds": state.cache.default_ttl_seconds},
                "externalApis": {"tourapi": state.service.tour_client.status()},
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
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)

        def _send_common_headers(self, content_type: str) -> None:
            """
            입력: 응답 Content-Type 값.
            출력: 없음.
            역할: 보안 헤더와 로컬 개발 CORS 헤더를 공통 적용한다.
            호출 예시: self._send_common_headers(\"application/json\")
            """
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
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
    # 변수 의미: SQLite 저장소다.
    repository = QuestbookRepository(settings.database_path)
    repository.initialize()
    repository.ensure_user("demo-user")
    # 변수 의미: 유저 단위 TourAPI 인메모리 캐시다.
    cache = TourPlaceMemoryCache(settings.cache_ttl_seconds)
    # 변수 의미: TourAPI 조회 클라이언트다.
    tour_client = TourApiClient(settings.tourapi_service_key)
    # 변수 의미: baseline 유스케이스 서비스다.
    service = BaselineQuestbookService(repository, cache, tour_client)
    return AppState(settings=settings, repository=repository, cache=cache, service=service)


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
