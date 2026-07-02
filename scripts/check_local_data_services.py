# Questbook 로컬 PostgreSQL과 Redis 연결 상태를 점검한다.
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import socket
import sys
from urllib.parse import urlparse


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
# 변수 의미: 저장소 루트 dotenv 파일 경로다.
ROOT_DOTENV_PATH = REPOSITORY_ROOT / ".env"
# 변수 의미: 로컬 PostgreSQL 기본 접속 URL이다.
DEFAULT_DATABASE_URL = "postgresql://questbook:questbook_local_password@127.0.0.1:5432/questbook"
# 변수 의미: 로컬 Redis 기본 접속 URL이다.
DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0"


@dataclass(frozen=True)
class ServiceEndpoint:
    """
    입력: 서비스 이름, 호스트, 포트, 선택적 데이터베이스 이름.
    출력: 연결 점검에 사용할 엔드포인트 값 객체.
    역할: 비밀번호를 출력하지 않고 서비스 위치만 표현한다.
    호출 예시: endpoint = ServiceEndpoint("PostgreSQL", "127.0.0.1", 5432, "questbook")
    """

    # 변수 의미: 점검할 서비스 이름이다.
    name: str
    # 변수 의미: 서비스 호스트 이름 또는 IP다.
    host: str
    # 변수 의미: 서비스 포트 번호다.
    port: int
    # 변수 의미: 선택적 데이터베이스 이름 또는 번호다.
    database: str = ""


def load_dotenv_file(path: Path) -> dict[str, str]:
    """
    입력: dotenv 파일 경로.
    출력: 파싱된 환경 변수 딕셔너리.
    역할: 비밀 값을 출력하지 않고 연결 점검용 설정만 읽는다.
    호출 예시: values = load_dotenv_file(ROOT_DOTENV_PATH)
    """
    # 변수 의미: dotenv에서 읽은 값 목록이다.
    values: dict[str, str] = {}
    if not path.exists():
        return values

    # 변수 의미: dotenv 파일 원문이다.
    dotenv_text = path.read_text(encoding="utf-8")
    for raw_line in dotenv_text.splitlines():
        # 변수 의미: 앞뒤 공백을 제거한 한 줄이다.
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        # 변수 의미: 환경 변수 이름과 값이다.
        key, raw_value = line.split("=", 1)
        values[key.strip()] = raw_value.strip().strip("'").strip('"')
    return values


def get_env(name: str, default: str, dotenv_values: dict[str, str]) -> str:
    """
    입력: 환경 변수 이름, 기본값, dotenv 값 목록.
    출력: 실제 환경 변수, dotenv, 기본값 순서로 선택한 문자열.
    역할: 로컬 점검 스크립트가 `.env`와 셸 환경을 함께 따르게 한다.
    호출 예시: database_url = get_env("QUESTBOOK_DATABASE_URL", DEFAULT_DATABASE_URL, values)
    """
    return os.environ.get(name, dotenv_values.get(name, default)).strip()


def endpoint_from_url(service_name: str, raw_url: str, default_port: int) -> ServiceEndpoint:
    """
    입력: 서비스 이름, 접속 URL, 기본 포트.
    출력: 비밀번호가 제거된 서비스 엔드포인트.
    역할: PostgreSQL과 Redis URL에서 연결 점검에 필요한 위치만 추출한다.
    호출 예시: endpoint = endpoint_from_url("Redis", redis_url, 6379)
    """
    # 변수 의미: 파싱된 URL 구조다.
    parsed_url = urlparse(raw_url)
    # 변수 의미: 접속 호스트다.
    host = parsed_url.hostname or "127.0.0.1"
    # 변수 의미: 접속 포트다.
    port = parsed_url.port or default_port
    # 변수 의미: 앞의 슬래시를 제거한 데이터베이스 이름 또는 번호다.
    database = parsed_url.path.lstrip("/")
    return ServiceEndpoint(service_name, host, port, database)


