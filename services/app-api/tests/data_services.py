# Questbook 테스트용 PostgreSQL과 Redis 연결 준비를 담당한다.
from __future__ import annotations

import os
from urllib.parse import urlparse

import psycopg
from psycopg import sql
import redis

# 변수 의미: 관리용 기본 DB 접속 URL이다.
ADMIN_DATABASE_URL = os.environ.get(
    "QUESTBOOK_TEST_ADMIN_DATABASE_URL",
    "postgresql://questbook:questbook_local_password@127.0.0.1:5432/questbook",
)
# 변수 의미: 테스트 전용 DB 접속 URL이다.
TEST_DATABASE_URL = os.environ.get(
    "QUESTBOOK_TEST_DATABASE_URL",
    "postgresql://questbook:questbook_local_password@127.0.0.1:5432/questbook_test",
)
# 변수 의미: 테스트 전용 Redis 접속 URL이다.
TEST_REDIS_URL = os.environ.get("QUESTBOOK_TEST_REDIS_URL", "redis://127.0.0.1:6379/15")


def ensure_test_database() -> str:
    """
    입력: 없음.
    출력: 테스트 DB 접속 URL.
    역할: questbook_test 데이터베이스가 없으면 생성한다.
    호출 예시: url = ensure_test_database()
    """
    # 변수 의미: URL에서 추출한 테스트 DB 이름이다.
    database_name = urlparse(TEST_DATABASE_URL).path.lstrip("/")
    with psycopg.connect(ADMIN_DATABASE_URL, autocommit=True) as connection:
        # 변수 의미: 테스트 DB 존재 여부 row다.
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (database_name,)
        ).fetchone()
        if exists is None:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    return TEST_DATABASE_URL


def reset_database(url: str) -> None:
    """
    입력: 테스트 DB 접속 URL.
    출력: 없음.
    역할: public 스키마를 비워 테스트 간 독립성을 보장한다.
    호출 예시: reset_database(TEST_DATABASE_URL)
    """
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA public CASCADE")
        connection.execute("CREATE SCHEMA public")


def reset_redis(url: str) -> redis.Redis:
    """
    입력: 테스트 Redis 접속 URL.
    출력: 초기화된 Redis 클라이언트.
    역할: 테스트 db 번호의 키를 모두 비운다.
    호출 예시: client = reset_redis(TEST_REDIS_URL)
    """
    # 변수 의미: 문자열 응답 모드의 Redis 클라이언트다.
    client = redis.Redis.from_url(url, decode_responses=True)
    client.flushdb()
    return client


def check_services_available() -> bool:
    """
    입력: 없음.
    출력: PostgreSQL과 Redis 접속 가능 여부.
    역할: 로컬 compose 스택이 없을 때 테스트를 건너뛰게 한다.
    호출 예시: available = check_services_available()
    """
    try:
        with psycopg.connect(ADMIN_DATABASE_URL, connect_timeout=2):
            pass
        redis.Redis.from_url(TEST_REDIS_URL, socket_connect_timeout=2).ping()
    except Exception:
        return False
    return True


# 변수 의미: 테스트 실행 환경에서 데이터 서비스 가용 여부다.
SERVICES_AVAILABLE = check_services_available()
