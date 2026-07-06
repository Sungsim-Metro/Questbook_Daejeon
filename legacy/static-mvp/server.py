# Questbook Daejeon 로컬 개발 서버와 NAVER Maps API 프록시를 제공한다.
from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


# 변수 의미: 정적 파일로 제공할 저장소 루트 경로다.
PROJECT_ROOT = Path(__file__).resolve().parent
# 변수 의미: 로컬 dotenv 파일 경로다.
DOTENV_PATH = PROJECT_ROOT / ".env"
# 변수 의미: 공식 API 문서 기준의 NAVER Maps API 호스트다.
NAVER_OPENAPI_BASE_URL = "https://naveropenapi.apigw.ntruss.com"
# 변수 의미: Geocoding 엔드포인트 경로다.
GEOCODE_PATH = "/map-geocode/v2/geocode"
# 변수 의미: Reverse Geocoding 엔드포인트 경로다.
REVERSE_GEOCODE_PATH = "/map-reversegeocode/v2/gc"
# 변수 의미: NAVER 상위 API 요청의 네트워크 제한 시간이다.
UPSTREAM_TIMEOUT_SECONDS = 8
# 변수 의미: 허용하는 Reverse Geocoding orders 토큰 집합이다.
ALLOWED_REVERSE_ORDERS = {"legalcode", "admcode", "addr", "roadaddr"}
# 변수 의미: 허용하는 Geocoding 응답 언어 집합이다.
ALLOWED_GEOCODE_LANGUAGES = {"kor", "eng"}
# 변수 의미: 프론트엔드에 전달할 공식 문서 링크 모음이다.
NAVER_MAP_DOCS = {
    "dynamicMap": "https://api.ncloud-docs.com/docs/application-maps-dynamic",
    "mapsJsSdk": "https://navermaps.github.io/maps.js.ncp/docs/",
    "geocoding": "https://api.ncloud-docs.com/docs/ai-naver-mapsgeocoding-geocode",
    "reverseGeocoding": "https://api.ncloud-docs.com/docs/ai-naver-mapsreversegeocoding-gc",
    "directions5": "https://api.ncloud-docs.com/docs/ai-naver-mapsdirections-driving",
}


def load_dotenv(path: Path) -> dict[str, str]:
    """
    입력: dotenv 파일을 가리키는 pathlib Path 객체.
    출력: 환경 변수 이름과 값으로 구성된 딕셔너리.
    역할: 비밀 값을 노출하지 않고 단순 KEY=VALUE 라인을 읽는다.
    호출 예시: env_values = load_dotenv(DOTENV_PATH)
    """
    # 변수 의미: 파싱된 dotenv 키-값 쌍이다.
    values: dict[str, str] = {}
    if not path.exists():
        return values

    # 변수 의미: dotenv 파일의 원문 내용이다.
    dotenv_text = path.read_text(encoding="utf-8")
    for raw_line in dotenv_text.splitlines():
        # 변수 의미: 앞뒤 공백을 제거한 dotenv 라인이다.
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        # 변수 의미: 원본 key와 value를 나눈 결과다.
        key, raw_value = line.split("=", 1)
        # 변수 의미: 정규화된 환경 변수 이름이다.
        normalized_key = key.strip()
        # 변수 의미: 정규화된 환경 변수 값이다.
        normalized_value = raw_value.strip().strip("'").strip('"')
        values[normalized_key] = normalized_value
    return values


def get_env_value(name: str) -> str:
    """
    입력: 환경 변수 이름.
    출력: 확인된 환경 변수 값 또는 빈 문자열.
    역할: 실제 환경 변수를 먼저 읽고 없으면 .env 값으로 대체한다.
    호출 예시: api_key = get_env_value("NAVER_MAPS_API_KEY")
    """
    # 변수 의미: 로컬 dotenv 파일에서 파싱한 값이다.
    dotenv_values = load_dotenv(DOTENV_PATH)
    return os.environ.get(name, dotenv_values.get(name, "")).strip()


