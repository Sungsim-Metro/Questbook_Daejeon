# NCP Secret Manager 값을 dotenv 파일에 반영하고 앱 서비스를 재시작한다.
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


# 변수 의미: qbook-app 운영 서버의 기본 dotenv 경로다.
DEFAULT_ENV_FILE = Path("/opt/Questbook_Daejeon/.env")
# 변수 의미: qbook-app 앱 API의 기본 systemd 서비스 이름이다.
DEFAULT_SERVICE_NAME = "questbook-api"
# 변수 의미: 앱 API 로컬 헬스체크 기본 URL이다.
DEFAULT_HEALTH_URL = "http://127.0.0.1:8100/api/health"
# 변수 의미: Secret Manager 전역 키 연동 Secret의 기본 API 엔드포인트다.
DEFAULT_SECRET_MANAGER_ENDPOINT = "https://secretmanager.apigw.ntruss.com"
# 변수 의미: Secret Manager 시크릿 값 조회 API 경로 형식이다.
SECRET_VALUE_PATH_TEMPLATE = "/api/v1/secrets/{secret_id}/values"
# 변수 의미: dotenv 환경 변수 이름으로 허용할 패턴이다.
DOTENV_KEY_PATTERN = re.compile(r"^[A-Z_][A-Z0-9_]*$")


def parse_args() -> argparse.Namespace:
    """
    입력: 명령행 인자.
    출력: argparse Namespace.
    역할: Secret Manager 동기화에 필요한 옵션을 파싱한다.
    호출 예시: args = parse_args()
    """
    # 변수 의미: 명령행 파서다.
    parser = argparse.ArgumentParser(
        description="NCP Secret Manager ACTIVE 값을 dotenv 파일에 반영하고 선택적으로 서비스를 재시작한다.",
    )
    parser.add_argument(
        "--secret-id",
        default=os.environ.get("NCP_SECRET_MANAGER_SECRET_ID", ""),
        help="NCP Secret Manager secretId. 기본값은 NCP_SECRET_MANAGER_SECRET_ID 환경 변수.",
    )
    parser.add_argument(
        "--access-key",
        default=os.environ.get("NCP_API_ACCESS_KEY", ""),
        help="NCP API Access Key. 기본값은 NCP_API_ACCESS_KEY 환경 변수.",
    )
    parser.add_argument(
        "--secret-key",
        default=os.environ.get("NCP_API_SECRET_KEY", ""),
        help="NCP API Secret Key. 기본값은 NCP_API_SECRET_KEY 환경 변수.",
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("NCP_SECRET_MANAGER_ENDPOINT", DEFAULT_SECRET_MANAGER_ENDPOINT),
        help=f"Secret Manager API 엔드포인트. 기본값: {DEFAULT_SECRET_MANAGER_ENDPOINT}",
    )
    parser.add_argument(
        "--stage",
        choices=("active", "pending", "previous"),
        default="active",
        help="dotenv에 반영할 Secret Manager 스테이지. 기본값: active",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_ENV_FILE,
        help=f"갱신할 dotenv 파일 경로. 기본값: {DEFAULT_ENV_FILE}",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="실제 dotenv 파일을 갱신한다. 생략하면 변경 예정 key만 출력한다.",
    )
    parser.add_argument(
        "--backup",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="쓰기 전에 기존 dotenv 백업을 생성한다. 기본값: true",
    )
    parser.add_argument(
        "--restart-service",
        default="",
        help=f"쓰기 후 재시작할 systemd 서비스 이름. 예: {DEFAULT_SERVICE_NAME}",
    )
    parser.add_argument(
        "--health-url",
        default="",
        help=f"재시작 후 확인할 헬스체크 URL. 예: {DEFAULT_HEALTH_URL}",
    )
    parser.add_argument(
        "--health-timeout-seconds",
        type=int,
        default=30,
        help="헬스체크 성공을 기다릴 최대 시간(초). 기본값: 30",
    )
    return parser.parse_args()


