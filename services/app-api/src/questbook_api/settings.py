# Questbook 앱 API의 실행 설정과 dotenv 로딩을 담당한다.
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
# 변수 의미: 앱 API 서비스 루트 경로다.
SERVICE_ROOT = Path(__file__).resolve().parents[2]
# 변수 의미: 저장소 공통 dotenv 파일 경로다.
ROOT_DOTENV_PATH = REPOSITORY_ROOT / ".env"
# 변수 의미: 앱 API 전용 dotenv 파일 경로다.
SERVICE_DOTENV_PATH = SERVICE_ROOT / ".env"


def load_dotenv_file(path: Path) -> dict[str, str]:
    """
    입력: dotenv 파일 경로.
    출력: 파싱된 환경 변수 딕셔너리.
    역할: 주석과 빈 줄을 제외하고 KEY=VALUE 형식만 읽는다.
    호출 예시: values = load_dotenv_file(ROOT_DOTENV_PATH)
    """
    # 변수 의미: 파일에서 읽은 환경 변수 값이다.
    values: dict[str, str] = {}
    if not path.exists():
        return values

    # 변수 의미: dotenv 파일의 전체 텍스트다.
    dotenv_text = path.read_text(encoding="utf-8")
    for raw_line in dotenv_text.splitlines():
        # 변수 의미: 앞뒤 공백을 제거한 한 줄이다.
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        # 변수 의미: 분리된 환경 변수 이름과 원본 값이다.
        key, raw_value = line.split("=", 1)
        # 변수 의미: 정규화된 환경 변수 이름이다.
        normalized_key = key.strip()
        # 변수 의미: 따옴표를 제거한 환경 변수 값이다.
        normalized_value = raw_value.strip().strip("'").strip('"')
        values[normalized_key] = normalized_value
    return values


def get_env(name: str, default: str = "") -> str:
    """
    입력: 환경 변수 이름과 기본값.
    출력: 실제 환경 변수, 서비스 dotenv, 루트 dotenv, 기본값 순서로 확인한 값.
    역할: secret 값을 출력하지 않고 설정 값을 한곳에서 조회한다.
    호출 예시: port = int(get_env("QUESTBOOK_APP_API_PORT", "8100"))
    """
    # 변수 의미: 앱 API 전용 dotenv에서 읽은 값이다.
    service_values = load_dotenv_file(SERVICE_DOTENV_PATH)
    # 변수 의미: 저장소 루트 dotenv에서 읽은 값이다.
    root_values = load_dotenv_file(ROOT_DOTENV_PATH)
    return os.environ.get(name, service_values.get(name, root_values.get(name, default))).strip()


def get_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    """
    입력: 환경 변수 이름, 기본값, 최솟값, 최댓값.
    출력: 범위 안으로 보정한 정수 설정값.
    역할: 포트와 TTL 같은 숫자 설정을 안전하게 읽는다.
    호출 예시: ttl = get_int_env("QUESTBOOK_CACHE_TTL_SECONDS", 1800, 60, 86400)
    """
    try:
        # 변수 의미: 파싱된 정수 환경 변수 값이다.
        parsed_value = int(get_env(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, parsed_value))


@dataclass(frozen=True)
class AppSettings:
    """
    입력: 없음.
    출력: 앱 API 실행에 필요한 설정 값 묶음.
    역할: 서버, DB, 외부 API, 캐시 설정을 명시적으로 전달한다.
    호출 예시: settings = AppSettings.from_env()
    """

    # 변수 의미: 앱 API 바인드 호스트다.
    host: str
    # 변수 의미: 앱 API 바인드 포트다.
    port: int
    # 변수 의미: SQLite 데이터베이스 파일 경로다.
    database_path: Path
    # 변수 의미: TourAPI 임시 캐시 TTL 초 단위 값이다.
    cache_ttl_seconds: int
    # 변수 의미: 한국관광공사 OpenAPI 서비스 키다.
    tourapi_service_key: str
    # 변수 의미: NAVER Maps Dynamic Map용 공개 Key ID다.
    naver_maps_key_id: str
    # 변수 의미: NAVER Maps REST API 비밀 키다.
    naver_maps_key: str
    # 변수 의미: Gemini API 비밀 키다.
    gemini_api_key: str
    # 변수 의미: baseline stateless access token 서명 키다.
    jwt_secret: str

    @classmethod
    def from_env(cls) -> "AppSettings":
        """
        입력: 없음.
        출력: 환경 변수에서 구성한 AppSettings.
        역할: baseline 앱 API의 기본 실행 설정을 만든다.
        호출 예시: settings = AppSettings.from_env()
        """
        # 변수 의미: 데이터베이스 기본 디렉토리다.
        default_data_dir = REPOSITORY_ROOT / ".questbook"
        # 변수 의미: 데이터베이스 기본 파일 경로다.
        default_database_path = default_data_dir / "baseline.sqlite3"
        # 변수 의미: 환경 변수에서 읽은 DB 경로 문자열이다.
        database_path_value = get_env("QUESTBOOK_DATABASE_PATH", str(default_database_path))
        return cls(
            host=get_env("QUESTBOOK_APP_API_HOST", "127.0.0.1"),
            port=get_int_env("QUESTBOOK_APP_API_PORT", 8100, 1, 65535),
            database_path=Path(database_path_value).expanduser(),
            cache_ttl_seconds=get_int_env("QUESTBOOK_CACHE_TTL_SECONDS", 1800, 60, 86400),
            tourapi_service_key=get_env("TOURAPI_SERVICE_KEY"),
            naver_maps_key_id=get_env("NAVER_MAPS_API_KEY_ID"),
            naver_maps_key=get_env("NAVER_MAPS_API_KEY"),
            gemini_api_key=get_env("GEMINI_API_KEY"),
            jwt_secret=get_env("QUESTBOOK_JWT_SECRET", "questbook-local-dev-secret-change-before-deploy"),
        )
