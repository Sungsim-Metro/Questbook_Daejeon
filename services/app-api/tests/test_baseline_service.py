# Questbook baseline 앱 서비스 유스케이스를 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import Barrier, Thread
import unittest


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.application.baseline_service import BaselineQuestbookService
from questbook_api.infrastructure.cache import TourPlaceMemoryCache
from questbook_api.infrastructure.repository import QuestbookRepository
from questbook_api.integrations.tourapi.client import TourApiClient


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
        역할: 테스트용 임시 DB와 서비스를 준비한다.
        호출 예시: self.setUp()
        """
        # 변수 의미: 테스트 임시 디렉토리 컨텍스트다.
        self.temp_dir = TemporaryDirectory()
        # 변수 의미: 테스트용 SQLite DB 경로다.
        database_path = Path(self.temp_dir.name) / "test.sqlite3"
        # 변수 의미: 테스트용 저장소다.
        self.repository = QuestbookRepository(database_path)
        self.repository.initialize()
        self.repository.ensure_user("demo-user")
        # 변수 의미: 테스트용 인메모리 캐시다.
        self.cache = TourPlaceMemoryCache(default_ttl_seconds=1800)
        # 변수 의미: API 키 없는 fallback TourAPI 클라이언트다.
        self.tour_client = TourApiClient("")
        # 변수 의미: 테스트 대상 baseline 서비스다.
        self.service = BaselineQuestbookService(self.repository, self.cache, self.tour_client)

    def tearDown(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트 임시 디렉토리를 정리한다.
        호출 예시: self.tearDown()
        """
        self.temp_dir.cleanup()

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