def get_naver_credentials() -> tuple[str, str]:
    """
    입력: 없음.
    출력: NAVER Maps API Key ID와 API Key 튜플.
    역할: REST API 프록시 라우트에서 사용할 인증 정보 조회를 한곳에 모은다.
    호출 예시: key_id, key = get_naver_credentials()
    """
    # 변수 의미: NAVER Maps API Key ID 값이다.
    api_key_id = get_env_value("NAVER_MAPS_API_KEY_ID")
    # 변수 의미: NAVER Maps API Key 비밀 값이다.
    api_key = get_env_value("NAVER_MAPS_API_KEY")
    return api_key_id, api_key


def clamp_int(value: str | None, default: int, minimum: int, maximum: int) -> int:
    """
    입력: 원본 정수 문자열, 기본값, 최솟값, 최댓값.
    출력: 범위 안으로 보정된 정수.
    역할: 클라이언트가 보낸 쿼리 값을 NAVER API 제한 안에 유지한다.
    호출 예시: count = clamp_int(params.get("count"), 5, 1, 100)
    """
    try:
        # 변수 의미: 파싱된 정수 값이다.
        parsed_value = int(value) if value is not None else default
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed_value))


def first_query_value(query: dict[str, list[str]], name: str, default: str = "") -> str:
    """
    입력: 파싱된 쿼리 딕셔너리, 필드 이름, 기본값.
    출력: 첫 번째 쿼리 파라미터 값.
    역할: 라우트 핸들러에서 parse_qs의 리스트 값을 단일 값으로 정규화한다.
    호출 예시: query_text = first_query_value(query, "query")
    """
    # 변수 의미: 요청한 필드에 해당하는 모든 쿼리 값이다.
    values = query.get(name, [])
    return values[0].strip() if values else default


