# NCP Object Storage S3 호환 클라이언트와 presigned URL 발급을 담당한다.
from __future__ import annotations

from typing import Any
from uuid import uuid4

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from questbook_api.settings import AppSettings


# 변수 의미: 사진 증빙 업로드에 허용할 MIME 타입별 확장자다.
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
}
# 변수 의미: Questbook에서 허용하는 Object Storage 업로드 목적이다.
ALLOWED_UPLOAD_PURPOSES = {"quest_receipt", "quest_photo", "user_auth_photo"}
# 변수 의미: Object Storage 연동에 필요한 환경 변수 이름 목록이다.
REQUIRED_OBJECT_STORAGE_ENV = [
    "NCP_OBJECT_STORAGE_BUCKET_NAME",
    "NCP_OBJECT_STORAGE_ACCESS_KEY",
    "NCP_OBJECT_STORAGE_SECRET_KEY",
]


def sanitize_object_key_token(value: str, fallback: str = "unknown") -> str:
    """
    입력: 객체 키 조각으로 사용할 문자열과 fallback 값.
    출력: 슬래시와 공백이 제거된 안전한 객체 키 토큰.
    역할: 사용자 입력이 Object Storage 경로를 벗어나지 않게 한다.
    호출 예시: token = sanitize_object_key_token("usr_abc")
    """
    # 변수 의미: 원본 문자열에서 앞뒤 공백을 제거한 값이다.
    stripped_value = value.strip()
    # 변수 의미: 객체 키 토큰에 허용되는 문자만 남긴 값이다.
    sanitized = "".join(
        character if character.isalnum() or character in {"-", "_"} else "-"
        for character in stripped_value
    ).strip("-")
    return (sanitized or fallback)[:96]


def normalize_image_content_type(content_type: str) -> str:
    """
    입력: 브라우저가 보낸 파일 Content-Type 값.
    출력: 허용된 이미지 Content-Type.
    역할: 사진 증빙 업로드를 이미지 파일로 제한한다.
    호출 예시: content_type = normalize_image_content_type("image/jpeg")
    """
    # 변수 의미: 파라미터가 붙은 Content-Type에서 MIME 타입만 분리한 값이다.
    normalized = content_type.split(";", 1)[0].strip().lower()
    if normalized not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise ValueError("Only jpeg, png, webp, heic, and heif image uploads are allowed.")
    return normalized


def normalize_upload_purpose(purpose: str) -> str:
    """
    입력: 업로드 목적 문자열.
    출력: 허용된 업로드 목적 문자열.
    역할: 사진 증빙 객체 키의 상위 디렉토리를 제한한다.
    호출 예시: purpose = normalize_upload_purpose("quest_receipt")
    """
    # 변수 의미: 앞뒤 공백을 제거한 업로드 목적이다.
    normalized = purpose.strip().lower()
    if normalized not in ALLOWED_UPLOAD_PURPOSES:
        raise ValueError("Unsupported upload purpose.")
    return normalized


def is_quest_evidence_purpose(purpose: str) -> bool:
    """
    입력: 업로드 목적 문자열.
    출력: 퀘스트 인스턴스에 묶인 증빙인지 여부.
    역할: 퀘스트 사진과 영수증에는 questInstanceId를 요구한다.
    호출 예시: if is_quest_evidence_purpose("quest_photo"): ...
    """
    return purpose in {"quest_receipt", "quest_photo"}


