# Questbook baseline PostgreSQL 저장소와 트랜잭션을 담당한다.
from __future__ import annotations

from datetime import datetime, timezone
from threading import RLock
from typing import Any
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


def now_iso() -> str:
    """
    입력: 없음.
    출력: UTC ISO-8601 시각 문자열.
    역할: DB 저장 시각 형식을 통일한다.
    호출 예시: created_at = now_iso()
    """
    return datetime.now(timezone.utc).isoformat()


def make_id(prefix: str) -> str:
    """
    입력: 식별자 접두사.
    출력: 접두사가 붙은 고유 식별자.
    역할: 외부 의존성 없이 baseline 엔티티 ID를 만든다.
    호출 예시: quest_id = make_id("rq")
    """
    return f"{prefix}_{uuid4().hex[:16]}"


def iso_dict_row(cursor: psycopg.Cursor[Any]) -> Any:
    """
    입력: psycopg 커서.
    출력: row를 dict로 만들며 datetime을 ISO-8601 문자열로 바꾸는 변환 함수.
    역할: 저장소 밖으로는 기존 계약대로 문자열 시각만 내보낸다.
    호출 예시: connection = psycopg.connect(url, row_factory=iso_dict_row)
    """
    # 변수 의미: 기본 dict 변환 함수다.
    base_factory = dict_row(cursor)

    def convert(record: Any) -> dict[str, Any]:
        """
        입력: psycopg row record.
        출력: datetime 값이 문자열로 정규화된 dict row.
        역할: TIMESTAMPTZ 컬럼을 API 직렬화 가능한 값으로 바꾼다.
        호출 예시: row = convert(record)
        """
        # 변수 의미: dict로 변환된 row다.
        row = base_factory(record)
        return {
            key: value.isoformat() if isinstance(value, datetime) else value
            for key, value in row.items()
        }

    return convert


# 변수 의미: baseline PostgreSQL 스키마 생성 SQL이다.
SCHEMA_SQL = """
-- Questbook baseline PostgreSQL 스키마를 정의한다.

CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  avatar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  categories_json JSONB NOT NULL,
  distance_range_meters INTEGER NOT NULL,
  pace TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS level_progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_level INTEGER NOT NULL,
  current_xp INTEGER NOT NULL,
  total_xp INTEGER NOT NULL,
  next_level_required_xp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_consents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_confirmed BOOLEAN NOT NULL,
  privacy_consent BOOLEAN NOT NULL,
  location_consent BOOLEAN NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS badge_definitions (
  id TEXT PRIMARY KEY,
  category_code TEXT NOT NULL REFERENCES categories(code),
  name TEXT NOT NULL,
  tier INTEGER NOT NULL,
  required_xp INTEGER NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(category_code, tier)
);

CREATE TABLE IF NOT EXISTS user_badges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_definition_id TEXT NOT NULL REFERENCES badge_definitions(id),
  progress_xp INTEGER NOT NULL,
  earned_at TIMESTAMPTZ,
  UNIQUE(user_id, badge_definition_id)
);

CREATE TABLE IF NOT EXISTS reusable_quests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  category_code TEXT NOT NULL REFERENCES categories(code),
  reward_xp INTEGER NOT NULL,
  verification_type TEXT NOT NULL,
  place_content_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  source TEXT NOT NULL,
  review_status TEXT NOT NULL,
  created_for_user_id TEXT NOT NULL REFERENCES users(id),
  is_reusable BOOLEAN NOT NULL,
  reuse_count INTEGER NOT NULL,
  completion_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(place_content_id, category_code, type)
);

CREATE TABLE IF NOT EXISTS user_quest_instances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reusable_quest_id TEXT NOT NULL REFERENCES reusable_quests(id),
  status TEXT NOT NULL,
  recommended_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_quest_instances_user_status
  ON user_quest_instances(user_id, status);

CREATE TABLE IF NOT EXISTS quest_completions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_quest_instance_id TEXT NOT NULL REFERENCES user_quest_instances(id),
  reusable_quest_id TEXT NOT NULL REFERENCES reusable_quests(id),
  completed_at TIMESTAMPTZ NOT NULL,
  earned_xp INTEGER NOT NULL,
  verification_result_json JSONB NOT NULL,
  photo_ref TEXT,
  note_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_quest_completions_user
  ON quest_completions(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_completions_instance
  ON quest_completions(user_quest_instance_id);

CREATE TABLE IF NOT EXISTS adventure_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reusable_quest_id TEXT NOT NULL REFERENCES reusable_quests(id),
  quest_completion_id TEXT NOT NULL REFERENCES quest_completions(id),
  place_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  badges_json JSONB NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL,
  share_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adventure_notes_user_created
  ON adventure_notes(user_id, created_at);

CREATE TABLE IF NOT EXISTS ggumdori_variants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  theme_category TEXT NOT NULL REFERENCES categories(code),
  tier INTEGER NOT NULL,
  unlock_condition TEXT NOT NULL,
  image_ref TEXT NOT NULL,
  description TEXT NOT NULL,
  rarity TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(theme_category, tier)
);

CREATE TABLE IF NOT EXISTS user_ggumdori (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES ggumdori_variants(id),
  unlocked_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, variant_id)
);

CREATE TABLE IF NOT EXISTS ggumdori_selection (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  selected_variant_id TEXT NOT NULL REFERENCES ggumdori_variants(id),
  updated_at TIMESTAMPTZ NOT NULL
);
"""