def build_json_bytes(payload: dict[str, Any]) -> bytes:
    """
    입력: JSON 직렬화가 가능한 딕셔너리.
    출력: UTF-8로 인코딩된 JSON 바이트.
    역할: API 프록시 라우트의 JSON 응답 형식을 일관되게 만든다.
    호출 예시: body = build_json_bytes({"ok": True})
    """
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def parse_required_float(raw_value: str, name: str, minimum: float, maximum: float) -> float:
    """
    입력: 원본 숫자 문자열, 파라미터 이름, 최솟값, 최댓값.
    출력: 검증된 실수 값.
    역할: 필수 위도와 경도 값을 검증한다.
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


class QuestbookRequestHandler(SimpleHTTPRequestHandler):
    """
    입력: 브라우저에서 들어오는 HTTP 요청.
    출력: 정적 파일 또는 NAVER Maps 프록시 응답.
    역할: 앱을 제공하고 NAVER API 인증 정보를 같은 출처 라우트 뒤에 숨긴다.
    호출 예시: ThreadingHTTPServer(("127.0.0.1", 8000), QuestbookRequestHandler)
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """
        입력: http.server에서 전달되는 핸들러 생성자 인자.
        출력: 없음.
        역할: 정적 파일 제공 디렉터리를 저장소 루트로 고정한다.
        호출 예시: QuestbookRequestHandler(request, client_address, server)
        """
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def do_GET(self) -> None:
        """
        입력: 현재 GET 요청.
        출력: HTTP 응답.
        역할: 정적 파일 처리 전에 NAVER 프록시 호출을 먼저 라우팅한다.
        호출 예시: GET /api/naver-map/config
        """
        # 변수 의미: 파싱된 요청 URL 구성 요소다.
        parsed_url = urlparse(self.path)
        if parsed_url.path in {"/api/naver-map/config", "/api/naver-map/status"}:
            self.handle_config()
            return
        if parsed_url.path == "/api/naver-map/geocode":
            self.handle_geocode(parsed_url.query)
            return
        if parsed_url.path == "/api/naver-map/reverse-geocode":
            self.handle_reverse_geocode(parsed_url.query)
            return
        super().do_GET()

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        """
        입력: HTTPStatus와 JSON 직렬화가 가능한 페이로드.
        출력: JSON HTTP 응답.
        역할: API 라우트 응답 작성을 한곳에서 처리한다.
        호출 예시: self.send_json(HTTPStatus.OK, {"configured": True})
        """
        # 변수 의미: 인코딩된 JSON 응답 바이트다.
        response_body = build_json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(response_body)

    def handle_config(self) -> None:
        """
        입력: 없음.
        출력: NAVER Maps 준비 상태를 설명하는 JSON 응답.
        역할: REST API Key를 노출하지 않고 프론트엔드가 Dynamic Map을 불러오게 한다.
        호출 예시: GET /api/naver-map/config
        """
        # 변수 의미: 설정된 NAVER 인증 정보다.
        api_key_id, api_key = get_naver_credentials()
        # 변수 의미: 브라우저에서 Dynamic Map을 로드할 수 있는지 여부다.
        dynamic_map_configured = bool(api_key_id)
        # 변수 의미: REST 프록시 라우트가 NAVER API를 호출할 수 있는지 여부다.
        rest_api_configured = bool(api_key_id and api_key)
        self.send_json(
            HTTPStatus.OK,
            {
                "dynamicMapConfigured": dynamic_map_configured,
                "restApiConfigured": rest_api_configured,
                "keyId": api_key_id if dynamic_map_configured else "",
                "requiredEnv": ["NAVER_MAPS_API_KEY_ID", "NAVER_MAPS_API_KEY"],
                "docs": NAVER_MAP_DOCS,
            },
        )

    def build_naver_headers(self, accept: str | None = None) -> dict[str, str]:
        """
        입력: 선택적 Accept 헤더 값.
        출력: NAVER Maps REST API에 필요한 헤더.
        역할: 상위 API 요청에 API Key ID와 API Key 헤더를 추가한다.
        호출 예시: headers = self.build_naver_headers("application/json")
        """
        # 변수 의미: 설정된 NAVER 인증 정보다.
        api_key_id, api_key = get_naver_credentials()
        if not api_key_id or not api_key:
            raise RuntimeError("NAVER Maps REST API credentials are missing.")

        # 변수 의미: 상위 API 요청 헤더다.
        headers = {
            "x-ncp-apigw-api-key-id": api_key_id,
            "x-ncp-apigw-api-key": api_key,
        }
        if accept:
            headers["Accept"] = accept
        return headers

    def request_upstream(self, path: str, params: dict[str, Any], accept: str | None = None) -> tuple[bytes, str, int]:
        """
        입력: NAVER API 경로, 쿼리 파라미터, 선택적 Accept 헤더.
        출력: 응답 바이트, 콘텐츠 타입, 상위 HTTP 상태 코드.
        역할: NAVER Open API에 제한 시간 안에서 같은 호스트 요청을 보낸다.
        호출 예시: body, content_type, status = self.request_upstream(GEOCODE_PATH, params, "application/json")
        """
        # 변수 의미: 인코딩된 쿼리 문자열이다.
        query_string = urlencode(params, doseq=True)
        # 변수 의미: 완성된 NAVER 상위 API URL이다.
        upstream_url = f"{NAVER_OPENAPI_BASE_URL}{path}?{query_string}"
        # 변수 의미: 준비된 상위 API 요청 객체다.
        request = Request(upstream_url, headers=self.build_naver_headers(accept))

        try:
            with urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
                # 변수 의미: 상위 API 응답 콘텐츠 타입이다.
                content_type = response.headers.get("Content-Type", "application/octet-stream")
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

    def handle_geocode(self, raw_query: str) -> None:
        """
        입력: 주소 검색어가 포함된 원본 쿼리 문자열.
        출력: NAVER에서 받은 JSON Geocoding 응답.
        역할: 사용자가 입력한 주소를 경도와 위도 후보로 변환한다.
        호출 예시: GET /api/naver-map/geocode?query=대전역
        """
        # 변수 의미: 파싱된 클라이언트 쿼리 파라미터다.
        query = parse_qs(raw_query)
        # 변수 의미: Geocoding에 사용할 주소 텍스트다.
        query_text = first_query_value(query, "query")
        if not query_text:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "query is required."})
            return

        # 변수 의미: 선택적으로 전달할 근접 좌표다.
        coordinate = normalize_coordinate_pair(first_query_value(query, "coordinate"))
        # 변수 의미: 요청된 응답 언어다.
        language = first_query_value(query, "language", "kor").lower()
        if language not in ALLOWED_GEOCODE_LANGUAGES:
            language = "kor"

        # 변수 의미: Geocoding 요청 파라미터다.
        upstream_params: dict[str, Any] = {
            "query": query_text,
            "language": language,
            "page": clamp_int(first_query_value(query, "page"), 1, 1, 1000),
            "count": clamp_int(first_query_value(query, "count"), 5, 1, 100),
        }
        if coordinate:
            upstream_params["coordinate"] = coordinate

        self.forward_json_response(GEOCODE_PATH, upstream_params)

    def handle_reverse_geocode(self, raw_query: str) -> None:
        """
        입력: 위도와 경도가 포함된 원본 쿼리 문자열.
        출력: NAVER에서 받은 JSON Reverse Geocoding 응답.
        역할: 좌표를 법정동, 행정동, 도로명 주소 데이터로 변환한다.
        호출 예시: GET /api/naver-map/reverse-geocode?lat=36.327&lng=127.427
        """
        # 변수 의미: 파싱된 클라이언트 쿼리 파라미터다.
        query = parse_qs(raw_query)
        try:
            # 변수 의미: Reverse Geocoding에 사용할 위도 값이다.
            latitude = parse_required_float(first_query_value(query, "lat"), "lat", -90.0, 90.0)
            # 변수 의미: Reverse Geocoding에 사용할 경도 값이다.
            longitude = parse_required_float(first_query_value(query, "lng"), "lng", -180.0, 180.0)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
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

        self.forward_json_response(REVERSE_GEOCODE_PATH, upstream_params)

    def forward_json_response(self, path: str, params: dict[str, Any]) -> None:
        """
        입력: NAVER JSON API 경로와 쿼리 파라미터.
        출력: NAVER JSON 응답 또는 오류 페이로드.
        역할: Geocoding과 Reverse Geocoding 응답 전달 로직을 공유한다.
        호출 예시: self.forward_json_response(GEOCODE_PATH, {"query": "대전역"})
        """
        try:
            # 변수 의미: 상위 API에서 받은 JSON 응답 정보다.
            response_body, content_type, status_code = self.request_upstream(path, params, "application/json")
        except RuntimeError as error:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return

        self.send_response(status_code)
        self.send_header("Content-Type", content_type or "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(response_body)

    def guess_type(self, path: str) -> str:
        """
        입력: 정적 파일 경로.
        출력: MIME 타입 문자열.
        역할: JavaScript와 JSON 파일이 올바른 MIME 타입으로 제공되게 한다.
        호출 예시: content_type = self.guess_type("assets/js/map.js")
        """
        # 변수 의미: 표준 라이브러리가 추정한 MIME 타입이다.
        guessed_type = mimetypes.guess_type(path)[0]
        return guessed_type or super().guess_type(path)


def build_public_url(host: str, port: int) -> str:
    """
    입력: 로컬 서버가 바인딩한 호스트와 포트.
    출력: 브라우저에서 접근할 앱 홈 URL.
    역할: 모든 인터페이스에 바인딩할 때 유용한 Tailscale 또는 로컬 URL을 만든다.
    호출 예시: public_url = build_public_url("0.0.0.0", 8000)
    """
    # 변수 의미: 환경 변수에서 읽은 선택적 브라우저 접근 URL이다.
    public_url = get_env_value("QUESTBOOK_PUBLIC_URL").rstrip("/")
    if public_url:
        return f"{public_url}/index.html"

    # 변수 의미: 서버가 모든 IPv4 또는 IPv6 인터페이스에서 수신 중인지 여부다.
    listens_on_all_interfaces = host in {"0.0.0.0", "::"}
    # 변수 의미: 콘솔 출력에 사용할 안전한 로컬 대체 호스트다.
    display_host = "127.0.0.1" if listens_on_all_interfaces else host
    return f"http://{display_host}:{port}/index.html"


def run() -> None:
    """
    입력: 없음.
    출력: 없음.
    역할: 정적 앱과 API 프록시용 로컬 HTTP 서버를 시작한다.
    호출 예시: run()
    """
    # 변수 의미: 설정된 서버 호스트다.
    host = get_env_value("QUESTBOOK_HOST") or "0.0.0.0"
    # 변수 의미: 설정된 서버 포트다.
    port = clamp_int(get_env_value("QUESTBOOK_PORT"), 8000, 1, 65535)
    # 변수 의미: 브라우저에서 접근할 앱 URL이다.
    public_url = build_public_url(host, port)
    # 변수 의미: 로컬 서버 인스턴스다.
    server = ThreadingHTTPServer((host, port), QuestbookRequestHandler)
    print(f"Questbook Daejeon server listening on {host}:{port}")
    print(f"Open {public_url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