class ObjectStorageClient:
    """
    입력: 앱 설정.
    출력: NCP Object Storage S3 호환 작업 클라이언트.
    역할: 비밀 키를 서버에만 보관하고 브라우저에는 presigned URL만 발급한다.
    호출 예시: client = ObjectStorageClient(settings)
    """

    def __init__(self, settings: AppSettings) -> None:
        """
        입력: 앱 설정.
        출력: 없음.
        역할: Object Storage 접속 설정을 보관한다.
        호출 예시: client = ObjectStorageClient(settings)
        """
        # 변수 의미: 앱 API 실행 설정이다.
        self.settings = settings

    def is_configured(self) -> bool:
        """
        입력: 없음.
        출력: Object Storage 필수 설정 완료 여부.
        역할: 버킷과 API 키가 모두 준비됐는지 확인한다.
        호출 예시: if client.is_configured(): ...
        """
        return bool(
            self.settings.object_storage_bucket_name
            and self.settings.object_storage_access_key
            and self.settings.object_storage_secret_key
        )

    def status(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: 비밀 값을 제외한 Object Storage 설정 상태.
        역할: 헬스체크와 설정 확인 API가 비밀 노출 없이 준비 상태를 보여준다.
        호출 예시: payload = client.status()
        """
        # 변수 의미: 아직 채워지지 않은 필수 환경 변수 이름 목록이다.
        missing_env = [
            name
            for name, value in {
                "NCP_OBJECT_STORAGE_BUCKET_NAME": self.settings.object_storage_bucket_name,
                "NCP_OBJECT_STORAGE_ACCESS_KEY": self.settings.object_storage_access_key,
                "NCP_OBJECT_STORAGE_SECRET_KEY": self.settings.object_storage_secret_key,
            }.items()
            if not value
        ]
        return {
            "configured": self.is_configured(),
            "endpointUrl": self.settings.object_storage_endpoint_url,
            "regionName": self.settings.object_storage_region_name,
            "bucketConfigured": bool(self.settings.object_storage_bucket_name),
            "bucketName": self.settings.object_storage_bucket_name,
            "addressingStyle": self.settings.object_storage_addressing_style,
            "presignedUrlTtlSeconds": self.settings.object_storage_presigned_url_ttl_seconds,
            "maxUploadBytes": self.settings.object_storage_max_upload_bytes,
            "requiredEnv": REQUIRED_OBJECT_STORAGE_ENV,
            "missingEnv": missing_env,
        }

    def check_bucket(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: bucket head 요청 결과.
        역할: 운영자가 `.env` 값을 넣은 뒤 실제 Object Storage 접속을 확인한다.
        호출 예시: result = client.check_bucket()
        """
        if not self.is_configured():
            return {"ok": False, "reason": "not_configured", "status": self.status()}

        try:
            self._s3_client().head_bucket(Bucket=self.settings.object_storage_bucket_name)
        except ClientError as error:
            # 변수 의미: NCP Object Storage가 돌려준 안전한 오류 코드다.
            error_code = str(error.response.get("Error", {}).get("Code", "client_error"))
            return {"ok": False, "reason": error_code, "bucketName": self.settings.object_storage_bucket_name}
        except BotoCoreError as error:
            return {"ok": False, "reason": error.__class__.__name__, "bucketName": self.settings.object_storage_bucket_name}
        return {"ok": True, "bucketName": self.settings.object_storage_bucket_name}

    def create_presigned_upload(
        self,
        user_id: str,
        purpose: str,
        content_type: str,
        quest_instance_id: str = "",
    ) -> dict[str, Any]:
        """
        입력: 사용자 ID, 업로드 목적, Content-Type, 선택적 퀘스트 인스턴스 ID.
        출력: 브라우저가 Object Storage로 직접 업로드할 presigned PUT 정보.
        역할: 서버 비밀 키 없이 제한된 시간 안에서 사진 업로드를 허용한다.
        호출 예시: upload = client.create_presigned_upload("usr_x", "quest_photo", "image/jpeg", "uqi_x")
        """
        if not self.is_configured():
            raise RuntimeError("NCP Object Storage is not configured.")

        # 변수 의미: 검증된 업로드 목적이다.
        normalized_purpose = normalize_upload_purpose(purpose)
        # 변수 의미: 검증된 이미지 Content-Type이다.
        normalized_content_type = normalize_image_content_type(content_type)
        # 변수 의미: 발급할 Object Storage 객체 키다.
        object_key = self.build_evidence_object_key(
            user_id,
            normalized_purpose,
            normalized_content_type,
            quest_instance_id,
        )
        # 변수 의미: 업로드 URL 생성에 사용할 S3 요청 파라미터다.
        params = {
            "Bucket": self.settings.object_storage_bucket_name,
            "Key": object_key,
            "ContentType": normalized_content_type,
        }
        # 변수 의미: boto3가 생성한 presigned PUT URL이다.
        upload_url = self._s3_client().generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=self.settings.object_storage_presigned_url_ttl_seconds,
            HttpMethod="PUT",
        )
        return {
            "method": "PUT",
            "url": upload_url,
            "headers": {"Content-Type": normalized_content_type},
            "objectKey": object_key,
            "contentType": normalized_content_type,
            "expiresInSeconds": self.settings.object_storage_presigned_url_ttl_seconds,
            "maxUploadBytes": self.settings.object_storage_max_upload_bytes,
        }

    def create_presigned_download(self, user_id: str, object_key: str) -> dict[str, Any]:
        """
        입력: 사용자 ID와 Object Storage 객체 키.
        출력: 짧은 만료 시간의 다운로드 URL.
        역할: 본인 prefix에 저장된 사진만 과거 기록 확인과 공유용으로 읽게 한다.
        호출 예시: download = client.create_presigned_download("usr_x", "users/usr_x/quests/uqi_x/evidence/...")
        """
        if not self.is_configured():
            raise RuntimeError("NCP Object Storage is not configured.")

        # 변수 의미: 사용자 prefix 권한 검증을 통과한 객체 키다.
        validated_object_key = self.validate_user_object_key(user_id, object_key)
        # 변수 의미: 다운로드 URL 생성에 사용할 S3 요청 파라미터다.
        params = {"Bucket": self.settings.object_storage_bucket_name, "Key": validated_object_key}
        # 변수 의미: boto3가 생성한 presigned GET URL이다.
        download_url = self._s3_client().generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=self.settings.object_storage_presigned_url_ttl_seconds,
            HttpMethod="GET",
        )
        return {
            "method": "GET",
            "url": download_url,
            "objectKey": validated_object_key,
            "expiresInSeconds": self.settings.object_storage_presigned_url_ttl_seconds,
        }

    def build_evidence_object_key(
        self,
        user_id: str,
        purpose: str,
        content_type: str,
        quest_instance_id: str = "",
    ) -> str:
        """
        입력: 사용자 ID, 업로드 목적, 이미지 Content-Type, 선택적 퀘스트 인스턴스 ID.
        출력: Questbook 사진 증빙용 Object Storage 객체 키.
        역할: 원본 사진을 사용자별 prefix 아래에만 저장하게 한다.
        호출 예시: key = client.build_evidence_object_key("usr_x", "quest_receipt", "image/jpeg", "uqi_x")
        """
        # 변수 의미: 검증된 업로드 목적이다.
        normalized_purpose = normalize_upload_purpose(purpose)
        # 변수 의미: 검증된 이미지 Content-Type이다.
        normalized_content_type = normalize_image_content_type(content_type)
        # 변수 의미: 객체 키에 넣을 파일 확장자다.
        extension = ALLOWED_IMAGE_CONTENT_TYPES[normalized_content_type]
        # 변수 의미: 객체 키에 넣을 사용자 ID 토큰이다.
        safe_user_id = sanitize_object_key_token(user_id, "user")
        # 변수 의미: 객체 키에 넣을 업로드 목적 토큰이다.
        safe_purpose = sanitize_object_key_token(normalized_purpose, "evidence")
        # 변수 의미: 중복 방지를 위한 랜덤 파일 이름이다.
        file_stem = uuid4().hex
        if is_quest_evidence_purpose(normalized_purpose):
            if not quest_instance_id:
                raise ValueError("questInstanceId is required for quest evidence uploads.")
            # 변수 의미: 객체 키에 넣을 퀘스트 인스턴스 ID 토큰이다.
            safe_quest_instance_id = sanitize_object_key_token(quest_instance_id, "quest")
            return (
                f"users/{safe_user_id}/quests/{safe_quest_instance_id}/"
                f"evidence/{safe_purpose}/{file_stem}.{extension}"
            )
        return f"users/{safe_user_id}/identity/evidence/{safe_purpose}/{file_stem}.{extension}"

    def validate_user_object_key(self, user_id: str, object_key: str) -> str:
        """
        입력: 사용자 ID와 클라이언트가 요청한 객체 키.
        출력: 같은 사용자 prefix에 속하는 검증된 객체 키.
        역할: 다른 사용자의 사진에 대한 presigned URL 발급을 막는다.
        호출 예시: key = client.validate_user_object_key("usr_x", "users/usr_x/...")
        """
        # 변수 의미: 앞뒤 공백을 제거한 객체 키다.
        normalized_key = object_key.strip()
        # 변수 의미: 현재 사용자에게 허용된 객체 키 prefix다.
        allowed_prefix = f"users/{sanitize_object_key_token(user_id, 'user')}/"
        if not normalized_key or normalized_key.startswith("/") or "/../" in f"/{normalized_key}/":
            raise ValueError("Invalid object key.")
        if not normalized_key.startswith(allowed_prefix):
            raise PermissionError("Object key is outside the current user prefix.")
        return normalized_key

    def _s3_client(self) -> Any:
        """
        입력: 없음.
        출력: boto3 S3 클라이언트.
        역할: NCP Object Storage S3 호환 엔드포인트용 클라이언트를 만든다.
        호출 예시: s3 = self._s3_client()
        """
        if not self.is_configured():
            raise RuntimeError("NCP Object Storage is not configured.")
        return boto3.client(
            "s3",
            endpoint_url=self.settings.object_storage_endpoint_url,
            region_name=self.settings.object_storage_region_name,
            aws_access_key_id=self.settings.object_storage_access_key,
            aws_secret_access_key=self.settings.object_storage_secret_key,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": self.settings.object_storage_addressing_style},
            ),
        )
