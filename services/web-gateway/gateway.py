# Questbook baseline 웹 게이트웨이와 정적 파일 서버를 제공한다.
from __future__ import annotations

import json
import gzip
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
# 변수 의미: 사용자 웹 public 정적 파일 루트다.
USER_WEB_PUBLIC_ROOT = REPOSITORY_ROOT / "apps" / "user-web" / "public"
# 변수 의미: 사용자 웹 src 정적 파일 루트다.
USER_WEB_SRC_ROOT = REPOSITORY_ROOT / "apps" / "user-web" / "src"
# 변수 의미: 저장소 루트 dotenv 파일 경로다.
DOTENV_PATH = REPOSITORY_ROOT / ".env"
# 변수 의미: 프록시 요청 제한 시간 초 단위 값이다.
PROXY_TIMEOUT_SECONDS = 10
# 변수 의미: 앱 API에서 브라우저까지 보존할 프록시 응답 헤더다.
FORWARDED_RESPONSE_HEADERS = {"Cache-Control", "Content-Security-Policy", "Vary"}


def load_dotenv(path: Path) -> dict[str, str]:
    """
    입력: dotenv 파일 경로.
    출력: 파싱된 환경 변수 딕셔너리.
    역할: secret 값을 출력하지 않고 게이트웨이 설정을 읽는다.
    호출 예시: env_values = load_dotenv(DOTENV_PATH)
    """
    # 변수 의미: 파싱된 환경 변수 값이다.
    values: dict[str, str] = {}
    if not path.exists():
        return values
    # 변수 의미: dotenv 파일 전체 텍스트다.
    dotenv_text = path.read_text(encoding="utf-8")
    for raw_line in dotenv_text.splitlines():
        # 변수 의미: 앞뒤 공백을 제거한 줄이다.
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        # 변수 의미: 환경 변수 이름과 원본 값이다.
        key, raw_value = line.split("=", 1)
        values[key.strip()] = raw_value.strip().strip("'").strip('"')
    return values


def get_env(name: str, default: str = "") -> str:
    """
    입력: 환경 변수 이름과 기본값.
    출력: 실제 환경 변수 또는 dotenv 값.
    역할: 게이트웨이 실행 설정을 조회한다.
    호출 예시: host = get_env(\"QUESTBOOK_WEB_HOST\", \"0.0.0.0\")
    """
    # 변수 의미: dotenv에서 읽은 환경 변수 값이다.
    dotenv_values = load_dotenv(DOTENV_PATH)
    return os.environ.get(name, dotenv_values.get(name, default)).strip()


def get_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    """
    입력: 환경 변수 이름, 기본값, 최솟값, 최댓값.
    출력: 범위 안으로 보정된 정수 설정값.
    역할: 포트 같은 숫자 설정을 안전하게 읽는다.
    호출 예시: port = get_int_env(\"QUESTBOOK_WEB_PORT\", 8000, 1, 65535)
    """
    try:
        # 변수 의미: 파싱된 정수 값이다.
        parsed_value = int(get_env(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, parsed_value))


def safe_static_path(raw_path: str) -> tuple[Path, Path] | None:
    """
    입력: HTTP 요청 경로.
    출력: 정적 파일 실제 경로와 기준 루트 또는 None.
    역할: public과 src 밖의 파일 접근을 차단한다.
    호출 예시: result = safe_static_path(\"/src/app.js\")
    """
    # 변수 의미: URL 디코딩 전 경로에서 쿼리를 제거한 값이다.
    request_path = raw_path if raw_path != "/" else "/index.html"
    if request_path.startswith("/src/"):
        # 변수 의미: src 기준 상대 경로다.
        relative_path = request_path.removeprefix("/src/").lstrip("/")
        # 변수 의미: src 실제 파일 경로다.
        file_path = (USER_WEB_SRC_ROOT / relative_path).resolve()
        # 변수 의미: src 루트 실제 경로다.
        root_path = USER_WEB_SRC_ROOT.resolve()
    else:
        # 변수 의미: public 기준 상대 경로다.
        relative_path = request_path.lstrip("/")
        # 변수 의미: public 실제 파일 경로다.
        file_path = (USER_WEB_PUBLIC_ROOT / relative_path).resolve()
        # 변수 의미: public 루트 실제 경로다.
        root_path = USER_WEB_PUBLIC_ROOT.resolve()
    try:
        file_path.relative_to(root_path)
    except ValueError:
        return None
    return file_path, root_path


