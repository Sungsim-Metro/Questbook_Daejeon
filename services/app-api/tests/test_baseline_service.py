# Questbook baseline 앱 서비스 유스케이스를 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
from threading import Barrier, Thread
from typing import Any
import unittest


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))
# 변수 의미: 테스트 헬퍼 모듈이 있는 디렉토리 경로다.
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))

import data_services

from questbook_api.application.baseline_service import BaselineQuestbookService
from questbook_api.infrastructure.cache import TourPlaceRedisCache
from questbook_api.infrastructure.repository import QuestbookRepository
from questbook_api.integrations.tourapi.client import TourApiClient


@unittest.skipUnless(data_services.SERVICES_AVAILABLE, "local PostgreSQL/Redis not available")
class BaselineQuestbookServiceTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: baseline 유스케이스 검증 결과.
    역할: 추천 캐시, 퀘스트 생성, 완료 트랜잭션을 확인한다.
    호출 예시: python -m unittest services.app-api.tests.test_baseline_service
    """

    def setUp(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트용 PostgreSQL 스키마와 Redis 캐시를 초기화한다.
        호출 예시: self.setUp()
        """
        # 변수 의미: 테스트 DB 접속 URL이다.
        self.database_url = data_services.ensure_test_database()
        data_services.reset_database(self.database_url)
        data_services.reset_redis(data_services.TEST_REDIS_URL)
        # 변수 의미: 테스트용 저장소다.
        self.repository = QuestbookRepository(self.database_url)
        self.repository.initialize()
        self.repository.ensure_user("demo-user")
        # 변수 의미: 테스트용 Redis 캐시다.
        self.cache = TourPlaceRedisCache(data_services.TEST_REDIS_URL, default_ttl_seconds=1800)
        # 변수 의미: API 키 없는 fallback TourAPI 클라이언트다.
        self.tour_client = TourApiClient("")
        # 변수 의미: 테스트 대상 baseline 서비스다.
        self.service = BaselineQuestbookService(self.repository, self.cache, self.tour_client)

    def tearDown(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 저장소 연결을 닫는다.
        호출 예시: self.tearDown()
        """
        self.repository.close()

    def _prepare_accepted_recommendation(self, category_key: str) -> tuple[str, dict[str, Any], dict[str, Any]]:
        """
        입력: 추천받을 카테고리 키.
        출력: 수락된 인스턴스 ID, 추천 장소, 추천 항목.
        역할: 완료 테스트에서 같은 추천·수락 준비 절차를 재사용한다.
        호출 예시: instance_id, place, recommendation = self._prepare_accepted_recommendation("market")
        """
        # 변수 의미: 지정 카테고리의 추천 응답이다.
        recommendations = self.service.get_recommendations("demo-user", 36.327, 127.427, category_key, 5000)
        # 변수 의미: 완료 테스트에 사용할 첫 번째 추천 항목이다.
        recommendation = recommendations["recommendations"][0]
        # 변수 의미: 추천된 퀘스트 인스턴스 ID다.
        instance_id = recommendation["quest"]["instanceId"]
        # 변수 의미: 추천 장소 좌표와 표시 정보다.
        place = recommendation["place"]
        self.service.accept_quest("demo-user", instance_id)
        return instance_id, place, recommendation

    def test_recommendations_use_user_scoped_cache(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 첫 추천은 캐시 miss, 같은 조건의 두 번째 추천은 캐시 hit인지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_recommendations_use_user_scoped_cache
        """
        # 변수 의미: 첫 번째 추천 응답이다.
        first_response = self.service.get_recommendations("demo-user", 36.327, 127.427, "market", 5000)
        # 변수 의미: 두 번째 추천 응답이다.
        second_response = self.service.get_recommendations("demo-user", 36.327, 127.427, "market", 5000)
        self.assertFalse(first_response["cache"]["hit"])
        self.assertTrue(second_response["cache"]["hit"])
        self.assertEqual(first_response["cache"]["ttlSeconds"], 1800)
        self.assertIn("관광정보 제공", first_response["attribution"])

    def test_category_change_invalidates_previous_user_cache(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 카테고리 변경 시 사용자의 기존 TourAPI 임시 캐시가 폐기되는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_category_change_invalidates_previous_user_cache
        """
        # 변수 의미: 자연 카테고리 첫 추천 응답이다.
        nature_first = self.service.get_recommendations("demo-user", 36.327, 127.427, "nature", 5000)
        # 변수 의미: 자연 카테고리 두 번째 추천 응답이다.
        nature_second = self.service.get_recommendations("demo-user", 36.327, 127.427, "nature", 5000)
        # 변수 의미: 시장 카테고리 변경 추천 응답이다.
        market_after_change = self.service.get_recommendations("demo-user", 36.327, 127.427, "market", 5000)
        self.assertFalse(nature_first["cache"]["hit"])
        self.assertTrue(nature_second["cache"]["hit"])
        self.assertFalse(market_after_change["cache"]["hit"])

    def test_force_refresh_bypasses_existing_cache(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 명시적 새로고침 요청이 같은 조건의 기존 캐시를 사용하지 않는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_force_refresh_bypasses_existing_cache
        """
        # 변수 의미: 첫 번째 추천 응답이다.
        first_response = self.service.get_recommendations("demo-user", 36.327, 127.427, "science", 5000)
        # 변수 의미: 같은 조건에서 캐시를 기대하는 응답이다.
        cached_response = self.service.get_recommendations("demo-user", 36.327, 127.427, "science", 5000)
        # 변수 의미: 강제 새로고침 응답이다.
        refreshed_response = self.service.get_recommendations("demo-user", 36.327, 127.427, "science", 5000, True)
        self.assertFalse(first_response["cache"]["hit"])
        self.assertTrue(cached_response["cache"]["hit"])
        self.assertFalse(refreshed_response["cache"]["hit"])

    def test_complete_quest_updates_progress_badges_and_notes(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 퀘스트 완료가 XP, 뱃지, 수첩 기록을 함께 갱신하는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_complete_quest_updates_progress_badges_and_notes
        """
        # 변수 의미: 시장 카테고리 추천 응답이다.
        recommendations = self.service.get_recommendations("demo-user", 36.327, 127.427, "market", 5000)
        # 변수 의미: 첫 번째 추천 항목이다.
        recommendation = recommendations["recommendations"][0]
        # 변수 의미: 추천된 퀘스트 인스턴스 ID다.
        instance_id = recommendation["quest"]["instanceId"]
        # 변수 의미: 추천 장소 좌표다.
        place = recommendation["place"]
        self.service.accept_quest("demo-user", instance_id)

        # 변수 의미: 퀘스트 완료 요청 결과다.
        completion = self.service.complete_quest(
            "demo-user",
            instance_id,
            {
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "accuracyMeters": 10,
                "photoAttached": True,
                "ocrText": place["title"],
                "checklistComplete": True,
            },
        )

        self.assertTrue(completion["ok"])
        self.assertEqual(completion["completion"]["earnedXp"], 60)
        self.assertGreaterEqual(self.repository.get_user("demo-user")["level"]["totalXp"], 60)
        self.assertTrue(any(badge["categoryCode"] == "market" and badge["earned"] for badge in self.repository.list_badges("demo-user")))
        self.assertEqual(len(self.repository.list_notes("demo-user")), 1)

    def test_market_completion_uses_gps_when_photo_is_missing(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 소비형 퀘스트에서 사진이 없어도 GPS 반경 안이면 임시 완료되는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_market_completion_uses_gps_when_photo_is_missing
        """
        # 변수 의미: 수락된 시장 퀘스트와 추천 장소다.
        instance_id, place, _recommendation = self._prepare_accepted_recommendation("market")

        # 변수 의미: 사진 없이 요청한 GPS-only 완료 결과다.
        completion = self.service.complete_quest(
            "demo-user",
            instance_id,
            {
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "accuracyMeters": 10,
                "photoAttached": False,
                "storeName": "",
            },
        )

        self.assertTrue(completion["ok"])
        self.assertEqual(completion["verification"]["decision"], "approved")
        self.assertEqual(completion["verification"]["decisionBasis"], "gps_only_temporary")
        # 변수 의미: 보조 검증 결과를 이름으로 조회하기 위한 맵이다.
        optional_checks = {check["name"]: check for check in completion["verification"]["optionalChecks"]}
        self.assertFalse(optional_checks["photo_attached"]["passed"])
        self.assertTrue(optional_checks["photo_attached"]["ignoredForDecision"])

    def test_market_completion_records_ignored_ocr_mismatch(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: OCR 상호명이 틀려도 GPS 반경 안이면 성공하고 보조 검증 실패를 기록하는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_market_completion_records_ignored_ocr_mismatch
        """
        # 변수 의미: 수락된 시장 퀘스트와 추천 장소다.
        instance_id, place, _recommendation = self._prepare_accepted_recommendation("market")

        # 변수 의미: 잘못된 OCR 텍스트를 포함한 완료 결과다.
        completion = self.service.complete_quest(
            "demo-user",
            instance_id,
            {
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "accuracyMeters": 10,
                "photoAttached": True,
                "ocrText": "다른 상점",
            },
        )

        self.assertTrue(completion["ok"])
        # 변수 의미: 보조 검증 결과를 이름으로 조회하기 위한 맵이다.
        optional_checks = {check["name"]: check for check in completion["verification"]["optionalChecks"]}
        self.assertFalse(optional_checks["store_name_match"]["passed"])
        self.assertEqual(optional_checks["store_name_match"]["reason"], "store_name_not_matched")
        self.assertTrue(optional_checks["store_name_match"]["ignoredForDecision"])

    def test_checklist_completion_uses_gps_when_checklist_is_incomplete(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 체크리스트 퀘스트에서 체크리스트가 미완료여도 GPS 반경 안이면 임시 완료되는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_checklist_completion_uses_gps_when_checklist_is_incomplete
        """
        # 변수 의미: 수락된 과학 퀘스트와 추천 장소다.
        instance_id, place, _recommendation = self._prepare_accepted_recommendation("science")

        # 변수 의미: 체크리스트 미완료 상태의 완료 결과다.
        completion = self.service.complete_quest(
            "demo-user",
            instance_id,
            {
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "accuracyMeters": 10,
                "checklistComplete": False,
            },
        )

        self.assertTrue(completion["ok"])
        # 변수 의미: 보조 검증 결과를 이름으로 조회하기 위한 맵이다.
        optional_checks = {check["name"]: check for check in completion["verification"]["optionalChecks"]}
        self.assertFalse(optional_checks["checklist_complete"]["passed"])
        self.assertEqual(optional_checks["checklist_complete"]["reason"], "checklist_incomplete")
        self.assertTrue(optional_checks["checklist_complete"]["ignoredForDecision"])

    def test_time_window_completion_uses_gps_when_photo_is_missing(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 시간대 사진 퀘스트에서 사진이 없어도 GPS 반경 안이면 임시 완료되는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_time_window_completion_uses_gps_when_photo_is_missing
        """
        # 변수 의미: 수락된 야경 퀘스트와 추천 장소다.
        instance_id, place, _recommendation = self._prepare_accepted_recommendation("nightview")

        # 변수 의미: 사진 없이 요청한 시간대 퀘스트 완료 결과다.
        completion = self.service.complete_quest(
            "demo-user",
            instance_id,
            {
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "accuracyMeters": 10,
                "photoAttached": False,
            },
        )

        self.assertTrue(completion["ok"])
        # 변수 의미: 보조 검증 결과를 이름으로 조회하기 위한 맵이다.
        optional_checks = {check["name"]: check for check in completion["verification"]["optionalChecks"]}
        self.assertFalse(optional_checks["photo_attached"]["passed"])
        self.assertEqual(optional_checks["photo_attached"]["reason"], "photo_required")
        self.assertTrue(optional_checks["photo_attached"]["ignoredForDecision"])

    def test_gps_failure_conditions_still_block_completion(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: GPS 정확도와 반경 실패가 여전히 완료를 막는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_gps_failure_conditions_still_block_completion
        """
        # 변수 의미: 수락된 자연 퀘스트와 추천 장소다.
        instance_id, place, _recommendation = self._prepare_accepted_recommendation("nature")

        # 변수 의미: 정확도가 낮은 GPS 완료 요청 결과다.
        low_accuracy_result = self.service.complete_quest(
            "demo-user",
            instance_id,
            {"latitude": place["latitude"], "longitude": place["longitude"], "accuracyMeters": 120},
        )
        self.assertFalse(low_accuracy_result["ok"])
        self.assertEqual(low_accuracy_result["verification"]["reason"], "low_gps_accuracy")

        # 변수 의미: 반경 밖 좌표로 요청한 완료 결과다.
        outside_radius_result = self.service.complete_quest(
            "demo-user",
            instance_id,
            {"latitude": 0, "longitude": 0, "accuracyMeters": 10},
        )
        self.assertFalse(outside_radius_result["ok"])
        self.assertEqual(outside_radius_result["verification"]["reason"], "outside_radius")

    def test_concurrent_completion_grants_xp_only_once(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 같은 인스턴스에 대한 동시 완료 요청 중 정확히 하나만 성공하고 XP가 중복 지급되지 않는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_concurrent_completion_grants_xp_only_once
        """
        # 변수 의미: 자연 카테고리 추천 응답이다.
        recommendations = self.service.get_recommendations("demo-user", 36.327, 127.427, "nature", 5000)
        # 변수 의미: 첫 번째 추천 항목이다.
        recommendation = recommendations["recommendations"][0]
        # 변수 의미: 추천된 퀘스트 인스턴스 ID다.
        instance_id = recommendation["quest"]["instanceId"]
        # 변수 의미: 추천 장소 좌표다.
        place = recommendation["place"]
        self.service.accept_quest("demo-user", instance_id)

        # 변수 의미: 동시 완료 요청 수다.
        request_count = 8
        # 변수 의미: 모든 스레드가 동시에 출발하게 하는 장벽이다.
        start_barrier = Barrier(request_count)
        # 변수 의미: 스레드별 완료 요청 결과 목록이다.
        results: list[dict] = [{} for _ in range(request_count)]

        def complete_from_thread(thread_index: int) -> None:
            """
            입력: 결과를 기록할 스레드 인덱스.
            출력: 없음.
            역할: 장벽에서 대기했다가 동시에 완료 요청을 보낸다.
            호출 예시: Thread(target=complete_from_thread, args=(0,))
            """
            start_barrier.wait()
            results[thread_index] = self.service.complete_quest(
                "demo-user",
                instance_id,
                {"latitude": place["latitude"], "longitude": place["longitude"], "accuracyMeters": 10},
            )

        # 변수 의미: 동시 완료 요청 스레드 목록이다.
        threads = [Thread(target=complete_from_thread, args=(index,)) for index in range(request_count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        # 변수 의미: 성공한 완료 응답 수다.
        success_count = sum(1 for result in results if result.get("ok"))
        self.assertEqual(success_count, 1)
        self.assertTrue(all(result.get("reason") == "already_completed" for result in results if not result.get("ok")))
        self.assertEqual(self.repository.get_user("demo-user")["level"]["totalXp"], recommendation["quest"]["rewardXp"])
        self.assertEqual(len(self.repository.list_notes("demo-user")), 1)

    def test_completion_after_cache_expiry_refetches_place(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 30분 캐시가 사라진 뒤에도 라이브 재조회로 반경 안 완료 인증이 성공하는지 확인한다.
        호출 예시: python -m unittest ...BaselineQuestbookServiceTest.test_completion_after_cache_expiry_refetches_place
        """
        # 변수 의미: 자연 카테고리 추천 응답이다.
        recommendations = self.service.get_recommendations("demo-user", 36.327, 127.427, "nature", 5000)
        # 변수 의미: 첫 번째 추천 항목이다.
        recommendation = recommendations["recommendations"][0]
        # 변수 의미: 추천된 퀘스트 인스턴스 ID다.
        instance_id = recommendation["quest"]["instanceId"]
        # 변수 의미: 추천 장소 좌표다.
        place = recommendation["place"]
        self.service.accept_quest("demo-user", instance_id)
        # 캐시 TTL 만료 또는 앱 서버 재시작과 같은 상황을 재현한다.
        self.cache.invalidate_for_user("demo-user")

        # 변수 의미: 캐시 소멸 후 반경 안 완료 요청 결과다.
        completion = self.service.complete_quest(
            "demo-user",
            instance_id,
            {"latitude": place["latitude"], "longitude": place["longitude"], "accuracyMeters": 10},
        )

        self.assertTrue(completion["ok"])
        self.assertEqual(completion["verification"]["decision"], "approved")


if __name__ == "__main__":
    unittest.main()