# 변수 의미: baseline 기준 카테고리 seed 데이터다.
CATEGORY_SEEDS = [
    ("nature", "자연 관찰", "도심 녹지와 공원을 탐험하는 관광 성향", 10),
    ("science", "과학 문화", "전시와 과학 체험을 선호하는 관광 성향", 20),
    ("downtown", "원도심 걷기", "대전 원도심 골목과 거리를 걷는 관광 성향", 30),
    ("market", "지역 상권", "로컬 상권과 먹거리를 방문하는 관광 성향", 40),
    ("mobility", "이동형", "타슈와 대중교통을 활용해 이동하는 관광 성향", 50),
    ("nightview", "야경 기록", "전망과 야간 관광지를 기록하는 관광 성향", 60),
]


# 변수 의미: baseline 뱃지 정의 seed 데이터다.
BADGE_SEEDS = [
    ("badge_nature_1", "nature", "초록 탐험가", 1, 50, "🌳", "#0a8f48", 10),
    ("badge_nature_2", "nature", "숲 탐험 꿈나무", 2, 140, "🌲", "#08783c", 11),
    ("badge_science_1", "science", "과학 탐험가", 1, 80, "🧪", "#3d7ad6", 20),
    ("badge_science_2", "science", "실험실 탐험가", 2, 170, "🔬", "#275cb5", 21),
    ("badge_downtown_1", "downtown", "대전 워커", 1, 40, "🗼", "#d39172", 30),
    ("badge_downtown_2", "downtown", "원도심 산책가", 2, 130, "🏙️", "#b96f4e", 31),
    ("badge_market_1", "market", "빵지순례자", 1, 60, "🥐", "#c9943f", 40),
    ("badge_market_2", "market", "상권 탐험가", 2, 150, "🛍️", "#a87624", 41),
    ("badge_mobility_1", "mobility", "타슈 라이더", 1, 70, "🚲", "#4b9fb8", 50),
    ("badge_mobility_2", "mobility", "도시 연결자", 2, 160, "🚌", "#287f98", 51),
    ("badge_nightview_1", "nightview", "전망 수집가", 1, 70, "🌙", "#796cb1", 60),
    ("badge_nightview_2", "nightview", "야경 기록가", 2, 160, "🌃", "#5c5298", 61),
]


# 변수 의미: 꿈돌이 도감 seed 데이터다.
GGUMDORI_SEEDS = [
    ("ggumdori_market_2", "제빵 꿈돌이", "market", 2, "market Lv.2", "/assets/ggumdori/market-2.svg", "지역 상권 탐험을 좋아하는 꿈돌이입니다.", "rare", 10),
    ("ggumdori_science_1", "안경 꿈돌이", "science", 1, "science Lv.1", "/assets/ggumdori/science-1.svg", "과학 전시와 실험을 좋아하는 꿈돌이입니다.", "common", 20),
    ("ggumdori_science_2", "플라스크 꿈돌이", "science", 2, "science Lv.2", "/assets/ggumdori/science-2.svg", "깊은 과학 탐험을 상징하는 꿈돌이입니다.", "rare", 21),
    ("ggumdori_nature_2", "숲 탐험 꿈돌이", "nature", 2, "nature Lv.2", "/assets/ggumdori/nature-2.svg", "대전의 녹지를 누비는 꿈돌이입니다.", "rare", 30),
    ("ggumdori_mobility_1", "타슈 꿈돌이", "mobility", 1, "mobility Lv.1", "/assets/ggumdori/mobility-1.svg", "이동형 퀘스트를 즐기는 꿈돌이입니다.", "common", 40),
    ("ggumdori_nightview_2", "야경 꿈돌이", "nightview", 2, "nightview Lv.2", "/assets/ggumdori/nightview-2.svg", "야경과 전망을 수집하는 꿈돌이입니다.", "rare", 50),
]