def check_tcp(endpoint: ServiceEndpoint, timeout_seconds: float = 3.0) -> tuple[bool, str]:
    """
    입력: 서비스 엔드포인트와 제한 시간.
    출력: 성공 여부와 진단 문구.
    역할: PostgreSQL 포트가 열려 있는지 확인한다.
    호출 예시: ok, message = check_tcp(postgres_endpoint)
    """
    try:
        with socket.create_connection((endpoint.host, endpoint.port), timeout=timeout_seconds):
            return True, f"{endpoint.name} TCP 연결 가능: {endpoint.host}:{endpoint.port}"
    except OSError as error:
        return False, f"{endpoint.name} TCP 연결 실패: {endpoint.host}:{endpoint.port} ({error})"


def check_postgres(endpoint: ServiceEndpoint, raw_url: str, timeout_seconds: float = 3.0) -> tuple[bool, str]:
    """
    입력: PostgreSQL 엔드포인트, 접속 URL, 제한 시간.
    출력: 성공 여부와 진단 문구.
    역할: psycopg가 있으면 실제 쿼리를 실행하고, 없으면 TCP 연결만 확인한다.
    호출 예시: ok, message = check_postgres(postgres_endpoint, database_url)
    """
    try:
        import psycopg
    except ModuleNotFoundError:
        # psycopg가 없는 시스템 Python에서는 포트 준비 상태까지만 확인한다.
        return check_tcp(endpoint, timeout_seconds)

    try:
        with psycopg.connect(raw_url, connect_timeout=timeout_seconds) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select current_database(), current_user")
                # 변수 의미: PostgreSQL에서 확인한 현재 DB와 사용자다.
                database_name, user_name = cursor.fetchone()
    except Exception as error:
        return False, f"{endpoint.name} 쿼리 실패: {endpoint.host}:{endpoint.port} ({error.__class__.__name__})"

    return True, f"{endpoint.name} 쿼리 성공: {endpoint.host}:{endpoint.port}/{database_name} ({user_name})"


def check_redis_ping(endpoint: ServiceEndpoint, timeout_seconds: float = 3.0) -> tuple[bool, str]:
    """
    입력: Redis 엔드포인트와 제한 시간.
    출력: 성공 여부와 진단 문구.
    역할: redis-cli 없이 RESP PING으로 Redis 응답을 확인한다.
    호출 예시: ok, message = check_redis_ping(redis_endpoint)
    """
    try:
        with socket.create_connection((endpoint.host, endpoint.port), timeout=timeout_seconds) as connection:
            connection.settimeout(timeout_seconds)
            connection.sendall(b"*1\r\n$4\r\nPING\r\n")
            # 변수 의미: Redis PING 응답 바이트다.
            response = connection.recv(64)
    except OSError as error:
        return False, f"{endpoint.name} PING 실패: {endpoint.host}:{endpoint.port} ({error})"

    if response.startswith(b"+PONG"):
        return True, f"{endpoint.name} PING 성공: {endpoint.host}:{endpoint.port}"
    return False, f"{endpoint.name} PING 비정상 응답: {endpoint.host}:{endpoint.port}"


def main() -> int:
    """
    입력: 없음.
    출력: 프로세스 종료 코드.
    역할: PostgreSQL과 Redis의 로컬 접속 가능 여부를 점검한다.
    호출 예시: python3 scripts/check_local_data_services.py
    """
    # 변수 의미: dotenv에서 읽은 환경 변수 값이다.
    dotenv_values = load_dotenv_file(ROOT_DOTENV_PATH)
    # 변수 의미: PostgreSQL 접속 URL이다.
    database_url = get_env("QUESTBOOK_DATABASE_URL", DEFAULT_DATABASE_URL, dotenv_values)
    # 변수 의미: Redis 접속 URL이다.
    redis_url = get_env("QUESTBOOK_REDIS_URL", DEFAULT_REDIS_URL, dotenv_values)
    # 변수 의미: PostgreSQL 엔드포인트다.
    postgres_endpoint = endpoint_from_url("PostgreSQL", database_url, 5432)
    # 변수 의미: Redis 엔드포인트다.
    redis_endpoint = endpoint_from_url("Redis", redis_url, 6379)

    # 변수 의미: 각 서비스 점검 결과 목록이다.
    checks = [
        check_postgres(postgres_endpoint, database_url),
        check_redis_ping(redis_endpoint),
    ]

    for ok, message in checks:
        print(("OK" if ok else "FAIL") + f" - {message}")

    return 0 if all(ok for ok, _message in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