def make_ncp_signature(method: str, path_with_query: str, timestamp: str, access_key: str, secret_key: str) -> str:
    """
    입력: HTTP 메서드, 경로와 쿼리, timestamp, Access Key, Secret Key.
    출력: x-ncp-apigw-signature-v2 헤더 값.
    역할: NCP API 공통 HMAC-SHA256 서명을 만든다.
    호출 예시: signature = make_ncp_signature("GET", "/api/v1/secrets/id/values", timestamp, access_key, secret_key)
    """
    # 변수 의미: NCP 서명 규칙에 맞춘 원문 메시지다.
    message = f"{method} {path_with_query}\n{timestamp}\n{access_key}"
    # 변수 의미: HMAC 계산에 사용할 Secret Key 바이트열이다.
    secret_bytes = secret_key.encode("utf-8")
    # 변수 의미: HMAC 계산에 사용할 메시지 바이트열이다.
    message_bytes = message.encode("utf-8")
    # 변수 의미: HMAC-SHA256 원본 digest다.
    digest = hmac.new(secret_bytes, message_bytes, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def build_secret_value_request(endpoint: str, secret_id: str, access_key: str, secret_key: str) -> Request:
    """
    입력: Secret Manager 엔드포인트, 시크릿 ID, NCP API 인증 키.
    출력: urllib Request 객체.
    역할: Secret Manager Get Secret Value API 요청을 구성한다.
    호출 예시: request = build_secret_value_request(endpoint, secret_id, access_key, secret_key)
    """
    # 변수 의미: 정규화된 엔드포인트 URL이다.
    normalized_endpoint = endpoint.rstrip("/")
    # 변수 의미: URL path에서 안전하게 인코딩한 secretId다.
    encoded_secret_id = quote(secret_id, safe="")
    # 변수 의미: Secret Manager 값 조회 API 경로다.
    path = SECRET_VALUE_PATH_TEMPLATE.format(secret_id=encoded_secret_id)
    # 변수 의미: API Gateway 인증 timestamp 밀리초 문자열이다.
    timestamp = str(int(time.time() * 1000))
    # 변수 의미: NCP API Gateway 서명 헤더 값이다.
    signature = make_ncp_signature("GET", path, timestamp, access_key, secret_key)
    # 변수 의미: 완성된 API URL이다.
    url = f"{normalized_endpoint}{path}"
    return Request(
        url,
        method="GET",
        headers={
            "x-ncp-apigw-timestamp": timestamp,
            "x-ncp-iam-access-key": access_key,
            "x-ncp-apigw-signature-v2": signature,
            "Content-Type": "application/json",
        },
    )


def fetch_secret_payload(endpoint: str, secret_id: str, access_key: str, secret_key: str, stage: str) -> dict[str, str]:
    """
    입력: Secret Manager API 설정과 조회할 스테이지.
    출력: dotenv에 반영할 key-value 딕셔너리.
    역할: Secret Manager 값을 조회하고 JSON 객체로 파싱한다.
    호출 예시: values = fetch_secret_payload(endpoint, secret_id, access_key, secret_key, "active")
    """
    # 변수 의미: Secret Manager API 요청 객체다.
    request = build_secret_value_request(endpoint, secret_id, access_key, secret_key)
    try:
        with urlopen(request, timeout=10) as response:
            # 변수 의미: Secret Manager API 응답 본문이다.
            response_body = response.read().decode("utf-8")
    except HTTPError as error:
        # 변수 의미: Secret Manager 오류 응답 본문이다.
        error_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Secret Manager request failed: HTTP {error.code} {error_body}") from error
    except URLError as error:
        raise RuntimeError(f"Secret Manager request failed: {error.reason}") from error

    # 변수 의미: JSON으로 파싱한 API 응답이다.
    api_payload = json.loads(response_body)
    if api_payload.get("code") != "SUCCESS":
        raise RuntimeError(f"Secret Manager returned non-success response: {api_payload.get('code')}")

    # 변수 의미: 복호화된 시크릿 스테이지별 문자열이다.
    decrypted_chain = api_payload.get("data", {}).get("decryptedSecretChain", {})
    # 변수 의미: 요청한 스테이지의 원본 시크릿 문자열이다.
    raw_secret_value = decrypted_chain.get(stage) or ""
    if not raw_secret_value:
        raise RuntimeError(f"Secret Manager stage is empty: {stage}")

    # 변수 의미: 시크릿 문자열 안에 들어 있는 JSON key-value 값이다.
    secret_values = json.loads(raw_secret_value)
    if not isinstance(secret_values, dict):
        raise RuntimeError("Secret Manager value must be a JSON object.")

    # 변수 의미: dotenv에 쓸 문자열 key-value 결과다.
    dotenv_values: dict[str, str] = {}
    for key, value in secret_values.items():
        if not isinstance(key, str) or not DOTENV_KEY_PATTERN.fullmatch(key):
            raise RuntimeError(f"Invalid dotenv key in Secret Manager value: {key!r}")
        if isinstance(value, (dict, list)):
            raise RuntimeError(f"Secret Manager value for {key} must be a scalar, not an object or array.")
        # 변수 의미: dotenv에 기록할 문자열 값이다.
        normalized_value = "" if value is None else str(value)
        if "\n" in normalized_value or "\r" in normalized_value:
            raise RuntimeError(f"Secret Manager value for {key} must not contain newlines.")
        dotenv_values[key] = normalized_value
    return dotenv_values


def parse_dotenv_line(line: str) -> tuple[str, str] | None:
    """
    입력: dotenv 파일의 한 줄.
    출력: key-value 튜플 또는 None.
    역할: 주석과 빈 줄을 제외하고 KEY=VALUE 라인만 파싱한다.
    호출 예시: item = parse_dotenv_line("QUESTBOOK_APP_API_PORT=8100")
    """
    # 변수 의미: 앞뒤 공백을 제거한 라인이다.
    stripped_line = line.strip()
    if not stripped_line or stripped_line.startswith("#") or "=" not in stripped_line:
        return None

    # 변수 의미: 분리한 key와 value 원문이다.
    key, value = stripped_line.split("=", 1)
    # 변수 의미: 정규화한 key다.
    normalized_key = key.strip()
    if not DOTENV_KEY_PATTERN.fullmatch(normalized_key):
        return None
    return normalized_key, value.strip()


def render_dotenv_value(value: str) -> str:
    """
    입력: dotenv에 저장할 문자열 값.
    출력: dotenv VALUE 표현.
    역할: 현재 프로젝트 dotenv 파서와 호환되는 단일 라인 값을 만든다.
    호출 예시: rendered = render_dotenv_value("abc")
    """
    if "\n" in value or "\r" in value:
        raise RuntimeError("dotenv value must not contain newlines.")
    return value


def merge_dotenv_lines(existing_text: str, updates: dict[str, str]) -> str:
    """
    입력: 기존 dotenv 텍스트와 갱신할 key-value 딕셔너리.
    출력: 갱신된 dotenv 텍스트.
    역할: 기존 주석과 순서를 보존하면서 Secret Manager key만 교체하고 새 key는 끝에 추가한다.
    호출 예시: new_text = merge_dotenv_lines(old_text, {"QUESTBOOK_JWT_SECRET": "..."})
    """
    # 변수 의미: 아직 파일에 반영되지 않은 갱신 key 집합이다.
    remaining_keys = set(updates)
    # 변수 의미: 갱신 결과 라인 목록이다.
    merged_lines: list[str] = []

    for line in existing_text.splitlines():
        # 변수 의미: 파싱된 dotenv 항목이다.
        parsed_line = parse_dotenv_line(line)
        if parsed_line is None:
            merged_lines.append(line)
            continue

        # 변수 의미: 현재 라인의 환경 변수 이름이다.
        key, _old_value = parsed_line
        if key in updates:
            merged_lines.append(f"{key}={render_dotenv_value(updates[key])}")
            remaining_keys.discard(key)
        else:
            merged_lines.append(line)

    if remaining_keys:
        if merged_lines and merged_lines[-1].strip():
            merged_lines.append("")
        merged_lines.append("# NCP Secret Manager에서 동기화한 값이다.")
        for key in sorted(remaining_keys):
            merged_lines.append(f"{key}={render_dotenv_value(updates[key])}")

    return "\n".join(merged_lines).rstrip() + "\n"


def write_env_file(env_file: Path, updates: dict[str, str], backup: bool) -> Path | None:
    """
    입력: dotenv 경로, 갱신 key-value, 백업 생성 여부.
    출력: 생성된 백업 경로 또는 None.
    역할: dotenv 파일을 원자적으로 갱신한다.
    호출 예시: backup_path = write_env_file(Path(".env"), values, True)
    """
    # 변수 의미: 기존 dotenv 텍스트다.
    existing_text = env_file.read_text(encoding="utf-8") if env_file.exists() else ""
    # 변수 의미: 갱신된 dotenv 텍스트다.
    merged_text = merge_dotenv_lines(existing_text, updates)
    # 변수 의미: 생성된 백업 파일 경로다.
    backup_path: Path | None = None

    env_file.parent.mkdir(parents=True, exist_ok=True)
    if backup and env_file.exists():
        # 변수 의미: 백업 파일명에 넣을 timestamp다.
        timestamp = time.strftime("%Y%m%d%H%M%S")
        backup_path = env_file.with_name(f"{env_file.name}.{timestamp}.bak")
        shutil.copy2(env_file, backup_path)

    # 변수 의미: 같은 디렉토리에 쓸 임시 파일 경로다.
    temporary_path = env_file.with_name(f".{env_file.name}.tmp")
    temporary_path.write_text(merged_text, encoding="utf-8")
    temporary_path.chmod(0o600)
    temporary_path.replace(env_file)
    env_file.chmod(0o600)
    return backup_path


def restart_systemd_service(service_name: str) -> None:
    """
    입력: systemd 서비스 이름.
    출력: 없음.
    역할: 지정한 서비스를 재시작하고 실패 시 예외를 발생시킨다.
    호출 예시: restart_systemd_service("questbook-api")
    """
    subprocess.run(["systemctl", "restart", service_name], check=True)


def wait_for_health(health_url: str, timeout_seconds: int) -> None:
    """
    입력: 헬스체크 URL과 최대 대기 시간.
    출력: 없음.
    역할: 앱 API가 정상 응답할 때까지 짧게 재시도한다.
    호출 예시: wait_for_health("http://127.0.0.1:8100/api/health", 30)
    """
    # 변수 의미: 헬스체크 종료 시각이다.
    deadline = time.time() + timeout_seconds
    # 변수 의미: 마지막으로 발생한 오류 설명이다.
    last_error = ""
    while time.time() < deadline:
        try:
            with urlopen(health_url, timeout=3) as response:
                # 변수 의미: 헬스체크 응답 상태 코드다.
                status_code = response.status
                if 200 <= status_code < 300:
                    return
                last_error = f"HTTP {status_code}"
        except Exception as error:  # noqa: BLE001 - 헬스체크 재시도에서는 원인 문자열만 보관한다.
            last_error = str(error)
        time.sleep(1)
    raise RuntimeError(f"Health check failed: {health_url} ({last_error})")


def validate_required_options(args: argparse.Namespace) -> None:
    """
    입력: argparse Namespace.
    출력: 없음.
    역할: 필수 실행 옵션 누락 여부를 확인한다.
    호출 예시: validate_required_options(args)
    """
    # 변수 의미: 누락된 필수 옵션 이름 목록이다.
    missing_options = []
    if not args.secret_id:
        missing_options.append("--secret-id or NCP_SECRET_MANAGER_SECRET_ID")
    if not args.access_key:
        missing_options.append("--access-key or NCP_API_ACCESS_KEY")
    if not args.secret_key:
        missing_options.append("--secret-key or NCP_API_SECRET_KEY")
    if missing_options:
        raise RuntimeError("Missing required option(s): " + ", ".join(missing_options))

    # 변수 의미: 파싱된 Secret Manager 엔드포인트다.
    parsed_endpoint = urlparse(args.endpoint)
    if parsed_endpoint.scheme != "https" or not parsed_endpoint.netloc:
        raise RuntimeError("--endpoint must be an absolute https URL.")


def main() -> int:
    """
    입력: 없음.
    출력: 프로세스 종료 코드.
    역할: Secret Manager 값을 dotenv에 반영하고 필요한 운영 동작을 수행한다.
    호출 예시: python scripts/sync_ncp_secret_env.py --write --restart-service questbook-api
    """
    # 변수 의미: 파싱된 명령행 인자다.
    args = parse_args()
    try:
        validate_required_options(args)
        # 변수 의미: Secret Manager에서 가져온 dotenv 갱신 값이다.
        updates = fetch_secret_payload(args.endpoint, args.secret_id, args.access_key, args.secret_key, args.stage)
        # 변수 의미: 정렬한 갱신 key 목록이다.
        update_keys = sorted(updates)
        print(f"Secret Manager에서 {len(update_keys)}개 key를 읽었습니다: {', '.join(update_keys)}")

        if not args.write:
            print("dry-run입니다. 실제 파일을 갱신하려면 --write를 추가하십시오.")
            return 0

        # 변수 의미: dotenv 백업 파일 경로다.
        backup_path = write_env_file(args.env_file, updates, args.backup)
        print(f"dotenv 파일을 갱신했습니다: {args.env_file}")
        if backup_path:
            print(f"기존 dotenv 백업을 생성했습니다: {backup_path}")

        if args.restart_service:
            restart_systemd_service(args.restart_service)
            print(f"systemd 서비스를 재시작했습니다: {args.restart_service}")

        if args.health_url:
            wait_for_health(args.health_url, args.health_timeout_seconds)
            print(f"헬스체크가 성공했습니다: {args.health_url}")
        return 0
    except Exception as error:  # noqa: BLE001 - CLI 최상위에서 사용자에게 실패 원인을 출력한다.
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