class QuestbookGatewayHandler(BaseHTTPRequestHandler):
    """
    입력: 브라우저 HTTP 요청.
    출력: 정적 파일 또는 앱 API 프록시 응답.
    역할: baseline 웹 서버 계층을 로컬에서 실행한다.
    호출 예시: ThreadingHTTPServer((host, port), QuestbookGatewayHandler)
    """

    server_version = "QuestbookWebGateway/0.1"

    def do_OPTIONS(self) -> None:
        """
        입력: OPTIONS 요청.
        출력: CORS preflight 응답.
        역할: 로컬 개발 중 API 요청을 허용한다.
        호출 예시: OPTIONS /api/health
        """
        if self.path.startswith("/api/"):
            self._proxy_request("OPTIONS")
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_common_headers("application/json")
        self.end_headers()

    def do_GET(self) -> None:
        """
        입력: GET 요청.
        출력: 정적 파일 또는 프록시 응답.
        역할: `/api`는 앱 서버로 보내고 나머지는 PWA 파일을 제공한다.
        호출 예시: GET / 또는 GET /api/me
        """
        if self.path.startswith("/api/") or self.path == "/health":
            self._proxy_request("GET")
            return
        self._serve_static_file()

    def do_POST(self) -> None:
        """
        입력: POST 요청.
        출력: 앱 API 프록시 응답.
        역할: 퀘스트 수락과 완료 요청을 앱 서버로 전달한다.
        호출 예시: POST /api/quests/uqi_x/complete
        """
        if self.path.startswith("/api/"):
            self._proxy_request("POST")
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_PATCH(self) -> None:
        """
        입력: PATCH 요청.
        출력: 앱 API 프록시 응답.
        역할: 수첩 기록 수정 요청을 앱 서버로 전달한다.
        호출 예시: PATCH /api/notes/note_x
        """
        if self.path.startswith("/api/"):
            self._proxy_request("PATCH")
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def log_message(self, format: str, *args: Any) -> None:
        """
        입력: 표준 HTTP 로그 포맷과 인자.
        출력: 없음.
        역할: 기본 요청 로그를 억제한다.
        호출 예시: self.log_message(\"%s\", \"ok\")
        """
        return

    def _serve_static_file(self) -> None:
        """
        입력: 현재 GET 요청 경로.
        출력: 정적 파일 응답.
        역할: 사용자 PWA 파일을 제공하고 SPA fallback을 처리한다.
        호출 예시: self._serve_static_file()
        """
        # 변수 의미: 파싱된 URL 경로다.
        parsed_url = urlparse(self.path)
        # 변수 의미: 안전하게 정규화한 정적 파일 경로와 루트다.
        path_result = safe_static_path(parsed_url.path)
        if path_result is None:
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
            return
        # 변수 의미: 실제 정적 파일 경로다.
        file_path, _root_path = path_result
        if not file_path.exists() or not file_path.is_file():
            file_path = USER_WEB_PUBLIC_ROOT / "index.html"
        if not file_path.exists():
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "user_web_not_built"})
            return

        # 변수 의미: 파일 확장자 기반 Content-Type이다.
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        # 변수 의미: 정적 파일 원본 바이트 본문이다.
        body = file_path.read_bytes()
        # 변수 의미: gzip 압축을 적용할지 여부다.
        use_gzip = "gzip" in self.headers.get("Accept-Encoding", "") and content_type.startswith(("text/", "application/javascript", "application/json"))
        if use_gzip:
            body = gzip.compress(body)
        self.send_response(HTTPStatus.OK)
        self._send_common_headers(content_type)
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        if file_path.name == "service-worker.js":
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_request(self, method: str) -> None:
        """
        입력: HTTP 메서드.
        출력: 앱 API 프록시 응답.
        역할: 브라우저가 같은 origin으로 호출한 `/api` 요청을 내부 앱 서버로 전달한다.
        호출 예시: self._proxy_request(\"GET\")
        """
        # 변수 의미: 내부 앱 API 기본 URL이다.
        app_api_base_url = get_env("QUESTBOOK_APP_API_BASE_URL", "http://127.0.0.1:8100")
        # 변수 의미: 프록시 대상 URL이다.
        target_url = f"{app_api_base_url}{self.path}"
        # 변수 의미: 요청 본문 길이다.
        content_length = int(self.headers.get("Content-Length", "0"))
        # 변수 의미: 요청 본문 바이트다.
        body = self.rfile.read(content_length) if content_length > 0 else None
        # 변수 의미: 앱 API로 전달할 헤더다.
        headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
        if self.headers.get("Authorization"):
            headers["Authorization"] = self.headers["Authorization"]
        try:
            # 변수 의미: 앱 API 프록시 요청 객체다.
            request = Request(target_url, data=body, headers=headers, method=method)
            with urlopen(request, timeout=PROXY_TIMEOUT_SECONDS) as response:
                # 변수 의미: 앱 API 응답 본문이다.
                response_body = response.read()
                # 변수 의미: 앱 API 응답 Content-Type이다.
                content_type = response.headers.get("Content-Type", "application/json")
                self.send_response(response.status)
                self._send_common_headers(content_type)
                self._forward_selected_headers(response.headers)
                self.send_header("Content-Length", str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
        except HTTPError as error:
            # 변수 의미: 앱 API 오류 응답 본문이다.
            error_body = error.read()
            self.send_response(error.code)
            self._send_common_headers(error.headers.get("Content-Type", "application/json"))
            self._forward_selected_headers(error.headers)
            self.send_header("Content-Length", str(len(error_body)))
            self.end_headers()
            self.wfile.write(error_body)
        except (URLError, TimeoutError) as error:
            self._send_json(
                HTTPStatus.BAD_GATEWAY,
                {"error": "app_api_unavailable", "message": str(error.reason if isinstance(error, URLError) else error)},
            )

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        """
        입력: HTTP 상태와 JSON 페이로드.
        출력: JSON HTTP 응답.
        역할: 게이트웨이 자체 오류 응답 형식을 통일한다.
        호출 예시: self._send_json(HTTPStatus.NOT_FOUND, {\"error\": \"not_found\"})
        """
        # 변수 의미: JSON 응답 본문이다.
        response_body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self._send_common_headers("application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _forward_selected_headers(self, headers: Any) -> None:
        """
        입력: 앱 API 응답 헤더 매핑.
        출력: 없음.
        역할: OAuth callback과 인증 API의 캐시·보안 헤더를 브라우저까지 보존한다.
        호출 예시: self._forward_selected_headers(response.headers)
        """
        for header_name in FORWARDED_RESPONSE_HEADERS:
            # 변수 의미: 앱 API가 내려준 보존 대상 헤더 값이다.
            header_value = headers.get(header_name)
            if header_value:
                self.send_header(header_name, header_value)

    def _send_common_headers(self, content_type: str) -> None:
        """
        입력: 응답 Content-Type.
        출력: 없음.
        역할: baseline 웹 서버 보안 헤더를 공통 적용한다.
        호출 예시: self._send_common_headers(\"text/html\")
        """
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "geolocation=(self), camera=(self)")


def run_gateway() -> None:
    """
    입력: 없음.
    출력: 없음.
    역할: 환경 변수 설정으로 웹 게이트웨이를 실행한다.
    호출 예시: python services/web-gateway/gateway.py
    """
    # 변수 의미: 게이트웨이 바인드 호스트다.
    host = get_env("QUESTBOOK_WEB_HOST", get_env("QUESTBOOK_HOST", "0.0.0.0"))
    # 변수 의미: 게이트웨이 바인드 포트다.
    port = get_int_env("QUESTBOOK_WEB_PORT", get_int_env("QUESTBOOK_PORT", 8000, 1, 65535), 1, 65535)
    # 변수 의미: 웹 게이트웨이 HTTP 서버다.
    server = ThreadingHTTPServer((host, port), QuestbookGatewayHandler)
    print(f"Questbook web gateway listening on http://{host}:{port}")
    print(f"Proxying /api to {get_env('QUESTBOOK_APP_API_BASE_URL', 'http://127.0.0.1:8100')}")
    server.serve_forever()


if __name__ == "__main__":
    run_gateway()