class QuestbookRepository:
    """
    입력: PostgreSQL 데이터베이스 접속 URL.
    출력: baseline 관계형 저장소 객체.
    역할: 사용자, 퀘스트, 뱃지, 수첩, 꿈돌이 상태를 하나의 DB에서 관리한다.
    호출 예시: repository = QuestbookRepository("postgresql://questbook:password@127.0.0.1:5432/questbook")
    """

    def __init__(self, database_url: str) -> None:
        """
        입력: PostgreSQL 접속 URL.
        출력: 없음.
        역할: 단일 연결과 동시성 잠금을 준비한다.
        호출 예시: repository = QuestbookRepository(settings.database_url)
        """
        # 변수 의미: PostgreSQL 접속 URL이다.
        self.database_url = database_url
        # 변수 의미: DB 접근 동시성을 보호하는 잠금이다.
        self._lock = RLock()
        # 변수 의미: PostgreSQL 연결 객체다.
        self._connection = psycopg.connect(database_url, row_factory=iso_dict_row, autocommit=True)

    def initialize(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 스키마를 만들고 기준 데이터를 seed한다.
        호출 예시: repository.initialize()
        """
        with self._lock, self._connection.transaction():
            self._connection.execute(SCHEMA_SQL)
            self._seed_reference_data()

    def close(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: PostgreSQL 연결을 닫는다.
        호출 예시: repository.close()
        """
        with self._lock:
            self._connection.close()

    def is_healthy(self) -> bool:
        """
        입력: 없음.
        출력: DB 조회 가능 여부.
        역할: 헬스체크에서 관계형 저장소 상태를 확인한다.
        호출 예시: ok = repository.is_healthy()
        """
        with self._lock:
            try:
                # 변수 의미: PostgreSQL 단순 조회 결과다.
                result = self._connection.execute("SELECT 1 AS ok").fetchone()
            except psycopg.Error:
                return False
            return bool(result and result["ok"] == 1)

    def _seed_reference_data(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 카테고리, 뱃지, 꿈돌이 기준 데이터를 삽입한다.
        호출 예시: self._seed_reference_data()
        """
        # 변수 의미: seed 삽입에 사용하는 커서다.
        with self._connection.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO categories(code, name, description, sort_order) VALUES (%s, %s, %s, %s) ON CONFLICT (code) DO NOTHING",
                CATEGORY_SEEDS,
            )
            cursor.executemany(
                """
                INSERT INTO badge_definitions(
                  id, category_code, name, tier, required_xp, icon, color, sort_order
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                BADGE_SEEDS,
            )
            cursor.executemany(
                """
                INSERT INTO ggumdori_variants(
                  id, name, theme_category, tier, unlock_condition, image_ref, description, rarity, sort_order
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                GGUMDORI_SEEDS,
            )

    def ensure_user(self, user_id: str = "demo-user") -> dict[str, Any]:
        """
        입력: 사용자 ID.
        출력: 사용자 공개 정보 딕셔너리.
        역할: baseline에서 소셜 로그인 전 기본 사용자를 준비한다.
        호출 예시: user = repository.ensure_user(\"demo-user\")
        """
        with self._lock, self._connection.transaction():
            # 변수 의미: 현재 시각 문자열이다.
            current_time = now_iso()
            self._connection.execute(
                """
                INSERT INTO users(id, nickname, avatar, created_at, last_active_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (user_id, "꼬마 탐험가", "✦", current_time, current_time),
            )
            self._connection.execute(
                """
                INSERT INTO preferences(user_id, categories_json, distance_range_meters, pace, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_id, Jsonb(["nature", "science", "downtown"]), 5000, "보통", current_time),
            )
            self._connection.execute(
                """
                INSERT INTO level_progress(user_id, current_level, current_xp, total_xp, next_level_required_xp)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_id, 1, 0, 0, 100),
            )
            self._connection.execute("UPDATE users SET last_active_at = %s WHERE id = %s", (current_time, user_id))
            return self.get_user(user_id)

    def link_user_account(
        self,
        user_id: str,
        provider: str,
        provider_user_id: str,
        display_name: str | None,
        email: str | None,
    ) -> dict[str, Any]:
        """
        입력: 사용자 ID, provider, provider 사용자 ID, 표시 이름, 이메일.
        출력: 연결된 사용자 계정 딕셔너리.
        역할: OAuth/OIDC 실연동 전에도 provider 기반 사용자 식별 구조를 유지한다.
        호출 예시: account = repository.link_user_account(\"demo-user\", \"demo-social\", \"demo-user\", \"꼬마 탐험가\", None)
        """
        with self._lock, self._connection.transaction():
            # 변수 의미: 현재 시각 문자열이다.
            current_time = now_iso()
            # 변수 의미: 삽입 또는 갱신된 provider 계정 row다.
            row = self._connection.execute(
                """
                INSERT INTO user_accounts(
                  id, user_id, provider, provider_user_id, email, display_name, created_at, last_login_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (provider, provider_user_id) DO UPDATE SET
                  email = EXCLUDED.email,
                  display_name = EXCLUDED.display_name,
                  last_login_at = EXCLUDED.last_login_at
                RETURNING *
                """,
                (
                    make_id("acct"),
                    user_id,
                    provider,
                    provider_user_id,
                    email,
                    display_name,
                    current_time,
                    current_time,
                ),
            ).fetchone()
            return dict(row)

    def _delete_user_if_unlinked(self, user_id: str) -> None:
        """
        입력: 사용자 ID.
        출력: 없음.
        역할: OAuth identity 동시 생성 경쟁에서 계정에 연결되지 않은 신규 사용자를 정리한다.
        호출 예시: self._delete_user_if_unlinked("usr_x")
        """
        with self._lock, self._connection.transaction():
            # 변수 의미: 사용자 ID를 참조하는 provider 계정 row다.
            linked_row = self._connection.execute(
                "SELECT 1 FROM user_accounts WHERE user_id = %s LIMIT 1",
                (user_id,),
            ).fetchone()
            if linked_row is None:
                self._connection.execute("DELETE FROM users WHERE id = %s", (user_id,))

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
        with self._lock:
            # 변수 의미: 기존에 연결된 사용자 ID다.
            existing_user_id = self.find_user_id_by_identity(provider, provider_user_id)
            # 변수 의미: 사용할 baseline 사용자 ID다.
            user_id = existing_user_id or make_id("usr")
            self.ensure_user(user_id)
            # 변수 의미: 연결 또는 재사용된 provider 계정 row다.
            account = self.link_user_account(
                user_id=user_id,
                provider=provider,
                provider_user_id=provider_user_id,
                display_name=display_name,
                email=email,
            )
            # 변수 의미: 최종적으로 provider 신원에 연결된 baseline 사용자 ID다.
            linked_user_id = str(account["user_id"])
            if linked_user_id != user_id:
                self._delete_user_if_unlinked(user_id)
            return linked_user_id

    def record_user_consent(
        self,
        user_id: str,
        age_confirmed: bool,
        privacy_consent: bool,
        location_consent: bool,
        consent_version: str,
    ) -> dict[str, Any]:
        """
        입력: 사용자 ID, 연령 확인 여부, 개인정보 동의, 위치정보 동의, 동의 문구 버전.
        출력: 저장된 동의 상태 딕셔너리.
        역할: 가입 또는 최초 위치 사용 전 필요한 동의와 만 14세 이상 확인을 기록한다.
        호출 예시: consent = repository.record_user_consent(\"demo-user\", True, True, True, \"baseline-2026-07\")
        """
        if not age_confirmed or not privacy_consent or not location_consent:
            raise ValueError("all baseline consents are required")
        with self._lock, self._connection.transaction():
            # 변수 의미: 동의 기록 시각이다.
            consented_at = now_iso()
            self._connection.execute(
                """
                INSERT INTO user_consents(
                  user_id, age_confirmed, privacy_consent, location_consent, consent_version, consented_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                  age_confirmed = EXCLUDED.age_confirmed,
                  privacy_consent = EXCLUDED.privacy_consent,
                  location_consent = EXCLUDED.location_consent,
                  consent_version = EXCLUDED.consent_version,
                  consented_at = EXCLUDED.consented_at
                """,
                (
                    user_id,
                    age_confirmed,
                    privacy_consent,
                    location_consent,
                    consent_version,
                    consented_at,
                ),
            )
            return self.get_user_consent(user_id)

    def get_user_consent(self, user_id: str) -> dict[str, Any]:
        """
        입력: 사용자 ID.
        출력: 사용자 동의 상태 딕셔너리.
        역할: API 요청 전에 위치정보·개인정보 동의와 연령 확인 상태를 점검한다.
        호출 예시: consent = repository.get_user_consent(\"demo-user\")
        """
        with self._lock:
            # 변수 의미: 사용자 동의 row다.
            row = self._connection.execute(
                "SELECT * FROM user_consents WHERE user_id = %s",
                (user_id,),
            ).fetchone()
            if row is None:
                return {
                    "ageConfirmed": False,
                    "privacyConsent": False,
                    "locationConsent": False,
                    "consentVersion": None,
                    "consentedAt": None,
                    "ready": False,
                }
            return {
                "ageConfirmed": bool(row["age_confirmed"]),
                "privacyConsent": bool(row["privacy_consent"]),
                "locationConsent": bool(row["location_consent"]),
                "consentVersion": row["consent_version"],
                "consentedAt": row["consented_at"],
                "ready": bool(row["age_confirmed"] and row["privacy_consent"] and row["location_consent"]),
            }

    def get_user(self, user_id: str) -> dict[str, Any]:
        """
        입력: 사용자 ID.
        출력: 사용자, 선호도, 레벨 요약 딕셔너리.
        역할: 홈 화면과 API 인증 컨텍스트에서 사용자 상태를 조회한다.
        호출 예시: user = repository.get_user(\"demo-user\")
        """
        with self._lock:
            # 변수 의미: 사용자와 레벨 진행도를 조인한 row다.
            row = self._connection.execute(
                """
                SELECT u.id, u.nickname, u.avatar, u.created_at, u.last_active_at,
                       lp.current_level, lp.current_xp, lp.total_xp, lp.next_level_required_xp,
                       p.categories_json, p.distance_range_meters, p.pace
                FROM users u
                JOIN level_progress lp ON lp.user_id = u.id
                JOIN preferences p ON p.user_id = u.id
                WHERE u.id = %s
                """,
                (user_id,),
            ).fetchone()
            if row is None:
                raise KeyError(f"unknown user: {user_id}")

            # 변수 의미: 완료한 퀘스트 수다.
            completion_count = self._connection.execute(
                "SELECT COUNT(*) AS count FROM quest_completions WHERE user_id = %s",
                (user_id,),
            ).fetchone()["count"]
            # 변수 의미: 획득한 뱃지 수다.
            earned_badge_count = self._connection.execute(
                "SELECT COUNT(*) AS count FROM user_badges WHERE user_id = %s AND earned_at IS NOT NULL",
                (user_id,),
            ).fetchone()["count"]
            return {
                "id": row["id"],
                "nickname": row["nickname"],
                "avatar": row["avatar"],
                "createdAt": row["created_at"],
                "lastActiveAt": row["last_active_at"],
                "level": {
                    "currentLevel": row["current_level"],
                    "currentXp": row["current_xp"],
                    "totalXp": row["total_xp"],
                    "nextLevelRequiredXp": row["next_level_required_xp"],
                    "progressPercent": min(100, round(row["current_xp"] / row["next_level_required_xp"] * 100)),
                },
                "preference": {
                    "categories": row["categories_json"],
                    "distanceRangeMeters": row["distance_range_meters"],
                    "pace": row["pace"],
                },
                "stats": {
                    "completedQuestCount": completion_count,
                    "earnedBadgeCount": earned_badge_count,
                },
                "consent": self.get_user_consent(user_id),
            }

    def get_category_codes(self) -> list[str]:
        """
        입력: 없음.
        출력: 카테고리 코드 목록.
        역할: API 입력 검증에서 허용 카테고리를 확인한다.
        호출 예시: codes = repository.get_category_codes()
        """
        with self._lock:
            # 변수 의미: 정렬된 카테고리 row 목록이다.
            rows = self._connection.execute("SELECT code FROM categories ORDER BY sort_order").fetchall()
            return [row["code"] for row in rows]

    def get_or_create_reusable_quest(self, user_id: str, quest_data: dict[str, Any]) -> dict[str, Any]:
        """
        입력: 사용자 ID와 생성할 공용 퀘스트 데이터.
        출력: 공용 퀘스트 row 딕셔너리.
        역할: contentId 기반으로 기존 퀘스트를 재사용하거나 새 템플릿 퀘스트를 저장한다.
        호출 예시: quest = repository.get_or_create_reusable_quest(user_id, quest_data)
        """
        with self._lock, self._connection.transaction():
            # 변수 의미: 기존 공용 퀘스트 row다.
            existing_row = self._connection.execute(
                """
                SELECT * FROM reusable_quests
                WHERE place_content_id = %s AND category_code = %s AND type = %s
                """,
                (quest_data["placeContentId"], quest_data["categoryCode"], quest_data["type"]),
            ).fetchone()
            if existing_row is not None:
                return dict(existing_row)

            # 변수 의미: 새 공용 퀘스트 식별자다.
            quest_id = make_id("rq")
            # 변수 의미: 생성 시각 문자열이다.
            created_at = now_iso()
            self._connection.execute(
                """
                INSERT INTO reusable_quests(
                  id, title, description, type, category_code, reward_xp, verification_type,
                  place_content_id, place_name, source, review_status, created_for_user_id,
                  is_reusable, reuse_count, completion_count, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    quest_id,
                    quest_data["title"],
                    quest_data["description"],
                    quest_data["type"],
                    quest_data["categoryCode"],
                    quest_data["rewardXp"],
                    quest_data["verificationType"],
                    quest_data["placeContentId"],
                    quest_data["placeName"],
                    quest_data["source"],
                    "approved",
                    user_id,
                    True,
                    0,
                    0,
                    created_at,
                ),
            )
            return dict(self._connection.execute("SELECT * FROM reusable_quests WHERE id = %s", (quest_id,)).fetchone())

    def get_or_create_user_quest_instance(self, user_id: str, reusable_quest_id: str, expires_at: str) -> dict[str, Any]:
        """
        입력: 사용자 ID, 공용 퀘스트 ID, 추천 만료 시각.
        출력: 사용자별 퀘스트 인스턴스 row 딕셔너리.
        역할: 같은 사용자의 진행 중 퀘스트 상태를 재사용하고 없으면 추천 상태로 만든다.
        호출 예시: instance = repository.get_or_create_user_quest_instance(user_id, quest_id, expires_at)
        """
        with self._lock, self._connection.transaction():
            # 변수 의미: 아직 완료되지 않은 기존 인스턴스 row다.
            existing_row = self._connection.execute(
                """
                SELECT * FROM user_quest_instances
                WHERE user_id = %s AND reusable_quest_id = %s AND status IN ('recommended', 'accepted', 'in_progress')
                ORDER BY recommended_at DESC
                LIMIT 1
                """,
                (user_id, reusable_quest_id),
            ).fetchone()
            if existing_row is not None:
                return dict(existing_row)

            # 변수 의미: 새 사용자 퀘스트 인스턴스 ID다.
            instance_id = make_id("uqi")
            # 변수 의미: 추천 시각 문자열이다.
            recommended_at = now_iso()
            self._connection.execute(
                """
                INSERT INTO user_quest_instances(
                  id, user_id, reusable_quest_id, status, recommended_at, accepted_at, expires_at, completed_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (instance_id, user_id, reusable_quest_id, "recommended", recommended_at, None, expires_at, None),
            )
            self._connection.execute(
                "UPDATE reusable_quests SET reuse_count = reuse_count + 1 WHERE id = %s",
                (reusable_quest_id,),
            )
            return dict(self._connection.execute("SELECT * FROM user_quest_instances WHERE id = %s", (instance_id,)).fetchone())

    def get_instance_with_quest(self, user_id: str, instance_id: str) -> dict[str, Any] | None:
        """
        입력: 사용자 ID와 사용자별 퀘스트 인스턴스 ID.
        출력: 인스턴스와 공용 퀘스트를 합친 딕셔너리 또는 None.
        역할: 수락과 완료 요청에서 본인 퀘스트만 조회한다.
        호출 예시: instance = repository.get_instance_with_quest(user_id, instance_id)
        """
        with self._lock:
            # 변수 의미: 인스턴스와 공용 퀘스트 조인 row다.
            row = self._connection.execute(
                """
                SELECT uqi.id AS instance_id, uqi.status, uqi.recommended_at, uqi.accepted_at,
                       uqi.expires_at, uqi.completed_at,
                       rq.id AS reusable_quest_id, rq.title, rq.description, rq.type,
                       rq.category_code, rq.reward_xp, rq.verification_type,
                       rq.place_content_id, rq.place_name, rq.source
                FROM user_quest_instances uqi
                JOIN reusable_quests rq ON rq.id = uqi.reusable_quest_id
                WHERE uqi.user_id = %s AND uqi.id = %s
                """,
                (user_id, instance_id),
            ).fetchone()
            return dict(row) if row is not None else None

    def accept_quest(self, user_id: str, instance_id: str) -> dict[str, Any]:
        """
        입력: 사용자 ID와 사용자별 퀘스트 인스턴스 ID.
        출력: 갱신된 퀘스트 인스턴스 딕셔너리.
        역할: 추천 상태 퀘스트를 진행 상태로 바꾼다.
        호출 예시: instance = repository.accept_quest(user_id, instance_id)
        """
        with self._lock, self._connection.transaction():
            # 변수 의미: 갱신 시각 문자열이다.
            accepted_at = now_iso()
            self._connection.execute(
                """
                UPDATE user_quest_instances
                SET status = 'accepted', accepted_at = COALESCE(accepted_at, %s)
                WHERE id = %s AND user_id = %s AND status IN ('recommended', 'accepted', 'in_progress')
                """,
                (accepted_at, instance_id, user_id),
            )
            # 변수 의미: 갱신 후 인스턴스 row다.
            instance = self.get_instance_with_quest(user_id, instance_id)
            if instance is None:
                raise KeyError(f"unknown quest instance: {instance_id}")
            return instance

    def complete_quest(
        self,
        user_id: str,
        instance: dict[str, Any],
        verification_result: dict[str, Any],
        distance_km: float,
        photo_ref: str | None = None,
    ) -> dict[str, Any] | None:
        """
        입력: 사용자 ID, 인스턴스와 공용 퀘스트 정보, 인증 결과, 이동 거리, 선택적 사진 객체 키.
        출력: 완료 처리 결과 딕셔너리 또는 이미 완료된 경우 None.
        역할: QuestCompletion, LevelProgress, UserBadge, UserGgumdori, AdventureNote를 하나의 트랜잭션으로 갱신한다.
        호출 예시: result = repository.complete_quest(user_id, instance, verification, 0.2, photo_ref)
        """
        with self._lock, self._connection.transaction():
            # 변수 의미: 완료 시각 문자열이다.
            completed_at = now_iso()
            # 변수 의미: 완료 기록 ID다.
            completion_id = make_id("qc")
            # 변수 의미: 수첩 기록 ID다.
            note_id = make_id("note")
            # 변수 의미: 획득 XP다.
            earned_xp = int(instance["reward_xp"])
            # 변수 의미: 완료 상태 전이 UPDATE 커서다.
            transition_cursor = self._connection.execute(
                """
                UPDATE user_quest_instances
                SET status = 'completed', completed_at = %s
                WHERE id = %s AND user_id = %s AND status != 'completed'
                """,
                (completed_at, instance["instance_id"], user_id),
            )
            if transition_cursor.rowcount != 1:
                return None
            self._connection.execute(
                """
                INSERT INTO quest_completions(
                  id, user_id, user_quest_instance_id, reusable_quest_id, completed_at,
                  earned_xp, verification_result_json, photo_ref, note_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    completion_id,
                    user_id,
                    instance["instance_id"],
                    instance["reusable_quest_id"],
                    completed_at,
                    earned_xp,
                    Jsonb(verification_result),
                    photo_ref,
                    note_id,
                ),
            )
            self._connection.execute(
                "UPDATE reusable_quests SET completion_count = completion_count + 1 WHERE id = %s",
                (instance["reusable_quest_id"],),
            )
            # 변수 의미: 갱신 후 레벨 진행도다.
            level = self._update_level_progress(user_id, earned_xp)
            # 변수 의미: 갱신된 뱃지와 새로 획득한 뱃지 목록이다.
            badge_result = self._update_badges(user_id, instance["category_code"], earned_xp, completed_at)
            # 변수 의미: 새로 해금된 꿈돌이 목록이다.
            unlocked_ggumdori = self._unlock_ggumdori(user_id, badge_result["earnedBadges"], completed_at)
            # 변수 의미: 수첩에 기록할 뱃지 이름 목록이다.
            badge_names = [badge["name"] for badge in badge_result["earnedBadges"]] or [
                badge["name"] for badge in badge_result["progressBadges"][:1]
            ]
            self._connection.execute(
                """
                INSERT INTO adventure_notes(
                  id, user_id, reusable_quest_id, quest_completion_id, place_name,
                  summary, badges_json, distance_km, share_image_url, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    note_id,
                    user_id,
                    instance["reusable_quest_id"],
                    completion_id,
                    instance["place_name"],
                    f"{instance['title']} 완료로 {earned_xp} XP를 획득했습니다.",
                    Jsonb(badge_names),
                    distance_km,
                    None,
                    completed_at,
                ),
            )
        return {
            "completionId": completion_id,
            "noteId": note_id,
            "earnedXp": earned_xp,
            "level": level,
            "badges": badge_result,
            "unlockedGgumdori": unlocked_ggumdori,
            "completedAt": completed_at,
        }

    def _update_level_progress(self, user_id: str, earned_xp: int) -> dict[str, Any]:
        """
        입력: 사용자 ID와 획득 XP.
        출력: 갱신된 레벨 진행도.
        역할: 누적 XP 기준으로 레벨과 현재 XP를 계산한다.
        호출 예시: level = self._update_level_progress(user_id, 50)
        """
        # 변수 의미: 현재 레벨 진행도 row다.
        row = self._connection.execute(
            "SELECT current_level, total_xp FROM level_progress WHERE user_id = %s",
            (user_id,),
        ).fetchone()
        # 변수 의미: 새 누적 XP다.
        total_xp = int(row["total_xp"]) + earned_xp
        # 변수 의미: 새 레벨 값이다.
        current_level = max(1, total_xp // 100 + 1)
        # 변수 의미: 현재 레벨 안에서의 XP다.
        current_xp = total_xp % 100
        # 변수 의미: 다음 레벨 필요 XP다.
        next_level_required_xp = 100
        self._connection.execute(
            """
            UPDATE level_progress
            SET current_level = %s, current_xp = %s, total_xp = %s, next_level_required_xp = %s
            WHERE user_id = %s
            """,
            (current_level, current_xp, total_xp, next_level_required_xp, user_id),
        )
        return {
            "currentLevel": current_level,
            "currentXp": current_xp,
            "totalXp": total_xp,
            "nextLevelRequiredXp": next_level_required_xp,
            "progressPercent": min(100, round(current_xp / next_level_required_xp * 100)),
        }

    def _update_badges(self, user_id: str, category_code: str, earned_xp: int, earned_at: str) -> dict[str, Any]:
        """
        입력: 사용자 ID, 카테고리 코드, 획득 XP, 획득 시각.
        출력: 진행 중인 뱃지와 새로 획득한 뱃지 목록.
        역할: 같은 카테고리의 모든 단계 뱃지 진행도를 갱신한다.
        호출 예시: result = self._update_badges(user_id, \"nature\", 50, now_iso())
        """
        # 변수 의미: 카테고리의 뱃지 정의 목록이다.
        badge_rows = self._connection.execute(
            "SELECT * FROM badge_definitions WHERE category_code = %s ORDER BY tier",
            (category_code,),
        ).fetchall()
        # 변수 의미: 진행 상태 뱃지 목록이다.
        progress_badges: list[dict[str, Any]] = []
        # 변수 의미: 이번 처리에서 새로 획득한 뱃지 목록이다.
        earned_badges: list[dict[str, Any]] = []
        for badge_row in badge_rows:
            # 변수 의미: 기존 사용자 뱃지 row다.
            user_badge_row = self._connection.execute(
                "SELECT * FROM user_badges WHERE user_id = %s AND badge_definition_id = %s",
                (user_id, badge_row["id"]),
            ).fetchone()
            if user_badge_row is None:
                # 변수 의미: 새 사용자 뱃지 ID다.
                user_badge_id = make_id("ub")
                # 변수 의미: 기존 진행 XP가 없을 때 시작값이다.
                previous_progress_xp = 0
                # 변수 의미: 기존 획득 시각이다.
                previous_earned_at = None
                self._connection.execute(
                    """
                    INSERT INTO user_badges(id, user_id, badge_definition_id, progress_xp, earned_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (user_badge_id, user_id, badge_row["id"], 0, None),
                )
            else:
                previous_progress_xp = int(user_badge_row["progress_xp"])
                previous_earned_at = user_badge_row["earned_at"]

            # 변수 의미: 새 진행 XP다.
            progress_xp = previous_progress_xp + earned_xp
            # 변수 의미: 이번에 획득 조건을 만족했는지 여부다.
            is_earned_now = previous_earned_at is None and progress_xp >= int(badge_row["required_xp"])
            # 변수 의미: 저장할 획득 시각이다.
            new_earned_at = earned_at if is_earned_now else previous_earned_at
            self._connection.execute(
                """
                UPDATE user_badges
                SET progress_xp = %s, earned_at = %s
                WHERE user_id = %s AND badge_definition_id = %s
                """,
                (progress_xp, new_earned_at, user_id, badge_row["id"]),
            )
            # 변수 의미: 공개 API용 뱃지 상태다.
            badge_payload = {
                "id": badge_row["id"],
                "categoryCode": badge_row["category_code"],
                "name": badge_row["name"],
                "tier": badge_row["tier"],
                "requiredXp": badge_row["required_xp"],
                "progressXp": progress_xp,
                "earnedAt": new_earned_at,
                "icon": badge_row["icon"],
                "color": badge_row["color"],
            }
            progress_badges.append(badge_payload)
            if is_earned_now:
                earned_badges.append(badge_payload)
        return {"progressBadges": progress_badges, "earnedBadges": earned_badges}

    def _unlock_ggumdori(self, user_id: str, earned_badges: list[dict[str, Any]], unlocked_at: str) -> list[dict[str, Any]]:
        """
        입력: 사용자 ID, 새로 획득한 뱃지 목록, 해금 시각.
        출력: 새로 해금된 꿈돌이 목록.
        역할: 뱃지 카테고리와 단계 조건에 맞는 꿈돌이를 해금한다.
        호출 예시: unlocked = self._unlock_ggumdori(user_id, earned_badges, now_iso())
        """
        # 변수 의미: 새로 해금된 꿈돌이 목록이다.
        unlocked_variants: list[dict[str, Any]] = []
        for badge in earned_badges:
            # 변수 의미: 뱃지 조건에 맞는 꿈돌이 row다.
            variant_row = self._connection.execute(
                "SELECT * FROM ggumdori_variants WHERE theme_category = %s AND tier = %s",
                (badge["categoryCode"], badge["tier"]),
            ).fetchone()
            if variant_row is None:
                continue
            # 변수 의미: 사용자 꿈돌이 해금 ID다.
            user_ggumdori_id = make_id("ug")
            # 변수 의미: 사용자 꿈돌이 insert 실행 결과다.
            cursor = self._connection.execute(
                """
                INSERT INTO user_ggumdori(id, user_id, variant_id, unlocked_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id, variant_id) DO NOTHING
                """,
                (user_ggumdori_id, user_id, variant_row["id"], unlocked_at),
            )
            if cursor.rowcount > 0:
                self._connection.execute(
                    """
                    INSERT INTO ggumdori_selection(user_id, selected_variant_id, updated_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                      selected_variant_id = EXCLUDED.selected_variant_id,
                      updated_at = EXCLUDED.updated_at
                    """,
                    (user_id, variant_row["id"], unlocked_at),
                )
            unlocked_variants.append(dict(variant_row))
        return unlocked_variants

    def list_badges(self, user_id: str) -> list[dict[str, Any]]:
        """
        입력: 사용자 ID.
        출력: 전체 뱃지 정의와 사용자 진행 상태 목록.
        역할: 뱃지 화면을 실제 DB 상태로 렌더링할 수 있게 한다.
        호출 예시: badges = repository.list_badges(\"demo-user\")
        """
        with self._lock:
            # 변수 의미: 뱃지 정의와 사용자 상태 조인 row 목록이다.
            rows = self._connection.execute(
                """
                SELECT bd.id, bd.category_code, bd.name, bd.tier, bd.required_xp, bd.icon, bd.color,
                       COALESCE(ub.progress_xp, 0) AS progress_xp, ub.earned_at
                FROM badge_definitions bd
                LEFT JOIN user_badges ub ON ub.badge_definition_id = bd.id AND ub.user_id = %s
                ORDER BY bd.sort_order
                """,
                (user_id,),
            ).fetchall()
            return [
                {
                    "id": row["id"],
                    "categoryCode": row["category_code"],
                    "name": row["name"],
                    "tier": row["tier"],
                    "requiredXp": row["required_xp"],
                    "progressXp": row["progress_xp"],
                    "earnedAt": row["earned_at"],
                    "earned": row["earned_at"] is not None,
                    "icon": row["icon"],
                    "color": row["color"],
                }
                for row in rows
            ]

    def list_notes(self, user_id: str) -> list[dict[str, Any]]:
        """
        입력: 사용자 ID.
        출력: 모험가의 수첩 기록 목록.
        역할: 완료 퀘스트 기반 탐험 노트 화면 데이터를 제공한다.
        호출 예시: notes = repository.list_notes(\"demo-user\")
        """
        with self._lock:
            # 변수 의미: 사용자 수첩 기록 row 목록이다.
            rows = self._connection.execute(
                """
                SELECT id, reusable_quest_id, quest_completion_id, place_name, summary,
                       badges_json, distance_km, share_image_url, created_at
                FROM adventure_notes
                WHERE user_id = %s
                ORDER BY created_at DESC
                """,
                (user_id,),
            ).fetchall()
            return [
                {
                    "id": row["id"],
                    "reusableQuestId": row["reusable_quest_id"],
                    "questCompletionId": row["quest_completion_id"],
                    "placeName": row["place_name"],
                    "summary": row["summary"],
                    "badges": row["badges_json"],
                    "distanceKm": row["distance_km"],
                    "shareImageUrl": row["share_image_url"],
                    "createdAt": row["created_at"],
                }
                for row in rows
            ]

    def list_ggumdori(self, user_id: str) -> dict[str, Any]:
        """
        입력: 사용자 ID.
        출력: 꿈돌이 도감 전체와 사용자 해금 상태.
        역할: 뱃지 단계 기반 꿈돌이 해금 상태를 제공한다.
        호출 예시: ggumdori = repository.list_ggumdori(\"demo-user\")
        """
        with self._lock:
            # 변수 의미: 선택된 꿈돌이 row다.
            selected_row = self._connection.execute(
                "SELECT selected_variant_id FROM ggumdori_selection WHERE user_id = %s",
                (user_id,),
            ).fetchone()
            # 변수 의미: 전체 꿈돌이 변형과 사용자 해금 상태 row 목록이다.
            rows = self._connection.execute(
                """
                SELECT gv.*, ug.unlocked_at
                FROM ggumdori_variants gv
                LEFT JOIN user_ggumdori ug ON ug.variant_id = gv.id AND ug.user_id = %s
                ORDER BY gv.sort_order
                """,
                (user_id,),
            ).fetchall()
            return {
                "selectedVariantId": selected_row["selected_variant_id"] if selected_row else None,
                "variants": [
                    {
                        "id": row["id"],
                        "name": row["name"],
                        "themeCategory": row["theme_category"],
                        "tier": row["tier"],
                        "unlockCondition": row["unlock_condition"],
                        "imageRef": row["image_ref"],
                        "description": row["description"],
                        "rarity": row["rarity"],
                        "unlocked": row["unlocked_at"] is not None,
                        "unlockedAt": row["unlocked_at"],
                    }
                    for row in rows
                ],
            }

    def get_recommendation_profile(self, user_id: str) -> dict[str, Any]:
        """
        입력: 사용자 ID.
        출력: 추천 점수 계산에 사용할 완료 이력과 뱃지 진행도.
        역할: 거리와 선호도 외에 완료 카테고리, 미획득 뱃지, 다음 단계 보상을 반영한다.
        호출 예시: profile = repository.get_recommendation_profile(\"demo-user\")
        """
        with self._lock:
            # 변수 의미: 완료한 퀘스트의 카테고리별 횟수 row 목록이다.
            completion_rows = self._connection.execute(
                """
                SELECT rq.category_code, COUNT(*) AS completion_count
                FROM quest_completions qc
                JOIN reusable_quests rq ON rq.id = qc.reusable_quest_id
                WHERE qc.user_id = %s
                GROUP BY rq.category_code
                """,
                (user_id,),
            ).fetchall()
            # 변수 의미: 카테고리별 완료 횟수다.
            completion_counts = {row["category_code"]: int(row["completion_count"]) for row in completion_rows}

            # 변수 의미: 뱃지 진행 row 목록이다.
            badge_rows = self._connection.execute(
                """
                SELECT bd.category_code, bd.tier, bd.required_xp,
                       COALESCE(ub.progress_xp, 0) AS progress_xp, ub.earned_at
                FROM badge_definitions bd
                LEFT JOIN user_badges ub ON ub.badge_definition_id = bd.id AND ub.user_id = %s
                ORDER BY bd.category_code, bd.tier
                """,
                (user_id,),
            ).fetchall()
            # 변수 의미: 카테고리별 다음 미획득 뱃지까지 남은 XP다.
            next_badge_remaining_xp: dict[str, int] = {}
            # 변수 의미: 이미 획득한 카테고리 코드 집합이다.
            earned_categories: set[str] = set()
            for row in badge_rows:
                if row["earned_at"] is not None:
                    earned_categories.add(row["category_code"])
                    continue
                next_badge_remaining_xp.setdefault(
                    row["category_code"],
                    max(0, int(row["required_xp"]) - int(row["progress_xp"])),
                )
            return {
                "completionCounts": completion_counts,
                "earnedCategories": sorted(earned_categories),
                "nextBadgeRemainingXp": next_badge_remaining_xp,
            }
