# Questbook 앱 API의 실행 설정과 dotenv 로딩을 담당한다.
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlparse


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
# 변수 의미: 앱 API 서비스 루트 경로다.
SERVICE_ROOT = Path(__file__).resolve().parents[2]
# 변수 의미: 저장소 공통 dotenv 파일 경로다.
ROOT_DOTENV_PATH = REPOSITORY_ROOT / ".env"
# 변수 의미: 앱 API 전용 dotenv 파일 경로다.
SERVICE_DOTENV_PATH = SERVICE_ROOT / ".env"
# 변수 의미: 로컬 개발에서만 허용할 baseline JWT 기본 서명 키다.
DEFAULT_JWT_SECRET = "questbook-local-dev-secret-change-before-deploy"
# 변수 의미: 배포와 실제 OAuth 사용에서 금지할 알려진 약한 JWT 서명 키들이다.
WEAK_JWT_SECRETS = {DEFAULT_JWT_SECRET, "change_this_local_dev_secret_before_deploy", ""}


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


def normalize_public_base_url(raw_value: str, default: str = "http://localhost:8000") -> str:
    """
    입력: 환경 변수에서 읽은 OAuth 공개 origin 후보와 기본값.
    출력: 검증된 공개 origin 문자열.
    역할: redirect_uri 조립에 path/query/fragment가 섞이지 않게 한다.
    호출 예시: base_url = normalize_public_base_url(get_env("QUESTBOOK_PUBLIC_BASE_URL"))
    """
    # 변수 의미: 비어 있으면 대체할 원본 공개 origin 후보 값이다.
    candidate = (raw_value or default).strip().rstrip("/")
    # 변수 의미: 파싱한 공개 origin URL이다.
    parsed_url = urlparse(candidate)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        raise ValueError("QUESTBOOK_PUBLIC_BASE_URL must be an absolute http(s) origin.")
    if parsed_url.path or parsed_url.params or parsed_url.query or parsed_url.fragment:
        raise ValueError("QUESTBOOK_PUBLIC_BASE_URL must not include path, query, or fragment.")
    return candidate


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
    # 변수 의미: PostgreSQL 데이터베이스 접속 URL이다.
    database_url: str
    # 변수 의미: Redis 캐시 접속 URL이다.
    redis_url: str
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

    @classmethod
    def from_env(cls) -> "AppSettings":
        """
        입력: 없음.
        출력: 환경 변수에서 구성한 AppSettings.
        역할: baseline 앱 API의 기본 실행 설정을 만든다.
        호출 예시: settings = AppSettings.from_env()
        """
        # 변수 의미: baseline stateless access token 서명 키다.
        jwt_secret = get_env("QUESTBOOK_JWT_SECRET", DEFAULT_JWT_SECRET)
        # 변수 의미: 네이버 OAuth client ID다.
        naver_oauth_client_id = get_env("NAVER_OAUTH_CLIENT_ID")
        # 변수 의미: 네이버 OAuth client secret이다.
        naver_oauth_client_secret = get_env("NAVER_OAUTH_CLIENT_SECRET")
        # 변수 의미: 구글 OAuth client ID다.
        google_oauth_client_id = get_env("GOOGLE_OAUTH_CLIENT_ID")
        # 변수 의미: 구글 OAuth client secret이다.
        google_oauth_client_secret = get_env("GOOGLE_OAUTH_CLIENT_SECRET")
        # 변수 의미: 실제 OAuth 로그인이 설정되어 있는지 여부다.
        oauth_configured = bool(
            naver_oauth_client_id
            or naver_oauth_client_secret
            or google_oauth_client_id
            or google_oauth_client_secret
        )
        # 변수 의미: 앱 API 바인드 호스트다.
        host = get_env("QUESTBOOK_APP_API_HOST", "127.0.0.1")
        # 변수 의미: 로컬 개발 바인드 여부다.
        is_local_host = host in {"127.0.0.1", "localhost", "::1"}
        # 변수 의미: JWT 서명 키가 배포 또는 OAuth 사용에 충분히 강한지 여부다.
        weak_jwt_secret = jwt_secret in WEAK_JWT_SECRETS or len(jwt_secret) < 32
        if weak_jwt_secret and (oauth_configured or not is_local_host):
            raise ValueError("QUESTBOOK_JWT_SECRET must be set to a strong value before enabling login.")

        return cls(
            host=host,
            port=get_int_env("QUESTBOOK_APP_API_PORT", 8100, 1, 65535),
            database_url=get_env(
                "QUESTBOOK_DATABASE_URL",
                "postgresql://questbook:questbook_local_password@127.0.0.1:5432/questbook",
            ),
            redis_url=get_env("QUESTBOOK_REDIS_URL", "redis://127.0.0.1:6379/0"),
            cache_ttl_seconds=get_int_env("QUESTBOOK_CACHE_TTL_SECONDS", 1800, 60, 86400),
            tourapi_service_key=get_env("TOURAPI_SERVICE_KEY"),
            naver_maps_key_id=get_env("NAVER_MAPS_API_KEY_ID"),
            naver_maps_key=get_env("NAVER_MAPS_API_KEY"),
            gemini_api_key=get_env("GEMINI_API_KEY"),
            jwt_secret=jwt_secret,
            public_base_url=normalize_public_base_url(get_env("QUESTBOOK_PUBLIC_BASE_URL")),
            naver_oauth_client_id=naver_oauth_client_id,
            naver_oauth_client_secret=naver_oauth_client_secret,
            google_oauth_client_id=google_oauth_client_id,
            google_oauth_client_secret=google_oauth_client_secret,
        )
