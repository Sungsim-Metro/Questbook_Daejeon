# 관광지 대표 사진의 배치 보충과 요청 시점 결합을 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
import unittest


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.catalog_sync import sync_place_images  # noqa: E402
from questbook_api.domain.models import TourPlaceCandidate  # noqa: E402
from questbook_api.server import attach_place_images  # noqa: E402


def make_place(content_id: str, image_url: str = "") -> TourPlaceCandidate:
    """
    입력: 장소 식별자와 대표 사진 URL.
    출력: 테스트용 라이브 장소 후보.
    역할: 사진 유무만 다른 장소를 간단히 만든다.
    호출 예시: place = make_place("1", "https://x/1.jpg")
    """
    return TourPlaceCandidate(
        content_id, f"장소 {content_id}", 36.35, 127.38, "nature", "자연 관찰", "", None, "tourapi", "12", image_url,
    )


class FakeImageRepository:
    """
    입력: 미리 채워 둘 place_images 캐시.
    출력: get/upsert만 흉내 내는 가짜 저장소.
    역할: DB 없이 캐시 조회·저장 흐름을 검증한다.
    호출 예시: repository = FakeImageRepository({"1": ""})
    """

    def __init__(self, cached: dict[str, str] | None = None) -> None:
        self.cached = dict(cached or {})
        self.requested_ids: list[list[str]] = []

    def get_place_images(self, content_ids: list[str]) -> dict[str, str]:
        self.requested_ids.append(list(content_ids))
        return {content_id: self.cached[content_id] for content_id in content_ids if content_id in self.cached}

    def upsert_place_images(self, rows: list[tuple[str, str]]) -> None:
        self.cached.update(dict(rows))


class FakeGalleryClient:
    """
    입력: 장소명별 관광사진 검색 결과(None이면 호출 실패).
    출력: find_gallery_image만 흉내 내는 가짜 클라이언트.
    역할: 외부 호출 없이 배치 보충 규칙을 검증한다.
    호출 예시: client = FakeGalleryClient({"장소 1": "https://x/1.jpg"})
    """

    def __init__(self, results: dict[str, str | None]) -> None:
        self.results = results
        self.looked_up: list[str] = []

    def find_gallery_image(self, place_title: str) -> str | None:
        self.looked_up.append(place_title)
        return self.results.get(place_title, "")


class SyncPlaceImagesTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 일일 배치의 관광사진 보충 검증 결과.
    역할: 필요한 장소만, 한 번만, 한도 안에서 조회하는지 확인한다.
    호출 예시: uv run --project services/app-api pytest services/app-api/tests/test_place_images.py
    """

    def test_only_looks_up_places_without_firstimage_or_cache(self) -> None:
        """
        입력: 대표 사진 있는 장소, 이미 찾아본 장소, 새 장소.
        출력: 없음.
        역할: 대표 사진이 있거나 이미 찾아본 장소는 다시 호출하지 않는지 확인한다.
        호출 예시: self.test_only_looks_up_places_without_firstimage_or_cache()
        """
        repository = FakeImageRepository({"2": ""})
        client = FakeGalleryClient({"장소 3": "https://x/3.jpg"})
        places = [make_place("1", "https://x/1.jpg"), make_place("2"), make_place("3")]
        sync_place_images(repository, client, places)
        self.assertEqual(client.looked_up, ["장소 3"])
        self.assertEqual(repository.cached, {"2": "", "3": "https://x/3.jpg"})

    def test_caches_no_match_but_retries_after_failure(self) -> None:
        """
        입력: 맞는 사진이 없는 장소와 호출이 실패한 장소.
        출력: 없음.
        역할: 없음("")은 캐싱해 재조회를 막고, 실패(None)는 캐싱하지 않아 다음 날 재시도하는지 확인한다.
        호출 예시: self.test_caches_no_match_but_retries_after_failure()
        """
        repository = FakeImageRepository()
        client = FakeGalleryClient({"장소 1": "", "장소 2": None})
        sync_place_images(repository, client, [make_place("1"), make_place("2")])
        self.assertEqual(repository.cached, {"1": ""})

    def test_respects_per_run_lookup_limit(self) -> None:
        """
        입력: 한도보다 많은 사진 없는 장소.
        출력: 없음.
        역할: 개발계정 일일 한도를 넘지 않도록 실행당 조회 수를 제한하는지 확인한다.
        호출 예시: self.test_respects_per_run_lookup_limit()
        """
        repository = FakeImageRepository()
        client = FakeGalleryClient({})
        sync_place_images(repository, client, [make_place(str(index)) for index in range(5)], max_lookups=2)
        self.assertEqual(len(client.looked_up), 2)

    def test_skips_database_when_every_place_has_firstimage(self) -> None:
        """
        입력: 전부 대표 사진이 있는 장소.
        출력: 없음.
        역할: 보충할 장소가 없으면 캐시 조회조차 하지 않는지 확인한다.
        호출 예시: self.test_skips_database_when_every_place_has_firstimage()
        """
        repository = FakeImageRepository()
        sync_place_images(repository, FakeGalleryClient({}), [make_place("1", "https://x/1.jpg")])
        self.assertEqual(repository.requested_ids, [])


class AttachPlaceImagesTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 요청 시점 사진 결합 검증 결과.
    역할: 대표 사진은 그대로 두고 빈 장소만 캐시로 채우는지 확인한다.
    호출 예시: uv run --project services/app-api pytest services/app-api/tests/test_place_images.py
    """

    def test_fills_only_missing_images_from_cache(self) -> None:
        """
        입력: 대표 사진 있는 장소, 캐시에 사진 있는 장소, 캐시에도 없는 장소.
        출력: 없음.
        역할: 이미 있는 사진은 덮지 않고, 빈 장소만 한 번의 조회로 채우는지 확인한다.
        호출 예시: self.test_fills_only_missing_images_from_cache()
        """
        repository = FakeImageRepository({"2": "https://gallery/2.jpg", "3": ""})
        payload = {"recommendations": [
            {"place": {"contentId": "1", "imageUrl": "https://tour/1.jpg"}},
            {"place": {"contentId": "2", "imageUrl": ""}},
            {"place": {"contentId": "3", "imageUrl": ""}},
        ]}
        attach_place_images(payload, repository)
        self.assertEqual(
            [item["place"]["imageUrl"] for item in payload["recommendations"]],
            ["https://tour/1.jpg", "https://gallery/2.jpg", ""],
        )
        self.assertEqual(repository.requested_ids, [["2", "3"]])


if __name__ == "__main__":
    unittest.main()
