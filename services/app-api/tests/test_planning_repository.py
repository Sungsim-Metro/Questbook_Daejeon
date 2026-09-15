# 기존 계정의 관심사를 보존하는 계획 모드 저장소 마이그레이션을 검증한다.
from __future__ import annotations

from pathlib import Path
import unittest

import data_services

from questbook_api.infrastructure.repository import QuestbookRepository


@unittest.skipUnless(data_services.SERVICES_AVAILABLE, "local PostgreSQL/Redis not available")
class PlanningRepositoryTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 기존 스키마 및 재시작 후 관심사 유지 검증 결과.
    역할: 자동 호환 스키마와 명시적 SQL 마이그레이션의 데이터 보존을 확인한다.
    호출 예시: pytest services/app-api/tests/test_planning_repository.py
    """

    def test_migration_preserves_existing_preferences_and_saved_configuration(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 기존 관심사 행이 자동/명시적 마이그레이션과 재연결 뒤에도 유지되는지 검사한다.
        호출 예시: self.test_migration_preserves_existing_preferences_and_saved_configuration()
        """
        # 변수 의미: 운영 DB를 허용하지 않는 테스트 전용 접속 URL이다.
        database_url = data_services.ensure_test_database()
        data_services.reset_database(database_url)
        # 변수 의미: 기존 컬럼 추가 이전 상태를 구성할 저장소다.
        repository = QuestbookRepository(database_url)
        try:
            repository.initialize()
            repository.ensure_user("existing-planning-user")
            with repository._connection.transaction():
                repository._connection.execute(
                    "UPDATE preferences SET categories_json = '[\"nature\", \"market\"]'::jsonb "
                    "WHERE user_id = %s", ("existing-planning-user",),
                )
                # 테스트 DB에서만 이전 버전의 컬럼 구성을 재현한다.
                repository._connection.execute("ALTER TABLE preferences DROP COLUMN IF EXISTS categories_set_at")
            repository.initialize()
            # 변수 의미: 자동 호환 마이그레이션 직후의 기존 관심사다.
            previous = repository.get_user("existing-planning-user")["preference"]
            self.assertEqual(previous["categories"], ["nature", "market"])
            self.assertFalse(previous["isConfigured"])
            # 변수 의미: 실제 배포에서 적용하는 데이터 보존형 SQL 파일이다.
            migration = Path(__file__).resolve().parents[3] / "database/migrations/003_user_preferences.sql"
            with repository._connection.transaction():
                repository._connection.execute(migration.read_text(encoding="utf-8"))
                repository._connection.execute(migration.read_text(encoding="utf-8"))
                repository._connection.execute(
                    "UPDATE preferences SET categories_json = '[]'::jsonb, categories_set_at = NOW() "
                    "WHERE user_id = %s", ("existing-planning-user",),
                )
        finally:
            repository.close()
        # 변수 의미: 프로세스 재기동과 같은 새 연결의 저장소다.
        reopened = QuestbookRepository(database_url)
        try:
            reopened.initialize()
            # 변수 의미: 재연결 후 명시적 관심사 해제 상태다.
            saved = reopened.ensure_user("existing-planning-user")["preference"]
            self.assertEqual(saved["categories"], [])
            self.assertTrue(saved["isConfigured"])
        finally:
            reopened.close()
