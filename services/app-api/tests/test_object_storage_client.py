# NCP Object Storage 클라이언트의 presigned URL 정책을 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.integrations.object_storage.client import ObjectStorageClient
from questbook_api.settings import AppSettings


class FakeUuid:
    """
    입력: 없음.
    출력: uuid4() 대체 객체.
    역할: 테스트에서 예측 가능한 Object Storage 객체 키를 만들게 한다.
    호출 예시: with patch("...uuid4", return_value=FakeUuid())
    """

    # 변수 의미: 테스트용 고정 UUID hex 값이다.
    hex = "a" * 32


def build_storage_settings() -> AppSettings:
    """
    입력: 없음.
    출력: Object Storage 테스트용 AppSettings.
    역할: 실제 비밀 값 없이 boto3 presigned URL 생성을 검증할 설정을 만든다.
    호출 예시: settings = build_storage_settings()
    """
    return AppSettings(
        host="127.0.0.1",
        port=0,
        database_url="postgresql://unused",
        redis_url="redis://unused",
        cache_ttl_seconds=1800,
        tourapi_service_key="",
        naver_maps_key_id="",
        naver_maps_key="",
        gemini_api_key="",
        jwt_secret="test-secret",
        public_base_url="http://localhost:8000",
        naver_oauth_client_id="",
        naver_oauth_client_secret="",
        google_oauth_client_id="",
        google_oauth_client_secret="",
        object_storage_bucket_name="qbook-evidence-test",
        object_storage_access_key="test-access-key",
        object_storage_secret_key="test-secret-key",
    )


class ObjectStorageClientTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: Object Storage 클라이언트 검증 결과.
    역할: 실제 NCP 호출 없이 객체 키와 presigned URL 발급 정책을 확인한다.
    호출 예시: uv run pytest tests/test_object_storage_client.py
    """

    def test_builds_user_scoped_quest_evidence_key(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 퀘스트 증빙 객체 키가 사용자와 퀘스트 prefix 아래에 생성되는지 확인한다.
        호출 예시: self.test_builds_user_scoped_quest_evidence_key()
        """
        # 변수 의미: Object Storage 테스트 클라이언트다.
        client = ObjectStorageClient(build_storage_settings())

        with patch("questbook_api.integrations.object_storage.client.uuid4", return_value=FakeUuid()):
            # 변수 의미: 테스트에서 생성한 영수증 사진 객체 키다.
            object_key = client.build_evidence_object_key(
                "usr_test",
                "quest_receipt",
                "image/jpeg",
                "uqi_test",
            )

        self.assertEqual(
            object_key,
            "users/usr_test/quests/uqi_test/evidence/quest_receipt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
        )

    def test_requires_quest_instance_for_quest_evidence(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 퀘스트 사진과 영수증 업로드에 questInstanceId가 필요한지 확인한다.
        호출 예시: self.test_requires_quest_instance_for_quest_evidence()
        """
        # 변수 의미: Object Storage 테스트 클라이언트다.
        client = ObjectStorageClient(build_storage_settings())

        with self.assertRaises(ValueError):
            client.build_evidence_object_key("usr_test", "quest_photo", "image/png")

    def test_rejects_non_image_upload_content_type(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 이미지가 아닌 파일 업로드 presign 요청을 거부하는지 확인한다.
        호출 예시: self.test_rejects_non_image_upload_content_type()
        """
        # 변수 의미: Object Storage 테스트 클라이언트다.
        client = ObjectStorageClient(build_storage_settings())

        with self.assertRaises(ValueError):
            client.create_presigned_upload("usr_test", "quest_photo", "application/pdf", "uqi_test")

    def test_creates_presigned_put_without_network_call(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: boto3 presigned PUT 생성이 네트워크 호출 없이 필요한 필드를 반환하는지 확인한다.
        호출 예시: self.test_creates_presigned_put_without_network_call()
        """
        # 변수 의미: Object Storage 테스트 클라이언트다.
        client = ObjectStorageClient(build_storage_settings())

        with patch("questbook_api.integrations.object_storage.client.uuid4", return_value=FakeUuid()):
            # 변수 의미: 브라우저 직접 업로드에 사용할 presigned PUT 응답이다.
            upload = client.create_presigned_upload("usr_test", "quest_photo", "image/webp", "uqi_test")

        self.assertEqual(upload["method"], "PUT")
        self.assertEqual(upload["contentType"], "image/webp")
        self.assertEqual(upload["headers"]["Content-Type"], "image/webp")
        self.assertEqual(
            upload["objectKey"],
            "users/usr_test/quests/uqi_test/evidence/quest_photo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
        )
        self.assertIn("X-Amz-Signature", upload["url"])

    def test_download_url_rejects_other_user_prefix(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 현재 사용자 prefix 밖의 객체 키 다운로드 URL 발급을 차단하는지 확인한다.
        호출 예시: self.test_download_url_rejects_other_user_prefix()
        """
        # 변수 의미: Object Storage 테스트 클라이언트다.
        client = ObjectStorageClient(build_storage_settings())

        with self.assertRaises(PermissionError):
            client.create_presigned_download("usr_test", "users/usr_other/quests/uqi/evidence/quest_photo/a.jpg")


if __name__ == "__main__":
    unittest.main()
